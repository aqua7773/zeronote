/**
 * 侧栏「智能分区」（UI 重布局目标态 ① · 方案 §2.1）。
 *
 * 结构：搜索框下面一行三个 chip（今天 / 最近 7 天 / 未打标签），点中之后
 * 文件树区域换成扁平列表（按 mtime 倒序），列表顶部「‹」回文件树。
 *
 * 为什么不做成「在文件树里插入三个虚拟分组」：文件树按目录组织，分区按时间/标签，
 * 两套结构叠在一起会出现「同一篇在树里点过一次、在分区里又点一次」的双入口，
 * 而且虚拟分组会污染 `ReadonlyArray<TreeNode>` 的键（目录展开状态按路径存）。
 * 分区是**视图**，不是目录 —— 所以它替换文件树，而不是插入文件树。
 */
import type { SmartNote, SmartSection } from '../lib/smart-sections'
import { SMART_SECTIONS, displayTitle, relativeTime, sectionEmptyText, sectionTitle } from '../lib/smart-sections'
import { cn } from '@/lib/utils'

export interface SmartSectionBarProps {
  active: SmartSection | null
  /** 分区 → 篇数；`untagged` 在索引没算出来前是 undefined（chip 不显示数字） */
  counts: Partial<Record<SmartSection, number>>
  onSelect: (section: SmartSection) => void
}

export function SmartSectionBar({ active, counts, onSelect }: SmartSectionBarProps) {
  return (
    <div className="zn-smart-bar" role="toolbar" aria-label="智能分区">
      {SMART_SECTIONS.map((s) => {
        const n = counts[s.id]
        const isActive = active === s.id
        return (
          <button
            key={s.id}
            type="button"
            className={cn('zn-smart-chip', isActive && 'is-active')}
            onClick={() => onSelect(s.id)}
            aria-pressed={isActive}
            title={n == null ? s.title : `${s.title} · ${n} 篇`}
          >
            {s.label}
            {n == null ? null : <span className="zn-smart-count">{n}</span>}
          </button>
        )
      })}
    </div>
  )
}

export interface SmartSectionListProps {
  section: SmartSection
  notes: SmartNote[]
  /** 算相对时间用的「现在」；由调用方给，测试里可钉死 */
  now: number
  /** 未打标签要等索引查完 —— 查的过程中给「正在读取索引…」而不是误导性的空态 */
  loading?: boolean
  onOpen: (path: string) => void
  onBack: () => void
}

export function SmartSectionList({
  section,
  notes,
  now,
  loading = false,
  onOpen,
  onBack,
}: SmartSectionListProps) {
  return (
    <div className="zn-smart-list">
      <div className="zn-smart-head">
        <button type="button" className="zn-smart-back" onClick={onBack} title="返回文件树" aria-label="返回文件树">
          ‹
        </button>
        <span className="zn-smart-title">{sectionTitle(section, notes.length)}</span>
      </div>
      {loading ? (
        <div className="zn-smart-empty">正在读取索引…</div>
      ) : notes.length === 0 ? (
        <div className="zn-smart-empty">{sectionEmptyText(section)}</div>
      ) : (
        <div className="zn-smart-items">
          {notes.map((n) => (
            <button
              key={n.path}
              type="button"
              className="zn-smart-item"
              onClick={() => onOpen(n.path)}
              title={n.path}
            >
              <span className="zn-smart-item-title">{displayTitle(n.title)}</span>
              <span className="zn-smart-item-time">{relativeTime(n.mtime, now)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
