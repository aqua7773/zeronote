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
  b64encode,
  conflictFileName,
  createGitClient,
  decideSync,
  encodeGitPath,
  fingerprint,
  fmtMs,
  normalizeManifest,
  parseContents,
  tryAutoMerge,
} from '../examples/sync-git/index.js'
import { mergeLines } from '../src/lib/merge3'
import { fingerprint as s3Fingerprint } from '../examples/sync-s3/index.js'
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
    expect(decideSync({ base: null, localFp: 'a', remoteFp: 'b' })).toBe('pull-new')
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
