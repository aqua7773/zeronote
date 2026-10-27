import { describe, expect, it } from 'vitest'
import {
  argvOf,
  isPluginCommandAllowed,
  normalizeAllowedCommands,
  pickAllowableCommands,
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
})
