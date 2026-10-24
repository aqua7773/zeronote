/**
 * 历史版本（`examples/history`）—— rev173.99 · ROADMAP 第 5 项。
 *
 * 覆盖：哈希 / 文件名往返 / 分层精简四档 / 行级 diff / HTML 转义 / 面板视图 / 接线与触发。
 */
import { describe, expect, it, vi } from 'vitest'
import plugin, {
  basePath,
  diffHtml,
  diffSummary,
  escapeHtml,
  hash32,
  historyNode,
  humanSize,
  lineDiff,
  monthKey,
  parseSnapshotName,
  prunePlan,
  snapshotName,
  weekKey,
} from '../examples/history/index.js'

const DAY = 24 * 60 * 60 * 1000

/* ───────────────────────── 基础工具 ───────────────────────── */

describe('hash32 / 文件名', () => {
  it('同一路径稳定、不同路径不同', () => {
    expect(hash32('笔记/周报.md')).toBe(hash32('笔记/周报.md'))
    expect(hash32('笔记/周报.md')).not.toBe(hash32('笔记/月报.md'))
    expect(hash32('a')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('快照文件名与时间戳可往返（秒级精度）', () => {
    const ts = new Date(2026, 9, 23, 23, 45, 12, 345).getTime()
    const name = snapshotName(ts)
    expect(name).toBe('2026-10-23T23-45-12-345.md')
    expect(parseSnapshotName(name)).toBe(ts)
    expect(parseSnapshotName(`.zn/history/abc/${name}`)).toBe(ts)
  })

  it('不合格式的文件名 → 0（列表里被跳过）', () => {
    expect(parseSnapshotName('readme.md')).toBe(0)
    expect(parseSnapshotName('2026-10-23.md')).toBe(0)
  })

  it('大小显示', () => {
    expect(humanSize(512)).toBe('512 B')
    expect(humanSize(2048)).toBe('2.0 KB')
    expect(humanSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('weekKey / monthKey（分层精简的分组键）', () => {
  it('同一自然周（周一起）键相同，跨周不同', () => {
    const mon = new Date(2026, 9, 19, 10).getTime() // 周一
    const sun = new Date(2026, 9, 25, 23).getTime() // 周日
    const nextMon = new Date(2026, 9, 26, 8).getTime()
    expect(weekKey(mon)).toBe(weekKey(sun))
    expect(weekKey(mon)).not.toBe(weekKey(nextMon))
  })

  it('月份键', () => {
    expect(monthKey(new Date(2026, 9, 1).getTime())).toBe('2026-10')
    expect(monthKey(new Date(2026, 10, 5).getTime())).toBe('2026-11')
  })
})

/* ───────────────────────── 分层精简（需求 §11） ───────────────────────── */

describe('prunePlan：四档保留', () => {
  const now = new Date(2026, 9, 23, 12).getTime()

  it('7 天内：全留', () => {
    const entries = [1, 2, 3].map((h) => ({ name: `h${h}`, ts: now - h * DAY }))
    const { keep, drop } = prunePlan(entries, now)
    expect(keep).toHaveLength(3)
    expect(drop).toEqual([])
  })

  it('8–30 天：每个自然日留最后一版', () => {
    const d = now - 10 * DAY
    const entries = [
      { name: 'a', ts: d },
      { name: 'b', ts: d + 1000 },
      { name: 'c', ts: d + 2000 },
    ]
    const { keep, drop } = prunePlan(entries, now)
    expect(keep).toEqual(['c'])
    expect(drop).toEqual(['a', 'b'])
  })

  it('31–365 天：每个自然周留最后一版', () => {
    const base = now - 100 * DAY
    const entries = [
      { name: 'w1', ts: base },
      { name: 'w2', ts: base + 1000 },
      { name: 'w3', ts: base + 8 * DAY }, // 下一周
    ]
    const { keep, drop } = prunePlan(entries, now)
    expect(keep).toContain('w2')
    expect(keep).toContain('w3')
    expect(drop).toContain('w1')
  })

  it('超过 1 年：每月留最后一版', () => {
    const d1 = new Date(2024, 0, 5, 10).getTime()
    const d1b = new Date(2024, 0, 20, 10).getTime()
    const d2 = new Date(2024, 1, 5, 10).getTime()
    const { keep, drop } = prunePlan(
      [
        { name: 'jan-a', ts: d1 },
        { name: 'jan-b', ts: d1b },
        { name: 'feb', ts: d2 },
      ],
      now,
    )
    expect(keep).toContain('jan-b')
    expect(keep).toContain('feb')
    expect(drop).toEqual(['jan-a'])
  })

  it('非法输入安全', () => {
    expect(prunePlan([], now)).toEqual({ keep: [], drop: [] })
    expect(prunePlan(null, now)).toEqual({ keep: [], drop: [] })
    const { keep } = prunePlan([{ name: '', ts: 1 }, { name: 'x', ts: now - DAY }], now)
    expect(keep).toEqual(['x'])
  })
})

/* ───────────────────────── 行级 diff ───────────────────────── */

describe('lineDiff / diffSummary', () => {
  it('相同内容全 same、统计 0/0', () => {
    const ops = lineDiff('a\nb', 'a\nb')
    expect(ops.every((o) => o.t === 'same')).toBe(true)
    expect(diffSummary(ops)).toEqual({ added: 0, removed: 0 })
  })

  it('改一行 = 删旧 + 加新', () => {
    const ops = lineDiff('a\nb\nc', 'a\nB\nc')
    const s = diffSummary(ops)
    expect(s).toEqual({ added: 1, removed: 1 })
    expect(ops.filter((o) => o.t === 'same').map((o) => o.text)).toEqual(['a', 'c'])
  })

  it('纯新增 / 纯删除', () => {
    expect(diffSummary(lineDiff('a', 'a\nb'))).toEqual({ added: 1, removed: 0 })
    expect(diffSummary(lineDiff('a\nb', 'a'))).toEqual({ added: 0, removed: 1 })
  })

  it('空文本不炸', () => {
    expect(diffSummary(lineDiff('', ''))).toEqual({ added: 0, removed: 0 })
  })
})

describe('escapeHtml / diffHtml', () => {
  it('笔记正文里的标签会被转义（防注入）', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
    expect(escapeHtml(`a & b "c" 'd'`)).toBe('a &amp; b &quot;c&quot; &#39;d&#39;')
  })

  it('diffHtml 只画变化行，且转义内容', () => {
    const html = diffHtml(lineDiff('a\n<b>', 'a\n<b>\n<img onerror=x>'))
    expect(html).toContain('zn-diff-add')
    expect(html).toContain('&lt;img onerror=x&gt;')
    expect(html).not.toContain('<img')
  })

  it('没有变化时返回空串（面板显示"一致"）', () => {
    expect(diffHtml(lineDiff('a', 'a'))).toBe('')
  })
})

/* ───────────────────────── 面板视图 ───────────────────────── */

type Node = { type: string; children?: Node[]; items?: unknown[]; empty?: string; value?: string; label?: string }

function walk(node: Node, out: Node[] = []): Node[] {
  out.push(node)
  for (const c of node.children ?? []) walk(c, out)
  for (const it of (node.items ?? []) as unknown[]) {
    const n = it as { node?: Node }
    if (n?.node) walk(n.node, out)
  }
  return out
}

describe('historyNode', () => {
  it('没有目标笔记（直接开面板）→ 引导态 + 按钮，而不是「「」的历史 0 版」', () => {
    const node = historyNode({ title: '', entries: [] }) as Node
    const btn = walk(node).find((n) => n.type === 'button') as unknown as { onClick: string }
    expect(btn.onClick).toBe('history.show-for-current')
    expect(walk(node).some((n) => n.value?.includes('当前笔记'))).toBe(true)
  })

  it('有目标但没历史时给触发说明', () => {
    const node = historyNode({ title: '周报', entries: [] }) as Node
    const empty = walk(node).find((n) => n.type === 'list')?.empty
    expect(empty).toContain('关闭或切到别的笔记')
    expect(empty).toContain('现在存一版')
  })

  it('列出条目，点一条走 history.pick', () => {
    const node = historyNode({
      title: '周报',
      entries: [{ file: 'h1', label: '2026-10-23 23:45', meta: '' }],
    }) as Node
    const link = walk(node).find((n) => n.type === 'link') as unknown as {
      onClick: string
      payload: { file: string }
    }
    expect(link.onClick).toBe('history.pick')
    expect(link.payload).toEqual({ file: 'h1' })
  })

  it('选中后出现「回滚到这一版」按钮（danger）', () => {
    const node = historyNode({
      title: '周报',
      entries: [],
      selected: 'h1',
      summary: '与当前版本：+1 行 / −0 行',
      diff: '<div>…</div>',
    }) as Node
    const btn = walk(node).find(
      (n) => n.type === 'button' && n.label === '回滚到这一版',
    ) as unknown as { label: string; payload: { file: string } }
    expect(btn.label).toBe('回滚到这一版')
    expect(btn.payload).toEqual({ file: 'h1' })
  })
})

/* ───────────────────────── 接线与触发 ───────────────────────── */

function fakeApi() {
  const commands = new Map<string, { id: string; run: (p?: unknown) => unknown }>()
  const panels: { id: string; location: string; render: () => Node }[] = []
  const handlers = new Map<string, (d: unknown) => void>()
  const executed: { id: string; payload: unknown }[] = []
  const writes: { path: string; content: string }[] = []
  /** 本插件 `provide` 出去的服务（名字 → 懒工厂）—— rev173.115 给同步插件用 */
  const services = new Map<string, () => unknown>()

  const api = {
    subscriptions: [] as unknown[],
    service: {
      provide: vi.fn((name: string, factory: () => unknown) => {
        services.set(name, factory)
        return { dispose: vi.fn() }
      }),
      consume: vi.fn(async (name: string) => {
        const f = services.get(name)
        return f ? await f() : null
      }),
    },
    fs: {
      listFiles: vi.fn(async () => [] as string[]),
      mkdir: vi.fn(async () => {}),
      writeText: vi.fn(async (path: string, content: string) => {
        writes.push({ path, content })
      }),
      readText: vi.fn(async () => ''),
      purgePrivate: vi.fn(async () => {}),
    },
    doc: {
      on: vi.fn((ev: string, cb: (d: unknown) => void) => {
        handlers.set(ev, cb)
        return { dispose: vi.fn() }
      }),
      active: vi.fn(() => null),
      replaceRange: vi.fn(),
    },
    view: {
      registerPanel: vi.fn((spec: { id: string; location: string; render: () => Node }) => {
        panels.push(spec)
        return { dispose: vi.fn() }
      }),
      refresh: vi.fn(),
    },
    command: {
      register: vi.fn((spec: { id: string; run: (p?: unknown) => unknown }) => {
        commands.set(spec.id, spec)
        return { dispose: vi.fn() }
      }),
      execute: vi.fn(async (id: string, payload?: unknown) => {
        executed.push({ id, payload })
      }),
    },
    host: { log: vi.fn(), notify: vi.fn() },
  }
  return { api, commands, panels, handlers, executed, writes, services }
}

describe('apply：面板 / 命令 / 触发', () => {
  it('面板：历史浮层 + 状态栏入口；5 条命令；订阅四个事件', () => {
    const { api, commands, panels, handlers } = fakeApi()
    plugin.apply(api as never)
    expect(panels.map((p) => p.id)).toEqual(['history.status', 'history.board'])
    expect(panels[0].location).toBe('statusbar')
    expect(panels[1].location).toBe('modal')
    for (const id of [
      'history.show-for-current',
      'history.refresh',
      'history.snapshot-now',
      'history.pick',
      'history.rollback',
    ]) {
      expect(commands.has(id)).toBe(true)
    }
    expect([...handlers.keys()].sort()).toEqual(['change', 'close', 'open', 'save'])
  })

  it('改过再关闭 → 存一份快照（mkdir + writeText 到 .zn/history）', async () => {
    const { api, handlers, writes } = fakeApi()
    plugin.apply(api as never)
    handlers.get('change')!({ path: '笔记/周报.md', content: 'v2' })
    handlers.get('close')!({ path: '笔记/周报.md', content: 'v2' })
    await new Promise((r) => setTimeout(r, 0))

    expect(api.fs.mkdir).toHaveBeenCalled()
    expect(writes).toHaveLength(1)
    expect(writes[0].path).toMatch(/^\.zn\/history\/[0-9a-f]{8}\/\d{4}-/)
    expect(writes[0].content).toBe('v2')
  })

  it('改完直接切到另一篇（不发 close）→ 用缓存的正文存快照', async () => {
    const { api, handlers, writes } = fakeApi()
    plugin.apply(api as never)
    handlers.get('change')!({ path: 'a.md', content: 'A2' })
    handlers.get('open')!({ path: 'b.md', content: 'B1' })
    await new Promise((r) => setTimeout(r, 0))

    expect(writes).toHaveLength(1)
    expect(writes[0].content).toBe('A2')
  })

  it('没改过就关闭 → 不生成（需求原文）', async () => {
    const { api, handlers, writes } = fakeApi()
    plugin.apply(api as never)
    handlers.get('close')!({ path: '笔记/周报.md', content: 'v2' })
    await new Promise((r) => setTimeout(r, 0))
    expect(writes).toHaveLength(0)
  })

  it('打开历史面板会列出该笔记的快照（读 listFiles）', async () => {
    const { api, commands } = fakeApi()
    api.doc.active.mockReturnValue({ path: '笔记/周报.md', content: 'v2' })
    api.fs.listFiles.mockResolvedValue(['.zn/history/x/2026-10-23T23-45-12-345.md'])
    plugin.apply(api as never)

    await commands.get('history.show-for-current')!.run()

    expect(api.fs.listFiles).toHaveBeenCalled()
    expect(api.command.execute).toHaveBeenCalledWith('core.panel.history.board')
  })

  it('回滚：先存当前版本，再写回历史内容', async () => {
    const { api, commands, writes } = fakeApi()
    api.doc.active.mockReturnValue({ path: '笔记/周报.md', content: 'now' })
    api.fs.readText.mockResolvedValue('old')
    plugin.apply(api as never)

    // 先打开面板建立 target
    await commands.get('history.show-for-current')!.run()
    writes.length = 0
    await commands.get('history.rollback')!.run({ file: '.zn/history/x/2026-10-23T23-45-12-345.md' })

    // 第一次写 = pre-rollback 快照（内容是当前），第二次写 = 回滚到 old
    expect(writes).toHaveLength(2)
    expect(writes[0].content).toBe('now')
    expect(writes[1].content).toBe('old')
  })
})

/* ───────────────────────── 同步点（rev173.115 三方合并的 base） ───────────────────────── */

describe('同步点：basePath / history 服务', () => {
  it('固定文件名 + 按路径分目录（同名文件不会串）', () => {
    const a = basePath('笔记/周报.md')
    expect(a).toBe(`.zn/history/${hash32('笔记/周报.md')}/base.sync.md`)
    expect(basePath('笔记/月报.md')).not.toBe(a)
    expect(basePath('x.md')).toMatch(/^\.zn\/history\/[0-9a-f]{8}\/base\.sync\.md$/)
  })

  it('base.sync.md 不会被当成历史条目（parseSnapshotName 不认）', () => {
    expect(parseSnapshotName('base.sync.md')).toBe(0)
  })

  it('按同步后端分开（rev173.116）：webdav / folder 各一份，不会互相覆盖', () => {
    expect(basePath('a.md', 'sync:webdav')).toMatch(/\.zn\/history\/[0-9a-f]{8}\/base\.webdav\.sync\.md$/)
    expect(basePath('a.md', 'sync:folder')).toMatch(/\.zn\/history\/[0-9a-f]{8}\/base\.folder\.sync\.md$/)
    expect(basePath('a.md', 'sync')).toMatch(/\.zn\/history\/[0-9a-f]{8}\/base\.sync\.md$/)
    expect(basePath('a.md')).toBe(basePath('a.md', 'sync'))
    // tag 里的路径字符不会漏进文件名
    expect(basePath('a.md', 'sync:../evil')).toMatch(/\/base\.evil\.sync\.md$/)
  })

  it('service：tag 落到各自的文件（两个后端写东西不串）', async () => {
    const { api, services, writes } = fakeApi()
    plugin.apply(api as never)
    const svc = (await services.get('history')!()) as { snapshot: Function }
    await svc.snapshot('a.md', 'w', { tag: 'sync:webdav' })
    await svc.snapshot('a.md', 'f', { tag: 'sync:folder' })
    const paths = writes.map((w) => w.path)
    expect(paths.some((p) => p.endsWith('/base.webdav.sync.md'))).toBe(true)
    expect(paths.some((p) => p.endsWith('/base.folder.sync.md'))).toBe(true)
  })

  it('插件 provide 了 history 服务；snapshot({tag:sync}) 写固定名，不产生历史条目', async () => {
    const { api, services, writes } = fakeApi()
    plugin.apply(api as never)
    const factory = services.get('history')
    expect(typeof factory).toBe('function')
    const svc = (await factory!()) as { snapshot: Function; findBase: Function }

    await svc.snapshot('笔记/周报.md', 'v1', { tag: 'sync' })

    const base = writes.filter((w) => w.path.endsWith('/base.sync.md'))
    expect(base).toHaveLength(1)
    expect(base[0].content).toBe('v1')
    // 普通快照名带 `T时-分-秒-毫秒`；同步点不该写这种
    expect(writes.filter((w) => /T\d{2}-\d{2}-\d{2}-\d{3}\.md$/.test(w.path))).toHaveLength(0)
  })

  it('内容没变不重复写（同步每 5 秒一轮，不判重会写穿磁盘）', async () => {
    const { api, services, writes } = fakeApi()
    api.fs.readText.mockResolvedValue('same')
    plugin.apply(api as never)
    const svc = (await services.get('history')!()) as { snapshot: Function }
    await svc.snapshot('a.md', 'same', { tag: 'sync' })
    expect(writes.filter((w) => w.path.endsWith('/base.sync.md'))).toHaveLength(0)
  })

  it('findBase 读回同步点；没有时返回 null（不抛）', async () => {
    const { api, services } = fakeApi()
    plugin.apply(api as never)
    const svc = (await services.get('history')!()) as { findBase: Function }

    api.fs.readText.mockResolvedValue('上次同步的内容')
    expect(await svc.findBase('a.md')).toBe('上次同步的内容')

    api.fs.readText.mockRejectedValue(new Error('ENOENT'))
    expect(await svc.findBase('b.md')).toBeNull()
  })

  it('普通快照不走同步点路径（close 仍写带时间戳的历史版本）', async () => {
    const { api, handlers, writes } = fakeApi()
    plugin.apply(api as never)
    handlers.get('change')!({ path: 'a.md', content: 'v2' })
    handlers.get('close')!({ path: 'a.md', content: 'v2' })
    await new Promise((r) => setTimeout(r, 0))

    expect(writes).toHaveLength(1)
    expect(writes[0].path).not.toContain('base.sync.md')
    expect(writes[0].path).toMatch(/\.zn\/history\/[0-9a-f]{8}\/\d{4}-\d{2}-\d{2}T/)
  })
})
