/**
 * 打卡插件（habit）的纯函数单测 —— rev173.103（ROADMAP 第 6 项）。
 *
 * 只测可断言的逻辑：日期键、四种频率的"应打卡日"、连续 / 累计、7 天补打卡窗口、
 * 月历网格、表单校验、面板结构。插件与 store / 宿主的交互靠桌面 CDP 实测。
 */
import { describe, expect, it } from 'vitest'
import {
  BACKFILL_DAYS,
  canBackfill,
  dayDate,
  dayKey,
  dayRecords,
  daysBetween,
  defaultPlan,
  extendStartDate,
  freqLabel,
  habitNode,
  isDueDay,
  monthGrid,
  normalizePlan,
  streakOf,
  streakOfPlan,
  timeOf,
  totalDays,
} from '../examples/habit/index.js'

describe('dayKey / dayDate / daysBetween', () => {
  it('用本地时间，不用 UTC（东八区晚上 8 点后不能算成明天）', () => {
    // 2026-10-24 23:30 本地 ⇒ 仍是 10-24（toISOString 会给出 10-24T15:30Z，slice 后也是 10-24，
    // 但 2026-10-24 早上 07:00 本地 = 2026-10-23T23:00Z ⇒ UTC 口径会错成 10-23）
    expect(dayKey(new Date(2026, 9, 24, 7, 0))).toBe('2026-10-24')
    expect(dayKey(new Date(2026, 9, 24, 23, 30))).toBe('2026-10-24')
  })

  it('dayDate 能解析并能拒绝坏格式', () => {
    expect(dayDate('2026-10-24')?.getDate()).toBe(24)
    expect(dayDate('2026-1-1')).toBeNull()
    expect(dayDate('')).toBeNull()
    expect(dayDate(undefined as never)).toBeNull()
  })

  it('daysBetween 按自然日算', () => {
    expect(daysBetween('2026-10-24', '2026-10-24')).toBe(0)
    expect(daysBetween('2026-10-21', '2026-10-24')).toBe(3)
    expect(daysBetween('2026-10-24', '2026-10-21')).toBe(-3)
    expect(Number.isNaN(daysBetween('坏', '2026-10-24'))).toBe(true)
  })
})

describe('isDueDay：四种频率', () => {
  const daily = defaultPlan('2026-10-24', 'a')
  it('daily 每天都是', () => {
    expect(isDueDay(daily, '2026-10-24')).toBe(true)
    expect(isDueDay(daily, '2026-10-25')).toBe(true)
  })

  it('weekly 只认选中的星期几（周一三五：周二周四跳过）', () => {
    const plan = { ...daily, startDate: '2026-10-01', freq: 'weekly', days: [1, 3, 5] }
    expect(isDueDay(plan, '2026-10-19')).toBe(true) // 周一
    expect(isDueDay(plan, '2026-10-20')).toBe(false) // 周二
    expect(isDueDay(plan, '2026-10-21')).toBe(true) // 周三
    expect(isDueDay(plan, '2026-10-23')).toBe(true) // 周五
    expect(isDueDay(plan, '2026-10-24')).toBe(false) // 周六
  })

  it('monthly 当月没有这一天时按当月最后一天', () => {
    const plan = { ...daily, startDate: '2026-01-01', freq: 'monthly', dayOfMonth: 31 }
    expect(isDueDay(plan, '2026-02-28')).toBe(true) // 2 月没有 31 ⇒ 28 号
    expect(isDueDay(plan, '2026-01-31')).toBe(true)
    expect(isDueDay(plan, '2026-01-30')).toBe(false)
  })

  it('everyN 从起始日每 N 天一次', () => {
    const plan = { ...daily, freq: 'everyN', n: 3, startDate: '2026-10-19' }
    expect(isDueDay(plan, '2026-10-19')).toBe(true)
    expect(isDueDay(plan, '2026-10-20')).toBe(false)
    expect(isDueDay(plan, '2026-10-22')).toBe(true)
  })

  it('早于 startDate 的不是应打卡日', () => {
    const plan = { ...daily, startDate: '2026-10-24' }
    expect(isDueDay(plan, '2026-10-23')).toBe(false)
  })
})

