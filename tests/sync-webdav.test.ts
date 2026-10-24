// @vitest-environment happy-dom
/**
 * 同步 · WebDAV（`examples/sync-webdav`）—— rev173.108
 *
 * 六层：
 *  1. 指纹（与 sync-folder 同一套判据）
 *  2. URL 编码 / 拼接（中文、空格、多余斜杠）
 *  3. Basic 认证头（**中文账号不能靠 btoa 硬编**）
 *  4. `PROPFIND` XML 解析（命名空间 / 无前缀 / 目录 / 编码过的 href / 坏 XML）
 *  5. `decideSync` 七种组合（决定了会不会丢字）
 *  6. 客户端接线（mock `net`：401 提示、412 乐观锁、manifest 读写）
 */
import { describe, expect, it, vi } from 'vitest'
import plugin, {
  basicAuth,
  conflictFileName,
  createDavClient,
  decideSync,
  dirOf,
  encodeDavPath,
  extOf,
  fingerprint,
  fingerprintBytes,
  fmtMs,
  isAttachment,
  joinUrl,
  needsAttachmentPull,
  normalizeManifest,
  parsePropfind,
  pushTiming,
  relayName,
  sparkline,
  timingSummary,
  tryAutoMerge,
} from '../examples/sync-webdav/index.js'
import { mergeLines } from '../src/lib/merge3'
import { fingerprint as syncFolderFingerprint } from '../examples/sync-folder/index.js'

/* ───────────────────────── 1. 指纹 ───────────────────────── */

describe('fingerprint', () => {
  it('同内容同指纹、变一字就变', () => {
    expect(fingerprint('a')).toBe(fingerprint('a'))
    expect(fingerprint('a')).not.toBe(fingerprint('b'))
  })

  it('与 sync-folder 用同一套算法（两边互认）', () => {
    // 直接对比两个插件的实现：任一边改了算法这条就红
    expect(fingerprint('abc')).toBe(syncFolderFingerprint('abc'))
    expect(fingerprint('# 标题\n中文内容')).toBe(syncFolderFingerprint('# 标题\n中文内容'))
  })
})

/* ───────────────────────── 2. URL ───────────────────────── */

describe('encodeDavPath', () => {
  it('逐段编码，保留 /', () => {
    expect(encodeDavPath('日记/2026 年 10 月.md')).toBe(
      '%E6%97%A5%E8%AE%B0/2026%20%E5%B9%B4%2010%20%E6%9C%88.md',
    )
  })

  it('去掉空段与前后斜杠', () => {
    expect(encodeDavPath('/a//b/')).toBe('a/b')
    expect(encodeDavPath('')).toBe('')
  })
})

describe('joinUrl', () => {
  it('拼地址 + 同步目录 + 相对路径', () => {
    expect(joinUrl('https://dav.example.com/dav/', 'ZeroNote', 'a.md')).toBe(
      'https://dav.example.com/dav/ZeroNote/a.md',
    )
  })

  it('同步目录为空时不出现双斜杠', () => {
    expect(joinUrl('https://dav.example.com/dav', '', 'a.md')).toBe('https://dav.example.com/dav/a.md')
  })

  it('保留协议里的 //', () => {
    expect(joinUrl('https://x.com', '', '')).toBe('https://x.com')
  })
})

/* ───────────────────────── 3. Basic 认证 ───────────────────────── */

describe('basicAuth', () => {
  it('纯 ASCII：标准 base64', () => {
    expect(basicAuth('user', 'pass')).toBe(`Basic ${btoa('user:pass')}`)
  })

  it('中文账号不抛错（btoa 直编会 InvalidCharacterError）', () => {
    const header = basicAuth('张三', '密码')
    expect(header.startsWith('Basic ')).toBe(true)
    // 解回来应当是 UTF-8 的「张三:密码」
    const bin = atob(header.slice(6))
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    expect(new TextDecoder().decode(bytes)).toBe('张三:密码')
  })

  it('空值也不炸', () => {
    expect(basicAuth('', '')).toBe(`Basic ${btoa(':')}`)
  })
})

/* ───────────────────────── 4. PROPFIND 解析 ───────────────────────── */

const XML_NS = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/dav/ZeroNote/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/ZeroNote/a.md</d:href>
    <d:propstat><d:prop>
      <d:resourcetype/>
      <d:getetag>"abc123"</d:getetag>
      <d:getcontentlength>42</d:getcontentlength>
    </d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat>
  </d:response>
  <d:response>
    <d:href>/dav/ZeroNote/%E6%97%A5%E8%AE%B0/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
