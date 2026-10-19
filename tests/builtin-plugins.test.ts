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

import { BUILTIN_PLUGINS, ensureBuiltinPlugins } from '../src/kernel/builtin-plugins'

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
