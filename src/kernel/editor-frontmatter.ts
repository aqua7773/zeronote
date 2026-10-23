/**
 * frontmatter 隐藏（rev173.98 · 用户「frontmatter 隐藏」）。
 *
 * 现状（2026-10-23 实测）：atomic 会把开头的 `--- … ---` 渲染成「属性行」——
 * `tags: [工作, 周报]` 以标题 + 链接样式显示在正文顶部。用户要求直接隐藏。
 *
 * 做法：给 frontmatter 的每一行加一个 **line decoration**（`zn-fm-hidden`），
 * 样式里 `display: none`。为什么不是 `Decoration.replace`：
 *  · atomic 的 inline-preview 已经对这些行加了它自己的装饰（`cm-atomic-h2` / `cm-atomic-hr`）；
 *  · 再叠一个 replace 装饰属于**同范围覆盖**，CM6 会报重叠错误 —— 那是编辑器级崩溃，不是样式问题。
 *  line decoration 只加行 class，可与任何装饰共存。
 *
 * 编辑入口：**源码模式**（编辑器右上角「源码」）。预览态看不到 frontmatter，
 * 也就不会误以为它是笔记正文；要改 tags 就切源码。
 *
 * 关于"光标进入自动展开"：没有做 —— 行被 `display: none` 后点不到，光标进不去；
 * 硬要做还得监听选区再改装饰，收益不抵复杂度（源码模式已覆盖这个需求）。
 */
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view'
import type { Extension } from '@codemirror/state'

const HIDDEN_LINE = Decoration.line({ class: 'zn-fm-hidden' })
/** 只在前 64 KB 里找闭合的 `---`：frontmatter 不会很长，避免大文档每次编辑都全文扫描 */
const SCAN_LIMIT = 64 * 1024

/**
 * 文档开头的 frontmatter 占了几行（**含首尾两条 `---`**）；没有返回 0。
 *
 * 判据（与内核 `tagsOf` 的 frontmatter 识别保持一致）：
 * · 第 1 行必须**整行只有** `---`（前后允许空格）；
 * · 之后第一行整行 `---` 为闭合；
 * · 没有闭合（用户正打字打到一半）⇒ 返回 0，不隐藏 —— 半截 frontmatter 藏起来会让人以为内容丢了。
 */
export function frontmatterLineCount(text: string): number {
  const src = String(text ?? '')
  if (!src.startsWith('---')) return 0
  const lines = src.slice(0, SCAN_LIMIT).split(/\r?\n/)
  if (!/^---[ \t]*$/.test(lines[0] ?? '')) return 0
  for (let i = 1; i < lines.length; i++) {
    if (/^---[ \t]*$/.test(lines[i])) return i + 1
  }
  return 0
}

function build(view: EditorView): DecorationSet {
  const doc = view.state.doc
  const text = doc.sliceString(0, Math.min(doc.length, SCAN_LIMIT))
  const n = frontmatterLineCount(text)
  if (!n) return Decoration.none
  const ranges = []
  const upto = Math.min(n, doc.lines)
  for (let i = 1; i <= upto; i++) ranges.push(HIDDEN_LINE.range(doc.line(i).from))
  return Decoration.set(ranges, true)
}

export function frontmatterHide(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view)
      }
    },
    { decorations: (v) => v.decorations },
  )
}
