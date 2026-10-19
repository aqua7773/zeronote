/**
 * 记账插件统计纯函数单测（rev173.28）。
 *
 * 覆盖：月份键、分类占比汇总（只算支出 / 降序 / 占比 / 笔数）、近 6 个月趋势（补齐 / 跨年）、
 * SVG 柱状图（每月一柱 / 金额缩写 / HTML 转义）。
 */
import { describe, expect, it } from 'vitest'
import {
  monthKey,
  monthlyTrend,
  summarizeByCategory,
  trendSvg,
} from '../examples/accounting/index.js'

/** 造一条交易；时间用本地时刻构造，与 monthKey 的本地口径一致 */
const tx = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  amount: 10,
  type: 'expense',
  merchant: 'm',
  category: '餐饮',
  source: 's',
  pkg: 'p',
  time: new Date(2026, 9, 15).getTime(),
  raw: '',
  status: 'confirmed',
  ...over,
})

describe('monthKey', () => {
  it('按本地自然月补零', () => {
    expect(monthKey(new Date(2026, 0, 5).getTime())).toBe('2026-01')
    expect(monthKey(new Date(2026, 9, 31).getTime())).toBe('2026-10')
  })
})

describe('summarizeByCategory', () => {
  it('只统计当月支出，按金额降序，带占比与笔数', () => {
    const txs = [
      tx({ id: 'a', amount: 60, category: '餐饮', time: new Date(2026, 9, 1).getTime() }),
      tx({ id: 'b', amount: 40, category: '交通', time: new Date(2026, 9, 2).getTime() }),
      tx({ id: 'c', amount: 30, category: '餐饮', time: new Date(2026, 9, 3).getTime() }),
      tx({
        id: 'd',
        amount: 999,
        category: '收入',
        type: 'income',
        time: new Date(2026, 9, 4).getTime(),
      }),
      tx({ id: 'e', amount: 999, category: '餐饮', time: new Date(2026, 8, 30).getTime() }),
    ]
    const r = summarizeByCategory(txs, 2026, 10)
    expect(r.total).toBe(130)
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toMatchObject({ category: '餐饮', amount: 90, count: 2 })
    expect(r.rows[0].pct).toBeCloseTo(90 / 130)
    expect(r.rows[1]).toMatchObject({ category: '交通', amount: 40, count: 1 })
  })

  it('没有支出时 total=0、rows 为空', () => {
    expect(summarizeByCategory([], 2026, 10)).toEqual({ total: 0, rows: [] })
    expect(summarizeByCategory([tx({ type: 'income' })], 2026, 10).rows).toHaveLength(0)
  })
})

describe('monthlyTrend', () => {
  it('补齐没有记录的月份，且跨年连续', () => {
    const now = new Date(2026, 1, 15).getTime() // 2026-02
    const txs = [
      tx({ amount: 100, time: new Date(2025, 10, 1).getTime() }), // 2025-11
      tx({ amount: 50, time: new Date(2026, 1, 10).getTime() }), // 2026-02
      tx({ amount: 20, type: 'income', time: new Date(2026, 1, 11).getTime() }),
    ]
    const t = monthlyTrend(txs, 6, now)
    expect(t.map((m) => m.key)).toEqual([
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ])
    expect(t.map((m) => m.expense)).toEqual([0, 0, 100, 0, 0, 50])
    expect(t[5].income).toBe(20)
    expect(t[5].label).toBe('2月')
  })
})

describe('trendSvg', () => {
  it('每月一根柱，带月份标签', () => {
    const svg = trendSvg(monthlyTrend([], 6, new Date(2026, 9, 1).getTime()))
    expect(svg).toContain('<svg')
    expect((svg.match(/<rect/g) || []).length).toBe(6)
    expect(svg).toContain('10月')
    expect(svg).toContain('5月')
  })

  it('金额缩写为「万」，标签做 HTML 转义', () => {
    const svg = trendSvg([{ key: 'k', label: '<10月>', expense: 12345, income: 0 }])
    expect(svg).toContain('1.2万')
    expect(svg).toContain('&lt;10月&gt;')
    expect(svg).not.toContain('<10月>')
  })

  it('零支出不出金额文字，柱子仍占位', () => {
    const svg = trendSvg([
      { key: 'a', label: '1月', expense: 0, income: 0 },
      { key: 'b', label: '2月', expense: 100, income: 0 },
    ])
    expect((svg.match(/<rect/g) || []).length).toBe(2)
    expect(svg).toContain('opacity="0.15"')
  })
})
