// @vitest-environment happy-dom
/**
 * 文件树按**真实目录**显示文档 / 图片 / 音视频（rev173.385）
 *
 * 用户要求（2026-11-06）：
 *  · 取消「附件」虚拟分组 —— 图片、视频、音频回到它们真实所在的目录；
 *  · 「文档」虚拟分组也取消（用户拍板「也取消，文档按真实目录显示」）。
 *
 * 判据：
 * · 树里**没有** `data-zn-virtual` 节点（除私密笔记那种插件分组）；
 * · 附件条目挂在 `附件/<类型>/` 的真实目录节点下，能逐层找到；
 * · 文档条目挂在它自己的目录下。
 */
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTree } from '../src/components/FileTree'
import type { NoteMeta } from '../src/kernel/contract'

afterEach(cleanup)

const meta = (path: string, title: string, kind: NoteMeta['kind']): NoteMeta => ({
  path,
  id: path,
  title,
  mtime: 0,
  size: 0,
  frontmatter: {},
  kind,
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

const rowOf = (container: HTMLElement, path: string) =>
  container.querySelector<HTMLElement>(`[data-zn-path="${path}"]`)

describe('FileTree · 文档 / 附件按真实目录显示', () => {
  it('图片 / 视频挂在 附件/<类型>/ 的真实目录下，没有虚拟分组', () => {
    const { container } = render(
      <FileTree
        {...(makeProps({
          notes: [
            meta('附件/图片/a.png', 'a.png', 'image'),
            meta('附件/视频/b.mp4', 'b.mp4', 'media'),
          ],
        }) as never)}
      />,
    )

    expect(container.querySelector('[data-zn-virtual="1"]')).toBeNull()
    expect(rowOf(container, '附件')).toBeTruthy()
    expect(rowOf(container, '附件/图片')).toBeTruthy()
    expect(rowOf(container, '附件/图片/a.png')).toBeTruthy()
    expect(rowOf(container, '附件/视频/b.mp4')).toBeTruthy()
  })

  it('文档不再聚到「文档」分组，进它自己的目录', () => {
    const { container } = render(
      <FileTree
        {...(makeProps({
          notes: [meta('资料/手册.pdf', '手册.pdf', 'doc')],
        }) as never)}
      />,
    )

    expect(container.querySelector('[data-zn-virtual="1"]')).toBeNull()
    expect(rowOf(container, '资料')).toBeTruthy()
    expect(rowOf(container, '资料/手册.pdf')).toBeTruthy()
    // 分组被取消后，树里不该再出现一个叫「文档」的虚拟分组行
    expect(
      [...container.querySelectorAll<HTMLElement>('.zn-tree-item')].find(
        (el) => el.textContent?.trim() === '文档',
      ),
    ).toBeUndefined()
  })
})
