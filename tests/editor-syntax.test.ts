// @vitest-environment happy-dom
/**
 * Markdown 语法增强（rev173.36）：`parseInline` 的纯函数单测。
 * 装饰器渲染不在单测范围（需要真实编辑器），这里锁「识别规则」。
 */
import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import {
  findMathBlocks,
  findMermaidBlocks,
  parseInline,
  sanitizeHtml,
} from '../src/kernel/editor-syntax'

describe('parseInline · 上标', () => {
  it('识别 ^x^ 并给出内容区间', () => {
    const hits = parseInline('x^2^ 与 a^b^')
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ kind: 'sup', innerFrom: 2, innerTo: 3 })
  })

  it('空的 ^^ 与以空白开头的 ^ x^ 不识别', () => {
    expect(parseInline('a^^b')).toHaveLength(0)
    expect(parseInline('a^ x^')).toHaveLength(0)
  })
})

describe('parseInline · 下标', () => {
  it('识别 H~2~O', () => {
    const hits = parseInline('H~2~O')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'sub', innerFrom: 2, innerTo: 3 })
  })

  it('不把 ~~删除线~~ 当成下标', () => {
    expect(parseInline('~~删除线~~')).toHaveLength(0)
  })

  it('内容里允许空格与括号（H~2 O~）', () => {
    expect(parseInline('H~2 O~')).toHaveLength(1)
  })
})

describe('parseInline · Emoji', () => {
  it('已知短码替换', () => {
    const hits = parseInline('好的 :smile: 还有 :rocket:')
    expect(hits.map((h) => (h.kind === 'emoji' ? h.ch : ''))).toEqual(['😄', '🚀'])
  })

  it('未知短码整行不命中', () => {
    expect(parseInline(':not_an_emoji:')).toHaveLength(0)
  })

  it('+1 也能识别', () => {
    const hits = parseInline(':+1:')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'emoji', ch: '👍' })
  })
})

describe('parseInline · 代码区不解析', () => {
  it('行内代码里的 ^ ~ : 原样', () => {
    expect(parseInline('`x^2^` `H~2~O` `:smile:`')).toHaveLength(0)
  })

  it('代码区外的仍识别（混合）', () => {
    const hits = parseInline('`x^2^` 和 y^3^')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'sup' })
  })
})

describe('parseInline · 行内数学', () => {
  it('识别 $a^2 + b^2 = c^2$', () => {
    const hits = parseInline('$a^2 + b^2 = c^2$')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'math', tex: 'a^2 + b^2 = c^2' })
  })

  it('$$…$$ 不算行内数学', () => {
    expect(parseInline('$$x$$')).toHaveLength(0)
  })

  it('代码里的 $ 不解析', () => {
    expect(parseInline('`$x$`')).toHaveLength(0)
  })
})

describe('findMathBlocks · 块级数学', () => {
  const docOf = (s: string) => Text.of(s.split('\n'))

  it('多行 $$ … $$ 识别为一块', () => {
    const blocks = findMathBlocks(docOf('前言\n$$\n\\int_0^1 x^2 dx\n$$\n后记'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].tex).toBe('\\int_0^1 x^2 dx')
  })

  it('单行 $$ … $$ 识别', () => {
    const blocks = findMathBlocks(docOf('$$E=mc^2$$'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].tex).toBe('E=mc^2')
  })

  it('未闭合的 $$ 不产生块', () => {
    expect(findMathBlocks(docOf('$$\nx\n'))).toHaveLength(0)
  })
})

describe('findMermaidBlocks · 图表', () => {
  const docOf = (s: string) => Text.of(s.split('\n'))

  it('识别 ```mermaid 围栏块', () => {
    const blocks = findMermaidBlocks(docOf('前言\n```mermaid\ngraph TD\nA-->B\n```\n后记'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].tex).toBe('graph TD\nA-->B')
  })

  it('未闭合的 mermaid 围栏不产生块', () => {
    expect(findMermaidBlocks(docOf('```mermaid\ngraph TD\n'))).toHaveLength(0)
  })
})

describe('parseInline · 脚注引用', () => {
  it('识别 [^1] 并带出编号', () => {
    const hits = parseInline('这是一个脚注示例[^1]。')
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ kind: 'footref', num: '1' })
  })

  it('代码里的 [^1] 不解析', () => {
    expect(parseInline('`[^1]`')).toHaveLength(0)
  })

  it('数学里的 [^1] 不产生脚注引用', () => {
    const hits = parseInline('$x[^1]$')
    expect(hits.filter((h) => h.kind === 'footref')).toHaveLength(0)
    expect(hits.some((h) => h.kind === 'math')).toBe(true)
  })
})

describe('parseInline · 内嵌 HTML', () => {
  it('识别白名单标签对', () => {
    const hits = parseInline('内嵌：<ins>下划线</ins> 结束')
    expect(hits.filter((h) => h.kind === 'html')).toHaveLength(1)
  })

  it('开关关掉时不识别（显示源码）', () => {
    expect(parseInline('<ins>下划线</ins>', false).filter((h) => h.kind === 'html')).toHaveLength(0)
  })
})

describe('sanitizeHtml · 白名单净化', () => {
  it('保留白名单标签', () => {
    expect(sanitizeHtml('<ins>下划线</ins>')).toBe('<ins>下划线</ins>')
  })

  it('剔除事件属性与 style', () => {
    const out = sanitizeHtml('<span onclick="alert(1)" style="color:red">x</span>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('style')
    expect(out).toContain('x')
  })

  it('script 与 iframe 整段剔除', () => {
    const out = sanitizeHtml('<script>alert(1)</script><iframe src="x"></iframe>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('iframe')
  })

  it('不在白名单的标签只留文本（如 div）', () => {
    const out = sanitizeHtml('<div>纯文本</div>')
    expect(out).not.toContain('<div>')
    expect(out).toContain('纯文本')
  })
})

describe('parseInline · 偏移正确', () => {
  it('中文前缀时区间以字符偏移计', () => {
    // 行内相对偏移：'下标：H~2~O' 里 H 在 3，~ 在 4，结尾 ~ 在 6 → 区间 [4, 7)
    const hits = parseInline('下标：H~2~O')
    expect(hits[0]).toMatchObject({ from: 4, to: 7 })
  })
})
