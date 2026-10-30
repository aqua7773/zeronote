/**
 * 附件类型推断（rev173.272 · 真人使用测试 #4）。
 *
 * 锁两件事：
 *   1. 四分类口径与 Rust `list_notes` 一致（笔记 / 图片 / 音视频 / 其余只读文档）；
 *   2. 大小写、多级路径、带点文件名都不出错 —— 前端拿到的都是库内相对路径。
 */
import { describe, expect, it } from 'vitest'
import { DOC_EXTS, isNoteFileName, isReadonlyDocFileName, kindOfPath } from '../src/lib/attachment-kind'

describe('kindOfPath（与 Rust list_notes 同一口径）', () => {
  it('Markdown 是笔记', () => {
    expect(kindOfPath('笔记.md')).toBe('note')
    expect(kindOfPath('a/b/笔记.markdown')).toBe('note')
    expect(kindOfPath('笔记.MD')).toBe('note')
  })

  it('图片走 image（大小写不敏感）', () => {
    expect(kindOfPath('附件/图.PNG')).toBe('image')
    expect(kindOfPath('a.jpeg')).toBe('image')
    expect(kindOfPath('x/y/照片.webp')).toBe('image')
  })

  it('音视频走 media', () => {
    expect(kindOfPath('附件/clip.mp4')).toBe('media')
    expect(kindOfPath('语音.m4a')).toBe('media')
  })

  it('其余一律 doc', () => {
    expect(kindOfPath('手册.pdf')).toBe('doc')
    expect(kindOfPath('a/b/书.epub')).toBe('doc')
    expect(kindOfPath('附件/说明.vtt')).toBe('doc')
  })

  it('没有扩展名 / 点开头的文件名不会误判成笔记或文档', () => {
    expect(kindOfPath('README')).toBe('doc')
    expect(kindOfPath('.gitignore')).toBe('doc')
    expect(isNoteFileName('笔记.txt')).toBe(false)
  })

  it('DOC_EXTS 与 Rust 的八种一致', () => {
    expect([...DOC_EXTS]).toEqual(['pdf', 'epub', 'mobi', 'azw3', 'azw', 'fb2', 'cbz', 'txt'])
    expect(isReadonlyDocFileName('a.AZW3')).toBe(true)
    expect(isReadonlyDocFileName('a.md')).toBe(false)
  })
})
