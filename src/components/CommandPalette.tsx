import { useEffect, useMemo, useRef, useState } from 'react'

export type CommandItem = { id: string; title: string }

/**
 * 模糊匹配打分：needle 的字符**按序**出现在 text 中即算命中。
 * 返回 null = 不匹配；分数越高越靠前。
 * 加分项：连续命中（streak）、命中在词首（串首或前一个字符是分隔符）。
 *
 * 用「顺序匹配」而不是 `includes`：命令一多，输入 `nn` 找 `core.newNote`、
 * 输入 `sn` 找 `core.save` 这类简写就很关键（Obsidian / VS Code 都是这个模型）。
 */
function fuzzyScore(text: string, needle: string): number | null {
  if (!needle) return 0
  const t = text.toLowerCase()
  const n = needle.toLowerCase()
  let ti = 0
  let score = 0
  let streak = 0
  for (const ch of n) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    if (found === ti) {
      streak += 1
      score += 3 + streak // 连续命中越来越值钱
    } else {
      streak = 0
      score += 1
    }
    const prev = found === 0 ? undefined : t[found - 1]
    if (prev === undefined || /[\s._\-/:]/.test(prev)) score += 2 // 词首命中
    ti = found + 1
  }
  return score - ti * 0.1 // 命中位置越靠前越好
}

/**
 * 命令面板（M2）—— 内核自带的唯一「UI 原语出口」：
 * 插件注册的命令都进这里，不需要插件自己画界面。
 *
 * 交互：模糊过滤 / ↑↓ 选择 / Enter 执行 / Esc 关闭 / 点击执行
 * 排序：空查询时**最近用过的置顶**（其余保持注册顺序）；
 *       有查询时先按匹配分数，同分再看谁最近用过。
 */
export function CommandPalette({
  open,
  onClose,
  items,
  recent = [],
  onRun,
}: {
  open: boolean
  onClose: () => void
  items: CommandItem[]
  /** 最近执行过的命令 id（最新在前），用于置顶 */
  recent?: string[]
  onRun: (id: string) => void
}) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) {
      const rank = new Map(recent.map((id, i) => [id, i]))
      return [...items].sort(
        (a, b) =>
          (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
          (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
      )
    }
    const scored: { item: CommandItem; score: number; rec: number }[] = []
    for (const c of items) {
      const cand = [fuzzyScore(c.title, q), fuzzyScore(c.id, q)].filter(
        (x): x is number => x !== null,
      )
      if (cand.length === 0) continue
      const rec = recent.indexOf(c.id)
      scored.push({ item: c, score: Math.max(...cand), rec: rec < 0 ? 999 : rec })
    }
    scored.sort((a, b) => b.score - a.score || a.rec - b.rec)
    return scored.map((s) => s.item)
  }, [items, query, recent])

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
                <span className="zn-palette-id">
                  {recent.includes(c.id) ? '↺ ' : ''}
                  {c.id}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
