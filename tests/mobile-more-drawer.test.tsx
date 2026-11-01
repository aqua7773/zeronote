// @vitest-environment happy-dom
/**
 * 手机右侧「更多」抽屉（rev173.308 起；rev173.312 合并设置）。
 *
 * 2026-10-31 用户：「移动端不做底部导航栏……搜索放进更多里面，更多改成右滑出现的右侧栏」。
 * 2026-11-01 用户：「设置跟更多页面合并，现在更多下面有设置，设置里面又有通用、附件、
 * 插件、关于」—— 于是设置**不再单独一行**，四个分组直接铺在「更多」里，点哪行进哪个 tab。
 *
 * 验收口径：内核入口恒在（搜索 / 回收站 / 切换库 / 插件中心 + 设置四分组）；
 * 插件类入口**传了才渲染**（零插件时整组消失，不留灰位）；关闭按钮可用；
 * **「设置」这个中间层已经不在了**（rev173.312 去重）。
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
    ...over,
  }
}

describe('MobileMoreDrawer', () => {
  it('笔记类入口全在，且点击回调正确', () => {
    const props = makeProps()
    render(<MobileMoreDrawer {...props} />)
    for (const name of ['搜索', '回收站', '切换笔记库', '插件中心']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: /搜索/ }))
    expect(props.onOpenSearch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /回收站/ }))
    expect(props.onOpenTrash).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /插件中心/ }))
    expect(props.onOpenPlugins).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /切换笔记库/ }))
    expect(props.onOpenVaults).toHaveBeenCalledTimes(1)
  })

  it('设置四分组直接铺开，各自把 tab id 传给 onOpenSettings（rev173.312）', () => {
    const props = makeProps()
    render(<MobileMoreDrawer {...props} />)
    const cases: [RegExp, string][] = [
      [/^通用/, 'general'],
      [/^附件/, 'assets'],
      // 「插件中心」那行也以「插件」开头，用 hint 首段区分
      [/^插件 已安装/, 'plugins'],
      [/^关于/, 'about'],
    ]
    for (const [re, tab] of cases) {
      fireEvent.click(screen.getByRole('button', { name: re }))
      expect(props.onOpenSettings).toHaveBeenLastCalledWith(tab)
    }
    expect(props.onOpenSettings).toHaveBeenCalledTimes(4)
  })

  it('「设置」中间层与重复的「关于 ZeroNote」行都不再存在', () => {
    render(<MobileMoreDrawer {...makeProps()} />)
    expect(screen.queryByRole('button', { name: /^设置$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /关于 ZeroNote/ })).toBeNull()
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

  it('插件入口传了才出现（零插件时整组消失，不留灰位）', () => {
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
