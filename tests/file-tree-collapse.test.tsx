// @vitest-environment happy-dom
/**
 * 文件树展开状态持久化（rev169 · 2026-10-18 用户要求
 * 「文件树现在是每次进入都会展开，设置成默认记住上次状态」）。
 *
 * 判据：
 *  · 没记录 ⇒ 全展开（升级前观感不变）；
 *  · 折叠一个目录 ⇒ 写 localStorage（按库隔离）；
 *  · 重新挂载（= 重开应用 / 切回该库）⇒ 那个目录仍是折叠的；
 *  · 再点一次展开 ⇒ 记录被移除（回到默认全展开）。
 */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '../src/components/FileTree'
import type { NoteMeta } from '../src/kernel/contract'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

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
    notes: [note('dir/a.md', 'a')],
    dirs: ['dir'],
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

/** 目录 `dir` 那一行（树里目录优先，它是第一行） */
function dirRow(container: HTMLElement): HTMLElement {
  const row = [...container.querySelectorAll('.zn-tree-item')].find((el) =>
    el.textContent?.includes('dir'),
  )
  if (!row) throw new Error('找不到目录行')
  return row as HTMLElement
}

describe('FileTree 展开状态记忆', () => {
  it('默认全展开（无记录时与旧行为一致）', () => {
    const { container } = render(<FileTree {...(makeProps() as never)} />)
    expect(dirRow(container).textContent).toContain('▾')
    expect(container.textContent).toContain('a.md')
  })

  it('折叠后写 localStorage；重新挂载仍是折叠的', () => {
    const props = makeProps()
    const { container, unmount } = render(<FileTree {...(props as never)} />)

    fireEvent.click(dirRow(container))
    // 折叠：三角变 ▸、子行消失
    expect(dirRow(container).textContent).toContain('▸')
    expect(container.textContent).not.toContain('a.md')
    // 落盘（key 带库路径 ⇒ 按库隔离）
    const raw = localStorage.getItem('zn-tree-collapsed:C:/vault')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toContain('dir')

    // 重新挂载 = 重开应用；应恢复成折叠
    unmount()
    const { container: again } = render(<FileTree {...(props as never)} />)
    expect(again.textContent).not.toContain('a.md')
    expect(dirRow(again).textContent).toContain('▸')
  })

  it('再点一次展开 ⇒ 记录被移除（回到默认全展开）', () => {
    const props = makeProps()
    const { container } = render(<FileTree {...(props as never)} />)

    fireEvent.click(dirRow(container)) // 折
    fireEvent.click(dirRow(container)) // 展开
    expect(container.textContent).toContain('a.md')
    expect(localStorage.getItem('zn-tree-collapsed:C:/vault')).toBeNull()
  })

  it('换库不串状态（另一个库默认全展开）', () => {
    localStorage.setItem('zn-tree-collapsed:C:/vault', JSON.stringify(['dir']))
    const { container } = render(
      <FileTree {...(makeProps({ vault: 'D:/other' }) as never)} />
    )
    expect(container.textContent).toContain('a.md')
    expect(dirRow(container).textContent).toContain('▾')
  })
})
