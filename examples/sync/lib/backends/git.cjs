/**
 * 同步后端 · Git 托管（git）—— rev173.288（从 `examples/sync-git` 并入）
 *
 * 走 **仓库 Contents API**（GitHub / Gitea / Gitee），不是 git 协议：插件只有 `net` 原语，
 * 没有 git 实现，也不需要 —— 我们只需要“读一个文件 / 写一个文件 / 删一个文件”。
 *
 * 与 S3 / WebDAV 的差别：
 * · 没有目录、没有 ETag：**`sha` 就是版本号**（用它做乐观锁，与 S3 的 `If-Match` 同一个角色）
 * · 上传是 base64 进 JSON（附件必须走 raw / download_url，否则 png 会被 UTF-8 改写 —— 见 `readBytes`）
 * · 平台对“sha 不匹配”的回码不统一：GitHub 409、其它 422 / 400 ⇒ 一律按冲突处理
 *
 * 引擎侧完全复用（`get` / `put` / `readManifest` / `writeManifest` 同一套方法名），
 * 本文件的 `createGitStorage` 就是把 Contents 客户端适配成那套名字。
 */
const { MANIFEST_REL, normalizeManifest } = require('../core.cjs')

/** manifest 在仓库内的落点（与 WebDAV / S3 同一个文件） */
const MANIFEST_PATH = MANIFEST_REL
/** 平台预设：API 根 + 写方法 + 认证方式 */
const PROVIDERS = {
  github: { label: 'GitHub', api: 'https://api.github.com', write: 'PUT', auth: 'bearer' },
  gitea: { label: 'Gitea / Forgejo', api: 'https://gitea.com/api/v1', write: 'PUT', auth: 'bearer' },
  gitee: { label: 'Gitee', api: 'https://gitee.com/api/v5', write: 'POST', auth: 'token' },
}

/**
 * UTF-8 → base64。
 *
 * **不能用 `btoa(text)` 直接编**：它按 Latin-1 走，遇到中文直接抛
 * `InvalidCharacterError`（与 `sync-webdav` 的 Basic 认证同一个坑）。
 */
function b64encode(text) {
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
function b64decode(b64) {
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
function b64encodeBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? [])
  let bin = ''
  const CHUNK = 0x8000 // 一次性拼太长的字符串在部分 WebView 上会爆栈
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + CHUNK)))
  }
  return btoa(bin)
}

/** base64 → 字节（先剥空白：平台返回的大文件 base64 每 60 字符一个 `\n`） */
function b64decodeBytes(b64) {
  const clean = String(b64 ?? '').replace(/\s+/g, '')
  const bin = atob(clean)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/** 库内相对路径 → URL 段（逐段编码，保留 `/`） */
function encodeGitPath(path) {
  return String(path ?? '')
    .split('/')
    .filter((s) => s && s !== '.')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

/**
 * 把 Contents API 的一个条目归一成我们的形状。
 *
 * 真实响应（实测 GitHub · 2026-10-25）：
 * `{ name: 'README', sha: '980a0d5f…', size: 13, encoding: 'base64', content: 'SGVsbG8…' }`
 * 目录响应是**数组**（每项 `{ name, path, type: 'file'|'dir', sha }`，没有 content）。
 */
function parseContents(entry) {
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
function createGitClient(cfg) {
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

/**
 * 把 Git 客户端适配成 **WebDAV 客户端的同一套方法名**（引擎因此不用改）。
 *
 * 三个映射要点：
 * · `etag` ↔ **`sha`**：Git 没有 ETag，文件版本就是 sha；引擎的乐观锁参数走同一个位置。
 * · `mkdir` 是空操作：仓库没有目录，路径里的 `/` 由 Contents API 自己处理。
 * · `remove` 必须带 sha：先读一次拿当前 sha 再删（删不掉只会让下一轮再试，不报错）。
 */
function createGitStorage(cfg) {
  const c = createGitClient(cfg)

  /** 读一次文本 + sha；目录 / 不存在都返回 null */
  async function readOne(rel) {
    const r = await c.read(rel)
    if (!r || typeof r.text !== 'string') return null
    return { text: r.text, sha: r.sha ?? null }
  }

  return {
    kind: 'git',
    test: () => c.test(),
    async get(rel) {
      const got = await readOne(rel)
      return got ? got.text : null
    },
    async getWithEtag(rel) {
      const got = await readOne(rel)
      return got ? { text: got.text, etag: got.sha ?? undefined } : null
    },
    /**
     * 写文本。`ifMatch` = 期望的 sha（乐观锁）：
     * 平台会在 sha 不匹配时回 409 / 422 / 400，这里统一折成 `precondition`。
     */
    async put(rel, text, ifMatch) {
      const w = await c.write(rel, text, { sha: ifMatch || null })
      return {
        ok: w.ok,
        status: w.status,
        etag: w.sha ?? undefined,
        precondition: !!w.conflict,
      }
    },
    /** 仓库没有目录 */
    async mkdir() {},
    async readManifest() {
      const got = await readOne(MANIFEST_PATH)
      if (!got) {
        return { files: {}, attachments: {}, private: {}, privateTree: {}, etag: null, notModified: false }
      }
      const m = normalizeManifest(got.text)
      return { ...m, etag: got.sha, notModified: false }
    },
    async writeManifest(manifest) {
      // 更新已有文件必须带 sha ⇒ 先读当前 sha（没有就是新建）
      const cur = await readOne(MANIFEST_PATH)
      const body = JSON.stringify({
        version: 1,
        files: manifest.files ?? {},
        attachments: manifest.attachments ?? {},
        private: manifest.private ?? {},
        privateTree: manifest.privateTree ?? {},
      })
      const w = await c.write(MANIFEST_PATH, body, { sha: cur?.sha ?? null })
      return { ok: w.ok, status: w.status, etag: w.sha ?? undefined }
    },
    async getBytes(rel) {
      const r = await c.readBytes(rel)
      if (!r || !r.data) return { data: null, notModified: false, etag: null }
      return { data: r.data, notModified: false, etag: r.sha ?? null }
    },
    async putBytes(rel, bytes, ifMatch) {
      const w = await c.writeBytes(rel, bytes, { sha: ifMatch || null })
      return { ok: w.ok, status: w.status, etag: w.sha ?? undefined, precondition: !!w.conflict }
    },
    async remove(rel) {
      const cur = await readOne(rel)
      if (!cur?.sha) return { ok: true, status: 404 }
      return c.remove(rel, cur.sha)
    },
    async exists(rel) {
      const got = await readOne(rel)
      return !!got
    },
  }
}

module.exports = {
  MANIFEST_PATH,
  PROVIDERS,
  b64decode,
  b64decodeBytes,
  b64encode,
  b64encodeBytes,
  createGitClient,
  createGitStorage,
  encodeGitPath,
  parseContents,
}