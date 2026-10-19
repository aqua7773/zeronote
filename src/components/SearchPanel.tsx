import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
 * `upsert` / `remove` 增量维护 —— **rev173.40 起真的接线了**：内核把 `fs` 写路径包了一层
 * （`src/kernel/fs-events.ts`），本机保存/新建/改名/删除会即时更新索引，外部改动由
 * `fs.watch` 跟随。面板里那个「重建索引」按钮留着做兜底（比如 watch 漏报、手动拷了 500 个 md）。
 */
export type SearchPanelProps = {
  open: boolean
  onClose: () => void
  onOpenNote: (path: string) => void
  /** 内核 index 原语；不传则显示「未接入」空态 */
  index?: IndexApi | null
  /** 库里全部笔记（含 mtime）—— 只用于「按修改时间排序」，不参与检索 */
  notes?: { path: string; mtime: number }[]
}

/** 面板一次最多显示多少条（内核那边的硬上限是 200） */
const RESULT_LIMIT = 50
/** 输入防抖 —— 千篇量级查询 ~10-30ms，180ms 足够避免每键一查 */
const DEBOUNCE_MS = 180
/** 最近搜索词（持久化，上限 8 条）—— 空查询时列出来，点一下即可复用 */
const LS_RECENT_SEARCH = 'zeronote.search.recent'
const RECENT_SEARCH_MAX = 8

function loadRecentSearch(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_RECENT_SEARCH) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_SEARCH_MAX)
  } catch {
    return []
  }
}

type SortBy = 'relevance' | 'name' | 'mtime'