describe('streakOf / streakOfPlan：连续天数按应打卡日', () => {
  const today = '2026-10-24' // 周六
  const weekly = { ...defaultPlan('2026-10-01', 'w'), freq: 'weekly', days: [1, 3, 5] }

  it('周一三五：周二周四没打不打断（周五、周三、周一 = 3）', () => {
    const checks = {
      '2026-10-19': ['08:00'],
      '2026-10-21': ['08:00'],
      '2026-10-23': ['08:00'],
    }
    expect(streakOfPlan(weekly, checks, today)).toBe(3)
  })

  it('某个应打卡日没记录 ⇒ 从那里断（只算最近连续）', () => {
    const checks = {
      '2026-10-19': ['08:00'],
      // 10-21 漏了
      '2026-10-23': ['08:00'],
    }
    expect(streakOfPlan(weekly, checks, today)).toBe(1)
  })

  it('今天是应打卡日但还没打 ⇒ 不算断，往昨天数', () => {
    const daily = defaultPlan('2026-10-01', 'd')
    const checks = { '2026-10-23': ['08:00'] }
    expect(streakOfPlan(daily, checks, '2026-10-24')).toBe(1)
  })

  it('今天已打卡 ⇒ 连今天一起数', () => {
    const daily = defaultPlan('2026-10-01', 'd')
    const checks = { '2026-10-23': ['08:00'], '2026-10-24': ['07:00'] }
    expect(streakOfPlan(daily, checks, '2026-10-24')).toBe(2)
  })

  it('空记录 / 坏输入 → 0', () => {
    const daily = defaultPlan('2026-10-01', 'd')
    expect(streakOfPlan(daily, {}, today)).toBe(0)
    expect(streakOf(daily, {}, '')).toBe(0)
    expect(streakOf(undefined as never, {}, today)).toBe(0)
  })
})

describe('extendStartDate：补打卡早于开始日 ⇒ 开始日前移', () => {
  const today = '2026-10-24'
  const plan = defaultPlan(today, 'p1')

  it('补昨天 ⇒ 开始日改成昨天', () => {
    const next = extendStartDate(plan, '2026-10-23')
    expect(next.startDate).toBe('2026-10-23')
    expect(next).not.toBe(plan)
  })

  it('补今天 / 未来 ⇒ 原样返回（同一对象，调用方据此跳过写盘）', () => {
    expect(extendStartDate(plan, today)).toBe(plan)
    expect(extendStartDate(plan, '2026-10-25')).toBe(plan)
  })

  it('坏日期 / 没开始日 ⇒ 原样', () => {
    expect(extendStartDate(plan, '')).toBe(plan)
    expect(extendStartDate(plan, '2026-1-1')).toBe(plan)
    const noStart = { ...plan, startDate: '' }
    expect(extendStartDate(noStart, '2026-10-23')).toBe(noStart)
  })

  it('开始日前移之后，连续天数认补的那天（手机实测的复现）', () => {
    const shifted = extendStartDate(plan, '2026-10-23')
    const checks = { '2026-10-23': ['08:00'], '2026-10-24': ['08:00'] }
    // 修前：startDate 还是 10-24 ⇒ 23 不算应打卡日 ⇒ 连续 1；修后应为 2
    expect(streakOfPlan(plan, checks, today)).toBe(1)
    expect(streakOfPlan(shifted, checks, today)).toBe(2)
  })
})

describe('totalDays：累计按有记录的天数，不按次数', () => {
  it('一天打三次只算一天', () => {
    expect(totalDays({ '2026-10-21': ['08:00', '12:00', '21:00'], '2026-10-22': ['09:00'] })).toBe(2)
  })
  it('空 / 坏数据 → 0', () => {
    expect(totalDays({})).toBe(0)
    expect(totalDays(undefined as never)).toBe(0)
    expect(totalDays({ '2026-10-21': [] })).toBe(0)
  })
})

describe('canBackfill：只能改最近 7 天', () => {
  const today = '2026-10-24'
  it('今天到往前 6 天可改', () => {
    expect(BACKFILL_DAYS).toBe(7)
    expect(canBackfill('2026-10-24', today)).toBe(true)
    expect(canBackfill('2026-10-18', today)).toBe(true)
  })
  it('第 8 天以后 / 未来 不行', () => {
    expect(canBackfill('2026-10-17', today)).toBe(false)
    expect(canBackfill('2026-10-25', today)).toBe(false)
  })
  it('坏输入 → false', () => {
    expect(canBackfill('', today)).toBe(false)
    expect(canBackfill('2026-10-24', '')).toBe(false)
  })
})

describe('monthGrid：周一起始的 6×7', () => {
  it('2026-10（1 号是周四）—— 首格是 9 月 28 日（周一），共 42 格', () => {
    const cells = monthGrid(2026, 9)
    expect(cells).toHaveLength(42)
    expect(cells[0].key).toBe('2026-09-28')
    expect(cells[0].inMonth).toBe(false)
    expect(cells[3].key).toBe('2026-10-01')
    expect(cells[3].inMonth).toBe(true)
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31)
  })

  it('坏输入返回空数组', () => {
    expect(monthGrid(NaN, 1)).toEqual([])
  })
})

describe('freqLabel', () => {
  const base = defaultPlan('2026-10-24', 'x')
  it('四种频率都有中文描述', () => {
    expect(freqLabel(base)).toBe('每天')
    expect(freqLabel({ ...base, freq: 'weekly', days: [5, 1, 3] })).toBe('每周 周一 周三 周五')
    expect(freqLabel({ ...base, freq: 'monthly', dayOfMonth: 15 })).toBe('每月 15 号')
    expect(freqLabel({ ...base, freq: 'everyN', n: 3 })).toBe('每隔 3 天')
  })
})

