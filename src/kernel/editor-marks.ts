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
import {
  type EditorState,
  type Extension,
  type Range,
  type StateEffect,
  type Text,
} from '@codemirror/state'
import { codeFolding, foldable, foldEffect, foldedRanges, foldService, unfoldEffect } from '@codemirror/language'
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
 * **折叠状态机改用 CM6 官方的**（rev81）—— 这里原来是个 `refreshEffect`，
 * 服务于"插件自己管折叠状态、内核照着重画"那套自造实现。
 *
 * 官方 `codeFolding()`（`@codemirror/language`，**早就在依赖树里**，atomic-editor 自己没用）
 * 自带 StateField + 位置映射 + `foldEffect`/`unfoldEffect` + 键位 ⇒ 状态不用我们管，
 * 插件改状态只需 `editor.toggleFold(line)`（内核替它 dispatch 官方 effect）。
 *
 * ⚠️ 折点仍必须由插件给（`foldEndAt` → 官方 `foldService`）：**markdown 列表折叠上游不做** ——
 * `@codemirror/lang-markdown` 的 `foldNodeProp` 里显式 `isList(type) ? undefined : …`，
 * 它只提供"标题整节折叠 + 代码块/引用/表格折叠"。所以这里换掉的是**状态机**，不是折点。
 */

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
 * **规则集合的版本号**（rev81b）—— 解决"插件比编辑器晚就绪"这件事。
 *
 * 内置（`atomic-editor`）在**编辑器挂载时捕获一次**扩展数组，而插件是**异步** blob import，
 * 常常晚于"自动恢复的那篇笔记" ⇒ 那一次 `buildDecorations` 跑在"规则表还空着"的时候，
 * 结果是**行首按钮 / 行 class 全都没有**，要等用户手动切一次笔记（切笔记会重建 view）才回来。
 * 症状与"「❖」有时不显示"完全一致 —— 2026-10-14 在 dev **整页重载**后稳定复现。
 *
 * 修法：规则增删时把版本号 +1 并**戳一下**活着的编辑器（一个空 transaction），
 * ViewPlugin 发现版本变了就重扫 ⇒ 插件什么时候注册完，界面什么时候补上。
 */
