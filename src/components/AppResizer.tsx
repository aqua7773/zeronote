/**
 * 侧栏与主区之间的拖拽分隔线 —— 从 `App.tsx` 原样迁出（rev122 · L2）。
 *
 * 事件挂在 document 上 —— 指针拖快时会跑出这条 5px 的窄线，只绑在自己身上会丢事件。
 * 拖拽期间临时锁掉文字选择与光标（`is-resizing` class）。
 * 只在桌面渲染：移动端侧栏是抽屉，宽度由抽屉自己定，没有"调占比"这回事。
 *
 * **键盘可调（B1 · WCAG 2.2 §2.5.7「拖拽必须有单点替代」）**：
 * 分隔线本身可获得焦点（`tabIndex=0`），←/→ 每次 16px、Home/End 到上下限；
 * 用 `role="separator"` + `aria-valuenow` 让读屏器也能读出来。
 */
import { MIN_SIDEBAR_W, MAX_SIDEBAR_W } from '../lib/layout'
export type AppResizerProps = {
  width: number
  /** 拖动中回调（已在此组件内夹好） */
  onResize: (width: number) => void
  /** 无障碍标签；默认是笔记库栏 */
  label?: string
}

export function AppResizer({ width, onResize, label }: AppResizerProps) {
  const clamp = (w: number) => Math.min(MAX_SIDEBAR_W, Math.max(MIN_SIDEBAR_W, w))
  return (
    <div
      className="zn-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label ?? '调整笔记库栏宽度'}
      aria-valuenow={Math.round(width)}
      aria-valuemin={MIN_SIDEBAR_W}
      aria-valuemax={MAX_SIDEBAR_W}
      tabIndex={0}
      onKeyDown={(e) => {
        // WCAG 2.5.7：纯拖拽不算数，键盘必须能完成同一个动作
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          onResize(clamp(width - 16))
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          onResize(clamp(width + 16))
        } else if (e.key === 'Home') {
          e.preventDefault()
          onResize(MIN_SIDEBAR_W)
        } else if (e.key === 'End') {
          e.preventDefault()
          onResize(MAX_SIDEBAR_W)
        }
      }}
      onPointerDown={(e) => {
        // 用 Pointer Events 而不是 mouse 系列：鼠标、触摸、触控笔一套搞定，
        // Android 上没有 mousedown，用 mouse 事件这条分隔线在手机上根本拖不动。
        e.preventDefault()
        const startX = e.clientX
        const startW = width
        const onMove = (ev: PointerEvent) => {
          onResize(clamp(startW + (ev.clientX - startX)))
        }
        const onUp = () => {
          document.removeEventListener('pointermove', onMove)
          document.removeEventListener('pointerup', onUp)
          document.body.classList.remove('is-resizing')
        }
        document.addEventListener('pointermove', onMove)
        document.addEventListener('pointerup', onUp)
        // 用 class 而不是 inline style：拖快时指针会甩到编辑器上，
        // 而 CodeMirror 内部有自己的 user-select，光设 body 的 inline 压不住它。
        document.body.classList.add('is-resizing')
      }}
    />
  )
}
