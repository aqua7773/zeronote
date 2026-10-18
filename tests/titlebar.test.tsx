// @vitest-environment happy-dom
/**
 * 标题栏按钮行为（rev132 + rev133 · 2026-10-18 用户要求）。
 *
 * 桌面：☰ 左键 = 文件树栏开关，右键 = 菜单；
 * 移动端：☰ 左键 = 抽屉开关，旁边的「⋯」= 菜单（手机没有右键，菜单必须有可见入口）；
 * 兼容：不传 `onToggleSidebar` 时，☰ 左键仍是菜单（旧行为）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TitleBar } from '../src/components/TitleBar'

afterEach(cleanup)

function renderBar({ toggle = false, menuButton = false } = {}) {
  const onMenu = vi.fn()
  const onToggleSidebar = toggle ? vi.fn() : undefined
  render(
    <TitleBar
      title="t"
      saveLabel=""
      onMenu={onMenu}
      showWindowControls={false}
      showMenuButton={menuButton}
      {...(onToggleSidebar ? { onToggleSidebar } : {})}
    />,
  )
  return { onMenu, onToggleSidebar }
}

describe('TitleBar ☰ / ⋯', () => {
  it('桌面：左键切换文件树栏，不弹菜单', () => {
    const { onMenu, onToggleSidebar } = renderBar({ toggle: true })
    fireEvent.click(screen.getByRole('button', { name: '切换文件树栏' }))
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
    expect(onMenu).not.toHaveBeenCalled()
  })

  it('桌面：右键 ☰ 弹菜单（菜单唯一入口）', () => {
    const { onMenu } = renderBar({ toggle: true })
    fireEvent.contextMenu(screen.getByRole('button', { name: '切换文件树栏' }))
    expect(onMenu).toHaveBeenCalledWith({ x: 0, y: 32 })
  })

  it('移动端：☰ 切换抽屉、⋯ 弹菜单（两个按钮分工）', () => {
    const { onMenu, onToggleSidebar } = renderBar({ toggle: true, menuButton: true })
    fireEvent.click(screen.getByRole('button', { name: '切换文件树栏' }))
    expect(onToggleSidebar).toHaveBeenCalledTimes(1)
    expect(onMenu).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    expect(onMenu).toHaveBeenCalledWith({ x: 0, y: 32 })
  })

  it('不传 onToggleSidebar：左键仍是菜单（兼容旧行为），且不显示 ⋯', () => {
    const { onMenu } = renderBar()
    expect(screen.queryByRole('button', { name: '菜单' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '菜单' }))
    expect(onMenu).toHaveBeenCalledWith({ x: 0, y: 32 })
    expect(screen.queryByRole('button', { name: '切换文件树栏' })).toBeNull()
  })
})
