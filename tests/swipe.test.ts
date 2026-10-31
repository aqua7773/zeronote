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
import { hasBlockingOverlay, isTypingNow, moreSwipeIntent, swipeIntent } from '../src/lib/swipe'

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

/**
 * 右侧「更多」抽屉（rev173.308 · 用户 2026-10-31「更多改成右滑出现的右侧栏」）。
 *
 * 与左抽屉的分工：左抽屉 = 任意位置**右划**；右抽屉 = **右边缘起手 + 左划**。
 * 两条判据方向相反、起点不同，所以同一次滑动不可能同时命中 —— 这正是这里要锁住的。
 */
describe('moreSwipeIntent', () => {
  const base = { startX: 390, viewportWidth: 400, open: false }

  it('右边缘起手 + 左划 ⇒ open', () => {
    expect(moreSwipeIntent(-120, 10, base)).toBe('open')
  })

  it('不在右边缘（从屏幕中间左划）⇒ 不开（那是选字 / 翻页）', () => {
    expect(moreSwipeIntent(-120, 10, { ...base, startX: 120 })).toBeNull()
  })

  it('门槛 = 距右边缘 64px（32 会被 Android 系统返回手势抢走，不能更小）', () => {
    expect(moreSwipeIntent(-120, 10, { startX: 400 - 64, viewportWidth: 400, open: false })).toBe('open')
    expect(moreSwipeIntent(-120, 10, { startX: 400 - 65, viewportWidth: 400, open: false })).toBeNull()
  })

  it('右边缘起手但**右划** ⇒ 不归它管（右划开的是左边文件树抽屉）', () => {
    expect(moreSwipeIntent(120, 10, base)).toBeNull()
    expect(swipeIntent(120, 10, { sidebarOpen: false, typing: false })).toBe('open')
  })

  it('右边缘左划时左抽屉不动作（互不干扰）', () => {
    expect(swipeIntent(-120, 10, { sidebarOpen: false, typing: false })).toBeNull()
    expect(moreSwipeIntent(-120, 10, base)).toBe('open')
  })

  it('抽屉已打开：右划关闭、左划不管、再点右边缘也不重开', () => {
    expect(moreSwipeIntent(120, 10, { ...base, open: true })).toBe('close')
    expect(moreSwipeIntent(-120, 10, { ...base, open: true })).toBeNull()
  })

  it('位移不足或更偏纵向 ⇒ null', () => {
    expect(moreSwipeIntent(-40, 5, base)).toBeNull()
    expect(moreSwipeIntent(-80, 90, base)).toBeNull()
  })

  it('浮层开着 ⇒ 打开与关闭两个方向都不动作', () => {
    expect(moreSwipeIntent(-120, 10, { ...base, overlay: true })).toBeNull()
    expect(moreSwipeIntent(120, 10, { ...base, open: true, overlay: true })).toBeNull()
  })
})
