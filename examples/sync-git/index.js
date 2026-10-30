/**
 * 同步 · Git 类后端（`sync-git`）—— rev173.122 · 同步二期第四个后端
 *
 * 走**代码托管平台的 REST Contents API**（不是 git 协议，不是 git push）：
 * GitHub / Gitea / Gitee 都是「一个文件一次 GET/PUT」，`sha` 天然就是乐观锁
 * （PUT 时带上次读到的 sha，远端变过 ⇒ 平台拒绝 ⇒ 当作冲突）。
 *
 * 方案见 `docs/同步插件-调研与方案-2026-10-24.md` §5.0 表格里「Git 类」那一行。
 *
 * ## 与 S3 版的三个差别
 *
 * 1. **有一个可选的分支维度**（`?ref=` 读 / body.branch 写），默认 `main`。
 * 2. **`sha` 就是乐观锁**（比 S3 / WebDAV 都强）：`PUT` 带 sha 时远端变过 ⇒ 409/422。
 * 3. **响应是 base64**（`encoding: 'base64'`），而且大文件的 base64 **会插换行**
 *    （实测 GitHub 的 README 没有，但 1MB 以上的内容有）⇒ 解码前必须剥掉所有空白。
 *
 * ## 实测过什么 / 没实测什么
 *
 * · **实测**（2026-10-25）：`GET /repos/octocat/Hello-World/contents/README` 真实返回
 *   `{ name, sha: '980a0d5f19a64b4b30a87d4206aade58726b60e3', size: 13, encoding: 'base64',
 *   content: 'SGVsbG8gV29ybGQhCg==' }` —— 本文件的解析就是照这个形状写的。
 * · **没实测**：需要 token 的 POST/PUT/DELETE（手头没有仓库写权限的凭据）。
 *   `gitee` 分支（POST + `access_token`）也没有实测，按公开文档实现，面板上如实标注。
 */

/* ───────────────────────── 常量 ───────────────────────── */

const PANEL_ID = 'sync-git.status'
const KEY_SETTINGS = 'settings.v1'
const KEY_BASELINE = 'baseline.v1'
const KEY_CONFLICTS = 'conflicts.v1'
const KEY_TIMING = 'timing.v1'
/** 设备 id（rev173.126 中转 ack 用；与另两个后端同一个键名、同一套格式） */
const KEY_DEVICE = 'device.v1'
const SECRET_KEY = 'sync.git.token'
const MANIFEST_PATH = '_zn/manifest.json'

/**
 * **私有文件**清单（rev173.164 · 期 1c）：库内 `.zn/` 下的密文，不是 `.md`、`listNotes` 拿不到。
 *
 * 密码库要**两个**文件一起搬：`secrets.zn`（数据密文）+ `vault.json`（KDF salt 与被主密码
 * 包裹的 DEK）。少了后者，另一台设备拿到密文也解不开。两者都不含明文。
 */
/**
 * 私有文件清单（rev173.164 · 期 1c；**rev173.182 按环拆 vault**）。
 *
 * `vault.<环>.json` 各是一个同步单元 —— 两台设备各改一个环的密码时不会互踩。
 * 旧单文件 `vault.json` 留在清单里兼容还没迁移的库。
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
const CONFLICT_ROOT = '.zn/conflicts'
const MAX_CONFLICTS = 100
const MAX_TIMING = 50
const MAX_FILES_PER_RUN = 200
const AUTO_MS = 5000
/**
 * **限流退避档位**（rev173.279 · 真人使用测试 #12）：
 * GitHub / Gitee 的 API 也有限流（`X-RateLimit-*` / 429）。旧行为是撞上就永久停自动同步，
 * 要用户手动重开、重开后又 5 秒一轮。改成 15 s → 60 s → 300 s 指数退避，成功即复位。
 * 认证失败（401 / 403 / 令牌无效）仍然立刻停。
 */
const BACKOFF_MS = [15000, 60000, 300000]

/** 平台预设：API 根 + 写方法 + 认证方式 */
export const PROVIDERS = {
  github: { label: 'GitHub', api: 'https://api.github.com', write: 'PUT', auth: 'bearer' },
  gitea: { label: 'Gitea / Forgejo', api: 'https://gitea.com/api/v1', write: 'PUT', auth: 'bearer' },
  gitee: { label: 'Gitee', api: 'https://gitee.com/api/v5', write: 'POST', auth: 'token' },
}

/* ───────────────────────── 纯函数（单测覆盖） ───────────────────────── */

/** 内容指纹：长度 + FNV-1a（与另外三个同步插件同一套，四边互认） */
export function fingerprint(text) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `${s.length.toString(36)}:${h.toString(36)}`
}

/** 二进制指纹（附件用；逐字节，不能拿 UTF-16 码元那份用 —— 与 sync-webdav / sync-s3 同一套） */
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
 * UTF-8 → base64。
 *
 * **不能用 `btoa(text)` 直接编**：它按 Latin-1 走，遇到中文直接抛
 * `InvalidCharacterError`（与 `sync-webdav` 的 Basic 认证同一个坑）。
 */
export function b64encode(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''))
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

/**
 * base64 → UTF-8。
 *
 * **必须先剥掉所有空白**：平台返回的大文件 base64 会每 60 字符插一个 `\n`，
 * 不剥 `atob` 会抛 `InvalidCharacterError`。
 */
export function b64decode(b64) {
  const clean = String(b64 ?? '').replace(/\s+/g, '')
  const bin = atob(clean)
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * 字节 → base64（附件用，rev173.126）。
 *
 * `b64encode` 只吃字符串；图片 / PDF 是二进制，按 UTF-8 编会毁字节，
 * 所以这里逐字节 `String.fromCharCode` 拼出来再 `btoa`。
 */
export function b64encodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? [])
  let bin = ''
  const CHUNK = 0x8000 // 一次性拼太长的字符串在部分 WebView 上会爆栈
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)))
  }
  return btoa(bin)
}