</d:multistatus>`

describe('parsePropfind', () => {
  it('剥掉同步根前缀，返回相对路径（根自身留空串，由 list() 过滤）', () => {
    const list = parsePropfind(XML_NS, { rootPrefix: '/dav/ZeroNote/' })
    const paths = list.map((e) => e.path)
    expect(paths).toContain('a.md')
    expect(paths).toContain('日记')
    expect(list.find((e) => e.path === '')?.isDir).toBe(true) // 根
  })

  it('etag 原样保留（带引号，If-Match 要用同一串）', () => {
    const list = parsePropfind(XML_NS, { rootPrefix: '/dav/ZeroNote/' })
    expect(list.find((e) => e.path === 'a.md')?.etag).toBe('"abc123"')
  })

  it('目录靠 resourcetype 判（不靠 href 结尾的 /）', () => {
    const list = parsePropfind(XML_NS, { rootPrefix: '/dav/ZeroNote/' })
    expect(list.find((e) => e.path === '日记')?.isDir).toBe(true)
    expect(list.find((e) => e.path === 'a.md')?.isDir).toBe(false)
  })

  it('href 里的中文被解码', () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/r/%E4%B8%AD%E6%96%87.md</d:href>
      <d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response></d:multistatus>`
    expect(parsePropfind(xml, { rootPrefix: '/r/' })[0].path).toBe('中文.md')
  })

  it('没有命名空间前缀也能解析', () => {
    const xml = `<multistatus><response><href>/r/b.md</href>
      <propstat><prop><resourcetype/><getetag>W/"1"</getetag></prop></propstat></response></multistatus>`
    const list = parsePropfind(xml, { rootPrefix: '/r/' })
    expect(list[0].path).toBe('b.md')
    expect(list[0].etag).toBe('W/"1"')
  })

  it('坏 XML ⇒ 空表（不抛）', () => {
    expect(parsePropfind('<multistatus><response>', { rootPrefix: '/r/' })).toEqual([])
    expect(parsePropfind('', {})).toEqual([])
  })

  it('大小写不同的前缀（D:）也认', () => {
    const xml = XML_NS.replace(/d:/g, 'D:').replace('xmlns:D', 'xmlns:D')
    expect(parsePropfind(xml, { rootPrefix: '/dav/ZeroNote/' })).toHaveLength(3)
  })
})

/* ───────────────────────── 5. 判定 ───────────────────────── */

describe('decideSync', () => {
  const base = { fp: 'base' }

  it('远端没有、本地新增 ⇒ push-new', () => {
    expect(decideSync({ base: null, localFp: 'a', remoteFp: null })).toBe('push-new')
  })

  it('远端删了、本地没改 ⇒ remote-deleted（跟着删基线）', () => {
    expect(decideSync({ base, localFp: 'base', remoteFp: null })).toBe('remote-deleted')
  })

  it('远端删了、本地改过 ⇒ conflict', () => {
    expect(decideSync({ base, localFp: 'mine', remoteFp: null })).toBe('conflict')
  })

  it('都没变 ⇒ noop', () => {
    expect(decideSync({ base, localFp: 'base', remoteFp: 'base' })).toBe('noop')
  })

  it('只有远端变 ⇒ pull', () => {
    expect(decideSync({ base, localFp: 'base', remoteFp: 'theirs' })).toBe('pull')
  })

  it('只有本地变 ⇒ push', () => {
    expect(decideSync({ base, localFp: 'mine', remoteFp: 'base' })).toBe('push')
  })

  it('两边都变且不同 ⇒ conflict', () => {
    expect(decideSync({ base, localFp: 'mine', remoteFp: 'theirs' })).toBe('conflict')
  })

  it('两边变成同一个内容 ⇒ noop（同一改动各自应用过，不该报冲突）', () => {
    expect(decideSync({ base, localFp: 'same', remoteFp: 'same' })).toBe('noop')
  })

  it('远端有、本地没基线 ⇒ pull-new', () => {
    expect(decideSync({ base: null, localFp: 'x', remoteFp: 'y' })).toBe('pull-new')
  })
})

/**
 * rev173.115 三方合并：双端改同一篇时，先试「自动合掉不重叠的改动」。
 *
 * 判据刻意保守 —— **只有完全合上（conflicts === 0）**才自动合；有一处真冲突就退回
 * 「留两份 + 取远端」的原流程，让用户自己看。自动选一边最危险：用户会以为已经合好了。
 */
describe('tryAutoMerge（rev173.115）', () => {
  const base = '# 周报\n第一段\n第二段\n'

  it('两边改不同段 ⇒ 合上，两边改动都在', () => {
    const mine = '# 周报\n第一段（本机改）\n第二段\n'
    const theirs = '# 周报\n第一段\n第二段（远端改）\n'
    const r = tryAutoMerge({ base, mine, theirs, mergeLines })
    expect(r).not.toBeNull()
    expect(r!.text).toContain('第一段（本机改）')
    expect(r!.text).toContain('第二段（远端改）')
  })

  it('两边改同一行 ⇒ null（真冲突，交给用户）', () => {
    const mine = '# 周报\n本机版\n'
    const theirs = '# 周报\n远端版\n'
    expect(tryAutoMerge({ base, mine, theirs, mergeLines })).toBeNull()
  })

  it('缺 base / 缺合并实现 ⇒ null（没 history 或没内核服务时的降级）', () => {
    expect(tryAutoMerge({ base: null, mine: 'a', theirs: 'b', mergeLines })).toBeNull()
    expect(tryAutoMerge({ base: 'a', mine: 'b', theirs: 'c', mergeLines: null })).toBeNull()
    expect(tryAutoMerge({ base: 'a', mine: 'b', theirs: 'c' })).toBeNull()
  })

  it('只有一边变过 ⇒ null（不是"双端都改"，不该走合并）', () => {
    expect(tryAutoMerge({ base, mine: base, theirs: `${base}新增\n`, mergeLines })).toBeNull()
    expect(tryAutoMerge({ base, mine: `${base}新增\n`, theirs: base, mergeLines })).toBeNull()
  })

  it('合出来等于远端版 ⇒ null（本机改动已在远端，省一次写盘 + PUT）', () => {
    // base=第二段，mine 与 base 相同不可能走到这里（上面已挡），这里造"本机改动是远端子集"的场景
    const b = 'A\nB\n'
    const m = 'A1\nB\n'
    const t = 'A1\nB\nC\n'
    expect(tryAutoMerge({ base: b, mine: m, theirs: t, mergeLines })).toBeNull()
  })

  it('合并实现抛错 ⇒ null（不把异常甩给同步流程）', () => {
    const boom = () => {
      throw new Error('merge 炸了')
    }
    expect(() => tryAutoMerge({ base, mine: 'x', theirs: 'y', mergeLines: boom })).not.toThrow()
    expect(tryAutoMerge({ base, mine: 'x', theirs: 'y', mergeLines: boom })).toBeNull()
  })
})

