// @vitest-environment happy-dom
/**
 * 核心能力接管（需求 §2.15 · rev173.231）的注册表语义：
 *  · 没插件 ⇒ 内核默认实现；
 *  · 插件 provide 即接管、Disposable 释放即回退；
 *  · 优先级大的胜出；同优先级取最早登记并标「需要选择」，用户选择被记住；
 *  · 防重入：实现内部再调同一能力 ⇒ 走默认（拿原始结果，不会无限递归）；
 *  · 坏实现抛错要 reject（静默空表比报错更危险）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCapabilityRegistry } from '../src/kernel/capability'

beforeEach(() => localStorage.clear())

function setup() {
  const onLog = vi.fn()
  const onChange = vi.fn()
  const r = createCapabilityRegistry({ onLog, onChange })
  r.setDefault('search.query', (q: unknown) => ({ from: 'kernel', q }))
  r.setDefault('storage.read', (p: unknown) => `disk:${String(p)}`)
  return { r, onLog, onChange }
}

describe('核心能力注册表', () => {
  it('没有插件接管时走内核默认实现', async () => {
    const { r } = setup()
    await expect(r.invoke('search.query', 'x')).resolves.toEqual({ from: 'kernel', q: 'x' })
    expect(r.selection('search.query').active).toBe('kernel')
  })

  it('插件 provide 即接管，Disposable 释放即回退', async () => {
    const { r } = setup()
    const d = r.scoped('p1').provide('search.query', () => ({ from: 'p1' }), { priority: 1 })
    await expect(r.invoke('search.query', 'x')).resolves.toEqual({ from: 'p1' })
    d.dispose()
    await expect(r.invoke('search.query', 'x')).resolves.toEqual({ from: 'kernel', q: 'x' })
  })

  it('优先级大的胜出（与登记顺序无关），它卸载后落到次高', async () => {
    const { r } = setup()
    r.scoped('low').provide('search.query', () => 'low', { priority: 1 })
    r.scoped('high').provide('search.query', () => 'high', { priority: 5 })
    expect(await r.invoke('search.query', '')).toBe('high')
    r.release('high')
    expect(await r.invoke('search.query', '')).toBe('low')
  })

  it('同优先级：先取最早登记的，并标记需要用户选择', async () => {
    const { r } = setup()
    r.scoped('a').provide('search.query', () => 'a')
    r.scoped('b').provide('search.query', () => 'b')
    const s = r.selection('search.query')
    expect(s.needsChoice).toBe(true)
    expect(s.active).toBe('a')
    expect(s.top.map((t) => t.pluginId).sort()).toEqual(['a', 'b'])
    expect(await r.invoke('search.query', '')).toBe('a')
  })

  it('用户选择被记住；清除后回到「需要选择」', async () => {
    const { r } = setup()
    r.scoped('a').provide('search.query', () => 'a')
    r.scoped('b').provide('search.query', () => 'b')
    r.setChoice('search.query', 'b')
    expect(r.selection('search.query').needsChoice).toBe(false)
    expect(await r.invoke('search.query', '')).toBe('b')

    r.setChoice('search.query', null)
    expect(r.selection('search.query').needsChoice).toBe(true)
    expect(await r.invoke('search.query', '')).toBe('a')
  })

  it('防重入：插件实现内部再调同一能力 ⇒ 走内核默认', async () => {
    const { r } = setup()
    r.scoped('p').provide('search.query', async (q: unknown) => {
      const raw = await r.invoke('search.query', q)
      return { wrapped: raw }
    })
    await expect(r.invoke('search.query', 'x')).resolves.toEqual({
      wrapped: { from: 'kernel', q: 'x' },
    })
  })

  it('不同能力互不干扰：storage.read 的接管者可以照常调 search.query', async () => {
    const { r } = setup()
    r.scoped('p').provide('storage.read', async (p: unknown) => `p:${String(p)}`)
    expect(await r.invoke('storage.read', 'a.md')).toBe('p:a.md')
    expect(await r.invoke('search.query', 'x')).toEqual({ from: 'kernel', q: 'x' })
  })

  it('坏实现抛错要 reject，不静默返回空表', async () => {
    const { r } = setup()
    r.scoped('bad').provide('search.query', () => {
      throw new Error('boom')
    })
    await expect(r.invoke('search.query', '')).rejects.toThrow('boom')
  })

  it('实现不是函数 ⇒ 当场报错（别等第一次搜索才炸）', () => {
    const { r } = setup()
    expect(() =>
      r.scoped('p').provide('search.query', 123 as unknown as (...a: unknown[]) => unknown),
    ).toThrow(/必须是函数/)
  })

  it('status 反映 hasFallback / providers / needsChoice', () => {
    const { r } = setup()
    r.scoped('a').provide('search.query', () => 'a')
    r.scoped('b').provide('search.query', () => 'b')
    const st = r.status().find((s) => s.name === 'search.query')
    expect(st?.hasFallback).toBe(true)
    expect(st?.providers.map((p) => p.pluginId).sort()).toEqual(['a', 'b'])
    expect(st?.needsChoice).toBe(true)
    // 没登记默认实现的能力 hasFallback 应为 false（storage.write 在 setup 里没注册）
    expect(r.status().find((s) => s.name === 'storage.write')?.hasFallback).toBe(false)
  })
})
