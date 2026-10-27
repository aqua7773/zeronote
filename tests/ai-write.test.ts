import { describe, expect, it } from 'vitest'
import { applyTags, buildDiff, diffText, normRel, notePathOf } from '../examples/ai/index.js'

/**
 * 写工具（rev173.199）的纯函数。
 *
 * 这三组的共同点：**错了都看不出来**。
 * · 路径归一化漏一条 `..` ⇒ AI 能写到库外（或写进 `.zn`）；
 * · diff 算错 ⇒ 用户点「采用」时看到的是干净的预览，落盘的却是别的内容；
 * · 标签增删改写错 ⇒ frontmatter 被写成半截，笔记在标签面板里消失。
 */
describe('normRel / notePathOf', () => {
  it('反斜杠归一、去多余斜杠', () => {
    expect(normRel('工作\\周报.md')).toBe('工作/周报.md')
    expect(normRel('/工作//周报.md/')).toBe('工作/周报.md')
    expect(normRel(' 工作/周报.md ')).toBe('工作/周报.md')
  })

  it('拒绝越界与隐藏路径', () => {
    expect(normRel('')).toBe('')
    expect(normRel('   ')).toBe('')
    expect(normRel('../外面.md')).toBe('')
    expect(normRel('工作/../../外面.md')).toBe('')
    expect(normRel('.zn/plugins/x/index.js')).toBe('')
    expect(normRel('工作/.hidden.md')).toBe('')
  })

  it('笔记路径补 .md，已有后缀不动', () => {
    expect(notePathOf('工作/周报')).toBe('工作/周报.md')
    expect(notePathOf('工作/周报.md')).toBe('工作/周报.md')
    expect(notePathOf('工作/周报.MD')).toBe('工作/周报.MD')
    expect(notePathOf('')).toBe('')
    expect(notePathOf('../x')).toBe('')
  })
})

describe('buildDiff', () => {
  it('相同内容没有增删', () => {
    const d = buildDiff('a\nb\n', 'a\nb\n')
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
    expect(d.lines.every((l) => l.type === 'same')).toBe(true)
  })

  it('替换中间一行：只记一加一删', () => {
    const d = buildDiff('第一行\n第二行\n第三行\n', '第一行\n改过的二行\n第三行\n')
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    // 公共前后缀必须保留成 same（含末尾换行切出的那个空行）——
    // 否则步骤摘要会把整篇都算成改动
    expect(d.lines.filter((l) => l.type === 'same')).toHaveLength(3)
    expect(d.lines.find((l) => l.type === 'del')?.text).toBe('第二行')
    expect(d.lines.find((l) => l.type === 'add')?.text).toBe('改过的二行')
  })

  it('新增一行', () => {
    const d = buildDiff('a\nc\n', 'a\nb\nc\n')
    expect(d.added).toBe(1)
    expect(d.removed).toBe(0)
  })

  it('空文件到有内容 = 全加', () => {
    // 末尾换行会切出一个空行，所以 "x\ny\n" 是 3 行（精确 diff 不吞末尾换行）
    const d = buildDiff('', 'x\ny\n')
    expect(d.removed).toBe(0)
    expect(d.added).toBe(3)
    expect(buildDiff('', 'x\ny').added).toBe(2)
  })

  it('CRLF 与 LF 视为同一份内容（不制造整篇 diff）', () => {
    const d = buildDiff('a\r\nb\r\n', 'a\nb\n')
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
  })

  it('同一段内删除与新增都记录', () => {
    const d = buildDiff('a\nb\nc\nd\n', 'a\nc\nx\nd\n')
    expect(d.removed).toBe(1)
    expect(d.added).toBe(1)
  })

  it('超过行数上限时 tooLong，不假装"没改动"', () => {
    const big = Array.from({ length: 2100 }, (_, i) => `l${i}`).join('\n')
    const d = buildDiff(big, `${big}\nnew`)
    expect(d.tooLong).toBe(true)
    expect(d.lines).toEqual([])
    expect(d.oldLines).toBe(2100)
    expect(d.newLines).toBe(2101)
  })
})

describe('diffText', () => {
  it('+/−/空格前缀', () => {
    const t = diffText(buildDiff('a\nb\n', 'a\nc\n'))
    expect(t).toContain('- b')
    expect(t).toContain('+ c')
    expect(t.split('\n')[0]).toBe('  a')
  })

  it('超长时截断并说明剩下多少行', () => {
    const big = Array.from({ length: 300 }, (_, i) => `l${i}`).join('\n')
    const t = diffText(buildDiff('', big), 10)
    expect(t.split('\n')).toHaveLength(11) // 10 行 + 一行提示
    expect(t).toContain('还有 290 行没有显示')
  })

  it('空 diff 返回空串', () => {
    expect(diffText(buildDiff('a', 'a'))).toBe('  a')
    expect(diffText(null as unknown as object)).toBe('')
  })
})

