/**
 * 笔记独立窗口的**占用账本**（rev173.63 · P1-c）。
 *
 * 为什么要有它：`noteWindowsRef` 只活在主窗口的一次页面生命周期里 —— 主窗口一 reload
 * （dev HMR / 用户刷新），账本就空了，于是「同一篇只能在一个容器里」的守卫失效：
 * 再点那篇会**开第二份**，同一个文件被两个窗口同时编辑。
 *
 * 存在 localStorage：跨 reload 保留；跨整个 app 重启时由调用方用「存活窗口集合」过滤
 * （重启后 `note-*` 窗口都不在了，过滤后自然清空）。
 *
 * 纯函数（解析 / 取序号 / 过滤）单独放这里，便于单测；读写 localStorage 的两个薄包装
 * 也在这里，调用方只管传账本。
 */

/** localStorage 键：`{ [库内路径]: "note-3" }` */
export const NOTE_WINDOWS_LS_KEY = 'zeronote.noteWindows'

export type NoteWindowLedger = Record<string, string>

/**
 * 解析 localStorage 里的账本。
 *
 * 容错是刻意的：这个键可能被旧版本写过、被手工改坏、或在隐私模式里读到 `null` ——
 * 任何异常都退回空账本（最坏结果是"多开一次"，绝不因为账本坏掉而拦住正常打开）。
 */
export function parseLedger(raw: string | null): NoteWindowLedger {
  if (!raw) return {}
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const out: NoteWindowLedger = {}
  for (const [path, label] of Object.entries(data as Record<string, unknown>)) {
    // 只认「note-<数字>」：别的 label 不是笔记窗口（插件窗口 / 主窗口），混进来会误拦
    if (typeof label === 'string' && /^note-\d+$/.test(label)) out[path] = label
  }
  return out
}

export function loadLedgerStorage(): NoteWindowLedger {
  try {
    return parseLedger(localStorage.getItem(NOTE_WINDOWS_LS_KEY))
  } catch {
    return {}
  }
}

export function saveLedgerStorage(ledger: NoteWindowLedger): void {
  try {
    if (Object.keys(ledger).length === 0) localStorage.removeItem(NOTE_WINDOWS_LS_KEY)
    else localStorage.setItem(NOTE_WINDOWS_LS_KEY, JSON.stringify(ledger))
  } catch {
    /* 配额满 / 隐私模式：账本只影响"是否已拆窗"，丢了最多多开一次 */
  }
}

/** 账本里最大的窗口序号（`note-7` → 7；没有就 0）—— 新 label 从它 +1 起，避免与残留窗口撞名 */
export function maxWindowSeq(ledger: NoteWindowLedger): number {
  let max = 0
  for (const label of Object.values(ledger)) {
    const m = /^note-(\d+)$/.exec(label)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/** 丢掉 label 不在存活集合里的条目（窗口已关 / 重启前残留） */
export function pruneLedger(ledger: NoteWindowLedger, alive: Set<string>): NoteWindowLedger {
  const out: NoteWindowLedger = {}
  for (const [path, label] of Object.entries(ledger)) {
    if (alive.has(label)) out[path] = label
  }
  return out
}
