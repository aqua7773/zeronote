/**
 * 私密文件夹插件（期 1）—— 私密笔记
 *
 * 方案：`docs/私密文件夹-方案-2026-10-26.md`（accepted · D2 = 内核 `doc.registerCodec`）
 * 需求：§3.3 私密内容（7 条）· §10.1 加密后同步
 *
 * ## 三条铁律（改这个文件之前先读）
 *
 * ① **明文只在解锁期存在**：磁盘上只有 `.zn/private/` 下的密文（正文 + 索引），
 *    文件名是随机 id，磁盘上看不出标题。
 * ② **不进内核索引 / 文件树 / 回收站**：整棵树在 `.zn/` 下 —— 内核的 `list_notes` /
 *    `list_dirs` 本来就会跳过 `.` 开头的目录，所以**不需要**在内核里加"排除私密"的分支。
 * ③ **锁定时清空引用**：`index = null` + 关闭正在编辑的私密文档。JS 无法保证擦除
 *    （字符串不可控），文档只说"尽力清空"，见方案 §6。
 *
 * ## 编辑是怎么走通的（别退化）
 *
 * 编辑器只认「读盘 → 明文 → 写盘」这一条链路。密文能进编辑器，靠的是内核的
 * `doc.registerCodec`（rev173.180）：打开时 `decode`、保存时 `encode`。
 * 本插件因此**不需要**自己画编辑器 —— Markdown 预览 / 工具栏 / 撤销 / 全局替换全部照用。
 *
 * `transient: true` 必须保留：草稿快照落在 localStorage 里是明文，私密笔记不能写。
 *
 * ## 与 `security` 插件的关系
 *
 * 软依赖：`service.consume('crypto')` 拿不到就降级显示"先去市场装安全插件"，**不崩、不阻塞加载**。
 * 本插件**不碰密钥**：加密/解密全部经 `crypto` 服务；用的是 `notes` 环（需求：与账号密码分开）。
 */

/* ───────────────────────── 常量 ───────────────────────── */

/** 消费的密钥环 id —— `security` 里「私密笔记」那一档 */
export const RING = 'notes'
/** 加密容器 id —— 与 `security` 建环时的 `containerId: ringId` 一致（方案 §7-2 已统一成环 id） */
export const CONTAINER = 'notes'
/** 私密文件夹根（整棵树在 `.zn/` 下 ⇒ 内核天然看不见） */
export const PRIVATE_DIR = '.zn/private'
export const NOTES_DIR = '.zn/private/notes'
/** 私密回收站（期 2）：与全局回收站分开 —— 需求 §3.3「独立回收站，进入也需验证」 */
export const TRASH_DIR = '.zn/private/trash'
export const INDEX_FILE = '.zn/private/index.zn'
/** security 插件的 vault 文件（只读：判断 notes 环有没有建立） */
export const SECURITY_VAULT = '.zn/security/vault.json'
export const PANEL_ID = 'private.panel'

/** 空闲锁定：`notes` 环一档 3 分钟（`security` 的 DEFAULT_RINGS） */
export const IDLE_LOCK_MS = 3 * 60 * 1000
/** 索引格式版本 —— 换结构时换它，老的拒读而不是猜 */
export const INDEX_VERSION = 1

/* ───────────────────────── 纯函数（tests/ 直接 import） ───────────────────────── */

const nowMs = () => Date.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 唯一 id：base36 时间 + 随机尾巴（文件名不能泄漏标题，也不能有路径分隔符） */
export function newNoteId(at = nowMs()) {
  const rand = Math.floor(Math.random() * 36 ** 4).toString(36).padStart(4, '0')
  return at.toString(36) + rand
}

/** 某篇笔记的库内相对路径 */
export function notePath(id) {
  return `${NOTES_DIR}/${id}.zn`
}

/** 空索引 */
export function emptyIndex() {
  return { v: INDEX_VERSION, notes: [], trash: [] }
}

/**
 * 解析索引明文。
 *
 * ⚠️ 这里做**明文内校验**（方案 §4.1）：索引与正文用同一个容器同一套 AAD，
 * 密文互换是能解开的 —— 所以"解出来是不是索引"必须自己判断，不能只看解密成功。
 *
 * `trash` 是期 2 加的段：**老索引没有它**（期 1 写出来的），按空数组处理 ——
 * 加字段改的是同一版本号 v:1，因为"没有 trash"与"trash 为空"行为完全一致。
 */
export function parseIndex(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('私密笔记索引不是合法 JSON（文件损坏或被换过）')
  }
  if (!raw || typeof raw !== 'object' || raw.v !== INDEX_VERSION || !Array.isArray(raw.notes)) {
    throw new Error('私密笔记索引格式不认识（版本不符或结构损坏）')
  }
  const notes = []
  for (const n of raw.notes) {
    if (!n || typeof n.id !== 'string' || !n.id) continue
    notes.push({
      id: n.id,
      title: typeof n.title === 'string' ? n.title : '',
      createdAt: Number(n.createdAt) || 0,
      updatedAt: Number(n.updatedAt) || 0,
    })
  }
  const trash = []
  for (const t of Array.isArray(raw.trash) ? raw.trash : []) {
    if (!t || typeof t.id !== 'string' || !t.id) continue
    trash.push({
      id: t.id,
      title: typeof t.title === 'string' ? t.title : '',
      // 恢复要**无损**：原始时间也一起存（否则恢复后列表排序会跳）
      createdAt: Number(t.createdAt) || 0,
      updatedAt: Number(t.updatedAt) || 0,
      deletedAt: Number(t.deletedAt) || 0,
    })
  }
  return { v: INDEX_VERSION, notes, trash }
}

