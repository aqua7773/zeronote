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

const PANEL_ID = 'sync.status'
const KEY_SETTINGS = 'settings.v1'
const KEY_BASELINE = 'baseline.v1'
/**
 * 远端回收站（rev173.294）。
 *
 * 删除在两端都该是「先搬进回收站」而不是把内容抹掉：
 * 本机是 `.zn/trash/<stamp>/<文件名>`（内核 `delete_note`），云端对应 `_zn/trash/<stamp>/<原路径>`。
 * 于是「删除」与「彻底删除」各走各的：删除只是搬家，彻底删除（清空回收站 / 单项真删）
 * 才把远端那份也真删。以前的做法是「删掉远端 + 本地另存一份留底」—— 留底重复且和回收站语义冲突。
 */
const REMOTE_TRASH_DIR = '_zn/trash'
/**
 * 远端回收站保留期：超过就真删。
 *
 * 本机回收站不自动清（用户自己决定），但云端必须有个上限 —— 否则只增不减，
 * 多设备各自删一轮，云端会积一堆没人会去看的旧副本。30 天 = 本机留多久都行、
 * 云端只当「跨设备恢复窗口」。
 */
const TRASH_KEEP_MS = 30 * 24 * 60 * 60 * 1000
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
const PRIVATE_FILES = [
  '.zn/secrets/secrets.zn',
  '.zn/security/vault.notes.json',
  '.zn/security/vault.secrets.json',
  '.zn/security/vault.json',
]
/** 私密文件夹的**根文件**（不在 notes/ 或 trash/ 里，单独列出） */
const PRIVATE_ROOT_FILES = ['.zn/private/index.zn']
/** 私密文件夹的**目录树**（数量可变 ⇒ 逐个文件走同一套方向判定，见 `syncPrivateTree`） */
const PRIVATE_DIRS = ['.zn/private/notes', '.zn/private/trash']

/**
 * 私密树单个文件的同步方向（**纯函数**，单测覆盖全部分支）。
 *
 * `localFp` / `remoteFp` / `baseFp` 都是指纹字符串或 `null`（null = 那边没有这个文件）。
 *
 * 与笔记同步的 `decideSync` **语义一致但不共用**：笔记那边删除了不会传播（保守），
 * 私密树这边**两边都传播** —— 私密笔记在面板里删除是真删除，不传播的话同步一轮就复活。
 */
