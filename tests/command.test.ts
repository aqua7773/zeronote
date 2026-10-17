import { describe, expect, it, vi } from 'vitest'
import { createCommandApi, tagCommandImpl } from '../src/kernel/command'

describe('command 注册表', () => {
  it('命令 id 必须带命名空间前缀', () => {
    const reg = createCommandApi()
    expect(() => reg.api.register({ id: 'nope', title: 'x', run: () => 1 })).toThrow(
      /命名空间前缀/,
    )
    expect(() => reg.declare({ id: 'nope', title: 'x', pluginId: 'p' })).toThrow(/命名空间前缀/)
  })

  it('register 后 list / search 可见；search 大小写不敏感且匹配 id', () => {
    const reg = createCommandApi()
    reg.api.register({ id: 'demo.hello', title: '打招呼', run: () => 1 })
    expect(reg.api.list()).toEqual([{ id: 'demo.hello', title: '打招呼' }])
    expect(reg.search('')).toHaveLength(1)
    expect(reg.search('DEMO')).toHaveLength(1)
    expect(reg.search('hello')).toHaveLength(1)
    expect(reg.search('打招呼')).toHaveLength(1)
    expect(reg.search('不存在')).toEqual([])
  })

  it('同 id 后来者接管；dispose 后还原上一条，不把旧命令带走', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reg = createCommandApi()
    const first = reg.api.register({ id: 'core.act', title: '内核实现', run: () => 'core' })
    const second = reg.api.register({ id: 'core.act', title: '插件接管', run: () => 'plugin' })
    await expect(reg.api.execute('core.act')).resolves.toBe('plugin')
    second.dispose()
    await expect(reg.api.execute('core.act')).resolves.toBe('core')
    first.dispose()
    expect(reg.api.list()).toEqual([])
    expect(warn).toHaveBeenCalled()
  })

  it('declare 只登记元数据不绑实现；isBound 为 false', () => {
    const reg = createCommandApi()
    reg.declare({ id: 'demo.lazy', title: '懒命令', keybinding: 'Ctrl+K', pluginId: 'demo' })
    expect(reg.api.list()).toEqual([{ id: 'demo.lazy', title: '懒命令' }])
    expect(reg.isBound('demo.lazy')).toBe(false)
    expect(reg.implTag('demo.lazy')).toBeNull()
  })

  it('declare 重复 id 抛错', () => {
    const reg = createCommandApi()
    reg.declare({ id: 'demo.x', title: 'x', pluginId: 'demo' })
    expect(() => reg.declare({ id: 'demo.x', title: 'y', pluginId: 'demo' })).toThrow(/重复/)
  })

  it('未绑定实现时 execute 先激活插件，bind 后执行', async () => {
    const reg = createCommandApi()
    reg.declare({ id: 'demo.lazy', title: '懒命令', pluginId: 'demo' })
    const activates: string[] = []
    reg.setActivator(async (pluginId) => {
      activates.push(pluginId)
      reg.api.bind('demo.lazy', () => 'done')
    })
    await expect(reg.api.execute('demo.lazy', 1, 2)).resolves.toBe('done')
    expect(activates).toEqual(['demo'])
    expect(reg.isBound('demo.lazy')).toBe(true)
  })

  it('未绑定且没有激活器 ⇒ execute 报错', async () => {
    const reg = createCommandApi()
    reg.declare({ id: 'demo.lazy', title: '懒命令', pluginId: 'demo' })
    await expect(reg.api.execute('demo.lazy')).rejects.toThrow(/激活器/)
  })

  it('execute 不存在的命令 ⇒ 报错', async () => {
    const reg = createCommandApi()
    await expect(reg.api.execute('ghost.cmd')).rejects.toThrow(/命令不存在/)
  })

  it('bind 到已有命令 ⇒ dispose 时还原上一层实现（接管可还原）', async () => {
    const reg = createCommandApi()
    reg.api.register({ id: 'core.newNote', title: '新建笔记', run: () => 'core' })
    const takeover = reg.api.bind('core.newNote', () => 'plugin')
    await expect(reg.api.execute('core.newNote')).resolves.toBe('plugin')
    takeover.dispose()
    await expect(reg.api.execute('core.newNote')).resolves.toBe('core')
  })

  it('嵌套接管：B dispose 还原 A，A dispose 还原内核', async () => {
    const reg = createCommandApi()
    reg.api.register({ id: 'core.x', title: 'x', run: () => 'core' })
    const a = reg.api.bind('core.x', () => 'A')
    const b = reg.api.bind('core.x', () => 'B')
    await expect(reg.api.execute('core.x')).resolves.toBe('B')
    b.dispose()
    await expect(reg.api.execute('core.x')).resolves.toBe('A')
    a.dispose()
    await expect(reg.api.execute('core.x')).resolves.toBe('core')
  })

  it('旧实例 dispose 不抹掉新接管者，且不留下僵尸还原点', async () => {
    // rev121 修：接管改成层栈后，A.dispose 只摘掉 A 那层（不碰 B），
    // B.dispose 落回**内核**而不是 A。修之前 A 那层还原点会随"跳过"一起丢失，
    // B 卸后命令指向已卸载的 A（僵尸实现）。
    const reg = createCommandApi()
    reg.api.register({ id: 'core.x', title: 'x', run: () => 'core' })
    const a = reg.api.bind('core.x', () => 'A')
    const b = reg.api.bind('core.x', () => 'B')
    await expect(reg.api.execute('core.x')).resolves.toBe('B')
    a.dispose() // 此时当前实现是 b，A 的 dispose 摘自己的层，不影响 b
    await expect(reg.api.execute('core.x')).resolves.toBe('B')
    b.dispose()
    await expect(reg.api.execute('core.x')).resolves.toBe('core')
  })

  it('A 先卸、B 后卸 ⇒ 落回内核（rev121 修的僵尸实现）', async () => {
    const reg = createCommandApi()
    reg.api.register({ id: 'core.y', title: 'y', run: () => 'core' })
    const a = reg.api.bind('core.y', () => 'A')
    const b = reg.api.bind('core.y', () => 'B')
    a.dispose()
    await expect(reg.api.execute('core.y')).resolves.toBe('B')
    b.dispose()
    await expect(reg.api.execute('core.y')).resolves.toBe('core')
  })

  it('dispose 幂等：同一层摘两次不抛、也不影响栈', async () => {
    const reg = createCommandApi()
    reg.api.register({ id: 'core.z', title: 'z', run: () => 'core' })
    const a = reg.api.bind('core.z', () => 'A')
    a.dispose()
    expect(() => a.dispose()).not.toThrow()
    await expect(reg.api.execute('core.z')).resolves.toBe('core')
  })

  it('bind 未知 id ⇒ 建条目（title 退化为 id），dispose 整条删除', async () => {
    const reg = createCommandApi()
    const d = reg.api.bind('demo.adhoc', () => 42)
    expect(reg.api.list()).toEqual([{ id: 'demo.adhoc', title: 'demo.adhoc' }])
    await expect(reg.api.execute('demo.adhoc')).resolves.toBe(42)
    d.dispose()
    expect(reg.api.list()).toEqual([])
  })

  it('release(pluginId) 清掉该插件的静态声明命令', () => {
    const reg = createCommandApi()
    reg.declare({ id: 'demo.a', title: 'a', pluginId: 'demo' })
    reg.declare({ id: 'other.b', title: 'b', pluginId: 'other' })
    reg.release('demo')
    expect(reg.api.list()).toEqual([{ id: 'other.b', title: 'b' }])
  })

  it('run 抛错 ⇒ onError 收到 (id, err) 且异常继续上抛', async () => {
    const seen: [string, unknown][] = []
    const reg = createCommandApi((id, err) => seen.push([id, err]))
    reg.api.register({
      id: 'demo.fail',
      title: 'fail',
      run: () => {
        throw new Error('boom')
      },
    })
    await expect(reg.api.execute('demo.fail')).rejects.toThrow('boom')
    expect(seen).toHaveLength(1)
    expect(seen[0][0]).toBe('demo.fail')
  })

  it('implTag：插件标记 ⇒ plugin:<id>；未标记 ⇒ core；未绑定 ⇒ null', async () => {
    const reg = createCommandApi()
    reg.api.register({ id: 'core.a', title: 'a', run: () => 1 })
    reg.declare({ id: 'demo.lazy', title: 'lazy', pluginId: 'demo' })
    expect(reg.implTag('core.a')).toBe('core')
    expect(reg.implTag('demo.lazy')).toBeNull()

    reg.api.bind('core.a', tagCommandImpl(() => 2, 'plugin:demo') as () => number)
    expect(reg.implTag('core.a')).toBe('plugin:demo')
  })
})
