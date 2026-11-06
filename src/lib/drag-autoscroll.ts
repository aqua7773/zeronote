/**
 * 拖拽到滚动容器边缘时的自动滚动（rev173.403）。
 *
 * 用户 2026-11-06：「长按拖动，从底部拖到顶部，不会自动上滑，导致文件树长或者根目录
 * 文件多的时候无法往上移」。文件树是 `overflow:auto` 的滚动容器（`.zn-tree`），
 * 拖拽期间指针贴边不动时不会产生 pointermove / touchmove ⇒ 容器不滚，
 * 没露出来的行永远拖不到。
 *
 * 判据收成**一份纯函数**，鼠标 `pointermove` 链与手机 `touchmove` 链共用
 * （AGENTS §8.8 / 方案 §9.7 风险 4：两条拖拽链各写一份，改一条漏另一条）。
 *
 * 参数取自常见实现：感应带 ≈ 48px（Blink 的 autoscroll 边缘区同为十几像素量级，
 * 移动端手指粗，取大一点）；速度随「离边缘的距离」线性增长，最贴边 12px/帧
 * （60Hz ≈ 720px/s）。**指针在容器外不滚** —— 拖出侧栏是「取消」，不该继续滚。
 */
export type EdgeScrollInput = {
  /** 指针的 clientY */
  y: number
  /** 滚动容器在视口里的上边（getBoundingClientRect().top） */
  top: number
  /** 滚动容器在视口里的下边 */
  bottom: number
  /** 感应带宽度（px）；默认 `EDGE_SCROLL_PX` */
  edge?: number
  /** 最贴边时每帧滚动量（px）；默认 `EDGE_SCROLL_MAX_STEP` */
  maxStep?: number
}

export const EDGE_SCROLL_PX = 48
export const EDGE_SCROLL_MAX_STEP = 12

/**
 * 这一帧该滚多少像素：**负数 = 向上**，正数 = 向下，0 = 不动。
 *
 * - 指针在容器外 ⇒ 0（拖出侧栏 = 取消，不继续滚）；
 * - 贴顶 `edge` 以内 ⇒ 负值，越贴边越快（最贴边 = `maxStep`）；
 * - 贴底 `edge` 以内 ⇒ 正值，同样越贴边越快；
 * - 容器太矮（高度 < 3×edge）时感应带按高度 1/3 收窄，免得整屏都在滚。
 */
export function edgeScrollStep({
  y,
  top,
  bottom,
  edge = EDGE_SCROLL_PX,
  maxStep = EDGE_SCROLL_MAX_STEP,
}: EdgeScrollInput): number {
  if (!Number.isFinite(y) || !Number.isFinite(top) || !Number.isFinite(bottom)) return 0
  if (bottom <= top) return 0
  if (y < top || y > bottom) return 0
  const band = Math.min(edge, Math.max(1, (bottom - top) / 3))
  if (y < top + band) {
    // 0（刚进感应带）→ 1（贴边）；`-0` 与 `0` 是不同值（Object.is），这里统一成 0
    const v = Math.ceil(maxStep * Math.min(1, Math.max(0, (top + band - y) / band)))
    return v === 0 ? 0 : -v
  }
  if (y > bottom - band) {
    const t = (y - (bottom - band)) / band
    return Math.ceil(maxStep * Math.min(1, Math.max(0, t)))
  }
  return 0
}
