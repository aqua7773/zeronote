/**
 * 插件分类推断（rev173.4 · 用户「插件越来越多了，开始做插件分类存放」）。
 *
 * 判据：
 *  · manifest 显式 `category` 优先；
 *  · 没写时按形状推断：只有 styles 没有 entry ⇒ 主题（纯 CSS 插件）；
 *  · 名字带 demo / probe / hello 等 ⇒ 示例与探针；
 *  · reader / theme / editor 关键词按顺序匹配；
 *  · 都不命中 ⇒ 工具（宁可归到「工具」也不要多一个「其它」组）。
 */
import { describe, expect, it } from 'vitest'
import {
  categorizePlugin,
  isPluginCategory,
  PLUGIN_CATEGORY_LABEL,
  PLUGIN_CATEGORY_ORDER,
} from '../src/lib/plugin-category'

describe('categorizePlugin', () => {
  it('manifest 显式 category 优先于任何推断', () => {
    expect(categorizePlugin({ id: 'probe-x', category: 'reader', entry: 'index.js' })).toBe(
      'reader',
    )
    // 非法值忽略，走推断
    expect(categorizePlugin({ id: 'probe-x', category: 'nonsense', entry: 'index.js' })).toBe(
      'demo',
    )
  })

  it('只有 styles、没有 entry ⇒ 主题（纯 CSS 插件）', () => {
    expect(categorizePlugin({ id: 'sepia', styles: ['theme.css'] })).toBe('theme')
  })

  it('demo / probe / hello 之类 ⇒ 示例与探针', () => {
    expect(categorizePlugin({ id: 'asset-probe', entry: 'index.js' })).toBe('demo')
    expect(categorizePlugin({ id: 'lazy-demo', entry: 'index.js' })).toBe('demo')
    expect(categorizePlugin({ id: 'hello', entry: 'index.js' })).toBe('demo')
  })

  it('关键词推断：reader / editor', () => {
    expect(categorizePlugin({ id: 'doc-reader', entry: 'index.js' })).toBe('reader')
    expect(categorizePlugin({ id: 'outline-map', entry: 'index.js' })).toBe('editor')
    expect(categorizePlugin({ id: 'any-editor-plugin', entry: 'index.js' })).toBe('editor')
  })

  it('猜不出来归工具（不新增「其它」组）', () => {
    expect(categorizePlugin({ id: 'my-custom-tool', entry: 'index.js' })).toBe('tool')
    expect(categorizePlugin({ id: 'import-export', entry: 'index.js' })).toBe('tool')
  })
})

describe('分类表', () => {
  it('五个分类都有标题，且顺序固定', () => {
    expect(PLUGIN_CATEGORY_ORDER).toEqual(['editor', 'reader', 'theme', 'tool', 'demo'])
    for (const c of PLUGIN_CATEGORY_ORDER) expect(PLUGIN_CATEGORY_LABEL[c]).toBeTruthy()
  })

  it('isPluginCategory 只认枚举值', () => {
    expect(isPluginCategory('reader')).toBe(true)
    expect(isPluginCategory('other')).toBe(false)
    expect(isPluginCategory(undefined)).toBe(false)
  })
})
