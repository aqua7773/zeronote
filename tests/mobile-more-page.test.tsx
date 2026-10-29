// @vitest-environment happy-dom
/**
 * 手机「更多」全屏页（UI 重布局 B2 · 方案 §2.2）。
 *
 * 验收口径：内核入口恒在（设置 / 回收站 / 切换库 / 插件管理 / 关于）；
 * 插件类入口**传了才渲染**（零插件时整组消失，不留灰位）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMorePage } from '../src/components/MobileMorePage'

afterEach(cleanup)

function makeProps(over: Record<string, unknown> = {}) {
  return {
    vault: '/storage/emulated/0/Documents/ZeroNote',
    noteCount: 44,
    onOpenSettings: vi.fn(),
    onOpenTrash: vi.fn(),
    onOpenVaults: vi.fn(),
    onOpenPlugins: vi.fn(),
    onAbout: vi.fn(),
    ...over,
  }
}

describe('MobileMorePage', () => {
  it('内核入口全在，且点击回调正确', () => {
    const props = makeProps()
    render(<MobileMorePage {...props} />)
    for (const name of ['回收站', '切换笔记库', '插件管理', '设置', '关于 ZeroNote']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: /设置/ }))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /回收站/ }))
    expect(props.onOpenTrash).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /插件管理/ }))
    expect(props.onOpenPlugins).toHaveBeenCalledTimes(1)
  })

  it('库信息显示在标题下（库名 + 篇数）', () => {
    render(<MobileMorePage {...makeProps()} />)
    expect(screen.getByText(/ZeroNote · 44 篇/)).toBeTruthy()
  })

  it('没有库时给中性文案，不显示路径', () => {
    render(<MobileMorePage {...makeProps({ vault: null, noteCount: 0 })} />)
    expect(screen.getByText('还没选择笔记库')).toBeTruthy()
  })

  it('插件入口传了才出现（零插件时整组消失，不留空标题）', () => {
    const { container, rerender } = render(<MobileMorePage {...makeProps()} />)
    // 默认没有插件入口 ⇒ 没有「插件」分组标题
    expect(container.textContent).not.toContain('插件\n')
    expect(screen.queryByRole('button', { name: /标签/ })).toBeNull()

    const onTag = vi.fn()
    rerender(
      <MobileMorePage
        {...makeProps()}
        pluginEntries={[{ key: 'tag', label: '标签', hint: '按标签浏览', plugin: true, onClick: onTag }]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /标签/ }))
    expect(onTag).toHaveBeenCalledTimes(1)
  })
})
