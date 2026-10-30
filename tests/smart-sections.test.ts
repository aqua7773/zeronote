/**
 * 侧栏「智能分区」纯函数（UI 重布局目标态 ① · 方案 §2.1）。
 *
 * 日期边界是这里最容易出错的地方：本地时区、跨月、跨年、`mtime` 精确到毫秒。
 * 所以 `now` 一律由调用方传入，测试里钉死一个时刻，逐条核对边界。
 */
import { describe, expect, it } from 'vitest'
import type { SmartNote } from '../src/lib/smart-sections'
import {
  displayTitle,
  pickByRecency,
  relativeTime,
  sectionEmptyText,
  sectionTitle,
  startOfDay,
  weekStart,
} from '../src/lib/smart-sections'

function note(path: string, mtime: number, kind: SmartNote['kind'] = 'note'): SmartNote {
  return { path, title: path.replace(/\.md$/, ''), mtime, kind }
}

/** 本地时间构造（测试不依赖 UTC —— 本机是 Asia/Shanghai，但边界用本地日期算） */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime()

describe('startOfDay / weekStart', () => {
  it('startOfDay 落在本地 0 点（不是 UTC 0 点）', () => {
    const t = startOfDay(at(2026, 10, 30, 13, 5))
    const d = new Date(t)
    expect(d.getHours()).toBe(0)
    expect(d.getMinutes()).toBe(0)
    expect(d.getSeconds()).toBe(0)
    expect(d.getDate()).toBe(30)
  })

  it('weekStart = 6 天前 0 点（含今天共 7 个自然日）', () => {
    const t = weekStart(at(2026, 10, 30, 9, 0))
    expect(new Date(t).getDate()).toBe(24)
    expect(new Date(t).getHours()).toBe(0)
  })

  it('跨月：10 月 3 日的 7 天起点在 9 月', () => {
    const t = weekStart(at(2026, 10, 3, 12, 0))
    const d = new Date(t)
    expect(d.getMonth()).toBe(8) // 0-based ⇒ 9 月
    expect(d.getDate()).toBe(27)
  })
})

describe('pickByRecency', () => {
  const now = at(2026, 10, 30, 12, 0)
  const today = startOfDay(now)

  it('只留笔记：文档 / 图片 / 音视频不参与时间分区', () => {
    const notes = [
      note('a.md', now),
      note('b.pdf', now, 'doc'),
      note('c.png', now, 'image'),
      note('d.mp4', now, 'media'),
    ]
    expect(pickByRecency(notes, today).map((n) => n.path)).toEqual(['a.md'])
  })

  it('按 mtime 从新到旧排序', () => {
    const notes = [note('old.md', today + 1000), note('new.md', now), note('mid.md', today + 5000)]
    expect(pickByRecency(notes, today).map((n) => n.path)).toEqual(['new.md', 'mid.md', 'old.md'])
  })

  it('边界：正好等于起点的那篇算在内（昨天 23:59 不算今天）', () => {
    const notes = [note('edge.md', today), note('yesterday.md', today - 1)]
    expect(pickByRecency(notes, today).map((n) => n.path)).toEqual(['edge.md'])
    // 「最近 7 天」用的是 6 天前 0 点，昨天的当然在里面
    expect(pickByRecency(notes, weekStart(now)).map((n) => n.path)).toEqual([
      'edge.md',
      'yesterday.md',
    ])
  })

  it('空库 ⇒ 空表（不抛错）', () => {
    expect(pickByRecency([], today)).toEqual([])
  })
})

describe('relativeTime', () => {
  const now = at(2026, 10, 30, 15, 0)

  it('1 分钟内「刚刚」；1 小时内按分钟', () => {
    expect(relativeTime(now - 30_000, now)).toBe('刚刚')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前')
  })

  it('今天超过 1 小时按小时', () => {
    expect(relativeTime(at(2026, 10, 30, 9, 0), now)).toBe('6 小时前')
  })

  it('昨天 / 更早', () => {
    expect(relativeTime(at(2026, 10, 29, 23, 0), now)).toBe('昨天')
    expect(relativeTime(at(2026, 10, 20, 10, 0), now)).toBe('10-20')
    expect(relativeTime(at(2025, 10, 20, 10, 0), now)).toBe('2025-10-20')
  })
})

describe('文案', () => {
  it('标题带分区名与篇数', () => {
    expect(sectionTitle('today', 3)).toBe('今天修改 · 3 篇')
    expect(sectionTitle('untagged', 0)).toBe('未打标签 · 0 篇')
  })

  it('空态按分区给不同原因（今天没动 vs 都打了标签）', () => {
    expect(sectionEmptyText('today')).toContain('今天')
    expect(sectionEmptyText('week')).toContain('7 天')
    expect(sectionEmptyText('untagged')).toContain('标签')
  })
})

describe('displayTitle（列表显示用标题）', () => {
  it('剥掉标题行的 # 前缀', () => {
    expect(displayTitle('# 待办清单')).toBe('待办清单')
    expect(displayTitle('### 三级标题')).toBe('三级标题')
  })

  it('图片行只留 alt（alt 为空 ⇒ 无标题而不是一串符号）', () => {
    expect(displayTitle('![封面](images/a.png)')).toBe('封面')
    expect(displayTitle('![](test-clip-1.mp4)')).toBe('（无标题）')
  })

  it('wiki 链接取目标名 / 别名', () => {
    expect(displayTitle('A-SIDE-1521参见 [[标签验收-周报]]')).toBe('A-SIDE-1521参见 标签验收-周报')
    expect(displayTitle('[[notes/真名|别名]]')).toBe('别名')
  })

  it('普通链接、强调、行内代码都收掉', () => {
    expect(displayTitle('看 [这个](https://e.com) 链接')).toBe('看 这个 链接')
    expect(displayTitle('**粗体** 与 `代码` 与 ~~删除~~')).toBe('粗体 与 代码 与 删除')
  })

  it('纯文本原样（只压空白）', () => {
    expect(displayTitle('  普通标题  ')).toBe('普通标题')
    expect(displayTitle('')).toBe('（无标题）')
  })
})
