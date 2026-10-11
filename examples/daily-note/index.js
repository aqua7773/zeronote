/**
 * 「当天目录新建」—— 接管内核的 `core.newNote`。
 *
 * 规格 §2.1 / §2.2 要求：
 *   · 灵感流一条 = `笔记/年/月/日/HH-mm-ss.md`
 *   · "在'笔记'目录下，**只能在当天时间目录新建笔记**"
 *
 * 这两条以前**做不到** —— 内核的新建按钮是硬编码的，插件没有任何接管点。
 * 现在内核的「新建笔记」（菜单项 / 首页按钮 / Ctrl+N / 快速切换里输名字）
 * **全都走 `core.newNote` 命令**，插件 `command.bind('core.newNote', run)`
 * 就把它换掉了；换掉之后**四个入口一起生效**（因为它们本来就指向同一条命令）。
 *
 * ⚠️ 依赖一个**顺序**：内核先 `register` 这条命令、插件后 `bind`。
 * 宿主的两个 effect 恰好是这个顺序（内核命令注册在前、插件加载在后），
 * 所以这里的 bind 是"覆盖实现"，不会撞 `命令 id 重复`。
 */
const pad = (n) => String(n).padStart(2, '0')

export default {
  apply(api) {
    api.subscriptions.push(
      api.command.bind('core.newNote', async (payload) => {
        const d = new Date()
        const dir = `笔记/${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
        // 快速切换里给了名字就用它；否则按灵感流的约定用 HH-mm-ss
        const given = String((payload && payload.name) || '').trim()
        const base = given
          ? given.replace(/\.md$/i, '')
          : `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
        const path = `${dir}/${base}.md`

        await api.fs.mkdir(dir) // 幂等：当天第一篇会建目录
        await api.fs.createNote(path, `# ${base}\n\n`)
        api.host.notify(`已建在当天目录：${path}`)
        await api.doc.open(path)
      }),
    )
  },
}
