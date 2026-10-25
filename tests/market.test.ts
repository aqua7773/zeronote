// @vitest-environment happy-dom
/**
 * 插件市场（阶段 1 · rev173.148）的纯函数部分：
 * 索引解析（坏条目跳过、好条目照常）· 状态判定（数字段比版本）· base64 解码。
 *
 * 下载与安装那两条 invoke 不在这里测（要真实 HTTP 与磁盘）——
 * Rust 侧 `install_znp_from_url` 的「sha 不符不落盘」有单测守着。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))

import {
  clearCachedUpdate,
  computeUpdates,
  decodeBase64Utf8,
  fetchMarketIndex,
  installFromMarket,
  isAutoCheckEnabled,
  marketAction,
  parseMarketIndex,
  readCachedUpdates,
  setAutoCheckEnabled,
  shouldCheckUpdates,
  writeCachedUpdates,
  MARKET_CHECK_TTL_MS,
  type MarketEntry,
} from '../src/kernel/market'

beforeEach(() => {
  mocks.invoke.mockReset()
  localStorage.clear()
})

const GOOD_SHA = 'a'.repeat(64)

function entry(patch: Partial<MarketEntry> = {}): MarketEntry {
  return {
    id: 'tag-panel',
    name: '标签面板',
    version: '0.2.0',
    url: 'https://example.com/tag-panel-0.2.0.znp',
    sha256: GOOD_SHA,
    ...patch,
  }
}

describe('parseMarketIndex', () => {
  it('正常索引：字段齐全的条目都能解析出来', () => {
    const raw = JSON.stringify({
      schema: 1,
      plugins: [
        { ...entry(), author: 'aqua7773', size: 24391, files: ['index.js'] },
        { ...entry({ id: 'habit', name: '打卡', version: '0.3.0' }) },
      ],
    })
    const r = parseMarketIndex(raw)
    expect(r.entries).toHaveLength(2)
    expect(r.skipped).toEqual([])
    expect(r.entries[0].author).toBe('aqua7773')
    expect(r.entries[0].size).toBe(24391)
    expect(r.entries[1].id).toBe('habit')
  })

  it('坏条目逐条跳过并记录原因，好条目照常出来', () => {
    const raw = JSON.stringify({
      plugins: [
        entry(),
        { ...entry({ id: 'no-sha', sha256: '' }) },
        { ...entry({ id: 'short-sha', sha256: 'abc' }) },
        { ...entry({ id: 'bad-url', url: 'file:///C:/x.znp' }) },
        { ...entry({ id: 'no-name', name: '' }) },
        entry(), // 与第一条重复
        { id: '' },
        'not-an-object',
      ],
    })
    const r = parseMarketIndex(raw)
    expect(r.entries.map((e) => e.id)).toEqual(['tag-panel'])
    const reasons = r.skipped.map((s) => `${s.id}:${s.reason}`)
    expect(reasons).toContain('no-sha:缺 sha256（或不是 64 位十六进制）')
    expect(reasons).toContain('short-sha:缺 sha256（或不是 64 位十六进制）')
    expect(reasons).toContain('bad-url:下载地址不是 http(s)')
    expect(reasons).toContain('no-name:缺 name 或 version')
    expect(reasons).toContain('tag-panel:重复条目')
    expect(reasons).toContain('?:不是对象')
    // 一条坏数据不该让整个市场空掉
    expect(r.entries.length).toBeGreaterThan(0)
  })

  it('顶层形状不对：直接报错（不是"空市场"）', () => {
    expect(() => parseMarketIndex('{ not json')).toThrow(/不是合法 JSON/)
    expect(() => parseMarketIndex('[]')).toThrow(/顶层应为对象/)
    expect(() => parseMarketIndex('{"schema":1}')).toThrow(/缺 plugins 数组/)
  })

  it('sha256 统一小写（索引里写大写也能比对）', () => {
    const r = parseMarketIndex(
      JSON.stringify({ plugins: [{ ...entry({ sha256: GOOD_SHA.toUpperCase() }) }] }),
    )
    expect(r.entries[0].sha256).toBe(GOOD_SHA)
  })
})

describe('marketAction', () => {
  it('没装 ⇒ install', () => {
    expect(marketAction(entry())).toBe('install')
  })

  it('数字段比版本：0.10.0 比 0.9.0 新（字符串比较会判反）', () => {
    expect(marketAction(entry({ version: '0.10.0' }), '0.9.0')).toBe('update')
    expect(marketAction(entry({ version: '0.9.0' }), '0.10.0')).toBe('installed')
  })

  it('同版本 / 本地更新 ⇒ installed', () => {
    expect(marketAction(entry({ version: '0.2.0' }), '0.2.0')).toBe('installed')
    expect(marketAction(entry({ version: '0.2.0' }), '0.3.0')).toBe('installed')
  })
})

describe('decodeBase64Utf8', () => {
  it('中文能正确还原（逐字节解码，不是 charCodeAt 直传）', () => {
    const text = '标签面板 · 中文没问题'
    const b64 = Buffer.from(text, 'utf8').toString('base64')
    expect(decodeBase64Utf8(b64)).toBe(text)
  })
})

/* ───────── 第二批 UX（rev173.156）：能力自述 / 更新判定 / 24h 节流 ───────── */

