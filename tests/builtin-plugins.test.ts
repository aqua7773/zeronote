// @vitest-environment happy-dom
/**
 * 内置插件写入失败的可见性（rev173.41）。
 *
 * 以前写失败只有 `console.warn` ⇒ 用户看到「导图/阅读器/记账没了」却没有任何原因。
 * 现在 `ensureBuiltinPlugins` 返回失败清单，由调用方提示。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))

import { BUILTIN_PLUGINS, compareVersions, ensureBuiltinPlugins } from '../src/kernel/builtin-plugins'

beforeEach(() => {
  mocks.invoke.mockReset()
})

describe('ensureBuiltinPlugins', () => {
  it('内容一致：不写盘，返回空失败清单', async () => {
    // read_plugin_file 一律返回与内置内容相同的值 —— 但内容未知，
    // 这里退而求其次：让读成功且写入成功，断言没有失败项
    mocks.invoke.mockResolvedValue(null)
    const r = await ensureBuiltinPlugins('C:/appdata')
    expect(r.failed).toEqual([])
  })

  it('写盘失败：逐条进失败清单（带插件与文件）', async () => {
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_plugin_file') throw new Error('missing')
      if (cmd === 'write_plugin_file') throw new Error('EACCES')
      return null
    })
    const r = await ensureBuiltinPlugins('C:/appdata')

    const expected = BUILTIN_PLUGINS.reduce((n, p) => n + Object.keys(p.files).length, 0)
    expect(r.failed).toHaveLength(expected)
    expect(r.failed[0].error).toContain('EACCES')
    expect(r.failed[0].pluginId).toBeTruthy()
    expect(r.failed[0].rel).toBeTruthy()
  })

  it('只有部分文件失败：清单只含失败项', async () => {
    let n = 0
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'read_plugin_file') throw new Error('missing')
      if (cmd === 'write_plugin_file') {
        n++
        if (n === 1) throw new Error('EACCES')
      }
      return null
    })
    const r = await ensureBuiltinPlugins('C:/appdata')
    expect(r.failed).toHaveLength(1)
  })
})

describe('compareVersions（数字段按数值比，不是字符串序）', () => {
  it('1.10.0 > 1.9.0（字符串比较会得出相反的答案）', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
  })

  it('相等 / 前缀 v / 段数不同', () => {
    expect(compareVersions('0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('v0.2.0', '0.2.0')).toBe(0)
    expect(compareVersions('0.2', '0.2.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1)
  })
})

/**
 * **不覆盖的两种情况**（rev173.147 · 插件市场的前置修复）。
 *
 * 以前「内容不同就覆盖」⇒ ① 从市场装的官方插件新版重启后被内置版盖回去；
 * ② 覆盖后目录里残留的 `signature.json` 与新内容对不上 ⇒ 插件变「拒载」（不是简单回退）。
 */
describe('ensureBuiltinPlugins 不覆盖（rev173.147）', () => {
  const target = BUILTIN_PLUGINS.find((p) => p.id === 'tag-panel')!
  const builtinVer = JSON.parse(target.files['manifest.json']).version as string

  /** 让「已装目录」看起来是这样：只有 outline-map 存在，其它插件一律不存在 */
  function mockInstalled(opts: { version?: string; signed?: boolean }) {
    mocks.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      if (cmd === 'read_plugin_file') {
        if (args?.pluginId !== 'tag-panel') throw new Error('missing')
        if (args?.rel === 'signature.json') {
          if (opts.signed) return '{"alg":"ed25519","keyId":"aqua-2026","sig":"x"}'
          throw new Error('missing')
        }
        if (args?.rel === 'manifest.json') {
          return JSON.stringify({ id: 'tag-panel', version: opts.version ?? builtinVer })
        }
        return '/* 用户装的旧版内容 */'
      }
      return null
    })
  }

  function writesFor(pluginId: string) {
    return mocks.invoke.mock.calls.filter(
      ([cmd, args]) => cmd === 'write_plugin_file' && (args as Record<string, unknown>)?.pluginId === pluginId,
    )
  }

  it('已装版本比内置新：不覆盖（不把市场装的更新版偷偷回退）', async () => {
    mockInstalled({ version: '9.9.9' })
    const r = await ensureBuiltinPlugins('C:/appdata')
    expect(r.skipped).toContainEqual({ pluginId: 'tag-panel', reason: 'newer' })
    expect(writesFor('tag-panel')).toHaveLength(0)
  })

  it('有 signature.json：一个字节都不写（写了签名就对不上 ⇒ 拒载）', async () => {
    mockInstalled({ signed: true, version: builtinVer })
    const r = await ensureBuiltinPlugins('C:/appdata')
    expect(r.skipped).toContainEqual({ pluginId: 'tag-panel', reason: 'signed' })
    expect(writesFor('tag-panel')).toHaveLength(0)
  })

  it('同版本内容不同：照旧覆盖（升级 / 修复路径不能被新规则挡住）', async () => {
    mockInstalled({ version: builtinVer })
    const r = await ensureBuiltinPlugins('C:/appdata')
    expect(writesFor('tag-panel').length).toBeGreaterThan(0)
    expect(r.skipped.find((s) => s.pluginId === 'tag-panel')).toBeUndefined()
  })

  it('已装版本比内置旧：覆盖（应用升级时内置插件跟着走）', async () => {
    mockInstalled({ version: '0.0.1' })
    const r = await ensureBuiltinPlugins('C:/appdata')
    expect(writesFor('tag-panel').length).toBeGreaterThan(0)
    expect(r.skipped.find((s) => s.pluginId === 'tag-panel')).toBeUndefined()
  })
})
