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
import {
  fileCardModelOf,
  fileCardRefresh,
  parseSingleLinkLine,
  type FileCardModel,
} from './file-card'
import { formatSize } from './attachment'

/**
 * 内嵌 HTML 的渲染开关（设置页「内嵌 HTML」）：作为**参数**一路传下来，
 * 而不是模块级状态 —— 模块级状态在「设置切换 → key 重建编辑器」时读到的是旧值（实测踩过）。
 * 白名单见 `HTML_ALLOWED_TAGS`：只放行纯排版标签，**属性一律剔除**（事件属性、style、class 全丢）。
 */

/** 允许渲染的内嵌 HTML 标签（无脚本、无外链、无表单） */
const HTML_ALLOWED_TAGS = new Set([
  'ins',
  'del',
  'mark',
  'kbd',
  'sup',
  'sub',
  'br',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'small',
  'code',
])

/**
 * 白名单净化（自实现，见 rev173.39 说明）。
 *
 * 不用 DOMPurify 的原因：它在 happy-dom 单测环境里行为不可靠（实测**剥掉了白名单标签**、
 * 又**放行了 iframe**），而运行时又是另一个环境 —— 行为无法用单测锁住。
 * 自实现：DOMParser 解析 → 只保留白名单标签、**丢弃全部属性**、文本原样；
 * 未知标签只把文本内容上提；`script` / `style` 整段丢弃。
 */
