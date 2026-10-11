/**
 * 编辑器标记演示 —— 用 `editor.addMark` 实现 `[[笔记名]]` 引用与 `#标签` 着色。
 *
 * 这是"规格 §2.2 的 `[[文件名]]` 笔记引用与跳转"的最小实现，也是第 2 批能力的验收件。
 *
 * 关键点：插件**完全不接触 CodeMirror**。它只交三样可序列化的东西 ——
 *   ① 正则源（字符串）  ② 样式档位（link / tag / …）  ③ 点击要执行的命令 id
 * 剩下的翻译（装饰器、点击定位）由宿主做。所以这套规则将来进 Worker / iframe 沙箱也不用改。
 */
export default {
  apply(api) {
    /** 在库里找一篇"名字对得上"的笔记：文件名或标题匹配即可 */
    async function findNote(name) {
      const notes = await api.fs.listNotes()
      return (
        notes.find((n) => {
          const base = n.path.split('/').pop()?.replace(/\.md$/i, '') ?? ''
          return base === name || n.title === name
        }) ?? null
      )
    }

    // 点击 [[xxx]] 时执行：解析出名字 → 找到笔记 → 打开
    api.command.register({
      id: 'editor-marks.open-ref',
      title: '打开引用的笔记',
      run: async (payload) => {
        const raw = String(payload?.text ?? '')
        const name = raw.replace(/^\[\[/, '').replace(/\]\]$/, '').trim()
        if (!name) return
        const hit = await findNote(name)
        if (!hit) {
          api.host.notify(`没找到笔记「${name}」`, 'warn')
          return
        }
        await api.doc.open(hit.path)
        api.host.notify(`已打开：${hit.path}`)
      },
    })

    // `[[笔记名]]` —— 链接样式 + 可点。
    // 正则里刻意排除换行与方括号：一行里写了半个 `[[` 不该把后面整段都染上。
    api.subscriptions.push(
      api.editor.addMark({
        id: 'wikilink',
        pattern: '\\[\\[[^\\[\\]\\n]{1,80}\\]\\]',
        className: 'link',
        onClick: 'editor-marks.open-ref',
        title: '点击打开这篇笔记',
      }),
    )

    // 点击标签时的动作（示例：真实实现里这里可以开搜索面板按标签过滤）
    api.command.register({
      id: 'editor-marks.goto-tag',
      title: '按标签查看',
      run: (payload) => {
        const tag = String(payload?.text ?? '').replace(/^#/, '')
        api.host.notify(`点到了标签「${tag}」（from=${payload?.from}）`)
      },
    })

    // `#标签` —— 着色 + 可点。
    // 用 lookbehind 要求前面是行首或空白，避免把 URL 里的 #fragment 也染上。
    //
    // ⚠️ 为什么拿它而不是 `[[...]]` 来验证点击：atomic 编辑器**自己认识 `[[x]]`**
    // 并用 replace/widget 类装饰渲染它（黄底 + 外链图标）；CM6 里那类装饰**优先级
    // 高于 mark 装饰**，所以叠加不上去、点击也轮不到我们。`#标签` 它不认识，
    // 于是我们的 mark 装饰正常生效 —— 这条才是本能力的主场。
    api.subscriptions.push(
      api.editor.addMark({
        id: 'hashtag',
        pattern: '(?<=^|\\s)#[^\\s#[\\]]{1,30}',
        className: 'tag',
        onClick: 'editor-marks.goto-tag',
        title: '点击按这个标签查看',
      }),
    )
  },
}
