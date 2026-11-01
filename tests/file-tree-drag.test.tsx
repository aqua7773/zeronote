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
