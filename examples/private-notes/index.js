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

/**
 * 消费的密钥环 id。
 *
 * rev173.416 起**由安全插件分配**：本插件只声明「我需要一个密钥环」，实际是哪个环
 * 由用户在「安全 → 密钥环分配」里定。默认 `notes`。
 */
export let RING = 'notes'
/** 加密容器 id —— 与 `security` 建环时的 `containerId: ringId` 一致（方案 §7-2 已统一成环 id） */
export const CONTAINER = 'notes'
/** 私密文件夹根（整棵树在 `.zn/` 下 ⇒ 内核天然看不见） */
export const PRIVATE_DIR = '.zn/private'
export const NOTES_DIR = '.zn/private/notes'
/** 私密回收站（期 2）：与全局回收站分开 —— 需求 §3.3「独立回收站，进入也需验证」 */
export const TRASH_DIR = '.zn/private/trash'
export const INDEX_FILE = '.zn/private/index.zn'
/**
 * security 插件的 vault（只读：判断 notes 环有没有建立）。
 *
 * rev173.335（真人测试9 #2 同源）：`security` 自 rev173.182 起按环拆文件
 * （`.zn/security/vault.<环id>.json`），旧单文件 `vault.json` 只剩迁移残留。
 * 这里原来只读旧单文件 ⇒ 迁移过的库存永远显示「还没建立密钥环」。
 */
export const SECURITY_VAULT_DIR = '.zn/security'
/** 某个环的 vault 文件（与 security 的 `vaultFileOf` 对齐） */
export function securityVaultFileOf(ringId) {
  return `${SECURITY_VAULT_DIR}/vault.${ringId}.json`
}
/** 旧版单文件（按环拆之前）—— 只读兼容 */
export const SECURITY_VAULT = `${SECURITY_VAULT_DIR}/vault.json`

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
      // rev173.397：手动改过的标题不再被正文首行覆盖（否则保存一次就变回去）
      ...(n.titleEdited === true ? { titleEdited: true } : {}),
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
  return {
    id: n.id,
    title: n.title ?? '',
    ...(n.titleEdited ? { titleEdited: true } : {}),
    createdAt: n.createdAt ?? 0,
    updatedAt: n.updatedAt ?? 0,
  }
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
 * 移出的**落点路径**（rev173.400）：标题 → 文件名 → 拼目标目录。
 *
 * 单拎成导出函数是为了可单测（清洗 + 重名避让 + 目录拼接一起测），
 * 也让「拖到某个目录」与「面板里移出到库根」共用同一条命名规则。
 */
