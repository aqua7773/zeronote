/**
 * 安全插件 · 密钥环分配表（rev173.416 · 方向反转）的单测
 *
 * **旧模型（v1，rev173.413–414）**：插件申请具体某个环，面板按插件勾选 —— 已废。
 * **新模型（v2，2026-11-07 用户拍板）**：插件只声明「我需要一个密钥环」，
 * 具体给哪个环由用户在面板下拉里分配；**双向 1:1**（一环一插件、一插件一环）。
 *
 * 只测 `examples/security/index.js` 里导出的纯函数；面板点击 / 落盘走 CDP 实测。
 */
import { describe, expect, it } from 'vitest'

import {
  allRingIds,
  assignConflict,
  assignRows,
  dropRingGrants,
  emptyGrants,
  newRingId,
  noRingError,
  parseGrants,
  pluginRing,
  ringOwner,
  slugifyRingName,
  withAssign,
  withDemand,
} from '../examples/security/index.js'

describe('security · 密钥环分配表（v2）', () => {
  it('空表：谁都没分配到环', () => {
    const g = emptyGrants()
    expect(ringOwner(g, 'secrets')).toBe(null)
    expect(pluginRing(g, 'secrets')).toBe(null)
  })

  it('坏 JSON / 非 v2 ⇒ 空表（v1 旧表按拍板不迁移）', () => {
    expect(parseGrants('{not json')).toEqual(emptyGrants())
    expect(parseGrants('null')).toEqual(emptyGrants())
    expect(parseGrants(JSON.stringify({ v: 1, grants: { secrets: ['secrets'] } }))).toEqual(emptyGrants())
  })

  it('读 v2：只认合法环 id；同一插件只留一个环；demand 只认 true', () => {
    const g = parseGrants(
      JSON.stringify({
        v: 2,
        rings: { secrets: 'secrets', notes: 'secrets', 'Bad ID!': 'x', todo: 'todo' },
        demand: { secrets: true, ghost: false },
      }),
    )
    // notes 也分给 secrets ⇒ 被丢掉（双向 1:1）
    expect(g.rings).toEqual({ secrets: 'secrets', todo: 'todo' })
    expect(g.demand).toEqual({ secrets: true })
  })

  it('分配后可双向查；解除后回到未分配', () => {
    const g = withAssign(emptyGrants(), 'secrets', 'secrets')
    expect(ringOwner(g, 'secrets')).toBe('secrets')
    expect(pluginRing(g, 'secrets')).toBe('secrets')
    const off = withAssign(g, 'secrets', '')
    expect(ringOwner(off, 'secrets')).toBe(null)
    expect(pluginRing(off, 'secrets')).toBe(null)
  })

  it('双向 1:1：插件换环时让出旧环；环换主人时顶掉旧插件（withAssign 的不变量）', () => {
    let g = withAssign(emptyGrants(), 'secrets', 'p')
    g = withAssign(g, 'notes', 'p')
    expect(pluginRing(g, 'p')).toBe('notes')
    expect(ringOwner(g, 'secrets')).toBe(null)

    g = withAssign(g, 'notes', 'q')
    expect(ringOwner(g, 'notes')).toBe('q')
    expect(pluginRing(g, 'p')).toBe(null)
  })

  it('分配冲突：插件已有环 / 环已有主人 ⇒ 给理由（命令层据此拒绝、不落盘）', () => {
    let g = withAssign(emptyGrants(), 'notes', 'private-notes')
    g = withAssign(g, 'secrets', 'secrets')

    // 1) 插件已有环：新环分不下去（用户 2026-11-07 要求的行为）
    expect(assignConflict(g, 'todo', 'private-notes')).toContain('已经有密钥环')
    // 2) 环已有主人：换不了人
    expect(assignConflict(g, 'notes', 'secrets')).toContain('已经分配给')
    // 3) 同插件同环 / 解除分配 / 全新插件 ⇒ 无冲突
    expect(assignConflict(g, 'notes', 'private-notes')).toBe(null)
    expect(assignConflict(g, 'notes', '')).toBe(null)
    expect(assignConflict(g, 'todo', 'newbie')).toBe(null)
  })

  it('withDemand 幂等且不带环 id', () => {
    const a = withDemand(emptyGrants(), 'p')
    const b = withDemand(a, 'p')
    expect(b).toBe(a)
    expect(b.demand).toEqual({ p: true })
    expect(b.rings).toEqual({})
  })

  it('assignRows：每个环一行；options = 声明需求的 ∪ 当前主人', () => {
    let g = withDemand(emptyGrants(), 'waiting')
    g = withAssign(g, 'notes', 'private-notes')
    const rows = assignRows(g, ['notes', 'secrets'])
    expect(rows.map((r) => r.ringId)).toEqual(['notes', 'secrets'])
    expect(rows[0].owner).toBe('private-notes')
    expect(rows[0].options).toEqual(['private-notes', 'waiting'])
    expect(rows[1].owner).toBe(null)
    // 每个下拉都列出「所有声明过需求的插件」—— 用户在任一个环里都能把它们分进去
    expect(rows[1].options).toEqual(['private-notes', 'waiting'])
  })

  it('assignRows：并入「已安装插件」（rev173.420）—— 旧版消费者不调 demand 也能选', () => {
    // 空表 + 没有任何 demand：正是手机 release 上「列表一个插件都没有」的形状
    const rows = assignRows(emptyGrants(), ['notes', 'secrets'], [
      { id: 'secrets', name: '密码库' },
      { id: 'private-notes', name: '私密笔记' },
      { id: 'security', name: '安全' },
    ])
    expect(rows[0].options).toEqual(['private-notes', 'secrets', 'security'])
    expect(rows[1].options).toEqual(['private-notes', 'secrets', 'security'])
    // 老宿主没有清单 ⇒ 传空数组 = 退回旧行为（不会凭空造选项）
    expect(assignRows(emptyGrants(), ['notes'], [])[0].options).toEqual([])
    // 兼容字符串形态（宿主实现可能只回 id）
    expect(assignRows(emptyGrants(), ['notes'], ['a', 'b'])[0].options).toEqual(['a', 'b'])
  })

  it('dropRingGrants：删环时清掉该环的分配，但保留 demand（rev173.420）', () => {
    let g = withDemand(emptyGrants(), 'private-notes')
    g = withAssign(g, 'notes', 'private-notes')
    const next = dropRingGrants(g, 'notes')
    expect(next.rings).toEqual({})
    expect(next.demand).toEqual({ 'private-notes': true })
    // 删不存在的环是幂等的
    expect(dropRingGrants(next, 'notes')).toEqual(next)
  })

  it('没分配时的报错文案指向「密钥环分配」（消费者原样显示）', () => {
    const msg = noRingError('evil-plugin')
    expect(msg).toContain('evil-plugin')
    expect(msg).toContain('密钥环分配')
  })
})

describe('security · 动态密钥环', () => {
  it('slugify：英文转小写连字符，纯中文归空（由 newRingId 兜底 ring）', () => {
    expect(slugifyRingName('Todo')).toBe('todo')
    expect(slugifyRingName('My Notes!')).toBe('my-notes')
    expect(slugifyRingName('工作')).toBe('')
  })

  it('newRingId：合法且去重递增', () => {
    expect(newRingId('Todo', [])).toBe('todo')
    expect(newRingId('Todo', ['todo'])).toBe('todo-2')
    expect(newRingId('工作', [])).toBe('ring')
    expect(newRingId('工作', ['ring', 'ring-2'])).toBe('ring-3')
  })

  it('allRingIds：内置两个在前，自定义环按 id 排序', () => {
    const vault = { rings: { secrets: {}, notes: {}, zeta: {}, alpha: {} } }
    expect(allRingIds(vault)).toEqual(['notes', 'secrets', 'alpha', 'zeta'])
  })
})
