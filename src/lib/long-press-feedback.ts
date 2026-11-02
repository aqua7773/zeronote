/**
 * 长按到达阈值时的**触觉 + 视觉反馈**（rev173.325 · 真人测试6 #3）。
 *
 * 用户原话：「长按释放后触发菜单不够直观，用户不知道什么时候按多久可以释放，
 * 给长按到达时间后加振动反馈，然后点按处添加一个水波涟漪的效果反馈。」
 *
 * 两个动作都**只做反馈、不改变任何手势判定**：
 *  · `hapticTick()` —— Android WebView 的 `navigator.vibrate`（需要
 *    `android.permission.VIBRATE`，普通权限、安装即授予；桌面 / 不支持的环境静默跳过）；
 *  · `spawnRipple(x, y)` —— 在按下点画一圈扩散的水波，动画结束自删。
 *
 * 为什么放在 `lib/`：五个长按入口（文件行 / 卡片 / ＋ / ☰ / 编辑区四键条）共用，
 * 单测可以直接测「不支持 vibrate 时不抛」与「ripple 用完会被移除」。
 */

/** 振动时长（ms）：只求"到点了"的轻提示，别做成通知级震动 */
const VIBRATE_MS = 12

/** 涟漪动画时长（ms）—— 与 styles.css 的 `zn-longpress-ripple` 保持一致 */
const RIPPLE_MS = 620

/** 到点轻震一下；不支持 / 被策略拒绝时静默（反馈不能反过来阻断功能） */
export function hapticTick(): void {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(VIBRATE_MS)
    }
  } catch {
    /* 静默：某些 WebView 在无用户手势时会抛 */
  }
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
