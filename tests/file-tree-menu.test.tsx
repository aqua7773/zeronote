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

/**
 * 条目菜单动作（rev173.281 · J#18）—— 插件贡献的菜单项。
 *
 * 组件只做三件事：按 `where` / `kinds` 过滤、渲染（含一层子菜单）、
 * 点击时把「点的哪个条目」作为参数交给 App。协议本身在 `item-menu.test.ts`。
 */
describe('FileTree 右键菜单：插件条目动作', () => {
  const fileActions = (over: Record<string, unknown>[] = [{}]) =>
    over.map((o) => ({
      command: 'io.exportTxt',
      title: '导出为 txt…',
      pluginId: 'import-export',
      ...o,
    }))

  it('传了 itemActions：右键文件能看到并触发，参数带 path / kind / where', () => {
    const onItemAction = vi.fn()
    render(
      <FileTree
        {...makeProps()}
        itemActions={fileActions()}
        onItemAction={onItemAction}
      />,
    )
    fireEvent.contextMenu(screen.getByText('a.md'))
    const item = screen.getByText('导出为 txt…')
    fireEvent.click(item)
    expect(onItemAction).toHaveBeenCalledTimes(1)
    expect(onItemAction.mock.calls[0][0]).toMatchObject({ command: 'io.exportTxt' })
    expect(onItemAction.mock.calls[0][1]).toEqual({
      path: 'a.md',
      kind: 'note',
      where: 'file-tree',
    })
    // 点完菜单关闭
    expect(screen.queryByText('导出为 txt…')).toBeNull()
  })

  it('kinds 缺省只给笔记：右键文件夹不出现', () => {
    render(
      <FileTree
        {...makeProps({ notes: [], dirs: ['文件夹'] })}
        itemActions={fileActions()}
        onItemAction={vi.fn()}
      />,
    )
    fireEvent.contextMenu(screen.getByText('文件夹'))
    expect(screen.queryByText('导出为 txt…')).toBeNull()
  })

  it('声明 kinds: [dir] 的动作只在文件夹上出现', () => {
    const onItemAction = vi.fn()
    render(
      <FileTree
        {...makeProps({ notes: [], dirs: ['文件夹'] })}
        itemActions={fileActions([{ kinds: ['dir'], command: 'io.dir', title: '目录动作' }])}
        onItemAction={onItemAction}
      />,
    )
    fireEvent.contextMenu(screen.getByText('文件夹'))
    fireEvent.click(screen.getByText('目录动作'))
    expect(onItemAction.mock.calls[0][1]).toMatchObject({ kind: 'dir', where: 'file-tree' })
  })

  it('where 只写 timeline 的动作不出现在文件树', () => {
    render(
      <FileTree
        {...makeProps()}
        itemActions={fileActions([{ where: ['timeline'] }])}
        onItemAction={vi.fn()}
      />,
    )
    fireEvent.contextMenu(screen.getByText('a.md'))
    expect(screen.queryByText('导出为 txt…')).toBeNull()
  })

  it('一层子菜单：点父项展开，点子项执行', () => {
    const onItemAction = vi.fn()
    render(
      <FileTree
        {...makeProps()}
        itemActions={fileActions([
          {
            title: '导出为…',
            children: [
              { command: 'io.txt', title: '纯文本' },
              { command: 'io.html', title: '网页' },
            ],
          },
        ])}
        onItemAction={onItemAction}
      />,
    )
    fireEvent.contextMenu(screen.getByText('a.md'))
    fireEvent.click(screen.getByText('导出为…'))
    fireEvent.click(screen.getByText('网页'))
    expect(onItemAction).toHaveBeenCalledTimes(1)
    expect(onItemAction.mock.calls[0][0]).toMatchObject({ command: 'io.html' })
    expect(onItemAction.mock.calls[0][1]).toMatchObject({ path: 'a.md' })
  })

  it('多选时把整批 paths 一起交给插件', () => {
    const onItemAction = vi.fn()
    render(
      <FileTree
        {...makeProps({ notes: [note('a.md', '甲'), note('b.md', '乙')] })}
        itemActions={fileActions()}
        onItemAction={onItemAction}
      />,
    )
    // 右键 a → 点「多选」→ 再点 b ⇒ 选中 ≥2 项直接弹批量菜单
    fireEvent.contextMenu(screen.getByText('a.md'))
    fireEvent.click(screen.getByText('多选'))
    fireEvent.click(screen.getByText('b.md'))
    fireEvent.click(screen.getByText('导出为 txt…'))
    expect(onItemAction).toHaveBeenCalledTimes(1)
    expect(onItemAction.mock.calls[0][1]).toMatchObject({
      // 批量菜单的 focus = 最后点的那条（openBatchMenu），整批路径一起交给插件
      path: 'b.md',
      paths: ['a.md', 'b.md'],
    })
  })

  it('不传 itemActions：菜单里没有插件项', () => {
    render(<FileTree {...makeProps()} onItemAction={vi.fn()} />)
    fireEvent.contextMenu(screen.getByText('a.md'))
    expect(screen.queryByText('导出为 txt…')).toBeNull()
  })
})
