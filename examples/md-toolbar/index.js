/**
 * Markdown 快捷输入 —— 两个挂载位置，一套命令：
 *
 *   · `editor-toolbar`（编辑器**底部**）：一排按钮。手机上软键盘弹起时视口被压缩，
 *     它正好落在**键盘正上方** —— 不是浮动定位，是布局的自然结果。
 *   · `editor-topbar`（编辑器**顶部**）：**快捷键提示条**（桌面用），把键位印在按钮上，
 *     点一下同样能执行。**可开关** —— 关掉时把面板 `dispose()` 掉，
 *     宿主那边整条 DOM 都消失（内核的规矩是"没人注册这个位置就一个 DOM 都不渲染"）；
 *     选择存在插件自己的 `store` 里，下次打开还记得。
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
 *      插到光标处，并把光标放在"该填内容"那一格（比如链接的 `[]` 里）。
 *
 * 界面全用声明式 UINode（`row` + `button`），插件里没有一行 React。
 * 每个按钮背后都是一条 `command`；带 `keybinding` 的那几条由内核的快捷键派发器
 * （`bindCommandKeybindings`）自动绑到键盘 —— 插件只是**声明**键位，不自己监听。
 */

/** 成对标记：[命令 id, 名称, 按钮文字, 快捷键, 标记] */
const PAIRS = [
  ['md-toolbar.bold', '粗体', 'B', 'Mod+B', '**'],
  ['md-toolbar.italic', '斜体', 'I', 'Mod+I', '*'],
  ['md-toolbar.code', '行内代码', '<>', 'Mod+E', '`'],
  ['md-toolbar.strike', '删除线', 'S', 'Mod+Shift+X', '~~'],
]

/** 行首标记 */
const PREFIXES = [
  ['md-toolbar.h1', '标题', 'H', 'Mod+1', '# '],
  ['md-toolbar.list', '无序列表', '•', 'Mod+Shift+L', '- '],
  ['md-toolbar.todo', '待办', '☑', 'Mod+Shift+T', '- [ ] '],
  ['md-toolbar.quote', '引用', '❝', 'Mod+Shift+Q', '> '],
]

/** 固定片段：[命令 id, 名称, 按钮文字, 快捷键, 文本, 光标落点] */
const SNIPPETS = [
  ['md-toolbar.block', '代码块', '{}', '', '```\n\n```', 4],
  ['md-toolbar.link', '链接', '🔗', 'Mod+K', '[](url)', 1],
  ['md-toolbar.table', '表格', '▦', '', '|  |  |\n| --- | --- |\n|  |  |', 2],
  ['md-toolbar.hr', '分隔线', '―', '', '\n---\n', 5],
]

const ALL = [...PAIRS, ...PREFIXES, ...SNIPPETS]

const IS_MAC = /Mac|iPhone|iPad/i.test(
  typeof navigator === 'undefined' ? '' : navigator.userAgent,
)
/** `Mod+Shift+L` → `Ctrl+Shift+L`（macOS 上显示 ⌘） */
const keyLabel = (kb) => kb.replace(/Mod/g, IS_MAC ? '⌘' : 'Ctrl')

export default {
  async apply(api) {
    const { command, doc, view, store, host, subscriptions } = api

    /** 光标所在**行**的行首偏移（0 基）；没有活动文档时返回 null */
    const lineStart = () => {
      const d = doc.active()
      const sel = doc.selection()
      if (!d || !sel) return null
      return d.content.lastIndexOf('\n', sel.from - 1) + 1
    }

    for (const [id, name, , kb, mark] of PAIRS) {
      subscriptions.push(
        command.register({
          id,
          title: `Markdown：${name}`,
          ...(kb ? { keybinding: kb } : {}),
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

    for (const [id, name, , kb, mark] of PREFIXES) {
      subscriptions.push(
        command.register({
          id,
          title: `Markdown：${name}`,
          ...(kb ? { keybinding: kb } : {}),
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

    for (const [id, name, , kb, text, caret] of SNIPPETS) {
      subscriptions.push(
        command.register({
          id,
          title: `Markdown：${name}`,
          ...(kb ? { keybinding: kb } : {}),
          run: () => {
            const sel = doc.selection()
            if (!sel) return
            doc.insertAt(sel.from, text, caret)
          },
        }),
      )
    }

    // ── ① 编辑器顶部：快捷键提示条（可开关）──────────────────────────
    const hintSpec = {
      id: 'md-toolbar.hint',
      title: 'Markdown 快捷键提示',
      location: 'editor-topbar',
      render: () => ({
        type: 'row',
        children: [
          // 开关放**最前**（CSS 把它 sticky 钉在左端，横滑也跑不掉）：
          // 曾放末尾（右端），结果和编辑区右上角那个「关闭」按钮挤在一起 ——
          // 实测点偏把笔记关掉了，还一度误判成"开关没记住状态"。
          {
            type: 'button',
            label: '✕',
            variant: 'ghost',
            onClick: 'md-toolbar.hint.toggle',
            payload: { name: '隐藏快捷键提示' },
          },
          ...ALL.filter(([, , , kb]) => kb).map(([id, name, , kb]) => ({
            type: 'button',
            label: `${keyLabel(kb)} ${name}`,
            variant: 'ghost',
            onClick: id,
            payload: { name },
          })),
        ],
      }),
    }

    /** 注册着 = 显示；dispose 掉 = 隐藏。宿主那边"没人注册就不渲染"。 */
    let hintSub = null
    const setHint = (on) => {
      if (on) {
        if (!hintSub) hintSub = view.registerPanel(hintSpec)
      } else {
        hintSub?.dispose()
        hintSub = null
      }
    }

    subscriptions.push(
      command.register({
        id: 'md-toolbar.hint.toggle',
        title: 'Markdown：快捷键提示 显示 / 隐藏',
        // 刻意**不给键位**：开关就在提示条右端那个 ✕ 上（CSS 把它 sticky 钉住，永远够得着），
        // 命令面板里也搜得到这条。少占一个键位，就少一处"键位冲突"的坑 ——
        // 曾试过 `Mod+Shift+H`，实测没触发，与其留一个没验过的行为，不如不要它。
        run: async () => {
          const next = !hintSub
          setHint(next)
          try {
            await store.set('hint', next)
          } catch {
            /* 存不下不影响本次开关 */
          }
          host.notify(
            next
              ? '已显示 Markdown 快捷键提示'
              : '已隐藏 Markdown 快捷键提示（命令面板里可以再打开）',
          )
        },
      }),
    )

    // 只有桌面挂提示条：手机没有 Ctrl 键，"快捷键提示"在那边是伪概念
    // （手机上由底部工具栏承担同一件事 —— 挂在软键盘上方）
    if (host.platform !== 'android') {
      const saved = await store.get('hint', true)
      if (saved !== false) setHint(true)
    }

    // ── ② 编辑器底部：一条横向排列的按钮 ──────────────────────────────
    subscriptions.push(
      view.registerPanel({
        id: 'md-toolbar.bar',
        title: 'Markdown 快捷输入',
        location: 'editor-toolbar',
        render: () => ({
          type: 'row',
          children: ALL.map(([id, name, label]) => ({
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
