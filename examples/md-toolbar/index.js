/**
 * Markdown 快捷输入 —— 挂在 `view` 的 **`editor-toolbar`** 位置上。
 *
 * 这一条渲染在**编辑器底部**。手机上软键盘弹起时视口被压缩，它正好落在
 * **键盘正上方** —— 不是靠浮动定位，是布局自然的结果（键盘挤掉了视口底部）。
 *
 * 三类按钮，行为各不相同：
 *
 *  · **成对标记**（粗体 / 斜体 / 行内代码 / 删除线）
 *      有选中 → 包住选中的文字；没选中 → 插一对空标记，**光标落在中间**，
 *      接着打字就是标记内的内容（不用手动把光标挪回去）。
 *  · **行首标记**（标题 / 列表 / 待办 / 引用）
 *      有选中 → 逐行加前缀；没选中 → 插到**光标所在那一行的行首**。
 *      这条依赖内核的 `doc.insertAt`：`insertAtCursor` 在光标停在行中时会把 `# ` 插进句子中间。
 *  · **固定片段**（代码块 / 链接 / 表格 / 分隔线）
 *      插到光标处，并把光标放在"该填内容"的那一格（比如链接的 `[]` 里）。
 *
 * 界面全用声明式 UINode（`row` + `button`），插件里没有一行 React。
 * 每个按钮背后都是一条 `command`，所以这些动作**在命令面板里也能找到**（工具栏不可用时一样能用）。
 */

/** 成对标记：[命令 id, 名称, 按钮文字, 标记] */
const PAIRS = [
  ['md-toolbar.bold', '粗体', 'B', '**'],
  ['md-toolbar.italic', '斜体', 'I', '*'],
  ['md-toolbar.code', '行内代码', '<>', '`'],
  ['md-toolbar.strike', '删除线', 'S', '~~'],
]

/** 行首标记 */
const PREFIXES = [
  ['md-toolbar.h1', '标题', 'H', '# '],
  ['md-toolbar.list', '无序列表', '•', '- '],
  ['md-toolbar.todo', '待办', '☑', '- [ ] '],
  ['md-toolbar.quote', '引用', '❝', '> '],
]

/** 固定片段：[命令 id, 名称, 按钮文字, 文本, 光标落点（距文本开头几个字符）] */
const SNIPPETS = [
  ['md-toolbar.block', '代码块', '{}', '```\n\n```', 4],
  ['md-toolbar.link', '链接', '🔗', '[](url)', 1],
  ['md-toolbar.table', '表格', '▦', '|  |  |\n| --- | --- |\n|  |  |', 2],
  ['md-toolbar.hr', '分隔线', '―', '\n---\n', 5],
]

export default {
  apply(api) {
    const { command, doc, view, subscriptions } = api

    /** 光标所在**行**的行首偏移（0 基）；没有活动文档时返回 null */
    const lineStart = () => {
      const d = doc.active()
      const sel = doc.selection()
      if (!d || !sel) return null
      return d.content.lastIndexOf('\n', sel.from - 1) + 1
    }

    for (const [id, name, , mark] of PAIRS) {
      subscriptions.push(
        command.register({
          id,
          title: `Markdown：${name}`,
          run: () => {
            const sel = doc.selection()
            if (!sel) return
            if (sel.text) doc.replaceSelection(mark + sel.text + mark)
            // 光标落在两个标记中间
            else doc.insertAt(sel.from, mark + mark, mark.length)
          },
        }),
      )
    }

    for (const [id, name, , mark] of PREFIXES) {
      subscriptions.push(
        command.register({
          id,
          title: `Markdown：${name}`,
          run: () => {
            const sel = doc.selection()
            if (!sel) return
            if (sel.text) {
              doc.replaceSelection(
                sel.text
                  .split('\n')
                  .map((l) => mark + l)
                  .join('\n'),
              )
              return
            }
            const at = lineStart()
            if (at === null) return
            doc.insertAt(at, mark)
          },
        }),
      )
    }

    for (const [id, name, , text, caret] of SNIPPETS) {
      subscriptions.push(
        command.register({
          id,
          title: `Markdown：${name}`,
          run: () => {
            const sel = doc.selection()
            if (!sel) return
            doc.insertAt(sel.from, text, caret)
          },
        }),
      )
    }

    // ── 工具栏本体：一条横向排列的按钮 ──
    const items = [...PAIRS, ...PREFIXES, ...SNIPPETS]
    subscriptions.push(
      view.registerPanel({
        id: 'md-toolbar.bar',
        title: 'Markdown 快捷输入',
        location: 'editor-toolbar',
        render: () => ({
          type: 'row',
          children: items.map(([id, name, label]) => ({
            type: 'button',
            label,
            variant: 'ghost',
            onClick: id,
            // 按钮节点没有 tooltip 字段，名字放进 payload ⇒ 命令面板里也按名字能搜到
            payload: { name },
          })),
        }),
      }),
    )
  },
}
