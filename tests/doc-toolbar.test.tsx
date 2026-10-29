// @vitest-environment happy-dom
/**
 * 文档工具条（UI 重布局 B4 · 方案 §2.1 / §3.3）——
 * 固定两项内核动作（源码 / 更多）+ `editor-topbar` 插件面板。
 *
 * 零插件基线：没有面板时左侧整块空着，两个内核按钮照样可用（不留灰按钮）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocToolbar } from '../src/components/DocToolbar'

afterEach(cleanup)

const base = {
  sourceMode: false,
  onToggleSourceMode: () => {},
  onMore: () => {},
  panels: [],
  panelState: {},
  onAction: () => {},
  onStateChange: () => {},
}

describe('DocToolbar', () => {
  it('零插件也渲染两个内核动作：源码 / 更多', () => {
    const { container } = render(<DocToolbar {...base} />)
    expect(screen.getByRole('button', { name: '源码' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '更多文档操作' })).toBeTruthy()
    // 左侧没有插件面板 ⇒ 一个按钮都不多出来
    expect(container.querySelectorAll('.zn-doc-toolbar-left button').length).toBe(0)
  })

  it('源码模式打开时按钮显示「预览」并带 aria-pressed', () => {
    render(<DocToolbar {...base} sourceMode />)
    const btn = screen.getByRole('button', { name: '预览' })
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('点「源码」把切换交回宿主', () => {
    const onToggle = vi.fn()
    render(<DocToolbar {...base} onToggleSourceMode={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: '源码' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('点「更多」把按钮位置交回宿主（菜单从右下角展开）', () => {
    const onMore = vi.fn()
    render(<DocToolbar {...base} onMore={onMore} />)
    fireEvent.click(screen.getByRole('button', { name: '更多文档操作' }))
    expect(onMore).toHaveBeenCalledTimes(1)
    const at = onMore.mock.calls[0][0] as { x: number; y: number }
    expect(typeof at.x).toBe('number')
    expect(typeof at.y).toBe('number')
  })

  it('插件面板（editor-topbar）渲染在左侧，禁用后整块消失', () => {
    const panel = {
      id: 'backlinks.status',
      pluginId: 'backlinks',
      title: '反向链接',
      location: 'editor-topbar' as const,
      render: () => ({
        type: 'button' as const,
        label: '被 2 篇引用',
        onClick: 'backlinks.show-for-current',
      }),
    }
    const { container, rerender } = render(
      <DocToolbar {...base} panels={[panel] as never} />,
    )
    expect(container.querySelector('.zn-doc-toolbar-left')?.textContent).toContain('被 2 篇引用')
    rerender(<DocToolbar {...base} panels={[]} />)
    expect(container.querySelector('.zn-doc-toolbar-left')?.textContent).toBe('')
  })
})
