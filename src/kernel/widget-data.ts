/**
 * 安卓桌面组件的数据快照（需求 §15 · rev173.242）
 *
 * ## 它解决什么问题
 *
 * 桌面组件活在 Launcher 侧，**碰不到运行中的 WebView**（没有 IPC、没有 JS、没有内存态）。
 * 它唯一能读的是磁盘。所以内核在「库就绪 / 笔记变化」时算好一份 JSON 落盘
 * （`<app_data_dir>/.zn/widget-data.json`，见 `src-tauri/src/widgets.rs`），
 * 组件只做渲染与点击。
 *
 * ## 为什么「算」在前端
 *
 * 打卡的「今天该不该打」判定本来就在 JS 里（`examples/habit/index.js` 的 `isDueDay`），
 * 同一门语言才能逐行对照；让 Rust 复刻一份只会多一处会漂移的实现。
 * Rust 那边只负责原子写字节。
 *
 * ## 边界（刻意做窄）
 *
 * - **只出公开笔记**：私密笔记在 `.zn/private/` 里（插件管的密文），`list_notes` 本来就不上报；
 *   这里再显式排除一次 `.zn/` 前缀，防止将来 `list_notes` 放宽口径把私有内容漏到桌面上。
 * - **只出笔记**（`kind === 'note'`）：附件 / 只读文档不是「最近笔记」。
 * - **收件箱照常出现**：`收件箱/` 是公开内容（需求 §15.1「固定公开」），组件里能看到。
 */
import type { NoteMeta } from './contract'
import { globalPluginRoot } from './plugin-roots'
import { invoke } from '@tauri-apps/api/core'

/** 组件默认显示几条（需求 §15.3：可调 1 / 3 / 5 / 7） */
export const WIDGET_NOTE_LIMIT = 7

/** 组件里的一行笔记 */
export type WidgetNote = {
  /** 库内相对路径（POSIX）—— 组件点击时交给主窗口 `?open=` */
  path: string
  title: string
  /** 毫秒时间戳（组件按它排序 / 显示「今天 / 昨天」） */
  mtime: number
}

/** 组件里的一行今日计划 */
export type WidgetPlan = {
  id: string
  title: string
  /** 今天已经打了几次 */
  done: number
  /** 今天的目标次数（≥1） */
  target: number
}

/** 落盘的那份快照 */
export type WidgetData = {
  version: 1
  /** 快照属于哪个库（组件换库后靠它判断是否过期） */
  vault: string
  /** 生成时刻（毫秒）—— 组件显示「数据可能过期」的依据 */
  updatedAt: number
  /** 今日应打卡的计划（已按计划顺序，不含今天不该打的） */
  plans: WidgetPlan[]
  /** 最近修改的公开笔记（最新在前） */
  notes: WidgetNote[]
}

/* ───────────────── 纯函数（tests/widget-data.test.ts） ───────────────── */

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * 本地日期键 `YYYY-MM-DD`。
 *
 * ⚠️ 不能 `toISOString().slice(0,10)` —— 那是 UTC，东八区晚上 8 点后会算成明天
 * （与 `examples/habit/index.js` 的 `dayKey` 同一条教训，那边踩过）。
 */
export function widgetDayKey(d: Date): string {
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 解析 `YYYY-MM-DD` → 本地零点 Date；坏格式返回 null */
export function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? '').trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d
}

/** 星期几 → 1..7（周一 = 1，周日 = 7） */
export function widgetIsoWeekday(d: Date): number {
  return d.getDay() === 0 ? 7 : d.getDay()
}

/**
 * 今天是不是**应打卡日**。
 *
 * 从 `examples/habit/index.js` 的 `isDueDay` 复刻（那边有完整单测与注释）：
 * `daily` 每天 · `weekly` 命中 `days` · `monthly` 当月的 `dayOfMonth`（当月没有那天取月末）·
 * `everyN` 从 `startDate` 起每 N 天。早于 `startDate` 一律不算。
 *
 * ⚠️ 唯一有意的差异：这里**不判 `targetPerDay`**（那是「打几次」，不是「今天打不打」）。
 */
