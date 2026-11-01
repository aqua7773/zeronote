// @vitest-environment happy-dom
/**
 * 文件树**多选**（rev173.317 · 真人测试5 #1「手机端多选功能残废」）。
 *
 * 旧行为：多选态下选到第 2 项就自动弹批量菜单，菜单带全屏遮罩 ⇒ 再点第三项
 * 实际点在遮罩上、只把菜单关掉，用户看到的就是「只选中一个，再点其他文件就取消了」。
 *
 * 现在的约定（本文件锁住）：
 *  · 多选态点行 = 加/减选，**任何时候都不自动弹菜单**；
 *  · 列表顶部出现批量栏（已选 N 项 · 移入… / 删除 / 彻底删除 / 完成）；
 *  · 「移入…」列出目录，点一个就把整批搬过去（走 `onRename`）；
 *  · 「完成」退出多选、清空选中。
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
    notes: [note('a.md'), note('b.md'), note('c.md')],
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

/** 进多选态：右键 a → 点「多选」 */
function enterMultiSelect() {
  fireEvent.contextMenu(screen.getByText('a.md'))
  fireEvent.click(screen.getByText('多选'))
}

describe('FileTree 多选：不再自动弹菜单', () => {
  it('连点三个文件都进选中集合，全程没有菜单', () => {
    const { container } = render(<FileTree {...makeProps()} />)
    enterMultiSelect()

    fireEvent.click(screen.getByText('b.md'))
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByText('c.md'))
    expect(screen.queryByRole('menu')).toBeNull()

    const picked = [...container.querySelectorAll('.zn-tree-item.is-picked')].map(
      (el) => (el as HTMLElement).dataset.znPath,
    )
    expect(picked).toEqual(['a.md', 'b.md', 'c.md'])
  })

  it('再点同一行 = 取消那一项（其余保持）', () => {
    const { container } = render(<FileTree {...makeProps()} />)
    enterMultiSelect()
    fireEvent.click(screen.getByText('b.md'))
    fireEvent.click(screen.getByText('b.md'))

    const picked = [...container.querySelectorAll('.zn-tree-item.is-picked')].map(
      (el) => (el as HTMLElement).dataset.znPath,
    )
    expect(picked).toEqual(['a.md'])
  })
})

describe('FileTree 多选：顶部批量栏', () => {
  it('显示已选数量，点「完成」退出并清空', () => {
    const { container } = render(<FileTree {...makeProps()} />)
    enterMultiSelect()

    expect(screen.getByText('已选 1 项')).toBeTruthy()
    fireEvent.click(screen.getByText('b.md'))
    expect(screen.getByText('已选 2 项')).toBeTruthy()

    fireEvent.click(screen.getByText('完成'))
    expect(screen.queryByText(/已选 \d+ 项/)).toBeNull()
    expect(container.querySelectorAll('.zn-tree-item.is-picked').length).toBe(0)
  })

  it('「移入…」列出目录，点一个就把整批搬过去', () => {
    const onRename = vi.fn()
    render(<FileTree {...makeProps({ onRename })} />)
    enterMultiSelect()
    fireEvent.click(screen.getByText('b.md'))

    fireEvent.click(screen.getByText('移入…'))
    // 库根 + 真实目录
    expect(screen.getByRole('menuitem', { name: '库根' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: '归档' }))

    expect(onRename).toHaveBeenCalledTimes(2)
    expect(onRename).toHaveBeenCalledWith('a.md', '归档/a.md', false)
    expect(onRename).toHaveBeenCalledWith('b.md', '归档/b.md', false)
    // 搬完退出多选
    expect(screen.queryByText(/已选 \d+ 项/)).toBeNull()
  })

  it('「删除」把整批交给 onDeleteMany', () => {
    const onDeleteMany = vi.fn()
    render(<FileTree {...makeProps({ onDeleteMany })} />)
    enterMultiSelect()
    fireEvent.click(screen.getByText('b.md'))

    fireEvent.click(screen.getByText('删除'))
    expect(onDeleteMany).toHaveBeenCalledTimes(1)
    expect(onDeleteMany.mock.calls[0][0]).toEqual(['a.md', 'b.md'])
  })
})

