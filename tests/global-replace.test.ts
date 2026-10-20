/**
 * 全局替换的纯逻辑（rev173.49 · 待办 #3「跨笔记替换」）。
 *
 * 判据（每条都对应一个真实失败模式）：
 *  · 普通模式必须**按字面量**匹配 —— 搜 `a.b` 不能把 `axb` 也换了；
 *  · 普通模式的替换串里 `$` 是**字面量** —— 搜 `$100` 替换成 `￥100` 不该被当成分组引用；
 *  · 正则模式要支持 `$1` 反向引用（用户写正则就是想要这个）；
 *  · 行号 / 列号从 1 开始，上下文只取命中所在行 —— 试运行清单靠它展示；
 *  · 非法正则 / 空查找返回 `{ error }`，**不抛异常**（面板拿它显示一句话）。
 */
import { describe, expect, it } from 'vitest'
import {
  applyReplace,
  collectHits,
  compileFind,
  countMatches,
  escapeRegExp,
} from '../src/lib/global-replace'

describe('compileFind', () => {
  it('普通模式把正则元字符转义（a.b 不匹配 axb）', () => {
    const text = 'axb a.b'
    expect(countMatches(text, 'a.b')).toBe(1)
    expect(countMatches(text, 'a.b', { regex: true })).toBe(2)
  })

  it('空查找 / 非法正则返回 error（不抛）', () => {
    expect('error' in compileFind('')).toBe(true)
    expect('error' in compileFind('([', { regex: true })).toBe(true)
    // 不打开正则时 `([` 只是普通字符，合法
    expect('re' in compileFind('([')).toBe(true)
  })

  it('默认忽略大小写；打开 caseSensitive 后区分', () => {
    expect(countMatches('Hello hello', 'hello')).toBe(2)
    expect(countMatches('Hello hello', 'hello', { caseSensitive: true })).toBe(1)
  })

  it('正则模式的 ^ / $ 按行（m flag）', () => {
    const text = '标题\n正文\n# 二级'
    expect(countMatches(text, '^# ', { regex: true })).toBe(1)
  })

  it('escapeRegExp 只转义元字符', () => {
    expect(escapeRegExp('a.b[c]')).toBe('a\\.b\\[c\\]')
    expect(escapeRegExp('中文-1')).toBe('中文-1')
  })
})

describe('collectHits', () => {
  it('给出 1-based 行号 / 列号与同行上下文', () => {
    const text = ['第一行没有', '第二行有目标词在这里', '第三行也没有'].join('\n')
    const fm = collectHits('a.md', text, '目标词')
    expect(fm.total).toBe(1)
    expect(fm.hits[0].line).toBe(2)
    expect(fm.hits[0].column).toBe(5)
    expect(fm.hits[0].match).toBe('目标词')
    expect(fm.hits[0].before).toBe('第二行有')
    expect(fm.hits[0].after).toBe('在这里')
  })

  it('同一行多处都能列出；跨行（正则 \\n）时行号取命中起点', () => {
    const text = 'a a a\nb'
    const fm = collectHits('a.md', text, 'a')
    expect(fm.total).toBe(3)
    expect(fm.hits.map((h) => h.line)).toEqual([1, 1, 1])
    const fm2 = collectHits('a.md', text, 'a\\nb', { regex: true })
    expect(fm2.hits[0].line).toBe(1)
  })

  it('预览条数受 limit 限制，但 total 是真实总数', () => {
    const text = Array.from({ length: 30 }, (_, i) => `行${i} 词`).join('\n')
    const fm = collectHits('a.md', text, '词', {}, 5)
    expect(fm.hits).toHaveLength(5)
    expect(fm.total).toBe(30)
  })

  it('没有命中 ⇒ 空表（total 0）', () => {
    const fm = collectHits('a.md', '无关内容', '目标')
    expect(fm.hits).toEqual([])
    expect(fm.total).toBe(0)
  })
})

describe('applyReplace', () => {
  it('普通模式：替换串里的 $ 是字面量', () => {
    const r = applyReplace('价格 $100 元', '$100', '￥100')
    expect(r.replaced).toBe(1)
    expect(r.content).toBe('价格 ￥100 元')
  })

  it('正则模式：$1 反向引用生效', () => {
    // 注意 `\w` 不匹配中文 —— 这里用 `(.+)` 抓名字
    const r = applyReplace('张三 (2026)', '(.+) \\((\\d+)\\)', '$2 年 · $1', { regex: true })
    expect(r.replaced).toBe(1)
    expect(r.content).toBe('2026 年 · 张三')
  })

  it('大小写不区分时保留替换串原样（不会把命中原文大写化）', () => {
    const r = applyReplace('HELLO hello', 'hello', 'World')
    expect(r.content).toBe('World World')
    expect(r.replaced).toBe(2)
  })

  it('没有命中 ⇒ 内容原样、计数 0', () => {
    const r = applyReplace('abc', 'zzz', 'y')
    expect(r).toEqual({ content: 'abc', replaced: 0 })
  })
})
