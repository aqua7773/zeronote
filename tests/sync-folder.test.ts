// @vitest-environment happy-dom
/**
 * 同步 · 本地文件夹后端（`examples/sync/lib/backends/folder.cjs`）—— rev173.286
 *
 * 从 `examples/sync-folder` 并入 `sync` 插件后，这里**继续测文件夹后端的行为**
 * （纯函数来自 `lib/core.cjs`，事件接线走 `sync` 插件的 apply + `backend: 'folder'`）。
 *
 * 五层：
 *  1. 指纹：稳定 / 内容变了就变 / 空串 / 长度参与
 *  2. 判定 `classifyChange`：六种组合一条不落（这是整个后端的心脏，错了会静默丢字）
 *  3. 冲突文件名：格式 / 重名加序号 / 不含 Windows 非法字符
 *  4. 影子副本路径
 *  5. 接线：面板与命令登记 / 事件订阅 / **双端修改真的写出冲突副本**
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import plugin from '../examples/sync/index.cjs'
/** CJS 模块的具名导出按解构取（纯函数挂在 `plugin` 上） */
const {
  SECRET_DIRS,
  classifyChange,
  conflictFileName,
  fingerprint,
  looksLikeSyncConflict,
  shortHash,
  snapshotPath,
  tryAutoMerge,
} = plugin as unknown as Record<string, never>
import { mergeLines } from '../src/lib/merge3'

/* ───────────────────────── 1. 指纹 ───────────────────────── */

describe('fingerprint', () => {
  it('同样的内容给同一个指纹', async () => {
    expect(fingerprint('# 周报\n正文')).toBe(fingerprint('# 周报\n正文'))
  })

  it('内容变一个字就变', async () => {
    expect(fingerprint('a')).not.toBe(fingerprint('b'))
    expect(fingerprint('# 周报\n正文')).not.toBe(fingerprint('# 周报\n正文!'))
  })

  it('空串与非字符串都有确定结果', async () => {
    expect(fingerprint('')).toBe(fingerprint(''))
    expect(fingerprint(null)).toBe(fingerprint(''))
    expect(fingerprint(undefined)).toBe(fingerprint(''))
  })

  it('等长但不同的内容不会撞（长度不是唯一判据）', async () => {
    const a = 'x'.repeat(100)
    const b = 'x'.repeat(99) + 'y'
    expect(fingerprint(a)).not.toBe(fingerprint(b))
  })

  it('换行差异算不同（CRLF vs LF）', async () => {
    expect(fingerprint('a\r\nb')).not.toBe(fingerprint('a\nb'))
  })

  it('shortHash 只取散列段', async () => {
    expect(shortHash('a.md')).toMatch(/^[0-9a-z]+$/)
    expect(fingerprint('a.md').endsWith(`:${shortHash('a.md')}`)).toBe(true)
  })
})

/* ───────────────────────── 2. 判定 ───────────────────────── */

describe('classifyChange', () => {
  const base = { fp: 'base' }

  it('从没见过 ⇒ new（外部新增）', async () => {
    expect(classifyChange({ base: null, pending: null, remoteFp: 'x' })).toBe('new')
  })

  it('没 pending 且与基线一致 ⇒ noop', async () => {
    expect(classifyChange({ base, pending: null, remoteFp: 'base' })).toBe('noop')
  })

  it('没 pending 但磁盘变了 ⇒ remote（只有别处改了）', async () => {
    expect(classifyChange({ base, pending: null, remoteFp: 'remote' })).toBe('remote')
  })

  it('pending 与磁盘一致 ⇒ noop（自己那版被同步工具搬回来了）', async () => {
    const pending = { fp: 'mine' }
    expect(classifyChange({ base, pending, remoteFp: 'mine' })).toBe('noop')
  })

  it('pending 与磁盘不一致 ⇒ conflict（这是唯一会写冲突副本的分支）', async () => {
    const pending = { fp: 'mine' }
    expect(classifyChange({ base, pending, remoteFp: 'theirs' })).toBe('conflict')
  })

  it('外部改回了基线、本地还有改动 ⇒ local-pending（保留本地待同步）', async () => {
    const pending = { fp: 'mine' }
    expect(classifyChange({ base, pending, remoteFp: 'base' })).toBe('local-pending')
  })

  it('本地删了、别处还有 ⇒ remote（恢复别处的，方案 A 的口径）', async () => {
    const pending = { deleted: true }
    expect(classifyChange({ base, pending, remoteFp: 'theirs' })).toBe('remote')
    expect(classifyChange({ base, pending, remoteFp: 'base' })).toBe('remote')
  })

  it('没有基线但有 pending（极端情况）也不会崩', async () => {
    const pending = { fp: 'mine' }
    expect(classifyChange({ base: null, pending, remoteFp: 'theirs' })).toBe('conflict')
    expect(classifyChange({ base: null, pending, remoteFp: 'mine' })).toBe('noop')
  })
})

