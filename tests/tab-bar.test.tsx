// @vitest-environment happy-dom
/**
 * 标签条组件（rev173.50 · 用户待办 #2「多标签页」）。
 *
 * 只锁外部可观察的行为：点了哪条 → onSelect(path)、点了 × → onClose(path) 且不触发切换、
 * 未保存圆点只在 dirty 时出现、没标签时整条不渲染。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TabBar } from '../src/components/TabBar'

afterEach(cleanup)

const tabs = [
  { path: 'a.md', title: '甲' },
  { path: 'dir/b.md', title: '乙', dirty: true },
]

function renderBar(activePath: string | null = 'a.md') {
  const onSelect = vi.fn()
  const onClose = vi.fn()
  render(<TabBar tabs={tabs} activePath={activePath} onSelect={onSelect} onClose={onClose} />)
  return { onSelect, onClose }
}

describe('TabBar', () => {
  it('点标签主体切换当前文档', () => {
    const { onSelect } = renderBar()
    fireEvent.click(screen.getByTitle('dir/b.md'))
    expect(onSelect).toHaveBeenCalledWith('dir/b.md')
  })

  it('点 × 关闭该标签，且不触发切换', () => {
    const { onSelect, onClose } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: '关闭 乙' }))
    expect(onClose).toHaveBeenCalledWith('dir/b.md')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('未保存圆点只出现在 dirty 标签上', () => {
    renderBar()
    const dots = screen.getAllByLabelText('未保存')
    expect(dots).toHaveLength(1)
  })

  it('没有标签时整条不渲染', () => {
    const { container } = render(
      <TabBar tabs={[]} activePath={null} onSelect={() => {}} onClose={() => {}} />,
    )
    expect(container.querySelector('.zn-tabs')).toBeNull()
  })

  /**
   * 右键标签（rev173.51）：「在新窗口打开 / 关闭标签页」由宿主弹菜单。
   * 组件只负责把「哪条、什么坐标」交回去。
   */
  it('右键标签 → onContextMenu(路径, 坐标)', () => {
    const onContextMenu = vi.fn()
    render(
      <TabBar
        tabs={tabs}
        activePath="a.md"
        onSelect={() => {}}
        onClose={() => {}}
        onContextMenu={onContextMenu}
      />,
    )
    const label = screen.getByTitle('dir/b.md')
    fireEvent.contextMenu(label.parentElement as HTMLElement, { clientX: 30, clientY: 40 })
    expect(onContextMenu).toHaveBeenCalledWith('dir/b.md', { x: 30, y: 40 })
  })

  it('不传 onContextMenu 时右键不报错（手机 / 旧调用方）', () => {
    render(<TabBar tabs={tabs} activePath="a.md" onSelect={() => {}} onClose={() => {}} />)
    const label = screen.getByTitle('dir/b.md')
    expect(() =>
      fireEvent.contextMenu(label.parentElement as HTMLElement, { clientX: 1, clientY: 2 }),
    ).not.toThrow()
  })
})
