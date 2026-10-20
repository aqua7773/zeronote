/**
 * 多标签页的**纯逻辑**（rev173.50 · 2026-10-20 · 用户待办 #2）。
 *
 * 为什么单独成文件：这四条规则（打开 / 关闭后选谁 / 上下切换 / 改名重映射）都是
 * 纯数组运算，跟 React 状态无关 —— 放 `lib/` 才能直接单测，不用挂整个 App。
 * `App` 只负责把结果写回 state（见 `App.tabs` 那一段的接线）。
 *
 * 标签页的**实际文档状态**（内容 / undo 历史 / 滚动位置）不在这里：
 * 那是 `MarkdownEditor` 的 `stateCacheRef` / `scrollCacheRef`，按 path 缓存（rev173.50 之前就有）。
 * 这里只回答「哪几篇开着、当前是哪篇、关掉一篇之后该切到哪篇」。
 */

/** 同时打开的标签页上限。超出丢**最久没打开过**的那个（当前活动的永远保留）。 */
export const MAX_TABS = 12

/**
 * 打开一篇笔记：不在里面就追加到末尾；**已在里面则位置不动**（原样返回）。
 *
 * 为什么不做 MRU 挪位：标签位置固定，`Ctrl+Tab` / `Ctrl+Shift+Tab` 的循环顺序才稳定。
 * 若每次切回都挪到末尾，按两次「下一个」会在两篇之间来回跳（rev173.50 设计时推演过）。
 * 主流编辑器（VS Code / 浏览器）同样是固定位置。
 *
 * 超出上限时丢**最旧的**（队首）—— 没有使用时间信息可依，最旧的就是最可能不再需要的；
 * 当前活动的那篇必然刚被 `addTab` 过、在队尾，不会被误丢。
 */
export function addTab(tabs: string[], path: string): string[] {
  if (!path || tabs.includes(path)) return tabs
  const next = [...tabs, path]
  return next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next
}

/** 移除一篇（不存在则原样返回，不做无意义的数组复制）。 */
export function removeTab(tabs: string[], path: string): string[] {
  if (!tabs.includes(path)) return tabs
  return tabs.filter((p) => p !== path)
}

/**
 * 关掉一篇之后：剩下的标签 + **该切到哪篇**（null = 一篇都没了，回起始页）。
 *
 * 选邻居的顺序：先往右（原位置上现在的那个）→ 没有就往左 → 都没有就是 null。
 * 这与主流编辑器（VS Code / 浏览器）一致：关掉中间的标签，激活它右边那个。
 */
export function closeTab(tabs: string[], path: string): { tabs: string[]; next: string | null } {
  const i = tabs.indexOf(path)
  if (i < 0) return { tabs, next: null }
  const rest = tabs.filter((p) => p !== path)
  const next = rest.length ? rest[Math.min(i, rest.length - 1)] : null
  return { tabs: rest, next }
}

/**
 * 上一个 / 下一个标签（循环）。`step = 1` 往后、`-1` 往前。
 *
 * `active` 不在列表里（或为 null）时：往后取第一个。
 * 只有一篇时返回它自己（调用方可据此判断「没得切」而不必再判长度）。
 */
export function stepTab(tabs: string[], active: string | null, step: 1 | -1): string | null {
  if (!tabs.length) return null
  const i = active ? tabs.indexOf(active) : -1
  if (i < 0) return tabs[0]
  return tabs[(i + step + tabs.length) % tabs.length]
}

/**
 * 改名 / 移动后重映射标签里的路径 —— 否则标签还指着一条已经不存在的路径
 * （下一次自动保存就会写失败，且标签点开是空的）。
 *
 * `isDir` 时按目录前缀换（与 `App.renameNote` 对 `activePath` 的处理同一套规则）。
 * 结果去重：改名撞上已打开的路径时，保留先出现的那个（后面的重复项直接丢掉，
 * 否则 React 的 key 会重复）。
 */
export function remapTabs(tabs: string[], from: string, to: string, isDir = false): string[] {
  const mapped = tabs.map((p) => {
    if (p === from) return to
    if (isDir && p.startsWith(`${from}/`)) return `${to}${p.slice(from.length)}`
    return p
  })
  return [...new Set(mapped)]
}
