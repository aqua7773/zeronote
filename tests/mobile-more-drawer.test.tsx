// @vitest-environment happy-dom
/**
 * 手机右侧「更多」抽屉（rev173.308）。
 *
 * 取代 B2 的「更多」底部 tab 全屏页：用户 2026-10-31「移动端不做底部导航栏……
 * 搜索放进更多里面，更多改成右滑出现的右侧栏」。
 *
 * 验收口径：内核入口恒在（**搜索** / 设置 / 回收站 / 切换库 / 插件中心 / 关于）；
 * 插件类入口**传了才渲染**（零插件时整组消失，不留灰位）；关闭按钮可用。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMoreDrawer } from '../src/components/MobileMoreDrawer'

afterEach(cleanup)

function makeProps(over: Record<string, unknown> = {}) {
  return {
    vault: '/storage/emulated/0/Documents/ZeroNote',
    noteCount: 44,
    onClose: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenTrash: vi.fn(),
    onOpenVaults: vi.fn(),
    onOpenPlugins: vi.fn(),
    onAbout: vi.fn(),
    ...over,
  }
}

describe('MobileMoreDrawer', () => {
  it('内核入口全在（含底栏删掉后搬进来的「搜索」），且点击回调正确', () => {
    const props = makeProps()
    render(<MobileMoreDrawer {...props} />)
    for (const name of ['搜索', '回收站', '切换笔记库', '插件中心', '设置', '关于 ZeroNote']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    expect(props.onOpenSearch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /设置/ }))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /回收站/ }))
    expect(props.onOpenTrash).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /插件中心/ }))
    expect(props.onOpenPlugins).toHaveBeenCalledTimes(1)
  })

  it('关闭按钮（✕）回调 onClose', () => {
    const props = makeProps()
    render(<MobileMoreDrawer {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭更多' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('库信息显示在标题下（库名 + 篇数）', () => {
    render(<MobileMoreDrawer {...makeProps()} />)
    expect(screen.getByText(/ZeroNote · 44 篇/)).toBeTruthy()
  })

  it('没有库时给中性文案，不显示路径', () => {
    render(<MobileMoreDrawer {...makeProps({ vault: null, noteCount: 0 })} />)
    expect(screen.getByText('还没选择笔记库')).toBeTruthy()
  })

  it('插件入口传了才出现（零插件时整组消失，不留空标题）', () => {
    const { container, rerender } = render(<MobileMoreDrawer {...makeProps()} />)
    // 默认没有插件入口 ⇒ 没有「插件」分组标题
    expect(container.textContent).not.toContain('插件\n')
    // `/标签/` 会误中「搜索」行的 hint（全文 / 标签 / 目录）⇒ 用行首锚定
    expect(screen.queryByRole('button', { name: /^标签/ })).toBeNull()

    const onTag = vi.fn()
    rerender(
      <MobileMoreDrawer
        {...makeProps()}
        pluginEntries={[{ key: 'tag', label: '标签', hint: '按标签浏览', plugin: true, onClick: onTag }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^标签/ }))
    expect(onTag).toHaveBeenCalledTimes(1)
  })
})
