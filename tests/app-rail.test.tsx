// @vitest-environment happy-dom
/**
 * 图标栏（UI 重布局 B1 · 方案 §2.1）。
 *
 * 验收口径（方案 §9）：5 项固定内核入口可点、选中态跟随侧栏可见性、
 * 插件固定区为空时**整块不渲染**（零插件不留灰位 / 空容器）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRail } from '../src/components/AppRail'

afterEach(cleanup)

function makeProps(over: Partial<Parameters<typeof AppRail>[0]> = {}) {
  return {
    activeView: 'notes' as const,
    sidebarVisible: true,
    pluginsOpen: false,
    settingsOpen: false,
    onSelectView: vi.fn(),
    onTogglePlugins: vi.fn(),
    onToggleSettings: vi.fn(),
    ...over,
  }
}

describe('AppRail 图标栏', () => {
  it('固定 5 项内核入口都在（笔记 / 搜索 / 时间流 / 插件 / 设置）', () => {
    render(<AppRail {...makeProps()} />)
    for (const name of ['笔记', '搜索', '时间流', '插件', '设置']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('tooltip 带快捷键（验收：图标 tooltip 带快捷键）', () => {
    render(<AppRail {...makeProps()} />)
    expect(screen.getByRole('button', { name: '笔记' }).getAttribute('title')).toContain('Ctrl+1')
    expect(screen.getByRole('button', { name: '搜索' }).getAttribute('title')).toContain('Ctrl+2')
    expect(screen.getByRole('button', { name: '时间流' }).getAttribute('title')).toContain('Ctrl+3')
    expect(screen.getByRole('button', { name: '设置' }).getAttribute('title')).toContain('Ctrl+,')
  })

  it('点三个视图按钮回调携带对应视图', () => {
    const props = makeProps()
    render(<AppRail {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))
    fireEvent.click(screen.getByRole('button', { name: '时间流' }))
    fireEvent.click(screen.getByRole('button', { name: '笔记' }))
    expect(props.onSelectView.mock.calls).toEqual([['search'], ['timeline'], ['notes']])
  })

  it('选中态：只有侧栏展开时当前视图带 aria-current', () => {
    const { rerender } = render(<AppRail {...makeProps()} />)
    expect(screen.getByRole('button', { name: '笔记' }).getAttribute('aria-current')).toBe('page')

    rerender(<AppRail {...makeProps({ activeView: 'search' })} />)
    expect(screen.getByRole('button', { name: '搜索' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '笔记' }).getAttribute('aria-current')).toBeNull()

    // 侧栏收起 ⇒ 三个视图按钮都不算"当前页"
    rerender(<AppRail {...makeProps({ activeView: 'search', sidebarVisible: false })} />)
    expect(screen.getByRole('button', { name: '搜索' }).getAttribute('aria-current')).toBeNull()
  })

  it('插件页 / 设置打开时对应按钮给选中态', () => {
    render(<AppRail {...makeProps({ pluginsOpen: true, settingsOpen: true })} />)
    expect(screen.getByRole('button', { name: '插件' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: '设置' }).getAttribute('aria-current')).toBe('page')
  })

  it('插件固定区为空时整块不渲染（零插件不留灰位）', () => {
    const { container } = render(<AppRail {...makeProps()} />)
    // 只有"底部分组"那一条分隔线；固定区若渲染会再多一条 + 若干按钮
    expect(container.querySelectorAll('.zn-rail-sep').length).toBe(1)
  })

  it('插件固定区最多渲染 3 个，点击回到 pin 的实现', () => {
    const onPinClick = vi.fn()
    const pins = [
      { id: 'a', title: '标签' },
      { id: 'b', title: '记账' },
      { id: 'c', title: 'AI' },
      { id: 'd', title: '第四个' },
    ]
    render(<AppRail {...makeProps({ pins, onPinClick })} />)
    expect(screen.queryByRole('button', { name: '第四个' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '记账' }))
    expect(onPinClick).toHaveBeenCalledWith('b')
  })
})
