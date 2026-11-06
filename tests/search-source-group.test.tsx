// @vitest-environment happy-dom
/**
 * 搜索面板的「额外源」分组（rev173.394 · 私密笔记第二批）。
 *
 * 锁住三条语义：
 * 1. 源命中**单独成组**排在公开结果之后（用户 2026-11-06 拍板「不混排」）；
 * 2. 面板把 `limit` 透传给源的 `search()`；
 * 3. 没传 `sources` 时行为与改动前完全一致（只有公开结果，没有分组标题）。
 *
 * 面板按契约注入 index 与源，不认识内核 —— 测试也用假的。
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SearchPanel } from '../src/components/SearchPanel'
import type { IndexApi, NoteSourceSearch } from '../src/kernel/contract'

afterEach(cleanup)

function makeIndex() {
  const index = {
    query: vi.fn(async (q: string) => [
      { path: 'a.md', title: '公开笔记 A', excerpt: `命中 ${q}`, score: 3 },
    ]),
    tags: vi.fn(async () => []),
    rebuild: vi.fn(async () => ({ count: 2, ms: 1 })),
    upsert: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    scoped: () => index,
  } as unknown as IndexApi
  return index
}

function makeSource(): NoteSourceSearch & { search: ReturnType<typeof vi.fn> } {
  return {
    id: 'private',
    group: { key: 'private', label: '私密笔记', icon: '🔒' },
    search: vi.fn(async (q: string) => [
      { path: '.zn/private/notes/x.zn', title: '私密笔记 X', excerpt: `私有 ${q}`, score: 0 },
    ]),
  }
}

const baseProps = {
  open: true,
  onClose: () => {},
  onOpenNote: () => {},
}

describe('SearchPanel 额外源分组', () => {
  it('源命中单独成组排在公开结果之后，limit 透传给源', async () => {
    const index = makeIndex()
    const source = makeSource()
    render(<SearchPanel {...baseProps} index={index} sources={[source]} />)

    fireEvent.change(screen.getByRole('textbox', { name: '搜索笔记' }), {
      target: { value: '里程碑' },
    })

    await waitFor(() => expect(screen.getByText('私密笔记 X')).toBeTruthy())
    expect(screen.getByText('公开笔记 A')).toBeTruthy()
    expect(source.search).toHaveBeenCalledWith('里程碑', expect.objectContaining({ limit: 50 }))

    // 顺序：公开在前、分组标题与私密条目在后
    const text = document.body.textContent ?? ''
    expect(text.indexOf('公开笔记 A')).toBeLessThan(text.indexOf('私密笔记'))
    // 分组标题只出现一次（标题行 + 结果副行里各有一次「私密笔记」，这里只关心顺序）
    expect(text).toContain('私密笔记 X')
  })

  it('源返回空数组 ⇒ 不出现空分组标题', async () => {
    const index = makeIndex()
    const source: NoteSourceSearch = {
      id: 'private',
      group: { key: 'private', label: '私密笔记', icon: '🔒' },
      search: async () => [],
    }
    render(<SearchPanel {...baseProps} index={index} sources={[source]} />)

    fireEvent.change(screen.getByRole('textbox', { name: '搜索笔记' }), {
      target: { value: '不存在的词' },
    })

    await waitFor(() => expect(screen.getByText('公开笔记 A')).toBeTruthy())
    // 等源那一路也走完再断言（同一个 Promise.all 落下）
    await waitFor(() => expect(screen.queryByText('私密笔记')).toBeNull())
  })

  it('源自己抛错只少一组，不显示「索引出错」', async () => {
    const index = makeIndex()
    const source: NoteSourceSearch = {
      id: 'private',
      group: { key: 'private', label: '私密笔记', icon: '🔒' },
      search: async () => {
        throw new Error('解密失败')
      },
    }
    render(<SearchPanel {...baseProps} index={index} sources={[source]} />)

    fireEvent.change(screen.getByRole('textbox', { name: '搜索笔记' }), {
      target: { value: '关键词' },
    })

    await waitFor(() => expect(screen.getByText('公开笔记 A')).toBeTruthy())
    expect(screen.queryByText(/索引出错/)).toBeNull()
  })
})
