/**
 * 同步 · S3 兼容后端（`sync-s3`）—— rev173.121 · 同步二期第三个后端
 *
 * ## 为什么是这套形态
 *
 * 用户 2026-10-24 拍板「仿 NoteGen 做多种后端，让用户自己选」；方案见
 * `docs/同步插件-调研与方案-2026-10-24.md` §5.0（多后端抽象）与 §5 表格里 S3 那行。
 *
 * 与 `sync-webdav` 的关系：**同一条同步引擎换了一个存储层**。
 * 不共享代码（插件之间不能 import），判定纯函数各存一份 —— 与 `sync-folder` 的做法一致，
 * 单测里有「两边判据一致」的断言兜着，任何一边改了算法都会红。
 *
 * ## S3 与 WebDAV 的三个关键差别（决定了实现形态）
 *
 * 1. **没有目录、没有 PROPFIND**：对象存储的键是平的。`_zn/manifest.json` 就是权威索引
 *    （与 WebDAV 版同一个文件、同一个格式），**不 list 桶** —— 列全桶在大桶上很贵，
 *    而且我们的同步语义本来就只需要"知道哪些篇变了"。
 * 2. **强一致**：S3 自 2020-12 起提供强一致的读后写；MinIO / R2 / B2 也是。
 *    这意味着"先写对象、再写 manifest"的中间态在下一轮会被读回来纠正。
 * 3. **条件写（`If-Match`）支持参差**：AWS 2024 起支持 conditional writes，
 *    但很多 S3 兼容实现不支持。所以这里**默认不用 `If-Match`**，
 *    冲突判定完全靠 manifest 的指纹（与 WebDAV 版同一个判据），
 *    服务端支持时靠 manifest 的 `etag` 兜一层 —— 见 `decideSync` 的注释。
 *    **rev173.129**：笔记 PUT 在「远端已有这篇且 manifest 记了 etag」时带 `If-Match`
 *    （412 ⇒ 走冲突处理并刷新 manifest；409 ⇒ 取新 ETag 重试一次）。
 *    不支持该头的实现会忽略它 ⇒ 行为与以前一致；`push-new` 仍不带条件。
 *
 * ## 签名
 *
 * 自己实现 AWS SigV4（不引 SDK：插件的 `net` 原语只发请求，Tauri 里没有 Node SDK 可用）。
 * 纯函数 `signRequest` 用 **AWS 官方 SDK 的测试向量**验证（`tests/sync-s3.test.ts`）——
 * 不是"自签自验"，改错一个字节测试就红。
 */

/* ───────────────────────── 常量 ───────────────────────── */

const PANEL_ID = 'sync-s3.status'
const KEY_SETTINGS = 'settings.v1'
const KEY_BASELINE = 'baseline.v1'
const KEY_CONFLICTS = 'conflicts.v1'
const KEY_DEVICE = 'device.v1'
const KEY_TIMING = 'timing.v1'
const SECRET_KEY = 'sync.s3.secret'
/** 云端的权威索引（与 WebDAV 版同一个键名与格式） */
const MANIFEST_KEY = '_zn/manifest.json'
const CONFLICT_ROOT = '.zn/conflicts'

/**
 * **私有文件**清单（rev173.164 · 期 1c）：库内 `.zn/` 下的密文，不是 `.md`、`listNotes` 拿不到。
 *
 * 密码库要**两个**文件一起搬：`secrets.zn`（数据密文）+ `vault.json`（KDF salt 与被主密码
 * 包裹的 DEK）。少了后者，另一台设备拿到密文也解不开。两者都不含明文。
 */
/**
 * 私有文件清单（rev173.164 · 期 1c；**rev173.182 按环拆 vault**）。
 *
 * `vault.<环>.json` 各是一个同步单元 —— 两台设备各改一个环的密码（重包裹 DEK）时
 * 不会同时改同一个文件，也就不会互相覆盖。旧单文件 `vault.json` 留在清单里兼容
 * 还没迁移的库（迁移完成后它消失，分支自然变成 no-op）。
 */
export const PRIVATE_FILES = [
  '.zn/secrets/secrets.zn',
  '.zn/security/vault.notes.json',
  '.zn/security/vault.secrets.json',
  '.zn/security/vault.json',
]
/** 私密文件夹的根文件（不在 notes/ 或 trash/ 里） */
export const PRIVATE_ROOT_FILES = ['.zn/private/index.zn']
/** 私密文件夹的目录树（数量可变 ⇒ 逐个文件走 `decideTreeAction`） */
export const PRIVATE_DIRS = ['.zn/private/notes', '.zn/private/trash']

/**
 * 私密树单个文件的同步方向（**纯函数**）。语义与 `sync-webdav` 的同名函数逐字一致
 * （那份有完整测试），这里复制一份是因为插件之间不能共享代码。
 */
export function decideTreeAction(localFp, remoteFp, baseFp) {
  const l = localFp || null
  const r = remoteFp || null
  const b = baseFp || null
  if (l === r) return 'noop'
  if (!l && r) return b ? 'delete-remote' : 'pull'
  if (l && !r) return b ? 'delete-local' : 'push'
  const localChanged = l !== b
  const remoteChanged = r !== b
  if (!b) return 'conflict'
  if (remoteChanged && !localChanged) return 'pull'
  if (localChanged && !remoteChanged) return 'push'
  return 'conflict'
}
const MAX_CONFLICTS = 100
const MAX_TIMING = 50
const MAX_FILES_PER_RUN = 200
const AUTO_MS = 5000
/** 空 body 的 SHA-256（GET / HEAD / DELETE 的 payload hash） */
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/* ───────────────────────── 纯函数（单测覆盖） ───────────────────────── */

/** 内容指纹：长度 + FNV-1a（与 sync-webdav / sync-folder 同一套，三边互认） */
export function fingerprint(text) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `${s.length.toString(36)}:${h.toString(36)}`
}

/** 二进制指纹（附件用；逐字节，不能拿 UTF-16 码元那份用） */
export function fingerprintBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? [])
  let h = 0x811c9dc5
  for (let i = 0; i < u8.length; i += 1) {
    h ^= u8[i]
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `${u8.length.toString(36)}:${h.toString(36)}`
}

/**
 * RFC 3986 编码（SigV4 要求）。`encodeURIComponent` 少编 `!'()*` 这四个，
 * 漏掉它们会让签名与服务器算的对不上（且只在 key 含这些字符时才暴露，最难查）。
 */
