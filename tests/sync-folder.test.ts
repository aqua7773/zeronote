// @vitest-environment happy-dom
/**
 * 同步 · 本地文件夹（`examples/sync-folder`）—— rev173.107
 *
 * 五层：
 *  1. 指纹：稳定 / 内容变了就变 / 空串 / 长度参与
 *  2. 判定 `classifyChange`：六种组合一条不落（这是整个插件的心脏，错了会静默丢字）
 *  3. 冲突文件名：格式 / 重名加序号 / 不含 Windows 非法字符
 *  4. 影子副本路径
 *  5. 接线：面板与命令登记 / 事件订阅 / **双端修改真的写出冲突副本**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import plugin, {
  classifyChange,
  conflictFileName,
  fingerprint,
  shortHash,
  snapshotPath,
} from '../examples/sync-folder/index.js'

/* ───────────────────────── 1. 指纹 ───────────────────────── */

describe('fingerprint', () => {
  it('同样的内容给同一个指纹', () => {
    expect(fingerprint('# 周报\n正文')).toBe(fingerprint('# 周报\n正文'))
  })

  it('内容变一个字就变', () => {
    expect(fingerprint('a')).not.toBe(fingerprint('b'))
    expect(fingerprint('# 周报\n正文')).not.toBe(fingerprint('# 周报\n正文!'))
  })

  it('空串与非字符串都有确定结果', () => {
    expect(fingerprint('')).toBe(fingerprint(''))
    expect(fingerprint(null)).toBe(fingerprint(''))
    expect(fingerprint(undefined)).toBe(fingerprint(''))
  })

  it('等长但不同的内容不会撞（长度不是唯一判据）', () => {
    const a = 'x'.repeat(100)
    const b = 'x'.repeat(99) + 'y'
    expect(fingerprint(a)).not.toBe(fingerprint(b))
  })

  it('换行差异算不同（CRLF vs LF）', () => {
    expect(fingerprint('a\r\nb')).not.toBe(fingerprint('a\nb'))
  })

  it('shortHash 只取散列段', () => {
    expect(shortHash('a.md')).toMatch(/^[0-9a-z]+$/)
    expect(fingerprint('a.md').endsWith(`:${shortHash('a.md')}`)).toBe(true)
  })
})

/* ───────────────────────── 2. 判定 ───────────────────────── */

describe('classifyChange', () => {
  const base = { fp: 'base' }

  it('从没见过 ⇒ new（外部新增）', () => {
    expect(classifyChange({ base: null, pending: null, remoteFp: 'x' })).toBe('new')
  })

  it('没 pending 且与基线一致 ⇒ noop', () => {
    expect(classifyChange({ base, pending: null, remoteFp: 'base' })).toBe('noop')
  })

  it('没 pending 但磁盘变了 ⇒ remote（只有别处改了）', () => {
    expect(classifyChange({ base, pending: null, remoteFp: 'remote' })).toBe('remote')
  })

  it('pending 与磁盘一致 ⇒ noop（自己那版被同步工具搬回来了）', () => {
    const pending = { fp: 'mine' }
    expect(classifyChange({ base, pending, remoteFp: 'mine' })).toBe('noop')
  })

  it('pending 与磁盘不一致 ⇒ conflict（这是唯一会写冲突副本的分支）', () => {
    const pending = { fp: 'mine' }
    expect(classifyChange({ base, pending, remoteFp: 'theirs' })).toBe('conflict')
  })

  it('外部改回了基线、本地还有改动 ⇒ local-pending（保留本地待同步）', () => {
    const pending = { fp: 'mine' }
    expect(classifyChange({ base, pending, remoteFp: 'base' })).toBe('local-pending')
  })

  it('本地删了、别处还有 ⇒ remote（恢复别处的，方案 A 的口径）', () => {
    const pending = { deleted: true }
    expect(classifyChange({ base, pending, remoteFp: 'theirs' })).toBe('remote')
    expect(classifyChange({ base, pending, remoteFp: 'base' })).toBe('remote')
  })

  it('没有基线但有 pending（极端情况）也不会崩', () => {
    const pending = { fp: 'mine' }
    expect(classifyChange({ base: null, pending, remoteFp: 'theirs' })).toBe('conflict')
    expect(classifyChange({ base: null, pending, remoteFp: 'mine' })).toBe('noop')
  })
})

/* ───────────────────────── 3. 冲突文件名 ───────────────────────── */

