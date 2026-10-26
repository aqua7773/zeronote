// @vitest-environment happy-dom
/**
 * 市场镜像（rev173.194）：镜像表 · 包地址改写 · 选择持久化 · 测速判定。
 *
 * 为什么单独一个文件：这些函数决定「列表能看但装不下来」会不会再发生 ——
 * 索引地址与包前缀必须**成对**切换（2026-10-27 手机实测 raw 被 RST，只换索引不换包 = 装不上）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (p: string) => p,
}))

import {
  CUSTOM_MIRROR_ID,
  MARKET_MIRRORS,
  MARKET_MIRROR_KEY,
  guessPackBase,
  installFromMarket,
  judgeMirrorProbe,
  loadMirror,
  mirrorPackUrl,
  probeMirror,
  saveMirror,
  type MarketEntry,
} from '../src/kernel/market'

const GOOD_SHA = 'a'.repeat(64)

const RAW_PACK_URL =
  'https://raw.githubusercontent.com/aqua7773/zeronote/main/market/packs/backup-0.3.1.znp'

function entry(patch: Partial<MarketEntry> = {}): MarketEntry {
  return {
    id: 'backup',
    name: '备份',
    version: '0.3.1',
    url: RAW_PACK_URL,
    sha256: GOOD_SHA,
    ...patch,
  }
}

function mirrorById(id: string) {
  const m = MARKET_MIRRORS.find((x) => x.id === id)
  if (!m) throw new Error(`没有镜像 ${id}`)
  return m
}

beforeEach(() => {
  localStorage.clear()
  mocks.invoke.mockReset()
})

describe('mirrorPackUrl', () => {
  it('raw 镜像原样拼回原地址', () => {
    expect(mirrorPackUrl(mirrorById('raw'), RAW_PACK_URL)).toBe(RAW_PACK_URL)
  })

  it('jsDelivr 换前缀（路径形态完全不同：gh/user/repo@ref）', () => {
    expect(mirrorPackUrl(mirrorById('jsdelivr-gcore'), RAW_PACK_URL)).toBe(
      'https://gcore.jsdelivr.net/gh/aqua7773/zeronote@main/market/packs/backup-0.3.1.znp',
    )
  })

  it('ghproxy 保留整条 raw 地址（它本身就是个前缀代理）', () => {
    expect(mirrorPackUrl(mirrorById('ghproxy'), RAW_PACK_URL)).toBe(
      'https://ghproxy.net/https://raw.githubusercontent.com/aqua7773/zeronote/main/market/packs/backup-0.3.1.znp',
    )
  })

  it('带 query 的地址只取文件名，query 丢掉', () => {
    const out = mirrorPackUrl(mirrorById('jsdelivr'), `${RAW_PACK_URL}?v=2`)
    expect(out).toContain('/market/packs/backup-0.3.1.znp')
    expect(out).not.toContain('?v=2')
  })

  it('不是 .znp 的地址原样返回（不瞎猜）', () => {
    expect(mirrorPackUrl(mirrorById('jsdelivr'), 'https://example.com/x.json')).toBe(
      'https://example.com/x.json',
    )
  })

  it('**外部作者 / 自建源**的 .znp 一律不改写（不能把人家的包搬到本仓库前缀下）', () => {
    const foreign = 'https://example.com/tag-panel-0.2.0.znp'
    for (const m of MARKET_MIRRORS) {
      expect(mirrorPackUrl(m, foreign)).toBe(foreign)
    }
    // 第三方 Release 同理
    const release = 'https://github.com/someone/repo/releases/download/v1/x-1.0.0.znp'
    expect(mirrorPackUrl(mirrorById('jsdelivr'), release)).toBe(release)
  })
})

describe('guessPackBase', () => {
  it('标准索引地址 → 仓库根', () => {
    expect(guessPackBase('https://cdn.jsdelivr.net/gh/a/b@main/market/index.json')).toBe(
      'https://cdn.jsdelivr.net/gh/a/b@main/',
    )
  })

  it('大小写不敏感', () => {
    expect(guessPackBase('https://x.com/a/MARKET/INDEX.JSON')).toBe('https://x.com/a/')
  })

  it('不是标准形态 → 只退到上级目录', () => {
    expect(guessPackBase('https://x.com/a/index.json')).toBe('https://x.com/a/')
  })
})

describe('loadMirror / saveMirror', () => {
  it('什么都没设 = 第一条（raw）', () => {
    expect(loadMirror().id).toBe(MARKET_MIRRORS[0].id)
  })

  it('存了内置 id 就取它（索引与包前缀都来自同一条）', () => {
    saveMirror(mirrorById('jsdelivr-gcore'))
    const m = loadMirror()
    expect(m.id).toBe('jsdelivr-gcore')
    expect(m.packBase).toContain('gcore.jsdelivr.net')
  })

  it('未知 id 回退默认', () => {
    localStorage.setItem(MARKET_MIRROR_KEY, 'nope')
    expect(loadMirror().id).toBe(MARKET_MIRRORS[0].id)
  })

  it('老字段里的自定义地址能读出来，包前缀跟着它走', () => {
    localStorage.setItem('zn-market-index-url', 'http://127.0.0.1:8934/market/index.json')
    const m = loadMirror()
    expect(m.id).toBe(CUSTOM_MIRROR_ID)
    expect(m.packBase).toBe('http://127.0.0.1:8934/')
  })

  it('保存自定义源会把地址写进老字段（兼容旧版本）', () => {
    saveMirror({
      id: CUSTOM_MIRROR_ID,
      label: '自定义',
      indexUrl: 'https://my.host/market/index.json',
      packBase: 'https://my.host/',
    })
    expect(localStorage.getItem('zn-market-index-url')).toBe('https://my.host/market/index.json')
    expect(loadMirror().id).toBe(CUSTOM_MIRROR_ID)
  })

  it('切回内置镜像不会抹掉自定义地址（切回来还在）', () => {
    saveMirror({
      id: CUSTOM_MIRROR_ID,
      label: '自定义',
      indexUrl: 'https://my.host/market/index.json',
      packBase: 'https://my.host/',
    })
    saveMirror(mirrorById('jsdelivr'))
    expect(loadMirror().id).toBe('jsdelivr')
    expect(localStorage.getItem('zn-market-index-url')).toBe('https://my.host/market/index.json')
  })
})

describe('judgeMirrorProbe', () => {
  it('200 + 有条目 = 可用', () => {
    expect(judgeMirrorProbe('x', 200, 16, 320)).toEqual({
      id: 'x',
      ok: true,
      ms: 320,
      detail: '16 条',
    })
  })

  it('200 但条目为 0 = 不可用（错误页会伪装成 200）', () => {
    expect(judgeMirrorProbe('x', 200, 0, 100).ok).toBe(false)
  })

  it('非 200 = 不可用且带状态码', () => {
    const r = judgeMirrorProbe('x', 404, 0, 50)
    expect(r.ok).toBe(false)
    expect(r.detail).toBe('HTTP 404')
  })
})

describe('probeMirror', () => {
  it('成功时用「解析出的条目数」当证据，不只看状态码', async () => {
    mocks.invoke.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body_b64: btoa(
        JSON.stringify({
          schema: 1,
          plugins: [
            {
              id: 'a',
              name: 'A',
              version: '1.0.0',
              url: 'https://x/a.znp',
              sha256: GOOD_SHA,
            },
          ],
        }),
      ),
    })
    const r = await probeMirror(mirrorById('jsdelivr'))
    expect(r.ok).toBe(true)
    expect(r.detail).toBe('1 条')
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })

  it('返回 200 但内容不是索引 → 不许判可用', async () => {
    mocks.invoke.mockResolvedValueOnce({
      status: 200,
      headers: {},
      body_b64: btoa('<html>blocked</html>'),
    })
    const r = await probeMirror(mirrorById('jsdelivr'))
    expect(r.ok).toBe(false)
  })

  it('RST 这类错误取源链最后一段（对用户最有信息量）', async () => {
    mocks.invoke.mockRejectedValueOnce(
      new Error(
        '连不上服务器：url —— error sending request ← client error (Connect) ← Connection reset by peer (os error 104)',
      ),
    )
    const r = await probeMirror(mirrorById('raw'))
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('Connection reset')
  })
})

describe('installFromMarket 走当前镜像', () => {
  it('默认（raw）时地址不变', async () => {
    mocks.invoke.mockResolvedValueOnce('backup')
    await installFromMarket('C:/vault', entry())
    expect(mocks.invoke).toHaveBeenCalledWith('install_znp_from_url', {
      vault: 'C:/vault',
      url: RAW_PACK_URL,
      expectedSha256: GOOD_SHA,
    })
  })

  it('选 jsDelivr 后包地址跟着换（这正是「能看不能装」的修法）', async () => {
    saveMirror(mirrorById('jsdelivr-gcore'))
    mocks.invoke.mockResolvedValueOnce('backup')
    await installFromMarket('C:/vault', entry())
    const arg = mocks.invoke.mock.calls[0][1] as { url: string }
    expect(arg.url).toBe(
      'https://gcore.jsdelivr.net/gh/aqua7773/zeronote@main/market/packs/backup-0.3.1.znp',
    )
  })
})
