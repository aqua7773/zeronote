/**
 * 「全局替换（跨笔记）」的纯逻辑 —— 不碰 Tauri / DOM，可单测。
 *
 * 口径与搜索一致（rev173.47）：
 *  · **普通模式**：`find` 按字面量匹配，忽略大小写（与搜索的语义一致；大小写要敏感就打开开关）；
 *  · **正则模式**：整串当表达式，flags 固定 `g` + `u` + `m`（`^`/`$` 按行）+ `i`（除非要求区分）；
 *  · 替换串在正则模式下支持 `$1` 反向引用；**普通模式下 `$` 是字面量**（用户搜 `$100` 时不该被吃掉）。
 *
 * 行号从 1 开始；上下文只取命中所在行（before 40 字符 / after 60 字符），够 UI 展示又不淹屏幕。
 */

export type ReplaceFlags = {
  /** 把 find 当正则表达式 */
  regex?: boolean
  /** 区分大小写（默认不区分，与搜索一致） */
  caseSensitive?: boolean
}

export type ReplaceHit = {
  /** 1-based 行号 */
  line: number
  /** 1-based 列号（字符偏移） */
  column: number
  /** 命中的原文 */
  match: string
  /** 同行命中点**之前**的片段（最多 40 字符，左侧截断时带 …） */
  before: string
  /** 同行命中点**之后**的片段（最多 60 字符） */
  after: string
}

/** 单个文件的扫描结果 */
export type FileMatch = {
  path: string
  hits: ReplaceHit[]
  /** 该文件里命中总数（hits 只是前 limit 条预览） */
  total: number
}

const HIT_LIMIT = 20
const BEFORE_MAX = 40
const AFTER_MAX = 60

/** 普通模式把正则元字符转义成字面量（用户输入 `a.b` 时不该匹配 `axb`） */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function flagsOf(flags: ReplaceFlags): string {
  const parts = ['g', 'u']
  if (!flags.caseSensitive) parts.push('i')
  if (flags.regex) parts.push('m')
  return parts.join('')
}

/**
 * 编译查找串：普通模式转义后编译；正则模式直接编译。
 * 空串 / 语法错误返回 `{ error }` —— UI 拿它显示一句话，**不抛异常**。
 */
export function compileFind(
  find: string,
  flags: ReplaceFlags = {},
): { re: RegExp } | { error: string } {
  if (typeof find !== 'string' || find.length === 0) return { error: '请输入要查找的内容' }
  const f = flagsOf(flags)
  try {
    return { re: new RegExp(flags.regex ? find : escapeRegExp(find), f) }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

function countOf(text: string, re: RegExp): number {
  // 传入的 re 可能带 g：每次统计都用**新的**实例，避免 lastIndex 残留
  const scan = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  let n = 0
  for (let m = scan.exec(text); m; m = scan.exec(text)) {
    if (m[0].length === 0) scan.lastIndex += 1
    else n += 1
  }
  return n
}

/** 一篇里的命中数 */
export function countMatches(text: string, find: string, flags: ReplaceFlags = {}): number {
  const c = compileFind(find, flags)
  if ('error' in c) return 0
  return countOf(text, c.re)
}

/** 取某偏移所在行的起止（返回 [行号 1-based, 起始偏移, 结束偏移]） */
function lineAt(text: string, index: number): { line: number; start: number; end: number } {
  const start = text.lastIndexOf('\n', index - 1) + 1
  const nextNl = text.indexOf('\n', index)
  const end = nextNl === -1 ? text.length : nextNl
  let line = 1
  for (let i = text.indexOf('\n'); i !== -1 && i < index; i = text.indexOf('\n', i + 1)) line += 1
  return { line, start, end }
}

/** 收集命中（行号 + 上下文），最多 `limit` 条预览 */
export function collectHits(
  path: string,
  text: string,
  find: string,
  flags: ReplaceFlags = {},
  limit: number = HIT_LIMIT,
): FileMatch {
  const c = compileFind(find, flags)
  if ('error' in c) return { path, hits: [], total: 0 }
  const re = c.re
  const total = countOf(text, re)
  if (total === 0) return { path, hits: [], total: 0 }

  const scan = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  const hits: ReplaceHit[] = []
  while (hits.length < limit) {
    const m = scan.exec(text)
    if (!m) break
    if (m[0].length === 0) {
      scan.lastIndex += 1
      continue
    }
    const at = lineAt(text, m.index)
    const lineText = text.slice(at.start, at.end)
    const colInLine = m.index - at.start
    const beforeRaw = lineText.slice(0, colInLine)
    const afterRaw = lineText.slice(colInLine + m[0].length)
    hits.push({
      line: at.line,
      column: colInLine + 1,
      match: m[0],
      before: beforeRaw.length > BEFORE_MAX ? `…${beforeRaw.slice(-BEFORE_MAX)}` : beforeRaw,
      after: afterRaw.length > AFTER_MAX ? `${afterRaw.slice(0, AFTER_MAX)}…` : afterRaw,
    })
  }
  return { path, hits, total }
}

/**
 * 执行替换。
 *
 * 普通模式用**函数替换**：`$` 在替换串里是字面量（`$100` 不会被当成 `$1` + `00`）；
 * 正则模式用**字符串替换**：`$1` / `$&` 这些反向引用照常生效（用户写正则就是想要这个）。
 */
export function applyReplace(
  text: string,
  find: string,
  replacement: string,
  flags: ReplaceFlags = {},
): { content: string; replaced: number } {
  const c = compileFind(find, flags)
  if ('error' in c) return { content: text, replaced: 0 }
  const re = c.re
  const replaced = countOf(text, re)
  if (replaced === 0) return { content: text, replaced: 0 }
  const content = flags.regex ? text.replace(re, replacement) : text.replace(re, () => replacement)
  return { content, replaced }
}
