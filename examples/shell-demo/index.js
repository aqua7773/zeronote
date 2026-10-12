/**
 * 整窗接管示例（U2 · 2026-10-13 rev51）
 *
 * 做一件事：**把自己的自绘界面接管整个窗口** —— 侧栏 / 编辑器 / 状态栏全部让位。
 *
 *   · `view.overrideShell({ mount })` —— `mount(el, ctx)` 拿到宿主给的容器，直接用 DOM 画
 *   · 返回的 `Disposable` = 释放接管（内核 UI 立刻回来）；push 进 `subscriptions` 后
 *     **卸载插件也会自动释放**（这就是原则 3 的"关掉插件内核还能用"）
 *   · 样式靠内核的 `--zn-*` 令牌（深浅色/主题自动跟随）；用户已裁决不强制风格
 *
 * 验收入口：`window.__shellDemo`（CDP 读它）+ 命令 `shell-demo.takeover` / `shell-demo.release`
 * 验收脚本：`node tools/verify-shell.mjs`
 */
export default {
  apply(api) {
    /** 当前接管句柄（null = 没在接管）。同一插件重复接管由它挡住 —— 内核只保证"不跨插件抢占"。 */
    let handle = null

    const release = () => {
      if (!handle) return
      handle.dispose()
      handle = null
      window.__shellDemo = { active: false }
      api.host.notify('已释放接管，内核 UI 回来了')
    }

    const takeover = () => {
      if (handle) {
        api.host.notify('已经在接管中（先「释放接管」或卸载插件）')
        return
      }
      try {
        handle = api.view.overrideShell({
          mount(el, ctx) {
            // 用 DOM API 而不是 innerHTML 拼字符串：路径/插件名不需要转义，也没有注入面
            const box = document.createElement('div')
            box.className = 'shell-demo-box'
            // 插件自己的样式就由插件给（内核不强制风格，只提供 --zn-* 令牌）
            box.style.cssText = 'padding:32px;max-width:760px;line-height:1.7'

            const title = document.createElement('h2')
            title.textContent = '整窗接管示例'
            title.style.cssText = 'margin:0 0 10px;font-size:20px'

            const caption = document.createElement('p')
            caption.textContent =
              '内核 UI 已经让位：侧栏、编辑器、状态栏都不在渲染树里。点下面的按钮把控制权还给内核。'
            caption.style.cssText = 'margin:0 0 20px;color:var(--zn-fg-muted)'

            const btn = document.createElement('button')
            btn.type = 'button'
            btn.className = 'zn-plain-btn'
            btn.textContent = '释放接管（内核 UI 回来）'
            btn.addEventListener('click', release)

            const meta = document.createElement('p')
            meta.textContent = `插件 ${ctx.pluginId} · 库 ${ctx.vault} · 平台 ${ctx.platform}`
            meta.style.cssText = 'margin-top:20px;font-size:12px;color:var(--zn-fg-subtle)'

            box.append(title, caption, btn, meta)
            el.appendChild(box)

            // 释放时先调这里，再由宿主清空容器（顺序：插件收尾 → 宿主清场）
            return {
              dispose: () => {
                btn.removeEventListener('click', release)
                /**
                 * 内核逃生口（右下角小按钮 / `Ctrl+Alt+Z`）释放时走的**就是这里** ——
                 * 所以必须把句柄清掉：否则插件还以为自己在接管，再执行「接管」会被自己挡住。
                 */
                handle = null
                window.__shellDemo = { active: false, releasedBy: 'dispose' }
              },
            }
          },
        })
        api.subscriptions.push(handle)
        window.__shellDemo = { active: true, pluginId: api.pluginId }
        api.host.notify('已接管整窗（内核 UI 让位）')
      } catch (e) {
        // 明确报错：接管失败不能变成"点了没反应"（比如已被别的插件接管）
        api.host.notify(`接管失败：${String(e)}`, 'error')
      }
    }

    window.__shellDemo = { active: false }

    api.subscriptions.push(
      api.command.register({
        id: 'shell-demo.takeover',
        title: '整窗接管示例：接管整个界面',
        run: () => takeover(),
      }),
      api.command.register({
        id: 'shell-demo.release',
        title: '整窗接管示例：释放接管',
        run: () => release(),
      }),
    )

    api.host.log('info', 'shell-demo 已就绪（view.overrideShell 可用）')
  },

  dispose() {
    // 宿主会把 subscriptions 里的接管句柄 dispose 掉（内核 UI 自动复原）；
    // 这里只清掉自己的诊断出口
    window.__shellDemo = { active: false, disposed: true }
  },
}
