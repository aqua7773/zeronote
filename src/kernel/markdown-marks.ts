/**
 * Markdown 标记 —— **内核自带的 12 个格式动作**。
 *
 * ## 为什么在内核（2026-10-12 从 `examples/md-toolbar` 上收）
 *
 * `# 标题` 的**渲染**本来就在内核（`@atomic-editor/editor` 的 Live Preview：
 * 光标所在行显示源码、其余行渲染成标题/粗体/表格）。但"把选中变成标题"这个**动作**
 * 此前是插件用 `doc.insertAt` 自己写的 ⇒ 同一套 Markdown 语法，内核管一半、插件管一半。
 * 收进来之后语法规则**只存在一份**（`**` / `# ` 这些字面量只在本文件出现）。
 *
 * 三处入口共用同一批命令（这就是收进内核的收益 —— 插件时代只有两处，
 * 且桌面右键菜单够不着插件内部的这 12 条行为）：
 *   · 手机键盘正上方那条工具栏（`editor-toolbar`，`MarkToolbar` 渲染）
 *   · 桌面编辑器顶部的快捷键提示条（`editor-topbar`，可开关）
 *   · 桌面编辑器右键菜单的「标记」子菜单
 *
 * ## 三类行为（与插件时代**一字不改**，只是换了拥有者）
 *
 *   · **成对标记**（粗体 / 斜体 / 行内代码 / 删除线）
 *       有选中 → 包住选中文字；无选中 → 插一对空标记、**光标落中间**，
 *       接着打字就是标记内的内容（不用手动把光标挪回去）。
 *   · **行首标记**（标题 / 列表 / 待办 / 引用）
 *       有选中 → 逐行加前缀；无选中 → 插到**光标所在那一行的行首**。
 *       这条依赖 `doc.insertAt`：`insertAtCursor` 在光标停在行中时会把 `# ` 插进句子中间。
 *   · **固定片段**（代码块 / 链接 / 表格 / 分隔线）
 *       插到光标处，光标落在"该填内容"的那一格（比如链接的 `[]` 里）。
 */
import type { CommandRegistry } from './command'
import type { Disposable, DocApi } from './contract'

/** 按钮/命令的三类行为，见文件头 */
export type MarkKind = 'pair' | 'prefix' | 'snippet'

export type MarkSpec = {
  /** 命令 id（内核命令一律 `core.` 前缀） */
  id: string
  /** 中文名：菜单、命令面板、按钮 tooltip 都用它 */
  name: string
  /** 按钮上的短标签（一条横滑工具栏里放得下） */
  label: string
  /** 契约写法的键位（`Mod+B`）；不写 = 不绑键盘 */
  keybinding?: string
  kind: MarkKind
  /** pair = 成对标记本身（`**`）；prefix = 行首前缀（`# `）；snippet = 整段文本 */
  text: string
  /** snippet 专用：插入后光标距内容开头的字符数（缺省 = 落在末尾） */
  caret?: number
}

/**
 * 12 个标记，**顺序即按钮顺序**（手机工具栏一排横滑过去）。
 *
 * 顺序刻意保持"由常用到不常用"：粗体/斜体在最左（手指够得着），
 * 表格/分隔线在最右（横滑一下就到）。
 */
export const MARK_COMMANDS: readonly MarkSpec[] = [
  // ── 成对标记 ──
  { id: 'core.mark.bold', name: '粗体', label: 'B', keybinding: 'Mod+B', kind: 'pair', text: '**' },
  { id: 'core.mark.italic', name: '斜体', label: 'I', keybinding: 'Mod+I', kind: 'pair', text: '*' },
  { id: 'core.mark.code', name: '行内代码', label: '<>', keybinding: 'Mod+E', kind: 'pair', text: '`' },
  { id: 'core.mark.strike', name: '删除线', label: 'S', keybinding: 'Mod+Shift+X', kind: 'pair', text: '~~' },
  // ── 行首标记 ──
  { id: 'core.mark.h1', name: '标题', label: 'H', keybinding: 'Mod+1', kind: 'prefix', text: '# ' },
  { id: 'core.mark.list', name: '无序列表', label: '•', keybinding: 'Mod+Shift+L', kind: 'prefix', text: '- ' },
  { id: 'core.mark.todo', name: '待办', label: '☑', keybinding: 'Mod+Shift+T', kind: 'prefix', text: '- [ ] ' },
  { id: 'core.mark.quote', name: '引用', label: '❝', keybinding: 'Mod+Shift+Q', kind: 'prefix', text: '> ' },
  // ── 固定片段 ──
  { id: 'core.mark.block', name: '代码块', label: '{}', kind: 'snippet', text: '```\n\n```', caret: 4 },
  { id: 'core.mark.link', name: '链接', label: '🔗', keybinding: 'Mod+K', kind: 'snippet', text: '[](url)', caret: 1 },
  {
    id: 'core.mark.table',
    name: '表格',
    label: '▦',
    kind: 'snippet',
    text: '|  |  |\n| --- | --- |\n|  |  |',
    caret: 2,
  },
  { id: 'core.mark.hr', name: '分隔线', label: '―', kind: 'snippet', text: '\n---\n', caret: 5 },
]

/** 带了键位的那几条 —— 桌面顶部提示条只列这些（手机没有 Ctrl 键，那条提示在手机上是伪概念） */
export const MARK_COMMANDS_WITH_KEYS: readonly MarkSpec[] = MARK_COMMANDS.filter(
  (m) => Boolean(m.keybinding),
)

/** 光标所在**行**的行首偏移（0 基）；没有活动文档时返回 null */
function lineStart(doc: DocApi): number | null {
  const d = doc.active()
  const sel = doc.selection()
  if (!d || !sel) return null
  return d.content.lastIndexOf('\n', sel.from - 1) + 1
}

/** 执行一条标记（三类行为的分派）—— 编辑器没就绪时静默返回（`selection()` 为 null） */
export function runMark(m: MarkSpec, doc: DocApi): void {
  const sel = doc.selection()
  if (!sel) return

  if (m.kind === 'pair') {
    if (sel.text) doc.replaceSelection(m.text + sel.text + m.text)
    else doc.insertAt(sel.from, m.text + m.text, m.text.length)
    return
  }

  if (m.kind === 'prefix') {
    if (sel.text) {
      doc.replaceSelection(
        sel.text
          .split('\n')
          .map((l) => m.text + l)
          .join('\n'),
      )
      return
    }
    const at = lineStart(doc)
    if (at === null) return
    doc.insertAt(at, m.text)
    return
  }

  doc.insertAt(sel.from, m.text, m.caret ?? m.text.length)
}

/**
 * 把 12 条标记注册进命令表（内核命令层，与 `core.save` / `core.newNote` 同一套）。
 *
 * **键位由内核的快捷键派发器自动绑**（`bindCommandKeybindings` 读命令表）——
 * 这里只声明，不自己监听，与插件时代的规矩一致。
 */
export function registerMarkdownMarks(registry: CommandRegistry, doc: DocApi): Disposable[] {
  return MARK_COMMANDS.map((m) =>
    registry.api.register({
      id: m.id,
      title: `Markdown：${m.name}`,
      ...(m.keybinding ? { keybinding: m.keybinding } : {}),
      run: () => runMark(m, doc),
    }),
  )
}
