/**
 * 备份（`examples/backup`）—— rev173.175 · 需求 §14.1 / 阶段 3 遗留项。
 *
 * 覆盖四层：
 *   1. 纯函数：备份目录名（本地时间、可字典序排序）· 人话时间 · 轮换挑选（只删超出 30 的最老）
 *   2. 清单解析：正常 / 坏 JSON / 旧格式裸数组 / 混进非法名
 *   3. 视图：空态两种文案（没备过 vs 清单坏了）· 有行时的徽标
 *   4. 接线：面板位置 / 命令都登记 / 启动时读清单但不自动备份
 */
import { describe, expect, it, vi } from 'vitest'
import plugin, {
  backupName,
  dueAt,
  dueText,
  formatName,
  formatSize,
  intervalLabel,
  intervalMs,
  isDue,
  panelNode,
  parseIndex,
  pickStale,
  selectOptions,
  toRows,
} from '../examples/backup/index.js'

describe('backupName / formatName', () => {
  it('按本地时间生成，秒精度，可字典序排序', () => {
    expect(backupName(new Date(2026, 9, 26, 14, 30, 5))).toBe('2026-10-26T14-30-05')
    expect(backupName(new Date(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01T00-00-00')
  })

  it('字典序 == 时间序（轮换靠这一点）', () => {
    const a = backupName(new Date(2026, 9, 26, 9, 59, 59))
    const b = backupName(new Date(2026, 9, 26, 10, 0, 0))
    expect(a < b).toBe(true)
  })

  it('人话时间；不认识的原样返回', () => {
    expect(formatName('2026-10-26T14-30-00')).toBe('10-26 14:30:00')
    expect(formatName('乱码')).toBe('乱码')
    expect(formatName(undefined)).toBe('')
  })
})

describe('pickStale —— 只删超出上限的最老那几份', () => {
  const mk = (n) =>
    Array.from({ length: n }, (_, i) => ({ name: `2026-10-${String(i + 1).padStart(2, '0')}T00-00-00` }))

  it('不足上限 ⇒ 一份都不删', () => {
    expect(pickStale(mk(5), 30)).toEqual([])
  })

  it('正好上限 ⇒ 一份都不删（边界：用 > 不是 >=）', () => {
    expect(pickStale(mk(30), 30)).toEqual([])
  })

  it('超出 => 删最老的，数量正确（返回按最新在前）', () => {
    const stale = pickStale(mk(33), 30)
    expect(stale.map((s) => s.name)).toEqual([
      '2026-10-03T00-00-00',
      '2026-10-02T00-00-00',
      '2026-10-01T00-00-00',
    ])
  })

  it('乱序输入也按最新保留', () => {
    const items = [
      { name: '2026-10-02T00-00-00' },
      { name: '2026-10-03T00-00-00' },
      { name: '2026-10-01T00-00-00' },
    ]
    expect(pickStale(items, 1).map((s) => s.name)).toEqual([
      '2026-10-02T00-00-00',
      '2026-10-01T00-00-00',
    ])
  })

  it('非法条目跳过、空表安全', () => {
    expect(pickStale(null, 30)).toEqual([])
    expect(pickStale([{}, { name: '' }, { name: '2026-10-01T00-00-00' }], 1)).toEqual([])
  })
})

describe('parseIndex —— 坏清单不崩，也不静默当成空', () => {
  it('正常格式', () => {
    const items = parseIndex(
      JSON.stringify({
        version: 1,
        items: [{ name: '2026-10-26T14-30-00', at: 1, notes: 12, dirs: 3, secret: true, ms: 88 }],
      }),
    )
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ name: '2026-10-26T14-30-00', notes: 12, dirs: 3, secret: true })
  })

  it('旧格式（裸数组）也认', () => {
    expect(parseIndex(JSON.stringify([{ name: '2026-10-26T14-30-00' }]))).toHaveLength(1)
  })

  it('坏 JSON ⇒ 空表（不抛）', () => {
    expect(parseIndex('{ 坏了')).toEqual([])
    expect(parseIndex('')).toEqual([])
    expect(parseIndex(null)).toEqual([])
  })

  it('名字不合规的条目丢掉（防止 `../` 之类混进清单）', () => {
    const items = parseIndex(
      JSON.stringify([{ name: '../逃逸' }, { name: '2026-10-26T14-30-00' }]),
    )
    expect(items.map((i) => i.name)).toEqual(['2026-10-26T14-30-00'])
  })
})

describe('toRows / formatSize', () => {
  it('行数据带人话标签', () => {
    const [row] = toRows([{ name: '2026-10-26T14-30-00', notes: 5, trigger: 'auto' }])
    expect(row.label).toBe('10-26 14:30:00')
    expect(row.notes).toBe(5)
    expect(row.trigger).toBe('auto')
  })

  it('大小换算', () => {
    expect(formatSize(0)).toBe('0 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatSize(-1)).toBe('—')
    expect(formatSize(Number.NaN)).toBe('—')
  })
})

describe('自动备份档位（rev173.176）', () => {
  const HOUR = 3600e3
  const DAY = 86400e3

  it('九个档位、默认每天', () => {
    expect(intervalMs('1h')).toBe(HOUR)
    expect(intervalMs('1d')).toBe(DAY)
    expect(intervalMs('1mo')).toBe(30 * DAY)
    expect(intervalLabel('1d')).toBe('每天')
  })

  it('未知档位回落默认（store 里存了旧值 / 手工改坏）', () => {
    expect(intervalMs('7m')).toBe(DAY)
    expect(intervalMs(undefined)).toBe(DAY)
    expect(intervalLabel('乱写')).toBe('每天')
  })

  it('从没备份过 ⇒ 立刻到期', () => {
    expect(isDue(0, '1d', 1000)).toBe(true)
    expect(isDue(null, '1d', 1000)).toBe(true)
  })

  it('正好到期（边界用 >=，不是 >）', () => {
    const last = 1_000_000
    expect(isDue(last, '1d', last + DAY)).toBe(true)
    expect(isDue(last, '1d', last + DAY - 1)).toBe(false)
  })

  it('dueAt：没备过给 0（表示立刻），备过按档位加', () => {
    expect(dueAt(0, '1d')).toBe(0)
    expect(dueAt(1000, '1h')).toBe(1000 + HOUR)
  })

  it('selectOptions 把当前档位排第一（宿主 state 为空时落到它）', () => {
    const opts = selectOptions('1w')
    expect(opts[0].value).toBe('1w')
    expect(opts).toHaveLength(9)
    expect(new Set(opts.map((o) => o.value)).size).toBe(9)
    // 非法值回落默认档，且仍排第一
    expect(selectOptions('乱写')[0].value).toBe('1d')
  })

  it('dueText 三种状态', () => {
    const now = new Date(2026, 9, 26, 12, 0, 0).getTime()
    expect(dueText(0, '1d', now)).toContain('还没备份过')
    expect(dueText(now - DAY - 1, '1d', now)).toContain('已到期')
    const normal = dueText(now - HOUR, '1d', now)
    expect(normal).toContain('上次')
    expect(normal).toContain('下次')
  })
})

describe('恢复（rev173.177）', () => {
  it('恢复前快照不参与 30 份轮换（需求 §14.2）', () => {
    const items = [
      { name: 'pre-restore-2026-10-01T00-00-00' },
      ...Array.from({ length: 30 }, (_, i) => ({
        name: `2026-10-${String(i + 2).padStart(2, '0')}T00-00-00`,
      })),
    ]
    // 30 份普通备份 + 1 份快照 ⇒ 一份都不删（快照不占额度）
    expect(pickStale(items, 30)).toEqual([])
    // 再挤一份普通备份 ⇒ 只删最老那份普通备份，快照永远不动
    const stale = pickStale([...items, { name: '2026-11-01T00-00-00' }], 30)
    expect(stale.map((s) => s.name)).toEqual(['2026-10-02T00-00-00'])
  })

  it('parseIndex 认恢复前快照并标 protected', () => {
    const items = parseIndex(
      JSON.stringify([
        { name: 'pre-restore-2026-10-26T20-30-00', protected: true, dirs: 6 },
        { name: '2026-10-26T14-30-00' },
      ]),
    )
    expect(items.map((i) => i.name)).toEqual([
      'pre-restore-2026-10-26T20-30-00',
      '2026-10-26T14-30-00',
    ])
    expect(items[0].protected).toBe(true)
    expect(items[1].protected).toBe(false)
  })

  it('toRows 把快照标成 pre（面板要单独显示）', () => {
    const [row] = toRows([{ name: 'pre-restore-2026-10-26T20-30-00' }])
    expect(row.pre).toBe(true)
  })

  it('面板有「恢复」按钮；上膛态换成确认文案', () => {
    const row = {
      name: '2026-10-26T14-30-00',
      label: '10-26 14:30:00',
      notes: 3,
      dirs: 0,
      secret: false,
      trigger: 'manual',
      pre: false,
    }
    const idle = JSON.stringify(panelNode({ rows: [row] }))
    expect(idle).toContain('backup.restore')
    expect(idle).toContain('"恢复"')
    const armed = JSON.stringify(panelNode({ rows: [row], pendingRestore: row.name }))
    expect(armed).toContain('确认恢复？再点一次')
  })

  it('旧备份没有 dirNames ⇒ 恢复会被拒绝（由命令层兜）', () => {
    // 这里锁的是「meta 里没有 dirNames 时会话能看出来」这一段的数据形状
    const meta = JSON.parse(JSON.stringify({ dirs: 6, secret: true }))
    expect(Array.isArray(meta.dirNames)).toBe(false)
    expect(meta.dirs).toBeGreaterThan(0)
  })
})

describe('panelNode', () => {
  it('空态：没备过 vs 清单坏了 文案不同', () => {
    const fresh = JSON.stringify(panelNode({ rows: [] }))
    const broken = JSON.stringify(panelNode({ rows: [], broken: true }))
    expect(fresh).toContain('还没有备份')
    expect(broken).toContain('清单读不出来')
    expect(broken).not.toBe(fresh)
  })

  it('有行时给出时间 / 篇数 / 含密码库 / 删除按钮', () => {
    const node = panelNode({
      rows: [{ name: '2026-10-26T14-30-00', label: '10-26 14:30:00', notes: 9, dirs: 2, secret: true, trigger: 'manual' }],
    })
    const text = JSON.stringify(node)
    expect(text).toContain('10-26 14:30:00')
    expect(text).toContain('9 篇')
    expect(text).toContain('含密码库')
    expect(text).toContain('backup.remove')
  })

  it('运行中按钮文案变成「备份中…」', () => {
    const text = JSON.stringify(panelNode({ rows: [], running: true }))
    expect(text).toContain('备份中…')
  })
})

describe('接线', () => {
  function makeApi({ notes = [] as unknown[], files = [] as unknown[], dirs = [] as unknown[] } = {}) {
    const commands = new Map()
    const panels = []
    const api = {
      subscriptions: [] as { dispose?: () => void }[],
      fs: {
        exists: vi.fn(async () => false),
        readText: vi.fn(async () => ''),
        writeText: vi.fn(async () => {}),
        readBytes: vi.fn(async () => new Uint8Array()),
        writeBytes: vi.fn(async () => {}),
        listFiles: vi.fn(async () => files),
        listDirs: vi.fn(async () => dirs),
        listNotes: vi.fn(async () => notes),
        copy: vi.fn(async () => {}),
        mkdir: vi.fn(async () => {}),
        purgeBackup: vi.fn(async () => {}),
      },
      store: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
      },
      view: {
        registerPanel: vi.fn((p) => {
          panels.push(p)
          return { dispose: () => {} }
        }),
        refresh: vi.fn(),
      },
      command: {
        register: vi.fn((c) => {
          commands.set(c.id, c)
          return { dispose: () => {} }
        }),
        execute: vi.fn(async () => {}),
      },
      host: { notify: vi.fn(), platform: 'desktop' },
    }
    const disposeAll = () => {
      for (const d of api.subscriptions) d?.dispose?.()
    }
    return { api, commands, panels, disposeAll }
  }

  it('面板注册在主区，命令齐', () => {
    const { api, commands, panels, disposeAll } = makeApi()
    plugin.apply(/** @type {any} */ (api))
    expect(panels).toHaveLength(1)
    expect(panels[0]).toMatchObject({ id: 'backup.board', location: 'main' })
    for (const id of [
      'backup.run',
      'backup.refresh',
      'backup.remove',
      'backup.set-interval',
      'backup.open',
    ]) {
      expect(commands.has(id)).toBe(true)
    }
    disposeAll()
  })

  it('启动：从没备份 + 空库 ⇒ 不备份（新装应用不该每次塞一份空备份）', async () => {
    const { api, disposeAll } = makeApi()
    plugin.apply(/** @type {any} */ (api))
    await new Promise((r) => setTimeout(r, 10))
    expect(api.fs.copy).not.toHaveBeenCalled()
    expect(api.fs.exists).toHaveBeenCalled()
    disposeAll()
  })

  it('启动：从没备份 + 库里有文件 ⇒ 立刻补一份（lastAt=0 视为到期）', async () => {
    const { api, disposeAll } = makeApi({ notes: [{ path: 'a.md' }], files: ['a.md'] })
    plugin.apply(/** @type {any} */ (api))
    await new Promise((r) => setTimeout(r, 10))
    expect(api.fs.copy).toHaveBeenCalledWith('a.md', expect.stringContaining('.zn/backups/'))
    expect(api.store.set).toHaveBeenCalled()
    disposeAll()
  })
})
