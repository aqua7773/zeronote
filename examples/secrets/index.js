/**
 * 密码库插件（期 1b）—— 绝密账号 / 账号密码
 *
 * 方案：`docs/安全插件-方案-2026-10-25.md` §4.5（accepted）
 * 需求：§8.6 绝密账号管理
 *
 * ## 三条铁律（改这个文件之前先读）
 *
 * ① **明文只在解锁期存在**：落盘只有 `.zn/secrets/secrets.zn` 一份密文。
 * ② **绝不进内核索引**：不调 `index.write`、不写 `.md`、不写临时文件 ——
 *    一旦进索引，明文就落盘了（方案 §4.5「三条内存规则」）。
 * ③ **锁定时清空引用**：`db = null` + 清显示缓存。JS 无法保证擦除
 *    （Uint8Array 能 fill(0)，字符串不能），所以文档只说"尽力清空"，见方案 §6。
 *
 * ## 与 `security` 插件的关系
 *
 * 软依赖：`service.consume('crypto')` 拿不到就降级显示"先去市场装安全插件"，**不崩、不阻塞加载**。
 * 本插件**不碰密钥**：加密/解密全部经 `crypto` 服务，AAD 由服务端绑定 `secrets|secrets|<用途>`。
 *
 * ## 纯函数为什么都 export
 *
 * `tests/secrets.test.ts` 直接 import 这些函数测（与 `examples/security` 同做法）。
 * 只有 UI / 落盘 / 宿主交互留给 CDP 实测。
 */

/* ───────────────────────── 常量 ───────────────────────── */

/** 消费的密钥环 id —— 与 `security` 插件的 RING_IDS 对齐（账号密码环） */
export const RING = 'secrets'
/** 加密容器 id —— 独立于 `private`（私密笔记），AAD 因此不会串 */
export const CONTAINER = 'secrets'
/** 整库密文（单文件；**不是一条一文件** —— 方案 §4.5 已定） */
export const VAULT_FILE = '.zn/secrets/secrets.zn'
/** security 插件的 vault.json（只读：判断 secrets 环有没有建立） */
export const SECURITY_VAULT = '.zn/security/vault.json'
export const PANEL_ID = 'secrets.panel'

/** 空闲锁定：secrets 环比 notes 环狠一档（方案 §4.5 表：60 秒 vs 3 分钟） */
export const IDLE_LOCK_MS = 60_000
/** 复制密码后多久清剪贴板（需求 §8.6：1 分钟） */
export const CLIP_TTL_MS = 60_000
/** 回收站保留期（需求 §8.6：7 天） */
export const TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** 「显示密码」自动收起时间 —— 需求没规定，取 15 秒（够抄下来，又不至于一直摊着） */
export const REVEAL_TTL_MS = 15_000
/** 密码默认长度（需求 §8.6：16 位） */
export const PASSWORD_LEN = 16

/**
 * 密码字符集（需求 §8.6：大小写 + 数字，**排除 0/O/1/l/I**，不含符号）。
 *
 * 为什么排除这五个：手抄 / 口头念时最容易混淆。去掉后：
 * 小写 25（去 `l`）· 大写 24（去 `I` `O`）· 数字 8（去 `0` `1`）。
 */
export const ALPHABET = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
}

const ALL_CHARS = ALPHABET.lower + ALPHABET.upper + ALPHABET.digit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const nowMs = () => Date.now()

/* ───────────────────────── 纯函数（tests/ 直接 import） ───────────────────────── */

/** 唯一 id。优先 `crypto.randomUUID`（桌面 + Android WebView 都在）；老环境退回时间戳 + 随机尾巴 */
export function newId(prefix = '') {
  const c = globalThis.crypto
  if (c?.randomUUID) return prefix + c.randomUUID()
  return prefix + nowMs().toString(36) + Math.random().toString(36).slice(2, 10)
}

/**
 * `[0, n)` 的均匀随机整数（注入式：测试传自己的 randInt，生产传系统随机）。
 *
 * 拒绝采样：直接 `% n` 在 n 不能整除 2^32 时有偏（密码学场合要避免）。
 */
export function defaultRandInt(n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error('randInt 的范围必须是正整数')
  const c = globalThis.crypto
  if (!c?.getRandomValues) {
    // 没有 Web Crypto 时（不该发生）退回 Math.random —— 宁愿能生成，也不静默出空密码
    return Math.floor(Math.random() * n)
  }
  const buf = new Uint32Array(1)
  const limit = Math.floor(0x1_0000_0000 / n) * n
  for (;;) {
    c.getRandomValues(buf)
    if (buf[0] < limit) return buf[0] % n
  }
}

/**
 * 生成密码：默认 16 位，保证**至少各有一个**小写 / 大写 / 数字，然后洗牌。
 *
 * 为什么不纯随机拼：三类字符不设下限时，16 位里漏掉一类的概率约 5%（
 * `(25/57)^16 ≈ 0.0004`… 实际是小写漏掉的概率极低，但**全是小写字母**这种整类缺失
 * 在短密码上很常见）。保证三类都有，强度与可读性都更稳。
 */
export function generatePassword(length = PASSWORD_LEN, randInt = defaultRandInt) {
  const len = Math.max(5, Math.trunc(Number(length) || PASSWORD_LEN))
  const chars = [
    ALPHABET.lower[randInt(ALPHABET.lower.length)],
    ALPHABET.upper[randInt(ALPHABET.upper.length)],
    ALPHABET.digit[randInt(ALPHABET.digit.length)],
  ]
  while (chars.length < len) chars.push(ALL_CHARS[randInt(ALL_CHARS.length)])
  // Fisher–Yates：把固定的「小写·大写·数字」前缀打散，否则前三位恒定有序
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    const tmp = chars[i]
    chars[i] = chars[j]
    chars[j] = tmp
  }
  return chars.join('')
}

