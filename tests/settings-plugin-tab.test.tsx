// @vitest-environment happy-dom
/**
 * 设置 · 插件 tab（B3 瘦身 · 方案 §5 / §6）。
 *
 * 锁三条：
 *  · 设置里**不再有插件列表**（列表只在插件中心画一次，防止两处漂移）；
 *  · 摘要给出「N 个已安装 / M 个可更新」，点「打开插件中心」由宿主接管；
 *  · 「启动时检查更新」开关仍留在设置里（它只标角标、不装东西）。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Settings, type SettingsProps } from '../src/components/Settings'

afterEach(cleanup)

const base: SettingsProps = {
  open: true,
  onOpenChange: vi.fn(),
  vault: '/vault',
  onPickVault: vi.fn(),
  themePref: 'system',
  onThemeChange: vi.fn(),
  renderHtml: true,
  onRenderHtmlChange: vi.fn(),
  imageMode: 'original',
  onImageModeChange: vi.fn(),
}

describe('设置 · 插件 tab（B3 瘦身）', () => {
  it('只有摘要与「打开插件中心」，没有任何插件列表', () => {
    const onOpenPluginCenter = vi.fn()
    const { container } = render(
      <Settings
        {...base}
        initialTab="plugins"
        pluginCount={3}
        pluginUpdateCount={1}
        onOpenPluginCenter={onOpenPluginCenter}
        autoCheckUpdates
        onAutoCheckChange={vi.fn()}
      />,
    )

    expect(screen.getByText(/3 个已安装/)).toBeTruthy()
    expect(screen.getByText(/1 个可更新/)).toBeTruthy()

    // 插件中心那套 DOM 一个都不该在设置里出现
    expect(container.querySelector('.zn-plugin-row')).toBeNull()
    expect(container.querySelector('.zn-plugin-list')).toBeNull()
    expect(container.querySelector('.zn-plugins-tabs')).toBeNull()
    expect(container.querySelector('.zn-market')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '打开插件中心' }))
    expect(onOpenPluginCenter).toHaveBeenCalledTimes(1)
  })

  it('启动检查更新开关仍在，并能回传', () => {
    const onAutoCheckChange = vi.fn()
    render(
      <Settings
        {...base}
        initialTab="plugins"
        autoCheckUpdates
        onAutoCheckChange={onAutoCheckChange}
      />,
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '启动时检查插件更新' }))
    expect(onAutoCheckChange).toHaveBeenCalledWith(false)
  })

  it('不传入口 ⇒ 不画「打开插件中心」（独立窗口 / 测试）', () => {
    render(<Settings {...base} initialTab="plugins" />)
    expect(screen.queryByRole('button', { name: '打开插件中心' })).toBeNull()
  })
})
