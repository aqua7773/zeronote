// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useDocApi } from '../src/hooks/useDocApi'
import type { NoteDoc } from '../src/kernel/contract'

/** 最小 CM6 EditorView 替身：正好覆盖 docApi 用到的那几个成员 */
function makeView(doc = 'abcdef') {
  return {
    state: {
      doc: { length: doc.length },
      selection: { main: { from: 1, to: 3, head: 1 } },
      sliceDoc: (from: number, to: number) => doc.slice(from, to),
    },
    dispatch: vi.fn(),
    focus: vi.fn(),
  }
}

function makeArgs(over: Record<string, unknown> = {}) {
  const refs = {
    docSubsRef: { current: new Map() as Map<string, Set<(d: NoteDoc) => void>> },
    frontmatterRef: { current: {} as Record<string, unknown> },
    activeRef: { current: null as string | null },
    contentRef: { current: '' },
    dirtyRef: { current: false },
    baseRef: { current: '' },
    editorRef: { current: null as ReturnType<typeof makeView> | null },
    docPendingRef: { current: null as { path: string; content: string } | null },
    docChangeTimerRef: { current: null as number | null },
    saveNowRef: { current: vi.fn(async () => {}) },
    openNoteRef: { current: vi.fn(async () => {}) },
  }
  return {
    refs,
    setActivePath: vi.fn(),
    setContent: vi.fn(),
    setDirty: vi.fn(),
    ...over,
  }
}

function render(args: ReturnType<typeof makeArgs>) {
  return renderHook(() => useDocApi(args as never)).result
}

