// @vitest-environment happy-dom
/**
 * 起始页长按 ＋ 的环形快捷入口（rev173.20 · 调研见 docs/快捷入口-调研-2026-10-19.md §4）。
 *
 * 四条必测（调研 §4 验收）：
 *   ① 短按 ＋ → 仍是新建笔记
 *   ② 长按 500ms → 打开遮罩
 *   ③ 长按后松手 → 不再触发新建（浏览器补发的 click 要被吃掉）
 *   ④ 点「记账」→ 走入口回调并关闭
 * 另加两条边界：空位补齐、点空白关闭。
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MobileNoteCards } from '../src/components/MobileNoteCards'
import { QuickLaunch } from '../src/components/QuickLaunch'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function cardsProps(over: Record<string, unknown> = {}) {
  return {
    notes: [],
    onOpen: vi.fn(),
    onNewNote: vi.fn(),
    onQuickLaunch: vi.fn(),
    readText: vi.fn(async () => ''),
    onDelete: vi.fn(),
    onPurge: vi.fn(),
    onRename: vi.fn(),
    ...over,
  }
}

const composeBtn = () => screen.getByRole('button', { name: '新建一条（长按打开快捷入口）' })

describe('MobileNoteCards · 长按 ＋', () => {
  it('短按（未到 500ms）仍新建笔记', () => {
    const props = cardsProps()
    render(<MobileNoteCards {...props} />)
    fireEvent.pointerDown(composeBtn(), { clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    fireEvent.pointerUp(composeBtn())
    fireEvent.click(composeBtn())
    expect(props.onNewNote).toHaveBeenCalledTimes(1)
    expect(props.onQuickLaunch).not.toHaveBeenCalled()
  })

  it('按住 500ms → 打开快捷入口', () => {
    const props = cardsProps()
    render(<MobileNoteCards {...props} />)
    fireEvent.pointerDown(composeBtn(), { clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(props.onQuickLaunch).toHaveBeenCalledTimes(1)
    expect(props.onNewNote).not.toHaveBeenCalled()
  })

  it('长按触发后松手 → 补发的 click 不再新建', () => {
    const props = cardsProps()
    render(<MobileNoteCards {...props} />)
    fireEvent.pointerDown(composeBtn(), { clientX: 10, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    fireEvent.pointerUp(composeBtn())
    // 浏览器在 pointerup 之后补发的那次 click
    fireEvent.click(composeBtn())
    expect(props.onQuickLaunch).toHaveBeenCalledTimes(1)
    expect(props.onNewNote).not.toHaveBeenCalled()
  })

  it('按下后移动超过 10px 取消长按（滑动不误触）', () => {
    const props = cardsProps()
    render(<MobileNoteCards {...props} />)
    fireEvent.pointerDown(composeBtn(), { clientX: 10, clientY: 10 })
    fireEvent.pointerMove(composeBtn(), { clientX: 40, clientY: 10 })
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(props.onQuickLaunch).not.toHaveBeenCalled()
  })

  it('卸载后挂起的定时器不再开遮罩', () => {
    const props = cardsProps()
    const view = render(<MobileNoteCards {...props} />)
    fireEvent.pointerDown(composeBtn(), { clientX: 10, clientY: 10 })
    view.unmount()
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(props.onQuickLaunch).not.toHaveBeenCalled()
  })

  it('面板形态（桌面时间流）不渲染 ＋ 按钮（用户 2026-10-19 要求）', () => {
    render(<MobileNoteCards {...cardsProps({ variant: 'panel' })} />)
    expect(document.querySelector('.zn-mobile-home--panel')).toBeTruthy()
    expect(document.querySelector('.zn-mobile-compose')).toBeNull()
  })
})

describe('QuickLaunch 环', () => {
  const entry = () => ({ key: 'accounting', label: '记账', onClick: vi.fn() })

  it('点入口 → 执行回调并关闭', () => {
    const e = entry()
    const onClose = vi.fn()
    render(<QuickLaunch open onClose={onClose} entries={[e]} />)
    fireEvent.click(screen.getByRole('button', { name: '记账' }))
    expect(e.onClick).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('不足 5 个时补空位（1 个入口 + 4 个虚线空位）', () => {
    render(<QuickLaunch open onClose={vi.fn()} entries={[entry()]} />)
    expect(document.querySelectorAll('.zn-quick-item.is-empty')).toHaveLength(4)
  })

  it('点空白关闭（用 click：遮罩在 click 里卸载，卡片拿不到这次点击）', () => {
    const onClose = vi.fn()
    render(<QuickLaunch open onClose={onClose} entries={[entry()]} />)
    fireEvent.click(document.querySelector('.zn-quick-overlay') as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('关闭挂在 click 上，pointerdown 只 preventDefault', () => {
    // 真机「点空白直接打开后面的笔记」的修复点：pointerdown 里就关会让遮罩先卸载，
    // 浏览器随后补发的 click 落到卡片上。这里锁死「pointerdown 不关、click 才关」。
    const onClose = vi.fn()
    render(<QuickLaunch open onClose={onClose} entries={[entry()]} />)
    const overlay = document.querySelector('.zn-quick-overlay') as Element
    // fireEvent 返回 dispatchEvent 的结果：false = 事件被 preventDefault 掉了
    expect(fireEvent.pointerDown(overlay)).toBe(false)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点中心 ＋ → 新建笔记并关闭（J#9：中心固定是新建，不是关闭）', () => {
    const onClose = vi.fn()
    const onNewNote = vi.fn()
    render(<QuickLaunch open onClose={onClose} entries={[entry()]} onNewNote={onNewNote} />)
    fireEvent.click(screen.getByRole('button', { name: '新建笔记' }))
    expect(onNewNote).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('不传 onNewNote 时中心只关闭（兼容旧调用 / 单测）', () => {
    const onClose = vi.fn()
    render(<QuickLaunch open onClose={onClose} entries={[]} />)
    fireEvent.click(screen.getByRole('button', { name: '新建笔记' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('「换入口」→ 调 onEdit（不进环的槽位）', () => {
    const onEdit = vi.fn()
    render(<QuickLaunch open onClose={vi.fn()} entries={[]} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: '换入口' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })

  it('null 槽位补虚线空位（5 格固定）', () => {
    render(
      <QuickLaunch
        open
        onClose={vi.fn()}
        entries={[entry(), null, null, null, null]}
      />,
    )
    expect(document.querySelectorAll('.zn-quick-item.is-empty')).toHaveLength(4)
  })

  it('未安装的入口灰化、不触发回调', () => {
    const e = entry()
    render(<QuickLaunch open onClose={vi.fn()} entries={[{ ...e, disabled: true, hint: '未安装' }]} />)
    const btn = screen.getByRole('button', { name: /记账/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('未安装')).toBeTruthy()
    fireEvent.click(btn)
    expect(e.onClick).not.toHaveBeenCalled()
  })

  it('关闭状态下什么都不渲染', () => {
    render(<QuickLaunch open={false} onClose={vi.fn()} entries={[entry()]} />)
    expect(document.querySelector('.zn-quick-overlay')).toBeNull()
  })
})
