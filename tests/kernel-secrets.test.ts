// @vitest-environment happy-dom
/**
 * `host.secrets` —— 系统凭据库的接线（rev173.106 · 2026-10-24 用户裁决「一开始就走钥匙串」）。
 *
 * 测的是三件事：
 *  · 三条调用落到**专用的** Rust 命令上（`secret_get/set/delete`），不蹭 `plugin_store_*`
 *    —— 蹭它就把凭据写进 `.zn/` 明文 JSON 了，等于这条需求没做；
 *  · 未配置时 `get` 返回 `null` 而不是抛错（插件靠它区分「没配」和「读失败」）；
 *  · `delete` 走独立命令（不是 `set('')` 之类的小聪明）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {} }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

import { createKernel } from '../src/kernel/kernel'

function makeKernel() {
  return createKernel('/vault', {} as never, {
    onPanelsChange: () => {},
    onNotify: () => {},
    onLog: () => {},
    onPanelStateChange: () => {},
  })
}

describe('host.secrets', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
  })

  it('未配置 ⇒ null（不抛错，插件据此显示「去配置」）', async () => {
    mocks.invoke.mockResolvedValueOnce(null)
    const k = makeKernel()
    await expect(k.host.secrets.get('sync.webdav.password')).resolves.toBeNull()
    expect(mocks.invoke).toHaveBeenCalledWith('secret_get', { account: 'sync.webdav.password' })
  })

  it('有值 ⇒ 原样返回', async () => {
    mocks.invoke.mockResolvedValueOnce('pa55')
    const k = makeKernel()
    await expect(k.host.secrets.get('sync.webdav.password')).resolves.toBe('pa55')
  })

  it('set 走 secret_set，参数名是 account / secret', async () => {
    mocks.invoke.mockResolvedValueOnce(undefined)
    const k = makeKernel()
    await k.host.secrets.set('sync.s3.secret', 'sk-1')
    expect(mocks.invoke).toHaveBeenCalledWith('secret_set', {
      account: 'sync.s3.secret',
      secret: 'sk-1',
    })
  })

  it('delete 走独立命令（不是写空串）', async () => {
    mocks.invoke.mockResolvedValueOnce(undefined)
    const k = makeKernel()
    await k.host.secrets.delete('sync.webdav.password')
    expect(mocks.invoke).toHaveBeenCalledWith('secret_delete', {
      account: 'sync.webdav.password',
    })
    expect(mocks.invoke).not.toHaveBeenCalledWith('secret_set', expect.anything())
  })

  it('绝不落到 plugin_store_*（那会把凭据写进库内明文 JSON）', async () => {
    mocks.invoke.mockResolvedValue(undefined)
    const k = makeKernel()
    await k.host.secrets.set('a', 'b')
    await k.host.secrets.delete('a')
    const names = mocks.invoke.mock.calls.map((c) => String(c[0]))
    expect(names.some((n) => n.startsWith('plugin_store'))).toBe(false)
  })
})

describe('net 原语在内核上可用', () => {
  it('k.net.fetch 存在（插件拿到的 ctx.net 与内核同一份实现）', () => {
    const k = makeKernel()
    expect(typeof k.net.fetch).toBe('function')
  })
})
