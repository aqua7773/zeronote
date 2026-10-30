/**
 * 同步后端 · S3 兼容存储（s3）—— rev173.287（从 `examples/sync-s3` 并入）
 *
 * 对象存储没有目录、没有 PROPFIND：`_zn/manifest.json` 就是权威索引（与 WebDAV 同一个
 * 文件、同一个格式）。判定与冲突处理全部复用引擎，本文件只负责**协议**：
 *
 *  · AWS SigV4 签名（自己实现，不引 SDK —— 插件只有 `net` 原语，Tauri 里没有 Node SDK）
 *  · 对象读写（path-style：`<endpoint>/<bucket>/<key>`，兼容 MinIO / R2 / B2 / rclone）
 *  · `createS3Storage()` 把客户端**适配成 WebDAV 客户端的同一套方法名**，引擎因此不用改
 *
 * 纯函数 `signRequest` 用 **AWS 官方 SDK 的测试向量**验证（`tests/sync-s3.test.ts`）——
 * 不是自签自验：改错一个字节测试就红。
 *
 * ## 与 WebDAV 的三个差别（决定了实现形态）
 *
 * 1. **没有目录** ⇒ `mkdir` 是空操作（键是平的）。
 * 2. **没有 304 / If-None-Match** ⇒ manifest 每轮全量读（几 KB，可接受）；
 *    附件的 ETag 只用来做「内容没变就不覆盖」的判断，不省传输。
 * 3. **条件写（If-Match）支持参差**：AWS 2024 起支持，很多兼容实现不支持 ⇒
 *    不支持的实现会忽略该头，行为退化成「不做乐观锁」，冲突仍由 manifest 指纹判定拦住。
 */
const { MANIFEST_REL, normalizeManifest } = require('../core.cjs')

/** 空 body 的 SHA-256（GET / HEAD / DELETE 的 payload hash） */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/* ───────────────────────── SigV4 纯函数 ───────────────────────── */

/**
 * RFC 3986 编码（SigV4 要求）。`encodeURIComponent` 少编 `!'()*` 这四个，
 * 漏掉它们会让签名与服务器算的对不上（且只在 key 含这些字符时才暴露，最难查）。
 */