export function isDueDay(plan: HabitPlan | null | undefined, key: string): boolean {
  const d = parseDayKey(key)
  if (!plan || !d) return false
  if (plan.startDate) {
    const start = parseDayKey(plan.startDate)
    if (start && d.getTime() < start.getTime()) return false
  }
  switch (plan.freq) {
    case 'weekly':
      return Array.isArray(plan.days) && plan.days.map(Number).includes(widgetIsoWeekday(d))
    case 'monthly': {
      const want = Math.max(1, Math.min(31, Math.floor(Number(plan.dayOfMonth) || 1)))
      // 当月最后一天：`new Date(y, m+1, 0)` 是「下个月的第 0 天」
      const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
      return d.getDate() === Math.min(want, lastDay)
    }
    case 'everyN': {
      const n = Math.max(1, Math.floor(Number(plan.n) || 1))
      const start = parseDayKey(plan.startDate || key)
      if (!start) return false
      const diff = Math.round((d.getTime() - start.getTime()) / 86_400_000)
      return diff >= 0 && diff % n === 0
    }
    case 'daily':
    default:
      return true
  }
}

/** 打卡插件 store 里的计划（只取这里用得到的字段） */
export type HabitPlan = {
  id: string
  title?: string
  freq?: string
  days?: unknown[]
  dayOfMonth?: unknown
  n?: unknown
  startDate?: string
  targetPerDay?: unknown
}

/** 打卡插件 store 里的记录表：`{ [planId]: { 'YYYY-MM-DD': ['08:12'] } }` */
export type HabitChecks = Record<string, Record<string, unknown>>

/** 某计划今天的打卡次数（坏数据一律当 0，不让组件因为一条脏记录空白） */
export function doneToday(checks: HabitChecks, planId: string, key: string): number {
  const rec = checks?.[planId]?.[key]
  return Array.isArray(rec) ? rec.length : 0
}

/**
 * 今天应打卡的计划 → 组件数据。
 *
 * 顺序跟随 store 里的计划顺序（用户在面板里排过的顺序，组件不重排）。
 */
export function duePlans(
  plans: HabitPlan[],
  checks: HabitChecks,
  todayKey: string,
): WidgetPlan[] {
  if (!Array.isArray(plans)) return []
  return plans
    .filter((p): p is HabitPlan => !!p && typeof p.id === 'string')
    .filter((p) => isDueDay(p, todayKey))
    .map((p) => ({
      id: p.id,
      title: typeof p.title === 'string' && p.title.trim() ? p.title : '未命名计划',
      done: doneToday(checks, p.id, todayKey),
      target: Math.max(1, Math.floor(Number(p.targetPerDay) || 1)),
    }))
}

/**
 * 最近修改的**公开笔记**。
 *
 * `list_notes` 已经跳过 `.zn`，这里再显式挡一次 —— 桌面是最容易被别人看到的界面，
 * 这一层不能只依赖上游口径（`private` 目录的密文不该出现在组件里）。
 */
export function recentPublicNotes(
  notes: NoteMeta[],
  limit: number = WIDGET_NOTE_LIMIT,
): WidgetNote[] {
  if (!Array.isArray(notes)) return []
  const max = Math.max(0, Math.floor(limit))
  const picked = notes
    .filter((n) => n && n.kind === 'note')
    .filter((n) => !n.path.startsWith('.zn/') && !n.path.startsWith('.'))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, max)
  return picked.map((n) => ({ path: n.path, title: n.title || n.path, mtime: n.mtime }))
}

/** 组装整份快照（调用方给数据，这里只做形状） */
export function buildWidgetData(input: {
  vault: string
  notes: NoteMeta[]
  plans?: HabitPlan[]
  checks?: HabitChecks
  now?: Date
  limit?: number
}): WidgetData {
  const now = input.now ?? new Date()
  const todayKey = widgetDayKey(now)
  return {
    version: 1,
    vault: input.vault,
    updatedAt: now.getTime(),
    plans: duePlans(input.plans ?? [], input.checks ?? {}, todayKey),
    notes: recentPublicNotes(input.notes, input.limit ?? WIDGET_NOTE_LIMIT),
  }
}

