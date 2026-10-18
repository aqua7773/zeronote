/**
 * 移动端起始页 —— **flomo 风格卡片流**（2026-10-18 用户给截图要求「移动端起始页做成这样」）。
 *
 * 每张卡片：时间 + 正文摘要；卡片点开笔记；右上「⋯」给打开 / 删除 / 彻底删除；
 * 底部固定「＋ 点击输入」——点了走 `core.newNote`（新建并打开，等同桌面起始页那个按钮）。
 *
 * 桌面端不渲染（仍用 AppEmptyState 的起始页）。
 */
import { useEffect, useMemo, useState } from 'react'
import type { NoteMeta } from '../kernel/contract'
import { ContextMenu, type MenuItem } from '@/components/ui'

type Props = {
  notes: NoteMeta[]
  onOpen: (path: string) => void
  onNewNote: () => void
  readText: (path: string) => Promise<string>
  onDelete: (path: string) => void
  onPurge: (path: string) => void
}

/** mtime（毫秒）→ `2026-10-18 14:08` */
const fmtTime = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 把 Markdown 压成纯文本摘要（去 frontmatter / 标题符号 / 列表与强调标记 / 代码块） */
const plain = (md: string) => {
  let t = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  t = t.replace(/```[\s\S]*?```/g, ' ')
  t = t.replace(/^#{1,6}\s+/gm, '')
  t = t.replace(/^\s*[-*+]\s+/gm, '')
  t = t.replace(/^\s*\d+\.\s+/gm, '')
  t = t.replace(/^\s*>\s?/gm, '')
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/[*_~`#]/g, '')
  return t.replace(/\s+/g, ' ').trim()
}

export function MobileNoteCards({ notes, onOpen, onNewNote, readText, onDelete, onPurge }: Props) {
  /** 按修改时间倒序，最多 100 条（足够看，也不会一次读太多文件） */
  const sorted = useMemo(() => [...notes].sort((a, b) => b.mtime - a.mtime).slice(0, 100), [notes])
  const [contents, setContents] = useState<Record<string, string>>({})
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      const next: Record<string, string> = {}
      await Promise.all(
        sorted.map(async (n) => {
          if (n.kind !== 'note') return
          try {
            next[n.path] = plain(await readText(n.path))
          } catch {
            next[n.path] = ''
          }
        }),
      )
      if (alive) setContents(next)
    })()
    return () => {
      alive = false
    }
  }, [sorted, readText])

  const items: MenuItem[] = menu
    ? [
        { label: '打开', onClick: () => onOpen(menu.path) },
        { label: '删除（回收站）', danger: true, divider: true, onClick: () => onDelete(menu.path) },
        {
          label: '彻底删除…',
          danger: true,
          onClick: () => {
            if (window.confirm('彻底删除？不进回收站，永久抹掉 —— 撤不回来。')) onPurge(menu.path)
          },
        },
      ]
    : []

  return (
    <div className="zn-mobile-home">
      <div className="zn-mobile-cards">
        {sorted.length === 0 && (
          <div className="zn-mobile-empty">还没有笔记 —— 点下面的输入框记一条。</div>
        )}
        {sorted.map((n) => (
          <article key={n.path} className="zn-mobile-card" onClick={() => onOpen(n.path)}>
            <div className="zn-mobile-card-time">
              <span>{fmtTime(n.mtime)}</span>
              <button
                type="button"
                className="zn-mobile-card-more"
                aria-label="更多"
                onClick={(e) => {
                  e.stopPropagation()
                  setMenu({ path: n.path, x: e.clientX, y: e.clientY })
                }}
              >
                ⋯
              </button>
            </div>
            <div className="zn-mobile-card-body">
              {contents[n.path] ?? (n.kind === 'note' ? '…' : n.title)}
            </div>
          </article>
        ))}
      </div>
      <button type="button" className="zn-mobile-compose" onClick={onNewNote}>
        <span className="zn-mobile-compose-plus">＋</span>
        <span>点击输入，新建一条</span>
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
