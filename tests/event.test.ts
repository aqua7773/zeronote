import { describe, expect, it, vi } from 'vitest'
import { createEventApi } from '../src/kernel/event'

describe('event 总线', () => {
  it('on + emit 把 payload 送给订阅者', () => {
    const bus = createEventApi()
    const seen: unknown[] = []
    bus.on('note:saved', (p) => seen.push(p))
    bus.emit('note:saved', { id: 'n1' })
    expect(seen).toEqual([{ id: 'n1' }])
  })

  it('dispose 后不再收到事件，且 topic 条目被清掉', () => {
    const bus = createEventApi()
    const seen: unknown[] = []
    const sub = bus.on('t', (p) => seen.push(p))
    sub.dispose()
    bus.emit('t', 1)
    expect(seen).toEqual([])
    expect(bus.stats()).toEqual({})
  })

  it('同一 handler 只订阅一次（Set 语义）', () => {
    const bus = createEventApi()
    const seen: unknown[] = []
    const h = (p: unknown) => seen.push(p)
    bus.on('t', h)
    bus.on('t', h)
    bus.emit('t', 1)
    expect(seen).toEqual([1])
  })

  it('一个 handler 抛错不影响其它订阅者，并回调 onHandlerError', () => {
    const errors: unknown[] = []
    const bus = createEventApi((topic, err) => errors.push([topic, err]))
    const seen: unknown[] = []
    bus.on('t', () => {
      throw new Error('boom')
    })
    bus.on('t', (p) => seen.push(p))
    bus.emit('t', 'ok')
    expect(seen).toEqual(['ok'])
    expect(errors).toHaveLength(1)
    expect((errors[0] as [string, Error])[0]).toBe('t')
  })

  it('emit 无订阅者的 topic 是空操作', () => {
    const bus = createEventApi()
    expect(() => bus.emit('nobody', 1)).not.toThrow()
  })

  it('disposeAll 清掉一批订阅，单个 dispose 抛错不阻断其它', () => {
    const bus = createEventApi()
    const seen: unknown[] = []
    const bad = bus.on('t', () => {})
    const good = bus.on('t', (p) => seen.push(p))
    vi.spyOn(bad, 'dispose').mockImplementation(() => {
      throw new Error('bad dispose')
    })
    bus.disposeAll([bad, good])
    bus.emit('t', 1)
    expect(seen).toEqual([])
  })

  it('stats 反映每个 topic 的订阅者数', () => {
    const bus = createEventApi()
    bus.on('a', () => {})
    bus.on('a', () => {})
    bus.on('b', () => {})
    expect(bus.stats()).toEqual({ a: 2, b: 1 })
  })
})
