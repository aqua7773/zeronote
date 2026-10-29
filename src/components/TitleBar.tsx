import { useRef } from 'react'
import { cn } from '@/lib/utils'
import { WindowControls } from './WindowControls'

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
 *
 * 2026-10-13 rev53：三键本身抽到 **`WindowControls`**（插件独立窗口共用同一套按钮，
 * 且插件窗口的"关闭"要走 `destroy()` —— 见那个组件的注释）。
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
  /**
   * ☰ 变成**文件树栏（侧栏）开关**（2026-10-18 用户要求，桌面 + 移动端都生效）。
   * 传了它 ⇒ 左键切换侧栏、右键才弹菜单。
   */
  onToggleSidebar?: () => void
  /**
   * 移动端：☰ 已被侧栏开关占用 ⇒ 在它旁边多画一个「⋯」菜单按钮
   * （手机没有右键，菜单必须有可见入口）。
   */
  showMenuButton?: boolean
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
  onToggleSidebar,
  showMenuButton = false,
  showWindowControls = true,
  visible = true,
  onHoverChange,
}: TitleBarProps) {
  // 显隐用**内联样式**：`.zn-titlebar.is-visible` 这条规则在这台 WebView 上不生效
  //（实测 state 已是 true、class 也切了，标题栏却仍不可见），内联优先级最高、一定有效。
  //
  // 用 `margin-top` 而不是 `transform`：标题栏要的是 **push（把下面挤下去）**，
  // 不是 overlay（浮在内容上面）。margin 参与布局，收起来时下面的内容会跟着顶上来。
  // 只处理 mouseEnter（进栏即显示），**不处理 mouseLeave** ——
  // 收起要走宿主 App 的「离开后停留」逻辑，在这里直接置 false 会把延迟绕过去
  //（实测过：1.5 秒就被收走了）。
  //
  // 展开与收回**同一时长**（用户要求「收回时间跟弹出时间保持一致」）。
  const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'
  const barStyle = {
    marginTop: visible ? 0 : -32,
    opacity: visible ? 1 : 0,
    transition: `margin-top 450ms ${EASE}, opacity 450ms ${EASE}`,
  }

  /**
   * 长按 ☰ = 打开菜单（rev173.48 · 用户要求「手机搜索入口：长按 ☰ 触发桌面右键动作」）。
   *
   * 背景：桌面右键 ☰ 一直是菜单入口；手机没有右键，而 ☰ 的短按被侧栏开关占用
   * （2026-10-18 用户要求），于是手机上**没有任何菜单入口** —— 搜索 / 插件管理 / 设置
   * 在手机上全是死角。长按复用同一个 `onMenu`（宿主弹的是同一份 menuItems）。
   *
   * 时长与卡片长按同一量级（500ms）；松手补发的 click 必须吃掉，否则会顺带切一次侧栏。
   */
  const HOLD_MS = 500
  const holdTimer = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const cancelHold = () => {
    if (holdTimer.current !== null) {
      window.clearTimeout(holdTimer.current)
      holdTimer.current = null
    }
  }
  const onHoldStart = () => {
    // 每次新按压都重置抑制标记（上一次长按留下的标记不能影响这次短按）
    suppressClick.current = false
    cancelHold()
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null
      suppressClick.current = true
      onMenu({ x: 0, y: 32 })
    }, HOLD_MS)
  }

  return (
    <header
      className="zn-titlebar"
      data-tauri-drag-region
      style={barStyle}
      onMouseEnter={() => onHoverChange?.(true)}
      onFocus={() => onHoverChange?.(true)}
    >
      <button
        type="button"
        className="zn-icon-btn"
        onPointerDown={onHoldStart}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        onClick={() => {
          // 长按那一下松手会补发 click —— 吃掉它，别顺带切一次侧栏
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          // 桌面：左键 = 文件树栏开关（2026-10-18 用户要求）；菜单让给右键与长按。
          // 移动端：没有 onToggleSidebar ⇒ 保持原行为（左键弹菜单，抽屉从菜单进）。
          if (onToggleSidebar) {
            onToggleSidebar()
            return
          }
          // 悬挂菜单：**左对齐窗口左边**（x=0）、**顶边贴在标题栏下沿**（y=32）、不留空隙。
          //（用户要求：「左对齐，不留空隙，顶部是贴标题栏底部，不是两个顶部重合」）
          // 32 就是标题栏高度（`.zn-titlebar` 的 height）—— 改高度时这两处要一起改。
          onMenu({ x: 0, y: 32 })
        }}
        onContextMenu={(e) => {
          // 右键 ☰ 永远弹菜单（桌面：左键也是菜单；手机：左键是抽屉，右键罕见但仍给菜单）
          e.preventDefault()
          onMenu({ x: 0, y: 32 })
        }}
        title={onToggleSidebar ? '切换文件树栏（右键或长按打开菜单）' : '主菜单'}
        aria-label={onToggleSidebar ? '切换文件树栏' : '菜单'}
        aria-haspopup={onToggleSidebar ? undefined : 'menu'}
      >
        ☰
      </button>

      {/* 移动端：☰ 已让给侧栏开关（手机没有右键），菜单改由这个「⋯」进 */}
      {showMenuButton ? (
        <button
          type="button"
          className="zn-icon-btn"
          onClick={() => onMenu({ x: 0, y: 32 })}
          title="菜单"
          aria-label="菜单"
          aria-haspopup="menu"
        >
          ⋯
        </button>
      ) : null}

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

      {showWindowControls ? <WindowControls /> : null}
    </header>
  )
}
