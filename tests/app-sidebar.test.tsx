// @vitest-environment happy-dom
/**
 * 侧栏外壳（UI 重布局 B1）。
 *
 * 两个形态：
 *  - 桌面（传 `view`）= 视图容器：头部是搜索框 + 收起按钮，中部渲染 `children`；
 *    搜索视图里头部不再出现第 2 个搜索入口（避免两个输入框并排）。
 *  - 手机（不传 `view`）= 抽屉：头部仍是应用名 + 设置齿轮（B2 之前保持原样）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppSidebar } from '../src/components/AppSidebar'

afterEach(cleanup)

function makeProps(over: Record<string, unknown> = {}) {
  return {
    vault: '/vault',
    open: false,
    width: 260,
    onOpenTrash: vi.fn(),
    onOpenVaultMenu: vi.fn(),
    ...over,
  }
}

describe('AppSidebar 抽屉形态（手机）', () => {
  it('设置图标在侧栏头部，点击打开设置', () => {
    const props = makeProps({ onOpenSettings: vi.fn() })
    render(<AppSidebar {...props} />)
    const btn = screen.getByRole('button', { name: '设置' })
    expect(btn.closest('.zn-sidebar-head')).toBeTruthy()
    fireEvent.click(btn)
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('没有库时设置图标也在（不依赖库）', () => {
    render(<AppSidebar {...makeProps({ vault: null, onOpenSettings: vi.fn() })} />)
    expect(screen.getByRole('button', { name: '设置' })).toBeTruthy()
  })
})

describe('AppSidebar 视图容器形态（桌面 · B1）', () => {
  it('头部是搜索按钮 + 收起按钮；不再有设置齿轮（设置归图标栏）', () => {
    const props = makeProps({ view: 'notes', onSearchIntent: vi.fn(), onCollapse: vi.fn() })
    render(<AppSidebar {...props} />)
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '搜索笔记…' }))
    expect(props.onSearchIntent).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '收起笔记库栏' }))
    expect(props.onCollapse).toHaveBeenCalledTimes(1)
  })

  it('children 渲染在视图容器里（文件树 / 搜索 / 时间流都走这一层）', () => {
    const { container } = render(
      <AppSidebar {...makeProps({ view: 'notes' })}>
        <div data-testid="tree-view">树</div>
      </AppSidebar>,
    )
    expect(screen.getByTestId('tree-view').closest('.zn-sidebar-view')).toBeTruthy()
    expect(container.querySelector('.zn-sidebar-view')).toBeTruthy()
  })

  it('搜索视图：头部不再放第二个搜索入口（避免两个输入框并排）', () => {
    render(<AppSidebar {...makeProps({ view: 'search' })} />)
    expect(screen.queryByRole('button', { name: '搜索笔记…' })).toBeNull()
    expect(screen.getByText('搜索')).toBeTruthy()
  })
})
