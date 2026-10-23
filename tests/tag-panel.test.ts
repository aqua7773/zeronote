/**
 * 标签面板（`examples/tag-panel`）—— rev173.93 · ROADMAP 第 2 项。
 *
 * 覆盖四层：
 *   1. 纯函数：排序（篇数降序 / 同数按名）· 筛选（大小写 / 中文 / 空查询）· 摘要清洗
 *   2. 视图：空态文案 · 选中后出笔记列表 · 筛选后只剩命中行
 *   3. 接线：面板注册位置 / 命令与事件都登记了 / `select` 走的是 `query('', { tag })`
 *   4. 边界：空索引时自动 `rebuild()` 一次；点笔记走新增的内核命令 `core.openNote`
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import plugin, {
  cleanExcerpt,
  filterTags,
  panelNode,
  peekNode,
  resolveTagAt,
  sortTags,
  toNoteRows,
} from '../examples/tag-panel/index.js'

/* ───────────────────────── 纯函数 ───────────────────────── */

describe('sortTags：按篇数降序，同数按名字', () => {
  it('篇数多的在前', () => {
    expect(sortTags([{ tag: 'b', count: 1 }, { tag: 'a', count: 3 }])).toEqual([
      { tag: 'a', count: 3 },
      { tag: 'b', count: 1 },
    ])
  })

  it('同篇数按本地化名字序（中文不会乱）', () => {
    const rows = sortTags([
      { tag: '项目', count: 2 },
      { tag: '工作', count: 2 },
      { tag: '会议', count: 2 },
    ])
    expect(rows.map((r) => r.tag)).toEqual(['工作', '会议', '项目'])
  })

  it('丢掉空标签名，非法 count 当 0，不炸非数组输入', () => {
    expect(sortTags([{ tag: '', count: 2 }, { tag: 'x' }, null, { tag: 'y', count: 'bad' }])).toEqual([
      { tag: 'x', count: 0 },
      { tag: 'y', count: 0 },
    ])
    expect(sortTags(undefined)).toEqual([])
  })
})

describe('filterTags：名字子串筛选', () => {
  const tags = [
    { tag: 'Work', count: 3 },
    { tag: '工作', count: 2 },
    { tag: 'work-log', count: 1 },
  ]

  it('空查询原样返回', () => {
    expect(filterTags(tags, '')).toBe(tags)
    expect(filterTags(tags, '   ')).toBe(tags)
  })

  it('大小写不敏感', () => {
    expect(filterTags(tags, 'WORK').map((t) => t.tag)).toEqual(['Work', 'work-log'])
  })

  it('中文子串', () => {
    expect(filterTags(tags, '作').map((t) => t.tag)).toEqual(['工作'])
  })

  it('无匹配 → 空表（不是报错）', () => {
    expect(filterTags(tags, 'zzz')).toEqual([])
  })
})

describe('cleanExcerpt / toNoteRows', () => {
  it('多行与多余空白压成一行', () => {
    expect(cleanExcerpt('第一行\n\n  第二行\t第三行')).toBe('第一行 第二行 第三行')
  })

  it('剥掉开头的 frontmatter（摘要不该从元数据开始）', () => {
    expect(cleanExcerpt('---\ntags: [工作]\n---\n# 本周进展\n- 落地')).toBe('# 本周进展 - 落地')
  })

  it('内核压成一行的 frontmatter 也要剥（SearchHit.excerpt 就是这种）', () => {
    expect(cleanExcerpt('--- tags: [工作, 周报] --- # 本周进展 - 落地')).toBe('# 本周进展 - 落地')
  })

  it('超长按字符截断并补省略号', () => {
    const long = '好'.repeat(200)
    const out = cleanExcerpt(long)
    expect(Array.from(out).length).toBe(121)
    expect(out.endsWith('…')).toBe(true)
  })

  it('标题缺省退回路径；保留 path 供打开用', () => {
    expect(toNoteRows([{ path: 'notes/a.md', title: '', excerpt: 'x' }])).toEqual([
      { path: 'notes/a.md', title: 'notes/a.md', excerpt: 'x' },
    ])
  })
})

/* ───────────────────────── 视图 ───────────────────────── */

type Node = { type: string; children?: Node[]; items?: unknown[]; empty?: string; label?: string }

function walk(node: Node, out: Node[] = []): Node[] {
  out.push(node)
  for (const c of node.children ?? []) walk(c, out)
  for (const it of (node.items ?? []) as unknown[]) {
    const n = it as { node?: Node }
    if (n?.node) walk(n.node, out)
  }
  return out
}

