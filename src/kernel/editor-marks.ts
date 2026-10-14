/**
 * editor 原语 —— **声明式标记规则**的注册表，以及「规则 → CodeMirror 装饰器」的翻译。
 * 对应契约 §2.6。
 *
 * 为什么不让插件直接给 CM6 `Extension`：
 *  ① 那是宿主依赖里的**类实例**，插件代码是字符串（将来还要进 Worker/iframe）—— 塞不进来；
 *  ② 一旦暴露，插件能把编辑器改成任意样子 ⇒ 声明式主路又被绕过（这是契约 §7 一直在防的）。
 * 所以插件只交**可序列化规则**（正则字符串 + 语义档位 + 命令 id），翻译工作留在宿主。
 *
 * 重叠处理：**先到先得** —— 前一条规则占掉的区间，后面的规则不再着色。
 * 这样多条规则叠加时行为可预期，也避免 CM6 的 RangeSetBuilder 因区间交叉而抛错。
 */
import { StateEffect, StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import type {
  Disposable,
  EditorApi,
  EditorFoldRule,
  EditorLineAction,
  EditorLineClassRule,
  EditorMarkRule,
} from './contract'

type Entry = {
  /** 完整 id（插件前缀 + 规则 id），用在 DOM 属性上 */
  fullId: string
  pluginId: string
  rule: EditorMarkRule
}

const entries = new Map<string, Entry>()

/** 行首动作按钮的条目（`addLineAction`，rev54） */
type LineEntry = { fullId: string; pluginId: string; rule: EditorLineAction }
const lineEntries = new Map<string, LineEntry>()

/** 逐行 class 的条目（`addLineClass`，rev78 新增 —— 大纲竖线用） */
type LineClassEntry = { fullId: string; pluginId: string; rule: EditorLineClassRule }
const lineClassEntries = new Map<string, LineClassEntry>()

/** 折叠/展开的条目（`addFold`，rev80 新增 —— 大纲折叠用） */
type FoldEntry = { fullId: string; pluginId: string; rule: EditorFoldRule }
const foldEntries = new Map<string, FoldEntry>()

/**
 * **"重算装饰"信号**（rev80）。
 *
 * 折叠是**有状态**的交互，而状态在插件手里 ⇒ 插件改完状态要让内核重画。
 * 空 transaction 不会触发 ViewPlugin 的 `docChanged / viewportChanged`，
 * 所以用一个自定义 effect 当信号；`refresh()` 就是"朝每个活着的编辑器各 dispatch 一次"。
 */
const refreshEffect = StateEffect.define<null>()

/**
 * 诊断出口（`window.__znFoldStats`）：折叠这条链上"谁在什么时候做了什么"。
 *
 * 为什么要有它：折叠是**跨内核/插件两层**的协作（内核问状态 → 插件改 → 内核重画），
 * 出问题时截图只能看出"没变"，分不清是"没回调""没重画"还是"重画了但状态没变"。
 * 2026-10-14 就是靠它定位到"块替换区间起点算错 ⇒ 点完圆点行不藏"。
 */
function foldStat(kind: string, data: Record<string, unknown>): void {
  const w = window as unknown as { __znFoldStats?: unknown[] }
  ;(w.__znFoldStats ??= []).push({ kind, ...data, at: Date.now() })
}

/**
 * 活着的编辑器实例（rev80 加的）：`refresh()` 需要拿到 view 才能 dispatch，
 * 而内核这一层**拿不到** EditorView（`createKernel(vault, doc, hooks)` 里没有它）。
 * 与其给内核新开一条 view 通道，不如让 ViewPlugin 自己登记 —— 它本来就在每个编辑器里存在。
 */
const liveViews = new Set<EditorView>()

/**
 * ⚠️ **内核不再画折叠按钮**（2026-10-14 定案）。
 *
 * 原先这里是一个 `FoldDotWidget`（`<button class="zn-fold-dot">`）—— 它是**独立元素**，
 * 于是"怎么跟库渲染的圆点同心"变成了一道**像素题**：`absolute + translateY` 要按字体度量硬调，
 * 改行内流又要靠 margin 推，实测怎么都剩 1–2px（用户复看放大截图就发现"托偏上"）。
 *
 * **正解是不要第二个元素**：把圆托挂在**圆点自己的伪元素**上（`.cm-atomic-bullet::before`）——
 * 同一个盒子 ⇒ 同心是**定义上的**，一个像素都不用调。
 *
 * 而"圆点长什么样、点了算什么"属于**外观**：按本项目既定原则（插件可用 `manifest.styles`
 * 注入样式、也可以覆盖内核实现）交回**插件** ——
 * 插件给行加 `zn-ol-foldable` / `zn-ol-folded` class（复用 `editor.addLineClass`），
 * 自己写 CSS、自己接点击，改完调 `api.editor.refresh()`。
 * 内核只保留**只有它能做**的那半：把子行藏起来（CM6 的块替换必须由 StateField 提供，插件碰不到）。
 */

/**
 * 行首按钮的视图元素（CM6 Widget）。
 *
 * `ignoreEvent()` **必须**返回 false —— 官方 *Decoration Example* 里那句注释就是原因：
 * 否则编辑器把自己的事件处理吃掉，按钮点不动。
 * `contentEditable=false` 让编辑器别把它当文本内容（光标/选区不会跳进按钮里）。
 */
class LineActionWidget extends WidgetType {
  readonly fullId: string
  readonly label: string
  readonly title: string | undefined
  readonly className: string | undefined

  // ⚠️ 不能写成 `constructor(readonly label: string)`（TS 的参数属性）——
  // 本项目 `erasableSyntaxOnly: true`，那种语法会生成代码，直接编译不过（官方示例是参数属性写法）
  constructor(fullId: string, label: string, title: string | undefined, className: string | undefined) {
    super()
    this.fullId = fullId
    this.label = label
    this.title = title
    this.className = className
  }

  eq(other: LineActionWidget) {
    return (
      other.fullId === this.fullId &&
      other.label === this.label &&
      other.title === this.title &&
      other.className === this.className
    )
  }

  toDOM() {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `zn-line-action${this.className ? ` is-${this.className}` : ''}`
    btn.textContent = this.label
    if (this.title) btn.title = this.title
    btn.setAttribute('data-zn-line-action', this.fullId)
    btn.setAttribute('aria-label', this.title ?? this.label)
    btn.contentEditable = 'false'
    return btn
  }

  ignoreEvent() {
    return false
  }
}

/** 规则变化时才重建扩展数组（MarkdownEditor 每次 render 都会调） */
let cachedExtensions: Extension[] | null = null

function fullIdOf(pluginId: string, ruleId: string): string {
  return `${pluginId}/${ruleId}`
}

/** 给某个插件用的视图 */
export function createScopedEditorApi(pluginId: string): EditorApi {
  return {
    addMark(rule: EditorMarkRule): Disposable {
      const fullId = fullIdOf(pluginId, rule.id)
      entries.set(fullId, { fullId, pluginId, rule })
      cachedExtensions = null
      return {
        dispose: () => {
          // 只有"登记的还是自己"才删 —— 免得旧实例的 dispose 干掉新同名规则
          if (entries.get(fullId)?.pluginId === pluginId) {
            entries.delete(fullId)
            cachedExtensions = null
          }
        },
      }
    },
    addLineAction(rule: EditorLineAction): Disposable {
      const fullId = fullIdOf(pluginId, rule.id)
      lineEntries.set(fullId, { fullId, pluginId, rule })
      cachedExtensions = null
      return {
        dispose: () => {
          if (lineEntries.get(fullId)?.pluginId === pluginId) {
            lineEntries.delete(fullId)
            cachedExtensions = null
          }
        },
      }
    },
    addLineClass(rule: EditorLineClassRule): Disposable {
      const fullId = fullIdOf(pluginId, rule.id)
      lineClassEntries.set(fullId, { fullId, pluginId, rule })
      cachedExtensions = null
      return {
        dispose: () => {
          if (lineClassEntries.get(fullId)?.pluginId === pluginId) {
            lineClassEntries.delete(fullId)
            cachedExtensions = null
          }
        },
      }
    },
    addFold(rule: EditorFoldRule): Disposable {
      const fullId = fullIdOf(pluginId, rule.id)
      foldEntries.set(fullId, { fullId, pluginId, rule })
      cachedExtensions = null
      return {
        dispose: () => {
          if (foldEntries.get(fullId)?.pluginId === pluginId) {
            foldEntries.delete(fullId)
            cachedExtensions = null
          }
        },
      }
    },
    refresh() {
      /**
       * 朝**每个活着的编辑器**各发一次"重算"信号。
       * 为什么不是只发当前那个：同一时间可能有多个编辑器（主窗口 + 插件独立窗口里的
       * 分屏），而 `refresh()` 的语义是"插件的展示状态变了，谁在显示谁重画" ——
       * 只刷新一个会让另一个保持旧样子（典型症状：导图窗口改了折叠、主窗口不变）。
       */
      for (const v of [...liveViews]) {
        try {
          v.dispatch({ effects: refreshEffect.of(null) })
        } catch {
          /* 正在销毁的 view 可能已经不能 dispatch —— 忽略即可 */
        }
      }
    },
    lineAtElement(el: Element): number | null {
      // 哪个 editor 装着这个元素，就在哪个 editor 里换算（插件在多窗口场景下不区分，
      // 所以挨个问；`dom.contains` 一次判断就够）
      for (const v of liveViews) {
        if (!v.dom.contains(el)) continue
        try {
          return v.state.doc.lineAt(v.posAtDOM(el)).number - 1
        } catch {
          return null
        }
      }
      return null
    },
    list: () => [
      ...[...entries.values()].map((e) => ({ id: e.fullId, pluginId: e.pluginId })),
      ...[...lineEntries.values()].map((e) => ({ id: e.fullId, pluginId: e.pluginId })),
      ...[...lineClassEntries.values()].map((e) => ({ id: e.fullId, pluginId: e.pluginId })),
      ...[...foldEntries.values()].map((e) => ({ id: e.fullId, pluginId: e.pluginId })),
    ],
  }
}

/** 插件卸载时强制回收它登记的规则（不指望插件自己 dispose） */
export function releaseEditorMarks(pluginId: string): void {
  let changed = false
  for (const [k, e] of [...entries]) {
    if (e.pluginId !== pluginId) continue
    entries.delete(k)
    changed = true
  }
  for (const [k, e] of [...lineEntries]) {
    if (e.pluginId !== pluginId) continue
    lineEntries.delete(k)
    changed = true
  }
  for (const [k, e] of [...lineClassEntries]) {
    if (e.pluginId !== pluginId) continue
    lineClassEntries.delete(k)
    changed = true
  }
  for (const [k, e] of [...foldEntries]) {
    if (e.pluginId !== pluginId) continue
    foldEntries.delete(k)
    changed = true
  }
  if (changed) cachedExtensions = null
}

/** 内核审计出口用：当前全部登记规则（含归属插件） */
export function editorMarkEntries(): { id: string; pluginId: string }[] {
  return [...entries.values()].map((e) => ({ id: e.fullId, pluginId: e.pluginId }))
}

/**
 * 扫全文建装饰集。
 *
 * 注意这里**每次都重扫全文** —— 与 `index` 原语同一个取舍：笔记是 KB 级、
 * `indexOf`/正则都是原生实现，几 KB 文本全扫是微秒级；上倒排/增量反而是过早优化。
 */
function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc
  const text = doc.toString()
  const found: { from: number; to: number; deco: Decoration }[] = []

  for (const { fullId, rule } of entries.values()) {
    let re: RegExp
    try {
      // 统一补 g：插件写不写都能扫出全部匹配
      const flags = rule.flags?.includes('g') ? rule.flags : `${rule.flags ?? ''}g`
      re = new RegExp(rule.pattern, flags)
    } catch (e) {
      // 正则写错不该让整个编辑器崩掉 —— 跳过这条规则即可
      console.warn(`[editor] 规则 ${fullId} 的正则无效：${String(e)}`)
      continue
    }
    let m: RegExpExecArray | null
    let guard = 0
    while ((m = re.exec(text)) !== null) {
      // 零宽匹配会让 exec 原地打转，必须手动前进
      if (m[0].length === 0) {
        re.lastIndex += 1
        continue
      }
      if (++guard > 5000) break // 兜底：正则太贪时别把主线程锁死
      found.push({
        from: m.index,
        to: m.index + m[0].length,
        deco: Decoration.mark({
          class: `zn-mark zn-mark-${rule.className ?? 'link'}`,
          attributes: {
            'data-zn-mark': fullId,
            ...(rule.title ? { title: rule.title } : {}),
            ...(rule.onClick ? { 'data-zn-mark-clickable': '1' } : {}),
          },
        }),
      })
    }
  }

  // 区间装饰要求按起点升序且**不允许区间交叉** ⇒ 排序 + 跳过重叠（先到先得）
  found.sort((a, b) => a.from - b.from || a.to - b.to)
  const ranges: Range<Decoration>[] = []
  let lastTo = -1
  for (const f of found) {
    if (f.from < lastTo) continue
    ranges.push(f.deco.range(f.from, f.to))
    lastTo = f.to
  }

  /**
   * **行首动作按钮**（rev54）：匹配到的**行首**插一个零宽 widget（视图元素，不进文档、不占偏移）。
   * 同一行可能被多条规则或同一规则的多次匹配命中 ⇒ 用 Set 按"行首偏移"去重，
   * 否则同一行会叠出好几个按钮（`side: -1` = 行首**之前**，也就是行的左侧）。
   */
  const seenLines = new Set<number>()
  for (const { fullId, rule } of lineEntries.values()) {
    let re: RegExp
    try {
      const flags = rule.flags?.includes('g') ? rule.flags : `${rule.flags ?? ''}g`
      re = new RegExp(rule.pattern, flags)
    } catch (e) {
      console.warn(`[editor] 行首按钮 ${fullId} 的正则无效：${String(e)}`)
      continue
    }
    let m: RegExpExecArray | null
    let guard = 0
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex += 1
        continue
      }
      if (++guard > 5000) break
      /**
       * ⚠️ **按"匹配里第一个非空白字符"定位行**（2026-10-14 修）
       *
       * 插件的 pattern 常写成 `^\s*(?:[-*+]|…)` —— 而 `\s` **包含换行**，所以当目标行
       * **前面有空行**时，匹配会从那个**空行**的行首就开始：`m.index` 落在空行上，
       * 按它取行号就把按钮算到了空行 ⇒ 插件按行号判定的 `filter` 直接失配。
       * 实测（outline-map）：`- 单独大纲…` 前面有空行 ⇒ 该行**该有按钮却没画**，
       * 而 `__omButtons()` 里明明有它（差 1 行）。
       */
      const mText = m[0]
      const lead = mText.length - mText.replace(/^\s+/, '').length
      const lineFrom = doc.lineAt(Math.min(m.index + lead, doc.length)).from
      if (seenLines.has(lineFrom)) continue
      /**
       * **跨行条件的最后一道关**（rev65）：正则只看得见字节，而"这个标题下面到底有没有列表"
       * 要看整篇 —— 所以给插件一个能看全文的谓词，返回 false 的行**不画按钮**。
       * 行号与 `onClick` 的 payload 同一口径（**0 起**），免得插件两处各写一套换算。
       */
      if (rule.filter) {
        const ln = doc.lineAt(lineFrom)
        if (!rule.filter({ doc: text, line: ln.number - 1, text: ln.text })) continue
      }
      seenLines.add(lineFrom)
      ranges.push(
        Decoration.widget({
          widget: new LineActionWidget(fullId, rule.label, rule.title, rule.className),
          side: -1,
        }).range(lineFrom),
      )
    }
  }

  /**
   * **逐行 class**（rev78）：只加 `Decoration.line`，不插视图元素 —— 给"按结构上样式"留出口
   * （大纲竖线用它：插件按缩进层级返回 `zn-ol-dN`，`styles.css` 用 `background-origin: content-box`
   * 把线画在**内容盒**左侧，与行盒左侧的按钮互不干扰）。
   *
   * 逐行问插件（`classAt`）⇒ **一次重建会对每一行各调一次**：插件侧必须按整篇缓存
   * （与 `filter` 同一要求）。插件抛错不该让编辑器崩掉 —— 那一行不加 class，其余照做。
   */
  for (const { fullId, rule } of lineClassEntries.values()) {
    for (let n = 1; n <= doc.lines; n++) {
      const ln = doc.line(n)
      let cls: string | null = null
      try {
        cls = rule.classAt({ doc: text, line: n - 1, text: ln.text })
      } catch (e) {
        console.warn(`[editor] 逐行 class ${fullId} 在第 ${n} 行出错：${String(e)}`)
        cls = null
      }
      if (!cls) continue
      ranges.push(Decoration.line({ class: cls }).range(ln.from))
    }
  }

  // 交给 CM6 排序（`Decoration.set(ranges, true)`）：widget 与区间装饰混在一起时，
  // 手写排序 + 零宽 range 更容易踩"起点必须严格升序"的坑（原先用 RangeSetBuilder 就是这么要求的）
  return Decoration.set(ranges, true)
}

