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
const SECRET_KEY = 'sync.git.token'
const MANIFEST_PATH = '_zn/manifest.json'
const CONFLICT_ROOT = '.zn/conflicts'
const MAX_CONFLICTS = 100
const MAX_TIMING = 50
const MAX_FILES_PER_RUN = 200
const AUTO_MS = 5000

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

/** 库内相对路径 → URL 段（逐段编码，保留 `/`） */
export function encodeGitPath(path) {
  return String(path ?? '')
    .split('/')
    .filter((s) => s && s !== '.')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

/**
 * 七种判定 —— 决定会不会丢字。**与 `sync-webdav` / `sync-s3` 逐字一致**。
 * ⚠️ 同样的已知隐患：`!base && remoteFp != null` 一律 `pull-new`（store 被清过时会被远端覆盖）。
 */
export function decideSync({ base, localFp, remoteFp }) {
  const hasBase = !!base
  if (remoteFp == null) {
    if (!hasBase) return 'push-new'
    return base.fp === localFp ? 'remote-deleted' : 'conflict'
  }
  if (!hasBase) return 'pull-new'
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

/** 解析 manifest（与其它三个同步插件同一格式） */
export function normalizeManifest(raw) {
  let j = raw
  if (typeof raw === 'string') {
    try {
      j = JSON.parse(raw)
    } catch {
      return { version: 1, files: {}, attachments: {} }
    }
  }
  if (!j || typeof j !== 'object') return { version: 1, files: {}, attachments: {} }
  const files = {}
  const src = j.files && typeof j.files === 'object' ? j.files : {}
  for (const [path, v] of Object.entries(src)) {
    if (!v || typeof v !== 'object' || typeof v.fp !== 'string' || !v.fp) continue
    files[path] = { fp: v.fp, sha: typeof v.sha === 'string' ? v.sha : undefined, at: Number(v.at) || 0 }
  }
  return { version: 1, files, attachments: {} }
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

    async function runSync(reason = '手动', { silent = false } = {}) {
      if (busy) return { skipped: true }
      if (!settings.owner || !settings.repo) return { error: '还没配置 owner / repo' }
      busy = true
      if (!silent) api.view.refresh()
      const t0 = Date.now()
      let tMark = t0
      const timing = { manifest: 0, notes: 0, write: 0 }
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
        let remote = { files: {}, attachments: {} }
        const got = await client.read(MANIFEST_PATH)
        if (got && typeof got.text === 'string') {
          const m = normalizeManifest(got.text)
          remote = { files: m.files, attachments: m.attachments }
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

        // ④ manifest 回写（有变动才写）
        if (remoteChanged || summary.pushed > 0) {
          const w = await client.write(
            MANIFEST_PATH,
            JSON.stringify({ version: 1, files: nextFiles, attachments: {} }),
            { sha: manifestSha, message: 'ZeroNote 同步：更新 manifest' },
          )
          if (w.ok) manifestSha = w.sha ?? null
        }
        timing.write = lap()
        await api.store.set(KEY_BASELINE, baseline)
        summary.hint = summary.hint || `${reason}同步完成`
      } catch (e) {
        summary.hint = `同步失败：${String(e)}`
        if (/401|403|429|rate limit|限流/i.test(String(e))) {
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

    let autoTimer = null

    function startAuto() {
      if (autoTimer || !settings.owner || !settings.repo) return
      const timer = window.setInterval(() => {
        if (busy || !settings.owner) return
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
          children: { type: 'input', bind: 'git.token', placeholder: '不改就留空' },
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
