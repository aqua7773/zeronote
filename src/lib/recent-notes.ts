/**
 * 「最近打开的笔记」持久化（UI 重布局 B1）—— ☰ 主菜单的「最近打开」子菜单用。
 *
 * 纯逻辑：只碰 localStorage，不碰 React / DOM 渲染，符合 `src/lib` 的依赖方向。
 * 按**库**分组：换库后菜单里只列当前库最近打开的笔记（别的库的路径在当前库打不开）。
 */
export const LS_RECENT_NOTES = 'zeronote.notes.recent'
export const RECENT_NOTES_MAX = 8

export type RecentNote = {
  /** 所属库的绝对路径（换库隔离用） */
  vault: string
  /** 笔记相对库的路径 */
  path: string
  /** 最近一次打开的时间戳（毫秒） */
  at: number
}

/** 读全表。坏数据 / 隐私模式一律当空表（不抛错，不打断菜单） */
export function loadRecentNotes(): RecentNote[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_RECENT_NOTES) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (x): x is RecentNote =>
        !!x &&
        typeof x === 'object' &&
        typeof (x as RecentNote).vault === 'string' &&
        typeof (x as RecentNote).path === 'string' &&
        typeof (x as RecentNote).at === 'number',
    )
  } catch {
    return []
  }
}

/**
 * 记一条「刚打开」—— 同一个 (库, 路径) 只留最新那条，整表按时间倒序、封顶 8 条。
 * 写盘失败（配额 / 隐私模式）只影响下次启动，返回值照常给本次使用。
 */
export function rememberRecentNote(vault: string, path: string, at = Date.now()): RecentNote[] {
  const rest = loadRecentNotes().filter((n) => !(n.vault === vault && n.path === path))
  const next = [{ vault, path, at }, ...rest]
    // 同一时刻可能有多条（批量打开）：稳定按时间倒序
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_NOTES_MAX)
  try {
    localStorage.setItem(LS_RECENT_NOTES, JSON.stringify(next))
  } catch {
    /* 存不下就只在本次会话里生效（调用方拿到的是内存里的新表） */
  }
  return next
}

/** 当前库里最近打开的 N 篇（菜单渲染用） */
export function recentNotesOf(vault: string | null, limit = 5): RecentNote[] {
  if (!vault) return []
  return loadRecentNotes()
    .filter((n) => n.vault === vault)
    .slice(0, limit)
}

/**
 * 空态「最近 3 篇」（UI 重布局 B4 · 方案 §6 / O10）。
 *
 * 排序规则，两步：
 *  1. **最近打开过的**（`zeronote.notes.recent`）按时间倒序，只留当前库里**仍然存在**的笔记；
 *  2. 不足 `limit` 时用**修改时间**倒序补齐 —— 新库 / 刚从别的设备同步过来时打开记录是空的，
 *     这时「最近改过的」是最接近用户想法的回访入口。
 *
 * 现在打开记录里可能残留已删除 / 已改名的路径 ⇒ 必须用 `notes` 里真实存在的路径过滤，
 * 不然后备列表会在空态里给出一个点了没反应的死条目。
 */
export function pickRecentNotes(
  notes: Array<{ path: string; title?: string; kind?: string; mtime?: number }>,
  vault: string | null,
  limit = 3,
): Array<{ path: string; title: string }> {
  if (!vault) return []
  const usable = new Map(
    notes.filter((n) => n.kind === 'note').map((n) => [n.path, n] as const),
  )
  const picked: Array<{ path: string; title: string }> = []
  const seen = new Set<string>()
  for (const r of recentNotesOf(vault, 32)) {
    const meta = usable.get(r.path)
    if (!meta || seen.has(r.path)) continue
    seen.add(r.path)
    picked.push({ path: meta.path, title: meta.title || meta.path })
    if (picked.length >= limit) return picked
  }
  const rest = [...usable.values()]
    .filter((n) => !seen.has(n.path))
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
  for (const meta of rest) {
    if (picked.length >= limit) break
    picked.push({ path: meta.path, title: meta.title || meta.path })
  }
  return picked
}