describe('parseMarketIndex：能力自述', () => {
  it('字符串数组原样带出（详情页与安装确认框要用）', () => {
    const r = parseMarketIndex(
      JSON.stringify({ plugins: [{ ...entry(), capabilities: ['doc:read', 'net'] }] }),
    )
    expect(r.entries[0].capabilities).toEqual(['doc:read', 'net'])
  })

  it('混进非字符串 / 空串时过滤掉，不影响整条', () => {
    const r = parseMarketIndex(
      JSON.stringify({ plugins: [{ ...entry(), capabilities: ['fs:read', 42, '', '  ', null] }] }),
    )
    expect(r.entries[0].capabilities).toEqual(['fs:read'])
  })

  it('没有这个字段 ⇒ undefined（老索引照样能读）', () => {
    const r = parseMarketIndex(JSON.stringify({ plugins: [entry()] }))
    expect(r.entries[0].capabilities).toBeUndefined()
  })
})

describe('computeUpdates', () => {
  const installed = [
    { id: 'tag-panel', version: '0.2.0' },
    { id: 'habit', version: '0.3.0' },
    { id: 'local-only', version: '1.0.0' },
  ]

  it('只返回「比本地新」的；同版本 / 本地更新 / 没装都不算', () => {
    const entries = [
      entry({ id: 'tag-panel', version: '0.2.1' }), // 可更新
      entry({ id: 'habit', version: '0.3.0' }), // 同版本
      entry({ id: 'history', version: '0.2.0' }), // 没装
    ]
    expect(computeUpdates(entries, installed)).toEqual({ 'tag-panel': '0.2.1' })
  })

  it('空索引 / 空已装 ⇒ 空对象（角标不出现）', () => {
    expect(computeUpdates([], installed)).toEqual({})
    expect(computeUpdates([entry()], [])).toEqual({})
  })

  it('数字段比较：0.10.0 > 0.9.0', () => {
    const updates = computeUpdates([entry({ id: 'tag-panel', version: '0.10.0' })], [
      { id: 'tag-panel', version: '0.9.0' },
    ])
    expect(updates).toEqual({ 'tag-panel': '0.10.0' })
  })
})

describe('shouldCheckUpdates：24h 节流', () => {
  const NOW = 1_000_000_000_000

  it('没记录 / 记录坏了 ⇒ 查', () => {
    expect(shouldCheckUpdates(null, NOW)).toBe(true)
    expect(shouldCheckUpdates(undefined, NOW)).toBe(true)
    expect(shouldCheckUpdates(0, NOW)).toBe(true)
    expect(shouldCheckUpdates(Number.NaN, NOW)).toBe(true)
  })

  it('24 小时内不查、超过就查（边界按 >= 算）', () => {
    expect(shouldCheckUpdates(NOW - 1000, NOW)).toBe(false)
    expect(shouldCheckUpdates(NOW - MARKET_CHECK_TTL_MS + 1, NOW)).toBe(false)
    expect(shouldCheckUpdates(NOW - MARKET_CHECK_TTL_MS, NOW)).toBe(true)
  })

  it('系统时间被调回（now < lastAt）⇒ 查，别变成「永远不查」', () => {
    expect(shouldCheckUpdates(NOW + 5_000, NOW)).toBe(true)
  })
})

describe('检查结论的缓存', () => {
  it('写入后能读回来（含时间戳）', () => {
    writeCachedUpdates(123, { 'tag-panel': '0.2.1' })
    expect(readCachedUpdates()).toEqual({ at: 123, updates: { 'tag-panel': '0.2.1' } })
  })

  it('缓存坏了 ⇒ 当成没记录，不炸', () => {
    localStorage.setItem('zn-market-updates', '{坏 JSON')
    localStorage.setItem('zn-market-check-at', 'abc')
    expect(readCachedUpdates()).toEqual({ at: null, updates: {} })
  })

  it('装完之后摘掉那一条（角标不该留着让人以为没更新成功）', () => {
    const next = clearCachedUpdate({ a: '1.0.0', b: '2.0.0' }, 'a')
    expect(next).toEqual({ b: '2.0.0' })
    // 不在表里 ⇒ 原样返回同一个对象（避免无意义的重渲染）
    expect(clearCachedUpdate(next, 'zzz')).toBe(next)
  })
})

describe('启动静默检查开关', () => {
  it('默认开；关掉后读得到关', () => {
    expect(isAutoCheckEnabled()).toBe(true)
    setAutoCheckEnabled(false)
    expect(isAutoCheckEnabled()).toBe(false)
    setAutoCheckEnabled(true)
    expect(isAutoCheckEnabled()).toBe(true)
  })
})

describe('fetchMarketIndex / installFromMarket', () => {
  it('fetch：状态码不是 200 ⇒ 报错并提示私有仓库', async () => {
    mocks.invoke.mockResolvedValue({ status: 404, headers: {}, body_b64: '' })
    await expect(fetchMarketIndex('https://example.com/index.json')).rejects.toThrow(
      /HTTP 404.*私有仓库/s,
    )
  })

  it('fetch：200 ⇒ 解码并解析', async () => {
    const body = JSON.stringify({ plugins: [entry()] })
    mocks.invoke.mockResolvedValue({
      status: 200,
      headers: {},
      body_b64: Buffer.from(body, 'utf8').toString('base64'),
    })
    const r = await fetchMarketIndex('https://example.com/index.json')
    expect(r.entries).toHaveLength(1)
    expect(mocks.invoke).toHaveBeenCalledWith('net_request', {
      req: { url: 'https://example.com/index.json', method: 'GET', timeoutMs: 20_000 },
    })
  })

  it('install：把 url 与整包 sha256 一起交给 Rust（校验在落盘同一侧）', async () => {
    mocks.invoke.mockResolvedValue('tag-panel')
    const id = await installFromMarket('C:/appdata', entry())
    expect(id).toBe('tag-panel')
    expect(mocks.invoke).toHaveBeenCalledWith('install_znp_from_url', {
      vault: 'C:/appdata',
      url: entry().url,
      expectedSha256: GOOD_SHA,
    })
  })
})
