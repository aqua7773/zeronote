/**
 * 反向链接（`examples/backlinks`）—— rev173.95 · ROADMAP 第 4 项（A2 双链的反链半边）。
 *
 * 覆盖五层：
 *   1. 提取：`[[A]]` / `[[A|显示]]` / 同名去重 / 上限 / 行上下文 / 排除空与跨行
 *   2. 匹配：按标题、按文件名、大小写与 `.md` 后缀、排除自己、稳定排序
 *   3. 歧义：库里同名笔记要能被找出来（面板顶部提示）
 *   4. 视图：空态文案 / 命中行是 link（payload 带 path）/ 歧义提示 tone=warn
 *   5. 接线：面板 location=modal · 命令登记 · show 会开启面板并扫描 · 缓存（mtime 不变不重读磁盘）
 */
import { describe, expect, it, vi } from 'vitest'
import plugin, {
  baseName,
  extractRefs,
  findAmbiguous,
  matchRefs,
  normName,
  noteNode,
} from '../examples/backlinks/index.js'

/* ───────────────────────── 1. 提取 ───────────────────────── */

describe('extractRefs：抽 `[[…]]`', () => {
  it('普通引用与带显示名的引用都抽，显示名不算目标', () => {
    const refs = extractRefs('看 [[双链验收]] 与 [[本周进展|周报]] 两篇')
    expect(refs.map((r) => r.name)).toEqual(['双链验收', '本周进展'])
  })

  it('同一篇里重复引用同一目标只留第一处', () => {
    const refs = extractRefs('[[A]] 然后 [[A]] 再 [[A]]')
    expect(refs).toHaveLength(1)
  })

  it('行上下文是引用所在那一行，压成一行', () => {
    const refs = extractRefs('第一行\n  前缀 [[目标]] 后缀  \n第三行')
    expect(refs[0].line).toBe('前缀 [[目标]] 后缀')
  })

  it('空引用 `[[]]`、跨行引用都不算', () => {
    expect(extractRefs('[[]] 与 [[换\n行]]')).toEqual([])
  })

  it('一篇里最多 5 条（防止一篇刷爆面板）', () => {
    const text = Array.from({ length: 9 }, (_, i) => `[[目标${i}]]`).join(' ')
    expect(extractRefs(text)).toHaveLength(5)
  })

  it('超长上下文按字数截断并补省略号', () => {
    const refs = extractRefs(`${'长'.repeat(200)}[[目标]]`)
    expect(Array.from(refs[0].line).length).toBe(121)
    expect(refs[0].line.endsWith('…')).toBe(true)
  })
})

describe('normName / baseName', () => {
  it('去 .md、反斜杠转正斜杠、大小写归一', () => {
    expect(normName('Notes\\Weekly.MD')).toBe('notes/weekly')
    expect(normName('  周报  ')).toBe('周报')
  })

  it('路径取文件名', () => {
    expect(baseName('日记/2026/周报.md')).toBe('周报')
    expect(baseName('周报')).toBe('周报')
  })
})

/* ───────────────────────── 2. 匹配 ───────────────────────── */

const entries = [
  {
    path: '双链验收.md',
    title: '双链验收',
    refs: [
      { name: '标签验收-周报', line: '引用 [[标签验收-周报]]' },
      { name: '本周进展', line: '引用 [[本周进展|周报]]' },
    ],
  },
  { path: '无关.md', title: '无关', refs: [{ name: '别的', line: '[[别的]]' }] },
]

describe('matchRefs：谁引用了目标', () => {
  it('按文件名命中', () => {
    const hits = matchRefs(entries, ['标签验收-周报'], '笔记/标签验收-周报.md')
    expect(hits).toHaveLength(1)
    expect(hits[0].path).toBe('双链验收.md')
    expect(hits[0].line).toContain('[[标签验收-周报]]')
  })

  it('按标题命中', () => {
    const hits = matchRefs(entries, ['本周进展'], '笔记/标签验收-周报.md')
    expect(hits).toHaveLength(1)
    expect(hits[0].name).toBe('本周进展')
  })

  it('大小写与 .md 后缀都归一（`[[WEEKLY.md]]` 能匹配 weekly）', () => {
    const hits = matchRefs(
      [{ path: 'a.md', title: 'A', refs: [{ name: 'WEEKLY.md', line: '[[WEEKLY.md]]' }] }],
      ['weekly'],
      'b.md',
    )
    expect(hits).toHaveLength(1)
  })

  it('排除自己引用自己', () => {
    const hits = matchRefs(entries, ['双链验收'], '双链验收.md')
    expect(hits).toEqual([])
  })

  it('空目标名返回空表', () => {
    expect(matchRefs(entries, [], 'x.md')).toEqual([])
  })
})

