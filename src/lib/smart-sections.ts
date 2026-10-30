/**
 * 侧栏「智能分区」（UI 重布局目标态 ① · 方案 §2.1）。
 *
 * 三块：**今天 / 最近 7 天 / 未打标签**。前两块按 `mtime` 算（纯函数、全同步），
 * 第三块要靠内核索引（标签来源是 frontmatter + 正文 `#标签`，`notes` 里只有 frontmatter）。
 *
 * 为什么不在组件里算：日期边界是最容易出错的地方（本地时区、跨月、跨年），
 * 抽成纯函数才能被单测钉住。`now` 一律由调用方传入，测试里可以钉死。
 */
export type SmartSection = 'today' | 'week' | 'untagged'

/**
 * 分区只用到的字段。**刻意不 import `kernel/contract`** —— `src/lib/` 不允许反向依赖
 * kernel（开发约定 §1 的依赖方向）；结构类型对 `NoteMeta` 天然兼容，App 直接传数组即可。
 */
export type SmartNote = {
  path: string
  title: string
  mtime: number
  kind: string
}

export const SMART_SECTIONS: { id: SmartSection; label: string; title: string }[] = [
  { id: 'today', label: '今天', title: '今天修改' },
  { id: 'week', label: '最近 7 天', title: '最近 7 天修改' },
  { id: 'untagged', label: '未打标签', title: '未打标签' },
]

const DAY_MS = 24 * 60 * 60 * 1000

/** 本地时区的「今天 0 点」时间戳 */
export function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * 「最近 7 天」的起点 = **6 天前的 0 点**（含今天共 7 个自然日）。
 * 用自然日而不是 `now - 7*24h`：用户说「最近 7 天」指的是日历上的 7 天，
 * 不是精确到分钟的 168 小时（后者在早上打开应用时会莫名其妙地少一天内容）。
 */
export function weekStart(now: number): number {
  return startOfDay(now) - 6 * DAY_MS
}

/** 只留笔记（文档 / 图片 / 音视频不参与时间分区），按 mtime 从新到旧 */
export function pickByRecency(notes: SmartNote[], since: number): SmartNote[] {
  return notes
    .filter((n) => n.kind === 'note' && n.mtime >= since)
    .sort((a, b) => b.mtime - a.mtime)
}

/** 相对时间文案（侧栏列表用；比完整时间戳更省横向空间） */
export function relativeTime(mtime: number, now: number): string {
  const diff = now - mtime
  if (diff < 60_000) return '刚刚'
  const today = startOfDay(now)
  if (mtime >= today) {
    const hours = Math.floor(diff / 3_600_000)
    return hours >= 1 ? `${hours} 小时前` : `${Math.floor(diff / 60_000)} 分钟前`
  }
  if (mtime >= today - DAY_MS) return '昨天'
  const d = new Date(mtime)
  const cur = new Date(now)
  const md = `${d.getMonth() + 1}-${d.getDate()}`
  return d.getFullYear() === cur.getFullYear() ? md : `${d.getFullYear()}-${md}`
}

/**
 * 分区标题（列表页顶部）与空态文案。
 * 空态文案单独给是因为「今天 0 篇」和「未打标签 0 篇」的原因是相反的
 * （前者是今天没动过笔记，后者是每篇都打了标签）—— 提示语要说清。
 */
export function sectionTitle(section: SmartSection, count: number): string {
  const meta = SMART_SECTIONS.find((s) => s.id === section)
  return `${meta?.title ?? '分区'} · ${count} 篇`
}

export function sectionEmptyText(section: SmartSection): string {
  if (section === 'today') return '今天还没有改动过笔记'
  if (section === 'week') return '最近 7 天没有改动过笔记'
  return '所有笔记都打过标签了'
}

/**
 * 列表里的**显示用**标题。
 *
 * `NoteMeta.title` 是内核从严抽的「标题原文」：frontmatter `title` → 正文首行 → 文件名。
 * 正文首行常常带 Markdown 标记（`# 标题`、`![](x.png)`、`[[别的笔记]]`），直接当列表标题
 * 会显示成一串符号（B4 空态「最近 3 篇」就踩过，这里补上）。
 *
 * ⚠️ 只清洗**显示**：文件树 / 标签页 / 搜索命中仍用原始 title（它们是"笔记内容的一部分"，
 * 用户点进去看到的就是原文）。要改全局口径是另一个决定，不在本函数里偷偷改。
 */
export function displayTitle(raw: string): string {
  let t = raw.trim()
  // 标题行前缀（# / ## …）
  t = t.replace(/^#{1,6}\s+/, '')
  // 图片 → alt；wiki 链接 → 别名或目标名
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
  t = t.replace(/\[\[([^\]]+)\]\]/g, '$1')
  // 普通链接 [文字](地址) → 文字
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  // 行内强调 / 代码 / 删除线
  t = t.replace(/[*_`~]+/g, '')
  t = t.replace(/\s+/g, ' ').trim()
  return t || '（无标题）'
}
