import { describe, expect, it } from 'vitest'
import {
  argvOf,
  filterCommands,
  groupCommands,
  groupLabel,
  isPluginCommandAllowed,
  normalizeAllowedCommands,
  pickAllowableCommands,
  summarizeAllowedCommands,
  TOOLS,
} from '../examples/ai/index.js'

/**
 * 第二版 `plugin.exec`（rev173.208）的白名单纯函数。
 *
 * 这里的每一条错了都**看不出来**：
 * · 放行了 `core.*` ⇒ 模型能直接命令内核（违反"内核保持薄"）；
 * · 放行了 `ai.*` ⇒ plugin_exec 递归调用自己，循环烧 token；
 * · 未授权也放行 ⇒ 用户勾选形同虚设；
 * · 白名单读回来不清洗 ⇒ 手改 store / 旧数据里的脏值会被当真。
 */
describe('isPluginCommandAllowed', () => {
  it('只有用户勾选过的插件命令放行', () => {
    expect(isPluginCommandAllowed('habit.check', ['habit.check'])).toBe(true)
    expect(isPluginCommandAllowed('habit.check', ['habit.backfill'])).toBe(false)
    expect(isPluginCommandAllowed('habit.check', [])).toBe(false)
  })

  it('内核命令与 AI 自己的命令永远不放行（即使被写进白名单）', () => {
    expect(isPluginCommandAllowed('core.openNote', ['core.openNote'])).toBe(false)
    expect(isPluginCommandAllowed('core.panel.ai.chat', ['core.panel.ai.chat'])).toBe(false)
    expect(isPluginCommandAllowed('ai.send', ['ai.send'])).toBe(false)
    expect(isPluginCommandAllowed('ai.toggle-command', ['ai.toggle-command'])).toBe(false)
  })

  it('空 / 非字符串一律拒绝', () => {
    expect(isPluginCommandAllowed('', [''])).toBe(false)
    expect(isPluginCommandAllowed(null, ['habit.check'])).toBe(false)
    expect(isPluginCommandAllowed(undefined, null)).toBe(false)
  })
})

describe('normalizeAllowedCommands', () => {
  it('去重、去空、去掉内核与 AI 自身', () => {
    expect(
      normalizeAllowedCommands([
        'habit.check',
        'habit.check',
        ' core.openNote ',
        'ai.send',
        '',
        null,
        42,
        'habit.backfill',
      ]),
    ).toEqual(['habit.check', 'habit.backfill'])
  })

  it('非数组当空处理（旧 store 可能是 null）', () => {
    expect(normalizeAllowedCommands(null)).toEqual([])
    expect(normalizeAllowedCommands('habit.check')).toEqual([])
  })
})

describe('pickAllowableCommands', () => {
  it('列出插件命令，去掉内核与 AI 自己，缺 title 时用 id', () => {
    expect(
      pickAllowableCommands([
        { id: 'habit.check', title: '打卡：打卡' },
        { id: 'core.openNote', title: '打开笔记' },
        { id: 'ai.send', title: 'AI：发送消息' },
        { id: 'habit.backfill' },
        { id: '' },
        null,
      ]),
    ).toEqual([
      { id: 'habit.check', title: '打卡：打卡' },
      { id: 'habit.backfill', title: 'habit.backfill' },
    ])
  })

  it('非数组当空处理', () => {
    expect(pickAllowableCommands(undefined)).toEqual([])
  })
})

describe('groupCommands / groupLabel', () => {
  it('按 id 第一段分组，按码点稳定排序（不依赖 locale）', () => {
    const groups = groupCommands([
      { id: 'tag-panel.open', title: '标签：打开标签面板' },
      { id: 'accounting.stats', title: '记账：统计' },
      { id: 'accounting.sync', title: '记账：同步支付通知' },
      { id: 'habit.check', title: '打卡：打卡' },
    ])
    expect(groups.map((g) => g.group)).toEqual(['accounting', 'habit', 'tag-panel'])
    expect(groups[0].items.map((i) => i.id)).toEqual(['accounting.stats', 'accounting.sync'])
  })

  it('没有点号的 id 单独成组；空输入返回空数组', () => {
    expect(groupCommands([{ id: 'plain' }])).toEqual([
      { group: 'plain', items: [{ id: 'plain', title: 'plain' }] },
    ])
    expect(groupCommands(null)).toEqual([])
  })

  it('分组标题取命令 title 的「前缀：」；取不到退回 id', () => {
    expect(groupLabel([{ id: 'a.x', title: '打卡：打卡' }], 'a')).toBe('打卡')
    expect(groupLabel([{ id: 'a.x', title: '没有冒号' }], 'a')).toBe('a')
    expect(groupLabel([], 'zz')).toBe('zz')
  })
})

