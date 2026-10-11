import { getCurrentWindow } from '@tauri-apps/api/window'
import { cn } from '@/lib/utils'

/**
 * 自绘窗口标题栏（记事本式）。
 *
 * 背景：`tauri.conf.json` 里关掉了系统装饰（`decorations: false`），
 * 所以「最小化 / 最大化 / 关闭」按钮、可拖动区、文件名都得自己画 ——
 * 换来的是**一条**统一标题栏，而不是「系统栏 + 内容区栏」两条。
 *
 * 三件必须自己处理的事（官方 learn/window-customization）：
 *   ① 拖动：给可拖动区加 `data-tauri-drag-region`。它**不继承**给子元素，
 *      所以标题文字要单独标一次；按钮绝不能标（否则点不动）。
 *   ② 双击最大化：由 drag-region 内置处理，不用自己写。
 *   ③ 移动端根本没有窗口装饰这回事 → `showWindowControls=false` 时不渲染按钮。
 */
export interface TitleBarProps {
  /** 当前文档名；没打开笔记时是库名 */
  title: string
  /** 保存状态文案（已保存 / 未保存 / 保存中… / 保存失败） */
  saveLabel: string
  /** 保存出错 → 文案标红 */
  saveError?: boolean
  /** 有未保存改动 → 文案标黄 */
  saveDirty?: boolean
  /** ☰ 点开菜单：把按钮的屏幕位置交回宿主去弹 */
  onMenu: (at: { x: number; y: number }) => void
  /** 桌面端才渲染窗口控制按钮 */
  showWindowControls?: boolean
  /** 是否滑出显示（自动隐藏：鼠标靠近顶部、或键盘焦点进来时显示） */
  visible?: boolean
  /** 鼠标/焦点进出标题栏 —— 宿主据此保持或取消显示 */
  onHoverChange?: (inside: boolean) => void
}

export function TitleBar({
  title,
  saveLabel,
  saveError,
  saveDirty,
  onMenu,
  showWindowControls = true,
  visible = true,
  onHoverChange,
}: TitleBarProps) {
  const win = getCurrentWindow()

  // 显隐用**内联样式**：`.zn-titlebar.is-visible` 这条规则在这台 WebView 上不生效
  //（实测 state 已是 true、class 也切了，标题栏却仍不可见），内联优先级最高、一定有效。
  const barStyle = {
    transform: visible ? 'translateY(0)' : 'translateY(-100%)',
    opacity: visible ? 1 : 0,
  }

  return (
    <header
      className="zn-titlebar"
      data-tauri-drag-region
      style={barStyle}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocus={() => onHoverChange?.(true)}
      onBlur={(e) => {
        // 焦点移到标题栏之外才收起（用 Tab 在栏内移动不算离开）
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onHoverChange?.(false)
        }
      }}
    >
      <button
        type="button"
        className="zn-icon-btn"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onMenu({ x: r.left, y: r.bottom + 4 })
        }}
        title="菜单"
        aria-label="菜单"
        aria-haspopup="menu"
      >
        ☰
      </button>

      <span className="zn-titlebar-name" data-tauri-drag-region title={title}>
        {title}
      </span>

      <span
        className={cn(
          'zn-save-state',
          saveError ? 'is-error' : saveDirty ? 'is-dirty' : '',
        )}
      >
        {saveLabel}
      </span>

      {showWindowControls ? (
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
            title="最大化 / 还原"
            aria-label="最大化或还原"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <rect
                x="0.5"
                y="0.5"
                width="9"
                height="9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </button>
          <button
            type="button"
            className="zn-win-btn is-close"
            onClick={() => void win.close()}
            title="关闭窗口"
            aria-label="关闭窗口"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      ) : null}
    </header>
  )
}
