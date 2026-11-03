/**
 * 「在正文里插入图片」的纯逻辑（不碰 DOM / Tauri，可单测）。
 *
 * 分工：
 *  - 这里只算 **写进 .md 的相对路径** 与 **插在哪个位置**；
 *  - 选文件、把图片复制进库、转 asset URL 由调用方负责
 *    （`App.insertImage` 选文件 + `import_attachment`；`MarkdownEditor` 渲染时转换）。
 *
 * 路径约定（与 Obsidian 一致）：
 *  - `![](image-x.png)` —— 相对**笔记所在目录**；
 *  - `![](/image-x.png)` —— 相对**库根**；
 *  - `http(s):` / `data:` / `blob:` / `asset:` 与 Windows 绝对路径 —— 原样使用，不参与库内解析。
 */

/** 允许作为附件的图片扩展名（小写、不带点；Rust 侧同一份白名单） */
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] as const

/** 带 scheme 的 URL（http: / data: / blob: / asset: …）不按库内路径解析 */
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i

/** Windows 绝对路径（`C:\x` / `C:/x`）与 UNC（`\\server\share`） */
const WIN_ABS_RE = /^(?:[a-zA-Z]:[\\/]|\\\\)/

/** 把 `\` 统一成 `/`，消掉 `.`，处理 `..`；越出根（`..` 过多）返回 null */
export function normalizePosix(path: string): string | null {
  const parts = path.replace(/\\/g, '/').split('/')
  const out: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(part)
  }
  return out.join('/')
}

