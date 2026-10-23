/**
 * `.cm-atomic-link` 的分类（rev173.97 · 用户「取消这个标签形式，wikilink 就是 wikilink」）。
 *
 * 背景（实测，`_shots/` 之外无证据，靠 DOM 查）：
 * frontmatter 里 `tags: [工作, 周报]` 被 markdown 解析成 **Link 节点** ⇒ atomic 给它
 * `.cm-atomic-link`（绿色 + 外链图标 + pointer）。但它既不是
 *   · `[[笔记]]`（wikilink —— atomic 的 `wiki-links.js` 严格要求**双方括号**），也不是
 *   · `[文字](url)`（外部链接 —— 方括号/圆括号被隐藏成 widget，可见文本里**不含 `[`**）。
 * 它只是「未定义引用的 shortcut link」，普通方括号而已。
 *
 * 判据（纯 DOM 文本，不依赖 CM6 位置）：
 *   · 可见文本以 `[` 开头、但不是 `[[` ⇒ **不是**链接，去掉链接外观（`zn-plain-link`）
 *   · 以 `[[` 开头 ⇒ wikilink，保留
 *   · 不以 `[` 开头 ⇒ 外部链接的可见文本，保留
 *
 * 为什么用可见文本而不是 `posAtDOM` 反查源码：`posAtDOM` 在有 widget 的节点上会抛错，
 * 而可见文本在三种情况下已经能分开（见上）。活跃行显示源码时可能含方括号，
 * 那一行本身就是源码态，去掉颜色影响可忽略。
 */
export function isPlainBracketLink(visibleText: string): boolean {
  const t = String(visibleText ?? '').trim()
  return t.startsWith('[') && !t.startsWith('[[')
}

/**
 * 按**源码**判断（首选，比可见文本稳）。
 *
 * 为什么需要两套判据（实测 rev173.97）：光标停在该行时 atomic 会**藏起方括号**，
 * `.cm-atomic-link` 的可见文本只剩 `工作, 周报` —— 用可见文本判断就会漏掉。
 * 源码在活跃 / 非活跃行是一致的。
 *
 *   `[[笔记]]`          → false（wikilink，保留）
 *   `[文字](url)`       → false（外部链接，保留）
 *   `[工作, 周报]`      → true （未定义引用的方括号，去外观）
 */
export function isPlainBracketSource(source: string): boolean {
  const s = String(source ?? '').trim()
  if (!s.startsWith('[')) return false
  if (s.startsWith('[[')) return false
  if (s.includes('](')) return false
  return true
}
