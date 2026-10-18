/**
 * 移动端抽屉手势的**判定**（纯函数，方便单测）。
 *
 * rev163/164（2026-10-18）：任意位置左→右滑打开侧栏、抽屉打开时右→左滑关闭；
 * 只认「横向位移 ≥60 且明显大于纵向」——避免跟列表纵向滚动打架。
 *
 * rev170（2026-10-18 用户要求「设置成输入状态不生效」）：**输入状态下右划不打开侧栏**。
 * 打字时手指在正文里左右划动很容易被当成「打开侧栏」，一开抽屉就把键盘和光标打断；
 * 所以 `typing` 为真时只禁用「打开」方向，**关闭方向不受影响**（抽屉开着时左滑仍是关）。
 */
export type SwipeAction = 'open' | 'close' | null

export function swipeIntent(
  dx: number,
  dy: number,
  opts: { sidebarOpen: boolean; typing: boolean },
): SwipeAction {
  // 太小或更偏纵向 ⇒ 不是抽屉手势（交给滚动 / 选择文字）
  if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return null
  if (dx > 0) {
    // 右划：抽屉已经开着就不再管；输入状态下**不打开**（2026-10-18 用户要求）
    if (opts.sidebarOpen || opts.typing) return null
    return 'open'
  }
  // 左划：只在抽屉开着时负责关闭
  return opts.sidebarOpen ? 'close' : null
}

/**
 * 当前是否处于**输入状态**（软键盘弹出 / 光标在可编辑元素里）。
 *
 * 判据用焦点而不是键盘高度：Android 各厂商的键盘遮挡行为不一致，
 * 而「正在输入」在本应用里等价于焦点在 `input` / `textarea` / `contentEditable`
 * （CM6 正文的 `contentDOM` 就是 contentEditable）。
 */
export function isTypingNow(doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}
