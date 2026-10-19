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

  it('点空白关闭（pointerdown，避免长按松手的 click 误关）', () => {
    const onClose = vi.fn()
    render(<QuickLaunch open onClose={onClose} entries={[entry()]} />)
    fireEvent.pointerDown(document.querySelector('.zn-quick-overlay') as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
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
