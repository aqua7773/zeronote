// @vitest-environment happy-dom
/**
 * 同步 · Git（`examples/sync-git`）—— rev173.122
 *
 * 六层：
 *  1. base64 往返（**中文 / 大文件换行** —— 这两个是最容易崩的地方）
 *  2. 路径编码 / 与另外三个同步插件的判据一致性
 *  3. Contents 响应解析（形状照**真实 GitHub 响应**写，见文件头注释）
 *  4. 客户端接线（mock `net`：404 / 200 / PUT 带 sha / 409 冲突 / DELETE）
 *  5. 插件接线（面板 + 七条命令）
 */
import { describe, expect, it, vi } from 'vitest'
import plugin, {
  PROVIDERS,
  b64decode,
  b64decodeBytes,
  b64encode,
  b64encodeBytes,
  conflictFileName,
  createGitClient,
  decideSync,
  encodeGitPath,
  fingerprint,
  fingerprintBytes,
  fmtMs,
  isAttachment,
  needsAttachmentPull,
  normalizeManifest,
  parseContents,
  relayName,
  tryAutoMerge,
} from '../examples/sync-git/index.js'
import { mergeLines } from '../src/lib/merge3'
import { fingerprint as s3Fingerprint, fingerprintBytes as s3FingerprintBytes } from '../examples/sync-s3/index.js'
import { fingerprint as webdavFingerprint } from '../examples/sync-webdav/index.js'

describe('base64（UTF-8 安全）', () => {
  it('中文往返不炸（btoa 直编会 InvalidCharacterError）', () => {
    const text = '# 标题\n这是中文内容 🎉'
    expect(b64decode(b64encode(text))).toBe(text)
  })

  it('解码前剥掉换行（平台返回的大文件 base64 每 60 字符插 \\n）', () => {
    const raw = b64encode('hello world')
    const wrapped = `${raw.slice(0, 5)}\n${raw.slice(5)}\n`
    expect(b64decode(wrapped)).toBe('hello world')
  })

  it('空串往返', () => {
    expect(b64decode(b64encode(''))).toBe('')
  })
})

/**
 * rev173.126 · 附件（二进制）相关的纯函数。
 *
 * 附件与 `.md` 走同一套 manifest 指纹，但**字节级**：拿 UTF-16 码元算的 `fingerprint` 会
 * 把两张不同的图算成同一个指纹（PNG 里大量非 ASCII 字节），所以必须逐字节。
 */