export function sanitizeHtml(raw: string): string {
  if (typeof DOMParser === 'undefined') return ''
  const doc = new DOMParser().parseFromString(raw, 'text/html')
  const out = doc.createElement('span')
  const walk = (node: Node, parent: Element) => {
    // 3 = TEXT_NODE（用数字而不是常量：happy-dom 里常量有时缺失）
    if (node.nodeType === 3) {
      parent.appendChild(doc.createTextNode(node.textContent ?? ''))
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    const tag = el.tagName.toLowerCase()
    // 危险标签：连内容一起丢
    if (tag === 'script' || tag === 'style') return
    if (!HTML_ALLOWED_TAGS.has(tag)) {
      // 未知标签：文本内容上提
      el.childNodes.forEach((c) => walk(c, parent))
      return
    }
    const clean = doc.createElement(tag)
    el.childNodes.forEach((c) => walk(c, clean))
    parent.appendChild(clean)
  }
  doc.body.childNodes.forEach((n) => walk(n, out))
  return out.innerHTML
}

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

/** 脚注引用 `[^1]` → 上标编号（点击跳转到定义，事件由 domEventHandlers 统一处理） */
class FootnoteRefWidget extends WidgetType {
  num: string
  constructor(num: string) {
    super()
    this.num = num
  }
  override eq(other: FootnoteRefWidget) {
    return other.num === this.num
  }
  override toDOM() {
    const sup = document.createElement('sup')
    sup.className = 'zn-footnote-ref'
    sup.dataset.num = this.num
    sup.textContent = this.num
    return sup
  }
  // 不吞事件：让 domEventHandlers 收到 mousedown（跳转）
  override ignoreEvent() {
    return false
  }
}

/** 脚注定义行 `[^1]: 内容` —— 整行接管（否则 atomic 会把正文当链接渲染） */
class FootnoteDefWidget extends WidgetType {
  num: string
  body: string
  constructor(num: string, body: string) {
    super()
    this.num = num
    this.body = body
  }
  override eq(other: FootnoteDefWidget) {
    return other.num === this.num && other.body === this.body
  }
  override toDOM() {
    const wrap = document.createElement('span')
    const sup = document.createElement('sup')
    sup.className = 'zn-footnote-defnum'
    sup.textContent = this.num
    const body = document.createElement('span')
    body.className = 'zn-footnote-def'
    body.textContent = this.body
    wrap.append(sup, body)
    return wrap
  }
  override ignoreEvent() {
    return true
  }
}

/** 内嵌 HTML（白名单净化后渲染；属性全部剔除） */
class HtmlWidget extends WidgetType {
  raw: string
  constructor(raw: string) {
    super()
    this.raw = raw
  }
  override eq(other: HtmlWidget) {
    return other.raw === this.raw
  }
  override toDOM() {
    const span = document.createElement('span')
    span.className = 'zn-html'
    span.innerHTML = sanitizeHtml(this.raw)
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

/** Mermaid 图表块：```mermaid … ```（源码先显示，渲染成功后替换成 SVG） */
let mermaidSeq = 0
class MermaidWidget extends WidgetType {
  code: string
  constructor(code: string) {
    super()
    this.code = code
  }
  override eq(other: MermaidWidget) {
    return other.code === this.code
  }
  override toDOM() {
    const div = document.createElement('div')
    div.className = 'zn-mermaid'
    // 先放源码（渲染失败时用户还能看到内容），成功后换成图
    const pre = document.createElement('pre')
    pre.className = 'zn-mermaid-src'
    pre.textContent = this.code
    div.appendChild(pre)
    const id = `zn-mermaid-${++mermaidSeq}`
    const dark = document.documentElement.dataset.theme === 'dark'
    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' })
        const { svg } = await mermaid.render(id, this.code)
        if (!div.isConnected) return
        div.innerHTML = svg
        div.classList.add('is-rendered')
      })
      .catch(() => {
        /* 保持源码 */
      })
    return div
  }
  // 不吞点击：让编辑器把点击映射回文档（光标进入块 → 显示源码可编辑）
  override ignoreEvent() {
    return false
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
  | { kind: 'footref'; from: number; to: number; num: string }
  | { kind: 'html'; from: number; to: number; raw: string }

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
 * `renderHtml` = 是否渲染内嵌 HTML（设置开关；关着时 HTML 整段不识别，显示源码）。
 */
export function parseInline(text: string, renderHtml = true): InlineMatch[] {
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

  // 脚注引用 [^1]（定义行 `[^1]:` 由 buildInlineDecorations 单独处理，不进这里）
  const footRe = /\[\^([^\]\n]+)\]/g
  while ((m = footRe.exec(text))) {
    if (inCode(m.index) || inMath(m.index)) continue
    out.push({ kind: 'footref', from: m.index, to: m.index + m[0].length, num: m[1] })
  }

  // 内嵌 HTML（仅白名单标签；设置开关关着时整段不识别）
  if (renderHtml) {
    const htmlRe =
      /<(ins|del|mark|kbd|sup|sub|strong|em|b|i|u|s|small|code|span)(?:\s[^>]*)?>([\s\S]*?)<\/\1>|<br\s*\/?>/gi
    while ((m = htmlRe.exec(text))) {
      if (inCode(m.index) || inMath(m.index)) continue
      out.push({ kind: 'html', from: m.index, to: m.index + m[0].length, raw: m[0] })
    }
  }

  return out
}

/** 把一行的识别结果翻译成 CM6 装饰器（偏移转为文档坐标） */
function lineDecorations(from: number, text: string, renderHtml: boolean): Range<Decoration>[] {
  const out: Range<Decoration>[] = []
  for (const hit of parseInline(text, renderHtml)) {
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
    if (hit.kind === 'footref') {
      out.push(
        Decoration.replace({ widget: new FootnoteRefWidget(hit.num) }).range(
          from + hit.from,
          from + hit.to,
        ),
      )
      continue
    }
    if (hit.kind === 'html') {
      out.push(
        Decoration.replace({ widget: new HtmlWidget(hit.raw) }).range(
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

/** 块级 Mermaid：```mermaid … ``` 围栏（开闭栅栏各自独立成行） */
export function findMermaidBlocks(doc: Text): MathBlock[] {
  const out: MathBlock[] = []
  let open: { from: number; after: number } | null = null
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const t = line.text.trim()
    if (!open) {
      if (/^```mermaid\s*$/.test(t)) open = { from: line.from, after: line.to }
      continue
    }
    if (t === '```') {
      out.push({ from: open.from, to: line.to, tex: doc.sliceString(open.after, line.from).trim() })
      open = null
    }
  }
  return out
}

/**
 * 库外非媒体附件的**文件卡片**（rev173.245 · 附件需求最后一小块）。
 *
 * 替换的是**整行** `[名](D:/某个大文件.pdf)`，与数学 / Mermaid 块同一套做法
 * （block 装饰器只能由 StateField 提供，见 `syntaxBlockField` 的说明）。
 *
 * 为什么不用 atomic 的 `.cm-atomic-link` 做增强：那是行内 mark，替换它的
 * 文本节点会与 CM6 的状态脱节（滚动 / 编辑时错位）；块级 widget 才是 CM6
 * 自己的渲染单元，滚动出去再回来由它重建。
 *
 * 点击行为分两半：卡片主体把光标放进这一行（`ignoreEvent` 返回 false，与图片一致，
 * 想看 / 改源码直接点），右上角「打开」按钮交给宿主分流（`onFileCardOpen`）。
 */
class FileCardWidget extends WidgetType {
  model: FileCardModel
  constructor(model: FileCardModel) {
    super()
    this.model = model
  }
  override eq(other: FileCardWidget) {
    const a = this.model
    const b = other.model
    return (
      a.name === b.name &&
      a.kind === b.kind &&
      a.ext === b.ext &&
      a.size === b.size &&
      a.missing === b.missing &&
      a.hint === b.hint
    )
  }
  override toDOM() {
    const m = this.model
    const card = document.createElement('div')
    card.className = `zn-file-card${m.missing ? ' is-missing' : ''}`
    card.dataset.kind = m.kind
    card.title = m.hint

    const icon = document.createElement('span')
    icon.className = 'zn-file-card-icon'
    icon.textContent = m.icon
    icon.setAttribute('aria-hidden', 'true')

    const body = document.createElement('span')
    body.className = 'zn-file-card-body'
    const name = document.createElement('span')
    name.className = 'zn-file-card-name'
    name.textContent = m.name
    const sub = document.createElement('span')
    sub.className = 'zn-file-card-sub'
    // 副标题的三段各自可缺：没有扩展名 / 台账没这条（大小未知）/ 本机读不到
    const bits: string[] = []
    if (m.ext) bits.push(m.ext.toUpperCase())
    if (m.size !== null) bits.push(formatSize(m.size))
    if (m.missing) bits.push('源文件不在本机')
    sub.textContent = bits.join(' · ')
    body.append(name, sub)

    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'zn-file-card-open'
    open.textContent = '打开'
    // 路径进 dataset：domEventHandlers 里读它，widget 不需要持有回调
    open.dataset.target = m.target

    card.append(icon, body, open)
    return card
  }
  /** 不吞点击：卡片主体点了就把光标放进这一行（与图片 widget 同一约定） */
  override ignoreEvent() {
    return false
  }
}

/**
 * 一行里只有一个库外附件链接 ⇒ 该行的卡片模型；否则 null。
 *
 * 导出是为了单测能直接锁「哪些行会被接管」（`tests/editor-syntax.test.ts`），
 * 装饰器本身的渲染仍由 CDP 实测覆盖（`docs/ROADMAP.md` §4 第 5 条口径）。
 */
export function findFileCardLines(
  doc: Text,
): { from: number; to: number; model: FileCardModel }[] {
  const out: { from: number; to: number; model: FileCardModel }[] = []
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const link = parseSingleLinkLine(line.text)
    if (!link) continue
    const model = fileCardModelOf(link.label, link.target)
    if (!model) continue
    out.push({ from: line.from, to: line.to, model })
  }
  return out
}

/** 块级数学的装饰器。
 *
 * ⚠️ **必须由 StateField 提供**：CM6 禁止插件（ViewPlugin）提供 block 装饰器 ——
 * 实测会抛 `RangeError: Block decorations may not be specified via plugins` 并整页白屏。
 */
function blockDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  const doc = state.doc
  const touched = (b: { from: number; to: number }) =>
    state.selection.ranges.some((r) => r.from <= b.to && r.to >= b.from)

  for (const b of findMathBlocks(doc)) {
    if (touched(b)) continue
    decos.push(
      Decoration.replace({ block: true, widget: new MathBlockWidget(b.tex) }).range(b.from, b.to),
    )
  }
  for (const b of findMermaidBlocks(doc)) {
    if (touched(b)) continue
    decos.push(
      Decoration.replace({ block: true, widget: new MermaidWidget(b.tex) }).range(b.from, b.to),
    )
  }
  // 文件卡片（rev173.245）：光标在行内时显示源码，与数学 / 图表块同一交互约定
  for (const b of findFileCardLines(doc)) {
    if (touched(b)) continue
    decos.push(
      Decoration.replace({ block: true, widget: new FileCardWidget(b.model) }).range(b.from, b.to),
    )
  }
  return Decoration.set(decos, true)
}

/** 行内装饰器（ViewPlugin 用；**不含 block 装饰器**） */
function buildInlineDecorations(view: EditorView, renderHtml: boolean): DecorationSet {
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
        // 脚注定义行 `[^1]: 内容` —— **整行**替换成 widget（否则 atomic 会把正文当链接渲染）
        const def = /^\[\^([^\]]+)\]:\s*/.exec(line.text)
        if (def) {
          decos.push(
            Decoration.replace({
              widget: new FootnoteDefWidget(def[1], line.text.slice(def[0].length)),
            }).range(line.from, line.to),
          )
          pos = line.to + 1
          continue
        }
        decos.push(...lineDecorations(line.from, line.text, renderHtml))
        // 定义列表（rev173.38）：术语行 + 下一行缩进解释
        //   术语
        //     解释（2+ 空格或 Tab 缩进）
        if (line.number < doc.lines) {
          const next = doc.line(line.number + 1)
          const cleanTerm = line.text.trim()
          if (
            cleanTerm &&
            !/^[#>*\-+|]/.test(cleanTerm) &&
            !/^( {2,}|\t)/.test(line.text) &&
            /^( {2,}|\t)\S/.test(next.text)
          ) {
            decos.push(Decoration.line({ class: 'zn-deflist-term' }).range(line.from))
            decos.push(Decoration.line({ class: 'zn-deflist-desc' }).range(next.from))
          }
        }
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(decos, true)
}

/** 块级装饰字段（数学 + Mermaid；StateField 才能提供 block 装饰器） */
const syntaxBlockField = StateField.define<DecorationSet>({
  create(state) {
    return blockDecorations(state)
  },
  update(value, tr) {
    // 选区变化也要重算（光标进入/离开块时切换「渲染 ↔ 源码」）；
    // 台账到达 / 变化时由 `fileCardRefresh` 主动触发一次（rev173.245）
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(fileCardRefresh))) {
      return blockDecorations(tr.state)
    }
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * 接入 `MarkdownEditor` 的 extensions 数组。
 *
 * `onFileCardOpen`（rev173.245）：文件卡片右上角「打开」→ 交回宿主分流
 * （与正文链接的 `onLocalLinkOpen` 同一层边界；编辑器不认文件系统）。
 */
export function editorSyntaxExtensions(
  renderHtml = true,
  onFileCardOpen?: (target: string) => void,
): Extension {
  return [
    syntaxBlockField,
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet
        constructor(view: EditorView) {
          this.decorations = buildInlineDecorations(view, renderHtml)
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || u.selectionSet) {
            this.decorations = buildInlineDecorations(u.view, renderHtml)
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    // 脚注引用点击 → 跳到对应定义行（`[^1]` 的「块内跳转」）
    EditorView.domEventHandlers({
      mousedown(event, view) {
        // 文件卡片的「打开」按钮（rev173.245）：卡片主体不拦，让 CM6 把光标放进这一行
        const openBtn = (event.target as HTMLElement | null)?.closest?.(
          '.zn-file-card-open',
        ) as HTMLElement | null
        if (openBtn) {
          event.preventDefault()
          const target = openBtn.dataset.target
          if (target) onFileCardOpen?.(target)
          return true
        }
        const el = (event.target as HTMLElement | null)?.closest?.('.zn-footnote-ref')
        if (!el) return false
        event.preventDefault()
        const num = (el as HTMLElement).dataset.num ?? ''
        const escaped = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const m = new RegExp(`^\\[\\^${escaped}\\]:`, 'm').exec(view.state.doc.toString())
        if (m) view.dispatch({ selection: { anchor: m.index }, scrollIntoView: true })
        return true
      },
    }),
  ]
}
