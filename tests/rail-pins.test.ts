/**
 * 图标栏插件固定区（目标态 ② · 方案 §2.1）—— 纯逻辑。
 * 重点测两件容易写错的事：**上限 3** 与 **坏数据容错**（localStorage 里可能是任意脏值）。
 */
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  RAIL_PINS_KEY,
  RAIL_PINS_MAX,
  loadRailPins,
  normalizePins,
  saveRailPins,
  toggleRailPin,
} from '../src/lib/rail-pins'

beforeEach(() => {
  localStorage.clear()
})

describe('normalizePins', () => {
  it('只留非空字符串，去重，截到 3 个', () => {
    expect(normalizePins(['a', '', '  ', 'a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c'])
  })

  it('非数组 / 混入别的类型 ⇒ 空的或只留字符串', () => {
    expect(normalizePins(null)).toEqual([])
    expect(normalizePins({ 0: 'a' })).toEqual([])
    expect(normalizePins(['a', 1, true, 'b'])).toEqual(['a', 'b'])
  })

  it('上限就是 3（常量与行为一致）', () => {
    expect(RAIL_PINS_MAX).toBe(3)
    expect(normalizePins(['1', '2', '3', '4'])).toHaveLength(3)
  })
})

describe('loadRailPins / saveRailPins', () => {
  it('往返一致，且存的是清洗后的值', () => {
    saveRailPins(['tag-panel', 'tag-panel', '', 'accounting'])
    expect(JSON.parse(localStorage.getItem(RAIL_PINS_KEY) as string)).toEqual([
      'tag-panel',
      'accounting',
    ])
    expect(loadRailPins()).toEqual(['tag-panel', 'accounting'])
  })

  it('坏 JSON / 没存过 ⇒ 空数组（不抛错）', () => {
    expect(loadRailPins()).toEqual([])
    localStorage.setItem(RAIL_PINS_KEY, '{不是 json')
    expect(loadRailPins()).toEqual([])
  })

  it('存了 5 个（旧版本写的 / 手改的）⇒ 读出来只剩 3 个', () => {
    localStorage.setItem(RAIL_PINS_KEY, JSON.stringify(['a', 'b', 'c', 'd', 'e']))
    expect(loadRailPins()).toEqual(['a', 'b', 'c'])
  })
})

describe('toggleRailPin', () => {
  it('没固定过 ⇒ 追加到末尾', () => {
    expect(toggleRailPin([], 'tag-panel')).toEqual({ pins: ['tag-panel'], overflow: false })
    expect(toggleRailPin(['a'], 'b')).toEqual({ pins: ['a', 'b'], overflow: false })
  })

  it('已固定 ⇒ 取消（顺序不变）', () => {
    expect(toggleRailPin(['a', 'b', 'c'], 'b')).toEqual({ pins: ['a', 'c'], overflow: false })
  })

  it('满 3 个再固定 ⇒ 不改变，返回 overflow（UI 要提示，而不是静默失败）', () => {
    expect(toggleRailPin(['a', 'b', 'c'], 'd')).toEqual({
      pins: ['a', 'b', 'c'],
      overflow: true,
    })
  })

  it('脏输入先清洗再切换', () => {
    expect(toggleRailPin(['a', 'a', '', 'b'], 'c')).toEqual({
      pins: ['a', 'b', 'c'],
      overflow: false,
    })
  })
})
