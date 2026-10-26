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
  return { v: INDEX_VERSION, notes: [] }
}

/**
 * 解析索引明文。
 *
 * ⚠️ 这里做**明文内校验**（方案 §4.1）：索引与正文用同一个容器同一套 AAD，
 * 密文互换是能解开的 —— 所以"解出来是不是索引"必须自己判断，不能只看解密成功。
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
  return { v: INDEX_VERSION, notes }
}

/** 索引 → 明文（写盘前由 crypto 服务加密） */
export function serializeIndex(index) {
  return JSON.stringify({ v: INDEX_VERSION, notes: index.notes.map(stripNote) })
}

function stripNote(n) {
  return { id: n.id, title: n.title ?? '', createdAt: n.createdAt ?? 0, updatedAt: n.updatedAt ?? 0 }
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

/** 索引里插入或更新一篇 */
export function upsertNote(index, note) {
  const notes = index.notes.filter((n) => n.id !== note.id)
  notes.push(stripNote(note))
  return { v: INDEX_VERSION, notes }
}

/** 索引里删掉一篇 */
export function removeNote(index, id) {
  return { v: INDEX_VERSION, notes: index.notes.filter((n) => n.id !== id) }
}

/** 索引里找一篇 */
export function findNote(index, id) {
  return index?.notes?.find((n) => n.id === id) ?? null
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
let index = null // 解锁后才有：{ v, notes }
let ringReady = false // notes 环建了没有
let busy = '' // 正在忙的环节（'unlock' | 'save' | ''）
let message = { text: '', tone: 'muted' }
let lastActive = 0 // 空闲锁定的时间戳（Android 后台会冻结定时器 ⇒ 只信时间）
let ui = {} // 面板 render 快照里的 bind 值

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

/** 确保 `.zn/private/{notes}` 目录在（幂等） */
async function ensureDirs(api) {
  try {
    await api.fs.mkdir(PRIVATE_DIR)
  } catch {
    /* 已存在 */
  }
  try {
    await api.fs.mkdir(NOTES_DIR)
  } catch {
    /* 已存在 */
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

const BINDS = { pw: 'private.pw' }

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
 * 列表视图（期 1：列表 + 新建 + 打开 + 锁定；搜索 / 回收站留期 2 —— 见方案 §5）。
 *
 * 为什么列表只显示标题与时间：正文解密在**打开时**做（每篇一次），列表不解密正文
 * ⇒ 100 篇的库打开面板也不卡。
 */
function listView() {
  const notes = sortNotes(index.notes)
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
        btn('锁定', 'private.lock', { variant: 'ghost' }),
      ],
    },
    textNode('打开即用完整编辑器；保存时自动加密回磁盘。', 'caption', 'muted'),
  ]

  if (!notes.length) {
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
          ],
        },
      })),
    })
  }

  if (message.text) children.push(textNode(message.text, 'caption', message.tone))
  children.push(textNode('文件在 .zn/private/（密文，文件名是随机 id）· 不进全局搜索 / 回收站', 'caption', 'muted'))
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

/** 从保存事件里回填索引（标题变了 / 时间更新）—— 不重新解密正文以外的任何东西 */
async function onDocSaved(api, d) {
  if (!index || !d?.path || !d.path.startsWith(`${NOTES_DIR}/`)) return
  const id = d.path.slice(NOTES_DIR.length + 1).replace(/\.zn$/, '')
  const existing = findNote(index, id)
  if (!existing) return
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
      {
        id: 'private.delete',
        title: '私密文件夹：删除一篇',
        run: async (payload) => {
          if (!index) return
          const id = String(payload?.id ?? '')
          if (!id || !findNote(index, id)) return
          try {
            api.doc.close()
          } catch {
            /* 没打开 */
          }
          // 期 1：真删除（`purge_private` 只认 `.zn/`）。独立回收站留期 2（方案 §5）
          await api.fs.purgePrivate(notePath(id)).catch(() => {})
          index = removeNote(index, id)
          await saveIndex(api)
          setMessage('已删除（期 1 为彻底删除；回收站随后续版本加）', 'muted')
          api.view.refresh(PANEL_ID)
        },
      },
    ]
    for (const cmd of commands) api.subscriptions.push(api.command.register(cmd))

    api.host.log('info', `[private-notes] 已加载：${index ? '已解锁' : '锁定'} · 密钥环${ringReady ? '已建立' : '未建立'}`)
  },
}
