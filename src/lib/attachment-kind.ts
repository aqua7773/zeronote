/**
 * 附件类型推断（rev173.272 · 真人使用测试 #4「同步来的图显示出来但点开说没有」）。
 *
 * 内核 `list_notes` 给每条 `NoteMeta` 带 `kind`（Rust 侧 `is_markdown` / `is_image` /
 * `is_media_file` 判出来）。但**前端列表会落后于磁盘**：粘贴 / 同步刚写进去的文件，
 * 靠 asset 协议直读文件**渲染得出来**，点开时 `notes.find(...)` 却还没轮到它 ⇒
 * 报「库里没有这个附件」。
 *
 * 修法 = 列表没有就问磁盘；问到了还要知道按哪条路打开 ⇒ 这里按扩展名现推，
 * 口径与 Rust 完全一致（图片 / 音视频直接复用前端已有的两份常量，不再抄第三份）。
 */

import { isImageFileName } from './insert-image'
import { isMediaFileName } from './media-render'

/**
 * 只读文档扩展名 —— 与 `src-tauri/src/lib.rs` 的 `DOC_EXTS` **同一份**。
 * `.md` / `.markdown` 不在此列：它们是笔记，走编辑器。
 */
export const DOC_EXTS = ['pdf', 'epub', 'mobi', 'azw3', 'azw', 'fb2', 'cbz', 'txt'] as const

/** 与 `NoteMeta.kind` 同集合（`src/kernel/contract.ts`） */
export type AttachmentKind = 'note' | 'image' | 'media' | 'doc'

function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** 笔记（编辑器打开的 Markdown） */
export function isNoteFileName(path: string): boolean {
  const ext = extOf(path)
  return ext === 'md' || ext === 'markdown'
}

/** 内核认的只读文档（阅读器打开） */
export function isReadonlyDocFileName(path: string): boolean {
  const ext = extOf(path)
  return (DOC_EXTS as readonly string[]).includes(ext)
}

/**
 * 按文件名推断 `kind`，与 Rust `list_notes` 的四分类一致：
 * 笔记 → 图片 → 音视频 → 其余一律 `doc`。
 */
export function kindOfPath(path: string): AttachmentKind {
  if (isNoteFileName(path)) return 'note'
  if (isImageFileName(path)) return 'image'
  if (isMediaFileName(path)) return 'media'
  return 'doc'
}
