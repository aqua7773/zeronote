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
const KEY_DEVICE = 'device.v1'
/** 最近若干次同步的耗时（rev173.119，画趋势用） */
const KEY_TIMING = 'timing.v1'
const SECRET_KEY = 'sync.webdav.password'

const CONFLICT_ROOT = '.zn/conflicts'
/** manifest 在远端的落点（相对同步根） */
const MANIFEST_REL = '_zn/manifest.json'

/**
 * **私有文件**清单（rev173.164 · 期 1c；rev173.182 按环拆 vault）。
 *
 * 这些是库内 `.zn/` 下的密文，不是 `.md`、`listNotes` 永远拿不到，所以要单独搬。
 *
 * 为什么密码库必须同步**多个**文件：
 *  · `secrets.zn`        —— 整库密文（真正的数据）
 *  · `vault.<环>.json`   —— KDF salt + 被主密码包裹的 DEK（**没有它，另一台拿到密文也解不开**）
 *
 * 为什么 vault 按环拆（rev173.182）：整文件同步时，两台设备各改一个环的密码（重包裹）
 * 会同时改同一个文件 ⇒ 判冲突 ⇒ 取远端 ⇒ **另一边的重包裹丢了**，那台设备解不开。
 * 拆开之后两个环各是一个同步单元，互不干扰。
 *
 * `vault.json`（旧单文件）仍留在清单里：还没迁移的库还在用它；迁移完成后文件会消失，
 * 那几条分支自然变成"两边都没有"的 no-op。
 *
 * 三个文件里都没有明文（只有公开参数与密文块），所以"上云"不等于"泄露"；
 * 但没有主密码，谁也解不开 —— 这是需求 §10.1「加密后同步」要的效果。
 */
export const PRIVATE_FILES = [
  '.zn/secrets/secrets.zn',
  '.zn/security/vault.notes.json',
  '.zn/security/vault.secrets.json',
  '.zn/security/vault.json',
]
/** 私密文件夹的**根文件**（不在 notes/ 或 trash/ 里，单独列出） */
export const PRIVATE_ROOT_FILES = ['.zn/private/index.zn']
/** 私密文件夹的**目录树**（数量可变 ⇒ 逐个文件走同一套方向判定，见 `syncPrivateTree`） */
export const PRIVATE_DIRS = ['.zn/private/notes', '.zn/private/trash']

/**
 * 私密树单个文件的同步方向（**纯函数**，单测覆盖全部分支）。
 *
 * `localFp` / `remoteFp` / `baseFp` 都是指纹字符串或 `null`（null = 那边没有这个文件）。
 *
 * 与笔记同步的 `decideSync` **语义一致但不共用**：笔记那边删除了不会传播（保守），
 * 私密树这边**两边都传播** —— 私密笔记在面板里删除是真删除，不传播的话同步一轮就复活。
 */
export function decideTreeAction(localFp, remoteFp, baseFp) {
  const l = localFp || null
  const r = remoteFp || null
  const b = baseFp || null
  // 两边一致（或两边都没有）⇒ 只刷新 baseline
  if (l === r) return 'noop'
  // 远端有、本地没有
  if (!l && r) return b ? 'delete-remote' : 'pull'
  // 本地有、远端没有
  if (l && !r) return b ? 'delete-local' : 'push'
  // 两边都有、内容不同
  const localChanged = l !== b
  const remoteChanged = r !== b
  if (!b) return 'conflict' // 没有基线且两边不同：谁都不该覆盖谁（与 `!base` 的笔记判据同一套）
  if (remoteChanged && !localChanged) return 'pull'
  if (localChanged && !remoteChanged) return 'push'
  return 'conflict'
}
/** 单次同步最多处理多少篇（防止第一次全量时把界面吊死） */
const MAX_FILES_PER_RUN = 200
/** 自动同步节拍：前台每 5 秒跑一次（坚果云 600 次/30min ≈ 12 次/分钟，5 秒正好 12 次） */
const AUTO_MS = 5000
/**
 * **限流退避档位**（rev173.279 · 真人使用测试 #12「坚果云同步很容易触发限流」）。
 *
 * 5 秒一轮 = 360 次 / 30 分钟，加上附件与 manifest 的请求，撞上坚果云 600 次的上限很快
 * （真机截图：`下载失败（503）`）。旧行为是**撞上就永久停自动同步**（`stopAuto()` + 关开关 +
 * 让用户手动重开）—— 用户以为同步坏了，而且重开后又 5 秒一轮，很快再撞。
 *
 * 改成**指数退避**：15 s → 60 s → 300 s，任何一轮成功立刻复位回 5 s。
 * 认证失败（401 / 403）仍然立刻停 —— 那种情况重试只会让封禁更久。
 */
const BACKOFF_MS = [15000, 60000, 300000]
/** 冲突记录上限 */
const MAX_CONFLICTS = 100
/**
 * 耗时历史上限（rev173.119）。
 *
 * 只记「有变化」的轮次与手动同步 —— 静默的空转轮 5 秒一条，会把趋势冲成一条平线，
 * 而用户真正想看的是"有活干那几轮要多久"。
 */
const MAX_TIMING = 50

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
    /**
     * 远端有、本地没有基线（换了设备 / store 被清 / 首次见这篇）：
     * - 两边内容相同 ⇒ 直接对齐基线，不必白拉一次
     * - 两边不同 ⇒ **不能假定远端更权威**：本机可能改过。以前一律 `pull-new`，
     *   store 丢过就会静默用远端盖掉本地（丢字）。现在判冲突 ⇒ 本机版先留副本
     *   再取远端版；history 同步点还在时会先试三方合并，合得上就两端一致。
     */
    if (localFp === remoteFp) return 'noop'
    return 'conflict'
  }
  const localChanged = localFp !== base.fp
  const remoteChanged = remoteFp !== base.fp
  if (!localChanged && !remoteChanged) return 'noop'
  if (remoteChanged && !localChanged) return 'pull'
  if (!remoteChanged && localChanged) return 'push'
  // 两边都变了；如果两边恰好变成同一个内容（同一份改动各自应用），不算冲突
  return localFp === remoteFp ? 'noop' : 'conflict'
}

