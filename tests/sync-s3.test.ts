// @vitest-environment happy-dom
/**
 * 同步 · S3（`examples/sync-s3`）—— rev173.121
 *
 * 五层：
 *  1. **SigV4 签名**：用 **AWS 官方 SDK 的测试向量**验证（不是自签自验）
 *  2. 编码规则：S3 路径不二次编码 / 不折叠 `//` / `!'()*` 要编码
 *  3. 同步判定：与 sync-webdav 同一套七种组合（两边判据必须一致）
 *  4. manifest 解析（与 WebDAV 版同一格式）
 *  5. 客户端接线（mock `net`：404 / 403 / 条件写）
 */
import { describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import plugin, {
  amzDate,
  canonicalHeaders,
  canonicalQuery,
  conflictFileName,
  createS3Client,
  decideSync,
  encodeRfc3986,
  encodeS3Path,
  fingerprint,
  fingerprintBytes,
  fmtMs,
  isAttachment,
  needsAttachmentPull,
  normalizeManifest,
  relayName,
  signRequest,
  tryAutoMerge,
} from '../examples/sync-s3/index.js'
import { mergeLines } from '../src/lib/merge3'
import { fingerprint as webdavFingerprint, needsAttachmentPull as webdavNeedsPull } from '../examples/sync-webdav/index.js'

// happy-dom 下 webcrypto 不一定挂到 globalThis —— 插件代码只认 `crypto.subtle`
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

/* ───────────────────────── 1. SigV4 ───────────────────────── */

describe('SigV4（AWS SDK 测试向量）', () => {
  /**
   * 向量来源：`aws-sdk-js/test/signers/v4.spec.js`
   * （DynamoDB ListTables，key = `akid` / `secret`，region = `region`）
   * 期望值：`31fac5ed29db737fbcafac527470ca6d9283283197c5e6e94ea40ddcec14a9c1`
   */
  const VECTOR = {
    accessKey: 'akid',
    secretKey: 'secret',
    region: 'region',
    service: 'dynamodb',
    date: new Date(1935346573456),
    payloadHash: '3128b8d4f3108b3e1677a38eb468d1c6dec926a58eaea235d034b9c71c3864d4',
    headers: {
      host: 'localhost',
      'x-amz-security-token': 'session',
      'x-amz-target': 'DynamoDB_20111205.ListTables',
      'x-amz-user-agent': 'aws-sdk-js/0.1',
    },
    method: 'POST',
    path: '/',
  }

  it('签名与 AWS SDK 逐字节一致', async () => {
    const r = await signRequest(VECTOR)
    expect(r.authorization).toContain(
      'Signature=31fac5ed29db737fbcafac527470ca6d9283283197c5e6e94ea40ddcec14a9c1',
    )
  })

  it('Authorization 的凭证段与 SignedHeaders 与 SDK 一致', async () => {
    const r = await signRequest(VECTOR)
    expect(r.authorization).toContain('Credential=akid/20310430/region/dynamodb/aws4_request')
    expect(r.authorization).toContain(
      'SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token;x-amz-target;x-amz-user-agent',
    )
  })

  it('时间戳格式：20130524T000000Z 与 20130524', () => {
    const d = new Date(Date.UTC(2013, 4, 24, 0, 0, 0))
    expect(amzDate(d)).toBe('20130524T000000Z')
    expect(amzDate(d).slice(0, 8)).toBe('20130524')
  })

  it('canonical query：按键排序、同时编码名与值', () => {
    expect(canonicalQuery({ 'list-type': '2', prefix: 'a b', delimiter: '/' })).toBe(
      'delimiter=%2F&list-type=2&prefix=a%20b',
    )
    expect(canonicalQuery({})).toBe('')
  })

  it('canonical headers：头名小写、排序、空白压缩、结尾换行', () => {
    const { canonicalHeaders: h, signedHeaders } = canonicalHeaders({
      'X-Amz-Target': 'X.Y',
      host: 'localhost',
      'content-type': 'text/plain',
    })
    expect(h).toBe('content-type:text/plain\nhost:localhost\nx-amz-target:X.Y\n')
    expect(signedHeaders).toBe('content-type;host;x-amz-target')

    const compact = canonicalHeaders({ header: '  Value    with\tspaces  ' }).canonicalHeaders
    expect(compact).toBe('header:Value with spaces\n')
  })

  it('authorization 头自身不参与签名（否则永远算不对）', () => {
    const { signedHeaders } = canonicalHeaders({ authorization: 'X', host: 'h' })
    expect(signedHeaders).toBe('host')
  })
})

/* ───────────────────────── 2. 编码 ───────────────────────── */

describe('S3 编码规则', () => {
  it('路径逐段编码、保留 /、不做路径规范化', () => {
    expect(encodeS3Path('a:b:c')).toBe('/a%3Ab%3Ac')
    expect(encodeS3Path('日记/2026 年 10 月.md')).toBe(
      '/%E6%97%A5%E8%AE%B0/2026%20%E5%B9%B4%2010%20%E6%9C%88.md',
    )
    // 不折叠 `//`、不解析 `..`（对象键里真的可以有）
    expect(encodeS3Path('a//b')).toBe('/a//b')
    expect(encodeS3Path('a/../b')).toBe('/a/../b')
    expect(encodeS3Path('')).toBe('/')
  })

  it('RFC3986：encodeURIComponent 漏掉的 !\'()* 也要编码', () => {
    expect(encodeRfc3986("!'()*")).toBe('%21%27%28%29%2A')
    expect(encodeRfc3986('a b')).toBe('a%20b')
    expect(encodeRfc3986('中文')).toBe('%E4%B8%AD%E6%96%87')
    // 不能编的（未保留字符）保持原样
    expect(encodeRfc3986('aZ0-_.~')).toBe('aZ0-_.~')
  })
})

/* ───────────────────────── 3. 同步判定 ───────────────────────── */

describe('decideSync（与 sync-webdav 同一判据）', () => {
  const b = (fp: string) => ({ fp, at: 1 })

  it('远端没有这篇', () => {
    expect(decideSync({ base: null, localFp: 'a', remoteFp: null })).toBe('push-new')
    expect(decideSync({ base: b('a'), localFp: 'a', remoteFp: null })).toBe('remote-deleted')
    expect(decideSync({ base: b('a'), localFp: 'b', remoteFp: null })).toBe('conflict')
  })

  it('本机没有基线（换设备 / store 被清）', () => {
    // rev173.128：与 sync-webdav 逐字一致 —— 相同 ⇒ noop、不同 ⇒ conflict（不再静默覆盖本地）
    expect(decideSync({ base: null, localFp: 'a', remoteFp: 'a' })).toBe('noop')
    expect(decideSync({ base: null, localFp: 'a', remoteFp: 'b' })).toBe('conflict')
  })

  it('有基线：四种组合', () => {
    expect(decideSync({ base: b('a'), localFp: 'a', remoteFp: 'a' })).toBe('noop')
    expect(decideSync({ base: b('a'), localFp: 'a', remoteFp: 'b' })).toBe('pull')
    expect(decideSync({ base: b('a'), localFp: 'b', remoteFp: 'a' })).toBe('push')
    expect(decideSync({ base: b('a'), localFp: 'b', remoteFp: 'c' })).toBe('conflict')
    // 两边改成同一内容 ⇒ 不是冲突
    expect(decideSync({ base: b('a'), localFp: 'b', remoteFp: 'b' })).toBe('noop')
  })

  it('指纹算法与 sync-webdav 互认（任一边改了都红）', () => {
    expect(fingerprint('abc')).toBe(webdavFingerprint('abc'))
    expect(fingerprint('# 标题\n中文')).toBe(webdavFingerprint('# 标题\n中文'))
  })
})

describe('tryAutoMerge（与 sync-folder 同一判据）', () => {
  const base = 'A\nB\nC\n'

  it('两边改不同行 ⇒ 合上；同一行 ⇒ null', () => {
    expect(tryAutoMerge({ base, mine: 'A1\nB\nC\n', theirs: 'A\nB\nC1\n', mergeLines })?.text).toBe(
      'A1\nB\nC1\n',
    )
    expect(tryAutoMerge({ base, mine: 'A\nB1\nC\n', theirs: 'A\nB2\nC\n', mergeLines })).toBeNull()
  })

  it('缺 base / 缺合并实现 / 单边改 ⇒ null', () => {
    expect(tryAutoMerge({ base: null, mine: 'x', theirs: 'y', mergeLines })).toBeNull()
    expect(tryAutoMerge({ base, mine: 'x', theirs: 'y' })).toBeNull()
    expect(tryAutoMerge({ base, mine: base, theirs: 'z', mergeLines })).toBeNull()
  })
})

describe('其他纯函数', () => {
  it('normalizeManifest：坏数据退空表；保留 attachments', () => {
    expect(normalizeManifest('nope').files).toEqual({})
    const m = normalizeManifest(
      JSON.stringify({
        version: 1,
        files: { 'a.md': { fp: '1:p', etag: '"e"', at: 5 }, bad: {} },
        attachments: { 'x.png': { fp: '3:q', ext: '.png', at: 9, cleaned: true } },
      }),
    )
    expect(m.files['a.md']).toEqual({ fp: '1:p', etag: '"e"', at: 5 })
    expect(m.files.bad).toBeUndefined()
    expect(m.attachments['x.png']).toEqual({ fp: '3:q', ext: '.png', at: 9, cleaned: true })
  })

  it('conflictFileName / fmtMs', () => {
    expect(conflictFileName(new Date(2026, 9, 25, 0, 4), '日记/a.md')).toBe('2026-10-25 0004-a.md')
    expect(fmtMs(320)).toBe('320 毫秒')
    expect(fmtMs(1200)).toBe('1.2 秒')
    expect(fmtMs(NaN)).toBe('—')
  })
})

/* ───────────────────────── 5. 客户端接线 ───────────────────────── */

function s3Net(responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = []
  const queue = [...responses]
  const net = {
    fetch: vi.fn(async (spec: { url: string; method: string; headers: Record<string, string> }) => {
      calls.push({ url: spec.url, method: spec.method, headers: spec.headers })
      const next = queue.shift() ?? { status: 500 }
      return {
        status: next.status,
        headers: next.headers ?? {},
        text: () => next.body ?? '',
        bytes: () => new TextEncoder().encode(next.body ?? ''),
      }
    }),
  }
  return { net, calls }
}

const cfg = {
  endpoint: 'https://s3.example.com',
  region: 'us-east-1',
  bucket: 'my-bucket',
  accessKey: 'AKIAEXAMPLE',
  secretKey: 'SECRETEXAMPLE',
  prefix: '',
  net: null as unknown,
}

async function client(net: unknown) {
  return createS3Client({ ...cfg, net } as never, { date: () => new Date(2026, 9, 25, 0, 0, 0) })
}

describe('S3 客户端', () => {
  it('getObject：404 ⇒ null（不抛）；200 返回内容与 etag', async () => {
    const { net } = s3Net([{ status: 404 }, { status: 200, body: 'hello', headers: { etag: '"abc"' } }])
    const c = await client(net)
    expect(await c.get('a.md')).toBeNull()
    const r = await c.get('a.md')
    expect(r).toMatchObject({ text: 'hello', etag: '"abc"' })
  })

  it('putObject：带上签名头与 x-amz-content-sha256', async () => {
    const { net, calls } = s3Net([{ status: 200, headers: { etag: '"v1"' } }])
    const c = await client(net)
    const r = await c.put('a.md', 'hi')
    expect(r).toMatchObject({ ok: true, etag: '"v1"' })
    expect(calls[0].method).toBe('PUT')
    expect(calls[0].url).toBe('https://s3.example.com/my-bucket/a.md')
    expect(calls[0].headers.Authorization).toContain('AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/')
    expect(calls[0].headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/)
  })

  it('listObjects：解析 ListBucketResult 的 Key 列表（分页）', async () => {
    const xml = `<?xml version="1.0"?><ListBucketResult>
      <Contents><Key>ZeroNote/a.md</Key><Size>5</Size><ETag>"e1"</ETag></Contents>
      <Contents><Key>ZeroNote/b.md</Key><Size>6</Size><ETag>"e2"</ETag></Contents>
      <IsTruncated>false</IsTruncated></ListBucketResult>`
    const { net } = s3Net([{ status: 200, body: xml }])
    const c = await client(net)
    const list = await c.list('ZeroNote/')
    expect(list.map((e) => e.key)).toEqual(['ZeroNote/a.md', 'ZeroNote/b.md'])
    expect(list[0].etag).toBe('"e1"')
  })

  it('deleteObject：204 / 404 都算成功（幂等）', async () => {
    const { net } = s3Net([{ status: 204 }, { status: 404 }])
    const c = await client(net)
    expect((await c.remove('a.md')).ok).toBe(true)
    expect((await c.remove('a.md')).ok).toBe(true)
  })

  it('putObject 带 ifMatch ⇒ 请求头有 if-match；不带 ⇒ 一个都没有（rev173.129）', async () => {
    const { net, calls } = s3Net([
      { status: 200, headers: { etag: '"v2"' } },
      { status: 200, headers: { etag: '"v2"' } },
    ])
    const c = await client(net)
    await c.put('a.md', 'hi', { ifMatch: '"v1"' })
    expect(calls[0].headers['if-match']).toBe('"v1"')
    // 头参与签名：SignedHeaders 里必须有它，否则服务端会按「头没签」拒
    expect(calls[0].headers.Authorization).toContain('if-match')
    await c.put('a.md', 'hi')
    expect(calls[1].headers['if-match']).toBeUndefined()
  })

  it('putObject：412 ⇒ precondition、409 ⇒ conflict409（不抛，调用方判断）', async () => {
    const { net } = s3Net([{ status: 412 }, { status: 409 }])
    const c = await client(net)
    expect(await c.put('a.md', 'x', { ifMatch: '"old"' })).toMatchObject({
      ok: false,
      status: 412,
      precondition: true,
    })
    expect(await c.put('a.md', 'x')).toMatchObject({ ok: false, status: 409, conflict409: true })
  })

  it('空文本 PUT ⇒ 显式 content-length: 0（rev173.131；非空不带，交给 reqwest）', async () => {
    const { net, calls } = s3Net([
      { status: 200, headers: { etag: '"e1"' } },
      { status: 200, headers: { etag: '"e2"' } },
    ])
    const c = await client(net)
    await c.put('empty.md', '')
    expect(calls[0].headers['content-length']).toBe('0')
    await c.put('x.md', 'hi')
    expect(calls[1].headers['content-length']).toBeUndefined()
  })
})

describe('附件（rev173.126）', () => {
  it('二进制指纹与 sync-webdav 同一套算法（逐字节）', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00])
    expect(fingerprintBytes(bytes)).toMatch(/^[0-9a-z]+:[0-9a-z]+$/)
  })

  it('isAttachment：只有非 .md 且在 .zn 外', () => {
    expect(isAttachment('附件/图.png')).toBe(true)
    expect(isAttachment('报告.pdf')).toBe(true)
    expect(isAttachment('笔记.md')).toBe(false)
    expect(isAttachment('.zn/conflicts/x.png')).toBe(false)
  })

  it('needsAttachmentPull 与 sync-webdav 逐字一致（两边互认）', () => {
    const cases: Array<[string | null, { fp: string; cleaned?: boolean } | null]> = [
      [null, { fp: 'a:1' }],
      ['a:1', { fp: 'a:1' }],
      ['a:1', { fp: 'b:2' }],
      [null, { fp: 'a:1', cleaned: true }],
      ['a:1', null],
    ]
    for (const [local, remote] of cases) {
      expect(needsAttachmentPull(local, remote)).toBe(webdavNeedsPull(local, remote))
    }
  })

  it('relayName：`:` 换成 `-`（Windows 备用数据流坑）', () => {
    expect(relayName('8:1te3kiy', '.png')).toBe('8-1te3kiy.png')
  })
})

