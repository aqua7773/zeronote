/**
 * 同步 · WebDAV（sync-webdav）—— rev173.108
 *
 * 直连用户自己的 WebDAV（坚果云 / Nextcloud / 群晖 / dufs），**不依赖任何第三方同步工具**。
 * 与 `sync-folder` 的差别：那个不搬文件（库放同步目录，搬运交给 Syncthing 之类），
 * 这个自己搬 —— 因为远端是网络存储，App 必须自己发请求。
 *
 * ## 为什么请求走 `ctx.net` 而不是自己 `fetch`
 *
 * WebDAV 的 `PROPFIND` / `MKCOL` / `MOVE` 带自定义方法与非简单头，WebView 里必然触发 CORS
 * preflight；服务器不回 CORS 头时前端只能看到 `TypeError: Failed to fetch`，
 * **分不清 CORS / 断网 / 401**（2026-10-12 踩过）。`ctx.net` 由 Rust 侧发请求，没有 CORS。
 *
 * ## 同步模型
 *
 * 远端 `<根>/_zn/manifest.json` 是唯一权威：
 * ```json
 * { "version": 1, "files": { "日记/2026.md": { "fp": "1a:abc", "etag": "\"x\"", "at": 123 } } }
 * ```
 * 每篇的 `fp` 是内容指纹（与 `sync-folder` 同一套算法），`etag` 给 `If-Match` 用。
 *
 * 一次同步：
 *   1. `GET manifest`（带 `If-None-Match`；没变 ⇒ 304，直接结束）
 *   2. 逐篇比较：`base`（上次同步的 fp） vs 本地 fp vs 远端 fp
 *      · 只有本地变 ⇒ `PUT`（带 `If-Match: 上次的 etag`）
 *      · 只有远端变 ⇒ `GET` 并写回本地
 *      · 两边都变 ⇒ **冲突**：本地版留 `.zn/conflicts/<平台>/…`，然后取远端版
 *      · `If-Match` 拿到 **412**（远端在我们读 manifest 之后又变了）⇒ 同样按冲突处理
 *   3. 更新本地 `baseline`，把 manifest 推回远端
 *
 * ## 凭据
 *
 * **不落磁盘明文**：密码走 `ctx.host.secrets`（Windows 凭据管理器 / Android Keystore），
 * 账号与地址落 `store`（那不是机密）。断开连接 = 删凭据 + 清设置。
 */

const PANEL_ID = 'sync-webdav.status'
const KEY_SETTINGS = 'settings.v1'
const KEY_BASELINE = 'baseline.v1'
const KEY_CONFLICTS = 'conflicts.v1'
const SECRET_KEY = 'sync.webdav.password'

const CONFLICT_ROOT = '.zn/conflicts'
/** manifest 在远端的落点（相对同步根） */
const MANIFEST_REL = '_zn/manifest.json'
/** 单次同步最多处理多少篇（防止第一次全量时把界面吊死） */
const MAX_FILES_PER_RUN = 200
/** 自动同步节拍：前台每 5 秒跑一次（坚果云 600 次/30min ≈ 12 次/分钟，5 秒正好 12 次） */
const AUTO_MS = 5000
/** 冲突记录上限 */
const MAX_CONFLICTS = 100

/* ───────────────────────── 纯函数（tests/sync-webdav.test.ts 单测） ───────────────────────── */

/** 内容指纹：长度 + FNV-1a 32 位（与 sync-folder 同一套，两边判据一致） */
export function fingerprint(text) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `${s.length.toString(36)}:${h.toString(36)}`
}

