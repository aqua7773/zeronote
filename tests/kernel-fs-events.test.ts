// @vitest-environment happy-dom
/**
 * 内核 fs 写路径的索引跟随 + 事件派发（rev173.40）。
 *
 * 覆盖的是这次修的两个缺口：
 *   · 搜索索引增量（写盘后 `index.query` 立刻能命中）
 *   · 契约 §1.4 的 `note:*` / `index:rebuilt` 事件真的被派发
 *
 * 用真实 `createKernel` + mock 的 Tauri `invoke` —— 测的是接线，不是假内核。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kernel } from '../src/kernel/kernel'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(async () => () => {}),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {} }))
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }))

import { createKernel } from '../src/kernel/kernel'

type Note = { path: string; title: string; kind?: 'note' | 'doc' | 'image'; mtime?: number }

/** 库内文件内容：读 read_note 从这里取 */
let files: Record<string, string>
let notes: Note[]

function makeKernel(): Kernel {
  mocks.invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case 'list_notes':
        return notes.map((n) => ({ kind: 'note', mtime: 1, ...n }))
      case 'list_dirs':
        return []
      case 'read_note':
        return files[String(args?.path)] ?? ''
      case 'write_note':
        files[String(args?.path)] = String(args?.content)
        return null
      case 'create_note':
        files[String(args?.path)] = String(args?.content ?? '')
        return null
      case 'delete_note':
        return 'trash/20261019'
      case 'restore_trash':
        return 'a.md'
      case 'rename_note':
      case 'move_entry':
      case 'create_dir':
      case 'empty_trash':
        return null
      default:
        return null
    }
  })
  return createKernel('/vault', {} as never, {
    onPanelsChange: () => {},
    onNotify: () => {},
    onLog: () => {},
    onPanelStateChange: () => {},
  })
}

/** 等 fire-and-forget 的索引更新（readText → upsert）落定 */
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(() => {
  files = {}
  notes = []
  mocks.invoke.mockReset()
  mocks.listen.mockClear()
})

