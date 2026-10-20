import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FsApi, NoteMeta } from '@/kernel/contract'
import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'
import { dirPrefixesOf } from '@/lib/note-dirs'
import {
  applyReplace,
  collectHits,
  compileFind,
  type FileMatch,
} from '@/lib/global-replace'

/**
 * 全局替换面板（rev173.49 · 待办 #3「跨笔记替换」）。
 *
 * 流程按验收口径写死：**先试运行出命中清单 → 确认后才写盘 → 每篇改前先备份**。
 *
 * 备份直接用**回收站**（`fs.delete` 把原文件移进 `.zn/trash/<stamp>/`）：用户能看见、能恢复，
 * 不必再为"替换备份"发明一套目录。顺序是 delete → writeText，所以任何一步失败都不会
 * 让原文凭空消失（最坏情况是"文件在回收站里、正文没写回去"，用户仍可恢复）。
 *
 * 契约方式与 SearchPanel 一致：受控（open/onClose 由 App 给），fs 从 props 注入 ——
 * 面板不认识内核，也能单测。
 */
export type ReplacePanelProps = {
  open: boolean
  onClose: () => void
  /** 内核 fs 原语；不传则显示「未接入」 */
  fs?: FsApi | null
  /** 库里全部笔记（用于范围过滤与目录下拉） */
  notes?: NoteMeta[]
  /** 替换完成后通知宿主：被改的路径 + 替换处数（宿主据此刷新列表 / 重载当前文档） */
  onApplied?: (paths: string[], replaced: number) => void
}

const HIT_PREVIEW_PER_FILE = 20

type Snapshot = { find: string; regex: boolean; caseSensitive: boolean; dir: string }

