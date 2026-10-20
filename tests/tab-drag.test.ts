/**
 * 标签拖拽判定（rev173.52 · 拖出独立 / 拖入放回）。
 *
 * 三个边界都要锁死：手抖不能拆窗口（阈值）、按下去不能立刻算越界（顶部不算）、
 * 贴着边界要能算越界（CDP 验收只能把指针送到窗口内）。
 */
import { describe, expect, it } from 'vitest'
import { DRAG_EDGE_MARGIN, DRAG_START_PX, dragStarted, isOutsideWindow } from '../src/lib/tab-drag'

describe('dragStarted', () => {
  it('位移不到阈值 ⇒ 不是拖拽（点击）', () => {
    expect(dragStarted({ x: 10, y: 10 }, { x: 10 + DRAG_START_PX - 1, y: 10 })).toBe(false)
  })

  it('任一方向达到阈值 ⇒ 拖拽', () => {
    expect(dragStarted({ x: 10, y: 10 }, { x: 10, y: 10 + DRAG_START_PX })).toBe(true)
    expect(dragStarted({ x: 10, y: 10 }, { x: 10 - DRAG_START_PX, y: 10 })).toBe(true)
  })
})

describe('isOutsideWindow', () => {
  const W = 1100
  const H = 720

  it('窗口正中：不算越界', () => {
    expect(isOutsideWindow(500, 300, W, H)).toBe(false)
  })

  it('右侧贴边热区 ⇒ 越界（CDP 靠它验收）', () => {
    // 热区 = 距边界 margin 以内：x 必须**大于** width - margin
    expect(isOutsideWindow(W - DRAG_EDGE_MARGIN + 1, 300, W, H)).toBe(true)
    expect(isOutsideWindow(W - DRAG_EDGE_MARGIN - 1, 300, W, H)).toBe(false)
  })

  it('右下方真的越界 ⇒ 越界', () => {
    expect(isOutsideWindow(W + 40, H + 40, W, H)).toBe(true)
  })

  it('顶部贴着标签条 ⇒ **不算**越界（标签本来就在最上面，误判会让每次点击都拆窗口）', () => {
    expect(isOutsideWindow(200, DRAG_EDGE_MARGIN, W, H)).toBe(false)
    expect(isOutsideWindow(200, 30, W, H)).toBe(false)
  })

  it('甩到窗口上方（y 为负）或左侧（x 为负）⇒ 越界', () => {
    expect(isOutsideWindow(200, -10, W, H)).toBe(true)
    expect(isOutsideWindow(-10, 200, W, H)).toBe(true)
  })
})