/** 索引 → 明文（写盘前由 crypto 服务加密） */
export function serializeIndex(index) {
  return JSON.stringify({
    v: INDEX_VERSION,
    notes: index.notes.map(stripNote),
    trash: (index.trash ?? []).map(stripTrash),
  })
}

function stripNote(n) {
  return { id: n.id, title: n.title ?? '', createdAt: n.createdAt ?? 0, updatedAt: n.updatedAt ?? 0 }
}

function stripTrash(t) {
  return {
    id: t.id,
    title: t.title ?? '',
    createdAt: t.createdAt ?? 0,
    updatedAt: t.updatedAt ?? 0,
    deletedAt: t.deletedAt ?? 0,
  }
}

/** 列表顺序：最近更新在前（同一时刻按 id 兜底，保证稳定） */
export function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * 从正文取标题：第一条 `# 标题`，否则第一行非空文本，都没有就「未命名」。
 * 只用于**列表显示**（正文是唯一真源，索引里的 title 只是缓存）。
 */
export function titleFromText(text, fallback = '未命名') {
  const lines = String(text ?? '').split(/\r?\n/)
  for (const line of lines) {
    const t = line.trim()
    if (!t) continue
    const m = /^#{1,6}\s+(.+)$/.exec(t)
    if (m) return m[1].trim().slice(0, 120) || fallback
    // 第一条非空行不是标题：也拿来当标题（与文件树对普通笔记的显示口径一致）
    return t.replace(/^[-*+>]\s+/, '').slice(0, 120) || fallback
  }
  return fallback
}

/**
 * 索引里插入或更新一篇。
 *
 * ⚠️ **必须带上 `trash`**：这个函数在 `onDocSaved` 里被调用（每次保存都跑），
 * 早期版本只返回 `{ v, notes }` ⇒ 保存任意一篇就会把回收站**整个从索引里抹掉**
 * （磁盘上的 `trash/*.zn` 还在，变成没人认领的孤儿）。单测 `moveToTrash … no-op` 抓到的。
 */
export function upsertNote(index, note) {
  const notes = index.notes.filter((n) => n.id !== note.id)
  notes.push(stripNote(note))
  return { v: INDEX_VERSION, notes, trash: index.trash ?? [] }
}

/** 索引里删掉一篇（同样要保留 `trash` —— 理由见 `upsertNote`） */
export function removeNote(index, id) {
  return {
    v: INDEX_VERSION,
    notes: index.notes.filter((n) => n.id !== id),
    trash: index.trash ?? [],
  }
}

/** 索引里找一篇 */
export function findNote(index, id) {
  return index?.notes?.find((n) => n.id === id) ?? null
}

/** 某篇笔记在回收站里的库内相对路径（密文搬家，不解密） */
export function trashPath(id) {
  return `${TRASH_DIR}/${id}.zn`
}

/* ── 回收站（索引层面的增删，纯函数） ── */

/** 移进回收站：notes 里挪到 trash（保留原始时间，恢复要无损） */
export function moveToTrash(index, id, deletedAt = Date.now()) {
  const note = findNote(index, id)
  if (!note) return index
  return {
    v: INDEX_VERSION,
    notes: index.notes.filter((n) => n.id !== id),
    trash: [...(index.trash ?? []), { ...note, deletedAt }],
  }
}

/** 从回收站恢复：trash 里挪回 notes */
export function restoreFromTrash(index, id) {
  const entry = findTrash(index, id)
  if (!entry) return index
  return {
    v: INDEX_VERSION,
    notes: [...index.notes, stripNote(entry)],
    trash: (index.trash ?? []).filter((t) => t.id !== id),
  }
}

/** 从回收站彻底删掉一条（只改索引；磁盘文件由调用方 purge） */
export function purgeTrashEntry(index, id) {
  return {
    v: INDEX_VERSION,
    notes: index.notes,
    trash: (index.trash ?? []).filter((t) => t.id !== id),
  }
}

/** 回收站里的某条 */
export function findTrash(index, id) {
  return index?.trash?.find((t) => t.id === id) ?? null
}

