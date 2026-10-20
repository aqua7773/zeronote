/**
 * 记账插件预算纯函数单测（rev173.73）。
 *
 * 覆盖：本月支出按分类汇总 / 剩余与使用率 / 超支排序 / 收入与上月不计 / 预算 ≤ 0 忽略。
 */
import { describe, expect, it } from 'vitest'
import { budgetStatus } from '../examples/accounting/index.js'

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

describe('budgetStatus', () => {
  it('按分类汇总本月支出，算剩余与使用率', () => {
    const rows = budgetStatus(
      [tx({ amount: 60 }), tx({ id: 'b', amount: 30, category: '交通' })],
      { 餐饮: 200, 交通: 50 },
      2026,
      10,
    )
    const food = rows.find((r) => r.category === '餐饮')!
    expect(food).toMatchObject({ budget: 200, spent: 60, left: 140, over: false })
    expect(food.pct).toBeCloseTo(0.3)

    const bus = rows.find((r) => r.category === '交通')!
    expect(bus.over).toBe(false)
    expect(bus.left).toBe(20)
  })

  it('超支的排前面，再按使用率降序', () => {
    const rows = budgetStatus(
      [
        tx({ amount: 300, category: '餐饮' }),
        tx({ id: 'b', amount: 10, category: '交通' }),
        tx({ id: 'c', amount: 90, category: '购物' }),
      ],
      { 餐饮: 200, 交通: 100, 购物: 100 },
      2026,
      10,
    )
    expect(rows[0].category).toBe('餐饮')
    expect(rows[0].over).toBe(true)
    expect(rows[1].category).toBe('购物')
  })

  it('只算支出、只算本月；没设预算的分类不出现', () => {
    const rows = budgetStatus(
      [
        tx({ amount: 500, type: 'income' }),
        tx({ id: 'b', amount: 999, time: new Date(2026, 8, 15).getTime() }),
        tx({ id: 'c', amount: 20, category: '医疗' }),
      ],
      { 餐饮: 100 },
      2026,
      10,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].spent).toBe(0)
  })

  it('预算 ≤ 0 忽略', () => {
    expect(budgetStatus([tx()], { 餐饮: 0 }, 2026, 10)).toHaveLength(0)
    expect(budgetStatus([tx()], {}, 2026, 10)).toHaveLength(0)
  })
})
