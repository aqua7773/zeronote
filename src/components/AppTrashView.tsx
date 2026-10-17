/**
 * 回收站整页视图 —— 从 `App.tsx` 原样迁出（rev122 · L2）。
 *
 * 二次确认（清空 / 彻底删除）的状态仍在 App（`confirmEmpty` / `confirmPurge`），
 * 这里只负责把点击转成回调 —— 保持拆分前"点两次"的交互不变。
 */
import type { TrashEntry } from '../kernel/contract'

export type AppTrashViewProps = {
  trash: TrashEntry[]
  /** 清空回收站的二次确认已点过一次 */
  confirmEmpty: boolean
  /** 哪一条的「彻底删除」已经点过一次 */
  confirmPurge: string | null
  onEmpty: () => void
  onConfirmEmpty: () => void
  onRestore: (id: string) => void
  onPurge: (id: string) => void
  onConfirmPurge: (id: string) => void
  onBack: () => void
  fmtSize: (n: number) => string
}

export function AppTrashView({
  trash,
  confirmEmpty,
  confirmPurge,
  onEmpty,
  onConfirmEmpty,
  onRestore,
  onPurge,
  onConfirmPurge,
  onBack,
  fmtSize,
}: AppTrashViewProps) {
  /* 回收站：整页视图（与插件管理共用同一套主区骨架） */
  return (
    <div className="zn-main-panel">
      <div className="zn-main-panel-bar">
        <span>回收站</span>
        <div className="zn-main-panel-actions">
          {trash.length > 0 && (
            <button
              type="button"
              className={`zn-plain-btn${confirmEmpty ? ' is-danger' : ''}`}
              onClick={() => {
                // 不可撤销 ⇒ 点两次
                if (confirmEmpty) onEmpty()
                else onConfirmEmpty()
              }}
              title="清空回收站（不可撤销）"
            >
              {confirmEmpty ? `确认清空 ${trash.length} 项？` : '清空回收站'}
            </button>
          )}
          <button type="button" className="zn-plain-btn" onClick={onBack} title="返回编辑器">
            返回编辑器
          </button>
        </div>
      </div>
      <div className="zn-main-panel-body">
        {trash.length === 0 ? (
          <div className="zn-trash-empty">回收站是空的</div>
        ) : (
          <ul className="zn-trash-list">
            {trash.map((t) => (
              <li key={t.id} className="zn-trash-row">
                <div className="zn-trash-main">
                  <span className="zn-trash-name">
                    {t.isDir ? '📁 ' : ''}
                    {t.name}
                  </span>
                  <span className="zn-trash-meta">
                    {t.originalPath ?? '原位置未知（旧格式条目）'} ·{' '}
                    {new Date(t.deletedAt).toLocaleString()} · {fmtSize(t.size)}
                  </span>
                </div>
                <div className="zn-trash-actions">
                  <button
                    type="button"
                    className="zn-plain-btn"
                    onClick={() => onRestore(t.id)}
                    title={t.originalPath ? `恢复到 ${t.originalPath}` : '恢复到库根'}
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    className={`zn-plain-btn${confirmPurge === t.id ? ' is-danger' : ''}`}
                    onClick={() => {
                      // 不可撤销 ⇒ 点两次
                      if (confirmPurge === t.id) onPurge(t.id)
                      else onConfirmPurge(t.id)
                    }}
                    title="彻底删除（不可撤销）"
                  >
                    {confirmPurge === t.id ? '确认删除' : '彻底删除'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
