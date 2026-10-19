// @vitest-environment happy-dom
/**
 * 插件来源解析的错误通道（rev173.41）。
 *
 * 以前 `collectPluginDirs` 把"读不到插件目录"吞成空数组 —— 用户只看到插件全没了。
 * 现在失败必须经 `onError` 交出去（插件页 / toast 用它）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  appDataDir: vi.fn(async () => 'C:/appdata/'),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: mocks.appDataDir }))

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.appDataDir.mockReset()
  mocks.appDataDir.mockResolvedValue('C:/appdata/')
  vi.resetModules()
})

describe('collectPluginDirs', () => {
  it('正常：返回全局根下的条目', async () => {
    mocks.invoke.mockResolvedValue(['outline-map', 'accounting'])
    const { collectPluginDirs } = await import('../src/kernel/plugin-roots')

    const entries = await collectPluginDirs()

    expect(entries).toEqual([
      { dir: 'outline-map', root: 'C:/appdata', source: 'global' },
      { dir: 'accounting', root: 'C:/appdata', source: 'global' },
    ])
  })

  it('读目录失败：不静默，onError 收到原因', async () => {
    mocks.invoke.mockRejectedValue(new Error('EACCES'))
    const { collectPluginDirs } = await import('../src/kernel/plugin-roots')
    const errors: string[] = []

    const entries = await collectPluginDirs((m) => errors.push(m))

    expect(entries).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('EACCES')
  })

  it('解析全局根失败：也要上报', async () => {
    mocks.appDataDir.mockRejectedValue(new Error('no appdata'))
    const { collectPluginDirs } = await import('../src/kernel/plugin-roots')
    const errors: string[] = []

    const entries = await collectPluginDirs((m) => errors.push(m))

    expect(entries).toEqual([])
    expect(errors[0]).toContain('no appdata')
  })
})
