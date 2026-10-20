import { useCallback, useEffect, useRef } from 'react'
import {
  BRIDGE_APIS,
  BRIDGE_RATE_PER_SEC,
  ZN_BRIDGE_VERSION,
  createRateGate,
  isReplyTooLarge,
  makeBridgeToken,
  parseBridgeCall,
  type BridgeHelloMessage,
  type BridgeReplyMessage,
  type WebviewBridgeHandler,
} from '../kernel/webview-bridge'

/**
 * WebView 逃生口 —— 插件挂**自己的页面**（画布、视频首帧、地图、可视化…）。
 *
 * 这是契约 §2.2 / §7.9 的实现，四条刻意取舍：
 *
 * ① `sandbox="allow-scripts"`，**刻意不给 `allow-same-origin`** ⇒ iframe 是 opaque origin：
 *    宿主碰不到它的 DOM，它也碰不到宿主的 DOM / localStorage / Tauri IPC。
 *    这是"逃生口"最要紧的性质 —— 页面可以有脚本，但拿不到宿主。
 *
 * ② 代价：**CSS 自定义属性不跨文档边界**，所以宿主没法把 `--zn-*` 令牌"灌"进去。
 *    令牌改用 `postMessage` 送：`{ type: 'zn:theme', mode, tokens }`（约定见契约 §2.2）。
 *    主题一变化（`<html data-theme>` 变了）就**自动重发**，所以画布能跟着深浅色走。
 *
 * ③ **能力通道**（rev173.76）：页面不能调 `ctx.*`，但可以发 `zn:call` 请求宿主代跑
 *    白名单里那几条（store / notify / 本插件命令）。协议、令牌、限流在
 *    `kernel/webview-bridge.ts`；能力实现在 `kernel/plugin-host.ts`。
 *    **没有 `bridge` prop 时通道关闭** —— 页面只收主题令牌，与 rev55 行为一致。
 *
 * ④ **不注入任何脚本**：iframe 里跑什么完全由插件自己的页面决定，宿主只发消息。
 */
export type ZnThemeMessage = {
  type: 'zn:theme'
  mode: 'light' | 'dark'
  /** 宿主当前生效的全部 `--zn-*` 设计令牌（键含前导 `--`） */
  tokens: Record<string, string>
}