/**
 * 冲突时尝试**三方合并**（rev173.115）。
 *
 * 输入是三方：`base` = 上次成功同步时的内容（history 插件打的同步点）、
 * `mine` = 本机当前、`theirs` = 远端当前。只有**完全合上**（没有一处真冲突）才返回文本 ——
 * 有冲突段时两边都要人看，自动选一边会让用户以为"已经合好了"。
 *
 * 返回 `null` = 不合并，调用方走原来的「留两份 + 取远端」流程。
 *
 * @param {{ base?: string|null, mine?: string|null, theirs?: string|null, mergeLines?: Function }} args
 * @returns {{ text: string } | null}
 */
export function tryAutoMerge({ base, mine, theirs, mergeLines }) {
  if (typeof base !== 'string' || typeof mine !== 'string' || typeof theirs !== 'string') return null
  if (typeof mergeLines !== 'function') return null
  // 只有一边变过 ⇒ 不是"双端都改"，交给 decideSync 的普通分支（这里合并没有意义）
  if (base === mine || base === theirs) return null
  let r
  try {
    r = mergeLines(base, mine, theirs)
  } catch {
    return null // 合并实现抛错 ⇒ 退回「留两份」，不丢字
  }
  if (!r || !Number.isFinite(r.conflicts) || r.conflicts > 0) return null
  if (typeof r.text !== 'string') return null
  // 合出来还是远端版 ⇒ 本机改动在远端已存在，没必要多写一次盘 + 一次 PUT
  if (r.text === theirs) return null
  return { text: r.text }
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
    // 附件段（rev173.109）：`cleaned` = 中转模式下云端副本已删（本地还留着）
    const atts = j && typeof j === 'object' && j.attachments && typeof j.attachments === 'object' ? j.attachments : {}
    const attachments = {}
    for (const [path, v] of Object.entries(atts)) {
      if (!v || typeof v !== 'object') continue
      if (typeof v.fp !== 'string') continue
      attachments[path] = {
        fp: v.fp,
        ext: typeof v.ext === 'string' ? v.ext : '',
        at: Number(v.at) || 0,
        ...(v.cleaned ? { cleaned: true } : {}),
        // `mode` 记录**上传方**当时的模式（rev173.126）：取文件时按它决定去原路径还是 `_zn/relay/`，
        // 否则一台 full、一台 relay 时 relay 那台永远找不到文件
        ...(v.mode === 'full' || v.mode === 'relay' ? { mode: v.mode } : {}),
      }
    }
    /**
     * 私有文件段（rev173.164 · 期 1c）：密码库这类**不进 `listNotes`** 的密文
     * （不是 `.md`、又在 `.zn/` 下），按固定清单单独搬运。
     */
    const privs = j && typeof j === 'object' && j.private && typeof j.private === 'object' ? j.private : {}
    const priv = {}
    for (const [rel, v] of Object.entries(privs)) {
      if (!v || typeof v !== 'object') continue
      if (typeof v.fp !== 'string') continue
      priv[rel] = { fp: v.fp, at: Number(v.at) || 0 }
    }
    /**
     * 私密文件夹树（rev173.182 · 期 3）：与 `private` 同形状，只是**数量可变**
     * （每篇私密笔记一个密文）。老 manifest 没有这一段 ⇒ 空对象（首轮全部当"新"推上去）。
     */
    const trees = j && typeof j === 'object' && j.privateTree && typeof j.privateTree === 'object' ? j.privateTree : {}
    const privateTree = {}
    for (const [rel, v] of Object.entries(trees)) {
      if (!v || typeof v !== 'object') continue
      if (typeof v.fp !== 'string') continue
      privateTree[rel] = { fp: v.fp, at: Number(v.at) || 0 }
    }
    return { version: 1, files: out, attachments, private: priv, privateTree }
  } catch {
    return { version: 1, files: {}, attachments: {}, private: {}, privateTree: {} }
  }
}

/**
 * 二进制指纹：长度 + FNV-1a（逐字节）。
 *
 * 为什么单独一个：文本那份按 `charCodeAt` 走，UTF-16 码元与 UTF-8 字节对不上 ——
 * 拿它给图片算指纹，两端算出来的值会不同（同一张 PNG 在不同编码路径上指纹不一致），
 * 于是每次同步都以为"变了"。
 */
export function fingerprintBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? [])
  let h = 0x811c9dc5
  for (let i = 0; i < u8.length; i += 1) {
    h ^= u8[i]
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `${u8.length.toString(36)}:${h.toString(36)}`
}

/** 附件扩展名（含点，小写）；没有就空串 */
export function extOf(path) {
  const name = String(path ?? '').split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

/** 父目录（库内相对路径，无父目录时返回空串） */
export function dirOf(path) {
  const s = String(path ?? '')
  const i = s.lastIndexOf('/')
  return i > 0 ? s.slice(0, i) : ''
}

/** 这条路径算不算「附件」（图片 / PDF / 任意非 Markdown 文件，且不在 `.zn/` 里） */
export function isAttachment(path) {
  const s = String(path ?? '')
  if (!s) return false
  if (s.startsWith('.zn/') || s.split('/').includes('.zn')) return false
  return !/\.(md|markdown)$/i.test(s)
}

/**
 * 远端这条附件要不要拉到本地（rev173.117）。
 *
 * 以前只看「本地有没有这个路径」（`localPaths.has(path)`）—— 远端把 **同一路径的图换掉**
 * （改图 / 重新截图 / 别的设备覆盖）时，本地永远停在旧版本，同步看起来"没事"。
 * 现在按 manifest 的 `fp` 判：
 *
 * · 远端 `cleaned`（中转模式已清理）⇒ 不拉
 * · 本地没有 ⇒ 拉
 * · 本地指纹与远端不同 ⇒ 拉（远端更新过）
 * · 相同 ⇒ 不拉
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
 * 耗时给人看的写法（rev173.117 同步耗时统计）。
 *
 * 小于 1 秒说毫秒（"320 毫秒"比"0.3 秒"更少歧义），1 秒以上保留一位小数；
 * 10 秒以上不带小数（"12 秒"），避免面板宽度抖动。
 */
export function fmtMs(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1000) return `${Math.round(n)} 毫秒`
  if (n < 10000) return `${(n / 1000).toFixed(1)} 秒`
  return `${Math.round(n / 1000)} 秒`
}

/**
 * 追加一条耗时记录（rev173.119）。
 *
 * `limit` 之外的旧记录丢掉 —— 面板只需要看最近的趋势，不是审计日志。
 * 非数组 / 坏条目一律容错成空表起步（store 里的数据可能是上一版写的）。
 */
