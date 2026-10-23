/**
 * `.cm-atomic-link` 的分类（rev173.97 · 用户「取消这个标签形式，wikilink 就是 wikilink」）。
 *
 * 只测判据：哪种可见文本算「普通方括号」（要去的链接外观）、哪种要保留。
 */
import { describe, expect, it } from 'vitest'
import { isPlainBracketLink, isPlainBracketSource, wikiLinkTarget } from '../src/lib/atomic-link'

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

/**
 * 点击判据（rev173.98「链接无法跳转」）。
 *
 * rev173.97 用可见文本 `^\[\[…\]\]$` 判 wikilink，但 atomic 的可见文本里
 * **没有稳定的双方括号**：活跃行是 widget（只剩目标名），普通行是隐藏 span
 * （变成 `[目标]`）。两种形态都要认，否则一半点击被丢弃。
 */
describe('wikiLinkTarget（点击判据）', () => {
  const line = '这里引用另一篇：[[标签验收-周报]]'

  it('两种可见文本形态都认（活跃行 / 普通行）', () => {
    expect(wikiLinkTarget(line, '标签验收-周报')).toBe('标签验收-周报')
    expect(wikiLinkTarget(line, '[标签验收-周报]')).toBe('标签验收-周报')
  })

  it('别名写法返回整段目标（`|` 由 openWikiLink 再切）', () => {
    const aliasLine = '[[本周进展|周报]] 与 [[导图验收]]'
    expect(wikiLinkTarget(aliasLine, '本周进展|周报')).toBe('本周进展|周报')
    expect(wikiLinkTarget(aliasLine, '[本周进展|周报]')).toBe('本周进展|周报')
  })

  it('同一行的第二个 wikilink 也认得', () => {
    const two = '[[本周进展|周报]] 与 [[导图验收]]'
    expect(wikiLinkTarget(two, '导图验收')).toBe('导图验收')
    expect(wikiLinkTarget(two, '[导图验收]')).toBe('导图验收')
  })

  it('普通方括号 / 外链 / 纯文本 → null', () => {
    expect(wikiLinkTarget('tags: [工作, 周报]', '工作, 周报')).toBeNull()
    expect(wikiLinkTarget('tags: [工作, 周报]', '[工作, 周报]')).toBeNull()
    expect(wikiLinkTarget('[文字](https://x.y)', '文字')).toBeNull()
    expect(wikiLinkTarget('普通文字', '普通文字')).toBeNull()
  })

  it('空输入不炸', () => {
    expect(wikiLinkTarget('', '')).toBeNull()
    expect(wikiLinkTarget('[[a]]', '')).toBeNull()
    expect(wikiLinkTarget(undefined as never, 'a')).toBeNull()
  })
})
