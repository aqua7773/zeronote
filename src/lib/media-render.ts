/**
 * 正文音视频的**类型判定**（纯函数，不碰 DOM / Tauri，可单测）。
 *
 * 背景（rev173.226 · 2026-10-28 用户「音视频内联播放」）：
 *  - 笔记里 `![](clip.mp4)` 此前被 atomic 当图片渲染 ⇒ 破图；
 *  - WebView2 与 Android WebView **都是 Chromium** ⇒ 媒体容器只认 Chromium 那几种，
 *    `MKV / AVI` 是**容器**不被识别（不是编码问题），不转码就是播不了；
 *  - 所以这里把「认得出来」与「能播」分成两个集合：
 *    `VIDEO_EXTS` / `AUDIO_EXTS` 进正文内联渲染，
 *    `UNPLAYABLE_EXTS` 只进文件树（附件分组），插入时提示「请先转成 MP4 / MP3」。
 *
 * ⚠️ 与 Rust 侧 `src-tauri/src/lib.rs` 的 `MEDIA_EXTS` 是**同一份口径**（那边只用来
 * 决定「要不要进文件树、kind 填什么」，不做解码）；改这里记得同步那边。
 */

/** 可内联播放的视频容器（Chromium：MP4/H.264、WebM、MOV） */
export const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'm4v', 'ogv'] as const

/** 可内联播放的音频容器 */
export const AUDIO_EXTS = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba'] as const

/**
 * 认得出是音视频、但 **Chromium 播不了**的容器（不转码就是失败）。
 * 它们照样收进库、进文件树（用户可能只想存附件），只是不内联渲染。
 */
export const UNPLAYABLE_EXTS = [
  'mkv',
  'avi',
  'wmv',
  'flv',
  'mpg',
  'mpeg',
  'ts',
  'm2ts',
  'mts',
  '3gp',
  'wma',
  'ape',
  'aiff',
  'aif',
  'amr',
] as const

export type MediaKind = 'video' | 'audio'

/** 从路径 / URL 取扩展名：去 query 与 hash、取最后一段、转小写（无扩展名 = 空串） */
export function mediaExt(pathOrUrl: string): string {
  const bare = pathOrUrl.trim().split(/[?#]/)[0] ?? ''
  const name = bare.split(/[\\/]/).pop() ?? ''
  const dot = name.lastIndexOf('.')
  if (dot < 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

function has(ext: string, list: readonly string[]): boolean {
  return ext !== '' && list.includes(ext)
}

/**
 * 这个路径**能不能在正文里内联播放**：`video` / `audio` / `null`。
 *
 * 只认 Chromium 支持的容器 —— `clip.mkv` 返回 null（不渲染，走附件链接）。
 */
export function mediaKindOf(pathOrUrl: string): MediaKind | null {
  const ext = mediaExt(pathOrUrl)
  if (has(ext, VIDEO_EXTS)) return 'video'
  if (has(ext, AUDIO_EXTS)) return 'audio'
  return null
}

/** 是不是「音视频类附件」（含播不了的容器）—— 插入时用它决定提示、文件树用它决定分组 */
export function isMediaFileName(path: string): boolean {
  const ext = mediaExt(path)
  return has(ext, VIDEO_EXTS) || has(ext, AUDIO_EXTS) || has(ext, UNPLAYABLE_EXTS)
}

/**
 * 插入时的提示（只对**播不了**的容器给，其它返回 null）。
 *
 * 文案里点名目标格式：视频 → MP4，音频 → MP3。用户点完「插入附件」立刻知道下一步做什么，
 * 而不是在正文里看到一个点不动的链接。
 */
export function mediaHint(path: string): string | null {
  const ext = mediaExt(path)
  if (!has(ext, UNPLAYABLE_EXTS)) return null
  const target = has(ext, ['wma', 'ape', 'aiff', 'aif', 'amr']) ? 'MP3' : 'MP4'
  return `浏览器不能播放 .${ext}（容器不支持），请先转成 ${target}`
}

/**
 * 视频元素的显示上限（CSS 用）：`min(60vh, 420px)` 由 `EDITOR_CSS` 里的类控制，
 * 这里只导出类名，避免组件里散落字符串。
 */
export const MEDIA_WRAP_CLASS = 'zn-media-wrap'
export const MEDIA_ELEMENT_CLASS = 'zn-media'
