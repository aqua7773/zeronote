// @vitest-environment happy-dom
/**
 * 拖拽落点（rev173.319 · 用户 2026-11-01）：
 *  · 拖到**目录行**⇒ 进那个目录；
 *  · 拖到**文件树栏内的空白** ⇒ 放到**库根**；
 *  · 拖出文件树栏外 ⇒ **不做动作**。
 *
 * 这里用鼠标通道测（触摸通道是同一套判定，只是先按住 240ms）。
 * `elementFromPoint` 在 happy-dom 里没有真实布局，所以直接 mock 它。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '../src/components/FileTree'
import type { NoteMeta } from '../src/kernel/contract'

afterEach(cleanup)

const note = (path: string): NoteMeta => ({
  path,
  id: path,
  title: path,
  mtime: 0,
  size: 0,
  frontmatter: {},
  kind: 'note',
})

function makeProps(over: Record<string, unknown> = {}) {
  return {
    notes: [note('a.md'), note('归档/x.md')],
    dirs: ['归档'],
    activePath: null,
    vault: 'C:/vault',
    onOpen: vi.fn(),
    onNewFile: vi.fn(async () => 'new.md'),
    onNewDir: vi.fn(async () => '新文件夹'),
    onRename: vi.fn(),
    onDeleteMany: vi.fn(),
    onPurgeMany: vi.fn(),
    clipboard: null,
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onDuplicate: vi.fn(),
    ...over,
  }
}

/** 用鼠标把 `from` 拖到坐标 (x, y) */
function dragTo(from: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(from, { button: 0, pointerType: 'mouse', clientX: 10, clientY: 10 })
  window.dispatchEvent(
    new PointerEvent('pointermove', {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerType: 'mouse',
    }),
  )
  window.dispatchEvent(
    new PointerEvent('pointerup', {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
      pointerType: 'mouse',
    }),
  )
}

describe('FileTree 拖拽落点', () => {
  let fromPoint: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fromPoint = vi.fn()
    Object.defineProperty(document, 'elementFromPoint', {
      value: fromPoint,
      configurable: true,
      writable: true,
    })
  })

  it('拖到栏内空白 ⇒ 移到库根', () => {
    const onRename = vi.fn()
    const { container } = render(<FileTree {...makeProps({ onRename })} />)
    const tree = container.querySelector('.zn-filetree') as HTMLElement
    // 空白处：落点就是树容器本身（没有 data-zn-path）
    fromPoint.mockReturnValue(tree)

    dragTo(screen.getByText('x.md'), 50, 300)

    expect(onRename).toHaveBeenCalledWith('归档/x.md', 'x.md', false)
  })

  it('拖到目录行 ⇒ 进那个目录', () => {
    const onRename = vi.fn()
    const { container } = render(<FileTree {...makeProps({ onRename })} />)
    const dirRow = container.querySelector('[data-zn-path="归档"]') as HTMLElement
    fromPoint.mockReturnValue(dirRow)

    dragTo(screen.getByText('a.md'), 50, 100)

    expect(onRename).toHaveBeenCalledWith('a.md', '归档/a.md', false)
  })

  it('拖出文件树栏外 ⇒ 不做动作', () => {
    const onRename = vi.fn()
    render(<FileTree {...makeProps({ onRename })} />)
    // 落点在栏外：body 不属于树的子树
    fromPoint.mockReturnValue(document.body)

    dragTo(screen.getByText('a.md'), 900, 300)

    expect(onRename).not.toHaveBeenCalled()
  })

  it('拖到文件行上 ⇒ 不做动作（文件不能当目录）', () => {
    const onRename = vi.fn()
    const { container } = render(<FileTree {...makeProps({ onRename })} />)
    const fileRow = container.querySelector('[data-zn-path="a.md"]') as HTMLElement
    fromPoint.mockReturnValue(fileRow)

    dragTo(screen.getByText('x.md'), 50, 100)

    expect(onRename).not.toHaveBeenCalled()
  })
})

/**
 * 触摸拖拽的落点判定被 rAF 节流（rev173.331 · 真人测试7 #3「拖拽会有很明显的卡顿感」）。
 *
 * 旧实现每次 `touchmove` 都 `elementFromPoint` + 两次 setState（整棵树重渲染）。
 * 手指拖动时 touchmove 频率可达 60–120Hz ⇒ 明显掉帧。现在一帧只算一次落点，
 * ghost 创建后直接改 style。
 */
describe('FileTree 触摸拖拽节流', () => {
  let fromPoint: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fromPoint = vi.fn()
    Object.defineProperty(document, 'elementFromPoint', {
      value: fromPoint,
      configurable: true,
      writable: true,
    })
  })

  it('同一帧内多次 touchmove 只判一次落点，ghost 位置取最后一点', async () => {
    const { container } = render(<FileTree {...makeProps()} />)
    const tree = container.querySelector('.zn-filetree') as HTMLElement
    fromPoint.mockReturnValue(tree)
    const row = container.querySelector('[data-zn-path="a.md"]') as HTMLElement

    // ⚠️ 必须用真实 `TouchEvent`：`fireEvent.touchStart(el, { touches })` 走的是
    // `createEvent`，happy-dom 里 `touches` 不会被赋值 ⇒ 处理器第一行就 return 了
    fireEvent(row, touch('touchstart', 10, 10, row))
    // 触摸拖拽要先按住 ARM_MS(240ms)，否则视为滚动
    await new Promise((r) => setTimeout(r, 300))
    fireEvent(window, touch('touchmove', 60, 200, row))
    fireEvent(window, touch('touchmove', 70, 210, row))
    fireEvent(window, touch('touchmove', 80, 220, row))
    await new Promise((r) => setTimeout(r, 60))

    expect(fromPoint).toHaveBeenCalledTimes(1)
    const ghost = document.querySelector<HTMLElement>('.zn-drag-ghost')
    expect(ghost).toBeTruthy()
    expect(ghost?.style.left).toBe('80px')
    expect(ghost?.style.top).toBe('220px')
  })
})

/** 造一个带单指触点的 TouchEvent（`target` 由 happy-dom 的派发流程覆盖） */
function touch(type: string, x: number, y: number, target: Element): TouchEvent {
  return new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: [{ clientX: x, clientY: y, identifier: 0, target } as unknown as Touch],
  })
}
