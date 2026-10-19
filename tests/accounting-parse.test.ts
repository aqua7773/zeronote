/**
 * 记账插件的解析/分类纯函数单测（rev173.16）。
 *
 * 覆盖：金额提取优先级、支付通知判定、收支方向、商户提取、自动分类、跨来源去重。
 * 解析规则参考 WhereIsMyMoney（Apache-2.0）与 AutoAccounting 的实现，按我们自己的文案表收敛。
 */
import { describe, expect, it } from 'vitest'
import {
  classify,
  dedupeTransactions,
  detectType,
  extractAmount,
  extractMerchant,
  isPaymentNotice,
  parseNotification,
} from '../examples/accounting/index.js'

describe('extractAmount 金额提取', () => {
  it('¥ / ￥ 前缀', () => {
    expect(extractAmount('微信支付 ¥23.50')).toBe(23.5)
    expect(extractAmount('付款成功 ￥8')).toBe(8)
  })

  it('「元」后缀', () => {
    expect(extractAmount('你已支付 15.8 元')).toBe(15.8)
  })

  it('关键词后跟金额', () => {
    expect(extractAmount('收款金额：88')).toBe(88)
  })

  it('兜底：带两位小数的数字', () => {
    expect(extractAmount('订单 20261019 支付 6.66')).toBe(6.66)
  })

  it('没有金额返回 null', () => {
    expect(extractAmount('你收到一条消息')).toBeNull()
    expect(extractAmount('')).toBeNull()
  })
})

describe('isPaymentNotice 交易通知判定', () => {
  it('支付成功 / 收款到账算交易', () => {
    expect(isPaymentNotice('微信支付', '付款成功 ¥12.00')).toBe(true)
    expect(isPaymentNotice('支付宝', '收款到账 8.50 元')).toBe(true)
  })

  it('验证码 / 过期 / 还款提醒不算', () => {
    expect(isPaymentNotice('验证码', '您的验证码是 123456')).toBe(false)
    expect(isPaymentNotice('微信', '红包已过期')).toBe(false)
    expect(isPaymentNotice('银行', '信用卡还款成功 ¥2000')).toBe(false)
  })

  it('无支付短语的消息不算', () => {
    expect(isPaymentNotice('微信', '晚上一起吃饭吗')).toBe(false)
  })
})

describe('detectType 收支方向', () => {
  it('到账 / 收款 → 收入', () => {
    expect(detectType('支付宝', '收款到账 5 元')).toBe('income')
  })

  it('支付 / 消费 → 支出', () => {
    expect(detectType('微信支付', '付款成功 23.5')).toBe('expense')
  })

  it('判断不出时默认支出', () => {
    expect(detectType('通知', '转账 10 元')).toBe('expense')
  })
})

describe('extractMerchant 商户提取', () => {
  it('「商户：」格式', () => {
    expect(extractMerchant('微信支付', '商户：美团外卖 付款成功 ¥23.5', '微信')).toBe('美团外卖')
  })

  it('「向…付款」格式', () => {
    expect(extractMerchant('支付宝', '向滴滴出行付款 12 元', '支付宝')).toBe('滴滴出行')
  })

  it('匹配不到时用标题 / App 兜底', () => {
    expect(extractMerchant('瑞幸咖啡', '你有一笔消费 ¥9.9', '微信')).toBe('瑞幸咖啡')
    expect(extractMerchant('微信支付', '付款成功 ¥1', '微信')).toBe('微信')
  })
})

describe('classify 自动分类', () => {
  it('商户表命中', () => {
    expect(classify('美团外卖', '')).toBe('餐饮')
    expect(classify('滴滴出行', '')).toBe('交通')
    expect(classify('京东商城', '')).toBe('购物')
  })

  it('关键词命中', () => {
    expect(classify('某某店', '超市购物')).toBe('购物')
    expect(classify('某某公司', '工资到账')).toBe('收入')
  })

  it('都没命中归「其他」', () => {
    expect(classify('未知商户', '一笔交易')).toBe('其他')
  })
})

describe('classify 学习映射', () => {
  it('userMap 优先于内置商户表', () => {
    expect(classify('美团外卖', '', { 美团外卖: '娱乐' })).toBe('娱乐')
  })

  it('parseNotification 接受 userMap（下次同商户自动命中）', () => {
    const tx = parseNotification(
      {
        pkg: 'com.tencent.mm',
        app: '微信',
        title: '微信支付',
        text: '商户：美团外卖 付款成功 ¥23.50',
        time: 1729312345000,
      },
      { 美团外卖: '娱乐' },
    )
    expect(tx).not.toBeNull()
    expect(tx.category).toBe('娱乐')
  })
})

describe('parseNotification 完整解析', () => {
  it('微信支付通知 → 一条支出记录', () => {
    const tx = parseNotification({
      pkg: 'com.tencent.mm',
      app: '微信',
      title: '微信支付',
      text: '商户：美团外卖 付款成功 ¥23.50',
      time: 1729312345000,
    })
    expect(tx).not.toBeNull()
    expect(tx.amount).toBe(23.5)
    expect(tx.type).toBe('expense')
    expect(tx.merchant).toBe('美团外卖')
    expect(tx.category).toBe('餐饮')
    expect(tx.status).toBe('confirmed')
    expect(tx.id).toContain('com.tencent.mm'.split('.').pop())
  })

  it('非交易通知返回 null', () => {
    expect(
      parseNotification({ pkg: 'com.tencent.mm', app: '微信', title: '微信', text: '晚上吃饭吗', time: 1 }),
    ).toBeNull()
  })

  it('金额缺失时给 pending 状态（等待补录）', () => {
    const tx = parseNotification({
      pkg: 'com.eg.android.AlipayGphone',
      app: '支付宝',
      title: '支付宝',
      text: '收款到账',
      time: 1729312345000,
    })
    expect(tx).not.toBeNull()
    expect(tx.amount).toBe(0)
    expect(tx.status).toBe('pending')
    expect(tx.type).toBe('income')
  })
})

describe('dedupeTransactions 跨来源去重', () => {
  const base = { amount: 23.5, type: 'expense', time: 1_000_000 }

  it('同金额、90 秒内、不同来源 ⇒ 合并成一条', () => {
    const list = [
      { ...base, id: 'wx', pkg: 'com.tencent.mm' },
      { ...base, id: 'bank', pkg: 'com.example.bank', time: base.time + 30_000 },
    ]
    expect(dedupeTransactions(list)).toHaveLength(1)
  })

  it('时间窗超过 90 秒不合并', () => {
    const list = [
      { ...base, id: 'wx', pkg: 'com.tencent.mm' },
      { ...base, id: 'bank', pkg: 'com.example.bank', time: base.time + 120_000 },
    ]
    expect(dedupeTransactions(list)).toHaveLength(2)
  })

  it('同来源两条同金额（不同时间窗内）也保留', () => {
    const list = [
      { ...base, id: 'a', pkg: 'com.tencent.mm' },
      { ...base, id: 'b', pkg: 'com.tencent.mm', time: base.time + 10_000 },
    ]
    expect(dedupeTransactions(list)).toHaveLength(2)
  })
})
