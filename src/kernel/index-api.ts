/**
 * index 原语（v0.2）—— 纯内存子串索引，**零第三方依赖**。
 *
 * 为什么不引搜索库 / SQLite FTS5：
 *   ① 中文没有词边界，FTS5 的 tokenizer 对「中文子串」查询本来就要靠 LIKE 或 trigram 兜底；
 *   ② 参考项目（Lumina / NoteGen）都是自己写索引，内核里塞一个 wasm 搜索库不划算
 *      —— ZeroNote 的定位是「空内核 + 全插件」，内核越薄越好；
 *   ③ `String.prototype.indexOf` 是原生实现，3 MB 语料全库扫描是毫秒级（见复杂度说明）。
 *
 * 复杂度（1000 篇 × 平均 3 KB ≈ 3 MB 语料）：
 *   · rebuild  O(N·L) 一次线性扫描（小写化 + 建表），N = 笔记数。真正的成本不在扫描，
 *     而在 1000 次 `readText` 的 IPC 往返，所以按 {@link READ_BATCH} 篇一批并发读。
 *     内存 ≈ 2 × 语料：原文 + 小写副本；纯中文文本没有 ASCII 大写字母时
 *     `lowerNoAlloc` 直接复用同一引用 ⇒ 实际只占 1 份。
 *   · query    O(N·L) 最坏 —— 每个关键词对每篇做 indexOf。3 MB 扫描约 1–3 ms，
 *     3 个关键词 + 计数 + 排序 ≈ 10–30 ms。千篇量级「每次敲键重查」完全够用；
 *     上万篇再谈倒排表 / 分片，现在上倒排是过早优化。
 *   · upsert / remove  O(L) —— 只重算一篇。
 *
 * 高亮协议：`excerpt` 里用两个不可见哨兵字符标出命中区间，
 * UI 侧用 {@link splitExcerpt} 切成 `{ text, hit }` 片段渲染（不要直接显示原始 excerpt）。
 */

import type { FsApi, IndexApi, SearchHit } from './contract'

/** excerpt 里「命中开始」哨兵（STX）—— 正文里的同名字符在入库时会被剥掉 */
export const HIT_START = '\u0002'
/** excerpt 里「命中结束」哨兵（ETX） */
export const HIT_END = '\u0003'

export type ExcerptSegment = { text: string; hit: boolean }

export type IndexDeps = {
  fs: FsApi
  /**
   * 一次 `rebuild()` 完成（含 scoped 分区重建）。
   *
   * 内核拿它派发 `index:rebuilt` 事件（契约 §1.4）：插件要"重建后做点什么"（刷新搜索页、
   * 重新拉标签统计）不必轮询。**分区名一起给** —— 插件只关心自己那份分区时能直接筛。
   */
  onRebuilt?: (stats: { count: number; ms: number; partition: string }) => void
}

/** query 缺省返回条数 */
const DEFAULT_LIMIT = 20
/** query 上限（防止插件传个离谱的 limit 把 UI 拖死） */
const MAX_LIMIT = 200
/** 单篇读失败不拖垮整次重建 */
const READ_BATCH = 8
/** 摘要：命中点前后各取多少字符 */
const EXCERPT_BEFORE = 30
const EXCERPT_AFTER = 70
/** 只在标题命中时，退化成正文开头这么长 */
const EXCERPT_HEAD = 100
/** 「越靠前分越高」的分段粒度（字符） */
const POSITION_BUCKET = 500

type Entry = {
  path: string
  title: string
  /** 与 `lower` **等长**的展示文本（保证偏移可切） */
  text: string
  lower: string
  titleLower: string
  /** 从 frontmatter 与正文抽出的标签（去重） */
  tags: string[]
}

type Span = { start: number; end: number }

/* ───────────────── 纯函数工具 ───────────────── */

/**
 * 大小写不敏感搜索：没有 ASCII 大写字母时直接复用原字符串（零拷贝）。
 * 中文笔记绝大多数命中这条快速路径 ⇒ 省一半内存和一次分配。
 */
function lowerNoAlloc(s: string): string {
  return /[A-Z]/.test(s) ? s.toLowerCase() : s
}

/** 剥掉哨兵字符 —— 否则用户正文里的 \u0002 会被 UI 当成高亮起点 */
function stripSentinels(s: string): string {
  return s.indexOf(HIT_START) === -1 && s.indexOf(HIT_END) === -1
    ? s
    : s.replaceAll(HIT_START, '').replaceAll(HIT_END, '')
}

