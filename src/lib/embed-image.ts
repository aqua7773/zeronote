/**
 * **导出时内嵌的图片**（rev173.278 · 真人使用测试 #20）。
 *
 * 导出插件的「导出为 Markdown（图片内嵌）」把正文里的图写成
 * `![](data:image/jpeg;base64,…)<!-- zn-orig: 附件/photo.jpg -->`：
 * 别的 Markdown 应用（Typora / VSCode / 微信预览）直接看到 base64 那份，
 * 注释是给 **ZeroNote 自己**看的 —— 点图时按它找回原文件。
 *
 * 为什么注释里存「原文那条引用」而不是绝对路径：导出时正文里写的就是它，
 * 不额外编造；用户手写库外绝对路径 / 库内相对路径都能原样带出去。
 * 这里的两个纯函数是**读的那一半**（写的那一半在 `examples/import-export`）。
 */
/** 盘符（`C:\x` / `C:/x`）与 UNC（`\\host\share`）—— 与内核 `insert-image` 同一份判据 */
const WIN_ABS_RE = /^(?:[a-zA-Z]:[\\/]|\\\\)/

/** 紧跟内嵌图的元数据注释（`-->` 之前的内容原样取出） */
export const ZN_ORIG_RE = /<!--\s*zn-orig:\s*([\s\S]*?)\s*-->/

/**
 * 内嵌图的 `zn-orig` 是**库外绝对路径**吗？
 *
 * ⚠️ 不能直接用 `isLocalAbsPath`：它把 `/x.png` 也算绝对（那是对的 —— Android 的库外
 * 文件全是 `/storage/...`），但**桌面上 `/x.png` 是「相对库根」的写法**（与内核
 * `resolveImageAbsPath` 同一口径）。两种含义只能靠平台分。
 */
export function isEmbeddedOrigAbs(
  orig: string,
  platform?: 'android' | 'windows' | 'other' | null,
): boolean {
  const raw = String(orig ?? '').trim()
  if (!raw) return false
  if (WIN_ABS_RE.test(raw)) return true
  return platform === 'android' && raw.startsWith('/')
}

/**
 * 从一段源码里读 `zn-orig`（`null` = 这段没有注释）。
 *
 * 调用方一般只给**图片 widget 之后的一小段**，不整篇扫：
 * 一篇导出稿里可能有很多张内嵌图，整篇 `match` 只会拿到第一张的。
 */
export function parseZnOrig(text: string): string | null {
  const m = /<!--\s*zn-orig:\s*([\s\S]*?)\s*-->/.exec(String(text ?? ''))
  const raw = m ? m[1].trim() : ''
  return raw || null
}

/**
 * 文档里所有「内嵌图 + 注释」的配对：`![](data:…)<!-- zn-orig: X -->` → `{ dataUrl → X }`。
 *
 * **为什么不能让编辑器按位置找注释**（第一版写法，实测错位）：`posAtDOM` 对 block widget
 * 返回的偏移并不总是 widget 的起点，实测会落到**下一条**注释之前 ⇒ 每张图都绑定到后一张的
 * 原文件（1096×709 的图配上了 512×512 的路径）。
 *
 * 改成**按 URL 配对**：文档里图片语法中的 URL 与 DOM 里 `<img src>` 是同一串 base64，
 * 精确、与虚拟化无关，也不会把用户自己贴的无注释 data 图算进来。
 */
export const ZN_EMBED_PAIR_RE = /!\[[^\]]*\]\(([^)]+)\)\s*<!--\s*zn-orig:\s*([\s\S]*?)\s*-->/g

/** 整篇扫一遍，返回 `dataUrl → 原引用`（没有注释的 data 图不在表里） */
export function collectEmbeddedOrigins(md: string): Map<string, string> {
  const text = String(md ?? '')
  const out = new Map<string, string>()
  if (!text.includes('zn-orig')) return out
  ZN_EMBED_PAIR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ZN_EMBED_PAIR_RE.exec(text)) !== null) {
    const src = m[1].trim()
    const orig = m[2].trim()
    if (src && orig) out.set(src, orig)
  }
  return out
}

/**
 * 原引用 → **库内相对路径**候选（按优先级）。库外绝对路径不在这里处理（返回空数组，
 * 调用方直接预览）；库内相对路径依次按：
 *
 * ① **当前打开的笔记目录**（导出时正文里写的就是相对那篇笔记的路径，最常见）；
 * ② **库根**（早期 / 手写的 `/附件/a.png`、或导出稿被搬走后仍在同一库）。
 *
 * 为什么给候选而不是一步解析对：导出的 `.md` 可能已经被导入到库内别的位置，
 * 那时「相对当前笔记」就错了 —— 但两个都试成本极低，且只有一个是真存在的。
 */
export function znOrigCandidates(
  orig: string,
  notePath: string | null | undefined,
  platform?: 'android' | 'windows' | 'other' | null,
): string[] {
  const raw = String(orig ?? '').trim()
  if (!raw || isEmbeddedOrigAbs(raw, platform)) return []
  // 桌面的 `/附件/a.png` = 相对库根，不该再拼笔记目录
  if (raw.startsWith('/')) {
    const rooted = raw.replace(/^\/+/, '')
    return rooted ? [rooted] : []
  }
  const noteDir =
    notePath && notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  const out: string[] = []
  if (noteDir) out.push(`${noteDir}/${raw}`.replace(/\/+/g, '/'))
  if (!out.includes(raw)) out.push(raw)
  return out
}