/** base64 → 字节（先剥空白：平台返回的大文件 base64 每 60 字符一个 `\n`） */
export function b64decodeBytes(b64) {
  const clean = String(b64 ?? '').replace(/\s+/g, '')
  const bin = atob(clean)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** 库内相对路径 → URL 段（逐段编码，保留 `/`） */
export function encodeGitPath(path) {
  return String(path ?? '')
    .split('/')
    .filter((s) => s && s !== '.')
    .map((s) => encodeURIComponent(s))
    .join('/')
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
 * 远端这条附件要不要拉到本地（rev173.126，与 sync-webdav / sync-s3 同一判据）。
 * 只看「本地有没有这个路径」不够 —— 远端换掉同一路径的图时本地会停在旧版本。
 */
export function needsAttachmentPull(localFp, remoteEntry) {
  if (!remoteEntry || remoteEntry.cleaned) return false
  if (!localFp) return true
  return localFp !== remoteEntry.fp
}

/** 中转文件 / ack 标记的仓库内文件名（`:` 换成 `-`，与另两个后端同构） */
export function relayName(fp, ext) {
  return `${String(fp ?? '').replace(/[:/\\]/g, '-')}${ext || ''}`
}

/**
 * 七种判定 —— 决定会不会丢字。**与 `sync-webdav` / `sync-s3` 逐字一致**。
 * 没有基线时（换设备 / store 被清）不再一律 `pull-new`（rev173.128）：
 * 两边相同 ⇒ `noop`，两边不同 ⇒ `conflict`（本机版先留副本，不静默覆盖）。
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

/** 三方合并（与另外三个同步插件同一判据） */
export function tryAutoMerge({ base, mine, theirs, mergeLines }) {
  if (typeof base !== 'string' || !base) return null
  if (typeof mergeLines !== 'function') return null
  if (mine === theirs || mine === base || theirs === base) return null
  try {
    const out = mergeLines(base, mine, theirs)
    if (!out || typeof out.text !== 'string') return null
    if ((out.conflicts ?? 0) > 0) return null
    if (out.text === mine || out.text === theirs) return null
    return { text: out.text, conflicts: out.conflicts ?? 0 }
  } catch {
    return null
  }
}

/** 冲突副本文件名（与另外三个同步插件同格式） */
export function conflictFileName(when, path) {
  const d = when instanceof Date ? when : new Date(when)
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`
  const base = String(path ?? '').split('/').pop() ?? '笔记.md'
  const name = /\.md$/i.test(base) ? base : `${base}.md`
  return `${stamp}-${name}`
}

/**
 * 解析 manifest（与其它三个同步插件同一格式）。
 *
 * **`attachments` 段必须原样解析**（rev173.126）：以前这里恒返回 `{}`，
 * 于是附件同步读到"远端没有附件" —— 下载循环直接空转，表现是不报错但图永远不过去。
 */
/**
 * 私密文件夹树段（rev173.182 · 期 3）：`{ rel: { fp, at, sha } }`。
 * **sha 必须带上** —— Git 后端的删除 / 覆盖都要 sha（GitHub Contents API）。
 */
function privateTreeOf(j) {
  const out = {}
  const src = j && typeof j === 'object' && j.privateTree && typeof j.privateTree === 'object' ? j.privateTree : {}
  for (const [rel, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object') continue
    if (typeof v.fp !== 'string' || !v.fp) continue
    out[rel] = { fp: v.fp, at: Number(v.at) || 0, ...(typeof v.sha === 'string' && v.sha ? { sha: v.sha } : {}) }
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
    if (!v || typeof v !== 'object' || typeof v.fp !== 'string' || !v.fp) continue
    files[path] = { fp: v.fp, sha: typeof v.sha === 'string' ? v.sha : undefined, at: Number(v.at) || 0 }
  }
  const attachments = {}
  const srcAtt = j.attachments && typeof j.attachments === 'object' ? j.attachments : {}
  for (const [path, v] of Object.entries(srcAtt)) {
    if (!v || typeof v !== 'object' || typeof v.fp !== 'string' || !v.fp) continue
    attachments[path] = {
      fp: v.fp,
      ext: typeof v.ext === 'string' ? v.ext : extOf(path),
      at: Number(v.at) || 0,
      ...(typeof v.sha === 'string' ? { sha: v.sha } : {}),
      ...(v.cleaned ? { cleaned: true } : {}),
      // `mode` 决定远端那份放在原路径还是 `_zn/relay/`（rev173.126）—— 丢了会让 relay 端找不到文件
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
    if (!v || typeof v !== 'object' || typeof v.fp !== 'string' || !v.fp) continue
    privateFiles[rel] = {
      fp: v.fp,
      at: Number(v.at) || 0,
      ...(typeof v.sha === 'string' ? { sha: v.sha } : {}),
    }
  }
  return { version: 1, files, attachments, private: privateFiles, privateTree: privateTreeOf(j) }
}

/** 耗时给人看（与另外三个同步插件同一套写法） */
export function fmtMs(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1000) return `${Math.round(n)} 毫秒`
  if (n < 10000) return `${(n / 1000).toFixed(1)} 秒`
  return `${Math.round(n / 1000)} 秒`
}

/**
 * 把 Contents API 的一个条目归一成我们的形状。
 *
 * 真实响应（实测 GitHub · 2026-10-25）：
 * `{ name: 'README', sha: '980a0d5f…', size: 13, encoding: 'base64', content: 'SGVsbG8…' }`
 * 目录响应是**数组**（每项 `{ name, path, type: 'file'|'dir', sha }`，没有 content）。
 */
export function parseContents(entry) {
  if (!entry || typeof entry !== 'object') return null
  if (Array.isArray(entry)) return { dir: entry.map((e) => ({ name: e.name, path: e.path, type: e.type, sha: e.sha })) }
  if (typeof entry.content !== 'string') return null
  return { text: b64decode(entry.content), sha: typeof entry.sha === 'string' ? entry.sha : null }
}

/* ───────────────────────── Contents 客户端 ───────────────────────── */

/**
 * @param {{ provider?: string, apiBase?: string, owner: string, repo: string, branch?: string,
 *           token: string, prefix?: string, net: object }} cfg
 */
export function createGitClient(cfg) {
  const preset = PROVIDERS[cfg.provider] ?? PROVIDERS.github
  const api = String(cfg.apiBase || preset.api).replace(/\/+$/, '')
  const owner = String(cfg.owner ?? '').trim()
  const repo = String(cfg.repo ?? '').trim()
  const branch = String(cfg.branch || 'main').trim()
  const prefix = String(cfg.prefix ?? '').replace(/^\/+|\/+$/g, '')
  const token = String(cfg.token ?? '')

  /** 库内相对路径 → 仓库内路径（带 prefix） */
  const repoPath = (p) => [prefix, p].filter(Boolean).join('/')

  const headers = (extra = {}) => {
    const h = { Accept: 'application/json', ...extra }
    if (token) {
      h.Authorization = preset.auth === 'bearer' ? `Bearer ${token}` : `token ${token}`
    }
    return h
  }

  /** 读一个文件或目录。文件 ⇒ `{ text, sha }`；目录 ⇒ `{ dir: [...] }`；不存在 ⇒ null */
  async function read(path) {
    const p = encodeGitPath(repoPath(path))
    const url = `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${p}?ref=${encodeURIComponent(branch)}`
    const res = await cfg.net.fetch({ url, method: 'GET', headers: headers() })
    if (res.status === 404) return null
    if (res.status === 401 || res.status === 403) {
      throw new Error(`认证失败或限流（${res.status}）`)
    }
    if (res.status >= 400) throw new Error(`读取失败（${res.status}）：${path}`)
    try {
      return parseContents(JSON.parse(res.text()))
    } catch (e) {
      throw new Error(`响应解析失败：${String(e)}`)
    }
  }

  /**
   * 写一个文件。`sha` 给了 ⇒ 更新（远端变过就 409 / 422 / 400）；不给 ⇒ 新建。
   * @returns {Promise<{ ok: boolean, status: number, sha: string|null, conflict?: boolean }>}
   */
  async function write(path, text, { sha = null, message = 'ZeroNote 同步' } = {}) {
    const p = encodeGitPath(repoPath(path))
    const url = `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${p}`
    const body = { message, content: b64encode(text), branch, ...(sha ? { sha } : {}) }
    const res = await cfg.net.fetch({
      url,
      method: preset.write,
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    const ok = res.status === 200 || res.status === 201
    let newSha = null
    if (ok) {
      try {
        newSha = JSON.parse(res.text())?.content?.sha ?? null
      } catch {
        /* 有些实现不返回 body，下次读回来即可 */
      }
    }
    /** 平台把「sha 不匹配」报成 409（GitHub）/ 422 / 400（各家不同） */
    const conflict = !ok && (res.status === 409 || res.status === 422 || res.status === 400)
    return { ok, status: res.status, sha: newSha, conflict }
  }

  /**
   * 读一个文件的原始字节（附件用，rev173.126）。
   *
   * ⚠️ **不能只靠 Contents API 的 `content`**：GitHub 的 `GET /contents` 会把文件当 UTF-8 文本
   * 再 base64 —— 实测 8 字节、含 `0x89` 的 png：`size` 仍是 8，但返回的 `content` 解码后是
   * 12 字节（`0x89` 变 `EF BF BD`，即 U+FFFD 替换字符）。图片 / PDF 一定不是合法 UTF-8，
   * 走 JSON 必被改写。所以先要 **raw 媒体类型**拿原始字节；平台不认 raw（回的是 JSON）时
   * 才回退解析，大文件再走 `download_url`。
   *
   * @returns {Promise<{ data: Uint8Array, sha: string|null } | null>} 不存在 ⇒ null
   */
  async function readBytes(path) {
    const p = encodeGitPath(repoPath(path))
    const url = `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${p}?ref=${encodeURIComponent(branch)}`
    const raw = await cfg.net.fetch({
      url,
      method: 'GET',
      headers: headers({ Accept: 'application/vnd.github.raw' }),
    })
    if (raw.status === 404) return null
    if (raw.status === 401 || raw.status === 403) {
      throw new Error(`认证失败或限流（${raw.status}）`)
    }
    if (raw.status >= 400) throw new Error(`读取失败（${raw.status}）：${path}`)
    const buf = raw.bytes ? raw.bytes() : new Uint8Array()
    // 不认 raw 的实现会回 JSON：首字节是 `{` 且能解析出 content / download_url 才算
    if (buf[0] !== 0x7b) return { data: buf, sha: null }
    let j = null
    try {
      j = JSON.parse(new TextDecoder().decode(buf))
    } catch {
      j = null
    }
    if (!j || (!j.content && !j.download_url)) return { data: buf, sha: null }
    if (typeof j.content === 'string' && j.content) {
      return { data: b64decodeBytes(j.content), sha: typeof j.sha === 'string' ? j.sha : null }
    }
    if (!j.download_url) throw new Error(`远端文件读不到内容（大文件且平台不给 download_url）：${path}`)
    const r2 = await cfg.net.fetch({ url: j.download_url, method: 'GET', headers: headers() })
    if (r2.status >= 400) throw new Error(`下载失败（${r2.status}）：${path}`)
    return { data: r2.bytes ? r2.bytes() : new Uint8Array(), sha: typeof j.sha === 'string' ? j.sha : null }
  }

  /** 写二进制（附件用）：base64 进 Contents API。冲突语义与 `write` 一致 */
  async function writeBytes(path, bytes, { sha = null, message = 'ZeroNote 同步：附件' } = {}) {
    const p = encodeGitPath(repoPath(path))
    const url = `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${p}`
    const body = { message, content: b64encodeBytes(bytes), branch, ...(sha ? { sha } : {}) }
    const res = await cfg.net.fetch({
      url,
      method: preset.write,
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    const ok = res.status === 200 || res.status === 201
    let newSha = null
    if (ok) {
      try {
        newSha = JSON.parse(res.text())?.content?.sha ?? null
      } catch {
        /* 有些实现不返回 body，下次读回来即可 */
      }
    }
    const conflict = !ok && (res.status === 409 || res.status === 422 || res.status === 400)
    return { ok, status: res.status, sha: newSha, conflict }
  }

  async function remove(path, sha, message = 'ZeroNote 同步：删除') {
    const p = encodeGitPath(repoPath(path))
    const url = `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${p}`
    const body = { message, sha, branch }
    const res = await cfg.net.fetch({
      url,
      method: 'DELETE',
      headers: headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    return { ok: [200, 204].includes(res.status), status: res.status }
  }

  return {
    api,
    owner,
    repo,
    branch,

    /** 连接测试：读一个文件（`manifest` 或根目录）—— 只验认证与路径，不写 */
    async test() {
      let res
      try {
        res = await cfg.net.fetch({
          url: `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?ref=${encodeURIComponent(branch)}`,
          method: 'GET',
          headers: headers(),
        })
      } catch (e) {
        return { ok: false, status: 0, hint: `连不上：${String(e).slice(0, 120)}` }
      }
      if (res.status === 200) return { ok: true, status: 200, hint: '连接正常' }
      if (res.status === 401) return { ok: false, status: 401, hint: '令牌无效（401）' }
      if (res.status === 403) return { ok: false, status: 403, hint: '令牌无权限或触发限流（403）' }
      if (res.status === 404) return { ok: false, status: 404, hint: '仓库不存在或没权限（404）——检查 owner / repo' }
      return { ok: false, status: res.status, hint: `意外状态 ${res.status}` }
    },

    read,
    write,
    readBytes,
    writeBytes,
    remove,
  }
}

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    const platform = api.host.platform === 'android' ? 'android' : 'windows'

    let settings = {
      provider: 'github',
      apiBase: '',
      owner: '',
      repo: '',
      branch: 'main',
      prefix: '',
      enabled: false,
      auto: true,
      /** 附件同步：off / relay / full（rev173.126；与另两个后端同名同义） */
      attachments: 'off',
    }
    let baseline = {}
    /** manifest 的 sha（乐观锁；写 manifest 时要带） */
    let manifestSha = null
    let conflicts = []
    let timingHistory = []
    let lastResult = null
    let formError = null
    let ready = false
    let busy = false
    let form = { provider: 'github', owner: '', repo: '', branch: '', prefix: '', token: '' }
    const baseMarked = new Set()
    /** 附件指纹缓存（rev173.126）：`mtime` + `size` 没变就复用上次的散列（只放内存） */
    const attFpCache = new Map()
    let savedToken = null

    const markDirty = () => {
      void api.store.set(KEY_SETTINGS, settings).catch((e) => api.host.log('warn', `Git 同步设置写入失败：${String(e)}`))
    }

    async function token() {
      if (savedToken !== null) return savedToken
      try {
        savedToken = (await api.host.secrets.get(SECRET_KEY)) ?? ''
      } catch {
        savedToken = ''
      }
      return savedToken
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

    const markBase = async (path, text) => {
      try {
        const history = await api.service.consume('history')
        if (history && typeof history.snapshot === 'function') {
          await history.snapshot(path, text, { tag: 'sync:git' })
        }
      } catch (e) {
        api.host.log('warn', `同步点写入失败（${path}）：${String(e)}`)
      }
    }

    /**
     * 三方合并：base 来自 history 的同步点，`theirs` 由调用方**先读好**传进来
     * （rev173.122 实测调整：冲突处理需要远端的最新 sha 才能重推，读一次就够，不要读两遍）。
     */
    async function autoMerge(path, localText, remoteText) {
      try {
        const history = await api.service.consume('history')
        const merger = await api.service.consume('kernel.merge')
        if (!history || typeof history.findBase !== 'function') return null
        if (!merger || typeof merger.mergeLines !== 'function') return null
        const base = await history.findBase(path, 'sync:git')
        if (!base) return null
        return tryAutoMerge({ base, mine: localText, theirs: remoteText, mergeLines: merger.mergeLines })
      } catch (e) {
        api.host.log('warn', `自动合并失败（${path}）：${String(e)}`)
        return null
      }
    }

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

    /**
     * 附件同步（rev173.126）。协议与 `sync-webdav` / `sync-s3` **同一套**：
     *
     * · `off`   —— 只同步 `.md`（默认）
     * · `full`  —— 附件与文档一样永久存在仓库（路径 = 笔记相对路径）
     * · `relay` —— 中转：`_zn/relay/<fp><ext>` ↔ `_zn/relay-ack/<fp>`，对端 ack 后删远端副本
     *
     * Git 的差别：一次 PUT 一个文件、`sha` 是乐观锁（冲突 409/422/400）；
     * 清理要带 sha 才能 DELETE，所以先 `read` 拿 sha。
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

        // ① 一致 ⇒ 只刷新 baseline
        if (localFp && remoteFp && localFp === remoteFp) {
          baseline[rel] = { fp: localFp, at: entry?.at ?? 0, ...(entry?.sha ? { sha: entry.sha } : {}) }
          continue
        }

        const localChanged = localFp !== base
        const remoteChanged = remoteFp !== base

        // ② 该拉：本地没有（新设备）· 或只有远端变
        if (remoteFp && (!localFp || (remoteChanged && !localChanged))) {
          try {
            const got = await client.read(rel)
            if (!got || typeof got.text !== 'string') continue
            const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : ''
            await api.fs.mkdir(parent).catch(() => {})
            await api.fs.writeText(rel, got.text)
            baseline[rel] = { fp: fingerprint(got.text), at: entry?.at ?? 0, ...(got.sha ? { sha: got.sha } : {}) }
            summary.pulled += 1
          } catch (e) {
            summary.hint = `私有文件下载失败 ${rel}：${String(e)}`
          }
          continue
        }

        // ③ 该推：远端还没有 · 或只有本地变
        if (localFp && (!remoteFp || (localChanged && !remoteChanged))) {
          try {
            const res = await client.write(rel, localText, {
              sha: entry?.sha ?? null,
              message: 'ZeroNote 同步：密码库',
            })
            if (!res.ok) {
              summary.hint = `私有文件上传失败 ${rel}（${res.status}）`
              continue
            }
            nextPriv[rel] = { fp: localFp, at: Date.now(), ...(res.sha ? { sha: res.sha } : {}) }
            baseline[rel] = { fp: localFp, at: nextPriv[rel].at, ...(res.sha ? { sha: res.sha } : {}) }
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
            const got = await client.read(rel)
            if (!got || typeof got.text !== 'string') continue
            await keepConflict(rel, '密码库双端修改')
            await api.fs.writeText(rel, got.text)
            baseline[rel] = { fp: fingerprint(got.text), at: entry?.at ?? 0, ...(got.sha ? { sha: got.sha } : {}) }
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
     *
     * Git 特有：删除 / 覆盖都要 **sha**（GitHub Contents API），所以远端条目里存 `sha`。
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
        // 空串按"没有"处理（与 `syncPrivate` 同一口径）
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
          if (localFp && remoteFp) {
            baseline[rel] = { fp: localFp, at: entry?.at ?? 0, ...(entry?.sha ? { sha: entry.sha } : {}) }
          }
          continue
        }

        if (action === 'pull') {
          try {
            const got = await client.read(rel)
            if (!got || typeof got.text !== 'string') continue
            await api.fs.mkdir(parent).catch(() => {})
            await api.fs.writeText(rel, got.text)
            baseline[rel] = {
              fp: fingerprint(got.text),
              at: entry?.at ?? 0,
              ...(got.sha ? { sha: got.sha } : {}),
            }
            summary.pulled += 1
          } catch (e) {
            summary.hint = `私密笔记下载失败 ${rel}：${String(e)}`
          }
          continue
        }

        if (action === 'push') {
          try {
            const res = await client.write(rel, localText, {
              sha: entry?.sha ?? null,
              message: 'ZeroNote 同步：私密笔记',
            })
            if (!res.ok) {
              summary.hint = `私密笔记上传失败 ${rel}（${res.status}）`
              continue
            }
            nextTree[rel] = { fp: localFp, at: Date.now(), ...(res.sha ? { sha: res.sha } : {}) }
            baseline[rel] = { fp: localFp, at: nextTree[rel].at, ...(res.sha ? { sha: res.sha } : {}) }
            summary.pushed += 1
            changed = true
          } catch (e) {
            summary.hint = `私密笔记上传失败 ${rel}：${String(e)}`
          }
          continue
        }

        if (action === 'delete-remote') {
          try {
            let sha = entry?.sha ?? null
            if (!sha) {
              const cur = await client.read(rel)
              sha = cur?.sha ?? null
            }
            if (sha) await client.remove(rel, sha, 'ZeroNote 同步：删除私密笔记')
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
          const got = await client.read(rel)
          if (!got || typeof got.text !== 'string') continue
          await keepConflict(rel, '私密笔记双端修改')
          await api.fs.writeText(rel, got.text)
          baseline[rel] = {
            fp: fingerprint(got.text),
            at: entry?.at ?? 0,
            ...(got.sha ? { sha: got.sha } : {}),
          }
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

      /** 本地附件指纹：`mtime` + `size` 没变就复用缓存；`bytes` 只在这次真读了盘时有值 */
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
          got = await client.readBytes(src)
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
          await client.writeBytes(`_zn/relay-ack/${relayName(entry.fp, '')}`, new TextEncoder().encode(me))
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
        /** full 模式用 manifest 里的 sha 当乐观锁；relay 的键与条目不是一对一，先读一次拿真实 sha */
        let sha = entry?.sha ?? null
        if (mode !== 'full') {
          try {
            sha = (await client.read(key))?.sha ?? null
          } catch {
            sha = null
          }
        }
        let r = await client.writeBytes(key, bytes, { sha })
        // 乐观锁失效（远端被绕过 manifest 改过）⇒ 重读 sha 再写一次，附件不做三方合并
        if (!r.ok && r.conflict) {
          let fresh = null
          try {
            fresh = await client.read(key)
          } catch {
            fresh = null
          }
          r = await client.writeBytes(key, bytes, { sha: fresh?.sha ?? null })
        }
        if (!r.ok) throw new Error(`上传附件失败（${r.status}）：${n.path}`)
        nextAtt[n.path] = { fp, ext, sha: r.sha ?? entry?.sha, at: Date.now(), mode }
        changed = true
        summary.pushed += 1
      }

      // ③ relay 清理：有 ack 就删远端副本（任何端都能做，幂等）
      for (const [path, entry] of Object.entries(nextAtt)) {
        if (!entry || entry.cleaned) continue
        // 只有「云端那份确实在 relay 路径上」的条目才有 ack 可等（full 条目永不清理）
        const remoteMode = entry.mode === 'full' || entry.mode === 'relay' ? entry.mode : mode
        if (remoteMode !== 'relay') continue
        const ackPath = `_zn/relay-ack/${relayName(entry.fp, '')}`
        let acked = null
        try {
          acked = await client.read(ackPath)
        } catch {
          acked = null
        }
        if (!acked) continue
        const relayPath = `_zn/relay/${relayName(entry.fp, entry.ext || extOf(path))}`
        try {
          const cur = await client.read(relayPath)
          if (cur?.sha) await client.remove(relayPath, cur.sha)
        } catch (e) {
          api.host.log('warn', `清理中转附件失败 ${path}：${String(e)}`)
        }
        nextAtt[path] = { ...entry, mode: 'relay', cleaned: true }
        changed = true
      }

      return { attachments: nextAtt, changed }
    }

    async function runSync(reason = '手动', { silent = false } = {}) {
      if (busy) return { skipped: true }
      if (!settings.owner || !settings.repo) return { error: '还没配置 owner / repo' }
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
        const client = createGitClient({ ...settings, token: await token(), net: api.net })

        // ① manifest
        let remote = { files: {}, attachments: {}, private: {}, privateTree: {} }
        const got = await client.read(MANIFEST_PATH)
        if (got && typeof got.text === 'string') {
          const m = normalizeManifest(got.text)
          remote = {
            files: m.files,
            attachments: m.attachments,
            private: m.private,
            privateTree: m.privateTree,
          }
          manifestSha = got.sha ?? null
        } else {
          manifestSha = null
        }
        timing.manifest = lap()

        // ② 逐篇比对
        const notes = await api.fs.listNotes()
        const localPaths = new Set()
        const nextFiles = { ...remote.files }
        let processed = 0
        let remoteChanged = false

        /**
         * 冲突处理（rev173.122 实测）。**先重读远端**再决定 —— 两个入口共用：
         *   ① `decideSync === 'conflict'`（manifest 已显示双端都改）
         *   ② `PUT` 返回冲突（manifest 的 sha 过期 ⇒ 远端被"绕过 manifest"改过）
         * 两者都要先把 manifest 里这篇的 fp / sha 刷成远端最新，否则会一直拿过期 sha 重试。
         */
        const resolveConflict = async (n, localText, remoteEntry) => {
          const fresh = await client.read(n.path)
          const remoteText = fresh && typeof fresh.text === 'string' ? fresh.text : null
          const remoteSha = fresh?.sha ?? remoteEntry?.sha ?? null
          if (remoteSha && remoteText !== null) {
            const freshFp = fingerprint(remoteText)
            if (remoteEntry?.fp !== freshFp || remoteEntry?.sha !== remoteSha) {
              nextFiles[n.path] = { fp: freshFp, sha: remoteSha, at: Date.now() }
              remoteChanged = true
            }
          }
          if (remoteText === null) {
            summary.hint = `远端已删除：${n.path}`
            summary.conflicts += 1
            return
          }
          const merged = await autoMerge(n.path, localText, remoteText)
          if (merged) {
            try {
              await api.fs.writeText(n.path, merged.text, { origin: 'plugin' })
            } catch (e) {
              api.host.log('warn', `合并结果落盘失败（${n.path}）：${String(e)}`)
            }
            const res2 = await client.write(n.path, merged.text, { sha: remoteSha })
            if (res2.ok) {
              const fp = fingerprint(merged.text)
              baseline[n.path] = { fp, sha: res2.sha ?? undefined }
              nextFiles[n.path] = { fp, sha: res2.sha ?? undefined, at: Date.now() }
              baseMarked.add(n.path)
              await markBase(n.path, merged.text)
              summary.merged += 1
              remoteChanged = true
              api.host.notify(`已自动合并：${n.path}`, 'info')
              return
            }
            // 又撞上（极端并发）⇒ 本机保留合并结果，base 不动，下一轮拿同一份 base 再合
            summary.hint = `合并结果未能上传（${res2.status}）：${n.path}`
            summary.conflicts += 1
            return
          }
          await keepConflict(n.path, '双端修改')
          summary.conflicts += 1
          await api.fs.writeText(n.path, remoteText, { origin: 'plugin' })
          const fp = fingerprint(remoteText)
          baseline[n.path] = { fp, sha: remoteSha }
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
            baseline[n.path] = { fp: localFp, sha: remoteEntry?.sha }
            if (!baseMarked.has(n.path)) {
              baseMarked.add(n.path)
              await markBase(n.path, localText)
            }
            continue
          }
          if (verdict === 'pull' || verdict === 'pull-new') {
            const r = await client.read(n.path)
            if (!r || typeof r.text !== 'string') continue
            await api.fs.writeText(n.path, r.text, { origin: 'plugin' })
            const fp = fingerprint(r.text)
            baseline[n.path] = { fp, sha: r.sha }
            baseMarked.add(n.path)
            await markBase(n.path, r.text)
            summary.pulled += 1
            continue
          }
          if (verdict === 'push' || verdict === 'push-new') {
            const res = await client.write(n.path, localText, { sha: remoteEntry?.sha ?? null })
            if (!res.ok) {
              /**
               * **乐观锁失效**（rev173.122 实测修）：manifest 里记的 sha 过期了 ——
               * 说明远端被"绕过 manifest"改过（网页直接编辑 / 另一台设备崩在半路）。
               * 以前这里只留一句 hint 就 continue ⇒ **下一轮还会重试同一个过期 sha，
               * 永远 409、永远推不上去**。现在当作冲突处理：重读远端 → 刷新 manifest 条目
               * → 能合就合、合不上就留副本并取远端版，本轮收口。
               */
              if (res.conflict) {
                await resolveConflict(n, localText, remoteEntry)
                continue
              }
              throw new Error(`上传失败（${res.status}）：${n.path}`)
            }
            baseline[n.path] = { fp: localFp, sha: res.sha ?? undefined }
            nextFiles[n.path] = { fp: localFp, sha: res.sha ?? undefined, at: Date.now() }
            baseMarked.add(n.path)
            await markBase(n.path, localText)
            summary.pushed += 1
            remoteChanged = true
            continue
          }
          if (verdict === 'conflict') {
            await resolveConflict(n, localText, remoteEntry)
            continue
          }
          if (verdict === 'remote-deleted') {
            delete baseline[n.path]
            summary.removed += 1
            remoteChanged = true
          }
        }

        // ③ 远端有、本地没有 ⇒ 拉
        for (const [path, entry] of Object.entries(remote.files)) {
          if (localPaths.has(path)) continue
          if (!/\.md$/i.test(path)) continue
          const r = await client.read(path)
          if (!r || typeof r.text !== 'string') continue
          try {
            await api.fs.writeText(path, r.text, { origin: 'plugin' })
          } catch (e) {
            summary.hint = `写入失败 ${path}：${String(e)}`
            continue
          }
          baseline[path] = { fp: fingerprint(r.text), sha: r.sha ?? entry.sha }
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

        // ⑤ manifest 回写（有变动才写）
        if (remoteChanged || summary.pushed > 0 || att.changed || priv.changed || privTree.changed) {
          const w = await client.write(
            MANIFEST_PATH,
            JSON.stringify({
              version: 1,
              files: nextFiles,
              attachments: att.attachments,
              private: priv.private,
              privateTree: privTree.privateTree,
            }),
            { sha: manifestSha, message: 'ZeroNote 同步：更新 manifest' },
          )
          if (w.ok) manifestSha = w.sha ?? null
        }
        timing.write = lap()
        await api.store.set(KEY_BASELINE, baseline)
        summary.hint = summary.hint || `${reason}同步完成`
        // 成功一轮 ⇒ 退避清零（限流是临时的）
        backoffLevel = 0
        backoffUntil = 0
      } catch (e) {
        summary.hint = `同步失败：${String(e)}`
        const msg = String(e)
        /**
         * 两类失败分开（rev173.279 · #12）：令牌 / 权限错立刻停（重试只会更糟）；
         * 限流（429 / `rate limit` / 403 里的 `rate`）走**指数退避**，成功后自动恢复。
         */
        if (/401|unauthorized|bad credentials|invalid token|forbidden/i.test(msg)) {
          backoffLevel = 0
          backoffUntil = 0
          stopAuto()
          if (settings.auto !== false) {
            settings.auto = false
            markDirty()
          }
          summary.hint += '（令牌无效或无权限，已暂停自动同步；改好令牌后在面板上重新开启）'
        } else if (/429|rate.?limit|too many/i.test(msg) || /限流/i.test(msg)) {
          const wait = BACKOFF_MS[Math.min(backoffLevel, BACKOFF_MS.length - 1)]
          backoffLevel = Math.min(backoffLevel + 1, BACKOFF_MS.length)
          backoffUntil = Date.now() + wait
          summary.backoffMs = wait
          summary.hint += `（远端限流，已退避 ${Math.round(wait / 1000)} 秒 —— 成功一轮后自动恢复，不用手动开）`
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
        // 退避那一轮必须刷面板 —— 否则面板还写着「自动 · 前台每 5 秒」
        if (!silent || changed || summary.backoffMs) api.view.refresh()
      }
      return summary
    }

    let autoTimer = null
    /** 限流退避状态（rev173.279 · #12）：撞几次限额、退避到哪个时间点；成功后清零 */
    let backoffLevel = 0
    let backoffUntil = 0

    function startAuto() {
      if (autoTimer || !settings.owner || !settings.repo) return
      const timer = window.setInterval(() => {
        if (busy || !settings.owner) return
        // 限流退避期：节拍照走、请求不发（成功后自动恢复）
        if (Date.now() < backoffUntil) return
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

    function render(ctx) {
      const state = ctx?.state ?? {}
      form = {
        provider: String(state['git.provider'] ?? '') || settings.provider,
        owner: String(state['git.owner'] ?? '') || settings.owner,
        repo: String(state['git.repo'] ?? '') || settings.repo,
        branch: String(state['git.branch'] ?? '') || settings.branch,
        prefix: String(state['git.prefix'] ?? '') || settings.prefix,
        token: String(state['git.token'] ?? ''),
      }
      const configured = Boolean(settings.owner && settings.repo)
      const label = PROVIDERS[settings.provider]?.label ?? settings.provider

      const children = [
        {
          type: 'text',
          value: '走代码托管平台的 Contents API（一个文件一次 GET/PUT，sha 当乐观锁）。令牌存系统凭据库。',
          variant: 'caption',
          tone: 'muted',
        },
        {
          type: 'text',
          value: configured
            ? `当前：${label} · ${settings.owner}/${settings.repo}@${settings.branch}${settings.prefix ? ` · 前缀 ${settings.prefix}` : ''}`
            : '还没配置 —— 填下面几项后点「保存设置」',
          variant: 'caption',
          tone: configured ? 'muted' : 'warn',
        },
        { type: 'divider' },
        {
          type: 'field',
          label: '平台',
          hint: 'Gitee 走 POST + access_token（未实测）；GitHub / Gitea 走 PUT',
          children: {
            type: 'select',
            bind: 'git.provider',
            options: Object.entries(PROVIDERS).map(([value, p]) => ({ value, label: p.label })),
            onSubmit: 'sync-git.set-provider',
          },
        },
        { type: 'field', label: 'owner', children: { type: 'input', bind: 'git.owner', placeholder: '用户名 / 组织' } },
        { type: 'field', label: '仓库', children: { type: 'input', bind: 'git.repo', placeholder: 'repo-name' } },
        { type: 'field', label: '分支', children: { type: 'input', bind: 'git.branch', placeholder: 'main' } },
        {
          type: 'field',
          label: '仓库内前缀（可选）',
          hint: '笔记放在仓库的哪个子目录，例如 ZeroNote',
          children: { type: 'input', bind: 'git.prefix', placeholder: 'ZeroNote' },
        },
        {
          type: 'field',
          label: '令牌',
          hint: 'GitHub: repo 权限的 PAT；Gitee: 私人令牌。只写在这里，保存后进系统凭据库',
          /* rev173.275 · 同 #14：令牌也是密码类，别明文摊着（契约 `secret: true`） */
          children: { type: 'input', bind: 'git.token', secret: true, placeholder: '不改就留空' },
        },
        {
          type: 'field',
          label: '附件（图片 / PDF）',
          hint: '不同步 = 只同步 .md；中转 = 对端收到后仓库里删掉（省空间）；永久 = 与文档一样',
          children: {
            type: 'select',
            bind: 'git.attachmentsMode',
            options: [
              { value: 'off', label: '不同步（默认）' },
              { value: 'relay', label: '同步中转（仓库不常留）' },
              { value: 'full', label: '与文档一样永久同步' },
            ],
            onSubmit: 'sync-git.set-attachments',
          },
        },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            { type: 'button', label: '保存设置', onClick: 'sync-git.save' },
            { type: 'button', label: '测试连接', onClick: 'sync-git.test', variant: 'ghost' },
            { type: 'button', label: '立即同步', onClick: 'sync-git.sync', disabled: !configured || busy },
            {
              type: 'button',
              label: settings.auto === false ? '开启自动同步' : '关闭自动同步',
              onClick: 'sync-git.toggle-auto',
              variant: 'ghost',
            },
            { type: 'button', label: '断开连接', onClick: 'sync-git.disconnect', variant: 'danger' },
          ],
        },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            {
              type: 'badge',
              text:
                settings.auto === false
                  ? '手动同步'
                  : backoffUntil > Date.now()
                    ? `自动 · 限流退避中（${Math.ceil((backoffUntil - Date.now()) / 1000)} 秒后重试）`
                    : '自动 · 前台每 5 秒',
              tone: settings.auto === false ? 'muted' : backoffUntil > Date.now() ? 'warn' : 'success',
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
            ...(lastResult.merged > 0 ? [{ type: 'badge', text: `合并 ${lastResult.merged}`, tone: 'success' }] : []),
            { type: 'badge', text: `冲突 ${lastResult.conflicts}`, tone: lastResult.conflicts > 0 ? 'danger' : 'success' },
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
      const owner = String(form.owner ?? '').trim()
      const repo = String(form.repo ?? '').trim()
      if (!owner) {
        formError = 'owner 不能为空'
        api.view.refresh()
        return
      }
      if (!repo) {
        formError = '仓库名不能为空'
        api.view.refresh()
        return
      }
      settings = {
        ...settings,
        provider: PROVIDERS[form.provider] ? form.provider : 'github',
        owner,
        repo,
        branch: String(form.branch ?? '').trim() || 'main',
        prefix: String(form.prefix ?? '').trim().replace(/^\/+|\/+$/g, ''),
        enabled: true,
      }
      const t = String(form.token ?? '')
      if (t) {
        try {
          await api.host.secrets.set(SECRET_KEY, t)
          savedToken = t
        } catch (e) {
          formError = `令牌写入系统凭据库失败：${String(e)}`
          api.view.refresh()
          return
        }
      }
      markDirty()
      if (settings.auto !== false) startAuto()
      api.host.notify('Git 同步设置已保存')
      api.view.refresh()
    }

    api.view.registerPanel({ id: PANEL_ID, title: '同步 · Git', location: 'main', render })
    register('sync-git.open', '同步：打开 Git 设置与状态', () => openPanel())
    register('sync-git.save', '同步：保存 Git 设置', () => saveSettings())
    register('sync-git.set-provider', '同步：选择 Git 平台', (payload) => {
      const v = String(payload?.value ?? 'github')
      settings.provider = PROVIDERS[v] ? v : 'github'
      markDirty()
      api.host.notify(`同步平台：${PROVIDERS[settings.provider].label}`)
      api.view.refresh()
    })
    register('sync-git.test', '同步：测试 Git 连接', async () => {
      stopAuto()
      let ok = false
      try {
        const client = createGitClient({ ...settings, token: await token(), net: api.net })
        const r = await client.test()
        ok = r.ok
        api.host.notify(r.ok ? `连接正常（${r.status}）` : r.hint, r.ok ? 'info' : 'error')
        lastResult = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, hint: r.hint, at: Date.now() }
      } catch (e) {
        api.host.notify(`连接测试失败：${String(e)}`, 'error')
        lastResult = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, hint: `连接测试失败：${String(e)}`, at: Date.now() }
      } finally {
        if (ok && settings.owner && settings.auto !== false) startAuto()
        else if (!ok && settings.auto !== false) {
          settings.auto = false
          markDirty()
        }
      }
      api.view.refresh()
    })
    register('sync-git.sync', '同步：立即同步一次（Git）', () => runSync('手动'))
    register('sync-git.set-attachments', '同步：设置附件同步方式（Git）', (payload) => {
      const v = String(payload?.value ?? 'off')
      settings.attachments = ['off', 'relay', 'full'].includes(v) ? v : 'off'
      markDirty()
      const label =
        settings.attachments === 'off'
          ? '不同步（只同步 .md）'
          : settings.attachments === 'relay'
            ? '同步中转（对端收到后仓库删掉）'
            : '与文档一样永久同步'
      api.host.notify(`附件同步：${label}`)
      api.view.refresh()
    })
    register('sync-git.toggle-auto', '同步：开关自动同步（Git）', () => {
      settings.auto = settings.auto === false
      markDirty()
      if (settings.auto === false) {
        stopAuto()
        api.host.notify('已关闭自动同步（Git）')
      } else {
        startAuto()
        api.host.notify('已开启自动同步（Git，前台每 5 秒）')
      }
      api.view.refresh()
    })
    register('sync-git.disconnect', '同步：断开 Git 并清除令牌', async () => {
      try {
        await api.host.secrets.delete(SECRET_KEY)
      } catch (e) {
        api.host.log('warn', `删除令牌失败：${String(e)}`)
      }
      savedToken = null
      stopAuto()
      settings = { ...settings, owner: '', repo: '', prefix: '', enabled: false }
      baseline = {}
      manifestSha = null
      markDirty()
      void api.store.set(KEY_BASELINE, {}).catch(() => {})
      api.host.notify('已断开 Git 同步并清除令牌')
      api.view.refresh()
    })

    void (async () => {
      try {
        settings = { ...settings, ...((await api.store.get(KEY_SETTINGS, {})) ?? {}) }
        baseline = (await api.store.get(KEY_BASELINE, {})) ?? {}
        conflicts = (await api.store.get(KEY_CONFLICTS, [])) ?? []
        timingHistory = (await api.store.get(KEY_TIMING, [])) ?? []
      } catch (e) {
        api.host.log('warn', `Git 同步设置读取失败：${String(e)}`)
      }
      ready = true
      api.view.refresh()
      if (settings.owner && settings.repo && settings.auto !== false) startAuto()

      const onVisible = () => {
        if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
        if (!settings.owner) return
        void runSync('回到前台', { silent: true })
      }
      document.addEventListener('visibilitychange', onVisible)
      api.subscriptions.push({ dispose: () => document.removeEventListener('visibilitychange', onVisible) })

      api.host.log(
        'info',
        `Git 同步插件就绪（${platform}，${settings.owner ? '已配置' : '未配置'}，自动=${settings.auto !== false}，ready=${ready}）`,
      )
    })()
  },
}
