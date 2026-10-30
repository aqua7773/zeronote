/**
 * 条目菜单动作注册表（rev173.281 · J#18）。
 *
 * 锁的是内核协议层的五条语义：
 *  ① 注册 / 静态声明都能读到，且带归属插件；
 *  ② 同插件同命令**后登记覆盖先登记**（manifest 静态 + apply 运行时不会出现两项）；
 *  ③ 覆盖后 dispose 旧层**不能**顺手删掉新层（层栈式还原，与 command 同一套教训）；
 *  ④ 撤销 / 卸载只清自己那个插件（别的插件动作不受影响）；
 *  ⑤ 写坏一条动作当场抛错、且批量声明**不会留下半套**（静默失效最贵）。
 */
import { describe, expect, it, vi } from 'vitest'
import { createItemMenuRegistry } from '../src/kernel/item-menu'
import type { ItemMenuAction } from '../src/kernel/contract'

const action = (over: Partial<ItemMenuAction> = {}): ItemMenuAction => ({
  command: 'io.exportTxt',
  title: '导出为 txt…',
  ...over,
})

describe('itemMenu 注册表', () => {
  it('注册一条动作后能读到，并带上归属插件', () => {
    const reg = createItemMenuRegistry()
    reg.scoped('import-export').register(action())
    const list = reg.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      command: 'io.exportTxt',
      title: '导出为 txt…',
      pluginId: 'import-export',
    })
  })

  it('静态声明与运行时注册同命令去重：后登记的那份生效', () => {
    const reg = createItemMenuRegistry()
    reg.declare([action({ title: '静态标题' })], 'import-export')
    reg.scoped('import-export').register(action({ title: '运行时标题', order: 5 }))
    const list = reg.list()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('运行时标题')
  })

  it('覆盖后 dispose 旧层不会删掉新层', () => {
    const reg = createItemMenuRegistry()
    const old = reg.declare([action({ title: '旧的' })], 'p')
    reg.scoped('p').register(action({ title: '新的' }))
    old.dispose()
    expect(reg.list().map((x) => x.title)).toEqual(['新的'])
  })

  it('撤销只影响自己，别的插件动作还在', () => {
    const reg = createItemMenuRegistry()
    const a = reg.declare([action({ command: 'a.go', title: 'A' })], 'a')
    reg.declare([action({ command: 'b.go', title: 'B' })], 'b')
    a.dispose()
    expect(reg.list().map((x) => x.command)).toEqual(['b.go'])
  })

  it('release(pluginId) 清掉该插件的全部动作（含运行时登记的）', () => {
    const reg = createItemMenuRegistry()
    reg.declare([action({ command: 'a.go' })], 'a')
    reg.scoped('a').register(action({ command: 'a.other' }))
    reg.declare([action({ command: 'b.go' })], 'b')
    reg.release('a')
    expect(reg.list().map((x) => x.command)).toEqual(['b.go'])
  })

  it('排序：order 小的在前，同 order 按登记顺序', () => {
    const reg = createItemMenuRegistry()
    reg.scoped('p').register(action({ command: 'p.c', title: 'C', order: 20 }))
    reg.scoped('p').register(action({ command: 'p.a', title: 'A', order: 10 }))
    reg.scoped('p').register(action({ command: 'p.b', title: 'B', order: 10 }))
    expect(reg.list().map((x) => x.command)).toEqual(['p.a', 'p.b', 'p.c'])
  })

  it('变更通知：注册 / 撤销 / release 都会推一次当前清单', () => {
    const onChange = vi.fn()
    const reg = createItemMenuRegistry(onChange)
    const d = reg.scoped('p').register(action({ command: 'p.a' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    d.dispose()
    expect(onChange).toHaveBeenCalledTimes(2)
    reg.release('p')
    // 没有可清的项 ⇒ 不推（避免无意义的重渲染）
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('子菜单父项没有 command 也能登记（按 title 去重）', () => {
    const reg = createItemMenuRegistry()
    reg.scoped('p').register({
      title: '导出为…',
      children: [action({ command: 'p.txt', title: 'txt' })],
    })
    expect(reg.list()[0].children?.[0].command).toBe('p.txt')
  })

  it('写坏的动作当场抛：没 title / 既无 command 又无 children / 子项没 command', () => {
    const reg = createItemMenuRegistry()
    expect(() => reg.scoped('p').register({ title: '  ' })).toThrow(/title/)
    expect(() => reg.scoped('p').register({ title: '空的' })).toThrow(/command/)
    expect(() =>
      reg.scoped('p').register({
        title: '父',
        children: [{ title: '子' }],
      }),
    ).toThrow(/子项必须有 command/)
  })

  it('批量声明里有一条坏的 ⇒ 一条也不留下（不留半套菜单）', () => {
    const reg = createItemMenuRegistry()
    expect(() =>
      reg.declare([action({ command: 'p.ok' }), { title: '', command: 'p.bad' }], 'p'),
    ).toThrow()
    expect(reg.list()).toHaveLength(0)
  })
})