/**
 * **折叠的"隐藏子行"那一半：只能由 StateField 提供**（rev80 实测踩到的 CM6 硬约束）。
 *
 * CM6 对装饰分权限：**ViewPlugin 不许提供块级装饰** —— 把
 * `Decoration.replace({ block: true })` 放进 ViewPlugin 的 `decorations` 里，运行期直接抛
 * `RangeError: Block decorations may not be specified via plugins`。
 * 症状极隐蔽：**圆点已经变成 ▸、折叠记录也写对了，但子行一行都没藏起来** ——
 * 抛错发生在 dispatch 的同步处理里，被调用处的 try 吞掉，看起来就像"状态没生效"。
 *
 * 所以拆两半：**圆点（widget）留在 ViewPlugin**，**块替换放这个 StateField**。
 * 这也是 CM6 折叠类扩展的标准写法（`@codemirror/language` 的 code folding 同样如此）。
 */
function buildFoldBlocks(state: EditorState): DecorationSet {
  if (foldEntries.size === 0) return Decoration.none
  const doc = state.doc
  const text = doc.toString()
  const ranges: Range<Decoration>[] = []
  let hiddenUntil = -1 // 已被祖先折叠盖到哪一行（0 起）
  for (let n = 1; n <= doc.lines; n++) {
    if (n - 1 <= hiddenUntil) continue
    const ln = doc.line(n)
    for (const { rule } of foldEntries.values()) {
      let end: number | null = null
      try {
        end = rule.foldEndAt({ doc: text, line: n - 1, text: ln.text })
      } catch {
        end = null
      }
      if (end === null || end <= n - 1) continue
      const last = Math.min(end, doc.lines - 1)
      let folded = false
      try {
        folded = rule.isFolded({ doc: text, line: n - 1, text: ln.text })
      } catch {
        folded = false
      }
      if (!folded) continue
      /**
       * ⚠️ 区间**必须从第一子行的行首**开始（`doc.line(n + 1).from`），不能从父行末尾算：
       * 起点落在"父行末尾 / 换行符"上时块替换不生效（子行照旧显示，圆点却已是 ▸）。
       * 收尾用末子行末尾 ⇒ 整个子块被替换掉，父行原样保留。
       */
      const from = doc.line(n + 1).from
      const endTo = doc.line(last + 1).to
      if (endTo > from) ranges.push(Decoration.replace({ block: true }).range(from, endTo))
      hiddenUntil = last
      break
    }
  }
  return ranges.length ? Decoration.set(ranges, true) : Decoration.none
}

