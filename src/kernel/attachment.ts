/**
 * **附件分流**（rev173.232 · 附件同步期 1）。
 *
 * 规则（`docs/附件与同步-需求-2026-10-28.md` §1/§2）：
 * - **≤ 1 MiB** ⇒ 复制到笔记同目录，正文写库内相对路径（老行为）；
 * - **> 1 MiB** ⇒ **不复制原图**，文件身份记进 `<库>/.zn-assets/manifest.json`；
 *   图片另生成一张 **≤1 MiB 的预览图**入库，**正文写预览图**（2026-11-04 定稿）——
 *   正文里显示的始终是小图，点开时才按台账找回原图（本机有就直接看，没有就问要不要同步）。
 *
 * 判定在 Rust 侧（`import_attachment` 读真实文件大小 + 真解码），这里只消费结果：
 * 前端**不**用字节长度猜 —— 剪贴板图片没有原文件路径，永远走复制。
 */
export const ATTACHMENT_COPY_LIMIT = 1024 * 1024

export type AttachmentOutcome = {
  /** `copied` = 复制进库；`referenced` = 只引用原文件（> 1 MiB，原图没进库） */
  mode: 'copied' | 'referenced'
  /** 笔记里该写的路径：`copied` ⇒ 原件；`referenced` ⇒ 图片的预览图 / 其它附件的绝对路径 */
  path: string
  /** 原图（或原件）的字节数 —— `referenced` 时是**原图**大小，不是预览图的 */
  size: number
  /** 引用台账条目 id（`sha256:<hex>`）；复制型为 null */
  ledgerId: string | null
  /** 原图绝对路径（`referenced` 必有）—— 点开 / 同步时按它找回原图 */
  original?: string
  /** > 1 MiB 图片的**预览图**库内相对路径（= `path`；其它情况缺省） */
  preview?: string | null
  /**
   * 降级说明（例如「预览图生成失败，正文已引用原文件」）。
   * 出现它就意味着「插入成功了，但没按本意走」—— 界面必须说清楚，不静默降级。
   */
  note?: string
}

/** 给人看的说明：插了预览图 / 引用了原文件 / 都没发生（null） */
export function attachmentHint(outcome: AttachmentOutcome): string | null {
  const parts: string[] = []
  if (outcome.preview) {
    parts.push(
      `已插入预览图（原图 ${formatSize(outcome.size)} 未复制，点开可查看 / 同步）`,
    )
  } else if (outcome.mode === 'referenced') {
    parts.push(`已引用原文件（${formatSize(outcome.size)}，超过 1 MiB 不复制进库）`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** `800 KB` / `2.3 MB` —— 附件提示用（阈值口径是 1 MiB，所以按 1024 进位） */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  // rev173.350（真人测试11 #3）：< 1 KB 要显示真实字节数 —— 原来直接
  // `Math.round(bytes / 1024)`，500 字节的短笔记会显示成 **0 KB**，看着像「没读到大小」。
  if (bytes < 1024) return `${bytes} B`
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
