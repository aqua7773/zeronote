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
