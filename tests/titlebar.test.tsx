// @vitest-environment happy-dom
/**
 * 标题栏 ☰ 按钮行为（rev132 · 2026-10-18 用户要求）。
 *
 * 桌面：左键 = 文件树栏开关，右键 = 菜单（菜单唯一入口从 ☰ 左键让给右键）；
 * 移动端（不传 onToggleSidebar）：左键仍是菜单 —— 抽屉集成在菜单里，行为不能变。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TitleBar } from '../src/components/TitleBar'

afterEach(cleanup)

function renderBar({ withToggle = false } = {}) {
  const onMenu = vi.fn()
  const onToggleSidebar = withToggle ? vi.fn() : undefined
  render(
    <TitleBar
      title="t"
      saveLabel=""
      onMenu={onMenu}
      showWindowControls={false}
      {...(onToggleSidebar ? { onToggleSidebar } : {})}
    />,
  )
  return { onMenu, onToggleSidebar }
}

describe('TitleBar ☰', () => {
  it('桌面：左键切换文件树栏，不弹菜单', () => {
    const { onMenu, onToggleSidebar } = renderBar({ withToggle: true })
    fireEvent.click(screen.getByRole('button', { name: '切换文件树栏' }))
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('桌面：右键 ☰ 弹菜单（菜单唯一入口）', () => {
    const { onMenu } = renderBar({ withToggle: true })
    fireEvent.contextMenu(screen.getByRole('button', { name: '切换文件树栏' }))
    expect(onMenu).toHaveBeenCalledWith({ x: 0, y: 32 })
  })

  it('移动端（不传 onToggleSidebar）：左键仍是菜单，右键不额外处理', () => {
    const { onMenu } = renderBar()
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    expect(onMenu).toHaveBeenCalledWith({ x: 0, y: 32 })

    onMenu.mockClear()
    fireEvent.contextMenu(screen.getByRole('button', { name: '菜单' }))
    expect(onMenu).not.toHaveBeenCalled()
  })
})
