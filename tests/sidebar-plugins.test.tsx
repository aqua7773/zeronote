// @vitest-environment happy-dom
/**
 * 侧栏插件分组（UI 重布局 B6 · 方案 §7.2 A 案）。
 *
 * 锁三件事：
 *  1. 面板渲染出来（标题 = 归属提示，内容 = UIRenderer）；
 *  2. 点按钮把命令交回宿主（不自己执行）；
 *  3. 零插件基线在**外壳**一层：`AppSidebar` 不传 `pluginSlot` 时整块不出现（不留空壳）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppSidebar } from '../src/components/AppSidebar'
import { SidebarPlugins } from '../src/components/SidebarPlugins'

afterEach(cleanup)

const panel = {
  id: 'hello.panel',
  pluginId: 'hello',
  title: 'Hello 插件',
  location: 'sidebar' as const,
  render: () => ({
    type: 'stack' as const,
    children: [
      { type: 'text' as const, value: '侧栏内容', variant: 'caption' },
      { type: 'button' as const, label: '打个招呼', onClick: 'hello.say' },
    ],
  }),
}

const base = {
  panelState: {},
  onAction: () => {},
  onStateChange: () => {},
}

describe('SidebarPlugins', () => {
  it('渲染面板标题与内容', () => {
    render(<SidebarPlugins panels={[panel] as never} {...base} />)
    expect(screen.getByText('Hello 插件')).toBeTruthy()
    expect(screen.getByText('侧栏内容')).toBeTruthy()
  })

  it('点面板按钮 → 把命令交回宿主', () => {
    const onAction = vi.fn()
    render(<SidebarPlugins panels={[panel] as never} {...base} onAction={onAction} />)
    fireEvent.click(screen.getByRole('button', { name: '打个招呼' }))
    /* 第二个参数是 UIRenderer 的事件负载（按钮没有 payload 时是 `{}`，不是 undefined） */
    expect(onAction).toHaveBeenCalledWith('hello.say', {})
  })

  it('多个面板按注册顺序排列（各自的 title 都在）', () => {
    const second = { ...panel, id: 'x.y', title: '第二块' }
    render(<SidebarPlugins panels={[panel, second] as never} {...base} />)
    expect(screen.getByText('Hello 插件')).toBeTruthy()
    expect(screen.getByText('第二块')).toBeTruthy()
  })
})

describe('AppSidebar 的插件槽位（零插件基线）', () => {
  const shellProps = {
    vault: 'C:\\v',
    open: false,
    width: 260,
    view: 'notes' as const,
    onOpenTrash: () => {},
    onOpenVaultMenu: () => {},
  }

  it('不传 pluginSlot ⇒ 侧栏里没有插件分组（不留空壳）', () => {
    const { container } = render(<AppSidebar {...shellProps} />)
    expect(container.querySelector('.zn-sidebar-plugin-slot')).toBeNull()
  })

  it('传了 pluginSlot ⇒ 渲染在文件树下方、回收站上方', () => {
    const { container } = render(
      <AppSidebar {...shellProps} pluginSlot={<SidebarPlugins panels={[panel] as never} {...base} />} />,
    )
    const slot = container.querySelector('.zn-sidebar-plugin-slot')
    expect(slot).toBeTruthy()
    expect(slot?.querySelector('.zn-sidebar-plugin-head')?.textContent).toBe('Hello 插件')
    // 顺序：视图容器 → 插件槽 → 回收站按钮
    const aside = container.querySelector('.zn-sidebar') as HTMLElement
    const kids = [...aside.children].map((el) => el.className)
    expect(kids.indexOf('zn-sidebar-plugin-slot')).toBeGreaterThan(kids.indexOf('zn-sidebar-view'))
  })
})
