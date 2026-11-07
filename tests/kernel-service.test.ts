import { describe, expect, it } from 'vitest'

import { createServiceRegistry } from '../src/kernel/service'

/**
 * rev173.413 · 安全插件期 3 块 1：`service` 带调用方身份。
 *
 * 盯三件事：
 * ① 默认语义一个字节不变（全局一份实例、懒工厂、错误不外抛）；
 * ② `perCaller: true` 时每个调用方各跑一次工厂、各自缓存（安全插件按它做环授权）；
 * ③ 卸载调用方时清掉它的 perCaller 缓存（闭包里可能持有它自己的状态）。
 */
function makeRegistry() {
  const log: string[] = []
  const available: string[] = []
  const gone: string[] = []
  const reg = createServiceRegistry({
    onAvailable: (name) => available.push(name),
    onGone: (name) => gone.push(name),
    onLog: (msg) => log.push(msg),
  })
  return { reg, log, available, gone }
}

describe('kernel service · 调用方身份', () => {
  it('默认模式：多个调用方共享同一份实例，工厂只跑一次', async () => {
    const { reg } = makeRegistry()
    let calls = 0
    reg.scoped('provider').provide('demo', () => {
      calls += 1
      return { id: calls }
    })

    const a = await reg.scoped('a').consume<{ id: number }>('demo')
    const b = await reg.scoped('b').consume<{ id: number }>('demo')

    expect(calls).toBe(1)
    expect(a).toBe(b)
    expect(a?.id).toBe(1)
  })

  it('默认模式：factory 收到第一个调用方的 pluginId', async () => {
    const { reg } = makeRegistry()
    let seen = ''
    reg.scoped('provider').provide('demo', ({ caller }) => {
      seen = caller
      return true
    })
    void (await reg.scoped('a').consume('demo'))
    void (await reg.scoped('b').consume('demo'))
    expect(seen).toBe('a')
  })

  it('perCaller：每个调用方各跑一次工厂，互不共享', async () => {
    const { reg } = makeRegistry()
    const seen: string[] = []
    reg.scoped('security').provide(
      'crypto',
      ({ caller }) => {
        seen.push(caller)
        return { caller }
      },
      { perCaller: true },
    )

    const a = await reg.scoped('private-notes').consume<{ caller: string }>('crypto')
    const b = await reg.scoped('secrets').consume<{ caller: string }>('crypto')

    expect(seen).toEqual(['private-notes', 'secrets'])
    expect(a?.caller).toBe('private-notes')
    expect(b?.caller).toBe('secrets')
    expect(a).not.toBe(b)
  })

  it('perCaller：同一调用方二次 consume 复用缓存，工厂只跑一次', async () => {
    const { reg } = makeRegistry()
    let calls = 0
    reg.scoped('security').provide(
      'crypto',
      () => {
        calls += 1
        return { at: calls }
      },
      { perCaller: true },
    )
    const a = await reg.scoped('x').consume('crypto')
    const b = await reg.scoped('x').consume('crypto')
    expect(calls).toBe(1)
    expect(a).toBe(b)
  })

  it('工厂抛错：默认模式所有调用方都拿 null，不向外抛，日志有记录', async () => {
    const { reg, log } = makeRegistry()
    reg.scoped('bad').provide('broken', () => {
      throw new Error('boom')
    })
    await expect(reg.scoped('a').consume('broken')).resolves.toBeNull()
    await expect(reg.scoped('b').consume('broken')).resolves.toBeNull()
    expect(log.some((m) => m.includes('boom'))).toBe(true)
  })

  it('perCaller：一个调用方坏掉不影响另一个', async () => {
    const { reg, log } = makeRegistry()
    reg.scoped('security').provide(
      'crypto',
      ({ caller }) => {
        if (caller === 'evil') throw new Error('denied')
        return { caller }
      },
      { perCaller: true },
    )
    await expect(reg.scoped('evil').consume('crypto')).resolves.toBeNull()
    const good = await reg.scoped('secrets').consume<{ caller: string }>('crypto')
    expect(good?.caller).toBe('secrets')
    expect(log.some((m) => m.includes('evil'))).toBe(true)
  })

  it('并发 consume 只跑一次工厂（默认与 perCaller 一致）', async () => {
    const { reg } = makeRegistry()
    let calls = 0
    reg.scoped('security').provide(
      'crypto',
      async () => {
        calls += 1
        await Promise.resolve()
        return { at: calls }
      },
      { perCaller: true },
    )
    const [a, b] = await Promise.all([
      reg.scoped('x').consume('crypto'),
      reg.scoped('x').consume('crypto'),
    ])
    expect(calls).toBe(1)
    expect(a).toBe(b)
  })

  it('卸载调用方 ⇒ 它的 perCaller 缓存被清掉（再 consume 会重跑工厂）', async () => {
    const { reg } = makeRegistry()
    let calls = 0
    reg.scoped('security').provide(
      'crypto',
      () => {
        calls += 1
        return { at: calls }
      },
      { perCaller: true },
    )
    void (await reg.scoped('gone').consume('crypto'))
    expect(calls).toBe(1)

    reg.release('gone')
    const again = await reg.scoped('gone').consume<{ at: number }>('crypto')
    expect(calls).toBe(2)
    expect(again?.at).toBe(2)
  })

  it('内核自身（无 id）也算合法调用方', async () => {
    const { reg } = makeRegistry()
    const seen: string[] = []
    reg.scoped('security').provide(
      'crypto',
      ({ caller }) => {
        seen.push(caller)
        return true
      },
      { perCaller: true },
    )
    void (await reg.scoped('').consume('crypto'))
    expect(seen).toEqual(['kernel'])
  })
})
