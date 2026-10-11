import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { IndexApi, SearchHit } from '@/kernel/contract'
import { splitExcerpt, tokenizeQuery } from '@/kernel/index-api'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

/**
 * 搜索面板 —— 内核 index 原语的自带 UI 出口。
 *
 * 契约方式（和 CommandPalette 一致）：**受控** —— 开/关与「打开哪篇」都由父级决定，
 * 面板自己不碰 doc 原语，也不认识 App 的状态。
 *
 * index 从 props 注入（`index={kernel.index}`），而不是面板自己去 import 内核：
 * 这样面板可以单测（塞一个假的 IndexApi）、也能被插件复用。
 *
 * 索引生命周期：首次打开时自动 `rebuild()` 一次（缓存进内存），之后靠内核里的
 * `upsert` / `remove` 增量维护；面板里那个「重建索引」按钮是给外部改动（比如
 * 手动往库里拷了 500 个 md 而 fs.watch 没触发）兜底的。
 */
export type SearchPanelProps = {
  open: boolean
  onClose: () => void
  onOpenNote: (path: string) => void
  /** 内核 index 原语；不传则显示「未接入」空态 */
  index?: IndexApi | null
}

/** 面板一次最多显示多少条（内核那边的硬上限是 200） */
const RESULT_LIMIT = 50
/** 输入防抖 —— 千篇量级查询 ~10-30ms，180ms 足够避免每键一查 */
const DEBOUNCE_MS = 180