/* ───────────────────────── 6. 冲突名 / manifest ───────────────────────── */

describe('conflictFileName', () => {
  const at = new Date(2026, 9, 24, 21, 5).getTime()

  it('格式与 sync-folder 一致', () => {
    expect(conflictFileName('日记/周报.md', at)).toBe('2026-10-24 2105-周报.md')
  })

  it('同名递增', () => {
    const taken = new Set(['2026-10-24 2105-周报.md'])
    expect(conflictFileName('周报.md', at, (n) => taken.has(n))).toBe('2026-10-24 2105-周报-2.md')
  })
})

describe('附件同步的纯函数（rev173.109）', () => {
  it('fingerprintBytes 按字节算，与文本指纹严格区分', () => {
    const bytes = new Uint8Array([0xff, 0x00, 0x10])
    expect(fingerprintBytes(bytes)).toBe(fingerprintBytes(new Uint8Array([0xff, 0x00, 0x10])))
    expect(fingerprintBytes(bytes)).not.toBe(fingerprintBytes(new Uint8Array([0xff, 0x00, 0x11])))
    // 同一串文本的 "字符指纹" 与 "UTF-8 字节指纹" 不应相等（这就是为什么另写一个）
    expect(fingerprintBytes(new TextEncoder().encode('中文'))).not.toBe(fingerprint('中文'))
  })

  it('fingerprintBytes 空输入不崩', () => {
    expect(fingerprintBytes(new Uint8Array())).toMatch(/^0:/)
    expect(fingerprintBytes(null as unknown as Uint8Array)).toMatch(/^0:/)
  })

  it('extOf：取小写扩展名，没有则空串', () => {
    expect(extOf('attachments/A.PNG')).toBe('.png')
    expect(extOf('说明.txt')).toBe('.txt')
    expect(extOf('无扩展名')).toBe('')
    expect(extOf('')).toBe('')
  })

  it('dirOf：父目录，顶层返回空串', () => {
    expect(dirOf('a/b/c.png')).toBe('a/b')
    expect(dirOf('c.png')).toBe('')
  })

  it('isAttachment：非 md 且不在 .zn 里', () => {
    expect(isAttachment('attachments/a.png')).toBe(true)
    expect(isAttachment('doc.pdf')).toBe(true)
    expect(isAttachment('note.md')).toBe(false)
    expect(isAttachment('x.markdown')).toBe(false)
    expect(isAttachment('.zn/conflicts/windows/a.md')).toBe(false)
    expect(isAttachment('.zn/relay/abc.png')).toBe(false)
    expect(isAttachment('')).toBe(false)
  })

  it('relayName：把指纹里的冒号换掉（Windows 会当成 NTFS 数据流）', () => {
    // 实测踩到：`8tj:1te3kiy.png` 在 Windows 上只建出 0 字节的 `8tj`
    expect(relayName('8tj:1te3kiy', '.png')).toBe('8tj-1te3kiy.png')
    expect(relayName('8tj:1te3kiy', '')).toBe('8tj-1te3kiy')
    expect(relayName('a/b:c', '.pdf')).toBe('a-b-c.pdf')
    expect(relayName(null as unknown as string, '.png')).toBe('.png')
  })

  it('normalizeManifest 保留 attachments 段与 cleaned 标记', () => {
    const m = normalizeManifest(
      JSON.stringify({
        files: {},
        attachments: {
          'a.png': { fp: '5:1', ext: '.png', at: 7 },
          'b.pdf': { fp: '9:2', ext: '.pdf', at: 8, cleaned: true },
          'bad.png': { ext: '.png' },
        },
      }),
    )
    expect(m.attachments['a.png']).toEqual({ fp: '5:1', ext: '.png', at: 7 })
    expect(m.attachments['b.pdf']).toEqual({ fp: '9:2', ext: '.pdf', at: 8, cleaned: true })
    expect(m.attachments['bad.png']).toBeUndefined()
  })

  it('normalizeManifest 坏数据 ⇒ 空的 attachments 段', () => {
    expect(normalizeManifest('nope').attachments).toEqual({})
    expect(normalizeManifest('{"files":{}}').attachments).toEqual({})
  })
})

describe('normalizeManifest', () => {
  it('正常形状原样保留', () => {
    const m = normalizeManifest('{"version":1,"files":{"a.md":{"fp":"1:x","etag":"\\"e\\"","at":5}}}')
    expect(m.files['a.md']).toEqual({ fp: '1:x', etag: '"e"', at: 5 })
  })

  it('坏 JSON / 空 / 缺字段 ⇒ 空表，不抛', () => {
    expect(normalizeManifest('not json').files).toEqual({})
    expect(normalizeManifest('').files).toEqual({})
    expect(normalizeManifest('{"files":{"a.md":{}}}').files).toEqual({})
    expect(normalizeManifest(null).files).toEqual({})
  })

  it('丢弃没有 fp 的条目（远端坏数据不污染本地基线）', () => {
    const m = normalizeManifest({ files: { 'a.md': { etag: 'x' }, 'b.md': { fp: 'f' } } })
    expect(Object.keys(m.files)).toEqual(['b.md'])
  })
})

