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
