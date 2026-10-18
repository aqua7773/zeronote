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
 * 图片 src → **本机绝对路径**（供 `convertFileSrc`）。
 *
 * 返回 null 表示「不该由库内路径解析」：
 *  - 已经是 URL（`https:` / `data:` / `blob:` / `asset:`）；
 *  - 相对路径越出了库根（`../../x.png`）；
 *  - 库路径为空（vault 未就绪）。
 *
 * Windows 绝对路径原样返回（调用方仍可 `convertFileSrc` 它）。
 */
export function resolveImageAbsPath(
  vault: string | null | undefined,
  notePath: string | null | undefined,
  src: string,
): string | null {
  const raw = src.trim()
  if (!raw) return null
  // 盘符 + 斜杠先于 scheme 判定：`C:\x` 长得像 scheme，但它是本机绝对路径
  if (WIN_ABS_RE.test(raw)) return raw.replace(/\\/g, '/')
  if (SCHEME_RE.test(raw)) return null
  const root = (vault ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (!root) return null

  // 以 / 开头 = 相对库根；否则相对笔记所在目录
  const noteDir = notePath ? dirnamePosix(notePath) : ''
  const base = raw.startsWith('/') ? '' : noteDir
  const rel = normalizePosix(base ? `${base}/${raw}` : raw.replace(/^\//, ''))
  if (!rel) return null
  return `${root}/${rel}`
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