function encodeRfc3986(s) {
  return encodeURIComponent(String(s ?? '')).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/**
 * S3 的 canonical URI：**逐段编码、保留 `/`、不做路径规范化**。
 *
 * S3 与其它 AWS 服务不同：路径**不能**二次编码，也不能把 `//` 折叠、不能解析 `..`
 * （对象键里真的可以有这些字符）。AWS SDK 的测试里就有这条断言
 * （`Key: 'a:b:c'` ⇒ `/a%3Ab%3Ac`）。
 */
function encodeS3Path(path) {
  const p = String(path ?? '')
  if (!p) return '/'
  return `/${p
    .split('/')
    .filter((seg, i) => i > 0 || seg !== '')
    .map((seg) => encodeRfc3986(seg))
    .join('/')}`
}

/** canonical query string：按键排序、名字与值都按 RFC3986 编码、空值保留 `=` */
function canonicalQuery(params) {
  const entries = Object.entries(params ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return entries.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(String(v))}`).join('&')
}

/**
 * canonical headers + signed headers。
 *
 * 三条必须做对（每条都对应一个「签名对不上但看不出为什么」）：
 * · 头名**转小写**排序；值里的连续空白压成一个空格、首尾去空白；
 * · 每个头都以 `\n` 结尾（canonical request 里 headers 块的最后也有一个空行）；
 * · `authorization` 自身不参与签名。
 */
function canonicalHeaders(headers) {
  const lower = {}
  for (const [k, v] of Object.entries(headers ?? {})) {
    const name = String(k).toLowerCase()
    if (name === 'authorization' || v === undefined || v === null) continue
    lower[name] = String(v).trim().replace(/\s+/g, ' ')
  }
  const names = Object.keys(lower).sort()
  const canon = names.map((n) => `${n}:${lower[n]}`).join('\n')
  return { canonicalHeaders: `${canon}\n`, signedHeaders: names.join(';') }
}

/** hex 编码（Uint8Array / ArrayBuffer） */
function toHex(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf ?? [])
  let out = ''
  for (let i = 0; i < u8.length; i += 1) out += u8[i].toString(16).padStart(2, '0')
  return out
}

const textEncoder = () => new TextEncoder()
const toBytes = (data) => (typeof data === 'string' ? textEncoder().encode(data) : data)

/** SHA-256（hex） */
async function sha256Hex(data) {
  const digest = await crypto.subtle.digest('SHA-256', toBytes(data))
  return toHex(digest)
}

/** HMAC-SHA256（返回字节） */
async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey('raw', toBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, toBytes(data)))
}

/** AWS 时间戳 → `20130524T000000Z` */
function amzDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/** AWS 时间戳 → `20130524`（凭证作用域的日期段） */
function amzDay(date) {
  return amzDate(date).slice(0, 8)
}

/**
 * 算一个 SigV4 签名（**纯计算**，不发请求）。
 *
 * @param {{
 *   method: string, path: string, query?: object, headers: object,
 *   payloadHash: string, region: string, service?: string,
 *   accessKey: string, secretKey: string, date: Date,
 * }} req
 * @returns {Promise<{ authorization: string, headers: object, canonicalRequest: string, stringToSign: string }>}
 */
async function signRequest(req) {
  const service = req.service || 's3'
  const date = req.date instanceof Date ? req.date : new Date(req.date)
  const stamp = amzDate(date)
  const day = amzDay(date)
  const payloadHash = req.payloadHash || EMPTY_SHA256

  /** 调用方传进来的头 + 三个必带头（覆盖写：同一请求里不能有两个 x-amz-date） */
  const headers = { ...(req.headers ?? {}) }
  headers['x-amz-date'] = stamp
  headers['x-amz-content-sha256'] = payloadHash

  const { canonicalHeaders: canonHeaders, signedHeaders } = canonicalHeaders(headers)
  const canonicalRequest = [
    req.method.toUpperCase(),
    encodeS3Path(req.path ?? ''),
    canonicalQuery(req.query),
    canonHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${day}/${req.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonicalRequest)].join('\n')

  const kDate = await hmacSha256(`AWS4${req.secretKey}`, day)
  const kRegion = await hmacSha256(kDate, req.region)
  const kService = await hmacSha256(kRegion, service)
  const kSigning = await hmacSha256(kService, 'aws4_request')
  const signature = toHex(await hmacSha256(kSigning, stringToSign))

  const signed = { ...headers, authorization: undefined }
  delete signed.authorization
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${req.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return { authorization, headers: { ...headers, Authorization: authorization }, canonicalRequest, stringToSign }
}

/* ───────────────────────── 响应解析 ───────────────────────── */

/** 取一个 XML 标签的文本（不引 DOMParser：各实现容错不同，正则够用） */
function pickTagText(xml, tag) {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(String(xml ?? ''))
  return m ? m[1].trim() : ''
}

function decodeXml(s) {
  return String(s ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * 解析 `ListBucketResult` 的 XML。
 *
 * @returns {{ items: { key: string, size: number, etag: string|null }[], truncated: boolean, token: string|null }}
 */
function parseListObjects(xml) {
  const raw = String(xml ?? '')
  const out = []
  const blockRe = /<Contents\b[^>]*>([\s\S]*?)<\/Contents>/gi
  let m
  while ((m = blockRe.exec(raw))) {
    const body = m[1]
    const key = pickTagText(body, 'Key')
    if (!key) continue
    out.push({
      key: decodeXml(key),
      size: Number(pickTagText(body, 'Size') || 0),
      etag: pickTagText(body, 'ETag') ? decodeXml(pickTagText(body, 'ETag')) : null,
    })
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(raw)
  const token = pickTagText(raw, 'NextContinuationToken')
  return { items: out, truncated, token: token ? decodeXml(token) : null }
}

/* ───────────────────────── S3 客户端 ───────────────────────── */

/**
 * S3 客户端（path-style：`<endpoint>/<bucket>/<key>`）。
 *
 * 为什么是 path-style：virtual-hosted 需要 `bucket.s3.amazonaws.com` 这类 DNS，
 * 而 MinIO / R2 / 自建网关大多用 path-style —— 兼容面更宽。
 *
 * @param {{ endpoint: string, region?: string, bucket: string, accessKey: string, secretKey: string, prefix?: string, net: object }} cfg
 * @param {{ date?: () => Date }} [opts] 注 `date` 只是为了让测试可复现
 */
function createS3Client(cfg, opts = {}) {
  const endpoint = String(cfg.endpoint ?? '').replace(/\/+$/, '')
  const base = new URL(endpoint)
  const region = cfg.region || 'us-east-1'
  const bucket = String(cfg.bucket ?? '').replace(/^\/+|\/+$/g, '')
  const prefix = String(cfg.prefix ?? '').replace(/^\/+|\/+$/g, '')
  const now = opts.date ?? (() => new Date())

  /** 对象键（含 prefix，不含 bucket） */
  const fullKey = (key) => [prefix, key].filter(Boolean).join('/')

  /**
   * 拼 URL。`p` 是**不含前导 `/` 的完整路径段串**（`bucket/…`），逐段编码。
   *
   * 前缀只进 query 的 `prefix` 参数、不进路径 —— 以前 `list()` / `test()` 传空 key，
   * 而 `fullKey('')` 会带上对象前缀 ⇒ 请求打到 `/桶/<前缀>` 上，前缀非空时连接测试
   * 与列对象直接 404（rev173.126 修）。
   */
  const urlFor = (p, query) => {
    const qs = query && Object.keys(query).length ? `?${canonicalQuery(query)}` : ''
    return `${endpoint}/${p
      .split('/')
      .map((seg) => encodeRfc3986(seg))
      .join('/')}${qs}`
  }

  /**
   * 发一个已签名的请求。
   *
   * **host 头参与签名但不显式发送**：HTTP 层会按 URL 自动带同一个值，
   * 而浏览器 / reqwest 都不允许手工设 Host。
   */
  async function request(method, key, { body, query, contentType, extraHeaders, bareBucket = false } = {}) {
    // `bareBucket`：桶根请求（连接测试 / 列对象）—— prefix 只进 query 的 `prefix` 参数，不进路径
    const path = bareBucket ? `/${bucket}` : `/${[bucket, fullKey(key)].filter(Boolean).join('/')}`
    const payloadHash =
      body === undefined || body === null ? EMPTY_SHA256 : await sha256Hex(body instanceof Uint8Array ? body : String(body))
    const headers = {
      host: base.host,
      ...(contentType ? { 'content-type': contentType } : {}),
      ...(extraHeaders ?? {}),
    }
    const signed = await signRequest({
      method,
      path,
      query,
      headers,
      payloadHash,
      region,
      service: 's3',
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
      date: now(),
    })
    const sendHeaders = { ...signed.headers }
    delete sendHeaders.host
    return cfg.net.fetch({
      url: urlFor(path.replace(/^\//, ''), query),
      method,
      headers: sendHeaders,
      body,
    })
  }

  return {
    endpoint,
    bucket,
    prefix,

    /** 连接测试：列 1 个对象（`max-keys=1`）—— 只验证签名与权限，不拉全表 */
    async test() {
      let res
      try {
        res = await request('GET', '', { query: { 'list-type': '2', 'max-keys': '1' }, bareBucket: true })
      } catch (e) {
        return { ok: false, status: 0, hint: `连不上：${String(e).slice(0, 120)}` }
      }
      if (res.status === 200) return { ok: true, status: 200, hint: '连接正常' }
      if (res.status === 401 || res.status === 403) {
        const body = String(res.text?.() ?? '')
        const code = pickTagText(body, 'Code')
        return { ok: false, status: res.status, hint: `密钥或权限不对（${res.status}${code ? ` ${code}` : ''}）` }
      }
      if (res.status === 404) return { ok: false, status: 404, hint: '桶不存在（404）——检查「桶名」' }
      if (res.status === 301 || res.status === 307) {
        return { ok: false, status: res.status, hint: `区域不对（${res.status}）——检查「区域」是否填对` }
      }
      return { ok: false, status: res.status, hint: `意外状态 ${res.status}` }
    },

    /** 读文本对象；不存在返回 `{text, etag}` / `null` */
    async get(key) {
      const res = await request('GET', key)
      if (res.status === 404) return null
      if (res.status >= 400) throw new Error(`下载失败（${res.status}）：${key}`)
      return { text: res.text(), etag: res.headers?.etag ?? null }
    },

    /** 读二进制；不存在返回 null */
    async getBytes(key) {
      const res = await request('GET', key)
      if (res.status === 404) return null
      if (res.status >= 400) throw new Error(`下载失败（${res.status}）：${key}`)
      return { data: res.bytes(), etag: res.headers?.etag ?? null }
    },

    /**
     * 写文本；返回 `{ ok, status, etag, precondition, conflict409 }`（4xx 不抛，调用方判断）。
     *
     * `opts.ifMatch` = 条件写：只有远端对象的 ETag 与它相等才写，否则 **412**。
     * 头参与 SigV4 签名（`request()` 把所有传入头都签）—— AWS 允许签额外头，值必须一致。
     */
    async put(key, text, opts = {}) {
      const body = typeof text === 'string' ? text : String(text ?? '')
      const extraHeaders = {}
      if (opts.ifMatch) extraHeaders['if-match'] = String(opts.ifMatch)
      /**
       * 空文本 PUT 必须显式带 `Content-Length: 0`。
       *
       * 根因在内核 `net_request`：reqwest 对空 Vec 的 body **既不设 Content-Length
       * 也不设 Transfer-Encoding**，而 rclone `serve s3` 对没有长度的 PUT 回
       * **411 Length Required** —— 表现为「手机端同步到一篇空笔记就永远卡住」。
       * 内核侧已补；这里兜一层，让旧内核也能同步空笔记。
       */
      if (body.length === 0) extraHeaders['content-length'] = '0'
      const res = await request('PUT', key, {
        body,
        contentType: opts.contentType ?? 'text/markdown; charset=utf-8',
        extraHeaders,
      })
      const ok = res.status === 200 || res.status === 201 || res.status === 204
      return {
        ok,
        status: res.status,
        etag: res.headers?.etag ?? null,
        /** 412 = ETag 不匹配（远端被绕过 manifest 改过 / 另一台刚写过） */
        precondition: res.status === 412,
        /** 409 ConditionalRequestConflict = 同一对象并发写撞车（AWS 要求取新 ETag 重试） */
        conflict409: res.status === 409,
      }
    },

    async putBytes(key, bytes) {
      const res = await request('PUT', key, { body: bytes, contentType: 'application/octet-stream' })
      return {
        ok: res.status === 200 || res.status === 201 || res.status === 204,
        status: res.status,
        etag: res.headers?.etag ?? null,
      }
    },

    /** 删一个对象（404 也算成功 —— 幂等） */
    async remove(key) {
      const res = await request('DELETE', key)
      return { ok: [200, 204, 404].includes(res.status), status: res.status }
    },

    /**
     * 对象是否存在（中转 ack 用）。
     *
     * 正常走 `HEAD`；个别实现不实现 HEAD（405/501）⇒ 回退 GET；
     * 只判存在性，别的状态一律当「不存在」（下一轮会再试，不会误删）。
     */
    async exists(key) {
      const res = await request('HEAD', key)
      if (res.status === 200) return true
      if (res.status === 404) return false
      if (res.status === 405 || res.status === 501) {
        const g = await request('GET', key)
        return g.status === 200
      }
      return false
    },

    /**
     * 列对象（自动翻页）。返回的 `key` 已剥掉插件的 `prefix` ——
     * 否则喂回 `get/put/remove` 会被再拼一次前缀（表现为「清理跑完远端还剩对象」）。
     */
    async list(listPrefix = '') {
      const all = []
      let token = null
      const rel = (k) => {
        if (!prefix) return k
        if (k === prefix) return ''
        return k.startsWith(`${prefix}/`) ? k.slice(prefix.length + 1) : k
      }
      for (let page = 0; page < 50; page += 1) {
        const query = { 'list-type': '2', 'max-keys': '1000' }
        const p = [prefix, listPrefix].filter(Boolean).join('/')
        if (p) query.prefix = p
        if (token) query['continuation-token'] = token
        const res = await request('GET', '', { query, bareBucket: true })
        if (res.status !== 200) throw new Error(`列对象失败（${res.status}）`)
        const parsed = parseListObjects(res.text())
        all.push(...parsed.items.map((it) => ({ ...it, key: rel(it.key) })))
        if (!parsed.truncated || !parsed.token) break
        token = parsed.token
      }
      return all
    },
  }
}

/**
 * 把 S3 客户端适配成 **WebDAV 客户端的同一套方法名**（`get` 返回文本、`readManifest`
 * 返回 `{files, attachments, private, privateTree, etag, notModified}` …）。
 *
 * 这样引擎只有一份，换后端只换 `makeClient()` 的返回 —— 不用在每个调用点写分支。
 */
function createS3Storage(cfg, opts = {}) {
  const c = createS3Client(cfg, opts)
  return {
    kind: 's3',
    test: () => c.test(),
    list: (rel = '') => c.list(rel),
    async get(rel) {
      const got = await c.get(rel)
      return got ? got.text : null
    },
    /**
     * 读文本 + 它的 ETag（412 冲突收尾要用：把远端最新版对齐进本机基线时，
     * 新基线必须带上远端对象的真实 etag，否则下一轮又拿旧 etag 撞 412）。
     */
    async getWithEtag(rel) {
      const got = await c.get(rel)
      return got ? { text: got.text, etag: got.etag ?? undefined } : null
    },
    /**
     * 写文本；带 `ifMatch` 时若服务端把条件写**当坏请求**（400 / 501）就重试一次不带条件。
     *
     * AWS / MinIO 支持 `If-Match`，但一些自建网关与旧实现直接拒 400 —— 不能让整个同步
     * 挂在「服务端不认识这个头」上。降级后行为退回到「不做乐观锁」，冲突仍由 manifest
     * 指纹判定拦住（这是 rev173.129 的老需求，并进统一引擎后放在这一层，引擎不用改）。
     */
    async put(rel, text, ifMatch) {
      const r = await c.put(rel, text, { ifMatch })
      if (ifMatch && (r.status === 400 || r.status === 501)) return c.put(rel, text, {})
      return r
    },
    /** 对象存储没有目录：建"目录"是空操作 */
    async mkdir() {},
    /**
     * 读 manifest。S3 没有 `If-None-Match` / 304，所以永远全量读（几 KB）——
     * `ifNoneMatch` 参数保留只是为了与 WebDAV 签名一致。
     */
    async readManifest() {
      const got = await c.get(MANIFEST_REL)
      if (!got) {
        return { files: {}, attachments: {}, private: {}, privateTree: {}, etag: null, notModified: false }
      }
      const m = normalizeManifest(got.text)
      return { ...m, etag: got.etag ?? null, notModified: false }
    },
    async writeManifest(manifest) {
      const body = JSON.stringify({
        version: 1,
        files: manifest.files ?? {},
        attachments: manifest.attachments ?? {},
        private: manifest.private ?? {},
        privateTree: manifest.privateTree ?? {},
      })
      // 不做条件写：manifest 是「尽力而为」的索引，真冲突靠每篇文件的 etag 兜
      return c.put(MANIFEST_REL, body)
    },
    async getBytes(rel) {
      const got = await c.getBytes(rel)
      if (!got) return { data: null, notModified: false, etag: null }
      return { data: got.data, notModified: false, etag: got.etag ?? null }
    },
    putBytes: (rel, bytes) => c.putBytes(rel, bytes),
    remove: (rel) => c.remove(rel),
    exists: (rel) => c.exists(rel),
  }
}

module.exports = {
  EMPTY_SHA256,
  amzDate,
  amzDay,
  canonicalHeaders,
  canonicalQuery,
  createS3Client,
  createS3Storage,
  decodeXml,
  encodeRfc3986,
  encodeS3Path,
  hmacSha256,
  parseListObjects,
  pickTagText,
  sha256Hex,
  signRequest,
  toHex,
}
