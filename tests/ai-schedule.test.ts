import { describe, expect, it } from 'vitest'
import {
  expandArgs,
  isDue,
  lastDueAt,
  nextDueAt,
  normalizeDays,
  normalizeTrigger,
  parseClock,
  triggerText,
} from '../examples/ai/index.js'

/**
 * 定时触发（rev173.202）。
 *
 * 这组的共同点：**时间和日期算错不会报错，只会"该跑的时候没跑"或"多跑一次"**。
 * 尤其补做：关掉 app 三天再打开，必须补一次而不是三次。
 *
 * 所有时间都用**本地时区**构造（面板上显示的也是本地时间）。
 */

/** 本地时间 → 毫秒。`at(2026,10,27,12,0)` = 2026-10-27 12:00（月份 1 起） */
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime()

describe('parseClock', () => {
  it('合法时间被规范化成 HH:MM', () => {
    expect(parseClock('23:00')).toEqual({ h: 23, m: 0, text: '23:00' })
    expect(parseClock('9:5')).toEqual({ h: 9, m: 5, text: '09:05' })
    expect(parseClock(' 07：30 ')).toEqual({ h: 7, m: 30, text: '07:30' })
  })

  it('非法时间返回 null', () => {
    expect(parseClock('')).toBeNull()
    expect(parseClock('24:00')).toBeNull()
    expect(parseClock('12:60')).toBeNull()
    expect(parseClock('明天早上')).toBeNull()
    expect(parseClock(null)).toBeNull()
  })
})

describe('normalizeDays', () => {
  it('去重排序，只留 1-7', () => {
    expect(normalizeDays([3, 1, 3, 9, 0, '2'])).toEqual([1, 2, 3])
  })

  it('空 = 每天（空数组）', () => {
    expect(normalizeDays([])).toEqual([])
    expect(normalizeDays(null)).toEqual([])
    expect(normalizeDays('x')).toEqual([])
  })
})

describe('normalizeTrigger', () => {
  it('schedule 带合法时间', () => {
    expect(normalizeTrigger({ type: 'schedule', at: '9:5' })).toEqual({ type: 'schedule', at: '09:05' })
    expect(normalizeTrigger({ type: 'schedule', at: '23:00', days: [5, 1] })).toEqual({
      type: 'schedule',
      at: '23:00',
      days: [1, 5],
    })
  })

  it('schedule 时间不合法 ⇒ 退化为 manual（不留一个永远不跑的任务）', () => {
    expect(normalizeTrigger({ type: 'schedule', at: '25:00' })).toEqual({ type: 'manual' })
    expect(normalizeTrigger({ type: 'schedule' })).toEqual({ type: 'manual' })
  })
})

describe('lastDueAt（含补做语义）', () => {
  const daily = { enabled: true, trigger: { type: 'schedule', at: '23:00' } }

  it('中午时最近一次是昨天 23:00', () => {
    expect(lastDueAt(daily, at(2026, 10, 27, 12, 0))).toBe(at(2026, 10, 26, 23, 0))
  })

  it('23:30 时最近一次是今天 23:00', () => {
    expect(lastDueAt(daily, at(2026, 10, 27, 23, 30))).toBe(at(2026, 10, 27, 23, 0))
  })

  it('正好 23:00 时算今天（边界要落在「到点」那一侧）', () => {
    expect(lastDueAt(daily, at(2026, 10, 27, 23, 0))).toBe(at(2026, 10, 27, 23, 0))
  })

  it('每周一 09:00：周三时最近一次是本周一', () => {
    const weekly = { enabled: true, trigger: { type: 'schedule', at: '09:00', days: [1] } }
    // 2026-10-28 是周三
    expect(lastDueAt(weekly, at(2026, 10, 28, 12, 0))).toBe(at(2026, 10, 26, 9, 0))
  })

  it('每周一 09:00：周一早上 8 点时最近一次是上周一', () => {
    const weekly = { enabled: true, trigger: { type: 'schedule', at: '09:00', days: [1] } }
    expect(lastDueAt(weekly, at(2026, 10, 26, 8, 0))).toBe(at(2026, 10, 19, 9, 0))
  })

  it('非定时任务返回 0', () => {
    expect(lastDueAt({ trigger: { type: 'save' } }, at(2026, 10, 27, 12, 0))).toBe(0)
  })
})

