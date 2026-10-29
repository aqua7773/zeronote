/**
 * **白屏兜底：窗口心跳 + 主窗口清扫**（rev173.104 · 已知隐患收口）。
 *
 * 问题（rev173.84 实测）：插件窗口 / 笔记窗口都是 `decorations: false`，关闭按钮**画在页面里**
 * （`App.tsx` 的 `.zn-plugin-window-bar`）。页面一旦整页挂掉（JS 全挂 / 白屏 / HMR 失败），
 * 标题条跟着消失 ⇒ **屏幕上没有任何关闭入口**，用户只能去任务管理器
 * （实测 `plugin-doc-reader-view-1` 因此卡死过）。
 *
 * 为什么不做「窗口加系统装饰」：自绘标题条是需求（与主窗口一致的三键），加了系统栏就变样。
 * 为什么不做「Rust 侧全局快捷键」：`tauri-plugin-global-shortcut` 是**全局**的（抢别的应用的键），
 * 为兜底付出的代价太大。
 *
 * 采用方案：**窗口 → 主窗口心跳**（`emitTo('main', …)`），主窗口定期扫窗口列表：
 *   · 心跳断（页面 JS 停了 / 页面被换掉）⇒ 超过 `STALE_MS` 判定卡死
 *   · 心跳说「我的 DOM 没了」（React 整棵树被清空 / 渲染崩了）⇒ 连续 `BAD_STREAK` 次判定白屏
 *   · 从没发过心跳（页面根本没加载起来）⇒ 过了 `GRACE_MS` 宽限期判定卡死
 * 判定后由主窗口 `destroy()` 掉 —— 这条通道**不依赖那个窗口里的任何 JS**，页面全挂也能生效。
 *
 * 为什么窗口端用**接收时间**而不是心跳里带的时间戳：主窗口如果自己卡住，心跳处理会一起排队；
 * 用发送时间会把它自己的卡顿算到窗口头上（误杀完好窗口）。接收时间 + 主窗口单线程 ⇒ 天然安全。
 */

/** 窗口 → 主窗口的心跳事件名 */
export const WINDOW_BEAT_EVENT = 'zn:window-beat'
/** 窗口端发送间隔 */
export const BEAT_MS = 3000
/** 多久没收到心跳判定卡死（≈ 4 个间隔，给一次丢包 + 紧一点的余量） */
export const STALE_MS = 12000
/** 新窗口宽限期：WebView 冷启动 + 页面首帧 + 首次心跳 */
export const GRACE_MS = 20000
/** 主窗口扫描间隔 */
export const SCAN_MS = 5000
/** 连续几次「我白屏」才动手（瞬时 DOM 重建不算） */
export const BAD_STREAK = 3

/** 参与守护的窗口 label 前缀 —— 主窗口自己（`main`）不在其中 */
export const GUARDED_PREFIXES = ['plugin-', 'note-'] as const

export interface WindowBeat {
  /** 主窗口**收到**这次心跳的时间（见文件头：不用发送时间） */
  recvAt: number
  /** 窗口自检「我的页面还在」 */
  ok: boolean
  /** 连续多少次说白屏 */
  badStreak: number
}

export function isGuardedWindow(label: string): boolean {
  return GUARDED_PREFIXES.some((p) => String(label ?? '').startsWith(p))
}

/** 记录一次心跳 → 返回新表（不修改入参，方便单测与 React 状态） */
export function applyBeat(
  beats: Record<string, WindowBeat>,
  label: string,
  ok: boolean,
  now: number,
): Record<string, WindowBeat> {
  const prev = beats[label]
  const badStreak = ok ? 0 : (prev?.badStreak ?? 0) + 1
  return { ...beats, [label]: { recvAt: now, ok, badStreak } }
}

/**
 * 判定这一轮**该关掉**哪些窗口。
 *
 * @param labels    当前存活的窗口 label（`getAllWebviewWindows()`）
 * @param beats     心跳表
 * @param firstSeen 主窗口首次看到某 label 的时间（宽限期起点；新窗口进列表时记 now）
 * @param now       当前时间
 */