function titleFromPath(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.md$/i, '') || path
}

/**
 * 抽标签：兼容 frontmatter 的三种写法（`tags: [a, b]` / 多行 `- a` / `tags: a, b`）
 * 以及正文里的 `#标签`（与编辑器标记的抽取约定一致）。
 *
 * 为什么在前端自己解析、不复用 Rust 的 `parse_frontmatter`：那边只认**单行** `key: value`
 * （`src-tauri/src/lib.rs`），多行标签数组会被整段跳过。而这里拿到的是**全文**，
 * 多解析一遍的成本，远低于把 Rust 侧的解析器复杂化（那也是内核变胖）。
 */
function tagsOf(raw: string): string[] {
  const out = new Set<string>()
  const push = (s: string) => {
    const t = s
      .trim()
      .replace(/^["'[\]]+|["'[\]]+$/g, '')
      .replace(/^#/, '')
      .trim()
    if (t) out.add(t)
  }

  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (fm) {
    const body = fm[1]
    /**
     * 三种写法**各自独立扫**，不是 if/else —— 同一份 frontmatter 里完全可以
     * 既有 `tags: [工作, 项目A]` 又有 `标签: 会议`，互斥会让后面那个凭空消失
     * （真实踩到：统计里「会议」不见了）。
     */
    // ① 行内数组 tags: [a, b, c]
    for (const m of body.matchAll(/^(?:tags|标签)\s*:\s*\[([^\]]*)\]\s*$/gim)) {
      m[1].split(',').forEach(push)
    }
    // ② 多行列表 tags: 换行后跟若干 "  - a"
    for (const m of body.matchAll(/^(?:tags|标签)\s*:\s*\r?\n((?:[ \t]*-[ \t]*.+\r?\n?)+)/gim)) {
      m[1].split(/\r?\n/).forEach((line) => {
        const mm = /^[ \t]*-[ \t]*(.+)$/.exec(line)
        if (mm) push(mm[1])
      })
    }
    // ③ 单行逗号分隔 tags: a, b（排除以 [ 开头的，那是 ① 的地盘）
    for (const m of body.matchAll(/^(?:tags|标签)\s*:\s*([^[\r\n].*)$/gim)) {
      m[1].split(',').forEach(push)
    }
  }

  /**
   * 正文里的 `#标签`：要求行首或空白之后。
   * **必须排除中英标点** —— 否则 "……一个 #工作。" 会把句号也当成标签名的一部分
   * （实测统计里出现了「工作。」这种鬼东西）。
   */
  const bodyTag = /(?<=^|\s)#([^\s#[\]{}()（）【】「」，。！？、；：""''.,!?;:]{1,30})/gm
  for (const m of raw.matchAll(bodyTag)) push(m[1])

  return [...out]
}

/** 建一条索引项。`path` 用 POSIX 分隔符（契约 §1.1）。 */
function makeEntry(path: string, title: string | undefined, raw: string): Entry {
  const text = stripSentinels(raw)
  // 极罕见：某些 Unicode 字符 toLowerCase 会改变长度（如 'İ' → 'i̇'）。
  // 那时 lower 的偏移就不能用来切原文 ⇒ 退化：摘要也用 lower（匹配语义不变）。
  const lowered = lowerNoAlloc(text)
  const aligned = lowered.length === text.length
  const shown = aligned ? text : lowered
  const fromPath = titleFromPath(path)
  const t = title && title.trim() ? title : fromPath
  // 文件名也纳入「可搜索标题」：用户经常按文件名找笔记，而内容首行标题往往不含文件名。
  // 真实踩到过：笔记内容是「# 新笔记」、文件名是 untitled-20261011-172344.md，搜 "unt" 得 0 结果。
  // 注意 title（显示用）不变，只有 titleLower（匹配用）扩展，避免影响列表观感。
  const searchable = fromPath && fromPath !== t ? `${t} ${fromPath}` : t
  return {
    path,
    title: t,
    text: shown,
    lower: lowered,
    titleLower: lowerNoAlloc(searchable),
    tags: tagsOf(text),
  }
}

/** 一次扫描拿到「命中次数」与「首次命中位置」—— 别扫两遍 */
function scan(haystack: string, needle: string): { count: number; first: number } {
  const first = haystack.indexOf(needle)
  if (first === -1) return { count: 0, first: -1 }
  let count = 1
  let i = haystack.indexOf(needle, first + needle.length)
  while (i !== -1) {
    count++
    i = haystack.indexOf(needle, i + needle.length)
  }
  return { count, first }
}

/**
 * 切查询串：**空白分隔** 的多个关键词（全角空格 U+3000 也在 `\s` 里），全部小写化。
 * 空串 / 纯空白 / 非字符串 ⇒ `[]`（调用方据此直接返回空结果，不抛错）。
 */
export function tokenizeQuery(q: string): string[] {
  if (typeof q !== 'string' || q.length === 0) return []
  const out: string[] = []
  for (const raw of q.toLowerCase().split(/\s+/)) {
    const tk = raw.trim()
    if (tk) out.push(tk)
  }
  return out
}

/** 把带哨兵的 excerpt 切成片段，供 UI 渲染高亮 */
export function splitExcerpt(excerpt: string): ExcerptSegment[] {
  const out: ExcerptSegment[] = []
  let i = 0
  while (i < excerpt.length) {
    const open = excerpt.indexOf(HIT_START, i)
    if (open === -1) {
      out.push({ text: excerpt.slice(i), hit: false })
      break
    }
    if (open > i) out.push({ text: excerpt.slice(i, open), hit: false })
    const close = excerpt.indexOf(HIT_END, open + 1)
    if (close === -1) {
      out.push({ text: excerpt.slice(open + 1), hit: true })
      break
    }
    out.push({ text: excerpt.slice(open + 1, close), hit: true })
    i = close + 1
  }
  return out.filter((s) => s.text.length > 0)
}

function resolveLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(limit), MAX_LIMIT)
}

/** `dir` 允许带 `\` 或尾部 `/`，统一成 `notes/sub` 形式；空 ⇒ 不过滤 */
function normalizeDir(dir: string | undefined): string {
  if (typeof dir !== 'string') return ''
  return dir.replace(/\\/g, '/').replace(/\/+$/, '')
}

function inDir(path: string, dirPrefix: string): boolean {
  return path === dirPrefix || path.startsWith(`${dirPrefix}/`)
}

function collectSpans(haystack: string, needle: string, from: number, to: number): Span[] {
  const spans: Span[] = []
  if (needle.length === 0) return spans
  let i = haystack.indexOf(needle, from)
  while (i !== -1 && i < to) {
    const start = Math.max(i, from)
    const end = Math.min(i + needle.length, to)
    if (end > start) spans.push({ start, end })
    i = haystack.indexOf(needle, i + needle.length)
  }
  return spans
}

function mergeSpans(spans: Span[]): Span[] {
  if (spans.length <= 1) return spans
  const sorted = [...spans].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Span[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1]
    const cur = sorted[i]
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end
    } else {
      out.push(cur)
    }
  }
  return out
}

