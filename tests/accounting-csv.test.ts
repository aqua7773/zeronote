/**
 * 记账插件 CSV 导出单测（rev173.29）。
 *
 * 覆盖：表头、BOM、金额两位小数、收支映射、RFC 4180 转义（逗号 / 双引号 / 换行）、空账本。
 */
import { describe, expect, it } from 'vitest'
import { toCsv } from '../examples/accounting/index.js'

const tx = (over: Record<string, unknown> = {}) => ({
  id: 'x',
  amount: 23.5,
  type: 'expense',
  merchant: '美团',
  category: '餐饮',
  source: '微信',
  time: new Date(2026, 9, 5, 12, 34, 56).getTime(),
  raw: '',
  status: 'confirmed',
  ...over,
})

describe('toCsv', () => {
  it('表头 + 一行数据 + BOM', () => {
    const csv = toCsv([tx()])
    expect(csv.startsWith('\uFEFF')).toBe(true)
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n')
    expect(lines[0]).toBe('时间,类型,金额,商户,分类,来源,状态')
    expect(lines[1]).toBe('2026-10-05 12:34:56,支出,23.50,美团,餐饮,微信,已确认')
  })

  it('收入与待补状态映射成中文', () => {
    const csv = toCsv([tx({ type: 'income', status: 'pending' })])
    expect(csv).toContain(',收入,')
    expect(csv).toContain('金额待补')
  })

  it('金额补两位小数', () => {
    expect(toCsv([tx({ amount: 8 })])).toContain(',8.00,')
    expect(toCsv([tx({ amount: 8.999 })])).toContain(',9.00,')
  })

  it('含逗号 / 双引号 / 换行的字段按 RFC 4180 转义', () => {
    const csv = toCsv([
      tx({ merchant: '美团,外卖', category: '餐饮"特殊"', source: '微信\n支付' }),
    ])
    expect(csv).toContain('"美团,外卖"')
    expect(csv).toContain('"餐饮""特殊"""')
    expect(csv).toContain('"微信\n支付"')
  })

  it('空账本只输出表头', () => {
    const lines = toCsv([]).replace(/^\uFEFF/, '').trim().split('\r\n')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toBe('时间,类型,金额,商户,分类,来源,状态')
  })

  it('可以关闭 BOM（给只认纯文本的消费方）', () => {
    expect(toCsv([], { bom: false }).startsWith('\uFEFF')).toBe(false)
  })
})
