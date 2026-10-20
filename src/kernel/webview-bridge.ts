/**
 * iframe ↔ 宿主的**能力通道**（契约 §2.2 / §7.9 · rev173.76）。
 *
 * 背景：`registerWebView` 的页面是 `sandbox="allow-scripts"`、**没有** `allow-same-origin`
 * ⇒ 它是 opaque origin，拿不到宿主的 DOM / localStorage / Tauri IPC。这在安全上正是想要的性质，
 * 代价是页面里的脚本**调不到任何 `ctx.*`** —— 只能收主题令牌（rev55 的最小版）。
 *
 * 本模块补上「调得了」的那一半，三条硬规矩：
 *
 * ① **绝不把 IPC 暴露给 opaque origin**（契约 §7.9 原话）。页面只能发 `postMessage`，
 *    宿主把**一份白名单子集**翻译成插件自己的 API 调用 —— 页面永远碰不到 `invoke` / Tauri。
 * ② **白名单是「插件已有能力的子集」**，不是新权限：页面能做的事 ⊆ 这个插件能做的事
 *    （store / notify / 自己注册的命令）。`fs` / `doc` 暂不开放 —— 它们需要路径与编辑器上下文，
 *    放进来只会把「同一个插件」切成两种信任级，收益不抵复杂度。
 * ③ **来源与令牌双重校验**：`event.source === 该 iframe 的 contentWindow`（opaque origin 下唯一可靠的
 *    身份）**且**握手令牌匹配。令牌每次 iframe `load` 重新下发 —— iframe 导航到别的页面后
 *    旧令牌随之失效（WindowProxy 不变，但新页面没有令牌）。
 *
 * 纯逻辑（白名单 / 令牌 / 限流 / 执行器）都放这里，`tests/webview-bridge.test.ts` 直接单测；
 * DOM 侧的收发在 `components/WebViewFrame.tsx`，插件实例的接线在 `kernel/plugin-host.ts`。
 */
import type { CommandApi, HostApi, StoreApi } from './contract'

/** 协议版本：出现在 `zn:hello` 里，页面可据此判断宿主是否支持 */
export const ZN_BRIDGE_VERSION = 1 as const

/** 页面 → 宿主：一次调用 */
export type BridgeCallMessage = {
  zn: typeof ZN_BRIDGE_VERSION
  type: 'zn:call'
  /** 握手拿到的令牌 */
  token: string
  /** 请求 id（页面自己生成，应答原样带回） */
  id: string
  api: BridgeApi
  args?: unknown[]
}

/** 宿主 → 页面：一次应答 */
export type BridgeReplyMessage = {
  zn: typeof ZN_BRIDGE_VERSION
  type: 'zn:reply'
  id: string
  ok: boolean
  value?: unknown
  error?: string
}

/** 宿主 → 页面：握手（每次 iframe `load` 都发一份新令牌） */
export type BridgeHelloMessage = {
  zn: typeof ZN_BRIDGE_VERSION
  type: 'zn:hello'
  token: string
  pluginId: string
  /** 本通道允许调用的 api 列表（页面可据此降级） */
  apis: string[]
}

/**
 * 通道白名单 —— **只放"插件自己的数据 + 用户提示 + 自己注册的命令"**。
 *
 * 想加一条之前先问：iframe 里的页面（可能引了 CDN 上的第三方脚本）拿到它，
 * 会不会超出「这个插件本来就能做的事」？（答案必须是「不会」才加。）
 */
export const BRIDGE_APIS = [
  'store.get',
  'store.set',
  'store.delete',
  'store.all',
  'host.info',
  'host.notify',
  'command.execute',
] as const

export type BridgeApi = (typeof BRIDGE_APIS)[number]

export function isBridgeApi(v: unknown): v is BridgeApi {
  return typeof v === 'string' && (BRIDGE_APIS as readonly string[]).includes(v)
}

/** 单条应答序列化后的上限（防止页面要一个巨大 store 把宿主卡住） */
export const BRIDGE_MAX_REPLY_BYTES = 256 * 1024

/** 每个 iframe 每秒最多几次调用（超出直接拒，不排队 —— 排队等于让页面控制宿主的内存） */
export const BRIDGE_RATE_PER_SEC = 20

/** 通道执行器：宿主侧按 api 名分派（由 `plugin-host.ts` 按插件实例构建） */
export type WebviewBridgeHandler = (api: BridgeApi, args: unknown[]) => Promise<unknown>

