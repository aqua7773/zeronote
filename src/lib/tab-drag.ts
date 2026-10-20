/**
 * 标签拖拽的**纯逻辑**（rev173.52 · 用户「做拖出独立，和拖入放回」）。
 *
 * 只有两件事需要判定，都不碰 DOM：
 *  · 这次按压到底是「点击」还是「拖拽」（位移阈值）；
 *  · 拖到哪儿算「甩出了窗口」—— 主窗口里 = 拆成独立窗口，独立窗口里 = 收回主窗口。
 *
 * 为什么用「越界」而不是跟另一个窗口的矩形求交：跨 webview 拿不到对方的屏幕矩形
 * 也要多一串窗口权限；而两个方向的动作本来就相反、各自只有唯一归宿 ——
 * 本窗口内拖出去就是「交给另一个容器」，不需要知道它在屏幕哪。
 */

export type DragPoint = { x: number; y: number }

/** 位移超过这么多像素才算拖拽（低于它按点击处理，不能因为手抖把标签拆出去） */
export const DRAG_START_PX = 8

/**
 * 边缘热区（像素）。
 *
 * 指针真的离开窗口后，WebView 未必还派发事件 —— 所以**贴着边界**也算越界。
 * 这也让 CDP 验收成了可能：脚本没法把指针送到窗口外，但可以送到 `width - 2`。
 */
export const DRAG_EDGE_MARGIN = 6

/** 从按下到当前，位移是否已够格叫拖拽 */
export function dragStarted(from: DragPoint, to: DragPoint, min = DRAG_START_PX): boolean {
  return Math.abs(to.x - from.x) >= min || Math.abs(to.y - from.y) >= min
}

/**
 * 指针是否已经越出窗口（或贴边到热区里）。
 *
 * ⚠️ **顶部不算**：标签条本身就在窗口最上面，把 `y < margin` 也当越界的话，
 * 按下去的瞬间就会被判成「拖出去」（第一版就是这里会误触发）。
 * 记的是 `y < 0`（真的甩到窗口上面去了）与下 / 左 / 右三条边的热区。
 */
export function isOutsideWindow(
  x: number,
  y: number,
  width: number,
  height: number,
  margin = DRAG_EDGE_MARGIN,
): boolean {
  return x < 0 || y < 0 || x > width - margin || y > height - margin
}
