/**
 * 索引分区演示 —— 证明「机密分区的文档不会被公开搜索命中」。
 *
 * 做法：往 `demo.secret` 分区里塞一条**编造的**笔记（不落盘，纯索引），
 * 然后拿同一个关键词分别在默认分区和机密分区查：
 *   · 默认分区 ⇒ **0 条**（看不见）      ← 这就是隔离
 *   · 机密分区 ⇒ **1 条**
 *
 * 这条能力是规格 §2.6「机密/绝密用本地索引、公开可云索引」的地基：
 * 不同密级的索引必须物理分开，否则一条机密正文会被公开搜索命中。
 */
const SECRET_KEY = 'zzyzx-plugh'
const SECRET_PATH = '机密/绝密草稿.md'

export default {
  async apply(api) {
    // 机密分区：独立命名空间，默认分区完全看不见
    const secret = api.index.scoped('demo.secret')
    await secret.upsert(SECRET_PATH, `# 绝密草稿\n\n这里只有一个暗号：${SECRET_KEY}\n`)

    api.command.register({
      id: 'index-scope.query-default',
      title: '分区演示：在默认分区搜暗号',
      run: async () => {
        const hits = await api.index.query(SECRET_KEY)
        api.view.setState('result', `默认分区命中 ${hits.length} 条：${JSON.stringify(hits.map((h) => h.path))}`)
        api.view.refresh()
      },
    })

    api.command.register({
      id: 'index-scope.query-secret',
      title: '分区演示：在机密分区搜暗号',
      run: async () => {
        const hits = await secret.query(SECRET_KEY)
        api.view.setState('result', `机密分区命中 ${hits.length} 条：${JSON.stringify(hits.map((h) => h.path))}`)
        api.view.refresh()
      },
    })

    api.view.registerPanel({
      id: 'index-scope.panel',
      title: '索引分区演示',
      location: 'main',
      render: (ctx) => ({
        type: 'stack',
        gap: 'md',
        children: [
          { type: 'text', value: '索引分区', variant: 'title' },
          {
            type: 'text',
            value:
              '已把一条编造的笔记（暗号 ' +
              SECRET_KEY +
              '）只写进 demo.secret 分区。下面两个按钮拿同一个关键词查，结果应该不同。',
            variant: 'caption',
            tone: 'muted',
          },
          {
            type: 'row',
            gap: 'sm',
            wrap: true,
            children: [
              { type: 'button', label: '在默认分区搜', onClick: 'index-scope.query-default' },
              { type: 'button', label: '在机密分区搜', variant: 'ghost', onClick: 'index-scope.query-secret' },
            ],
          },
          { type: 'divider' },
          { type: 'text', value: '结果', variant: 'caption', tone: 'muted' },
          { type: 'code', value: String(ctx.state.result ?? '（还没查）') },
          {
            type: 'text',
            value: '默认分区应为 0 条、机密分区应为 1 条 —— 这就是隔离。',
            variant: 'caption',
            tone: 'success',
          },
        ],
      }),
    })
  },
}
