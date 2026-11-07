/**
 * 安全插件 · 插件授权表（期 3 · 环分配）的单测 —— rev173.413
 *
 * 只测 `examples/security/index.js` 里导出的纯函数；面板点击 / 落盘走桌面 CDP 实测。
 * 关键语义：**默认拒绝**（2026-11-07 用户拍板，不写内置白名单）。
 */
import { describe, expect, it } from 'vitest'

import {
  authError,
  emptyGrants,
  granted,
  grantsRows,
  parseGrants,
  recordRequest,
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

  it('只认已知环名，并去重', () => {
    const g = parseGrants(
      JSON.stringify({ grants: { p: ['notes', 'notes', 'bogus'], q: ['secrets'] } }),
    )
    expect(g.grants).toEqual({ p: ['notes'], q: ['secrets'] })
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
