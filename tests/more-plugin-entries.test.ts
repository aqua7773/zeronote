/**
 * 「更多 → 插件」组的条目来源（rev173.331 · 真人测试7 #2）。
 *
 * 判据：
 *  · 面板在 `main` / `sidebar` 位置 ⇒ 是一条入口（能当页面打开）；
 *  · `statusbar` / `modal` / `editor-toolbar` / `editor-topbar` ⇒ **不是**入口；
 *  · `hidden`（每个文档一个的动态实例面板）⇒ 不列；
 *  · 副标题：已知插件给具体说法，其余回落「xxx 插件」。
 */
import { describe, expect, it } from 'vitest'
import {
  MORE_PLUGIN_HINTS,
  PLUGIN_PAGE_LOCATIONS,
  pluginPanelEntries,
  type PanelLike,
} from '../src/lib/more-plugin-entries'

const panel = (over: Partial<PanelLike> & { id: string }): PanelLike => ({
  title: over.id,
  location: 'main',
  pluginId: over.id,
  ...over,
})

describe('pluginPanelEntries', () => {
  it('main / sidebar 都算入口，顺序按注册顺序', () => {
    const out = pluginPanelEntries([
      panel({ id: 'tag-panel', title: '标签', pluginId: 'tag-panel' }),
      panel({ id: 'sync.status', title: '同步', pluginId: 'sync', location: 'main' }),
      panel({ id: 'pinned', title: '置顶', pluginId: 'notes-extra', location: 'sidebar' }),
    ])
    expect(out.map((e) => e.panelId)).toEqual(['tag-panel', 'sync.status', 'pinned'])
    expect(out.map((e) => e.label)).toEqual(['标签', '同步', '置顶'])
  })

  it('sync 这种只挂 main 的插件也会出现（真人测试7 #2 的用例）', () => {
    const out = pluginPanelEntries([panel({ id: 'sync.status', title: '同步', pluginId: 'sync' })])
    expect(out).toHaveLength(1)
    expect(out[0]).toEqual({
      key: 'sync.status',
      label: '同步',
      hint: '同步状态与冲突处理',
      panelId: 'sync.status',
    })
  })

  it('小部件 / 弹窗 / 编辑器工具条都不进这一组', () => {
    const out = pluginPanelEntries([
      panel({ id: 'w', title: '部件', location: 'statusbar' }),
      panel({ id: 'm', title: '弹窗', location: 'modal' }),
      panel({ id: 't', title: '工具条', location: 'editor-toolbar' }),
      panel({ id: 'tb', title: '顶条', location: 'editor-topbar' }),
      panel({ id: 'ok', title: '页面' }),
    ])
    expect(out.map((e) => e.key)).toEqual(['ok'])
  })

  it('hidden 的动态实例面板不列', () => {
    const out = pluginPanelEntries([
      panel({ id: 'doc-reader.view.a', title: '阅读器', hidden: true }),
      panel({ id: 'tag-panel', title: '标签' }),
    ])
    expect(out.map((e) => e.key)).toEqual(['tag-panel'])
  })

  it('未知插件的副标题回落成「xxx 插件」，没有 pluginId 就没有副标题', () => {
    const out = pluginPanelEntries(
      [panel({ id: 'p1', pluginId: 'wild-idea' }), { id: 'p2', title: '无主', location: 'main' }],
      {},
    )
    expect(out[0].hint).toBe('wild-idea 插件')
    expect(out[1].hint).toBeUndefined()
  })

  it('空列表 ⇒ 空（宿主据此整组不渲染）', () => {
    expect(pluginPanelEntries([])).toEqual([])
    expect(PLUGIN_PAGE_LOCATIONS).toEqual(['main', 'sidebar'])
    expect(Object.keys(MORE_PLUGIN_HINTS)).toContain('sync')
  })
})
