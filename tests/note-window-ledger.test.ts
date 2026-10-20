// @vitest-environment happy-dom
/**
 * 独立窗口占用账本（rev173.63 · P1-c）。
 *
 * 修的是：`noteWindowsRef` 只在主窗口这一次页面生命周期里 —— reload 就丢，
 * 「同一篇只能在一个容器里」的守卫失效，会开出第二份。
 *
 * 这里测的是账本的纯逻辑与 localStorage 往返；窗口对象恢复在 App 里（需要 Tauri IPC）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  loadLedgerStorage,
  maxWindowSeq,
  NOTE_WINDOWS_LS_KEY,
  parseLedger,
  pruneLedger,
  saveLedgerStorage,
} from '../src/lib/note-window-ledger'

describe('note-window-ledger', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('parseLedger：坏数据一律退回空账本（宁可多开一次，也不误拦）', () => {
    expect(parseLedger(null)).toEqual({})
    expect(parseLedger('')).toEqual({})
    expect(parseLedger('not json')).toEqual({})
    expect(parseLedger('[]')).toEqual({})
    expect(parseLedger('"x"')).toEqual({})
    expect(parseLedger('{"a.md":"main"}')).toEqual({}) // 不是笔记窗口 label
    expect(parseLedger('{"a.md":"note-x"}')).toEqual({})
  })

  it('parseLedger：合法的 path → note-N 映射原样保留', () => {
    expect(parseLedger('{"a.md":"note-3","sub/b.md":"note-7"}')).toEqual({
      'a.md': 'note-3',
      'sub/b.md': 'note-7',
    })
  })

  it('maxWindowSeq：取最大序号（新窗口 label 从它 +1 起，避免与残留撞名）', () => {
    expect(maxWindowSeq({})).toBe(0)
    expect(maxWindowSeq({ 'a.md': 'note-3', 'b.md': 'note-10' })).toBe(10)
    expect(maxWindowSeq({ 'a.md': 'note-2', 'b.md': 'bad' })).toBe(2)
  })

  it('pruneLedger：只留下 label 仍在存活的条目', () => {
    const ledger = { 'a.md': 'note-1', 'b.md': 'note-2', 'c.md': 'note-3' }
    expect(pruneLedger(ledger, new Set(['note-1', 'note-3']))).toEqual({
      'a.md': 'note-1',
      'c.md': 'note-3',
    })
    // 整个 app 重启：note-* 全不在 ⇒ 账本清空（下次打开不会被误拦）
    expect(pruneLedger(ledger, new Set(['main']))).toEqual({})
  })

  it('localStorage 往返：保存 → 读回；空账本会删键（不留下一个空对象）', () => {
    saveLedgerStorage({ 'a.md': 'note-4' })
    expect(localStorage.getItem(NOTE_WINDOWS_LS_KEY)).toBe('{"a.md":"note-4"}')
    expect(loadLedgerStorage()).toEqual({ 'a.md': 'note-4' })

    saveLedgerStorage({})
    expect(localStorage.getItem(NOTE_WINDOWS_LS_KEY)).toBeNull()
    expect(loadLedgerStorage()).toEqual({})
  })
})
