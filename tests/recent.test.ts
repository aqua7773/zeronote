import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadRecentCommands,
  loadRecentVaults,
  LS_RECENT_CMDS,
  persistRecentVaults,
  RECENT_CMDS_MAX,
  RECENT_VAULTS_MAX,
} from '../src/lib/recent'

/** 极简 localStorage 替身（node 环境没有它） */
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

const LS_RECENT_VAULTS = 'zeronote.vaults.recent'

beforeEach(() => {
  store.clear()
})

describe('最近打开过的库', () => {
  it('没有记录 ⇒ 空数组', () => {
    expect(loadRecentVaults()).toEqual([])
  })

  it('写回后再读回', () => {
    persistRecentVaults(['C:\\a', 'C:\\b'])
    expect(loadRecentVaults()).toEqual(['C:\\a', 'C:\\b'])
  })

  it('超过上限会被截断', () => {
    const many = Array.from({ length: RECENT_VAULTS_MAX + 3 }, (_, i) => `C:\\v${i}`)
    store.set(LS_RECENT_VAULTS, JSON.stringify(many))
    expect(loadRecentVaults()).toHaveLength(RECENT_VAULTS_MAX)
  })

  it('坏 JSON ⇒ 空数组（不抛）', () => {
    store.set(LS_RECENT_VAULTS, '{oops')
    expect(loadRecentVaults()).toEqual([])
  })

  it('非数组 ⇒ 空数组', () => {
    store.set(LS_RECENT_VAULTS, '{"a":1}')
    expect(loadRecentVaults()).toEqual([])
  })

  it('过滤掉非字符串项', () => {
    store.set(LS_RECENT_VAULTS, JSON.stringify(['a', 1, null, 'b']))
    expect(loadRecentVaults()).toEqual(['a', 'b'])
  })
})

describe('最近用过的命令', () => {
  it('没有记录 ⇒ 空数组', () => {
    expect(loadRecentCommands()).toEqual([])
  })

  it('按上限截断', () => {
    const many = Array.from({ length: RECENT_CMDS_MAX + 2 }, (_, i) => `core.c${i}`)
    store.set(LS_RECENT_CMDS, JSON.stringify(many))
    expect(loadRecentCommands()).toHaveLength(RECENT_CMDS_MAX)
  })

  it('坏 JSON ⇒ 空数组', () => {
    store.set(LS_RECENT_CMDS, 'not json')
    expect(loadRecentCommands()).toEqual([])
  })
})
