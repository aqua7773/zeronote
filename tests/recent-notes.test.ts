// @vitest-environment happy-dom
/**
 * 「最近打开的笔记」持久化（UI 重布局 B1 · ☰ 菜单的「最近打开」）。
 *
 * 覆盖：记录 / 同路径去重 / 封顶 / 按库隔离 / 坏数据不炸。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  LS_RECENT_NOTES,
  RECENT_NOTES_MAX,
  loadRecentNotes,
  pickRecentNotes,
  recentNotesOf,
  rememberRecentNote,
} from '../src/lib/recent-notes'

beforeEach(() => {
  localStorage.clear()
})

describe('recent-notes', () => {
  it('记录后能读回；同一路径只留最新一条（时间更新）', () => {
    rememberRecentNote('/v', 'a.md', 1000)
    rememberRecentNote('/v', 'b.md', 2000)
    rememberRecentNote('/v', 'a.md', 3000)
    const list = loadRecentNotes()
    expect(list.map((n) => n.path)).toEqual(['a.md', 'b.md'])
    expect(list[0].at).toBe(3000)
  })

  it('封顶 RECENT_NOTES_MAX 条，最旧的被挤掉', () => {
    for (let i = 0; i < RECENT_NOTES_MAX + 3; i++) rememberRecentNote('/v', `n${i}.md`, 1000 + i)
    const list = loadRecentNotes()
    expect(list.length).toBe(RECENT_NOTES_MAX)
    expect(list[0].path).toBe(`n${RECENT_NOTES_MAX + 2}.md`)
    expect(list.some((n) => n.path === 'n0.md')).toBe(false)
  })

  it('按库隔离：菜单里只列当前库的记录', () => {
    rememberRecentNote('/v1', 'a.md', 1000)
    rememberRecentNote('/v2', 'b.md', 2000)
    expect(recentNotesOf('/v1').map((n) => n.path)).toEqual(['a.md'])
    expect(recentNotesOf('/v2').map((n) => n.path)).toEqual(['b.md'])
    // 没有库 ⇒ 空表（不炸、不串库）
    expect(recentNotesOf(null)).toEqual([])
  })

  it('坏数据（非数组 / 缺字段）当空表处理，不抛错', () => {
    localStorage.setItem(LS_RECENT_NOTES, '{"nope":1}')
    expect(loadRecentNotes()).toEqual([])
    localStorage.setItem(LS_RECENT_NOTES, '[{"path":"x.md"},{"vault":"/v","path":"y.md","at":1}]')
    expect(loadRecentNotes().map((n) => n.path)).toEqual(['y.md'])
  })

  it('只取前 limit 条（菜单最多列 6 条）', () => {
    for (let i = 0; i < 8; i++) rememberRecentNote('/v', `n${i}.md`, 1000 + i)
    expect(recentNotesOf('/v', 3).length).toBe(3)
  })
})

/**
 * 空态「最近 3 篇」（B4 · 方案 §6 / O10）——
 * 排序 = 最近打开优先，不足时按修改时间补齐；已删除 / 非笔记一律不出现在里面。
 */
describe('pickRecentNotes（空态最近 3 篇）', () => {
  const notes = [
    { path: 'a.md', title: 'A', kind: 'note', mtime: 100 },
    { path: 'b.md', title: 'B', kind: 'note', mtime: 300 },
    { path: 'c.md', title: 'C', kind: 'note', mtime: 200 },
    { path: 'd.pdf', title: 'D', kind: 'doc', mtime: 900 },
  ]

  it('按「最近打开」排序（不是按 mtime）', () => {
    rememberRecentNote('/v', 'c.md', 2000)
    rememberRecentNote('/v', 'a.md', 3000)
    const out = pickRecentNotes(notes, '/v', 3)
    expect(out.map((n) => n.path)).toEqual(['a.md', 'c.md', 'b.md'])
  })

  it('打开记录里已不存在的笔记不出现（避免死条目）', () => {
    rememberRecentNote('/v', 'gone.md', 5000)
    rememberRecentNote('/v', 'b.md', 4000)
    const out = pickRecentNotes(notes, '/v', 3)
    expect(out[0].path).toBe('b.md') // 真打开过的排最前
    expect(out.some((n) => n.path === 'gone.md')).toBe(false)
  })

  it('没打开过任何笔记 ⇒ 用修改时间倒序补齐', () => {
    const out = pickRecentNotes(notes, '/v', 3)
    expect(out.map((n) => n.path)).toEqual(['b.md', 'c.md', 'a.md'])
  })

  it('文档 / 图片不进「最近 3 篇」（只列笔记）', () => {
    const out = pickRecentNotes(notes, '/v', 3)
    expect(out.some((n) => n.path === 'd.pdf')).toBe(false)
  })

  it('跨库记录不算当前库', () => {
    rememberRecentNote('/other', 'a.md', 9000)
    const out = pickRecentNotes(notes, '/v', 3)
    expect(out.map((n) => n.path)).toEqual(['b.md', 'c.md', 'a.md'])
  })

  it('没有库 / 没有笔记 ⇒ 空表', () => {
    expect(pickRecentNotes(notes, null, 3)).toEqual([])
    expect(pickRecentNotes([], '/v', 3)).toEqual([])
  })
})