export function SearchPanel({ open, onClose, onOpenNote, index = null }: SearchPanelProps) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [stat, setStat] = useState<{ count: number; ms: number } | null>(null)
  const [rebuildTick, setRebuildTick] = useState(0)
  /** 递增序号：异步结果回来时若已过期就丢掉（防止慢查询覆盖新查询） */
  const seqRef = useRef(0)
  /** 已经为哪个 index 建过库 —— 切库（kernel 重建）后会再建一次 */
  const indexedRef = useRef<IndexApi | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const rebuild = useCallback(async () => {
    if (!index) return
    setBusy(true)
    try {
      const r = await index.rebuild()
      setStat(r)
      setError(null)
      setRebuildTick((t) => t + 1)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [index])

  /* 打开时聚焦并把上次的词整体选中，直接敲就能覆盖 */
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open])

  /* 首次打开（或换库后）自动建一次索引 */
  useEffect(() => {
    if (!open || !index) return
    if (indexedRef.current === index) return
    indexedRef.current = index
    void rebuild()
  }, [open, index, rebuild])

  /* 查询：防抖 + 竞态保护。空查询的清理放在输入事件里（effect 里同步 setState 会触发额外渲染） */
  useEffect(() => {
    if (!open || !index) return
    const text = q.trim()
    const seq = ++seqRef.current
    if (!text) return
    const timer = window.setTimeout(() => {
      setBusy(true)
      index
        .query(text, { limit: RESULT_LIMIT })
        .then((r) => {
          if (seqRef.current !== seq) return
          setHits(r)
          setError(null)
          setBusy(false)
          setCursor(0)
        })
        .catch((e: unknown) => {
          if (seqRef.current !== seq) return
          setHits([])
          setError(String(e))
          setBusy(false)
        })
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [open, index, q, rebuildTick])

  const pick = useCallback(
    (hit: SearchHit) => {
      onOpenNote(hit.path)
      onClose()
    },
    [onOpenNote, onClose],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, Math.max(hits.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      const hit = hits[cursor]
      if (hit) {
        e.preventDefault()
        pick(hit)
      }
    }
  }

  if (!open) return null

  const hasQuery = q.trim().length > 0

  let body: ReactNode
  if (!index) {
    body = <Empty>索引未接入 —— 把内核的 index 原语传给这个面板（kernel.index）</Empty>
  } else if (error) {
    body = <Empty className="text-destructive">索引出错：{error}</Empty>
  } else if (!hasQuery) {
    body = (
      <Empty>
        输入关键词开始搜索。
        <br />
        空格分隔多个关键词 —— 全部命中才算结果（AND），中文按子串匹配。
      </Empty>
    )
  } else if (hits.length === 0) {
    body = <Empty>{busy ? '搜索中…' : `没有匹配「${q.trim()}」的笔记`}</Empty>
  } else {
    body = hits.map((hit, i) => (
      <button
        key={hit.path}
        type="button"
        className={cn(
          'block w-full rounded-ui-sm px-2 py-1.5 text-left transition-colors duration-100',
          i === cursor ? 'bg-accent' : 'hover:bg-accent',
        )}
        onMouseEnter={() => setCursor(i)}
        onClick={() => pick(hit)}
      >
        <div className="truncate text-xs font-medium text-foreground">
          <TitleText text={hit.title} terms={tokenizeQuery(q)} />
        </div>
        <div
          className={cn(
            'mt-0.5 line-clamp-2 text-xs',
            i === cursor ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          <Excerpt text={hit.excerpt} />
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {hit.path} · {hit.score}
        </div>
      </button>
    ))
  }

  const foot = !index
    ? '未接入 index 原语'
    : error
      ? '出错'
      : busy
        ? '搜索中…'
        : hasQuery
          ? `${hits.length} 条结果${stat ? ` · 索引 ${stat.count} 篇` : ''}`
          : stat
            ? `已索引 ${stat.count} 篇 · ${stat.ms} ms`
            : '索引未建立'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[10vh]"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-foreground/40" />
      <div
        className="relative flex w-full max-w-[42rem] flex-col overflow-hidden rounded-ui-lg border border-border bg-popover text-foreground shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              const next = e.target.value
              setQ(next)
              if (!next.trim()) {
                // 清空输入 → 立刻回空态（不等防抖）
                setHits([])
                setError(null)
                setBusy(false)
              }
            }}
            onKeyDown={onKeyDown}
            placeholder="搜索笔记（空格分隔多个关键词，需全部命中）"
            aria-label="搜索笔记"
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void rebuild()}
            disabled={!index || busy}
            title="重新扫描全库并重建内存索引"
          >
            重建索引
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>

        <div className="min-h-0 max-h-[55vh] flex-1 overflow-y-auto p-1">{body}</div>

        <div className="shrink-0 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          {foot}
        </div>
      </div>
    </div>
  )
}

function Empty({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('px-3 py-6 text-center text-xs text-muted-foreground', className)}>
      {children}
    </div>
  )
}

/** 标题高亮：只标最早出现的那个关键词，够用且不引额外依赖 */
function TitleText({ text, terms }: { text: string; terms: string[] }) {
  const lower = text.toLowerCase()
  let at = -1
  let len = 0
  for (const tk of terms) {
    const i = lower.indexOf(tk)
    if (i !== -1 && (at === -1 || i < at)) {
      at = i
      len = tk.length
    }
  }
  if (at === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-ui-sm bg-primary/20 px-0.5 text-foreground">
        {text.slice(at, at + len)}
      </mark>
      {text.slice(at + len)}
    </>
  )
}

/** 摘要高亮：按哨兵切片（命中区间由 index 侧标好，面板不重复做匹配） */
function Excerpt({ text }: { text: string }) {
  const segs = splitExcerpt(text)
  if (segs.length === 0) return <span className="text-muted-foreground">（无摘要）</span>
  const nodes: ReactNode[] = []
  let offset = 0
  for (const seg of segs) {
    nodes.push(
      seg.hit ? (
        <mark key={offset} className="rounded-ui-sm bg-primary/20 px-0.5 text-foreground">
          {seg.text}
        </mark>
      ) : (
        <span key={offset}>{seg.text}</span>
      ),
    )
    offset += seg.text.length
  }
  return <>{nodes}</>
}
