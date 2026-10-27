/**
 * `[[x]]` 悬浮预览的纯逻辑（rev173.228 · 需求 §4.5）。
 *
 * 判据（每条对应一个真实失败模式）：
 *  · 匹配顺序必须与**点击跳转**一致 —— 否则「点开 A、预览 B」，用户会以为链接坏了；
 *  · `[[目标|别名]]` 只认 `|` 前面的目标（别名是显示名）；
 *  · `[[今天]]` 要能命中 `日记/今天.md`（路径后缀）—— 库内同名时按含路径的写法区分；
 *  · 摘要不能把 frontmatter / 代码块 / 图片语法原样吐出来（否则预览像没渲染的源码）。
 */
import { describe, expect, it } from 'vitest'
import { findWikiNote, previewSnippet, wikiTarget } from '../src/lib/wiki-preview'

const notes = [
  { id: 'id-a', path: '工作/周报.md', title: '周报' },
  { id: 'id-b', path: '日记/2026-10-28.md', title: '今天' },
  { id: 'id-c', path: '根笔记.md', title: '根笔记' },
]

describe('wikiTarget', () => {
  it('目标 | 别名 → 目标', () => {
    expect(wikiTarget('本周进展|周报')).toBe('本周进展')
    expect(wikiTarget(' 周报 ')).toBe('周报')
  })

  it('空值 / 只有别名 → 空串', () => {
    expect(wikiTarget('')).toBe('')
    expect(wikiTarget('|别名')).toBe('')
    expect(wikiTarget(null as unknown as string)).toBe('')
  })
})

describe('findWikiNote', () => {
  it('按 id / 路径 / 路径后缀 / 标题依次命中', () => {
    expect(findWikiNote(notes, 'id-b')?.path).toBe('日记/2026-10-28.md')
    expect(findWikiNote(notes, '工作/周报')?.path).toBe('工作/周报.md')
    expect(findWikiNote(notes, '工作/周报.md')?.path).toBe('工作/周报.md')
    expect(findWikiNote(notes, '今天')?.path).toBe('日记/2026-10-28.md')
    expect(findWikiNote(notes, '2026-10-28')?.path).toBe('日记/2026-10-28.md')
  })

  it('别名不影响查找（`[[目标|显示名]]` 只认 | 前面的目标）', () => {
    expect(findWikiNote(notes, '周报|本周进展')?.path).toBe('工作/周报.md')
    // 反过来写（显示名在前）就是「目标不存在」—— 语义固定，不做兜底猜测
    expect(findWikiNote(notes, '本周进展|周报')).toBeNull()
  })

  it('反斜杠路径（Windows 习惯）也能命中', () => {
    expect(findWikiNote(notes, '工作\\周报')?.path).toBe('工作/周报.md')
  })

  it('找不到 → null；空目标 → null', () => {
    expect(findWikiNote(notes, '不存在的笔记')).toBeNull()
    expect(findWikiNote(notes, '')).toBeNull()
    expect(findWikiNote(notes, '|只给别名')).toBeNull()
  })

  it('id 优先于同名标题（ID 是稳定身份）', () => {
    const dupe = [
      { id: 'id-x', path: 'a.md', title: '同名' },
      { id: 'id-y', path: 'b.md', title: '同名' },
    ]
    expect(findWikiNote(dupe, 'id-y')?.path).toBe('b.md')
    expect(findWikiNote(dupe, '同名')?.path).toBe('a.md')
  })
})

describe('previewSnippet', () => {
  it('剥 frontmatter / 标题符号 / 强调 / 链接，只留可读正文', () => {
    const md = ['---', 'tags: [工作]', '---', '# 周报', '', '本周 **完成** [音视频](x.mp4) 内联播放。'].join('\n')
    expect(previewSnippet(md)).toBe('周报 本周 完成 音视频 内联播放。')
  })

  it('代码块与图片整段丢掉', () => {
    const md = '前文\n\n```js\nconsole.log(1)\n```\n\n![](pic.png)\n\n后文'
    expect(previewSnippet(md)).toBe('前文 后文')
  })

  it('wikilink 只留显示名', () => {
    expect(previewSnippet('见 [[周报|本周进展]] 与 [[根笔记]]')).toBe('见 本周进展 与 根笔记')
  })

  it('超过 max 截断加省略号', () => {
    const out = previewSnippet('一'.repeat(50), 10)
    expect(out).toBe(`${'一'.repeat(10)}…`)
  })

  it('空内容 → 空串', () => {
    expect(previewSnippet('')).toBe('')
    expect(previewSnippet('---\na: 1\n---\n')).toBe('')
  })
})