/**
 * 摘要：以「最早出现的那个关键词」为锚点，前后各取一段，窗口内**所有**关键词命中都标哨兵。
 * 一个关键词都没在正文命中（只在标题命中）时，退化成正文开头。
 */
function buildExcerpt(entry: Entry, tokens: string[]): string {
  const body = entry.lower
  let anchor = -1
  let anchorLen = 0
  for (const tk of tokens) {
    const i = body.indexOf(tk)
    if (i !== -1 && (anchor === -1 || i < anchor)) {
      anchor = i
      anchorLen = tk.length
    }
  }

  const from = anchor === -1 ? 0 : Math.max(0, anchor - EXCERPT_BEFORE)
  const to =
    anchor === -1
      ? Math.min(entry.text.length, EXCERPT_HEAD)
      : Math.min(entry.text.length, anchor + anchorLen + EXCERPT_AFTER)

  const spans: Span[] = []
  for (const tk of tokens) spans.push(...collectSpans(body, tk, from, to))

  let out = anchor > EXCERPT_BEFORE ? '…' : ''
  let pos = from
  for (const s of mergeSpans(spans)) {
    if (s.start > pos) out += entry.text.slice(pos, s.start)
    out += HIT_START + entry.text.slice(s.start, s.end) + HIT_END
    pos = s.end
  }
  out += entry.text.slice(pos, to)
  if (to < entry.text.length) out += '…'

  // 摘要里的换行/制表符会在 HTML 里折叠成一堆空白，先压平
  return out.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ')
}