export function WebViewFrame({
  url,
  title,
  pluginId,
  bridge,
}: {
  url: string
  title: string
  /** 面板归属的插件 id（握手消息里带给页面，便于页面自己记录） */
  pluginId?: string
  /** 能力通道执行器；不传 = 通道关闭（只收主题令牌） */
  bridge?: WebviewBridgeHandler
}) {
  const ref = useRef<HTMLIFrameElement | null>(null)
  /** 本次 load 的通道令牌；每次 load 重新生成 ⇒ 旧页面的令牌随导航作废 */
  const tokenRef = useRef('')
  /** 每秒调用次数闸门（每个 iframe 一份） */
  const gateRef = useRef(createRateGate())
  /**
   * 回调 / props 放 ref：message 监听只挂一次（依赖 `[]`），
   * 这样插件重载换了 bridge 实例也不需要重挂窗口监听。
   *
   * ⚠️ 不能在渲染期间写 `.current`（`react(refs)` 警告）—— 用 effect 同步；
   * 初次渲染时 `useRef(bridge)` 的初值就是对的，`load` 事件一定晚于 effect。
   */
  const bridgeRef = useRef<WebviewBridgeHandler | undefined>(bridge)
  const pluginIdRef = useRef<string | undefined>(pluginId)
  useEffect(() => {
    bridgeRef.current = bridge
  }, [bridge])
  useEffect(() => {
    pluginIdRef.current = pluginId
  }, [pluginId])

  /** 读 `<html>` 上当前生效的令牌，发给 iframe（主题切换时重发） */
  const sendTokens = useCallback(() => {
    const win = ref.current?.contentWindow
    if (!win) return
    const cs = getComputedStyle(document.documentElement)
    const tokens: Record<string, string> = {}
    for (const name of Array.from(cs)) {
      if (name.startsWith('--zn-')) tokens[name] = cs.getPropertyValue(name).trim()
    }
    const mode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    const msg: ZnThemeMessage = { type: 'zn:theme', mode, tokens }
    // targetOrigin 用 '*'：iframe 是 opaque origin，没法比对来源；
    // 送出去的只有设计令牌，没有任何用户数据。
    win.postMessage(msg, '*')
  }, [])

  /**
   * 能力通道握手：iframe 每次 `load` 发一份**新**令牌。
   * 令牌换新就作废旧的 —— iframe 导航去别的页面时 WindowProxy 不变，
   * 只有「新页面拿不到旧令牌」这一条能挡住"换了页面还能调 API"。
   */
  const sendHello = useCallback(() => {
    const win = ref.current?.contentWindow
    if (!win) return
    tokenRef.current = makeBridgeToken()
    gateRef.current = createRateGate()
    const msg: BridgeHelloMessage = {
      zn: ZN_BRIDGE_VERSION,
      type: 'zn:hello',
      token: tokenRef.current,
      pluginId: pluginIdRef.current ?? '',
      apis: [...BRIDGE_APIS],
    }
    win.postMessage(msg, '*')
  }, [])

  const onLoad = useCallback(() => {
    sendTokens()
    // 没有 bridge = 通道关闭：页面收不到 hello，`zn:call` 会被一律忽略
    if (bridgeRef.current) sendHello()
  }, [sendHello, sendTokens])

  /** 页面请求 → 校验 → 代跑 → 应答（全程不抛错到 React 树外） */
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const win = ref.current?.contentWindow
      // opaque origin 下 `event.origin` 恒为 'null'，唯一可靠的身份是 WindowProxy 本身
      if (!win || ev.source !== win) return
      const call = parseBridgeCall(ev.data)
      if (!call) return

      const base = { zn: ZN_BRIDGE_VERSION, type: 'zn:reply' as const, id: call.id }
      const reply = (msg: BridgeReplyMessage) => {
        try {
          win.postMessage(msg, '*')
        } catch {
          /* 页面正在卸载：丢了就丢了 */
        }
      }

      if (!bridgeRef.current) {
        reply({ ...base, ok: false, error: '这个面板没有开启能力通道（宿主未提供 bridge）' })
        return
      }
      if (call.token !== tokenRef.current) {
        reply({ ...base, ok: false, error: '令牌无效或已过期（页面重新加载后要等 zn:hello）' })
        return
      }
      if (!gateRef.current()) {
        reply({ ...base, ok: false, error: `调用太频繁（每秒上限 ${BRIDGE_RATE_PER_SEC} 次）` })
        return
      }
      void bridgeRef
        .current(call.api, call.args ?? [])
        .then(
          (value) => {
            const ok: BridgeReplyMessage = { ...base, ok: true, value }
            if (isReplyTooLarge(ok)) {
              reply({ ...base, ok: false, error: '应答太大（上限 256 KB），请分页 / 减少字段' })
              return
            }
            reply(ok)
          },
          (e: unknown) => {
            reply({ ...base, ok: false, error: e instanceof Error ? e.message : String(e) })
          },
        )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    // 主题由 applyTheme() 写到 `<html data-theme>`（见 lib/theme.ts）—— 盯这个属性
    const mo = new MutationObserver(sendTokens)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    // 「跟随系统」时 system 变化不改 data-theme、只改解析结果 ⇒ 也得盯一眼
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', sendTokens)
    return () => {
      mo.disconnect()
      mq.removeEventListener('change', sendTokens)
    }
  }, [sendTokens])

  return (
    <iframe
      ref={ref}
      src={url}
      title={title}
      sandbox="allow-scripts"
      onLoad={onLoad}
      className="zn-webview-frame"
    />
  )
}