describe('附件（rev173.126）', () => {
  it('字节 base64 往返：任意二进制不被 UTF-8 改写', () => {
    const bytes = Uint8Array.from([0, 1, 2, 0xff, 0x80, 0x7f, 0x0a, 0x0d, 0xc3, 0x28])
    expect(Array.from(b64decodeBytes(b64encodeBytes(bytes)))).toEqual(Array.from(bytes))
  })

  it('字节 base64：中文 UTF-8 字节串与文本编码结果一致', () => {
    const text = '图片存档 📷'
    const bytes = new TextEncoder().encode(text)
    expect(b64encodeBytes(bytes)).toBe(b64encode(text))
    expect(b64decodeBytes(b64encodeBytes(bytes)).length).toBe(bytes.length)
  })

  it('decode 前剥空白（平台返回的大文件 base64 每 60 字符插 \\n）', () => {
    const raw = b64encodeBytes(new Uint8Array([1, 2, 3, 4, 5]))
    const wrapped = `${raw.slice(0, 3)}\n${raw.slice(3)}\n`
    expect(Array.from(b64decodeBytes(wrapped))).toEqual([1, 2, 3, 4, 5])
  })

  it('二进制指纹逐字节；与另两个插件同一套算法', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    expect(fingerprintBytes(bytes)).toMatch(/^[0-9a-z]+:[0-9a-z]+$/)
    // 三边必须互认（任一边改了字节算法都会红）
    expect(fingerprintBytes(bytes)).toBe(s3FingerprintBytes(bytes))
    // 含高位字节：文本指纹（UTF-16 码元）与字节指纹不是同一回事
    expect(fingerprintBytes(bytes)).not.toBe(fingerprint(new TextDecoder().decode(bytes)))
  })

  it('isAttachment：.md 不算、.zn 不算、图片 / PDF 算', () => {
    expect(isAttachment('附件/图.png')).toBe(true)
    expect(isAttachment('说明.pdf')).toBe(true)
    expect(isAttachment('笔记.md')).toBe(false)
    expect(isAttachment('.zn/conflicts/x.png')).toBe(false)
    expect(isAttachment('')).toBe(false)
  })

  it('needsAttachmentPull：本地没有 / 指纹不同才拉；cleaned 不拉', () => {
    expect(needsAttachmentPull(null, { fp: 'a:1' })).toBe(true)
    expect(needsAttachmentPull('a:1', { fp: 'a:1' })).toBe(false)
    expect(needsAttachmentPull('a:1', { fp: 'b:2' })).toBe(true)
    expect(needsAttachmentPull(null, { fp: 'a:1', cleaned: true })).toBe(false)
    expect(needsAttachmentPull('a:1', null)).toBe(false)
  })

  it('relayName：指纹里的 `:` 换掉（Windows 备用数据流坑）', () => {
    expect(relayName('8:1te3kiy', '.png')).toBe('8-1te3kiy.png')
    expect(relayName('a/b\\c', '')).toBe('a-b-c')
  })
})

describe('路径与判据', () => {
  it('encodeGitPath：逐段编码、保留 /', () => {
    expect(encodeGitPath('日记/2026 年 10 月.md')).toBe(
      '%E6%97%A5%E8%AE%B0/2026%20%E5%B9%B4%2010%20%E6%9C%88.md',
    )
    expect(encodeGitPath('/a//b/')).toBe('a/b')
  })

  it('指纹与另外两个同步插件互认（四边同一套）', () => {
    expect(fingerprint('abc')).toBe(webdavFingerprint('abc'))
    expect(fingerprint('abc')).toBe(s3Fingerprint('abc'))
  })

  it('decideSync：与 sync-webdav 逐字一致', () => {
    const b = (fp: string) => ({ fp, at: 1 })
    expect(decideSync({ base: null, localFp: 'a', remoteFp: null })).toBe('push-new')
    expect(decideSync({ base: b('a'), localFp: 'a', remoteFp: null })).toBe('remote-deleted')
    expect(decideSync({ base: b('a'), localFp: 'b', remoteFp: null })).toBe('conflict')
    expect(decideSync({ base: null, localFp: 'a', remoteFp: 'a' })).toBe('noop')
    expect(decideSync({ base: null, localFp: 'a', remoteFp: 'b' })).toBe('conflict')
    expect(decideSync({ base: b('a'), localFp: 'a', remoteFp: 'a' })).toBe('noop')
    expect(decideSync({ base: b('a'), localFp: 'a', remoteFp: 'b' })).toBe('pull')
    expect(decideSync({ base: b('a'), localFp: 'b', remoteFp: 'a' })).toBe('push')
    expect(decideSync({ base: b('a'), localFp: 'b', remoteFp: 'c' })).toBe('conflict')
    expect(decideSync({ base: b('a'), localFp: 'b', remoteFp: 'b' })).toBe('noop')
  })

  it('tryAutoMerge / conflictFileName / fmtMs', () => {
    const base = 'A\nB\nC\n'
    expect(tryAutoMerge({ base, mine: 'A1\nB\nC\n', theirs: 'A\nB\nC1\n', mergeLines })?.text).toBe(
      'A1\nB\nC1\n',
    )
    expect(tryAutoMerge({ base, mine: 'A\nB1\nC\n', theirs: 'A\nB2\nC\n', mergeLines })).toBeNull()
    expect(conflictFileName(new Date(2026, 9, 25, 0, 4), 'x.md')).toBe('2026-10-25 0004-x.md')
    expect(fmtMs(320)).toBe('320 毫秒')
    expect(fmtMs(1200)).toBe('1.2 秒')
  })
})

