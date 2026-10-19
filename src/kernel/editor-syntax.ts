/**
 * Markdown 语法增强（rev173.36 · 2026-10-19 用户要求「做一个 Markdown 补全插件，把这些样式补齐」）。
 *
 * ## 为什么在内核里，而不是插件
 * 插件 API（`EditorMarkRule`）只收「正则 → 5 个语义档位」的**声明式**规则，
 * 做不了上标（要垂直偏移 + 隐藏 `^` 标记），也做不了 Emoji（要把 `:smile:` 换成字符）、
 * 更做不了数学公式（需要 KaTeX widget）。这些必须由宿主翻译成 CM6 装饰器 ——
 * 与 `editor-marks.ts` 同一层。
 *
 * ## 已实现
 * · 上标 `^x^` / 下标 `~x~` / Emoji `:name:`（第一批）
 * · 行内数学 `$…$` / 块级数学 `$$ … $$`（KaTeX，第二批）
 * 规则（与 atomic 的 Live Preview 一致）：
 * · 光标所在行（块级数学：光标落在块内）**不渲染**（显示源码，方便编辑）；
 * · 行内代码 `…` 与围栏代码块内不渲染；
 * · 标记符（`^` `~` `$`）被隐藏，只留样式。
 *
 * 后续批次：脚注、Mermaid、定义列表。
 */
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type { Extension, Range, Text } from '@codemirror/state'
import { StateField, type EditorState } from '@codemirror/state'

const supMark = Decoration.mark({ class: 'zn-sup' })
const subMark = Decoration.mark({ class: 'zn-sub' })
/** 空替换：隐藏 `^` / `~` 标记本身 */
const hideMark = Decoration.replace({})

class EmojiWidget extends WidgetType {
  /** 要显示的 emoji 字符 */
  ch: string
  constructor(ch: string) {
    super()
    this.ch = ch
  }
  override eq(other: EmojiWidget) {
    return other.ch === this.ch
  }
  override toDOM() {
    const span = document.createElement('span')
    span.className = 'zn-emoji'
    span.textContent = this.ch
    return span
  }
  override ignoreEvent() {
    return true
  }
}

/** 行内数学：KaTeX 渲染成行内 span（源码 `$…$` 被隐藏） */
class MathInlineWidget extends WidgetType {
  tex: string
  constructor(tex: string) {
    super()
    this.tex = tex
  }
  override eq(other: MathInlineWidget) {
    return other.tex === this.tex
  }
  override toDOM() {
    const span = document.createElement('span')
    span.className = 'zn-math'
    try {
      span.innerHTML = katex.renderToString(this.tex, { throwOnError: false, displayMode: false })
    } catch {
      span.textContent = `$${this.tex}$`
    }
    return span
  }
  override ignoreEvent() {
    return true
  }
}

/** 块级数学：KaTeX display 模式，独占一行块 */
class MathBlockWidget extends WidgetType {
  tex: string
  constructor(tex: string) {
    super()
    this.tex = tex
  }
  override eq(other: MathBlockWidget) {
    return other.tex === this.tex
  }
  override toDOM() {
    const div = document.createElement('div')
    div.className = 'zn-math-block'
    try {
      div.innerHTML = katex.renderToString(this.tex, { throwOnError: false, displayMode: true })
    } catch {
      div.textContent = this.tex
    }
    return div
  }
  // 不吞点击：让 CM6 把点击位置映射回文档 → 光标进入块内 → 切换成源码可编辑
  override ignoreEvent() {
    return false
  }
}

/**
 * 常用 Emoji（GitHub 风格短码）。没有映射的保持原文 —— 宁可不换，也不猜错。
 * 完整表太大；先收常用，后续按用户需要补。
 */
