/**
 * 窗口控制三键：**最小化 / 最大化（还原）/ 关闭** —— 主窗口与插件独立窗口共用。
 *
 * 为什么要抽出来（rev53）：插件窗口第一版只有一颗「关闭」文字按钮，用户一眼就问
 * "最小化最大化和 × 呢？" —— 窗口该有的三键一个都不能少，而且**两个窗口的按钮要长得一样**。
 * 抽成一个组件，主窗口（`TitleBar`）与插件窗口（`App.tsx` 的窗口模式标题条）都用它。
 *
 * ## 三条实现要点（照抄主窗口踩过的结论）
 * 1. **拖动**：拖动区由调用方标 `data-tauri-drag-region`；`data-tauri-drag-region` **不继承**给子元素，
 *    所以标题文字要单独标一次，**按钮绝不能标**（否则点不动）。
 * 2. **双击最大化**由 drag-region 内置处理，不用自己写。
 * 3. **最大化图标随状态切换**：用 Tauri 的 `onResized` 监听（它由窗口管理器驱动 ——
 *    双击标题栏 / `Win+↑` / 拖到屏幕边缘触发最大化时同样会派发），再问 `isMaximized()`。
 *
 * ## `onClose` 为什么必须能换
 * 主窗口关闭走 `close()`（内核有"关窗前落盘"监听器兜着）；插件窗口走 `destroy()`
 * —— 不是因为它"会死锁"，而是因为 **`close()` 只发 `tauri://close-requested` 事件、
 * 真正销毁靠监听器里的 `destroy()`**（证据与源码见 `App.tsx` 里那个极简 close 监听器的注释）。
 * 插件窗口的三键直接 `destroy()` 最省一层：它是用户明确点的"关"，不需要再走一遍请求。
 */
import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

export function WindowControls({ onClose }: { onClose?: () => void }) {
  const win = getCurrentWindow()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    void (async () => {
      try {
        const now = await win.isMaximized()
        if (!disposed) setMaximized(now)
        unlisten = await win.onResized(async () => {
          setMaximized(await win.isMaximized())
        })
      } catch {
        /* 非 Tauri 环境（浏览器预览）拿不到窗口状态 —— 不影响其它功能 */
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [win])

  return (
    <div className="zn-window-controls">
      <button
        type="button"
        className="zn-win-btn"
        onClick={() => void win.minimize()}
        title="最小化"
        aria-label="最小化"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5.5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
      <button
        type="button"
        className="zn-win-btn"
        onClick={() => void win.toggleMaximize()}
        title={maximized ? '向下还原' : '最大化'}
        aria-label={maximized ? '向下还原' : '最大化'}
      >
        {maximized ? (
          /* 还原：两个叠起来的方框（后面的框只画露出来的两条边） */
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
            <path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="zn-win-btn is-close"
        onClick={() => (onClose ? onClose() : void win.close())}
        title="关闭窗口"
        aria-label="关闭窗口"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  )
}
