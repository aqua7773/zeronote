// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppEmptyState } from '../src/components/AppEmptyState'
import { rememberRecentNote } from '../src/lib/recent-notes'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

/** 库路径用变量传：JSX 属性字符串不做 JS 转义，`vault="C:\\v"` 会变成两个字面反斜杠 */
const V = 'C:\\v'

describe('AppEmptyState', () => {
  it('没有库 ⇒ 给「选择笔记库」按钮', () => {
    const onPick = vi.fn()
    render(<AppEmptyState vault={null} notes={[]} onPickVault={onPick} onNewNote={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '选择笔记库' }))
    expect(onPick).toHaveBeenCalledTimes(1)
  })

  it('有库但没笔记 ⇒ 「新建第一条」', () => {
    const onNew = vi.fn()
    render(
      <AppEmptyState vault={V} notes={[]} onPickVault={() => {}} onNewNote={onNew} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '新建第一条' }))
    expect(onNew).toHaveBeenCalledTimes(1)
  })

  it('有笔记 ⇒ 「新建笔记」+ Markdown 速查表', () => {
    const { container } = render(
      <AppEmptyState
        vault={V}
        notes={[{ path: 'a.md', name: 'a.md', kind: 'note' } as never]}
        onPickVault={() => {}}
        onNewNote={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: '新建笔记' })).toBeTruthy()
    expect(container.querySelectorAll('.zn-md-cheat').length).toBe(14)
  })

  it('三种情况都带快捷键教学', () => {
    const { container } = render(
      <AppEmptyState vault={null} notes={[]} onPickVault={() => {}} onNewNote={() => {}} />,
    )
    expect(container.querySelector('.zn-empty-keys')).toBeTruthy()
  })

  /* ── B4（方案 §6 / O10）：回访入口与插件入口的零插件基线 ── */

  const notes = [
    { path: 'a.md', id: '1', title: 'A 笔记', kind: 'note', mtime: 100, size: 1, frontmatter: {} },
    { path: 'b.md', id: '2', title: 'B 笔记', kind: 'note', mtime: 300, size: 1, frontmatter: {} },
    { path: 'c.md', id: '3', title: 'C 笔记', kind: 'note', mtime: 200, size: 1, frontmatter: {} },
  ]

  it('有笔记 ⇒ 显示「最近 3 篇」，点击打开对应笔记', () => {
    const onOpen = vi.fn()
    const { container } = render(
      <AppEmptyState
        vault={V}
        notes={notes as never}
        onPickVault={() => {}}
        onNewNote={() => {}}
        onOpenNote={onOpen}
      />,
    )
    expect(screen.getByText('最近 3 篇')).toBeTruthy()
    // 没有打开记录 ⇒ 按修改时间倒序：b(300) / c(200) / a(100)
    const items = container.querySelectorAll<HTMLButtonElement>('.zn-empty-recent-item')
    expect(items.length).toBe(3)
    fireEvent.click(items[0])
    expect(onOpen).toHaveBeenCalledWith('b.md')
  })

  it('最近打开过的排在最前（优先于修改时间）', () => {
    rememberRecentNote('C:\\v', 'a.md', 9999)
    const onOpen = vi.fn()
    const { container } = render(
      <AppEmptyState
        vault={V}
        notes={notes as never}
        onPickVault={() => {}}
        onNewNote={() => {}}
        onOpenNote={onOpen}
      />,
    )
    fireEvent.click(container.querySelectorAll<HTMLButtonElement>('.zn-empty-recent-item')[0])
    expect(onOpen).toHaveBeenCalledWith('a.md')
  })

  it('零插件：没有「从文件导入」', () => {
    render(
      <AppEmptyState
        vault={V}
        notes={notes as never}
        onPickVault={() => {}}
        onNewNote={() => {}}
      />,
    )
    expect(screen.queryByRole('button', { name: '从文件导入' })).toBeNull()
    expect(screen.getByRole('button', { name: '新建笔记' })).toBeTruthy()
  })

  it('import-export 启用（宿主传 onImport）⇒ 多出「从文件导入」', () => {
    const onImport = vi.fn()
    render(
      <AppEmptyState
        vault={V}
        notes={notes as never}
        onPickVault={() => {}}
        onNewNote={() => {}}
        onImport={onImport}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: '从文件导入' }))
    expect(onImport).toHaveBeenCalledTimes(1)
  })
})
