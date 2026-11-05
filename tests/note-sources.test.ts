/**
 * 额外笔记源注册表（rev173.376 · 私密笔记改造 §4.1）
 *
 * 锁住四条语义：
 * 1. 源的条目被补全分组字段，并按注册顺序合并；
 * 2. 源返回空数组（锁定）= 宿主看不到任何条目；
 * 3. 源自己的 `onSourceChange` 会触发宿主订阅；
 * 4. 一个源坏掉（`list()` 抛错 / 返回非数组）只跳过它自己。
 */
import { describe, expect, it, vi } from 'vitest'
import { createNoteSources } from '../src/kernel/note-sources'
import type { NoteMeta, NoteSource } from '../src/kernel/contract'

const meta = (path: string, extra: Partial<NoteMeta> = {}): NoteMeta => ({
  path,
  id: path,
  title: path,
  mtime: 0,
  size: 0,
  frontmatter: {},
  kind: 'note',
  ...extra,
})

function makeSource(id: string, items: NoteMeta[]): NoteSource & { emit: () => void } {
  const listeners = new Set<() => void>()
  return {
    id,
    group: { key: id, label: `组 ${id}`, icon: '🔒' },
    list: () => items,
    onSourceChange(cb) {
      listeners.add(cb)
      return { dispose: () => listeners.delete(cb) }
    },
    emit: () => {
      for (const cb of listeners) cb()
    },
  }
}

describe('createNoteSources', () => {
  it('把条目的分组字段补全，并按注册顺序合并', () => {
    const reg = createNoteSources(() => {})
    reg.register('p1', makeSource('a', [meta('a/1.md')]))
    reg.register('p1', makeSource('b', [meta('b/1.md'), meta('b/2.md')]))

    const snap = reg.snapshot()
    expect(snap.map((n) => n.path)).toEqual(['a/1.md', 'b/1.md', 'b/2.md'])
    expect(snap[0].group).toBe('a')
    expect(snap[0].groupLabel).toBe('组 a')
    expect(snap[0].groupIcon).toBe('🔒')
  })

  it('源返回空数组（锁定）⇒ 快照里没有任何条目', () => {
    const reg = createNoteSources(() => {})
    const items: NoteMeta[] = [meta('.zn/private/notes/x.zn')]
    reg.register('p1', makeSource('private', items))
    expect(reg.snapshot()).toHaveLength(1)

    items.length = 0 // 锁定
    expect(reg.snapshot()).toHaveLength(0)
  })

  it('源自己通知变化 ⇒ 宿主订阅被调用', () => {
    const reg = createNoteSources(() => {})
    const src = makeSource('a', [meta('a/1.md')])
    const host = vi.fn()
    reg.subscribe(host)
    reg.register('p1', src)
    expect(host).toHaveBeenCalledTimes(1) // 注册本身也算一次

    src.emit()
    expect(host).toHaveBeenCalledTimes(2)
  })

  it('注销后条目消失，并通知宿主', () => {
    const reg = createNoteSources(() => {})
    const src = makeSource('a', [meta('a/1.md')])
    const d = reg.register('p1', src)
    const host = vi.fn()
    reg.subscribe(host)

    d.dispose()
    d.dispose() // 幂等
    expect(reg.snapshot()).toHaveLength(0)
    expect(host).toHaveBeenCalledTimes(1)
    expect(reg.sources()).toHaveLength(0)
  })

  it('一个源抛错只跳过它自己', () => {
    const warn = vi.fn()
    const reg = createNoteSources(warn)
    const good = makeSource('good', [meta('g/1.md')])
    const bad: NoteSource = {
      id: 'bad',
      group: { key: 'bad', label: '坏源' },
      list: () => {
        throw new Error('boom')
      },
      onSourceChange: () => ({ dispose: () => {} }),
    }
    reg.register('p1', bad)
    reg.register('p1', good)

    expect(reg.snapshot().map((n) => n.path)).toEqual(['g/1.md'])
    expect(warn).toHaveBeenCalled()
  })

  it('list() 返回非数组 ⇒ 跳过并告警（不把树整个渲染崩掉）', () => {
    const warn = vi.fn()
    const reg = createNoteSources(warn)
    reg.register('p1', {
      id: 'weird',
      group: { key: 'weird', label: '怪源' },
      // 误返回一个对象（不是数组）—— 典型是插件把 `{ notes }` 当成了条目列表
      list: () => ({ notes: [] }) as unknown as NoteMeta[],
      onSourceChange: () => ({ dispose: () => {} }),
    })
    expect(reg.snapshot()).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('同插件同 id 重复注册 ⇒ 后者取代前者（树里不出现两遍）', () => {
    const reg = createNoteSources(() => {})
    reg.register('p1', makeSource('a', [meta('a/old.md')]))
    reg.register('p1', makeSource('a', [meta('a/new.md')]))
    expect(reg.snapshot().map((n) => n.path)).toEqual(['a/new.md'])
  })

  it('宿主回调抛错不影响其它订阅者', () => {
    const warn = vi.fn()
    const reg = createNoteSources(warn)
    const second = vi.fn()
    reg.subscribe(() => {
      throw new Error('宿主炸了')
    })
    reg.subscribe(second)
    reg.register('p1', makeSource('a', [meta('a/1.md')]))
    expect(second).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
  })
})