/** 空库 */
export function emptyDb() {
  return { v: 1, updatedAt: 0, platforms: [] }
}

/**
 * 容错归一化：解密出来的 JSON 可能来自旧版本 / 手改过的备份。
 * 缺字段补默认，**不抛错**（每次弹错都让整个密码库打不开，代价太大）。
 */
export function normalizeDb(raw) {
  const out = emptyDb()
  if (!raw || typeof raw !== 'object') return out
  out.updatedAt = Number(raw.updatedAt) || 0
  const list = Array.isArray(raw.platforms) ? raw.platforms : []
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    const accounts = Array.isArray(p.accounts) ? p.accounts : []
    out.platforms.push({
      id: String(p.id ?? newId('p_')),
      name: String(p.name ?? '未命名平台'),
      site: String(p.site ?? ''),
      createdAt: Number(p.createdAt) || 0,
      accounts: accounts
        .filter((a) => a && typeof a === 'object')
        .map((a) => ({
          id: String(a.id ?? newId('a_')),
          account: String(a.account ?? ''),
          password: String(a.password ?? ''),
          note: String(a.note ?? ''),
          createdAt: Number(a.createdAt) || 0,
          updatedAt: Number(a.updatedAt) || 0,
          deletedAt: a.deletedAt ? Number(a.deletedAt) : null,
        })),
    })
  }
  return out
}

/** 平台按名称排序（**必须传 locale** —— rev173.154 的教训：不传 locale 在 CI 的 en-US 下排法不同） */
export function sortPlatforms(platforms) {
  return [...platforms].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))
}

/** 密码掩码。长度不泄露真实长度（固定 8 个点，够看出"有东西"即可） */
export function maskSecret() {
  return '········'
}

/** 某个平台下**活跃**（未进回收站）的账号 */
export function activeAccounts(platform) {
  return (platform?.accounts ?? []).filter((a) => !a.deletedAt)
}

/** 平台名 / 站点是否命中搜索词（**不搜密码** —— 需求 §8.6 明确） */
export function matchesPlatform(platform, q) {
  const s = String(q ?? '').toLowerCase()
  if (!s) return true
  return (
    String(platform?.name ?? '').toLowerCase().includes(s) ||
    String(platform?.site ?? '').toLowerCase().includes(s)
  )
}

/** 账号 / 备注是否命中搜索词（**不搜密码**） */
export function matchesAccount(account, q) {
  const s = String(q ?? '').toLowerCase()
  if (!s) return true
  return (
    String(account?.account ?? '').toLowerCase().includes(s) ||
    String(account?.note ?? '').toLowerCase().includes(s)
  )
}

/**
 * 列表树：`[{ platform, accounts }]`。
 *
 * 搜索语义：**平台命中 ⇒ 它下面全部账号都显示**（用户想找的是这个平台）；
 * 否则只显示命中账号的平台。
 *
 * **没有账号的平台也显示**（rev173.163 实测修）：第一版把空平台过滤掉了，
 * 结果"新建平台 → 保存 → 列表里什么都没有"，用户没法往里加账号。
 * 空平台在无搜索时保留，有搜索词时只在平台名/站点命中时出现。
 */
export function visibleTree(db, query = '') {
  const q = String(query ?? '').trim().toLowerCase()
  const out = []
  for (const p of db?.platforms ?? []) {
    const active = activeAccounts(p)
    if (!q) {
      out.push({ platform: p, accounts: active })
      continue
    }
    const hitPlatform = matchesPlatform(p, q)
    const hitAccounts = active.filter((a) => matchesAccount(a, q))
    if (!hitPlatform && !hitAccounts.length) continue
    out.push({ platform: p, accounts: hitPlatform ? active : hitAccounts })
  }
  return out.sort((a, b) => String(a.platform.name).localeCompare(String(b.platform.name), 'zh'))
}

/** 回收站条目（按删除时间倒序）+ 到期时间 */
export function trashList(db) {
  const out = []
  for (const p of db?.platforms ?? []) {
    for (const a of p.accounts ?? []) {
      if (!a.deletedAt) continue
      out.push({ platform: p, account: a, expiresAt: a.deletedAt + TRASH_TTL_MS })
    }
  }
  return out.sort((x, y) => y.account.deletedAt - x.account.deletedAt)
}

/** 真删超过 7 天的回收站条目，返回删掉的条数 */
export function purgeExpired(db, now = nowMs()) {
  let removed = 0
  for (const p of db?.platforms ?? []) {
    const keep = []
    for (const a of p.accounts ?? []) {
      if (a.deletedAt && now - a.deletedAt > TRASH_TTL_MS) {
        removed++
        continue
      }
      keep.push(a)
    }
    p.accounts = keep
  }
  if (removed) db.updatedAt = now
  return removed
}

/** 统计（面板抬头用） */
export function describeDb(db) {
  let accounts = 0
  let trash = 0
  for (const p of db?.platforms ?? []) {
    for (const a of p.accounts ?? []) {
      if (a.deletedAt) trash++
      else accounts++
    }
  }
  return { platforms: db?.platforms?.length ?? 0, accounts, trash }
}

