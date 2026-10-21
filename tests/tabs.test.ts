/**
 * 多标签页纯逻辑（rev173.50 · 用户待办 #2）。
 *
 * 覆盖四条规则：打开（MRU 挪位 / 上限）· 关闭后选谁 · 上下切换（循环）· 改名重映射。
 * `App` 里的接线另外由真机验收，这里锁语义 —— 尤其是「关掉中间那篇该激活右边」和
 * 「目录改名带前缀」这两条，错了用户会直接点开一条不存在的路径。
 */
import { describe, expect, it } from 'vitest'
import {
  addTab,
  closeTab,
  isPanelTab,
  MAX_TABS,
  panelIdOfTab,
  panelTabId,
  remapTabs,
  removeTab,
  stepTab,
} from '../src/lib/tabs'

describe('addTab', () => {
  it('新路径追加到末尾', () => {
    expect(addTab(['a.md'], 'b.md')).toEqual(['a.md', 'b.md'])
  })

  it('已存在的路径位置不动（固定位置，Ctrl+Tab 循环才稳定）', () => {
    const tabs = ['a.md', 'b.md', 'c.md']
    expect(addTab(tabs, 'a.md')).toBe(tabs)
  })

  it('空路径原样返回（没打开文档时不该凭空多一个标签）', () => {
    expect(addTab(['a.md'], '')).toEqual(['a.md'])
  })

  it(`超出上限丢最久没用的那个（上限 ${MAX_TABS}）`, () => {
    const many = Array.from({ length: MAX_TABS }, (_, i) => `n${i}.md`)
    const next = addTab(many, 'new.md')
    expect(next).toHaveLength(MAX_TABS)
    expect(next[0]).toBe('n1.md') // n0 被挤掉
    expect(next[next.length - 1]).toBe('new.md')
  })
})

describe('removeTab', () => {
  it('移除存在的路径', () => {
    expect(removeTab(['a.md', 'b.md'], 'a.md')).toEqual(['b.md'])
  })

  it('不存在则原样返回（引用不变，避免多余渲染）', () => {
    const tabs = ['a.md']
    expect(removeTab(tabs, 'zzz.md')).toBe(tabs)
  })
})

describe('closeTab', () => {
  it('关中间：激活右边那个', () => {
    expect(closeTab(['a.md', 'b.md', 'c.md'], 'b.md')).toEqual({
      tabs: ['a.md', 'c.md'],
      next: 'c.md',
    })
  })

  it('关末尾：激活左边那个', () => {
    expect(closeTab(['a.md', 'b.md'], 'b.md')).toEqual({ tabs: ['a.md'], next: 'a.md' })
  })

  it('关唯一一篇：next 为 null（回起始页）', () => {
    expect(closeTab(['a.md'], 'a.md')).toEqual({ tabs: [], next: null })
  })

  it('关不在列表里的路径：不动标签，next 为 null', () => {
    const tabs = ['a.md', 'b.md']
    expect(closeTab(tabs, 'zzz.md')).toEqual({ tabs, next: null })
  })
})

describe('stepTab', () => {
  it('往后循环', () => {
    expect(stepTab(['a.md', 'b.md', 'c.md'], 'a.md', 1)).toBe('b.md')
    expect(stepTab(['a.md', 'b.md', 'c.md'], 'c.md', 1)).toBe('a.md')
  })

  it('往前循环', () => {
    expect(stepTab(['a.md', 'b.md', 'c.md'], 'a.md', -1)).toBe('c.md')
    expect(stepTab(['a.md', 'b.md'], 'b.md', -1)).toBe('a.md')
  })

  it('当前不在列表 / 为空：取第一篇', () => {
    expect(stepTab(['a.md', 'b.md'], null, 1)).toBe('a.md')
    expect(stepTab(['a.md', 'b.md'], 'zzz.md', -1)).toBe('a.md')
  })

  it('只有一篇：返回它自己；一篇都没有：null', () => {
    expect(stepTab(['a.md'], 'a.md', 1)).toBe('a.md')
    expect(stepTab([], 'a.md', 1)).toBeNull()
  })
})

describe('remapTabs', () => {
  it('文件改名：只换那一条', () => {
    expect(remapTabs(['a.md', 'b.md'], 'a.md', 'x.md')).toEqual(['x.md', 'b.md'])
  })

  it('目录改名：整棵子树的前缀一起换', () => {
    expect(remapTabs(['d/a.md', 'd/sub/b.md', 'other.md'], 'd', 'e', true)).toEqual([
      'e/a.md',
      'e/sub/b.md',
      'other.md',
    ])
  })

  it('isDir=false 时不碰同前缀的其它路径', () => {
    expect(remapTabs(['d/a.md', 'd/b.md'], 'd', 'e')).toEqual(['d/a.md', 'd/b.md'])
  })

  it('改名撞上已打开的路径：去重（否则 React key 重复）', () => {
    expect(remapTabs(['a.md', 'b.md'], 'a.md', 'b.md')).toEqual(['b.md'])
  })
})

/**
 * 面板标签（rev173.83）：阅读器 / 导图也能进标签条。
 * 用前缀而不是改类型 —— 上面那四个纯函数因此一行都不用改。
 */
describe('面板标签', () => {
  it('panelTabId / isPanelTab / panelIdOfTab 成对', () => {
    const key = panelTabId('doc-reader.view')
    expect(key).toBe('panel:doc-reader.view')
    expect(isPanelTab(key)).toBe(true)
    expect(panelIdOfTab(key)).toBe('doc-reader.view')
  })

  it('笔记路径不会被误判成面板', () => {
    expect(isPanelTab('notes/panel:demo.md')).toBe(false)
    expect(panelIdOfTab('notes/a.md')).toBeNull()
  })

  it('现有四个函数照常吃面板标签（add/close/step 都能用）', () => {
    const tabs = addTab(['a.md'], panelTabId('doc-reader.view'))
    expect(tabs).toEqual(['a.md', 'panel:doc-reader.view'])
    expect(stepTab(tabs, 'a.md', 1)).toBe('panel:doc-reader.view')
    expect(closeTab(tabs, 'panel:doc-reader.view')).toEqual({ tabs: ['a.md'], next: 'a.md' })
  })
})
