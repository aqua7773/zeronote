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
import type { Extension, Range } from '@codemirror/state'
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
    list: () => [
      ...[...entries.values()].map((e) => ({ id: e.fullId, pluginId: e.pluginId })),
      ...[...lineEntries.values()].map((e) => ({ id: e.fullId, pluginId: e.pluginId })),
      ...[...lineClassEntries.values()].map((e) => ({ id: e.fullId, pluginId: e.pluginId })),
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

const markPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
    }
    update(u: ViewUpdate) {
      // 只有文档/视口变了才重扫（纯滚动/选区变化不必）
      if (u.docChanged || u.viewportChanged) {
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
  if (entries.size === 0 && lineEntries.size === 0 && lineClassEntries.size === 0) return []
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

  cachedExtensions = [markPlugin, clickHandler]
  return cachedExtensions
}