describe('parseContents（形状照真实 GitHub 响应）', () => {
  it('文件：base64 content + sha', () => {
    // 实测 2026-10-25：GET /repos/octocat/Hello-World/contents/README
    const r = parseContents({
      name: 'README',
      sha: '980a0d5f19a64b4b30a87d4206aade58726b60e3',
      size: 13,
      encoding: 'base64',
      content: 'SGVsbG8gV29ybGQhCg==',
    })
    expect(r).toEqual({ text: 'Hello World!\n', sha: '980a0d5f19a64b4b30a87d4206aade58726b60e3' })
  })

  it('目录：数组 ⇒ 条目清单', () => {
    const r = parseContents([
      { name: 'a.md', path: 'ZeroNote/a.md', type: 'file', sha: 's1' },
      { name: 'sub', path: 'ZeroNote/sub', type: 'dir', sha: 's2' },
    ])
    expect(r).toEqual({
      dir: [
        { name: 'a.md', path: 'ZeroNote/a.md', type: 'file', sha: 's1' },
        { name: 'sub', path: 'ZeroNote/sub', type: 'dir', sha: 's2' },
      ],
    })
  })

  it('坏数据 ⇒ null', () => {
    expect(parseContents(null)).toBeNull()
    expect(parseContents({ name: 'x' })).toBeNull()
  })

  it('normalizeManifest：保留 sha、丢掉没 fp 的条目', () => {
    const m = normalizeManifest(
      JSON.stringify({ files: { 'a.md': { fp: '1:p', sha: 's', at: 5 }, bad: {} } }),
    )
    expect(m.files['a.md']).toEqual({ fp: '1:p', sha: 's', at: 5 })
    expect(m.files.bad).toBeUndefined()
  })
})

/* ───────────────────────── 客户端接线 ───────────────────────── */