const listNodes = (node: Node) => walk(node).filter((n) => n.type === 'list')
const links = (node: Node) =>
  walk(node)
    .filter((n) => n.type === 'link')
    .map((n) => (n as unknown as { label: string; onClick: string; payload?: Record<string, unknown> }))

describe('panelNode：空态', () => {
  it('没有标签时给引导文案，重建按钮仍在', () => {
    const node = panelNode({ tags: [], filter: '', selected: '', notes: [], status: '' }) as Node
    const all = walk(node)
    expect(all.some((n) => n.type === 'button' && n.label === '重建索引')).toBe(true)
    const lists = listNodes(node)
    expect(lists[0].empty).toContain('#标签')
    expect(all.some((n) => n.type === 'text' && n.value === '标签')).toBe(true)
  })

  it('筛选无匹配时说的是「没匹配」，不是「库里没标签」', () => {
    const node = panelNode({
      tags: [{ tag: '工作', count: 1 }],
      filter: 'zzz',
      selected: '',
      notes: [],
      status: '',
    }) as Node
    expect(listNodes(node)[0].empty).toContain('zzz')
    expect(listNodes(node)[0].empty).not.toContain('#标签，或在笔记开头')
  })
})

describe('panelNode：选中标签后的笔记列表', () => {
  it('标题是可点的 link，payload 带 path', () => {
    const node = panelNode({
      tags: [{ tag: '工作', count: 2 }],
      filter: '',
      selected: '工作',
      notes: [{ path: '工作/周报.md', title: '周报', excerpt: '本周进展' }],
      status: '',
    }) as Node
    const ls = links(node)
    expect(ls.some((l) => l.label === '周报' && l.onClick === 'tag-panel.openNote')).toBe(true)
    expect(ls.find((l) => l.label === '周报')?.payload).toEqual({ path: '工作/周报.md' })
  })

  it('选中标签但列表为空：文案提示去重建索引', () => {
    const node = panelNode({
      tags: [{ tag: '工作', count: 1 }],
      filter: '',
      selected: '工作',
      notes: [],
      status: '',
    }) as Node
    const ls = listNodes(node)
    expect(ls.length).toBe(2)
    expect(ls[1].empty).toContain('重建索引')
  })

  it('筛选只影响标签行，不影响已选中的笔记块', () => {
    const node = panelNode({
      tags: [
        { tag: '工作', count: 2 },
        { tag: '生活', count: 1 },
      ],
      filter: '生',
      selected: '工作',
      notes: [{ path: 'a.md', title: 'A', excerpt: '' }],
      status: '',
    }) as Node
    const tagLinks = links(node).filter((l) => l.onClick === 'tag-panel.select')
    expect(tagLinks.map((l) => l.label)).toEqual(['生活'])
    expect(links(node).some((l) => l.onClick === 'tag-panel.openNote')).toBe(true)
  })
})

/* ───────────────────────── 接线（假 api） ───────────────────────── */

type PanelSpec = {
  id: string
  title: string
  location: string
  render: (ctx: { pluginId: string; state: Record<string, unknown> }) => Node
}

