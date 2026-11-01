// @vitest-environment happy-dom
/**
 * 插件中心 · 启动检查开关（rev173.315）。
 *
 * 用户 2026-11-01：「更多页面里同时存在笔记-插件中心，和设置-插件，两个同类项目没有合并」。
 * 合并后「设置 → 插件」整页删掉，唯一独有的一项「启动时检查插件更新」搬进了插件中心。
 *
 * 锁两条：
 *  · 传了回调 ⇒「已安装」tab 里能看到开关，点击回传；
 *  · 没传 ⇒ 不渲染（独立窗口 / 测试环境）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PluginPanel } from '../src/components/PluginPanel'

afterEach(cleanup)

const base = {
  plugins: [],
  onToggle: vi.fn(),
  onDelete: vi.fn(),
}

describe('插件中心 · 启动检查开关（rev173.315 从设置搬来）', () => {
  it('传了回调 ⇒ 开关在，「已安装」tab 里能点，回传 false', () => {
    const onAutoCheckChange = vi.fn()
    render(<PluginPanel {...base} autoCheckUpdates onAutoCheckChange={onAutoCheckChange} />)
    const box = screen.getByRole('checkbox', { name: '启动时检查插件更新' })
    expect((box as HTMLInputElement).checked).toBe(true)
    fireEvent.click(box)
    expect(onAutoCheckChange).toHaveBeenCalledWith(false)
  })

  it('没传回调 ⇒ 不渲染这一行', () => {
    render(<PluginPanel {...base} />)
    expect(screen.queryByRole('checkbox', { name: '启动时检查插件更新' })).toBeNull()
  })
})