export function encodeRfc3986(s) {
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
export function encodeS3Path(path) {
  const p = String(path ?? '')
  if (!p) return '/'
  return `/${p
    .split('/')
    .filter((seg, i) => i > 0 || seg !== '')
    .map((seg) => encodeRfc3986(seg))
    .join('/')}`
}

/** canonical query string：按键排序、名字与值都按 RFC3986 编码、空值保留 `=` */
export function canonicalQuery(params) {
  const entries = Object.entries(params ?? {})
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return entries.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(String(v))}`).join('&')
}

/**
 * canonical headers + signed headers。
 *
 * 三条必须做对（每条都对应一个"签名对不上但看不出为什么"）：
 * · 头名**转小写**排序；值里的连续空白压成一个空格、首尾去空白；
 * · 每个头都以 `\n` 结尾（canonical request 里 headers 块的最后也有一个空行）；
 * · `authorization` 自身不参与签名。
 */
export function canonicalHeaders(headers) {
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
export function toHex(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf ?? [])
  let out = ''
  for (let i = 0; i < u8.length; i += 1) out += u8[i].toString(16).padStart(2, '0')
  return out
}

const textEncoder = () => new TextEncoder()
const toBytes = (data) => (typeof data === 'string' ? textEncoder().encode(data) : data)

/** SHA-256（hex） */
export async function sha256Hex(data) {
  const digest = await crypto.subtle.digest('SHA-256', toBytes(data))
  return toHex(digest)
}

/** HMAC-SHA256（返回字节） */
export async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey(
    'raw',
    toBytes(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, toBytes(data)))
}

/** AWS 时间戳 → `20130524T000000Z` */
export function amzDate(date) {
  const d = date instanceof Date ? date : new Date(date)
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/** AWS 时间戳 → `20130524`（凭证作用域的日期段） */
export function amzDay(date) {
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
export async function signRequest(req) {
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
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    stamp,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n')

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

/* ── 同步判定（与 sync-webdav 同一判据，各存一份） ── */

/**
 * 七种判定 —— 决定会不会丢字。`base` 是本机基线，`localFp` 是磁盘现在的指纹，
 * `remoteFp` 是 manifest 里记的远端指纹（没有这篇 ⇒ null）。
 *
 * **判据与 `sync-webdav` 逐字一致**（同一套七种组合，跨后端语义必须相同）。
 * 没有基线时（换设备 / store 被清）不再一律拉远端（rev173.128）：两边相同 ⇒ `noop`，
 * 两边不同 ⇒ `conflict` —— 本机版先留副本，不静默覆盖。
 */
export function decideSync({ base, localFp, remoteFp }) {
  const hasBase = !!base
  if (remoteFp == null) {
    if (!hasBase) return 'push-new'
    return base.fp === localFp ? 'remote-deleted' : 'conflict'
  }
  if (!hasBase) return localFp === remoteFp ? 'noop' : 'conflict'
  const localChanged = localFp !== base.fp
  const remoteChanged = remoteFp !== base.fp
  if (!localChanged && !remoteChanged) return 'noop'
  if (remoteChanged && !localChanged) return 'pull'
  if (!remoteChanged && localChanged) return 'push'
  return localFp === remoteFp ? 'noop' : 'conflict'
}

/**
 * 三方合并（与 sync-folder / sync-webdav 同一判据）。
 *
 * @param {{base: string|null, mine: string, theirs: string, mergeLines?: Function}} args
 */
export function tryAutoMerge({ base, mine, theirs, mergeLines }) {
  if (typeof base !== 'string' || !base) return null
  if (typeof mergeLines !== 'function') return null
  if (mine === theirs) return null
  if (mine === base) return null
  if (theirs === base) return null
  try {
    const out = mergeLines(base, mine, theirs)
    if (!out || typeof out.text !== 'string') return null
    if (out.conflicts > 0) return null
    const text = out.text
    if (text === mine || text === theirs) return null
    return { text, conflicts: out.conflicts ?? 0 }
  } catch {
    return null
  }
}

/** 冲突副本文件名（与另外两个同步插件同格式：`YYYY-MM-DD HHmm-标题.md`） */
export function conflictFileName(when, path) {
  const d = when instanceof Date ? when : new Date(when)
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`
  const base = String(path ?? '').split('/').pop() ?? '笔记.md'
  const name = /\.md$/i.test(base) ? base : `${base}.md`
  return `${stamp}-${name}`
}

/** 附件扩展名（含点，小写）；没有就空串 */
export function extOf(path) {
  const name = String(path ?? '').split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

/** 父目录（无父目录返回空串） */
export function dirOf(path) {
  const s = String(path ?? '')
  const i = s.lastIndexOf('/')
  return i > 0 ? s.slice(0, i) : ''
}

/** 算不算附件（非 Markdown、且不在 `.zn/` 里） */
export function isAttachment(path) {
  const s = String(path ?? '')
  if (!s) return false
  if (s.startsWith('.zn/') || s.split('/').includes('.zn')) return false
  return !/\.(md|markdown)$/i.test(s)
}

/**
 * 远端这条附件要不要拉到本地（rev173.126，与 `sync-webdav` 同一判据）。
 *
 * 只看「本地有没有这个路径」不够 —— 远端把**同一路径的图换掉**时本地会永远停在旧版本。
 * 现在按 manifest 的 `fp` 判：远端 `cleaned` 不拉 / 本地没有要拉 / 指纹不同要拉。
 *
 * @param {string|null} localFp 本地现有文件的指纹；没有这份就传 null
 * @param {{fp?: string, cleaned?: boolean}|null} remoteEntry
 */
export function needsAttachmentPull(localFp, remoteEntry) {
  if (!remoteEntry || remoteEntry.cleaned) return false
  if (!localFp) return true
  return localFp !== remoteEntry.fp
}

/**
 * 中转文件 / ack 标记的对象键（S3 的键是平的，这里仍按 `_zn/relay/…` 组织，与 WebDAV 版同构）。
 *
 * 指纹格式是 `<长度>:<散列>`，`:` 在 Windows 上会被当成 NTFS 备用数据流，一律换成 `-`；
 * 顺带避开 `/` `\` 这些在对象键里有路径含义的字符。
 */
export function relayName(fp, ext) {
  return `${String(fp ?? '').replace(/[:/\\]/g, '-')}${ext || ''}`
}

/**
 * 解析 manifest（与 WebDAV 版同一格式）。
 *
 * `{ version: 1, files: { [path]: { fp, etag?, at } }, attachments: { … } }`
 * 坏数据一律退成空表 —— 远端被别的东西覆盖过时，不要让整个同步崩掉。
 */
/**
 * 私密文件夹树段（rev173.182 · 期 3）：`{ rel: { fp, at } }`，数量可变。
 * 老 manifest 没有这一段 ⇒ 空对象（首轮全部当"新"推上去）。
 */
function privateTreeOf(j) {
  const out = {}
  const src = j && typeof j === 'object' && j.privateTree && typeof j.privateTree === 'object' ? j.privateTree : {}
  for (const [rel, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') continue
    if (typeof v.fp !== 'string' || !v.fp) continue
    out[rel] = { fp: v.fp, at: Number(v.at) || 0 }
  }
  return out
}

export function normalizeManifest(raw) {
  let j = raw
  if (typeof raw === 'string') {
    try {
      j = JSON.parse(raw)
    } catch {
      return { version: 1, files: {}, attachments: {}, private: {}, privateTree: {} }
    }
  }
  if (!j || typeof j !== 'object') return { version: 1, files: {}, attachments: {}, private: {}, privateTree: {} }
  const files = {}
  const src = j.files && typeof j.files === 'object' ? j.files : {}
  for (const [path, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') continue
    if (typeof v.fp !== 'string' || !v.fp) continue
    files[path] = {
      fp: v.fp,
      etag: typeof v.etag === 'string' ? v.etag : undefined,
      at: Number(v.at) || 0,
    }
  }
  const attachments = {}
  const srcAtt = j.attachments && typeof j.attachments === 'object' ? j.attachments : {}
  for (const [path, v] of Object.entries(srcAtt)) {
    if (!v || typeof v !== 'object') continue
    if (typeof v.fp !== 'string' || !v.fp) continue
    attachments[path] = {
      fp: v.fp,
      ext: typeof v.ext === 'string' ? v.ext : extOf(path),
      at: Number(v.at) || 0,
      ...(v.cleaned ? { cleaned: true } : {}),
      // `mode` 决定云端那份放在原路径还是 `_zn/relay/`（rev173.126）—— 丢了会让 relay 端找不到文件
      ...(v.mode === 'full' || v.mode === 'relay' ? { mode: v.mode } : {}),
    }
  }
  /**
   * 私有文件段（rev173.164 · 期 1c）：密码库密文 + 密钥元数据。
   * 它们不是 `.md`、又在 `.zn/` 下，`listNotes` 看不到，只能按固定清单单独搬。
   */
  const privateFiles = {}
  const srcPriv = j.private && typeof j.private === 'object' ? j.private : {}
  for (const [rel, v] of Object.entries(srcPriv)) {
    if (!v || typeof v !== 'object') continue
    if (typeof v.fp !== 'string' || !v.fp) continue
    privateFiles[rel] = { fp: v.fp, at: Number(v.at) || 0 }
  }
  return { version: 1, files, attachments, private: privateFiles, privateTree: privateTreeOf(j) }
}

/** 耗时给人看（与另外两个同步插件同一套写法） */
export function fmtMs(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1000) return `${Math.round(n)} 毫秒`
  if (n < 10000) return `${(n / 1000).toFixed(1)} 秒`
  return `${Math.round(n / 1000)} 秒`
}

/* ───────────────────────── S3 客户端 ───────────────────────── */

/**
 * 解析 `ListBucketResult` 的 XML（**不用 DOMParser**：happy-dom 与各实现的容错不同，
 * 与 `sync-webdav` 的 PROPFIND 解析同一套正则思路）。
 *
 * @returns {{ key: string, size: number, etag: string|null, truncated: boolean, token: string|null }[]}
 */
export function parseListObjects(xml) {
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
      truncated: false,
      token: null,
    })
  }
  const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(raw)
  const token = pickTagText(raw, 'NextContinuationToken')
  return { items: out, truncated, token: token ? decodeXml(token) : null }
}

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
 * S3 客户端（path-style：`<endpoint>/<bucket>/<key>`）。
 *
 * 为什么是 path-style：virtual-hosted 需要 `bucket.s3.amazonaws.com` 这类 DNS，
 * 而 MinIO / R2 / 自建网关大多用 path-style —— 兼容面更宽。
 *
 * @param {{ endpoint: string, region?: string, bucket: string, accessKey: string, secretKey: string, prefix?: string, net: object }} cfg
 * @param {{ date?: () => Date }} [opts] 注 `date` 只是为了让测试可复现
 */
