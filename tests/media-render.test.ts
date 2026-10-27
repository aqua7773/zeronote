/**
 * 音视频内联播放的**类型判定**（rev173.226 · 2026-10-28 用户要求「音视频内联播放」）。
 *
 * 判据（每条都对应一个真实失败模式）：
 *  · Chromium 只认 MP4 / WebM / MOV 与 MP3 / M4A / OGG / WAV / FLAC ——
 *    `MKV` / `AVI` 是**容器**不被识别，不能当"能播"；
 *  · 扩展名要**大小写不敏感**（手机导出的 `IMG_0001.MP4`）；
 *  · URL 上的 `?t=…` / `#…` 不能算进扩展名（`clip.mp4?v=2` 仍是视频）；
 *  · 播不了的容器照样是「媒体附件」（进文件树），只是插入时要提示转格式。
 */
import { describe, expect, it } from 'vitest'
import {
  AUDIO_EXTS,
  UNPLAYABLE_EXTS,
  VIDEO_EXTS,
  isMediaFileName,
  mediaExt,
  mediaHint,
  mediaKindOf,
} from '../src/lib/media-render'

describe('mediaExt', () => {
  it('取最后一段扩展名并转小写', () => {
    expect(mediaExt('clip.mp4')).toBe('mp4')
    expect(mediaExt('子目录/IMG_0001.MP4')).toBe('mp4')
    expect(mediaExt('C:\\库\\a.M4A')).toBe('m4a')
  })

  it('URL 的 query / hash 不算扩展名', () => {
    expect(mediaExt('https://x.test/a.mp4?t=1')).toBe('mp4')
    expect(mediaExt('asset://localhost/x/clip.webm#t=2')).toBe('webm')
  })

  it('没有扩展名 / 以点结尾 ⇒ 空串', () => {
    expect(mediaExt('README')).toBe('')
    expect(mediaExt('a.')).toBe('')
    expect(mediaExt('')).toBe('')
  })
})

describe('mediaKindOf', () => {
  it('能播的视频 / 音频', () => {
    expect(mediaKindOf('clip.mp4')).toBe('video')
    expect(mediaKindOf('clip.MOV')).toBe('video')
    expect(mediaKindOf('song.mp3')).toBe('audio')
    expect(mediaKindOf('录音.m4a')).toBe('audio')
  })

  it('播不了的容器返回 null（不当内联播放）', () => {
    expect(mediaKindOf('movie.mkv')).toBeNull()
    expect(mediaKindOf('old.avi')).toBeNull()
    expect(mediaKindOf('x.wma')).toBeNull()
  })

  it('非媒体一律 null', () => {
    expect(mediaKindOf('a.md')).toBeNull()
    expect(mediaKindOf('pic.png')).toBeNull()
    expect(mediaKindOf('report.pdf')).toBeNull()
  })

  it('三个列表互不重叠（同一个扩展名只能落一类）', () => {
    const all = [...VIDEO_EXTS, ...AUDIO_EXTS, ...UNPLAYABLE_EXTS]
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('isMediaFileName', () => {
  it('能播的和播不了的都算媒体附件', () => {
    expect(isMediaFileName('clip.mp4')).toBe(true)
    expect(isMediaFileName('movie.mkv')).toBe(true)
    expect(isMediaFileName('song.flac')).toBe(true)
  })

  it('图片 / 笔记 / 文档不算', () => {
    expect(isMediaFileName('pic.png')).toBe(false)
    expect(isMediaFileName('a.md')).toBe(false)
    expect(isMediaFileName('book.epub')).toBe(false)
  })
})

describe('mediaHint', () => {
  it('播不了的视频提示转 MP4，音频提示转 MP3', () => {
    expect(mediaHint('movie.mkv')).toContain('MP4')
    expect(mediaHint('old.avi')).toContain('MP4')
    expect(mediaHint('x.wma')).toContain('MP3')
  })

  it('能播的 / 非媒体不给提示', () => {
    expect(mediaHint('clip.mp4')).toBeNull()
    expect(mediaHint('song.mp3')).toBeNull()
    expect(mediaHint('pic.png')).toBeNull()
  })
})
