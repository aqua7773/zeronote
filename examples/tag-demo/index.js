/**
 * 标签演示 —— `index.tags()` 聚合 + `index.query(q, { tag })` 字段过滤。
 *
 * 规格 §2.3 要求「搜索范围：正文、标题、标签」，这里的第二条命令就是**按标签筛**：
 * 关键词为空、只给 `tag` ⇒ 等价于"列出这个标签下的全部笔记"。
 *
 * 标签来源（`tagsOf` 会一起抽）：
 *   · frontmatter `tags: [a, b]`（行内数组）
 *   · frontmatter 多行 `tags:` + `- a`
 *   · frontmatter `标签: a, b`（中文键、单行逗号）
 *   · 正文里的 `#标签`
 */
export default {
  apply(api) {
    api.command.register({
      id: 'tag-demo.stats',
      title: '标签演示：统计库里的标签',
      run: async () => {
        // rebuild 一次把所有笔记读进来（真实插件会挂到"打开搜索面板"的时机）
        const r = await api.index.rebuild()
        const tags = await api.index.tags()
        const top = tags
          .slice(0, 8)
          .map((t) => `${t.tag}(${t.count})`)
          .join('、')
        api.host.notify(`索引 ${r.count} 篇 / ${r.ms}ms；共 ${tags.length} 种标签：${top || '（无）'}`)
      },
    })

    api.command.register({
      id: 'tag-demo.search',
      title: '标签演示：只看「工作」标签的笔记',
      run: async () => {
        await api.index.rebuild()
        const hits = await api.index.query('', { tag: '工作' })
        api.host.notify(
          `标签「工作」下 ${hits.length} 篇：${hits.map((h) => h.title).join(' / ') || '（无）'}`,
        )
      },
    })
  },
}