/** posix 风格的 dirname（`a/b.md` → `a`；无目录 → `''`） */
export function dirnamePosix(path: string): string {
  const p = path.replace(/\\/g, '/')
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

/**
 * Markdown 的**尖括号目标** `<路径>` → 内部路径（去掉尖括号与两侧空白）。
 *
 * CommonMark 用尖括号包住「含空格的路径」，我们插入引用型附件时也这么写
 * （`![](<C:/Music/专辑 1/a b.mp3>)`）。atomic 的图片解析从 rev173.235 起支持它，
 * 但别的入口（表格、预览、未来的渲染器）拿到的可能仍是带尖括号的原文 ——
 * 剥掉比带着去当文件名安全（否则 `<` 会变成文件名的一部分）。
 */
export function stripAngleTarget(src: string): string {
  const t = src.trim()
  return t.length >= 2 && t.startsWith('<') && t.endsWith('>') ? t.slice(1, -1).trim() : t
}

/**
 * 本地路径里的百分号转义 → 真字符（`%20` → 空格）。
 *
 * 为什么需要：`![](<a b.png>)` 是标准写法，但用户也可能写成 `a%20b.png`
 * —— 而 `convertFileSrc` 会把 `%` **再编码一次**（`%20` → `%2520`）⇒ 文件找不到。
 * rev173.235 实测：编码路径的图在编辑器里加载失败（`naturalWidth = 0`）。
 *
 * 只对本地路径调用（`http(s):` 在 `resolveImageAbsPaths` 里已经提前返回 null）；
 * 解不开（非法转义）就原样返回 —— 文件名里本来就可能真的有 `%`。
 */
export function decodeLocalPath(path: string): string {
  if (!path.includes('%')) return path
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/**
 * 图片 src → **本机绝对路径**（供 `convertFileSrc`）。
 *
 * 返回 null 表示「不该由库内路径解析」：
 *  - 已经是 URL（`https:` / `data:` / `blob:` / `asset:`）；
 *  - 相对路径越出了库根（`../../x.png`）；
 *  - 库路径为空（vault 未就绪）。
 *
 * 宽容处理（rev173.235）：尖括号目标先剥掉、百分号转义先解码再解析 ——
 * 「引用原文件」写出的 `<C:/…/截图 2026 10.png>` 与手写的 `%20` 形式都能落到真路径。
 *
 * Windows 绝对路径原样返回（调用方仍可 `convertFileSrc` 它）。
 */
export function resolveImageAbsPaths(
  vault: string | null | undefined,
  notePath: string | null | undefined,
  src: string,
): string[] {
  const raw = decodeLocalPath(stripAngleTarget(src))
  if (!raw) return []
  // 盘符 + 斜杠先于 scheme 判定：`C:\x` 长得像 scheme，但它是本机绝对路径
  if (WIN_ABS_RE.test(raw)) return [raw.replace(/\\/g, '/')]
  /**
   * Android 外部存储的绝对路径（2026-11-03 P1 收口）：不判它就会被当成
   * 「前导 / = 库根」剥成 `storage/...`，手机上点图 / 渲染直接找不到文件。
   * 前缀表与写入侧 `pathFromVaultRoot` 是同一份（storage / sdcard / data / mnt）。
   */
  if (
    raw.startsWith('/storage/') ||
    raw.startsWith('/sdcard/') ||
    raw.startsWith('/data/') ||
    raw.startsWith('/mnt/')
  ) {
    return [raw]
  }
  if (SCHEME_RE.test(raw)) return []
  const root = (vault ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!root) return []
  /**
   * 候选顺序**只在这里定义一次**（`linkCandidates`）：笔记目录 → 库根（rev173.325），
   * `/` 开头只按库根。渲染、点击、导出三处都走它 —— 别再各写一套（rev173.336 教训）。
   */
  return linkCandidates(raw, notePath).map((rel) => `${root}/${rel}`)
}

/* P5（2026-11-03）：单数版 `resolveImageAbsPath` 已删 —— 它只取第一候选，
   天然没有库根兜底；需要「首选」时用 `resolveImageAbsPaths(...)[0]`。 */

/**
 * 正文里点一个**库内相对引用**（图片 / 附件链接）时，按哪些库内路径去找 —— 按顺序。
 *
 * 与 `resolveImageAbsPaths` 同一口径（rev173.336 · 真人测试10 #3）：
 *  - 前导 `/` = 相对库根 ⇒ 只有一条；
 *  - 否则**笔记目录 → 库根**两候选：插入附件写的是库根相对路径（`pathFromVaultRoot`），
 *    笔记在子目录时只拼笔记目录会得到 `测试文件/测试文件/image-….jpg`，
 *    正文显示正常、点开却报「库里没有这个附件」。
 */
export function linkCandidates(
  rel: string,
  notePath: string | null | undefined,
): string[] {
  const raw = String(rel ?? '').replace(/\\/g, '/')
  const rooted = raw.startsWith('/')
  const body = raw.replace(/^\.\//, '').replace(/^\/+/, '')
  const out: string[] = []
  const add = (p: string | null) => {
    if (p && !out.includes(p)) out.push(p)
  }
  if (rooted) {
    add(normalizePosix(body))
  } else {
    const noteDir = notePath ? dirnamePosix(notePath) : ''
    if (noteDir) add(normalizePosix(`${noteDir}/${body}`))
    add(normalizePosix(body))
  }
  return out
}

/** 库内相对路径 → 相对**当前笔记目录**的路径（写进 Markdown 的那个） */
export function pathFromNote(
  notePath: string | null | undefined,
  imageRelPath: string,
): string {
  const target = imageRelPath.replace(/\\/g, '/')
  const noteDir = notePath ? dirnamePosix(notePath) : ''
  if (!noteDir) return target
  if (!target.startsWith(`${noteDir}/`)) return target
  return target.slice(noteDir.length + 1)
}

/**
 * ⚠️ 写入侧**已统一用 `pathFromVaultRoot`**（rev173.325）：写「相对笔记目录」的路径
 * 一旦移动笔记就断。`pathFromNote` 只保留给单测与旧数据的诊断，**新代码不要调用**。
 */

/**
 * 库内相对路径 → 以**库根**为基准的写法（写进 Markdown 的那个）。
 *
 * 为什么不再写成相对笔记目录（rev173.325 · 真人测试6 #1）：附件落盘在「笔记当时所在目录」，
 * 相对笔记目录的写法**一移动笔记就断**（用户实测：移回原位才正常）。
 * 这里写**完整库内路径**（`视频/image-1.png`），解析时按「笔记目录 → 库根」两候选去找
 * （`resolveImageAbsPaths`）—— 笔记放哪都能命中。
 *
 * ⚠️ **不写前导 `/`**：`isLocalAbsPath`（附件三处共用）把 `/` 开头当「平台绝对路径」，
 * 写了会让音视频/文件卡片误判成「库外原文件」。库根语义靠解析的第二候选表达，不需要前缀。
 *
 * 绝对路径（>1 MiB 的引用型附件、Android 的 `/storage/…`）与带 scheme 的 URL 原样返回。
 */
export function pathFromVaultRoot(imageRelPath: string): string {
  const raw = String(imageRelPath ?? '').replace(/\\/g, '/').trim()
  if (!raw) return raw
  if (WIN_ABS_RE.test(raw) || SCHEME_RE.test(raw)) return raw
  // Android 的外部存储绝对路径（引用型附件）原样保留 —— 与 `isLocalAbsPath` 同一口径
  if (/^\/(?:storage|sdcard|data|mnt)\//.test(raw)) return raw
  // 干掉可能的前导 /（老调用 / 手写路径），与 `isLocalAbsPath` 的判据兼容
  return raw.replace(/^\/+/, '')
}

/**
 * 附件文件名主干（不含扩展名、不含目录）：`image-20261018-203055`。
 * 同一秒插两张时由 Rust 侧加 `-1` / `-2` 去重。
 */
export function attachmentStem(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return [
    'image-',
    date.getFullYear(),
    p(date.getMonth() + 1),
    p(date.getDate()),
    '-',
    p(date.getHours()),
    p(date.getMinutes()),
    p(date.getSeconds()),
  ].join('')
}

/**
 * 光标处插入图片语法的编辑描述（`from`/`to`/`insert` 直接喂给 CM6 的 `changes`）。
 *
 * 规则：图片语法**独占一行** —— 插入点前不是换行就补一个，
 * 插入点后不是换行（或文末）也补一个，避免图片语法黏在正文/标题里解析不出来。
 */
export function imageInsertion(
  doc: string,
  from: number,
  to: number,
  relPath: string,
  alt = '',
): { from: number; to: number; insert: string; anchor: number } {
  return blockInsertion(doc, from, to, `![${alt}](${relPath})`)
}

/** 块规则：插入内容独占一行（前后按需补 `\n`） */
function blockInsertion(
  doc: string,
  from: number,
  to: number,
  markdown: string,
): { from: number; to: number; insert: string; anchor: number } {
  let insert = markdown
  if (from > 0 && doc[from - 1] !== '\n') insert = `\n${insert}`
  if (to < doc.length && doc[to] !== '\n') insert = `${insert}\n`
  return { from, to, insert, anchor: from + insert.length }
}

/**
 * 插入**附件链接**（普通文件，rev173.3）：`[文件名](相对路径)`，与图片一样独占一行。
 *
 * 为什么不是图片语法：非图片文件 `![]()` 会渲染成裂图；用普通链接，
 * 点击时由宿主按扩展名分流（图片预览 / 文档阅读器 / 提示路径）。
 */
export function linkInsertion(
  doc: string,
  from: number,
  to: number,
  relPath: string,
  label: string,
): { from: number; to: number; insert: string; anchor: number } {
  return blockInsertion(doc, from, to, `[${label}](${relPath})`)
}

/**
 * 源文件是不是图片（按扩展名，大小写不敏感）。
 * 「插入附件」用它决定写 `![]()`（图片，走渲染）还是 `[]()`（普通链接）。
 */
export function isImageFileName(path: string): boolean {
  const ext = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? ''
  return (IMAGE_EXTS as readonly string[]).includes(ext)
}

/**
 * 从源文件名取「主干」当附件名：`报告 终版.pdf` → `报告-终版`。
 * 去扩展名、空白转 `-`、限 64 字符；空则回退 `file`（Rust 侧还有一层白名单清洗）。
 */
export function stemFromFileName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  return stem.replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 64) || 'file'
}
