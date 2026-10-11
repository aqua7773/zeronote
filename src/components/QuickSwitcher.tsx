import { useEffect, useMemo, useRef, useState } from 'react'

type NoteItem = { path: string }

/** `灵感/2026-10-11/16-22-44.md` → 显示用的文件名与目录 */
function splitPath(path: string) {
  const norm = path.replace(/\\/g, '/')
  const i = norm.lastIndexOf('/')
  const file = i >= 0 ? norm.slice(i + 1) : norm
  const dir = i >= 0 ? norm.slice(0, i) : ''
  return { file, dir, base: file.replace(/\.md$/i, '') }
}

/**
 * 快速打开笔记（`Ctrl+O`，对应 Obsidian 的 Quick switcher）。
 *
 * 与命令面板同源但职责不同：命令面板（`Ctrl+P`）管「**做什么**」，
 * 这里管「**去哪篇**」。两份调研都把这条列为「低成本高感知」。
 *
 * 三个行为细节照抄成熟产品：
 * 1. 空查询列出全部笔记 —— 不必先想好关键词
 * 2. 匹配时**文件名优先于目录**（目录同名不该盖过文件名）
 * 3. 输入的名字不存在时，`Enter` **直接新建并打开**（Obsidian 行为）；
 *    空态里会写明即将创建的文件名，避免误创建
 *
 * 由宿主**条件渲染**（只有开着才挂载），所以不需要 `open` prop ——
 * 每次打开都是全新实例，query/cursor 天然归零，也省掉一个 effect 里的 setState。
 */
export function QuickSwitcher({
  notes,
  onClose,
  onOpenNote,
  onCreateNote,
}: {
  notes: NoteItem[]
  onClose: () => void
  onOpenNote: (path: string) => void
  onCreateNote: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 挂载即聚焦（挂载后才能拿到 DOM；这里只碰 DOM，不 setState）
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const q = query.trim()
  // 与文件树保持**同一顺序**（localeCompare + zh：中文按拼音排），
  // 否则同一个库在两处呈现不同次序，用户会以为漏了东西
  const ordered = useMemo(
    () => [...notes].sort((a, b) => a.path.localeCompare(b.path, 'zh')),
    [notes],
  )
  const filtered = useMemo(() => {
    if (!q) return ordered.slice(0, 200)
    const needle = q.toLowerCase()
    // 文件名命中排前面，仅目录命中排后面
    const byFile: NoteItem[] = []
    const byDir: NoteItem[] = []
    for (const n of ordered) {
      const { file, dir } = splitPath(n.path)
      if (file.toLowerCase().includes(needle)) byFile.push(n)
      else if (dir.toLowerCase().includes(needle)) byDir.push(n)
    }
    return [...byFile, ...byDir].slice(0, 200)
  }, [ordered, q])

  // 光标用**派生值**夹在范围内，而不是 effect 里 setState（后者要多渲染一轮）
  const active = filtered.length === 0 ? 0 : Math.min(cursor, filtered.length - 1)

  // 输入的名字没匹配上任何笔记 → 允许直接新建（名字做最小合法性检查）
  const creating = q.length > 0 && filtered.length === 0
  const creatable =
    creating && !/[\\/:*?"<>|]/.test(q) && !/^\./.test(q) && q.length <= 80

  const openPath = (path: string) => {
    onClose()
    onOpenNote(path)
  }

  const doCreate = () => {
    onClose()
    onCreateNote(/\.md$/i.test(q) ? q : `${q}.md`)
  }

  return (
    <div className="zn-palette-mask" onMouseDown={onClose}>
      <div className="zn-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="输入笔记名，Enter 打开（名字不存在则新建）…"
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor(Math.min(active + 1, Math.max(filtered.length - 1, 0)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor(Math.max(active - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              if (filtered.length > 0) openPath(filtered[active].path)
              else if (creatable) doCreate()
            }
          }}
        />
        <div className="zn-palette-list">
          {filtered.length === 0 ? (
            <div className="zn-palette-empty">
              {!q
                ? '这个库里还没有笔记'
                : creatable
                  ? `没有匹配的笔记 —— Enter 新建「${q.replace(/\.md$/i, '')}.md」`
                  : '没有匹配的笔记'}
            </div>
          ) : (
            filtered.map((n, i) => {
              const { base, dir } = splitPath(n.path)
              return (
                <button
                  key={n.path}
                  type="button"
                  className={`zn-palette-item${i === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => openPath(n.path)}
                >
                  <span>{base}</span>
                  <span className="zn-palette-id">{dir}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