export function SearchPanel({
  open,
  onClose,
  onOpenNote,
  index = null,
  notes = [],
}: SearchPanelProps) {
  const [q, setQ] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('relevance')
  const [recent, setRecent] = useState<string[]>(loadRecentSearch)
  const [hits, setHits] = useState<SearchHit[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [stat, setStat] = useState<{ count: number; ms: number } | null>(null)
  const [rebuildTick, setRebuildTick] = useState(0)
  /**
   * 筛选行（rev173.47 · 用户待办 #4「搜索筛选：正则 / 标签 / 目录」）。
   *
   * 三者都交给内核 `index.query` 的字段过滤参数，**面板自己不做匹配** ——
   * 这样筛选与关键词可以任意组合，语义也只在一处定义（契约 §2.3）。
   */
  const [tagFilter, setTagFilter] = useState('')
  const [dirFilter, setDirFilter] = useState('')
  const [regexOn, setRegexOn] = useState(false)
  /** 标签统计（来自 `index.tags()`）—— 下拉的选项与篇数 */
  const [tagStats, setTagStats] = useState<{ tag: string; count: number }[]>([])
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

  /**
   * 标签下拉的选项：重建后再拉一次（`index.tags()` 读的是内存索引，
   * 建库之前是空的）。`rebuildTick` 让「重建索引」按钮也能刷新它。
   */
  useEffect(() => {
    if (!open || !index) return
    let alive = true
    index
      .tags()
      .then((t) => {
        if (alive) setTagStats(t)
      })
      .catch(() => {
        /* 索引没建好就先不给选项；不打断搜索本身 */
      })
    return () => {
      alive = false
    }
  }, [open, index, rebuildTick])

  /** 目录下拉选项：从笔记路径推**所有层级前缀**（`a/b/c.md` → `a`、`a/b`） */
  const dirOptions = useMemo(() => {
    const set = new Set<string>()
    for (const n of notes) {
      const parts = n.path.replace(/\\/g, '/').split('/')
      parts.pop() // 去掉文件名
      let acc = ''
      for (const seg of parts) {
        acc = acc ? `${acc}/${seg}` : seg
        if (acc) set.add(acc)
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh'))
  }, [notes])

  /** 正则语法预检 —— 内核那边语法错误会静默返回空表，这里给用户一句能看懂的话 */
  const regexError = useMemo(() => {
    if (!regexOn || !q.trim()) return null
    try {
      new RegExp(q, 'imu')
      return null
    } catch (e) {
      return e instanceof Error ? e.message : String(e)
    }
  }, [regexOn, q])

  /* 查询：防抖 + 竞态保护。空查询的清理放在输入事件里（effect 里同步 setState 会触发额外渲染） */
  useEffect(() => {
    if (!open || !index) return
    const text = q.trim()
    const tag = tagFilter || undefined
    const dir = dirFilter || undefined
    const seq = ++seqRef.current
    // 关键词 / 标签 / 目录全空 ⇒ 真没条件（只开正则开关不算条件）
    if (!text && !tag && !dir) return
    const timer = window.setTimeout(() => {
      setBusy(true)
      index
        .query(text, { limit: RESULT_LIMIT, tag, dir, regex: regexOn })
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
  }, [open, index, q, rebuildTick, tagFilter, dirFilter, regexOn])

  /** 记一条最近搜索词（去重 + 封顶）；存不下也不影响搜索本身 */
  const rememberQuery = useCallback((text: string) => {
    const t = text.trim()
    if (!t) return
    setRecent((prev) => {
      const next = [t, ...prev.filter((x) => x !== t)].slice(0, RECENT_SEARCH_MAX)
      try {
        localStorage.setItem(LS_RECENT_SEARCH, JSON.stringify(next))
      } catch {
        /* 配额或隐私模式失败忽略 */
      }
      return next
    })
  }, [])

  const pick = useCallback(
    (hit: SearchHit) => {
      rememberQuery(q)
      onOpenNote(hit.path)
      onClose()
    },
    [onOpenNote, onClose, rememberQuery, q],
  )

  /**
   * 结果排序：默认保持内核给出的**相关度**顺序。
   * 「按修改时间」需要 mtime，而它不在 SearchHit 里 —— 所以由宿主把笔记清单传进来。
   */
  const sorted = useMemo(() => {
    if (sortBy === 'relevance') return hits
    if (sortBy === 'name') {
      return [...hits].sort((a, b) => a.path.localeCompare(b.path, 'zh'))
    }
    const mtimeOf = new Map(notes.map((n) => [n.path, n.mtime]))
    return [...hits].sort((a, b) => (mtimeOf.get(b.path) ?? 0) - (mtimeOf.get(a.path) ?? 0))
  }, [hits, sortBy, notes])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, Math.max(sorted.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      const hit = sorted[cursor]
      if (hit) {
        e.preventDefault()
        pick(hit)
      }
    }
  }

  if (!open) return null

  const hasQuery = q.trim().length > 0 || Boolean(tagFilter) || Boolean(dirFilter)

  let body: ReactNode
  if (!index) {
    body = <Empty>索引未接入 —— 把内核的 index 原语传给这个面板（kernel.index）</Empty>
  } else if (error) {
    body = <Empty className="text-destructive">索引出错：{error}</Empty>
  } else if (regexError) {
    body = <Empty className="text-destructive">正则无效：{regexError}</Empty>
  } else if (!hasQuery) {
    // 有历史就先给历史（点一下即复用），没有才讲用法
    body =
      recent.length === 0 ? (
        <Empty>
          输入关键词开始搜索。
          <br />
          空格分隔多个关键词 —— 全部命中才算结果（AND），中文按子串匹配。
          <br />
          下面的筛选行可以按标签 / 目录浏览，「正则」把查询当表达式。
        </Empty>
      ) : (
        <div className="px-1 py-1">
          <div className="px-2 py-1 text-xs text-muted-foreground">最近搜索</div>
          {recent.map((r) => (
            <button
              key={r}
              type="button"
              className="block w-full truncate rounded-ui-sm px-2 py-1.5 text-left text-xs text-foreground transition-colors duration-100 hover:bg-accent"
              onClick={() => setQ(r)}
            >
              {r}
            </button>
          ))}
        </div>
      )
  } else if (sorted.length === 0) {
    const kw = q.trim()
    body = (
      <Empty>
        {busy ? '搜索中…' : kw ? `没有匹配「${kw}」的笔记` : '没有符合筛选条件的笔记'}
      </Empty>
    )
  } else {
    body = sorted.map((hit, i) => (
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
          ? /**
             * 查询态**不再显示 `stat.count`**（rev173.40）：索引现在是增量维护的，
             * `stat` 只是上次 rebuild 的快照 —— 删/建几篇后数字就过时，显示出来是错的。
             * 空态仍显示它（那时它刚 rebuild 过，语义正确）。
             */
            `${sorted.length} 条结果`
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
              // 清空关键词且**没有筛选条件**时立刻回空态；有筛选就让查询自己跑
              if (!next.trim() && !tagFilter && !dirFilter) {
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
          {/* 排序切换：只在有结果时出现；「相关」= 内核给的评分顺序 */}
          {hasQuery && sorted.length > 1 && (
            <div className="flex shrink-0 items-center gap-0.5 rounded-ui-sm border border-border p-0.5">
              {(
                [
                  ['relevance', '相关'],
                  ['name', '名称'],
                  ['mtime', '时间'],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={cn(
                    'rounded-ui-sm px-1.5 py-0.5 text-xs transition-colors duration-100',
                    sortBy === key
                      ? 'bg-primary zn-on-accent'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  onClick={() => setSortBy(key)}
                  title={
                    key === 'relevance'
                      ? '按相关度（内核评分）'
                      : key === 'name'
                        ? '按文件名'
                        : '按修改时间（新 → 旧）'
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}
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

        {/* 筛选行（rev173.47 · 待办 #4）：标签 / 目录 / 正则 —— 三项都交给内核字段过滤 */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            aria-label="按标签筛选"
            title="只显示带这个标签的笔记（标签来自 frontmatter 与正文 #标签）"
            className="h-6 max-w-[9rem] rounded-ui-sm border border-border bg-transparent px-1 text-xs text-foreground focus:outline-none"
          >
            <option value="">全部标签</option>
            {tagStats.map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.tag}（{t.count}）
              </option>
            ))}
          </select>
          <select
            value={dirFilter}
            onChange={(e) => setDirFilter(e.target.value)}
            aria-label="按目录筛选"
            title="只显示该目录（含子目录）下的笔记"
            disabled={dirOptions.length === 0}
            className="h-6 max-w-[10rem] rounded-ui-sm border border-border bg-transparent px-1 text-xs text-foreground focus:outline-none disabled:opacity-50"
          >
            <option value="">全部目录</option>
            {dirOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setRegexOn((v) => !v)}
            aria-pressed={regexOn}
            title="把查询当作正则表达式（忽略大小写，例如 ^# .*清单$）"
            className={cn(
              'rounded-ui-sm border px-1.5 py-0.5 text-xs transition-colors duration-100',
              regexOn
                ? 'border-primary bg-primary zn-on-accent'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            .* 正则
          </button>
          {(tagFilter || dirFilter || regexOn) && (
            <button
              type="button"
              onClick={() => {
                setTagFilter('')
                setDirFilter('')
                setRegexOn(false)
              }}
              className="rounded-ui-sm px-1.5 py-0.5 text-xs text-muted-foreground transition-colors duration-100 hover:bg-accent hover:text-foreground"
            >
              清除筛选
            </button>
          )}
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
      <mark className="zn-mark">
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
        <mark key={offset} className="zn-mark">
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
