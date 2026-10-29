/**
 * **附件文件卡片**（rev173.245 · 附件需求最后一小块）。
 *
 * 需求原文（`docs/附件与同步-需求-2026-10-28.md` §1）：正文里永远只写一条路径，
 * 渲染层按扩展名决定显示成**图片 / 音频 / 视频 / 文件卡片**。前三种早已落地
 * （rev173.226 媒体内联、rev173.235 破图提示、rev173.239 两个正文入口），
 * 只剩「非媒体附件」一直是普通链接（同文档 §3 表格最后一行）。
 *
 * 本期范围（**只做库外绝对路径**，与需求那句话一致）：
 * - 触发：整行只有一个链接，目标以盘符 / UNC 开头，扩展名在文档白名单里；
 * - 展示：类型图标 + 文件名 + 扩展名 + 大小 + 「源文件不在本机」；
 * - 不动库内相对路径（现状是普通链接，需求没要求改）。
 *
 * 为什么「大小 / 在不在本机」能同步拿到：库外绝对路径的非媒体附件**必然**是
 * > 1 MiB 的「引用原文件」（≤ 1 MiB 会复制进库、写相对路径），身份一定在引用台账
 * `<库>/.zn-assets/manifest.json` 里（rev173.232 起的规则）。所以台账就是唯一
 * 数据源 —— 不新增内核原语，也不去 stat 文件。
 *
 * ⚠️ 台账里**没有**这条时，大小留空、「不在本机」不报：手工敲进去的路径本来
 * 就可能不在台账里，猜错比留白更糟（硬约束 4：静默失效比报错危险，但误报同样危险）。
 */
import { StateEffect } from '@codemirror/state'
import { formatSize, isLocalAbsPath } from './attachment'

/** 卡片的类型分组 —— 决定图标与底色，不发散到十几类 */
export type FileCardKind = 'doc' | 'sheet' | 'slide' | 'archive' | 'ebook' | 'file'

/**
 * 扩展名 → 分组。
 *
 * **只收「文档类」**：图片 / 音视频扩展名**故意不在这里** —— 那是 `![]()` 的领域，
 * 内联播放与破图提示早已覆盖（`media-render.ts` 与 `MEDIA_EXTS` 是同一份口径）。
 * 未知扩展名返回 null ⇒ 不卡片化，保持普通链接（宁可不做，不要误伤）。
 */
const KIND_BY_EXT: Record<string, FileCardKind> = {
  // 文档
  pdf: 'doc',
  doc: 'doc',
  docx: 'doc',
  odt: 'doc',
  rtf: 'doc',
  pages: 'doc',
  // 表格
  xls: 'sheet',
  xlsx: 'sheet',
  ods: 'sheet',
  csv: 'sheet',
  numbers: 'sheet',
  // 演示
  ppt: 'slide',
  pptx: 'slide',
  odp: 'slide',
  key: 'slide',
  // 归档
  zip: 'archive',
  '7z': 'archive',
  rar: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  iso: 'archive',
  // 电子书
  epub: 'ebook',
  mobi: 'ebook',
  azw3: 'ebook',
  djvu: 'ebook',
  // 其它常见「附件」扩展名（图标统一）
  txt: 'file',
  md: 'file',
  json: 'file',
  xml: 'file',
  log: 'file',
  psd: 'file',
  ai: 'file',
  sketch: 'file',
  fig: 'file',
  apk: 'file',
  exe: 'file',
  dmg: 'file',
}

/** 分组 → 图标（用 emoji：跨平台、不需要额外资源文件） */
const ICON_BY_KIND: Record<FileCardKind, string> = {
  doc: '📄',
  sheet: '📊',
  slide: '📽️',
  archive: '🗜️',
  ebook: '📚',
  file: '📎',
}

/** 分组 → 中文类型名（读屏与 title 用） */
export const KIND_LABEL: Record<FileCardKind, string> = {
  doc: '文档',
  sheet: '表格',
  slide: '演示',
  archive: '压缩包',
  ebook: '电子书',
  file: '文件',
}

export function iconOfKind(kind: FileCardKind): string {
  return ICON_BY_KIND[kind]
}

/**
 * 路径 / URL → 小写扩展名（不含点）；没有扩展名 ⇒ `''`。
 *
 * 先剥尖括号、解 `%xx`：插入端对含空格的路径写的是 `[名](<D:/a b.pdf>)`，
 * `%20` 编码在别处也会出现（与 `insert-image.ts` / `asset-relay.ts` 的做法一致）。
 */
