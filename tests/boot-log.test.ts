/**
 * 启动日志插件（`examples/boot-log` · rev173.352）。
 *
 * 覆盖四层：
 *   1. 纯函数：阶段间隔 / 长任务排序 / 与 logcat 同源的日志文本
 *   2. 读取：`__znBootMarks` 缺失或抛错 ⇒ null（面板给提示，不炸）
 *   3. 面板：无数据时的提示节点 · 有数据时的两张表 · ≥100ms 标红
 *   4. 接线：面板注册位置 / 3 条命令 / 「打开」走 `core.panel.<id>`
 */
import { describe, expect, it, vi } from 'vitest'
import plugin, { logText, longTaskRows, panelNode, readBoot, stageRows } from '../examples/boot-log/index.js'

const data = {
  at: 900,
  marks: [
    { name: 'entry', at: 3 },
    { name: 'styles-ready', at: 9 },
    { name: 'plugins-ready', at: 703 },
  ],
  longTasks: [
    { start: 120, dur: 77 },
    { start: 400, dur: 180 },
    { start: 50, dur: 55 },
  ],
}

/* ───────────────────────── 纯函数 ───────────────────────── */

describe('stageRows：间隔 = 与上一个打点的差', () => {
  it('第一项从 0 起算，后续取相邻差', () => {
    expect(stageRows(data)).toEqual([
      { stage: 'entry', at: 3, gap: 3 },
      { stage: 'styles-ready', at: 9, gap: 6 },
      { stage: 'plugins-ready', at: 703, gap: 694 },
    ])
  })

  it('同一时刻的两个打点间隔为 0', () => {
    expect(stageRows({ marks: [{ name: 'a', at: 5 }, { name: 'b', at: 5 }] }).map((r) => r.gap)).toEqual([
      5, 0,
    ])
  })
})

describe('longTaskRows：按耗时降序且不改原数组', () => {
  it('最慢的在第一行', () => {
    expect(longTaskRows(data).map((t) => t.dur)).toEqual([180, 77, 55])
  })

  it('没有 longTasks 字段时返回空表', () => {
    expect(longTaskRows({ marks: [] })).toEqual([])
  })

  it('不排序原数组（后续读取还要按开始时间）', () => {
    const input = { longTasks: [{ start: 1, dur: 10 }, { start: 2, dur: 90 }] }
    longTaskRows(input)
    expect(input.longTasks.map((t) => t.dur)).toEqual([10, 90])
  })
})

describe('logText：与 logcat 那条同源', () => {
  it('阶段按 `名@时刻` 拼接，长任务接在后面', () => {
    expect(logText(data)).toBe(
      '[zn-boot] entry@3 styles-ready@9 plugins-ready@703 | longtask@120+77ms longtask@400+180ms longtask@50+55ms',
    )
  })

  it('没有长任务时不出现分隔符', () => {
    expect(logText({ marks: [{ name: 'entry', at: 3 }] })).toBe('[zn-boot] entry@3')
  })
})

describe('readBoot：缺函数 / 抛错都返回 null', () => {
  it('没有 __znBootMarks ⇒ null', () => {
    expect(readBoot({})).toBeNull()
    expect(readBoot(undefined)).toBeNull()
  })

  it('调用抛错 ⇒ null（不把异常抛给面板）', () => {
    expect(
      readBoot({
        __znBootMarks: () => {
          throw new Error('boom')
        },
      }),
    ).toBeNull()
  })

  it('返回结构不对（没有 marks 数组）⇒ null', () => {
    expect(readBoot({ __znBootMarks: () => ({ at: 1 }) })).toBeNull()
  })

  it('正常返回原样透传', () => {
    expect(readBoot({ __znBootMarks: () => data })).toBe(data)
  })
})

/* ───────────────────────── 面板 ───────────────────────── */

describe('panelNode', () => {
  it('没有数据：给「这个版本没有启动打点」而不是空白', () => {
    const node = panelNode(null)
    expect(node.type).toBe('stack')
    expect(JSON.stringify(node)).toContain('这个版本没有启动打点')
  })

  it('有数据：两张表 + 刷新/复制按钮 + 等价日志', () => {
    const node = panelNode(data)
    const tables = node.children.filter((c) => c.type === 'table')
    expect(tables).toHaveLength(2)
    expect(tables[0].rows).toHaveLength(3)
    expect(tables[1].rows).toHaveLength(3)
    // 长任务表第一行 = 最慢的 180ms
    expect(tables[1].rows[0].start).toBe(400)

    const json = JSON.stringify(node)
    expect(json).toContain('boot-log.refresh')
    expect(json).toContain('boot-log.copy')
    expect(json).toContain('[zn-boot] entry@3')
  })

  it('≥100ms 的长任务标 danger，<100ms 保持默认', () => {
    const rows = panelNode(data).children.filter((c) => c.type === 'table')[1].rows
    const tones = rows.map((r) => r.dur.tone)
    expect(tones).toEqual(['danger', 'default', 'default'])
  })

  it('没有长任务时给「没有 >50ms」文案', () => {
    const json = JSON.stringify(panelNode({ at: 10, marks: [{ name: 'entry', at: 3 }], longTasks: [] }))
    expect(json).toContain('本次启动没有 >50ms 的长任务')
  })
})

/* ───────────────────────── 接线 ───────────────────────── */

function fakeApi() {
  const commands = new Map<string, { id: string; run: () => unknown }>()
  const panels: { id: string; title: string; location: string; render: () => unknown }[] = []
  const executed: string[] = []
  const api = {
    subscriptions: [] as { dispose: () => void }[],
    view: {
      registerPanel: vi.fn((spec: (typeof panels)[number]) => {
        panels.push(spec)
        return { dispose: vi.fn() }
      }),
      refresh: vi.fn(),
    },
    command: {
      register: vi.fn((spec: { id: string; run: () => unknown }) => {
        commands.set(spec.id, spec)
        return { dispose: vi.fn() }
      }),
      execute: vi.fn(async (id: string) => {
        executed.push(id)
      }),
    },
    host: { notify: vi.fn(), log: vi.fn() },
  }
  return { api, commands, panels, executed }
}

describe('apply：注册与命令接线', () => {
  it('主区一个面板 + 3 条命令', () => {
    const { api, commands, panels } = fakeApi()
    plugin.apply(api as never)

    expect(panels).toHaveLength(1)
    expect(panels[0].id).toBe('boot-log.panel')
    expect(panels[0].location).toBe('main')
    expect(typeof panels[0].render).toBe('function')
    expect([...commands.keys()].sort()).toEqual(['boot-log.copy', 'boot-log.open', 'boot-log.refresh'])
  })

  it('open 走内核注册的 core.panel.<id>', async () => {
    const { api, commands, executed } = fakeApi()
    plugin.apply(api as never)

    await commands.get('boot-log.open')!.run()
    expect(executed).toEqual(['core.panel.boot-log.panel'])
  })

  it('refresh 调 view.refresh(面板 id)', async () => {
    const { api, commands } = fakeApi()
    plugin.apply(api as never)

    await commands.get('boot-log.refresh')!.run()
    expect(api.view.refresh).toHaveBeenCalledWith('boot-log.panel')
  })

  it('没有打点时复制只提示、不抛错', async () => {
    const { api, commands } = fakeApi()
    plugin.apply(api as never)

    await commands.get('boot-log.copy')!.run()
    expect(api.host.notify).toHaveBeenCalled()
    expect(String(api.host.notify.mock.calls[0][0])).toContain('没有启动打点')
  })
})
