// @vitest-environment happy-dom
/**
 * 插件页（2026-10-19 用户）：
 *  · 说明只显示 15 个字（全文放悬停 title，manifest 原文不动）；
 *  · 分类标题可点击折叠，状态记 localStorage（重开应用仍是折叠的）。
 */
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 市场 tab 会拉索引（`invoke('net_request')`）—— 这里只要「切过去不炸」，
 * 所以让 invoke 直接失败，MarketPane 自带错误态。
 */
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
  convertFileSrc: (p: string) => p,
}))

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
 * 「已安装 / 插件市场」两个 tab 的**唯一条件**是传了 `onMarketInstall`（rev173.152）。
 *
 * 这条是「设置页与菜单主区统一」的锁：两处都只是把同一条通道透传进同一个 `PluginPanel`，
 * 所以「设置里没市场」只可能是漏传 —— 而不是另写了一套 UI 慢慢漂移。
 * （B3：市场叫「插件市场」；设置页已不再嵌这个面板，但条件本身仍是唯一入口。）
 */
describe('插件页 tab（市场通道透传才有）', () => {
  it('不传 onMarketInstall ⇒ 不显示 tab（独立窗口 / 测试环境）', () => {
    const { container } = renderPanel([row({ id: 'a' })])
    expect(container.querySelector('.zn-plugins-tabs')).toBeNull()
  })

  it('传了 ⇒ 出现「已安装 N / 插件市场」两个 tab，默认在已安装', () => {
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
    expect(tabs).toEqual(['已安装 2', '插件市场'])
    expect(container.querySelector('.zn-plugins-tab.is-active')?.textContent).toContain('已安装')
  })
})

/**
 * 零插件空态（B3 · 方案 §6 验收）：
 * 安装 `.znp` + 浏览市场 + 3 条推荐。空页不是死路。
 */
describe('零插件空态', () => {
  const empty = (onInstall = vi.fn()) =>
    render(
      <PluginPanel
        plugins={[]}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onInstall={onInstall}
        onMarketInstall={vi.fn().mockResolvedValue(null)}
        globalRoot="C:/appdata"
      />,
    )

  it('给「安装 .znp」与「浏览插件市场」两个入口', () => {
    empty()
    expect(screen.getByText('还没有安装插件')).toBeTruthy()
    expect(screen.getByRole('button', { name: /安装插件包/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: '浏览插件市场' })).toBeTruthy()
  })

  it('3 条推荐是标签 / 反向链接 / 历史版本', () => {
    const { container } = empty()
    const items = [...container.querySelectorAll('.zn-plugins-recommend-list li')]
    expect(items).toHaveLength(3)
    expect(
      items.map((li) => li.querySelector('.zn-plugins-recommend-name')?.textContent),
    ).toEqual(['标签', '反向链接', '历史版本'])
  })

  it('点「浏览插件市场」切到市场 tab', () => {
    empty()
    fireEvent.click(screen.getByRole('button', { name: '浏览插件市场' }))
    expect(screen.getByRole('tab', { name: '插件市场' }).getAttribute('aria-selected')).toBe('true')
  })
})

/**
 * 禁用撤销（B3 · 方案 §6 验收「禁用插件可撤销」）：
 * 拨掉开关 ⇒ 出现撤销条；点撤销 ⇒ 重新启用，条子消失。
 */
describe('禁用撤销条', () => {
  it('拨掉开关出现撤销条，点「撤销」重新启用', () => {
    const onToggle = vi.fn()
    const { container } = render(
      <PluginPanel
        plugins={[row({ id: 'a', name: '标签' })]}
        onToggle={onToggle}
        onDelete={vi.fn()}
      />,
    )
    fireEvent.click(container.querySelector('.zn-plugin-switch') as HTMLElement)
    expect(onToggle).toHaveBeenCalledWith('a', false)

    const bar = container.querySelector('.zn-plugin-undo') as HTMLElement
    expect(bar).toBeTruthy()
    expect(bar.textContent).toContain('已禁用「标签」')

    fireEvent.click(within(bar).getByRole('button', { name: '撤销' }))
    expect(onToggle).toHaveBeenLastCalledWith('a', true)
    expect(container.querySelector('.zn-plugin-undo')).toBeNull()
  })

  it('重新拨开同一个开关也清掉撤销条（不需要再点撤销）', () => {
    /* 受控小壳：开关状态真的跟着 onChange 变（真机上 App 就是这样驱动的） */
    function Harness() {
      const [enabled, setEnabled] = useState(true)
      return (
        <PluginPanel
          plugins={[row({ id: 'a', name: '标签', enabled })]}
          onToggle={(_id, next) => setEnabled(next)}
          onDelete={vi.fn()}
        />
      )
    }
    const { container } = render(<Harness />)
    const sw = container.querySelector('.zn-plugin-switch') as HTMLInputElement
    fireEvent.click(sw)
    expect(container.querySelector('.zn-plugin-undo')).toBeTruthy()
    fireEvent.click(sw)
    expect(container.querySelector('.zn-plugin-undo')).toBeNull()
  })
})

/**
 * 可更新角标（rev173.156 · 第二批 UX）。
 *
 * 数据来自 24h 节流检查（只查不装）；这里只锁「显示规则」：
 *  · 有更新才显示，没更新不显示；
 *  · tab 上的计数**只数真装着的**（缓存里可能残留已删插件的 id）。
 */
describe('可更新角标', () => {
  it('有更新的行显示「↑ 可更新 vX」，没更新的行不显示', () => {
    const { container } = render(
      <PluginPanel
        plugins={[row({ id: 'a' }), row({ id: 'b' })]}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        updates={{ a: '0.2.1' }}
      />,
    )
    const badges = [...container.querySelectorAll('.zn-plugin-update')]
    expect(badges).toHaveLength(1)
    expect(badges[0].textContent).toContain('↑ 可更新 v0.2.1')
  })

  it('tab 计数只算装着的那几个（残留的已删 id 不算）', () => {
    render(
      <PluginPanel
        plugins={[row({ id: 'a' })]}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onMarketInstall={vi.fn().mockResolvedValue(null)}
        updates={{ a: '0.2.1', ghost: '9.9.9' }}
      />,
    )
    expect(screen.getByText('↑ 1')).toBeTruthy()
  })

  it('没有更新 / 不传 updates ⇒ 一个角标都不出现', () => {
    const { container } = renderPanel([row({ id: 'a' })])
    expect(container.querySelector('.zn-plugin-update')).toBeNull()
    expect(container.querySelector('.zn-plugin-update-count')).toBeNull()
  })
})
