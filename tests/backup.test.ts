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
  formatName,
  formatSize,
  panelNode,
  parseIndex,
  pickStale,
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
  function makeApi() {
    const commands = new Map()
    const panels = []
    return {
      api: {
        subscriptions: [],
        fs: {
          exists: vi.fn(async () => false),
          readText: vi.fn(async () => ''),
          writeText: vi.fn(async () => {}),
          readBytes: vi.fn(async () => new Uint8Array()),
          writeBytes: vi.fn(async () => {}),
          listFiles: vi.fn(async () => []),
          listDirs: vi.fn(async () => []),
          listNotes: vi.fn(async () => []),
          copy: vi.fn(async () => {}),
          mkdir: vi.fn(async () => {}),
          purgeBackup: vi.fn(async () => {}),
        },
        view: {
          registerPanel: vi.fn((p) => {
            panels.push(p)
            return () => {}
          }),
          refresh: vi.fn(),
        },
        command: {
          register: vi.fn((c) => {
            commands.set(c.id, c)
            return () => {}
          }),
          execute: vi.fn(async () => {}),
        },
        host: { notify: vi.fn(), platform: 'desktop' },
      },
      commands,
      panels,
    }
  }

  it('面板注册在主区，命令齐', () => {
    const { api, commands, panels } = makeApi()
    plugin.apply(/** @type {any} */ (api))
    expect(panels).toHaveLength(1)
    expect(panels[0]).toMatchObject({ id: 'backup.board', location: 'main' })
    for (const id of ['backup.run', 'backup.refresh', 'backup.remove', 'backup.open']) {
      expect(commands.has(id)).toBe(true)
    }
  })

  it('启动只读清单，不自动备份', async () => {
    const { api } = makeApi()
    plugin.apply(/** @type {any} */ (api))
    await new Promise((r) => setTimeout(r, 0))
    expect(api.fs.copy).not.toHaveBeenCalled()
    expect(api.fs.exists).toHaveBeenCalled()
  })
})
