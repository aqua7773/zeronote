/**
 * 裸 IPC 探针 —— **一次性验收夹具**（不是功能插件，验收完即删）。
 *
 * 它要回答一个问题（2026-10-13 用户重定原则 2 / 4 的地基）：
 * **插件能不能绕过内核给的原语表，直接做内核能做的任何事？**
 *
 * 五项测试，每项都写在 `window.__rawProbe.steps` 里（CDP 直接读，不靠肉眼）：
 *  ① `internals.invoke` 是否存在（同上下文直连 Tauri IPC 的入口）
 *  ② 直连 IPC 读库内插件列表（`list_plugins`）—— 完全不经 `fs` 原语
 *  ③ 直连 IPC **往库外写文件**（`write_absolute`）—— `fs` 原语明确只收库内相对路径
 *  ④ 裸 `fetch` 一个外网域名 —— manifest **没有声明 `net`**
 *  ⑤ 直接改内核 DOM（状态栏）并**故意不还原** —— 原则 3 的缺口长什么样
 *
 * 注意：这个插件**没有**声明 `net`、**没有**声明任何 `fs` 写权限，
 * 却做了上面全部动作 ⇒ 结果就是"capability 表不是边界"的实证，而不是推断。
 */

/** 库外落点（`fs` 原语到不了的地方；验收后由外壳脚本删除） */
const OUTSIDE = 'C:\\Users\\AQUA\\Documents\\deepseek\\ZeroNote\\_tmp-test\\raw-ipc-outside.txt'

export default {
  async apply(ctx) {
    const { command, host, view, subscriptions } = ctx

    /** 所有证据挂 window —— 面板给人看，`window.__rawProbe` 给 CDP 断言读 */
    const R = (window.__rawProbe = { startedAt: new Date().toISOString(), steps: [] })
    const rec = (k, v) => {
      R.steps.push({ k, v })
      try {
        view.refresh('rawprobe.panel')
      } catch {
        /* 面板可能还没注册好 —— 刷新失败无所谓 */
      }
    }
    const safe = async (k, fn) => {
      try {
        rec(k, await fn())
      } catch (e) {
        rec(k, `ERROR: ${String(e)}`)
      }
    }

    const run = async () => {
      R.steps.length = 0
      R.startedAt = new Date().toISOString()

      const internals = window.__TAURI_INTERNALS__
      rec('① internals.invoke 类型', typeof internals?.invoke)

      // 库路径：优先走内核给的 fs 原语；被裁剪就直接读 localStorage（插件也能读）
      let vault = null
      try {
        vault = ctx.fs.vaultPath()
      } catch {
        vault = localStorage.getItem('zeronote.vault')
      }
      rec('①b 拿到的库路径', vault)

      // ② 不经 fs 原语，直连 IPC 读库内插件列表
      await safe('② 直连 IPC list_plugins', () =>
        internals.invoke('list_plugins', { vault }),
      )

      // ③ 不经 fs 原语，往**库外**写文件（fs 原语会拒绝这种路径）
      await safe('③ 直连 IPC 写库外文件', () =>
        internals.invoke('write_absolute', {
          path: OUTSIDE,
          content: `由插件经裸 IPC 写入（未经 fs 原语）\n时间：${new Date().toISOString()}\n`,
        }),
      )

      // ④ 裸 fetch：manifest 里**没有** net
      await safe('④ 裸 fetch（未声明 net）', async () => {
        const res = await fetch('https://esm.sh/')
        return `HTTP ${res.status}`
      })

      // ⑤ 直接改内核 DOM（状态栏），并**故意不还原**
      await safe('⑤ 改内核 DOM', () => {
        const bar = document.querySelector('.zn-statusbar')
        if (!bar) return '找不到 .zn-statusbar'
        bar.style.backgroundImage =
          'repeating-linear-gradient(45deg,#ef4444,#ef4444 6px,#7f1d1d 6px,#7f1d1d 12px)'
        bar.dataset.rawProbeTouched = '1'
        window.__rawProbeMarker = 'plugin-was-here'
        return '状态栏已改（本插件的 dispose 不还原它）'
      })

      rec('⑤b window 全局标记', window.__rawProbeMarker ?? '(无)')
      rec('⑥ dispose 是否还原 DOM', '否 —— 见 dispose() 注释')
    }

    // 注册一条命令，手动重跑
    subscriptions.push(
      command.register({
        id: 'rawprobe.run',
        title: '探针：跑一遍裸 IPC 测试',
        run: () => {
          void run()
        },
      }),
    )

    subscriptions.push(
      view.registerPanel({
        id: 'rawprobe.panel',
        title: '裸 IPC 探针',
        location: 'sidebar',
        render: () => ({
          type: 'stack',
          gap: 'sm',
          children: [
            { type: 'text', value: '插件绕过原语表 —— 实测', variant: 'caption' },
            {
              type: 'text',
              value: `② list_plugins：${JSON.stringify(
                R.steps.find((s) => s.k.startsWith('②'))?.v ?? '（未跑）',
              ).slice(0, 120)}`,
              variant: 'caption',
            },
            {
              type: 'text',
              value: `③ 写库外：${String(
                R.steps.find((s) => s.k.startsWith('③'))?.v ?? '（未跑）',
              ).slice(0, 120)}`,
              variant: 'caption',
            },
            {
              type: 'text',
              value: `④ 裸 fetch：${String(
                R.steps.find((s) => s.k.startsWith('④'))?.v ?? '（未跑）',
              ).slice(0, 120)}`,
              variant: 'caption',
            },
            { type: 'code', value: JSON.stringify(R.steps, null, 1).slice(0, 900), lang: 'json' },
          ],
        }),
      }),
    )

    host.log('info', '裸 IPC 探针已就绪')
    await run()
  },

  /**
   * **故意不还原**第 ⑤ 步改过的 DOM。
   *
   * 想验证的正是原则 3 的缺口：内核的"卸载即净"只回收**插件经原语登记的资源**
   * （命令 / 面板 / 样式），插件自己伸手改的宿主 DOM 不在账上 ——
   * 除非插件作者自觉在 dispose 里写回去。
   */
  dispose() {},
}
