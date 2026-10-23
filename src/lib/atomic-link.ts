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

/**
 * 点击判据：这个 `.cm-atomic-link` 是 `[[…]]` 吗？是则返回**归一化后的目标名**，
 * 否则返回 `null`（rev173.98 修「链接无法跳转」）。
 *
 * **为什么不能看可见文本的形态**（rev173.97 的错）：
 *   · 光标所在行（活跃行）：atomic 把方括号换成 `contenteditable=false` 的 widget，
 *     `textContent` 只有目标名 —— `[[标签验收-周报]]` 取出 `标签验收-周报`；
 *   · 普通行：方括号是 `<span>`（视觉隐藏），`textContent` 变成 `[标签验收-周报]`。
 * 两种形态取决于光标位置 ⇒ 拿可见文本做 `^\[\[…\]\]$` 判定必然漏一半
 * （rev173.97 因此把所有点击都丢弃了，用户 2026-10-24 报「链接无法跳转」）。
 *
 * 改看**源码行**（与 `MarkdownEditor.mark()` 的外观判据同一套，保证「绿色 = 可点」）：
 * 行里有 `[[目标]]` ⇒ 返回 `目标`。
 *
 *   line `这里引用：[[标签验收-周报]]`, text `标签验收-周报`   → 标签验收-周报
 *   line `这里引用：[[标签验收-周报]]`, text `[标签验收-周报]`  → 标签验收-周报
 *   line `[[本周进展|周报]]`,           text `[本周进展|周报]`  → 本周进展|周报
 *   line `tags: [工作, 周报]`,          text `[工作, 周报]`    → null（普通方括号）
 *   line `[文字](https://x.y)`,         text `文字`            → null（外部链接）
 */
export function wikiLinkTarget(line: string, visibleText: string): string | null {
  const t = String(visibleText ?? '')
    .trim()
    .replace(/^\[+/, '')
    .replace(/\]+$/, '')
    .trim()
  if (!t) return null
  return String(line ?? '').includes(`[[${t}]]`) ? t : null
}