/* ───────────────────────── 3. 冲突文件名 ───────────────────────── */

describe('conflictFileName', () => {
  const at = new Date(2026, 9, 24, 20, 15, 30).getTime() // 本地时间 2026-10-24 20:15:30

  it('格式 = `YYYY-MM-DD HHmm-原标题.md`', async () => {
    expect(conflictFileName('日记/周报.md', at)).toBe('2026-10-24 2015-周报.md')
  })

  it('不含 `:` 与 `/`（Windows 文件名非法 / 目录穿越）', async () => {
    const name = conflictFileName('a/b/c.md', at)
    expect(name).not.toMatch(/[:/\\]/)
  })

  it('没有 .md 后缀也补上', async () => {
    expect(conflictFileName('说明', at)).toBe('2026-10-24 2015-说明.md')
  })

  it('同名已存在 ⇒ 追加 -2 / -3', async () => {
    const taken = new Set(['2026-10-24 2015-周报.md', '2026-10-24 2015-周报-2.md'])
    expect(conflictFileName('周报.md', at, (n) => taken.has(n))).toBe(
      '2026-10-24 2015-周报-3.md',
    )
  })

  it('路径异常时给个能落盘的兜底名', async () => {
    expect(conflictFileName('', at)).toBe('2026-10-24 2015-note.md')
  })
})

describe('snapshotPath', () => {
  it('落在 `.zn/sync/last/<hash>.md`', async () => {
    expect(snapshotPath('日记/周报.md')).toMatch(/^\.zn\/sync\/last\/[0-9a-z]+\.md$/)
  })

  it('不同路径不同副本', async () => {
    expect(snapshotPath('a.md')).not.toBe(snapshotPath('b.md'))
  })
})

/* ───────────────────────── 4. 接线 + 冲突端到端 ───────────────────────── */

