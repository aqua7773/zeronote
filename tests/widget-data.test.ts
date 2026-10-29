/**
 * 桌面组件快照的**数据口径**（rev173.242 · 需求 §15）
 *
 * 这些用例守的是三件最容易静默出错的事：
 *
 * 1. **日期口径**：`toISOString()` 是 UTC，东八区晚上 8 点后会把「今天」算成明天 ⇒
 *    组件上的打卡记错天（打卡插件 rev173.103 踩过同一个坑，那边有注释）。
 * 2. **与插件漂移**：`isDueDay` 在 `examples/habit/index.js` 里已有一份带单测的实现，
 *    组件这边复刻了一份。这里**直接 import 插件那份逐条对照** —— 两边哪天改歪了立刻红。
 * 3. **私密内容不出门**：桌面组件是最容易被旁人看到的界面，`.zn/` 下的东西一律不出现。
 */
import { describe, expect, it } from 'vitest'
import {
  buildWidgetData,
  doneToday,
  duePlans,
  isDueDay as widgetIsDueDay,
  parseDayKey,
  recentPublicNotes,
  widgetDayKey,
  widgetIsoWeekday,
  type HabitChecks,
  type HabitPlan,
} from '../src/kernel/widget-data'
import { isDueDay as pluginIsDueDay } from '../examples/habit/index.js'
import type { NoteMeta } from '../src/kernel/contract'

const note = (path: string, mtime: number, kind: NoteMeta['kind'] = 'note'): NoteMeta => ({
  path,
  id: path,
  title: path.replace(/\.md$/, ''),
  mtime,
  size: 10,
  frontmatter: {},
  kind,
})

describe('widgetDayKey', () => {
  it('用本地时区，不用 UTC', () => {
    // 本地 23:30 —— toISOString 在东八区会算成「明天」
    expect(widgetDayKey(new Date(2026, 9, 29, 23, 30))).toBe('2026-10-29')
    expect(widgetDayKey(new Date(2026, 0, 1, 0, 5))).toBe('2026-01-01')
  })

  it('非法日期返回空串', () => {
    expect(widgetDayKey(new Date(Number.NaN))).toBe('')
  })
})

describe('parseDayKey / widgetIsoWeekday', () => {
  it('解析成**本地**零点', () => {
    const d = parseDayKey('2026-10-29')!
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9)
    expect(d.getDate()).toBe(29)
    expect(d.getHours()).toBe(0)
  })

  it('坏格式返回 null', () => {
    expect(parseDayKey('2026-1-5')).toBeNull()
    expect(parseDayKey('')).toBeNull()
    expect(parseDayKey('明天')).toBeNull()
  })

  it('周一 = 1，周日 = 7', () => {
    expect(widgetIsoWeekday(new Date(2026, 9, 26))).toBe(1) // 2026-10-26 周一
    expect(widgetIsoWeekday(new Date(2026, 10, 1))).toBe(7) // 2026-11-01 周日
  })
})

describe('isDueDay 与打卡插件逐条一致（防漂移）', () => {
  const plans: HabitPlan[] = [
    { id: 'daily', title: '每天', freq: 'daily' },
    { id: 'daily-start', title: '从 11 月开始', freq: 'daily', startDate: '2026-11-01' },
    { id: 'weekly', title: '周一三五', freq: 'weekly', days: [1, 3, 5] },
    { id: 'weekly-empty', title: '没选天', freq: 'weekly', days: [] },
    { id: 'monthly-1', title: '每月 1 号', freq: 'monthly', dayOfMonth: 1 },
    { id: 'monthly-31', title: '每月 31 号', freq: 'monthly', dayOfMonth: 31 },
    { id: 'every3', title: '每 3 天', freq: 'everyN', n: 3, startDate: '2026-10-01' },
    { id: 'every0', title: '坏 N', freq: 'everyN', n: 0, startDate: '2026-10-01' },
    { id: 'odd', title: '没写 freq', freq: '' },
  ]
  const days = [
    '2026-10-01',
    '2026-10-02',
    '2026-10-26',
    '2026-10-28',
    '2026-10-29',
    '2026-10-31',
    '2026-11-01',
    '2026-02-28',
    '2026-02-29', // 2026 不是闰年 —— 插件侧会把它当「3 月 1 日」的等价物，两边必须同判
  ]

  it('同一份计划 × 同一批日期，两边结论完全相同', () => {
    for (const plan of plans) {
      for (const key of days) {
        expect({ plan: plan.id, key, due: widgetIsDueDay(plan, key) }).toEqual({
          plan: plan.id,
          key,
          due: pluginIsDueDay(plan, key),
        })
      }
    }
  })

  it('月度 31 号在 30 天的月份取月末', () => {
    expect(widgetIsDueDay({ id: 'm', freq: 'monthly', dayOfMonth: 31 }, '2026-09-30')).toBe(true)
    expect(widgetIsDueDay({ id: 'm', freq: 'monthly', dayOfMonth: 31 }, '2026-09-29')).toBe(false)
  })

  it('早于 startDate 不算应打卡日', () => {
    expect(widgetIsDueDay({ id: 's', freq: 'daily', startDate: '2026-10-29' }, '2026-10-28')).toBe(
      false,
    )
    expect(widgetIsDueDay({ id: 's', freq: 'daily', startDate: '2026-10-29' }, '2026-10-29')).toBe(
      true,
    )
  })
})