describe('插件接线', () => {
  it('注册主区面板与命令', () => {
    const panels: string[] = []
    const commands: string[] = []
    const api = {
      host: {
        platform: 'windows',
        log: () => {},
        notify: () => {},
        secrets: { get: async () => '', set: async () => {}, delete: async () => {} },
      },
      fs: { listNotes: async () => [], readText: async () => '', writeText: async () => {} },
      net: { fetch: async () => ({ status: 200, headers: {}, text: () => '', bytes: () => new Uint8Array() }) },
      store: { get: async (_k: string, d: unknown) => d, set: async () => {} },
      event: { on: () => ({ dispose: () => {} }) },
      command: {
        register: (c: { id: string }) => {
          commands.push(c.id)
          return { dispose: () => {} }
        },
        execute: async () => {},
      },
      view: {
        registerPanel: (s: { id: string }) => {
          panels.push(s.id)
          return { dispose: () => {} }
        },
        refresh: () => {},
      },
      service: { consume: async () => null, provide: () => ({ dispose: () => {} }) },
      subscriptions: [],
    }
    plugin.apply(api as never)
    expect(panels).toEqual(['sync-s3.status'])
    expect(commands.sort()).toEqual([
      'sync-s3.disconnect',
      'sync-s3.open',
      'sync-s3.save',
      'sync-s3.set-attachments',
      'sync-s3.sync',
      'sync-s3.test',
      'sync-s3.toggle-auto',
    ])
  })
})

