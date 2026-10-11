/**
 * **消费者**示例 —— 这就是「软依赖」的实际写法。
 *
 * 三个值得照抄的点：
 *  ① `consume` 是 async 且**可能返回 null** —— 所以 `apply` 是 async 的，
 *     但**加载不会被阻塞或拒绝**（缺前置也照样装得上）；
 *  ② 拿不到就**降级**：这里显示一句"请先装前置插件"。比抛错好得多 ——
 *     硬依赖会导致"一个插件装错版本，整个应用起不来"；
 *  ③ 想让"前置插件晚于自己加载"也能补上时，监听 `service:available` 事件重试
 *     （本示例的消费点在 apply 里一次性完成，所以不需要）。
 */
export default {
  async apply(api) {
    /** @type {{ renderToString(tex: string, displayMode?: boolean): string } | null} */
    let katex = await api.service.consume('katex')

    // 前置插件可能比自己晚加载 ⇒ 挂一次事件，等它出现就补上
    api.subscriptions.push(
      api.event.on('service:available', (payload) => {
        const name = (payload && typeof payload === 'object' ? payload.name : null) ?? ''
        if (name !== 'katex' || katex) return
        void api.service.consume('katex').then((got) => {
          if (!got) return
          katex = got
          api.view.refresh('dep-consumer.panel')
        })
      }),
    )

    api.view.registerPanel({
      id: 'dep-consumer.panel',
      title: '公式演示',
      location: 'main',
      render: () => {
        if (!katex) {
          return {
            type: 'stack',
            gap: 'sm',
            children: [
              { type: 'text', value: '还没拿到 katex 服务', variant: 'title' },
              {
                type: 'text',
                value: '请把 examples/dep-katex 也装进 .zn/plugins/ —— 这就是「前置插件」。',
                tone: 'warn',
              },
              { type: 'text', value: '（本插件不会因此加载失败，只是降级显示）', variant: 'caption', tone: 'muted' },
            ],
          }
        }
        return {
          type: 'stack',
          gap: 'md',
          children: [
            { type: 'text', value: '二次方程求根公式', variant: 'caption', tone: 'muted' },
            {
              type: 'html',
              // 前置插件提供的 style 拼在前面 —— 消费者不必知道 katex 需要哪套 CSS
              value: (katex.style ?? '') + katex.renderToString('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', true),
            },
            { type: 'divider' },
            { type: 'text', value: '下面这段同样是 katex 渲染的 HTML，走 html 节点直投', variant: 'caption', tone: 'muted' },
            {
              type: 'html',
              value: katex.renderToString('\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}', true),
            },
            { type: 'badge', text: `katex ${katex.version ?? ''}（由前置插件提供）`, tone: 'success' },
          ],
        }
      },
    })
  },
}
