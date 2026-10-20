// @vitest-environment happy-dom
/**
 * 会话恢复（hot exit）的草稿快照（rev173.65 · P2）。
 *
 * 修的是：崩溃 / HMR 整页重载会丢「最后一次还没落盘」的输入 ——
 * 自动保存的失焦 / 关窗 flush 在这两种退出方式下都不会跑。
 *
 * 这里测纯逻辑与 localStorage 往返；「什么时候写 / 什么时候清」在 useDocIO 里
 * （见 tests/use-doc-io.test.tsx），启动提示与恢复 UI 在 App 里（真窗口验收）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearDraft,
  clearDraftFor,
  DRAFT_LS_KEY,
  DRAFT_MAX_BYTES,
  DRAFT_TTL_MS,
  draftBytes,
  loadDraft,
  parseDraft,
  saveDraft,
} from '../src/lib/draft-snapshot'

describe('draft-snapshot', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
  })

  it('draftBytes：按 UTF-8 字节算（中文 3 字节 / emoji 4 字节）', () => {
    expect(draftBytes('abc')).toBe(3)
    expect(draftBytes('中')).toBe(3)
    expect(draftBytes('😀')).toBe(4)
  })

  it('parseDraft：坏数据一律退回 null（启动路径绝不抛错）', () => {
    expect(parseDraft(null)).toBeNull()
    expect(parseDraft('')).toBeNull()
    expect(parseDraft('not json')).toBeNull()
    expect(parseDraft('[]')).toBeNull()
    expect(parseDraft('"x"')).toBeNull()
    expect(parseDraft('{"path":"a.md"}')).toBeNull() // 缺 content
    expect(parseDraft('{"path":"","content":"x"}')).toBeNull() // 空路径
    expect(parseDraft('{"path":"a.md","content":1}')).toBeNull()
  })

  it('parseDraft：合法快照原样解析；at 不是数字时退化成 0', () => {
    expect(parseDraft('{"path":"a.md","content":"hi","at":123}')).toEqual({
      path: 'a.md',
      content: 'hi',
      at: 123,
    })
    expect(parseDraft('{"path":"a.md","content":"hi"}')).toEqual({
      path: 'a.md',
      content: 'hi',
      at: 0,
    })
  })

  it('parseDraft：超过 8 KB 的内容判坏（绝不截断恢复半篇）', () => {
    const big = 'a'.repeat(DRAFT_MAX_BYTES + 1)
    expect(parseDraft(JSON.stringify({ path: 'a.md', content: big, at: 1 }))).toBeNull()
    const edge = 'a'.repeat(DRAFT_MAX_BYTES)
    expect(parseDraft(JSON.stringify({ path: 'a.md', content: edge, at: 1 }))).toEqual({
      path: 'a.md',
      content: edge,
      at: 1,
    })
  })

  it('localStorage 往返：saveDraft → loadDraft；只留最新一篇', () => {
    expect(saveDraft('a.md', 'first', 1000)).toBe(true)
    expect(loadDraft(1000)).toEqual({ path: 'a.md', content: 'first', at: 1000 })

    expect(saveDraft('b.md', 'second', 2000)).toBe(true) // 后写覆盖前写
    expect(loadDraft(2000)).toEqual({ path: 'b.md', content: 'second', at: 2000 })
  })

  it('saveDraft：超 8 KB / 空路径 ⇒ 不存且清掉旧键（不留对不上的旧快照）', () => {
    saveDraft('old.md', 'old', 1)
    expect(saveDraft('big.md', 'a'.repeat(DRAFT_MAX_BYTES + 1), 2)).toBe(false)
    expect(localStorage.getItem(DRAFT_LS_KEY)).toBeNull()
    expect(loadDraft(2)).toBeNull()

    saveDraft('old.md', 'old', 1)
    expect(saveDraft('', 'x', 3)).toBe(false)
    expect(localStorage.getItem(DRAFT_LS_KEY)).toBeNull()
  })

  it('loadDraft：超过 7 天的草稿不提示，并顺手删键', () => {
    const old = Date.now() - DRAFT_TTL_MS - 1
    saveDraft('a.md', 'stale', old)
    expect(loadDraft(Date.now())).toBeNull()
    expect(localStorage.getItem(DRAFT_LS_KEY)).toBeNull()
  })

  it('clearDraftFor：只清属于这一篇的草稿（保存别篇时不能误删）', () => {
    saveDraft('a.md', 'mine', 1)
    clearDraftFor('b.md') // 保存的是别篇 ⇒ 草稿必须留着
    expect(loadDraft(1)).toEqual({ path: 'a.md', content: 'mine', at: 1 })

    clearDraftFor('a.md')
    expect(loadDraft(1)).toBeNull()
    clearDraftFor(null) // 没打开笔记：什么都不做
  })

  it('clearDraft：丢弃即删键', () => {
    saveDraft('a.md', 'x', 1)
    clearDraft()
    expect(localStorage.getItem(DRAFT_LS_KEY)).toBeNull()
  })
})
