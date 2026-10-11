/**
 * 灵感流插件 —— ZeroNote 的**第一个真插件**（也是「声明式 UI 主路」的压力测试）。
 * 2026-10-12 按需求规格 §2.1 做了一次**能力升级**（0.1 → 0.2）。
 *
 * ## 规格 §2.1 的每一条，以及它靠什么实现
 *
 * | 要求 | 靠什么 |
 * |---|---|
 * | 聊天式输入框 | `textarea` + `button`（`send` 把输入值带给命令） |
 * | 一条 = `笔记/年/月/日/HH-mm-ss.md` | **`fs.mkdir`**（幂等建目录，0.2 新能力）+ `fs.createNote` |
 * | 按时间流展示 `笔记/` | `fs.listNotes('笔记')`，路径本身就是时间 ⇒ 字典倒排 |
 * | 点击某条进入编辑器 | **`list.onClick` + 稳定 key**（0.2 新能力）→ 命令 → `doc.open` |
 * | 快捷标签 | 输入里的 `#标签` 写进 frontmatter（`index` 那边也认它） |
 * | 手机端辅助输入工具栏 | **`view` 的 `editor-toolbar` 位置**（0.2 新能力） |
 *
 * ## 从 0.1 特意保留的四条工程习惯（升级时没丢）
 *
 * ① 空内容拒发  ② 连点保护（500ms）  ③ **失败保留输入**（只有成功才清空）
 * ④ 状态行显示成功 / 失败原因
 *
 * 这四条是 0.1 那版（M2 时期）攒下的，与"能力"无关 —— 换多少原语都不该丢。
 */
const BIND_DRAFT = 'inspiration-flow.draft'
const DEDUP_MS = 500
const ROOT = '笔记'
const MAX_ROWS = 50

const pad = (n) => String(n).padStart(2, '0')
const dirOf = (d) => `${ROOT}/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
const nameOf = (d) => `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`

/**
 * 从输入里抽 `#标签`。字符类与 `index-api` 的 `tagsOf` **保持一致**（排除中英标点）——
 * 不一致的话「写个 #想法。」会在这里算成标签「想法。」，而在索引里算成「想法」。
 */
const TAG_RE = /(?<=^|\s)#([^\s#[\]{}()（）【】「」，。！？、；：""''.,!?;:]{1,30})/gm

