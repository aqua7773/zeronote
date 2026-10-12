/**
 * 独立窗口示例（U1 · 2026-10-13 rev50）
 *
 * 这个插件只做一件事：把**自己的一个面板**放进独立窗口。
 *
 *   · `view.registerPanel` 照旧登记面板（这里是 `location: 'main'`，所以它平时也能在主区看）
 *   · `view.openWindow({ panel })` 把它开成一个**新窗口**（可拖 / 可缩放 / 能多开）
 *   · 返回的 `Disposable` = 关掉那个窗口；push 进 `subscriptions` 后**卸载插件窗口自动关**
 *
 * 窗口那边是**新的 webview**（自己的 JS 上下文）：它会重新加载一遍插件，
 * 然后只渲染 `?pluginWindow=window-demo.panel` 指定的这个面板 —— 没有侧栏、没有编辑器。
 * 所以在新窗口里再点一次「在新窗口打开」，就是再开一个（多开）。
 *
 * 验收脚本：`node tools/verify-plugin-window.mjs`
 */
export default {
  apply(api) {
    /** 本次 apply 里开过几个窗口 —— 写进面板状态，界面上看得见（不是日志里猜） */
    let opened = 0

    const openWindow = (title) => {
      try {
        const win = api.view.openWindow({
          panel: 'window-demo.panel',
          title,
          width: 720,
          height: 520,
        })
        // 与其它资源同一条路子：登记 ⇒ 插件卸载时宿主替我关掉它
        api.subscriptions.push(win)
        opened += 1
        api.view.setState('window-demo.opened', opened)
        api.view.refresh()
        api.host.notify(`已开第 ${opened} 个独立窗口`)
      } catch (e) {
        // 明确报错：开窗口失败不能变成「点了没反应」
        api.host.notify(`打开窗口失败：${String(e)}`, 'error')
      }
    }

    api.subscriptions.push(
      api.command.register({
        id: 'window-demo.open',
        title: '独立窗口示例：在新窗口打开',
        run: () => openWindow('独立窗口示例'),
      }),
      api.command.register({
        id: 'window-demo.openAgain',
        title: '独立窗口示例：再开一个窗口',
        run: () => openWindow('独立窗口示例 · 再一个'),
      }),
      api.view.registerPanel({
        id: 'window-demo.panel',
        title: '独立窗口示例',
        location: 'main',
        render: (ctx) => ({
          type: 'stack',
          children: [
            { type: 'text', value: '独立窗口示例', variant: 'title' },
            {
              type: 'text',
              value: '这个面板可以放进它自己的窗口：可拖、可缩放、能多开；插件卸载时窗口会被自动关掉。',
              variant: 'caption',
            },
            { type: 'divider' },
            { type: 'button', label: '在新窗口打开', onClick: 'window-demo.open' },
            { type: 'button', label: '再开一个（多开）', onClick: 'window-demo.openAgain' },
            {
              type: 'text',
              value: `本次已开 ${Number(ctx.state['window-demo.opened'] ?? 0)} 个独立窗口`,
              variant: 'caption',
            },
          ],
        }),
      }),
    )

    api.host.log('info', 'window-demo 已就绪（view.openWindow 可用）')
  },
}