/** 找一个平台 */
export function findPlatform(db, platformId) {
  return (db?.platforms ?? []).find((p) => p.id === platformId) ?? null
}

/** 找一个账号（含已删除的 —— 回收站里也要能操作） */
export function findAccount(db, platformId, accountId) {
  return findPlatform(db, platformId)?.accounts?.find((a) => a.id === accountId) ?? null
}

/** 新建平台（重名允许：同名不同站点是合法场景） */
export function addPlatform(db, { name, site = '', now = nowMs(), id = null } = {}) {
  const platform = {
    id: id ?? newId('p_'),
    name: String(name ?? '').trim(),
    site: String(site ?? '').trim(),
    createdAt: now,
    accounts: [],
  }
  db.platforms.push(platform)
  db.updatedAt = now
  return platform
}

/** 改平台名 / 站点 */
export function renamePlatform(db, platformId, { name, site, now = nowMs() } = {}) {
  const p = findPlatform(db, platformId)
  if (!p) return null
  if (name != null) p.name = String(name).trim()
  if (site != null) p.site = String(site).trim()
  db.updatedAt = now
  return p
}

/** 加账号 */
export function addAccount(
  db,
  platformId,
  { account = '', password = '', note = '', now = nowMs(), id = null } = {},
) {
  const p = findPlatform(db, platformId)
  if (!p) return null
  const acc = {
    id: id ?? newId('a_'),
    account: String(account ?? '').trim(),
    password: String(password ?? ''),
    note: String(note ?? ''),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }
  p.accounts.push(acc)
  db.updatedAt = now
  return acc
}

/** 改账号（`patch` 里只取认得的字段） */
export function updateAccount(db, platformId, accountId, patch = {}, now = nowMs()) {
  const acc = findAccount(db, platformId, accountId)
  if (!acc) return null
  if (patch.account != null) acc.account = String(patch.account).trim()
  if (patch.password != null) acc.password = String(patch.password)
  if (patch.note != null) acc.note = String(patch.note)
  acc.updatedAt = now
  db.updatedAt = now
  return acc
}

/** 软删除（进回收站） */
export function trashAccount(db, platformId, accountId, now = nowMs()) {
  const acc = findAccount(db, platformId, accountId)
  if (!acc || acc.deletedAt) return null
  acc.deletedAt = now
  acc.updatedAt = now
  db.updatedAt = now
  return acc
}

/** 从回收站恢复 */
export function restoreAccount(db, platformId, accountId, now = nowMs()) {
  const acc = findAccount(db, platformId, accountId)
  if (!acc || !acc.deletedAt) return null
  acc.deletedAt = null
  acc.updatedAt = now
  db.updatedAt = now
  return acc
}

/** 真删除（不可撤销；UI 必须二次确认） */
export function purgeAccount(db, platformId, accountId, now = nowMs()) {
  const p = findPlatform(db, platformId)
  if (!p) return false
  const before = p.accounts.length
  p.accounts = p.accounts.filter((a) => a.id !== accountId)
  if (p.accounts.length === before) return false
  db.updatedAt = now
  return true
}

/** 剩余保留天数（回收站行用；向上取整，剩 6 小时算 1 天） */
export function daysLeft(expiresAt, now = nowMs()) {
  return Math.max(0, Math.ceil((expiresAt - now) / (24 * 60 * 60 * 1000)))
}

/* ───────────────────────── 插件状态（闭包内，不落盘） ───────────────────────── */

/** crypto 服务（null = 安全插件没装 / 还没加载） */
let svc = null
/** 解密后的整库（null = 没解锁） */
let db = null
/** 上一次 render 的 state 快照（ViewApi 没有 getState，命令里读输入值靠它） */
let ui = {}
/** 忙碌态（KDF 派生 1 秒期间要让人看见） */
let busy = ''
/** 状态条消息 */
let message = { text: '', tone: 'muted' }
/** 视图：list / edit / recycle */
let mode = 'list'
/** 展开的平台 id */
let expanded = new Set()
/** 正在显示明文的账号 id（15 秒后自动收起） */
let revealed = new Set()
const revealTimers = new Map()
/** 编辑态 */
let editing = null // { kind: 'platform' | 'account', platformId, accountId }
/** secrets 环是否已建立（首屏就能提示，不用等解锁失败） */
let ringReady = false
/** 最近一次操作时间（空闲锁定用） */
let lastActive = 0
/** 剪贴板：值 + 计划清空的时刻（后台冻结时靠时间戳补判） */
let clip = { value: '', deadline: 0 }
let clipTimer = null
/** 面板 id 常量在顶部 */

/* ───────────────────────── 剪贴板（原生优先，网页 API 回退） ───────────────────────── */

/** 插件在宿主页面里跑，拿注入的 Tauri 入口（桌面 / 浏览器之外没有它） */
function ipc() {
  return globalThis.__TAURI_INTERNALS__ || null
}

/**
 * 写剪贴板。
 *
 * 为什么不用 `navigator.clipboard` 一条路：Android WebView 把 `clipboard-read` 固定成 denied
 * （`src/App.tsx:2969` 实测），写虽然可用，但桌面 WebView2 在非焦点状态下也会失败 ⇒
 * 先走原生 `tauri-plugin-clipboard-manager`（capabilities 已放行 read/write text），失败再回退。
 */