function fakeApi(
  tags: { tag: string; count: number }[] = [{ tag: '工作', count: 2 }],
  opts: { doc?: { path: string; content: string } | null; platform?: string } = {},
) {
  const commands = new Map<string, { id: string; run: (p?: unknown) => unknown }>()
  const panels: PanelSpec[] = []
  const events = new Map<string, (p: unknown) => void>()
  const executed: { id: string; payload: unknown }[] = []
  const marks: { id: string; pattern: string; onClick?: string; className?: string }[] = []

  const api = {
    subscriptions: [] as { dispose: () => void }[],
    index: {
      tags: vi.fn(async () => tags),
      query: vi.fn(async () => [
        { path: 'notes/周报.md', title: '周报', excerpt: '本周进展', score: 0 },
      ]),
      rebuild: vi.fn(async () => ({ count: 3, ms: 1 })),
    },
    view: {
      registerPanel: vi.fn((spec: PanelSpec) => {
        panels.push(spec)
        return { dispose: vi.fn() }
      }),
      refresh: vi.fn(),
      setState: vi.fn(),
    },
    event: {
      on: vi.fn((topic: string, cb: (p: unknown) => void) => {
        events.set(topic, cb)
        return { dispose: vi.fn() }
      }),
    },
    command: {
      register: vi.fn((spec: { id: string; run: (p?: unknown) => unknown }) => {
        commands.set(spec.id, spec)
        return { dispose: vi.fn() }
      }),
      execute: vi.fn(async (id: string, payload?: unknown) => {
        executed.push({ id, payload })
      }),
      list: () => [],
    },
    host: { notify: vi.fn(), platform: opts.platform ?? 'windows' },
    doc: { active: vi.fn(() => opts.doc ?? null) },
    editor: {
      addMark: vi.fn((spec: { id: string; pattern: string; onClick?: string; className?: string }) => {
        marks.push(spec)
        return { dispose: vi.fn() }
      }),
    },
  }
  return { api, commands, panels, events, executed, marks }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('apply：注册与命令接线', () => {
  it('面板：主区浏览 + 浮层两个；7 条命令与 5 个事件都登记了', () => {
    const { api, commands, panels, events, marks } = fakeApi()
    plugin.apply(api as never)

    expect(panels.map((p) => p.id)).toEqual(['tag-panel.board', 'tag-panel.peek'])
    expect(panels[0].location).toBe('main')
    expect(panels[1].location).toBe('modal')
    expect(typeof panels[0].render).toBe('function')

    for (const id of [
      'tag-panel.open',
      'tag-panel.select',
      'tag-panel.clear',
      'tag-panel.rebuild',
      'tag-panel.openNote',
      'tag-panel.show-for-tag',
      'tag-panel.openInWindow',
    ]) {
      expect(commands.has(id)).toBe(true)
    }
    for (const topic of [
      'note:saved',
      'note:changed',
      'note:deleted',
      'note:renamed',
      'index:rebuilt',
    ]) {
      expect(events.has(topic)).toBe(true)
    }

    // 正文 `#标签` 的 mark 注册（点它开浮层）
    expect(marks).toHaveLength(1)
    expect(marks[0].onClick).toBe('tag-panel.show-for-tag')
    expect(marks[0].className).toBe('tag')
  })

  it('select 用 query("", { tag }) 拉该标签下的笔记', async () => {
    const { api, commands } = fakeApi()
    plugin.apply(api as never)

    await commands.get('tag-panel.select')!.run({ tag: ' 工作 ' })

    expect(api.index.query).toHaveBeenCalledWith('', { tag: '工作' })
    expect(api.view.refresh).toHaveBeenCalledWith('tag-panel.board')
  })

  it('过滤栏的值来自面板 state（input 的 bind）', async () => {
    const { api, panels, commands } = fakeApi()
    plugin.apply(api as never)
    await commands.get('tag-panel.select')!.run({ tag: '工作' })

    const node = panels[0].render({
      pluginId: 'tag-panel',
      state: { 'tag-panel.filter': '生活' },
    })
    // 标签行被筛掉（只有「工作」，筛「生活」⇒ 空），但选中块里的笔记仍在
    const ls = listNodes(node)
    expect((ls[0].items ?? []).length).toBe(0)
    expect(links(node).some((l) => l.onClick === 'tag-panel.openNote')).toBe(true)
  })

  it('空索引：首次打开自动 rebuild 一次', async () => {
    vi.useFakeTimers()
    const { api, panels } = fakeApi([])
    plugin.apply(api as never)

    // 第一次 tags() 为空 → rebuild → 第二次仍返回空（空库）
    panels[0].render({ pluginId: 'tag-panel', state: {} })
    await vi.advanceTimersByTimeAsync(10)

    expect(api.index.rebuild).toHaveBeenCalledTimes(1)

    // 再渲染一次不该重复 rebuild（插件生命周期内只做一次）
    panels[0].render({ pluginId: 'tag-panel', state: {} })
    await vi.advanceTimersByTimeAsync(10)
    expect(api.index.rebuild).toHaveBeenCalledTimes(1)
  })

  it('点笔记走内核命令 core.openNote（带 path）', async () => {
    const { api, commands, executed } = fakeApi()
    plugin.apply(api as never)

    await commands.get('tag-panel.openNote')!.run({ path: 'notes/周报.md' })

    expect(executed).toEqual([{ id: 'core.openNote', payload: { path: 'notes/周报.md' } }])
  })

  it('打开笔记失败时明确提示（不静默）', async () => {
    const { api, commands } = fakeApi()
    api.command.execute.mockRejectedValueOnce(new Error('no such command'))
    plugin.apply(api as never)

    await commands.get('tag-panel.openNote')!.run({ path: 'a.md' })

    expect(api.host.notify).toHaveBeenCalled()
    expect(String(api.host.notify.mock.calls[0][0])).toContain('core.openNote')
  })

  it('取消筛选：清掉选中块', async () => {
    const { api, panels, commands } = fakeApi()
    plugin.apply(api as never)
    await commands.get('tag-panel.select')!.run({ tag: '工作' })
    await commands.get('tag-panel.clear')!.run()

    const node = panels[0].render({ pluginId: 'tag-panel', state: {} })
    expect(listNodes(node)).toHaveLength(1)
    expect(links(node).some((l) => l.onClick === 'tag-panel.openNote')).toBe(false)
  })
})

/* ───────────────────────── rev173.96：点正文标签 → 浮层 → 独立窗口 ───────────────────────── */

describe('resolveTagAt：从光标偏移认出 #标签', () => {
  const text = '开头 #工作 中间 #生活。结尾'

  it('点在 # 上、标签中间、标签末尾都认', () => {
    const at = text.indexOf('#工作')
    expect(resolveTagAt(text, at)).toBe('工作')
    expect(resolveTagAt(text, at + 1)).toBe('工作')
    expect(resolveTagAt(text, at + 3)).toBe('工作')
  })

  it('前面是标点（不是空白/行首）就不认 —— 与内核 tagsOf 口径一致', () => {
    const t = '一本书。#生活 后'
    expect(resolveTagAt(t, t.indexOf('#生活'))).toBe('')
  })

  it('落在普通文字 / 越界 / 空正文都安全返回空', () => {
    expect(resolveTagAt(text, 0)).toBe('')
    expect(resolveTagAt(text, 999)).toBe('')
    expect(resolveTagAt('', 0)).toBe('')
  })
})

describe('peekNode：点标签弹出的浮层', () => {
  it('标题是 #标签，点一篇走 openInWindow（独立窗口）', () => {
    const node = peekNode({
      tag: '工作',
      notes: [{ path: 'notes/a.md', title: 'A', excerpt: '' }],
    }) as Node
    const all = walk(node)
    expect(all.some((n) => n.type === 'text' && n.value === '#工作')).toBe(true)
    const link = links(node).find((l) => l.onClick === 'tag-panel.openInWindow')
    expect(link?.payload).toEqual({ path: 'notes/a.md' })
  })

  it('空列表给「还没有笔记用这个标签」', () => {
    const node = peekNode({ tag: '生活', notes: [] }) as Node
    const empty = walk(node).find((n) => n.type === 'list')?.empty
    expect(empty).toContain('还没有')
  })
})

describe('show-for-tag / openInWindow 接线', () => {
  it('点标签 → 打开浮层（core.panel.tag-panel.peek）并查该标签', async () => {
    const { api, commands, executed } = fakeApi()
    plugin.apply(api as never)

    await commands.get('tag-panel.show-for-tag')!.run({ text: '#工作' })

    expect(executed.some((e) => e.id === 'core.panel.tag-panel.peek')).toBe(true)
    expect(api.index.query).toHaveBeenCalledWith('', { tag: '工作' })
  })

  it('text 缺失时用 from + 正文兜底解析', async () => {
    const content = '前文 #生活 后文'
    const { api, commands } = fakeApi(undefined, { doc: { path: 'a.md', content } })
    plugin.apply(api as never)

    await commands.get('tag-panel.show-for-tag')!.run({ from: content.indexOf('#生活') + 1 })

    expect(api.index.query).toHaveBeenCalledWith('', { tag: '生活' })
  })

  it('桌面：在独立窗口打开，并收掉浮层', async () => {
    const { api, commands, executed } = fakeApi()
    plugin.apply(api as never)

    await commands.get('tag-panel.openInWindow')!.run({ path: 'notes/a.md' })

    expect(executed).toContainEqual({ id: 'core.openInNewWindow', payload: { path: 'notes/a.md' } })
    expect(executed.some((e) => e.id === 'core.closePanel')).toBe(true)
  })

  it('手机：降级为主区打开，并明确提示（不静默）', async () => {
    const { api, commands, executed } = fakeApi(undefined, { platform: 'android' })
    plugin.apply(api as never)

    await commands.get('tag-panel.openInWindow')!.run({ path: 'a.md' })

    expect(executed).toContainEqual({ id: 'core.openNote', payload: { path: 'a.md' } })
    expect(api.host.notify).toHaveBeenCalled()
  })
})
