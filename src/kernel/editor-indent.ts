/**
 * 缩进 / 反缩进的**内核实现**（rev173.8）。
 *
 * 两个入口共用这一份：
 *  · 编辑器的 Tab / Shift+Tab（`MarkdownEditor` 的 keymap）；
 *  · 手机键盘上方工具栏的两个按钮（`core.indent` / `core.outdent` 命令 → `MarkToolbar`）。
 *
 * 只动**列表行**（判据见 `lib/indent.ts`）；非列表行返回 false，Tab 键交给 CM6 原生缩进。
 */
import type { EditorView } from '@codemirror/view'
import { indentEdit } from '../lib/indent'

export function indentLine(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view
  const line = state.doc.lineAt(state.selection.main.head)
  const edit = indentEdit(line.text, dir)
  if (!edit) return false
  view.dispatch({
    changes: { from: line.from + edit.from, to: line.from + edit.to, insert: edit.insert },
  })
  return true
}