/** 内存版 fs（配合假 api 跑真实事件流） */
function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const writes: Array<{ path: string; content: string }> = []
  /** 每次 `readText` 记一条（rev173.135：断言「带 text 时根本不读盘」） */
  const reads: string[] = []
  /**
   * 下一次 `readText(path)` 拖一个宏任务再返回 —— 模拟 IPC 慢（rev173.133 的竞争测试要它）。
   * 只影响**下一次**调用：这样「保存时的读盘」可以慢、「回响的读盘」正常，
   * 复现 `note:changed` 抢在 `note:saved` 之前跑完判定的真实时序。
   */
  const slowNext = new Set<string>()
  return {
    files,
    writes,
    reads,
    slowNextRead: (path: string) => {
      slowNext.add(path)
    },
    api: {
      listNotes: async () =>
        [...files.keys()]
          .filter((p) => p.endsWith('.md') && !p.startsWith('.zn/'))
          .map((path) => ({ path })),
      /** rev173.114：`.zn/` 排除检查要枚举私有目录（不递归，与内核 listFiles 同语义） */
      listFiles: async (dir: string) => {
        const prefix = `${dir}/`
        return [...files.keys()].filter(
          (p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'),
        )
      },
      readText: async (path: string) => {
        reads.push(path)
        if (slowNext.delete(path)) await new Promise((r) => setTimeout(r, 0))
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

async function harness(
  initialFiles: Record<string, string> = {},
  initialStore: Record<string, unknown> = {},
  /** 注入的服务（`history` / `kernel.merge`）—— 不注就是"没装"，插件走降级 */
  services: Record<string, unknown> = {},
) {
  const mem = memoryFs(initialFiles)
  const host = fakeHost()
  const handlers: Record<string, (p?: unknown) => void> = {}
  const commands: string[] = []
  /** id → run（rev173.112 起要直接驱动命令，比如 toggle） */
  const runs = new Map<string, () => unknown>()
  const panels: Array<{ id: string; location: string }> = []
  /** id → render（rev173.117：要断言面板文案，比如「上次检查 … 用时」） */
  const renders = new Map<string, (ctx?: unknown) => unknown>()
  let refreshCount = 0
  const store = new Map<string, unknown>(Object.entries(initialStore))
  /**
   * 这个文件只测「本地文件夹」后端：默认把当前后端设成它（插件读 `settings.v1.backend`
   * 决定要不要挂事件监听）。调用方显式给了 `settings.v1`（比如测「停用自动检查」）
   * 就只补上 `backend` 字段，别的按调用方的来。
   */
  store.set('settings.v1', {
    backend: 'folder',
    ...((store.get('settings.v1') as Record<string, unknown>) ?? {}),
  })

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
    // rev173.116：三方合并要 consume `history` 与 `kernel.merge`（都是软依赖）
    service: {
      consume: async (name: string) => services[name] ?? null,
      provide: () => ({ dispose: () => {} }),
    },
    command: {
      register: (c: { id: string; run: () => unknown }) => {
        commands.push(c.id)
        runs.set(c.id, c.run)
        return { dispose: () => {} }
      },
      execute: async () => {},
    },
    view: {
      registerPanel: (spec: { id: string; location: string; render?: (ctx?: unknown) => unknown }) => {
        panels.push({ id: spec.id, location: spec.location })
        if (spec.render) renders.set(spec.id, spec.render)
        return { dispose: () => {} }
      },
      refresh: () => {
        refreshCount += 1
      },
    },
    subscriptions: [] as Array<{ dispose: () => void }>,
  }

  plugin.apply(api as never)
  /**
   * 新插件把 folder 后端的初始化放在异步 IIFE 里（读 settings → `folder.load()` →
   * `folder.attach()`）。等它跑完，事件监听才在表里 —— 这个文件测的就是这些监听。
   */
  await settle()
  return { mem, host, handlers, commands, runs, panels, api, store, renders, refresh: () => refreshCount }
}

/** 让 fire-and-forget 的 async handler 跑完 */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0))
}