/** 回收站顺序：最近删的在前 */
export function sortTrash(trash) {
  return [...(trash ?? [])].sort((a, b) => {
    if (b.deletedAt !== a.deletedAt) return b.deletedAt - a.deletedAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/* ── 搜索（期 2 · 需求 §3.3「独立搜索入口」） ── */

/**
 * 多关键词 **AND** 搜索（大小写不敏感），标题或正文命中即可。
 *
 * 与内核 `index.query` 同一套语义（多词 AND、全量小写比较），但**数据源是内存里
 * 解密后的正文** —— 私密笔记不进内核索引（需求 §3.3「不经过 AI」+ 不落明文索引）。
 *
 * @param {Array<{id:string,title:string}>} notes 索引里的条目
 * @param {Map<string,string>|Record<string,string>} plainById 已解密的正文
 * @param {string} q 查询串
 * @returns {Array<{id:string,title:string,excerpt:string,titleHit:boolean}>}
 */
export function searchNotes(notes, plainById, q) {
  const terms = String(q ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (!terms.length) return []
  const get = (id) =>
    plainById instanceof Map ? plainById.get(id) ?? '' : plainById?.[id] ?? ''
  const out = []
  for (const n of notes) {
    const text = get(n.id)
    const title = String(n.title ?? '')
    const hay = `${title}\n${text}`.toLowerCase()
    if (!terms.every((t) => hay.includes(t))) continue
    out.push({
      id: n.id,
      title: title || '未命名',
      excerpt: excerptOf(text, terms),
      // 标题命中优先（与内核搜索的"标题权重高"口径接近）
      titleHit: terms.every((t) => title.toLowerCase().includes(t)),
    })
  }
  return out.sort((a, b) => Number(b.titleHit) - Number(a.titleHit))
}

/** 命中处前后各取 `radius` 个字符作为片段（找不到就给开头一段） */
export function excerptOf(text, terms, radius = 30) {
  const s = String(text ?? '')
  const low = s.toLowerCase()
  let at = -1
  let hit = ''
  for (const t of terms ?? []) {
    const i = low.indexOf(String(t).toLowerCase())
    if (i >= 0 && (at < 0 || i < at)) {
      at = i
      hit = String(t)
    }
  }
  const clean = (x) => x.replace(/\s+/g, ' ').trim()
  if (at < 0) return clean(s.slice(0, radius * 2))
  const from = Math.max(0, at - radius)
  const to = Math.min(s.length, at + hit.length + radius)
  return `${from > 0 ? '…' : ''}${clean(s.slice(from, to))}${to < s.length ? '…' : ''}`
}

/* ── 移出（私密 → 公开）需要文件名 ── */

/**
 * 用标题生成一个**库内可用的** .md 文件名（重名自动加 `-2`）。
 *
 * 为什么要清洗：标题可能带 `/` `:` `*` 这些 Windows 非法字符；以 `.` 开头会被内核的
 * `list_notes` 当私有目录/隐藏文件跳过（移出去就"看不见"了，静默失效）。
 */
export function publicPathFor(title, taken = [], ext = '.md') {
  const base =
    String(title || '私密笔记')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/^\.+/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || '私密笔记'
  const used = new Set((taken ?? []).map((p) => String(p).toLowerCase()))
  let name = base
  let n = 2
  while (used.has((name + ext).toLowerCase())) name = `${base}-${n++}`
  return name + ext
}

/**
 * 是否已建立 `notes` 环（只看 vault.json 的公开结构 —— 里面没有密码，只有 KDF 参数与密文块）。
 */
export function hasNotesRing(vaultText) {
  try {
    const v = JSON.parse(vaultText)
    return Boolean(v?.rings?.notes)
  } catch {
    return false
  }
}

/* ───────────────────────── 状态 ───────────────────────── */

let svc = null // crypto 服务（软依赖）
let index = null // 解锁后才有：{ v, notes, trash }
let ringReady = false // notes 环建了没有
let busy = '' // 正在忙的环节（'unlock' | 'search' | ''）
let message = { text: '', tone: 'muted' }
let lastActive = 0 // 空闲锁定的时间戳（Android 后台会冻结定时器 ⇒ 只信时间）
let ui = {} // 面板 render 快照里的 bind 值
/**
 * 解锁期正文缓存（id → 明文）—— **只给搜索用**（期 2）。
 * 懒加载：第一次搜索才逐篇解密，锁定即清空。方案 §4.4：不落盘任何明文索引。
 */
const plainCache = new Map()
/** 搜索结果（null = 没在搜）；面板 render 是同步的，异步结果存在这里 */
let searchResult = null
/** 当前面板视图：'list' | 'trash' */
let mode = 'list'
/** 回收站里「已上膛」的那条（彻底删除要点两次 —— 与备份恢复同一套防误触） */
let purgeArmed = null

/* ───────────────────────── 锁定 ───────────────────────── */

/** 关掉当前正在编辑的私密文档（有未保存内容时先落盘 —— 锁前不能丢改动） */
async function closePrivateDoc(api) {
  const d = api.doc.active?.()
  if (!d || !d.path?.startsWith(`${NOTES_DIR}/`)) return
  try {
    if (d.dirty) await api.doc.save(d.path)
  } catch {
    /* 落盘失败也让锁定继续 —— 不要因为一篇保存不了就永远锁不上 */
  }
  try {
    api.doc.close()
  } catch {
    /* 没打开就无所谓 */
  }
}

function lockNow(api, reason = 'manual') {
  index = null
  plainCache.clear() // 明文缓存必须随锁清掉（搜索用的是它）
  searchResult = null
  mode = 'list'
  ui = { ...ui }
  try {
    svc?.lock(RING)
  } catch {
    /* 服务侧没解锁过（例如别的窗口）—— 无所谓，本地引用已经清掉 */
  }
  void closePrivateDoc(api)
  setMessage(
    reason === 'idle' ? '空闲 3 分钟，已自动锁定' : reason === 'service' ? '密钥环已锁定' : '',
    'muted',
  )
  api.view.refresh(PANEL_ID)
}

/** 空闲判定：Android 后台会冻结定时器 ⇒ 只靠时间戳，不靠"定时器还在跑" */
function checkIdle(api) {
  if (!index || !lastActive) return
  if (nowMs() - lastActive > IDLE_LOCK_MS) lockNow(api, 'idle')
}

/** 任何用户操作都刷新活动时间 */
function touch() {
  lastActive = nowMs()
}

function setMessage(text, tone = 'muted') {
  message = { text, tone }
}

/* ───────────────────────── 存储 ───────────────────────── */

/** 确保 `.zn/private/{notes,trash}` 目录在（幂等） */
async function ensureDirs(api) {
  for (const dir of [PRIVATE_DIR, NOTES_DIR, TRASH_DIR]) {
    try {
      await api.fs.mkdir(dir)
    } catch {
      /* 已存在 */
    }
  }
}

function needSvc() {
  if (!svc) throw new Error('还没连上加密服务 —— 先装「安全」插件')
  return svc
}

/**
 * 读索引（解锁后调用）。没有索引文件 = 还没建过任何私密笔记 ⇒ 空索引。
 * 索引损坏一律**抛出**，不静默当成空库（否则下一次保存会把它覆盖掉，全丢）。
 */
async function loadIndex(api) {
  await ensureDirs(api)
  let cipher = null
  try {
    const raw = await api.fs.readText(INDEX_FILE)
    if (raw && raw.trim()) cipher = raw
  } catch {
    cipher = null // 文件不存在
  }
  if (!cipher) return emptyIndex()
  const plain = await needSvc().decryptText({ ring: RING, container: CONTAINER, payload: cipher })
  return parseIndex(plain)
}

/** 写索引（解锁后调用）—— 坏状态拒写 */
async function saveIndex(api) {
  if (!index) throw new Error('私密文件夹没解锁，拒绝写入')
  await ensureDirs(api)
  const payload = await needSvc().encrypt({
    ring: RING,
    container: CONTAINER,
    data: serializeIndex(index),
  })
  await api.fs.writeText(INDEX_FILE, payload)
  lastActive = nowMs()
}

/** 检查 notes 环建了没有（vault.json 缺失 / 坏 JSON 都按"没建"处理） */
async function checkRingReady(api) {
  try {
    const text = await api.fs.readText(SECURITY_VAULT)
    ringReady = hasNotesRing(text)
  } catch {
    ringReady = false
  }
}

/* ───────────────────────── 解锁 ───────────────────────── */

async function unlockAndLoad(api, password) {
  const s = needSvc()
  const pw = String(password ?? '')
  if (!pw) throw new Error('请输入主密码')
  await s.unlock(RING, pw)
  index = await loadIndex(api)
  plainCache.clear()
  searchResult = null
  mode = 'list'
  purgeArmed = null
  lastActive = nowMs()
  setMessage(`已解锁 · ${index.notes.length} 篇私密笔记`, 'success')
}

/* ───────────────────────── 正文读写 ───────────────────────── */

async function readPlain(api, id) {
  const cipher = await api.fs.readText(notePath(id))
  return needSvc().decryptText({ ring: RING, container: CONTAINER, payload: cipher })
}

async function writePlain(api, id, plain) {
  const payload = await needSvc().encrypt({ ring: RING, container: CONTAINER, data: plain })
  await api.fs.writeText(notePath(id), payload)
}

/** 新建一篇：落一份密文空正文 + 索引一条 */
async function createNote(api) {
  if (!index) throw new Error('先解锁')
  const id = newNoteId()
  const at = nowMs()
  await writePlain(api, id, '')
  index = upsertNote(index, { id, title: '未命名', createdAt: at, updatedAt: at })
  await saveIndex(api)
  return id
}

/* ───────────────────────── 期 2：搜索（独立搜索入口 · 需求 §3.3） ───────────────────────── */

/** 把正文缓存补齐（只解密还没缓存过的；单篇解不开按空处理，不反复重试） */
async function fillPlainCache(api) {
  if (!index) return 0
  let n = 0
  for (const note of index.notes) {
    if (plainCache.has(note.id)) continue
    try {
      plainCache.set(note.id, await readPlain(api, note.id))
      n += 1
    } catch {
      plainCache.set(note.id, '')
    }
  }
  return n
}

async function runSearch(api, q) {
  const query = String(q ?? '').trim()
  if (!query) {
    searchResult = null
    setMessage('', 'muted')
    api.view.refresh(PANEL_ID)
    return
  }
  if (!index) return
  busy = 'search'
  setMessage(`正在解密索引…（共 ${index.notes.length} 篇）`, 'muted')
  api.view.refresh(PANEL_ID)
  await sleep(30) // 先让提示渲染出来，再跑解密
  try {
    await fillPlainCache(api)
    searchResult = searchNotes(index.notes, plainCache, query)
    setMessage(
      searchResult.length ? `找到 ${searchResult.length} 篇` : '没有匹配的私密笔记',
      searchResult.length ? 'success' : 'muted',
    )
  } catch (e) {
    setMessage(`搜索失败：${String(e?.message ?? e)}`, 'danger')
  } finally {
    busy = ''
    api.view.refresh(PANEL_ID)
  }
}

/* ───────────────────────── 期 2：回收站（独立回收站 · 需求 §3.3） ───────────────────────── */

/**
 * 删除 = 密文搬进 `.zn/private/trash/`（**不解密、不碰全局回收站**）。
 * 用 `fs.move` 而不是"读出来再写" —— 搬家不需要密钥，锁定时也能删。
 */
async function trashNote(api, id) {
  if (!index) throw new Error('先解锁')
  const note = findNote(index, id)
  if (!note) throw new Error('没有这篇私密笔记')
  // 正在编辑器里开着就先关掉：否则下一次自动保存会把刚移走的文件重新写出来
  const d = api.doc.active?.()
  if (d?.path === notePath(id)) {
    try {
      api.doc.close()
    } catch {
      /* 没打开就无所谓 */
    }
  }
  await ensureDirs(api)
  await api.fs.move(notePath(id), trashPath(id))
  plainCache.delete(id)
  index = moveToTrash(index, id, nowMs())
  await saveIndex(api)
  return note
}

async function restoreNote(api, id) {
  if (!index) throw new Error('先解锁')
  if (!findTrash(index, id)) throw new Error('回收站里没有这篇')
  await ensureDirs(api)
  await api.fs.move(trashPath(id), notePath(id))
  plainCache.delete(id) // 恢复后重新解密（内容可能变过）
  index = restoreFromTrash(index, id)
  await saveIndex(api)
}

async function purgeNote(api, id) {
  if (!index) throw new Error('先解锁')
  await api.fs.purgePrivate(trashPath(id)).catch(() => {})
  index = purgeTrashEntry(index, id)
  await saveIndex(api)
}

async function emptyPrivateTrash(api) {
  if (!index) throw new Error('先解锁')
  const items = [...(index.trash ?? [])]
  for (const t of items) await api.fs.purgePrivate(trashPath(t.id)).catch(() => {})
  index = { ...index, trash: [] }
  await saveIndex(api)
  return items.length
}

/* ───────────────────────── 期 2：移入 / 移出（公开 ⇄ 私密） ───────────────────────── */

/**
 * 移入：把**当前打开的公开笔记**加密搬进私密文件夹。
 *
 * 为什么原文件要**立刻真删**（而不是留进全局回收站）：全局回收站的条目是**明文** ——
 * 移入私密却把明文留在 `.zn/trash/` 里，等于没加密。所以 `fs.delete`（进回收站）后
 * 按 `originalPath` 找到那条再 `purgeTrash`。顺序铁律：密文写成功之后才动原文件。
 */
async function moveCurrentIntoPrivate(api) {
  if (!index) throw new Error('先解锁私密文件夹')
  const d = api.doc.active?.()
  if (!d?.path) throw new Error('先打开一篇公开笔记')
  if (d.path.startsWith('.zn/')) throw new Error('这篇已经在私有目录里了（只有普通笔记能移入）')
  if (d.dirty) await api.doc.save(d.path)
  const plain = await api.fs.readText(d.path)
  const id = newNoteId()
  const at = nowMs()
  await writePlain(api, id, plain)
  index = upsertNote(index, { id, title: titleFromText(plain), createdAt: at, updatedAt: at })
  await saveIndex(api)
  const originalPath = d.path
  await api.doc.close()
  await api.fs.delete(originalPath)
  try {
    const list = await api.fs.listTrash()
    const hit = list.find((t) => t.originalPath === originalPath) ?? null
    if (hit) await api.fs.purgeTrash(hit.id)
  } catch {
    /* 清不掉也不致命：全局回收站里会留一份明文，属于已知边界（见方案 §6） */
  }
  return { id, title: titleFromText(plain) }
}

/**
 * 移出：解开一篇私密笔记，写成库内普通 `.md`；明文落盘后**立刻**删密文
 * （不保留双份 —— 用户要的是"变成公开笔记"，留一份密文只会让它下次又出现在私密列表里）。
 */
async function moveOutToPublic(api, id) {
  if (!index) throw new Error('先解锁私密文件夹')
  const note = findNote(index, id)
  if (!note) throw new Error('没有这篇私密笔记')
  const plain = await readPlain(api, id)
  const taken = (await api.fs.listNotes()).map((n) => n.path)
  const target = publicPathFor(note.title || titleFromText(plain), taken)
  await api.fs.writeText(target, plain)
  await api.fs.purgePrivate(notePath(id)).catch(() => {})
  plainCache.delete(id)
  index = removeNote(index, id)
  await saveIndex(api)
  return target
}

/* ───────────────────────── 面板 ───────────────────────── */

function textNode(value, variant, tone) {
  const n = { type: 'text', value }
  if (variant) n.variant = variant
  if (tone) n.tone = tone
  return n
}

function btn(label, action, extra = {}) {
  return { type: 'button', label, onClick: action, ...extra }
}

/** 读一个 bind 的值（render 快照里取） */
function val(bind) {
  const v = ui[bind]
  return typeof v === 'string' ? v : ''
}

const BINDS = { pw: 'private.pw', search: 'private.search' }

/** 「安全插件没装」的降级视图（软依赖标准做法：不崩、给出去哪装） */
function noServiceView() {
  return {
    type: 'stack',
    gap: 'md',
    children: [
      textNode('🔒 私密文件夹还没连上加密服务', 'title'),
      textNode(
        '本插件不自己保管密钥 —— 加密由「安全」插件提供的 crypto 服务完成。请先从市场安装「安全」插件，再回来。',
        'body',
      ),
      { type: 'row', gap: 'sm', children: [btn('打开插件管理', 'private.open-plugins', { variant: 'default' })] },
      textNode('（装好安全插件后不用重启本插件：服务一出现这里会自动刷新）', 'caption', 'muted'),
    ],
  }
}

/** 锁定视图：建立环的指引 / 输主密码 */
function lockedView() {
  const children = [
    textNode('🔒 私密文件夹已锁定', 'title'),
    textNode('这里要的是「私密笔记」那把主密码 —— 与账号密码是两把，互不派生。', 'caption', 'muted'),
  ]

  if (!ringReady) {
    children.push(
      textNode('还没建立「私密笔记」密钥环。', 'body', 'warn'),
      textNode('去「安全」插件新建一个密钥环，选「私密笔记」这一档。', 'caption', 'muted'),
      {
        type: 'row',
        gap: 'sm',
        children: [
          btn('打开安全插件', 'private.open-security'),
          btn('重新检查', 'private.recheck', { variant: 'ghost' }),
        ],
      },
    )
    return { type: 'stack', gap: 'md', children }
  }

  children.push({
    type: 'field',
    label: '主密码',
    hint: busy === 'unlock' ? '正在派生密钥…（Argon2id，桌面约 1 秒）' : undefined,
    children: {
      type: 'input',
      bind: BINDS.pw,
      secret: true,
      placeholder: '私密笔记的主密码',
      onSubmit: 'private.unlock',
    },
  })
  children.push({ type: 'row', gap: 'sm', children: [btn('解锁', 'private.unlock', { send: BINDS.pw })] })
  if (message.text) children.push(textNode(message.text, 'caption', message.tone))
  children.push(textNode('空闲 3 分钟自动锁定 · 主密码只在本机内存里用于派生，不落盘', 'caption', 'muted'))
  return { type: 'stack', gap: 'md', children }
}

/**
 * 列表视图（期 2）：搜索框 + 列表 + 回收站入口 + 移出。
 *
 * 列表本身只显示标题与时间 —— 正文解密留到打开 / 搜索时做，
 * 所以 100 篇的库打开面板也不卡。
 */
function listView() {
  const notes = sortNotes(index.notes)
  const trashCount = index.trash?.length ?? 0
  const children = [
    {
      type: 'row',
      gap: 'sm',
      align: 'center',
      wrap: true,
      children: [
        textNode('🔓 私密文件夹', 'title'),
        { type: 'badge', text: `${notes.length} 篇`, tone: 'default' },
        btn('＋ 新建', 'private.new'),
        btn(`🗑 回收站${trashCount ? ` ${trashCount}` : ''}`, 'private.goto-trash', { variant: 'ghost' }),
        btn('锁定', 'private.lock', { variant: 'ghost' }),
      ],
    },
    {
      type: 'field',
      label: '搜索',
      hint: busy === 'search' ? '正在解密正文…' : '搜标题和正文，多关键词用空格分开',
      children: {
        type: 'input',
        bind: BINDS.search,
        placeholder: '搜索私密笔记…',
        onSubmit: 'private.search-run',
      },
    },
    {
      type: 'row',
      gap: 'sm',
      children: [
        btn('搜索', 'private.search-run', { send: BINDS.search }),
        btn('清除', 'private.search-clear', { variant: 'ghost' }),
      ],
    },
  ]

  if (searchResult) {
    children.push(textNode(`找到 ${searchResult.length} 篇`, 'body'))
    if (!searchResult.length) {
      children.push(textNode('没有匹配的私密笔记。', 'body', 'muted'))
    } else {
      children.push({
        type: 'list',
        items: searchResult.map((r) => ({
          key: r.id,
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
                  textNode(r.title || '未命名', 'body'),
                  btn('打开', 'private.open', { variant: 'ghost', payload: { id: r.id } }),
                ],
              },
              textNode(r.excerpt, 'caption', 'muted'),
            ],
          },
        })),
      })
    }
  } else if (!notes.length) {
    children.push(textNode('还没有私密笔记。点「＋ 新建」开始。', 'body', 'muted'))
  } else {
    children.push({
      type: 'list',
      items: notes.map((n) => ({
        key: n.id,
        node: {
          type: 'row',
          gap: 'sm',
          align: 'center',
          wrap: true,
          children: [
            textNode(n.title || '未命名', 'body'),
            textNode(fmtTime(n.updatedAt), 'caption', 'muted'),
            btn('打开', 'private.open', { variant: 'ghost', payload: { id: n.id } }),
            btn('移出', 'private.move-out', { variant: 'ghost', payload: { id: n.id } }),
            btn('删除', 'private.trash', { variant: 'ghost', payload: { id: n.id } }),
          ],
        },
      })),
    })
  }

  if (message.text) children.push(textNode(message.text, 'caption', message.tone))
  children.push(
    textNode(
      '文件在 .zn/private/（密文，文件名是随机 id）· 不进全局搜索 / 回收站 · 「移入私密」把当前打开的公开笔记搬进来',
      'caption',
      'muted',
    ),
  )
  return { type: 'stack', gap: 'md', children }
}

