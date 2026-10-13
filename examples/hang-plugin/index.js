/**
 * 卡死探针 —— **故意**占死 JS 主线程。
 *
 * 用途（`docs/卡死兜底方案-2026-10-13.md` §6/§7）：
 *   ① 主线程被占死时，前端心跳**确实停** ⇒ Rust 看门狗判超时
 *   ② 从 Rust 的**独立线程** `std::process::exit(101)` 真能终止进程
 *   ③ 卡死前写的 `localStorage` 标记，重启后**读得到**（启动自愈的前提）
 *
 * ⚠️ **装上就会卡死应用** —— 按需挂 junction，验完立刻摘掉，别常驻测试库。
 *
 * 两种卡法（改 `MODE`）：
 *   `'hang'` —— `for(;;){}` 永不返回（真实卡死的样子）
 *   `'slow'` —— 阻塞 8 秒后正常返回（用来验"长任务不该被误杀"）
 */
const MODE = 'hang'

/** @type {import('../../src/kernel/contract').Plugin} */
export default {
  apply() {
    // ③ 先同步写标记：`localStorage` 是同步 API ⇒ 循环开始前它必然已落盘
    try {
      localStorage.setItem(
        'zn.hangprobe',
        JSON.stringify({ id: 'hang-plugin', mode: MODE, t: Date.now() }),
      )
    } catch {
      /* 写不进去也不影响"卡死"这个主目的 */
    }

    if (MODE === 'slow') {
      const until = Date.now() + 8000
      while (Date.now() < until) {
        /* 阻塞 8 秒：正常的长任务，看门狗不该杀 */
      }
      return
    }

    // ①② 死循环：主线程从此不再执行任何 JS（包括每秒一次的心跳）
    for (;;) {
      /* hang */
    }
  },

  dispose() {},
}
