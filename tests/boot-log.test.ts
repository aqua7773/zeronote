/**
 * 启动日志插件（`examples/boot-log` · rev173.352 · 0.2.0）。
 *
 * 覆盖五层：
 *   1. 纯函数：阶段间隔 / 长任务排序 / 与 logcat 同源的日志文本
 *   2. 读取：`__znBootMarks` 缺失或抛错 ⇒ null（面板给提示，不炸）
 *   3. 面板：无数据提示 · 阶段/长任务/DOM 快照/IPC/资源五张表 · ≥100ms 标红
 *   4. 聚合：IPC 按命令合并排序 · 资源按耗时排序并截短
 *   5. 接线：面板注册位置 / 3 条命令 / 「打开」走 `core.panel.<id>`
 */
import { describe, expect, it, vi } from 'vitest'
import plugin, {
  aggregateIpc,
  installMethodProbe,
  installProbe,
  logText,
  longTaskRows,
  panelNode,
  probeSnapshot,
  readBoot,
  resourceRows,
  slowCallRows,
  stageRows,
} from '../examples/boot-log/index.js'

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

  it('有 IPC 时追加 ipc 段（按总耗时取前 3）', () => {
    const withIpc = {
      marks: [{ name: 'entry', at: 3 }],
      longTasks: [],
      ipc: [
        { cmd: 'read_file', start: 10, dur: 40, ok: true },
        { cmd: 'read_file', start: 60, dur: 20, ok: true },
        { cmd: 'list_files', start: 90, dur: 5, ok: true },
      ],
    }
    expect(logText(withIpc)).toBe('[zn-boot] entry@3 | ipc: read_file×2@60ms list_files×1@5ms')
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

/* ───────────────────────── 聚合 ───────────────────────── */

describe('aggregateIpc：按命令合并、按总耗时降序', () => {
  it('同一命令累计次数与总耗时，firstAt 取最早', () => {
    const rows = aggregateIpc([
      { cmd: 'read_file', start: 50, dur: 30, ok: true },
      { cmd: 'read_file', start: 10, dur: 20, ok: true },
      { cmd: 'list_files', start: 5, dur: 100, ok: true },
    ])
    expect(rows[0]).toEqual({ cmd: 'list_files', count: 1, total: 100, max: 100, firstAt: 5 })
    expect(rows[1]).toEqual({ cmd: 'read_file', count: 2, total: 50, max: 30, firstAt: 10 })
  })

  it('数量上限生效', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ cmd: `c${i}`, start: i, dur: i, ok: true }))
    expect(aggregateIpc(many, 5)).toHaveLength(5)
  })

  it('空输入 ⇒ 空表', () => {
    expect(aggregateIpc(undefined)).toEqual([])
  })
})

describe('resourceRows：启动期慢资源', () => {
  it('超过 20 秒窗口的条目丢掉', () => {
    const rows = resourceRows([
      { name: 'a.png', startTime: 3000, duration: 40 },
      { name: 'late.png', startTime: 25000, duration: 999 },
    ])
    expect(rows.map((r) => r.name)).toEqual(['a.png'])
  })

  it('按耗时降序，且不足 1ms 的忽略', () => {
    const rows = resourceRows([
      { name: 'x', startTime: 10, duration: 5 },
      { name: 'y', startTime: 20, duration: 80 },
      { name: 'z', startTime: 30, duration: 0 },
    ])
    expect(rows.map((r) => r.name)).toEqual(['y', 'x'])
  })

  it('长 URL 截短到 90 字符以内', () => {
    const long = 'https://example.com/' + 'a'.repeat(200)
    const [row] = resourceRows([{ name: long, startTime: 5, duration: 10 }])
    expect(row.name.length).toBeLessThanOrEqual(91)
    expect(row.name.startsWith('…')).toBe(true)
  })
})

/* ───────────────────────── 面板 ───────────────────────── */

describe('panelNode', () => {
  it('没有数据：给「这个版本没有启动打点」而不是空白', () => {
    const node = panelNode(null)
    expect(node.type).toBe('stack')
    expect(JSON.stringify(node)).toContain('这个版本没有启动打点')
  })

  it('有数据：六张表（阶段/长任务/DOM 快照/IPC/资源/慢调用）+ 刷新/复制按钮', () => {
    const node = panelNode({
      ...data,
      ipc: [{ cmd: 'read_file', start: 10, dur: 40, ok: true }],
      snaps: [{ start: 400, dur: 180, imgs: 3, loaded: 2, nodes: 400 }],
      resources: [{ name: 'a.png', startTime: 3000, duration: 40 }],
    })
    const tables = node.children.filter((c) => c.type === 'table')
    expect(tables).toHaveLength(6)
    expect(tables[0].rows).toHaveLength(3)
    expect(tables[1].rows).toHaveLength(3)
    expect(tables[2].rows[0].dom).toContain('图 2/3')
    expect(tables[3].rows[0].cmd).toBe('read_file')
    expect(tables[4].rows[0].name).toBe('a.png')

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

  it('没有剪贴板时复制报告只提示、不抛错', async () => {
    const { api, commands } = fakeApi()
    plugin.apply(api as never)

    await commands.get('boot-log.copy')!.run()
    expect(api.host.notify).toHaveBeenCalled()
  })

  it('Tauri 的 invoke 只读时：装不上探针但不抛错，面板标 ipcUnavailable', () => {
    // 真机实测：__TAURI_INTERNALS__.invoke 是 writable:false / configurable:false
    const internal = {}
    Object.defineProperty(internal, 'invoke', {
      value: () => Promise.resolve(),
      writable: false,
      configurable: false,
    })
    const win = { __TAURI_INTERNALS__: internal, PerformanceObserver: undefined }

    expect(() => installProbe(win)).not.toThrow()
    expect(probeSnapshot().ipcUnavailable).toBe(true)

    // 面板照常渲染，IPC 表给出「只读」提示而不是空白
    const json = JSON.stringify(panelNode({ ...data, ipc: [], ipcUnavailable: true }))
    expect(json).toContain('Tauri IPC 只读')
  })

  it('方法探针：≥50ms 的 sort 被记下（带调用栈），快调用不记', () => {
    installMethodProbe()

    // 快排序：不记录
    Array.from({ length: 5 }, (_, i) => i).sort((a, b) => a - b)
    const before = slowCallRows().length

    // 慢排序：比较器忙等 30ms × 3 次 ⇒ 总耗时 > 50ms
    const arr = [3, 1, 2]
    arr.sort(() => {
      const t = Date.now()
      while (Date.now() - t < 30) {
        /* busy */
      }
      return 0
    })

    const rows = slowCallRows()
    expect(rows.length).toBeGreaterThan(before)
    expect(rows[0].label).toBe('Array.sort')
    expect(rows[0].dur).toBeGreaterThanOrEqual(50)
    expect(rows[0].stack).toContain('boot-log.test')
  })
})
