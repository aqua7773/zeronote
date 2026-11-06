// @vitest-environment happy-dom
/**
 * `host.prompt`（rev173.405）：内核只做转发，浮层由宿主实现（`App.tsx` 的 askPrompt）。
 *
 * 锁住两条容易退化的约定：
 *  1. **没接 `onPrompt` 就抛错** —— 静默返回空串会让插件把"没输入"当成"空密码"去调解锁；
 *  2. 接了就把 option 原样交过去、把宿主的返回值（含 `null` = 取消）原样还给插件。
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

describe('host.prompt', () => {
  it('宿主没接 onPrompt ⇒ 抛错（不静默返回空串）', async () => {
    const k = makeKernel()
    await expect(k.host.prompt({ title: '解锁' })).rejects.toThrow('当前宿主不支持输入对话框')
  })

  it('参数原样交给宿主，返回值原样还给插件', async () => {
    const onPrompt = vi.fn(async () => 'secret-123')
    const k = makeKernel({ onPrompt })
    const got = await k.host.prompt({
      title: '解锁私密笔记',
      message: '输入主密码',
      placeholder: '主密码',
      secret: true,
      okText: '解锁',
    })
    expect(got).toBe('secret-123')
    expect(onPrompt).toHaveBeenCalledWith({
      title: '解锁私密笔记',
      message: '输入主密码',
      placeholder: '主密码',
      secret: true,
      okText: '解锁',
    })
  })

  it('用户取消（宿主回 null）⇒ 插件拿到 null，不是空串', async () => {
    const k = makeKernel({ onPrompt: async () => null })
    await expect(k.host.prompt({ secret: true })).resolves.toBeNull()
  })
})
