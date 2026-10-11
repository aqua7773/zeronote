/**
 * **前置插件**示例 —— 只提供「能力」，自己不挂任何界面。
 *
 * 这就是"把依赖环境做成插件"的形态：
 *   · 内核**完全不认识** katex（`service` 原语只是一张 `名字 → 懒工厂` 的表）；
 *   · 换成别的公式渲染器 ⇒ 换掉这个插件即可，内核一行都不用改；
 *   · `factory` 是懒的 ⇒ **没有插件 consume 时，CDN 请求一次都不会发**（按需激活）。
 *
 * 卸载即净：`provide` 返回的 Disposable 由宿主在插件卸载时强制回收
 * （见 Kernel.releaseServices），所以不需要消费者做任何清理。
 */
export default {
  apply(api) {
    api.service.provide(
      'katex',
      async () => {
        // 只有**第一次 consume** 才会走到这里 —— 上面那句 provide 本身零成本
        const mod = await import('https://esm.sh/katex@0.16.11')
        const katex = mod.default ?? mod
        api.host.log('info', '[dep-katex] 首次被使用时才从 CDN 载入 katex')
        return {
          /** 与 katex 官方 API 同名，消费者用起来无感 */
          renderToString: (tex, displayMode = false) =>
            katex.renderToString(tex, { displayMode, throwOnError: false }),
          /**
           * katex 的 HTML 输出里同时含 **MathML 层与可视层**，官方靠 katex.css 隐藏前者。
           * 不加载它的后果：同一道公式会被念两遍（可视 + 那段降级文本）—— 实测踩到过。
           *
           * **前置插件负责自己的样式**：消费者只要把这段拼在 html 节点前面即可，
           * 不必知道 katex 内部有什么讲究。
           */
          style:
            '<style>@import url("https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css");</style>',
          version: '0.16.11',
        }
      },
      { version: '0.16.11' },
    )
  },
}
