/**
 * WebDAV 后端（`sync` 插件的第一个 backend）。
 *
 * 从 `examples/sync-webdav` 原样搬过来 —— 那边的引擎已经与本插件共用一套纯函数
 * （`lib/core.cjs`），这里只留「与 WebDAV 协议有关」的那部分：
 * URL 编码 / Basic 认证 / PROPFIND XML 解析 / 乐观锁 PUT / manifest 读写。
 *
 * 为什么是 `.cjs`：宿主的多文件运行时只认 CommonJS（契约 §3.2），
 * 而仓库是 `"type": "module"` —— `.cjs` 让 Node 侧（单测）与宿主侧都按 CJS 解析。
 */
const { MANIFEST_REL, encodeDavPath, basicAuth, joinUrl, parsePropfind, normalizeManifest } = require('../core.cjs')
/* ───────────────────────── WebDAV 客户端 ───────────────────────── */

/**
 * 一层薄封装：只认 `ctx.net`，不关心 UI。
 *
 * @param {{ baseUrl: string, username: string, password: string, root: string, net: object }} cfg
 */
function createDavClient(cfg) {
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

  /** 建目录（逐级）；405 = 已存在算成功。sync 里上传前靠它建 `<根>/<父目录>` */
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

  /**
   * 建**同步根本身**（逐级 MKCOL；405 = 已存在算成功）。
   *
   * ⚠️ **不能复用 `mkdirPath`**（rev173.118 修）：它收的是「相对同步根」的路径，而
   * `request()` 又会经 `urlFor()` 再拼一次 `root` —— `mkdirPath(root)` 实际会去建
   * `<根>/<root>/<root>`，实测在远端多出一个空的 `ZeroNote/` 子目录（rev173.117 实测发现）。
   * 这里直接用「不含 root」的 URL 拼法。
   */
  const mkdirRoot = async () => {
    const parts = root.split('/').filter(Boolean)
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      const res = await cfg.net.fetch({
        url: joinUrl(baseUrl, '', acc),
        method: 'MKCOL',
        headers: { Authorization: auth },
        timeoutMs: 30000,
      })
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
          await mkdirRoot()
          res = await probe()
          created = res.status === 207 || res.status === 200
        } catch {
          /* 建不出来就照旧按 404 报 */
        }
      }
      if (res.status === 207 || res.status === 200) {
        const hint = created
          ? '连接正常（已自动创建同步目录）'
          : root
            ? '连接正常'
            : '连接正常，但「同步目录」为空 —— 坚果云这类服务的 WebDAV 根不可直接写，建议填一个子目录（如 ZeroNote）'
        return { ok: true, status: res.status, hint }
      }
      if (res.status === 401) return { ok: false, status: 401, hint: '账号或密码不对（401）' }
      if (res.status === 403) return { ok: false, status: 403, hint: '没有权限（403）' }
      if (res.status === 429 || res.status === 503) {
        // 坚果云高频请求 / 连续失败后会回 503 + `<s:exception>BlockedTemporarily</s:exception>`
        return { ok: false, status: res.status, hint: '远端临时限流 / 封禁（503）—— 等 10–30 分钟再试' }
      }
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

    /**
     * 读一个文件；**不存在返回 `null`**（不抛）。
     *
     * ⚠️ `409` 也要当"不存在"（rev173.108 实测坚果云）：对**父目录不存在**的资源
     * 它回 `409 Conflict` 而不是规范的 `404` —— 首次同步读 `_zn/manifest.json`
     * 就会撞上（`_zn/` 还没建）。把 409 当错误抛的话，第一次同步永远失败。
     */
    async get(rel) {
      const res = await request('GET', rel)
      if (res.status === 404 || res.status === 409) return null
      if (res.status >= 400) throw new Error(`下载失败（${res.status}）：${rel}`)
      return res.text()
    },

    /**
     * 读文本 + 它的 ETag（与 S3 后端的同名方法对应）。
     *
     * 412 冲突收尾时用它：把远端最新版对齐进本机基线，新基线要带上**远端真实 etag**，
     * 否则下一轮又拿旧 etag 撞 412。
     */
    async getWithEtag(rel) {
      const res = await request('GET', rel)
      if (res.status === 404 || res.status === 409) return null
      if (res.status >= 400) throw new Error(`下载失败（${res.status}）：${rel}`)
      return { text: res.text(), etag: res.headers?.etag ?? undefined }
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

    /**
     * 读远端 manifest；没有返回空表。
     *
     * **`If-None-Match` 304 短路径（rev173.111）**：自动同步每 5 秒一轮，manifest 大多数时候
     * 没变 —— 把上轮的 etag 传上去，远端回 304 就不用再拉一遍几 KB 的 JSON。
     * 调用方拿到 `notModified: true` 时用自己缓存的表。
     *
     * @param {string|null} [ifNoneMatch] 上一轮拿到的 etag
     * @returns {Promise<{files: object|null, attachments: object|null, etag: string|null, notModified: boolean}>}
     */
    async readManifest(ifNoneMatch) {
      const res = await request('GET', MANIFEST_REL, {
        headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {},
      })
      if (res.status === 304) {
        return {
          files: null,
          attachments: null,
          private: null,
          privateTree: null,
          etag: ifNoneMatch ?? null,
          notModified: true,
        }
      }
      /**
       * `404` / `409` = 还没有 manifest（坚果云对**父目录不存在**的 GET 回 409）⇒ 空表。
       * 这里不再走 `get()`：它把 404/409 吞成 null，拿不到响应的 ETag。
       */
      if (res.status === 404 || res.status === 409) {
        return { files: {}, attachments: {}, private: {}, privateTree: {}, etag: null, notModified: false }
      }
      if (res.status >= 400) throw new Error(`下载失败（${res.status}）：${MANIFEST_REL}`)
      const m = normalizeManifest(res.text())
      return { ...m, etag: res.headers?.etag ?? null, notModified: false }
    },

    /** 写远端 manifest（先确保 `_zn/` 存在；`attachments` / `private` 段原样带上）。返回 PUT 结果（带新 etag） */
    async writeManifest(manifest) {
      await this.mkdir('_zn')
      const body = JSON.stringify({
        version: 1,
        files: manifest.files ?? {},
        attachments: manifest.attachments ?? {},
        private: manifest.private ?? {},
        privateTree: manifest.privateTree ?? {},
      })
      // 不做 If-Match：manifest 是"尽力而为"的索引，真冲突靠每篇文件的 etag 兜
      return this.put(MANIFEST_REL, body)
    },

    /* ── 二进制（附件同步用）：字节进出，不做任何编码假设 ── */

    /**
     * 读二进制。返回 `{ data, notModified, etag }`：
     *
     * · `data: Uint8Array`               ⇒ 正常内容
     * · `data: null, notModified: false` ⇒ 远端没有这份（404 / 409）
     * · `data: null, notModified: true`  ⇒ **带了 `If-None-Match`，远端没变**（304）
     *
     * 304 短路径（rev173.117）：与 manifest 同一套做法 —— 附件这种几 MB 的东西，
     * 远端没变就不该再拉一遍字节。调用方拿到 `notModified` 时自己决定用本机已有的副本。
     */
    async getBytes(rel, ifNoneMatch) {
      const res = await request('GET', rel, {
        headers: ifNoneMatch ? { 'If-None-Match': ifNoneMatch } : {},
      })
      const etag = res.headers?.etag ?? null
      if (res.status === 304) return { data: null, notModified: true, etag: ifNoneMatch ?? etag }
      if (res.status === 404 || res.status === 409) return { data: null, notModified: false, etag }
      if (res.status >= 400) throw new Error(`下载失败（${res.status}）：${rel}`)
      return { data: res.bytes(), notModified: false, etag }
    },

    /** 写二进制。返回 `{ ok, status }` */
    async putBytes(rel, bytes) {
      const res = await request('PUT', rel, {
        headers: { 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      return { ok: [200, 201, 204].includes(res.status), status: res.status }
    },

    /** 删一个文件（不存在也算成功 —— apply 幂等） */
    async remove(rel) {
      const res = await request('DELETE', rel)
      return { ok: [200, 202, 204, 404, 409].includes(res.status), status: res.status }
    },

    /** 远端有没有这个资源（PROPFIND Depth 0） */
    async exists(rel) {
      const res = await request('PROPFIND', rel, { headers: { Depth: '0' } })
      return res.status === 207 || res.status === 200
    },
  }
}


module.exports = { createDavClient }
