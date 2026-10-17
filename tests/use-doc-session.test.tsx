// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDocSession } from '../src/hooks/useDocSession'

function makeKernel() {
  return {
    fs: {
      readText: vi.fn(async () => 'hello'),
    },
  }
}

function makeArgs(kernel: ReturnType<typeof makeKernel>, over: Record<string, unknown> = {}) {
  const refs = {
    activeRef: { current: null as string | null },
    contentRef: { current: '' },
    dirtyRef: { current: false },
    baseRef: { current: '' },
    frontmatterRef: { current: {} as Record<string, unknown> },
    notesRef: { current: [] as unknown[] },
    saveNowRef: { current: vi.fn(async () => {}) },
    openNoteRef: { current: async () => {} },
  }
  return {
    kernel: kernel as never,
    notes: [] as { path: string; title: string; id?: string }[],
    fireDoc: vi.fn(),
    flushDocChange: vi.fn(),
    refs,
    setActivePath: vi.fn(),
    setContent: vi.fn(),
    setDirty: vi.fn(),
    setSaveState: vi.fn(),
    setError: vi.fn(),
    setToast: vi.fn(),
    setSidebarOpen: vi.fn(),
    ...over,
  }
}

describe('useDocSession', () => {
  it('openNote：读盘 → 设内容/路径 + 广播 open', async () => {
    const k = makeKernel()
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocSession(args))
    await act(async () => {
      await result.current.openNote('a.md')
    })
    expect(k.fs.readText).toHaveBeenCalledWith('a.md')
    expect(args.setContent).toHaveBeenCalledWith('hello')
    expect(args.setActivePath).toHaveBeenCalledWith('a.md')
    expect(args.refs.baseRef.current).toBe('hello')
    expect(args.fireDoc).toHaveBeenCalledWith('open', 'a.md', 'hello', false)
  })

  it('openNote：有未保存内容 ⇒ 先 saveNow', async () => {
    const k = makeKernel()
    const args = makeArgs(k)
    args.refs.dirtyRef.current = true
    const { result } = renderHook(() => useDocSession(args))
    await act(async () => {
      await result.current.openNote('a.md')
    })
    expect(args.refs.saveNowRef.current).toHaveBeenCalledTimes(1)
  })

  it('openNote：已经是当前笔记 ⇒ 什么都不做', async () => {
    const k = makeKernel()
    const args = makeArgs(k)
    args.refs.activeRef.current = 'a.md'
    const { result } = renderHook(() => useDocSession(args))
    await act(async () => {
      await result.current.openNote('a.md')
    })
    expect(k.fs.readText).not.toHaveBeenCalled()
  })

  it('openNote：读盘失败 ⇒ 报错、不清空当前文档', async () => {
    const k = makeKernel()
    k.fs.readText.mockRejectedValueOnce(new Error('gone'))
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocSession(args))
    await act(async () => {
      await result.current.openNote('a.md')
    })
    expect(args.setError).toHaveBeenCalled()
    expect(args.setContent).not.toHaveBeenCalled()
  })

  it('openNote：从 notesRef 取 frontmatter', async () => {
    const k = makeKernel()
    const args = makeArgs(k)
    args.refs.notesRef.current = [{ path: 'a.md', frontmatter: { tag: 'x' } }]
    const { result } = renderHook(() => useDocSession(args))
    await act(async () => {
      await result.current.openNote('a.md')
    })
    expect(args.refs.frontmatterRef.current).toEqual({ tag: 'x' })
  })

  it('closeNote：清空四个状态 + 广播 close', async () => {
    const k = makeKernel()
    const args = makeArgs(k)
    args.refs.activeRef.current = 'a.md'
    args.refs.contentRef.current = 'body'
    const { result } = renderHook(() => useDocSession(args))
    await act(async () => {
      await result.current.closeNote()
    })
    expect(args.setActivePath).toHaveBeenCalledWith(null)
    expect(args.setContent).toHaveBeenCalledWith('')
    expect(args.setDirty).toHaveBeenCalledWith(false)
    expect(args.fireDoc).toHaveBeenCalledWith('close', 'a.md', 'body', false)
  })

  it('closeNote：有未保存内容 ⇒ 先落盘', async () => {
    const k = makeKernel()
    const args = makeArgs(k)
    args.refs.dirtyRef.current = true
    const { result } = renderHook(() => useDocSession(args))
    await act(async () => {
      await result.current.closeNote()
    })
    expect(args.refs.saveNowRef.current).toHaveBeenCalled()
  })

  it('openWikiLink：按 id / 路径 / 后缀 / 标题依次命中', async () => {
    const k = makeKernel()
    const notes = [
      { id: 'n1', path: '日记/今天.md', title: '今天' },
      { id: 'n2', path: 'b.md', title: 'B' },
    ]
    const args = makeArgs(k, { notes })
    const { result } = renderHook(() => useDocSession(args))
    await act(async () => {
      result.current.openWikiLink('b')
    })
    expect(k.fs.readText).toHaveBeenCalledWith('b.md')
  })

  it('openWikiLink：找不到 ⇒ 提示', () => {
    const k = makeKernel()
    const args = makeArgs(k, { notes: [] })
    const { result } = renderHook(() => useDocSession(args))
    act(() => result.current.openWikiLink('missing'))
    expect(args.setToast).toHaveBeenCalledWith('没有找到「missing」这篇笔记')
  })

  it('openNoteRef 在挂载后同步为最新的 openNote', async () => {
    const k = makeKernel()
    const args = makeArgs(k)
    renderHook(() => useDocSession(args))
    await act(async () => {
      await args.refs.openNoteRef.current('x.md')
    })
    expect(k.fs.readText).toHaveBeenCalledWith('x.md')
  })
})
