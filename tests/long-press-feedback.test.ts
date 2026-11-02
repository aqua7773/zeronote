// @vitest-environment happy-dom
/**
 * 长按到点的反馈（rev173.325 · 真人测试6 #3）。
 *
 * 判据：
 *  · 有 `navigator.vibrate` 就振一次、且只振**短**（12ms）；
 *  · 没有 / 抛异常 ⇒ 静默 —— 反馈坏了不能反过来影响长按功能；
 *  · 涟漪插在按下点、动画结束后自删（含 reduce-motion 不派 animationend 的兜底）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hapticTick, spawnRipple } from '../src/lib/long-press-feedback'

afterEach(() => {
  vi.useRealTimers()
  delete (navigator as { vibrate?: unknown }).vibrate
  document.body.innerHTML = ''
})

describe('hapticTick', () => {
  it('有 navigator.vibrate 时调用一次、时长 12ms', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true })
    hapticTick()
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(12)
  })

  it('没有 vibrate（桌面 / 老 WebView）不抛', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true })
    expect(() => hapticTick()).not.toThrow()
  })

  it('vibrate 抛异常时静默（不能把长按打断）', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: () => {
        throw new Error('nope')
      },
      configurable: true,
    })
    expect(() => hapticTick()).not.toThrow()
  })
})

describe('spawnRipple', () => {
  it('在按下点插入涟漪，兜底定时器到点后移除', () => {
    vi.useFakeTimers()
    spawnRipple(120, 240)
    const el = document.querySelector<HTMLElement>('.zn-longpress-ripple')
    expect(el).toBeTruthy()
    expect(el?.style.left).toBe('120px')
    expect(el?.style.top).toBe('240px')
    // animationend 没触发（reduce-motion / 测试环境）⇒ 定时器兜底
    vi.advanceTimersByTime(900)
    expect(document.querySelector('.zn-longpress-ripple')).toBeNull()
  })

  it('坐标取整（clientX 可能是小数）', () => {
    spawnRipple(10.6, 20.2)
    const el = document.querySelector<HTMLElement>('.zn-longpress-ripple')
    expect(el?.style.left).toBe('11px')
    expect(el?.style.top).toBe('20px')
  })
})
