/**
 * 底部状态栏 —— 从 `App.tsx` 原样迁出（rev122 · L2）。
 *
 * 左侧：笔记/文档计数 + `location: 'statusbar'` 的插件小部件 + 错误提示；
 * 右侧：当前文档字数（不含空白）。
 */
import type { NoteMeta } from '../kernel/contract'
import type { PanelRegistration } from '../kernel/kernel'
import { renderPanelSafe } from '../kernel/panel-safe'
import { PanelBoundary } from './PanelBoundary'
import {
  UIRenderer,
  type UIActionHandler,
  type UIStateChangeHandler,
} from './UIRenderer'

export type AppStatusBarProps = {
  notes: NoteMeta[]
  statusPanels: PanelRegistration[]
  panelState: Record<string, unknown>
  error: string | null
  activePath: string | null
  charCount: number
  onAction: UIActionHandler
  onStateChange: UIStateChangeHandler
}

export function AppStatusBar({
  notes,
  statusPanels,
  panelState,
  error,
  activePath,
  charCount,
  onAction,
  onStateChange,
}: AppStatusBarProps) {
  return (
    <div className="zn-statusbar">
      {/* 左半：库信息与常驻面板。整块包一层，保证从最左开始 ——
          之前只靠末尾一个 margin-left:auto 的空元素压尾，内容为空时排版会漂。 */}
      <div className="zn-statusbar-left">
        {/* 「篇」只数**笔记**：文档（pdf/epub/…）与图片附件都不是笔记，混进同一个数字会误导 */}
        <span>
          {notes.filter((n) => n.kind === 'note').length} 篇
          {notes.some((n) => n.kind === 'doc')
            ? ` · ${notes.filter((n) => n.kind === 'doc').length} 文档`
            : ''}
          {notes.some((n) => n.kind === 'image')
            ? ` · ${notes.filter((n) => n.kind === 'image').length} 附件`
            : ''}
        </span>
        {/* location: 'statusbar' 的面板常驻状态栏（小部件），不进右栏 tab */}
        {statusPanels.map((p) => (
          <PanelBoundary key={p.id}>
            <UIRenderer
              node={renderPanelSafe(p, panelState)}
              state={panelState}
              onAction={onAction}
              onStateChange={onStateChange}
            />
          </PanelBoundary>
        ))}
        {error && <span style={{ color: 'var(--zn-danger)' }}>⚠ {error}</span>}
      </div>
      {/* 右下角：当前文档字数（不含空白） */}
      <span title="当前文档字数（不含空白）">
        {activePath ? `${charCount.toLocaleString()} 字` : ''}
      </span>
    </div>
  )
}
