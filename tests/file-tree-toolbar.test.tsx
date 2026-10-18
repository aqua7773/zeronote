// @vitest-environment happy-dom
/**
 * 文件树顶栏（rev139 · 2026-10-18 用户要求）：列表上方一栏，「新建笔记 / 新建文件夹」。
 * 行为必须与右键菜单一致 —— 都走 `createIn('', …)` 在**库根**新建。
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '../src/components/FileTree'
import type { NoteMeta } from '../src/kernel/contract'

afterEach(cleanup)

const note = (path: string, title: string): NoteMeta => ({
  path,
  id: path,
  title,
  mtime: 0,
  size: 0,
  frontmatter: {},
  kind: 'note',
})

function makeProps(over: Record<string, unknown> = {}) {
  return {
    notes: [note('a.md', 'a')],
    dirs: [],
    activePath: null,
    onOpen: vi.fn(),
    onNewFile: vi.fn(async () => 'new.md'),
    onNewDir: vi.fn(async () => '新建文件夹'),
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

describe('FileTree 顶栏', () => {
  it('顶栏在树容器里，两个按钮点击都在库根新建', () => {
    const props = makeProps()
    const { container } = render(<FileTree {...(props as never)} />)

    expect(container.querySelector('.zn-tree-toolbar')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '新建笔记' }))
    expect(props.onNewFile).toHaveBeenCalledWith('')
    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }))
    expect(props.onNewDir).toHaveBeenCalledWith('')
  })

  it('空库也有顶栏（不能只剩右键入口）', () => {
    const props = makeProps({ notes: [], dirs: [] })
    const { container } = render(<FileTree {...(props as never)} />)
    expect(container.querySelector('.zn-tree-toolbar')).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建笔记' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '新建文件夹' })).toBeTruthy()
  })

  it('点「多选」进入多选模式（出现批量操作条、0 项已选）', () => {
    const props = makeProps()
    const { container } = render(<FileTree {...(props as never)} />)
    expect(container.querySelector('.zn-select-bar')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '多选' }))
    expect(container.querySelector('.zn-select-bar')).toBeTruthy()
    expect(screen.getByText(/已选 0 项/)).toBeTruthy()
  })

  it('右键菜单里有「多选」：点击进入多选并选中该行', () => {
    const props = makeProps()
    const { container } = render(<FileTree {...(props as never)} />)

    const row = container.querySelector('.zn-tree-item')
    expect(row).toBeTruthy()
    fireEvent.contextMenu(row as Element)

    const menu = document.querySelector('[role="menu"]') as HTMLElement
    expect(menu).toBeTruthy()
    fireEvent.click(within(menu).getByText('多选'))

    expect(container.querySelector('.zn-select-bar')).toBeTruthy()
    expect(screen.getByText(/已选 1 项/)).toBeTruthy()
  })
})
