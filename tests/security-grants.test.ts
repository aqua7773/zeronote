/**
 * 安全插件 · 插件授权表（期 3 · 环分配）的单测 —— rev173.413
 *
 * 只测 `examples/security/index.js` 里导出的纯函数；面板点击 / 落盘走桌面 CDP 实测。
 * 关键语义：**默认拒绝**（2026-11-07 用户拍板，不写内置白名单）。
 */
import { describe, expect, it } from 'vitest'

import {
  allRingIds,
  authError,
  emptyGrants,
  granted,
  grantsRows,
  newRingId,
  parseGrants,
  recordRequest,
  slugifyRingName,
  withGrant,
} from '../examples/security/index.js'

describe('security · 授权表', () => {
  it('空表默认拒绝一切', () => {
    const g = emptyGrants()
    expect(granted(g, 'secrets', 'secrets')).toBe(false)
    expect(granted(g, 'private-notes', 'notes')).toBe(false)
  })

  it('坏 JSON / 怪形状 ⇒ 空表（不崩、不误授权）', () => {
    expect(parseGrants('{not json')).toEqual(emptyGrants())
    expect(parseGrants('null')).toEqual(emptyGrants())
    expect(parseGrants('"str"')).toEqual(emptyGrants())
    expect(parseGrants('{"grants":{"x":"secrets"}}')).toEqual(emptyGrants())
  })

  it('只认合法环 id（内置名与用户环的 [a-z0-9-] 都行），并去重', () => {
    const g = parseGrants(
      JSON.stringify({ grants: { p: ['notes', 'notes', 'my-ring'], q: ['secrets', 'Bad ID!'] } }),
    )
    expect(g.grants).toEqual({ p: ['notes', 'my-ring'], q: ['secrets'] })
  })

  it('授权后可读，撤销后立即拒绝', () => {
    const allowed = withGrant(emptyGrants(), 'secrets', 'secrets', true)
    expect(granted(allowed, 'secrets', 'secrets')).toBe(true)
    const revoked = withGrant(allowed, 'secrets', 'secrets', false)
    expect(granted(revoked, 'secrets', 'secrets')).toBe(false)
    // 撤销后不留空数组键
    expect(revoked.grants).toEqual({})
  })

  it('两个环互不串：授权 notes 不等于能进 secrets', () => {
    const g = withGrant(emptyGrants(), 'private-notes', 'notes', true)
    expect(granted(g, 'private-notes', 'notes')).toBe(true)
    expect(granted(g, 'private-notes', 'secrets')).toBe(false)
  })

  it('同一插件的两个环各自独立', () => {
    const g = withGrant(emptyGrants(), 'p', 'notes', true)
    const g2 = withGrant(g, 'p', 'secrets', true)
    expect(g2.grants.p.sort()).toEqual(['notes', 'secrets'])
  })

  it('recordRequest 幂等：同一 (插件, 环) 只登记一次', () => {
    const a = recordRequest(emptyGrants(), 'p', 'secrets')
    const b = recordRequest(a, 'p', 'secrets')
    expect(b.requested).toEqual({ p: ['secrets'] })
  })

  it('授权后该环从请求列表移除（不再提示「在申请」）', () => {
    const pending = recordRequest(emptyGrants(), 'p', 'notes')
    expect(grantsRows(pending)[0].pending).toBe(true)
    const ok = withGrant(pending, 'p', 'notes', true)
    expect(ok.requested).toEqual({})
    expect(grantsRows(ok)[0].pending).toBe(false)
  })

  it('grantsRows 合并「已授权」与「在申请」两类来源并按 id 排序', () => {
    let g = withGrant(emptyGrants(), 'secrets', 'secrets', true)
    g = recordRequest(g, 'private-notes', 'notes')
    const rows = grantsRows(g)
    expect(rows.map((r) => r.pluginId)).toEqual(['private-notes', 'secrets'])
    expect(rows[0]).toMatchObject({ pending: true, rings: { notes: false, secrets: false } })
    expect(rows[1]).toMatchObject({ pending: false, rings: { notes: false, secrets: true } })
  })

  it('未授权报错文案给出可操作指引（消费者原样显示）', () => {
    const msg = authError('evil-plugin', 'secrets')
    expect(msg).toContain('evil-plugin')
    expect(msg).toContain('账号密码')
    expect(msg).toContain('插件授权')
  })
})

describe('security · 动态密钥环（期 3 追加）', () => {
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

  it('grantsRows 按传入的环列表生成；请求了还不存在的环进 missing', () => {
    let g = recordRequest(emptyGrants(), 'p', 'todo')
    g = withGrant(g, 'p', 'notes', true)
    const rows = grantsRows(g, ['notes', 'secrets'])
    expect(rows[0].rings).toEqual({ notes: true, secrets: false })
    expect(rows[0].missing).toEqual(['todo'])
    expect(rows[0].pending).toBe(true)
  })
})
