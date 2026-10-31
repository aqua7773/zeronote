/**
 * 移动端抽屉手势的**判定**（纯函数，方便单测）。
 *
 * rev163/164（2026-10-18）：任意位置左→右滑打开侧栏、抽屉打开时右→左滑关闭；
 * 只认「横向位移 ≥60 且明显大于纵向」——避免跟列表纵向滚动打架。
 *
 * rev170（2026-10-18 用户要求「设置成输入状态不生效」）：**输入状态下右划不打开侧栏**。
 * 打字时手指在正文里左右划动很容易被当成「打开侧栏」，一开抽屉就把键盘和光标打断；
 * 所以 `typing` 为真时只禁用「打开」方向，**关闭方向不受影响**（抽屉开着时左滑仍是关）。
 *
 * rev173.303（2026-10-31 第三次真人测试 #2 #3）：**浮层开着时两个方向都不响应**。
 * 用户原话「附件的照片打开的时候没有屏蔽左右滑动的操作，就是在看照片的时候可以通过左右
 * 滑动打开收起左侧栏」「这个遮罩也是，建议检查一下其他的遮罩」—— 看图 / 环形菜单 /
 * 命令面板这些遮罩上，左右滑动只该交给遮罩自己（关闭、翻页），不该去开关抽屉。
 */
export type SwipeAction = 'open' | 'close' | null

/**
 * 有「会吃掉滑动手势」的浮层开着吗（rev173.303）。
 *
 * 用 DOM 查而不是问 React state：图片预览的状态在 `MarkdownEditor` 内部、环形菜单
 * 与命令面板各有自己的 state —— 逐个提升到 App 会把一件事拆到四处，而且以后新增
 * 浮层必须记得同步。**新增遮罩时记得把 class 加进这个选择器**（单测会兜住已知的四类）。
 */
const BLOCKING_OVERLAY_SELECTOR =
  '.zn-img-preview, .zn-quick-overlay, .zn-palette-mask, .zn-dialog-backdrop'

export function hasBlockingOverlay(doc: Document = document): boolean {
  return !!doc.querySelector(BLOCKING_OVERLAY_SELECTOR)
}

export function swipeIntent(
  dx: number,
  dy: number,
  opts: { sidebarOpen: boolean; typing: boolean; overlay?: boolean },
): SwipeAction {
  // 浮层开着 ⇒ 两个方向都不归抽屉管（rev173.303）
  if (opts.overlay) return null
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
