/**
 * 拖拽贴边自动滚动（rev173.403 · 用户「长按拖动从底部拖到顶部不会自动上滑」）。
 *
 * 纯函数判据 —— 鼠标 pointer 链与手机 touch 链共用这一份（AGENTS §8.8）。
 */
import { describe, expect, it } from 'vitest'
import { EDGE_SCROLL_MAX_STEP, edgeScrollStep } from '../src/lib/drag-autoscroll'

const box = { top: 100, bottom: 600 }

describe('edgeScrollStep', () => {
  it('容器中部 ⇒ 不滚', () => {
    expect(edgeScrollStep({ ...box, y: 350 })).toBe(0)
  })

  it('贴顶 ⇒ 向上滚，且越贴边越快', () => {
    const near = edgeScrollStep({ ...box, y: 104 })
    const mid = edgeScrollStep({ ...box, y: 130 })
    const edgeOfBand = edgeScrollStep({ ...box, y: 147 })
    expect(near).toBeLessThan(0)
    expect(Math.abs(near)).toBeGreaterThan(Math.abs(mid))
    expect(Math.abs(mid)).toBeGreaterThan(0)
    // 感应带外沿附近速度趋近 0（不进感应带就是 0）
    expect(Math.abs(edgeOfBand)).toBeLessThanOrEqual(1)
    expect(edgeScrollStep({ ...box, y: 100 })).toBe(-EDGE_SCROLL_MAX_STEP)
  })

  it('贴底 ⇒ 向下滚，最贴边 = maxStep', () => {
    expect(edgeScrollStep({ ...box, y: 598 })).toBe(EDGE_SCROLL_MAX_STEP)
    expect(edgeScrollStep({ ...box, y: 560 })).toBeGreaterThan(0)
    expect(edgeScrollStep({ ...box, y: 560 })).toBeLessThan(EDGE_SCROLL_MAX_STEP)
  })

  it('指针在容器外 ⇒ 不滚（拖出侧栏 = 取消，不该继续滚）', () => {
    expect(edgeScrollStep({ ...box, y: 40 })).toBe(0)
    expect(edgeScrollStep({ ...box, y: 700 })).toBe(0)
  })

  it('矮容器：感应带按高度 1/3 收窄，中间仍有不滚的区域', () => {
    const small = { top: 0, bottom: 60 }
    expect(edgeScrollStep({ ...small, y: 30 })).toBe(0)
    expect(edgeScrollStep({ ...small, y: 1 })).toBeLessThan(0)
    expect(edgeScrollStep({ ...small, y: 59 })).toBeGreaterThan(0)
  })

  it('退化输入（容器高度 0 / NaN）⇒ 0，不抛错', () => {
    expect(edgeScrollStep({ top: 5, bottom: 5, y: 5 })).toBe(0)
    expect(edgeScrollStep({ top: 0, bottom: 100, y: Number.NaN })).toBe(0)
  })

  it('自定义 maxStep 生效', () => {
    expect(edgeScrollStep({ ...box, y: 100, maxStep: 30 })).toBe(-30)
  })
})