/**
 * 回收站视图（期 2）—— 与全局回收站分开：需求 §3.3「独立回收站，进入也需验证」。
 * 验证继承主面板的解锁状态（没解锁根本进不来）。
 */
function trashView() {
  const items = sortTrash(index.trash)
  const children = [
    {
      type: 'row',
      gap: 'sm',
      align: 'center',
      wrap: true,
      children: [
        textNode('🗑 私密回收站', 'title'),
        { type: 'badge', text: `${items.length} 篇`, tone: 'default' },
        btn('返回列表', 'private.goto-list', { variant: 'ghost' }),
        ...(items.length ? [btn('清空', 'private.empty-trash', { variant: 'ghost' })] : []),
      ],
    },
    textNode('条目仍是密文（删除不解密）。彻底删除不可恢复。', 'caption', 'muted'),
  ]

  if (!items.length) {
    children.push(textNode('回收站是空的。', 'body', 'muted'))
  } else {
    children.push({
      type: 'list',
      items: items.map((t) => ({
        key: t.id,
        node: {
          type: 'row',
          gap: 'sm',
          align: 'center',
          wrap: true,
          children: [
            textNode(t.title || '未命名', 'body'),
            textNode(`删于 ${fmtTime(t.deletedAt)}`, 'caption', 'muted'),
            btn('恢复', 'private.restore', { variant: 'ghost', payload: { id: t.id } }),
            btn(purgeArmed === t.id ? '真的删？' : '彻底删除', 'private.purge', {
              variant: 'ghost',
              payload: { id: t.id },
            }),
          ],
        },
      })),
    })
  }

  if (message.text) children.push(textNode(message.text, 'caption', message.tone))
  return { type: 'stack', gap: 'md', children }
}