/** 库内相对路径 → URL 段（逐段编码，保留 `/`；空格与中文都要编码） */
export function encodeDavPath(rel) {
  return String(rel ?? '')
    .split('/')
    .filter((s) => s && s !== '.')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

/**
 * Basic 认证头。**必须按 UTF-8 编码再 base64** —— `btoa('中文:密码')` 会抛
 * `InvalidCharacterError`（超出 Latin-1）。坚果云这类用邮箱当账号的没事，
 * 但用户自己填中文用户名就崩。
 */
export function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user ?? ''}:${pass ?? ''}`)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return `Basic ${btoa(bin)}`
}

/** 把 `<base>/<root>/<rel>` 拼成一个合法 URL（去掉多余斜杠，但保留协议部分的 `//`） */
export function joinUrl(base, root, rel) {
  const b = String(base ?? '').trim().replace(/\/+$/, '')
  const r = encodeDavPath(root)
  const p = encodeDavPath(rel)
  return [b, r, p].filter(Boolean).join('/')
}

/**
 * 解析 `PROPFIND Depth: 1` 的 207 XML。
 *
 * 容错要点（各家服务器都踩过）：
 * · 命名空间前缀不一定是 `d:`（Nextcloud 用 `d`，坚果云用 `D`，还有不写前缀的）；
 * · `<d:href>` 是**已编码**的绝对路径，要比 `decodeURIComponent` 之后才好用；
 * · 目录的 `resourcetype` 里带 `<d:collection/>`；
 * · `getetag` 可能带引号（原样保留 —— `If-Match` 要用一模一样的那串）。
 *
 * @returns {{ path: string, href: string, isDir: boolean, etag: string | null, size: number | null }[]}
 *          `path` 是**去掉同步根前缀**后的相对路径（根自身返回空串）
 */
/** XML 实体解码（WebDAV 的 href 里 `&amp;` 很常见） */
function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, ent) => {
    const e = String(ent).toLowerCase()
    if (e === 'lt') return '<'
    if (e === 'gt') return '>'
    if (e === 'amp') return '&'
    if (e === 'quot') return '"'
    if (e === 'apos') return "'"
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16) || 0)
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10) || 0)
    return m
  })
}