let entriesVersion = 0
function pokeEditors(): void {
  entriesVersion += 1
  for (const v of [...liveViews]) {
    try {
      v.dispatch({})
    } catch {
      /* 正在销毁的 view 不能再 dispatch */
    }
  }
}

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
 * 插件给行加 `zn-ol-foldable` class、自己写 CSS、自己接点击并调 `api.editor.toggleFold(line)`。
 *
 * ⚠️ **rev81 起"已折叠"的判定也不在插件手里**：内核把 CM6 官方折叠状态（`foldedRanges`）
 * 读出来，通过 `addLineClass` 的 `folded` 字段告诉插件（插件不再维护镜像）——
 * 于是 `zn-ol-foldable`（内核算的折点）+ `folded`（官方状态）就够画出"圆托常驻"。
 * 而"藏子行"整件事交给官方 `codeFolding()`（它内部正是那个 StateField），
 * 内核只剩"折点接成 `foldService`"与"点击桥到官方 effect"两件胶水活。
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
  /**
   * 行号（**0 起**，与 `filter` / `onClick` payload 同口径）。
   *
   * 点击时**不再依赖 `posAtDOM` 反查行号**（rev173.11）：手机端 CM6 虚拟化会拆掉重建
   * widget，`posAtDOM` 偶发抛错 ⇒ 行号停在 -1 ⇒ 插件 `find(t => t.line === -1)` 永不命中
   * ⇒ 看起来"点了没反应"（手机 toast 也不显示）。
   */
  readonly lineNo: number

  // ⚠️ 不能写成 `constructor(readonly label: string)`（TS 的参数属性）——
  // 本项目 `erasableSyntaxOnly: true`，那种语法会生成代码，直接编译不过（官方示例是参数属性写法）
  constructor(
    fullId: string,
    label: string,
    title: string | undefined,
    className: string | undefined,
    lineNo: number,
  ) {
    super()
    this.fullId = fullId
    this.label = label
    this.title = title
    this.className = className
    this.lineNo = lineNo
  }

  eq(other: LineActionWidget) {
    return (
      other.fullId === this.fullId &&
      other.label === this.label &&
      other.title === this.title &&
      other.className === this.className &&
      // 行号变了必须重画 DOM（否则 `data-zn-line` 留旧值，点击开到错的行）
      other.lineNo === this.lineNo
    )
  }

  toDOM() {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = `zn-line-action${this.className ? ` is-${this.className}` : ''}`
    btn.textContent = this.label
    if (this.title) btn.title = this.title
    btn.setAttribute('data-zn-line-action', this.fullId)
    // 行号随按钮一起进 DOM：点击时可脱离 `posAtDOM` 拿到行号（rev173.11，手机虚拟化兜底）
    btn.setAttribute('data-zn-line', String(this.lineNo))
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
      pokeEditors()
      return {
        dispose: () => {
          // 只有"登记的还是自己"才删 —— 免得旧实例的 dispose 干掉新同名规则
          if (entries.get(fullId)?.pluginId === pluginId) {
            entries.delete(fullId)
            cachedExtensions = null
            pokeEditors()
          }
        },
      }
    },
    addLineAction(rule: EditorLineAction): Disposable {
      const fullId = fullIdOf(pluginId, rule.id)
      lineEntries.set(fullId, { fullId, pluginId, rule })
      cachedExtensions = null
      pokeEditors()
      return {
        dispose: () => {
          if (lineEntries.get(fullId)?.pluginId === pluginId) {
            lineEntries.delete(fullId)
            cachedExtensions = null
            pokeEditors()
          }
        },
      }
    },
    addLineClass(rule: EditorLineClassRule): Disposable {
      const fullId = fullIdOf(pluginId, rule.id)
      lineClassEntries.set(fullId, { fullId, pluginId, rule })
      cachedExtensions = null
      pokeEditors()
      return {
        dispose: () => {
          if (lineClassEntries.get(fullId)?.pluginId === pluginId) {
            lineClassEntries.delete(fullId)
            cachedExtensions = null
            pokeEditors()
          }
        },
      }
    },
    addFold(rule: EditorFoldRule): Disposable {
      const fullId = fullIdOf(pluginId, rule.id)
      foldEntries.set(fullId, { fullId, pluginId, rule })
      cachedExtensions = null
      pokeEditors()
      return {
        dispose: () => {
          if (foldEntries.get(fullId)?.pluginId === pluginId) {
            foldEntries.delete(fullId)
            cachedExtensions = null
            pokeEditors()
          }
        },
      }
    },
    toggleFold(line: number): boolean {
      /**
       * 朝**每个活着的编辑器**各切一次。
       * 为什么不只切当前那个：同一时间可能有多个编辑器（主窗口 + 插件独立窗口里的分屏），
       * 插件的语义是"这一行现在要折 / 展开" —— 只切一个会让另一个保持旧样子
       * （典型症状：导图窗口里折了、主窗口没动）。切换后调插件的 `onToggle` 供写盘。
       */
      let any = false
      for (const v of [...liveViews]) {
        const range = foldRangeAt(v, line)
        if (!range) continue
        any = true
        const now = foldedAtRange(v.state, range.from)
        try {
          v.dispatch({ effects: (now ? unfoldEffect : foldEffect).of(range) })
        } catch (e) {
          foldStat('toggle-err', { line, err: String(e) })
          continue
        }
        foldStat('toggle', { line, folded: !now, len: range.to - range.from })
        notifyFoldChange(v)
      }
      return any
    },
    foldAt(line: number): boolean {
      for (const v of liveViews) {
        const range = foldRangeAt(v, line)
        if (!range) continue
        return foldedAtRange(v.state, range.from)
      }
      return false
    },
    restoreFolds() {
      /**
       * 朝每个活着的编辑器各应用一次 `initialFolded`（rev81）。
       * 用途：插件**异步**读完持久化记录之后（读盘比编辑器挂载慢）把"上次折起来的行"补上。
       * 重复应用无害 —— 官方 `foldedRanges` 对已折叠的范围会去重（内部 `foldExists`）。
       */
      for (const v of [...liveViews]) applyInitialFolds(v)
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
  if (changed) {
    cachedExtensions = null
    pokeEditors()
  }
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
  // 四个扩展常驻（见 `editorMarkExtensions` 的注释）⇒ 没有任何规则时这里必须**立刻返回**，
  // 别白跑一次 `doc.toString()`
  if (
    entries.size === 0 &&
    lineEntries.size === 0 &&
    lineClassEntries.size === 0 &&
    foldEntries.size === 0
  )
    return Decoration.none
  const doc = view.state.doc
  const text = doc.toString()
  /**
   * **被折叠隐藏的行**（P1-1 · 2026-10-18）：折叠后这些行在视图里不存在，但 `doc` 仍是全文。
   * 逐行生成 `Decoration.line` / 行首按钮时若照旧挂上去，CM6 会把它们 map 到折叠区间内部，
   * 背景线仍按行盒绘制 ⇒ **折叠后父行下方残留一条竖线**（用户截图所报）。
   * 跳过它们，装饰只落在可见行上。
   */
  const hidden = hiddenLineSet(view.state)
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
      // 命中折叠隐藏行 ⇒ 跳过（否则 mark 装饰会被 map 到折叠点，视觉上粘在父行后面）
      if (hidden.has(doc.lineAt(m.index).number - 1)) continue
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
      // 行号（**0 起**）：连同 widget 一起进视图，点击时不再靠 `posAtDOM` 反查（rev173.11）
      const lineNo = doc.lineAt(lineFrom).number - 1
      // 折叠隐藏行上的按钮同样会"掉"到折叠点（见 `hiddenLineSet`）
      if (hidden.has(lineNo)) continue
      /**
       * **跨行条件的最后一道关**（rev65）：正则只看得见字节，而"这个标题下面到底有没有列表"
       * 要看整篇 —— 所以给插件一个能看全文的谓词，返回 false 的行**不画按钮**。
       * 行号与 `onClick` 的 payload 同一口径（**0 起**），免得插件两处各写一套换算。
       */
      if (rule.filter) {
        const ln = doc.lineAt(lineFrom)
        if (!rule.filter({ doc: text, line: lineNo, text: ln.text })) continue
      }
      seenLines.add(lineFrom)
      ranges.push(
        Decoration.widget({
          widget: new LineActionWidget(fullId, rule.label, rule.title, rule.className, lineNo),
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
  /**
   * **"这一行是否已折叠"由内核读官方状态**（rev81）：`foldedRanges(state)` 里每个 range 的起点
   * 正是**第一子行的行首** ⇒ 父行（0 起）= 该行的 1 起行号 − 2。
   * 于是插件不用再维护一份折叠镜像（rev80 那套"插件记账 + 内核来问"正是错位的来源）。
   */
  const foldedLines = foldedLineSet(view.state)
  for (const { fullId, rule } of lineClassEntries.values()) {
    for (let n = 1; n <= doc.lines; n++) {
      if (hidden.has(n - 1)) continue
      const ln = doc.line(n)
      let cls: string | null = null
      try {
        cls = rule.classAt({ doc: text, line: n - 1, text: ln.text, folded: foldedLines.has(n - 1) })
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
 * **折叠：折点由插件给，状态机用 CM6 官方的**（rev81 换掉 rev80 那套自造实现）。
 *
 * 三块拼起来：
 * 1. **`foldService`** —— 官方问"这一行能折到哪"，我们把每个插件的 `foldEndAt` 依次问一遍。
 * 2. **`codeFolding()`** —— 官方状态机：`foldEffect` / `unfoldEffect` 进出、
 *    `foldedRanges(state)` 读状态、位置随编辑**自动 map**（比 rev80 的"行文本签名"稳得多），
 *    还自带 `Ctrl-Alt-[` 那套键位。给它一个**空 placeholder**：折起来不留 `…`（与 rev80 视觉一致）。
 * 3. **桥**：`foldedLineSet`（给 `classAt`）/ `toggleFold` / `applyInitialFolds`。
 *
 * ⚠️ 为什么折点不能也交给官方：`@codemirror/lang-markdown` 的 `foldNodeProp` 显式跳过 List
 * （`isList(type) ? undefined : …`）—— 列表折叠上游不做，这是它留的空白。
 */
let foldTextDoc: Text | null = null
let foldText = ''
/**
 * `doc → 文本`缓存：`foldService` 是**逐行**被问的，而插件的解析函数要全文。
 * 同一个 state 里 `doc` 是同一个对象 ⇒ 一次 `toString()` 就够（与插件侧 `foldEndsOfDoc` 同一套写法）。
 */
function foldTextOf(doc: Text): string {
  if (foldTextDoc !== doc) {
    foldTextDoc = doc
    foldText = doc.toString()
  }
  return foldText
}

const foldServiceExt = foldService.of((state, lineStart) => {
  if (foldEntries.size === 0) return null
  const doc = state.doc
  const n = doc.lineAt(lineStart).number // 1 起
  const text = foldTextOf(doc)
  const lineText = doc.line(n).text
  for (const { rule } of foldEntries.values()) {
    let end: number | null = null
    try {
      end = rule.foldEndAt({ doc: text, line: n - 1, text: lineText })
    } catch {
      end = null
    }
    if (end === null || end <= n - 1) continue
    const last = Math.min(end, doc.lines - 1)
    if (last < n) continue // 没有子行 ⇒ 不可折
    /**
     * ⚠️ 起点**必须是第一子行的行首**（rev80 实测）：从"父行末尾 / 换行符"算起时块替换不生效，
     * 症状是"圆点已是折叠态、子行却一行没藏"。收尾用末子行末尾 ⇒ 父行原样保留。
     */
    const from = doc.line(n + 1).from
    const to = doc.line(last + 1).to
    if (to <= from) continue
    return { from, to }
  }
  return null
})

/** 这一行（0 起）现在能折到哪 —— 走**官方 `foldable`**（所有 foldService 一起问） */
function foldRangeAt(view: EditorView, line0: number): { from: number; to: number } | null {
  const doc = view.state.doc
  if (line0 < 0 || line0 >= doc.lines) return null
  const ln = doc.line(line0 + 1)
  try {
    return foldable(view.state, ln.from, ln.to)
  } catch {
    return null
  }
}

/** 某个起点当前是否处于折叠态（读官方 `foldedRanges`） */
function foldedAtRange(state: EditorState, from: number): boolean {
  if (foldEntries.size === 0) return false
  let hit = false
  try {
    foldedRanges(state).between(from, from + 1, () => {
      hit = true
      return false
    })
  } catch {
    /* 没装 codeFolding（没有任何折叠规则）时没有这个 field —— 当作未折叠 */
  }
  return hit
}

/**
 * **被折叠的父行集合**（0 起）—— 给 `classAt` 用。
 *
 * 官方 `foldedRanges` 里每个 range 的起点 = **第一子行行首** ⇒ 父行（0 起）= 该行 1 起行号 − 2。
 */
function foldedLineSet(state: EditorState): Set<number> {
  const out = new Set<number>()
  if (foldEntries.size === 0) return out
  try {
    foldedRanges(state).between(0, state.doc.length, (from) => {
      out.add(state.doc.lineAt(from).number - 2)
    })
  } catch {
    /* 同上：没有折叠规则就没有这个 field */
  }
  return out
}

/**
 * **被折叠隐藏的行集合**（0 起）—— 给装饰生成用（P1-1）。
 *
 * 与 `foldedLineSet`（父行）互补：那个回答"这一行是不是折叠的父行"，这个回答
 * "这一行现在根本没有显示"。`foldedRanges` 的每个 range 覆盖 `from..to`，
 * 其中所有行都是被隐藏的子行（不含父行）。
 */
function hiddenLineSet(state: EditorState): Set<number> {
  const out = new Set<number>()
  if (foldEntries.size === 0) return out
  try {
    foldedRanges(state).between(0, state.doc.length, (from, to) => {
      const first = state.doc.lineAt(from).number - 1
      const last = state.doc.lineAt(Math.max(from, to - 1)).number - 1
      for (let n = first; n <= last; n++) out.add(n)
    })
  } catch {
    /* 没装 codeFolding（没有任何折叠规则）时没有这个 field —— 当作没有隐藏行 */
  }
  return out
}

/**
 * **折叠集合变了 ⇒ 把整份折叠集合交给插件**（对账式；契约里 `onFoldChange` 有为什么）。
 *
 * 逐行通知在"嵌套折叠、展开祖先"时会留下子孙的残留签名（实测踩过：本地库上残留 2 项，
 * 下次打开又照着它们折起来）—— 对账式没有这种漂移。
 */
function notifyFoldChange(view: EditorView): void {
  if (foldEntries.size === 0) return
  const doc = view.state.doc
  const foldedLines = [...foldedLineSet(view.state)].sort((a, b) => a - b)
  const ctx = { doc: foldTextOf(doc), foldedLines }
  for (const { rule } of foldEntries.values()) {
    try {
      rule.onFoldChange?.(ctx)
    } catch (e) {
      console.warn(`[editor] 折叠回调出错：${String(e)}`)
    }
  }
}

/**
 * 应用各规则的 `initialFolded` —— 编辑器**挂载时**一次，插件**异步读完盘**后
 * 调 `restoreFolds()` 再一次（读盘比挂载慢，所以两次都要）。
 * 官方对已折叠的范围会去重，重复应用无害。
 */
function applyInitialFolds(view: EditorView): void {
  if (foldEntries.size === 0) return
  const doc = view.state.doc
  const text = foldTextOf(doc)
  const effects: StateEffect<{ from: number; to: number }>[] = []
  let hiddenUntil = -1 // 已被祖先折叠盖到哪一行（0 起）
  for (let n = 1; n <= doc.lines; n++) {
    if (n - 1 <= hiddenUntil) continue
    const ln = doc.line(n)
    for (const { rule } of foldEntries.values()) {
      if (!rule.initialFolded) continue
      let want = false
      try {
        want = rule.initialFolded({ doc: text, line: n - 1, text: ln.text })
      } catch {
        want = false
      }
      if (!want) continue
      const range = foldRangeAt(view, n - 1)
      if (!range) continue
      effects.push(foldEffect.of(range))
      hiddenUntil = doc.lineAt(range.to).number - 1
      break
    }
  }
  if (!effects.length) return
  try {
    view.dispatch({ effects })
  } catch (e) {
    foldStat('initial-err', { err: String(e), n: effects.length })
  }
}

/**
 * **空 placeholder**：官方 `codeFolding` 折叠后默认在折点处显示 `…`（`placeholderText: "…"`）。
 * 本项目的视觉是**纯隐藏、不留符号**（用户原话「本身就是区分」）⇒ 给个空 span。
 */
function foldPlaceholder(): HTMLElement {
  const el = document.createElement('span')
  el.className = 'zn-fold-placeholder'
  return el
}

const markPlugin = ViewPlugin.fromClass(
  class {
    readonly view: EditorView
    decorations: DecorationSet
    /** 上次重扫时的**规则版本** —— 用来发现"插件在我挂载之后才注册"（见 `pokeEditors`） */
    seenVersion = entriesVersion
    constructor(view: EditorView) {
      this.view = view
      liveViews.add(view) // 折叠的 toggle / restore 靠这张表找到"活着的编辑器"
      this.decorations = buildDecorations(view)
      /**
       * **初始折叠**（rev81）：构造期不能 dispatch（state 还没装配完），推到微任务里。
       * 插件此刻通常已注册规则（它在 `apply()` 里注册）；若它的持久化记录是**异步**读的，
       * 读完会再调一次 `api.editor.restoreFolds()`。
       */
      queueMicrotask(() => applyInitialFolds(view))
    }
    destroy() {
      liveViews.delete(this.view)
    }
    update(u: ViewUpdate) {
      /**
       * 折叠态变了 ⇒ 重扫装饰（行 class 的 `zn-ol-folded` 依赖它），并**对账**给插件。
       *
       * 判据用**两份 `foldedRanges` 的引用**：官方只在 fold / unfold effect 到来时重建它 ——
       * 这样连"用户用官方键位（`Ctrl-Alt-[`）折的"也会被对账到（那条路不经过 `toggleFold`）。
       * `foldEntries` 为空时压根没装 `codeFolding` —— 不能去读那个 field（会抛）。
       */
      const foldChanged =
        foldEntries.size > 0 && foldedRanges(u.state) !== foldedRanges(u.startState)
      if (foldChanged) {
        foldStat('fold-changed', { lines: u.state.doc.lines })
        notifyFoldChange(u.view)
      }
      /**
       * **规则表在挂载之后变过**（插件晚加载 / 卸载插件）⇒ 也必须重扫，
       * 否则那一次空表扫出来的"没有按钮"会一直挂到用户手动切笔记（见 `pokeEditors`）。
       */
      const rulesChanged = this.seenVersion !== entriesVersion
      if (rulesChanged) this.seenVersion = entriesVersion
      if (u.docChanged || u.viewportChanged || foldChanged || rulesChanged) {
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
  /**
   * ⚠️ **不再"没有规则就返回空数组"**（rev81b）。
   *
   * 为什么非改不可：内置（`atomic-editor`）在**编辑器挂载时捕获一次**扩展数组，
   * 而插件是**异步** blob import —— 若那次调用发生在插件注册**之前**，返回的空数组会被永久用掉：
   * 之后插件再注册也没用，这几个扩展（widget 装饰、折叠）**永远不在**这个编辑器里。
   * 症状就是"行首按钮 / 行 class / 折叠全不出现"，手动切一次笔记（重建 view）才回来 ——
   * 2026-10-14 在 dev 整页重载后稳定复现（也正是"「❖」有时不显示"的真身）。
   * `pokeEditors()` 只能让**已在扩展里**的插件重扫，救不了这种"扩展压根没装"的情况。
   *
   * 所以这四个扩展**常驻**：规则表为空时它们什么都不画（`buildDecorations` 开头就早退）。
   */
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
        /**
         * ⚠️ **行号优先读 widget 自带的 `data-zn-line`**（rev173.11）。
         *
         * 手机端 CM6 虚拟化会拆掉重建 widget，`posAtDOM` 偶发抛错 ⇒ 以前 `line` 停在 -1，
         * 插件按 -1 判定"这一行没有可开的组" ⇒ 用户看到"点了没反应"（手机 toast 不显示）。
         * `posAtDOM` 现在只用来补 `from`（插件拿它做光标上下文；拿不到不影响开导图）。
         */
        const dataLine = actEl.getAttribute('data-zn-line')
        let line = dataLine !== null ? Number(dataLine) : -1
        let from = -1
        try {
          from = view.posAtDOM(actEl)
        } catch {
          /* 拿不到定位不影响命令本身，只是少了上下文 */
        }
        if (!Number.isFinite(line) || line < 0) {
          try {
            if (from >= 0) line = view.state.doc.lineAt(from).number - 1
          } catch {
            line = -1
          }
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

  /**
   * **官方折叠状态机 + 折点桥 + 装饰插件**（rev81）。
   *
   * · `codeFolding()`：状态机（StateField + `foldEffect`/`unfoldEffect` + 位置 map + 键位）。
   *   传空 placeholder ⇒ 折起来不留 `…`（与 rev80 的视觉一致）。
   *   ⚠️ 它自带 `foldKeymap`（`Ctrl-Alt-[` 折、`Ctrl-Alt-]` 展、`Ctrl-Alt-Shift-[` 全折…）——
   *   这是换官方带来的**新增键位**，已在 HANDOFF rev81 记录。
   * · `foldServiceExt`：把插件的 `foldEndAt` 接成官方 `foldService`（列表折叠上游不做）。
   * · `markPlugin`：圆点 / 按钮 / 行 class 这些视图装饰，外加"挂载时应用初始折叠"。
   */
  cachedExtensions = [
    codeFolding({ placeholderDOM: () => foldPlaceholder() }),
    foldServiceExt,
    markPlugin,
    clickHandler,
  ]
  return cachedExtensions
}