describe('接线', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('注册主区面板 + 十一条命令（一个插件，后端可换）', async () => {
    const h = await harness()
    expect(h.panels).toEqual([{ id: 'sync.status', location: 'main' }])
    expect(h.commands.sort()).toEqual([
      'sync.disconnect',
      'sync.mark-baseline',
      'sync.open',
      'sync.open-conflict',
      'sync.resolve-conflict',
      'sync.run',
      'sync.save',
      'sync.set-attachments',
      'sync.set-backend',
      'sync.set-provider',
      'sync.test',
      'sync.toggle-auto',
    ])
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('订阅五个内核事件', async () => {
    const h = await harness()
    expect(Object.keys(h.handlers).sort()).toEqual([
      'note:changed',
      'note:created',
      'note:deleted',
      'note:renamed',
      'note:saved',
    ])
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('webdav 后端下**不订阅**这五个事件（两种后端的自动检查互不干扰）', async () => {
    // 只给 settings.v1 不够：harness 会补 backend:'folder'，这里显式覆盖成 webdav
    const h = await harness({}, { 'settings.v1': { backend: 'webdav' } })
    expect(Object.keys(h.handlers)).toEqual([])
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  /* rev173.112 · 启用 / 停用开关 */

  it('toggle：写 settings.v1，来回切都落盘', async () => {
    const h = await harness()
    await settle()
    const toggle = h.runs.get('sync.toggle-auto')!
    expect(toggle).toBeTypeOf('function')

    await toggle()
    expect(h.store.get('settings.v1')).toMatchObject({ backend: 'folder', auto: false })
    expect(h.host.notes.some((n) => n.msg.includes('自动检查已关闭'))).toBe(true)

    await toggle()
    expect(h.store.get('settings.v1')).toMatchObject({ backend: 'folder', auto: true })
    expect(h.host.notes.some((n) => n.msg.includes('自动检查已开启'))).toBe(true)

    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('store 里 auto:false ⇒ 启动读到「已停用」（toggle 一次就变 true）', async () => {
    const h = await harness({}, { 'settings.v1': { auto: false } })
    await settle()
    await h.runs.get('sync.toggle-auto')!()
    expect(h.store.get('settings.v1')).toMatchObject({ auto: true })
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  /* rev173.114 · `.zn/` 排除检查 */

  it('looksLikeSyncConflict：认得各家的冲突副本，不误伤自己的副本', async () => {
    // Syncthing / OneDrive / 中文客户端
    expect(looksLikeSyncConflict('周报.sync-conflict-20261024-123456-ABC123.md')).toBe(true)
    expect(looksLikeSyncConflict('周报 (conflicted copy).md')).toBe(true)
    expect(looksLikeSyncConflict('周报 (冲突副本).md')).toBe(true)
    // 自己的冲突副本命名（`<时间>-<文件名>.md`）不能算命中
    expect(looksLikeSyncConflict('2026-10-24 2053-双链验收.md')).toBe(false)
    expect(looksLikeSyncConflict('')).toBe(false)
  })

  it('「测试连接」在文件夹后端 = 检查 .zn/：有同步冲突副本 ⇒ 报警并带出文件名', async () => {
    const h = await harness({
      '.zn/sync/last/周报.sync-conflict-20261024-123456-ABCDEF.md': 'x',
    })
    await settle()
    await h.runs.get('sync.test')!()
    await settle()
    const warn = h.host.notes.find((n) => n.level === 'warn' && n.msg.includes('.zn/'))
    expect(warn?.msg).toContain('sync-conflict')
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('「测试连接」没痕迹时给「没发现」而不是沉默', async () => {
    const h = await harness({ '.zn/sync/last/abc123.md': 'x' })
    await settle()
    await h.runs.get('sync.test')!()
    await settle()
    expect(h.host.notes.some((n) => n.msg.includes('没发现同步冲突痕迹'))).toBe(true)
    h.api.subscriptions.forEach((s) => s.dispose())
  })
})

describe('冲突端到端（双端都改同一篇）', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('本机保存 → 外部改成另一版 ⇒ 写 `.zn/conflicts/windows/…` 且 content 是本机版', async () => {
    const h = await harness({ '周报.md': '# 周报\n本机版' })
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
    const h = await harness({ 'a.md': 'v1' })
    await settle()
    h.handlers['note:created']({ path: 'a.md' })
    await settle()

    h.mem.files.set('a.md', 'v2')
    h.handlers['note:changed']({ path: 'a.md', kind: 'modify' })
    await settle()

    expect(h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts'))).toHaveLength(0)
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  /* rev173.120 · 内核口子：插件写盘带 origin: 'plugin' */

  it('`note:changed` 带 origin:"plugin"（插件自己写盘）⇒ 完全忽略，不判冲突', async () => {
    const h = await harness({ 'c.md': '基线版' })
    await settle()
    h.handlers['note:created']({ path: 'c.md' })
    await settle()
    const writesBefore = h.mem.writes.length

    // 模拟插件（三方合并 / 导入）落盘：磁盘内容变了，内核发带 origin 的 changed
    h.mem.files.set('c.md', '插件写进来的新内容')
    h.handlers['note:changed']({ path: 'c.md', kind: 'modify', origin: 'plugin' })
    await settle()

    // 不该留冲突副本、也不该动任何东西（基线 / pending 归发起方对齐）
    expect(h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts'))).toHaveLength(0)
    expect(h.mem.writes.length).toBe(writesBefore)
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('插件写盘不再触发 note:saved ⇒ 不留僵尸 pending（rev173.120 根治）', async () => {
    const h = await harness({ 'd.md': '基线版' })
    await settle()
    h.handlers['note:created']({ path: 'd.md' })
    await settle()

    /**
     * 真内核在插件写盘时只发 `note:changed(origin:'plugin')`，**不发 note:saved**。
     * 这里直接模拟那个口径：只发 changed ⇒ pending 必须保持为空
     * （以前要靠 `selfWrites` 抑制表才挡得住，现在内核层面就不发错事件）。
     */
    h.mem.files.set('d.md', '插件合并结果')
    h.handlers['note:changed']({ path: 'd.md', kind: 'modify', origin: 'plugin' })
    await settle()

    const pending = (h.store.get('folder.pending.v1') ?? {}) as Record<string, unknown>
    expect(Object.keys(pending)).toHaveLength(0)
    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('外部删除 + 本地改过 ⇒ 本地版进冲突目录', async () => {
    const h = await harness({ 'b.md': '本机改过' })
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
    const h = await harness({ 'c.md': 'mine' })
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
    const h = await harness({ 'd.md': 'v1' })
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

  it('保存的判定被回响抢跑（读盘慢）⇒ pending 仍留下，本机版不丢（rev173.133）', async () => {
    /**
     * 真实时序：`note:saved` 的处理体里有一次读盘（IPC）。Rust watcher 的回响若在这段
     * `await` 中间跑完判定，pending 还没建立 ⇒ 磁盘是新内容、基线还是旧内容 ⇒ 判
     * `remote`（当成"别处更新"），基线对齐新内容；随后 saved 醒来看到
     * `baseline.fp === 当前 fp` 直接早退 ⇒ 这次改动**既没有 pending 也没有影子副本**，
     * 永远同步不出去（rev173.116 实测记下的观察项，rev173.133 修）。
     *
     * `slowNextRead` 只拖慢「saved 那次」读盘，回响那次照常立即返回 —— 精确重现抢跑。
     */
    const h = await harness({ 'f.md': 'v1' })
    await settle()
    h.handlers['note:created']({ path: 'f.md' }) // 基线 = v1
    await settle()

    h.mem.files.set('f.md', 'v2')
    h.mem.slowNextRead('f.md')
    h.handlers['note:saved']({ path: 'f.md', text: 'v2' })
    h.handlers['note:changed']({ path: 'f.md', kind: 'modify' })
    await settle()

    // 对端再改成 v3 ⇒ 必须判得出冲突，且留的是本机版 v2
    h.mem.files.set('f.md', 'v3')
    h.handlers['note:changed']({ path: 'f.md', kind: 'modify' })
    await settle()
    const cw = h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts/windows/'))
    expect(cw).toHaveLength(1)
    expect(cw[0].content).toBe('v2')

    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('新建的判定不再读盘（带 text）⇒ 同步点用内核正文种下（rev173.135）', async () => {
    /**
     * `note:created` 以前要 `await readText` 才拿得到正文。Rust watcher 的回响若在那段
     * `await` 中间先跑完 `scan`，这篇会被当成"外部已有、本机没有" —— 基线按磁盘对齐、
     * **同步点没种下**（冲突判定仍正确，只是第一次同步多绕一圈）。
     *
     * rev173.135 内核随事件带 `text`：判定段同步完成，`slowNextRead` 根本不会被消费。
     */
    const snapshots: Array<{ path: string; text: string }> = []
    const h = await harness({ 'g.md': 'v1' }, {}, {
      history: {
        findBase: async () => null,
        snapshot: async (path: string, text: string) => {
          snapshots.push({ path, text })
          return true
        },
      },
    })
    await settle()

    h.mem.slowNextRead('g.md') // 旧代码会在这让出事件循环
    h.handlers['note:created']({ path: 'g.md', text: 'v1' })

    // ① 判定段**同步**完成：这一刻还没为这篇读过盘（旧代码这里会 await readText）
    expect(h.mem.reads).not.toContain('g.md')

    await settle()
    // ② 同步点直接用事件里的正文种下
    expect(snapshots).toEqual([{ path: 'g.md', text: 'v1' }])

    h.api.subscriptions.forEach((s) => s.dispose())
  })
})

/**
 * rev173.116 三方合并：本机保存 + 外部改同一篇的不同段落 ⇒ 自动合上，两边都不丢。
 *
 * 关键时序（与真实一致）：基线来自一次外部事件（`note:changed` 判 `new`），
 * 本机保存时写影子副本（`mine`），外部再改一次时 `theirs` 是磁盘内容 —— 三个快照齐了才能合。
 */
describe('三方合并（rev173.116）', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  const base = '# 周报\n第一段\n第二段\n'
  const mergedServices = (b: string) => ({
    history: { findBase: async () => b, snapshot: async () => true },
    'kernel.merge': { mergeLines },
  })

  it('两边改不同段 ⇒ 自动合上，无冲突副本、两边改动都在', async () => {
    const h = await harness({ '周报.md': base }, {}, mergedServices(base))
    await settle()

    // ① 首次外部事件 ⇒ 基线 = base（同时种同步点）
    h.handlers['note:changed']({ path: '周报.md', kind: 'modify' })
    await settle()

    // ② 本机保存：改标题（影子副本 = 本机版）
    const mine = '# 周报（本机改的标题）\n第一段\n第二段\n'
    h.mem.files.set('周报.md', mine)
    h.handlers['note:saved']({ path: '周报.md' })
    await settle()

    // ③ 外部改成另一版：改第三行
    const theirs = '# 周报\n第一段\n第二段（外部改的）\n'
    h.mem.files.set('周报.md', theirs)
    h.handlers['note:changed']({ path: '周报.md', kind: 'modify' })
    await settle()

    const merged = h.mem.files.get('周报.md') as string
    expect(merged).toContain('本机改的标题')
    expect(merged).toContain('外部改的')
    expect(h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts'))).toHaveLength(0)
    expect(h.host.notes.some((n) => n.msg.includes('已自动合并'))).toBe(true)

    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('两边改同一行 ⇒ 不合（退回留副本，副本 = 本机版）', async () => {
    const h = await harness({ '周报.md': base }, {}, mergedServices(base))
    await settle()
    h.handlers['note:changed']({ path: '周报.md', kind: 'modify' })
    await settle()

    h.mem.files.set('周报.md', '# 周报\n本机版\n第二段\n')
    h.handlers['note:saved']({ path: '周报.md' })
    await settle()

    h.mem.files.set('周报.md', '# 周报\n外部版\n第二段\n')
    h.handlers['note:changed']({ path: '周报.md', kind: 'modify' })
    await settle()

    const conflictWrites = h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts/windows/'))
    expect(conflictWrites).toHaveLength(1)
    expect(conflictWrites[0].content).toContain('本机版')
    expect(h.mem.files.get('周报.md')).toBe('# 周报\n外部版\n第二段\n')

    h.api.subscriptions.forEach((s) => s.dispose())
  })

  it('没有 history 同步点 ⇒ 退回留副本（降级不丢字）', async () => {
    // 只给合并实现、不给 base：autoMerge 拿不到 base 直接返回 null
    const h = await harness({ '周报.md': base }, {}, { 'kernel.merge': { mergeLines } })
    await settle()
    h.handlers['note:changed']({ path: '周报.md', kind: 'modify' })
    await settle()

    h.mem.files.set('周报.md', '# 周报\n本机版\n第二段\n')
    h.handlers['note:saved']({ path: '周报.md' })
    await settle()

    h.mem.files.set('周报.md', '# 周报\n外部版\n第二段\n')
    h.handlers['note:changed']({ path: '周报.md', kind: 'modify' })
    await settle()

    expect(h.mem.writes.filter((w) => w.path.startsWith('.zn/conflicts/windows/'))).toHaveLength(1)

    h.api.subscriptions.forEach((s) => s.dispose())
  })
})

describe('tryAutoMerge（与 sync-webdav 同一判据）', () => {
  const base = 'A\nB\nC\n'

  it('两边改不同行 ⇒ 合上', async () => {
    const r = tryAutoMerge({ base, mine: 'A1\nB\nC\n', theirs: 'A\nB\nC1\n', mergeLines })
    expect(r?.text).toBe('A1\nB\nC1\n')
  })

  it('同一行 ⇒ null；缺 base / 缺实现 ⇒ null', async () => {
    expect(tryAutoMerge({ base, mine: 'A\nB1\nC\n', theirs: 'A\nB2\nC\n', mergeLines })).toBeNull()
    expect(tryAutoMerge({ base: null, mine: 'x', theirs: 'y', mergeLines })).toBeNull()
    expect(tryAutoMerge({ base, mine: 'x', theirs: 'y' })).toBeNull()
  })

  it('两边改成同一内容 ⇒ null（不写盘，也不自触发 note:saved）', async () => {
    expect(tryAutoMerge({ base, mine: 'A1\nB\nC\n', theirs: 'A1\nB\nC\n', mergeLines })).toBeNull()
  })
})

/** 递归收集 UINode 树里的文本（text 值 / badge 文案） */
function collectTexts(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out
  const n = node as { type?: string; value?: string; text?: string; children?: unknown[] }
  if (typeof n.value === 'string') out.push(n.value)
  if (typeof n.text === 'string') out.push(n.text)
  if (Array.isArray(n.children)) for (const c of n.children) collectTexts(c, out)
  return out
}

describe('扫描耗时（rev173.117）', () => {
  it('扫描后面板给「上次检查：HH:MM:SS（用时 …）」', async () => {
    const h = await harness({ 'a.md': '# 一\n' })
    await h.runs.get('sync.run')!()
    const render = h.renders.get('sync.status')!
    const texts = collectTexts(render({ state: {} }))
    const line = texts.find((t) => t.startsWith('上次检查：'))
    expect(line).toBeTruthy()
    // 第一次扫就有耗时（毫秒级也算），不能只有时间没有用时
    expect(line).toContain('用时')
  })

  it('没扫过时说「还没检查过」', async () => {
    const h = await harness({ 'a.md': '# 一\n' })
    const texts = collectTexts(h.renders.get('sync.status')!({ state: {} }))
    expect(texts).toContain('上次检查：还没检查过')
  })
})

/**
 * rev173.164 · 期 1c：**密码库目录放行**。
 *
 * sync-folder 自己不搬文件（靠 Syncthing 等外部工具），所以"放行"对它只有两件事：
 *  ① 把放行规则讲清楚（`.zn/secrets/` + `.zn/security/`，其余 `.zn/` 继续排除）
 *  ② **密码库出现冲突副本 ≠ "同步工具没排除 .zn/"** —— 那是用户按提示放行后才可能的正常现象，
 *     含义是"两端都改过密码库"，必须人挑一份（密文没法自动合并）。
 */
describe('密码库目录放行与冲突检测（rev173.164 · 期 1c）', () => {
  it('SECRET_DIRS 正好是三个私有目录（密码库两处 + 私密笔记一棵树）', async () => {
    // rev173.182 加 `.zn/private`：私密笔记也要能跨设备同步（每篇一个密文）
    expect(SECRET_DIRS).toEqual(['.zn/secrets', '.zn/security', '.zn/private'])
  })

  it('密码库出现同步冲突副本 ⇒ 明确报「密码库」并要人挑一份', async () => {
    const h = await harness({
      '.zn/secrets/secrets.zn': 'zn1.A.B',
      '.zn/secrets/secrets.sync-conflict-20261026-101010-ABCDEF.zn': 'zn1.C.D',
    })
    await settle()
    await h.runs.get('sync.test')!()
    await settle()
    const last = h.host.notes.at(-1)
    expect(last?.msg).toContain('密码库')
    expect(last?.msg).toContain('冲突副本')
    expect(last?.level).toBe('warn')
  })

  it('没有冲突副本 ⇒ 提示里带上放行规则（.zn/secrets/ 与 .zn/security/）', async () => {
    const h = await harness({ '.zn/secrets/secrets.zn': 'zn1.A.B' })
    await settle()
    await h.runs.get('sync.test')!()
    await settle()
    const last = h.host.notes.at(-1)
    expect(last?.msg).toContain('.zn/secrets/ 与 .zn/security/')
  })

  it('.zn/ 别处的冲突痕迹仍然报「没排除 .zn/」（两条不能混）', async () => {
    const h = await harness({
      '.zn/sync/last/abc.sync-conflict-20261026-101010-ABCDEF.md': 'x',
    })
    await settle()
    await h.runs.get('sync.test')!()
    await settle()
    const last = h.host.notes.at(-1)
    expect(last?.msg).toContain('同步工具没有排除它')
    expect(last?.msg).not.toContain('密码库')
  })
})
