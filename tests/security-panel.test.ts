/**
 * 安全插件 · 面板结构（rev173.424 用户示意图）
 *
 * 用户 2026-11-08 给的三张图：列表页每环一行「🔒 环名 | 已绑定 X / 未分配 | 修改 · 解锁 · 删除」，
 * 顶部「安全 · 自检 · 指纹」+ 右上「新建密钥环」；「测试」和 ✓ 不再占行。
 *
 * 只断言**结构**（按钮 / 文本），点击与落盘走 G2 真机 / 桌面实测。
 */
import { describe, expect, it } from 'vitest'

import { emptyGrants, panelNode, withAssign, withDemand } from '../examples/security/index.js'

type AnyNode = { type?: string; [k: string]: unknown }

/** 把 UINode 树拉平成 { kind, label|value, onClick } 列表 */
function flatten(node: unknown, out: AnyNode[] = []): AnyNode[] {
  if (!node) return out
  if (Array.isArray(node)) {
    for (const n of node) flatten(n, out)
    return out
  }
  const n = node as AnyNode
  if (n.type === 'text') out.push({ kind: 'text', value: n.value })
  if (n.type === 'button') out.push({ kind: 'button', label: n.label, onClick: n.onClick })
  if (n.type === 'link') out.push({ kind: 'link', label: n.label, onClick: n.onClick })
  if (n.type === 'select') out.push({ kind: 'select', bind: n.bind })
  if (Array.isArray(n.children)) flatten(n.children, out)
  return out
}

function ringVault(ids: string[], labels: Record<string, string> = {}) {
  return {
    v: 1,
    rings: Object.fromEntries(ids.map((id) => [id, { id, label: labels[id] ?? id }])),
  }
}

const render = (view: Record<string, unknown>) => flatten(panelNode(view))

describe('security · 面板结构（rev173.424）', () => {
  it('每环一行：修改 / 解锁 / 删除，不再有「测试」和 ✓', () => {
    const v = ringVault(['notes', 'secrets'], { notes: '私密笔记', secrets: '账号密码' })
    const nodes = render({ vault: v, unlocked: {}, grants: emptyGrants(), plugins: [] })
    const buttons = nodes.filter((n) => n.kind === 'button').map((n) => String(n.label))

    expect(buttons.filter((l) => l === '修改')).toHaveLength(2)
    expect(buttons.filter((l) => l === '解锁')).toHaveLength(2)
    expect(buttons.filter((l) => l === '删除')).toHaveLength(2)
    expect(buttons).not.toContain('测试')
    // ✓ 是状态标记、不是按钮 —— 整页文本里也不该再出现
    const texts = nodes.filter((n) => n.kind === 'text').map((n) => String(n.value))
    expect(texts).not.toContain('✓')
  })

  it('行内状态是可点的链接：未分配 / 已绑定<插件>（分配菜单入口）', () => {
    const v = ringVault(['notes', 'secrets'], { notes: '私密笔记', secrets: '账号密码' })
    const unassigned = render({ vault: v, unlocked: {}, grants: emptyGrants(), plugins: [] })
    const links = unassigned.filter((n) => n.kind === 'link')
    expect(links.map((n) => String(n.label))).toContain('未分配')
    expect(links.every((n) => n.onClick === 'security.assign-menu')).toBe(true)

    const g = withAssign(emptyGrants(), 'notes', 'private-notes')
    const assigned = render({ vault: v, unlocked: {}, grants: g, plugins: [] })
    expect(assigned.filter((n) => n.kind === 'link').map((n) => String(n.label))).toContain('已绑定private-notes')
  })

  it('点开分配菜单：只列「申请了密钥环」的插件（含已绑定 / 未绑定状态），不再有原生 select', () => {
    const v = ringVault(['notes'])
    const g = withDemand(withAssign(emptyGrants(), 'notes', 'private-notes'), 'secrets')
    const nodes = render({
      vault: v,
      unlocked: {},
      grants: g,
      // 已装 ≠ 已申请：sync 装在这台机器上，但没调过 crypto.demand()
      plugins: ['private-notes', 'secrets', 'sync'],
      assignMenuFor: 'notes',
    })
    const labels = nodes.filter((n) => n.kind === 'button').map((n) => String(n.label))
    expect(labels.some((l) => l.startsWith('未分配'))).toBe(true)
    expect(labels).toContain('private-notes · 已绑定')
    expect(labels).toContain('secrets · 未绑定')
    expect(labels.some((l) => l.startsWith('sync'))).toBe(false)
    // 下拉框已按用户要求换成分组菜单
    expect(nodes.filter((n) => n.kind === 'select')).toHaveLength(0)
  })

  it('顶部：安全 / 自检 / 指纹 + 新建密钥环；指纹按设备绑定状态换文案', () => {
    const v = ringVault(['notes'])
    const bare = render({ vault: v, unlocked: {}, grants: emptyGrants(), plugins: [] })
    const labels = bare.filter((n) => n.kind === 'button').map((n) => String(n.label))
    expect(labels).toContain('自检')
    expect(labels).toContain('指纹')
    expect(labels).toContain('新建密钥环')
    // 新建入口在顶部，底部旧入口已删 ⇒ 整页只出现一次
    expect(labels.filter((l) => l === '新建密钥环')).toHaveLength(1)

    const bound = render({ vault: v, unlocked: {}, grants: emptyGrants(), plugins: [], deviceBound: true })
    expect(bound.filter((n) => n.kind === 'button').map((n) => String(n.label))).toContain('指纹（已绑定）')
  })

  it('未建立的环：行内是「建立」而不是三按钮；点环名仍走 open-ring', () => {
    const nodes = render({ vault: { v: 1, rings: {} }, unlocked: {}, grants: emptyGrants(), plugins: [] })
    const buttons = nodes.filter((n) => n.kind === 'button')
    expect(buttons.filter((n) => n.label === '建立')).toHaveLength(2) // notes + secrets
    const openRing = buttons.filter((n) => n.onClick === 'security.open-ring')
    expect(openRing.length).toBeGreaterThanOrEqual(2)
    // 解锁按钮用的是新命令（rev173.424：与密码库同一套流程）
    const v2 = ringVault(['notes'])
    const withRing = render({ vault: v2, unlocked: {}, grants: emptyGrants(), plugins: [] })
    expect(withRing.filter((n) => n.kind === 'button' && n.onClick === 'security.unlock-ring')).toHaveLength(1)
  })

  it('解锁按钮在已解锁时禁用（避免重复派生）；「修改」始终可点', () => {
    const v = ringVault(['notes'])
    const nodes = flatten(panelNode({ vault: v, unlocked: { notes: true }, grants: emptyGrants(), plugins: [] }))
    // flatten 不保留 disabled，这里直接查原始树
    const tree = panelNode({ vault: v, unlocked: { notes: true }, grants: emptyGrants(), plugins: [] }) as AnyNode
    const walk = (n: AnyNode): AnyNode[] => [n, ...(Array.isArray(n.children) ? (n.children as AnyNode[]).flatMap(walk) : [])]
    const all = walk(tree)
    const unlock = all.find((n) => n.type === 'button' && n.label === '解锁')
    const modify = all.find((n) => n.type === 'button' && n.label === '修改')
    expect(unlock?.disabled).toBe(true)
    expect(modify?.disabled).toBe(false)
    expect(nodes.length).toBeGreaterThan(0)
  })
})
