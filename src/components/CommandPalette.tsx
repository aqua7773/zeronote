import { useEffect, useMemo, useRef, useState } from 'react'

export type CommandItem = { id: string; title: string }

/**
 * 命令面板（M2）—— 内核自带的唯一「UI 原语出口」：
 * 插件注册的命令都进这里，不需要插件自己画界面。
 *
 * 交互：输入过滤 / ↑↓ 选择 / Enter 执行 / Esc 关闭 / 点击执行
 */
export function CommandPalette({
  open,
  onClose,
  items,
  onRun,
}: {
  open: boolean
  onClose: () => void
  items: CommandItem[]
  onRun: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (c) => c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
    )
  }, [items, query])

  // 每次打开重置
  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      // 等 mask 挂上再聚焦
      const t = window.setTimeout(() => inputRef.current?.focus(), 0)
      return () => window.clearTimeout(t)
    }
  }, [open])

  // 列表变化时把光标夹回范围内
  useEffect(() => {
    setCursor((c) => (filtered.length === 0 ? 0 : Math.min(c, filtered.length - 1)))
  }, [filtered.length])

  if (!open) return null

  const run = (id: string) => {
    onClose()
    onRun(id)
  }

  return (
    <div className="zn-palette-mask" onMouseDown={onClose}>
      <div className="zn-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          placeholder="输入命令名…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, Math.max(filtered.length - 1, 0)))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              const hit = filtered[cursor]
              if (hit) run(hit.id)
            }
          }}
        />
        <div className="zn-palette-list">
          {filtered.length === 0 ? (
            <div className="zn-palette-empty">
              {items.length === 0 ? '还没有任何命令（插件注册后会出现在这里）' : '没有匹配的命令'}
            </div>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                type="button"
                className={`zn-palette-item${i === cursor ? ' is-active' : ''}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(c.id)}
              >
                <span>{c.title}</span>
                <span className="zn-palette-id">{c.id}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
