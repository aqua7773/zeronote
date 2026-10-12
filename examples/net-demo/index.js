/**
 * 网络出口 + 边界对照示例（契约 §4）
 *
 * 2026-10-13 拆权限门后，这个插件声明了 `net` 也**照常加载** —— 内核不再做权限判定、
 * 不再需要用户"授权"（原则 4：权限完全由插件控制）。保留 `net` 声明只是**自述**：
 * 设置页「网络与进程（自述）」会把自称需要 `net` / `proc` 的插件列出来，供用户知情。
 *
 * ⚠️ 别把它当"最小权限示例"看：插件与宿主跑在同一个 JS 上下文里，裸 `fetch` /
 * ESM 静态 `import` / 直接 `invoke()` 三条路都不查任何声明
 * （实测见 `docs/架构原则-2026-10-13.md` §2）。
 *
 * ## 三个按钮 = 网络边界的对照实验（2026-10-12 实测修正）
 *
 * WebView 里的 `fetch` 要过两道关，之前把两道搞混过，这里各留一个靶子：
 *
 * | 按钮 | 目标 | 拦它的是谁 |
 * |---|---|---|
 * | ① | `https://esm.sh/…`（有 CORS 头，且曾在 CSP 白名单内） | 都放行 —— HTTP 200 |
 * | ② | `https://www.baidu.com/`（**无** CORS 头） | **CORS**：`No 'Access-Control-Allow-Origin' header` |
 * | ③ | `https://registry.npmmirror.com/…`（**有** CORS 头，且**不在** CSP 白名单里） | 若通 ⇒ CSP 已真放宽；若拒 ⇒ CSP 仍拦 |
 *
 * ⚠️ **关键教训（2026-10-12 踩到）**：②与③失败时，插件侧看到的都是同一句
 * `TypeError: Failed to fetch` —— **从插件侧分不出是 CORS 还是 CSP**。要分辨必须看 `adb logcat`：
 * · CORS → `Access to fetch at … has been blocked by CORS policy`
 * · CSP  → `Refused to connect to … because it violates … Content Security Policy directive`
 * 当时只看插件侧，把 `example.com` 的 **CORS** 失败误判成了 **CSP 拦截**。
 */

/**
 * ③ 的靶子：**原本不在** CSP 白名单里，但**会返回 CORS 头**的国内可达服务。
 * 选它是因为 registry 规范要求 npm 镜像带 `Access-Control-Allow-Origin`，
 * 这样"被拦"就一定不是 CORS 造成的 —— 才能干净地测出 CSP 是否放行。
 */
const OUT_OF_ALLOWLIST = 'https://registry.npmmirror.com/vue/latest'

/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply(ctx) {
    const { command, view, host, subscriptions } = ctx

    subscriptions.push(
      command.register({
        id: 'net-demo.ping',
        title: '网络边界①：fetch esm.sh（有 CORS、曾在白名单内）',
        run: () => {
          host.notify('fetch esm.sh …')
          fetch('https://esm.sh/katex@0.16.11/package.json')
            .then((r) => host.notify(`① esm.sh：HTTP ${r.status} —— 通`))
            .catch((e) => host.notify(`① 失败：${String(e)}`, 'warn'))
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'net-demo.noCors',
        title: '网络边界②：fetch baidu.com（无 CORS）',
        run: () => {
          host.notify('fetch www.baidu.com …')
          fetch('https://www.baidu.com/')
            .then((r) => host.notify(`② baidu：HTTP ${r.status}`))
            .catch((e) => host.notify(`② 被拦（预期 CORS）：${String(e)}`, 'warn'))
        },
      }),
    )

    subscriptions.push(
      command.register({
        id: 'net-demo.outsideList',
        title: '网络边界③：fetch 白名单外的 npmmirror（有 CORS，测 CSP）',
        run: () => {
          host.notify('fetch registry.npmmirror.com …')
          fetch(OUT_OF_ALLOWLIST)
            .then((r) =>
              r.text().then((t) =>
                host.notify(`③ 白名单外：HTTP ${r.status} —— 通了（${t.length} 字节）`),
              ),
            )
            .catch((e) =>
              host.notify(`③ 被拦：${String(e)}（看 logcat 分清 CORS/CSP）`, 'warn'),
            )
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
            { type: 'text', value: '这个插件声明了 net —— 照常加载', variant: 'title' },
            {
              type: 'text',
              value:
                '你看到这一页 ⇒ 它加载成功了。注意：**不需要任何授权** —— ' +
                '2026-10-13 拆权限门后，内核不查 capability、也不拦插件。',
              variant: 'caption',
            },
            { type: 'divider' },
            {
              type: 'text',
              value:
                'WebView 里的 fetch 要过两道关：CORS（对方回不回 Access-Control-Allow-Origin）' +
                '与 CSP connect-src。三个按钮各打一个靶。',
              variant: 'caption',
            },
            { type: 'button', label: '① esm.sh（有 CORS、曾在白名单内）', onClick: 'net-demo.ping' },
            { type: 'button', label: '② www.baidu.com（无 CORS）', onClick: 'net-demo.noCors' },
            {
              type: 'button',
              label: '③ npmmirror（有 CORS、原不在白名单）',
              onClick: 'net-demo.outsideList',
            },
          ],
        }),
      }),
    )

    host.log('info', 'net-demo 已就绪（无需任何授权 —— 内核不查 capability）')
  },
}
