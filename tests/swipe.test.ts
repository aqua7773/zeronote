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
import {
  dismissTypingFocus,
  drawersOpenOnlyOnHome,
  hasBlockingOverlay,
  isTypingNow,
  moreSwipeIntent,
  swipeIntent,
} from '../src/lib/swipe'

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

  it('任意带 data-overlay 的层都算（P4：新增浮层不用改白名单）', () => {
    const el = document.createElement('div')
    el.setAttribute('data-overlay', '')
    document.body.append(el)
    expect(hasBlockingOverlay(document)).toBe(true)
    el.remove()
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

describe('dismissTypingFocus（rev173.342 · 图片预览收软键盘）', () => {
  it('焦点在 contentEditable ⇒ 失焦并返回 true', () => {
    const box = document.createElement('div')
    box.contentEditable = 'true'
    box.tabIndex = 0
    document.body.append(box)

    box.focus()
    expect(isTypingNow()).toBe(true)
    expect(dismissTypingFocus()).toBe(true)
    expect(document.activeElement).not.toBe(box)
    box.remove()
  })

  it('焦点在普通按钮 ⇒ 不动焦点，返回 false', () => {
    const btn = document.createElement('button')
    document.body.append(btn)
    btn.focus()

    expect(dismissTypingFocus()).toBe(false)
    expect(document.activeElement).toBe(btn)
    btn.remove()
  })
})

/**
 * 右侧「更多」抽屉（rev173.308 起；rev173.312 去掉边缘限制）。
 *
 * 分工是**按方向**：右划 = 左边文件树，左划 = 右边「更多」。
 * 两条判据方向相反，同一次滑动不可能同时命中 —— 这正是这里要锁住的。
 *
 * rev173.312（2026-11-01 用户）：「右划随处能开、左划只有贴右边缘一小片能开」用着别扭，
 * 两边都改成全屏；代价是正文里左划可能被当抽屉手势，靠 60px 门槛 + 输入态禁用来兜。
 */
describe('moreSwipeIntent', () => {
  const base = { open: false }

  it('任意位置左划 ⇒ open（不再要求贴右边缘）', () => {
    expect(moreSwipeIntent(-120, 10, base)).toBe('open')
  })

  it('正在输入时左划 ⇒ 不开（与左抽屉同口径，打字别弹抽屉）', () => {
    expect(moreSwipeIntent(-120, 10, { ...base, typing: true })).toBeNull()
  })

  it('右划 ⇒ 不归它管（右划开的是左边文件树抽屉）', () => {
    expect(moreSwipeIntent(120, 10, base)).toBeNull()
    expect(swipeIntent(120, 10, { sidebarOpen: false, typing: false })).toBe('open')
  })

  it('左划时左抽屉不动作（互不干扰）', () => {
    expect(swipeIntent(-120, 10, { sidebarOpen: false, typing: false })).toBeNull()
    expect(moreSwipeIntent(-120, 10, base)).toBe('open')
  })

  it('抽屉已打开：右划关闭、左划不管', () => {
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

/**
 * rev173.317 · 真人测试5 #4：「搜索、插件中心这些页面也可以呼起左侧栏和右侧栏，
 * 甚至还能先呼出左侧栏然后再呼出右侧栏叠加，侧栏呼出应该是一个仅限首页可以进行的操作」。
 *
 * 用户确认按字面：**打开笔记的编辑页也禁止**，只有时间流卡片页能开。
 */
describe('drawersOpenOnlyOnHome', () => {
  it('首页（编辑器视图 + home tab + 没打开笔记）⇒ 允许', () => {
    expect(drawersOpenOnlyOnHome('editor', 'home', null)).toBe(true)
  })

  it('编辑页（打开了笔记）⇒ 禁止', () => {
    expect(drawersOpenOnlyOnHome('editor', 'home', 'a.md')).toBe(false)
  })

  it('搜索全屏页 ⇒ 禁止', () => {
    expect(drawersOpenOnlyOnHome('editor', 'search', null)).toBe(false)
  })

  it('插件中心 / 回收站 / 插件面板页（mainView 不是 editor）⇒ 禁止', () => {
    expect(drawersOpenOnlyOnHome('plugins', 'home', null)).toBe(false)
    expect(drawersOpenOnlyOnHome('trash', 'home', null)).toBe(false)
    expect(drawersOpenOnlyOnHome('io-panel', 'home', null)).toBe(false)
  })
})
