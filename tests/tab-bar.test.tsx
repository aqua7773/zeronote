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

  it('没有标签、也没有「＋」入口时整条不渲染', () => {
    const { container } = render(
      <TabBar tabs={[]} activePath={null} onSelect={() => {}} onClose={() => {}} />,
    )
    expect(container.querySelector('.zn-tabs')).toBeNull()
  })

  /* ── B5（rev173.261 · 方案 §2.1）：＋ 新建 / 选面板 · » 全部标签 ── */

  it('有 onNewNote 时没有标签也渲染标签条（＋ 常在 = 无标签也能新建）', () => {
    const onNew = vi.fn()
    const { container } = render(
      <TabBar tabs={[]} activePath={null} onSelect={() => {}} onClose={() => {}} onNewNote={onNew} />,
    )
    expect(container.querySelector('.zn-tabs')).toBeTruthy()
    const plus = screen.getByRole('button', { name: '新建笔记或打开面板' })
    expect(plus).toBeTruthy()
    // 没有标签时 «» 不出现（没东西可列）
    expect(screen.queryByRole('button', { name: '全部标签' })).toBeNull()
  })

  it('点 ＋ → 菜单有「新建笔记」，点它回调 onNewNote', () => {
    const onNew = vi.fn()
    render(
      <TabBar tabs={tabs} activePath="a.md" onSelect={() => {}} onClose={() => {}} onNewNote={onNew} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建笔记或打开面板' }))
    const item = screen.getByRole('menuitem', { name: /新建笔记/ })
    fireEvent.click(item)
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('＋ 菜单列出可打开的面板，点它回调 onOpenPanel(id)', () => {
    const onOpenPanel = vi.fn()
    render(
      <TabBar
        tabs={tabs}
        activePath="a.md"
        onSelect={() => {}}
        onClose={() => {}}
        onNewNote={() => {}}
        panelItems={[
          { id: 'tag-panel.board', title: '标签' },
          { id: 'accounting.panel', title: '记账' },
        ]}
        onOpenPanel={onOpenPanel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建笔记或打开面板' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /打开 · 记账/ }))
    expect(onOpenPanel).toHaveBeenCalledWith('accounting.panel')
  })

  it('零插件（没有面板）⇒ ＋ 菜单只有「新建笔记」，不留空组', () => {
    render(
      <TabBar tabs={tabs} activePath="a.md" onSelect={() => {}} onClose={() => {}} onNewNote={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建笔记或打开面板' }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(1)
  })

  it('点 » → 列出全部标签，点一项切换', () => {
    const onSelect = vi.fn()
    render(
      <TabBar tabs={tabs} activePath="a.md" onSelect={onSelect} onClose={() => {}} onNewNote={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '全部标签' }))
    // 菜单里两条都在（含当前那条，带 is-active）
    const items = screen.getAllByRole('menuitem')
    expect(items).toHaveLength(2)
    fireEvent.click(items[1])
    expect(onSelect).toHaveBeenCalledWith('dir/b.md')
  })

  it('点菜单外 = 关菜单（不误切标签）', () => {
    render(
      <TabBar tabs={tabs} activePath="a.md" onSelect={() => {}} onClose={() => {}} onNewNote={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '全部标签' }))
    expect(screen.getByRole('menu', { name: '全部标签' })).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu', { name: '全部标签' })).toBeNull()
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

  /**
   * 拖出窗口（rev173.52）：位移过阈值 + 松手贴边 ⇒ `onDragEnd` 带 `outside: true`，
   * 并且随后补发的那记 click 被吃掉（不能顺带切一次标签）。
   */
  it('拖到窗口边缘松手 ⇒ onDragEnd(outside=true)，且不触发切换', () => {
    const onDragEnd = vi.fn()
    const onSelect = vi.fn()
    render(
      <TabBar
        tabs={tabs}
        activePath="a.md"
        onSelect={onSelect}
        onClose={() => {}}
        onDragEnd={onDragEnd}
      />,
    )
    const label = screen.getByTitle('dir/b.md')
    fireEvent.pointerDown(label, { button: 0, clientX: 100, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 400, clientY: 20 })
    fireEvent.pointerUp(window, { clientX: window.innerWidth, clientY: 20 })

    expect(onDragEnd).toHaveBeenCalledTimes(1)
    const [path, at] = onDragEnd.mock.calls[0] as [string, { outside: boolean }]
    expect(path).toBe('dir/b.md')
    expect(at.outside).toBe(true)

    fireEvent.click(label) // 松手后浏览器补的那记 click
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('手抖（位移不到阈值）松手 ⇒ 不算拖拽，正常当点击', () => {
    const onDragEnd = vi.fn()
    const onSelect = vi.fn()
    render(
      <TabBar
        tabs={tabs}
        activePath="a.md"
        onSelect={onSelect}
        onClose={() => {}}
        onDragEnd={onDragEnd}
      />,
    )
    const label = screen.getByTitle('dir/b.md')
    fireEvent.pointerDown(label, { button: 0, clientX: 100, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 103, clientY: 20 })
    fireEvent.pointerUp(window, { clientX: 105, clientY: 20 })
    expect(onDragEnd).not.toHaveBeenCalled()

    fireEvent.click(label)
    expect(onSelect).toHaveBeenCalledWith('dir/b.md')
  })

  it('拖到窗口中间松手 ⇒ onDragEnd(outside=false)（不拆窗口）', () => {
    const onDragEnd = vi.fn()
    render(
      <TabBar tabs={tabs} activePath="a.md" onSelect={() => {}} onClose={() => {}} onDragEnd={onDragEnd} />,
    )
    const label = screen.getByTitle('dir/b.md')
    fireEvent.pointerDown(label, { button: 0, clientX: 100, clientY: 20 })
    fireEvent.pointerMove(window, { clientX: 300, clientY: 300 })
    fireEvent.pointerUp(window, { clientX: 300, clientY: 300 })
    const [, at] = onDragEnd.mock.calls[0] as [string, { outside: boolean }]
    expect(at.outside).toBe(false)
  })
})