describe('doneToday / duePlans', () => {
  const checks: HabitChecks = {
    a: { '2026-10-29': ['08:12', '21:30'], '2026-10-28': ['09:00'] },
    b: { '2026-10-29': [] },
  }

  it('按当天记录条数算次数，坏数据当 0', () => {
    expect(doneToday(checks, 'a', '2026-10-29')).toBe(2)
    expect(doneToday(checks, 'b', '2026-10-29')).toBe(0)
    expect(doneToday(checks, 'c', '2026-10-29')).toBe(0)
    expect(doneToday({ a: { '2026-10-29': 'oops' as unknown as [] } }, 'a', '2026-10-29')).toBe(0)
  })

  it('只留今天应打卡的，保持 store 里的顺序', () => {
    const plans: HabitPlan[] = [
      { id: 'daily', title: '每天', freq: 'daily' },
      { id: 'weekly', title: '周一三五', freq: 'weekly', days: [1, 3, 5] },
      { id: 'monthly', title: '每月 1 号', freq: 'monthly', dayOfMonth: 1 },
    ]
    // 2026-10-29 是周四 ⇒ 周三五那条不打
    expect(duePlans(plans, checks, '2026-10-29').map((p) => p.id)).toEqual(['daily'])
  })

  it('today 有记录也留在列表里（允许一天多次），并带上目标次数', () => {
    const plans: HabitPlan[] = [{ id: 'a', title: '晨跑', freq: 'daily', targetPerDay: 3 }]
    expect(duePlans(plans, checks, '2026-10-29')).toEqual([
      { id: 'a', title: '晨跑', done: 2, target: 3 },
    ])
  })

  it('缺标题 / 坏目标次数有兜底', () => {
    const plans: HabitPlan[] = [{ id: 'x', freq: 'daily', targetPerDay: 0 }]
    expect(duePlans(plans, {}, '2026-10-29')).toEqual([
      { id: 'x', title: '未命名计划', done: 0, target: 1 },
    ])
  })
})

describe('recentPublicNotes', () => {
  it('按 mtime 倒序、只留笔记、可限量', () => {
    const notes = [
      note('旧.md', 1000),
      note('新.md', 3000),
      note('图.png', 9000, 'image'),
      note('书.pdf', 8000, 'doc'),
      note('中.md', 2000),
    ]
    expect(recentPublicNotes(notes, 5).map((n) => n.path)).toEqual(['新.md', '中.md', '旧.md'])
    expect(recentPublicNotes(notes, 1).map((n) => n.path)).toEqual(['新.md'])
    expect(recentPublicNotes(notes, 0)).toEqual([])
  })

  it('私密 / 点开头的路径一律不出门', () => {
    const notes = [note('.zn/private/a.md', 5000), note('.hidden.md', 4000), note('公开.md', 1)]
    expect(recentPublicNotes(notes, 7).map((n) => n.path)).toEqual(['公开.md'])
  })

  it('标题为空时退回路径', () => {
    const n = note('a/b.md', 1)
    n.title = ''
    expect(recentPublicNotes([n], 1)[0].title).toBe('a/b.md')
  })
})

describe('buildWidgetData', () => {
  it('组装出完整形状，plans 与 notes 都按当天算', () => {
    const data = buildWidgetData({
      vault: '/storage/emulated/0/Documents/ZeroNote',
      notes: [note('新.md', 3000), note('旧.md', 1000)],
      plans: [{ id: 'a', title: '晨跑', freq: 'daily' }],
      checks: { a: { '2026-10-29': ['08:00'] } },
      now: new Date(2026, 9, 29, 10, 0),
      limit: 5,
    })
    expect(data.version).toBe(1)
    expect(data.vault).toBe('/storage/emulated/0/Documents/ZeroNote')
    expect(data.updatedAt).toBe(new Date(2026, 9, 29, 10, 0).getTime())
    expect(data.plans).toEqual([{ id: 'a', title: '晨跑', done: 1, target: 1 }])
    expect(data.notes.map((n) => n.path)).toEqual(['新.md', '旧.md'])
  })

  it('没有打卡插件时 plans 为空数组（不是 null）', () => {
    const data = buildWidgetData({ vault: '/v', notes: [], now: new Date(2026, 9, 29) })
    expect(data.plans).toEqual([])
    expect(data.notes).toEqual([])
  })
})