describe('findAmbiguous：同名笔记', () => {
  it('库里另一篇同名笔记会被列出（不含自己）', () => {
    const notes = [
      { path: '周报.md', title: '周报' },
      { path: '归档/周报.md', title: '周报' },
      { path: '别的.md', title: '别的' },
    ]
    const amb = findAmbiguous(notes, ['周报'], '周报.md')
    expect(amb.map((n) => n.path)).toEqual(['归档/周报.md'])
  })
})

/* ───────────────────────── 4. 视图 ───────────────────────── */

type Node = { type: string; children?: Node[]; items?: unknown[]; empty?: string; value?: string; tone?: string }

function walk(node: Node, out: Node[] = []): Node[] {
  out.push(node)
  for (const c of node.children ?? []) walk(c, out)
  for (const it of (node.items ?? []) as unknown[]) {
    const n = it as { node?: Node }
    if (n?.node) walk(n.node, out)
  }
  return out
}

describe('noteNode：反链面板', () => {
  it('没有引用时给出空态，标题里带目标名', () => {
    const node = noteNode({ target: '周报', hits: [] }) as Node
    const all = walk(node)
    expect(all.some((n) => n.type === 'list' && n.empty?.includes('周报'))).toBe(true)
  })

  it('命中的来源标题是可点的 link，payload 带 path', () => {
    const node = noteNode({
      target: '周报',
      hits: [{ path: '双链验收.md', title: '双链验收', name: '周报', line: '引用 [[周报]]' }],
    }) as Node
    const link = walk(node).find((n) => n.type === 'link') as unknown as {
      label: string
      onClick: string
      payload: { path: string }
    }
    expect(link.label).toBe('双链验收')
    expect(link.onClick).toBe('backlinks.open')
    expect(link.payload).toEqual({ path: '双链验收.md' })
  })

  it('有同名笔记时给出 warn 提示', () => {
    const node = noteNode({
      target: '周报',
      hits: [],
      ambiguity: [{ path: '归档/周报.md', title: '周报' }],
    }) as Node
    const warn = walk(node).find((n) => n.type === 'text' && n.tone === 'warn') as
      | { value: string }
      | undefined
    expect(warn?.value).toContain('同名')
    expect(warn?.value).toContain('归档/周报.md')
  })
})

/* ───────────────────────── 5. 接线 ───────────────────────── */

type PanelSpec = {
  id: string
  title: string
  location: string
  render: (ctx?: { pluginId: string; state: Record<string, unknown> }) => Node
}