export default {
  apply(ctx) {
    const { fs, command, view, host, doc, subscriptions } = ctx

    /** 时间流（新 → 旧），render 是纯函数，数据得先备好 */
    let rows = []
    /** 面板底部的状态行 */
    let status = ''
    /** 连点保护 */
    let lastSentAt = 0

    function frontmatterFor(text) {
      const tags = [...text.matchAll(TAG_RE)].map((m) => m[1])
      return tags.length > 0 ? `---\ntags: [${[...new Set(tags)].join(', ')}]\n---\n\n` : ''
    }

    async function reload() {
      try {
        const list = await fs.listNotes(ROOT)
        rows = list
          .map((m) => ({ path: m.path, size: m.size }))
          // 路径形如 `笔记/2026/10/12/02-23-46.md` ⇒ 字典倒排就是时间倒排
          .sort((a, b) => (a.path < b.path ? 1 : -1))
          .slice(0, MAX_ROWS)
      } catch {
        rows = [] // 目录还不存在 = 还没写过，不是错误
      }
      view.refresh('inspiration-flow.stream')
    }

    async function capture(rawValue) {
      const text = String(rawValue ?? '').replace(/\s+$/, '')

      // ① 空内容拒发
      if (!text.trim()) {
        status = '内容为空，已拒发'
        host.notify('内容为空，没有落盘', 'warn')
        view.refresh()
        return
      }

      // ② 快速连点只算一次
      const now = Date.now()
      if (now - lastSentAt < DEDUP_MS) return
      lastSentAt = now

      const d = new Date()
      const dir = dirOf(d)
      const rel = `${dir}/${nameOf(d)}.md`
      try {
        await fs.mkdir(dir) // 0.2 新能力：当天第一篇会建目录，幂等
        await fs.createNote(rel, `${frontmatterFor(text)}# ${nameOf(d)}\n\n${text}\n`)
        view.setState(BIND_DRAFT, '') // ③ 成功才清空输入
        status = `已捕捉 → ${rel}`
        await reload()
        host.notify('已捕捉 ✎')
      } catch (e) {
        // ④ 失败保留输入（不清空），把原因显示出来
        status = `失败：${String(e)}`
        host.notify('捕捉失败，输入已保留', 'error')
        view.refresh()
      }
    }

    subscriptions.push(
      command.register({
        id: 'inspiration-flow.capture',
        title: '灵感：捕捉当前输入',
        run: (payload) => capture(payload && payload.value),
      }),
      command.register({
        id: 'inspiration-flow.refresh',
        title: '灵感：刷新时间流',
        run: () => reload(),
      }),
      /** 点时间流里某一条 ⇒ 打开它（`list.onClick` 的 payload 带 `{ index, key }`） */
      command.register({
        id: 'inspiration-flow.open',
        title: '灵感：打开这一条',
        run: async (payload) => {
          const path = String((payload && payload.key) || '')
          if (path) await doc.open(path)
        },
      }),
      /** 工具栏：把**编辑器里选中的文字**存成灵感（比"捕捉空输入框"有意义得多） */
      command.register({
        id: 'inspiration-flow.capture-selection',
        title: '灵感：把选中的文字存为灵感',
        run: async () => {
          const sel = doc.selection()
          if (!sel || !sel.text.trim()) {
            host.notify('先在正文里选中一段文字', 'warn')
            return
          }
          await capture(sel.text)
        },
      }),
      /** 工具栏：往光标处插一个 `#标签` */
      command.register({
        id: 'inspiration-flow.tag',
        title: '灵感：插入标签',
        run: (payload) => doc.insertAtCursor(`#${String((payload && payload.tag) || '想法')} `),
      }),

      view.registerPanel({
        id: 'inspiration-flow.stream',
        title: '灵感流',
        location: 'main',
        render: () => ({
          type: 'stack',
          gap: 'md',
          children: [
            { type: 'text', value: '灵感流', variant: 'title' },
            {
              type: 'text',
              value: `落在 ${ROOT}/年/月/日/ 下 · 共 ${rows.length} 条`,
              variant: 'caption',
            },
            { type: 'divider' },
            {
              type: 'textarea',
              bind: BIND_DRAFT,
              rows: 3,
              placeholder: '随手记一句……（写 #标签 会存进 frontmatter）',
              onSubmit: 'inspiration-flow.capture',
            },
            {
              type: 'row',
              gap: 'sm',
              wrap: true,
              children: [
                // send 把 state[BIND_DRAFT] 的当前值随命令发出去
                { type: 'button', label: '捕捉', onClick: 'inspiration-flow.capture', send: BIND_DRAFT },
                { type: 'button', label: '刷新', variant: 'ghost', onClick: 'inspiration-flow.refresh' },
              ],
            },
            { type: 'divider' },
            {
              type: 'list',
              onClick: 'inspiration-flow.open',
              empty: '还没有灵感 —— 在上面写一句再点「捕捉」',
              items: rows.map((r) => ({
                key: r.path, // 稳定 key：点击时原样回到命令 payload 的 key
                node: {
                  type: 'row',
                  gap: 'sm',
                  align: 'center',
                  children: [
                    {
                      type: 'text',
                      value: r.path.slice(ROOT.length + 1).replace(/\.md$/i, ''),
                      variant: 'caption',
                    },
                    { type: 'badge', text: `${r.size} B`, tone: 'muted' },
                  ],
                },
              })),
            },
            ...(status
              ? [
                  {
                    type: 'text',
                    value: status,
                    variant: 'caption',
                    tone: status.startsWith('失败') ? 'danger' : 'muted',
                  },
                ]
              : []),
          ],
        }),
      }),

      /** 编辑器底部工具栏（手机端随手可点）—— `location: 'editor-toolbar'` */
      view.registerPanel({
        id: 'inspiration-flow.toolbar',
        title: '灵感工具',
        location: 'editor-toolbar',
        render: () => ({
          type: 'row',
          gap: 'sm',
          align: 'center',
          wrap: true,
          children: [
            { type: 'button', label: '⚡ 存为灵感', onClick: 'inspiration-flow.capture-selection' },
            ...['想法', '待办', '引用'].map((tag) => ({
              type: 'button',
              label: `#${tag}`,
              variant: 'ghost',
              onClick: 'inspiration-flow.tag',
              payload: { tag },
            })),
          ],
        }),
      }),
    )

    void reload()
    host.log('info', `灵感流就绪（${ROOT}/年/月/日/）`)
  },
}
