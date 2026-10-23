/**
 * frontmatter 行数识别（rev173.98 · 用户「frontmatter 隐藏」）。
 *
 * 只测判据：哪种开头算 frontmatter、算几行、哪些情况**不藏**（半截 frontmatter）。
 */
import { describe, expect, it } from 'vitest'
import { frontmatterLineCount } from '../src/kernel/editor-frontmatter'

describe('frontmatterLineCount', () => {
  it('标准 frontmatter：含首尾两条 ---', () => {
    const text = '---\ntags: [工作, 周报]\n---\n\n# 本周进展\n正文'
    expect(frontmatterLineCount(text)).toBe(3)
  })

  it('CRLF 也算', () => {
    expect(frontmatterLineCount('---\r\ntags: x\r\n---\r\n正文')).toBe(3)
  })

  it('多条属性 → 行数跟着变', () => {
    const text = '---\ntitle: 周报\ntags: [a, b]\ncreated: 2026-10-23\n---\n正文'
    expect(frontmatterLineCount(text)).toBe(5)
  })

  it('没有闭合 ---（正在打字）→ 不藏', () => {
    expect(frontmatterLineCount('---\ntags: [工作')).toBe(0)
  })

  it('不是整行 --- 开头 → 不是 frontmatter', () => {
    expect(frontmatterLineCount('--- 这是分割线\n正文')).toBe(0)
    expect(frontmatterLineCount('# 标题\n---\n正文')).toBe(0)
    expect(frontmatterLineCount('')).toBe(0)
  })

  it('只有一行 --- → 不藏', () => {
    expect(frontmatterLineCount('---')).toBe(0)
  })
})
