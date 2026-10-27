/**
 * `[[笔记名]]` 悬浮预览的纯逻辑（rev173.228 · 需求 §4.5「引用显示标题和摘要」）。
 *
 * 与点击跳转**共用同一套匹配**（`findWikiNote`）—— 两处各写一份必然漂移：
 * 点开的是 A、预览显示的是 B，用户会以为链接坏了。
 *
 * 需求原文（`docs/requirements/current.md` §4.5）：
 * 「笔记可互相引用 · 引用显示标题和摘要 · 被引用笔记标题/摘要变化时引用自动更新 · 反向链接」。
 * 前两条落到这里；「自动更新」靠每次 hover 现查（不缓存笔记内容，只缓存渲染结果）。
 */

/** 能参与匹配的最小笔记形状（`NoteMeta` 的超集，测试里可以塞更小的对象） */
export type WikiNote = { id: string; path: string; title: string }

/** 路径归一：反斜杠转正斜杠、去 `.md`、去首尾空白 */
function norm(s: string): string {
  return String(s ?? '')
    .replace(/\\/g, '/')
    .replace(/\.md$/i, '')
    .trim()
}

/** `[[目标|别名]]` → 目标（别名只是显示名，不参与查找） */
export function wikiTarget(raw: string): string {
  return String(raw ?? '').split('|')[0].trim()
}

/**
 * 把 `[[…]]` 的目标解析成一篇笔记。匹配顺序（与点击跳转一致）：
 *
 * 1. 独立笔记 ID（`[[a1b2c3]]`）
 * 2. 库内相对路径去 `.md`（`[[日记/今天]]`）
 * 3. 路径**后缀**（`[[今天]]` 命中 `日记/今天.md`）
 * 4. 显示标题（frontmatter title / 正文首行）
 *
 * 找不到返回 `null` —— 调用方决定是提示还是只显示「未找到」的浮层。
 */
export function findWikiNote<T extends WikiNote>(notes: readonly T[], raw: string): T | null {
  const target = wikiTarget(raw)
  if (!target) return null
  const want = norm(target)
  if (!want) return null
  return (
    notes.find((n) => n.id === target) ??
    notes.find((n) => norm(n.path) === want) ??
    notes.find((n) => norm(n.path).endsWith(`/${want}`)) ??
    notes.find((n) => norm(n.title) === want) ??
    null
  )
}

/**
 * 笔记正文 → 预览摘要：剥掉会干扰阅读的结构（frontmatter / 代码块 / 图片 / 链接 / 标题符号），
 * 压成一行，超过 `max` 字截断加 `…`。
 *
 * 为什么不是「直接取前 N 字」：目标笔记开头常常是 `---` frontmatter 或 `# 标题`，
 * 原样截出来预览里全是符号，看着像没渲染的源码。
 */
export function previewSnippet(md: string, max = 140): string {
  const body = String(md ?? '')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') // frontmatter
    .replace(/```[\s\S]*?```/g, ' ') // 围栏代码块
    .replace(/`([^`]*)`/g, '$1') // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只留文字
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, a: string, b?: string) => b || a) // wikilink
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // ATX 标题
    .replace(/^\s{0,3}>\s?/gm, '') // 引用
    .replace(/[*_~]/g, '') // 强调标记
    .replace(/\s+/g, ' ')
    .trim()
  return body.length > max ? `${body.slice(0, max)}…` : body
}
