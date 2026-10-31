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

/**
 * **右侧「更多」抽屉**的手势判定（rev173.308 · 用户 2026-10-31「更多改成右滑出现的右侧栏」）。
 *
 * 与左侧文件树抽屉（`swipeIntent`）互补、互不干扰：
 *  · 左抽屉 —— **任意位置右划**打开（dx > 0），与旧行为完全一致；
 *  · 右抽屉 —— **屏幕右边缘起手 + 左划**打开（dx < 0 且 startX 贴右边）。
 * 两者方向相反、起点不同，同一次滑动不可能同时命中。
 *
 * 打开状态下右划关闭 —— 与左抽屉对称（拉出来的那一侧划回去）。
 * 浮层开着（看图 / 环形菜单 / 命令面板 / 对话框）时同左抽屉：不归抽屉管。
 *
 * ⚠️ **边缘宽度 64 不是随便定的**（rev173.308 真机实测 · 24069RA21C · Android 手势导航）：
 * 最初写 32，`adb shell input swipe` 从屏幕最右边 20px 起手时 —— **App 直接被退掉了**，
 * 因为 Android 全面屏手势把「右边缘内滑」判成了**系统返回**，我们的监听根本收不到。
 * 改成距右边缘 64px 起手后同一条 swipe 不再被系统抢（App 存活、logcat 无返回）。
 * 32→64 的代价只是「必须从靠右一点的地方起手」，换来的是这套手势在真机上真的能用。
 */
export const MORE_DRAWER_EDGE_PX = 64

export type MoreSwipeAction = 'open' | 'close' | null

export function moreSwipeIntent(
  dx: number,
  dy: number,
  opts: { startX: number; viewportWidth: number; open: boolean; overlay?: boolean },
): MoreSwipeAction {
  if (opts.overlay) return null
  if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return null
  if (opts.open) return dx > 0 ? 'close' : null
  // 未打开：只认右边缘起手的左划（在正文中间左划是选择文字 / 翻页，不该开抽屉）
  if (dx > 0) return null
  const fromRightEdge = opts.startX >= opts.viewportWidth - MORE_DRAWER_EDGE_PX
  return fromRightEdge ? 'open' : null
}
