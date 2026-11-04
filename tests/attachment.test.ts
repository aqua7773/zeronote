// @vitest-environment happy-dom
/**
 * 附件分流（rev173.232 · 附件同步期 1）的纯函数：
 *  · 阈值口径必须是 1 MiB = 1,048,576（需求 §6）
 *  · >1 MiB 的图片：正文里是**预览图**，提示要说清「原图没进来、点开可取」
 *  · >1 MiB 的其它附件：引用原文件，提示「不复制进库」
 *  · 含空格 / 括号的绝对路径必须用 `<...>` 包起来，否则 Markdown 目标会被截断
 */
import { describe, expect, it } from 'vitest'
import {
  ATTACHMENT_COPY_LIMIT,
  attachmentHint,
  formatSize,
  mdTarget,
  type AttachmentOutcome,
} from '../src/kernel/attachment'

describe('附件分流阈值', () => {
  it('阈值就是 1 MiB（与系统文件属性同口径）', () => {
    expect(ATTACHMENT_COPY_LIMIT).toBe(1024 * 1024)
    expect(ATTACHMENT_COPY_LIMIT).toBe(1_048_576)
  })

  it('复制型不额外解释', () => {
    const copied: AttachmentOutcome = {
      mode: 'copied',
      path: 'sub/a.png',
      size: 800 * 1024,
      ledgerId: null,
    }
    expect(attachmentHint(copied)).toBeNull()
  })

  it('非图片的引用型说明「不复制进库」', () => {
    const referenced: AttachmentOutcome = {
      mode: 'referenced',
      path: 'D:/Music/a.mp3',
      size: 2 * 1024 * 1024,
      ledgerId: 'sha256:abc',
      original: 'D:/Music/a.mp3',
    }
    const hint = attachmentHint(referenced)
    expect(hint).toContain('已引用原文件')
    expect(hint).toContain('不复制进库')
    expect(hint).toContain('2.0 MB')
  })
})

describe('formatSize', () => {
  it('按 1024 进位，边界不出现 NaN / 负数', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(800 * 1024)).toBe('800 KB')
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatSize(2.5 * 1024 * 1024)).toBe('2.5 MB')
    expect(formatSize(Number.NaN)).toBe('0 B')
  })
})

describe('mdTarget', () => {
  it('普通路径原样返回', () => {
    expect(mdTarget('sub/a.png')).toBe('sub/a.png')
    expect(mdTarget('D:/Music/a.mp3')).toBe('D:/Music/a.mp3')
  })

  it('含空白 / 括号 / 尖括号的路径包进 <>', () => {
    expect(mdTarget('D:/Music/专辑 1/a b.mp3')).toBe('<D:/Music/专辑 1/a b.mp3>')
    expect(mdTarget('D:/x/(live).mp4')).toBe('<D:/x/(live).mp4>')
  })
})

describe('大图 = 预览图 + 原图引用（2026-11-04 定稿）', () => {
  it('正文写预览图时，提示点明「原图多大、没进来、点开可取」', () => {
    const outcome: AttachmentOutcome = {
      mode: 'referenced',
      path: 'notes/image-x-preview.jpg',
      size: 10 * 1024 * 1024,
      ledgerId: 'sha256:abc',
      original: 'D:/Pictures/big.png',
      preview: 'notes/image-x-preview.jpg',
    }
    const hint = attachmentHint(outcome)
    expect(hint).toContain('已插入预览图')
    expect(hint).toContain('10.0 MB')
    expect(hint).toContain('点开可查看')
    // 不能说「已引用原文件」—— 正文里确实是预览图
    expect(hint).not.toContain('已引用原文件')
  })

  it('预览图生成失败退回绝对路径时，要说回「已引用原文件」', () => {
    const fallback: AttachmentOutcome = {
      mode: 'referenced',
      path: 'D:/Pictures/big.png',
      size: 12 * 1024 * 1024,
      ledgerId: 'sha256:def',
      original: 'D:/Pictures/big.png',
    }
    const hint = attachmentHint(fallback)
    expect(hint).toContain('已引用原文件')
    expect(hint).not.toContain('已插入预览图')
  })
})
