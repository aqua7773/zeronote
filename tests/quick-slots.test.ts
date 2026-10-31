// @vitest-environment happy-dom
/**
 * 环形快捷入口 5 格配置（rev173.281 · J#9）。
 *
 * 锁四件事：
 *  ① 默认值固定 5 格，第 1 格沿用改造前的「记账」；
 *  ② 读坏了 / 长度不对 ⇒ 规整成 5 格（不炸、不把别的槽挤掉）；
 *  ③ 写进去再读回来一致（持久化）；
 *  ④ key → 标签：插件面板按 id 找 title，内置动作按表查，未知 key 返回 null（当空槽）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  BUILTIN_QUICK_OPTIONS,
  DEFAULT_QUICK_SLOTS,
  QUICK_SLOTS_KEY,
  QUICK_SLOT_COUNT,
  normalizeQuickSlots,
  quickSlotLabel,
  quickSlotOptions,
  readQuickSlots,
  writeQuickSlots,
} from '../src/lib/quick-slots'

beforeEach(() => {
  localStorage.clear()
})

describe('quick-slots 5 格配置', () => {
  it('默认 5 格：第 1 格是记账（未装时环上灰位），其余都是内置入口', () => {
    expect(DEFAULT_QUICK_SLOTS).toHaveLength(QUICK_SLOT_COUNT)
    // 面板 id 是 accounting.ledger（插件 id 是 accounting，面板挂在 .ledger 上）
    expect(DEFAULT_QUICK_SLOTS[0]).toBe('panel:accounting.ledger')
    for (const key of DEFAULT_QUICK_SLOTS.slice(1)) {
      expect(key?.startsWith('builtin:')).toBe(true)
    }
  })

  it('normalize：长度不足补 null、多余截断、非法值归 null', () => {
    expect(normalizeQuickSlots(['a', 42, '  ', null, 'e', 'f'])).toEqual(['a', null, null, null, 'e'])
    expect(normalizeQuickSlots(null)).toEqual([null, null, null, null, null])
  })

  it('没存过 ⇒ 默认值；写进去再读回来一致', () => {
    expect(readQuickSlots()).toEqual(DEFAULT_QUICK_SLOTS)
    const custom = ['builtin:search', null, 'panel:import-export', 'builtin:trash', 'builtin:settings']
    writeQuickSlots(custom)
    expect(readQuickSlots()).toEqual(custom)
  })

  it('存了坏 JSON ⇒ 回落默认值（不抛）', () => {
    localStorage.setItem(QUICK_SLOTS_KEY, '{oops')
    expect(readQuickSlots()).toEqual(DEFAULT_QUICK_SLOTS)
  })

  it('quickSlotLabel：面板按 id 找 title · 内置按表查 · 未知返回 null', () => {
    const panels = [{ id: 'accounting', title: '记账' }]
    expect(quickSlotLabel('panel:accounting', panels)).toBe('记账')
    expect(quickSlotLabel('builtin:trash', panels)).toBe('回收站')
    expect(quickSlotLabel('panel:gone', panels)).toBeNull()
    expect(quickSlotLabel('builtin:nope', panels)).toBeNull()
    expect(quickSlotLabel(null, panels)).toBeNull()
  })

  it('quickSlotOptions：面板在前、内置在后（面板 id 用 panel: 前缀）', () => {
    const opts = quickSlotOptions([{ id: 'accounting', title: '记账' }])
    expect(opts[0]).toEqual({ key: 'panel:accounting', label: '记账' })
    expect(opts).toHaveLength(1 + BUILTIN_QUICK_OPTIONS.length)
    expect(opts.map((o) => o.key)).toContain('builtin:search')
  })

  it('内置候选里没有「新建笔记」—— 它固定在中心 ＋，不占 5 格', () => {
    expect(BUILTIN_QUICK_OPTIONS.map((o) => o.key)).not.toContain('builtin:newNote')
  })

  it('内置候选里也没有「时间流」—— 桌面不需要手机 ＋ 环里的这个入口（rev173.303）', () => {
    expect(BUILTIN_QUICK_OPTIONS.map((o) => o.key)).not.toContain('builtin:timeline')
  })
})
