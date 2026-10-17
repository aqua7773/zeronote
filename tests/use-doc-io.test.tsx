// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDocIO } from '../src/hooks/useDocIO'

function makeKernel() {
  return {
    fs: {
      listNotes: vi.fn(async () => [{ path: 'a.md', title: 'a' }]),
      listDirs: vi.fn(async () => ['notes']),
      readText: vi.fn(async () => 'disk'),
      writeText: vi.fn(async () => {}),
      watch: vi.fn(() => ({ dispose: vi.fn() })),
    },
  }
}

function makeArgs(kernel: ReturnType<typeof makeKernel>, over: Record<string, unknown> = {}) {
  const refs = {
    notesRef: { current: [] as unknown[] },
    contentRef: { current: 'mine' },
    activeRef: { current: 'a.md' as string | null },
    dirtyRef: { current: true },
    baseRef: { current: 'base' },
    saveNowRef: { current: async () => {} },
    timerRef: { current: null as number | null },
    docChangeTimerRef: { current: null as number | null },
    docPendingRef: { current: null as { path: string; content: string } | null },
    externalReloadRef: { current: false },
  }
  return {
    kernel: kernel as never,
    fireDoc: vi.fn(),
    flushDocChange: vi.fn(),
    pluginWindowId: null,
    refs,
    setNotes: vi.fn(),
    setDirs: vi.fn(),
    setError: vi.fn(),
    setContent: vi.fn(),
    setDirty: vi.fn(),
    setSaveState: vi.fn(),
    setToast: vi.fn(),
    autosaveMs: 800,
    docChangeDebounceMs: 200,
    ...over,
  }
}

describe('useDocIO', () => {
  it('refresh：拉笔记与目录，并写入 notesRef', async () => {
    const k = makeKernel()
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocIO(args))
    await act(async () => {
      await result.current.refresh()
    })
    expect(k.fs.listNotes).toHaveBeenCalled()
    expect(k.fs.listDirs).toHaveBeenCalled()
    expect(args.setNotes).toHaveBeenCalledWith([{ path: 'a.md', title: 'a' }])
    expect(args.setDirs).toHaveBeenCalledWith(['notes'])
    expect(args.refs.notesRef.current).toHaveLength(1)
  })

  it('saveNow：写盘成功 ⇒ saved + 广播 save', async () => {
    const k = makeKernel()
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocIO(args))
    await act(async () => {
      await result.current.saveNow()
    })
    expect(k.fs.writeText).toHaveBeenCalledWith('a.md', expect.any(String))
    expect(args.setSaveState).toHaveBeenCalledWith('saved')
    expect(args.fireDoc).toHaveBeenCalledWith('save', 'a.md', expect.any(String), false)
  })

  it('saveNow：磁盘没变（theirs === base）⇒ 不合并，直接写内存内容', async () => {
    const k = makeKernel()
    k.fs.readText.mockResolvedValueOnce('base')
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocIO(args))
    await act(async () => {
      await result.current.saveNow()
    })
    expect(k.fs.writeText).toHaveBeenCalledWith('a.md', 'mine')
  })

  it('saveNow：写盘失败 ⇒ error 状态 + 不广播 save', async () => {
    const k = makeKernel()
    k.fs.writeText.mockRejectedValueOnce(new Error('disk full'))
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocIO(args))
    await act(async () => {
      await result.current.saveNow()
    })
    expect(args.setSaveState).toHaveBeenCalledWith('error')
    expect(args.fireDoc).not.toHaveBeenCalledWith('save', expect.anything(), expect.anything(), false)
  })

  it('onEditorChange：更新内容 + 标记脏 + 启动自动保存计时', () => {
    vi.useFakeTimers()
    const k = makeKernel()
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocIO(args))
    act(() => result.current.onEditorChange('next'))
    expect(args.setContent).toHaveBeenCalledWith('next')
    expect(args.setDirty).toHaveBeenCalledWith(true)
    expect(args.refs.timerRef.current).not.toBeNull()
    vi.useRealTimers()
  })

  it('onEditorChange：外部重载引起的那次回调被跳过', () => {
    const k = makeKernel()
    const args = makeArgs(k)
    args.refs.externalReloadRef.current = true
    const { result } = renderHook(() => useDocIO(args))
    act(() => result.current.onEditorChange('next'))
    expect(args.setContent).not.toHaveBeenCalled()
    expect(args.refs.externalReloadRef.current).toBe(false)
  })

  it('onEditorChange：有打开的笔记时挂起 change 并去抖广播', () => {
    vi.useFakeTimers()
    const k = makeKernel()
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocIO(args))
    act(() => result.current.onEditorChange('next'))
    expect(args.refs.docPendingRef.current).toEqual({ path: 'a.md', content: 'next' })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(args.flushDocChange).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('reloadActiveFromDisk：内容不同 ⇒ 整篇替换 + 广播 open', async () => {
    const k = makeKernel()
    k.fs.readText.mockResolvedValueOnce('new text')
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocIO(args))
    let changed = false
    await act(async () => {
      changed = await result.current.reloadActiveFromDisk()
    })
    expect(changed).toBe(true)
    expect(args.setContent).toHaveBeenCalledWith('new text')
    expect(args.fireDoc).toHaveBeenCalledWith('open', 'a.md', 'new text', false)
  })

  it('reloadActiveFromDisk：内容相同 ⇒ 不动编辑器', async () => {
    const k = makeKernel()
    k.fs.readText.mockResolvedValueOnce('mine')
    const args = makeArgs(k)
    const { result } = renderHook(() => useDocIO(args))
    await act(async () => {
      await result.current.reloadActiveFromDisk()
    })
    expect(args.setContent).not.toHaveBeenCalled()
  })
})