describe('applyTags（add）', () => {
  it('没有 frontmatter ⇒ 建一段', () => {
    const r = applyTags('# 标题\n\n正文\n', ['工作', '周报'], 'add')
    expect(r.changed).toBe(true)
    expect(r.text.startsWith('---\ntags: [工作, 周报]\n---\n\n# 标题')).toBe(true)
    expect(r.tags).toEqual(['工作', '周报'])
  })

  it('行内数组写法：追加并保持行内格式', () => {
    const src = '---\ntags: [工作]\ntitle: x\n---\n正文'
    const r = applyTags(src, ['周报'], 'add')
    expect(r.text).toContain('tags: [工作, 周报]')
    expect(r.text).toContain('title: x')
    expect(r.changed).toBe(true)
  })

  it('多行列表写法：追加成新的 "- 项"', () => {
    const src = '---\ntags:\n  - 工作\n  - 周报\ntitle: x\n---\n正文'
    const r = applyTags(src, ['会议'], 'add')
    expect(r.text).toContain('tags:\n  - 工作\n  - 周报\n  - 会议')
    expect(r.text).toContain('title: x')
  })

  it('单行逗号写法：保持逗号', () => {
    const r = applyTags('---\ntags: 工作, 周报\n---\n正文', ['会议'], 'add')
    expect(r.text).toContain('tags: 工作, 周报, 会议')
  })

  it('有 frontmatter 但没有 tags 行 ⇒ 追加一行', () => {
    const r = applyTags('---\ntitle: x\n---\n正文', ['工作'], 'add')
    expect(r.text).toContain('title: x\ntags: [工作]')
  })

  it('已经有这个标签 ⇒ 不改变、不写盘', () => {
    const src = '---\ntags: [工作]\n---\n正文'
    const r = applyTags(src, ['工作'], 'add')
    expect(r.changed).toBe(false)
    expect(r.text).toBe(src)
  })

  it('大小写不同视为同一个标签（与内核 toLowerCase 比较一致）', () => {
    const r = applyTags('---\ntags: [Work]\n---\n正文', ['work'], 'add')
    expect(r.changed).toBe(false)
  })

  it('空标签被忽略（不会写出 "tags: []" 这种噪音）', () => {
    const src = '# 正文\n'
    const r = applyTags(src, ['', '  ', '#'], 'add')
    expect(r.changed).toBe(false)
    expect(r.text).toBe(src)
  })

  it('标签前的 # 被剥掉', () => {
    const r = applyTags('# 正文', ['#工作'], 'add')
    expect(r.text).toContain('tags: [工作]')
  })

  it('CRLF 文件保持 CRLF', () => {
    const r = applyTags('---\r\ntags: [a]\r\n---\r\n正文\r\n', ['b'], 'add')
    expect(r.text).toContain('tags: [a, b]\r\n')
    expect(r.text.includes('\n---\r\n')).toBe(true)
  })
})

describe('applyTags（remove）', () => {
  it('删掉一个标签，其它保留', () => {
    const r = applyTags('---\ntags: [工作, 周报, 会议]\n---\n正文', ['周报'], 'remove')
    expect(r.changed).toBe(true)
    expect(r.removed).toEqual(['周报'])
    expect(r.text).toContain('tags: [工作, 会议]')
  })

  it('删到空 ⇒ 整行去掉（不留 tags: []）', () => {
    const r = applyTags('---\ntags: [工作]\ntitle: x\n---\n正文', ['工作'], 'remove')
    expect(r.text).not.toContain('tags:')
    expect(r.text).toContain('title: x')
  })

  it('多行写法删到空 ⇒ 整段去掉', () => {
    const r = applyTags('---\ntags:\n  - 工作\ntitle: x\n---\n正文', ['工作'], 'remove')
    expect(r.text).not.toContain('- 工作')
    expect(r.text).toContain('title: x')
  })

  it('要删的本来就没有 ⇒ 不改变', () => {
    const src = '---\ntags: [工作]\n---\n正文'
    expect(applyTags(src, ['会议'], 'remove').changed).toBe(false)
  })

  it('正文里还有 #标签 ⇒ stillInBody 报出来（否则是静默失效）', () => {
    const r = applyTags('---\ntags: [工作]\n---\n今天 #工作 很忙', ['工作'], 'remove')
    expect(r.changed).toBe(true)
    expect(r.stillInBody).toEqual(['工作'])
  })

  it('正文里没有引用 ⇒ stillInBody 为空', () => {
    const r = applyTags('---\ntags: [工作]\n---\n今天很忙', ['工作'], 'remove')
    expect(r.stillInBody).toEqual([])
  })

  it('没有 frontmatter 时只在正文里找（不凭空建文件头）', () => {
    const src = '今天 #工作 很忙\n'
    const r = applyTags(src, ['工作'], 'remove')
    expect(r.changed).toBe(false)
    expect(r.text).toBe(src)
    expect(r.stillInBody).toEqual(['工作'])
  })
})
