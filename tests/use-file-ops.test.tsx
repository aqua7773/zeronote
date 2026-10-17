// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFileOps } from '../src/hooks/useFileOps'

/** 最小假内核：只实现本 hook 会碰到的 fs 方法 */
function makeKernel() {
  return {
    fs: {
      exists: vi.fn(async () => false),
      copy: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      delete: vi.fn(async (p: string) => `.zn/trash/1/${p}`),
      listTrash: vi.fn(async () => [] as { id: string; originalPath?: string }[]),
      restoreTrash: vi.fn(async (id: string) => `/back/${id}`),
      purgeTrash: vi.fn(async () => {}),
      emptyTrash: vi.fn(async () => 3),
      rename: vi.fn(async () => {}),
    },
  }
}

function makeArgs(kernel: ReturnType<typeof makeKernel>, over: Record<string, unknown> = {}) {
  return {
    kernel: kernel as never,
    refresh: vi.fn(async () => {}),
    activeRef: { current: null },
    dirtyRef: { current: false },
    saveNowRef: { current: async () => {} },
    setActivePath: vi.fn(),
    setContent: vi.fn(),
    setDirty: vi.fn(),
    setSaveState: vi.fn(),
    setError: vi.fn(),
    setToast: vi.fn(),
    setMainView: vi.fn(),
    ...over,
  }
}

describe('useFileOps', () => {
  it('剪切：设置剪贴板 + 提示', () => {
    const k = makeKernel()
    const { result } = renderHook(() => useFileOps(makeArgs(k)))
    act(() => result.current.cutPaths(['a.md']))
    expect(result.current.clipboard).toEqual({ mode: 'cut', paths: ['a.md'] })
    expect(result.current.fmtSize(2048)).toBe('2.0 KB')
  })

  it('复制：设置剪贴板（多选提示带数量）', () => {
    const k = makeKernel()
    const toast = vi.fn()
    const { result } = renderHook(() => useFileOps(makeArgs(k, { setToast: toast })))
    act(() => result.current.copyPaths(['a.md', 'b.md']))
    expect(result.current.clipboard).toEqual({ mode: 'copy', paths: ['a.md', 'b.md'] })
    expect(toast).toHaveBeenCalledWith('已复制 2 项')
  })

  it('空选择不设置剪贴板', () => {
    const k = makeKernel()
    const { result } = renderHook(() => useFileOps(makeArgs(k)))
    act(() => result.current.cutPaths([]))
    expect(result.current.clipboard).toBeNull()
  })

  it('粘贴复制：目标已存在 ⇒ 自动退成「 副本」', async () => {
    const k = makeKernel()
    // 「a 副本.md」已被占用一次 ⇒ 递增到「a 副本 2.md」（后续 exists 返回 falsy）
    k.fs.exists.mockResolvedValueOnce(true)
    const { result } = renderHook(() => useFileOps(makeArgs(k)))
    act(() => result.current.copyPaths(['a.md']))
    await act(async () => {
      await result.current.pasteInto('')
    })
    expect(k.fs.copy).toHaveBeenCalledWith('a.md', 'a 副本 2.md')
  })

  it('粘贴剪切：目标已存在 ⇒ 报错（不覆盖）', async () => {
    const k = makeKernel()
    k.fs.exists.mockResolvedValueOnce(true)
    const setError = vi.fn()
    const { result } = renderHook(() => useFileOps(makeArgs(k, { setError })))
    act(() => result.current.cutPaths(['a.md']))
    await act(async () => {
      await result.current.pasteInto('')
    })
    expect(k.fs.move).not.toHaveBeenCalled()
    expect(setError).toHaveBeenCalled()
  })

  it('粘贴剪切：粘回原位静默跳过', async () => {
    const k = makeKernel()
    const { result } = renderHook(() => useFileOps(makeArgs(k)))
    act(() => result.current.cutPaths(['a.md']))
    await act(async () => {
      await result.current.pasteInto('')
    })
    expect(k.fs.move).not.toHaveBeenCalled()
    expect(result.current.clipboard).toBeNull()
  })

  it('删除：逐个 delete 并挂上撤销条', async () => {
    const k = makeKernel()
    const setUndoToast = vi.fn()
    const { result } = renderHook(() => useFileOps(makeArgs(k, { setToast: setUndoToast })))
    await act(async () => {
      await result.current.deleteNotes(['a.md', 'b.md'])
    })
    expect(k.fs.delete).toHaveBeenCalledTimes(2)
    expect(result.current.undoDelete).toHaveLength(2)
  })

  it('删除打开着的笔记 ⇒ 清空编辑器四个状态', async () => {
    const k = makeKernel()
    const activeRef = { current: 'a.md' }
    const setActivePath = vi.fn()
    const setContent = vi.fn()
    const setDirty = vi.fn()
    const setSaveState = vi.fn()
    const { result } = renderHook(() =>
      useFileOps(
        makeArgs(k, { activeRef, setActivePath, setContent, setDirty, setSaveState }),
      ),
    )
    await act(async () => {
      await result.current.deleteNotes(['a.md'])
    })
    expect(setActivePath).toHaveBeenCalledWith(null)
    expect(setContent).toHaveBeenCalledWith('')
    expect(setDirty).toHaveBeenCalledWith(false)
    expect(setSaveState).toHaveBeenCalledWith('idle')
  })

  it('撤销删除：按 .zn/trash/<id>/ 取 id 调 restoreTrash', async () => {
    const k = makeKernel()
    const { result } = renderHook(() => useFileOps(makeArgs(k)))
    await act(async () => {
      await result.current.deleteNotes(['a.md'])
    })
    await act(async () => {
      await result.current.undoDeleteNote()
    })
    expect(k.fs.restoreTrash).toHaveBeenCalledWith('1')
    expect(result.current.undoDelete).toBeNull()
  })

  it('彻底删除：delete → listTrash 找 originalPath → purgeTrash', async () => {
    const k = makeKernel()
    k.fs.listTrash.mockResolvedValueOnce([{ id: '7', originalPath: 'a.md' }])
    const { result } = renderHook(() => useFileOps(makeArgs(k)))
    await act(async () => {
      await result.current.purgeNotes(['a.md'])
    })
    expect(k.fs.delete).toHaveBeenCalledWith('a.md')
    expect(k.fs.purgeTrash).toHaveBeenCalledWith('7')
  })

  it('清空回收站：调 emptyTrash 并复位确认态', async () => {
    const k = makeKernel()
    const { result } = renderHook(() => useFileOps(makeArgs(k)))
    await act(async () => {
      await result.current.emptyTrashAll()
    })
    expect(k.fs.emptyTrash).toHaveBeenCalled()
    expect(result.current.confirmEmpty).toBe(false)
  })
})
