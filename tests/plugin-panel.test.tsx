// @vitest-environment happy-dom
/**
 * 插件页（2026-10-19 用户）：
 *  · 说明只显示 15 个字（全文放悬停 title，manifest 原文不动）；
 *  · 分类标题可点击折叠，状态记 localStorage（重开应用仍是折叠的）。
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PluginPanel, type PluginRow } from '../src/components/PluginPanel'
import { clampText } from '../src/lib/format'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

const row = (over: Partial<PluginRow> & { id: string }): PluginRow => ({
  name: over.id,
  version: '0.1.0',
  enabled: true,
  capabilities: [],
  ...over,
})

function renderPanel(plugins: PluginRow[]) {
  return render(
    <PluginPanel plugins={plugins} onToggle={vi.fn()} onDelete={vi.fn()} onInstall={vi.fn()} />,
  )
}

/** 22 个字 —— 超过「最多 15 字」的限制 */
const LONG = '这是一个非常长的插件说明足够超过十五个字限制'

describe('clampText（说明截断的纯函数）', () => {
  it('不超过上限时原样返回', () => {
    expect(clampText('短说明', 15)).toBe('短说明')
    expect(clampText('一二三四五六七八九十一二三四五', 15)).toBe('一二三四五六七八九十一二三四五')
  })

  it('超上限时截前 15 字并补省略号', () => {
    expect(clampText(LONG, 15)).toBe('这是一个非常长的插件说明足够超…')
    expect(Array.from(clampText(LONG, 15)).length).toBe(16)
  })
})

describe('插件页说明', () => {
  it('只显示 15 个字，title 保留全文', () => {
    const { container } = renderPanel([row({ id: 'a', description: LONG })])
    const desc = container.querySelector('.zn-plugin-desc') as HTMLElement
    expect(desc.textContent).toBe(clampText(LONG, 15))
    expect(desc.getAttribute('title')).toBe(LONG)
  })
})

describe('插件分类折叠', () => {
  /** 两组：编辑增强（a） / 主题外观（b） —— 分类顺序固定，editor 在前 */
  const twoGroups = () => [
    row({ id: 'a', category: 'editor' }),
    row({ id: 'b', category: 'theme' }),
  ]

  it('点分类标题折叠该组，再点展开', () => {
    const { container } = renderPanel(twoGroups())
    expect(container.querySelectorAll('.zn-plugin-row').length).toBe(2)

    const head = container.querySelector('.zn-plugin-group-head') as HTMLElement
    expect(head.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(head)
    expect(container.querySelectorAll('.zn-plugin-row').length).toBe(1)
    expect(container.querySelector('.zn-plugin-group-head')?.getAttribute('aria-expanded')).toBe(
      'false',
    )

    fireEvent.click(container.querySelector('.zn-plugin-group-head') as HTMLElement)
    expect(container.querySelectorAll('.zn-plugin-row').length).toBe(2)
  })

  it('折叠状态写 localStorage；重新挂载仍折叠', () => {
    const plugins = twoGroups()
    const first = renderPanel(plugins)
    fireEvent.click(first.container.querySelector('.zn-plugin-group-head') as HTMLElement)
    expect(localStorage.getItem('zn-plugin-groups-collapsed')).toContain('editor')
    first.unmount()

    const again = renderPanel(plugins)
    // editor 组折叠 ⇒ 只剩 theme 组那 1 行
    expect(again.container.querySelectorAll('.zn-plugin-row').length).toBe(1)
    expect(again.container.querySelector('.zn-plugin-group-head')?.getAttribute('aria-expanded')).toBe(
      'false',
    )
  })

  it('全部展开后移除记录（回到默认全展开）', () => {
    const { container } = renderPanel(twoGroups())
    const head = () => container.querySelector('.zn-plugin-group-head') as HTMLElement

    fireEvent.click(head())
    expect(localStorage.getItem('zn-plugin-groups-collapsed')).toBeTruthy()

    fireEvent.click(head())
    expect(localStorage.getItem('zn-plugin-groups-collapsed')).toBeNull()
  })
})

/**
 * 「已安装 / 发现」两个 tab 的**唯一条件**是传了 `onMarketInstall`（rev173.152）。
 *
 * 这条是「设置页与菜单主区统一」的锁：两处都只是把同一条通道透传进同一个 `PluginPanel`，
 * 所以「设置里没市场」只可能是漏传 —— 而不是另写了一套 UI 慢慢漂移。
 */
describe('插件页 tab（市场通道透传才有）', () => {
  it('不传 onMarketInstall ⇒ 不显示 tab（独立窗口 / 测试环境）', () => {
    const { container } = renderPanel([row({ id: 'a' })])
    expect(container.querySelector('.zn-plugins-tabs')).toBeNull()
  })

  it('传了 ⇒ 出现「已安装 N / 发现」两个 tab，默认在已安装', () => {
    const { container } = render(
      <PluginPanel
        plugins={[row({ id: 'a' }), row({ id: 'b' })]}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onMarketInstall={vi.fn().mockResolvedValue(null)}
      />,
    )
    const tabs = [...container.querySelectorAll('.zn-plugins-tab')].map((b) =>
      (b.textContent || '').trim(),
    )
    expect(tabs).toEqual(['已安装 2', '发现'])
    expect(container.querySelector('.zn-plugins-tab.is-active')?.textContent).toContain('已安装')
  })
})
