// @vitest-environment happy-dom
/**
 * 文件树里的「额外笔记源」分组（rev173.376 · 私密笔记改造 §4.2/§4.3）
 *
 * 判据：
 * · 带 `group` 的条目收进一个虚拟分组，分组行显示图标 + 名称 + 条数；
 * · 组内条目显示**标题**（磁盘名是随机 id，不能直接露给用户）；
 * · 点条目照常 `onOpen(真实路径)` —— 打开链路与普通笔记一致；
 * · 源返回空（锁定）⇒ 根本没有这个分组。
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
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
    notes: [],
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

describe('FileTree · 额外笔记源分组', () => {
  it('带 group 的条目收进虚拟分组，并显示图标 + 条数', () => {
    const { container } = render(
      <FileTree
        {...(makeProps({ notes: [priv('a1', '第一篇'), priv('b2', '第二篇')] }) as never)}
      />,
    )
    expect(container.textContent).toContain('🔒 私密笔记')
    expect(container.textContent).toContain('第一篇')
    expect(container.textContent).toContain('第二篇')

    const groupRow = [...container.querySelectorAll('.zn-tree-item')].find((el) =>
      el.textContent?.includes('私密笔记'),
    )
    expect(groupRow?.textContent).toContain('2')
  })

  it('组内条目显示标题，不暴露随机文件名', () => {
    const { container } = render(
      <FileTree {...(makeProps({ notes: [priv('a1', '会议纪要')] }) as never)} />,
    )
    expect(container.textContent).toContain('会议纪要')
    expect(container.textContent).not.toContain('a1.zn')
  })

  it('点组内条目 ⇒ onOpen 收到真实磁盘路径', () => {
    const onOpen = vi.fn()
    const { container } = render(
      <FileTree {...(makeProps({ notes: [priv('a1', '会议纪要')], onOpen }) as never)} />,
    )
    const row = [...container.querySelectorAll<HTMLElement>('[data-zn-path]')].find(
      (el) => el.dataset.znPath === '.zn/private/notes/a1.zn',
    )
    expect(row).toBeTruthy()
    fireEvent.click(row!)
    expect(onOpen).toHaveBeenCalledWith('.zn/private/notes/a1.zn')
  })

  it('0 条目但分组声明可见（解锁了空库）⇒ 组行仍在，并给出「拖进来」提示', () => {
    const { container } = render(
      <FileTree
        {...(makeProps({
          notes: [note('公开.md', '公开')],
          sourceGroups: [{ key: 'private', label: '私密笔记', icon: '🔒' }],
        }) as never)}
      />,
    )
    // rev173.401：空组是「拖入」的唯一落点，没有它用户永远搬不进第一篇
    expect(container.textContent).toContain('私密笔记')
    expect(container.textContent).toContain('把笔记拖到这里')
  })

  it('源返回空（锁定）⇒ 文件树里没有这个分组', () => {
    const { container } = render(
      <FileTree {...(makeProps({ notes: [note('公开.md', '公开')] }) as never)} />,
    )
    expect(container.textContent).toContain('公开.md')
    expect(container.textContent).not.toContain('私密笔记')
  })
})
