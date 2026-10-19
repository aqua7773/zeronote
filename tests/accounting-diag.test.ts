/**
 * 记账插件「原始通知诊断」单测（rev173.28.1）。
 *
 * describeNotice 解释 parseNotification 返回 null 的**原因**，是诊断视图的核心：
 * 用户看到「未识别」+ 原因 + 原文，才知道该补哪条规则。
 */
import { describe, expect, it } from 'vitest'
import { describeNotice } from '../examples/accounting/index.js'

const n = (title: string, text: string, extra: Record<string, unknown> = {}) => ({
  pkg: 'com.tencent.mm',
  app: '微信',
  title,
  text,
  time: 1,
  ...extra,
})

describe('describeNotice 诊断原因', () => {
  it('能解析 ⇒ ok:true 且无原因', () => {
    const r = describeNotice(n('微信支付', '付款成功 ¥23.50'))
    expect(r.ok).toBe(true)
    expect(r.reason).toBe('')
  })

  it('验证码类 ⇒ 命中忽略规则', () => {
    const r = describeNotice(n('微信', '你的验证码是 123456'))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('忽略规则')
  })

  it('没有支付短语', () => {
    const r = describeNotice(n('微信', '晚上一起吃饭吗'))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('没有支付短语')
  })

  it('有支付短语但没有金额（「已支付」不含收款/付款/转账/红包）', () => {
    const r = describeNotice(n('通知', '已支付'))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('没找到金额')
  })

  it('空通知', () => {
    expect(describeNotice({ title: '', text: '' }).reason).toBe('空通知')
  })
})
