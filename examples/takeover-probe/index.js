/**
 * 接管协议验收夹具（2026-10-13 rev49）—— **是 `tools/verify-takeover.mjs` 的配套输入，
 * 每次跑验收都要它**（与 `raw-ipc-probe` 一样保留作可复跑证据，别顺手删）。
 *
 * 一个插件只做五件事，每件事对应接管协议的一条规矩：
 *
 * | # | 做什么 | 考什么 |
 * |---|---|---|
 * | ① | `command.register` 一条自己的命令 | 卸载后**命令表**回到基线（可观测的差异项） |
 * | ② | `command.bind('core.newNote', …)` **接管内核命令** | 卸载后**还原到内核实现**，而不是"没有实现" |
 * | ③ | `event.on('note:saved', …)` | 卸载后**订阅表**回到基线 |
 * | ④ | 改宿主 DOM（状态栏条纹）＋ `host.onRollback(还原)` | **登记过** ⇒ 内核负责还原 |
 * | ⑤ | 改宿主 DOM（body 属性）**不登记** | 没登记 ⇒ 内核不管（残留是**预期**，证明边界诚实） |
 *
 * ⚠️ ②③ **故意不接返回值**（不 push 进 `subscriptions`）：
 * 这正是本轮要证明的事 —— 「宿主有能力兜住的事，不该留给插件作者去记」。
 * 老实现下它俩会残留（命令被换掉后卸不掉、回调挂在总线上等下一次事件才炸）。
 *
 * 诊断出口 `window.__takeoverProbe`（`{ loaded, log }`）给 CDP 轮询与断言用。
 */
const STRIPE = 'repeating-linear-gradient(45deg, rgb(239,68,68) 0 12px, rgb(127,29,29) 12px 24px)'

export default {
  apply(api) {
    const log = []
    const mark = (step) => log.push(`${new Date().toISOString()} ${step}`)
    window.__takeoverProbe = { loaded: true, log }

    // ① 命令表差异项：这条命令在插件卸载后必须消失
    api.command.register({
      id: 'takeover-probe.ping',
      title: '接管探针：打个招呼',
      run: () => {
        api.host.notify('接管探针还在 —— 说明插件没卸干净')
      },
    })
    mark('registered takeover-probe.ping')

    // ② 接管内核命令（不真建笔记，避免污染测试库）
    api.command.bind('core.newNote', () => {
      api.host.notify('接管探针：core.newNote 现在由插件实现（没有真的建笔记）')
      return 'taken-over'
    })
    mark('bound core.newNote')

    // ③ 订阅内核事件（回调故意留空，只为让订阅表可观测）
    api.event.on('note:saved', () => {})
    mark('subscribed note:saved')

    // ④ 自改宿主 DOM —— **登记还原**：内核在卸载时替你调它
    const bar = document.querySelector('.zn-statusbar')
    if (bar) {
      const prev = bar.style.backgroundImage
      api.host.onRollback(() => {
        bar.style.backgroundImage = prev
      })
      bar.style.backgroundImage = STRIPE
      mark('painted statusbar（已登记 onRollback）')
    } else {
      mark('注意：没找到 .zn-statusbar，④ 这步没做')
    }

    // ⑤ 自改宿主 DOM —— **不登记**，且 `dispose()` 里也不清理：
    //    "没登记的自己负责"——这份夹具就是故意不负责的反例，用来验证内核确实不替它擦。
    document.body.dataset.znProbeUnregistered = '1'
    mark('set body[data-zn-probe-unregistered]（未登记）')
  },

  dispose() {
    if (window.__takeoverProbe) window.__takeoverProbe.loaded = false
  },
}