/** 时间戳 → 「10-26 21:30」（列表里够用，不引日期库） */
function fmtTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function panelNode() {
  if (!svc) return noServiceView()
  if (!index) return lockedView()
  return mode === 'trash' ? trashView() : listView()
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

/** 从保存事件里回填索引（标题变了 / 时间更新）—— 不重新解密正文以外的任何东西 */
async function onDocSaved(api, d) {
  if (!index || !d?.path || !d.path.startsWith(`${NOTES_DIR}/`)) return
  const id = d.path.slice(NOTES_DIR.length + 1).replace(/\.zn$/, '')
  const existing = findNote(index, id)
  if (!existing) return
  // 保存后正文就是事件里这份 —— 直接更新搜索缓存，免得下次搜索又解一次
  plainCache.set(id, d.content)
  index = upsertNote(index, {
    ...existing,
    title: titleFromText(d.content, '未命名'),
    updatedAt: nowMs(),
  })
  touch()
  try {
    await saveIndex(api)
  } catch (e) {
    api.host.notify(`私密笔记索引更新失败：${String(e?.message ?? e)}`, 'warn')
  }
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

    /* ② 内容转换器（rev173.180）—— 打开时解密、保存时加密，编辑器因此照常可用 */
    api.subscriptions.push(
      api.doc.registerCodec({
        id: 'private-notes:content',
        match: (p) => p.startsWith(`${NOTES_DIR}/`),
        // 内容敏感：会话恢复草稿落在 localStorage 里是明文，私密笔记一律不写
        transient: true,
        decode: async (raw) => {
          if (!svc) throw new Error('私密文件夹还没连上加密服务')
          if (!index) throw new Error('私密文件夹已锁定 —— 先在面板里解锁')
          touch()
          return svc.decryptText({ ring: RING, container: CONTAINER, payload: raw })
        },
        encode: async (plain) => {
          if (!svc) throw new Error('私密文件夹还没连上加密服务')
          if (!index) throw new Error('私密文件夹已锁定 —— 拒绝写盘（先解锁再保存）')
          touch()
          return svc.encrypt({ ring: RING, container: CONTAINER, data: plain })
        },
      }),
    )

    /* ③ 面板 */
    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '私密文件夹',
        location: 'main',
        render: (ctx) => {
          ui = { ...(ctx?.state ?? {}) }
          return panelNode()
        },
      }),
    )

    /* ④ 保存事件 → 回填索引标题（正文是唯一真源，索引只是缓存） */
    api.subscriptions.push(api.doc.on('save', (d) => void onDocSaved(api, d)))

    /* ⑤ 空闲锁定：3 秒检查一次（时间戳判定，后台冻结也补得住） */
    const idleTimer = setInterval(() => checkIdle(api), 3000)
    api.subscriptions.push({ dispose: () => clearInterval(idleTimer) })

    /* ⑥ 切回前台补判一次（Android 后台定时器被冻结） */
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkIdle(api)
    }
    document.addEventListener('visibilitychange', onVisible)
    api.subscriptions.push({ dispose: () => document.removeEventListener('visibilitychange', onVisible) })

    /* ⑦ 命令 */
    const commands = [
      { id: 'private.open', title: '私密文件夹：打开', run: () => openCorePanel(api, PANEL_ID, '私密文件夹') },
      {
        id: 'private.open-plugins',
        title: '私密文件夹：打开插件管理',
        run: () => api.command.execute('core.plugins').catch(() => api.host.notify('打不开插件管理', 'warn')),
      },
      {
        id: 'private.open-security',
        title: '私密文件夹：打开安全插件',
        run: () =>
          api.command.execute('security.open').catch(() => api.host.notify('安全插件没装或没启用', 'warn')),
      },
      {
        id: 'private.recheck',
        title: '私密文件夹：重新检查密钥环',
        run: async () => {
          await checkRingReady(api)
          setMessage(ringReady ? '找到「私密笔记」密钥环，可以输入主密码了' : '仍然没有找到「私密笔记」密钥环', ringReady ? 'success' : 'warn')
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'private.unlock',
        title: '私密文件夹：解锁',
        run: async (payload) => {
          if (busy) return
          const pw = val(BINDS.pw) || String(payload?.value ?? '')
          busy = 'unlock'
          setMessage('', 'muted')
          api.view.refresh(PANEL_ID)
          await sleep(40) // 先让"正在派生密钥…"渲染出来，再跑 Argon2
          try {
            await unlockAndLoad(api, pw)
            api.view.setState(BINDS.pw, '')
          } catch (e) {
            const msg = String(e?.message ?? e)
            if (msg.includes('还没建立')) {
              ringReady = false
              setMessage('「私密笔记」密钥环还没建立 —— 先去安全插件建一个', 'warn')
            } else if (/invalid tag|tag mismatch|bad tag/i.test(msg)) {
              // AEAD 认证失败 = 主密码不对（不存 password verifier，见安全方案 §4）
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
      { id: 'private.lock', title: '私密文件夹：立即锁定', run: () => lockNow(api, 'manual') },
      {
        id: 'private.new',
        title: '私密文件夹：新建私密笔记',
        run: async () => {
          if (!index) {
            api.host.notify('先在面板里解锁', 'warn')
            return
          }
          try {
            const id = await createNote(api)
            setMessage('已新建（空笔记，写完自动加密保存）', 'success')
            api.view.refresh(PANEL_ID)
            await api.command.execute('core.openNote', { path: notePath(id) })
          } catch (e) {
            api.host.notify(`新建失败：${String(e?.message ?? e)}`, 'error')
          }
        },
      },
      {
        id: 'private.open-note',
        title: '私密文件夹：打开一篇',
        run: async (payload) => {
          if (!index) {
            api.host.notify('先在面板里解锁', 'warn')
            return
          }
          const id = String(payload?.id ?? '')
          if (!id || !findNote(index, id)) {
            api.host.notify('没有这篇私密笔记', 'warn')
            return
          }
          touch()
          await api.command.execute('core.openNote', { path: notePath(id) })
        },
      },
      /* ── 期 2：搜索 ── */
      {
        id: 'private.search-run',
        title: '私密文件夹：搜索',
        run: async (payload) => {
          if (!index || busy) return
          const q = String(payload?.value ?? '') || val(BINDS.search)
          await runSearch(api, q)
        },
      },
      {
        id: 'private.search-clear',
        title: '私密文件夹：清除搜索',
        run: () => {
          searchResult = null
          setMessage('', 'muted')
          api.view.setState(BINDS.search, '')
          api.view.refresh(PANEL_ID)
        },
      },
      /* ── 期 2：回收站 ── */
      {
        id: 'private.goto-trash',
        title: '私密文件夹：回收站',
        run: () => {
          mode = 'trash'
          purgeArmed = null
          searchResult = null
          setMessage('', 'muted')
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'private.goto-list',
        title: '私密文件夹：返回列表',
        run: () => {
          mode = 'list'
          purgeArmed = null
          setMessage('', 'muted')
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'private.trash',
        title: '私密文件夹：删除一篇（进私密回收站）',
        run: async (payload) => {
          if (!index) return
          const id = String(payload?.id ?? '')
          try {
            await trashNote(api, id)
            setMessage('已移入私密回收站（可恢复）', 'muted')
          } catch (e) {
            setMessage(`删除失败：${String(e?.message ?? e)}`, 'danger')
          }
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'private.restore',
        title: '私密文件夹：恢复一篇',
        run: async (payload) => {
          if (!index) return
          try {
            await restoreNote(api, String(payload?.id ?? ''))
            setMessage('已恢复到私密列表', 'success')
          } catch (e) {
            setMessage(`恢复失败：${String(e?.message ?? e)}`, 'danger')
          }
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'private.purge',
        title: '私密文件夹：彻底删除（不可恢复）',
        run: async (payload) => {
          if (!index) return
          const id = String(payload?.id ?? '')
          if (!id) return
          // 两步确认：第一次只上膛（按钮变「真的删？」），第二次才真删 —— 与备份恢复同一套
          if (purgeArmed !== id) {
            purgeArmed = id
            setMessage('再点一次「真的删？」才会彻底删除 —— 这一步不可恢复', 'warn')
            api.view.refresh(PANEL_ID)
            return
          }
          purgeArmed = null
          try {
            await purgeNote(api, id)
            setMessage('已彻底删除', 'muted')
          } catch (e) {
            setMessage(`彻底删除失败：${String(e?.message ?? e)}`, 'danger')
          }
          api.view.refresh(PANEL_ID)
        },
      },
      {
        id: 'private.empty-trash',
        title: '私密文件夹：清空回收站',
        run: async () => {
          if (!index) return
          const n = index.trash?.length ?? 0
          if (!n) return
          const cleared = await emptyPrivateTrash(api).catch((e) => {
            setMessage(`清空失败：${String(e?.message ?? e)}`, 'danger')
            return -1
          })
          if (cleared >= 0) setMessage(`已清空回收站（${cleared} 篇）`, 'muted')
          purgeArmed = null
          api.view.refresh(PANEL_ID)
        },
      },
      /* ── 期 2：移入 / 移出 ── */
      {
        id: 'private.move-in',
        title: '私密文件夹：把当前笔记移入私密',
        run: async () => {
          try {
            const r = await moveCurrentIntoPrivate(api)
            setMessage(`「${r.title}」已移入私密文件夹（原文件已从库中移除）`, 'success')
            api.view.refresh(PANEL_ID)
            await api.command.execute('core.openNote', { path: notePath(r.id) })
          } catch (e) {
            api.host.notify(`移入失败：${String(e?.message ?? e)}`, 'warn')
          }
        },
      },
      {
        id: 'private.move-out',
        title: '私密文件夹：把一篇移出为公开笔记',
        run: async (payload) => {
          if (!index) {
            api.host.notify('先在面板里解锁', 'warn')
            return
          }
          try {
            const target = await moveOutToPublic(api, String(payload?.id ?? ''))
            setMessage(`已移出为公开笔记：${target}`, 'success')
            api.view.refresh(PANEL_ID)
            await api.command.execute('core.openNote', { path: target })
          } catch (e) {
            setMessage(`移出失败：${String(e?.message ?? e)}`, 'danger')
            api.view.refresh(PANEL_ID)
          }
        },
      },
    ]
    for (const cmd of commands) api.subscriptions.push(api.command.register(cmd))

    api.host.log('info', `[private-notes] 已加载：${index ? '已解锁' : '锁定'} · 密钥环${ringReady ? '已建立' : '未建立'}`)
  },
}