describe('useDocApi', () => {
  it('active：没打开文档 ⇒ null', () => {
    const args = makeArgs()
    const r = render(args)
    expect(r.current.docApi.active()).toBeNull()
  })

  it('active：返回实时快照（path/content/frontmatter/dirty 读 ref）', () => {
    const args = makeArgs()
    args.refs.activeRef.current = 'a.md'
    args.refs.contentRef.current = 'hello'
    args.refs.frontmatterRef.current = { tag: 'x' }
    args.refs.dirtyRef.current = true
    const r = render(args)
    expect(r.current.docApi.active()).toEqual({
      path: 'a.md',
      content: 'hello',
      frontmatter: { tag: 'x' },
      dirty: true,
    })
  })

  it('open：转发给 openNoteRef 的最新引用', async () => {
    const args = makeArgs()
    const r = render(args)
    await act(async () => {
      await r.current.docApi.open('x.md')
    })
    expect(args.refs.openNoteRef.current).toHaveBeenCalledWith('x.md')
  })

  it('close：清空状态 + 在清空之前取快照广播 close', () => {
    const args = makeArgs()
    args.refs.activeRef.current = 'a.md'
    args.refs.contentRef.current = 'body'
    args.refs.frontmatterRef.current = { tag: 'x' }
    const r = render(args)
    act(() => r.current.docApi.close())
    expect(args.setActivePath).toHaveBeenCalledWith(null)
    expect(args.setContent).toHaveBeenCalledWith('')
    expect(args.setDirty).toHaveBeenCalledWith(false)
    expect(args.refs.baseRef.current).toBe('')
    expect(args.refs.frontmatterRef.current).toEqual({})
    // 订阅者拿到的是清空前的快照
    const seen: NoteDoc[] = []
    r.current.docApi.on('close', (d) => seen.push(d))
    args.refs.activeRef.current = 'b.md'
    args.refs.contentRef.current = 'B'
    act(() => r.current.docApi.close())
    expect(seen.at(-1)).toMatchObject({ path: 'b.md', content: 'B', dirty: false })
  })

  it('close：先兑现挂起的 change（乱序修复）', () => {
    const args = makeArgs()
    args.refs.activeRef.current = 'a.md'
    args.refs.docPendingRef.current = { path: 'a.md', content: 'pending' }
    const r = render(args)
    const order: string[] = []
    r.current.docApi.on('change', () => order.push('change'))
    r.current.docApi.on('close', () => order.push('close'))
    act(() => r.current.docApi.close())
    expect(order).toEqual(['change', 'close'])
  })

  it('save：转发给 saveNowRef', async () => {
    const args = makeArgs()
    const r = render(args)
    await act(async () => {
      await r.current.docApi.save()
    })
    expect(args.refs.saveNowRef.current).toHaveBeenCalled()
  })

  it('selection：无编辑器 ⇒ null；有 ⇒ 返回当前选区文本', () => {
    const args = makeArgs()
    const r = render(args)
    expect(r.current.docApi.selection()).toBeNull()
    args.refs.editorRef.current = makeView('abcdef')
    expect(r.current.docApi.selection()).toEqual({ from: 1, to: 3, text: 'bc' })
  })

  it('replaceSelection：按选区替换并聚焦', () => {
    const args = makeArgs()
    const v = makeView()
    args.refs.editorRef.current = v
    const r = render(args)
    r.current.docApi.replaceSelection('X')
    expect(v.dispatch).toHaveBeenCalledWith({ changes: { from: 1, to: 3, insert: 'X' } })
    expect(v.focus).toHaveBeenCalled()
  })

  it('insertAtCursor：光标处插入、光标落在插入内容之后', () => {
    const args = makeArgs()
    const v = makeView()
    args.refs.editorRef.current = v
    const r = render(args)
    r.current.docApi.insertAtCursor('XY')
    expect(v.dispatch).toHaveBeenCalledWith({
      changes: { from: 1, insert: 'XY' },
      selection: { anchor: 3 },
    })
  })

  it('insertAt：偏移夹紧到文档范围内', () => {
    const args = makeArgs()
    const v = makeView('abcdef')
    args.refs.editorRef.current = v
    const r = render(args)
    r.current.docApi.insertAt(-5, '!')
    expect(v.dispatch).toHaveBeenLastCalledWith({
      changes: { from: 0, insert: '!' },
      selection: { anchor: 1 },
    })
    r.current.docApi.insertAt(999, '!')
    expect(v.dispatch).toHaveBeenLastCalledWith({
      changes: { from: 6, insert: '!' },
      selection: { anchor: 7 },
    })
  })

  it('insertAt：cursorOffset 越界夹进 [0, text.length]', () => {
    const args = makeArgs()
    const v = makeView()
    args.refs.editorRef.current = v
    const r = render(args)
    r.current.docApi.insertAt(0, 'ab', 99)
    expect(v.dispatch).toHaveBeenLastCalledWith({
      changes: { from: 0, insert: 'ab' },
      selection: { anchor: 2 },
    })
  })

  it('replaceRange：from/to 颠倒自动交换，两端夹紧', () => {
    const args = makeArgs()
    const v = makeView('abcdef')
    args.refs.editorRef.current = v
    const r = render(args)
    r.current.docApi.replaceRange(4, 2, 'X')
    expect(v.dispatch).toHaveBeenLastCalledWith({
      changes: { from: 2, to: 4, insert: 'X' },
      selection: { anchor: 3 },
    })
    r.current.docApi.replaceRange(-1, 999, '')
    expect(v.dispatch).toHaveBeenLastCalledWith({
      changes: { from: 0, to: 6, insert: '' },
      selection: { anchor: 0 },
    })
  })

  it('on：广播给所有订阅者；单个回调抛错不影响其它', () => {
    const args = makeArgs()
    const r = render(args)
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = vi.fn()
    const b = vi.fn()
    r.current.docApi.on('open', () => {
      throw new Error('boom')
    })
    r.current.docApi.on('open', a)
    r.current.docApi.on('open', b)
    args.refs.activeRef.current = 'a.md'
    r.current.fireDoc('open', 'a.md', 'c', false)
    expect(a).toHaveBeenCalledWith({ path: 'a.md', content: 'c', frontmatter: {}, dirty: false })
    expect(b).toHaveBeenCalledTimes(1)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })

  it('on：dispose 幂等，空了就把 key 删掉', () => {
    const args = makeArgs()
    const r = render(args)
    const cb = vi.fn()
    const h = r.current.docApi.on('save', cb)
    expect(args.refs.docSubsRef.current.has('save')).toBe(true)
    h.dispose()
    h.dispose()
    expect(args.refs.docSubsRef.current.has('save')).toBe(false)
  })

  it('fireDoc：无订阅者 / 无 path ⇒ 不广播', () => {
    const args = makeArgs()
    const r = render(args)
    const cb = vi.fn()
    r.current.docApi.on('open', cb)
    r.current.fireDoc('open', null, 'x', false)
    expect(cb).not.toHaveBeenCalled()
  })

  it('flushDocChange：兑现挂起的 change、清 timer、清 pending', () => {
    const args = makeArgs()
    args.refs.docPendingRef.current = { path: 'a.md', content: 'draft' }
    const clear = vi.spyOn(window, 'clearTimeout')
    const r = render(args)
    const seen: NoteDoc[] = []
    r.current.docApi.on('change', (d) => seen.push(d))
    act(() => r.current.flushDocChange())
    expect(seen).toEqual([{ path: 'a.md', content: 'draft', frontmatter: {}, dirty: true }])
    expect(args.refs.docPendingRef.current).toBeNull()
    clear.mockRestore()
  })

  it('flushDocChange：没有 pending ⇒ 不广播', () => {
    const args = makeArgs()
    const r = render(args)
    const cb = vi.fn()
    r.current.docApi.on('change', cb)
    r.current.flushDocChange()
    expect(cb).not.toHaveBeenCalled()
  })
})