const EMOJI: Record<string, string> = {
  smile: '😄',
  laughing: '😆',
  joy: '😂',
  blush: '😊',
  wink: '😉',
  heart_eyes: '😍',
  thinking: '🤔',
  neutral_face: '😐',
  cry: '😢',
  sob: '😭',
  angry: '😠',
  rage: '😡',
  scream: '😱',
  yawn: '🥱',
  sleepy: '😴',
  sunglasses: '😎',
  nerd_face: '🤓',
  money_face: '🤑',
  heart: '❤️',
  broken_heart: '💔',
  thumbsup: '👍',
  '-1': '👎',
  clap: '👏',
  pray: '🙏',
  wave: '👋',
  ok_hand: '👌',
  point_right: '👉',
  point_left: '👈',
  muscle: '💪',
  ok: '🆗',
  '+1': '👍',
  100: '💯',
  fire: '🔥',
  star: '⭐',
  sparkles: '✨',
  rocket: '🚀',
  tada: '🎉',
  gift: '🎁',
  trophy: '🏆',
  medal: '🏅',
  crown: '👑',
  bulb: '💡',
  book: '📖',
  books: '📚',
  pencil: '✏️',
  memo: '📝',
  clipboard: '📋',
  calendar: '📅',
  clock: '🕐',
  hourglass: '⏳',
  coffee: '☕',
  tea: '🍵',
  beer: '🍺',
  apple: '🍎',
  cake: '🍰',
  pizza: '🍕',
  warning: '⚠️',
  no_entry: '⛔',
  check: '✅',
  heavy_check_mark: '✔️',
  x: '❌',
  question: '❓',
  exclamation: '❗',
  lock: '🔒',
  unlock: '🔓',
  key: '🔑',
  link: '🔗',
  pushpin: '📌',
  paperclip: '📎',
  scissors: '✂️',
  hammer: '🔨',
  wrench: '🔧',
  gear: '⚙️',
  package: '📦',
  floppy_disk: '💾',
  computer: '💻',
  phone: '📱',
  camera: '📷',
  music: '🎵',
  art: '🎨',
  game_die: '🎲',
  soccer: '⚽',
  basketball: '🏀',
  eyes: '👀',
  speech_balloon: '💬',
  boom: '💥',
  zap: '⚡',
  recycle: '♻️',
  white_check_mark: '✅',
  red_circle: '🔴',
  green_circle: '🟢',
  blue_circle: '🔵',
  arrow_right: '➡️',
  arrow_left: '⬅️',
  arrow_up: '⬆️',
  arrow_down: '⬇️',
}

/** 行内识别结果（纯函数产物，便于单测；不含任何 DOM） */
export type InlineMatch =
  | { kind: 'sup' | 'sub'; from: number; to: number; innerFrom: number; innerTo: number }
  | { kind: 'emoji'; from: number; to: number; ch: string }
  | { kind: 'math'; from: number; to: number; tex: string }