function fakeApi(
  opts: { doc?: { path: string } | null; notes?: unknown[]; texts?: Record<string, string> } = {},
) {
  const commands = new Map<string, { id: string; run: (p?: unknown) => unknown }>()
  const panels: PanelSpec[] = []
  const executed: { id: string; payload: unknown }[] = []
  const store = new Map<string, unknown>()

  const notes = opts.notes ?? [
    { path: '双链验收.md', title: '双链验收', mtime: Date.now(), kind: 'note' },
    { path: '标签验收-周报.md', title: '本周进展', mtime: Date.now(), kind: 'note' },
  ]
  const texts: Record<string, string> = {
    '双链验收.md': '引用 [[标签验收-周报]] 与 [[本周进展]]',
    '标签验收-周报.md': '没有引用',
    ...(opts.texts ?? {}),
  }

  const readText = vi.fn(async (path: string) => texts[path] ?? '')
  const docHandlers = new Map<string, (d: unknown) => void>()
  const events = new Map<string, (p: unknown) => void>()

  const api = {
    subscriptions: [] as unknown[],
    doc: {
      active: vi.fn(() => opts.doc ?? null),
      on: vi.fn((ev: string, cb: (d: unknown) => void) => {
        docHandlers.set(ev, cb)
        return { dispose: vi.fn() }
      }),
    },
    event: {
      on: vi.fn((topic: string, cb: (p: unknown) => void) => {
        events.set(topic, cb)
        return { dispose: vi.fn() }
      }),
    },
    fs: {
      listNotes: vi.fn(async () => notes),
      readText,
    },
    store: {
      get: vi.fn(async (key: string, def?: unknown) => (store.has(key) ? store.get(key) : def)),
      set: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value)
      }),
    },
    view: {
      registerPanel: vi.fn((spec: PanelSpec) => {
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
    host: { notify: vi.fn() },
  }
  return { api, commands, panels, executed, readText, docHandlers, events }
}

describe('apply：注册与接线', () => {
  it('面板：浮层 + 状态栏；3 条命令都登记', () => {
    const { api, panels, commands } = fakeApi()
    plugin.apply(api as never)
    expect(panels.map((p) => p.id)).toEqual(['backlinks.board', 'backlinks.status'])
    expect(panels[1].location).toBe('statusbar')
    expect(panels[0].location).toBe('modal')
    for (const id of ['backlinks.show-for-current', 'backlinks.rescan', 'backlinks.open']) {
      expect(commands.has(id)).toBe(true)
    }
  })

  it('没有打开的笔记时提示，不开面板', async () => {
    const { api, commands, executed } = fakeApi({ doc: null })
    plugin.apply(api as never)
    await commands.get('backlinks.show-for-current')!.run()
    expect(api.host.notify).toHaveBeenCalled()
    expect(executed.some((e) => e.id.startsWith('core.panel.'))).toBe(false)
  })

  it('打开面板并扫描出反链（文件名与标题两种写法都命中）', async () => {
    const { api, panels, commands, executed } = fakeApi({ doc: { path: '标签验收-周报.md' } })
    plugin.apply(api as never)

    await commands.get('backlinks.show-for-current')!.run()

    expect(executed.some((e) => e.id === 'core.panel.backlinks.board')).toBe(true)
    expect(api.fs.listNotes).toHaveBeenCalled()
    expect(api.fs.readText).toHaveBeenCalledWith('双链验收.md')

    // 面板视图里出现「双链验收」（来源）
    const node = panels[0].render()
    const links = walk(node).filter((n) => n.type === 'link')
    expect(links.length).toBeGreaterThan(0)
  })

  it('第二次打开走缓存：mtime 没变就不再读盘', async () => {
    const { api, commands, readText } = fakeApi({ doc: { path: '标签验收-周报.md' } })
    plugin.apply(api as never)

    await commands.get('backlinks.show-for-current')!.run()
    const first = readText.mock.calls.length
    await commands.get('backlinks.show-for-current')!.run()

    expect(readText.mock.calls.length).toBe(first) // 第二次没新增读盘
  })

  it('点来源走内核 core.openNote', async () => {
    const { api, commands, executed } = fakeApi()
    plugin.apply(api as never)
    await commands.get('backlinks.open')!.run({ path: '双链验收.md' })
    expect(executed.some((e) => e.id === 'core.openNote')).toBe(true)
  })

  it('重新扫描强制读盘（不吃缓存）', async () => {
    const { api, commands, readText } = fakeApi({ doc: { path: '标签验收-周报.md' } })
    plugin.apply(api as never)

    await commands.get('backlinks.show-for-current')!.run()
    const first = readText.mock.calls.length
    await commands.get('backlinks.rescan')!.run()

    expect(readText.mock.calls.length).toBeGreaterThan(first)
  })

  it('打开笔记 → 状态栏显示「被 N 篇引用」（按篇去重）', async () => {
    const { api, panels, docHandlers } = fakeApi()
    plugin.apply(api as never)

    // 打开「标签验收-周报」：它被「双链验收」引用一次（正文里还有一处 [[本周进展]]，
    // 同一篇 ⇒ 只算 1 篇）
    docHandlers.get('open')!({ path: '标签验收-周报.md', content: '' })
    await new Promise((r) => setTimeout(r, 50))

    const status = panels.find((p) => p.id === 'backlinks.status')!
    const node = status.render() as unknown as { label: string; onClick: string }
    expect(node.label).toBe('被 1 篇引用')
    expect(node.onClick).toBe('backlinks.show-for-current')
    expect(api.fs.readText).toHaveBeenCalledWith('双链验收.md')
  })

  it('没有打开的笔记 → 状态栏是中性文字，点了给提示', async () => {
    const { api, panels } = fakeApi({ doc: null })
    plugin.apply(api as never)
    const status = panels.find((p) => p.id === 'backlinks.status')!
    expect((status.render() as unknown as { label: string }).label).toBe('被引用')
  })

  it('点状态栏按钮 = 走同一条 show-for-current 命令', async () => {
    const { api, panels } = fakeApi()
    plugin.apply(api as never)
    const status = panels.find((p) => p.id === 'backlinks.status')!
    const node = status.render() as unknown as { onClick: string }
    expect(node.onClick).toBe('backlinks.show-for-current')
  })
})

/* ───────────────────────── 6. 全库持久反链索引（rev173.134） ───────────────────────── */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('全库持久反链索引（rev173.134）', () => {
  it('120 天前的老笔记里的引用也命中（不再有 30 天窗口）', async () => {
    const old = Date.now() - 120 * 24 * 60 * 60 * 1000
    const { api, commands, panels } = fakeApi({
      doc: { path: '老笔记.md' },
      notes: [
        { path: '老笔记.md', title: '老笔记', mtime: old, kind: 'note' },
        { path: '很久以前.md', title: '很久以前', mtime: old - 86_400_000, kind: 'note' },
      ],
      texts: { '很久以前.md': '见 [[老笔记]]' },
    })
    plugin.apply(api as never)
    await commands.get('backlinks.show-for-current')!.run()

    const links = walk(panels[0].render()).filter((n) => n.type === 'link')
    expect(links).toHaveLength(1)
  })

  it('`note:saved` 带正文 ⇒ 缓存直接更新，不读盘', async () => {
    const now = Date.now()
    const { api, readText, events, panels } = fakeApi({
      doc: { path: '标签验收-周报.md' },
      notes: [
        { path: '新篇.md', title: '新篇', mtime: now, kind: 'note' },
        { path: '标签验收-周报.md', title: '本周进展', mtime: now, kind: 'note' },
      ],
      texts: { '新篇.md': '还没有引用' },
    })
    plugin.apply(api as never)
    await sleep(30) // 等后台补齐（会把磁盘上的「还没有引用」读进来）
    const before = readText.mock.calls.length

    events.get('note:saved')!({ path: '新篇.md', text: '现在引用 [[标签验收-周报]]' })
    await sleep(20)

    expect(readText.mock.calls.length).toBe(before) // 零读盘
    const status = panels.find((p) => p.id === 'backlinks.status')!
    expect((status.render() as unknown as { label: string }).label).toBe('被 1 篇引用')
  })

  it('事件更新过之后即使 mtime 变新也不重读（`at` 信任窗口）', async () => {
    const base = Date.now() - 60_000
    const { api, readText, events, commands } = fakeApi({
      doc: { path: '标签验收-周报.md' },
      notes: [
        { path: '旧.md', title: '旧', mtime: base, kind: 'note' },
        { path: '标签验收-周报.md', title: '本周进展', mtime: base, kind: 'note' },
      ],
      texts: { '旧.md': '' },
    })
    plugin.apply(api as never)
    await sleep(30)

    // 事件时刻晚于 base ⇒ at >= mtime ⇒ 下次扫描应直接信任缓存
    events.get('note:saved')!({ path: '旧.md', text: '[[标签验收-周报]]' })
    await sleep(10)
    const before = readText.mock.calls.length
    await commands.get('backlinks.show-for-current')!.run()

    expect(readText.mock.calls.length).toBe(before)
  })

  it('`note:deleted` ⇒ 缓存淘汰，计数归零', async () => {
    const { api, events, panels } = fakeApi({ doc: { path: '标签验收-周报.md' } })
    plugin.apply(api as never)
    await sleep(30)

    const status = panels.find((p) => p.id === 'backlinks.status')!
    expect((status.render() as unknown as { label: string }).label).toBe('被 1 篇引用')

    events.get('note:deleted')!({ path: '双链验收.md' })
    await sleep(20)
    expect((status.render() as unknown as { label: string }).label).toBe('被 0 篇引用')
  })
})
