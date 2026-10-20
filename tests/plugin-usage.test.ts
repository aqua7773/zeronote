/**
 * 插件能力使用审计（rev173.78）。
 *
 * 测的是纯逻辑：计数合并、加载/卸载标记、节流落盘、坏数据容错。
 * Proxy 包装在 `plugin-host.ts`（依赖 Tauri），端到端靠 CDP 的 `__znPluginUsage()`。
 */
import { describe, expect, it, vi } from 'vitest'
import { UsageRecorder } from '../src/kernel/plugin-usage'

const fixedClock = (start = 1000) => {
  let t = start
  return { now: () => t, tick: (ms: number) => (t += ms) }
}

describe('UsageRecorder 记录', () => {
  it('同一 API 多次调用累计次数，first 不变、last 更新', () => {
    const clock = fixedClock()
    const r = new UsageRecorder({ now: clock.now, flushEveryMs: 0 })
    r.record('demo', 'store.get')
    clock.tick(10)
    r.record('demo', 'store.get')
    clock.tick(10)
    r.record('demo', 'fs.read')

    const book = r.snapshot()
    expect(book.plugins.demo.apis['store.get']).toEqual({ count: 2, first: 1000, last: 1010 })
    expect(book.plugins.demo.apis['fs.read']).toEqual({ count: 1, first: 1020, last: 1020 })
  })

  it('不同插件分开记', () => {
    const r = new UsageRecorder({ flushEveryMs: 0 })
    r.record('a', 'store.get')
    r.record('b', 'doc.save')
    expect(Object.keys(r.snapshot().plugins).sort()).toEqual(['a', 'b'])
  })

  it('空 pluginId / 空 api 被忽略（不让脏数据进文件）', () => {
    const r = new UsageRecorder({ flushEveryMs: 0 })
    r.record('', 'store.get')
    r.record('demo', '')
    expect(r.snapshot().plugins).toEqual({})
  })
})

describe('加载 / 卸载标记', () => {
  it('markLoaded 刷新 loadedAt，历史 API 记录保留', () => {
    const clock = fixedClock()
    const r = new UsageRecorder({ now: clock.now, flushEveryMs: 0 })
    r.markLoaded('demo')
    r.record('demo', 'store.get')
    clock.tick(500)
    r.markLoaded('demo')
    const e = r.snapshot().plugins.demo
    expect(e.loadedAt).toBe(1500)
    expect(e.apis['store.get'].count).toBe(1)
  })

  it('markUnloaded 只清 loadedAt，不删记录', () => {
    const r = new UsageRecorder({ flushEveryMs: 0 })
    r.markLoaded('demo')
    r.record('demo', 'fs.read')
    r.markUnloaded('demo')
    expect(r.snapshot().plugins.demo.loadedAt).toBe(0)
    expect(r.snapshot().plugins.demo.apis['fs.read'].count).toBe(1)
  })
})

describe('落盘节流', () => {
  it('flushEveryMs = 0 时每次记录立即落盘', () => {
    const sink = vi.fn()
    const r = new UsageRecorder({ flushEveryMs: 0, sink })
    r.record('demo', 'store.get')
    expect(sink).toHaveBeenCalledTimes(1)
    r.record('demo', 'store.set')
    expect(sink).toHaveBeenCalledTimes(2)
  })

  it('有节流时不立刻落盘，flush() 才写', () => {
    const sink = vi.fn()
    const r = new UsageRecorder({ flushEveryMs: 60000, sink })
    r.record('demo', 'store.get')
    expect(sink).toHaveBeenCalledTimes(0)
    r.flush()
    expect(sink).toHaveBeenCalledTimes(1)
  })

  it('没变化时 flush 不重复写', () => {
    const sink = vi.fn()
    const r = new UsageRecorder({ flushEveryMs: 0, sink })
    r.record('demo', 'store.get')
    const calls = sink.mock.calls.length
    r.flush()
    expect(sink.mock.calls.length).toBe(calls)
  })

  it('sink 抛错 / reject 都不会冒到调用方', () => {
    const r = new UsageRecorder({
      flushEveryMs: 0,
      sink: () => {
        throw new Error('disk full')
      },
    })
    expect(() => r.record('demo', 'store.get')).not.toThrow()
  })

  it('dispose 清定时器并 flush', () => {
    const sink = vi.fn()
    const r = new UsageRecorder({ flushEveryMs: 60000, sink })
    r.record('demo', 'store.get')
    r.dispose()
    expect(sink).toHaveBeenCalledTimes(1)
  })
})

describe('restore / reset', () => {
  it('恢复合法审计', () => {
    const r = new UsageRecorder({ flushEveryMs: 0 })
    r.restore({
      version: 1,
      updatedAt: 1,
      plugins: { demo: { loadedAt: 0, apis: { 'fs.read': { count: 3, first: 1, last: 2 } } } },
    })
    expect(r.snapshot().plugins.demo.apis['fs.read'].count).toBe(3)
  })

  it('坏数据一律忽略（版本不符 / 结构不对 / 字段缺）', () => {
    const r = new UsageRecorder({ flushEveryMs: 0 })
    r.restore(null)
    r.restore({ version: 2, plugins: {} })
    r.restore('oops')
    expect(r.snapshot().plugins).toEqual({})
    // 插件条目存在但 API 记录字段不对 ⇒ 只跳过那一条，不整份丢弃
    r.restore({ version: 1, plugins: { demo: { apis: { 'fs.read': { count: 'x' } } } } })
    expect(r.snapshot().plugins.demo.apis).toEqual({})
  })

  it('reset 单个 / 全部', () => {
    const r = new UsageRecorder({ flushEveryMs: 0 })
    r.record('a', 'x')
    r.record('b', 'y')
    r.reset('a')
    expect(Object.keys(r.snapshot().plugins)).toEqual(['b'])
    r.reset()
    expect(r.snapshot().plugins).toEqual({})
  })

  it('snapshot 是深拷贝（改它不影响记录器）', () => {
    const r = new UsageRecorder({ flushEveryMs: 0 })
    r.record('demo', 'x')
    const s = r.snapshot()
    s.plugins.demo.apis.x.count = 999
    expect(r.snapshot().plugins.demo.apis.x.count).toBe(1)
  })
})