export function pushTiming(history, entry, limit = MAX_TIMING) {
  const list = Array.isArray(history) ? history.filter((e) => e && typeof e === 'object') : []
  const next = [...list, entry]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/**
 * 最近若干次的耗时摘要（rev173.119）：`{ count, avg, max }`。
 * 没有可用记录返回 `null`（面板据此决定画不画这一行）。
 */
export function timingSummary(history) {
  const list = (Array.isArray(history) ? history : []).filter((e) => e && Number.isFinite(e.total))
  if (!list.length) return null
  let sum = 0
  let max = 0
  for (const e of list) {
    sum += e.total
    if (e.total > max) max = e.total
  }
  return { count: list.length, avg: Math.round(sum / list.length), max: Math.round(max) }
}

/** sparkline 的八档字符（低 → 高） */
const SPARK = '▁▂▃▄▅▆▇█'

/**
 * 字符 sparkline（rev173.119）：把一组耗时映射成 `▁▂▃▄▅▆▇█` 的走势。
 *
 * 三条约定（都对应一个"画出来会误导人"的坑）：
 * · 只取**最后 `width` 个** —— 趋势看最近的，早期的慢轮不该压扁现在的波形；
 * · 全部相等时用中间档（`▄`）—— `min === max` 除零会得到 `NaN` 索引、直接崩；
 * · 最大值 ≤ 0（异常数据）时全用最低档，不抛错。
 */
export function sparkline(values, width = 24) {
  const nums = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v))
  if (!nums.length) return ''
  const tail = nums.slice(-Math.max(1, width))
  const min = Math.min(...tail)
  const max = Math.max(...tail)
  if (max <= 0) return SPARK[0].repeat(tail.length)
  const span = max - min
  return tail
    .map((v) => {
      if (span === 0) return SPARK[3]
      const i = Math.round(((v - min) / span) * (SPARK.length - 1))
      return SPARK[Math.max(0, Math.min(SPARK.length - 1, i))]
    })
    .join('')
}

/**
 * 中转文件 / ack 标记的**远端文件名**。
 *
 * ⚠️ **必须把指纹里的 `:` 换掉**（rev173.109 实测）：`fingerprint` 的格式是 `<长度>:<散列>`，
 * 直接拿来当文件名时，Windows 会把它当 **NTFS 备用数据流** —— `fs.writeFile('8tj:1te3kiy.png')`
 * 只建出一个 0 字节的 `8tj`（内容进了流里），远端看到的就是空文件。
 * 顺带也避开 `/` `\` 这些在各家 DAV 实现里含义不一的字符。
 */
