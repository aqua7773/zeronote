/**
 * **附件分流**（rev173.232 · 附件同步期 1）。
 *
 * 规则（`docs/附件与同步-需求-2026-10-28.md` §1）：
 * - **≤ 1 MiB** ⇒ 复制到笔记同目录，正文写库内相对路径（老行为）；
 * - **> 1 MiB** ⇒ **不复制**，正文写绝对路径，文件身份记进
 *   `<库>/.zn-assets/manifest.json`（引用台账，期 1 只记不搬）。
 *
 * 判定在 Rust 侧（`import_attachment` 读真实文件大小），这里只消费结果：
 * 前端**不**用字节长度猜 —— 剪贴板图片没有原文件路径，永远走复制。
 */
export const ATTACHMENT_COPY_LIMIT = 1024 * 1024

export type AttachmentOutcome = {
  /** `copied` = 复制进库；`referenced` = 只引用原文件（> 1 MiB） */
  mode: 'copied' | 'referenced'
  /** 笔记里该写的路径：`copied` ⇒ 库内相对路径；`referenced` ⇒ 绝对路径（正斜杠） */
  path: string
  size: number
  /** 引用台账条目 id（`sha256:<hex>`）；复制型为 null */
  ledgerId: string | null
}

/** > 1 MiB 被引用时给用户的说明；复制型不需要解释（返回 null） */
export function attachmentHint(outcome: AttachmentOutcome): string | null {
  if (outcome.mode !== 'referenced') return null
  return `已引用原文件（${formatSize(outcome.size)}，超过 1 MiB 不复制进库）`
}

/** `800 KB` / `2.3 MB` —— 附件提示用（阈值口径是 1 MiB，所以按 1024 进位） */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
