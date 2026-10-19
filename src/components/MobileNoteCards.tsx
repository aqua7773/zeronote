/**
 * 移动端起始页 —— **flomo 风格卡片流**（2026-10-18 用户给截图要求「移动端起始页做成这样」）。
 *
 * 每张卡片：时间 + 正文摘要；卡片点开笔记；右上「⋯」给打开 / 删除 / 彻底删除；
 * 底部固定「＋ 点击输入」——点了走 `core.newNote`（新建并打开，等同桌面起始页那个按钮）。
 *
 * 桌面端不渲染（仍用 AppEmptyState 的起始页）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NoteMeta } from '../kernel/contract'
import { ContextMenu, type MenuItem } from '@/components/ui'

type Props = {
  notes: NoteMeta[]
  onOpen: (path: string) => void
  onNewNote: () => void
  /** 长按 ＋ = 打开环形快捷入口（rev173.20）；短按仍走 onNewNote。
   *  桌面时间流面板（`variant="panel"`）不传 = 没有长按。 */
  onQuickLaunch?: () => void
  readText: (path: string) => Promise<string>
  onDelete: (path: string) => void
  onPurge: (path: string) => void
  /** 重命名（同目录）：组件给完整新路径 */
  onRename: (from: string, to: string) => void
  /**
   * 渲染形态（rev173.33）：
   * · `mobile`（默认）= 手机起始页，底部**浮动**的 ＋（fixed）；
   * · `panel` = 桌面「时间流」面板，＋ 还原成流内按钮（面板宽度由外层容器给）。
   * 卡片本身两种形态完全一样。
   */
  variant?: 'mobile' | 'panel'
}

/** 长按判定：按住 500ms 算长按；移动超过 10px 算滑动、取消长按（调研 §3.1 / §4） */
const LONG_PRESS_MS = 500
const LONG_PRESS_MOVE_PX = 10

/** mtime（毫秒）→ `2026-10-18 14:08:32`（2026-10-18 用户要求：精确到秒） */
const fmtTime = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
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

export function MobileNoteCards({
  notes,
  onOpen,
  onNewNote,
  onQuickLaunch,
  readText,
  onDelete,
  onPurge,
  onRename,
  variant = 'mobile',
}: Props) {
  /** 按修改时间倒序，最多 100 条（足够看，也不会一次读太多文件） */
  const sorted = useMemo(() => [...notes].sort((a, b) => b.mtime - a.mtime).slice(0, 100), [notes])
  const [contents, setContents] = useState<Record<string, string>>({})
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)

  /* ── 长按 ＋（rev173.20）──
   * 短按 = 新建笔记（不变）；按住 500ms = 打开环形快捷入口。
   * 三个 ref 分工：定时器、按下起点（判滑动）、「长按已触发」标记（吃掉松手后补发的 click）。 */
  const pressTimer = useRef<number | null>(null)
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)

  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    pressStart.current = null
  }, [])

  // 卸载时清掉挂起的定时器，别让它在组件没了之后调 onQuickLaunch
  useEffect(() => cancelPress, [cancelPress])

  const onComposePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // 每一次新按压都重置抑制标记（上一次长按留下的标记不能影响这次短按）
    suppressClick.current = false
    cancelPress()
    // 桌面时间流面板没有环形快捷入口（那是手机起始页的能力）—— 不注册长按
    if (!onQuickLaunch) return
    pressStart.current = { x: e.clientX, y: e.clientY }
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      pressStart.current = null
      suppressClick.current = true
      onQuickLaunch()
    }, LONG_PRESS_MS)
  }

  const onComposePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = pressStart.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) cancelPress()
  }

  /** 短按才新建；长按那一下松手会补发 click，必须吃掉 */
  const onComposeClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    onNewNote()
  }

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

  /** 重命名：prompt 输入新文件名（同目录）；`.md` 笔记没写后缀时自动补 */
  const rename = (path: string) => {
    const base = path.slice(path.lastIndexOf('/') + 1)
    const next = window.prompt('重命名（新文件名）', base)
    if (!next) return
    const name = next.trim()
    if (!name || name === base) return
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const finalName = /\.md$/i.test(path) && !/\.[a-z0-9]+$/i.test(name) ? `${name}.md` : name
    onRename(path, dir ? `${dir}/${finalName}` : finalName)
  }

  /** 长按 / 右上「⋯」都能弹这张菜单（2026-10-18 用户要求「长按卡片可以重命名和删除」） */
  const items: MenuItem[] = menu
    ? [
        { label: '打开', onClick: () => onOpen(menu.path) },
        { label: '重命名…', divider: true, onClick: () => rename(menu.path) },
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
    <div className={variant === 'panel' ? 'zn-mobile-home zn-mobile-home--panel' : 'zn-mobile-home'}>
      <div className="zn-mobile-cards">
        {sorted.length === 0 && (
          <div className="zn-mobile-empty">还没有笔记 —— 点下面的输入框记一条。</div>
        )}
        {sorted.map((n) => {
          // 非 note（文档/附件）不读正文，直接拿标题 —— 否则永远停在「…」（2026-10-19 面板里看到）
          const c = contents[n.path]
          const body = n.kind !== 'note' ? n.title : c === undefined ? '…' : c || '（空笔记）'
          return (
            <article
              key={n.path}
              className="zn-mobile-card"
              onClick={() => onOpen(n.path)}
              onContextMenu={(e) => {
                // 手机长按（Android 转 contextmenu）与桌面右键同一个菜单
                e.preventDefault()
                setMenu({ path: n.path, x: e.clientX, y: e.clientY })
              }}
            >
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
              <div className="zn-mobile-card-body">{body}</div>
            </article>
          )
        })}
      </div>
      {/* ＋ 按钮只属于手机起始页（rev173.33：桌面时间流面板不要加号——用户要求） */}
      {variant !== 'panel' && (
        <button
          type="button"
          className="zn-mobile-compose"
          onClick={onComposeClick}
          onPointerDown={onComposePointerDown}
          onPointerMove={onComposePointerMove}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          aria-label="新建一条（长按打开快捷入口）"
          title="点击新建 · 长按快捷入口"
        >
          <span className="zn-mobile-compose-plus">＋</span>
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
