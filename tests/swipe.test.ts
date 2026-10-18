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
import { isTypingNow, swipeIntent } from '../src/lib/swipe'

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