export function pickStuckWindows(
  labels: string[],
  beats: Record<string, WindowBeat>,
  firstSeen: Record<string, number>,
  now: number,
): string[] {
  const stuck: string[] = []
  for (const label of labels) {
    if (!isGuardedWindow(label)) continue
    const seen = firstSeen[label]
    // 刚出现（或在宽限期内）⇒ 还在加载，不动
    if (seen != null && now - seen < GRACE_MS) continue
    const beat = beats[label]
    if (!beat) {
      // 从没心跳，且过了宽限 ⇒ 页面根本没起来
      if (seen != null) stuck.push(label)
      continue
    }
    if (now - beat.recvAt > STALE_MS) {
      // 心跳断了：页面 JS 停了（死循环 / 崩了 / 被换成了别的页面）
      stuck.push(label)
      continue
    }
    if (beat.badStreak >= BAD_STREAK) {
      // 心跳还在，但它自己报告 DOM 没了（白屏）
      stuck.push(label)
    }
  }
  return stuck
}

/**
 * 窗口端的自检：页面**看起来还在**吗？
 *
 * 三条判据（rev173.104 实测修订）：
 *   · 窗口根节点（`.zn-plugin-window` / `.zn-note-window`）在；
 *   · 根节点**可见**（rect 宽高 > 0 —— `display:none` / 零尺寸就是白屏）；
 *   · 根节点里有子元素（React 树被清空 = 只剩空壳）。
 *
 * ⚠️ **不能看 body 高度**：html/body 默认 100%，即便根节点被隐藏，`body.getBoundingClientRect()`
 * 仍然是窗口高度（实测 640）⇒ 那条判据永远为真，等于没检查。
 *
 * 不检查具体控件：面板加载失败（插件抛错）是另一种状态，主区 / 窗口里都有错误态，
 * 不该因为「面板没画出来」就把窗口杀掉。
 */
export function domLooksAlive(doc: Document | null | undefined): boolean {
  if (!doc) return false
  const root = doc.querySelector('.zn-plugin-window, .zn-note-window') as HTMLElement | null
  if (!root) return false
  const rect = root.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return root.childElementCount > 0
}

/* ───────── 主窗口自救（rev173.247）─────────
 *
 * rev173.104 的守护只覆盖**子窗口**（`plugin-` / `note-`）：主窗口根节点不在判据里，
 * 而 Rust 看门狗（`卡死兜底方案` §2.1）判的是**心跳有没有到** —— 「DOM 没了但 JS 还活着」
 * 这种白屏心跳照发，两条通道都够不着。
 *
 * 这里的补法：主窗口自己每几秒自检一次，连续 `MAIN_BAD_STREAK` 次判定「页面没了」
 * 就 `location.reload()` —— **整个页面重跑一遍**。
 *
 * 三个必守的约束：
 *  1. **只自救一次**（`sessionStorage` 记）：白屏原因没解决时 reload 会原地循环，
 *     那比白屏还糟（用户连菜单都点不到，每次刚起来又刷回去）。第二次起放手不管。
 *  2. **阈值保守**：3 次 × 5 s = 15 秒才动手 —— 瞬时 DOM 重建（HMR / 切库重排）不算。
 *  3. **reload 前的内容靠 `beforeunload` 兜**：`useDocIO` 已在那条事件上把未落盘内容写进
 *     草稿（`rev173.65`），reload 后走「恢复草稿」。唯一例外是私密笔记（明文不进 localStorage），
 *     那种情况下 800 ms 自动保存已覆盖绝大多数情形 —— 这条代价如实写在文档 §11。
 */

/** 主窗口根节点（`#root` 下那一层就是它；白屏 = 它不在 / 零尺寸 / 没有子元素） */
export const MAIN_ROOT_SELECTOR = '.zn-app'

/** 主窗口自检间隔（与子窗口扫描同一节奏，便于理解） */
export const MAIN_CHECK_MS = 5000

/** 连续几次「页面没了」才 reload（3 × 5 s = 15 s） */
export const MAIN_BAD_STREAK = 3

/** sessionStorage：这次启动已经自救过一次（防死循环） */
export const MAIN_RESCUE_FLAG = 'zn.main-rescue-done'

/** 主窗口的「页面看起来还在吗」—— 判据与子窗口同一套，只是换根节点 */
export function mainDomLooksAlive(doc: Document | null | undefined): boolean {
  if (!doc) return false
  const root = doc.querySelector(MAIN_ROOT_SELECTOR) as HTMLElement | null
  if (!root) return false
  const rect = root.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  return root.childElementCount > 0
}

/**
 * 这一轮该不该 reload 主窗口（纯函数；`streak` 是**本次之前**已连续的次数）。
 *
 * 三条：这次启动没自救过（`alreadyRescued` 为假）· 这一轮判定白屏 · 累计到阈值。
 */
export function shouldRescueMain(ok: boolean, streak: number, alreadyRescued: boolean): boolean {
  if (alreadyRescued) return false
  if (ok) return false
  return streak + 1 >= MAIN_BAD_STREAK
}