export function ReplacePanel({
  open,
  onClose,
  fs = null,
  notes = [],
  onApplied,
}: ReplacePanelProps) {
  const [find, setFind] = useState('')
  const [replacement, setReplacement] = useState('')
  const [regexOn, setRegexOn] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [dirFilter, setDirFilter] = useState('')
  const [scanning, setScanning] = useState(false)
  const [applying, setApplying] = useState(false)
  const [matches, setMatches] = useState<FileMatch[]>([])
  /** 上次试运行时的条件 —— 与当前不一致就提示「条件变了，请重新试运行」 */
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [done, setDone] = useState<{ paths: string[]; replaced: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const dirOptions = useMemo(() => dirPrefixesOf(notes), [notes])

  const totalHits = useMemo(() => matches.reduce((s, m) => s + m.total, 0), [matches])

  /** 每次改条件都清掉旧清单 —— 避免「看着旧清单点替换」 */
  const invalidate = useCallback(() => {
    setMatches([])
    setSnapshot(null)
    setDone(null)
    setError(null)
  }, [])

  /** 当前条件是否与清单一致 */
  const stale =
    snapshot !== null &&
    (snapshot.find !== find ||
      snapshot.regex !== regexOn ||
      snapshot.caseSensitive !== caseSensitive ||
      snapshot.dir !== dirFilter)

  const scan = useCallback(async () => {
    if (!fs) return
    if (!find.trim()) {
      setError('请输入要查找的内容')
      return
    }
    const c = compileFind(find, { regex: regexOn, caseSensitive })
    if ('error' in c) {
      setError(`查找表达式无效：${c.error}`)
      return
    }
    const scope = dirFilter
      ? (n: NoteMeta) => n.path === dirFilter || n.path.startsWith(`${dirFilter}/`)
      : () => true
    const targets = notes.filter((n) => n.kind === 'note' && scope(n))

    setScanning(true)
    setError(null)
    setDone(null)
    try {
      const out: FileMatch[] = []
      for (const n of targets) {
        const text = await fs.readText(n.path)
        const fm = collectHits(n.path, text, find, { regex: regexOn, caseSensitive })
        if (fm.total > 0) out.push(fm)
      }
      setMatches(out)
      setSnapshot({ find, regex: regexOn, caseSensitive, dir: dirFilter })
    } catch (e) {
      setError(`试运行失败：${String(e)}`)
    } finally {
      setScanning(false)
    }
  }, [fs, notes, find, regexOn, caseSensitive, dirFilter])

  const applyAll = useCallback(async () => {
    if (!fs || totalHits === 0) return
    const ok = window.confirm(
      `将替换 ${totalHits} 处，涉及 ${matches.length} 篇笔记。\n\n` +
        '每篇改前会先把原文件移进回收站（可恢复），确认继续？',
    )
    if (!ok) return

    setApplying(true)
    setError(null)
    const changed: string[] = []
    let replaced = 0
    try {
      for (const m of matches) {
        // 重新读一遍：试运行之后文件可能被改过（编辑器 / 外部程序）
        const text = await fs.readText(m.path)
        const r = applyReplace(text, find, replacement, { regex: regexOn, caseSensitive })
        if (r.replaced === 0) continue
        await fs.delete(m.path) // 备份进回收站
        await fs.writeText(m.path, r.content)
        changed.push(m.path)
        replaced += r.replaced
      }
      setMatches([])
      setSnapshot(null)
      setDone({ paths: changed, replaced })
      onApplied?.(changed, replaced)
    } catch (e) {
      setError(`替换中断：${String(e)}`)
      if (changed.length > 0) onApplied?.(changed, replaced)
    } finally {
      setApplying(false)
    }
  }, [fs, matches, find, replacement, regexOn, caseSensitive, totalHits, onApplied])

  if (!open) return null

  let body: ReactNode
  if (!fs) {
    body = <Empty>fs 未接入 —— 把内核的 fs 原语传给这个面板（kernel.fs）</Empty>
  } else if (error) {
    body = <Empty className="text-destructive">{error}</Empty>
  } else if (done) {
    body = (
      <Empty>
        已替换 <b>{done.replaced}</b> 处 · {done.paths.length} 篇。
        <br />
        原文件已移入回收站（可恢复）。
      </Empty>
    )
  } else if (scanning) {
    body = <Empty>正在扫描…</Empty>
  } else if (matches.length === 0) {
    body = (
      <Empty>
        输入查找内容后点「试运行」。
        <br />
        会先列出命中清单（文件 + 行 + 上下文），确认后才写盘。
      </Empty>
    )
  } else {
    body = matches.map((m) => (
      <div key={m.path} className="px-1 py-1.5">
        <div className="flex items-baseline justify-between gap-2 px-1">
          <span className="truncate text-xs font-medium text-foreground">{m.path}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{m.total} 处</span>
        </div>
        {m.hits.slice(0, HIT_PREVIEW_PER_FILE).map((h, i) => (
          <div key={i} className="mt-0.5 truncate px-1 text-xs text-muted-foreground">
            <span className="text-fg-subtle">{h.line}: </span>
            {h.before}
            <mark className="zn-mark">{h.match}</mark>
            {h.after}
          </div>
        ))}
        {m.total > m.hits.length && (
          <div className="mt-0.5 px-1 text-xs text-muted-foreground">
            …还有 {m.total - m.hits.length} 处未展开
          </div>
        )}
      </div>
    ))
  }

  const foot = !fs
    ? '未接入 fs 原语'
    : applying
      ? '正在替换…'
      : done
        ? `${done.paths.length} 篇已改 · ${done.replaced} 处`
        : scanning
          ? '扫描中…'
          : matches.length > 0
            ? `${matches.length} 篇 · ${totalHits} 处命中${stale ? '（条件已改，请重新试运行）' : ''}`
            : '未运行'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-[10vh]"
      onMouseDown={onClose}
      onKeyDown={(e) => {
        // Esc 关面板 —— 与搜索面板同一套习惯（输入框的 keydown 会冒泡到这里）
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="absolute inset-0 bg-foreground/40" />
      <div
        className="relative flex max-h-[80vh] w-full max-w-[42rem] flex-col overflow-hidden rounded-ui-lg border border-border bg-popover text-foreground shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <span className="shrink-0 text-xs font-medium text-foreground">全局替换</span>
          <input
            ref={inputRef}
            value={find}
            onChange={(e) => {
              setFind(e.target.value)
              invalidate()
            }}
            placeholder="查找"
            aria-label="查找"
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <Button size="sm" variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>

        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
          <input
            value={replacement}
            onChange={(e) => {
              setReplacement(e.target.value)
              invalidate()
            }}
            placeholder="替换为（正则模式可用 $1 引用分组）"
            aria-label="替换为"
            className="h-7 min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
        </div>

        {/* 选项行：范围 / 正则 / 大小写 / 试运行 */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-3 py-1.5">
          <select
            value={dirFilter}
            onChange={(e) => {
              setDirFilter(e.target.value)
              invalidate()
            }}
            aria-label="替换范围目录"
            title="只替换该目录（含子目录）下的笔记"
            disabled={dirOptions.length === 0}
            className="h-6 max-w-[10rem] rounded-ui-sm border border-border bg-transparent px-1 text-xs text-foreground focus:outline-none disabled:opacity-50"
          >
            <option value="">全部笔记</option>
            {dirOptions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              setRegexOn((v) => !v)
              invalidate()
            }}
            aria-pressed={regexOn}
            title="把查找串当作正则表达式（^ / $ 按行；替换串可用 $1）"
            className={cn(
              'rounded-ui-sm border px-1.5 py-0.5 text-xs transition-colors duration-100',
              regexOn
                ? 'border-primary bg-primary zn-on-accent'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            .* 正则
          </button>
          <button
            type="button"
            onClick={() => {
              setCaseSensitive((v) => !v)
              invalidate()
            }}
            aria-pressed={caseSensitive}
            title="区分大小写（默认不区分，与搜索一致）"
            className={cn(
              'rounded-ui-sm border px-1.5 py-0.5 text-xs transition-colors duration-100',
              caseSensitive
                ? 'border-primary bg-primary zn-on-accent'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            Aa
          </button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void scan()}
            disabled={!fs || scanning || applying}
            title="只扫描并列出命中清单，不写盘"
          >
            试运行
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void applyAll()}
            disabled={!fs || applying || scanning || totalHits === 0 || stale}
            title="按上面的清单逐篇替换（每篇改前先备份到回收站）"
          >
            全部替换
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-1">{body}</div>

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
