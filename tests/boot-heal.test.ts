import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * boot-heal 在**模块顶层**执行 `bootSelfHeal()`（读 localStorage）。
 * 所以这里不能静态 import —— 每条用例先准备好替身存储，再动态 import（`vi.resetModules()` 保证重新执行）。
 */
const store = new Map<string, string>()
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, String(v))
  },
  removeItem: (k: string) => {
    store.delete(k)
  },
  clear: () => store.clear(),
}
vi.stubGlobal('localStorage', fakeStorage)

const LS_LOADING = 'zeronote.plugins.loading'
const LS_DISABLED = 'zeronote.plugins.disabled'

beforeEach(() => {
  store.clear()
  vi.resetModules()
})

describe('启动自愈', () => {
  it('没有卡死标记 ⇒ 什么都不做', async () => {
    const mod = await import('../src/lib/boot-heal')
    expect(mod.bootAutoDisabled.size).toBe(0)
    expect(mod.bootAutoDisabledNotice).toBeNull()
  })

  it('读到卡死标记 ⇒ 并入禁用集合、给出提示、标记清掉', async () => {
    store.set(LS_LOADING, JSON.stringify({ id: 'bad-plugin', t: 1 }))
    const mod = await import('../src/lib/boot-heal')
    expect(mod.bootAutoDisabled.has('bad-plugin')).toBe(true)
    expect(mod.bootAutoDisabledNotice).toContain('bad-plugin')
    expect(store.has(LS_LOADING)).toBe(false)
  })

  it('标记是坏 JSON ⇒ 不抛、不误伤', async () => {
    store.set(LS_LOADING, '{oops')
    const mod = await import('../src/lib/boot-heal')
    expect(mod.bootAutoDisabled.size).toBe(0)
  })

  it('标记里没有 id ⇒ 忽略', async () => {
    store.set(LS_LOADING, JSON.stringify({ t: 1 }))
    const mod = await import('../src/lib/boot-heal')
    expect(mod.bootAutoDisabled.size).toBe(0)
  })
})

describe('loadDisabled', () => {
  it('读已禁用集合', async () => {
    store.set(LS_DISABLED, JSON.stringify(['a', 'b']))
    const mod = await import('../src/lib/boot-heal')
    expect([...mod.loadDisabled()].sort()).toEqual(['a', 'b'])
  })

  it('坏 JSON ⇒ 空集合', async () => {
    store.set(LS_DISABLED, 'nope')
    const mod = await import('../src/lib/boot-heal')
    expect(mod.loadDisabled().size).toBe(0)
  })

  it('把启动自愈认出的插件并进去并落盘', async () => {
    store.set(LS_DISABLED, JSON.stringify(['ok']))
    store.set(LS_LOADING, JSON.stringify({ id: 'bad' }))
    const mod = await import('../src/lib/boot-heal')
    const set = mod.loadDisabled()
    expect(set.has('ok')).toBe(true)
    expect(set.has('bad')).toBe(true)
    // 落盘：下次启动不会再加载 bad
    expect(JSON.parse(store.get(LS_DISABLED) ?? '[]')).toEqual(expect.arrayContaining(['ok', 'bad']))
  })
})