/** 从一段 XML 里取标签内容（容忍命名空间前缀与属性） */
function pickTag(block, name) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}\\s*>`, 'i')
  const m = re.exec(block)
  return m ? m[1] : null
}

/**
 * 解析 `PROPFIND Depth: 1` 的 207 XML。
 *
 * **故意不用 `DOMParser`**（rev173.108 实测）：`happy-dom` 对 `application/xml` 的
 * `getElementsByTagNameNS` / CSS 选择器支持不完整（单测全红），而 WebDAV 的 207 结构是固定的
 * —— 一堆扁平的 `<response>`，每块里几个单值标签。用「切块 + 取标签」的正则更小、更可测，
 * 也不再依赖宿主对 XML 命名空间的支持（旧 Android WebView 一样跑）。
 *
 * 容错：前缀 `d:` / `D:` / 无前缀都认；`&amp;` 这类实体解码；坏数据返回空表而非抛错。
 *
 * @returns {{ path: string, href: string, isDir: boolean, etag: string | null, size: number | null }[]}
 *          `path` 是**去掉同步根前缀**后的相对路径（根自身被过滤掉）
 */
export function parsePropfind(xml, { rootPrefix = '' } = {}) {
  const text = String(xml ?? '')
  if (!text.trim()) return []
  const blocks = [...text.matchAll(/<(?:[\w.-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?response\s*>/gi)].map(
    (m) => m[1],
  )
  const prefix = rootPrefix ? decodeURIComponent(rootPrefix).replace(/\/+$/, '') : ''

  return blocks.map((block) => {
    const rawHref = decodeEntities(pickTag(block, 'href') ?? '').trim()
    const rawEtag = decodeEntities(pickTag(block, 'getetag') ?? '').trim()
    const rawLen = decodeEntities(pickTag(block, 'getcontentlength') ?? '').trim()
    const isDir = /<(?:[\w.-]+:)?collection\b/i.test(block) || /\/$/.test(rawHref)

    let path = ''
    try {
      path = decodeURIComponent(rawHref)
    } catch {
      path = rawHref
    }
    if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length)
    path = path.replace(/^\/+/, '').replace(/\/+$/, '')

    const etag = rawEtag || null
    const size = /^\d+$/.test(rawLen) ? Number(rawLen) : null
    // 根自身解析成空串（调用方按需过滤）
    if (isDir && path === '') return { path: '', href: rawHref, isDir: true, etag, size: null }
    return { path, href: rawHref, isDir, etag, size }
  })
}

/**
 * 判定一篇该怎么走。
 *
 * @param {{fp: string, etag?: string} | null} base    上次同步时的版本
 * @param {string} localFp                              本地当前指纹
 * @param {string | null} remoteFp                      远端当前指纹（manifest 里的；`null` = 远端没有这篇）
 * @returns {'noop'|'push'|'pull'|'conflict'|'push-new'|'pull-new'|'remote-deleted'}
 */
export function decideSync({ base, localFp, remoteFp }) {
  const hasBase = !!base
  if (remoteFp == null) {
    // 远端没有这篇
    if (!hasBase) return 'push-new' // 本地新增
    return base.fp === localFp ? 'remote-deleted' : 'conflict' // 远端删了、本地改过 ⇒ 冲突
  }
  if (!hasBase) {
    // 远端有、本地没有基线：本地没有这篇 ⇒ 拉；本地有且内容相同 ⇒ noop
    return localFp === remoteFp ? 'pull-new' : 'pull-new'
  }
  const localChanged = localFp !== base.fp
  const remoteChanged = remoteFp !== base.fp
  if (!localChanged && !remoteChanged) return 'noop'
  if (remoteChanged && !localChanged) return 'pull'
  if (!remoteChanged && localChanged) return 'push'
  // 两边都变了；如果两边恰好变成同一个内容（同一份改动各自应用），不算冲突
  return localFp === remoteFp ? 'noop' : 'conflict'
}

/** 冲突副本文件名（`.zn/conflicts/<平台>/<YYYY-MM-DD HHmm>-<名>.md`，与 sync-folder 同一套规则） */
export function conflictFileName(path, at, taken = () => false) {
  const d = new Date(at)
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`
  const file = String(path ?? '').split('/').pop() || 'note.md'
  const base = file.replace(/\.md$/i, '') || 'note'
  let name = `${stamp}-${base}.md`
  let i = 2
  while (taken(name)) {
    name = `${stamp}-${base}-${i}.md`
    i += 1
  }
  return name
}

/** 远端 manifest 的形状校验（坏数据当作空，不让同步整个停摆） */
export function normalizeManifest(raw) {
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    const files = j && typeof j === 'object' && j.files && typeof j.files === 'object' ? j.files : {}
    const out = {}
    for (const [path, v] of Object.entries(files)) {
      if (!v || typeof v !== 'object') continue
      if (typeof v.fp !== 'string') continue
      out[path] = { fp: v.fp, etag: typeof v.etag === 'string' ? v.etag : undefined, at: Number(v.at) || 0 }
    }
    return { version: 1, files: out }
  } catch {
    return { version: 1, files: {} }
  }
}

/* ───────────────────────── WebDAV 客户端 ───────────────────────── */

/**
 * 一层薄封装：只认 `ctx.net`，不关心 UI。
 *
 * @param {{ baseUrl: string, username: string, password: string, root: string, net: object }} cfg
 */
