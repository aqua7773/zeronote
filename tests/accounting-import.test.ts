/**
 * 记账插件 CSV 导入单测（rev173.30）。
 *
 * 覆盖：微信 / 支付宝账单表头定位（跳过说明行）、金额符号、收支方向、
 * 「/」（不计收支）跳过、表头缺失报错、导入去重（交易单号 / 时间金额）。
 */
import { describe, expect, it } from 'vitest'
import { mergeImported, parseBillCsv } from '../examples/accounting/index.js'

const WECHAT = [
  '微信支付账单明细',
  '微信昵称：[测试]',
  '起始时间：[2026-10-01 00:00:00] 终止时间：[2026-10-31 23:59:59]',
  '导出类型：[全部]',
  '微信支付账单明细数据如下:',
  '----------------------微信支付账单明细列表--------------------',
  '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
  '2026-10-19 12:36:06,商户消费,美团外卖,美团外卖,支出,¥23.50,零钱,支付成功,4200001234,123,/',
  '2026-10-15 09:00:00,转账,张三,转账,收入,¥100.00,零钱,已存入零钱,4200009999,,',
  '2026-10-14 08:00:00,转账,李四,转账,/,¥50.00,零钱,已转账,4200008888,,',
  '----------------------微信支付账单明细结束--------------------',
].join('\n')

const ALIPAY = [
  '支付宝交易记录明细查询',
  '账号:[test@example.com]',
  '---------------------------------交易记录明细列表------------------------------------',
  '交易时间,交易分类,交易对方,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注',
  '2026-10-18 20:00:00,餐饮美食,肯德基,肯德基宅急送,支出,45.00,余额宝,交易成功,2026200001,2026200001,',
  '2026-10-17 10:00:00,转账红包,王五,转账,收入,200.00,余额,交易成功,2026200002,,',
].join('\n')

describe('parseBillCsv 微信账单', () => {
  const r = parseBillCsv(WECHAT)

  it('识别来源并跳过说明行', () => {
    expect(r.ok).toBe(true)
    expect(r.source).toBe('微信账单')
    expect(r.rows).toHaveLength(2)
  })

  it('支出：¥ 金额、商户、自动分类', () => {
    const t = r.rows[0]
    expect(t.amount).toBe(23.5)
    expect(t.type).toBe('expense')
    expect(t.merchant).toBe('美团外卖')
    expect(t.category).toBe('餐饮')
    expect(t.txNo).toBe('4200001234')
    expect(t.time).toBe(new Date(2026, 9, 19, 12, 36, 6).getTime())
  })

  it('收入归「收入」分类', () => {
    const t = r.rows[1]
    expect(t.type).toBe('income')
    expect(t.category).toBe('收入')
    expect(t.amount).toBe(100)
  })

  it('「/」（不计收支）跳过', () => {
    expect(r.rows.some((t) => t.merchant === '李四')).toBe(false)
  })
})

describe('parseBillCsv 支付宝账单', () => {
  const r = parseBillCsv(ALIPAY)

  it('识别来源、金额无货币符号', () => {
    expect(r.ok).toBe(true)
    expect(r.source).toBe('支付宝账单')
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0].amount).toBe(45)
    expect(r.rows[0].merchant).toBe('肯德基')
    expect(r.rows[0].category).toBe('餐饮')
    expect(r.rows[0].txNo).toBe('2026200001')
  })
})

describe('parseBillCsv 异常输入', () => {
  it('表头缺失 ⇒ ok:false 且给原因', () => {
    const r = parseBillCsv('随便一段文本\n没有表头')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('表头')
  })

  it('有表头但没有收支行 ⇒ ok:false', () => {
    const r = parseBillCsv(
      '交易时间,交易对方,收/支,金额\n2026-10-19 12:00:00,某人,/,10.00',
    )
    expect(r.ok).toBe(false)
  })
})

describe('mergeImported 去重', () => {
  const base = { amount: 23.5, type: 'expense', merchant: '美团', time: 1_700_000_000_000 }

  it('按交易单号去重', () => {
    const existing = [{ ...base, id: 'a', txNo: 'X1' }]
    const r = mergeImported(existing, [{ ...base, id: 'b', txNo: 'X1' }])
    expect(r.added).toBe(0)
    expect(r.skipped).toBe(1)
    expect(r.list).toHaveLength(1)
  })

  it('无单号时按「分钟 + 金额 + 商户 + 收支」去重', () => {
    const existing = [{ ...base, id: 'a' }]
    const same = { ...base, id: 'b', time: base.time + 30_000 } // 同一分钟
    const r = mergeImported(existing, [same])
    expect(r.added).toBe(0)
    expect(r.skipped).toBe(1)
  })

  it('不同分钟同金额 ⇒ 都保留，并按时间排序', () => {
    const existing = [{ ...base, id: 'a' }]
    const later = { ...base, id: 'b', time: base.time + 120_000 }
    const r = mergeImported(existing, [later])
    expect(r.added).toBe(1)
    expect(r.list.map((t) => t.id)).toEqual(['a', 'b'])
  })
})
