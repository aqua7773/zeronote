// @vitest-environment happy-dom
/**
 * 「发现」（插件市场阶段 1 · rev173.148）的界面行为：
 *  · 索引拉回来后按状态显示「安装 / ↑ 更新 / 已安装」（版本用数字段比较）
 *  · 点安装先弹确认框，确认后才真正下载安装，装完切回「已安装」
 *  · 索引拉不到时**明确报错**（不是给一个空市场）
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))

import { MarketPane } from '../src/components/MarketPane'
import type { PluginRow } from '../src/components/PluginPanel'

const SHA = 'a'.repeat(64)

function b64Index(plugins: unknown[]): string {
  return Buffer.from(JSON.stringify({ schema: 1, plugins }), 'utf8').toString('base64')
}

function mockIndex(plugins: unknown[]) {
  mocks.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === 'net_request') return { status: 200, headers: {}, body_b64: b64Index(plugins) }
    return null
  })
}

function installedRow(id: string, version: string): PluginRow {
  return { id, name: id, version, enabled: true, capabilities: [] }
}

beforeEach(() => {
  mocks.invoke.mockReset()
  localStorage.clear()
})
afterEach(cleanup)

describe('发现（市场）', () => {
  it('按已装版本显示「安装 / ↑ 更新 / 已安装」', async () => {
    mockIndex([
      { id: 'tag-panel', name: '标签面板', version: '0.2.0', url: 'https://x/a.znp', sha256: SHA },
      { id: 'habit', name: '打卡', version: '0.9.0', url: 'https://x/b.znp', sha256: SHA },
      { id: 'new-one', name: '新插件', version: '1.0.0', url: 'https://x/c.znp', sha256: SHA },
    ])
    render(
      <MarketPane
        installed={[installedRow('tag-panel', '0.2.0'), installedRow('habit', '0.10.0')]}
        onInstall={vi.fn()}
        onSwitchToInstalled={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('标签面板')).toBeTruthy())
    // 同版本 ⇒ 已安装；本地 0.10.0 比索引 0.9.0 新 ⇒ 也是已安装（字符串比较会判反，变成「更新」）
    expect(screen.getAllByText('已安装')).toHaveLength(2)
    expect(screen.queryByText('↑ 更新 0.9.0')).toBeNull()
    // 没装过 ⇒ 安装
    expect(screen.getByText('安装')).toBeTruthy()
  })

  it('新版才给「↑ 更新」', async () => {
    mockIndex([
      { id: 'habit', name: '打卡', version: '0.10.0', url: 'https://x/b.znp', sha256: SHA },
    ])
    render(
      <MarketPane
        installed={[installedRow('habit', '0.9.0')]}
        onInstall={vi.fn()}
        onSwitchToInstalled={vi.fn()}
      />,
    )
    await waitFor(() => expect(screen.getByText('↑ 更新 0.10.0')).toBeTruthy())
  })

  it('点安装 → 确认框 → 确认后才调 onInstall，装完切回已安装', async () => {
    mockIndex([
      { id: 'tag-panel', name: '标签面板', version: '0.2.0', url: 'https://x/a.znp', sha256: SHA },
    ])
    const onInstall = vi.fn().mockResolvedValue('tag-panel')
    const onSwitch = vi.fn()
    render(<MarketPane installed={[]} onInstall={onInstall} onSwitchToInstalled={onSwitch} />)

    await waitFor(() => expect(screen.getByText('安装')).toBeTruthy())
    expect(onInstall).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('安装'))
    await waitFor(() => expect(screen.getByText('安装这个插件？')).toBeTruthy())

    // 确认框里的「安装」（列表里那个还在，取最后一个）
    const buttons = screen.getAllByText('安装')
    fireEvent.click(buttons[buttons.length - 1])

    await waitFor(() => expect(onInstall).toHaveBeenCalledTimes(1))
    expect(onInstall.mock.calls[0][0]).toMatchObject({
      id: 'tag-panel',
      url: 'https://x/a.znp',
      sha256: SHA,
    })
    await waitFor(() => expect(onSwitch).toHaveBeenCalled())
  })

  it('取消确认框 ⇒ 不安装', async () => {
    mockIndex([
      { id: 'tag-panel', name: '标签面板', version: '0.2.0', url: 'https://x/a.znp', sha256: SHA },
    ])
    const onInstall = vi.fn()
    render(<MarketPane installed={[]} onInstall={onInstall} onSwitchToInstalled={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('安装')).toBeTruthy())
    fireEvent.click(screen.getByText('安装'))
    await waitFor(() => expect(screen.getByText('取消')).toBeTruthy())
    fireEvent.click(screen.getByText('取消'))
    expect(onInstall).not.toHaveBeenCalled()
  })

  it('索引 404 ⇒ 报错并点明私有仓库（不是展示空市场）', async () => {
    mocks.invoke.mockResolvedValue({ status: 404, headers: {}, body_b64: '' })
    render(<MarketPane installed={[]} onInstall={vi.fn()} onSwitchToInstalled={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/HTTP 404/)).toBeTruthy())
    expect(screen.getByText(/私有仓库/)).toBeTruthy()
    expect(screen.queryByText('这个索引里没有可安装的插件。')).toBeNull()
  })

  it('坏条目被跳过且提示可见', async () => {
    mockIndex([
      { id: 'tag-panel', name: '标签面板', version: '0.2.0', url: 'https://x/a.znp', sha256: SHA },
      { id: 'broken', name: '坏条目', version: '1.0.0', url: 'https://x/b.znp', sha256: '' },
    ])
    render(<MarketPane installed={[]} onInstall={vi.fn()} onSwitchToInstalled={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('标签面板')).toBeTruthy())
    expect(screen.getByText(/1 条被跳过/)).toBeTruthy()
    expect(screen.getByText(/broken/)).toBeTruthy()
  })
})
