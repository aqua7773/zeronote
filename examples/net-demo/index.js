/**
 * `net` 授权通道示例（契约 §4）
 *
 * 这个插件声明了 `net` ⇒ 在用户于「设置 → 插件 → 网络访问」里为它开过一次**之前**，
 * 它根本不会被加载（插件页会显示拒载原因："要求默认拒绝的 capability：net"）。
 *
 * 验收判据：
 *   ① 刚装进库 ⇒ 插件列表里它**未启用** + 错误区写明怎么开
 *   ② 打开开关 ⇒ 它立刻加载、面板出现、状态行变"已启用"
 *   ③ 授权记录落在库内 `.zn/permissions.json`
 *
 * ⚠️ 诚实说明：这道门是**知情与承诺**，**不是隔离** —— 插件与宿主跑在同一个 JS
 * 上下文里，裸 `fetch` / ESM 静态 `import` / `invoke` 三条路都不查这张表。
 *
 * 不过本次（2026-10-12）加了 CSP 之后，"裸 fetch"这条路**实际被 `connect-src` 挡住了** ——
 * 下面两个按钮就是对照实验：白名单内的域名能通，白名单外的一律被拦。
 * 详见 `docs/内核契约-v0.1.md` §4.2。
 */

/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply(ctx) {
    const { command, view, host, subscriptions } = ctx

    subscriptions.push(
      command.register({
        id: 'net-demo.ping',
        title: '网络访问示例：fetch 白名单内的域名',
        run: () => {
          host.notify('fetch esm.sh（connect-src 白名单内）…')
          fetch('https://esm.sh/katex@0.16.11/package.json')
            .then((r) => host.notify(`① 白名单内：HTTP ${r.status} —— 通`))
            .catch((e) => host.notify(`① 白名单内却失败了：${String(e)}`, 'warn'))
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'net-demo.blocked',
        title: '网络访问示例：fetch 白名单外的域名',
        run: () => {
          host.notify('fetch example.com（不在 connect-src 白名单里）…')
          fetch('https://example.com/')
            .then((r) => host.notify(`② 白名单外竟然通了：HTTP ${r.status}`, 'warn'))
            .catch((e) => host.notify(`② 白名单外被拦（预期）：${String(e)}`))
        },
      }),
    )

    subscriptions.push(
      view.registerPanel({
        id: 'net-demo.panel',
        title: '网络访问示例',
        location: 'main',
        render: () => ({
          type: 'stack',
          gap: 'md',
          children: [
            { type: 'text', value: '这个插件声明了 net', variant: 'title' },
            {
              type: 'text',
              value: '你看到这一页 ⇒ 它已经被授权、并且真的被加载起来了。',
              variant: 'caption',
            },
            { type: 'divider' },
            {
              type: 'text',
              value: '对照实验：CSP 的 connect-src 白名单里只有 esm.sh 与 cdn.jsdelivr.net。',
              variant: 'caption',
            },
            { type: 'button', label: '① fetch esm.sh（白名单内）', onClick: 'net-demo.ping' },
            {
              type: 'button',
              label: '② fetch example.com（白名单外）',
              onClick: 'net-demo.blocked',
            },
          ],
        }),
      }),
    )

    host.log('info', 'net-demo 已就绪（这台设备上它已被授权联网）')
  },
}
