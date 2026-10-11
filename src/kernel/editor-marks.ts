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
import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { Disposable, EditorApi, EditorMarkRule } from './contract'

type Entry = {
  /** 完整 id（插件前缀 + 规则 id），用在 DOM 属性上 */
  fullId: string
  pluginId: string
  rule: EditorMarkRule
}

const entries = new Map<string, Entry>()

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
    list: () => [...entries.values()].map((e) => ({ id: e.fullId, pluginId: e.pluginId })),
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
  if (changed) cachedExtensions = null
}

/**
 * 扫全文建装饰集。
 *
 * 注意这里**每次都重扫全文** —— 与 `index` 原语同一个取舍：笔记是 KB 级、
 * `indexOf`/正则都是原生实现，几 KB 文本全扫是微秒级；上倒排/增量反而是过早优化。
 */
function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()
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

  // RangeSetBuilder 要求按起点升序且**不允许区间交叉** ⇒ 排序 + 跳过重叠（先到先得）
  found.sort((a, b) => a.from - b.from || a.to - b.to)
  let lastTo = -1
  for (const f of found) {
    if (f.from < lastTo) continue
    builder.add(f.from, f.to, f.deco)
    lastTo = f.to
  }
  return builder.finish()
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
  if (entries.size === 0) return []
  if (cachedExtensions) return cachedExtensions

  const clickHandler = EditorView.domEventHandlers({
    click(evt, view) {
      const target = evt.target as HTMLElement | null
      const el = target?.closest?.('[data-zn-mark]') as HTMLElement | null
      if (!el) return false
      const fullId = el.getAttribute('data-zn-mark')
      const entry = fullId ? entries.get(fullId) : null
      const cmd = entry?.rule.onClick
      if (!cmd) return false
      // 标记起点：posAtDOM 给的是 DOM 位置 → 文档偏移
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
