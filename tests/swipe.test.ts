// @vitest-environment happy-dom
/**
 * 移动端抽屉手势判定（rev170 · 2026-10-18 用户要求「设置成输入状态不生效」）。
 *
 * 判据：
 *  · 右划且位移足够 ⇒ 打开侧栏；
 *  · **输入状态下右划 ⇒ 不打开**（打字时手指在正文里左右划不该弹抽屉）；
 *  · 关闭方向不受输入状态影响；
 *  · 位移不足 / 更偏纵向 ⇒ 不动作（交给滚动与选字）。
 */
import { describe, expect, it } from 'vitest'
import { hasBlockingOverlay, isTypingNow, swipeIntent } from '../src/lib/swipe'

const idle = { sidebarOpen: false, typing: false }

describe('swipeIntent', () => {
  it('右划且位移足够 ⇒ open', () => {
    expect(swipeIntent(120, 10, idle)).toBe('open')
  })

  it('输入状态下右划 ⇒ 不打开（用户要求）', () => {
    expect(swipeIntent(120, 10, { ...idle, typing: true })).toBeNull()
  })

  it('左划且抽屉开着 ⇒ close（输入状态不影响关闭）', () => {
    expect(swipeIntent(-120, 10, { sidebarOpen: true, typing: true })).toBe('close')
  })

  it('位移不足或更偏纵向 ⇒ null', () => {
    expect(swipeIntent(40, 5, idle)).toBeNull()
    expect(swipeIntent(80, 90, idle)).toBeNull()
  })

  it('抽屉已开着时右划 ⇒ 不动作', () => {
    expect(swipeIntent(120, 10, { sidebarOpen: true, typing: false })).toBeNull()
  })

  /**
   * rev173.303（2026-10-31 第三次真人测试 #2 #3）：看图 / 环形菜单这类遮罩上，
   * 左右滑动**两个方向都不归抽屉管** —— 用户原话「看照片的时候可以通过左右滑动
   * 打开收起左侧栏」「这个遮罩也是，建议检查一下其他的遮罩」。
   */
  it('浮层开着 ⇒ 打开与关闭两个方向都不动作', () => {
    expect(swipeIntent(120, 10, { sidebarOpen: false, typing: false, overlay: true })).toBeNull()
    expect(swipeIntent(-120, 10, { sidebarOpen: true, typing: false, overlay: true })).toBeNull()
  })
})

describe('hasBlockingOverlay', () => {
  it('没有任何遮罩 ⇒ false', () => {
    expect(hasBlockingOverlay(document)).toBe(false)
  })

  it('图片预览 / 环形菜单 / 命令面板 / 对话框 —— 四类遮罩各一个都算「开着」', () => {
    for (const cls of ['zn-img-preview', 'zn-quick-overlay', 'zn-palette-mask', 'zn-dialog-backdrop']) {
      const el = document.createElement('div')
      el.className = cls
      document.body.append(el)
      expect(hasBlockingOverlay(document), cls).toBe(true)
      el.remove()
      expect(hasBlockingOverlay(document), cls).toBe(false)
    }
  })
})

describe('isTypingNow', () => {
  it('焦点在 input / textarea ⇒ true', () => {
    const input = document.createElement('input')
    const ta = document.createElement('textarea')
    document.body.append(input, ta)

    input.focus()
    expect(isTypingNow()).toBe(true)
    ta.focus()
    expect(isTypingNow()).toBe(true)
  })

  it('焦点在普通按钮 / 没有焦点 ⇒ false', () => {
    const btn = document.createElement('button')
    document.body.append(btn)
    btn.focus()
    expect(isTypingNow()).toBe(false)
  })
})