/**
 * 打分（整数，越大越相关）—— 规则：
 *   · 标题命中 ×8，正文命中 ×2（标题是强信号）
 *   · 该关键词出现在标题里，额外 +4
 *   · 整条标题 == 关键词，额外 +10（最强信号：搜「索引」时《索引》排第一）
 *   · 正文首次命中越靠前 +1..+4（每 500 字符一档递减）
 * 多关键词累加 ⇒ 命中词更多的笔记自然排前面。
 */
function scoreEntry(entry: Entry, tokens: string[]): number {
  let score = 0
  for (const tk of tokens) {
    const t = scan(entry.titleLower, tk)
    const b = scan(entry.lower, tk)
    score += t.count * 8 + b.count * 2
    if (t.count > 0) score += 4
    if (entry.titleLower === tk) score += 10
    if (b.first !== -1) {
      score += Math.max(1, 4 - Math.floor(b.first / POSITION_BUCKET))
    }
  }
  return score
}

/**
 * 正则模式的摘要：以**第一个命中**为锚点取窗口，窗口内所有命中都标哨兵
 * （与关键词模式同一套口径 —— UI 的 `splitExcerpt` 高亮不用分叉）。
 *
 * 零宽匹配（`^` / `\b` / `(?=x)`）没有可高亮的文本 —— 跳过但要推进 `lastIndex`，
 * 否则 `exec` 循环会原地打转。
 */
function buildRegexExcerpt(entry: Entry, re: RegExp): string {
  const text = entry.text
  const head = re.exec(text)
  const from = head ? Math.max(0, head.index - EXCERPT_BEFORE) : 0
  const to = head
    ? Math.min(text.length, head.index + head[0].length + EXCERPT_AFTER)
    : Math.min(text.length, EXCERPT_HEAD)

  const spans: Span[] = []
  const scanRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
  for (let m = scanRe.exec(text); m && m.index < to; m = scanRe.exec(text)) {
    if (m[0].length === 0) {
      scanRe.lastIndex += 1
      continue
    }
    const start = Math.max(m.index, from)
    const end = Math.min(m.index + m[0].length, to)
    if (end > start) spans.push({ start, end })
  }

  let out = from > 0 ? '…' : ''
  let pos = from
  for (const s of mergeSpans(spans)) {
    if (s.start > pos) out += text.slice(pos, s.start)
    out += HIT_START + text.slice(s.start, s.end) + HIT_END
    pos = s.end
  }
  out += text.slice(pos, to)
  if (to < text.length) out += '…'
  // 与 buildExcerpt 一样压平空白，避免摘要里出现一串换行
  return out.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ')
}

/** 正则打分（与 `scoreEntry` 同口径：标题 ×8 / 正文 ×2 / 标题命中 +4 / 越靠前 +1..4） */
function scoreRegex(entry: Entry, re: RegExp): number {
  const count = (hay: string, limit = 200): number => {
    const scanRe = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)
    let n = 0
    for (let m = scanRe.exec(hay); m && n < limit; m = scanRe.exec(hay)) {
      if (m[0].length === 0) scanRe.lastIndex += 1
      else n += 1
    }
    return n
  }
  const t = count(entry.titleLower)
  const b = count(entry.text)
  let score = t * 8 + b * 2
  if (t > 0) score += 4
  const first = entry.text.search(re)
  if (first !== -1) score += Math.max(1, 4 - Math.floor(first / POSITION_BUCKET))
  return score
}

/* ───────────────── 实现 ───────────────── */

/** 一个分区的内部状态 —— 每个分区一份，彼此看不见 */
type Partition = {
  docs: Map<string, Entry>
  /** 重建进行中：期间的 upsert/remove 记在这里，重建收尾时重放，避免被覆盖 */
  building: boolean
  pendingUpserts: Map<string, string>
  pendingRemoves: Set<string>
  /** 并发 rebuild 复用同一个 promise（返回同一份 { count, ms }） */
  inflight: Promise<{ count: number; ms: number }> | null
}

/** 默认分区名 —— 内核与没显式分区的插件都用它 */
export const DEFAULT_PARTITION = 'default'