describe('conflictFileName', () => {
  const at = new Date(2026, 9, 24, 20, 15, 30).getTime() // 本地时间 2026-10-24 20:15:30

  it('格式 = `YYYY-MM-DD HHmm-原标题.md`', () => {
    expect(conflictFileName({ path: '日记/周报.md', at })).toBe('2026-10-24 2015-周报.md')
  })

  it('不含 `:` 与 `/`（Windows 文件名非法 / 目录穿越）', () => {
    const name = conflictFileName({ path: 'a/b/c.md', at })
    expect(name).not.toMatch(/[:/\\]/)
  })

  it('没有 .md 后缀也补上', () => {
    expect(conflictFileName({ path: '说明', at })).toBe('2026-10-24 2015-说明.md')
  })

  it('同名已存在 ⇒ 追加 -2 / -3', () => {
    const taken = new Set(['2026-10-24 2015-周报.md', '2026-10-24 2015-周报-2.md'])
    expect(conflictFileName({ path: '周报.md', at }, (n) => taken.has(n))).toBe(
      '2026-10-24 2015-周报-3.md',
    )
  })

  it('路径异常时给个能落盘的兜底名', () => {
    expect(conflictFileName({ path: '', at })).toBe('2026-10-24 2015-note.md')
  })
})

describe('snapshotPath', () => {
  it('落在 `.zn/sync/last/<hash>.md`', () => {
    expect(snapshotPath('日记/周报.md')).toMatch(/^\.zn\/sync\/last\/[0-9a-z]+\.md$/)
  })

  it('不同路径不同副本', () => {
    expect(snapshotPath('a.md')).not.toBe(snapshotPath('b.md'))
  })
})

/* ───────────────────────── 4. 接线 + 冲突端到端 ───────────────────────── */

/** 内存版 fs（配合假 api 跑真实事件流） */
function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const writes: Array<{ path: string; content: string }> = []
  return {
    files,
    writes,
    api: {
      listNotes: async () =>
        [...files.keys()]
          .filter((p) => p.endsWith('.md') && !p.startsWith('.zn/'))
          .map((path) => ({ path })),
      readText: async (path: string) => {
        if (!files.has(path)) throw new Error(`ENOENT ${path}`)
        return files.get(path) as string
      },
      mkdir: async () => {},
      writeText: async (path: string, content: string) => {
        files.set(path, content)
        writes.push({ path, content })
      },
      delete: async (path: string) => {
        files.delete(path)
        return '.zn/trash/x'
      },
      purgePrivate: async (path: string) => {
        files.delete(path)
      },
    },
  }
}

function fakeHost() {
  const log: string[] = []
  const notes: Array<{ msg: string; level?: string }> = []
  return {
    log,
    notes,
    api: {
      platform: 'windows' as const,
      apiVersion: '0.2.0',
      appVersion: '0.0.0',
      log: (_level: string, msg: string) => {
        log.push(msg)
      },
      notify: (msg: string, level?: string) => {
        notes.push({ msg, level })
      },
    },
  }
}

function harness(initialFiles: Record<string, string> = {}) {
  const mem = memoryFs(initialFiles)
  const host = fakeHost()
  const handlers: Record<string, (p?: unknown) => void> = {}
  const commands: string[] = []
  const panels: Array<{ id: string; location: string }> = []
  let refreshCount = 0
  const store = new Map<string, unknown>()

  const api = {
    fs: mem.api,
    host: host.api,
    store: {
      get: async (k: string, d: unknown) => (store.has(k) ? store.get(k) : d),
      set: async (k: string, v: unknown) => {
        store.set(k, v)
      },
      delete: async (k: string) => {
        store.delete(k)
      },
      all: async () => Object.fromEntries(store),
    },
    event: {
      on: (topic: string, cb: (p?: unknown) => void) => {
        handlers[topic] = cb
        return { dispose: () => {} }
      },
      emit: () => {},
    },
    command: {
      register: (c: { id: string }) => {
        commands.push(c.id)
        return { dispose: () => {} }
      },
      execute: async () => {},
    },
    view: {
      registerPanel: (spec: { id: string; location: string }) => {
        panels.push({ id: spec.id, location: spec.location })
        return { dispose: () => {} }
      },
      refresh: () => {
        refreshCount += 1
      },
    },
    subscriptions: [] as Array<{ dispose: () => void }>,
  }

  plugin.apply(api as never)
  return { mem, host, handlers, commands, panels, api, store, refresh: () => refreshCount }
}

