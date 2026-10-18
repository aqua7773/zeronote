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

  it('rev141：顶栏 / 批量条移除，右键「多选」保留（点行只加减选，批量走菜单）', () => {
    const props = makeProps({ notes: [note('a.md', 'a'), note('b.md', 'b')] })
    const { container } = render(<FileTree {...(props as never)} />)

    // 顶栏只剩两个新建按钮；批量条不存在
    expect(screen.queryByRole('button', { name: '多选' })).toBeNull()
    expect(container.querySelector('.zn-select-bar')).toBeNull()

    const rows = container.querySelectorAll('.zn-tree-item')
    expect(rows.length).toBe(2)

    // 右键菜单里的「多选」保留，点击进入点选模式
    fireEvent.contextMenu(rows[0])
    const menu = document.querySelector('[role="menu"]') as HTMLElement
    expect(menu).toBeTruthy()
    fireEvent.click(within(menu).getByText('多选'))

    // 点第二行 = 加选（不打开笔记），并**直接弹出批量菜单**（不用再右键一次）
    fireEvent.click(rows[1])
    expect(props.onOpen).not.toHaveBeenCalled()
    const menu2 = document.querySelector('[role="menu"]') as HTMLElement
    expect(menu2).toBeTruthy()
    expect(within(menu2).getByText('删除选中的 2 项')).toBeTruthy()
    // 批量条始终不出现
    expect(container.querySelector('.zn-select-bar')).toBeNull()
  })
})
