/**
 * WebView 逃生口示例（契约 §2.2 / §7.9）
 *
 * 演示三件事：
 *   ① `view.registerWebView({ location: 'main', url })` 把**插件自己的页面**挂进主区；
 *   ② 那个页面跑在 `sandbox="allow-scripts"` 的 iframe 里（**没有** allow-same-origin）——
 *      它有脚本，但拿不到宿主的 DOM / localStorage / Tauri IPC；
 *   ③ 主题令牌由宿主 `postMessage` 送进来，**主题一变化就自动重发**，
 *      页面把令牌写成本文档的 CSS 变量 ⇒ 它是"跟着 ZeroNote 主题走"的。
 *
 * ⚠️ **页面必须是"独立 origin"的资源**（库内文件经 `host.assetUrl`、或 http(s) 远程页），
 * 不能是 `data:` / `srcdoc` 内联的 HTML —— 那两种 iframe 会**继承宿主 CSP**，
 * 而 Tauri 编译时会往 `script-src` 注入打包资源的 sha256；按 CSP 规范，
 * 源列表里一旦有 hash，`'unsafe-inline'` 就被忽略 ⇒ 内联脚本被拦。
 * （真机 logcat 实测：「'unsafe-inline' is ignored if either a hash or nonce value is present」，
 *  2026-10-12 踩到并写进契约 §2.2。）
 */

/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply(ctx) {
    const { command, view, host, subscriptions } = ctx

    /**
     * 页面地址必须是**独立 origin 的资源**（`http(s):` 页面）。
     *
     * 两种"看起来更省事"的写法都不行，各有真机实测原因：
     *  · `data:` / `srcdoc` / `blob:` —— 这类 iframe 会**继承宿主 CSP**，而 Tauri 编译时会
     *    往 `script-src` 注入打包资源的 sha256；按 CSP 规范，"源列表里一旦有 hash，
     *    `'unsafe-inline'` 就被忽略" ⇒ 页面里的内联脚本一律被拦
     *    （真机 logcat 原话：`'unsafe-inline' is ignored if either a hash or nonce value is present`）。
     *  · `host.assetUrl()`（Tauri asset 协议）在 **Android 上不服务 .html**：
     *    真机实测 `http://asset.localhost/…/page.html` → `net::ERR_INVALID_RESPONSE`
     *    （把 scope 放宽到 `/storage/**` 也一样）。
     *
     * 所以这个演示页由**局域网上的一台静态服务器**提供（一行 node 就能起）：
     *   node -e "require('http').createServer((q,s)=>…).listen(8791,'0.0.0.0')"
     * 真实插件把页面放在自己的服务上，或直接指向 `http(s)://` 远程页面即可。
     */
    const url = 'http://192.168.1.5:8791/page.html'

    // 主区挂一个「自己的页面」
    subscriptions.push(
      view.registerWebView({
        id: 'webview-demo.main',
        title: 'WebView 示例',
        location: 'main',
        url,
      }),
    )

    // 顺手演示：同一个页面也能以 modal 弹出来（location 分流由宿主负责）
    subscriptions.push(
      view.registerWebView({
        id: 'webview-demo.modal',
        title: 'WebView 示例（弹窗）',
        location: 'modal',
        url,
      }),
    )

    subscriptions.push(
      command.register({
        id: 'webview-demo.report',
        title: 'WebView 示例：报一下沙箱边界',
        run: () => {
          host.notify('iframe 与宿主互为 opaque origin：页面拿不到宿主的 DOM / 存储 / IPC')
        },
      }),
    )

    host.log('info', `webview-demo 已就绪：两个 WebView 面板（main / modal）→ ${url}`)
  },
}
