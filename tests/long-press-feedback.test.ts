// @vitest-environment happy-dom
/**
 * 长按到点的反馈（rev173.325 · 真人测试6 #3；rev173.331 振动改原生通道）。
 *
 * 判据：
 *  · Android 上走原生命令 `plugin:statusbar|vibrate`（navigator.vibrate 在国产 ROM 上不可靠）；
 *  · 原生失败 / 非 Android ⇒ 静默或回退 `navigator.vibrate`，绝不抛 —— 反馈坏了不能反过来
 *    影响长按功能；
 *  · 涟漪插在按下点、动画（880ms）结束后自删（含 reduce-motion 不派 animationend 的兜底）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }))

const { hapticTick, spawnRipple } = await import('../src/lib/long-press-feedback')

const UA_DESKTOP = navigator.userAgent

function setUA(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}

function setVibrate(fn: unknown) {
  Object.defineProperty(navigator, 'vibrate', { value: fn, configurable: true })
}

afterEach(() => {
  invokeMock.mockReset()
  vi.useRealTimers()
  setUA(UA_DESKTOP)
  delete (navigator as { vibrate?: unknown }).vibrate
  document.body.innerHTML = ''
})

// 模块在 import 时就固定了 `isAndroid`，所以 Android 相关用例要重新 import 一份
async function loadAsAndroid() {
  setUA('Mozilla/5.0 (Linux; Android 16; 24069RA21C) AppleWebKit/537.36')
  vi.resetModules()
  return import('../src/lib/long-press-feedback')
}

describe('hapticTick', () => {
  it('桌面：没有 navigator.vibrate 也不抛（不跨进程调用）', () => {
    setVibrate(undefined)
    hapticTick()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('桌面：支持 navigator.vibrate 时调用一次、时长 12ms', () => {
    const vibrate = vi.fn()
    setVibrate(vibrate)
    hapticTick()
    expect(vibrate).toHaveBeenCalledTimes(1)
    expect(vibrate).toHaveBeenCalledWith(12)
  })

  it('vibrate 抛异常时静默（不能把长按打断）', () => {
    setVibrate(() => {
      throw new Error('nope')
    })
    expect(() => hapticTick()).not.toThrow()
  })

  it('Android：走原生命令，成功后不再碰 navigator.vibrate', async () => {
    invokeMock.mockResolvedValue(undefined)
    const vibrate = vi.fn()
    setVibrate(vibrate)
    const mod = await loadAsAndroid()
    mod.hapticTick()
    expect(invokeMock).toHaveBeenCalledWith('plugin:statusbar|vibrate', { ms: 12 })
    await Promise.resolve()
    expect(vibrate).not.toHaveBeenCalled()
  })

  it('Android：原生命令失败 ⇒ 回退 navigator.vibrate（旧 WebView 也有反馈）', async () => {
    invokeMock.mockRejectedValue(new Error('no plugin'))
    const vibrate = vi.fn()
    setVibrate(vibrate)
    const mod = await loadAsAndroid()
    mod.hapticTick()
    await vi.waitFor(() => expect(vibrate).toHaveBeenCalledWith(12))
  })

  it('Android：invoke 同步抛（非 Tauri 上下文）也回退，不冒出异常', async () => {
    invokeMock.mockImplementation(() => {
      throw new Error('no internals')
    })
    const vibrate = vi.fn()
    setVibrate(vibrate)
    const mod = await loadAsAndroid()
    expect(() => mod.hapticTick()).not.toThrow()
    expect(vibrate).toHaveBeenCalledWith(12)
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
    // animationend 没触发（reduce-motion / 测试环境）⇒ 定时器兜底（880 + 200ms）
    vi.advanceTimersByTime(1100)
    expect(document.querySelector('.zn-longpress-ripple')).toBeNull()
  })

  it('坐标取整（clientX 可能是小数）', () => {
    spawnRipple(10.6, 20.2)
    const el = document.querySelector<HTMLElement>('.zn-longpress-ripple')
    expect(el?.style.left).toBe('11px')
    expect(el?.style.top).toBe('20px')
  })
})