export function publicTargetPath(title, taken = [], dir = '') {
  const name = publicPathFor(title, taken)
  const d = String(dir ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
  return d ? `${d}/${name}` : name
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

/**
 * 单环 vault 文件（security rev173.182 拆出来的新格式）里是不是 `notes` 环。
 * 结构：`{ v: 2, ring: { id: 'notes', ... } }`（见 security 的 `vaultPartPayload`）。
 */
export function hasNotesRingPart(vaultText) {
  try {
    const v = JSON.parse(vaultText)
    return v?.ring?.id === 'notes'
  } catch {
    return false
  }
}

/* ───────────────────────── 状态 ───────────────────────── */

let svc = null // crypto 服务（软依赖）
let index = null // 解锁后才有：{ v, notes, trash }
let ringReady = false // notes 环建了没有
let busy = '' // 正在忙的环节（'unlock' | 'search' | ''）
let lastActive = 0 // 空闲锁定的时间戳（Android 后台会冻结定时器 ⇒ 只信时间）
/**
 * 解锁期正文缓存（id → 明文）—— **只给搜索用**（期 2）。
 * 懒加载：第一次搜索才逐篇解密，锁定即清空。方案 §4.4：不落盘任何明文索引。
 */
const plainCache = new Map()

/* ───────────────── 额外笔记源（rev173.376 · 改造方案 §4.4） ───────────────── */

/**
 * 把解锁后的索引暴露成宿主的「额外笔记源」：条目以 `.zn/private/notes/<id>.zn` 的
 * **真实路径**出现在文件树里（打开走内核 `openNote`，解密由 `doc.registerCodec` 负责）。
 * 锁定 ⇒ `index = null` ⇒ `list()` 返回空数组 ⇒ 整组从文件树消失。
 */
const SOURCE_ID = 'private-notes'
const SOURCE_GROUP = { key: 'private', label: '私密笔记', icon: '🔒' }
/** 宿主的订阅者（注册表替我们挂在 onSourceChange 上；这里只负责广播） */
const sourceListeners = new Set()

function notifySourceChange() {
  for (const cb of [...sourceListeners]) {
    try {
      cb()
    } catch {
      /* 某个订阅者坏了不影响其它订阅者，也不影响插件主流程 */
    }
  }
}

/** 当前条目（同步返回）—— 只读内存索引，不读盘、不解密 */
function sourceNotes() {
  if (!index) return []
  return index.notes.map((n) => ({
    path: notePath(n.id),
    id: `private:${n.id}`,
    title: n.title || '未命名',
    mtime: n.updatedAt || n.createdAt || 0,
    size: 0,
    frontmatter: {},
    kind: 'note',
    group: SOURCE_GROUP.key,
    groupLabel: SOURCE_GROUP.label,
    groupIcon: SOURCE_GROUP.icon,
  }))
}

/**
 * 源的搜索入口（rev173.394 · 改造方案第二批）：**明文只在插件内存里** ——
 * 不 upsert 进内核索引，因为内核默认分区是**所有插件都能 query** 的共享空间
 * （私密明文进去 = 任何插件 / AI 都能搜到，违背需求 §3.3）。
 * 宿主（`SearchPanel`）把这里的命中单独成组，排在公开结果之后。
 *
 * 锁定 ⇒ `index = null` ⇒ 返回空数组（明文缓存也已随锁清空）。
 */
async function sourceSearch(api, q, opts) {
  const query = String(q ?? '').trim()
  if (!query || !index) return []
  const limit = Math.max(1, Math.min(200, Number(opts?.limit) || 50))
  // 首次搜索要把正文解密一遍（之后走 plainCache）；单篇坏了按空处理
  await fillPlainCache(api)
  return searchNotes(index.notes, plainCache, query)
    .slice(0, limit)
    .map((r) => ({
      // 真实路径：宿主的 `onOpenNote` / codec 链路都按这个走
      path: notePath(r.id),
      title: r.title,
      excerpt: r.excerpt,
      // 面板不混排打分，这个值只用于显示占位
      score: 0,
    }))
}

/** 源条目路径 → 笔记 id（rev173.398：`sourceReadText` / `sourceRename` 共用一份解析） */
function idOfNotePath(path) {
  const prefix = `${NOTES_DIR}/`
  const p = String(path ?? '')
  const name = p.startsWith(prefix) ? p.slice(prefix.length) : ''
  return name.endsWith('.zn') ? name.slice(0, -3) : ''
}

/**
 * 源条目正文（rev173.394 第二批）—— 时间流卡片的摘要走这里，否则宿主读密文只会得到乱码。
 * 明文复用搜索用的 `plainCache`（锁定即清空，不落盘任何索引）。
 */
async function sourceReadText(api, path) {
  if (!index) throw new Error('私密笔记已锁定')
  const id = idOfNotePath(path)
  if (!id) throw new Error('不是私密笔记的路径')
  const cached = plainCache.get(id)
  if (cached !== undefined) return cached
  const text = await readPlain(api, id)
  plainCache.set(id, text)
  return text
}

/**
 * 源条目改名（rev173.398 · 文件树右键）：改的是索引里的**显示标题**，密文文件名保持随机 id。
 * 打上 `titleEdited` ⇒ 之后保存正文不会用正文首行覆盖它。
 */
async function sourceRename(api, path, title) {
  if (!index) throw new Error('私密笔记已锁定')
  const id = idOfNotePath(path)
  const note = id ? findNote(index, id) : null
  if (!note) throw new Error('没有这篇私密笔记')
  const t = String(title ?? '').trim().slice(0, 120)
  if (!t) throw new Error('标题不能为空')
  index = upsertNote(index, { ...note, title: t, titleEdited: true })
  await saveIndex(api)
}

/**
 * 源条目删除（rev173.402 · 文件树菜单「删除」/ Delete 键）→ **私密回收站**。
 * 与面板里的删除共用 `trashNote`：密文搬进 `.zn/private/trash/`，可恢复、不解密、
 * 不进全局明文回收站（那等于把私密内容当公开文件处理）。
 */
async function sourceRemove(api, path) {
  const id = idOfNotePath(path)
  if (!id) throw new Error('不是私密笔记的路径')
  await trashNote(api, id)
}

/* ───────────────────────── 锁定 ───────────────────────── *//** 关掉当前正在编辑的私密文档（有未保存内容时先落盘 —— 锁前不能丢改动） */
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
  try {
    svc?.lock(RING)
  } catch {
    /* 服务侧没解锁过（例如别的窗口）—— 无所谓，本地引用已经清掉 */
  }
  void closePrivateDoc(api)
  // rev173.405：面板已删 —— 状态提示统一走宿主 toast（空串不弹）
  if (reason === 'idle') api.host.notify('空闲 3 分钟，私密笔记已自动锁定')
  else if (reason === 'service') api.host.notify('密钥环已锁定，私密笔记已隐藏')
  // 锁定 ⇒ 源返回空数组 ⇒ 文件树里的分组立刻消失（rev173.376）
  notifySourceChange()
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

/* ───────────────────────── 生物识别（rev173.350 · 真人测试11 #4）─────────────────────────
 *
 * 用户：「密码库加了指纹解锁，私密笔记没加，这种问题就是我反复指出的，没有举一反三」。
 *
 * 两个插件消费的是**同一个** `crypto` 服务、同一套 `biometric` 扩展，只是密钥环不同
 * （本插件用 `notes` 环）。所以绑定 / 解锁 / 解除的代码与 `secrets` 完全同构，
 * 状态按环独立（`bound(RING)`）。
 *
 * 缓存成同步可读的原因同 `secrets`：面板 render 是同步的（UINode 声明式），
 * 不能在里面 await IPC。
 */
let biometric = { available: false, bound: false }
/**
 * rev173.406：指纹绑定提示只在**本会话**提示一次（面板删了，绑定入口只剩命令面板，
 * 不提示的话普通用户根本发现不了；每次解锁都弹又太吵）。
 */
let bioHintShown = false

/**
 * **同步**读指纹状态（render 里用）。
 *
 * rev173.361：`security` 的 `biometric.available()` / `bound(ring)` 都是内存读（无 IPC），
 * 所以可以每次渲染前同步刷一次 —— 修的是「用户在安全插件面板里绑定了指纹，
 * 回到私密笔记锁屏却还看不到『用指纹解锁』」：缓存只在 `apply` 时读过一次，绑定发生在
 * 之后，没人通知本插件。原来无绑定入口时用户只能主密码解锁，等于功能没生效。
 */
function syncBiometricNow() {
  try {
    const b = svc?.biometric
    biometric = b
      ? { available: Boolean(b.available()), bound: Boolean(b.bound(RING)) }
      : { available: false, bound: false }
  } catch {
    biometric = { available: false, bound: false }
  }
  return biometric
}

/** 从 crypto 服务读指纹状态（服务没有 biometric 扩展 = 老版安全插件 ⇒ 都是 false） */
async function refreshBiometric() {
  return syncBiometricNow()
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
  // 索引变了 ⇒ 文件树里的条目（标题 / 增删）跟着变
  notifySourceChange()
}

/**
 * 检查 notes 环建了没有（rev173.335：新拆分文件优先，旧单文件兜底；缺失 / 坏 JSON 都按"没建"处理）
 */
async function checkRingReady(api) {
  try {
    const text = await api.fs.readText(securityVaultFileOf(RING))
    ringReady = hasNotesRingPart(text)
    if (ringReady) return
  } catch {
    // 没有拆分文件是正常态（还没建过 / 还没迁移）—— 继续看旧单文件
  }
  try {
    ringReady = hasNotesRing(await api.fs.readText(SECURITY_VAULT))
  } catch {
    ringReady = false
  }
}

/* ───────────────────────── 解锁 ───────────────────────── */

/** 解锁成功后的收尾（主密码 / 指纹两条路都走它） */
async function afterUnlock(api) {
  index = await loadIndex(api)
  plainCache.clear()
  lastActive = nowMs()
  await refreshBiometric()
  api.host.notify(`私密笔记已解锁 · ${index.notes.length} 篇`, 'info')
  // rev173.406：未绑定指纹时提示一次 —— 面板删掉后绑定入口只剩命令面板
  if (!bioHintShown && biometric.available && !biometric.bound) {
    bioHintShown = true
    api.host.notify('提示：命令面板可执行「私密文件夹：绑定本机指纹」，之后点锁即可刷指纹解锁', 'info')
  }
  // 解锁 ⇒ 文件树里出现「🔒 私密笔记」分组（rev173.376）
  notifySourceChange()
}

async function unlockAndLoad(api, password) {
  const s = needSvc()
  adoptRing() // rev173.416：解锁前跟上最新的环分配（用户可能刚在安全面板改过）
  const pw = String(password ?? '')
  if (!pw) throw new Error('请输入主密码')
  await s.unlock(RING, pw)
  await afterUnlock(api)
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
async function moveCurrentIntoPrivate(api, path) {
  if (!index) throw new Error('先解锁私密文件夹')
  /**
   * rev173.400：支持**按路径**移入（文件树拖拽），不再只认「当前打开的笔记」。
   * 不传 path 时行为不变（面板按钮 / 命令面板仍用当前笔记）。
   */
  const target = String(path ?? '').trim()
  const active = api.doc.active?.() ?? null
  const sourcePath = target || active?.path || ''
  if (!sourcePath) throw new Error('先打开一篇公开笔记')
  if (sourcePath.startsWith('.zn/')) throw new Error('这篇已经在私有目录里了（只有普通笔记能移入）')
  // 只有「移入的正是当前打开那篇」才需要先落盘未保存内容
  if (active && active.path === sourcePath && active.dirty) await api.doc.save(sourcePath)
  const plain = await api.fs.readText(sourcePath)
  const id = newNoteId()
  const at = nowMs()
  await writePlain(api, id, plain)
  index = upsertNote(index, { id, title: titleFromText(plain), createdAt: at, updatedAt: at })
  await saveIndex(api)
  const originalPath = sourcePath
  // 打开的正是这篇才关标签；否则关掉的是别的笔记（会丢用户正在看的那篇）
  if (active && active.path === originalPath) await api.doc.close()
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
async function moveOutToPublic(api, id, dir = '') {
  if (!index) throw new Error('先解锁私密文件夹')
  const note = findNote(index, id)
  if (!note) throw new Error('没有这篇私密笔记')
  const plain = await readPlain(api, id)
  const taken = (await api.fs.listNotes()).map((n) => n.path)
  // rev173.400：拖到某个目录就落那个目录（`''` = 库根，与面板按钮行为一致）
  const target = publicTargetPath(note.title || titleFromText(plain), taken, dir)
  await api.fs.writeText(target, plain)
  await api.fs.purgePrivate(notePath(id)).catch(() => {})
  plainCache.delete(id)
  index = removeNote(index, id)
  await saveIndex(api)
  return target
}

/* ───────────────────────── 命令实现 ───────────────────────── */

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
    // rev173.397：手动改过标题（`titleEdited`）就保留，否则按正文首行回填
    title: existing.titleEdited ? existing.title : titleFromText(d.content, '未命名'),
    updatedAt: nowMs(),
  })
  touch()
  try {
    await saveIndex(api)
  } catch (e) {
    api.host.notify(`私密笔记索引更新失败：${String(e?.message ?? e)}`, 'warn')
  }
}

/* ───────────────────────── 插件入口 ───────────────────────── */

/**
 * rev173.416：向 security 声明「我需要一个密钥环」，并跟上它分配给我的那个环。
 * 拿不到服务 / 安全插件版本旧 ⇒ 保持默认 `notes`，行为与之前一致。
 */
function adoptRing() {
  try {
    const got = svc?.demand?.()
    if (typeof got === 'string' && got) RING = got
  } catch {
    /* 没装安全插件 / 版本旧：保持默认，等 service:available 再来 */
  }
}

export default {
  async apply(api) {
    /* ① 拿 crypto 服务（软依赖：拿不到就降级，不阻塞加载） */
    svc = await api.service.consume('crypto')
    adoptRing()
    api.subscriptions.push(
      api.event.on('service:available', (payload) => {
        const name = payload && typeof payload === 'object' ? payload.name : null
        if (name !== 'crypto' || svc) return
        void api.service.consume('crypto').then(async (got) => {
          if (!got) return
          svc = got
          adoptRing()
          await checkRingReady(api)
          // rev173.361：服务晚到 ⇒ 指纹状态也要重读（否则锁屏一直按「没绑定」渲染）
          await refreshBiometric()
        })
      }),
    )
    await checkRingReady(api)
    // 指纹状态：面板 render 是同步的，先读一次让锁屏一打开就能显示「用指纹解锁」（rev173.350）
    await refreshBiometric()

    /* ② 内容转换器（rev173.180）—— 打开时解密、保存时加密，编辑器因此照常可用 */
    api.subscriptions.push(
      api.doc.registerCodec({
        id: 'private-notes:content',
        match: (p) => p.startsWith(`${NOTES_DIR}/`),
        // 内容敏感：会话恢复草稿落在 localStorage 里是明文，私密笔记一律不写
        transient: true,
        decode: async (raw) => {
          if (!svc) throw new Error('私密文件夹还没连上加密服务')
          if (!index) throw new Error('私密文件夹已锁定 —— 先解锁私密笔记')
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

    /* ②.5 额外笔记源（rev173.376 · 改造方案 §4.4）—— 文件树里的「🔒 私密笔记」分组。
       老内核没有 api.notes ⇒ 跳过（插件在旧版应用上仍能用独立面板，不崩）。 */
    if (api.notes && typeof api.notes.registerSource === 'function') {
      api.subscriptions.push(
        api.notes.registerSource({
          id: SOURCE_ID,
          group: SOURCE_GROUP,
          // rev173.401：解锁后**即使 0 篇也要显示分组**（空组是拖入的落点）；锁定即消失
          groupVisible: () => Boolean(index),
          list: sourceNotes,
          // 第二批：源自己搜（明文不进内核索引，见 sourceSearch 注释）
          search: (q, opts) => sourceSearch(api, q, opts),
          // 第二批：时间流摘要要解密后的正文（见 sourceReadText 注释）
          readText: (path) => sourceReadText(api, path),
          // rev173.398：文件树右键改名（改显示标题，文件名不变）
          rename: (path, title) => sourceRename(api, path, title),
          // rev173.402：文件树菜单「删除」/ Delete 键 → 私密回收站（可恢复）
          remove: (path) => sourceRemove(api, path),
          onSourceChange(cb) {
            sourceListeners.add(cb)
            return {
              dispose: () => {
                sourceListeners.delete(cb)
              },
            }
          },
        }),
      )
    }

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

    /**
     * 状态提示统一走宿主 toast（rev173.405：独立面板已删，不再有面板内的 message 区）。
     * tone 语义保持旧面板的三档：danger ⇒ error，warn ⇒ warn，其余 ⇒ info。
     */
    const say = (text, tone = 'muted') => {
      if (!text) return
      api.host.notify(text, tone === 'danger' ? 'error' : tone === 'warn' ? 'warn' : 'info')
    }

    /* ⑦ 命令 */
    const commands = [
      {
        id: 'private.open',
        title: '私密文件夹：解锁 / 锁定',
        run: async () => {
          /**
           * rev173.405：**独立面板已删**（改造方案 §4.4 最后一项）。
           * · 已解锁 ⇒ 立即锁定（文件树里的「🔒 私密笔记」分组随之消失）；
           * · 未解锁 ⇒ 用内核 `host.prompt` 弹输入对话框收主密码（用户拍板「点解锁弹输入弹窗」）。
           * 面板承担的解锁 UI / 列表视图 / 回收站都不在了：回收站改由宿主回收站页的
           * 「私密」切换承载（`App.tsx` 的 trashScope），列表由文件树承载。
           */
          if (index) {
            lockNow(api, 'manual')
            return
          }
          if (busy) return
          if (!svc) {
            api.host.notify('还没连上加密服务 —— 先装「安全」插件', 'warn')
            return
          }
          await checkRingReady(api)
          if (!ringReady) {
            api.host.notify('「私密笔记」密钥环还没建立 —— 先去安全插件建一个', 'warn')
            return
          }
          /**
           * rev173.406：**指纹解锁**（原来在面板锁屏上的「用指纹解锁」按钮，面板删掉不能连功能一起丢）。
           * 已绑定 ⇒ 先弹系统指纹；成功即解锁；取消 / 失败则**回落到主密码输入框**（不阻断）。
           */
          const bio = syncBiometricNow()
          /**
           * rev173.407：**老应用兼容**。`host.prompt` 是内核 rev173.405 才有的能力 ——
           * release 机装 0.10.0 + 本插件 0.3.4 时它是 `undefined`，直接调会抛 TypeError，
           * 用户看到的是「点锁没反应 / 报错」。这条兜底把原因说出来，并指向正确的修法。
           * 放在指纹分支**之后**：指纹不需要 prompt，老应用上已绑定指纹的仍能解锁。
           */
          const canPrompt = typeof api.host.prompt === 'function'
          if (bio.available && bio.bound && svc.biometric) {
            try {
              await svc.biometric.unlock(RING)
              busy = 'unlock'
              try {
                await afterUnlock(api)
              } finally {
                busy = ''
              }
              return
            } catch (e) {
              const msg = String(e?.message ?? e)
              if (!/cancel|取消/i.test(msg)) {
                api.host.notify(`指纹解锁失败：${msg}，请输主密码`, 'warn')
              }
            }
          }
          if (!canPrompt) {
            api.host.notify('当前应用版本过旧：私密笔记需要「输入弹窗」能力 —— 请把 ZeroNote 更新到最新版', 'error')
            return
          }
          const pw = await api.host.prompt({
            title: '解锁私密笔记',
            message: bio.available && bio.bound ? '指纹已取消 —— 也可以输入主密码' : '输入「私密笔记」密钥环的主密码',
            placeholder: '主密码',
            secret: true,
            okText: '解锁',
          })
          if (pw === null) return // 用户取消：什么都不做（不当作"密码为空"）
          busy = 'unlock'
          try {
            await unlockAndLoad(api, pw)
          } catch (e) {
            const msg = String(e?.message ?? e)
            api.host.notify(
              /invalid tag|tag mismatch|bad tag/i.test(msg) ? '主密码不对' : `解锁失败：${msg}`,
              'error',
            )
          } finally {
            busy = ''
          }
        },
      },
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
      { id: 'private.lock', title: '私密文件夹：立即锁定', run: () => lockNow(api, 'manual') },
      {
        id: 'private.biometric-unlock',
        title: '私密文件夹：用指纹解锁',
        run: async () => {
          if (busy) return
          if (!svc?.biometric) {
            say('当前安全插件版本不支持指纹解锁', 'warn')
            return
          }
          busy = 'unlock'
          say('等待指纹验证…', 'muted')
          try {
            // DEK 不出 security：这里只拿"解锁成功"，环内的密钥由服务自己管
            await svc.biometric.unlock(RING)
            await afterUnlock(api)
          } catch (e) {
            const msg = String(e?.message ?? e)
            say(/cancel|取消/i.test(msg) ? '已取消指纹验证' : `指纹解锁失败：${msg}`, 'danger')
          } finally {
            busy = ''
          }
        },
      },
      {
        id: 'private.biometric-bind',
        title: '私密文件夹：绑定本机指纹',
        run: async () => {
          if (!index) {
            say('先解锁，再绑定指纹', 'warn')
            return
          }
          if (!svc?.biometric) {
            say('当前安全插件版本不支持指纹绑定', 'warn')
            return
          }
          try {
            await svc.biometric.bind(RING)
            await refreshBiometric()
            say(
              biometric.bound ? '已绑定这台设备 —— 之后解锁可直接用指纹' : '绑定失败：没有写进密钥环',
              biometric.bound ? 'success' : 'danger',
            )
          } catch (e) {
            say(`绑定指纹失败：${String(e?.message ?? e)}`, 'danger')
          }
        },
      },
      {
        id: 'private.biometric-unbind',
        title: '私密文件夹：解除本机指纹',
        run: async () => {
          if (!svc?.biometric) {
            say('当前安全插件版本不支持指纹', 'warn')
            return
          }
          try {
            await svc.biometric.unbind(RING)
            await refreshBiometric()
            say('已解除这台设备的指纹绑定（主密码不受影响）', 'success')
          } catch (e) {
            say(`解除指纹失败：${String(e?.message ?? e)}`, 'danger')
          }
        },
      },
      {
        id: 'private.new',
        title: '私密文件夹：新建私密笔记',
        run: async () => {
          if (!index) {
            api.host.notify('先解锁私密笔记', 'warn')
            return
          }
          try {
            const id = await createNote(api)
            say('已新建（空笔记，写完自动加密保存）', 'success')
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
            api.host.notify('先解锁私密笔记', 'warn')
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
      /* ── rev173.397：改显示标题（面板内输入，不动密文文件名） ── */
      /* ── 期 2：回收站 ── */
      {
        id: 'private.trash',
        title: '私密文件夹：删除一篇（进私密回收站）',
        run: async (payload) => {
          if (!index) return
          /** rev173.402：多一个 `{ path }`（文件树菜单 / Delete 键用），与 move-out 同一口径 */
          const id = payload?.path ? idOfNotePath(payload.path) : String(payload?.id ?? '')
          if (!id) {
            say('删除失败：这不是私密笔记的路径', 'danger')
            return
          }
          try {
            await trashNote(api, id)
            say('已移入私密回收站（可恢复）', 'muted')
          } catch (e) {
            say(`删除失败：${String(e?.message ?? e)}`, 'danger')
          }
        },
      },
      {
        id: 'private.restore',
        title: '私密文件夹：恢复一篇',
        run: async (payload) => {
          if (!index) return
          /** rev173.402：撤销条传的是 `{ path }`（与被删条目同一路径） */
          const id = payload?.path ? idOfNotePath(payload.path) : String(payload?.id ?? '')
          if (!id) {
            say('恢复失败：这不是私密笔记的路径', 'danger')
            return
          }
          try {
            await restoreNote(api, id)
            say('已恢复到私密列表', 'success')
          } catch (e) {
            say(`恢复失败：${String(e?.message ?? e)}`, 'danger')
          }
        },
      },
      {
        /**
         * 私密回收站清单（rev173.405）—— 宿主回收站页「私密」范围的数据源。
         * 只给**明文标题 + 删除时间**（与文件树 / 时间流同一口径，不暴露密文路径）。
         * 未解锁 ⇒ 空数组（宿主那边切换按钮此时也不显示）。
         */
        id: 'private.trash-data',
        title: '私密文件夹：回收站清单',
        run: () => {
          if (!index) return { items: [] }
          return {
            items: sortTrash(index.trash ?? []).map((t) => ({
              id: t.id,
              title: t.title || '未命名',
              deletedAt: t.deletedAt,
            })),
          }
        },
      },
      {
        id: 'private.purge',
        title: '私密文件夹：彻底删除（不可恢复）',
        run: async (payload) => {
          if (!index) return
          const id = String(payload?.id ?? '')
          if (!id) return
          /**
           * rev173.405：面板删了，「上膛」状态没有归宿 —— 二次确认由宿主回收站页做
           * （`AppTrashView` 的按钮要点两次才调 onPurge）。插件这里只负责真删。
           */
          try {
            await purgeNote(api, id)
            say('已彻底删除', 'muted')
          } catch (e) {
            say(`彻底删除失败：${String(e?.message ?? e)}`, 'danger')
          }
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
            say(`清空失败：${String(e?.message ?? e)}`, 'danger')
            return -1
          })
          if (cleared >= 0) say(`已清空回收站（${cleared} 篇）`, 'muted')
        },
      },
      /* ── 期 2：移入 / 移出 ── */
      {
        id: 'private.move-in',
        title: '私密文件夹：把当前笔记移入私密',
        run: async (payload) => {
          /** rev173.400：多一个 `{ path }`（文件树拖拽用）与 `{ silent }`（拖拽后别抢焦点） */
          const silent = payload?.silent === true
          try {
            const r = await moveCurrentIntoPrivate(api, payload?.path)
            say(`「${r.title}」已移入私密文件夹（原文件已从库中移除）`, 'success')
            if (!silent) {
              await api.command.execute('core.openNote', { path: notePath(r.id) })
            }
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
            api.host.notify('先解锁私密笔记', 'warn')
            return
          }
          /** rev173.400：`{ path, dir, silent }` —— 文件树把条目拖到某个目录时用 */
          const silent = payload?.silent === true
          try {
            const id = payload?.path ? idOfNotePath(payload.path) : String(payload?.id ?? '')
            const target = await moveOutToPublic(api, id, payload?.dir)
            say(`已移出为公开笔记：${target}`, 'success')
            const stillOpen = api.doc.active?.()?.path === notePath(id)
            if (!silent) {
              await api.command.execute('core.openNote', { path: target })
            } else if (stillOpen) {
              // 拖出的正是打开着的那篇：切到新落点，别让编辑器还指着已删掉的密文路径
              await api.command.execute('core.openNote', { path: target })
            }
          } catch (e) {
            say(`移出失败：${String(e?.message ?? e)}`, 'danger')
          }
        },
      },
    ]
    for (const cmd of commands) api.subscriptions.push(api.command.register(cmd))

    api.host.log('info', `[private-notes] 已加载：${index ? '已解锁' : '锁定'} · 密钥环${ringReady ? '已建立' : '未建立'}`)
  },
}