function decideTreeAction(localFp, remoteFp, baseFp) {
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

/* ───────────────────────── 纯函数（tests/sync.test.ts 单测） ───────────────────────── */

/** 内容指纹：长度 + FNV-1a 32 位（与 sync-folder 同一套，两边判据一致） */
function fingerprint(text) {
  const s = typeof text === 'string' ? text : String(text ?? '')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `${s.length.toString(36)}:${h.toString(36)}`
}

/** 库内相对路径 → URL 段（逐段编码，保留 `/`；空格与中文都要编码） */
function encodeDavPath(rel) {
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
function basicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user ?? ''}:${pass ?? ''}`)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  return `Basic ${btoa(bin)}`
}

/** 把 `<base>/<root>/<rel>` 拼成一个合法 URL（去掉多余斜杠，但保留协议部分的 `//`） */
function joinUrl(base, root, rel) {
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
function parsePropfind(xml, { rootPrefix = '' } = {}) {
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
function decideSync({ base, localFp, remoteFp }) {
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
 * 判定「本地已经删了、远端还留着」这一篇怎么处理（rev173.295）。
 *
 * 为什么要有它：删除走内核的软删除（移进 `.zn/trash/`），而 `.zn/` 不参与同步 ⇒
 * 同步插件只看到「本地没有这篇」，旧逻辑一律当成「拉下来」，于是删掉的东西下一轮就复活
 * （用户 2026-10-31 原话：「我本地删掉的大小，一同步又回来了」）。
 *
 * **删除优先**（2026-10-31 真机反馈后的定稿）：只要本地删过（有基线），就删远端 ——
 * 不再看「远端改没改」。旧版对「远端改过」走 `restore-remote`，结果是：本机已经删了、
 * 没有本机版可留 ⇒ 冲突记录变成**一条没有按钮的死记录**（面板显示「本机版没留下来，
 * 只能保留另一边」，用户连选项都点不到），而且云端版又被拉回本地 ⇒ 感觉"删了没用"。
 *
 * 唯一不删的情形是**没有基线**（换设备 / store 丢了）：那时「本地没有」不一定是用户删的，
 * 交给拉取段把远端版本拉下来。
 *
 * @param {{fp: string} | null} base  上次同步时的版本
 * @param {string | null} remoteFp    远端当前指纹
 * @returns {'noop'|'delete-remote'|'restore-remote'}
 */
function decideDeletion({ base, remoteFp }) {
  if (remoteFp == null) return 'noop'
  if (!base) return 'restore-remote'
  return 'delete-remote'
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
function tryAutoMerge({ base, mine, theirs, mergeLines }) {
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
function conflictFileName(path, at, taken = () => false) {
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

/* ───────────────── 本地文件夹后端（`lib/backends/folder.cjs`）的纯函数 ───────────────── */

/**
 * 本机版本**影子副本**目录（rev173.286 · 从 sync-folder 并入）。
 *
 * 本地文件夹后端不搬文件：库放在 Syncthing / OneDrive / 坚果云目录里，搬运交给那个工具。
 * 外部改了磁盘之后，**本机那一版就只剩这里** —— 所以 `note:saved` 时要另存一份。
 * 放在 `.zn/` 下（不进文件树），且必须让外部工具排除。
 */
const SNAPSHOT_DIR = '.zn/sync/last'
/**
 * 静默期：本机保存后多久没人动过，就认为同步工具已经把它搬走了。
 * 20 秒够 Syncthing 传一轮；短了会把「还没传出”当成”已同步」，双端改会被静默覆盖。
 */
const SETTLE_MS = 20_000
/** 结算节拍（只看时间戳，不碰磁盘） */
const TICK_MS = 5_000
/** 本地文件夹后端的「本机改过、还没确认被搬走」记录 */
const KEY_PENDING = 'pending.v1'
/**
 * **密码库私有目录**（rev173.164 · 期 1c）。要跨设备同步密码库，外部工具必须放行这三处
 * （`.zn/` 其余部分继续排除）。这里只用来检查它们有没有被外部工具造出冲突副本。
 */
const SECRET_DIRS = ['.zn/secrets', '.zn/security', '.zn/private']

/** 两位补零 */
function pad2(n) {
  return String(n).padStart(2, '0')
}

/** 短散列（路径 → 影子副本文件名用），同一套实现，不为它引第二个算法 */
function shortHash(s) {
  return fingerprint(String(s ?? '')).split(':')[1] ?? '0'
}

/** 影子副本路径（`<库>/.zn/sync/last/<hash32>.md`） */
function snapshotPath(path) {
  return `${SNAPSHOT_DIR}/${shortHash(path)}.md`
}

/**
 * 这条路径算不算要同步的笔记。
 *
 * **必须排掉 `.zn/`**：影子副本、冲突副本都是 `.md`，内核 rev173.107 已不再为它们发
 * `note:saved`，插件这一侧也自己判一道 —— 一旦漏过来就**自我递归**
 * （实测踩过：每写一份副本又触发一次保存，几秒内 1900 多次 writeText）。
 */
function isSyncable(path) {
  const s = String(path ?? '')
  if (!/\.md$/i.test(s)) return false
  if (s.startsWith('.zn/') || s === '.zn') return false
  return !s.split('/').includes('.zn')
}

/**
 * 文件名像不像「外部同步工具自己造的冲突副本」——`.zn/` **没被排除**的痕迹（rev173.114）。
 *
 * 插件管不到 Syncthing / OneDrive / 坚果云的排除配置，但可以在私有目录里找它们留下的指纹：
 * · Syncthing：`<名>.sync-conflict-20261024-123456-ABCDEF.md`
 * · OneDrive / Windows：`<名>-主机名.md`、`<名> (conflicted copy).md`
 * · 坚果云 / 中文客户端：`<名> (冲突副本).md`
 *
 * 注意：**不能**把 `2026-10-24 2053-双链验收.md` 这种我们自己的冲突副本当命中
 * （没有「副本 / 冲突」关键词）。
 */
function looksLikeSyncConflict(name) {
  const s = String(name ?? '')
  if (!s) return false
  return /\.sync-conflict-/i.test(s) || /conflicted copy/i.test(s) || /\(冲突/.test(s) || /冲突副本/.test(s)
}

/**
 * 判定一次外部改动 —— **本地文件夹后端的心脏**（原 `sync-folder` 的 `classifyChange`）。
 *
 * 三种状态：`baseline[path]` = 双方一致的版本 · `pending[path]` = 本机改过、还没确认被搬走 ·
 * `remoteFp` = 磁盘上现在的指纹。
 *
 * 为什么保存时不直接更新 baseline：那样「本机改完、同步还没传出去、对端又改了」会变成
 * 「只有外部变了」⇒ 本地改动被静默覆盖。所以保存只写 pending，等 `SETTLE_MS` 静默期
 * 才升为 baseline。
 *
 * | baseline | pending | 磁盘指纹 | 结论 |
 * |---|---|---|---|
 * | 无 | 无 | 任意 | `new` ⇒ 收下并记基线 |
 * | 有 | 无 | == baseline | `noop` |
 * | 有 | 无 | != baseline | `remote` ⇒ 别处更新，收下 |
 * | 有 | 有（内容） | == pending | `noop`（自己那版被同步工具搬回来了） |
 * | 有 | 有（内容） | != pending 且 != baseline | `conflict` ⇒ 留副本 |
 * | 有 | 有（删除） | 任意 | `remote` ⇒ 本地删了但别处还有，**恢复别处的** |
 *
 * @param {{fp?: string} | null | undefined} base    基线版本
 * @param {{fp?: string, deleted?: boolean} | null | undefined} pending 本机待同步版本
 * @param {string} remoteFp                          磁盘上的当前指纹
 * @returns {'new'|'noop'|'remote'|'conflict'|'local-pending'}
 */
function classifyChange({ base, pending, remoteFp }) {
  const hasPending = !!(pending && (pending.deleted || pending.fp))
  if (!base && !hasPending) return 'new'
  if (!hasPending) return base.fp === remoteFp ? 'noop' : 'remote'
  // 本机删过：别处还有这文件 ⇒ 恢复别处的（方案 A：本地删、外部改 ⇒ 恢复外部版）
  if (pending.deleted) return 'remote'
  if (pending.fp === remoteFp) return 'noop'
  if (base && base.fp === remoteFp) return 'local-pending'
  return 'conflict'
}

/** 远端 manifest 的形状校验（坏数据当作空，不让同步整个停摆） */
function normalizeManifest(raw) {
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw
    const files = j && typeof j === 'object' && j.files && typeof j.files === 'object' ? j.files : {}
    const out = {}
    for (const [path, v] of Object.entries(files)) {
      if (!v || typeof v !== 'object') continue
      if (typeof v.fp !== 'string') continue
      out[path] = {
        fp: v.fp,
        /**
         * `etag` 是统一后的字段名；**老 Git manifest 里叫 `sha`**（rev173.288 兼容）——
         * 不认它的话，老仓库升上来首轮会丢掉乐观锁版本号（不会丢数据，但少了保护）。
         */
        etag: typeof v.etag === 'string' ? v.etag : typeof v.sha === 'string' ? v.sha : undefined,
        at: Number(v.at) || 0,
      }
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
function fingerprintBytes(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? [])
  let h = 0x811c9dc5
  for (let i = 0; i < u8.length; i += 1) {
    h ^= u8[i]
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0
  }
  return `${u8.length.toString(36)}:${h.toString(36)}`
}

/** 附件扩展名（含点，小写）；没有就空串 */
function extOf(path) {
  const name = String(path ?? '').split('/').pop() ?? ''
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

/** 父目录（库内相对路径，无父目录时返回空串） */
function dirOf(path) {
  const s = String(path ?? '')
  const i = s.lastIndexOf('/')
  return i > 0 ? s.slice(0, i) : ''
}

/** 这条路径算不算「附件」（图片 / PDF / 任意非 Markdown 文件，且不在 `.zn/` 里） */
function isAttachment(path) {
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
function needsAttachmentPull(localFp, remoteEntry) {
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
function fmtMs(ms) {
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
function pushTiming(history, entry, limit = MAX_TIMING) {
  const list = Array.isArray(history) ? history.filter((e) => e && typeof e === 'object') : []
  const next = [...list, entry]
  return next.length > limit ? next.slice(next.length - limit) : next
}

/**
 * 最近若干次的耗时摘要（rev173.119）：`{ count, avg, max }`。
 * 没有可用记录返回 `null`（面板据此决定画不画这一行）。
 */
function timingSummary(history) {
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
function sparkline(values, width = 24) {
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
function relayName(fp, ext) {
  return `${String(fp ?? '').replace(/[:/\\]/g, '-')}${ext || ''}`
}

module.exports = {
  PRIVATE_FILES,
  PRIVATE_ROOT_FILES,
  PRIVATE_DIRS,
  PANEL_ID,
  KEY_SETTINGS,
  KEY_BASELINE,
  REMOTE_TRASH_DIR,
  TRASH_KEEP_MS,
  KEY_CONFLICTS,
  KEY_DEVICE,
  KEY_TIMING,
  SECRET_KEY,
  CONFLICT_ROOT,
  MANIFEST_REL,
  MAX_FILES_PER_RUN,
  AUTO_MS,
  BACKOFF_MS,
  MAX_CONFLICTS,
  MAX_TIMING,
  SPARK,
  SNAPSHOT_DIR,
  SETTLE_MS,
  TICK_MS,
  KEY_PENDING,
  SECRET_DIRS,
  pad2,
  shortHash,
  snapshotPath,
  isSyncable,
  looksLikeSyncConflict,
  classifyChange,
  decideTreeAction,
  fingerprint,
  encodeDavPath,
  basicAuth,
  joinUrl,
  parsePropfind,
  decideSync,
  decideDeletion,
  tryAutoMerge,
  conflictFileName,
  normalizeManifest,
  fingerprintBytes,
  extOf,
  dirOf,
  isAttachment,
  needsAttachmentPull,
  fmtMs,
  pushTiming,
  timingSummary,
  sparkline,
  relayName,
}