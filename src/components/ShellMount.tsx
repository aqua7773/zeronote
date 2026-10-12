/**
 * 整窗接管的**挂载器**（U2 · 2026-10-13 rev51）
 *
 * 内核只维护"谁在接管"这本账并通知宿主；真正的 DOM 挂载在这里 ——
 * 与面板（`panels` → `UIRenderer`）同一个模式：**内核不碰 React 树**。
 *
 * 三条规矩：
 *  · `mount(el, ctx)` **只调用一次**（依赖是 `[spec, ctx]`，两者都由上层稳定住）——
 *    每次重渲染都重跑会把插件自己的 DOM 状态（滚动位置、焦点、画布内容）全部毁掉。
 *  · 释放时**先调插件返回的 `Disposable`**（让它自己收拾），**再清空容器** ——
 *    顺序反了就变成"插件想在还存在的 DOM 上收尾，DOM 已经没了"。
 *  · 插件的 `mount` 抛错不白屏：把"谁 + 什么错"写在容器里（内核 UI 会在释放/卸载后回来）。
 */
import { useEffect, useRef } from 'react'
import type { Disposable, ShellMountCtx, ShellSpec } from '../kernel/contract'

export function ShellMount({ spec, ctx }: { spec: ShellSpec; ctx: ShellMountCtx }) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let cleanup: Disposable | void
    try {
      cleanup = spec.mount(el, ctx)
    } catch (e) {
      el.textContent = `插件 ${ctx.pluginId} 的整窗接管 mount 抛错：${String(e)}`
    }
    return () => {
      try {
        if (cleanup && typeof cleanup.dispose === 'function') cleanup.dispose()
      } catch {
        /* 插件清理抛错不阻断内核复原 */
      }
      el.replaceChildren()
    }
  }, [spec, ctx])

  return <div className="zn-shell-mount" ref={ref} />
}
