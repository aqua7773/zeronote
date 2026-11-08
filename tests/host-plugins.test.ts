// @vitest-environment happy-dom
/**
 * `host.installedPlugins()`（rev173.420）—— 宿主经 `KernelHooks.listPlugins` 给快照。
 *
 * 锁住两条约定：
 *  1. 宿主没接 `listPlugins` ⇒ 返回**空数组**（功能降级，不抛错 —— 拿不到清单不该让插件崩）
 *  2. 接了就把**每次调用现取**的结果给插件（宿主侧用 ref 保证装卸插件后是最新清单）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kernel, KernelHooks } from '../src/kernel/kernel'

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

function makeKernel(extra: Partial<KernelHooks> = {}): Kernel {
  mocks.invoke.mockImplementation(async () => null)
  return createKernel('/vault', {} as never, {
    onPanelsChange: () => {},
    onNotify: () => {},
    onLog: () => {},
    onPanelStateChange: () => {},
    ...extra,
  })
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.listen.mockClear()
})

describe('host.installedPlugins', () => {
  it('宿主没接 listPlugins ⇒ 空数组（不抛错）', () => {
    const k = makeKernel()
    expect(k.host.installedPlugins()).toEqual([])
  })

  it('listPlugins 抛错 ⇒ 仍然返回空数组（插件侧不该因为清单坏掉整页崩）', () => {
    const k = makeKernel({
      listPlugins: () => {
        throw new Error('boom')
      },
    })
    expect(k.host.installedPlugins()).toEqual([])
  })

  it('每次调用都现取最新清单（宿主用 ref ⇒ 装卸插件后能看到变化）', () => {
    let list: { id: string; name?: string; version?: string }[] = []
    const k = makeKernel({ listPlugins: () => list })
    expect(k.host.installedPlugins()).toEqual([])
    list = [{ id: 'security', name: '安全', version: '0.3.5' }]
    expect(k.host.installedPlugins()).toEqual([{ id: 'security', name: '安全', version: '0.3.5' }])
  })
})
