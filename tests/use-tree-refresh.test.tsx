// @vitest-environment happy-dom
/**
 * `useTreeRefresh` —— 内核写盘事件 → 文件树刷新（rev173.283 · 真人测试二 #1）。
 *
 * 回归的是一个真实故障：同步插件把远端笔记写到本地后，文件树一直不出现，
 * 直到用户新建一篇才刷出来一把（watcher 的 SELF_WRITE_SILENCE_MS 吞掉自己写盘的回响）。
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TREE_REFRESH_DEBOUNCE_MS, useTreeRefresh } from '../src/hooks/useTreeRefresh'

function makeKernel() {
  const handlers = new Map<string, Set<(p: unknown) => void>>()
  return {
    handlers,
    event: {
      on: (topic: string, cb: (p: unknown) => void) => {
        let set = handlers.get(topic)
        if (!set) {
          set = new Set()
          handlers.set(topic, set)
        }
        set.add(cb)
        return { dispose: () => set!.delete(cb) }
      },
      emit: (topic: string, payload?: unknown) => {
        for (const h of [...(handlers.get(topic) ?? [])]) h(payload)
      },
    },
  }
}

describe('useTreeRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('插件写盘（note:changed）⇒ 去抖后刷新一次列表', () => {
    const k = makeKernel()
    const refresh = vi.fn()
    renderHook(() => useTreeRefresh(k as never, refresh))

    act(() => {
      k.event.emit('note:changed', { path: 'a.md', kind: 'modify', origin: 'plugin' })
    })
    expect(refresh).not.toHaveBeenCalled() // 还在去抖窗口里
    act(() => {
      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS + 10)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('一轮同步写十篇 ⇒ 只扫一次（去抖合并）', () => {
    const k = makeKernel()
    const refresh = vi.fn()
    renderHook(() => useTreeRefresh(k as never, refresh))

    act(() => {
      k.event.emit('note:created', { path: 'a.md' })
      k.event.emit('note:changed', { path: 'b.md', kind: 'modify' })
      k.event.emit('note:renamed', { from: 'c.md', to: 'd.md' })
      k.event.emit('note:deleted', { path: 'e.md' })
    })
    act(() => {
      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS + 10)
    })
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('用户保存（note:saved）不触发全库扫描', () => {
    const k = makeKernel()
    const refresh = vi.fn()
    renderHook(() => useTreeRefresh(k as never, refresh))

    act(() => {
      k.event.emit('note:saved', { path: 'a.md', text: 'x' })
    })
    act(() => {
      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS + 10)
    })
    expect(refresh).not.toHaveBeenCalled()
    // 也没有偷偷订阅它
    expect(k.handlers.has('note:saved')).toBe(false)
  })

  it('卸载后不再刷新（订阅已 dispose）', () => {
    const k = makeKernel()
    const refresh = vi.fn()
    const { unmount } = renderHook(() => useTreeRefresh(k as never, refresh))

    unmount()
    for (const topic of ['note:created', 'note:changed', 'note:renamed', 'note:deleted']) {
      expect(k.handlers.get(topic)?.size ?? 0).toBe(0)
    }
    act(() => {
      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS + 10)
    })
    expect(refresh).not.toHaveBeenCalled()
  })

  it('kernel 为空（启动中）不炸', () => {
    const refresh = vi.fn()
    expect(() => renderHook(() => useTreeRefresh(null, refresh))).not.toThrow()
    act(() => {
      vi.advanceTimersByTime(TREE_REFRESH_DEBOUNCE_MS + 10)
    })
    expect(refresh).not.toHaveBeenCalled()
  })
})
