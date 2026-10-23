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
