// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

import { disableAcceleratorKeysFor, watchAcceleratorKeys } from '../src/lib/accelerator'

/**
 * rev173.70：独立窗口（note-* / plugin-*）的 Ctrl+F 也要归编辑器。
 * 这两条测试盯的是**时序**——窗口还没注册就 invoke 会拿到「窗口不存在」。
 */
function makeWin(label: string) {
  const handlers = new Map<string, () => void>()
  return {
    label,
    handlers,
    once: vi.fn((name: string, cb: () => void) => {
      handlers.set(name, cb)
      return Promise.resolve(() => {})
    }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('accelerator', () => {
  it('窗口 created 后调用后端，失败返回 false（不抛）', async () => {
    mocks.invoke.mockRejectedValue(new Error('no window'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(disableAcceleratorKeysFor('note-1')).resolves.toBe(false)
    expect(mocks.invoke).toHaveBeenCalledWith('disable_accelerator_keys_for', { label: 'note-1' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('created 触发后补设置，且只调一次（800ms 兜底不重复）', async () => {
    mocks.invoke.mockResolvedValue(true)
    const win = makeWin('plugin-x-1')
    watchAcceleratorKeys(win as never)

    win.handlers.get('tauri://created')?.()
    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('disable_accelerator_keys_for', { label: 'plugin-x-1' })

    await vi.advanceTimersByTimeAsync(900)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })

  it('created 没来（事件错过）时 800ms 兜底补一次', async () => {
    mocks.invoke.mockResolvedValue(true)
    const win = makeWin('note-2')
    watchAcceleratorKeys(win as never)
    expect(mocks.invoke).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(800)
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('disable_accelerator_keys_for', { label: 'note-2' })
  })

  it('窗口在 created 前就销毁 ⇒ 不再补调（不对已关的 label 打 warn）', async () => {
    mocks.invoke.mockResolvedValue(true)
    const win = makeWin('note-3')
    watchAcceleratorKeys(win as never)
    win.handlers.get('tauri://destroyed')?.()
    await vi.advanceTimersByTimeAsync(900)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
