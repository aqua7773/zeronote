/**
 * 打卡（habit）—— A 档第 4 个插件 · ROADMAP 第 6 项（rev173.103）
 *
 * 需求 §7.1–§7.3（**除提醒**）：
 *   · 四种频率：每天 / 每周固定星期几 / 每月固定日期 / 每隔 N 天
 *   · 一天可多次打卡，**上限用户自定**；一天至少一次 = 当天完成
 *   · 连续天数按「应打卡日」算：**非打卡日跳过、不算中断**（周一三五，周二周四不打断）
 *   · 同时展示**连续**与**累计**（累计 = 有记录的天数，不看次数）
 *   · 日历：当天是否完成 + 打卡次数
 *   · 可补打卡 / 修改某天记录，**只能改最近 7 天**
 *
 * **不做到点提醒**（2026-10-23 用户裁决）：契约里没有定时器原语、Android 也没有前台服务，
 * App 不在就提醒不了。与其给一个不可靠的"闹钟"，不如把记录、日历、连续统计做扎实。
 *
 * 数据放 `store`（用户拍板，与 accounting 同一种做法）：
 *   · `plans`:  [{ id, title, freq, days, dayOfMonth, n, startDate, targetPerDay }]
 *   · `checks`: { [planId]: { 'YYYY-MM-DD': ['08:12', '21:30'] } }
 *
 * 面板：`main` 区标签（`habit.board`）—— 计划列表 + 今天次数 + 打卡按钮 + 月历。
 * 弹层 / 状态栏都不加：这是"打开慢慢看"的界面，不是随手点的开关（对比 history 的状态栏入口）。
 */

const PANEL_ID = 'habit.board'
const PLANS_KEY = 'plans'
const CHECKS_KEY = 'checks'
/** 补打卡 / 修改只允许最近这几天（需求原文「最近 7 天」，含今天） */
export const BACKFILL_DAYS = 7
const DAY = 24 * 60 * 60 * 1000
/** 连续天数往回最多走这么多天（防止坏数据（如 1970 年起始）把循环拖死） */
const STREAK_MAX_DAYS = 3660

export const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const pad = (n) => String(n).padStart(2, '0')

/* ───────────────────────── 纯函数（tests/habit.test.ts 单测） ───────────────────────── */

/**
 * 本地日期键 `YYYY-MM-DD`。
 *
 * ⚠️ 不能用 `toISOString().slice(0, 10)` —— 那是 UTC，东八区晚上 8 点后会算成"明天"，
 * 打卡会记错天（实测这类 bug 最伤：白天正常、晚上错一天）。
 */