/**
 * 建一个内存索引。`deps.fs` 是唯一的 IO 依赖（rebuild 靠 `listNotes` + `readText`）。
 *
 * 生命周期由调用方掌握：UI 在打开搜索面板时调一次 `rebuild()`，
 * 之后靠 `upsert` / `remove` 增量维护（可挂在 `fs.watch` 上，见报告第 4 节）。
 *
 * ## 分区（2026-10-12 加）
 *
 * 以前全局**只有一份**索引，隐患很实在：机密笔记的正文会被公开搜索命中，
 * 一个插件的索引数据另一个插件也能查到。现在 `scoped(名字)` 给出**独立命名空间** ——
 * 各自的 `docs`、各自的 pending、各自的 rebuild，互相看不见。
 *
 * **分区只隔离"可见性"，不改变数据源**：`rebuild()` 照样扫全库（`fs.listNotes`），
 * 只是写进自己那份。要按密级/标签筛，**由插件决定 upsert 什么** ——
 * "哪些笔记算机密"是业务策略，不该由内核替它判断。
 */
export function createIndexApi(deps: IndexDeps): IndexApi {
  const partitions = new Map<string, Partition>()

  function partOf(name: string): Partition {
    let p = partitions.get(name)
    if (!p) {
      p = {
        docs: new Map<string, Entry>(),
        building: false,
        pendingUpserts: new Map<string, string>(),
        pendingRemoves: new Set<string>(),
        inflight: null,
      }
      partitions.set(name, p)
    }
    return p
  }

  /** 给某个分区造一个视图 */
  function viewOf(name: string): IndexApi {
    const part = partOf(name)

    function applyUpsert(path: string, text: string): void {
      const prev = part.docs.get(path)
      part.docs.set(path, makeEntry(path, prev?.title, text))
    }

    async function rebuildImpl(): Promise<{ count: number; ms: number }> {
      const t0 = Date.now()
      let result: { count: number; ms: number } | null = null
      part.building = true
      part.pendingUpserts.clear()
      part.pendingRemoves.clear()
      try {
        // 只索引**笔记**：`listNotes` 2026-10-13 起也会返回只读文档（`kind: 'doc'`，
        // 如 pdf/epub），2026-10-18 rev173.3 起还有图片（`kind: 'image'`）——
        // 索引是"Markdown 全文搜索"，对二进制调 `readText` 只会白读一遍。
        const list = (await deps.fs.listNotes()).filter((m) => m.kind === 'note')
        const next = new Map<string, Entry>()
        for (let i = 0; i < list.length; i += READ_BATCH) {
          const chunk = list.slice(i, i + READ_BATCH)
          // 单篇读失败（文件被外部删/权限问题）⇒ 跳过这一篇，不整体失败
          const texts = await Promise.all(
            chunk.map((m) => deps.fs.readText(m.path).then((t) => t, () => null)),
          )
          for (let j = 0; j < chunk.length; j++) {
            const text = texts[j]
            if (text === null || text === undefined) continue
            next.set(chunk[j].path, makeEntry(chunk[j].path, chunk[j].title, text))
          }
        }
        part.docs = next
        result = { count: part.docs.size, ms: Date.now() - t0 }
        return result
      } finally {
        for (const [p, t] of part.pendingUpserts) applyUpsert(p, t)
        for (const p of part.pendingRemoves) part.docs.delete(p)
        part.pendingUpserts.clear()
        part.pendingRemoves.clear()
        part.building = false
        /**
         * 广播放在 `finally` 的**回放之后**：监听者收到事件立刻 `query()` 时，重建期间写进来
         * 的那几篇也已经在索引里了（否则就是一个"事件到了但数据没到"的竞态）。
         * 只有**成功**重建才广播（失败由调用方拿到 reject，不该再报一次"完成"）；
         * 回调抛错不能拖垮 rebuild —— 插件监听器写错是它的事，索引是内核能力。
         */
        if (result) {
          try {
            deps.onRebuilt?.({ ...result, partition: name })
          } catch {
            /* 监听器异常不影响重建结果 */
          }
        }
      }
    }

    return {
      /**
       * 多关键词 **AND** + 中文子串。`opts.regex` 为真时 `q` 整个当作**正则表达式**
       * （不切词、大小写不敏感）—— 语法错误时返回空表而不抛错
       * （查询契约：任何输入都不抛错；由 UI 负责提示「正则无效」）。
       */
      async query(
        q: string,
        opts?: { limit?: number; dir?: string; tag?: string; regex?: boolean },
      ): Promise<SearchHit[]> {
        if (part.docs.size === 0) return []

        const dirPrefix = normalizeDir(opts?.dir)
        const limit = resolveLimit(opts?.limit)
        // 字段过滤：按标签精确命中（大小写不敏感，与正文搜索的语义保持一致）
        const wantTag = opts?.tag?.trim().toLowerCase()

        // 正则模式：整串当表达式（`i` 忽略大小写、`m` 让 ^ / $ 按行匹配、`u` 正确处理中文）
        let re: RegExp | null = null
        if (opts?.regex === true && typeof q === 'string' && q.trim() !== '') {
          try {
            re = new RegExp(q, 'imu')
          } catch {
            return []
          }
        }
        const tokens = re ? [] : tokenizeQuery(q)

        /**
         * 空关键词**只在有筛选条件时才算合法** —— "列出这个标签 / 目录下的全部笔记"
         * 正是 `query('', { tag })` / `query('', { dir })` 的用法（真实踩到：之前这里
         * 直接 return [] 导致按标签筛选永远 0 篇）。什么条件都没给才是真的空查询。
         */
        if (!re && tokens.length === 0 && !wantTag && !dirPrefix) return []

        const scored: { entry: Entry; score: number }[] = []

        for (const entry of part.docs.values()) {
          if (dirPrefix && !inDir(entry.path, dirPrefix)) continue
          if (wantTag && !entry.tags.some((t) => t.toLowerCase() === wantTag)) continue

          // 正则模式：正文或标题命中即算（`re` 不带 `g`，`test` 不改变匹配状态）
          if (re) {
            if (!re.test(entry.text) && !re.test(entry.titleLower)) continue
            scored.push({ entry, score: scoreRegex(entry, re) })
            continue
          }

          // 纯标签 / 纯目录筛选：没有关键词可匹配，不打分也不做命中摘要
          if (tokens.length === 0) {
            scored.push({ entry, score: 0 })
            continue
          }

          let ok = true
          for (const tk of tokens) {
            // AND：任一关键词在标题和正文里都不出现 ⇒ 整篇淘汰
            if (entry.titleLower.indexOf(tk) === -1 && entry.lower.indexOf(tk) === -1) {
              ok = false
              break
            }
          }
          if (ok) scored.push({ entry, score: scoreEntry(entry, tokens) })
        }

        scored.sort(
          (a, b) =>
            b.score - a.score ||
            (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0),
        )

        // 摘要在切片之后才算 —— 只给真正返回的那 ≤ limit 篇做窗口拼接
        return scored.slice(0, limit).map(({ entry, score }) => ({
          path: entry.path,
          title: entry.title,
          // 无关键词时没有"命中窗口"可给 ⇒ 退回正文开头（正则模式见 buildRegexExcerpt）
          excerpt: re
            ? buildRegexExcerpt(entry, re)
            : tokens.length > 0
              ? buildExcerpt(entry, tokens)
              : entry.text.slice(0, 120).replace(/\s+/g, ' ').trim(),
          score,
        }))
      },

      async upsert(path: string, text: string): Promise<void> {
        applyUpsert(path, text)
        if (part.building) part.pendingUpserts.set(path, text)
      },

      async remove(path: string): Promise<void> {
        part.docs.delete(path)
        if (part.building) part.pendingRemoves.add(path)
      },

      async rebuild(): Promise<{ count: number; ms: number }> {
        if (part.inflight) return part.inflight
        const p = rebuildImpl()
        part.inflight = p
        try {
          return await p
        } finally {
          part.inflight = null
        }
      },

      /**
       * 标签统计：**每个标签下有多少篇笔记**（不是正文里出现几次 —— `tagsOf` 已按篇去重），
       * 按笔记数降序。规格 §2.3 的「标签聚合查看」用它。
       */
      async tags(): Promise<{ tag: string; count: number }[]> {
        const counter = new Map<string, number>()
        for (const entry of part.docs.values()) {
          for (const t of entry.tags) counter.set(t, (counter.get(t) ?? 0) + 1)
        }
        return [...counter.entries()]
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
      },

      /**
       * 取一个**独立分区**。名字是**绝对的**（不做层级嵌套）——
       * `scoped('a').scoped('b')` 拿到的还是分区 `b`，不是 `a/b`，避免歧义。
       * 同名分区共享同一份索引（前置插件与消费者可以对同一个分区操作）。
       */
      scoped(child: string): IndexApi {
        if (!child || typeof child !== 'string') {
          throw new Error('index.scoped 需要一个非空的分区名')
        }
        return viewOf(child)
      },
    }
  }

  return viewOf(DEFAULT_PARTITION)
}

