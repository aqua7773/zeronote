// @vitest-environment happy-dom
/**
 * `host.dialog`（rev173.421）：内核只做转发，浮层由宿主实现（`App.tsx` 的 askDialog）。
 *
 * 锁住两条与 `host.prompt` 一致的约定：
 *  1. 没接 `onDialog` ⇒ **抛错**（不返回 null —— 插件会把"弹不出来"当成"用户取消"）
 *  2. 接了就把 options 原样交过去、把宿主的返回值（含 `null` = 取消）原样还给插件
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

describe('host.dialog', () => {
  it('宿主没接 onDialog ⇒ 抛错（不静默返回 null）', async () => {
    const k = makeKernel()
    await expect(k.host.dialog({ title: '新建密钥环' })).rejects.toThrow('当前宿主不支持对话框')
  })

  it('参数原样交给宿主，结果（action + state）原样还给插件', async () => {
    const onDialog = vi.fn(async () => ({ action: 'save', state: { name: 'Todo' } }))
    const k = makeKernel({ onDialog })
    const opts = {
      title: '新建密钥环',
      message: '名称只做显示',
      body: { type: 'stack' as const, children: [] },
      actions: [
        { id: 'save', label: '保存密钥环' },
        { id: 'cancel', label: '取消', variant: 'ghost' as const },
      ],
      width: 420,
    }
    const got = await k.host.dialog(opts)
    expect(onDialog).toHaveBeenCalledWith(opts)
    expect(got).toEqual({ action: 'save', state: { name: 'Todo' } })
  })

  it('用户取消（宿主回 null）⇒ 插件拿到 null，不是空对象', async () => {
    const k = makeKernel({ onDialog: async () => null })
    await expect(k.host.dialog({ title: '解锁' })).resolves.toBeNull()
  })
})