describe('normalizePlan：表单校验', () => {
  const today = '2026-10-24'

  it('标题不能为空', () => {
    expect(normalizePlan({ title: '  ' }, today).error).toBeTruthy()
  })

  it('每天计划：默认上限 1，起始日 = 今天', () => {
    const { plan } = normalizePlan({ title: '跑步' }, today)
    expect(plan?.freq).toBe('daily')
    expect(plan?.targetPerDay).toBe(1)
    expect(plan?.startDate).toBe(today)
  })

  it('每周计划必须选星期几', () => {
    expect(normalizePlan({ title: 'x', freq: 'weekly', days: [] }, today).error).toBeTruthy()
    const { plan } = normalizePlan({ title: 'x', freq: 'weekly', days: [5, 1, 5] }, today)
    expect(plan?.days).toEqual([1, 5])
  })

  it('每月日期 1–31；每隔 N 天 1–365', () => {
    expect(normalizePlan({ title: 'x', freq: 'monthly', dayOfMonth: 0 }, today).error).toBeTruthy()
    expect(normalizePlan({ title: 'x', freq: 'monthly', dayOfMonth: 32 }, today).error).toBeTruthy()
    expect(normalizePlan({ title: 'x', freq: 'monthly', dayOfMonth: 31 }, today).plan?.dayOfMonth).toBe(31)
    expect(normalizePlan({ title: 'x', freq: 'everyN', n: 0 }, today).error).toBeTruthy()
    expect(normalizePlan({ title: 'x', freq: 'everyN', n: 366 }, today).error).toBeTruthy()
  })

  it('上限至少 1，最多 99', () => {
    const { plan } = normalizePlan({ title: 'x', targetPerDay: 0 }, today)
    expect(plan?.targetPerDay).toBe(1)
    expect(normalizePlan({ title: 'x', targetPerDay: 500 }, today).plan?.targetPerDay).toBe(99)
  })

  it('起始日期格式不对要报错', () => {
    expect(normalizePlan({ title: 'x', freq: 'everyN', n: 2, startDate: '2026/10/24' }, today).error).toBeTruthy()
  })
})

describe('habitNode：面板结构', () => {
  it('空态：有引导文案 + 新建按钮', () => {
    const node = habitNode({ plans: [], checks: {}, today: '2026-10-24' })
    const flat = JSON.stringify(node)
    expect(flat).toContain('还没有计划')
    expect(flat).toContain('habit.create-start')
    expect(node.type).toBe('stack')
  })

  it('有计划：列表里有打卡按钮 + 今日次数；选中后出现日历', () => {
    const plan = { ...defaultPlan('2026-10-24', 'p1'), title: '跑步' }
    const node = habitNode({
      plans: [plan],
      checks: { p1: { '2026-10-24': ['07:30'] } },
      today: '2026-10-24',
      selectedId: 'p1',
      month: { y: 2026, m: 9 },
      selectedDay: '2026-10-24',
    })
    const flat = JSON.stringify(node)
    expect(flat).toContain('今日 1/1')
    expect(flat).toContain('habit.check')
    expect(flat).toContain('连续 1 天')
    expect(flat).toContain('累计 1 天')
    // 日历：6 行 × 7 列
    const table = findNode(node, (n) => n.type === 'table')
    expect(table?.rows).toHaveLength(6)
    expect(table?.columns).toHaveLength(7)
    // 选中日在上限内 ⇒ 补打卡按钮可用
    expect(flat).toContain('"label":"补打卡"')
  })

  it('达到上限：打卡按钮 disabled', () => {
    const plan = { ...defaultPlan('2026-10-24', 'p1'), title: '跑步' }
    const node = habitNode({
      plans: [plan],
      checks: { p1: { '2026-10-24': ['07:30'] } },
      today: '2026-10-24',
    })
    const checkBtn = findNode(node, (n) => n.type === 'button' && n.onClick === 'habit.check')
    expect(checkBtn?.disabled).toBe(true)
  })
})

/** 深度找第一个满足条件的 UINode（测试辅助） */
function findNode(node: unknown, pred: (n: any) => boolean): any {
  if (!node || typeof node !== 'object') return null
  const n = node as any
  if (pred(n)) return n
  for (const value of Object.values(n)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const hit = findNode(item?.node ?? item, pred)
        if (hit) return hit
      }
    } else if (value && typeof value === 'object') {
      const hit = findNode(value, pred)
      if (hit) return hit
    }
  }
  return null
}

describe('dayRecords / timeOf', () => {
  it('缺记录返回空数组（不返回 undefined）', () => {
    expect(dayRecords({}, 'p1', '2026-10-24')).toEqual([])
    expect(dayRecords({ p1: { '2026-10-24': ['08:00'] } }, 'p1', '2026-10-24')).toEqual(['08:00'])
  })

  it('timeOf 是 HH:mm', () => {
    expect(timeOf(new Date(2026, 9, 24, 8, 5).getTime())).toBe('08:05')
    expect(timeOf(new Date(2026, 9, 24, 21, 30).getTime())).toBe('21:30')
  })
})
