/**
 * **附件分流**（rev173.232 · 附件同步期 1）与**图片两模式**（rev173.234 · 期 2）。
 *
 * 规则（`docs/附件与同步-需求-2026-10-28.md` §1/§2）：
 * - **≤ 1 MiB** ⇒ 复制到笔记同目录，正文写库内相对路径（老行为）；
 * - **> 1 MiB** ⇒ **不复制**，正文写绝对路径，文件身份记进
 *   `<库>/.zn-assets/manifest.json`（引用台账，期 1 只记不搬）；
 * - **图片**多两条路（由设置里的「图片插入模式」决定）：
 *   - `original`（默认 · 模式 A）：≤1 MiB 复制原图；>1 MiB 引用原图 + 生成预览图入库；
 *   - `compress`（模式 B）：一律压到 ≤1 MiB 再入库，正文与点开默认都是压缩版。
 *
 * 判定在 Rust 侧（`import_attachment` 读真实文件大小 + 真解码），这里只消费结果：
 * 前端**不**用字节长度猜 —— 剪贴板图片没有原文件路径，永远走复制。
 */
export const ATTACHMENT_COPY_LIMIT = 1024 * 1024

/**
 * 图片插入模式（设置项 `zeronote.imageMode`）。
 * - `original` = A：引入原图（大图只引用 + 出预览图）
 * - `compress` = B：压到 1 MiB 以下入库
 */
export type ImageInsertMode = 'original' | 'compress'

export const IMAGE_MODE_STORAGE_KEY = 'zeronote.imageMode'

/** 读模式设置；没存过 ⇒ `original`（需求 §2：默认 A） */
export function loadImageMode(): ImageInsertMode {
  try {
    return window.localStorage.getItem(IMAGE_MODE_STORAGE_KEY) === 'compress'
      ? 'compress'
      : 'original'
  } catch {
    return 'original'
  }
}

export type AttachmentOutcome = {
  /** `copied` = 复制进库；`referenced` = 只引用原文件（> 1 MiB） */
  mode: 'copied' | 'referenced'
  /** 笔记里该写的路径：`copied` ⇒ 库内相对路径；`referenced` ⇒ 绝对路径（正斜杠） */
  path: string
  /** 入库文件的字节数（`copied` 时是压缩后的实际大小） */
  size: number
  /** 引用台账条目 id（`sha256:<hex>`）；复制型为 null */
  ledgerId: string | null
  /** 压缩信息（只有真压过才给）；`originalSize` = 源文件字节数 */
  compressed?: { originalSize: number; format: string }
  /** 模式 A 大图的**预览图**库内相对路径（期 3 渲染用；其余情况为 null/缺省） */
  preview?: string | null
  /**
   * 降级说明（例如「压缩失败，已改为引用原文件」）。
   * 出现它就意味着「插入成功了，但没按模式本意走」—— 界面必须说清楚，不静默降级。
   */
  note?: string
}

/** 给人看的说明：压了 / 引用了 / 都没发生（null） */
export function attachmentHint(outcome: AttachmentOutcome): string | null {
  const parts: string[] = []
  if (outcome.compressed) {
    // 透明图只能无损压缩，极端情况下确实压不到 1 MiB —— 如实说，不假装达标
    const over = outcome.size > ATTACHMENT_COPY_LIMIT
    parts.push(
      `已压缩 ${formatSize(outcome.compressed.originalSize)} → ${formatSize(outcome.size)}${
        over ? '（无损图仍超过 1 MiB）' : ''
      }`,
    )
  }
  if (outcome.mode === 'referenced') {
    parts.push(`已引用原文件（${formatSize(outcome.size)}，超过 1 MiB 不复制进库）`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** `800 KB` / `2.3 MB` —— 附件提示用（阈值口径是 1 MiB，所以按 1024 进位） */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * **本地绝对路径判据**（rev173.250 · 手机走查发现三处各写一份、且都只认 Windows）。
 *
 * - 盘符：`D:/x` `D:\x`（桌面）
 * - UNC / 网络：`\\host\share` `//host/share`
 * - Unix 绝对：`/storage/emulated/0/...`（Android 的库外文件都是这个形态）
 *
 * **不认** Web URL（`https://a.com/a.pdf` 以字母开头，不匹配任何分支）与库内相对路径
 * （`附件/a.pdf`、`./x`）⇒ 卡片 / 同步入口不会被误触发。
 *
 * 卡片（`file-card.ts`）· 媒体「原文件不在本机 · 同步」（`MarkdownEditor.tsx`）·
 * 模式 B「同步原图」（`asset-relay.ts`）**共用这一份** —— 此前三份 Windows-only 判据
 * 让手机上整片能力静默失效（卡片不出现、同步入口不出现、原图路径被拼成 `root/storage/...`）。
 */
export function isLocalAbsPath(path: string): boolean {
  let raw = (path ?? '').trim()
  // 尖括号目标（`<D:/a b.pdf>`，含空格路径的 CommonMark 写法）先剥掉再判
  if (raw.length >= 2 && raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1).trim()
  if (!raw) return false
  if (raw.startsWith('\\\\')) return true
  const p = raw.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(p)) return true
  if (p.startsWith('//')) return true
  return p.startsWith('/') && p.length > 1
}

/**
 * Markdown 链接目标：含空白 / 括号 / 尖括号时用 `<...>` 包起来。
 *
 * CommonMark 的尖括号目标正是为「路径里有空格」准备的；不包的话
 * `![](D:/Music/a b.mp3)` 会被解析成「链接 + 后面的文字」，图片直接坏掉。
 */
export function mdTarget(path: string): string {
  return /[\s()<>]/.test(path) ? `<${path}>` : path
}
