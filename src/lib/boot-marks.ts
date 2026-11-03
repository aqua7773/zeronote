/**
 * 启动耗时打点（rev173.351 · 真人测试11 #2「每次刚进软件会出现一次明显卡顿」）。
 *
 * ## 为什么先打点再改
 *
 * 卡顿可能来自首帧渲染、插件扫描/激活、首次笔记列表加载，或者样式计算 ——
 * 猜哪个都是浪费。这里用 `performance.mark` 把几个**边界**记下来（无 DOM、无 IO，
 * 开销可忽略），真机冷启动后一条命令就能读出各阶段耗时，再决定改哪里。
 *
 * ## 怎么读
 *
 * · CDP：`node tools/cdp.mjs eval "__znBootMarks()"`（手机 / 桌面都行）
 * · 日志：`console.info('[zn-boot]', …)`，`adb logcat | findstr zn-boot`
 *
 * `at` 是相对**导航开始**的毫秒数（`performance.now()` 的口径），
 * 所以第一项 `entry` 就是「HTML 到能执行 main.tsx」的开销。
 */
export type BootMark = { name: string; at: number }
/** 一次主线程长任务（>50ms ⇒ 用户会感到「顿一下」） */
export type LongTask = { start: number; dur: number }

const marks: BootMark[] = []
const longTasks: LongTask[] = []
/** 只留启动期（前 20 秒）的长任务，避免长时间运行后无限增长 */
const LONG_TASK_WINDOW_MS = 20_000

/**
 * 主线程长任务监控（rev173.351）—— 这是「卡顿」的直接证据。
 *
 * 打点只能告诉我们阶段边界；用户说的「明显卡顿」是一个**长任务**把主线程占住，
 * 期间点击没响应。`PerformanceObserver({ entryTypes: ['longtask'] })` 只报 ≥50ms 的
 * 任务，正是要找的东西。
 */
try {
  if (typeof PerformanceObserver !== 'undefined') {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.startTime > LONG_TASK_WINDOW_MS) continue
        longTasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) })
      }
    })
    po.observe({ entryTypes: ['longtask'] })
  }
} catch {
  /* 老 WebView 不支持 longtask —— 打点表仍可用 */
}

/** 记录一个阶段（同名只记第一次 —— 重渲染 / 重加载不会把表撑爆） */
export function bootMark(name: string): void {
  if (typeof performance === 'undefined') return
  if (marks.some((m) => m.name === name)) return
  marks.push({ name, at: Math.round(performance.now()) })
  try {
    performance.mark(`zn-boot:${name}`)
  } catch {
    /* 老 WebView 没有 performance.mark —— 不影响主流程 */
  }
}

/** 完整打点表（从页面开始到调用时刻），供 CDP / 日志用 */
export function bootMarks(): { at: number; marks: BootMark[]; longTasks: LongTask[] } {
  return { at: Math.round(performance.now()), marks: [...marks], longTasks: [...longTasks] }
}

/** 把表打到控制台（一次字符串，方便 logcat 过滤） */
export function logBootMarks(): void {
  try {
    const { marks: list } = bootMarks()
    if (!list.length) return
    console.info('[zn-boot]', list.map((m) => `${m.name}@${m.at}`).join(' '))
  } catch {
    /* 忽略 */
  }
}

if (typeof window !== 'undefined') {
  ;(window as Window & { __znBootMarks?: () => unknown }).__znBootMarks = bootMarks
}