/* ───────────────────────── 7. 客户端接线 ───────────────────────── */

function davNet(responses: Array<{ status: number; headers?: Record<string, string>; body?: string }>) {
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

describe('createDavClient', () => {
  const cfg = {
    baseUrl: 'https://dav.example.com/dav/',
    username: 'me',
    password: 'secret',
    root: 'ZeroNote',
  }

  it('test：207 ⇒ ok；401 ⇒ 明确提示', async () => {
    const ok = davNet([{ status: 207 }])
    const client = createDavClient({ ...cfg, net: ok.net })
    expect((await client.test()).ok).toBe(true)

    const denied = davNet([{ status: 401 }])
    const r = await createDavClient({ ...cfg, net: denied.net }).test()
    expect(r.ok).toBe(false)
    expect(r.hint).toContain('401')
  })

  it('请求带 Authorization，URL 拼上同步目录', async () => {
    const { net, calls } = davNet([{ status: 207 }])
    const client = createDavClient({ ...cfg, net })
    await client.test()
    expect(calls[0].url).toBe('https://dav.example.com/dav/ZeroNote')
    expect(calls[0].headers.Authorization).toBe(basicAuth('me', 'secret'))
    expect(calls[0].headers.Depth).toBe('0')
  })

  it('get：404 ⇒ null（不抛）', async () => {
    const { net } = davNet([{ status: 404 }])
    const client = createDavClient({ ...cfg, net })
    await expect(client.get('a.md')).resolves.toBeNull()
  })

  it('get：409 也当"不存在"（坚果云对父目录不存在的资源回 409）', async () => {
    const { net } = davNet([{ status: 409 }])
    const client = createDavClient({ ...cfg, net })
    await expect(client.get('_zn/manifest.json')).resolves.toBeNull()
  })

  it('put：412 原样返回（调用方按冲突处理）', async () => {
    const { net } = davNet([{ status: 412 }])
    const client = createDavClient({ ...cfg, net })
    const r = await client.put('a.md', 'x', '"old"')
    expect(r.ok).toBe(false)
    expect(r.status).toBe(412)
  })

  it('put 成功后带回新 etag', async () => {
    const { net, calls } = davNet([{ status: 201, headers: { etag: '"new"' } }])
    const client = createDavClient({ ...cfg, net })
    const r = await client.put('a.md', 'x')
    expect(r).toEqual({ ok: true, status: 201, etag: '"new"' })
    expect(calls[0].method).toBe('PUT')
  })

  it('mkdir：逐级 MKCOL，405（已存在）算成功', async () => {
    const { net, calls } = davNet([{ status: 201 }, { status: 405 }])
    const client = createDavClient({ ...cfg, net })
    await client.mkdir('日记/2026')
    expect(calls.map((c) => c.method)).toEqual(['MKCOL', 'MKCOL'])
    expect(calls[1].url).toContain('ZeroNote/%E6%97%A5%E8%AE%B0/2026')
  })

  it('readManifest：远端没有 ⇒ 空表', async () => {
    const { net } = davNet([{ status: 404 }])
    const client = createDavClient({ ...cfg, net })
    expect((await client.readManifest()).files).toEqual({})
  })

  it('readManifest：有内容就解析', async () => {
    const body = JSON.stringify({ version: 1, files: { 'a.md': { fp: '1:p', etag: '"e"' } } })
    const { net } = davNet([{ status: 200, body }])
    const client = createDavClient({ ...cfg, net })
    expect((await client.readManifest()).files['a.md'].fp).toBe('1:p')
  })

  /* rev173.111 · 304 短路径 */

  it('readManifest：带 If-None-Match，304 ⇒ notModified 且不含表', async () => {
    const { net, calls } = davNet([{ status: 304 }])
    const client = createDavClient({ ...cfg, net })
    const r = await client.readManifest('"v3"')
    expect(r.notModified).toBe(true)
    expect(r.files).toBeNull()
    expect(r.attachments).toBeNull()
    expect(calls[0].headers['If-None-Match']).toBe('"v3"')
  })

  it('readManifest：200 带回 ETag（下一轮 304 用）；没给 ETag 时返回 null', async () => {
    const body = JSON.stringify({ version: 1, files: { 'a.md': { fp: '1:p' } } })
    const { net, calls } = davNet([{ status: 200, body, headers: { etag: '"v7"' } }])
    const client = createDavClient({ ...cfg, net })
    const r = await client.readManifest('"v6"')
    expect(r.notModified).toBe(false)
    expect(r.etag).toBe('"v7"')
    expect(r.files['a.md'].fp).toBe('1:p')
    expect(calls[0].headers['If-None-Match']).toBe('"v6"')

    const { net: net2 } = davNet([{ status: 200, body }])
    expect((await createDavClient({ ...cfg, net: net2 }).readManifest()).etag).toBeNull()
  })

  it('readManifest：409（父目录不存在）也算空表，不抛', async () => {
    const { net } = davNet([{ status: 409 }])
    const client = createDavClient({ ...cfg, net })
    expect(await client.readManifest()).toMatchObject({ files: {}, notModified: false })
  })

  it('readManifest：503 仍然抛错（限流判定靠这段文本）', async () => {
    const { net } = davNet([{ status: 503 }])
    const client = createDavClient({ ...cfg, net })
    await expect(client.readManifest()).rejects.toThrow('下载失败（503）')
  })
})

describe('插件接线', () => {
  it('注册主区面板与五条命令', () => {
    const panels: string[] = []
    const commands: string[] = []
    const api = {
      host: { platform: 'windows', log: () => {}, notify: () => {} },
      fs: {},
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
      subscriptions: [],
    }
    plugin.apply(api as never)
    expect(panels).toEqual(['sync-webdav.status'])
    expect(commands.sort()).toEqual([
      'sync-webdav.disconnect',
      'sync-webdav.open',
      'sync-webdav.open-conflict',
      'sync-webdav.save',
      'sync-webdav.set-attachments',
      'sync-webdav.sync',
      'sync-webdav.test',
      'sync-webdav.toggle-auto',
    ])
  })
})

/**
 * rev173.110 回归：**限流停自动同步后，开关必须跟实际一致。**
 *
 * 真实事故（2026-10-24 真机）：22:27 手机被坚果云 503 打断 ⇒ `stopAuto()` 只清定时器，
 * `settings.auto` 仍是 true ⇒ 面板一直显示「关闭自动同步 / 自动 · 前台每 5 秒」，
 * 用户以为还在自动同步，实际已经停了 —— 手机上写的笔记 20 分钟没上传。
 */
describe('限流后开关与实际一致（rev173.110）', () => {
  it('503 停掉自动同步 ⇒ settings.auto 落盘为 false', async () => {
    const store = new Map<string, unknown>()
    let render: ((ctx: { state?: Record<string, string> }) => unknown) | null = null
    const commands = new Map<string, (payload?: unknown) => unknown>()
    const api = {
      host: {
        platform: 'windows',
        log: () => {},
        notify: () => {},
        secrets: { get: async () => 'p', set: async () => {}, delete: async () => {} },
      },
      fs: {
        listNotes: async () => [],
        readText: async () => '',
        writeText: async () => {},
        mkdir: async () => {},
      },
      net: {
        fetch: async () => ({
          status: 503,
          headers: {},
          text: async () => '<s:exception>BlockedTemporarily</s:exception>',
          bytes: async () => new Uint8Array(),
        }),
      },
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
      subscriptions: [] as Array<{ dispose?: () => void }>,
    }
    plugin.apply(api as never)
    await new Promise((r) => setTimeout(r, 0))

    render!({
      state: {
        'sync.baseUrl': 'https://dav.example/dav/',
        'sync.username': 'u',
        'sync.root': 'ZeroNote',
      },
    })
    await commands.get('sync-webdav.save')!()
    expect((store.get('settings.v1') as { auto?: boolean }).auto).toBe(true)

    await commands.get('sync-webdav.sync')!()
    expect((store.get('settings.v1') as { auto?: boolean }).auto).toBe(false)

    // apply 里 startAuto 挂的 interval 已经由 stopAuto 摘掉；保险起见全清
    for (const s of api.subscriptions) s.dispose?.()
  })
})

/* ─────────────── rev173.117 · 附件 304 / 指纹缓存 / 耗时 ─────────────── */

describe('附件也走 304（rev173.117）', () => {
  const cfg = {
    baseUrl: 'https://dav.example.com/dav/',
    username: 'me',
    password: 'secret',
    root: 'ZeroNote',
  }

  it('getBytes：带 If-None-Match，304 ⇒ notModified 且不返回字节', async () => {
    const { net, calls } = davNet([{ status: 304 }])
    const client = createDavClient({ ...cfg, net })
    const r = await client.getBytes('_zn/relay/x.png', '"v1"')
    expect(r).toEqual({ data: null, notModified: true, etag: '"v1"' })
    expect(calls[0].headers['If-None-Match']).toBe('"v1"')
  })

  it('getBytes：404 / 409 ⇒ 没有这份（不抛）', async () => {
    for (const status of [404, 409]) {
      const { net } = davNet([{ status }])
      const r = await createDavClient({ ...cfg, net }).getBytes('a.png')
      expect(r).toMatchObject({ data: null, notModified: false })
    }
  })

  it('getBytes：200 带回字节与 etag（下一轮 304 用）', async () => {
    const { net } = davNet([{ status: 200, body: 'PNGDATA', headers: { etag: '"e2"' } }])
    const r = await createDavClient({ ...cfg, net }).getBytes('a.png')
    expect(r.notModified).toBe(false)
    expect(new TextDecoder().decode(r.data!)).toBe('PNGDATA')
    expect(r.etag).toBe('"e2"')
  })

  /* rev173.118 · test() 自动建目录不能多拼一层 */

  it('test：404 自动建目录建的是「同步根」本身，不再多出一层', async () => {
    const { net, calls } = davNet([{ status: 404 }, { status: 201 }, { status: 207 }])
    const client = createDavClient({ ...cfg, net })
    const r = await client.test()
    expect(r).toMatchObject({ ok: true, status: 207 })
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PROPFIND https://dav.example.com/dav/ZeroNote',
      // 修复前这里是 …/ZeroNote/ZeroNote（实测会在远端多出一个空目录）
      'MKCOL https://dav.example.com/dav/ZeroNote',
      'PROPFIND https://dav.example.com/dav/ZeroNote',
    ])
  })

  it('test：多级同步目录逐级建（a/b ⇒ 两次 MKCOL）', async () => {
    const { net, calls } = davNet([{ status: 404 }, { status: 201 }, { status: 201 }, { status: 207 }])
    await createDavClient({ ...cfg, root: 'a/b', net }).test()
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'PROPFIND https://dav.example.com/dav/a/b',
      'MKCOL https://dav.example.com/dav/a',
      'MKCOL https://dav.example.com/dav/a/b',
      'PROPFIND https://dav.example.com/dav/a/b',
    ])
  })

  it('test：目录已存在（405）也算建成功路径走通', async () => {
    const { net } = davNet([{ status: 404 }, { status: 405 }, { status: 207 }])
    expect((await createDavClient({ ...cfg, net }).test()).ok).toBe(true)
  })

  it('needsAttachmentPull：远端没有 / 一致 / 换过 / 已清理', () => {
    // 本地没有 ⇒ 拉
    expect(needsAttachmentPull(null, { fp: 'a' })).toBe(true)
    // 指纹一致 ⇒ 不拉
    expect(needsAttachmentPull('a', { fp: 'a' })).toBe(false)
    // **远端换过同一路径的内容 ⇒ 拉**（旧代码只看文件在不在，这里会漏）
    expect(needsAttachmentPull('a', { fp: 'b' })).toBe(true)
    // 中转模式已清理 ⇒ 不拉
    expect(needsAttachmentPull('a', { fp: 'b', cleaned: true })).toBe(false)
    expect(needsAttachmentPull('a', null)).toBe(false)
  })

  it('fmtMs：毫秒与秒的分界写法', () => {
    expect(fmtMs(0)).toBe('0 毫秒')
    expect(fmtMs(320)).toBe('320 毫秒')
    expect(fmtMs(999)).toBe('999 毫秒')
    expect(fmtMs(1200)).toBe('1.2 秒')
    expect(fmtMs(12345)).toBe('12 秒')
    expect(fmtMs(NaN)).toBe('—')
    expect(fmtMs(-1)).toBe('—')
  })
})