const foldBlockField = StateField.define<DecorationSet>({
  // 没有插件登记折叠规则时恒为 none ⇒ 编辑器行为与以前完全一样
  create: (state) => buildFoldBlocks(state),
  update(deco, tr) {
    // 文档变了（行号会漂移）或插件喊了 refresh ⇒ 重算；否则沿用旧装饰并做位置映射
    const forced = tr.effects.some((e) => e.is(refreshEffect))
    if (tr.docChanged || forced) return buildFoldBlocks(tr.state)
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

const markPlugin = ViewPlugin.fromClass(
  class {
    readonly view: EditorView
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.view = view
      liveViews.add(view) // rev80：`refresh()` 靠这张表找到"要重画的编辑器"
      this.decorations = buildDecorations(view)
    }
    destroy() {
      liveViews.delete(this.view)
    }
    update(u: ViewUpdate) {
      // 文档/视口变了才重扫（纯滚动/选区变化不必）；
      // rev80 起插件还能用 `refresh()` 强制重算（折叠状态在插件手里，内核看不到它何时变）
      const forced = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)))
      if (forced) foldStat('rebuild-forced', { lines: u.state.doc.lines })
      if (u.docChanged || u.viewportChanged || forced) {
        this.decorations = buildDecorations(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)

/**
 * 把当前登记的规则翻成 CM6 扩展。**没有任何规则时返回空数组** ——
 * 没有插件用这个能力时，编辑器与以前完全一样（按需激活）。
 */
export function editorMarkExtensions(
  onAction: (commandId: string, payload?: Record<string, unknown>) => void,
): Extension[] {
  if (
    entries.size === 0 &&
    lineEntries.size === 0 &&
    lineClassEntries.size === 0 &&
    foldEntries.size === 0
  )
    return []
  if (cachedExtensions) return cachedExtensions

  const clickHandler = EditorView.domEventHandlers({
    click(evt, view) {
      const target = evt.target as HTMLElement | null

      // ① 行首按钮（rev54）：payload 带行号 —— 插件据此判断"这是哪一组"
      const actEl = target?.closest?.('[data-zn-line-action]') as HTMLElement | null
      if (actEl) {
        const fullId = actEl.getAttribute('data-zn-line-action')
        const entry = fullId ? lineEntries.get(fullId) : null
        const cmd = entry?.rule.onClick
        if (!cmd) return false
        let from = -1
        let line = -1
        try {
          from = view.posAtDOM(actEl)
          line = view.state.doc.lineAt(from).number - 1 // CM6 行号从 1 起，插件用 0 起
        } catch {
          /* 拿不到定位不影响命令本身，只是少了上下文 */
        }
        onAction(cmd, { line, from })
        return true
      }

      // ② 行内标记（原有）：payload 带区间文本与偏移
      const el = target?.closest?.('[data-zn-mark]') as HTMLElement | null
      if (!el) return false
      const fullId = el.getAttribute('data-zn-mark')
      const entry = fullId ? entries.get(fullId) : null
      const cmd = entry?.rule.onClick
      if (!cmd) return false
      let from = -1
      try {
        from = view.posAtDOM(el)
      } catch {
        // 拿不到偏移也不影响命令执行，只少了定位信息
      }
      onAction(cmd, { text: el.textContent ?? '', from })
      return true // 吃掉这次点击（命令已处理）
    },
  })

  // `foldBlockField` 必须排在前面：块替换（隐藏子行）与 widget（圆点）由两份装饰合成，
  // 顺序不影响结果，但把"状态派生"的那份放前面更贴近 CM6 示例的写法。
  cachedExtensions = [foldBlockField, markPlugin, clickHandler]
  return cachedExtensions
}
