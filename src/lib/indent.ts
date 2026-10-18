/**
 * 列表行的缩进 / 反缩进（rev173.8 · 用户「手机端键盘上的快捷列表加个缩进和取消缩进按键」）。
 *
 * 纯函数：给一行文本与方向，返回行首的编辑（相对行首的偏移）；不该动时返回 null。
 * 只对**列表行**生效 —— 与编辑器里 Tab / Shift+Tab 的行为完全一致
 *（非列表行按 Tab 仍交给 CM6 的原生处理，按钮则什么都不做）。
 */

/** 一行是不是列表行（`- ` / `* ` / `+ ` / `1. ` / `1) `） */
export const LIST_LINE_RE = /^\s*(?:[-*+]|\d+[.)])\s+/

export type LineEdit = { from: number; to: number; insert: string }

/**
 * 行首编辑：
 *  · dir = 1  → 行首加两个空格（`from/to = 0`）
 *  · dir = -1 → 去掉行首 1–2 个空格（没有空格 ⇒ null）
 *  · 不是列表行 ⇒ null
 */
export function indentEdit(lineText: string, dir: 1 | -1): LineEdit | null {
  if (!LIST_LINE_RE.test(lineText)) return null
  if (dir > 0) return { from: 0, to: 0, insert: '  ' }
  const m = /^ {1,2}/.exec(lineText)
  if (!m) return null
  return { from: 0, to: m[0].length, insert: '' }
}