/** 行内代码区间（`` `…` ``）—— 里面的语法一律不动 */
function codeRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  const re = /`[^`\n]*`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) out.push([m.index, m.index + m[0].length])
  return out
}

/**
 * 解析单行里的增强语法（纯函数，单测直接测它）。
 * 偏移都是**行内相对偏移**（0 起）。
 */
export function parseInline(text: string): InlineMatch[] {
  const out: InlineMatch[] = []
  const codes = codeRanges(text)
  const inCode = (i: number) => codes.some(([a, b]) => i >= a && i < b)
  let m: RegExpExecArray | null

  // 行内数学 $…$（排除 $$ 与换行；内容不能为空）—— **最先扫**：
  // 公式里的 `^` / `~` 不能被上标/下标规则抢先吃掉（`$a^2 + b^2$` 就是这样）
  const mathRanges: Array<[number, number]> = []
  const mathRe = /(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g
  while ((m = mathRe.exec(text))) {
    if (inCode(m.index)) continue
    mathRanges.push([m.index, m.index + m[0].length])
    out.push({ kind: 'math', from: m.index, to: m.index + m[0].length, tex: m[1] })
  }
  const inMath = (i: number) => mathRanges.some(([a, b]) => i >= a && i < b)

  // 上标 ^x^ —— 内容不能为空、不能以空白开头
  const supRe = /\^([^\s^][^^]*?)\^/g
  while ((m = supRe.exec(text))) {
    if (inCode(m.index) || inMath(m.index)) continue
    const s = m.index
    const e = s + m[0].length
    out.push({ kind: 'sup', from: s, to: e, innerFrom: s + 1, innerTo: e - 1 })
  }

  // 下标 ~x~ —— 前后不能紧贴另一个 ~，避免吃掉 ~~删除线~~
  const subRe = /(?<!~)~([^\s~][^~]*?)~(?!~)/g
  while ((m = subRe.exec(text))) {
    if (inCode(m.index) || inMath(m.index)) continue
    const s = m.index
    const e = s + m[0].length
    out.push({ kind: 'sub', from: s, to: e, innerFrom: s + 1, innerTo: e - 1 })
  }

  // Emoji :name: —— 只认表里有的
  const emojiRe = /:([a-z0-9_+-]{2,}):/gi
  while ((m = emojiRe.exec(text))) {
    if (inCode(m.index) || inMath(m.index)) continue
    const ch = EMOJI[m[1].toLowerCase()]
    if (!ch) continue
    out.push({ kind: 'emoji', from: m.index, to: m.index + m[0].length, ch })
  }

  return out
}

/** 把一行的识别结果翻译成 CM6 装饰器（偏移转为文档坐标） */
function lineDecorations(from: number, text: string): Range<Decoration>[] {
  const out: Range<Decoration>[] = []
  for (const hit of parseInline(text)) {
    if (hit.kind === 'emoji') {
      out.push(
        Decoration.replace({ widget: new EmojiWidget(hit.ch) }).range(
          from + hit.from,
          from + hit.to,
        ),
      )
      continue
    }
    if (hit.kind === 'math') {
      out.push(
        Decoration.replace({ widget: new MathInlineWidget(hit.tex) }).range(
          from + hit.from,
          from + hit.to,
        ),
      )
      continue
    }
    const mark = hit.kind === 'sup' ? supMark : subMark
    // 隐藏开头的 ^ / ~，内容加样式，隐藏结尾的 ^ / ~
    out.push(hideMark.range(from + hit.from, from + hit.from + 1))
    out.push(mark.range(from + hit.innerFrom, from + hit.innerTo))
    out.push(hideMark.range(from + hit.to - 1, from + hit.to))
  }
  return out
}

/** 块级数学：`$$` 单独起行、另一个 `$$` 单独收行（中间内容任意），或单行 `$$…$$` */
type MathBlock = { from: number; to: number; tex: string }

export function findMathBlocks(doc: Text): MathBlock[] {
  const out: MathBlock[] = []
  let open: { from: number; after: number } | null = null
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const t = line.text.trim()
    if (t === '$$') {
      if (!open) {
        open = { from: line.from, after: line.to }
      } else {
        out.push({ from: open.from, to: line.to, tex: doc.sliceString(open.after, line.from).trim() })
        open = null
      }
      continue
    }
    // 单行块：$$ … $$
    if (/^\$\$[^$]+\$\$$/.test(t) && t.length > 4) {
      out.push({ from: line.from, to: line.to, tex: t.slice(2, -2).trim() })
    }
  }
  return out
}

/**
 * 块级数学的装饰器。
 *
 * ⚠️ **必须由 StateField 提供**：CM6 禁止插件（ViewPlugin）提供 block 装饰器 ——
 * 实测会抛 `RangeError: Block decorations may not be specified via plugins` 并整页白屏。
 */
function mathBlockDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  const doc = state.doc
  for (const b of findMathBlocks(doc)) {
    // 光标落在块内 → 显示源码（方便编辑）
    const touched = state.selection.ranges.some((r) => r.from <= b.to && r.to >= b.from)
    if (touched) continue
    decos.push(
      Decoration.replace({ block: true, widget: new MathBlockWidget(b.tex) }).range(b.from, b.to),
    )
  }
  return Decoration.set(decos, true)
}

/** 行内装饰器（ViewPlugin 用；**不含 block 装饰器**） */
function buildInlineDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = []
  const doc = view.state.doc
  // 光标所在行不渲染（与 Live Preview 一致：那一行显示源码）
  const cursorLines = new Set<number>()
  for (const r of view.state.selection.ranges) {
    cursorLines.add(doc.lineAt(r.from).number)
    cursorLines.add(doc.lineAt(r.to).number)
  }
  // 块级数学区间：这些行由 MathBlockWidget 接管，不再做行内扫描
  const mathRanges = findMathBlocks(doc).map((b) => [b.from, b.to] as [number, number])

  let inFence = false
  for (const { from, to } of view.visibleRanges) {
    let pos = from
    while (pos <= to) {
      const line = doc.lineAt(pos)
      if (line.from > to) break
      const trimmed = line.text.trimStart()
      if (/^(```|~~~)/.test(trimmed)) {
        // 围栏代码块整块跳过（开/闭栅栏都翻转状态）
        inFence = !inFence
        pos = line.to + 1
        continue
      }
      const inMath = mathRanges.some(([a, b]) => line.from >= a && line.to <= b)
      if (!inFence && !inMath && !cursorLines.has(line.number)) {
        decos.push(...lineDecorations(line.from, line.text))
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(decos, true)
}

/** 块级数学字段（StateField 才能提供 block 装饰器） */
const mathBlockField = StateField.define<DecorationSet>({
  create(state) {
    return mathBlockDecorations(state)
  },
  update(value, tr) {
    // 选区变化也要重算（光标进入/离开块时切换「渲染 ↔ 源码」）
    if (tr.docChanged || tr.selection) return mathBlockDecorations(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** 接入 `MarkdownEditor` 的 extensions 数组 */
export function editorSyntaxExtensions(): Extension {
  return [
    mathBlockField,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = buildInlineDecorations(view)
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || u.selectionSet) {
            this.decorations = buildInlineDecorations(u.view)
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
  ]
}