async function clipboardWrite(text) {
  const t = ipc()
  if (t) {
    try {
      await t.invoke('plugin:clipboard-manager|write_text', { text })
      return true
    } catch {
      /* 回退 */
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** 读剪贴板（Android 后台受限 ⇒ 读不到就当空，不抛错） */
async function clipboardRead() {
  const t = ipc()
  if (t) {
    try {
      const s = await t.invoke('plugin:clipboard-manager|read_text')
      if (typeof s === 'string') return s
    } catch {
      /* 回退 */
    }
  }
  try {
    return await navigator.clipboard.readText()
  } catch {
    return ''
  }
}

/**
 * 复制密码 + 计划 60 秒后清空。
 *
 * **只在剪贴板内容仍是这个密码时才清** —— 否则会误删用户后复制的东西（方案 §4.5）。
 */
function copySecret(value) {
  clip = { value, deadline: nowMs() + CLIP_TTL_MS }
  if (clipTimer) clearTimeout(clipTimer)
  clipTimer = setTimeout(() => void settleClipboard(), CLIP_TTL_MS)
}

/** 到点清剪贴板；也被「解锁 / 面板重开」调用（Android 后台定时器会被冻结） */
async function settleClipboard() {
  clipTimer = null
  const pending = clip
  clip = { value: '', deadline: 0 }
  if (!pending.value) return
  const cur = await clipboardRead()
  if (cur !== pending.value) return
  await clipboardWrite('')
}

/* ───────────────────────── 落盘 ───────────────────────── */

function setMessage(text, tone = 'muted') {
  message = { text, tone }
}

/** 读 `.zn/security/vault.json` 看 secrets 环建了没有（只读，不写别人的文件） */
async function checkRingReady(api) {
  try {
    const text = await api.fs.readText(SECURITY_VAULT)
    const parsed = JSON.parse(text)
    ringReady = Boolean(parsed?.rings?.[RING])
  } catch {
    ringReady = false // 文件不存在 = 安全插件没建过任何环
  }
  return ringReady
}

/**
 * 解锁并加载整库。
 *
 * 两种失败要分开：**环还没建**（去安全插件建）vs **密码不对**（重输）。
 * `crypto.unlock` 抛的是普通 Error，只能按消息文本判 —— 所以这里不静默吞错，
 * 把原文带上，用户能看见到底是哪一步坏了。
 */
async function unlockAndLoad(api, password) {
  if (!svc) throw new Error('没拿到 crypto 服务（安全插件没装？）')
  const pw = String(password ?? '')
  if (!pw) throw new Error('请输入主密码')
  await svc.unlock(RING, pw) // Argon2id 约 1 s（桌面）：调用方先渲染"正在派生…"
  db = await loadDb(api)
  lastActive = nowMs()
  mode = 'list'
  expanded = new Set()
  revealed = new Set()
  const removed = purgeExpired(db)
  if (removed) await saveDb(api) // 过期清理要落盘，否则每次解锁都白算
  setMessage('', 'muted')
  return db
}

/** 读整库密文 → 明文对象。文件不存在 = 首次（空库） */
async function loadDb(api) {
  let text = ''
  try {
    if (await api.fs.exists(VAULT_FILE)) text = await api.fs.readText(VAULT_FILE)
  } catch {
    text = ''
  }
  if (!text.trim()) return emptyDb()
  const plain = await svc.decryptText({ ring: RING, container: CONTAINER, payload: text.trim() })
  return normalizeDb(JSON.parse(plain))
}

/**
 * 整库加密写盘。
 *
 * 坏文件**不覆盖**：解密失败时 `db` 根本不会被赋值（异常向上抛），调用方也就不该走到这里。
 * 这里再加一道 —— 没有 db 就别写，避免把空库盖掉真实数据。
 */
async function saveDb(api) {
  if (!db) throw new Error('密码库没解锁，拒绝写入')
  const payload = await svc.encrypt({
    ring: RING,
    container: CONTAINER,
    data: JSON.stringify(db),
  })
  try {
    await api.fs.mkdir('.zn/secrets')
  } catch {
    /* 目录已存在 */
  }
  await api.fs.writeText(VAULT_FILE, payload)
  lastActive = nowMs()
}

/* ───────────────────────── 锁定 ───────────────────────── */

function lockNow(api, reason = 'manual') {
  db = null
  revealed = new Set()
  for (const t of revealTimers.values()) clearTimeout(t)
  revealTimers.clear()
  editing = null
  mode = 'list'
  expanded = new Set()
  try {
    svc?.lock(RING)
  } catch {
    /* 服务侧没解锁过（例如别的窗口）—— 无所谓，本地引用已经清掉 */
  }
  setMessage(reason === 'idle' ? '空闲 60 秒，已自动锁定' : '', 'muted')
  api.view.refresh(PANEL_ID)
}

/** 空闲判定：Android 后台会冻结定时器 ⇒ 只靠时间戳，不靠"定时器还在跑" */
function checkIdle(api) {
  if (!db || !lastActive) return
  if (nowMs() - lastActive > IDLE_LOCK_MS) lockNow(api, 'idle')
}

/** 任何用户操作都刷新活动时间 */
function touch() {
  lastActive = nowMs()
}

/* ───────────────────────── 面板 ───────────────────────── */

const BINDS = {
  search: 'secrets.search',
  pw: 'secrets.pw',
  name: 'secrets.name',
  site: 'secrets.site',
  account: 'secrets.account',
  password: 'secrets.password',
  note: 'secrets.note',
}

/** 读一个 bind 的值（render 快照里取） */
function val(bind) {
  const v = ui[bind]
  return typeof v === 'string' ? v : ''
}

function textNode(value, variant, tone) {
  const n = { type: 'text', value }
  if (variant) n.variant = variant
  if (tone) n.tone = tone
  return n
}

function btn(label, action, extra = {}) {
  return { type: 'button', label, onClick: action, ...extra }
}

/** 「安全插件没装」的降级视图（软依赖标准做法：不崩、给出去哪装） */
function noServiceView() {
  return {
    type: 'stack',
    gap: 'md',
    children: [
      textNode('🔒 密码库还没连上加密服务', 'title'),
      textNode(
        '本插件不自己保管密钥 —— 加密由「安全」插件提供的 crypto 服务完成。请先从市场安装「安全」插件，再回来。',
        'body',
      ),
      {
        type: 'row',
        gap: 'sm',
        children: [btn('打开插件管理', 'secrets.open-plugins', { variant: 'default' })],
      },
      textNode('（装好安全插件后不用重启本插件：服务一出现这里会自动刷新）', 'caption', 'muted'),
    ],
  }
}

/** 锁定视图：输主密码 */
function lockedView() {
  const children = [
    textNode('🔒 密码库已锁定', 'title'),
    textNode('这里要的是「账号密码」那把主密码 —— 与私密笔记的主密码是两把，互不派生。', 'caption', 'muted'),
  ]

  if (!ringReady) {
    children.push(
      textNode('还没建立「账号密码」密钥环。', 'body', 'warn'),
      textNode('去「安全」插件新建一个密钥环，选「账号密码」这一档。', 'caption', 'muted'),
      {
        type: 'row',
        gap: 'sm',
        children: [btn('打开安全插件', 'secrets.open-security'), btn('重新检查', 'secrets.recheck', { variant: 'ghost' })],
      },
    )
    return { type: 'stack', gap: 'md', children }
  }

  children.push({
    type: 'field',
    label: '主密码',
    hint: busy === RING ? '正在派生密钥…（Argon2id，桌面约 1 秒）' : undefined,
    children: {
      type: 'input',
      bind: BINDS.pw,
      secret: true,
      placeholder: '账号密码库的主密码',
      onSubmit: 'secrets.unlock',
    },
  })
  children.push({
    type: 'row',
    gap: 'sm',
    children: [btn('解锁', 'secrets.unlock', { send: BINDS.pw, variant: 'default' })],
  })
  if (message.text) children.push(textNode(message.text, 'caption', message.tone))
  children.push(textNode('空闲 60 秒自动锁定 · 主密码只在本机内存里用于派生，不落盘', 'caption', 'muted'))
  return { type: 'stack', gap: 'md', children }
}

/**
 * 一个账号行 —— **返回裸 UINode**（不是 `{ key, node }`）。
 *
 * ⚠️ `stack.children` 只吃 UINode，`{key,node}` 是 `list.items` 的包装形式。
 * 第一版这里返回了包装对象 ⇒ 整段 JSON 被当文本摊在界面上（rev173.163 实测抓到）。
 */
function accountRow(platform, account) {
  const shown = revealed.has(account.id)
  const pwText = shown ? account.password || '（空）' : maskSecret()
  return {
    type: 'stack',
    gap: 'sm',
    children: [
      {
        type: 'row',
        gap: 'sm',
        align: 'center',
        wrap: true,
        children: [
          textNode(account.account || '（未填账号）'),
          textNode(pwText, 'caption', shown ? 'warn' : 'muted'),
          btn(shown ? '隐藏' : '显示', 'secrets.reveal', {
            variant: 'ghost',
            payload: { platformId: platform.id, accountId: account.id },
          }),
          btn('复制', 'secrets.copy', {
            variant: 'ghost',
            payload: { platformId: platform.id, accountId: account.id },
          }),
          btn('编辑', 'secrets.edit-account', {
            variant: 'ghost',
            payload: { platformId: platform.id, accountId: account.id },
          }),
          btn('删除', 'secrets.del-account', {
            variant: 'danger',
            payload: { platformId: platform.id, accountId: account.id },
          }),
        ],
      },
      ...(account.note ? [textNode(account.note, 'caption', 'muted')] : []),
    ],
  }
}

/** 列表视图 */
function listView() {
  const q = val(BINDS.search)
  const tree = visibleTree(db, q)
  const stat = describeDb(db)
  const items = []

  for (const { platform, accounts } of tree) {
    const open = expanded.has(platform.id)
    items.push({
      key: platform.id,
      node: {
        type: 'stack',
        gap: 'sm',
        children: [
          {
            type: 'row',
            gap: 'sm',
            align: 'center',
            wrap: true,
            children: [
              textNode(platform.name, 'title'),
              { type: 'badge', text: `${accounts.length} 个账号`, tone: 'default' },
              ...(platform.site ? [textNode(platform.site, 'caption', 'muted')] : []),
              btn(open ? '收起' : '展开', 'secrets.toggle', {
                variant: 'ghost',
                payload: { platformId: platform.id },
              }),
              btn('＋ 账号', 'secrets.new-account', {
                variant: 'ghost',
                payload: { platformId: platform.id },
              }),
              btn('改名', 'secrets.edit-platform', {
                variant: 'ghost',
                payload: { platformId: platform.id },
              }),
            ],
          },
          ...(open
            ? accounts.length
              ? accounts.map((a) => accountRow(platform, a))
              : [textNode('还没有账号 —— 点上面的「＋ 账号」加一个', 'caption', 'muted')]
            : []),
        ],
      },
    })
  }

  const children = [
    {
      type: 'row',
      gap: 'sm',
      align: 'center',
      wrap: true,
      children: [
        textNode(`🔓 密码库 · ${stat.platforms} 个平台 / ${stat.accounts} 个账号`, 'title'),
        {
          type: 'badge',
          text: stat.trash ? `回收站 ${stat.trash}` : '回收站空',
          tone: stat.trash ? 'warn' : 'muted',
        },
        btn('回收站', 'secrets.goto-recycle', { variant: 'ghost' }),
        btn('锁定', 'secrets.lock', { variant: 'ghost' }),
      ],
    },
    {
      type: 'input',
      bind: BINDS.search,
      placeholder: '搜索平台 / 账号 / 备注（不搜密码）',
    },
    {
      type: 'row',
      gap: 'sm',
      children: [btn('＋ 新建平台', 'secrets.new-platform', { variant: 'default' })],
    },
    ...(message.text ? [textNode(message.text, 'caption', message.tone)] : []),
    { type: 'divider' },
    {
      type: 'list',
      items,
      empty: q ? `没有匹配「${q}」的账号` : '还没有账号 —— 点「＋ 新建平台」开始',
    },
  ]
  return { type: 'stack', gap: 'md', children }
}

/** 编辑视图（新建平台 / 改平台 / 新建账号 / 改账号） */
function editView() {
  const isAccount = editing?.kind === 'account'
  const platform = findPlatform(db, editing?.platformId)
  const editingExisting = isAccount ? Boolean(editing?.accountId) : Boolean(editing?.platformId)
  const title = isAccount ? (editingExisting ? '编辑账号' : '新建账号') : editingExisting ? '编辑平台' : '新建平台'
  const children = [
    textNode(title, 'title'),
    textNode(
      isAccount
        ? `平台：${platform?.name ?? '（未知）'}`
        : '一个平台可以有多个账号（同一站点的小号、团队号）',
      'caption',
      'muted',
    ),
  ]

  if (!isAccount) {
    children.push({
      type: 'field',
      label: '平台名',
      hint: '例如 GitHub / 银行 / 邮箱',
      children: { type: 'input', bind: BINDS.name, placeholder: '平台名' },
    })
    children.push({
      type: 'field',
      label: '站点（可选）',
      children: { type: 'input', bind: BINDS.site, placeholder: '例如 github.com' },
    })
  } else {
    children.push({
      type: 'field',
      label: '账号',
      children: { type: 'input', bind: BINDS.account, placeholder: '登录名 / 邮箱 / 手机号' },
    })
    children.push({
      type: 'field',
      label: '密码',
      hint: '默认隐藏 · 保存后落在整库密文里',
      children: {
        type: 'row',
        gap: 'sm',
        children: [
          { type: 'input', bind: BINDS.password, secret: true, placeholder: '密码' },
          btn('生成', 'secrets.gen', { variant: 'ghost' }),
        ],
      },
    })
    children.push({
      type: 'field',
      label: '备注（可选）',
      children: { type: 'textarea', bind: BINDS.note, rows: 3, placeholder: '例如：绑定手机、二级密码提示' },
    })
  }

  children.push({
    type: 'row',
    gap: 'sm',
    children: [
      btn('保存', 'secrets.save', { variant: 'default' }),
      btn('取消', 'secrets.cancel', { variant: 'ghost' }),
    ],
  })
  if (message.text) children.push(textNode(message.text, 'caption', message.tone))
  return { type: 'stack', gap: 'md', children }
}

/** 回收站视图 */
function recycleView() {
  const rows = trashList(db)
  const now = nowMs()
  return {
    type: 'stack',
    gap: 'md',
    children: [
      {
        type: 'row',
        gap: 'sm',
        align: 'center',
        children: [
          textNode('🗑 回收站', 'title'),
          { type: 'badge', text: `${rows.length} 项`, tone: rows.length ? 'warn' : 'muted' },
          btn('返回', 'secrets.goto-list', { variant: 'ghost' }),
        ],
      },
      textNode('删除的账号保留 7 天，到期自动清除。恢复或彻底删除都在这里。', 'caption', 'muted'),
      {
        type: 'list',
        items: rows.map(({ platform, account, expiresAt }) => ({
          key: account.id,
          node: {
            type: 'row',
            gap: 'sm',
            align: 'center',
            wrap: true,
            children: [
              textNode(`${platform.name} · ${account.account || '（未填账号）'}`),
              { type: 'badge', text: `剩 ${daysLeft(expiresAt, now)} 天`, tone: 'muted' },
              btn('恢复', 'secrets.restore', {
                variant: 'ghost',
                payload: { platformId: platform.id, accountId: account.id },
              }),
              btn('彻底删除', 'secrets.purge', {
                variant: 'danger',
                payload: { platformId: platform.id, accountId: account.id },
              }),
            ],
          },
        })),
        empty: '回收站是空的',
      },
      ...(message.text ? [textNode(message.text, 'caption', message.tone)] : []),
    ],
  }
}

/** 面板总入口 */
function panelNode() {
  if (!svc) return noServiceView()
  if (!db) return lockedView()
  if (mode === 'edit') return editView()
  if (mode === 'recycle') return recycleView()
  return listView()
}

/* ───────────────────────── 命令实现 ───────────────────────── */

/** 打开某面板：冷启动时 `core.panel.*` 可能还没注册（doc-reader / tag-panel 同款重试） */
async function openCorePanel(api, panelId, fallbackTitle) {
  for (let i = 0; i < 5; i++) {
    try {
      await api.command.execute(`core.panel.${panelId}`)
      return
    } catch {
      await sleep(30)
    }
  }
  api.host.notify(`打不开${fallbackTitle}（内核还没注册面板命令）`, 'warn')
}

/** 进编辑态：把当前值预填进输入框 */
function enterEdit(api, next) {
  editing = next
  mode = 'edit'
  setMessage('', 'muted')
  if (next.kind === 'platform') {
    const p = findPlatform(db, next.platformId)
    api.view.setState(BINDS.name, p?.name ?? '')
    api.view.setState(BINDS.site, p?.site ?? '')
  } else {
    const a = findAccount(db, next.platformId, next.accountId)
    api.view.setState(BINDS.account, a?.account ?? '')
    api.view.setState(BINDS.password, a?.password ?? '')
    api.view.setState(BINDS.note, a?.note ?? '')
  }
  api.view.refresh(PANEL_ID)
}

/** 显示密码 + 15 秒自动收起 */
function reveal(api, platformId, accountId) {
  const acc = findAccount(db, platformId, accountId)
  if (!acc) return
  if (revealed.has(accountId)) {
    revealed.delete(accountId)
    const t = revealTimers.get(accountId)
    if (t) clearTimeout(t)
    revealTimers.delete(accountId)
    api.view.refresh(PANEL_ID)
    return
  }
  revealed.add(accountId)
  const timer = setTimeout(() => {
    revealed.delete(accountId)
    revealTimers.delete(accountId)
    api.view.refresh(PANEL_ID)
  }, REVEAL_TTL_MS)
  revealTimers.set(accountId, timer)
  api.view.refresh(PANEL_ID)
}

/* ───────────────────────── 插件入口 ───────────────────────── */

export default {
  async apply(api) {
    /* ① 拿 crypto 服务（软依赖：拿不到就降级，不阻塞加载） */
    svc = await api.service.consume('crypto')
    api.subscriptions.push(
      api.event.on('service:available', (payload) => {
        const name = payload && typeof payload === 'object' ? payload.name : null
        if (name !== 'crypto' || svc) return
        void api.service.consume('crypto').then(async (got) => {
          if (!got) return
          svc = got
          await checkRingReady(api)
          api.view.refresh(PANEL_ID)
        })
      }),
    )
    await checkRingReady(api)

    /* ② 面板 */
    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '密码库',
        location: 'main',
        render: (ctx) => {
          ui = { ...(ctx?.state ?? {}) }
          return panelNode()
        },
      }),
    )

    /* ③ 空闲锁定：3 秒检查一次（时间戳判定，时间戳在后台也走） */
    const idleTimer = setInterval(() => checkIdle(api), 3000)
    api.subscriptions.push({
      dispose: () => {
        clearInterval(idleTimer)
        if (clipTimer) clearTimeout(clipTimer)
        for (const t of revealTimers.values()) clearTimeout(t)
        revealTimers.clear()
      },
    })

    /* ④ 切回前台时补判两件事：空闲锁 / 剪贴板到点没清（后台定时器被冻结） */
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      checkIdle(api)
      if (clip.value && nowMs() >= clip.deadline) void settleClipboard()
    }
    document.addEventListener('visibilitychange', onVisible)
    api.subscriptions.push({
      dispose: () => document.removeEventListener('visibilitychange', onVisible),
    })

    /* ⑤ 命令 */
    const commands = [
      {
        id: 'secrets.open',
        title: '密码库：打开',
        run: () => openCorePanel(api, PANEL_ID, '密码库面板'),
      },
      {
        id: 'secrets.open-plugins',
        title: '密码库：打开插件管理',
        run: () => api.command.execute('core.plugins').catch(() => api.host.notify('打不开插件管理', 'warn')),
      },
      {
        id: 'secrets.open-security',
        title: '密码库：打开安全插件',
        run: () => api.command.execute('security.open').catch(() => api.host.notify('安全插件没装或没启用', 'warn')),
      },
      {
        id: 'secrets.recheck',
        title: '密码库：重新检查密钥环',
        run: async () => {
          await checkRingReady(api)
          setMessage(ringReady ? '找到「账号密码」密钥环，可以输入主密码了' : '仍然没有找到「账号密码」密钥环', ringReady ? 'success' : 'warn')
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.unlock',
        title: '密码库：解锁',
        run: async (payload) => {
          if (busy) return
          const pw = val(BINDS.pw) || String(payload?.value ?? '')
          busy = RING
          setMessage('', 'muted')
          api.view.refresh(PANEL_ID)
          await sleep(40) // 先让"正在派生密钥…"渲染出来，再跑 Argon2
          try {
            await unlockAndLoad(api, pw)
            api.view.setState(BINDS.pw, '')
            setMessage('已解锁', 'success')
          } catch (e) {
            const msg = String(e?.message ?? e)
            if (msg.includes('还没建立')) {
              ringReady = false
              setMessage('「账号密码」密钥环还没建立 —— 先去安全插件建一个', 'warn')
            } else if (/invalid tag|tag mismatch|bad tag/i.test(msg)) {
              // AEAD 认证失败 = 主密码不对（不存 password verifier，见方案 §4）
              setMessage('主密码不对', 'danger')
            } else {
              setMessage(`解锁失败：${msg}`, 'danger')
            }
          } finally {
            busy = ''
            api.view.refresh(PANEL_ID)
          }
        },
      },
      {
        id: 'secrets.lock',
        title: '密码库：立即锁定',
        run: () => lockNow(api, 'manual'),
      },
      {
        id: 'secrets.new-platform',
        title: '密码库：新建平台',
        run: () => enterEdit(api, { kind: 'platform', platformId: null, accountId: null }),
      },
      {
        id: 'secrets.edit-platform',
        title: '密码库：改平台信息',
        run: (payload) => enterEdit(api, { kind: 'platform', platformId: String(payload?.platformId ?? ''), accountId: null }),
      },
      {
        id: 'secrets.new-account',
        title: '密码库：新建账号',
        run: (payload) => {
          const platformId = String(payload?.platformId ?? '')
          if (!findPlatform(db, platformId)) return
          enterEdit(api, { kind: 'account', platformId, accountId: null })
        },
      },
      {
        id: 'secrets.edit-account',
        title: '密码库：编辑账号',
        run: (payload) => {
          const platformId = String(payload?.platformId ?? '')
          const accountId = String(payload?.accountId ?? '')
          if (!findAccount(db, platformId, accountId)) return
          enterEdit(api, { kind: 'account', platformId, accountId })
        },
      },
      {
        id: 'secrets.gen',
        title: '密码库：生成密码',
        run: () => {
          const pw = generatePassword(PASSWORD_LEN)
          api.view.setState(BINDS.password, pw)
          setMessage('已生成 16 位密码（大小写 + 数字，排除 0/O/1/l/I）', 'success')
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.save',
        title: '密码库：保存',
        run: async () => {
          if (!db || !editing) return
          touch()
          try {
            if (editing.kind === 'platform') {
              const name = val(BINDS.name).trim()
              if (!name) {
                setMessage('平台名不能为空', 'danger')
                api.view.refresh(PANEL_ID)
                return
              }
              const site = val(BINDS.site).trim()
              if (editing.platformId) {
                renamePlatform(db, editing.platformId, { name, site })
              } else {
                const p = addPlatform(db, { name, site })
                expanded.add(p.id)
              }
            } else {
              const account = val(BINDS.account).trim()
              const password = val(BINDS.password)
              const note = val(BINDS.note)
              if (!account) {
                setMessage('账号不能为空', 'danger')
                api.view.refresh(PANEL_ID)
                return
              }
              if (!password) {
                setMessage('密码不能为空（点「生成」可自动填一个）', 'danger')
                api.view.refresh(PANEL_ID)
                return
              }
              if (editing.accountId) {
                updateAccount(db, editing.platformId, editing.accountId, { account, password, note })
              } else {
                addAccount(db, editing.platformId, { account, password, note })
              }
              expanded.add(editing.platformId)
            }
            await saveDb(api)
            mode = 'list'
            editing = null
            setMessage('已保存', 'success')
          } catch (e) {
            setMessage(`保存失败：${String(e?.message ?? e)}`, 'danger')
          }
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.cancel',
        title: '密码库：取消编辑',
        run: () => {
          editing = null
          mode = 'list'
          setMessage('', 'muted')
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.toggle',
        title: '密码库：展开/收起平台',
        run: (payload) => {
          const id = String(payload?.platformId ?? '')
          if (!id) return
          if (expanded.has(id)) expanded.delete(id)
          else expanded.add(id)
          touch()
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.reveal',
        title: '密码库：显示/隐藏密码',
        run: (payload) => {
          touch()
          reveal(api, String(payload?.platformId ?? ''), String(payload?.accountId ?? ''))
        },
      },
      {
        id: 'secrets.copy',
        title: '密码库：复制密码',
        run: async (payload) => {
          const acc = findAccount(db, String(payload?.platformId ?? ''), String(payload?.accountId ?? ''))
          if (!acc) return
          touch()
          const ok = await clipboardWrite(acc.password)
          if (!ok) {
            setMessage('写剪贴板失败（内容没有复制）', 'danger')
          } else {
            copySecret(acc.password)
            setMessage('已复制 —— 60 秒后自动清空剪贴板', 'success')
          }
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.del-account',
        title: '密码库：删除账号',
        run: async (payload) => {
          const platformId = String(payload?.platformId ?? '')
          const accountId = String(payload?.accountId ?? '')
          if (!findAccount(db, platformId, accountId)) return
          if (trashAccount(db, platformId, accountId)) {
            await saveDb(api)
            setMessage('已移入回收站（保留 7 天）', 'success')
          }
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.goto-recycle',
        title: '密码库：回收站',
        run: () => {
          if (purgeExpired(db)) void saveDb(api)
          mode = 'recycle'
          setMessage('', 'muted')
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.goto-list',
        title: '密码库：返回列表',
        run: () => {
          mode = 'list'
          setMessage('', 'muted')
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.restore',
        title: '密码库：恢复账号',
        run: async (payload) => {
          const ok = restoreAccount(db, String(payload?.platformId ?? ''), String(payload?.accountId ?? ''))
          if (ok) {
            await saveDb(api)
            setMessage('已恢复', 'success')
          }
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'secrets.purge',
        title: '密码库：彻底删除',
        run: async (payload) => {
          const ok = purgeAccount(db, String(payload?.platformId ?? ''), String(payload?.accountId ?? ''))
          if (ok) {
            await saveDb(api)
            setMessage('已彻底删除（不可撤销）', 'warn')
          }
          api.view.refresh(PANEL_ID)
        },
      },
    ]
    for (const cmd of commands) api.subscriptions.push(api.command.register(cmd))

    api.host.log(
      'info',
      `[secrets] 已加载：crypto 服务${svc ? '可用' : '不可用'} · 密钥环${ringReady ? '已建立' : '未建立'} · ${
        db ? '已解锁' : '锁定'
      }`,
    )
  },
}