export function createS3Client(cfg, opts = {}) {
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
   * rev173.126 起不再在这里拼 prefix —— 以前 `list()` / `test()` 传空 key，
   * 而 `fullKey('')` 会带上**对象前缀** ⇒ 请求打到 `/桶/<前缀>` 上，
   * 前缀非空时连接测试与列对象直接 **404**（rev173.125 验收时前缀是空的，没暴露）。
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
      body === undefined || body === null
        ? EMPTY_SHA256
        : await sha256Hex(body instanceof Uint8Array ? body : String(body))
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
    const res = await cfg.net.fetch({
      url: urlFor(path.replace(/^\//, ''), query),
      method,
      headers: sendHeaders,
      body,
    })
    return res
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
      if (res.status === 200) {
        return { ok: true, status: 200, hint: bucket ? '连接正常' : '连接正常（桶为空）' }
      }
      if (res.status === 401 || res.status === 403) {
        const body = String(res.text?.() ?? '')
        const code = pickTagText(body, 'Code')
        return {
          ok: false,
          status: res.status,
          hint: `密钥或权限不对（${res.status}${code ? ` ${code}` : ''}）`,
        }
      }
      if (res.status === 404) return { ok: false, status: 404, hint: '桶不存在（404）——检查「桶名」' }
      if (res.status === 301 || res.status === 307) {
        return { ok: false, status: res.status, hint: `区域不对（${res.status}）——检查「区域」是否填对` }
      }
      return { ok: false, status: res.status, hint: `意外状态 ${res.status}` }
    },

    /** 读文本对象；不存在返回 null */
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
     * `opts.ifMatch`（rev173.129）= 条件写：只有远端对象的 ETag 与它相等才写，否则 **412**。
     * 头参与 SigV4 签名（`request()` 把所有传入头都签）—— AWS 允许签额外头，值必须一致。
     */
    async put(key, text, opts = {}) {
      const body = typeof text === 'string' ? text : String(text ?? '')
      const extraHeaders = {}
      if (opts.ifMatch) extraHeaders['if-match'] = String(opts.ifMatch)
      /**
       * 空文本 PUT 必须显式带 `Content-Length: 0`（rev173.131）。
       *
       * 根因在内核 `net_request`：reqwest 对空 Vec 的 body **既不设 Content-Length
       * 也不设 Transfer-Encoding**（2026-10-25 抓包实测：`cl=null te=null bytes=0`），
       * 而 rclone `serve s3` 对没有长度的 PUT 回 **411 Length Required** ——
       * 表现为「手机端同步到一篇空笔记就永远卡住、每 5 秒重试同一篇」。
       * 内核侧已补显式 CL；这里再兜一层，让**已经装在别处的旧内核**也能同步空笔记。
       * 头参与签名（`request()` 全签），值 '0' 与实际一致，服务端验签不受影响。
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
     * 对象是否存在（rev173.126 中转 ack 用）。
     *
     * 正常走 `HEAD`（不传内容）。个别 S3 兼容实现不实现 HEAD（405/501）⇒ 回退 GET；
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
     * 列对象（自动翻页）。
     *
     * `listPrefix` 是**相对对象前缀**（相对插件的 `prefix` 设置）；返回的 `key` 也**剥掉了**
     * 插件的 `prefix`（rev173.126）—— 否则 `list()` 的结果喂回 `get/put/remove` 会被再拼一次前缀，
     * 实际打到 `<prefix>/<prefix>/…` 上（验收时表现为「清理跑完远端还剩对象」）。
     *
     * @returns {Promise<{ key: string, size: number, etag: string|null }[]>}
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

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    const platform = api.host.platform === 'android' ? 'android' : 'windows'

    let settings = {
      endpoint: '',
      region: 'us-east-1',
      bucket: '',
      accessKey: '',
      prefix: '',
      enabled: false,
      auto: true,
      /** 附件同步：off / relay / full（rev173.126；与 sync-webdav 同名同义） */
      attachments: 'off',
    }
    let baseline = {}
    /** 上一轮 manifest（带 etag；S3 不支持 304，这层只用于「本轮远端没改」的比对） */
    let manifestCache = null
    let conflicts = []
    let timingHistory = []
    let lastResult = null
    let formError = null
    let ready = false
    let busy = false
    /** 表单镜像（`input.bind` 只写 ViewCtx.state，`command.run` 拿不到 ctx） */
    let form = { endpoint: '', region: '', bucket: '', accessKey: '', password: '', prefix: '' }
    /** 进程内已确认存在「同步点」的路径（同 webdav：只放内存，丢了只是多写一次） */
    const baseMarked = new Set()
    /**
     * 附件指纹缓存（rev173.126）：`mtime` + `size` 没变就复用上次的散列。
     * 自动同步每 5 秒一轮，附件多的时候每轮把所有图片重新读一遍 + 重算散列是纯浪费。
     * 只放内存；刚写完的文件会被删掉，下一轮重算。
     */
    const attFpCache = new Map()
    let savedSecret = null

    const markDirty = () => {
      void api.store.set(KEY_SETTINGS, settings).catch((e) => api.host.log('warn', `S3 设置写入失败：${String(e)}`))
    }

    async function secret() {
      if (savedSecret !== null) return savedSecret
      try {
        savedSecret = (await api.host.secrets.get(SECRET_KEY)) ?? ''
      } catch {
        savedSecret = ''
      }
      return savedSecret
    }

    const markBase = async (path, text) => {
      try {
        const history = await api.service.consume('history')
        if (!history || typeof history.snapshot !== 'function') return
        await history.snapshot(path, text, { tag: 'sync:s3' })
      } catch (e) {
        api.host.log('warn', `同步点写入失败（${path}）：${String(e)}`)
      }
    }

    /** 三方合并：base 来自 history 的同步点 */
    async function autoMerge(client, path, localText) {
      try {
        const history = await api.service.consume('history')
        const merger = await api.service.consume('kernel.merge')
        if (!history || typeof history.findBase !== 'function') return null
        if (!merger || typeof merger.mergeLines !== 'function') return null
        const base = await history.findBase(path, 'sync:s3')
        if (!base) return null
        const remote = await client.get(path)
        if (!remote) return null
        return tryAutoMerge({ base, mine: localText, theirs: remote.text, mergeLines: merger.mergeLines })
      } catch (e) {
        api.host.log('warn', `自动合并失败（${path}）：${String(e)}`)
        return null
      }
    }

    /** 冲突副本：把**本机版**写进 `.zn/conflicts/<平台>/` */
    async function keepConflict(path, reason) {
      let file = null
      try {
        const text = await api.fs.readText(path)
        const existing = conflicts.map((c) => c.file).filter(Boolean)
        let name = conflictFileName(Date.now(), path)
        if (existing.includes(name)) {
          const stem = name.replace(/\.md$/i, '')
          let i = 2
          while (existing.includes(`${stem}-${i}.md`)) i += 1
          name = `${stem}-${i}.md`
        }
        await api.fs.mkdir(`${CONFLICT_ROOT}/${platform}`)
        await api.fs.writeText(`${CONFLICT_ROOT}/${platform}/${name}`, text)
        file = name
      } catch (e) {
        api.host.log('warn', `冲突副本写入失败（${path}）：${String(e)}`)
      }
      conflicts.unshift({ path, at: Date.now(), platform, file, reason })
      conflicts = conflicts.slice(0, MAX_CONFLICTS)
      void api.store.set(KEY_CONFLICTS, conflicts).catch(() => {})
      api.host.notify(`同步冲突：${path}（本机版已留副本）`, 'warn')
    }

    /** 设备 id（中转 ack 用；每台设备一个，存 store） */
    async function deviceId() {
      let id = ''
      try {
        id = String((await api.store.get(KEY_DEVICE, '')) || '')
      } catch {
        /* 读不到就当没有 */
      }
      if (!id) {
        id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
        void api.store.set(KEY_DEVICE, id).catch(() => {})
      }
      return id
    }

    /**
     * 附件同步（rev173.126）。与 `sync-webdav` **同一套协议与三种模式**：
     *
     * · `off`   —— 只同步 `.md`（默认）
     * · `full`  —— 附件与文档一样**永久**存在云端，对象键 = 笔记相对路径
     * · `relay` —— **同步中转**：上传 `_zn/relay/<fp><ext>`，对端下载后写 `_zn/relay-ack/<fp>`，
     *              任何一端看到 ack 就删云端副本并在 manifest 里标 `cleaned: true`
     *
     * 与 WebDAV 版的差别只有存储层：S3 没有 mkdir / 没有 304 条件 GET，
     * 所以这里不建目录、不带 `If-None-Match`（是否需要下载本来就由指纹判，不会每轮重拉）。
     *
     * @returns {{ attachments: Record<string, object>, changed: boolean }}
     */
    /**
     * **私有文件同步**（rev173.164 · 期 1c）：密码库密文 + 密钥元数据。
     *
     * 与附件段的差别：附件丢了只是少张图，密码库传坏了**解不开** —— 所以这里更保守：
     * 只在确知方向时动手（靠 baseline 判谁变了），双端都变就留副本再取远端，
     * 任何一步失败只写 hint 不抛（不该让整轮笔记同步跟着停）。
     *
     * @returns {{ private: Record<string, object>, changed: boolean }}
     */
    async function syncPrivate(client, manifest, summary) {
      const remotePriv = manifest.private || {}
      const nextPriv = { ...remotePriv }
      let changed = false

      for (const rel of PRIVATE_FILES) {
        /** 不用 `fs.exists`：少一次 IPC，且"不存在（抛）/ 空文件（''）"要收敛成同一个 null */
        let localText = null
        try {
          const raw = await api.fs.readText(rel)
          if (raw && raw.trim()) localText = raw
        } catch {
          localText = null
        }
        const localFp = localText == null ? null : fingerprint(localText)
        const entry = remotePriv[rel] ?? null
        const remoteFp = typeof entry?.fp === 'string' ? entry.fp : null
        const base = baseline[rel]?.fp ?? null
        const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''

        // ① 一致 ⇒ 只刷新 baseline
        if (localFp && remoteFp && localFp === remoteFp) {
          baseline[rel] = { fp: localFp, at: entry?.at ?? 0 }
          continue
        }

        const localChanged = localFp !== base
        const remoteChanged = remoteFp !== base

        // ② 该拉：本地没有（新设备）· 或只有远端变
        if (remoteFp && (!localFp || (remoteChanged && !localChanged))) {
          try {
            const got = await client.get(rel)
            if (!got) continue
            await api.fs.mkdir(parent).catch(() => {})
            await api.fs.writeText(rel, got.text)
            baseline[rel] = { fp: fingerprint(got.text), at: entry?.at ?? 0 }
            summary.pulled += 1
          } catch (e) {
            summary.hint = `私有文件下载失败 ${rel}：${String(e)}`
          }
          continue
        }

        // ③ 该推：远端还没有 · 或只有本地变
        if (localFp && (!remoteFp || (localChanged && !remoteChanged))) {
          try {
            const res = await client.put(rel, localText)
            if (!res.ok) {
              summary.hint = `私有文件上传失败 ${rel}（${res.status}）`
              continue
            }
            nextPriv[rel] = { fp: localFp, at: Date.now() }
            baseline[rel] = { fp: localFp, at: nextPriv[rel].at }
            summary.pushed += 1
            changed = true
          } catch (e) {
            summary.hint = `私有文件上传失败 ${rel}：${String(e)}`
          }
          continue
        }

        // ④ 双端都变 ⇒ 冲突：本机版留副本（keepConflict 自己读文本），再取远端版
        if (localFp && remoteFp && localChanged && remoteChanged) {
          try {
            const got = await client.get(rel)
            if (!got) continue
            await keepConflict(rel, '密码库双端修改')
            await api.fs.writeText(rel, got.text)
            baseline[rel] = { fp: fingerprint(got.text), at: entry?.at ?? 0 }
            summary.conflicts += 1
          } catch (e) {
            summary.hint = `私有文件冲突处理失败 ${rel}：${String(e)}`
          }
        }
      }
      return { private: nextPriv, changed }
    }

    /**
     * **私密文件夹目录树同步**（rev173.182 · 私密文件夹期 3）。
     *
     * 与 `syncPrivate` 的区别：那个是固定清单，这里是**数量可变**的目录树。
     * 方向判定用纯函数 `decideTreeAction`（与 sync-webdav 逐字一致）。
     * 删除两边都传播 —— 私密笔记在面板里删除是真删除，不传播同步一轮就复活。
     */
    async function syncPrivateTree(client, manifest, summary) {
      const remoteTree = manifest.privateTree || {}
      const nextTree = { ...remoteTree }
      let changed = false

      const localPaths = new Set()
      if (typeof api.fs.listFiles === 'function') {
        for (const dir of PRIVATE_DIRS) {
          const files = await api.fs.listFiles(dir).catch(() => [])
          for (const rel of files) localPaths.add(rel)
        }
      }
      for (const rel of PRIVATE_ROOT_FILES) {
        // 空串按"没有"处理（与 `syncPrivate` 同一口径）：memory fs 对不存在的路径可能返回 ''，
        // 当成"本地有"会白推一次空文件（单测 `空笔记也能同步` 抓到过）
        const raw = await api.fs.readText(rel).catch(() => null)
        if (raw && raw.trim()) localPaths.add(rel)
      }

      const all = new Set([...localPaths, ...Object.keys(remoteTree)])
      for (const rel of all) {
        let localText = null
        if (localPaths.has(rel)) {
          try {
            const raw = await api.fs.readText(rel)
            if (raw != null) localText = raw
          } catch {
            localText = null
          }
        }
        const localFp = localText == null ? null : fingerprint(localText)
        const entry = remoteTree[rel] ?? null
        const remoteFp = typeof entry?.fp === 'string' ? entry.fp : null
        const base = baseline[rel]?.fp ?? null
        const action = decideTreeAction(localFp, remoteFp, base)
        const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''

        if (action === 'noop') {
          if (localFp && remoteFp) baseline[rel] = { fp: localFp, at: entry?.at ?? 0 }
          continue
        }

        if (action === 'pull') {
          try {
            const got = await client.get(rel)
            if (!got) continue
            await api.fs.mkdir(parent).catch(() => {})
            await api.fs.writeText(rel, got.text)
            baseline[rel] = { fp: fingerprint(got.text), at: entry?.at ?? 0 }
            summary.pulled += 1
          } catch (e) {
            summary.hint = `私密笔记下载失败 ${rel}：${String(e)}`
          }
          continue
        }

        if (action === 'push') {
          try {
            const res = await client.put(rel, localText)
            if (!res.ok) {
              summary.hint = `私密笔记上传失败 ${rel}（${res.status}）`
              continue
            }
            nextTree[rel] = { fp: localFp, at: Date.now() }
            baseline[rel] = { fp: localFp, at: nextTree[rel].at }
            summary.pushed += 1
            changed = true
          } catch (e) {
            summary.hint = `私密笔记上传失败 ${rel}：${String(e)}`
          }
          continue
        }

        if (action === 'delete-remote') {
          try {
            await client.remove(rel)
            delete nextTree[rel]
            delete baseline[rel]
            summary.pushed += 1
            changed = true
          } catch (e) {
            summary.hint = `删除远端私密笔记失败 ${rel}：${String(e)}`
          }
          continue
        }

        if (action === 'delete-local') {
          try {
            await api.fs.purgePrivate(rel).catch(() => {})
            delete baseline[rel]
            summary.removed = (summary.removed ?? 0) + 1
          } catch (e) {
            summary.hint = `删除本地私密笔记失败 ${rel}：${String(e)}`
          }
          continue
        }

        try {
          const got = await client.get(rel)
          if (!got) continue
          await keepConflict(rel, '私密笔记双端修改')
          await api.fs.writeText(rel, got.text)
          baseline[rel] = { fp: fingerprint(got.text), at: entry?.at ?? 0 }
          summary.conflicts += 1
        } catch (e) {
          summary.hint = `私密笔记冲突处理失败 ${rel}：${String(e)}`
        }
      }

      return { privateTree: nextTree, changed }
    }

    async function syncAttachments(client, manifest, summary) {
      const mode = settings.attachments || 'off'
      const remoteAtt = manifest.attachments || {}
      if (mode === 'off') return { attachments: remoteAtt, changed: false }

      const nextAtt = { ...remoteAtt }
      const notes = await api.fs.listNotes()
      const locals = notes.filter((n) => isAttachment(n.path))
      const localByPath = new Map(locals.map((n) => [n.path, n]))
      const me = await deviceId()
      let changed = false

      /** 本地附件指纹：`mtime` + `size` 没变就复用缓存；返回的 `bytes` 只在这次真读了盘时有值 */
      async function localFpOf(meta) {
        const hit = attFpCache.get(meta.path)
        if (hit && hit.mtime === meta.mtime && hit.size === meta.size) return { fp: hit.fp, bytes: null }
        const bytes = await api.fs.readBytes(meta.path)
        const fp = fingerprintBytes(bytes)
        attFpCache.set(meta.path, { mtime: meta.mtime, size: meta.size, fp })
        return { fp, bytes }
      }

      /** 本地是否比远端条目更新（本地 mtime 晚于远端上传时间；两端都取本机 Date.now() 系） */
      const localIsNewer = (meta, entry) => Number(meta?.mtime ?? 0) > Number(entry?.at ?? 0)

      // ① 远端 → 本地（本地没有，**或者远端确实更新**）—— 必须在上传之前，否则本机会先盖掉远端新版
      for (const [path, entry] of Object.entries(remoteAtt)) {
        if (!entry || entry.cleaned) continue
        if (!isAttachment(path)) continue
        const local = localByPath.get(path) ?? null
        let localFp = null
        if (local) {
          try {
            localFp = (await localFpOf(local)).fp
          } catch {
            localFp = null
          }
        }
        if (!needsAttachmentPull(localFp, entry)) continue
        /**
         * 版本不同的**单向**：本地 mtime 更新 ⇒ 本机改过，留给上传；否则远端更新 ⇒ 拉。
         * 没有这一道，两台设备会互相覆盖（后同步的那台永远把自己那版推上去）——
         * rev173.126 验收实测：B 上传了新图，A 同步时先推自己的旧图再拉回来，永远拿不到新版。
         */
        if (local && localIsNewer(local, entry)) continue
        /**
         * 云端那份放在哪，由**上传方当时的模式**决定（条目里的 `mode`），不是本机设置 ——
         * 一台 full、一台 relay 时，relay 那台若按本机模式去 `_zn/relay/` 找，必然找不到
         * （rev173.126 验收实测）。老条目没有 `mode` ⇒ 退回按本机设置。
         */
        const remoteMode = entry.mode === 'full' || entry.mode === 'relay' ? entry.mode : mode
        const src = remoteMode === 'full' ? path : `_zn/relay/${relayName(entry.fp, entry.ext || extOf(path))}`
        let got = null
        try {
          got = await client.getBytes(src)
        } catch (e) {
          api.host.log('warn', `下载附件失败 ${path}：${String(e)}`)
          continue
        }
        if (!got?.data) continue
        try {
          await api.fs.writeBytes(path, got.data)
        } catch (e) {
          api.host.log('warn', `写入附件失败 ${path}：${String(e)}`)
          continue
        }
        // 刚写完，`listNotes` 的 mtime / size 变了 ⇒ 丢掉旧指纹，下一轮重新算
        attFpCache.delete(path)
        summary.pulled += 1
        if (remoteMode === 'relay') {
          await client.putBytes(`_zn/relay-ack/${relayName(entry.fp, '')}`, new TextEncoder().encode(me))
        }
      }

      // ② 本地 → 远端（远端没有 / 本地更新 / cleaned 需重传）
      for (const n of locals) {
        const entry = nextAtt[n.path]
        let fp = ''
        let bytes = null
        try {
          const got = await localFpOf(n)
          fp = got.fp
          bytes = got.bytes
        } catch {
          continue // 读不到就下一轮
        }
        // 远端已有同一份就跳过；`cleaned` 的不算（中转清理过，切「永久」后要重传）
        if (entry && entry.fp === fp && !entry.cleaned) continue
        // 版本不同且本地不更新 ⇒ 远端更新，等下一轮下载，不要拿旧版覆盖
        if (entry && !entry.cleaned && !localIsNewer(n, entry)) continue
        if (!bytes) {
          try {
            bytes = await api.fs.readBytes(n.path)
          } catch {
            continue
          }
        }
        const ext = extOf(n.path)
        const key = mode === 'full' ? n.path : `_zn/relay/${relayName(fp, ext)}`
        const r = await client.putBytes(key, bytes)
        if (!r.ok) throw new Error(`上传附件失败（${r.status}）：${n.path}`)
        nextAtt[n.path] = { fp, ext, at: Date.now(), mode }
        changed = true
        summary.pushed += 1
      }

      // ③ relay 清理：有 ack 就删云端副本（任何端都能做，幂等）
      for (const [path, entry] of Object.entries(nextAtt)) {
        if (!entry || entry.cleaned) continue
        // 只有「云端那份确实在 relay 路径上」的条目才有 ack 可等（full 条目永不清理）
        const remoteMode = entry.mode === 'full' || entry.mode === 'relay' ? entry.mode : mode
        if (remoteMode !== 'relay') continue
        const acked = await client.exists(`_zn/relay-ack/${relayName(entry.fp, '')}`)
        if (!acked) continue
        await client.remove(`_zn/relay/${relayName(entry.fp, entry.ext || extOf(path))}`)
        nextAtt[path] = { ...entry, mode: 'relay', cleaned: true }
        changed = true
      }

      return { attachments: nextAtt, changed }
    }

    /**
     * 一次完整同步。返回摘要，不抛（错误转成 hint）。
     *
     * `silent`（自动轮询用）：不弹错误 toast、无变化时不刷面板。
     */
    async function runSync(reason = '手动', { silent = false } = {}) {
      if (busy) return { skipped: true }
      if (!settings.endpoint || !settings.bucket) return { error: '还没配置 Endpoint / 桶名' }
      busy = true
      if (!silent) api.view.refresh()
      const t0 = Date.now()
      let tMark = t0
      const timing = { manifest: 0, notes: 0, attachments: 0, private: 0, privateTree: 0, write: 0 }
      const lap = () => {
        const now = Date.now()
        const d = now - tMark
        tMark = now
        return d
      }
      const summary = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, removed: 0, hint: '' }
      try {
        const client = createS3Client({
          ...settings,
          secretKey: await secret(),
          net: api.net,
        })

        // ① manifest（云端的权威索引）
        let remote
        const got = await client.get(MANIFEST_KEY)
        if (got === null) {
          remote = { files: {}, attachments: {}, private: {}, privateTree: {} }
          manifestCache = { files: {}, attachments: {}, private: {}, privateTree: {}, etag: null }
        } else {
          const m = normalizeManifest(got.text)
          remote = {
            files: m.files,
            attachments: m.attachments,
            private: m.private,
            privateTree: m.privateTree,
          }
          manifestCache = {
            files: m.files,
            attachments: m.attachments,
            private: m.private,
            privateTree: m.privateTree,
            etag: got.etag,
          }
        }
        timing.manifest = lap()

        // ② 逐篇比对
        const notes = await api.fs.listNotes()
        const localPaths = new Set()
        const nextFiles = { ...remote.files }
        /** manifest 条目被刷新过（412 / 绕过 manifest 的远端改动）⇒ 本轮必须回写 */
        let manifestChanged = false
        let processed = 0

        /**
         * 冲突处理（rev173.129）。两个入口共用：
         *   ① `decideSync === 'conflict'`（manifest 已显示双端都改）
         *   ② `PUT` 返回 **412**（manifest 的 etag 过期 ⇒ 远端被"绕过 manifest"改过，
         *      比如网页控制台手改 / 另一台设备崩在半路）
         *
         * 先**重读远端**把 manifest 条目刷成最新，再决定合并 / 留副本 ——
         * 不刷新的话下一轮还会拿同一个过期 etag 去撞 412（Git 后端 rev173.123 踩过同款死循环）。
         */
        const resolveConflict = async (n, localText, remoteEntry) => {
          let fresh = null
          try {
            fresh = await client.get(n.path)
          } catch {
            fresh = null
          }
          const remoteText = fresh && typeof fresh.text === 'string' ? fresh.text : null
          const remoteEtag = fresh?.etag ?? remoteEntry?.etag ?? null
          if (remoteText === null) {
            summary.hint = `远端已删除：${n.path}`
            summary.conflicts += 1
            return
          }
          const freshFp = fingerprint(remoteText)
          if (remoteEntry?.fp !== freshFp || remoteEntry?.etag !== remoteEtag) {
            nextFiles[n.path] = { fp: freshFp, etag: remoteEtag ?? undefined, at: Date.now() }
            manifestChanged = true
          }
          const merged = await autoMerge(client, n.path, localText)
          if (merged) {
            let wrote = false
            try {
              await api.fs.writeText(n.path, merged.text, { origin: 'plugin' })
              wrote = true
            } catch (e) {
              api.host.log('warn', `合并结果落盘失败（${n.path}）：${String(e)}`)
            }
            if (wrote) {
              // 合并结果回推也带条件：远端这期间若又被改，412 ⇒ 本轮留 hint，下一轮再合
              const res2 = await client.put(n.path, merged.text, { ifMatch: remoteEtag })
              if (res2.ok) {
                const fp = fingerprint(merged.text)
                baseline[n.path] = { fp, etag: res2.etag }
                nextFiles[n.path] = { fp, etag: res2.etag ?? undefined, at: Date.now() }
                manifestChanged = true
                baseMarked.add(n.path)
                await markBase(n.path, merged.text)
                summary.merged += 1
                api.host.notify(`已自动合并：${n.path}`, 'info')
                return
              }
              summary.hint = `合并结果未能上传（${res2.status}）：${n.path}`
            }
            summary.conflicts += 1
            return
          }
          await keepConflict(n.path, '双端修改')
          summary.conflicts += 1
          await api.fs.writeText(n.path, remoteText, { origin: 'plugin' })
          const fp = fingerprint(remoteText)
          baseline[n.path] = { fp, etag: remoteEtag }
          baseMarked.add(n.path)
          await markBase(n.path, remoteText)
          summary.pulled += 1
        }

        for (const n of notes) {
          if (!/\.md$/i.test(n.path)) continue
          if (processed >= MAX_FILES_PER_RUN) break
          processed += 1
          localPaths.add(n.path)
          let localText
          try {
            localText = await api.fs.readText(n.path)
          } catch {
            continue
          }
          const localFp = fingerprint(localText)
          const base = baseline[n.path] ?? null
          const remoteEntry = remote.files[n.path] ?? null
          const verdict = decideSync({ base, localFp, remoteFp: remoteEntry?.fp ?? null })

          if (verdict === 'noop') {
            baseline[n.path] = { fp: localFp, etag: remoteEntry?.etag }
            if (!baseMarked.has(n.path)) {
              baseMarked.add(n.path)
              await markBase(n.path, localText)
            }
            continue
          }
          if (verdict === 'pull' || verdict === 'pull-new') {
            const r = await client.get(n.path)
            if (!r) continue
            await api.fs.writeText(n.path, r.text, { origin: 'plugin' })
            const fp = fingerprint(r.text)
            baseline[n.path] = { fp, etag: r.etag }
            baseMarked.add(n.path)
            await markBase(n.path, r.text)
            summary.pulled += 1
            continue
          }
          if (verdict === 'push' || verdict === 'push-new') {
            /**
             * 条件写（rev173.129）：只有「远端已有这篇 + manifest 记了 etag」才带 `If-Match`。
             * - 服务端支持 ⇒ 远端被绕过 manifest 改过时回 412，**不会静默覆盖**；
             * - 服务端忽略该头 ⇒ 行为与以前完全一致（不会变坏）。
             * `push-new` 不带条件：`If-None-Match: *` 在 S3 兼容实现上的支持面更窄。
             */
            const ifMatch = verdict === 'push' && remoteEntry?.etag ? remoteEntry.etag : null
            let res = await client.put(n.path, localText, { ifMatch })
            if (res.conflict409) {
              // 并发写撞车：AWS 要求取对象新 ETag 再试一次（只重试一次，避免死循环）
              let fresh = null
              try {
                fresh = await client.get(n.path)
              } catch {
                fresh = null
              }
              res = await client.put(n.path, localText, { ifMatch: fresh?.etag ?? null })
            }
            if (res.precondition) {
              await resolveConflict(n, localText, remoteEntry)
              continue
            }
            if (!res.ok && ifMatch && res.status === 400) {
              /**
               * 兜底：个别 S3 兼容实现把不认识的 `If-Match` 当**坏请求**（400）而不是忽略。
               * 重试一次不带条件（本轮退化成旧行为），并给出明确 hint —— 不让升级后同步全挂。
               */
              res = await client.put(n.path, localText)
              if (res.ok) summary.hint = `服务端不支持 If-Match（400），本轮已降级为无条件写：${n.path}`
            }
            if (!res.ok) throw new Error(`上传失败（${res.status}）：${n.path}`)
            baseline[n.path] = { fp: localFp, etag: res.etag }
            nextFiles[n.path] = { fp: localFp, etag: res.etag ?? undefined, at: Date.now() }
            baseMarked.add(n.path)
            await markBase(n.path, localText)
            summary.pushed += 1
            continue
          }
          if (verdict === 'conflict') {
            await resolveConflict(n, localText, remoteEntry)
            continue
          }
          if (verdict === 'remote-deleted') {
            delete baseline[n.path]
            summary.removed += 1
          }
        }

        // ③ 远端有、本地没有 ⇒ 拉下来
        for (const [path, entry] of Object.entries(remote.files)) {
          if (localPaths.has(path)) continue
          if (!/\.md$/i.test(path)) continue
          const r = await client.get(path)
          if (!r) continue
          try {
            await api.fs.writeText(path, r.text, { origin: 'plugin' })
          } catch (e) {
            summary.hint = `写入失败 ${path}：${String(e)}`
            continue
          }
          baseline[path] = { fp: fingerprint(r.text), etag: r.etag ?? entry.etag }
          baseMarked.add(path)
          await markBase(path, r.text)
          summary.pulled += 1
        }
        timing.notes = lap()

        // ④ 附件（rev173.126）—— 在 .md 循环之后；`summary.pushed / pulled` 里也含附件计数
        const att = await syncAttachments(client, remote, summary)
        timing.attachments = lap()

        // ④b 私有文件（密码库密文 + 密钥元数据，rev173.164 · 期 1c）
        const priv = await syncPrivate(client, remote, summary)
        timing.private = lap()

        // ④c 私密文件夹目录树（rev173.182 · 期 3）
        const privTree = await syncPrivateTree(client, remote, summary)
        timing.privateTree = lap()

        // ⑤ manifest 回写（有变动才写 —— 5 秒一轮，没变化不该反复 PUT）
        if (
          summary.pushed > 0 ||
          summary.removed > 0 ||
          att.changed ||
          priv.changed ||
          privTree.changed ||
          manifestChanged
        ) {
          const w = await client.put(
            MANIFEST_KEY,
            JSON.stringify({
              version: 1,
              files: nextFiles,
              attachments: att.attachments,
              private: priv.private,
              privateTree: privTree.privateTree,
            }),
            { contentType: 'application/json; charset=utf-8' },
          )
          if (w.ok) {
            manifestCache = {
              files: nextFiles,
              attachments: att.attachments,
              private: priv.private,
              privateTree: privTree.privateTree,
              etag: w.etag,
            }
          }
        }
        timing.write = lap()
        await api.store.set(KEY_BASELINE, baseline)
        summary.hint = summary.hint || `${reason}同步完成`
      } catch (e) {
        summary.hint = `同步失败：${String(e)}`
        if (/401|403|429|503|SignatureDoesNotMatch|AccessDenied/i.test(String(e))) {
          stopAuto()
          if (settings.auto !== false) {
            settings.auto = false
            markDirty()
          }
          summary.hint += '（认证失败或限流，已暂停自动同步）'
        }
        if (!silent) api.host.notify(summary.hint, 'error')
        else api.host.log('warn', summary.hint)
      } finally {
        busy = false
        summary.ms = { ...timing, total: Date.now() - t0 }
        const changed = summary.pulled + summary.pushed + summary.merged + summary.conflicts + summary.removed > 0
        if (changed || !silent) {
          timingHistory = [...timingHistory, { at: Date.now(), ...summary.ms }].slice(-MAX_TIMING)
          void api.store.set(KEY_TIMING, timingHistory).catch(() => {})
        }
        lastResult = { ...summary, at: Date.now() }
        if (!silent || changed) api.view.refresh()
      }
      return summary
    }

    /* ── 自动同步 ── */

    let autoTimer = null

    function startAuto() {
      if (autoTimer || !settings.endpoint || !settings.bucket) return
      const timer = window.setInterval(() => {
        if (busy || !settings.endpoint) return
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        void runSync('自动', { silent: true })
      }, AUTO_MS)
      autoTimer = timer
      api.subscriptions.push({ dispose: () => window.clearInterval(timer) })
    }

    function stopAuto() {
      if (autoTimer) {
        window.clearInterval(autoTimer)
        autoTimer = null
      }
    }

    /* ── 面板 ── */

    function render(ctx) {
      const state = ctx?.state ?? {}
      form = {
        endpoint: String(state['s3.endpoint'] ?? '') || settings.endpoint,
        region: String(state['s3.region'] ?? '') || settings.region,
        bucket: String(state['s3.bucket'] ?? '') || settings.bucket,
        accessKey: String(state['s3.accessKey'] ?? '') || settings.accessKey,
        password: String(state['s3.password'] ?? ''),
        prefix: String(state['s3.prefix'] ?? '') || settings.prefix,
      }
      const configured = Boolean(settings.endpoint && settings.bucket)

      const children = [
        {
          type: 'text',
          value: 'S3 兼容存储（AWS S3 / MinIO / Cloudflare R2 / B2）。密钥存系统凭据库，地址与桶名存插件设置。',
          variant: 'caption',
          tone: 'muted',
        },
        {
          type: 'text',
          value: configured
            ? `当前：${settings.endpoint} · 桶 ${settings.bucket}${settings.prefix ? ` · 前缀 ${settings.prefix}` : ''} · 区域 ${settings.region} · 账号 ${settings.accessKey}`
            : '还没配置 —— 填下面四项后点「保存设置」',
          variant: 'caption',
          tone: configured ? 'muted' : 'warn',
        },
        { type: 'divider' },
        {
          type: 'field',
          label: 'Endpoint',
          hint: '例：https://s3.amazonaws.com 或 https://minio.你的域名（不带桶名）',
          children: { type: 'input', bind: 's3.endpoint', placeholder: 'https://…' },
        },
        {
          type: 'field',
          label: '区域',
          hint: 'AWS 必填（us-east-1 等）；MinIO / R2 通常随意，但有些会校验',
          children: { type: 'input', bind: 's3.region', placeholder: 'us-east-1' },
        },
        {
          type: 'field',
          label: '桶名',
          children: { type: 'input', bind: 's3.bucket', placeholder: 'zeronote' },
        },
        {
          type: 'field',
          label: '对象前缀（可选）',
          hint: '桶里放笔记的子目录，例如 ZeroNote',
          children: { type: 'input', bind: 's3.prefix', placeholder: 'ZeroNote' },
        },
        {
          type: 'field',
          label: 'Access Key ID',
          children: { type: 'input', bind: 's3.accessKey', placeholder: 'AKIA…' },
        },
        {
          type: 'field',
          label: 'Secret Access Key',
          hint: '只写在这里；保存后存进系统凭据库',
          /* rev173.275 · 同 #14：secret 也是密码，别明文摊着（契约 `secret: true`） */
          children: { type: 'input', bind: 's3.password', secret: true, placeholder: '不改就留空' },
        },
        {
          type: 'field',
          label: '附件（图片 / PDF）',
          hint: '不同步 = 只同步 .md；中转 = 对端收到后云端副本删掉（省空间）；永久 = 与文档一样',
          children: {
            type: 'select',
            bind: 's3.attachmentsMode',
            options: [
              { value: 'off', label: '不同步（默认）' },
              { value: 'relay', label: '同步中转（云端不常留）' },
              { value: 'full', label: '与文档一样永久同步' },
            ],
            onSubmit: 'sync-s3.set-attachments',
          },
        },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            { type: 'button', label: '保存设置', onClick: 'sync-s3.save' },
            { type: 'button', label: '测试连接', onClick: 'sync-s3.test', variant: 'ghost' },
            { type: 'button', label: '立即同步', onClick: 'sync-s3.sync', disabled: !configured || busy },
            {
              type: 'button',
              label: settings.auto === false ? '开启自动同步' : '关闭自动同步',
              onClick: 'sync-s3.toggle-auto',
              variant: 'ghost',
            },
            { type: 'button', label: '断开连接', onClick: 'sync-s3.disconnect', variant: 'danger' },
          ],
        },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            {
              type: 'badge',
              text: settings.auto === false ? '手动同步' : '自动 · 前台每 5 秒',
              tone: settings.auto === false ? 'muted' : 'success',
            },
            ...(busy ? [{ type: 'badge', text: '正在同步…', tone: 'warn' }] : []),
          ],
        },
      ]

      if (formError) children.push({ type: 'text', value: formError, tone: 'danger', variant: 'caption' })

      if (lastResult) {
        children.push({ type: 'divider' })
        children.push({ type: 'text', value: '上次同步', variant: 'title' })
        children.push({
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            { type: 'badge', text: `下载 ${lastResult.pulled}`, tone: 'default' },
            { type: 'badge', text: `上传 ${lastResult.pushed}`, tone: 'default' },
            ...(lastResult.merged > 0
              ? [{ type: 'badge', text: `合并 ${lastResult.merged}`, tone: 'success' }]
              : []),
            {
              type: 'badge',
              text: `冲突 ${lastResult.conflicts}`,
              tone: lastResult.conflicts > 0 ? 'danger' : 'success',
            },
          ],
        })
        children.push({
          type: 'text',
          value: `${new Date(lastResult.at).toLocaleString()} · ${lastResult.hint || ''}`,
          variant: 'caption',
          tone: 'muted',
        })
        if (lastResult.ms) {
          const ms = lastResult.ms
          children.push({
            type: 'row',
            gap: 'sm',
            wrap: true,
            children: [
              { type: 'badge', text: `用时 ${fmtMs(ms.total)}`, tone: 'muted' },
              { type: 'badge', text: `manifest ${fmtMs(ms.manifest)}`, tone: 'muted' },
              { type: 'badge', text: `笔记 ${fmtMs(ms.notes)}`, tone: 'muted' },
              ...(ms.attachments > 0
                ? [{ type: 'badge', text: `附件 ${fmtMs(ms.attachments)}`, tone: 'muted' }]
                : []),
            ],
          })
        }
      }

      const totals = timingHistory.filter((e) => Number.isFinite(e.total))
      if (totals.length > 1) {
        const sum = totals.reduce((n, e) => n + e.total, 0)
        const max = Math.max(...totals.map((e) => e.total))
        children.push({
          type: 'text',
          value: `最近 ${totals.length} 次：平均 ${fmtMs(Math.round(sum / totals.length))} · 最慢 ${fmtMs(max)}`,
          variant: 'caption',
          tone: 'muted',
        })
      }

      if (conflicts.length > 0) {
        children.push({ type: 'divider' })
        children.push({ type: 'text', value: '冲突记录', variant: 'title' })
        children.push({
          type: 'list',
          items: conflicts.slice(0, 8).map((c) => ({
            type: 'text',
            value: `${new Date(c.at).toLocaleString()} · ${c.path}${c.file ? `（副本 ${CONFLICT_ROOT}/${c.platform}/${c.file}）` : '（本机版未留存）'}`,
          })),
        })
      }

      return { type: 'stack', gap: 'md', children }
    }

    /* ── 命令 ── */

    const register = (id, title, run) => api.command.register({ id, title, run })

    async function openPanel() {
      for (let i = 0; i < 5; i += 1) {
        try {
          await api.command.execute(`core.panel.${PANEL_ID}`)
          return
        } catch {
          if (i === 4) return
          await new Promise((r) => setTimeout(r, 120))
        }
      }
    }

    async function saveSettings() {
      formError = null
      const endpoint = String(form.endpoint ?? '').trim().replace(/\/+$/, '')
      const bucket = String(form.bucket ?? '').trim()
      if (!endpoint) {
        formError = 'Endpoint 不能为空'
        api.view.refresh()
        return
      }
      if (!/^https?:\/\//i.test(endpoint)) {
        formError = 'Endpoint 要以 http:// 或 https:// 开头'
        api.view.refresh()
        return
      }
      if (!bucket) {
        formError = '桶名不能为空'
        api.view.refresh()
        return
      }
      settings = {
        ...settings,
        endpoint,
        region: String(form.region ?? '').trim() || 'us-east-1',
        bucket,
        accessKey: String(form.accessKey ?? '').trim(),
        prefix: String(form.prefix ?? '').trim().replace(/^\/+|\/+$/g, ''),
        enabled: true,
      }
      const pwd = String(form.password ?? '')
      if (pwd) {
        try {
          await api.host.secrets.set(SECRET_KEY, pwd)
          savedSecret = pwd
        } catch (e) {
          formError = `密钥写入系统凭据库失败：${String(e)}`
          api.view.refresh()
          return
        }
      }
      markDirty()
      if (settings.auto !== false) startAuto()
      api.host.notify('S3 同步设置已保存')
      api.view.refresh()
    }

    api.view.registerPanel({ id: PANEL_ID, title: '同步 · S3', location: 'main', render })
    register('sync-s3.open', '同步：打开 S3 设置与状态', () => openPanel())
    register('sync-s3.save', '同步：保存 S3 设置', () => saveSettings())
    register('sync-s3.test', '同步：测试 S3 连接', async () => {
      stopAuto()
      let ok = false
      try {
        const client = createS3Client({ ...settings, secretKey: await secret(), net: api.net })
        const r = await client.test()
        ok = r.ok
        api.host.notify(r.ok ? `连接正常（${r.status}）` : r.hint, r.ok ? 'info' : 'error')
        lastResult = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, hint: r.hint, at: Date.now() }
      } catch (e) {
        api.host.notify(`连接测试失败：${String(e)}`, 'error')
        lastResult = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, hint: `连接测试失败：${String(e)}`, at: Date.now() }
      } finally {
        if (ok && settings.endpoint && settings.auto !== false) startAuto()
        else if (!ok && settings.auto !== false) {
          settings.auto = false
          markDirty()
        }
      }
      api.view.refresh()
    })
    register('sync-s3.sync', '同步：立即同步一次', () => runSync('手动'))
    register('sync-s3.set-attachments', '同步：设置附件同步方式', (payload) => {
      const v = String(payload?.value ?? 'off')
      settings.attachments = ['off', 'relay', 'full'].includes(v) ? v : 'off'
      markDirty()
      const label =
        settings.attachments === 'off'
          ? '不同步（只同步 .md）'
          : settings.attachments === 'relay'
            ? '同步中转（对端收到后云端删掉）'
            : '与文档一样永久同步'
      api.host.notify(`附件同步：${label}`)
      api.view.refresh()
    })
    register('sync-s3.toggle-auto', '同步：开关自动同步（S3）', () => {
      settings.auto = settings.auto === false
      markDirty()
      if (settings.auto === false) {
        stopAuto()
        api.host.notify('已关闭自动同步（S3）')
      } else {
        startAuto()
        api.host.notify('已开启自动同步（S3，前台每 5 秒）')
      }
      api.view.refresh()
    })
    register('sync-s3.disconnect', '同步：断开 S3 并清除密钥', async () => {
      try {
        await api.host.secrets.delete(SECRET_KEY)
      } catch (e) {
        api.host.log('warn', `删除密钥失败：${String(e)}`)
      }
      savedSecret = null
      stopAuto()
      settings = { ...settings, endpoint: '', bucket: '', accessKey: '', prefix: '', enabled: false }
      baseline = {}
      manifestCache = null
      markDirty()
      void api.store.set(KEY_BASELINE, {}).catch(() => {})
      api.host.notify('已断开 S3 并清除密钥')
      api.view.refresh()
    })

    /* ── 启动 ── */

    void (async () => {
      try {
        settings = { ...settings, ...((await api.store.get(KEY_SETTINGS, {})) ?? {}) }
        baseline = (await api.store.get(KEY_BASELINE, {})) ?? {}
        conflicts = (await api.store.get(KEY_CONFLICTS, [])) ?? []
        timingHistory = (await api.store.get(KEY_TIMING, [])) ?? []
      } catch (e) {
        api.host.log('warn', `S3 设置读取失败：${String(e)}`)
      }
      ready = true
      api.view.refresh()
      if (settings.endpoint && settings.bucket && settings.auto !== false) startAuto()

      const onVisible = () => {
        if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
        if (!settings.endpoint) return
        void runSync('回到前台', { silent: true })
      }
      document.addEventListener('visibilitychange', onVisible)
      api.subscriptions.push({ dispose: () => document.removeEventListener('visibilitychange', onVisible) })

      api.host.log(
        'info',
        `S3 同步插件就绪（${platform}，${settings.endpoint ? '已配置' : '未配置'}，自动=${settings.auto !== false}，ready=${ready}）`,
      )
    })()
  },
}