export function dayKey(d) {
  const t = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(t.getTime())) return ''
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`
}

/** `YYYY-MM-DD` → 本地零点 Date；坏格式返回 null */
export function dayDate(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? '').trim())
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return Number.isNaN(d.getTime()) ? null : d
}

/** 两个日期键相差的天数（to - from）；坏输入返回 NaN */
export function daysBetween(fromKey, toKey) {
  const a = dayDate(fromKey)
  const b = dayDate(toKey)
  if (!a || !b) return NaN
  return Math.round((b.getTime() - a.getTime()) / DAY)
}

/**
 * 补打卡的日子**早于计划开始日** ⇒ 把开始日前移到那天。
 *
 * 为什么（手机实测 2026-10-24 发现）：新建计划时 `startDate` = 创建日；
 * 用户立刻补打昨天，`canBackfill` 允许（最近 7 天），记录也落盘了，
 * 但 `isDueDay` 认为"早于 startDate 不算应打卡日" ⇒ **连续天数不涨、累计天数涨**，
 * 同一份数据两个口径打架。用户主动补的那天，就是计划实际生效的那天。
 */
export function extendStartDate(plan, date) {
  const target = dayDate(date)
  const start = dayDate(plan?.startDate)
  if (!target || !start) return plan
  if (target.getTime() >= start.getTime()) return plan
  return { ...plan, startDate: dayKey(target) }
}

/** 星期几 → 1..7（周一 = 1，周日 = 7）。需求里"每周固定星期几"用这套序号 */
export function isoWeekday(d) {
  const t = d instanceof Date ? d : new Date(d)
  return t.getDay() === 0 ? 7 : t.getDay()
}

/** 当天应打卡的次数上限（至少 1） */
export function targetOf(plan) {
  const n = Math.floor(Number(plan?.targetPerDay) || 1)
  return Math.max(1, n)
}

/**
 * 这天是不是**应打卡日**（需求 §7.3 连续天数的地基）。
 *
 * | freq | 规则 |
 * |---|---|
 * | `daily` | 每天 |
 * | `weekly` | `days` 里包含这个星期几 |
 * | `monthly` | 是这个月的第 `dayOfMonth` 天；**当月没有那一天**（如 2 月 31 号）⇒ 当月最后一天算 |
 * | `everyN` | 从 `startDate` 起每 N 天 |
 *
 * 早于 `startDate` 的一律不算（计划从哪天开始生效）。
 */
export function isDueDay(plan, key) {
  const d = dayDate(key)
  if (!plan || !d) return false
  if (plan.startDate) {
    const start = dayDate(plan.startDate)
    if (start && d.getTime() < start.getTime()) return false
  }
  switch (plan.freq) {
    case 'weekly':
      return Array.isArray(plan.days) && plan.days.map(Number).includes(isoWeekday(d))
    case 'monthly': {
      const want = Math.max(1, Math.min(31, Math.floor(Number(plan.dayOfMonth) || 1)))
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      return d.getDate() === Math.min(want, lastDay)
    }
    case 'everyN': {
      const n = Math.max(1, Math.floor(Number(plan.n) || 1))
      const start = dayDate(plan.startDate || key)
      if (!start) return false
      const diff = Math.round((d.getTime() - start.getTime()) / DAY)
      return diff >= 0 && diff % n === 0
    }
    case 'daily':
    default:
      return true
  }
}

/** 某计划某天的记录数组（永远是数组，坏数据也安全） */
export function dayRecords(checks, planId, key) {
  const rec = checks?.[planId]?.[key]
  return Array.isArray(rec) ? rec : []
}

/**
 * **连续天数**（需求 §7.3 的关键）。
 *
 * 从今天往回走，只统计应打卡日：非打卡日**跳过**、某应打卡日没记录 ⇒ 中断。
 * 今天如果是应打卡日但还没打卡，**不算中断**（今天还没过完）—— 从昨天继续数。
 *
 * @param {object} plan
 * @param {object} checks 该计划的记录表（`{ 'YYYY-MM-DD': ['08:12'] }`）
 * @param {string} todayKey
 */
export function streakOf(plan, checks, todayKey) {
  const today = dayDate(todayKey)
  if (!plan || !today) return 0
  let cursor = new Date(today.getTime())
  // 今天应打卡但还没打 ⇒ 从昨天开始（不把"还没结束的今天"当断）
  if (isDueDay(plan, todayKey) && !hasRecord(checks, todayKey)) {
    cursor = new Date(cursor.getTime() - DAY)
  }
  let streak = 0
  for (let i = 0; i < STREAK_MAX_DAYS; i++) {
    const key = dayKey(cursor)
    if (isDueDay(plan, key)) {
      if (!hasRecord(checks, key)) break
      streak++
    }
    cursor = new Date(cursor.getTime() - DAY)
  }
  return streak
}

/** 该计划某天有没有任何记录（`checks` 可以是整表，也可以是单计划的表 —— 两种都支持） */
function hasRecord(checks, key) {
  if (!checks || typeof checks !== 'object') return false
  const direct = checks[key]
  if (Array.isArray(direct)) return direct.length > 0
  return false
}

/**
 * 连续天数（面板口径）—— `checks` 传**该计划**的记录表。
 * 与上面分开是怕调用方把整表（按 planId 分组）传进来：`streakOf` 只认"当天 → 数组"这一层。
 */
export function streakOfPlan(plan, planChecks, todayKey) {
  return streakOf(plan, planChecks ?? {}, todayKey)
}

/** 累计打卡天数 = **有记录的天数**（需求：不按次数算） */
export function totalDays(planChecks) {
  if (!planChecks || typeof planChecks !== 'object') return 0
  let n = 0
  for (const key of Object.keys(planChecks)) {
    if (Array.isArray(planChecks[key]) && planChecks[key].length > 0) n++
  }
  return n
}

/** 这一天能不能补打卡 / 修改（最近 7 天，含今天；未来不行） */
export function canBackfill(key, todayKey) {
  const diff = daysBetween(key, todayKey)
  if (!Number.isFinite(diff)) return false
  return diff >= 0 && diff < BACKFILL_DAYS
}

/**
 * 月历格子（周一为一周起点，6 行 × 7 列 = 42 格，含前后月补位）。
 * @returns {{ key:string, day:number, inMonth:boolean }[]}
 */
export function monthGrid(year, month) {
  const y = Math.floor(Number(year))
  const m = Math.floor(Number(month))
  if (!Number.isFinite(y) || !Number.isFinite(m)) return []
  const first = new Date(y, m, 1)
  const offset = (isoWeekday(first) - 1 + 7) % 7
  const start = new Date(y, m, 1 - offset)
  const cells = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    cells.push({
      key: dayKey(d),
      day: d.getDate(),
      inMonth: d.getFullYear() === y && d.getMonth() === m,
    })
  }
  return cells
}

/** 频率 → 一句人话（面板与确认提示共用） */
export function freqLabel(plan) {
  switch (plan?.freq) {
    case 'weekly': {
      const days = Array.isArray(plan.days) ? plan.days.map(Number).filter((n) => n >= 1 && n <= 7) : []
      return days.length ? `每周 ${days.sort((a, b) => a - b).map((d) => WEEKDAYS[d - 1]).join(' ')}` : '每周（未选星期几）'
    }
    case 'monthly':
      return `每月 ${Math.max(1, Math.min(31, Math.floor(Number(plan.dayOfMonth) || 1)))} 号`
    case 'everyN':
      return `每隔 ${Math.max(1, Math.floor(Number(plan.n) || 1))} 天`
    case 'daily':
    default:
      return '每天'
  }
}

/** 新建计划时的默认值（`startDate` = 今天，从今天开始算应打卡日） */
export function defaultPlan(todayKey, id) {
  return {
    id: id || `p${Date.now().toString(36)}`,
    title: '',
    freq: 'daily',
    days: [1, 2, 3, 4, 5, 6, 7],
    dayOfMonth: 1,
    n: 2,
    startDate: todayKey || dayKey(new Date()),
    targetPerDay: 1,
  }
}

/**
 * 把表单值（都是字符串）规整成计划对象；标题空 ⇒ 返回 error。
 * 单独抽出来是为了单测（面板与命令都走它，避免两套校验）。
 */
export function normalizePlan(input, todayKey) {
  const title = String(input?.title ?? '').trim()
  if (!title) return { error: '计划名不能为空' }
  const freq = ['daily', 'weekly', 'monthly', 'everyN'].includes(input?.freq) ? input.freq : 'daily'
  const base = defaultPlan(todayKey, input?.id)
  const plan = { ...base, title, freq }
  if (freq === 'weekly') {
    const days = Array.isArray(input?.days) ? input.days.map(Number).filter((n) => n >= 1 && n <= 7) : []
    if (!days.length) return { error: '每周计划至少要选一个星期几' }
    plan.days = [...new Set(days)].sort((a, b) => a - b)
  }
  if (freq === 'monthly') {
    const d = Math.floor(Number(input?.dayOfMonth))
    if (!Number.isFinite(d) || d < 1 || d > 31) return { error: '每月日期要在 1–31 之间' }
    plan.dayOfMonth = d
  }
  if (freq === 'everyN') {
    const n = Math.floor(Number(input?.n))
    if (!Number.isFinite(n) || n < 1 || n > 365) return { error: '间隔天数要在 1–365 之间' }
    plan.n = n
    const start = String(input?.startDate ?? '').trim()
    if (start) {
      if (!dayDate(start)) return { error: '起始日期要写成 YYYY-MM-DD' }
      plan.startDate = start
    }
  }
  const target = Math.floor(Number(input?.targetPerDay))
  if (Number.isFinite(target)) plan.targetPerDay = Math.max(1, Math.min(99, target))
  return { plan }
}

/** 现在几点（打卡记录用 `HH:mm`） */
export function timeOf(ts) {
  const d = new Date(ts)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ───────────────────────── 面板节点（纯函数，单测可断言结构） ───────────────────────── */

function planRow(plan, checks, today) {
  const recs = dayRecords(checks, plan.id, today)
  const count = recs.length
  const target = targetOf(plan)
  const done = count >= target
  return {
    key: plan.id,
    node: {
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'link', label: plan.title, onClick: 'habit.select-plan', payload: { planId: plan.id } },
        { type: 'badge', text: `今日 ${count}/${target}`, tone: done ? 'success' : 'muted' },
        { type: 'text', value: freqLabel(plan), variant: 'caption', tone: 'muted' },
        {
          type: 'button',
          label: done ? '再打一次' : '打卡',
          onClick: 'habit.check',
          payload: { planId: plan.id },
          disabled: count >= target,
        },
        { type: 'button', label: '编辑', onClick: 'habit.edit', payload: { planId: plan.id }, variant: 'ghost' },
        { type: 'button', label: '删除', onClick: 'habit.delete-plan', payload: { planId: plan.id }, variant: 'ghost' },
      ],
    },
  }
}

function formNode(draft) {
  const freq = draft?.freq || 'daily'
  const children = [
    { type: 'text', value: draft?.id ? '编辑计划' : '新建计划', variant: 'title' },
    {
      type: 'field',
      label: '计划名',
      children: {
        type: 'input',
        bind: 'habit.draft.title',
        placeholder: '如：早起 / 背单词 / 跑步',
        onSubmit: 'habit.save-plan',
      },
    },
    {
      type: 'field',
      label: '频率',
      children: {
        type: 'select',
        bind: 'habit.draft.freq',
        options: [
          { value: 'daily', label: '每天' },
          { value: 'weekly', label: '每周固定星期几' },
          { value: 'monthly', label: '每月固定日期' },
          { value: 'everyN', label: '每隔 N 天' },
        ],
      },
    },
  ]
  if (freq === 'weekly') {
    children.push({
      type: 'field',
      label: '星期几（可多选）',
      children: {
        type: 'row',
        wrap: true,
        gap: 'sm',
        children: WEEKDAYS.map((label, i) => ({
          type: 'checkbox',
          bind: `habit.draft.day.${i + 1}`,
          label,
        })),
      },
    })
  }
  if (freq === 'monthly') {
    children.push({
      type: 'field',
      label: '每月几号（1–31；当月没有这一天时按当月最后一天）',
      children: { type: 'input', bind: 'habit.draft.dayOfMonth', placeholder: '1' },
    })
  }
  if (freq === 'everyN') {
    children.push(
      {
        type: 'field',
        label: '每隔几天（1–365）',
        children: { type: 'input', bind: 'habit.draft.n', placeholder: '2' },
      },
      {
        type: 'field',
        label: '从哪天开始（YYYY-MM-DD）',
        children: { type: 'input', bind: 'habit.draft.startDate', placeholder: '2026-10-24' },
      },
    )
  }
  children.push({
    type: 'field',
    label: '每天最多打卡几次（上限，到了就不再记）',
    children: { type: 'input', bind: 'habit.draft.target', placeholder: '1' },
  })
  children.push({
    type: 'row',
    gap: 'sm',
    children: [
      { type: 'button', label: '保存', onClick: 'habit.save-plan' },
      { type: 'button', label: '取消', onClick: 'habit.cancel-form', variant: 'ghost' },
    ],
  })
  return { type: 'stack', gap: 'md', children }
}

function calendarTable(plan, checks, today, month) {
  const cells = monthGrid(month.y, month.m)
  const columns = WEEKDAYS.map((label, i) => ({ key: `c${i}`, label, align: 'left', width: '14%' }))
  const rows = []
  for (let w = 0; w < 6; w++) {
    const row = {}
    for (let i = 0; i < 7; i++) {
      const cell = cells[w * 7 + i]
      if (!cell) {
        row[`c${i}`] = ''
        continue
      }
      const recs = dayRecords(checks, plan.id, cell.key)
      const count = recs.length
      const due = isDueDay(plan, cell.key)
      /**
       * **竖排**（日期 / 次数两行）而不是横排：手机上 7 列横排放不下
       * （实测 rev173.103：日期 + 「1 次」徽章横排 ⇒ 表格右侧溢出屏幕被裁）。
       */
      const children = [
        cell.inMonth
          ? {
              type: 'link',
              label: String(cell.day),
              onClick: 'habit.pick-day',
              payload: { planId: plan.id, date: cell.key },
            }
          : { type: 'text', value: String(cell.day), variant: 'caption', tone: 'muted' },
      ]
      // 有记录 ⇒ 次数；应打卡但没记 ⇒ 「待打」；其余（非打卡日 / 未来非应打卡日）不占位置
      if (count > 0) children.push({ type: 'text', value: `${count} 次`, variant: 'caption', tone: 'success' })
      else if (due) children.push({ type: 'text', value: '待打', variant: 'caption', tone: 'muted' })
      row[`c${i}`] = { type: 'stack', gap: 'sm', children }
    }
    rows.push(row)
  }
  return { type: 'table', columns, rows, empty: '这个月没有日期' }
}

/**
 * 面板整棵树。纯函数：输入状态、输出 UINode（`tests/habit.test.ts` 断言结构，
 * 也保证 render 里没有副作用）。
 */
export function habitNode(view) {
  const {
    plans = [],
    checks = {},
    today = '',
    selectedId = '',
    month = { y: new Date().getFullYear(), m: new Date().getMonth() },
    selectedDay = '',
    formOpen = false,
    draft = {},
    status = '',
  } = view ?? {}

  const children = [
    {
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'text', value: '打卡', variant: 'title' },
        { type: 'badge', text: `${plans.length} 个计划` },
        { type: 'button', label: formOpen ? '收起表单' : '新建计划', onClick: 'habit.create-start', variant: 'ghost' },
      ],
    },
  ]
  if (status) children.push({ type: 'text', value: status, variant: 'caption', tone: 'muted' })
  if (formOpen) children.push(formNode(draft))

  children.push({
    type: 'list',
    empty: '还没有计划。点「新建计划」加一个 —— 只有记录与统计，到点提醒不做（App 关着收不到）。',
    items: plans.map((plan) => planRow(plan, checks, today)),
  })

  const plan = plans.find((p) => p.id === selectedId)
  if (plan) {
    const planChecks = checks?.[plan.id] ?? {}
    const streak = streakOfPlan(plan, planChecks, today)
    const total = totalDays(planChecks)
    const canEdit = !!selectedDay && canBackfill(selectedDay, today)
    const dayCount = selectedDay ? dayRecords(checks, plan.id, selectedDay).length : 0
    children.push({ type: 'divider' })
    children.push({
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'text', value: plan.title, variant: 'title' },
        { type: 'badge', text: `连续 ${streak} 天`, tone: streak > 0 ? 'success' : 'default' },
        { type: 'badge', text: `累计 ${total} 天` },
        { type: 'text', value: freqLabel(plan), variant: 'caption', tone: 'muted' },
      ],
    })
    children.push({
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'button', label: '‹ 上月', onClick: 'habit.prev-month', variant: 'ghost' },
        { type: 'text', value: `${month.y} 年 ${month.m + 1} 月` },
        { type: 'button', label: '下月 ›', onClick: 'habit.next-month', variant: 'ghost' },
      ],
    })
    children.push(calendarTable(plan, checks, today, month))
    // 提示一行、按钮一行：手机上挤在同一行会把「清除这天」折到下一行，看着像两个无关按钮
    children.push({
      type: 'text',
      value: selectedDay
        ? `${selectedDay} · ${dayCount} 次${canEdit ? '' : '（只能改最近 7 天）'}`
        : '点日历里的日期，可以补打卡或清掉那天的记录',
      variant: 'caption',
      tone: 'muted',
    })
    children.push({
      type: 'row',
      gap: 'sm',
      wrap: true,
      children: [
        {
          type: 'button',
          label: '补打卡',
          onClick: 'habit.backfill',
          payload: { planId: plan.id, date: selectedDay },
          disabled: !canEdit || dayCount >= targetOf(plan),
        },
        {
          type: 'button',
          label: '清除这天',
          onClick: 'habit.clear-day',
          payload: { planId: plan.id, date: selectedDay },
          disabled: !canEdit || dayCount === 0,
          variant: 'ghost',
        },
      ],
    })
  }

  return { type: 'stack', gap: 'md', children }
}

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    /** 计划清单（store `plans`） */
    let plans = []
    /** 打卡记录（store `checks`） */
    let checks = {}
    /** 数据是否已经读过一次 */
    let loaded = false
    /** 当前选中的计划（看它的日历） */
    let selectedId = ''
    /** 日历显示的月份（0-based） */
    let month = { y: new Date().getFullYear(), m: new Date().getMonth() }
    /** 日历里选中的那一天 */
    let selectedDay = ''
    /** 表单开没开、是不是在编辑已有计划 */
    let formOpen = false
    let editing = null
    /** render 时把 `ctx.state` 的草稿字段抄一份 —— 命令（run）拿不到 ctx */
    let draftView = { id: '', title: '', freq: 'daily', days: [], dayOfMonth: '1', n: '2', startDate: '', target: '1' }
    let status = ''

    const today = () => dayKey(new Date())

    function refresh() {
      api.view.refresh(PANEL_ID)
    }

    async function persistPlans() {
      await api.store.set(PLANS_KEY, plans)
    }

    async function persistChecks() {
      await api.store.set(CHECKS_KEY, checks)
    }

    /** 读一次 store（幂等；坏数据一律当空，不让一个坏字段把面板打崩） */
    async function loadAll() {
      try {
        const savedPlans = await api.store.get(PLANS_KEY, [])
        plans = Array.isArray(savedPlans) ? savedPlans.filter((p) => p && typeof p.id === 'string') : []
      } catch {
        plans = []
      }
      try {
        const savedChecks = await api.store.get(CHECKS_KEY, {})
        checks = savedChecks && typeof savedChecks === 'object' && !Array.isArray(savedChecks) ? savedChecks : {}
      } catch {
        checks = {}
      }
      if (!selectedId && plans.length) selectedId = plans[0].id
    }

    /** 首次渲染时异步读 store（render 期间不能同步 refresh ⇒ setTimeout 0） */
    let starting = false
    function ensureStarted() {
      if (loaded || starting) return
      starting = true
      setTimeout(() => {
        void (async () => {
          await loadAll()
          loaded = true
          starting = false
          refresh()
        })()
      }, 0)
    }

    /** 打开表单（新建）：清空草稿 + 预填 state */
    function startCreate() {
      if (formOpen) {
        formOpen = false
        refresh()
        return
      }
      editing = null
      const base = defaultPlan(today())
      fillDraft(base, [])
      formOpen = true
      refresh()
    }

    /** 把计划值写进 bind（`view.setState` → 宿主重渲染 → 输入框显示出来） */
    function fillDraft(plan, days) {
      const ds = Array.isArray(days) ? days : Array.isArray(plan.days) ? plan.days : []
      api.view.setState('habit.draft.title', plan.title ?? '')
      api.view.setState('habit.draft.freq', plan.freq ?? 'daily')
      api.view.setState('habit.draft.dayOfMonth', String(plan.dayOfMonth ?? 1))
      api.view.setState('habit.draft.n', String(plan.n ?? 2))
      api.view.setState('habit.draft.startDate', plan.startDate ?? today())
      api.view.setState('habit.draft.target', String(plan.targetPerDay ?? 1))
      for (let d = 1; d <= 7; d++) api.view.setState(`habit.draft.day.${d}`, ds.includes(d))
    }

    function startEdit(planId) {
      const plan = plans.find((p) => p.id === planId)
      if (!plan) return
      editing = plan
      fillDraft(plan, plan.days)
      formOpen = true
      refresh()
    }

    /** 保存表单：读 render 抄下来的草稿 → 规整 → 落 store */
    async function savePlan() {
      const days = Array.isArray(draftView.days) ? draftView.days : []
      const input = {
        id: editing?.id ?? draftView.id,
        title: draftView.title,
        freq: draftView.freq,
        days,
        dayOfMonth: draftView.dayOfMonth,
        n: draftView.n,
        startDate: draftView.startDate,
        targetPerDay: draftView.target,
      }
      const { plan, error } = normalizePlan(input, today())
      if (error) {
        status = error
        refresh()
        return
      }
      const wasEditing = !!editing
      if (wasEditing) {
        plans = plans.map((p) => (p.id === editing.id ? { ...p, ...plan } : p))
      } else {
        plans = [...plans, plan]
        selectedId = plan.id
      }
      editing = null
      formOpen = false
      status = ''
      await persistPlans()
      api.host.notify(wasEditing ? '计划已更新' : '计划已创建')
      refresh()
    }

    async function cancelForm() {
      formOpen = false
      editing = null
      status = ''
      refresh()
    }

    /** 打卡：次数到上限就不再记（需求：上限用户自定） */
    async function check(planId) {
      const plan = plans.find((p) => p.id === planId)
      if (!plan) return
      const key = today()
      const recs = dayRecords(checks, planId, key)
      if (recs.length >= targetOf(plan)) {
        api.host.notify(`「${plan.title}」今天的上限（${targetOf(plan)} 次）到了`, 'warn')
        return
      }
      checks = { ...checks, [planId]: { ...(checks[planId] ?? {}), [key]: [...recs, timeOf(Date.now())] } }
      selectedId = planId
      await persistChecks()
      api.host.notify(`「${plan.title}」已打卡 ${recs.length + 1}/${targetOf(plan)}`)
      refresh()
    }

    /** 补打卡：只允许最近 7 天；同样受每日上限约束 */
    async function backfill(planId, date) {
      const plan = plans.find((p) => p.id === planId)
      if (!plan) return
      if (!canBackfill(date, today())) {
        api.host.notify('只能修改最近 7 天内的记录', 'warn')
        return
      }
      const recs = dayRecords(checks, planId, date)
      if (recs.length >= targetOf(plan)) {
        api.host.notify(`那天已经够 ${targetOf(plan)} 次了`, 'warn')
        return
      }
      // 补的是计划开始日之前的日子 ⇒ 开始日前移（否则连续天数不认这天，见 extendStartDate）
      const nextPlan = extendStartDate(plan, date)
      if (nextPlan !== plan) {
        plans = plans.map((p) => (p.id === planId ? nextPlan : p))
        await persistPlans()
      }
      checks = { ...checks, [planId]: { ...(checks[planId] ?? {}), [date]: [...recs, timeOf(Date.now())] } }
      await persistChecks()
      api.host.notify(`已补打卡 ${date}`)
      refresh()
    }

    /** 清掉某天的全部记录（同属"修改某天记录"，同样限 7 天） */
    async function clearDay(planId, date) {
      if (!canBackfill(date, today())) {
        api.host.notify('只能修改最近 7 天内的记录', 'warn')
        return
      }
      const table = { ...(checks[planId] ?? {}) }
      delete table[date]
      checks = { ...checks, [planId]: table }
      await persistChecks()
      api.host.notify(`已清除 ${date} 的记录`)
      refresh()
    }

    async function deletePlan(planId) {
      const plan = plans.find((p) => p.id === planId)
      if (!plan) return
      plans = plans.filter((p) => p.id !== planId)
      const table = { ...checks }
      delete table[planId]
      checks = table
      if (selectedId === planId) selectedId = plans[0]?.id ?? ''
      await persistPlans()
      await persistChecks()
      api.host.notify(`已删除「${plan.title}」`)
      refresh()
    }

    function selectPlan(planId) {
      selectedId = planId
      selectedDay = ''
      refresh()
    }

    function pickDay(planId, date) {
      selectedId = planId
      selectedDay = String(date ?? '')
      refresh()
    }

    function shiftMonth(delta) {
      const d = new Date(month.y, month.m + delta, 1)
      month = { y: d.getFullYear(), m: d.getMonth() }
      // 切月清掉选中日（手机实测 2026-10-24 发现）：不清的话 9 月的日历底下
      // 还挂着「2026-10-24 · 0 次」，补打卡按钮照旧可点 —— 用户以为在改 9 月的某天。
      selectedDay = ''
      refresh()
    }

    /* ── 面板 ── */
    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '打卡',
        location: 'main',
        render: (ctx) => {
          ensureStarted()
          const state = ctx?.state ?? {}
          draftView = {
            id: editing?.id ?? '',
            title: String(state['habit.draft.title'] ?? ''),
            freq: String(state['habit.draft.freq'] ?? 'daily'),
            days: [1, 2, 3, 4, 5, 6, 7].filter((d) => state[`habit.draft.day.${d}`] === true),
            dayOfMonth: String(state['habit.draft.dayOfMonth'] ?? '1'),
            n: String(state['habit.draft.n'] ?? '2'),
            startDate: String(state['habit.draft.startDate'] ?? today()),
            target: String(state['habit.draft.target'] ?? '1'),
          }
          return habitNode({
            plans,
            checks,
            today: today(),
            selectedId,
            month,
            selectedDay,
            formOpen,
            draft: { ...draftView, days: draftView.days },
            status,
          })
        },
      }),
    )

    /* ── 命令 ── */
    const register = (id, title, run) => {
      api.subscriptions.push(api.command.register({ id, title, run }))
    }

    register('habit.create-plan', '打卡：新建计划', () => {
      startCreate()
      void openPanel()
    })
    register('habit.create-start', '打卡：新建计划（面板内）', () => startCreate())
    register('habit.cancel-form', '打卡：取消编辑', () => cancelForm())
    register('habit.save-plan', '打卡：保存计划', () => savePlan())
    register('habit.check', '打卡：打卡', (payload) => check(String(payload?.planId ?? '')))
    register('habit.edit', '打卡：编辑计划', (payload) => startEdit(String(payload?.planId ?? '')))
    register('habit.delete-plan', '打卡：删除计划', (payload) => deletePlan(String(payload?.planId ?? '')))
    register('habit.select-plan', '打卡：看这个计划的日历', (payload) => selectPlan(String(payload?.planId ?? '')))
    register('habit.pick-day', '打卡：选中某天', (payload) =>
      pickDay(String(payload?.planId ?? ''), String(payload?.date ?? '')),
    )
    register('habit.backfill', '打卡：补打卡', (payload) =>
      backfill(String(payload?.planId ?? ''), String(payload?.date ?? '')),
    )
    register('habit.clear-day', '打卡：清除某天的记录', (payload) =>
      clearDay(String(payload?.planId ?? ''), String(payload?.date ?? '')),
    )
    register('habit.prev-month', '打卡：上个月', () => shiftMonth(-1))
    register('habit.next-month', '打卡：下个月', () => shiftMonth(1))

    /**
     * 打开主区面板：`core.panel.<id>` 是内核给每个面板自动注册的命令。
     * 冷启动时面板可能还没登记好，重试几次（与 doc-reader 同一个套路）。
     */
    async function openPanel() {
      for (let i = 0; i < 5; i++) {
        try {
          await api.command.execute(`core.panel.${PANEL_ID}`)
          return
        } catch (e) {
          if (i === 4) throw e
          await new Promise((r) => setTimeout(r, 120))
        }
      }
    }
  },
}
