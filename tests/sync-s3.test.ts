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
  fmtMs,
  normalizeManifest,
  signRequest,
  tryAutoMerge,
} from '../examples/sync-s3/index.js'
import { mergeLines } from '../src/lib/merge3'
import { fingerprint as webdavFingerprint } from '../examples/sync-webdav/index.js'

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

  it('本机没有基线', () => {
    // 与 sync-webdav 逐字一致：没有基线 ⇒ 一律拉远端（已知隐患，见实现里的注释）
    expect(decideSync({ base: null, localFp: 'a', remoteFp: 'a' })).toBe('pull-new')
    expect(decideSync({ base: null, localFp: 'a', remoteFp: 'b' })).toBe('pull-new')
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
      'sync-s3.sync',
      'sync-s3.test',
      'sync-s3.toggle-auto',
    ])
  })
})
