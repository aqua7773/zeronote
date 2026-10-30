// @vitest-environment happy-dom
/**
 * 搜索筛选（rev173.47 · 待办 #4）：正则 / 标签 / 目录。
 *
 * 测的是**内核 `index.query` 的字段过滤**（面板只负责把参数传下来）：
 *   · `opts.regex` —— 整串当表达式、忽略大小写；语法错误返回空表而不抛错；
 *   · `opts.tag` —— 空关键词 + 标签 = 列出该标签全部笔记；
 *   · `opts.dir` —— 空关键词 + 目录同样是合法查询（本轮新增）；
 *   · 三者可与关键词组合，且正则摘要要带高亮哨兵。
 *
 * 用真实 `createKernel` + mock 的 Tauri `invoke` —— 与 kernel-fs-events.test.ts 同一套夹具。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Kernel } from '../src/kernel/kernel'
import { HIT_START, HIT_END } from '../src/kernel/index-api'

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
        return 'trash/20261020'
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

beforeEach(() => {
  files = {
    'a.md': '---\ntags: [工作]\n---\n# 待办清单\n- [ ] 写测试',
    '学习/b.md': '# 数学笔记\n公式 E=mc^2',
    'c.md': '# 随笔\n今天天气不错',
    // 目录 / 标签都不匹配的干扰项
    'd.md': '---\ntags: [生活]\n---\n# 日记\n今天下雨',
  }
  notes = [
    { path: 'a.md', title: '待办清单' },
    { path: '学习/b.md', title: '数学笔记' },
    { path: 'c.md', title: '随笔' },
    { path: 'd.md', title: '日记' },
  ]
  mocks.invoke.mockReset()
  mocks.listen.mockClear()
})

const paths = (hits: { path: string }[]) => hits.map((h) => h.path).sort()

describe('index.query：正则', () => {
  it('整串当表达式（^…$ 生效），且忽略大小写', async () => {
    const k = makeKernel()
    await k.index.rebuild()

    // 标题行「# 数学笔记」只有 学习/b.md
    expect(paths(await k.index.query('^# 数学', { regex: true }))).toEqual(['学习/b.md'])
    // 大小写：正文写的是 E=mc^2
    expect(paths(await k.index.query('e=mc\\^2', { regex: true }))).toEqual(['学习/b.md'])
  })

  it('语法错误返回空表，不抛错（UI 那边自己提示）', async () => {
    const k = makeKernel()
    await k.index.rebuild()
    await expect(k.index.query('([', { regex: true })).resolves.toEqual([])
  })

  it('摘要带高亮哨兵（UI 的 splitExcerpt 直接能渲染）', async () => {
    const k = makeKernel()
    await k.index.rebuild()
    const [hit] = await k.index.query('写测试', { regex: true })
    expect(hit.path).toBe('a.md')
    expect(hit.excerpt).toContain(HIT_START + '写测试' + HIT_END)
  })
})

describe('index.query：标签 / 目录（空关键词）', () => {
  it('空关键词 + 标签 ⇒ 列出该标签全部笔记', async () => {
    const k = makeKernel()
    await k.index.rebuild()
    expect(paths(await k.index.query('', { tag: '工作' }))).toEqual(['a.md'])
    expect(paths(await k.index.query('', { tag: '生活' }))).toEqual(['d.md'])
  })

  it('空关键词 + 目录 ⇒ 列出该目录（含子目录）全部笔记', async () => {
    const k = makeKernel()
    await k.index.rebuild()
    expect(paths(await k.index.query('', { dir: '学习' }))).toEqual(['学习/b.md'])
    // 目录 + 关键词：目录是前缀过滤，关键词仍要命中
    expect(paths(await k.index.query('数学', { dir: '学习' }))).toEqual(['学习/b.md'])
    expect(paths(await k.index.query('日记', { dir: '学习' }))).toEqual([])
  })

  it('什么条件都没给 ⇒ 空表（不能把整个库倒出来）', async () => {
    const k = makeKernel()
    await k.index.rebuild()
    expect(await k.index.query('')).toEqual([])
    expect(await k.index.query('', {})).toEqual([])
  })

  it('标签 + 正则 + 目录可以叠在一起', async () => {
    const k = makeKernel()
    await k.index.rebuild()
    // 「工作」标签下只有 a.md，它的标题是「待办清单」
    expect(paths(await k.index.query('^# 待办', { regex: true, tag: '工作' }))).toEqual(['a.md'])
    expect(paths(await k.index.query('^# 待办', { regex: true, tag: '生活' }))).toEqual([])
    // 目录不同 ⇒ 同样命中不了
    expect(paths(await k.index.query('^# 待办', { regex: true, dir: '学习' }))).toEqual([])
  })

  /**
   * 「未打标签」（rev173.264 · 侧栏智能分区）：`tags` 为空的笔记。
   * 标签来源是 frontmatter **加正文 `#标签`** —— 所以这里同时覆盖两种写法的排除。
   */
  it('空关键词 + untagged ⇒ 只列没有标签的笔记', async () => {
    const k = makeKernel()
    await k.index.rebuild()
    expect(paths(await k.index.query('', { untagged: true }))).toEqual(['c.md', '学习/b.md'])
  })

  it('untagged 与 tag 同时给 ⇒ 以 tag 为准（不返回空表）', async () => {
    const k = makeKernel()
    await k.index.rebuild()
    expect(paths(await k.index.query('', { untagged: true, tag: '工作' }))).toEqual(['a.md'])
  })

  it('正文里的 #标签 也算标签（untagged 要排除它）', async () => {
    files['e.md'] = '# 随手记\n#灵感 今天想到一件事'
    notes.push({ path: 'e.md', title: '随手记' })
    const k = makeKernel()
    await k.index.rebuild()
    expect(paths(await k.index.query('', { untagged: true }))).toEqual(['c.md', '学习/b.md'])
  })
})
