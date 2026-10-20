/**
 * 会话恢复（hot exit）的**草稿快照**（rev173.65 · P2 · 对标 v2 §2.4）。
 *
 * 要解决的：自动保存 = 停笔 800ms + 失焦 / 关窗 flush。崩溃、或 dev 下 HMR
 * **整页重载**（不触发 blur / 关窗）会丢最后一次输入。这里把「还没落盘的手改」
 * 先写进 localStorage，下次启动在主窗口提示「恢复 / 丢弃」。
 *
 * 为什么只留 1 篇、且内容 ≤ 8 KB：
 *  · **1 篇** —— 用户同一时刻只在编辑一篇；多篇没有对应 UI，只会让「恢复哪篇」变模糊。
 *  · **8 KB** —— 这是兜底不是备份：超过就放弃（**绝不截断**，恢复半篇比不恢复更危险）。
 *    长文本来就有 800ms 自动保存兜着，草稿只负责覆盖"最后一下"。
 *
 * 与 `note-window-ledger.ts` 同风格：纯函数 + 薄 localStorage 包装，可单测。
 * 清理时机见 `hooks/useDocIO.ts`：saveNow 成功（含关窗前 flush）⇒ 清键；
 * 正常退出因此**不会**留下草稿 —— 只有崩溃 / 整页重载才留。
 */

/** localStorage 键：`{ path, content, at }` 一条 */
export const DRAFT_LS_KEY = 'zeronote.draft'
/** 内容上限（UTF-8 字节）—— 超了不存，避免把 localStorage 塞满 */
export const DRAFT_MAX_BYTES = 8 * 1024
/** 过期时间：一周前的崩溃草稿不再提示（用户早忘了自己在写什么） */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type DraftSnapshot = { path: string; content: string; at: number }

/** 内容字节数：中文按 UTF-8 3 字节算，8 KB 的口径才和 localStorage 占用量对得上 */
export function draftBytes(content: string): number {
  return new TextEncoder().encode(content).length
}

/**
 * 解析键值。任何异常（坏 JSON / 缺字段 / 超上限）一律返回 null ——
 * 草稿坏了最坏结果是「这次没有恢复提示」，**绝不能在启动路径上抛错**。
 */
export function parseDraft(raw: string | null): DraftSnapshot | null {
  if (!raw) return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const o = data as Record<string, unknown>
  if (typeof o.path !== 'string' || o.path.length === 0) return null
  if (typeof o.content !== 'string') return null
  if (draftBytes(o.content) > DRAFT_MAX_BYTES) return null
  return { path: o.path, content: o.content, at: typeof o.at === 'number' ? o.at : 0 }
}

/** 读草稿：过期 / 坏数据返回 null（过期顺手删键，别让它一直留着） */
export function loadDraft(now: number = Date.now()): DraftSnapshot | null {
  try {
    const d = parseDraft(localStorage.getItem(DRAFT_LS_KEY))
    if (!d) return null
    if (now - d.at > DRAFT_TTL_MS) {
      localStorage.removeItem(DRAFT_LS_KEY)
      return null
    }
    return d
  } catch {
    return null // 隐私模式 / 受限上下文读不了 localStorage
  }
}

/**
 * 写草稿（覆盖上一篇）。
 *
 * 超上限 / 空路径 ⇒ **清掉旧键**并返回 false：只留 1 篇的前提下，宁可这次没有，
 * 也不留一份与最新输入对不上的旧快照（否则启动时提示恢复的会是别的内容）。
 */
export function saveDraft(path: string, content: string, now: number = Date.now()): boolean {
  try {
    if (!path || draftBytes(content) > DRAFT_MAX_BYTES) {
      localStorage.removeItem(DRAFT_LS_KEY)
      return false
    }
    const snapshot: DraftSnapshot = { path, content, at: now }
    localStorage.setItem(DRAFT_LS_KEY, JSON.stringify(snapshot))
    return true
  } catch {
    return false // 配额满 / 隐私模式：草稿是兜底，写不进不能影响正常保存
  }
}

/** 删草稿（用户点「丢弃」/ 恢复完成） */
export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_LS_KEY)
  } catch {
    /* 无所谓 */
  }
}

/**
 * 只清「属于这一篇」的草稿（saveNow 成功 / 正常关窗时调用）。
 *
 * 为什么带 path：草稿可能属于上一篇（切篇后还没被覆盖），
 * 保存别篇成功时不能把它误删 —— 那会吞掉唯一一份崩溃恢复数据。
 */
export function clearDraftFor(path: string | null): void {
  if (!path) return
  try {
    const d = parseDraft(localStorage.getItem(DRAFT_LS_KEY))
    if (d && d.path === path) localStorage.removeItem(DRAFT_LS_KEY)
  } catch {
    /* 无所谓 */
  }
}