export function createDavClient(cfg) {
  const baseUrl = String(cfg.baseUrl ?? '').trim()
  const root = String(cfg.root ?? '').trim().replace(/^\/+|\/+$/g, '')
  const auth = basicAuth(cfg.username, cfg.password)

  const urlFor = (rel = '') => joinUrl(baseUrl, root, rel)

  /** 发一个请求，返回原始 `NetResponse`（**不抛 4xx**，调用方自己看 status） */
  const request = (method, rel, { headers = {}, body, timeoutMs = 30000 } = {}) =>
    cfg.net.fetch({
      url: urlFor(rel),
      method,
      headers: { Authorization: auth, ...headers },
      body,
      timeoutMs,
    })

  /** 建目录（逐级）；405 = 已存在算成功。`test()` 的 404 自动创建与 sync 里上传前都靠它 */
  const mkdirPath = async (rel) => {
    const parts = String(rel ?? '')
      .split('/')
      .filter(Boolean)
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      const res = await request('MKCOL', acc)
      if (![200, 201, 204, 405].includes(res.status)) {
        throw new Error(`建目录失败（${res.status}）：${acc}`)
      }
    }
  }

  return {
    baseUrl,
    root,
    urlFor,
    request,

    /**
     * 连接测试：对同步根发 `PROPFIND Depth: 0`。返回 `{ ok, status, hint }`。
     *
     * **404 且填了「同步目录」⇒ 自动把它建出来再测一次**（rev173.108 实测踩到：
     * 用户第一次配时远端还没有那个子目录，直接报 404 会让人以为地址填错了）。
     */
    async test() {
      const probe = () =>
        request('PROPFIND', '', {
          headers: { Depth: '0', 'Content-Type': 'application/xml; charset=utf-8' },
          body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
        })

      let res = await probe()
      let created = false
      if (res.status === 404 && root) {
        try {
          await mkdirPath(root)
          res = await probe()
          created = res.status === 207 || res.status === 200
        } catch {
          /* 建不出来就照旧按 404 报 */
        }
      }
      if (res.status === 207 || res.status === 200) {
        return { ok: true, status: res.status, hint: created ? '连接正常（已自动创建同步目录）' : '连接正常' }
      }
      if (res.status === 401) return { ok: false, status: 401, hint: '账号或密码不对（401）' }
      if (res.status === 403) return { ok: false, status: 403, hint: '没有权限（403）' }
      if (res.status === 404) return { ok: false, status: 404, hint: '远端目录不存在（404）——检查「同步目录」' }
      if (res.status === 405) return { ok: false, status: 405, hint: '这个地址不支持 WebDAV（405）' }
      return { ok: false, status: res.status, hint: `意外状态 ${res.status}` }
    },

    /** 列目录（Depth: 1）。返回不含根自身的条目 */
    async list(rel = '') {
      const res = await request('PROPFIND', rel, {
        headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getetag/><d:getcontentlength/></d:prop></d:propfind>',
      })
      if (res.status !== 207 && res.status !== 200) {
        throw new Error(`列目录失败（${res.status}）：${rel || '/'}`)
      }
      const rootPrefix = new URL(urlFor(rel)).pathname.replace(/\/+$/, '')
      return parsePropfind(res.text(), { rootPrefix }).filter((e) => e.path !== '')
    },

    /** 读一个文件；不存在返回 `null`（不抛） */
    async get(rel) {
      const res = await request('GET', rel)
      if (res.status === 404) return null
      if (res.status >= 400) throw new Error(`下载失败（${res.status}）：${rel}`)
      return res.text()
    },

    /**
     * 写一个文件。返回 `{ ok, status, etag }`：
     * · `ok: true` = 写成功（201/204/200）
     * · `status: 412` = **乐观锁失败**（远端在我们读 manifest 之后又变了）⇒ 调用方按冲突处理
     */
    async put(rel, text, ifMatch) {
      const headers = { 'Content-Type': 'text/markdown; charset=utf-8' }
      if (ifMatch) headers['If-Match'] = ifMatch
      const res = await request('PUT', rel, { headers, body: text })
      const etag = res.headers['etag'] ?? null
      const ok = res.status === 200 || res.status === 201 || res.status === 204
      return { ok, status: res.status, etag }
    },

    /**
     * 建目录（逐级）；405 = 已存在，算成功。
     *
     * 注意这里传的是**相对同步根**的路径：`mkdir('日记/2026')` 会建 `<根>/日记` 与 `<根>/日记/2026`。
     * 建同步根本身要传 `root`（`test()` 里那个 404 自动创建走的就是这条）。
     */
    mkdir: mkdirPath,

    /** 读远端 manifest；没有返回空表 */
    async readManifest() {
      const text = await this.get(MANIFEST_REL)
      return normalizeManifest(text ?? '{"version":1,"files":{}}')
    },

    /** 写远端 manifest（先确保 `_zn/` 存在） */
    async writeManifest(manifest) {
      await this.mkdir('_zn')
      const body = JSON.stringify({ version: 1, files: manifest.files })
      // 不做 If-Match：manifest 是"尽力而为"的索引，真冲突靠每篇文件的 etag 兜
      return this.put(MANIFEST_REL, body)
    },
  }
}

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    const platform = api.host.platform === 'android' ? 'android' : 'windows'

    let settings = { baseUrl: '', username: '', root: '', enabled: false, auto: true }
    let baseline = {}
    let conflicts = []
    let ready = false
    let busy = false
    /** 上一次同步的摘要（面板展示） */
    let lastResult = null
    let formError = null
    /**
     * 表单的镜像值。
     *
     * 宿主的 `input.bind` 只把用户输入写进 **`ViewCtx.state`**，而 `command.run` **拿不到 ctx**
     * ⇒ render 时把 state 抄一份到这里，命令读这份（与 habit 的 `draftView` 同一个做法）。
     */
    let form = {
      baseUrl: '',
      username: '',
      password: '',
      root: '',
    }

    const markDirty = () => {
      void api.store
        .set(KEY_SETTINGS, settings)
        .catch((e) => api.host.log('warn', `同步设置写入失败：${String(e)}`))
    }

    const savedPasswords = new Map()

    async function password() {
      if (savedPasswords.has('p')) return savedPasswords.get('p')
      let p = ''
      try {
        p = (await api.host.secrets.get(SECRET_KEY)) ?? ''
      } catch (e) {
        api.host.log('warn', `读取凭据失败：${String(e)}`)
      }
      savedPasswords.set('p', p)
      return p
    }

    const conflictDir = `${CONFLICT_ROOT}/${platform}`
    const takenNames = new Set()

    async function keepConflict(path, reason) {
      let localText = null
      try {
        localText = await api.fs.readText(path)
      } catch {
        localText = null
      }
      let fileName = null
      if (localText != null) {
        fileName = conflictFileName(path, Date.now(), (n) => takenNames.has(n))
        takenNames.add(fileName)
        try {
          await api.fs.mkdir(conflictDir)
          await api.fs.writeText(`${conflictDir}/${fileName}`, localText)
        } catch (e) {
          api.host.log('warn', `冲突副本写入失败：${String(e)}`)
          fileName = null
        }
      }
      conflicts.unshift({ path, file: fileName, platform, at: Date.now(), reason, lost: localText == null })
      if (conflicts.length > MAX_CONFLICTS) conflicts.length = MAX_CONFLICTS
      void api.store.set(KEY_CONFLICTS, conflicts).catch(() => {})
      api.host.notify(
        localText == null ? `同步冲突：${path}（本机版未留存）` : `同步冲突：${path} → ${fileName}`,
        'warn',
      )
      api.view.refresh()
    }

    /**
     * 一次完整同步。返回摘要，不抛（错误转成 hint）。
     *
     * `silent`（自动轮询用）：不弹错误 toast、无变化时不刷面板 —— 否则每 5 秒一次重渲染，
     * 用户正在面板里填东西时输入框会被刷掉。
     */
    async function runSync(reason = '手动', { silent = false } = {}) {
      if (busy) return { skipped: true }
      if (!settings.baseUrl) return { error: '还没配置 WebDAV 地址' }
      busy = true
      if (!silent) api.view.refresh()
      const summary = { pulled: 0, pushed: 0, conflicts: 0, removed: 0, hint: '' }
      try {
        const client = createDavClient({ ...settings, password: await password(), net: api.net })
        const remote = await client.readManifest()
        const notes = await api.fs.listNotes()
        const localPaths = new Set()
        const nextFiles = { ...remote.files }

        let processed = 0
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
            continue
          }
          if (verdict === 'pull' || verdict === 'pull-new') {
            const text = await client.get(n.path)
            if (text == null) continue
            await api.fs.writeText(n.path, text)
            const fp = fingerprint(text)
            baseline[n.path] = { fp, etag: remoteEntry?.etag }
            summary.pulled += 1
            continue
          }
          if (verdict === 'push' || verdict === 'push-new') {
            await client.mkdir(n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '')
            const res = await client.put(n.path, localText, undefined)
            if (res.status === 412) {
              await keepConflict(n.path, '远端在同步期间又变了')
              summary.conflicts += 1
              continue
            }
            if (!res.ok) throw new Error(`上传失败（${res.status}）：${n.path}`)
            baseline[n.path] = { fp: localFp, etag: res.etag ?? undefined }
            nextFiles[n.path] = { fp: localFp, etag: res.etag ?? undefined, at: Date.now() }
            summary.pushed += 1
            continue
          }
          if (verdict === 'conflict') {
            await keepConflict(n.path, '双端修改')
            summary.conflicts += 1
            // 取远端版（本机版已经进冲突目录）
            const text = await client.get(n.path)
            if (text != null) {
              await api.fs.writeText(n.path, text)
              const fp = fingerprint(text)
              baseline[n.path] = { fp, etag: remoteEntry?.etag }
              summary.pulled += 1
            }
            continue
          }
          if (verdict === 'remote-deleted') {
            delete baseline[n.path]
            summary.removed += 1
          }
        }

        // 本地没有、远端有的笔记 ⇒ 拉下来
        for (const [path, entry] of Object.entries(remote.files)) {
          if (localPaths.has(path)) continue
          if (!/\.md$/i.test(path)) continue
          const text = await client.get(path)
          if (text == null) continue
          try {
            await api.fs.writeText(path, text)
          } catch (e) {
            summary.hint = `写入失败 ${path}：${String(e)}`
            continue
          }
          baseline[path] = { fp: fingerprint(text), etag: entry.etag }
          summary.pulled += 1
        }

        // manifest 回写（把本轮上传的条目并进去）
        if (summary.pushed > 0) await client.writeManifest({ files: nextFiles })
        await api.store.set(KEY_BASELINE, baseline)
        summary.hint = summary.hint || `${reason}同步完成`
      } catch (e) {
        summary.hint = `同步失败：${String(e)}`
        if (!silent) api.host.notify(summary.hint, 'error')
        else api.host.log('warn', summary.hint)
      } finally {
        busy = false
        const changed = summary.pulled + summary.pushed + summary.conflicts + summary.removed > 0
        lastResult = { ...summary, at: Date.now() }
        // 自动轮询下「什么都没变」不刷面板（每 5 秒重渲染会把用户正在填的表单刷掉）
        if (!silent || changed) api.view.refresh()
      }
      return summary
    }

    /* ── 自动同步（「无感」就是这一段） ── */

    let autoTimer = null

    /**
     * 开自动同步：前台每 `AUTO_MS` 跑一次。
     *
     * 三条约束（都对应一个真实坑）：
     * · **只在前台跑**：Android 切后台会挂起定时器（方案 §8 第 5 条，用户已接受这个边界），
     *   这里再判一道，免得在桌面端空转打远端；
     * · `busy` 时跳过：手动同步正在跑时不能再起一轮；
     * · 静默模式：没变化不刷面板（每 5 秒重渲染会把用户正在填的表单刷掉）。
     */
    function startAuto() {
      if (autoTimer || !settings.baseUrl) return
      const timer = window.setInterval(() => {
        if (busy || !settings.baseUrl) return
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        void runSync('自动', { silent: true })
      }, AUTO_MS)
      autoTimer = timer
      api.subscriptions.push({
        __syncAuto: true,
        dispose: () => {
          window.clearInterval(timer)
          if (autoTimer === timer) autoTimer = null
        },
      })
    }

    function stopAuto() {
      const i = api.subscriptions.findIndex((s) => s && s.__syncAuto)
      if (i >= 0) {
        const [sub] = api.subscriptions.splice(i, 1)
        sub.dispose()
      }
      if (autoTimer) {
        window.clearInterval(autoTimer)
        autoTimer = null
      }
    }

    /* ── 面板 ── */

    function render(ctx) {
      const state = (ctx && ctx.state) || {}
      // 宿主把用户输入写进 state；已保存的值当兜底（这样重开面板能看到上次配的地址）
      form = {
        baseUrl: String(state['sync.baseUrl'] ?? settings.baseUrl ?? ''),
        username: String(state['sync.username'] ?? settings.username ?? ''),
        password: String(state['sync.password'] ?? ''),
        root: String(state['sync.root'] ?? settings.root ?? ''),
      }
      const configured = !!settings.baseUrl
      const children = [
        {
          type: 'text',
          value: '直连你自己的 WebDAV。密码存系统凭据库（不是明文文件），地址与账号存插件设置。',
          variant: 'caption',
          tone: 'muted',
        },
        { type: 'divider' },
        { type: 'text', value: configured ? '已配置' : '还没配置', variant: 'title' },
        {
          type: 'field',
          label: 'WebDAV 地址',
          hint: '例：https://dav.jianguoyun.com/dav/',
          children: {
            type: 'input',
            bind: 'sync.baseUrl',
            placeholder: 'https://…/dav/',
          },
        },
        {
          type: 'field',
          label: '账号',
          children: { type: 'input', bind: 'sync.username', placeholder: '邮箱 / 用户名' },
        },
        {
          type: 'field',
          label: '密码 / 应用密码',
          hint: '只写在这里；保存后存进系统凭据库',
          children: { type: 'input', bind: 'sync.password', placeholder: '不改就留空' },
        },
        {
          type: 'field',
          label: '同步目录',
          hint: '远端放笔记的子目录，留空 = 地址根',
          children: { type: 'input', bind: 'sync.root', placeholder: 'ZeroNote' },
        },
        {
          type: 'row',
          gap: 'sm',
          wrap: true,
          children: [
            { type: 'button', label: '保存设置', onClick: 'sync-webdav.save' },
            { type: 'button', label: '测试连接', onClick: 'sync-webdav.test', variant: 'ghost' },
            { type: 'button', label: '立即同步', onClick: 'sync-webdav.sync', disabled: !configured || busy },
            {
              type: 'button',
              label: settings.auto === false ? '开启自动同步' : '关闭自动同步',
              onClick: 'sync-webdav.toggle-auto',
              variant: 'ghost',
            },
            { type: 'button', label: '断开连接', onClick: 'sync-webdav.disconnect', variant: 'danger' },
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
      }

      if (conflicts.length > 0) {
        children.push({ type: 'divider' })
        children.push({ type: 'text', value: '冲突记录', variant: 'title' })
        children.push({
          type: 'list',
          items: conflicts.slice(0, 8).map((c) => ({
            type: 'text',
            value: c.file
              ? `${new Date(c.at).toLocaleString()} · ${c.path} → .zn/conflicts/${c.platform}/${c.file}`
              : `${new Date(c.at).toLocaleString()} · ${c.path}（本机版未留存）`,
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

    /** 从表单读值保存（密码空 = 不改） */
    async function saveSettings() {
      formError = null
      const baseUrl = String(form.baseUrl ?? '').trim()
      if (!baseUrl) {
        formError = '地址不能为空'
        api.view.refresh()
        return
      }
      if (!/^https?:\/\//i.test(baseUrl)) {
        formError = '地址要以 http:// 或 https:// 开头'
        api.view.refresh()
        return
      }
      settings = {
        baseUrl,
        username: String(form.username ?? '').trim(),
        root: String(form.root ?? '').trim().replace(/^\/+|\/+$/g, ''),
        enabled: true,
      }
      const pwd = String(form.password ?? '')
      if (pwd) {
        try {
          await api.host.secrets.set(SECRET_KEY, pwd)
          savedPasswords.set('p', pwd)
        } catch (e) {
          formError = `密码写入系统凭据库失败：${String(e)}`
          api.view.refresh()
          return
        }
      }
      markDirty()
      // 配好了就开自动同步（用户选「无感」；关闭的开关在面板上）
      if (settings.auto !== false) startAuto()
      api.host.notify('同步设置已保存')
      api.view.refresh()
    }

    api.view.registerPanel({ id: PANEL_ID, title: '同步 · WebDAV', location: 'main', render })
    register('sync-webdav.open', '同步：打开 WebDAV 设置与状态', () => openPanel())
    register('sync-webdav.save', '同步：保存 WebDAV 设置', () => saveSettings())
    register('sync-webdav.test', '同步：测试连接', async () => {
      try {
        const client = createDavClient({ ...settings, password: await password(), net: api.net })
        const r = await client.test()
        api.host.notify(r.ok ? `连接正常（${r.status}）` : r.hint, r.ok ? 'info' : 'error')
        lastResult = { pulled: 0, pushed: 0, conflicts: 0, hint: r.hint, at: Date.now() }
      } catch (e) {
        api.host.notify(`连接测试失败：${String(e)}`, 'error')
      }
      api.view.refresh()
    })
    register('sync-webdav.sync', '同步：立即同步一次', () => runSync('手动'))
    register('sync-webdav.toggle-auto', '同步：开关自动同步（前台每 5 秒）', async () => {
      settings.auto = settings.auto === false
      if (settings.auto) startAuto()
      else stopAuto()
      markDirty()
      api.host.notify(
        settings.auto ? '自动同步已开启（前台每 5 秒检查一次）' : '自动同步已关闭（仍可手动同步）',
      )
      api.view.refresh()
    })
    register('sync-webdav.disconnect', '同步：断开并清除凭据', async () => {
      try {
        await api.host.secrets.delete(SECRET_KEY)
      } catch (e) {
        api.host.log('warn', `删除凭据失败：${String(e)}`)
      }
      savedPasswords.clear()
      settings = { baseUrl: '', username: '', root: '', enabled: false }
      baseline = {}
      markDirty()
      void api.store.set(KEY_BASELINE, {}).catch(() => {})
      api.host.notify('已断开 WebDAV 并清除密码')
      api.view.refresh()
    })

    void (async () => {
      try {
        settings = { ...settings, ...((await api.store.get(KEY_SETTINGS, {})) ?? {}) }
        baseline = (await api.store.get(KEY_BASELINE, {})) ?? {}
        conflicts = (await api.store.get(KEY_CONFLICTS, [])) ?? []
      } catch (e) {
        api.host.log('warn', `同步设置读取失败：${String(e)}`)
      }
      ready = true
      api.view.refresh()

      // 已配置且没关自动 ⇒ 起来就开始近实时
      if (settings.baseUrl && settings.auto !== false) startAuto()

      // 切回前台立刻补一次（后台期间定时器被挂起，不能只靠 5 秒节拍）
      const onVisible = () => {
        if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
        if (!settings.baseUrl) return
        void runSync('回到前台', { silent: true })
      }
      document.addEventListener('visibilitychange', onVisible)
      api.subscriptions.push({ dispose: () => document.removeEventListener('visibilitychange', onVisible) })

      api.host.log(
        'info',
        `WebDAV 同步插件就绪（${platform}，${settings.baseUrl ? '已配置' : '未配置'}，自动=${settings.auto !== false}，ready=${ready}）`,
      )
    })()
  },
}
