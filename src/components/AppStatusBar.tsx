/**
 * 底部状态栏 —— 从 `App.tsx` 原样迁出（rev122 · L2）。
 *
 * **B4 瘦身（方案 §2.1 / D4 / O1）**：这里现在**只放状态**。
 *  - 左：`location: 'statusbar'` 的插件 chip（同步状态、安全锁定这类「一行状态」）与错误提示；
 *  - 右：当前文档字数（不含空白）。
 *
 * 移走的东西：
 *  - **篇数统计**（`N 篇 · N 文档 · N 附件`）—— 那是库信息，属于侧栏文件树；
 *    状态栏当年被当成了"导航 + 计数 + 入口"三合一（调研 D4），插件越多越乱。
 *  - 反链 / 历史（它们迁到文档工具条，见 `DocToolbar.tsx`）。
 *
 * 尺寸：整条 26px、里面可点 chip 最低 24px —— WCAG 2.2 AA **2.5.8 目标尺寸**（≥24×24）。
 */
import type { PanelRegistration } from '../kernel/kernel'
import { renderPanelSafe } from '../kernel/panel-safe'
import { PanelBoundary } from './PanelBoundary'
import {
  UIRenderer,
  type UIActionHandler,
  type UIStateChangeHandler,
} from './UIRenderer'

export type AppStatusBarProps = {
  statusPanels: PanelRegistration[]
  panelState: Record<string, unknown>
  error: string | null
  activePath: string | null
  charCount: number
  onAction: UIActionHandler
  onStateChange: UIStateChangeHandler
}

export function AppStatusBar({
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
      {/* 左半：常驻状态 chip。整块包一层，保证从最左开始 ——
          之前只靠末尾一个 margin-left:auto 的空元素压尾，内容为空时排版会漂。 */}
      <div className="zn-statusbar-left">
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
