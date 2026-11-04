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

let timeoutSpy: ReturnType<typeof vi.spyOn>

/** 轮询的「首次延迟」= 8000ms；settle() 用的 setTimeout(r, 0) 不算 */
const hasPollDelay = (spy: ReturnType<typeof vi.spyOn>): boolean =>
  spy.mock.calls.some((c) => typeof c[1] === 'number' && c[1] >= 5000)

afterEach(() => {
  timeoutSpy?.mockRestore()
  mocks.invoke.mockReset()
  mocks.listen.mockReset()
})

describe('fs.watch 的事件源', () => {
  it('watch_vault 成功后停轮询，事件真的派发到回调，dispose 退订', async () => {
    const handlers = listenOk()
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    timeoutSpy = vi.spyOn(window, 'setTimeout')

    const onChange = vi.fn()
    const fs = createFsApi('/vault')
    const sub = fs.watch(onChange)
    await settle()

    // ① 真的去让 Rust 起 watcher
    expect(mocks.invoke).toHaveBeenCalledWith('watch_vault', { vault: '/vault' })
    // ② 起成功了 ⇒ 不能启动轮询（否则等于周期性全库扫一遍）
    expect(hasPollDelay(timeoutSpy)).toBe(false)
    // ③ 事件能到达订阅者
    handlers[0]({ payload: { kind: 'modify', path: 'a.md' } })
    expect(onChange).toHaveBeenCalledWith({ kind: 'modify', path: 'a.md' })

    // ④ dispose ⇒ 引用计数 -1（多窗口共享同一库的 watcher）
    sub.dispose()
    await settle()
    expect(mocks.invoke).toHaveBeenCalledWith('unwatch_vault', { vault: '/vault' })
  })

  it('watch_vault 失败 ⇒ 保留轮询兜底（首次 8 秒起，不静默失效）', async () => {
    listenOk()
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'watch_vault') throw new Error('移动端不使用系统文件监听')
      return undefined
    })
    timeoutSpy = vi.spyOn(window, 'setTimeout')

    const fs = createFsApi('/vault')
    const sub = fs.watch(() => {})
    await settle()

    // 起不来 ⇒ 必须留轮询；否则外部改动就彻底没人管了
    expect(hasPollDelay(timeoutSpy)).toBe(true)
    sub.dispose()
  })

  it('旧内核没有 list_notes_light ⇒ 轮询回退到 list_notes（不许静默失效）', async () => {
    vi.useFakeTimers()
    try {
      listenOk()
      mocks.invoke.mockReset()
      const calls: string[] = []
      mocks.invoke.mockImplementation(async (cmd: string) => {
        calls.push(cmd)
        if (cmd === 'watch_vault') throw new Error('移动端不使用系统文件监听')
        // 场景：前端热更新已带新代码，但进程里还是没重编的旧 Rust 二进制
        if (cmd === 'list_notes_light') throw new Error('command list_notes_light not found')
        if (cmd === 'list_notes') return [{ path: 'a.md', mtime: 1 }]
        return undefined
      })

      const onChange = vi.fn()
      const fs = createFsApi('/vault')
      const sub = fs.watch(onChange)
      // 先把 listen → watch_vault(reject) → startPoll 这条异步链冲干净
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
      // 轮询首次延迟 8 秒：推过去，让它真的跑一轮
      await vi.advanceTimersByTimeAsync(8_100)

      expect(calls).toContain('list_notes_light')
      expect(calls, '轻量命令不可用必须退回完整版').toContain('list_notes')
      // 首轮只建基线（rev173.359）：不许把「本来就有的文件」报成 create
      expect(onChange).not.toHaveBeenCalled()

      // 第二轮出了新文件 ⇒ 降级后的完整版同样能发现
      mocks.invoke.mockImplementation(async (cmd: string) => {
        calls.push(cmd)
        if (cmd === 'list_notes') {
          return [
            { path: 'a.md', mtime: 1 },
            { path: 'b.md', mtime: 2 },
          ]
        }
        return undefined
      })
      await vi.advanceTimersByTimeAsync(10_100)
      expect(onChange).toHaveBeenCalledWith({ kind: 'create', path: 'b.md' })
      sub.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('轮询首轮只建基线，不把库里已有的文件报成 create（rev173.359）', async () => {
    vi.useFakeTimers()
    try {
      listenOk()
      mocks.invoke.mockReset()
      let files = [
        { path: 'a.md', mtime: 1 },
        { path: 'b.md', mtime: 2 },
      ]
      mocks.invoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'watch_vault') throw new Error('移动端不使用系统文件监听')
        if (cmd === 'list_notes_light') return files
        return undefined
      })

      const onChange = vi.fn()
      const fs = createFsApi('/vault')
      const sub = fs.watch(onChange)
      for (let i = 0; i < 10; i += 1) await Promise.resolve()
      // 首轮（启动后 8 秒）：库里 2 篇都是「本来就有的」⇒ 一条事件都不该发
      await vi.advanceTimersByTimeAsync(8_100)
      expect(onChange, '首轮不许把已有文件报成 create').not.toHaveBeenCalled()

      // 第二轮：多了一篇 ⇒ 只报这一条（不是把三篇全报一遍）
      files = [...files, { path: 'c.md', mtime: 3 }]
      await vi.advanceTimersByTimeAsync(10_100)
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith({ kind: 'create', path: 'c.md' })
      sub.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