/* ─────────────── rev173.119 · 耗时历史与趋势 ─────────────── */

describe('耗时历史与趋势（rev173.119）', () => {
  it('pushTiming：追加；超过上限丢最早的', () => {
    let h: Array<{ total: number }> = []
    h = pushTiming(h, { total: 1 }, 3)
    h = pushTiming(h, { total: 2 }, 3)
    expect(h.map((e) => e.total)).toEqual([1, 2])

    const limited = [1, 2, 3, 4].reduce<Array<{ total: number }>>((acc, n) => pushTiming(acc, { total: n }, 3), [])
    expect(limited.map((e) => e.total)).toEqual([2, 3, 4])
  })

  it('pushTiming：坏数据（非数组 / null 条目）不炸', () => {
    expect(pushTiming(null, { total: 5 }, 3).map((e) => e.total)).toEqual([5])
    expect(pushTiming([null, { total: 1 }], { total: 2 }, 3).map((e) => e.total)).toEqual([1, 2])
  })

  it('timingSummary：空 ⇒ null；有记录 ⇒ 平均与最慢；坏条目忽略', () => {
    expect(timingSummary([])).toBeNull()
    expect(timingSummary(null)).toBeNull()
    expect(timingSummary([{ total: 100 }, { total: 300 }])).toEqual({ count: 2, avg: 200, max: 300 })
    expect(timingSummary([{ total: 100 }, { total: 'x' }, null])).toEqual({ count: 1, avg: 100, max: 100 })
  })

  it('sparkline：条数 = 数值个数；全相等用中间档；空 ⇒ 空串', () => {
    expect([...sparkline([100, 200, 300])].length).toBe(3)
    expect(sparkline([5, 5, 5])).toBe('▄▄▄')
    expect(sparkline([])).toBe('')
  })

  it('sparkline：只取最后 width 个（早期慢轮不该压扁当前的波形）', () => {
    expect([...sparkline([999, 1, 2, 3], 3)].length).toBe(3)
    // 异常数据（全 0 / 负数）也不抛
    expect(sparkline([0, 0])).toBe('▁▁')
  })
})

