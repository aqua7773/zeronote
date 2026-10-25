/**
 * 能力自述 → 人话（rev173.156 · 第二批 UX）。
 *
 * 锁三件事：已知的翻成具体说法、**未知的原样露出**（不猜不隐藏）、批量去重保序。
 */
import { describe, expect, it } from 'vitest'
import { capabilityLabel, capabilityLabels } from '../src/lib/capability-label'

describe('capabilityLabel', () => {
  it('已知能力翻成「能做什么」', () => {
    expect(capabilityLabel('fs:read')).toBe('读你的文件')
    expect(capabilityLabel('doc:write')).toBe('改当前笔记')
    expect(capabilityLabel('net')).toBe('联网')
    expect(capabilityLabel('view:main')).toBe('主区面板')
  })

  it('老写法（已不在 contract 的 Capability 里）照样翻译', () => {
    expect(capabilityLabel('host')).toBe('宿主能力')
    expect(capabilityLabel('event')).toBe('监听事件')
  })

  it('不认识的取值原样返回 —— 宁可露出也没必要猜', () => {
    expect(capabilityLabel('weird:thing')).toBe('weird:thing')
  })

  it('空 / 空白 ⇒ 空串（批量时会被过滤掉）', () => {
    expect(capabilityLabel('')).toBe('')
    expect(capabilityLabel('   ')).toBe('')
  })
})

describe('capabilityLabels', () => {
  it('批量翻译，按原顺序，翻译后重复的只留一个', () => {
    expect(capabilityLabels(['fs:read', 'net', 'fs:read'])).toEqual(['读你的文件', '联网'])
  })

  it('空数组 / undefined ⇒ 空数组（老索引没有这个字段）', () => {
    expect(capabilityLabels([])).toEqual([])
    expect(capabilityLabels(undefined)).toEqual([])
  })
})
