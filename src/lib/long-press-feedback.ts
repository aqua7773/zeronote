/**
 * 长按到达阈值时的**触觉 + 视觉反馈**（rev173.325 · 真人测试6 #3；rev173.331 改振动通道）。
 *
 * 用户原话（真人测试6）：「长按释放后触发菜单不够直观，用户不知道什么时候按多久可以释放，
 * 给长按到达时间后加振动反馈，然后点按处添加一个水波涟漪的效果反馈。」
 * 用户原话（真人测试7 #1）：「长按的涟漪不够明显，而且好像也是松手触发（没什么意义），
 * 也没有振动效果，反馈的目的就是提醒什么时候可以松手」。
 *
 * 两个动作都**只做反馈、不改变任何手势判定**（五个入口都在 500ms 定时器里调它，
 * 松手才弹菜单）：
 *  · `hapticTick()` —— Android 走**原生命令** `plugin:statusbar|vibrate` → Kotlin `Vibrator`；
 *    桌面 / 原生失败时回退 `navigator.vibrate`（**为什么不用它打头**：多数国产 ROM 的
 *    WebView 把 `navigator.vibrate` 静默忽略，真人测试7 的「没有振动效果」就是这么来的）；
 *  · `spawnRipple(x, y)` —— 在按下点画一圈扩散的水波，动画结束自删。
 *
 * 为什么放在 `lib/`：五个长按入口（文件行 / 卡片 / ＋ / ☰ / 编辑区四键条）共用，
 * 单测可以直接测「不支持时静默」与「ripple 用完会被移除」。
 */
import { invoke } from '@tauri-apps/api/core'

/** 振动时长（ms）：只求"到点了可以松手"的轻提示，别做成通知级震动 */
const VIBRATE_MS = 12

/** 涟漪动画时长（ms）—— 与 styles.css 的 `--zn-dur-ripple` / `zn-longpress-ripple` 保持一致 */
const RIPPLE_MS = 880

/** Android UA 判断（桌面 / 浏览器没有 Vibrator 服务，不必跨进程调一次） */
const isAndroid =
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** Web 兜底通道：支持就用，不支持 / 抛异常一律静默（反馈不能反过来阻断功能） */
function vibrateWeb(ms: number): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(ms)
    }
  } catch {
    /* 静默：某些 WebView 在无用户手势时会抛 */
  }
}

/** 到点轻震一下；任何环境出错都静默 */
export function hapticTick(): void {
  if (isAndroid) {
    try {
      void invoke('plugin:statusbar|vibrate', { ms: VIBRATE_MS }).catch(() => vibrateWeb(VIBRATE_MS))
      return
    } catch {
      // invoke 在非 Tauri 上下文里可能**同步**抛（`__TAURI_INTERNALS__` 不存在）
    }
  }
  vibrateWeb(VIBRATE_MS)
}

/**
 * 在屏幕坐标 `(x, y)` 处生成一圈涟漪，`RIPPLE_MS` 后自动移除。
 *
 * 用 `position: fixed` + 屏幕坐标：调用方传的都是 `clientX/clientY`，
 * 与页面滚动无关。重复调用不节流 —— 长按每 500ms 才到点一次，不会堆积。
 */
export function spawnRipple(x: number, y: number): void {
  if (typeof document === 'undefined') return
  const el = document.createElement('span')
  el.className = 'zn-longpress-ripple'
  el.style.left = `${Math.round(x)}px`
  el.style.top = `${Math.round(y)}px`
  const done = () => el.remove()
  el.addEventListener('animationend', done, { once: true })
  // 兜底：reduce-motion 会把动画压到 1ms（有可能不派发 animationend），或页面被切走
  window.setTimeout(done, RIPPLE_MS + 200)
  document.body.appendChild(el)
}