/** 递归收集 UINode 树里所有 badge 的文本（断言面板真的画了耗时） */
function collectBadges(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out
  const n = node as { type?: string; text?: string; children?: unknown[] }
  if (n.type === 'badge' && typeof n.text === 'string') out.push(n.text)
  if (Array.isArray(n.children)) for (const c of n.children) collectBadges(c, out)
  return out
}

/** 递归收集 UINode 树里的字符串内容（text.value / code.value） */
function collectTexts(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out
  const n = node as { value?: unknown; children?: unknown[] }
  if (typeof n.value === 'string') out.push(n.value)
  if (Array.isArray(n.children)) for (const c of n.children) collectTexts(c, out)
  return out
}

describe('同步的实际行为（rev173.117）', () => {
  it('第二轮不重读没变过的附件，面板给出耗时拆分', async () => {
    const store = new Map<string, unknown>()
    const commands = new Map<string, (payload?: unknown) => unknown>()
    let render: ((ctx: { state?: Record<string, string> }) => unknown) | null = null
    const readBytesCalls: string[] = []
    /** 本地附件的当前状态（第三轮改它，模拟「用户换了同一路径的图」） */
    const local = { mtime: Date.now() - 60_000, size: 3, bytes: new Uint8Array([1, 2, 3]) }
    /** 远端 manifest 的持久状态（PUT 写、GET 读；带 ETag 让第二轮能走 304） */
    let manifestBody = ''
    let manifestVersion = 0
    const net = {
      fetch: async (spec: { url: string; method: string; headers?: Record<string, string>; body?: unknown }) => {
        if (spec.method === 'GET' && spec.url.endsWith('_zn/manifest.json')) {
          if (!manifestBody) {
            return { status: 404, headers: {}, text: async () => '', bytes: async () => new Uint8Array() }
          }
          if (spec.headers?.['If-None-Match'] === `"m${manifestVersion}"`) {
            return { status: 304, headers: { etag: `"m${manifestVersion}"` }, text: async () => '', bytes: async () => new Uint8Array() }
          }
          return {
            status: 200,
            headers: { etag: `"m${manifestVersion}"` },
            text: async () => manifestBody,
            bytes: async () => new TextEncoder().encode(manifestBody),
          }
        }
        if (spec.method === 'PUT' && spec.url.endsWith('_zn/manifest.json')) {
          manifestBody = String(spec.body ?? '')
          manifestVersion += 1
          return { status: 201, headers: { etag: `"m${manifestVersion}"` }, text: async () => '', bytes: async () => new Uint8Array() }
        }
        // MKCOL / PUT relay 文件 / PROPFIND：一律 201
        return { status: 201, headers: {}, text: async () => '', bytes: async () => new Uint8Array() }
      },
    }
    const api = {
      host: {
        platform: 'windows',
        log: () => {},
        notify: () => {},
        secrets: { get: async () => 'p', set: async () => {}, delete: async () => {} },
      },
      fs: {
        listNotes: async () => [
          { path: 'a.png', id: 'a', title: 'a', mtime: local.mtime, size: local.size, frontmatter: {}, kind: 'doc' },
        ],
        readBytes: async (p: string) => {
          readBytesCalls.push(p)
          return local.bytes
        },
        writeBytes: async () => {},
        readText: async () => '',
        writeText: async () => {},
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
      subscriptions: [] as Array<{ dispose?: () => void }>,
    }
    plugin.apply(api as never)
    await new Promise((r) => setTimeout(r, 0))

    const state = {
      'sync.baseUrl': 'https://dav.example/dav/',
      'sync.username': 'u',
      'sync.root': 'ZeroNote',
      'sync.attachmentsMode': 'relay',
    }
    render!({ state })
    await commands.get('sync-webdav.save')!()
    await commands.get('sync-webdav.set-attachments')!({ value: 'relay' })

    // 第一轮：附件要上传 ⇒ 读一次字节
    await commands.get('sync-webdav.sync')!()
    expect(readBytesCalls).toEqual(['a.png'])

    // 第二轮：manifest 304 + 附件指纹命中 ⇒ 一次都不再读盘
    await commands.get('sync-webdav.sync')!()
    expect(readBytesCalls).toEqual(['a.png'])

    // 第三轮：本地换图（mtime 变新，且**晚于**远端条目的上传时间）⇒ 本机算「改过」⇒ 上传 + 记耗时
    local.mtime = Date.now() + 60_000
    local.bytes = new Uint8Array([9, 9, 9])
    await commands.get('sync-webdav.sync')!()
    // 只读一次：算指纹时读到的字节被上传复用（先拉后推也不能多读一遍）
    expect(readBytesCalls).toEqual(['a.png', 'a.png'])

    // 面板画了耗时（总 + 阶段），并且画出了「最近 2 次」的趋势
    const ui = render!({ state })
    const badges = collectBadges(ui)
    expect(badges.some((t) => t.startsWith('用时 '))).toBe(true)
    expect(badges.some((t) => t.startsWith('manifest '))).toBe(true)
    // 三轮都是手动同步 ⇒ 手动轮一律进历史（无变化的静默轮才跳过）
    const texts = collectTexts(ui)
    expect(texts.some((t) => t.startsWith('最近 3 次'))).toBe(true)

    for (const s of api.subscriptions) s.dispose?.()
  })
})



/**
 * rev173.127 · 双设备：附件方向判定。
 *
 * 场景：A 上传 v1 → B 拉下来后换图成 v2 并上传 → A 再同步。
 * 修前（先推后拉）：A 会先把自己的 v1 推回远端、再拉回来，永远停在 v1（谁后同步谁赢）。
 * 修后（先拉后推 + mtime/at 方向判定）：A 认「远端条目比本地新」⇒ 直接拉 v2。
 */
describe('双设备：附件方向（rev173.127）', () => {
  function makeDav() {
    const files = new Map<string, { bytes: Uint8Array; etag: string }>()
    /** 请求流水（断言「A 有没有把旧图推回去」时用） */
    const requests: string[] = []
    let ver = 0
    const asBytes = (body: unknown): Uint8Array => {
      if (typeof body === 'string') return new TextEncoder().encode(body)
      if (body instanceof Uint8Array) return body
      return new Uint8Array()
    }
    // 内核 `net.fetch` 的响应体是**同步**方法（体已预读好）—— mock 也必须同步，
    // 否则 `normalizeManifest(res.text())` 拿到的是 Promise（解析成空表，且不报错）
    const emptyText = () => ''
    const emptyBytes = () => new Uint8Array()
    const net = {
      fetch: async (spec: { url: string; method: string; headers?: Record<string, string>; body?: unknown }) => {
        const method = String(spec.method ?? 'GET').toUpperCase()
        const p = decodeURIComponent(new URL(spec.url).pathname).replace(/^\/dav\/ZeroNote\/?/, '')
        requests.push(`${method} ${p}`)
        const hdr = (etag: string) => ({ etag })
        if (method === 'PROPFIND') return { status: 207, headers: {}, text: emptyText, bytes: emptyBytes }
        if (method === 'MKCOL') return { status: 201, headers: {}, text: emptyText, bytes: emptyBytes }
        if (method === 'DELETE') {
          files.delete(p)
          return { status: 204, headers: {}, text: emptyText, bytes: emptyBytes }
        }
        if (method === 'GET') {
          const f = files.get(p)
          if (!f) return { status: 404, headers: {}, text: emptyText, bytes: emptyBytes }
          if (spec.headers?.['If-None-Match'] && spec.headers['If-None-Match'] === f.etag) {
            return { status: 304, headers: hdr(f.etag), text: emptyText, bytes: emptyBytes }
          }
          return {
            status: 200,
            headers: hdr(f.etag),
            text: () => new TextDecoder().decode(f.bytes),
            bytes: () => f.bytes,
          }
        }
        if (method === 'PUT') {
          ver += 1
          files.set(p, { bytes: asBytes(spec.body), etag: `"e${ver}"` })
          return { status: 201, headers: hdr(`"e${ver}"`), text: emptyText, bytes: emptyBytes }
        }
        return { status: 500, headers: {}, text: emptyText, bytes: emptyBytes }
      },
    }
    return { files, net, requests }
  }

  function makeDevice(net: unknown, platform: string) {
    const files = new Map<string, Uint8Array>()
    const mtimes = new Map<string, number>()
    const store = new Map<string, unknown>()
    const commands = new Map<string, (p?: unknown) => unknown>()
    const notices: string[] = []
    let render: ((ctx: { state?: Record<string, string> }) => unknown) | null = null
    const api = {
      host: {
        platform,
        log: () => {},
        notify: (m: string) => { notices.push(m) },
        secrets: { get: async () => 'p', set: async () => {}, delete: async () => {} },
      },
      fs: {
        listNotes: async () =>
          [...files.keys()].map((p) => ({
            path: p,
            id: p,
            title: p,
            mtime: mtimes.get(p) ?? 0,
            size: files.get(p)?.length ?? 0,
            frontmatter: {},
            kind: 'doc',
          })),
        readBytes: async (p: string) => files.get(p) ?? new Uint8Array(),
        writeBytes: async (p: string, b: Uint8Array) => {
          files.set(p, b)
          mtimes.set(p, Date.now())
        },
        readText: async () => '',
        writeText: async () => {},
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
      subscriptions: [] as Array<{ dispose?: () => void }>,
    }
    plugin.apply(api as never)
    return {
      files,
      commands,
      notices,
      render: () => render,
      setLocal: (p: string, bytes: Uint8Array, mtime: number) => {
        files.set(p, bytes)
        mtimes.set(p, mtime)
      },
      dispose: () => {
        for (const s of api.subscriptions) s.dispose?.()
      },
    }
  }

  async function configure(dev: ReturnType<typeof makeDevice>) {
    // 等启动 IIFE 读完 store，再走真实的「保存设置 / 设置附件模式」命令
    await new Promise((r) => setTimeout(r, 0))
    dev.render()!({
      state: {
        'sync.baseUrl': 'https://dav.example/dav/',
        'sync.username': 'u',
        'sync.root': 'ZeroNote',
        'sync.attachmentsMode': 'full',
      },
    })
    await dev.commands.get('sync-webdav.save')!()
    await dev.commands.get('sync-webdav.set-attachments')!({ value: 'full' })
  }

  it('对端换图 ⇒ 本机拉新图，而不是把旧图推回去', async () => {
    const { files: dav, net, requests } = makeDav()
    const A = makeDevice(net, 'windows')
    const B = makeDevice(net, 'mac')
    await configure(A)
    await configure(B)

    const v1 = new Uint8Array([1, 1, 1])
    const v2 = new Uint8Array([2, 2, 2])

    // A 有图（一分钟前）⇒ 推上去
    A.setLocal('图.png', v1, Date.now() - 60_000)
    await A.commands.get('sync-webdav.sync')!({})
    expect(dav.get('图.png')?.bytes).toEqual(v1)

    // B 空库 ⇒ 拉下来
    await B.commands.get('sync-webdav.sync')!({})
    expect(B.files.get('图.png')).toEqual(v1)

    // B 换图（比远端条目新）⇒ 推上去
    B.setLocal('图.png', v2, Date.now() + 60_000)
    await B.commands.get('sync-webdav.sync')!({})
    expect(dav.get('图.png')?.bytes).toEqual(v2)

    // A 再同步：应当拉 v2，且**没有**把 v1 推回远端
    const before = requests.length
    await A.commands.get('sync-webdav.sync')!({})
    expect(A.files.get('图.png')).toEqual(v2)
    expect(dav.get('图.png')?.bytes).toEqual(v2)
    const round = requests.slice(before)
    expect(round.some((r) => r.startsWith('GET 图.png'))).toBe(true)
    // 关键：这一轮不能有「PUT 图.png」（旧版推回去就是这条）
    expect(round.some((r) => r.startsWith('PUT 图.png'))).toBe(false)

    A.dispose()
    B.dispose()
  })
})