function gitNet(responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = []
  const queue = [...responses]
  const net = {
    fetch: vi.fn(async (spec: { url: string; method: string; headers: Record<string, string>; body?: string }) => {
      calls.push({ url: spec.url, method: spec.method, headers: spec.headers, body: spec.body })
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
  provider: 'github',
  owner: 'me',
  repo: 'notes',
  branch: 'main',
  token: 'T0KEN',
  prefix: '',
  net: null as unknown,
}

function client(net: unknown, over: Partial<typeof cfg> = {}) {
  return createGitClient({ ...cfg, ...over, net } as never)
}

describe('Git Contents 客户端', () => {
  it('read：404 ⇒ null；200 ⇒ 解码内容与 sha', async () => {
    const { net, calls } = gitNet([
      { status: 404 },
      {
        status: 200,
        body: JSON.stringify({ sha: 's1', encoding: 'base64', content: b64encode('你好') }),
      },
    ])
    const c = client(net)
    expect(await c.read('a.md')).toBeNull()
    expect(await c.read('a.md')).toEqual({ text: '你好', sha: 's1' })
    expect(calls[0].url).toBe('https://api.github.com/repos/me/notes/contents/a.md?ref=main')
    expect(calls[0].headers.Authorization).toBe('Bearer T0KEN')
  })

  it('write：PUT + base64 body + sha（更新时带）', async () => {
    const { net, calls } = gitNet([{ status: 200, body: JSON.stringify({ content: { sha: 'new1' } }) }])
    const c = client(net)
    const r = await c.write('a.md', '内容', { sha: 'old1' })
    expect(r).toEqual({ ok: true, status: 200, sha: 'new1', conflict: false })
    const body = JSON.parse(String(calls[0].body))
    expect(body).toMatchObject({ sha: 'old1', branch: 'main', content: b64encode('内容') })
    expect(calls[0].method).toBe('PUT')
  })

  it('write：409 / 422 / 400 都算「乐观锁冲突」（各家报法不同）', async () => {
    for (const status of [409, 422, 400]) {
      const { net } = gitNet([{ status }])
      const r = await client(net).write('a.md', 'x', { sha: 'old' })
      expect(r.ok).toBe(false)
      expect(r.conflict).toBe(true)
    }
  })

  it('remove：DELETE 带 sha', async () => {
    const { net, calls } = gitNet([{ status: 200 }])
    const r = await client(net).remove('a.md', 'sha1')
    expect(r.ok).toBe(true)
    expect(calls[0].method).toBe('DELETE')
    expect(JSON.parse(String(calls[0].body))).toMatchObject({ sha: 'sha1' })
  })

  it('provider 差异：Gitee 用 POST + token 头', async () => {
    const { net, calls } = gitNet([{ status: 201, body: JSON.stringify({ content: { sha: 'g1' } }) }])
    const c = client(net, { provider: 'gitee' })
    await c.write('a.md', 'x')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url.startsWith('https://gitee.com/api/v5/repos/me/notes/contents/a.md')).toBe(true)
    expect(calls[0].headers.Authorization).toBe('token T0KEN')
  })

  it('test：200 ok / 401 提示令牌无效 / 404 提示仓库不存在', async () => {
    const ok = gitNet([{ status: 200 }])
    expect((await client(ok.net).test()).ok).toBe(true)

    const bad = gitNet([{ status: 401 }])
    expect((await client(bad.net).test()).hint).toContain('401')

    const missing = gitNet([{ status: 404 }])
    expect((await client(missing.net).test()).hint).toContain('404')
  })

  it('PROVIDERS 三个平台的 API 根与方法', () => {
    expect(PROVIDERS.github.api).toBe('https://api.github.com')
    expect(PROVIDERS.github.write).toBe('PUT')
    expect(PROVIDERS.gitee.write).toBe('POST')
    expect(Object.keys(PROVIDERS)).toEqual(['github', 'gitea', 'gitee'])
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
    expect(panels).toEqual(['sync-git.status'])
    expect(commands.sort()).toEqual([
      'sync-git.disconnect',
      'sync-git.open',
      'sync-git.save',
      'sync-git.set-attachments',
      'sync-git.set-provider',
      'sync-git.sync',
      'sync-git.test',
      'sync-git.toggle-auto',
    ])
  })
})

/**
 * rev173.123 · **乐观锁失效的自愈**（本轮真机实测发现的 bug）。
 *
 * 场景：远端被"绕过 manifest"改过（网页里手改 / 另一台设备崩在半路）⇒ 插件手里的 sha 过期
 * ⇒ `PUT` 409。修之前这里只留一句 hint 就 continue，下一轮还拿同一个过期 sha 重试 —
 * **永远 409、永远推不上去**。修之后本轮重读远端、刷新 manifest 条目、该合就合。
 */
describe('乐观锁失效的自愈（rev173.123）', () => {
  it('PUT 409 ⇒ 本轮重读远端并合并，下一轮不再重复冲突', async () => {
    const store = new Map<string, unknown>()
    const commands = new Map<string, (p?: unknown) => unknown>()
    const localWrites: Array<{ path: string; text: string }> = []

    const BASE = 'L1\nL2\nL3\n'
    const localText = 'L1（本机）\nL2\nL3\n'
    /** 远端状态：一开始等于 base；后来被别人"绕过 manifest"改成第三行 */
    const remote = { text: 'L1\nL2\nL3（网页手改）\n', sha: 'sha-page-edit' }
    const manifestState = {
      version: 1 as const,
      files: { 'a.md': { fp: fingerprint(BASE), sha: 'sha-old', at: 1 } } as Record<string, unknown>,
      attachments: {},
    }
    let manifestSha = 'sha-m'
    let putCalls = 0

    store.set('settings.v1', {
      provider: 'github',
      apiBase: '',
      owner: 'me',
      repo: 'notes',
      branch: 'main',
      prefix: '',
      enabled: true,
      auto: false,
    })
    store.set('baseline.v1', { 'a.md': { fp: fingerprint(BASE), sha: 'sha-old' } })

    const net = {
      fetch: async (spec: { url: string; method: string; body?: string }) => {
        const isManifest = spec.url.includes('_zn%2Fmanifest.json') || spec.url.includes('_zn/manifest.json')
        const isFile = spec.url.includes('/contents/a.md')
        if (spec.method === 'GET' && isManifest) {
          // 平台上 manifest 也是一个「文件」⇒ 走 Contents 包装（sha + base64 content）
          const body = JSON.stringify({ sha: manifestSha, encoding: 'base64', content: b64encode(JSON.stringify(manifestState)) })
          return { status: 200, headers: {}, text: () => body, bytes: () => new TextEncoder().encode(body) }
        }
        if (spec.method === 'GET' && isFile) {
          const body = JSON.stringify({ sha: remote.sha, encoding: 'base64', content: b64encode(remote.text) })
          return { status: 200, headers: {}, text: () => body, bytes: () => new TextEncoder().encode(body) }
        }
        if (spec.method === 'PUT' && isFile) {
          putCalls += 1
          // 第一次 = 拿过期 sha 推 ⇒ 平台拒绝
          if (putCalls === 1) return { status: 409, headers: {}, text: () => '{"message":"sha mismatch"}', bytes: () => new Uint8Array() }
          // 第二次 = resolveConflict 里用远端最新 sha 推合并结果
          const body = JSON.parse(String(spec.body))
          remote.text = b64decode(body.content)
          remote.sha = 'sha-merged'
          const out = JSON.stringify({ content: { sha: remote.sha } })
          return { status: 200, headers: {}, text: () => out, bytes: () => new TextEncoder().encode(out) }
        }
        if (spec.method === 'PUT' && isManifest) {
          const body = JSON.parse(String(spec.body))
          manifestState.files = JSON.parse(b64decode(body.content)).files
          manifestSha = 'sha-m2'
          const out = JSON.stringify({ content: { sha: manifestSha } })
          return { status: 200, headers: {}, text: () => out, bytes: () => new TextEncoder().encode(out) }
        }
        return { status: 500, headers: {}, text: () => '', bytes: () => new Uint8Array() }
      },
    }

    const api = {
      host: {
        platform: 'windows',
        log: () => {},
        notify: () => {},
        secrets: { get: async () => 'T', set: async () => {}, delete: async () => {} },
      },
      fs: {
        listNotes: async () => [{ path: 'a.md', id: 'a', title: 'a', mtime: 1, size: 9, frontmatter: {}, kind: 'note' }],
        readText: async () => localText,
        writeText: async (p: string, t: string) => {
          localWrites.push({ path: p, text: t })
        },
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
      view: { registerPanel: () => ({ dispose: () => {} }), refresh: () => {} },
      service: {
        consume: async (name: string) =>
          name === 'history'
            ? { snapshot: async () => {}, findBase: async () => BASE }
            : name === 'kernel.merge'
              ? { mergeLines }
              : null,
        provide: () => ({ dispose: () => {} }),
      },
      subscriptions: [] as Array<{ dispose?: () => void }>,
    }

    plugin.apply(api as never)
    await new Promise((r) => setTimeout(r, 20))

    const s1 = (await commands.get('sync-git.sync')!()) as { merged?: number; conflicts?: number; pushed?: number }
    expect(putCalls).toBe(2) // 第一次 409 + 第二次推合并结果
    expect(s1.merged).toBe(1)
    expect(s1.conflicts ?? 0).toBe(0)
    // 合并结果落盘：两边改动都在
    expect(localWrites.at(-1)?.text).toBe('L1（本机）\nL2\nL3（网页手改）\n')
    expect(remote.text).toBe('L1（本机）\nL2\nL3（网页手改）\n')

    // 再跑一轮：不该再冲突 / 再合并（收口了）
    const s2 = (await commands.get('sync-git.sync')!()) as { merged?: number; conflicts?: number; pushed?: number }
    expect(s2.merged ?? 0).toBe(0)
    expect(s2.conflicts ?? 0).toBe(0)

    for (const s of api.subscriptions) s.dispose?.()
  })
})

/**
 * rev173.164 · 期 1c：**私有文件同步**（密码库）。
 *
 * `.zn/` 下的密文不是 `.md`，`listNotes` 看不到 ⇒ 以前密码库**同步不出去**，
 * 换设备就是空库（"云端零明文"做到了，"换设备能解开"没做到）。
 */
describe('私有文件同步：密码库（rev173.164 · 期 1c）', () => {
  const enc = (s: string) => new TextEncoder().encode(s)
  const dec = (b: Uint8Array | undefined) => (b ? new TextDecoder().decode(b) : '')
  const SECRETS = '.zn/secrets/secrets.zn'
  const VAULT = '.zn/security/vault.json'

  /** 极简 Contents API：对象表（key = 仓库内路径），sha 递增 */
  function makeGitRepo() {
    const files = new Map<string, { text: string; sha: string }>()
    const requests: string[] = []
    let ver = 0
    const emptyBytes = () => new Uint8Array()
    const net = {
      fetch: async (spec: { url: string; method: string; body?: string }) => {
        const method = String(spec.method ?? 'GET').toUpperCase()
        const m = /\/contents\/([^?]+)/.exec(spec.url)
        if (!m) return { status: 200, headers: {}, text: () => '{}', bytes: emptyBytes }
        const p = decodeURIComponent(m[1])
        requests.push(`${method} ${p}`)
        if (method === 'GET') {
          const f = files.get(p)
          if (!f) return { status: 404, headers: {}, text: () => '{}', bytes: emptyBytes }
          const body = JSON.stringify({
            name: p,
            path: p,
            sha: f.sha,
            encoding: 'base64',
            content: b64encode(f.text),
          })
          return { status: 200, headers: {}, text: () => body, bytes: () => enc(body) }
        }
        if (method === 'PUT') {
          const body = JSON.parse(String(spec.body ?? '{}'))
          ver += 1
          const sha = `s${ver}`
          files.set(p, { text: b64decode(String(body.content ?? '')), sha })
          const out = JSON.stringify({ content: { sha } })
          return { status: 201, headers: {}, text: () => out, bytes: () => enc(out) }
        }
        if (method === 'DELETE') {
          files.delete(p)
          return { status: 200, headers: {}, text: () => '{}', bytes: emptyBytes }
        }
        return { status: 500, headers: {}, text: () => '', bytes: emptyBytes }
      },
    }
    return { files, net, requests }
  }

  function makeDevice(net: unknown, local: Map<string, Uint8Array>, platform: string) {
    const store = new Map<string, unknown>()
    const commands = new Map<string, (p?: unknown) => unknown>()
    const notices: string[] = []
    store.set('settings.v1', {
      provider: 'github',
      apiBase: '',
      owner: 'me',
      repo: 'notes',
      branch: 'main',
      prefix: '',
      enabled: true,
      auto: false,
    })
    const api = {
      host: {
        platform,
        log: () => {},
        notify: (msg: string) => {
          notices.push(msg)
        },
        secrets: { get: async () => 'T', set: async () => {}, delete: async () => {} },
      },
      fs: {
        listNotes: async () => [],
        readText: async (p: string) => dec(local.get(p)),
        writeText: async (p: string, text: string) => {
          local.set(p, enc(String(text)))
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
      view: { registerPanel: () => ({ dispose: () => {} }), refresh: () => {} },
      service: { consume: async () => null, provide: () => ({ dispose: () => {} }) },
      subscriptions: [] as Array<{ dispose?: () => void }>,
    }
    plugin.apply(api as never)
    return { commands, notices, dispose: () => { for (const s of api.subscriptions) s.dispose?.() } }
  }

  it('A 建库 ⇒ 两个文件都进仓库；B 空库 ⇒ 都拉下来', async () => {
    const { files: repo, net } = makeGitRepo()
    const localA = new Map<string, Uint8Array>()
    const localB = new Map<string, Uint8Array>()
    const A = makeDevice(net, localA, 'windows')
    const B = makeDevice(net, localB, 'mac')
    await new Promise((r) => setTimeout(r, 20))

    localA.set(SECRETS, enc('zn1.AAAA.BBBB'))
    localA.set(VAULT, enc('{"v":1,"rings":{"secrets":{"wrapped":{"secrets":"zn1.X.Y"}}}}'))

    await A.commands.get('sync-git.sync')!({})
    expect(repo.get(SECRETS)?.text).toBe('zn1.AAAA.BBBB')
    expect(repo.get(VAULT)?.text).toContain('wrapped')

    await B.commands.get('sync-git.sync')!({})
    expect(dec(localB.get(SECRETS))).toBe('zn1.AAAA.BBBB')
    expect(dec(localB.get(VAULT))).toContain('wrapped')

    A.dispose()
    B.dispose()
  })

  it('只有远端变 ⇒ 本机拉下来（不能既不拉也不推）', async () => {
    const { files: repo, net, requests } = makeGitRepo()
    const localA = new Map<string, Uint8Array>()
    const localB = new Map<string, Uint8Array>()
    const A = makeDevice(net, localA, 'windows')
    const B = makeDevice(net, localB, 'mac')
    await new Promise((r) => setTimeout(r, 20))

    localA.set(SECRETS, enc('zn1.v1'))
    await A.commands.get('sync-git.sync')!({})
    await B.commands.get('sync-git.sync')!({})
    expect(dec(localB.get(SECRETS))).toBe('zn1.v1')

    localB.set(SECRETS, enc('zn1.v2'))
    await B.commands.get('sync-git.sync')!({})
    expect(repo.get(SECRETS)?.text).toBe('zn1.v2')

    const before = requests.length
    await A.commands.get('sync-git.sync')!({})
    expect(dec(localA.get(SECRETS))).toBe('zn1.v2')
    const round = requests.slice(before).filter((r) => r.includes(SECRETS))
    expect(round.some((r) => r.startsWith('GET'))).toBe(true)
    expect(round.some((r) => r.startsWith('PUT'))).toBe(false)

    A.dispose()
    B.dispose()
  })

  it('双端都改 ⇒ 冲突留副本，本地取远端版', async () => {
    const { files: repo, net } = makeGitRepo()
    const localA = new Map<string, Uint8Array>()
    const localB = new Map<string, Uint8Array>()
    const A = makeDevice(net, localA, 'windows')
    const B = makeDevice(net, localB, 'mac')
    await new Promise((r) => setTimeout(r, 20))

    localA.set(SECRETS, enc('zn1.v1'))
    await A.commands.get('sync-git.sync')!({})
    await B.commands.get('sync-git.sync')!({})

    localA.set(SECRETS, enc('zn1.v2'))
    await A.commands.get('sync-git.sync')!({})

    localB.set(SECRETS, enc('zn1.v3'))
    await B.commands.get('sync-git.sync')!({})

    const copies = [...localB.keys()].filter((k) => k.startsWith('.zn/conflicts/'))
    expect(copies).toHaveLength(1)
    expect(dec(localB.get(copies[0]))).toBe('zn1.v3')
    expect(dec(localB.get(SECRETS))).toBe('zn1.v2')
    expect(repo.get(SECRETS)?.text).toBe('zn1.v2')

    A.dispose()
    B.dispose()
  })
})
