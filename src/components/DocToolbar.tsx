/**
 * 文档工具条（UI 重布局 B4 · 方案 §2.1 / §3.3）。
 *
 * 位置：标签条下方、编辑区上方，**只在桌面 + 有打开的文档时**渲染。
 *
 * 三块内容：
 *  - 左：`location: 'editor-topbar'` 的插件面板（反链 / 历史这类「贴着当前文档」的东西）。
 *        没插件注册 ⇒ 这块整块不渲染，不留空位（方案 §1.3 零插件基线）。
 *  - 右：固定两项内核动作 —— 「源码 / 预览」与「⋯ 更多」。
 *  - 手机端不用这个组件：那里「源码」还钉在编辑器右上角（B2 已定），
 *    `editor-topbar` 面板仍由 `App.tsx` 按旧路径渲染。
 *
 * 为什么「源码」从这里出：方案 §2.1「文档工具条固定「源码 / 更多」」，且 O1 要求可点元素
 * ≥24×24 —— 编辑器里那个 24px 浮按钮在窄窗口下会被右上角的「关闭」压住，挪到工具条里
 * 两个动作并排、尺寸统一。
 */
import type { PanelRegistration } from '../kernel/kernel'
import { renderPanelSafe } from '../kernel/panel-safe'
import { PanelBoundary } from './PanelBoundary'
import {
  UIRenderer,
  type UIActionHandler,
  type UIStateChangeHandler,
} from './UIRenderer'

export type DocToolbarProps = {
  /** 当前是否源码模式（受控值，状态在宿主 `App`） */
  sourceMode: boolean
  onToggleSourceMode: () => void
  /** 点「更多」时把按钮位置交回宿主（那里弹 ContextMenu） */
  onMore: (at: { x: number; y: number }) => void
  /** `location: 'editor-topbar'` 的面板（禁用 / 未装 ⇒ 空数组） */
  panels: PanelRegistration[]
  panelState: Record<string, unknown>
  onAction: UIActionHandler
  onStateChange: UIStateChangeHandler
}

export function DocToolbar({
  sourceMode,
  onToggleSourceMode,
  onMore,
  panels,
  panelState,
  onAction,
  onStateChange,
}: DocToolbarProps) {
  return (
    <div className="zn-doc-toolbar">
      <div className="zn-doc-toolbar-left">
        {panels.map((p) => (
          <PanelBoundary key={p.id}>
            <UIRenderer
              node={renderPanelSafe(p, panelState)}
              state={panelState}
              onAction={onAction}
              onStateChange={onStateChange}
            />
          </PanelBoundary>
        ))}
      </div>
      <div className="zn-doc-toolbar-right">
        <button
          type="button"
          className="zn-doc-toolbar-btn"
          onClick={onToggleSourceMode}
          title={
            sourceMode ? '切回预览（Live Preview）' : '切换到源码模式（显示原始 markdown）'
          }
          aria-pressed={sourceMode}
        >
          {sourceMode ? '预览' : '源码'}
        </button>
        <button
          type="button"
          className="zn-doc-toolbar-btn is-icon"
          onClick={(e) => {
            /* 弹在按钮**右下角**：菜单从按钮底部展开，不与工具条重叠 */
            const r = e.currentTarget.getBoundingClientRect()
            onMore({ x: r.left, y: r.bottom })
          }}
          title="当前文档的更多操作"
          aria-label="更多文档操作"
          aria-haspopup="menu"
        >
          ⋯
        </button>
      </div>
    </div>
  )
}