/** 让 fire-and-forget 的 async handler 跑完 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0))
}

describe('接线', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('注册主区面板 + 三条命令', () => {
    const h = harness()
    expect(h.panels).toEqual([{ id: 'sync-folder.status', location: 'main' }])
    expect(h.commands.sort()).toEqual([
      'sync-folder.mark-synced',
      'sync-folder.open',
      'sync-folder.scan',
    ])
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('订阅五个内核事件', () => {
    const h = harness()
    expect(Object.keys(h.handlers).sort()).toEqual([
      'note:changed',
      'note:created',
      'note:deleted',
      'note:renamed',
      'note:saved',
    ])
    h.api.subscriptions.forEach((s) => s.dispose())
  })
})

describe('冲突端到端（双端都改同一篇）', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('本机保存 → 外部改成另一版 ⇒ 写 `.zn/conflicts/windows/…` 且 content 是本机版', async () => {
    const h = harness({ '周报.md': '# 周报\n本机版' })
    await settle() // 让 apply 的初始化（读 store）跑完

    // ① 本机保存（内核会发 note:saved）
    h.handlers['note:saved']({ path: '周报.md' })
    await settle()
    expect(h.mem.files.get('.zn/sync/last/' + shortHash('周报.md') + '.md')).toBe('# 周报\n本机版')

    // ② 同步工具把对端那版覆盖上来（磁盘内容变了）+ note:changed
    h.mem.files.set('周报.md', '# 周报\n对端版')
    h.handlers['note:changed']({ path: '周报.md', kind: 'modify' })
    await settle()

    const conflictWrites = h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts/windows/'))
    expect(conflictWrites).toHaveLength(1)
    expect(conflictWrites[0].content).toBe('# 周报\n本机版')
    expect(conflictWrites[0].path).toMatch(/^\.zn\/conflicts\/windows\/\d{4}-\d{2}-\d{2} \d{4}-周报\.md$/)
    expect(h.host.notes.some((n) => n.level === 'warn' && n.msg.includes('同步冲突'))).toBe(true)
    // 磁盘上留的是对端版（不丢字的两边：一边在磁盘，一边在冲突目录）
    expect(h.mem.files.get('周报.md')).toBe('# 周报\n对端版')

    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('只有外部改动（本机没动）⇒ 不产生冲突，只是更新基线', async () => {
    const h = harness({ 'a.md': 'v1' })
    await settle()
    h.handlers['note:created']({ path: 'a.md' })
    await settle()

    h.mem.files.set('a.md', 'v2')
    h.handlers['note:changed']({ path: 'a.md', kind: 'modify' })
    await settle()

    expect(h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts'))).toHaveLength(0)
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('外部删除 + 本地改过 ⇒ 本地版进冲突目录', async () => {
    const h = harness({ 'b.md': '本机改过' })
    await settle()
    h.handlers['note:saved']({ path: 'b.md' })
    await settle()

    h.mem.files.delete('b.md')
    h.handlers['note:changed']({ path: 'b.md', kind: 'delete' })
    await settle()

    const conflictWrites = h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts/windows/'))
    expect(conflictWrites).toHaveLength(1)
    expect(conflictWrites[0].content).toBe('本机改过')

    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('同步工具把自己那版搬回来（noop）⇒ 不冲突、不重复留副本', async () => {
    const h = harness({ 'c.md': 'mine' })
    await settle()
    h.handlers['note:saved']({ path: 'c.md' })
    await settle()
    // 同步工具回传同一份内容
    h.handlers['note:changed']({ path: 'c.md', kind: 'modify' })
    await settle()

    expect(h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts'))).toHaveLength(0)
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('自己的保存回响（noop）**不清 pending** —— 之后真冲突仍判得出', async () => {
    // 这是真实时序：本机保存 → Rust watcher 偶尔把这次写入也报成 note:changed
    // （自写抑制是 1500ms 窗口，不保证 100%）。若在 noop 分支清掉 pending，
    // 紧接着对端改同一篇就会被误判成"只有外部更新"，本地版静默丢失。
    const h = harness({ 'd.md': 'v1' })
    await settle()
    h.handlers['note:created']({ path: 'd.md' }) // 建基线 = v1
    await settle()

    // ① 本机存成 v2
    h.mem.files.set('d.md', 'v2')
    h.handlers['note:saved']({ path: 'd.md' })
    await settle()

    // ② watcher 回响（磁盘仍是 v2）—— 必须是无害的
    h.handlers['note:changed']({ path: 'd.md', kind: 'modify' })
    await settle()
    expect(h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts'))).toHaveLength(0)

    // ③ 对端改 v3 ⇒ 应当判成冲突（本地版 v2 进冲突副本）
    h.mem.files.set('d.md', 'v3')
    h.handlers['note:changed']({ path: 'd.md', kind: 'modify' })
    await settle()

    const conflictWrites = h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts/windows/'))
    expect(conflictWrites).toHaveLength(1)
    expect(conflictWrites[0].content).toBe('v2')

    h.api.subscriptions.forEach((s) => s.dispose())
  })
})
