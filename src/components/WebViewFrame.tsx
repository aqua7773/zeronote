import { useCallback, useEffect, useRef } from 'react'

/**
 * WebView 逃生口 —— 插件挂**自己的页面**（画布、视频首帧、地图、可视化…）。
 *
 * 这是契约 §2.2 / §7.9 的最小实现，三条刻意取舍：
 *
 * ① `sandbox="allow-scripts"`，**刻意不给 `allow-same-origin`** ⇒ iframe 是 opaque origin：
 *    宿主碰不到它的 DOM，它也碰不到宿主的 DOM / localStorage / Tauri IPC。
 *    这是"逃生口"最要紧的性质 —— 页面可以有脚本，但拿不到宿主。
 *
 * ② 代价：**CSS 自定义属性不跨文档边界**，所以宿主没法把 `--zn-*` 令牌"灌"进去。
 *    令牌改用 `postMessage` 送：`{ type: 'zn:theme', mode, tokens }`（约定见契约 §2.2）。
 *    页面自己决定怎么用 —— 例如 `document.documentElement.style.setProperty(name, value)`。
 *    主题一变化（`<html data-theme>` 变了）就**自动重发**，所以画布能跟着深浅色走。
 *
 * ③ **不注入任何脚本**：iframe 里跑什么完全由插件自己的页面决定，宿主只送一个消息。
 */
export type ZnThemeMessage = {
  type: 'zn:theme'
  mode: 'light' | 'dark'
  /** 宿主当前生效的全部 `--zn-*` 设计令牌（键含前导 `--`） */
  tokens: Record<string, string>
}

export function WebViewFrame({ url, title }: { url: string; title: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null)

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
      onLoad={sendTokens}
      className="zn-webview-frame"
    />
  )
}
