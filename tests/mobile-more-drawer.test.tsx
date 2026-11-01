// @vitest-environment happy-dom
/**
 * 手机右侧「更多」抽屉（rev173.308 起；rev173.313 改成单栏钻入）。
 *
 * 用户 2026-11-01：「设置现在移动端还是悬浮窗口……把更多的那些项目都放到设置页
 * （或者改名叫更多，因为不止设置功能），然后这个页面在桌面端的形态是悬浮窗口，
 * 在移动端的形态就是右侧栏」。
 *
 * 验收口径：
 *  · 首屏 = 8 个内核条目（搜索 / 回收站 / 切换库 / 插件中心 + 通用 / 附件 / 插件 / 关于）；
 *  · 动作类点击 → `onAction(id)`（宿主收起抽屉再做）；
 *  · 设置类点击 → `onViewChange(tab)`，**在同一栏里展开**（不再弹第二个浮窗）；
 *  · 二级页有返回，返回回到菜单；
 *  · 插件类入口**传了才渲染**（零插件时整组消失）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileMoreDrawer, type MobileMoreDrawerProps } from '../src/components/MobileMoreDrawer'

afterEach(cleanup)

function makeProps(over: Partial<MobileMoreDrawerProps> = {}): MobileMoreDrawerProps {
  return {
    vault: '/storage/emulated/0/Documents/ZeroNote',
    noteCount: 44,
    view: 'menu',
    onViewChange: vi.fn(),
    onClose: vi.fn(),
    onAction: vi.fn(),
    // SettingsSectionProps 的必填项（本测试只走菜单与「通用」页，其余给空实现）
    onPickVault: vi.fn(),
    themePref: 'system',
    onThemeChange: vi.fn(),
    onFocusModeChange: vi.fn(),
    renderHtml: true,
    onRenderHtmlChange: vi.fn(),
    onImageModeChange: vi.fn(),
    ...over,
  }
}

describe('MobileMoreDrawer（单栏钻入）', () => {
  it('动作类四条目全在，点击交给 onAction', () => {
    const props = makeProps()
    render(<MobileMoreDrawer {...props} />)
    const cases: [RegExp, string][] = [
      [/^搜索/, 'search'],
      [/^回收站/, 'trash'],
      [/^切换笔记库/, 'vaults'],
      [/^插件中心/, 'plugin-center'],
    ]
    for (const [re, id] of cases) {
      fireEvent.click(screen.getByRole('button', { name: re }))
      expect(props.onAction).toHaveBeenLastCalledWith(id)
    }
    expect(props.onAction).toHaveBeenCalledTimes(4)
  })

  it('设置三分组点击 ⇒ onViewChange(tab)，不弹浮窗（rev173.313）', () => {
    const props = makeProps()
    render(<MobileMoreDrawer {...props} />)
    const cases: [RegExp, string][] = [
      [/^通用/, 'general'],
      [/^附件/, 'assets'],
      [/^关于/, 'about'],
    ]
    for (const [re, tab] of cases) {
      fireEvent.click(screen.getByRole('button', { name: re }))
      expect(props.onViewChange).toHaveBeenLastCalledWith(tab)
    }
    expect(props.onViewChange).toHaveBeenCalledTimes(3)
  })

  it('二级页在同一条栏里展开，并带「返回更多」', () => {
    const props = makeProps({ view: 'general' })
    render(<MobileMoreDrawer {...props} />)
    // 二级页头部有分组名与返回；菜单条目不再出现
    expect(screen.queryByRole('button', { name: /^搜索/ })).toBeNull()
    const back = screen.getByRole('button', { name: '返回更多' })
    fireEvent.click(back)
    expect(props.onViewChange).toHaveBeenCalledWith('menu')
  })

  it('二级页也能直接关闭整条抽屉', () => {
    const props = makeProps({ view: 'general' })
    render(<MobileMoreDrawer {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭更多' }))
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('菜单首屏有关闭按钮，回调 onClose', () => {
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
