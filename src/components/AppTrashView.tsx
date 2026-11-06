/**
 * 回收站整页视图 —— 从 `App.tsx` 原样迁出（rev122 · L2）。
 *
 * 二次确认（清空 / 彻底删除）的状态仍在 App（`confirmEmpty` / `confirmPurge`），
 * 这里只负责把点击转成回调 —— 保持拆分前"点两次"的交互不变。
 *
 * rev173.405：加「公开 / 私密」范围切换（用户拍板：「私密模式下，回收站加个切换，
 * 点了切到私密回收站」）。私密回收站未解锁时**不显示切换**（入口都不该存在）。
 * 两个范围的条目形状相同（`TrashEntry`），区别只在数据来源与操作命令 —— 由 App 路由。
 */
import type { TrashEntry } from '../kernel/contract'

/** 回收站范围：公开（内核 `.zn/trash`）或私密（插件 `.zn/private/trash`） */
export type TrashScope = 'public' | 'private'

export type AppTrashViewProps = {
  trash: TrashEntry[]
  /** 当前范围 —— 决定标题文案、条目副标题与空态 */
  scope: TrashScope
  /** 私密回收站可用（私密已解锁）；false ⇒ 不显示切换 */
  privateAvailable: boolean
  onScopeChange: (scope: TrashScope) => void
  /** 私密回收站数据加载中（密钥派生 / 解密索引有延迟，避免看起来"空了"） */
  loading?: boolean
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
  scope,
  privateAvailable,
  onScopeChange,
  loading = false,
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
  const isPrivate = scope === 'private'
  /* 回收站：整页视图（与插件管理共用同一套主区骨架） */
  return (
    <div className="zn-main-panel">
      <div className="zn-main-panel-bar">
        <div className="zn-trash-title">
          <span>{isPrivate ? '私密回收站' : '回收站'}</span>
          {/* 私密未解锁时整条切换都不出现 —— 不给"点了说没权限"的入口 */}
          {privateAvailable && (
            <div className="zn-trash-scope" role="tablist" aria-label="回收站范围">
              <button
                type="button"
                role="tab"
                aria-selected={!isPrivate}
                className={`zn-plain-btn${!isPrivate ? ' is-active' : ''}`}
                onClick={() => onScopeChange('public')}
              >
                公开
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isPrivate}
                className={`zn-plain-btn${isPrivate ? ' is-active' : ''}`}
                onClick={() => onScopeChange('private')}
              >
                私密
              </button>
            </div>
          )}
        </div>
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
        {loading ? (
          <div className="zn-trash-empty">正在解密私密回收站…</div>
        ) : trash.length === 0 ? (
          <div className="zn-trash-empty">{isPrivate ? '私密回收站是空的' : '回收站是空的'}</div>
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
                    {isPrivate
                      ? /* 私密条目是密文，原位置 / 大小对用户没有意义（也不该暴露密文文件名） */
                        `删除于 ${new Date(t.deletedAt).toLocaleString()}`
                      : `${t.originalPath ?? '原位置未知（旧格式条目）'} · ${new Date(t.deletedAt).toLocaleString()} · ${fmtSize(t.size)}`}
                  </span>
                </div>
                <div className="zn-trash-actions">
                  <button
                    type="button"
                    className="zn-plain-btn"
                    onClick={() => onRestore(t.id)}
                    title={isPrivate ? '恢复到私密列表' : t.originalPath ? `恢复到 ${t.originalPath}` : '恢复到库根'}
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