export function relayName(fp, ext) {
  return `${String(fp ?? '').replace(/[:/\\]/g, '-')}${ext || ''}`
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

/* ───────────────────────── 插件本体 ───────────────────────── */

export default {
  apply(api) {
    const platform = api.host.platform === 'android' ? 'android' : 'windows'

    let settings = { baseUrl: '', username: '', root: '', enabled: false, auto: true, attachments: 'off' }
    let baseline = {}
    /**
     * 上一轮远端 manifest 的缓存（rev173.111 · 304 短路径）。
     * `{ files, attachments, etag }`；etag 为空 = 远端没给 ETag ⇒ 下一轮照旧全量拉。
     */
    let manifestCache = null
    /**
     * 本地附件指纹缓存（rev173.117）：`path → { mtime, size, fp }`。
     * 5 秒一轮的自动同步靠它跳过没变过的附件（见 `syncAttachments.localFpOf`）。
     */
    const attFpCache = new Map()
    /**
     * 远端附件的 ETag 缓存（rev173.117）：`远端路径 → etag`。
     * 下载时带 `If-None-Match`，远端没变就 304（省一次完整传输）。
     */
    const attEtag = new Map()
    /**
     * 最近若干次同步的耗时（rev173.119）：`{ at, total, manifest, notes, attachments }[]`。
     * 落 store，重启后趋势还在（面板画 sparkline + 平均 / 最慢）。
     */
    let timingHistory = []
    let conflicts = []
    /**
     * 进程内已确认存在「同步点」的路径（rev173.115）。
     * 只放内存：丢了只是下一轮多写一次 base，不影响正确性。
     */
    const baseMarked = new Set()
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
     * 让 history 打一个**同步点**（rev173.115 三方合并的 base）。
     *
     * 时机：每次成功推 / 拉之后，两端内容一致 —— 这就是下次冲突时要用的「共同祖先」。
     * 软依赖：history 被禁用 / 没装 ⇒ 静默跳过（合并退化成「留两份」，不丢数据）。
     */
    async function markBase(path, text) {
      try {
        const hist = await api.service.consume('history')
        if (hist?.snapshot) await hist.snapshot(path, text, { tag: 'sync:webdav' })
      } catch (e) {
        api.host.log('debug', `同步点跳过 ${path}：${String(e)}`)
      }
    }

    /**
     * 冲突时的三方合并：base 取自 history 同步点，mine = 本机，theirs = 远端。
     * 任何一环拿不到都返回 `null`（调用方走原「留两份」）。
     */
    async function autoMerge(client, path, localText) {
      try {
        const [hist, merger] = await Promise.all([
          api.service.consume('history'),
          api.service.consume('kernel.merge'),
        ])
        if (!hist?.findBase || !merger?.mergeLines) return null
        const base = await hist.findBase(path, { tag: 'sync:webdav' })
        if (typeof base !== 'string') return null
        const theirs = await client.get(path)
        if (theirs == null) return null
        return tryAutoMerge({ base, mine: localText, theirs, mergeLines: merger.mergeLines })
      } catch (e) {
        api.host.log('warn', `自动合并失败（${path}）：${String(e)}`)
        return null
      }
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
      const t0 = Date.now()
      let tMark = t0
      /**
       * 各阶段耗时（rev173.117）：`{ manifest, notes, attachments, total }`。
       *
       * 为什么要这个：自动同步每 5 秒一轮，用户能感觉到"卡"的时候第一句一定是
       * 「是不是同步拖的」—— 面板上直接给出哪个阶段慢，比猜快。
       */
      const timing = { manifest: 0, notes: 0, attachments: 0, private: 0, privateTree: 0 }
      const lap = () => {
        const now = Date.now()
        const d = now - tMark
        tMark = now
        return d
      }
      const summary = {
        pulled: 0,
        pushed: 0,
        merged: 0,
        conflicts: 0,
        removed: 0,
        hint: '',
        manifest304: false,
      }
      try {
        const client = createDavClient({ ...settings, password: await password(), net: api.net })
        /**
         * manifest：有 etag 就带 `If-None-Match` 走 304 短路径（rev173.111）。
         * 304 ⇒ 用上轮缓存的 files / attachments；200 ⇒ 刷新缓存。
         */
        let remote
        if (manifestCache?.etag) {
          const got = await client.readManifest(manifestCache.etag)
          if (got.notModified) {
            remote = {
              files: manifestCache.files,
              attachments: manifestCache.attachments,
              private: manifestCache.private,
              privateTree: manifestCache.privateTree,
            }
            summary.manifest304 = true
          } else {
            remote = {
              files: got.files,
              attachments: got.attachments,
              private: got.private,
              privateTree: got.privateTree,
            }
            manifestCache = {
              files: got.files,
              attachments: got.attachments,
              private: got.private,
              privateTree: got.privateTree,
              etag: got.etag,
            }
          }
        } else {
          const got = await client.readManifest()
          remote = { files: got.files, attachments: got.attachments, private: got.private }
          manifestCache = {
            files: got.files,
            attachments: got.attachments,
            private: got.private,
            etag: got.etag,
          }
        }
        timing.manifest = lap()
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
            /**
             * 首轮见到这篇时补一个同步点（rev173.115）：老用户升级后 base 是空的，
             * 第一次真冲突会退化成「留两份」；这里顺手种一个，下一次就能三方合并。
             * `baseMarked` 挡住"每 5 秒一轮重写"。
             */
            if (!baseMarked.has(n.path)) {
              baseMarked.add(n.path)
              await markBase(n.path, localText)
            }
            continue
          }
          if (verdict === 'pull' || verdict === 'pull-new') {
            const text = await client.get(n.path)
            if (text == null) continue
            await api.fs.writeText(n.path, text)
            const fp = fingerprint(text)
            baseline[n.path] = { fp, etag: remoteEntry?.etag }
            baseMarked.add(n.path)
            await markBase(n.path, text)
            summary.pulled += 1
            continue
          }
          if (verdict === 'push' || verdict === 'push-new') {
            const parent = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''
            await client.mkdir(parent)
            let res = await client.put(n.path, localText, undefined)
            /**
             * `404` = 父集合不存在。除了"目录没建"，**坚果云的根 `/dav/` 本身不可写**
             * （只列得出 `我的坚果云/` 这类子目录）—— 同步目录留空就会撞上。
             * 再建一次再试一次，仍失败就把话说清楚（不是笼统的"上传失败"）。
             */
            if (res.status === 404) {
              await client.mkdir(settings.root || parent).catch(() => {})
              res = await client.put(n.path, localText, undefined)
            }
            if (res.status === 412) {
              await keepConflict(n.path, '远端在同步期间又变了')
              summary.conflicts += 1
              continue
            }
            if (!res.ok) {
              throw new Error(
                res.status === 404
                  ? `上传失败（404）：${n.path} —— 远端父目录不存在；坚果云的 WebDAV 根不可直接写，请在「同步目录」里填一个子目录（如 ZeroNote）`
                  : `上传失败（${res.status}）：${n.path}`,
              )
            }
            baseline[n.path] = { fp: localFp, etag: res.etag ?? undefined }
            nextFiles[n.path] = { fp: localFp, etag: res.etag ?? undefined, at: Date.now() }
            baseMarked.add(n.path)
            await markBase(n.path, localText)
            summary.pushed += 1
            continue
          }
          if (verdict === 'conflict') {
            /**
             * 先试**三方合并**（rev173.115）—— base 来自 history 的同步点。
             * 合上了 ⇒ 本机写合并结果 + 推回远端 ⇒ 两端都是合并结果，这一轮不算冲突。
             * 合不上（有真冲突段 / 没 base / 没 history）⇒ 原流程：本机版留副本、取远端版。
             */
            const merged = await autoMerge(client, n.path, localText)
            if (merged) {
              let wrote = false
              try {
                await api.fs.writeText(n.path, merged.text)
                wrote = true
              } catch (e) {
                api.host.log('warn', `合并结果落盘失败（${n.path}）：${String(e)}`)
              }
              if (wrote) {
                const res2 = await client.put(n.path, merged.text, remoteEntry?.etag)
                if (res2.ok) {
                  const fp = fingerprint(merged.text)
                  baseline[n.path] = { fp, etag: res2.etag ?? undefined }
                  nextFiles[n.path] = { fp, etag: res2.etag ?? undefined, at: Date.now() }
                  baseMarked.add(n.path)
                  await markBase(n.path, merged.text)
                  summary.merged += 1
                  api.host.notify(`已自动合并：${n.path}`, 'info')
                  continue
                }
                /**
                 * 推送失败（412 = 远端又变了 / 网络）：**本机保留合并结果**，别再用远端版
                 * 盖掉它；base 不动，下一轮拿同一份 base 再合一次。
                 */
                summary.hint = `合并结果未能上传（${res2.status}）：${n.path}`
              }
              summary.conflicts += 1
              continue
            }
            await keepConflict(n.path, '双端修改')
            summary.conflicts += 1
            // 取远端版（本机版已经进冲突目录）
            const text = await client.get(n.path)
            if (text != null) {
              await api.fs.writeText(n.path, text)
              const fp = fingerprint(text)
              baseline[n.path] = { fp, etag: remoteEntry?.etag }
              baseMarked.add(n.path)
              await markBase(n.path, text)
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
          baseMarked.add(path)
          await markBase(path, text)
          summary.pulled += 1
        }

        timing.notes = lap()

        // 附件（在 .md 循环之后：`summary.pushed` 里也含附件计数）
        const att = await syncAttachments(client, remote, summary)
        timing.attachments = lap()

        // 私有文件（密码库密文 + 密钥元数据，rev173.164 · 期 1c）
        const priv = await syncPrivate(client, remote, summary)
        timing.private = lap()

        // 私密文件夹目录树（rev173.182 · 期 3）—— 数量可变，逐文件比对
        const privTree = await syncPrivateTree(client, remote, summary)
        timing.privateTree = lap()

        // manifest 回写（本轮有 .md / 附件 / 私有文件变动才写 —— 5 秒一轮，没变化不该反复 PUT）
        if (summary.pushed > 0 || att.changed || priv.changed || privTree.changed) {
          const w = await client.writeManifest({
            files: nextFiles,
            attachments: att.attachments,
            private: priv.private,
            privateTree: privTree.privateTree,
          })
          // 写盘后远端 etag 变了 ⇒ 缓存跟着换，下一轮照样能走 304
          manifestCache = {
            files: nextFiles,
            attachments: att.attachments,
            private: priv.private,
            privateTree: privTree.privateTree,
            etag: w?.etag ?? null,
          }
        }
        await api.store.set(KEY_BASELINE, baseline)
        summary.hint = summary.hint || `${reason}同步完成${summary.manifest304 ? '（manifest 304）' : ''}`
        // 成功一轮 ⇒ 退避清零（限流是临时的，恢复后立刻回到 5 秒节拍）
        backoffLevel = 0
        backoffUntil = 0
      } catch (e) {
        summary.hint = `同步失败：${String(e)}`
        const msg = String(e)
        /**
         * 两类失败分开处理（rev173.279 · 真人使用测试 #12）：
         *
         * · **认证错**（401 / 403）⇒ 立刻停自动同步。重试只会让封禁更久
         *   （2026-10-24 实测：401 重试十几分钟后桌面 + 手机全被 503 挡了半小时）。
         *   开关显示必须与**实际**一致：`stopAuto()` 只清定时器、不动 `settings.auto`，
         *   不置 false 面板会一直显示「自动 · 前台每 5 秒」—— 用户以为还在同步（真机踩过）。
         *
         * · **限流 / 临时封禁**（429 / 503 / `BlockedTemporarily`）⇒ **指数退避，不永久停**。
         *   旧行为是撞上就停、要用户手动重开；重开后又 5 秒一轮，很快再撞。
         *   现在 15 s → 60 s → 300 s，任何一轮成功立刻复位回 5 s。
         */
        if (/401|403|unauthorized|forbidden/i.test(msg)) {
          backoffLevel = 0
          backoffUntil = 0
          stopAuto()
          if (settings.auto !== false) {
            settings.auto = false
            markDirty()
          }
          summary.hint += '（认证失败，已暂停自动同步；改好账号或密码后在面板上重新开启）'
        } else if (/429|503|blocked|rate.?limit|too many/i.test(msg)) {
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
        // 失败也记耗时（面板要能看出"卡在哪个阶段"）
        summary.ms = { ...timing, total: Date.now() - t0 }
        const changed = summary.pulled + summary.pushed + summary.merged + summary.conflicts + summary.removed > 0
        /**
         * 耗时历史（rev173.119）：只记**有变化**的轮次与手动同步。
         * 静默的空转轮每 5 秒一条，50 条只够覆盖 4 分钟，而且全是"没活干"的噪声 ——
         * 那样的趋势图看不出任何东西。
         */
        if (changed || !silent) {
          timingHistory = pushTiming(timingHistory, { at: Date.now(), ...summary.ms })
          void api.store.set(KEY_TIMING, timingHistory).catch((e) => api.host.log('warn', `耗时历史写入失败：${String(e)}`))
        }
        lastResult = { ...summary, at: Date.now() }
        /**
         * 自动轮询下「什么都没变」不刷面板（每 5 秒重渲染会把用户正在填的表单刷掉）；
         * **退避那一轮例外** —— 用户必须看见「已退避到 N 秒」，否则面板还写着「自动 · 前台每 5 秒」。
         */
        if (!silent || changed || summary.backoffMs) api.view.refresh()
      }
      return summary
    }

    /* ── 附件同步（rev173.109 · 用户 2026-10-24 要的两种模式） ── */

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
     * 附件同步。两种模式（用户 2026-10-24 拍板：「添加一个选项」）：
     *
     * · `full`  —— 附件与文档一样**永久**存在云端（占空间，但任何设备随时能取）
     * · `relay` —— **同步中转**：只在上传方与下载方之间过一道，对端 ack 之后云端副本就删掉
     *              （云端省空间；代价是第三台设备事后取不到这份）
     *
     * `relay` 的协议：
     *   上传：`PUT _zn/relay/<fp><ext>`，`manifest.attachments[path] = { fp, ext, at }`
     *   下载：`GET _zn/relay/<fp><ext>` 写本地 ⇒ `PUT _zn/relay-ack/<fp>`（内容 = 设备 id）
     *   清理：任何一端看到 ack 就删 relay 文件，并在 manifest 里标 `cleaned: true`
     *          —— **条目保留**：别的设备看到 cleaned 就知道「曾经有、别等了」，不会反复重试。
     *
     * @returns {{ attachments: Record<string, object>, changed: boolean }}
     */
    /**
     * **私有文件同步**（rev173.164 · 期 1c）：密码库密文 + 密钥元数据。
     *
     * 为什么单独一段：这两个文件不是 `.md`、又在 `.zn/` 下，`listNotes` 永远看不到它们
     * （附件段也刻意跳 `.zn/`）⇒ 以前密码库**同步不出去**，换设备就是空库。
     *
     * 两者都是**文本**（`secrets.zn` 是 `zn1.<nonce>.<ct>` 的 base64url；`vault.json` 是 JSON），
     * 所以走文本接口，并且能直接复用 `keepConflict`（冲突时把本机版落 `.zn/conflicts/<平台>/`）。
     *
     * 方向判断与笔记同一套 `decideSync` 语义，但**没有三方合并**：
     * 密文合并毫无意义（二进制/密文拼不起来），冲突就是「留两份 + 取远端」。
     *
     * 任何一步失败只写 hint，不抛 —— 密码库传不上去不该让整轮同步（含笔记）停摆。
     *
     * @returns {{ private: Record<string, object>, changed: boolean }}
     */
    async function syncPrivate(client, manifest, summary) {
      const remotePriv = manifest.private || {}
      const nextPriv = { ...remotePriv }
      let changed = false

      for (const rel of PRIVATE_FILES) {
        /**
         * 读本地：**不用 `fs.exists`**，直接读 + 把空串当"没有"。
         * 两个理由：① 少一次 IPC（每 5 秒一轮）② 测试台的 memoryFs 没有 `exists`，
         * 而"文件不存在 ⇒ readText 抛"与"存在但空 ⇒ 返回 ''"两种表现要收敛成同一个 null。
         */
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

        // ① 两边一致 ⇒ 只刷新 baseline（`at` 用远端的，别每轮改 manifest）
        if (localFp && remoteFp && localFp === remoteFp) {
          baseline[rel] = { fp: localFp, at: entry?.at ?? 0 }
          continue
        }

        const localChanged = localFp !== base
        const remoteChanged = remoteFp !== base

        /**
         * ② 该拉：本地没有（新设备）· 或者**只有远端变了**。
         *
         * 第二条不能漏 —— 第一版只写了「本地没有」的拉，于是"B 改了、A 同步"
         * 既不拉也不推（localChanged=false 让推送分支也不成立），A 永远停在旧版
         * （单测 `B 改了密码库 ⇒ A 拉回新版` 抓到）。
         */
        if (remoteFp && (!localFp || (remoteChanged && !localChanged))) {
          try {
            const text = await client.get(rel)
            if (text == null) continue
            await client.mkdir(parent).catch(() => {})
            await api.fs.mkdir(parent).catch(() => {})
            await api.fs.writeText(rel, text)
            baseline[rel] = { fp: fingerprint(text), at: entry?.at ?? 0 }
            summary.pulled += 1
          } catch (e) {
            summary.hint = `私有文件下载失败 ${rel}：${String(e)}`
          }
          continue
        }

        // ③ 只有本地变（或远端还没有）⇒ 推
        if (localFp && (!remoteFp || (localChanged && !remoteChanged))) {
          try {
            await client.mkdir(parent).catch(() => {})
            const res = await client.put(rel, localText)
            if (![200, 201, 204, 207].includes(res.status)) {
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

        // ④ 两边都变 ⇒ 冲突：本机版留副本（keepConflict 自己读文本），再取远端版
        if (localFp && remoteFp && localChanged && remoteChanged) {
          try {
            const text = await client.get(rel)
            if (text == null) continue
            await keepConflict(rel, '密码库双端修改')
            await api.fs.writeText(rel, text)
            baseline[rel] = { fp: fingerprint(text), at: entry?.at ?? 0 }
            summary.conflicts += 1
          } catch (e) {
            summary.hint = `私有文件冲突处理失败 ${rel}：${String(e)}`
          }
          continue
        }

        // ⑤ 只剩「本地没有 + 远端也没有」—— 正常态（用户还没建密码库），什么都不做
      }
      return { private: nextPriv, changed }
    }

    /**
     * **私密文件夹目录树同步**（rev173.182 · 私密文件夹期 3）。
     *
     * 与 `syncPrivate` 的区别：那个是**固定清单**（密码库那几个文件），这里是**数量可变**的
     * 目录树（每篇私密笔记一个 `.zn` 密文）。方向判定抽成纯函数 `decideTreeAction`
     * （单测覆盖全部分支），这里只负责按判定执行。
     *
     * 与笔记同步唯一不同的语义：**删除两边都传播**。私密笔记在面板里删除是真删除，
     * 不传播的话同步一轮就会"复活"。
     */
    async function syncPrivateTree(client, manifest, summary) {
      const remoteTree = manifest.privateTree || {}
      const nextTree = { ...remoteTree }
      let changed = false

      /**
       * 本地有哪些（`listFiles` 返回**库内相对路径**，rev173.177 的教训）。
       * `typeof` 兜底：单测里的 memory fs 是逐个方法手写的，没提供 `listFiles` 时按"没有树"
       * 处理（等价于旧行为），而不是整轮同步崩掉。
       */
      const localPaths = new Set()
      if (typeof api.fs.listFiles === 'function') {
        for (const dir of PRIVATE_DIRS) {
          const files = await api.fs.listFiles(dir).catch(() => [])
          for (const rel of files) localPaths.add(rel)
        }
      }
      // 根下的固定文件（`.zn/private/index.zn`）不在那两个目录里，单独补
      for (const rel of PRIVATE_ROOT_FILES) {
        // 空串按"没有"处理（与 `syncPrivate` 同一口径）
        const raw = await api.fs.readText(rel).catch(() => null)
        if (raw && raw.trim()) localPaths.add(rel)
      }

      // 要处理的路径 = 本地 ∪ 远端（任一存在）
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
            const text = await client.get(rel)
            if (text == null) continue
            await api.fs.mkdir(parent).catch(() => {})
            await api.fs.writeText(rel, text)
            baseline[rel] = { fp: fingerprint(text), at: entry?.at ?? 0 }
            summary.pulled += 1
          } catch (e) {
            summary.hint = `私密笔记下载失败 ${rel}：${String(e)}`
          }
          continue
        }

        if (action === 'push') {
          try {
            await client.mkdir(parent).catch(() => {})
            const res = await client.put(rel, localText)
            if (![200, 201, 204, 207].includes(res?.status ?? 201)) {
              summary.hint = `私密笔记上传失败 ${rel}（${res?.status}）`
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

        // conflict：密文无法合并 ⇒ 留本机副本 + 取远端
        try {
          const text = await client.get(rel)
          if (text == null) continue
          await keepConflict(rel, '私密笔记双端修改')
          await api.fs.writeText(rel, text)
          baseline[rel] = { fp: fingerprint(text), at: entry?.at ?? 0 }
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

      /**
       * 本地附件的指纹：**`mtime` + `size` 没变就复用上次的结果**（rev173.117）。
       *
       * 自动同步每 5 秒一轮，附件多的时候每轮把所有图片重新读一遍 + 重算散列是纯浪费
       * （100 张图 ≈ 每轮几百 MB 读盘）。`listNotes` 本来就带 `mtime` / `size`，
       * 这两个都没变就没有理由再读内容。缓存只放内存，进程重启多读一次而已。
       *
       * 返回 `{ fp, bytes }`：`bytes` 只在**这次真读了盘**时才有值 —— 调用方直接拿它上传，
       * 免得同一轮为了算指纹和为了上传各读一遍（字节不留在缓存里，图片可能很大）。
       */
      async function localFpOf(meta) {
        const hit = attFpCache.get(meta.path)
        if (hit && hit.mtime === meta.mtime && hit.size === meta.size) return { fp: hit.fp, bytes: null }
        const bytes = await api.fs.readBytes(meta.path)
        const fp = fingerprintBytes(bytes)
        attFpCache.set(meta.path, { mtime: meta.mtime, size: meta.size, fp })
        return { fp, bytes }
      }

      /**
       * 本轮「算指纹时顺带读到的字节」。
       *
       * 先拉后推之后，同一份附件在一轮里要**看两次**（下载循环判方向 + 上传循环取内容）——
       * 不复用的话，本地改过的那张图会被读两遍（100 张图就是两倍 IO）。
       * 只在**这次真读了盘**时才有条目；下载覆盖本地后会删掉，避免拿旧字节又推回去。
       */
      const preloaded = new Map()

      /**
       * 本地 → 远端。**在拉取之后调用**（rev173.126）：顺序反了会先拿本机旧版盖掉远端新版，
       * 两台设备互相覆盖、谁后同步谁赢，另一台永远拿不到新版。
       */
      async function pushLocal() {
      // ① 本地 → 远端
      for (const n of locals) {
        const entry = nextAtt[n.path]
        let fp = ''
        let bytes = null
        try {
          const got = await localFpOf(n)
          fp = got.fp
          bytes = got.bytes ?? preloaded.get(n.path) ?? null
        } catch {
          continue // 读不到就下一轮
        }
        /**
         * 远端已有同一份就跳过 —— **但 `cleaned` 的不算**：那是中转模式清理过的
         * （云端副本已删），切到「永久同步」后必须重新传一份上去
         * （rev173.109 实测踩到：从 relay 切 full，附件一直不出现）。
         */
        if (entry && entry.fp === fp && !entry.cleaned) continue
        // 版本不同且本地不更新 ⇒ 远端更新，等下一轮/上一轮下载，不要拿旧版覆盖
        if (entry && !entry.cleaned && Number(n.mtime ?? 0) <= Number(entry.at ?? 0)) continue
        // 指纹缓存命中时上一行没读过字节 ⇒ 上传前补读一次
        if (!bytes) {
          try {
            bytes = await api.fs.readBytes(n.path)
          } catch {
            continue
          }
        }
        const ext = extOf(n.path)
        if (mode === 'full') {
          await client.mkdir(dirOf(n.path))
          const r = await client.putBytes(n.path, bytes)
          if (!r.ok) throw new Error(`上传附件失败（${r.status}）：${n.path}`)
        } else {
          await client.mkdir('_zn/relay')
          const r = await client.putBytes(`_zn/relay/${relayName(fp, ext)}`, bytes)
          if (!r.ok) throw new Error(`上传附件失败（${r.status}）：${n.path}`)
        }
        nextAtt[n.path] = { fp, ext, at: Date.now(), mode }
        changed = true
        summary.pushed += 1
      }
      }

      // ② 远端 → 本地（本地没有这份，**或者远端换过内容**）
      for (const [path, entry] of Object.entries(remoteAtt)) {
        if (!entry || entry.cleaned) continue
        if (!isAttachment(path)) continue
        const local = localByPath.get(path) ?? null
        /**
         * 内容级判定（rev173.117）：以前是 `localPaths.has(path)` —— 只要本地有这个文件名
         * 就永远不再看，远端把同一路径的图换掉时两端会长期不一致。现在比指纹。
         */
        let localFp = null
        if (local) {
          try {
            // `localFpOf` 返回 `{ fp, bytes }`；以前把**对象**当指纹用，与字符串永远不等 ⇒
            // 本地同版也会每轮拉一次（rev173.126 修）
            const got = await localFpOf(local)
            localFp = got.fp
            // 这一轮真要上传的话，直接复用刚读到的字节，别再读一遍盘
            if (got.bytes) preloaded.set(path, got.bytes)
          } catch {
            localFp = null
          }
        }
        if (!needsAttachmentPull(localFp, entry)) continue
        // 版本不同且本地更新 ⇒ 本机改过、留给 pushLocal；否则远端更新 ⇒ 拉
        if (local && Number(local.mtime ?? 0) > Number(entry.at ?? 0)) continue
        // 云端那份放在哪由**上传方的模式**决定（条目里的 `mode`），不是本机设置
        const remoteMode = entry.mode === 'full' || entry.mode === 'relay' ? entry.mode : mode
        const src = remoteMode === 'full' ? path : `_zn/relay/${relayName(entry.fp, entry.ext || extOf(path))}`
        let got = null
        try {
          // 带上次的 ETag：远端没变 ⇒ 304，不用再传一遍字节（rev173.117）
          got = await client.getBytes(src, attEtag.get(src) ?? null)
        } catch (e) {
          api.host.log('warn', `下载附件失败 ${path}：${String(e)}`)
          continue
        }
        if (got?.notModified) {
          /**
           * 304 = 远端这份与我们**上次取到**的一样。本地文件如果就是那份（指纹对得上），
           * 说明是本地被改动过、而远端没动 —— 不覆盖用户的本地文件；否则我们手上没有
           * 可用的字节，只能补一次完整下载。
           */
          if (localFp && localFp === entry.fp) continue
          try {
            got = await client.getBytes(src)
          } catch (e) {
            api.host.log('warn', `下载附件失败 ${path}：${String(e)}`)
            continue
          }
        }
        if (!got?.data) continue
        try {
          await api.fs.writeBytes(path, got.data)
        } catch (e) {
          api.host.log('warn', `写入附件失败 ${path}：${String(e)}`)
          continue
        }
        if (got.etag) attEtag.set(src, got.etag)
        // 刚写完，`listNotes` 的 mtime / size 变了 ⇒ 丢掉旧指纹，下一轮重新算一次
        attFpCache.delete(path)
        // 本地已被远端版覆盖 ⇒ 丢弃「算指纹时读到的旧字节」，否则下一句上传会拿旧内容推回去
        preloaded.delete(path)
        summary.pulled += 1
        if (remoteMode === 'relay') {
          await client.mkdir('_zn/relay-ack')
          await client.putBytes(`_zn/relay-ack/${relayName(entry.fp, '')}`, new TextEncoder().encode(me))
        }
      }

      await pushLocal()

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

    /* ── 自动同步（「无感」就是这一段） ── */

    let autoTimer = null
    /**
     * 限流退避状态（rev173.279 · #12）：
     * `backoffLevel` = 已连撞几次限额（0 = 正常），`backoffUntil` = 退避到哪个时间点。
     * 退避期间 5 秒的节拍照跑，但**跳过不发请求** —— 保留节拍是为了成功后能自动恢复，
     * 不用用户手动重开。
     */
    let backoffLevel = 0
    let backoffUntil = 0

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
        // 限流退避期：节拍照走、请求不发（成功后自动恢复，见 runSync 的 catch）
        if (Date.now() < backoffUntil) return
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
      // ⚠️ 用 `||` 不是 `??`：宿主会把 bind 初始化成**空字符串**，`??` 认空串为有值 ⇒ 预填失效
      form = {
        baseUrl: String(state['sync.baseUrl'] || settings.baseUrl || ''),
        username: String(state['sync.username'] || settings.username || ''),
        password: String(state['sync.password'] || ''),
        root: String(state['sync.root'] || settings.root || ''),
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
        ...(configured
          ? [
              {
                type: 'text',
                value: `当前：${settings.baseUrl}${settings.root ? ` · 目录 ${settings.root}` : ' · **目录为空**（坚果云等不可写根目录）'} · 账号 ${settings.username || '（空）'}`,
                variant: 'caption',
              },
            ]
          : []),
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
          /* rev173.275 · 真人使用测试 #14：以前是明文 input，保存后密码就摊在屏幕上。
             契约里的 `secret: true` 渲染成密码框（圆点），是对齐 `secrets` 密码库的做法。 */
          children: { type: 'input', bind: 'sync.password', secret: true, placeholder: '不改就留空' },
        },
        {
          type: 'field',
          label: '同步目录',
          hint: '远端放笔记的子目录。**坚果云的 WebDAV 根不可写，必须填**（如 ZeroNote）',
          children: { type: 'input', bind: 'sync.root', placeholder: settings.root || 'ZeroNote' },
        },
        {
          type: 'field',
          label: '附件（图片 / PDF）',
          hint: '不同步 = 只同步 .md；中转 = 对端收到后云端副本删掉（省空间）；永久 = 与文档一样',
          children: {
            type: 'select',
            bind: 'sync.attachmentsMode',
            options: [
              { value: 'off', label: '不同步（默认）' },
              { value: 'relay', label: '同步中转（云端不常留）' },
              { value: 'full', label: '与文档一样永久同步' },
            ],
            onSubmit: 'sync-webdav.set-attachments',
          },
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
              /**
               * 限流退避中要**说出来**（rev173.279 · #12）：否则面板一直写「自动 · 前台每 5 秒」，
               * 而实际已经拉到 60 秒一轮 —— 用户会以为同步还在高频打远端。
               */
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
            // rev173.115：三方合并成功数（有真冲突段时仍进「冲突」）
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
        /**
         * 耗时（rev173.117）：总时长 + 三个阶段的拆分。
         * 附件阶段为 0（模式 = 不同步 / 没有附件）时不显示，免得平白多两个 0。
         */
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

      /**
       * 耗时趋势（rev173.119）：最近若干次的平均 / 最慢 + 一条 sparkline。
       *
       * **刻意放在 `lastResult` 之外**：历史是落 store 的，重启 / 重开面板后
       * `lastResult`（本进程的内存值）是空的 —— 挂在里面就等于"每次开 App 都看不到趋势"。
       * 只有 1 条记录时不画（单点没有"趋势"可言）。
       */
      const trend = timingSummary(timingHistory)
      if (trend && trend.count > 1) {
        if (!lastResult) children.push({ type: 'divider' })
        children.push({
          type: 'text',
          value: `最近 ${trend.count} 次：平均 ${fmtMs(trend.avg)} · 最慢 ${fmtMs(trend.max)}`,
          variant: 'caption',
          tone: 'muted',
        })
        const line = sparkline(timingHistory.map((e) => e.total))
        if (line) children.push({ type: 'code', value: line })
      }

      if (conflicts.length > 0) {
        children.push({ type: 'divider' })
        children.push({ type: 'text', value: '冲突记录', variant: 'title' })
        children.push({
          type: 'list',
          items: conflicts.slice(0, 8).map((c) => {
            const where = c.file ? `${CONFLICT_ROOT}/${c.platform}/${c.file}` : null
            return {
              type: 'stack',
              gap: 'sm',
              children: [
                {
                  type: 'text',
                  value: `${new Date(c.at).toLocaleString()} · ${c.path}${where ? '' : '（本机版未留存）'}`,
                },
                ...(where
                  ? [
                      { type: 'text', value: where, variant: 'caption', tone: 'muted' },
                      // rev173.113：一键打开副本（以前只有一行字，得自己去文件管理器找）
                      {
                        type: 'button',
                        label: '打开冲突副本',
                        onClick: 'sync-webdav.open-conflict',
                        payload: { file: c.file, platform: c.platform },
                        variant: 'ghost',
                      },
                    ]
                  : []),
              ],
            }
          }),
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
        // 保留既有字段：以前整体覆盖会把 `auto` / `attachments` 冲掉 ——
        // 保存一次设置，附件模式回到「不同步」、自动同步开关也跟着错位（2026-10-24 修）。
        ...settings,
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
      // 先停自动同步：否则 5 秒内那一轮会把「测试结果」从面板上覆盖掉（实测踩到）
      stopAuto()
      let ok = false
      try {
        const client = createDavClient({ ...settings, password: await password(), net: api.net })
        const r = await client.test()
        ok = r.ok
        api.host.notify(r.ok ? `连接正常（${r.status}）` : r.hint, r.ok ? 'info' : 'error')
        lastResult = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, hint: r.hint, at: Date.now() }
      } catch (e) {
        api.host.notify(`连接测试失败：${String(e)}`, 'error')
        lastResult = { pulled: 0, pushed: 0, merged: 0, conflicts: 0, hint: `连接测试失败：${String(e)}`, at: Date.now() }
      } finally {
        // 测试通过才恢复自动同步（失败时保持停着，避免打远端锁号）
        if (ok && settings.baseUrl && settings.auto !== false) startAuto()
        // 失败 = 自动同步已被上面的 stopAuto() 停掉 ⇒ settings.auto 同步置 false，
        // 否则面板仍显示「关闭自动同步」（实际停了），用户不会知道要去手动重开。
        else if (!ok && settings.auto !== false) {
          settings.auto = false
          markDirty()
        }
      }
      api.view.refresh()
    })
    register('sync-webdav.sync', '同步：立即同步一次', () => runSync('手动'))
    register('sync-webdav.set-attachments', '同步：设置附件同步方式', (payload) => {
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
    register('sync-webdav.open-conflict', '同步：打开冲突副本', async (payload) => {
      const file = String(payload?.file ?? '')
      const plat = String(payload?.platform || platform)
      if (!file) {
        api.host.notify('没有可打开的冲突副本', 'warn')
        return
      }
      try {
        await api.command.execute('core.openNote', { path: `${CONFLICT_ROOT}/${plat}/${file}` })
      } catch (e) {
        api.host.notify(`打不开冲突副本：${String(e)}`, 'error')
      }
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
      manifestCache = null
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
        timingHistory = (await api.store.get(KEY_TIMING, [])) ?? []
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