/** 生成握手令牌。优先 `randomUUID`，老 WebView 退回 `getRandomValues`。 */
export function makeBridgeToken(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const buf = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') {
    c.getRandomValues(buf)
  } else {
    // 理论上到不了这（WebView2 / Android WebView 都有 crypto）；真到了也别静默给空令牌
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 令牌桶：每秒 `maxPerSec` 次，窗口一过就重置。
 *
 * 用固定窗口而不是滑动窗口：这里只需要「别被一个坏循环打爆」，精度不重要，
 * 固定窗口的语义也更好解释（每秒最多 N 次）。
 */
export function createRateGate(
  maxPerSec: number = BRIDGE_RATE_PER_SEC,
  now: () => number = () => Date.now(),
): () => boolean {
  let left = maxPerSec
  let windowStart = now()
  return () => {
    const t = now()
    if (t - windowStart >= 1000) {
      windowStart = t
      left = maxPerSec
    }
    if (left <= 0) return false
    left--
    return true
  }
}

/** 参数数量上限（多传的参数一律忽略；也挡住"用超长 args 撑爆日志"） */
export const BRIDGE_MAX_ARGS = 4

/**
 * 把页面发来的原始消息归一成 `BridgeCallMessage`（只认契约形状）。
 *
 * 返回 `null` = 不是给通道的消息（页面可能用了别的 `type`，宿主必须忽略而不是报错）。
 */
export function parseBridgeCall(raw: unknown): BridgeCallMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Record<string, unknown>
  if (m.zn !== ZN_BRIDGE_VERSION) return null
  if (m.type !== 'zn:call') return null
  if (typeof m.token !== 'string' || !m.token) return null
  if (typeof m.id !== 'string' || !m.id || m.id.length > 64) return null
  if (!isBridgeApi(m.api)) return null
  const args = Array.isArray(m.args) ? m.args.slice(0, BRIDGE_MAX_ARGS) : []
  return { zn: ZN_BRIDGE_VERSION, type: 'zn:call', token: m.token, id: m.id, api: m.api, args }
}

/** 应答体是否超限（按 UTF-8 字节数算 —— 中文 store 值按字符数会低估 3 倍） */
export function isReplyTooLarge(msg: BridgeReplyMessage): boolean {
  let json: string
  try {
    json = JSON.stringify(msg)
  } catch {
    // 循环引用 / BigInt 之类：序列化不了就是超限（由调用方转成错误应答）
    return true
  }
  return new TextEncoder().encode(json).length > BRIDGE_MAX_REPLY_BYTES
}

/**
 * 通道执行器（按插件实例构建）—— **纯逻辑**，不碰 Tauri，可直接单测。
 *
 * 参数一律当**不可信输入**逐条校验：这个入口的另一端是"可能引了 CDN 脚本的第三方页面"。
 * 能力边界取插件已有能力的子集（见文件头三条硬规矩）。
 */
export function createWebviewBridge(opts: {
  pluginId: string
  store: StoreApi
  host: HostApi
  command: CommandApi
  /** 该插件**注册过**的命令 id（`command.execute` 的白名单来源） */
  ownedCommands: Set<string>
}): WebviewBridgeHandler {
  const { pluginId, store, host, command, ownedCommands } = opts

  /** 字符串参数：类型 + 非空 + 长度 */
  const str = (v: unknown, name: string, max = 200): string => {
    if (typeof v !== 'string' || !v) throw new Error(`${name} 必须是非空字符串`)
    if (v.length > max) throw new Error(`${name} 太长（上限 ${max} 字符）`)
    return v
  }

  /** 可序列化 + 体积上限（store 落盘是 JSON 文件，超大值会拖慢整个宿主） */
  const safeValue = (v: unknown): unknown => {
    let json: string
    try {
      json = JSON.stringify(v)
    } catch {
      throw new Error('值无法序列化（不能有循环引用 / BigInt / 函数）')
    }
    if (new TextEncoder().encode(json).length > BRIDGE_MAX_REPLY_BYTES) {
      throw new Error(`值太大（上限 ${Math.round(BRIDGE_MAX_REPLY_BYTES / 1024)} KB）`)
    }
    return v
  }

  return async (api: BridgeApi, args: unknown[]) => {
    switch (api) {
      case 'store.get':
        return store.get(str(args[0], 'key'), args[1])
      case 'store.set':
        await store.set(str(args[0], 'key'), safeValue(args[1]))
        return null
      case 'store.delete':
        await store.delete(str(args[0], 'key'))
        return null
      case 'store.all':
        return store.all()
      case 'host.info':
        return {
          pluginId,
          platform: host.platform,
          appVersion: host.appVersion,
          apiVersion: host.apiVersion,
        }
      case 'host.notify': {
        const msg = str(args[0], '消息', 500)
        const level = args[1] === 'warn' || args[1] === 'error' ? args[1] : 'info'
        host.notify(msg, level)
        return null
      }
      case 'command.execute': {
        const id = str(args[0], '命令 id')
        if (!ownedCommands.has(id)) {
          throw new Error(`命令 ${id} 不属于插件 ${pluginId}（通道只放行本插件注册的命令）`)
        }
        await command.execute(id, args[1])
        return null
      }
      default:
        throw new Error(`通道不支持的 api：${String(api)}`)
    }
  }
}
