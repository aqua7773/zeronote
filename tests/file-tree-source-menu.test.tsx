// @vitest-environment happy-dom
/**
 * 私密笔记的菜单 / 快捷键对齐（rev173.402 · 方案 §9.3 / §9.12）
 *
 * 判据：
 * · 源条目右键 = 弹**同一套菜单**（不再直接弹改名框 —— 用户 2026-11-06
 *   「操作都对齐普通笔记，唯一的区别就是加密」）；
 * · 菜单里**没有**磁盘语义项（剪切 / 复制 / 创建副本 / 粘贴 / 在文件夹中打开 / 新建）；
 * · 删除走 `onRemoveSource`（插件进私密回收站），**绝不**落到 `onDeleteMany`
 *   （那会把密文当公开文件移进全局明文回收站）；
 * · F2 / Delete 与菜单同一条路由（§9.12.1：不能各写一份）；
 * · 源分组行右键 = 「新建私密笔记」（§9.9.8）。
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '../src/components/FileTree'
import type { NoteMeta } from '../src/kernel/contract'

afterEach(cleanup)

const priv = (id: string, title: string): NoteMeta => ({
  path: `.zn/private/notes/${id}.zn`,
  id: `private:${id}`,
  title,
  mtime: 0,
  size: 0,
  frontmatter: {},
  kind: 'note',
  group: 'private',
  groupLabel: '私密笔记',
  groupIcon: '🔒',
})

function makeProps(over: Record<string, unknown> = {}) {
  return {
    notes: [priv('a1', '第一篇')],
    sourceGroups: [{ key: 'private', label: '私密笔记', icon: '🔒' }],
    dirs: [],
    activePath: null,
    vault: 'C:/vault',
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

const rowOf = (container: HTMLElement, path: string) =>
  container.querySelector(`[data-zn-path="${path}"]`) as HTMLElement

const openMenuOn = (el: HTMLElement) => {
  fireEvent.contextMenu(el, { clientX: 10, clientY: 10 })
  // 只看菜单本身 —— 树顶栏也有「新建笔记 / 新建文件夹」按钮，不能拿整页 textContent 判
  return document.querySelector('[role="menu"]')?.textContent ?? ''
}

describe('FileTree · 私密条目菜单对齐（rev173.402）', () => {
  it('右键源条目弹菜单（不再直接改名），且只出有意义的项', () => {
    const onRenameSource = vi.fn()
    const onRemoveSource = vi.fn()
    const { container } = render(
      <FileTree {...(makeProps({ onRenameSource, onRemoveSource }) as never)} />,
    )
    const text = openMenuOn(rowOf(container, '.zn/private/notes/a1.zn'))
    // 不再直接弹改名框
    expect(onRenameSource).not.toHaveBeenCalled()
    expect(text).toContain('重命名…')
    expect(text).toContain('删除（进私密回收站）')
    // §9.6：这些磁盘语义项必须**隐藏**（不是灰显）
    for (const banned of [
      '剪切',
      '复制文件',
      '创建副本',
      '粘贴',
      '在文件夹中打开',
      '新建文件',
      '新建文件夹',
      '打开时间流',
    ]) {
      expect(text).not.toContain(banned)
    }
  })

  it('菜单「删除」走 onRemoveSource，不碰磁盘删除', () => {
    const onRemoveSource = vi.fn()
    const onDeleteMany = vi.fn()
    const { container } = render(
      <FileTree {...(makeProps({ onRemoveSource, onDeleteMany }) as never)} />,
    )
    openMenuOn(rowOf(container, '.zn/private/notes/a1.zn'))
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes('删除（进私密回收站）'),
    ) as HTMLElement
    fireEvent.click(item)
    expect(onRemoveSource).toHaveBeenCalledWith('.zn/private/notes/a1.zn')
    expect(onDeleteMany).not.toHaveBeenCalled()
  })

  it('F2 / Delete 走源回调，不落到磁盘改名 / 磁盘删除', () => {
    const onRenameSource = vi.fn()
    const onRemoveSource = vi.fn()
    const onDeleteMany = vi.fn()
    const onRename = vi.fn()
    const { container } = render(
      <FileTree
        {...(makeProps({
          onRenameSource,
          onRemoveSource,
          onDeleteMany,
          onRename,
          activePath: '.zn/private/notes/a1.zn',
        }) as never)}
      />,
    )
    const tree = container.querySelector('.zn-tree') as HTMLElement
    fireEvent.keyDown(tree, { key: 'F2' })
    expect(onRenameSource).toHaveBeenCalledWith('.zn/private/notes/a1.zn')
    fireEvent.keyDown(tree, { key: 'Delete' })
    expect(onRemoveSource).toHaveBeenCalledWith('.zn/private/notes/a1.zn')
    expect(onDeleteMany).not.toHaveBeenCalled()
    expect(onRename).not.toHaveBeenCalled()
  })

  it('源分组行右键 = 「新建私密笔记」（§9.9.8）', () => {
    const onNewSourceNote = vi.fn()
    const { container } = render(
      <FileTree {...(makeProps({ onNewSourceNote }) as never)} />,
    )
    const groupRow = container.querySelector('[data-zn-path="__zn_group_private"]') as HTMLElement
    openMenuOn(groupRow)
    const item = [...document.querySelectorAll('[role="menuitem"]')].find((el) =>
      el.textContent?.includes('新建私密笔记'),
    ) as HTMLElement
    fireEvent.click(item)
    expect(onNewSourceNote).toHaveBeenCalledWith('private')
  })
})