/* ───────────────── 调用层 ───────────────── */

/** 打卡插件的 id（store 在 `<appDataDir>/.zn/plugins/habit/store.json`） */
const HABIT_PLUGIN_ID = 'habit'

/** 同一份库 10 秒内不重复写盘（保存笔记会连续触发，组件不需要这么实时） */
const SYNC_THROTTLE_MS = 10_000

let lastSync = { vault: '', at: 0 }
let syncing = false
/** 节流期间被跳过的那次（用最后一次的数据补写，避免「刚好错过最新一条」） */
let pending: { vault: string; notes: NoteMeta[] } | null = null

/**
 * 把当前状态写成组件快照。
 *
 * - 失败一律**吞掉并返回原因**：组件数据是锦上添花，不能因为它报错打断保存流程。
 * - 同一份库 10 秒内只写一次；被节流的那次会记住最新 notes，等下一次触发时补写。
 */
export async function syncWidgetData(opts: {
  vault: string | null
  notes: NoteMeta[]
  force?: boolean
}): Promise<string | null> {
  const { vault, notes } = opts
  if (!vault) return null
  const now = Date.now()
  if (!opts.force && vault === lastSync.vault && now - lastSync.at < SYNC_THROTTLE_MS) {
    pending = { vault, notes }
    return null
  }
  if (syncing) {
    pending = { vault, notes }
    return null
  }
  syncing = true
  try {
    let plans: HabitPlan[] = []
    let checks: HabitChecks = {}
    try {
      const root = await globalPluginRoot()
      const store = await invoke<Record<string, unknown>>('plugin_store_read', {
        vault: root,
        pluginId: HABIT_PLUGIN_ID,
      })
      if (Array.isArray(store?.plans)) plans = store.plans as HabitPlan[]
      if (store?.checks && typeof store.checks === 'object' && !Array.isArray(store.checks)) {
        checks = store.checks as HabitChecks
      }
    } catch {
      // 打卡插件没装 / store 读不了 ⇒ 组件只显示最近笔记，不报错
    }
    const data = buildWidgetData({ vault, notes, plans, checks })
    const path = await invoke<string>('widget_data_write', { data: JSON.stringify(data) })
    lastSync = { vault, at: now }
    return path
  } catch (e) {
    console.warn('[widget] 快照写入失败', e)
    return null
  } finally {
    syncing = false
    const p = pending
    pending = null
    // 补写被跳过的那次（force 一次，避免无限递归节流）
    if (p && (p.vault !== lastSync.vault || Date.now() - lastSync.at >= SYNC_THROTTLE_MS)) {
      void syncWidgetData({ vault: p.vault, notes: p.notes, force: true })
    }
  }
}

/** 测试用：重置节流状态（生产代码不要调） */
export function __resetWidgetSyncForTest(): void {
  lastSync = { vault: '', at: 0 }
  pending = null
  syncing = false
}

/**
 * 取走「桌面组件改过打卡数据」的脏标记（需求 §15.2）。
 *
 * 桌面组件点一下 = 直接往 `habit` 插件的 `store.json` 里追加一条记录（组件在 Launcher
 * 进程里，没有别的通道）。而插件在 WebView 里持有的是加载时的**内存态** ——
 * 用户切回 App 时若插件还活着，它不知道磁盘变了，下次保存就会把组件那笔覆盖掉。
 *
 * ⇒ 前端在**回到前台**时调用这里；返回 true 就 `reloadPlugin('habit')`（重载 = 重读磁盘）。
 * 取走语义：同一笔只需要重载一次。
 *
 * 桌面平台没有这个标记，恒返回 false（这条命令在两端都注册，不分支）。
 */
export async function takeHabitWidgetDirty(): Promise<boolean> {
  try {
    return await invoke<boolean>('widget_take_habit_dirty')
  } catch {
    return false
  }
}
