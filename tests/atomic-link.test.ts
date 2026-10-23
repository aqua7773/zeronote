/**
 * `.cm-atomic-link` 的分类（rev173.97 · 用户「取消这个标签形式，wikilink 就是 wikilink」）。
 *
 * 只测判据：哪种可见文本算「普通方括号」（要去的链接外观）、哪种要保留。
 */
import { describe, expect, it } from 'vitest'
import { isPlainBracketLink, isPlainBracketSource } from '../src/lib/atomic-link'

describe('isPlainBracketLink', () => {
  it('单方括号 —— frontmatter 的 tags 这种 —— 当普通文本', () => {
    expect(isPlainBracketLink('[工作, 周报]')).toBe(true)
    expect(isPlainBracketLink('  [x]  ')).toBe(true)
    expect(isPlainBracketLink('[a](b)')).toBe(true) // 活跃行显示源码时可能带圆括号，仍不是 wikilink
  })

  it('wikilink（双方括号）保留链接样式', () => {
    expect(isPlainBracketLink('[[标签验收-周报]]')).toBe(false)
    expect(isPlainBracketLink('[[本周进展|周报]]')).toBe(false)
    expect(isPlainBracketLink('  [[a]]  ')).toBe(false)
  })

  it('外部链接的可见文本不含方括号，保留', () => {
    expect(isPlainBracketLink('文字')).toBe(false)
    expect(isPlainBracketLink('https://example.com')).toBe(false)
    expect(isPlainBracketLink('')).toBe(false)
  })

  it('非字符串输入不炸', () => {
    expect(isPlainBracketLink(undefined as never)).toBe(false)
    expect(isPlainBracketLink(null as never)).toBe(false)
  })
})

describe('isPlainBracketSource（按源码判断，首选）', () => {
  it('frontmatter 的 `[a, b]` → 普通方括号', () => {
    expect(isPlainBracketSource('[工作, 周报]')).toBe(true)
    expect(isPlainBracketSource('  [x]  ')).toBe(true)
  })

  it('wikilink 与外部链接都保留', () => {
    expect(isPlainBracketSource('[[标签验收-周报]]')).toBe(false)
    expect(isPlainBracketSource('[[a|显示]]')).toBe(false)
    expect(isPlainBracketSource('[文字](https://x.y)')).toBe(false)
  })

  it('不带方括号的源码（普通文本 / 裸 URL）→ 不是', () => {
    expect(isPlainBracketSource('普通文字')).toBe(false)
    expect(isPlainBracketSource('https://example.com')).toBe(false)
    expect(isPlainBracketSource('')).toBe(false)
  })
})
