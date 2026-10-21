/**
 * **DOM 直挂面板的挂载器**（rev173.81）。
 *
 * 与 `ShellMount`（整窗接管）同一个模式，区别只在容器大小与外壳归谁：
 * · `ShellMount` —— 插件把内核 UI **整个请下场**，自己画一整窗；退出靠插件自己的 UI。
 * · 本文件 —— 插件只画**主区 / 窗口内容区**这一块，内核的顶栏与返回按钮保留。
 *
 * 为什么需要它（不要退回 `overrideShell`）：PDF（pdf.js + canvas）、思维导图（mind-elixir）
 * 需要真 DOM 与脚本，`render` 的 21 种 UINode 塞不进去；而整窗接管会让"返回"变成
 * 各插件自己的一件事（实测三种退出方式并存：内核右下角按钮 / 插件顶栏 ✕ / 返回键直接退 App）。
 * 面板 + `mount` 复用了面板已有的一切：`core.panel.<id>` 命令、`mainView`、返回键层栈、`openWindow` 校验。
 *
 * 三条规矩（照抄 `ShellMount` 的实测结论，别改）：
 *  · `mount(el, ctx)` **只调用一次**（依赖是 `[panel]`）—— 面板对象在 `onPanelsChange` 时引用不变，
 *    所以 `view.refresh()` 与 `setState` **不会**重挂，插件自己的滚动位置 / 焦点 / 画布不会被毁掉。
 *  · `ctx.state` 是 **getter**：读到的永远是最新面板状态，但改状态不触发重挂。
 *  · 释放时**先调**插件返回的 `Disposable`，**再清空容器** —— 顺序反了就是"插件想在还存在的 DOM 上收尾"。
 *  · `mount` 抛错不白屏：错误文本写进容器，其余界面照常（与 `render` 的第一层容错对齐）。
 */
import { useEffect, useRef } from 'react'
import type { Disposable, ViewCtx } from '../kernel/contract'
import type { PanelRegistration } from '../kernel/kernel'

export function PanelMount({
  panel,
  state,
}: {
  panel: PanelRegistration
  state: Record<string, unknown>
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  /** 最新 state：mount 只跑一次，但插件随时能读到当前值 */
  const stateRef = useRef(state)
  /**
   * 同步放 effect 里，**不在渲染期写 ref**（`react(refs)` 规则：渲染期间写 ref 会让
   * 并发渲染下的两次渲染互相污染）。这个 effect 声明在挂载 effect **之前** ⇒ 首次渲染时
   * 先同步 state、再调 `mount`，插件在 mount 里就能读到正确的初始值。
   */
  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    const el = ref.current
    const mount = panel.mount
    if (!el || !mount) return
    el.replaceChildren()
    const ctx: ViewCtx = {
      pluginId: panel.pluginId ?? '',
      get state() {
        return stateRef.current
      },
    }
    let cleanup: Disposable | void
    try {
      cleanup = mount(el, ctx)
    } catch (e) {
      el.textContent = `插件 ${ctx.pluginId} 的面板 ${panel.id} mount 抛错：${String(e)}`
    }
    return () => {
      try {
        if (cleanup && typeof cleanup === 'object' && typeof cleanup.dispose === 'function') {
          cleanup.dispose()
        }
      } catch {
        /* 插件清理抛错不阻断内核 —— 与 ShellMount 同一策略 */
      }
      el.replaceChildren()
    }
  }, [panel])

  return <div className="zn-panel-mount" ref={ref} />
}
