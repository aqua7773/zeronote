// @vitest-environment happy-dom
/**
 * 文件树右键菜单里的「打开时间流」（rev173.48）。
 *
 * 判据：
 *  · 桌面传了 `onOpenTimeline` ⇒ 右键树项 / 空白处都能看到这一项；
 *  · 点了回调一次、菜单关掉；
 *  · 没传（手机端没有时间流）⇒ 这一项不出现 —— 不留一个点了没反应的死项。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
    notes: [note('a.md', '甲')],
    dirs: [],
    activePath: null,
    vault: 'C:/vault',
    onOpen: vi.fn(),
    onNewFile: vi.fn(async () => 'b.md'),
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

describe('FileTree 右键菜单：打开时间流', () => {
  it('传了回调：右键树项能看到并触发「打开时间流」', () => {
    const onOpenTimeline = vi.fn()
    render(<FileTree {...makeProps()} onOpenTimeline={onOpenTimeline} />)

    fireEvent.contextMenu(screen.getByText('a.md'))
    const item = screen.getByText('打开时间流')
    expect(item).toBeTruthy()
    fireEvent.click(item)
    expect(onOpenTimeline).toHaveBeenCalledTimes(1)
    // 点完菜单关掉
    expect(screen.queryByText('打开时间流')).toBeNull()
  })

  it('空白处右键也能看到（menu.path === null 时仍给视图开关）', () => {
    const onOpenTimeline = vi.fn()
    const { container } = render(
      <FileTree {...makeProps()} onOpenTimeline={onOpenTimeline} />,
    )
    const root = container.querySelector('.zn-filetree')
    if (!root) throw new Error('找不到文件树根')
    fireEvent.contextMenu(root)
    expect(screen.getByText('打开时间流')).toBeTruthy()
  })

  it('不传回调（手机端没有时间流）：这一项不出现', () => {
    render(<FileTree {...makeProps()} />)
    fireEvent.contextMenu(screen.getByText('a.md'))
    expect(screen.queryByText('打开时间流')).toBeNull()
  })
})