describe('isDue', () => {
  const mk = (lastRunAt: number) => ({
    enabled: true,
    lastRunAt,
    trigger: { type: 'schedule', at: '23:00' },
  })

  it('上次运行早于最近一次应跑 ⇒ 该跑（含关掉 app 三天后的补做）', () => {
    expect(isDue(mk(at(2026, 10, 24, 23, 0)), at(2026, 10, 27, 12, 0))).toBe(true)
  })

  it('上次运行就是最近一次应跑 ⇒ 不跑', () => {
    expect(isDue(mk(at(2026, 10, 26, 23, 0)), at(2026, 10, 27, 12, 0))).toBe(false)
  })

  it('停用 / 非定时 / 没配时间都不跑', () => {
    expect(isDue({ ...mk(0), enabled: false }, at(2026, 10, 27, 12, 0))).toBe(false)
    expect(isDue({ enabled: true, lastRunAt: 0, trigger: { type: 'save' } }, at(2026, 10, 27, 12, 0))).toBe(false)
    expect(isDue({ enabled: true, lastRunAt: 0, trigger: { type: 'schedule' } }, at(2026, 10, 27, 12, 0))).toBe(false)
  })

  it('补做只补一次：跑完把 lastRunAt 更新到「最近一次应跑」就不再触发', () => {
    const t = mk(at(2026, 10, 24, 23, 0))
    const now = at(2026, 10, 27, 12, 0)
    expect(isDue(t, now)).toBe(true)
    t.lastRunAt = now // runTask 会把 lastRunAt 设成运行时刻
    expect(isDue(t, now)).toBe(false)
  })
})

describe('nextDueAt', () => {
  const daily = { trigger: { type: 'schedule', at: '23:00' } }

  it('中午时下次是今天 23:00', () => {
    expect(nextDueAt(daily, at(2026, 10, 27, 12, 0))).toBe(at(2026, 10, 27, 23, 0))
  })

  it('23:30 时下次是明天 23:00', () => {
    expect(nextDueAt(daily, at(2026, 10, 27, 23, 30))).toBe(at(2026, 10, 28, 23, 0))
  })

  it('每周三：周一算下次是本周三', () => {
    const weekly = { trigger: { type: 'schedule', at: '09:00', days: [3] } }
    expect(nextDueAt(weekly, at(2026, 10, 26, 12, 0))).toBe(at(2026, 10, 28, 9, 0))
  })

  it('非定时返回 0', () => {
    expect(nextDueAt({ trigger: { type: 'save' } })).toBe(0)
  })
})

describe('triggerText（定时）', () => {
  it('每天 / 每周几的人话', () => {
    expect(triggerText({ trigger: { type: 'schedule', at: '23:00' } })).toBe('每天 23:00')
    expect(triggerText({ trigger: { type: 'schedule', at: '09:00', days: [1, 3] } })).toBe('每周一、三 09:00')
    expect(triggerText({ trigger: { type: 'schedule', at: '07:30', days: [1, 2, 3, 4, 5, 6, 7] } })).toBe('每天 07:30')
    expect(triggerText({ trigger: { type: 'schedule' } })).toBe('定时（时间无效）')
  })
})

describe('expandArgs（固定步骤的占位符）', () => {
  it('{{path}} / {{dir}} 替换', () => {
    expect(expandArgs({ path: '{{path}}', dir: '{{ dir }}' }, { path: '工作/a.md', dir: '工作' })).toEqual({
      path: '工作/a.md',
      dir: '工作',
    })
  })

  it('嵌套对象与数组一起替换', () => {
    const out = expandArgs(
      { tags: ['{{path}}'], nested: { to: '{{path}}', n: 3 } },
      { path: 'x.md' },
    )
    expect(out).toEqual({ tags: ['x.md'], nested: { to: 'x.md', n: 3 } })
  })

  it('没有占位符时原样返回（数字 / 布尔不被转成字符串）', () => {
    const args = { limit: 10, raw: true, name: 'list_notes' }
    expect(expandArgs(args, { path: 'x.md' })).toEqual(args)
  })

  it('缺失的变量替换成空串，不炸', () => {
    expect(expandArgs({ a: '{{path}}' }, {})).toEqual({ a: '' })
  })
})
