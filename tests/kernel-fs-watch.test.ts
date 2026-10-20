// @vitest-environment happy-dom
/**
 * fs.watch 的**事件源接线**（rev173.59）。
 *
 * 修的是 P0：`listen('zn://fs-change')` 对任何事件名都会成功，旧代码一见成功就
 * `stopPoll()` —— 而 Rust 侧从来没发过这个事件 ⇒ 外部改动完全不刷新，轮询兜底也被关掉。
 *
 * 现在的纪律是「`watch_vault` 真的把 watcher 起起来才算数」：
 *   · 起成功 ⇒ 停轮询（桌面：由 Rust watcher 发事件）；
 *   · 起失败（移动端 / 库不存在 / 系统 watcher 不可用）⇒ 保留 3 秒轮询。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))

import { createFsApi } from '../src/kernel/fs'

/** 让 async 链（listen → then → await invoke → stopPoll / startPoll）跑完 */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

/** 装一个会成功的 listen，并拿到事件回调（`handlers[0]` 就是 fs.watch 的监听器） */
function listenOk(): Array<(ev: { payload: unknown }) => void> {
  const handlers: Array<(ev: { payload: unknown }) => void> = []
  mocks.listen.mockImplementation(
    async (_name: string, cb: (ev: { payload: unknown }) => void) => {
      handlers.push(cb)
      return () => {}
    },
  )
  return handlers
}

let intervalSpy: ReturnType<typeof vi.spyOn>

afterEach(() => {
  intervalSpy?.mockRestore()
  mocks.invoke.mockReset()
  mocks.listen.mockReset()
})

describe('fs.watch 的事件源', () => {
  it('watch_vault 成功后停轮询，事件真的派发到回调，dispose 退订', async () => {
    const handlers = listenOk()
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    intervalSpy = vi.spyOn(window, 'setInterval')

    const onChange = vi.fn()
    const fs = createFsApi('/vault')
    const sub = fs.watch(onChange)
    await settle()

    // ① 真的去让 Rust 起 watcher
    expect(mocks.invoke).toHaveBeenCalledWith('watch_vault', { vault: '/vault' })
    // ② 起成功了 ⇒ 不能启动轮询（否则等于每 3 秒全库扫一遍）
    expect(intervalSpy).not.toHaveBeenCalled()
    // ③ 事件能到达订阅者
    handlers[0]({ payload: { kind: 'modify', path: 'a.md' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'modify', path: 'a.md' })

    // ④ dispose ⇒ 引用计数 -1（多窗口共享同一库的 watcher）
    sub.dispose()
    await settle()
    expect(mocks.invoke).toHaveBeenCalledWith('unwatch_vault', { vault: '/vault' })
  })

  it('watch_vault 失败 ⇒ 保留 3 秒轮询兜底（不静默失效）', async () => {
    listenOk()
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'watch_vault') throw new Error('移动端不使用系统文件监听')
      return undefined
    })
    intervalSpy = vi.spyOn(window, 'setInterval')

    const fs = createFsApi('/vault')
    const sub = fs.watch(() => {})
    await settle()

    // 起不来 ⇒ 必须留轮询；否则外部改动就彻底没人管了
    expect(intervalSpy).toHaveBeenCalled()
    sub.dispose()
  })
})
