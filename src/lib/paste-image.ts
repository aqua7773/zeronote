/**
 * 「编辑器粘贴图片」的纯逻辑（不碰 Tauri / 不碰 DOM），方便单测。
 *
 * 分工：
 *  - 这里只负责：从剪贴板 FileList 里挑出图片、推断扩展名、把字节转 base64；
 *  - 落盘与插入正文由宿主负责（`App` 调 `import_attachment_b64`，再走 `imageInsertion`）。
 *
 * 为什么需要 `import_attachment_b64`：剪贴板里的图片在 WebView 里只是内存里的 `File`，
 * 没有磁盘路径，`import_attachment(src)` 那类「从磁盘复制」的命令用不了。
 */

import { IMAGE_EXTS } from './insert-image'

/** 单张粘贴图片的大小上限（超过就提示、不写盘；Rust 侧还有 32 MB 的兜底） */
export const MAX_PASTE_IMAGE_BYTES = 10 * 1024 * 1024

/** 常见图片 MIME → 扩展名（小写、不带点） */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/x-ms-bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
}

/**
 * 从剪贴板的 `FileList` 里挑**第一张**图片；没有则返回 null。
 *
 * `files` 在部分浏览器里是空表（用户复制的只是文字），所以调用方必须
 * 「拿到 null 就放行默认粘贴」，否则会把从网页 / Excel 复制的文字吞掉。
 */
export function pickPastedImage(files: FileList | null | undefined): File | null {
  if (!files || files.length === 0) return null
  for (let i = 0; i < files.length; i += 1) {
    const f = files[i]
    if (f && typeof f.type === 'string' && f.type.toLowerCase().startsWith('image/')) return f
  }
  return null
}

/**
 * 图片扩展名（小写、无点）。
 *
 * 优先看 MIME（剪贴板截图基本都是 `image/png`）；认不出来再看文件名后缀；
 * 都认不出、或后缀不在图片白名单里就按 `png`（截图的事实标准）。
 * Rust 侧 `import_attachment_b64` 还会再校验一次扩展名。
 */
export function pasteImageExt(file: { name?: string; type?: string }): string {
  const mime = (file.type ?? '').toLowerCase()
  if (MIME_EXT[mime]) return MIME_EXT[mime]
  const name = file.name ?? ''
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (/^[a-z0-9]{1,8}$/.test(ext) && (IMAGE_EXTS as readonly string[]).includes(ext)) return ext
  return 'png'
}

/**
 * `Uint8Array` → base64。
 *
 * 分块的原因：`String.fromCharCode(...bytes)` 一次展开几十万个参数会爆栈
 * （普通网页截图 1–3 MB，直接展开必崩）。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
