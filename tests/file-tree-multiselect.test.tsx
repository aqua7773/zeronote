// @vitest-environment happy-dom
/**
 * 文件树**多选**（rev173.318 · 用户 2026-11-01 定的新形式）。
 *
 * 用户原话：
 *  · 「多选的形式，不要添加顶栏；进入多选时，在每条笔记/文件夹前加一个勾选框」
 *  · 「勾选文件夹时一并勾选其中的文件」
 *  · 「取消一个，文件夹就变成未勾选，其余文件依旧被选中」
 *  · 批量操作与「退出多选」都走长按 / 右键菜单
 *
 * 本文件锁住这几条，防止退回「选到第 2 项自动弹菜单」或「顶栏」那两版。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
    notes: [note('a.md'), note('b.md'), note('归档/x.md'), note('归档/y.md')],
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

/** 当前被勾上的路径（读 DOM，而不是读 state） */
function checkedPaths(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.zn-tree-item')]
    .filter((el) => el.querySelector('.zn-check.is-on'))
    .map((el) => (el as HTMLElement).dataset.znPath ?? '')
}

/** 右键某行 → 点「多选」 */
function enterMultiSelect(rowText: string) {
  fireEvent.contextMenu(screen.getByText(rowText))
  fireEvent.click(screen.getByText('多选'))
}

describe('FileTree 多选：勾选框形式（没有顶栏）', () => {
  it('进多选后每行前面都有勾选框，且没有批量栏', () => {
    const { container } = render(<FileTree {...makeProps()} />)
    enterMultiSelect('a.md')

    // 5 行（归档 + 归档里的两篇 + a + b）各一个勾选框
    expect(container.querySelectorAll('.zn-check').length).toBe(5)
    // 顶栏批量条已删除
    expect(container.querySelector('.zn-tree-batchbar')).toBeNull()
    // 进多选时右键的那条是勾上的
    expect(checkedPaths(container)).toEqual(['a.md'])
  })

  it('连点多个文件都勾上，不弹菜单、不打开笔记', () => {
    const props = makeProps()
    const { container } = render(<FileTree {...props} />)
    enterMultiSelect('a.md')

    fireEvent.click(screen.getByText('b.md'))
    fireEvent.click(screen.getByText('归档'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(props.onOpen).not.toHaveBeenCalled()

    // 勾「归档」会连带里面两篇
    expect(checkedPaths(container).sort()).toEqual(
      ['a.md', 'b.md', '归档', '归档/x.md', '归档/y.md'].sort(),
    )
  })

  it('再点已勾的一行 = 取消那一项', () => {
    const { container } = render(<FileTree {...makeProps()} />)
    enterMultiSelect('a.md')
    fireEvent.click(screen.getByText('b.md'))
    fireEvent.click(screen.getByText('b.md'))
    expect(checkedPaths(container)).toEqual(['a.md'])
  })
})

describe('FileTree 多选：文件夹级联', () => {
  it('勾文件夹 ⇒ 它自己和里面全部条目一起勾上', () => {
    const { container } = render(<FileTree {...makeProps()} />)
    // 文件夹也能直接进多选
    enterMultiSelect('归档')
    expect(checkedPaths(container).sort()).toEqual(['归档', '归档/x.md', '归档/y.md'].sort())
  })

  it('取消里面某一篇 ⇒ 文件夹变回未勾选，其余文件仍然勾着', () => {
    const { container } = render(<FileTree {...makeProps()} />)
    enterMultiSelect('归档')
    // 取消 归档/y.md
    fireEvent.click(screen.getByText('y.md'))
    expect(checkedPaths(container)).toEqual(['归档/x.md'])
  })

  it('再勾一次文件夹 ⇒ 又全部勾回来', () => {
    const { container } = render(<FileTree {...makeProps()} />)
    enterMultiSelect('归档')
    fireEvent.click(screen.getByText('y.md'))
    fireEvent.click(screen.getByText('归档'))
    expect(checkedPaths(container).sort()).toEqual(['归档', '归档/x.md', '归档/y.md'].sort())
  })
})

describe('FileTree 多选：批量操作走菜单', () => {
  it('右键菜单里有「删除选中的 N 项 / 移入… / 退出多选」', () => {
    render(<FileTree {...makeProps()} />)
    enterMultiSelect('a.md')
    fireEvent.click(screen.getByText('b.md'))

    fireEvent.contextMenu(screen.getByText('a.md'))
    expect(screen.getByText('删除选中的 2 项')).toBeTruthy()
    expect(screen.getByText('移入…')).toBeTruthy()
    expect(screen.getByText('退出多选')).toBeTruthy()
  })

  it('「退出多选」清空勾选、勾选框消失', () => {
    const { container } = render(<FileTree {...makeProps()} />)
    enterMultiSelect('a.md')
    fireEvent.contextMenu(screen.getByText('a.md'))
    fireEvent.click(screen.getByText('退出多选'))

    expect(container.querySelectorAll('.zn-check').length).toBe(0)
    expect(container.querySelectorAll('.zn-tree-item.is-picked').length).toBe(0)
  })

  it('「移入…」列出目录，点一个就把整批搬过去', () => {
    const onRename = vi.fn()
    render(<FileTree {...makeProps({ onRename, dirs: ['归档', '资料'] })} />)
    enterMultiSelect('a.md')
    fireEvent.click(screen.getByText('b.md'))

    fireEvent.contextMenu(screen.getByText('a.md'))
    fireEvent.click(screen.getByText('移入…'))
    expect(screen.getByRole('menuitem', { name: '库根' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '资料' }))

    expect(onRename).toHaveBeenCalledTimes(2)
    expect(onRename).toHaveBeenCalledWith('a.md', '资料/a.md', false)
    expect(onRename).toHaveBeenCalledWith('b.md', '资料/b.md', false)
  })

  it('「删除选中的 N 项」把整批交给 onDeleteMany', () => {
    const onDeleteMany = vi.fn()
    render(<FileTree {...makeProps({ onDeleteMany })} />)
    enterMultiSelect('a.md')
    fireEvent.click(screen.getByText('b.md'))

    fireEvent.contextMenu(screen.getByText('a.md'))
    fireEvent.click(screen.getByText('删除选中的 2 项'))
    expect(onDeleteMany).toHaveBeenCalledTimes(1)
    expect(onDeleteMany.mock.calls[0][0].sort()).toEqual(['a.md', 'b.md'])
  })
})
