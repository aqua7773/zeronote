// @vitest-environment happy-dom
/**
 * 插件版本回滚（rev173.230 · 需求 §2.14）的界面行为：
 *  · 插件行上的「版本记录」按钮能列出存档（版本 / 时间 / 大小 / 是否含数据）；
 *  · 回滚成功给出「从 vX → vY」，并让宿主重扫插件；
 *  · 数据代际降级时先拦一道：显示警示 + 「仍要回滚 / 取消」，取消什么都不动；
 *  · 纯函数（体积 / 时间）的边界。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), root: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))

vi.mock('../src/kernel/plugin-roots', () => ({
  tryGlobalPluginRoot: mocks.root,
}))

import { PluginPanel, type PluginRow } from '../src/components/PluginPanel'
import { formatBytes, formatVersionTime } from '../src/kernel/plugin-versions'

const row: PluginRow = { id: 'hello', name: 'Hello', version: '2.0.0', enabled: true, capabilities: [] }

function renderPanel(onReloadPlugins = vi.fn()) {
  render(
    <PluginPanel
      plugins={[row]}
      onToggle={vi.fn()}
      onDelete={vi.fn()}
      onInstall={vi.fn()}
      onReloadPlugins={onReloadPlugins}
    />,
  )
  return onReloadPlugins
}

const versionsState = {
  current: { version: '2.0.0', name: 'Hello', storeVersion: null, hasStore: true },
  versions: [
    {
      stamp: '1.0.0-1761600000000',
      version: '1.0.0',
      name: 'Hello',
      installedAt: 1761600000000,
      sizeBytes: 2048,
      storeVersion: 1,
      hasStore: true,
    },
  ],
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.root.mockReset()
  mocks.root.mockResolvedValue('C:/app')
  localStorage.clear()
})
afterEach(cleanup)

describe('版本记录对话框', () => {
  it('列出存档：版本 / 时间 / 大小 / 含数据', async () => {
    mocks.invoke.mockResolvedValue(versionsState)
    const { container } = render(
      <PluginPanel
        plugins={[row]}
        onToggle={vi.fn()}
        onDelete={vi.fn()}
        onInstall={vi.fn()}
      />,
    )
    fireEvent.click(container.querySelector('.zn-plugin-hist') as HTMLElement)
    await screen.findByText('v1.0.0')
    expect(screen.getByText(formatBytes(2048))).toBeTruthy()
    expect(screen.getByText(formatVersionTime(1761600000000))).toBeTruthy()
    expect(screen.getByText('含数据')).toBeTruthy()
    expect(mocks.invoke).toHaveBeenCalledWith('list_plugin_versions', {
      vault: 'C:/app',
      pluginId: 'hello',
    })
  })

  it('回滚成功：提示 vX → vY 并让宿主重扫', async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'list_plugin_versions') return versionsState
      if (cmd === 'rollback_plugin')
        return {
          status: 'ok',
          fromVersion: '2.0.0',
          toVersion: '1.0.0',
          dataBackup: 'C:/app/.zn/plugin-versions/hello/_backup/1-store.json',
          storeRestored: false,
          warning: null,
        }
      return null
    })
    const onReload = renderPanel()
    fireEvent.click(document.body.querySelector('.zn-plugin-hist') as HTMLElement)
    await screen.findByText('v1.0.0')
    fireEvent.click(screen.getByRole('button', { name: '回滚' }))
    await screen.findByText(/已回滚：v2\.0\.0 → v1\.0\.0/)
    expect(onReload).toHaveBeenCalled()
    expect(mocks.invoke).toHaveBeenCalledWith('rollback_plugin', {
      vault: 'C:/app',
      pluginId: 'hello',
      stamp: '1.0.0-1761600000000',
      force: false,
    })
  })

  it('数据代际降级：先拦一道，取消不动；确认后才 force 回滚', async () => {
    let rolled = 0
    mocks.invoke.mockImplementation(async (cmd: string, args: { force?: boolean }) => {
      if (cmd === 'list_plugin_versions') return versionsState
      if (cmd === 'rollback_plugin') {
        rolled++
        if (!args.force) {
          return {
            status: 'needConfirm',
            fromVersion: '2.0.0',
            toVersion: '1.0.0',
            reason: '当前 v2.0.0 的数据格式是第 2 代，v1.0.0 只认第 1 代 —— 直接回滚可能让数据不可用',
            dataBackup: null,
          }
        }
        return {
          status: 'ok',
          fromVersion: '2.0.0',
          toVersion: '1.0.0',
          dataBackup: null,
          storeRestored: true,
          warning: null,
        }
      }
      return null
    })
    renderPanel()
    fireEvent.click(document.body.querySelector('.zn-plugin-hist') as HTMLElement)
    await screen.findByText('v1.0.0')
    fireEvent.click(screen.getByRole('button', { name: '回滚' }))

    // 警示出现；此时还没有第二次调用
    await screen.findByText(/可能让数据不可用/)
    expect(rolled).toBe(1)
    expect(screen.getByRole('button', { name: '仍要回滚' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '仍要回滚' }))
    await waitFor(() => expect(rolled).toBe(2))
    await screen.findByText(/数据也回退到该版本快照/)
  })
})

describe('formatBytes / formatVersionTime', () => {
  it('按 1024 进一位，边界不出现 NaN', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.5 MB')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })

  it('时间戳缺失给 —，正常值可读', () => {
    expect(formatVersionTime(0)).toBe('—')
    expect(formatVersionTime(Number.NaN)).toBe('—')
    expect(formatVersionTime(new Date(2026, 9, 28, 4, 12).getTime())).toBe('2026-10-28 04:12')
  })
})
