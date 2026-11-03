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
 * 浮层必须记得同步。
 *
 * **2026-11-03 P4：新增浮层请写 `data-overlay` 属性**，不再往这个选择器里加 class。
 * 旧四类 class 保留兼容（单测仍覆盖），全量迁移后可删。
 */
const BLOCKING_OVERLAY_SELECTOR =
  '[data-overlay], .zn-img-preview, .zn-quick-overlay, .zn-palette-mask, .zn-dialog-backdrop'

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
 * 打开**纯「看」的浮层**（图片预览）时收掉软键盘（rev173.342 · 交接卡「已知未修」）。
 *
 * 为什么需要：手机点正文里的图时，`MarkdownEditor` 的 click 处理器 `preventDefault()`
 * 了默认行为 ⇒ CodeMirror 的 contenteditable **不会自己失焦**，软键盘一直弹着，
 * 于是预览和键盘各占半屏。
 *
 * 用途边界：只给「看」的浮层用 —— 命令面板 / 快速打开 / 搜索这类**要打字**的浮层
 * 不能调用，否则键盘刚收下又要弹起来。桌面没有软键盘，调用方按平台分支
 * （`App.tsx` 里只在 `platform === 'android'` 时走）。
 *
 * @returns 是否真的收了焦点（`true` = 调用前处于输入状态）
 */
export function dismissTypingFocus(doc: Document = document): boolean {
  if (!isTypingNow(doc)) return false
  const el = doc.activeElement as HTMLElement | null
  el?.blur()
  return true
}

/**
 * **右侧「更多」抽屉**的手势判定（rev173.308，rev173.312 去掉边缘限制）。
 *
 * 与左侧文件树抽屉（`swipeIntent`）互补、互不干扰 —— **方向决定抽屉**：
 *  · 右划（dx > 0）⇒ 左边文件树；
 *  · 左划（dx < 0）⇒ 右边「更多」。
 * 两者方向相反，同一次滑动不可能同时命中。
 *
 * 打开状态下反向划关闭 —— 拉出来的那一侧划回去。
 * 浮层开着（看图 / 环形菜单 / 命令面板 / 对话框）时同左抽屉：不归抽屉管。
 *
 * ⚠️ **rev173.312 用户要求「两边都全屏」**：2026-11-01 手机实测，「右划随处能开左侧栏、
 * 左划只有贴右边缘那一小片能开右侧栏」两条规则不对称，用着别扭。现在左划也全屏生效。
 *
 * 代价与底线：
 *  · 正文里左划本来可能被当成选字 / 翻页 —— 60px 门槛 + 「横向明显大于纵向」仍在，
 *    小位移、斜向滑动都不会触发；
 *  · **输入状态下不打开**（`typing`），与左抽屉同一口径（rev170 用户要求打字时别弹抽屉）。
 *
 * 历史：边缘宽度 64px 是 rev173.308 真机实测出来的（32px 时 `input swipe` 从最右 20px
 * 起手会被 Android 全面屏手势判成系统返回、App 直接退出）。**改成全屏后这条不再适用** ——
 * 只有当起手点真落在系统手势区时才可能被抢，而那种情况系统本来就会拦。
 */
export type MoreSwipeAction = 'open' | 'close' | null

export function moreSwipeIntent(
  dx: number,
  dy: number,
  opts: { open: boolean; typing?: boolean; overlay?: boolean },
): MoreSwipeAction {
  if (opts.overlay) return null
  if (Math.abs(dx) < 60 || Math.abs(dx) <= Math.abs(dy)) return null
  if (opts.open) return dx > 0 ? 'close' : null
  // 未打开：右划归左抽屉，不归它管
  if (dx > 0) return null
  // 输入状态下不打开（与左抽屉同口径）
  if (opts.typing) return null
  return 'open'
}

/**
 * **只有首页（时间流卡片页）能用左右滑呼出抽屉**（rev173.317 · 真人测试5 #4）。
 *
 * 用户：「搜索、插件中心这些页面也可以呼起左侧栏和右侧栏，甚至还能先呼出左侧栏然后
 * 再呼出右侧栏叠加，侧栏呼出应该是一个仅限首页可以进行的操作」，并确认「打开笔记的
 * 编辑页也禁止」（按字面：只有卡片页算首页）。
 *
 * 判据用三样东西，都是 App 的顶层 state：
 *  · `mainView === 'editor'` —— 插件中心 / 回收站 / 插件面板页都不是 `editor`；
 *  · `mobilePage === 'home'` —— 搜索全屏页是 `search`；
 *  · `!activePath` —— 打开了笔记就是编辑页，用户要求也禁止。
 *
 * ⚠️ 只影响**打开**方向：抽屉已经开着时，反向划回去必须永远有效（否则关不掉）。
 */
export function drawersOpenOnlyOnHome(
  mainView: string,
  mobilePage: string,
  activePath: string | null,
): boolean {
  return mainView === 'editor' && mobilePage === 'home' && !activePath
}