export function extOfPath(pathOrUrl: string): string {
  const raw = normalizeCardPath(pathOrUrl)
  const base = raw.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** 路径规范化（**只用于判定与匹配台账，不用于读文件**）—— 与 `normalizeRelayPath` 同规则 */
export function normalizeCardPath(path: string): string {
  let raw = (path ?? '').trim()
  if (raw.length >= 2 && raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1).trim()
  if (raw.includes('%')) {
    try {
      raw = decodeURIComponent(raw)
    } catch {
      /* 非法转义按原样用（文件名里本来就可能真有 %） */
    }
  }
  return raw.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
}

/**
 * 库外绝对路径：盘符（`D:/`）· UNC（`\\host` / `//host`）· Unix 绝对（`/storage/...`）。
 *
 * rev173.250 起委托 `isLocalAbsPath`（附件三处共用一份口径）—— 此前只认 Windows 形态，
 * 手机上 `import_attachment` 写出的 `/storage/emulated/0/...` 一律不做卡片（手机走查实测）。
 * ⚠️ UNC 的判据在**归一化之前**：`normalizeCardPath` 会把 `\\` 变成 `//`。
 */
export function isExternalAbsPath(path: string): boolean {
  return isLocalAbsPath(path)
}

/**
 * 路径 → 卡片分组；`null` = 不做卡片（保持普通链接）。
 *
 * **只认库外绝对路径**：库内相对路径的附件走的是另一条线（点开由宿主分流，
 * 需求本期没要求改），混进来会让「普通链接」这个既有行为突然变形。
 */
export function fileCardKindOf(pathOrUrl: string): FileCardKind | null {
  if (!isExternalAbsPath(pathOrUrl)) return null
  return KIND_BY_EXT[extOfPath(pathOrUrl)] ?? null
}

/** 整行只有一个链接时解析出的两半 */
export type SingleLinkLine = { label: string; target: string }

/**
 * 「整行只有一个 Markdown 链接」→ `{ label, target }`；否则 null。
 *
 * 只认纯链接行（允许两侧空白）—— **不支持**列表前缀（`- [a.pdf](…)`）与
 * 引用块（`> [a.pdf](…)`）：块级装饰会整行替换，吞掉列表圆点 / 引用竖线反而更糟。
 * 这条边界写进 HANDOFF，以后要支持再单独做（那时得换「只替换链接部分」的方案）。
 *
 * 目标允许两种写法：`<含 空格/括号 的路径>` 与普通的无空白串。
 */
export function parseSingleLinkLine(text: string): SingleLinkLine | null {
  const m = /^\s*\[([^\]]*)\]\(\s*(<[^>]*>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)\s*\)\s*$/.exec(
    text,
  )
  if (!m) return null
  return { label: m[1], target: m[2] }
}

/** 台账里的一条（与 `asset-relay.ts` 的 `RelayPendingItem` 对齐，只取卡片要用的两列） */
export type FileCardLedgerEntry = {
  /** 原文件绝对路径（台账 `original`） */
  original: string
  size: number
  /** 本机现在还能不能读到源文件（Rust 侧 stat 的结果） */
  exists: boolean
}

/** 归一化路径 → 条目（模块级：widget 的 `toDOM` 同步读，台账到达后靠刷新效果重算） */
let ledger = new Map<string, FileCardLedgerEntry>()

export function setFileCardLedger(entries: FileCardLedgerEntry[]): void {
  const next = new Map<string, FileCardLedgerEntry>()
  for (const it of entries) {
    const key = normalizeCardPath(it.original)
    if (key) next.set(key, { ...it, original: key })
  }
  ledger = next
}

export function fileCardLedger(): Map<string, FileCardLedgerEntry> {
  return ledger
}

/** 台账变了 ⇒ 让已挂载的编辑器重算块装饰（StateField 的 update 里认这个效果） */
export const fileCardRefresh = StateEffect.define<null>()

/** 卡片要显示的东西（纯函数产物，单测直接断言） */
export type FileCardModel = {
  /** 链接标签（不是 URL 时用它做文件名） */
  name: string
  /** 规范化后的目标路径（点击「打开」时交给宿主，原样不丢） */
  target: string
  /** 小写扩展名（`pdf`）；空串表示没有扩展名 */
  ext: string
  kind: FileCardKind
  icon: string
  /** 台账里的字节数；台账没有这条 ⇒ null（不猜） */
  size: number | null
  /** 台账明确说「本机读不到源文件」⇒ true；台账没这条 ⇒ false（不知道就不报警） */
  missing: boolean
  /** 卡片的 title 提示（完整路径 + 状态） */
  hint: string
}

/**
 * 链接标签 → 显示名。
 *
 * 插附件时正文写的是 `[文件名](路径)`；但用户手写时可能写成 `[https://…](路径)`
 * 或干脆留空。这两种都退回「路径里的文件名」—— 标签是 URL 时直接显示它比显示路径更没用。
 */
function displayNameOf(label: string, target: string): string {
  const clean = label.trim()
  if (clean && !/^[a-z][a-z0-9+.-]*:\/\//i.test(clean)) return clean
  const base = normalizeCardPath(target).split('/').pop() ?? ''
  return base || '附件'
}

/**
 * 一行链接 → 卡片模型；`null` = 这一行不该变成卡片。
 *
 * `entries` 不给时用模块级台账（编辑器里走这条路；单测可以显式传，避免共享状态）。
 */
export function fileCardModelOf(
  label: string,
  target: string,
  entries: Map<string, FileCardLedgerEntry> = ledger,
): FileCardModel | null {
  const kind = fileCardKindOf(target)
  if (!kind) return null
  const path = normalizeCardPath(target)
  const entry = entries.get(path)
  const missing = entry ? !entry.exists : false
  const size = entry && Number.isFinite(entry.size) ? entry.size : null
  const parts = [path]
  if (size !== null) parts.push(formatSize(size))
  if (missing) parts.push('源文件不在本机')
  return {
    name: displayNameOf(label, target),
    target: path,
    ext: extOfPath(target),
    kind,
    icon: ICON_BY_KIND[kind],
    size,
    missing,
    hint: parts.join(' · '),
  }
}

/** 卡片副标题：`PDF · 2.3 MB`（没有扩展名 / 大小时只留有的那半） */
export function fileCardSubtitle(model: FileCardModel): string {
  const bits: string[] = []
  if (model.ext) bits.push(model.ext.toUpperCase())
  if (model.size !== null) bits.push(formatSize(model.size))
  return bits.join(' · ')
}