describe('fs 写路径 → 索引 + 事件', () => {
  it('writeText：发 note:saved（带正文），且新内容立刻可搜', async () => {
    const k = makeKernel()
    const seen: unknown[] = []
    k.event.on('note:saved', (p) => seen.push(p))

    await k.fs.writeText('a.md', '# 标题\n这是世界和平的笔记')

    /**
     * rev173.133：payload 带 `text`（刚写盘的正文）。订阅方（同步插件）靠它在**同步段**
     * 里算指纹、记 pending —— 不这样的话它得 `await readText`，而 watcher 回响可能插在
     * 那段 await 中间把基线对齐掉，本机改动就永远同步不出去。
     */
    expect(seen).toEqual([{ path: 'a.md', text: '# 标题\n这是世界和平的笔记' }])
    const hits = await k.index.query('世界')
    expect(hits.map((h) => h.path)).toEqual(['a.md'])
  })

  it('createNote：发 note:created（带正文，rev173.135）', async () => {
    const k = makeKernel()
    const seen: unknown[] = []
    k.event.on('note:created', (p) => seen.push(p))

    await k.fs.createNote('b.md', '全新内容')

    /**
     * rev173.135：payload 带 `text`（新建的正文）—— 与 `note:saved` 同一个来由。
     * 订阅方（同步插件）靠它在**同步段**里种基线，不必 `await readText`；
     * 那边的 watcher 回响可能插在那段 await 中间先跑完扫描。
     */
    expect(seen).toEqual([{ path: 'b.md', text: '全新内容' }])
    expect((await k.index.query('全新')).map((h) => h.path)).toEqual(['b.md'])
  })

  it('restoreTrash：也发 note:created，带 restored 标记与正文（rev173.135）', async () => {
    files['a.md'] = '回收站恢复的内容'
    const k = makeKernel()
    const seen: unknown[] = []
    k.event.on('note:created', (p) => seen.push(p))

    const restored = await k.fs.restoreTrash('1')

    expect(restored).toBe('a.md')
    expect(seen).toEqual([{ path: 'a.md', restored: true, text: '回收站恢复的内容' }])
    expect((await k.index.query('回收站恢复')).map((h) => h.path)).toEqual(['a.md'])
  })

  it('写 `.zn/` 下的 .md（历史快照 / 同步影子副本）**不发** note:saved，也不进索引', async () => {
    const k = makeKernel()
    const saved: unknown[] = []
    k.event.on('note:saved', (p) => saved.push(p))

    await k.fs.writeText('.zn/history/abc/1.md', '历史快照内容')
    await k.fs.writeText('.zn/sync/last/xyz.md', '影子副本内容')

    expect(saved).toEqual([])
    expect((await k.index.query('历史快照')).map((h) => h.path)).toEqual([])
    expect((await k.index.query('影子副本')).map((h) => h.path)).toEqual([])

    // 普通笔记不受影响（免得把修复做成"全都不发了"）
    await k.fs.writeText('正常.md', '正常笔记')
    expect(saved).toEqual([{ path: '正常.md', text: '正常笔记' }])
  })

  it('delete：发 note:deleted（带 trashId），索引里移除', async () => {
    const k = makeKernel()
    await k.fs.writeText('c.md', '待删除的内容')
    const seen: unknown[] = []
    k.event.on('note:deleted', (p) => seen.push(p))

    const trashId = await k.fs.delete('c.md')

    expect(trashId).toBe('trash/20261019')
    expect(seen).toEqual([{ path: 'c.md', trashId: 'trash/20261019' }])
    expect(await k.index.query('待删除')).toEqual([])
  })

  it('rename：发 note:renamed，索引跟着换路径', async () => {
    const k = makeKernel()
    await k.fs.writeText('old.md', '重命名内容')
    files['new.md'] = '重命名内容'
    const seen: unknown[] = []
    k.event.on('note:renamed', (p) => seen.push(p))

    await k.fs.rename('old.md', 'new.md')
    await tick()

    expect(seen).toEqual([{ from: 'old.md', to: 'new.md' }])
    expect((await k.index.query('重命名')).map((h) => h.path)).toEqual(['new.md'])
  })

  it('写盘失败：不产生“已保存”的假信号', async () => {
    const k = makeKernel()
    mocks.invoke.mockImplementationOnce(async () => {
      throw new Error('disk full')
    })
    const seen: unknown[] = []
    k.event.on('note:saved', (p) => seen.push(p))

    await expect(k.fs.writeText('bad.md', 'x')).rejects.toThrow('disk full')
    expect(seen).toEqual([])
  })

  /* rev173.120 · 插件写盘的内核口子 */

  it('writeText({ origin: "plugin" })：更新索引，但**不发 note:saved**，改发 note:changed', async () => {
    const k = makeKernel()
    const saved: unknown[] = []
    const changed: unknown[] = []
    k.event.on('note:saved', (p) => saved.push(p))
    k.event.on('note:changed', (p) => changed.push(p))

    await k.fs.writeText('p.md', '插件程序写进来的内容', { origin: 'plugin' })

    // 关键：同步插件靠 note:saved 记 pending —— 插件自己写盘绝不能触发它
    expect(saved).toEqual([])
    expect(changed).toEqual([{ path: 'p.md', kind: 'modify', origin: 'plugin' }])
    // 但索引必须照常更新：插件写的内容也要搜得到
    expect((await k.index.query('插件程序')).map((h) => h.path)).toEqual(['p.md'])
  })

  it('writeText 不传 origin ⇒ 仍是用户语义（note:saved）', async () => {
    const k = makeKernel()
    const saved: unknown[] = []
    const changed: unknown[] = []
    k.event.on('note:saved', (p) => saved.push(p))
    k.event.on('note:changed', (p) => changed.push(p))

    await k.fs.writeText('u.md', '用户保存的内容')

    expect(saved).toEqual([{ path: 'u.md', text: '用户保存的内容' }])
    expect(changed).toEqual([])
  })

  it('插件写 `.zn/` 下的快照不发任何笔记事件（口径不变）', async () => {
    const k = makeKernel()
    const saved: unknown[] = []
    const changed: unknown[] = []
    k.event.on('note:saved', (p) => saved.push(p))
    k.event.on('note:changed', (p) => changed.push(p))

    await k.fs.writeText('.zn/sync/last/x.md', '影子副本', { origin: 'plugin' })

    expect(saved).toEqual([])
    expect(changed).toEqual([])
  })

  it('rebuild：完成后发 index:rebuilt（带 partition）', async () => {
    notes = [
      { path: 'n1.md', title: 'n1' },
      { path: 'n2.md', title: 'n2' },
    ]
    files['n1.md'] = '第一篇'
    files['n2.md'] = '第二篇'
    const k = makeKernel()
    const seen: { count: number; partition: string }[] = []
    k.event.on('index:rebuilt', (p) => seen.push(p as { count: number; partition: string }))

    const stats = await k.index.rebuild()

    expect(stats.count).toBe(2)
    expect(seen).toEqual([{ count: 2, ms: expect.any(Number), partition: 'default' }])
  })
})

describe('外部改动 → applyExternalChange', () => {
  it('modify：索引更新并发 note:changed', async () => {
    const k = makeKernel()
    files['ext.md'] = '外部写入的世界'
    const seen: unknown[] = []
    k.event.on('note:changed', (p) => seen.push(p))

    const { applyExternalChange } = await import('../src/kernel/fs-events')
    applyExternalChange({ kind: 'modify', path: 'ext.md' }, k.fs, k.index, k.event)
    await tick()

    // happy-dom 的 setTimeout 足够让 readText 的 promise 链跑完
    await tick()
    expect(seen).toEqual([{ path: 'ext.md', kind: 'modify' }])
    expect((await k.index.query('世界')).map((h) => h.path)).toEqual(['ext.md'])
  })

  it('delete：移除索引并发 note:changed', async () => {
    const k = makeKernel()
    await k.fs.writeText('gone.md', '要没了')
    const seen: unknown[] = []
    k.event.on('note:changed', (p) => seen.push(p))

    const { applyExternalChange } = await import('../src/kernel/fs-events')
    applyExternalChange({ kind: 'delete', path: 'gone.md' }, k.fs, k.index, k.event)

    expect(seen).toEqual([{ path: 'gone.md', kind: 'delete' }])
    expect(await k.index.query('要没了')).toEqual([])
  })

  it('非 .md 文件被忽略', async () => {
    const k = makeKernel()
    const seen: unknown[] = []
    k.event.on('note:changed', (p) => seen.push(p))

    const { applyExternalChange } = await import('../src/kernel/fs-events')
    applyExternalChange({ kind: 'modify', path: 'image.png' }, k.fs, k.index, k.event)

    expect(seen).toEqual([])
  })
})