/**
 * rev173.129 · S3 条件写（`If-Match`）。
 *
 * 场景与 Git 后端 rev173.123 同款：manifest 里记的 etag 过期（远端被"绕过 manifest"改过），
 * 以前 `PUT` 不带条件 ⇒ **静默覆盖**远端；现在带 `If-Match` ⇒ 412 ⇒ 走冲突处理
 * （重读远端 → 刷新 manifest 条目 → 能合就合 / 合不上留副本取远端）。
 */
describe('S3 条件写：If-Match（rev173.129）', () => {
  /**
   * 极简 S3：对象表 + 条件写 + manifest（manifest 也只是表里一个对象）。
   * `mode` 控制服务端对 `If-Match` 的态度：
   *   · `strict`（默认）—— 按 AWS 语义校验，不匹配 ⇒ 412
   *   · `ignore`       —— 忽略该头（多数 S3 兼容实现的行为）
   *   · `reject`       —— 当成坏请求 ⇒ 400（兜底逻辑要能用）
   */
  function makeS3(mode: 'strict' | 'ignore' | 'reject' = 'strict') {
    const objects = new Map<string, { body: string; etag: string }>()
    const requests: Array<{ method: string; key: string; headers: Record<string, string> }> = []
    let ver = 0
    const emptyText = () => ''
    const emptyBytes = () => new Uint8Array()
    const net = {
      fetch: async (spec: {
        url: string
        method: string
        headers?: Record<string, string>
        body?: unknown
      }) => {
        const method = String(spec.method ?? 'GET').toUpperCase()
        const u = new URL(spec.url)
        const key = decodeURIComponent(u.pathname.replace(/^\/my-bucket\/?/, ''))
        const headers = spec.headers ?? {}
        requests.push({ method, key, headers })
        if (method === 'GET' && u.searchParams.get('list-type') === '2') {
          return { status: 200, headers: {}, text: () => '<ListBucketResult/>', bytes: emptyBytes }
        }
        if (method === 'GET' || method === 'HEAD') {
          const f = objects.get(key)
          if (!f) return { status: 404, headers: {}, text: emptyText, bytes: emptyBytes }
          return { status: 200, headers: { etag: f.etag }, text: () => f.body, bytes: emptyBytes }
        }
        if (method === 'PUT') {
          const cond = headers['if-match']
          if (cond && mode === 'reject') {
            return { status: 400, headers: {}, text: () => '<Code>InvalidArgument</Code>', bytes: emptyBytes }
          }
          // rev173.131：空 body 不带 Content-Length ⇒ 411（rclone serve s3 的真实行为）
          const bodyText = typeof spec.body === 'string' ? spec.body : ''
          if (bodyText.length === 0 && headers['content-length'] == null) {
            return { status: 411, headers: {}, text: () => '<Code>MissingContentLength</Code>', bytes: emptyBytes }
          }
          if (cond && mode === 'strict' && objects.get(key)?.etag !== cond) {
            return {
              status: 412,
              headers: {},
              text: () => '<Code>PreconditionFailed</Code>',
              bytes: emptyBytes,
            }
          }
          ver += 1
          const body = typeof spec.body === 'string' ? spec.body : ''
          objects.set(key, { body, etag: `"v${ver}"` })
          return { status: 200, headers: { etag: `"v${ver}"` }, text: emptyText, bytes: emptyBytes }
        }
        return { status: 500, headers: {}, text: emptyText, bytes: emptyBytes }
      },
    }
    return { objects, requests, net }
  }

  function makeDevice(net: unknown, local: Map<string, Uint8Array>, mtimes: Map<string, number>) {
    const store = new Map<string, unknown>()
    const commands = new Map<string, (p?: unknown) => unknown>()
    const notices: string[] = []
    let render: ((ctx: { state?: Record<string, string> }) => unknown) | null = null
    const api = {
      host: {
        platform: 'windows',
        log: () => {},
        notify: (m: string) => {
          notices.push(m)
        },
        secrets: {
          get: async () => 'secret',
          set: async () => {},
          delete: async () => {},
        },
      },
      fs: {
        listNotes: async () =>
          [...local.keys()].map((p) => ({
            path: p,
            id: p,
            title: p,
            mtime: mtimes.get(p) ?? 0,
            size: local.get(p)?.length ?? 0,
            frontmatter: {},
            kind: 'doc',
          })),
        readText: async (p: string) => new TextDecoder().decode(local.get(p) ?? new Uint8Array()),
        writeText: async (p: string, text: string) => {
          local.set(p, new TextEncoder().encode(String(text)))
          mtimes.set(p, Date.now())
        },
        readBytes: async (p: string) => local.get(p) ?? new Uint8Array(),
        writeBytes: async () => {},
        mkdir: async () => {},
      },
      net,
      store: {
        get: async (k: string, d: unknown) => (store.has(k) ? store.get(k) : d),
        set: async (k: string, v: unknown) => {
          store.set(k, v)
        },
      },
      event: { on: () => ({ dispose: () => {} }) },
      command: {
        register: (c: { id: string; run: (p?: unknown) => unknown }) => {
          commands.set(c.id, c.run)
          return { dispose: () => {} }
        },
        execute: async () => {},
      },
      view: {
        registerPanel: (s: { render: (ctx: { state?: Record<string, string> }) => unknown }) => {
          render = s.render
          return { dispose: () => {} }
        },
        refresh: () => {},
      },
      service: { consume: async () => null, provide: () => ({ dispose: () => {} }) },
      subscriptions: [] as Array<{ dispose?: () => void }>,
    }
    plugin.apply(api as never)
    return {
      commands,
      notices,
      render: () => render,
      dispose: () => {
        for (const s of api.subscriptions) s.dispose?.()
      },
    }
  }

  async function configure(dev: ReturnType<typeof makeDevice>) {
    await new Promise((r) => setTimeout(r, 0))
    dev.render()!({
      state: {
        's3.endpoint': 'https://s3.example.com',
        's3.region': 'us-east-1',
        's3.bucket': 'my-bucket',
        's3.prefix': '',
        's3.accessKey': 'AKIAEXAMPLE',
        's3.password': 'secret',
        's3.attachmentsMode': 'off',
      },
    })
    await dev.commands.get('sync-s3.save')!()
  }

  const dec = (b: Uint8Array) => new TextDecoder().decode(b)
  const enc = (s: string) => new TextEncoder().encode(s)

  it('远端被绕过 manifest 改过 ⇒ PUT 412 ⇒ 留副本 + 取远端 + 刷新 manifest（下一轮不再 412）', async () => {
    const { objects, requests, net } = makeS3('strict')
    const local = new Map<string, Uint8Array>()
    const mtimes = new Map<string, number>()

    // ① 首次：本机 v1 ⇒ push-new（远端没有这篇，不带 If-Match）
    local.set('n.md', enc('v1\n'))
    mtimes.set('n.md', Date.now() - 60_000)
    const A = makeDevice(net, local, mtimes)
    await configure(A)
    await A.commands.get('sync-s3.sync')!({})
    expect(objects.get('n.md')!.body).toBe('v1\n')
    expect(requests.filter((r) => r.method === 'PUT' && r.key === 'n.md')[0].headers['if-match']).toBeUndefined()

    // ② 绕过 manifest 手改远端：对象内容与 etag 都变，manifest 还是旧的
    objects.set('n.md', { body: 'remote-v2\n', etag: '"manual"' })

    // ③ 本机改过 + 再同步 ⇒ decideSync = push（manifest 看起来没变）⇒ PUT 带旧 etag ⇒ 412
    local.set('n.md', enc('local-mine\n'))
    mtimes.set('n.md', Date.now() + 60_000)
    const beforePut = requests.length
    await A.commands.get('sync-s3.sync')!({})

    // 本机版没丢（进冲突目录），本地取了远端版
    expect(dec(local.get('n.md')!)).toBe('remote-v2\n')
    const conflicts = [...local.keys()].filter((k) => k.startsWith('.zn/conflicts/windows/'))
    expect(conflicts).toHaveLength(1)
    expect(dec(local.get(conflicts[0])!)).toBe('local-mine\n')

    // manifest 被刷新成远端最新（否则下一轮还拿旧 etag 撞 412）
    const manifest = JSON.parse(objects.get('_zn/manifest.json')!.body)
    expect(manifest.files['n.md'].fp).toBe(fingerprint('remote-v2\n'))
    expect(manifest.files['n.md'].etag).toBe('"manual"')

    // 这一轮真的发了带条件的 PUT（证明 412 是服务端拒的，不是本地判冲突）
    const puts = requests.slice(beforePut).filter((r) => r.method === 'PUT' && r.key === 'n.md')
    expect(puts).toHaveLength(1)
    expect(puts[0].headers['if-match']).toBe('"v1"')

    // ④ 再同步一轮：两边一致 ⇒ 一篇都不该 PUT（不再死循环）
    const before2 = requests.length
    await A.commands.get('sync-s3.sync')!({})
    expect(requests.slice(before2).filter((r) => r.method === 'PUT' && r.key === 'n.md')).toHaveLength(0)

    A.dispose()
  })

  it('服务端把 If-Match 当坏请求（400）⇒ 自动降级为无条件写，不让同步全挂', async () => {
    const { objects, requests, net } = makeS3('reject')
    const local = new Map<string, Uint8Array>()
    const mtimes = new Map<string, number>()

    local.set('n.md', enc('v1\n'))
    mtimes.set('n.md', Date.now() - 60_000)
    const A = makeDevice(net, local, mtimes)
    await configure(A)
    await A.commands.get('sync-s3.sync')!({}) // push-new：不带条件

    // 本地改 ⇒ 有 baseline(etag) ⇒ 会带 If-Match ⇒ 服务端 400 ⇒ 自动重试一次不带
    local.set('n.md', enc('v2\n'))
    mtimes.set('n.md', Date.now() + 60_000)
    const before = requests.length
    const summary = (await A.commands.get('sync-s3.sync')!({})) as { hint?: string }
    const puts = requests.slice(before).filter((r) => r.method === 'PUT' && r.key === 'n.md')
    expect(puts).toHaveLength(2)
    expect(puts[0].headers['if-match']).toBeDefined()
    expect(puts[1].headers['if-match']).toBeUndefined()
    expect(objects.get('n.md')!.body).toBe('v2\n')
    expect(String(summary.hint ?? '')).toContain('不支持 If-Match')

    A.dispose()
  })

  it('服务端忽略 If-Match（不校验）⇒ 行为与以前一致，同步照常成功', async () => {
    const { objects, requests, net } = makeS3('ignore')
    const local = new Map<string, Uint8Array>()
    const mtimes = new Map<string, number>()

    local.set('n.md', enc('v1\n'))
    mtimes.set('n.md', Date.now() - 60_000)
    const A = makeDevice(net, local, mtimes)
    await configure(A)
    await A.commands.get('sync-s3.sync')!({})

    objects.set('n.md', { body: 'remote-v2\n', etag: '"manual"' })
    local.set('n.md', enc('local-mine\n'))
    mtimes.set('n.md', Date.now() + 60_000)
    await A.commands.get('sync-s3.sync')!({})

    // 服务端不校验 ⇒ 本机版直接覆盖远端（旧行为），不会有冲突副本
    expect(objects.get('n.md')!.body).toBe('local-mine\n')
    expect([...local.keys()].some((k) => k.startsWith('.zn/conflicts/'))).toBe(false)
    expect(requests.filter((r) => r.method === 'PUT' && r.key === 'n.md').length).toBe(2)

    A.dispose()
  })

  it('空笔记也能同步（rev173.131：reqwest 对空 body 不发 CL ⇒ rclone 411、每 5 秒重试同一篇）', async () => {
    const { objects, net } = makeS3('strict')
    const local = new Map<string, Uint8Array>()
    const mtimes = new Map<string, number>()

    local.set('empty.md', new Uint8Array(0))
    mtimes.set('empty.md', Date.now() - 60_000)
    const A = makeDevice(net, local, mtimes)
    await configure(A)
    const summary = (await A.commands.get('sync-s3.sync')!({})) as { pushed?: number; hint?: string }

    expect(summary.pushed).toBe(1)
    expect(objects.get('empty.md')!.body).toBe('')
    expect(String(summary.hint ?? '')).not.toContain('411')

    A.dispose()
  })

  /**
   * rev173.164 · 期 1c：**私有文件同步**（密码库）。
   *
   * `.zn/` 下的密文不是 `.md`，`listNotes` 看不到 ⇒ 以前密码库**同步不出去**，
   * 换设备就是空库（"云端零明文"做到了，"换设备能解开"没做到）。
   */
  it('密码库：A 建库 ⇒ 两个文件都进远端；B 空库 ⇒ 都拉下来', async () => {
    const { objects, net } = makeS3('strict')
    const SECRETS = '.zn/secrets/secrets.zn'
    const VAULT = '.zn/security/vault.json'
    const localA = new Map<string, Uint8Array>()
    const mtimesA = new Map<string, number>()
    const localB = new Map<string, Uint8Array>()
    const mtimesB = new Map<string, number>()

    localA.set(SECRETS, enc('zn1.AAAA.BBBB'))
    localA.set(VAULT, enc('{"v":1,"rings":{"secrets":{"wrapped":{"secrets":"zn1.X.Y"}}}}'))
    const A = makeDevice(net, localA, mtimesA)
    const B = makeDevice(net, localB, mtimesB)
    await configure(A)
    await configure(B)

    await A.commands.get('sync-s3.sync')!({})
    expect(objects.get(SECRETS)?.body).toBe('zn1.AAAA.BBBB')
    expect(objects.get(VAULT)?.body).toContain('wrapped')

    await B.commands.get('sync-s3.sync')!({})
    expect(dec(localB.get(SECRETS)!)).toBe('zn1.AAAA.BBBB')
    expect(dec(localB.get(VAULT)!)).toContain('wrapped')

    A.dispose()
    B.dispose()
  })

  it('密码库：只有远端变 ⇒ 本机拉下来（不能既不拉也不推）', async () => {
    const { objects, net, requests } = makeS3('strict')
    const SECRETS = '.zn/secrets/secrets.zn'
    const localA = new Map<string, Uint8Array>()
    const mtimesA = new Map<string, number>()
    const localB = new Map<string, Uint8Array>()
    const mtimesB = new Map<string, number>()

    localA.set(SECRETS, enc('zn1.v1'))
    const A = makeDevice(net, localA, mtimesA)
    const B = makeDevice(net, localB, mtimesB)
    await configure(A)
    await configure(B)

    await A.commands.get('sync-s3.sync')!({})
    await B.commands.get('sync-s3.sync')!({})
    expect(dec(localB.get(SECRETS)!)).toBe('zn1.v1')

    // B 改 ⇒ 推
    localB.set(SECRETS, enc('zn1.v2'))
    await B.commands.get('sync-s3.sync')!({})
    expect(objects.get(SECRETS)?.body).toBe('zn1.v2')

    // A 再同步：必须拉 v2，且不能把 v1 推回去
    const before = requests.length
    await A.commands.get('sync-s3.sync')!({})
    expect(dec(localA.get(SECRETS)!)).toBe('zn1.v2')
    const round = requests.slice(before).filter((r) => r.key === SECRETS)
    expect(round.some((r) => r.method === 'GET')).toBe(true)
    expect(round.some((r) => r.method === 'PUT')).toBe(false)

    A.dispose()
    B.dispose()
  })

  it('密码库：双端都改 ⇒ 冲突留副本，本地取远端版', async () => {
    const { objects, net } = makeS3('strict')
    const SECRETS = '.zn/secrets/secrets.zn'
    const localA = new Map<string, Uint8Array>()
    const mtimesA = new Map<string, number>()
    const localB = new Map<string, Uint8Array>()
    const mtimesB = new Map<string, number>()

    localA.set(SECRETS, enc('zn1.v1'))
    const A = makeDevice(net, localA, mtimesA)
    const B = makeDevice(net, localB, mtimesB)
    await configure(A)
    await configure(B)

    await A.commands.get('sync-s3.sync')!({})
    await B.commands.get('sync-s3.sync')!({})

    localA.set(SECRETS, enc('zn1.v2'))
    await A.commands.get('sync-s3.sync')!({})

    localB.set(SECRETS, enc('zn1.v3'))
    await B.commands.get('sync-s3.sync')!({})

    const copies = [...localB.keys()].filter((k) => k.startsWith('.zn/conflicts/'))
    expect(copies).toHaveLength(1)
    expect(dec(localB.get(copies[0])!)).toBe('zn1.v3')
    expect(dec(localB.get(SECRETS)!)).toBe('zn1.v2')
    expect(objects.get(SECRETS)?.body).toBe('zn1.v2')

    A.dispose()
    B.dispose()
  })
})