describe('filterCommands', () => {
  const list = [
    { id: 'accounting.exportCsv', title: '记账：导出 CSV' },
    { id: 'habit.check', title: '打卡：打卡' },
    { id: 'tag-panel.open', title: '标签：打开标签面板' },
  ]

  it('按 id 或标题匹配，大小写不敏感', () => {
    expect(filterCommands(list, 'csv').map((c) => c.id)).toEqual(['accounting.exportCsv'])
    expect(filterCommands(list, 'CSV').map((c) => c.id)).toEqual(['accounting.exportCsv'])
    expect(filterCommands(list, '标签').map((c) => c.id)).toEqual(['tag-panel.open'])
    expect(filterCommands(list, 'habit').map((c) => c.id)).toEqual(['habit.check'])
  })

  it('空查询返回全部；无匹配返回空；非数组当空', () => {
    expect(filterCommands(list, '')).toHaveLength(3)
    expect(filterCommands(list, '   ')).toHaveLength(3)
    expect(filterCommands(list, '不存在的命令')).toEqual([])
    expect(filterCommands(null, 'x')).toEqual([])
  })
})

describe('summarizeAllowedCommands', () => {
  const all = [
    { id: 'accounting.stats', title: '记账：统计' },
    { id: 'habit.check', title: '打卡：打卡' },
  ]

  it('只返回已授权条目，另带可授权总数（不把 137 条塞给模型）', () => {
    expect(summarizeAllowedCommands(all, ['habit.check'])).toEqual({
      allowedCount: 1,
      allowed: [{ id: 'habit.check', title: '打卡：打卡' }],
      allowableTotal: 2,
    })
  })

  it('一条都没授权时返回空列表', () => {
    expect(summarizeAllowedCommands(all, [])).toEqual({ allowedCount: 0, allowed: [], allowableTotal: 2 })
  })

  it('query 在已授权范围内再筛一次', () => {
    expect(
      summarizeAllowedCommands(all, ['accounting.stats', 'habit.check'], '记账').allowed.map((c) => c.id),
    ).toEqual(['accounting.stats'])
  })

  it('非数组输入当空', () => {
    expect(summarizeAllowedCommands(null, null)).toEqual({ allowedCount: 0, allowed: [], allowableTotal: 0 })
  })
})

describe('argvOf', () => {
  it('缺省不传参；数组原样；标量与对象包成单参', () => {
    expect(argvOf(undefined)).toEqual([])
    expect(argvOf(null)).toEqual([])
    expect(argvOf([1, 'a'])).toEqual([1, 'a'])
    expect(argvOf('x')).toEqual(['x'])
    expect(argvOf({ planId: 'p1' })).toEqual([{ planId: 'p1' }])
  })
})

describe('plugin_exec 工具定义', () => {
  it('在 TOOLS 里且参数必填 command', () => {
    const t = TOOLS.find((x) => x.function.name === 'plugin_exec')
    expect(t).toBeTruthy()
    expect(t.function.parameters.required).toEqual(['command'])
    expect(t.function.parameters.properties.command.type).toBe('string')
    expect(t.function.parameters.properties.args.type).toBe('array')
  })

  it('list_allowed_commands 存在且只收可选 query', () => {
    const t = TOOLS.find((x) => x.function.name === 'list_allowed_commands')
    expect(t).toBeTruthy()
    expect(t.function.parameters.required).toEqual([])
    expect(t.function.parameters.properties.query.type).toBe('string')
  })
})
