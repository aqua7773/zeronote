/**
 * 安全插件（security）—— 主密码 / 双密钥环 / 加密服务
 *
 * 方案：`docs/安全插件-方案-2026-10-25.md`（2026-10-25 用户拍板：密码库与私密笔记**各一把主密码**）
 *
 * ## 它做什么
 *
 * ```
 * 主密码 ──Argon2id──→ masterKey（只在内存）── 解包 ──→ 容器 DEK ── XChaCha20-Poly1305 ──→ 数据
 * ```
 *
 * - 两把**互不派生**的环：`notes`（私密笔记，3 分钟锁）/ `secrets`（账号密码，60 秒锁）
 * - 磁盘上只有 `vault.json`（KDF 参数 + 被包裹的 DEK），**没有密码、没有密钥**
 * - 对外 `service.provide('crypto')`：消费者只能"请求加解密"，拿不到 DEK（需求 §9.4）
 * - 恢复：安全问题（可选）+ 恢复码（建立时显示一次）；恢复后重设主密码，数据密文不动
 *
 * ## 它不做什么（诚实边界，同方案 §6）
 *
 * - **不是沙箱**：插件与宿主同上下文，恶意插件能读进程内内存（D-001 已裁决无沙箱）
 * - **不保证擦除**：`wipe()` 只能清我们持有的那份，JS 字符串与 GC 副本不可控
 * - **明文要回主线程渲染**：加密保护的是"文件被拿走"，不是"同机代码偷看"
 *
 * ## 密码输入的处置
 *
 * 内核的 `input` 节点没有 password 类型（契约 §2 UINode 只有 `bind`/`placeholder`）。
 * 所以：**输入值只在面板 state 里短暂存在，命令读完立刻 `setState(bind, '')` 清空**，
 * 并在 `finally` 里把本地快照里的那份也清掉。这不是完美方案，但比留在内存里过夜强。
 */
/* ═══════════════ 密码学核心（原 crypto.js，单文件内联 —— 插件 ESM 相对 import 不可用） ═══════════════ */

/**
 * 安全插件 · 密码学核心（纯逻辑：无 UI、无 Tauri、无网络）
 *
 * 单测：`tests/security.test.ts` —— 每个导出都要有反向用例（错密码 / 改一字节 / 跨环）。
 *
 * ## 为什么所有函数都收一个 `libs` 参数
 *
 * 插件是 **Blob 模块**，运行时 `import` 不到 npm 包，只能动态 `import('/vendor/noble/…')`
 * （见 `scripts/vendor-noble.mjs`）。而单测要跑在 Node 里、直接 import 裸包名。
 * ⇒ 把库当参数注入：生产端传 vendor 版本，测试端传 node_modules 版本，**同一份逻辑两份入口**。
 *
 * ## 密钥层级（需求 §9.3 / §9.4）
 *
 * ```
 * 主密码 ──Argon2id(salt, t, m, p)──→ masterKey(32B, 只在内存)
 *                                       │
 *         每个容器 DEK(32B, 随机) ──包裹──→ wrapped 落盘（"zn1.<nonce>.<ct>"）
 *                                       │
 *         数据 ──XChaCha20-Poly1305(DEK, AAD=环|容器|用途)──→ 密文落盘
 * ```
 *
 * - **多密钥环**（2026-10-25 用户拍板）：`notes` 与 `secrets` 各一把主密码、各一个 salt、
 *   各一把 DEK，**互不派生**。A 环的密码算不出 B 环的密钥，A 环的 DEK 解不开 B 环的密文。
 * - 不存 password verifier：解锁 = 用 masterKey 解开包裹，**AEAD 认证通过即密码正确**。
 * - 换密码 = 只重新包裹 DEK，数据密文一个字节都不动。
 * - 恢复 = DEK 被"主密钥"与"恢复密钥"各包一份，所以改密码不会让恢复路径失效。
 */

/** 两环的默认参数（`secrets` 更敏感：窗口更短）—— 需求 §9.2 + 2026-10-25 决策 */
export const DEFAULT_RINGS = {
  notes: { kdf: { t: 3, m: 65536, p: 1 }, idleLockMs: 3 * 60 * 1000 },
  secrets: { kdf: { t: 3, m: 65536, p: 1 }, idleLockMs: 60 * 1000 },
}

/** 密文格式版本 —— 换算法时换前缀，老密文照旧能读 */
export const PAYLOAD_VERSION = 'zn1'
/** 签名格式版本 */
export const SIG_VERSION = 'hs1'

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/* ───────────────────────── 编码 ───────────────────────── */

/** Uint8Array → base64url（无 padding；跨 Node / WebView 稳定，不依赖 btoa） */
export function toB64url(bytes) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64URL[a >> 2]
    out += B64URL[((a & 3) << 4) | ((b ?? 0) >> 4)]
    if (b === undefined) break
    out += B64URL[((b & 15) << 2) | ((c ?? 0) >> 6)]
    if (c === undefined) break
    out += B64URL[c & 63]
  }
  return out
}

/** base64url → Uint8Array；非法字符抛错（不静默给空数组） */
export function fromB64url(text) {
  const s = String(text ?? '').replace(/=+$/, '')
  const at = (ch) => {
    const i = B64URL.indexOf(ch)
    if (i < 0) throw new Error('密文格式不认识：base64url 里有非法字符')
    return i
  }
  const out = []
  for (let i = 0; i < s.length; i += 4) {
    const c0 = at(s[i])
    const c1 = s[i + 1] === undefined ? undefined : at(s[i + 1])
    if (c1 === undefined) throw new Error('密文格式不认识：base64url 长度不对')
    const c2 = s[i + 2] === undefined ? undefined : at(s[i + 2])
    const c3 = s[i + 3] === undefined ? undefined : at(s[i + 3])
    out.push((c0 << 2) | (c1 >> 4))
    if (c2 !== undefined) out.push(((c1 & 15) << 4) | (c2 >> 2))
    if (c3 !== undefined) out.push(((c2 & 3) << 6) | c3)
  }
  return new Uint8Array(out)
}

/* ───────────────────────── 小工具 ───────────────────────── */

const utf8 = new TextEncoder()
const utf8d = new TextDecoder()

/** 字符串 → 字节；已经是字节就原样返回（密文/二进制都走这条路） */
export function toBytes(input) {
  if (input instanceof Uint8Array) return input
  return utf8.encode(String(input ?? ''))
}

/** 字节 → 字符串（只在确认是文本时用） */
export function fromBytes(bytes) {
  return utf8d.decode(bytes)
}

/** 恢复答案的宽松匹配（需求 §8.6：忽略大小写、忽略前后空格） */
export function normalizeAnswer(answer) {
  return String(answer ?? '')
    .trim()
    .toLowerCase()
}

/** 定长比较（不提前 return；签名/恢复码比较用） */
export function equalBytes(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** 尽力清空（JS 无法保证 GC 副本，只能清我们持有的那份） */
export function wipe(bytes) {
  if (bytes instanceof Uint8Array) bytes.fill(0)
  return bytes
}

/* ───────────────────────── 密文封装 ───────────────────────── */

/** 组装 `zn1.<nonce>.<ct>` */
function pack(version, nonce, ct) {
  return `${version}.${toB64url(nonce)}.${toB64url(ct)}`
}

/** 拆 `zn1.<nonce>.<ct>`；版本不符 / 段数不对都抛错（不猜） */
function unpack(version, payload) {
  const parts = String(payload ?? '').split('.')
  if (parts.length !== 3 || parts[0] !== version) {
    throw new Error(`密文格式不认识（期望 ${version}.<nonce>.<ct>）`)
  }
  return { nonce: fromB64url(parts[1]), ct: fromB64url(parts[2]) }
}

/**
 * 加密一段数据（AEAD，带 AAD）。
 *
 * `aad` 把密文**绑定到用途**：把 A 容器的密文贴到 B 容器下面会解密失败，
 * 把包裹的 DEK 当数据密文用也会失败 —— 不是靠"我们保证不混用"，是靠密码学。
 */
export function seal(libs, key, aad, plaintext) {
  const nonce = libs.randomBytes(24)
  const ct = libs.xchacha20poly1305(key, nonce, utf8.encode(aad)).encrypt(toBytes(plaintext))
  return pack(PAYLOAD_VERSION, nonce, ct)
}

/** 解密；AEAD 认证失败会抛错（改一个字节、AAD 不符、密钥不对都抛） */
export function open(libs, key, aad, payload) {
  const { nonce, ct } = unpack(PAYLOAD_VERSION, payload)
  return libs.xchacha20poly1305(key, nonce, utf8.encode(aad)).decrypt(ct)
}

/* ───────────────────────── KDF ───────────────────────── */

/**
 * 主密码 → 32 字节密钥。**同步**（Argon2 在 JS 里没有异步版）。
 *
 * 调用方（UI）必须先渲染"正在派生密钥…"再调 —— 桌面约 1 s、手机 2–4 s，
 * 同步阻塞时界面是冻住的（见方案 §3）。
 */
export function deriveKey(libs, password, saltB64, kdf) {
  if (kdf?.algo && kdf.algo !== 'argon2id') {
    // 不认识的 KDF 必须报错：静默按 argon2id 算会得出一把"解不开但看起来正常"的密钥
    throw new Error(`不认识的密钥派生算法：${kdf.algo}`)
  }
  const salt = fromB64url(saltB64)
  const m = Math.max(8, Math.floor(kdf?.m ?? 65536))
  return libs.argon2id(utf8.encode(String(password ?? '')), salt, {
    t: Math.max(1, Math.floor(kdf?.t ?? 3)),
    m,
    p: Math.max(1, Math.floor(kdf?.p ?? 1)),
    dkLen: 32,
    // maxmem 是字节：Argon2 需要 m KiB 的块 + 少量开销，留 2 倍余量
    maxmem: m * 1024 * 2,
  })
}

/** 生成新 salt（16B） */
export function newSalt(libs) {
  return toB64url(libs.randomBytes(16))
}

/* ───────────────────────── 密钥环 ───────────────────────── */

/** 解析容器的 AAD（环 + 容器 + 用途） */
const aadOf = (ringId, containerId) => `${ringId}|${containerId}|data`
/** 包裹 DEK 用的 AAD：与数据密文分域，防止把包裹块当数据密文用 */
const wrapAad = (ringId) => `${ringId}|dek`

/** 用主密钥包裹一把 DEK */
export function wrapDek(libs, masterKey, ringId, dek) {
  return seal(libs, masterKey, wrapAad(ringId), dek)
}

/** 用主密钥解开 DEK（密码不对 ⇒ AEAD 抛错） */
export function unwrapDek(libs, masterKey, ringId, wrapped) {
  return open(libs, masterKey, wrapAad(ringId), wrapped)
}

/**
 * 首次建立一把密钥环：生成 salt + 随机 DEK，并把 DEK 用主密钥包裹。
 *
 * 返回 `{ ring, dek }` —— `dek` 只在内存里用（调用方用完自己 `wipe`）。
 */
export function createRing(libs, ringId, password, opts = {}) {
  if (!ringId) throw new Error('密钥环必须有 id')
  if (!String(password ?? '')) throw new Error('主密码不能为空')
  const preset = DEFAULT_RINGS[ringId] ?? {}
  // `algo` 放最后：它是本实现的事实（派生逻辑只实现了 argon2id），不允许被调用方改成别的
  const kdf = { ...preset.kdf, ...(opts.kdf ?? {}), algo: 'argon2id' }
  const salt = newSalt(libs)
  const masterKey = deriveKey(libs, password, salt, kdf)
  const dek = libs.randomBytes(32)
  const ring = {
    id: ringId,
    kdf: { ...kdf, salt },
    idleLockMs: opts.idleLockMs ?? preset.idleLockMs ?? 3 * 60 * 1000,
    wrapped: { [opts.containerId ?? ringId]: wrapDek(libs, masterKey, ringId, dek) },
  }
  wipe(masterKey)
  return { ring, dek }
}

/**
 * 解锁一把环：主密码 → masterKey → 解开某个容器的 DEK。
 *
 * 密码错 ⇒ `unwrapDek` 抛错（不返回"密码错误"以外的信息）。
 */
export function unlockRing(libs, ring, password, containerId) {
  const container = containerId ?? ring?.id
  const wrapped = ring?.wrapped?.[container]
  if (!wrapped) throw new Error(`这个密钥环里没有容器「${container}」`)
  const masterKey = deriveKey(libs, password, ring.kdf.salt, ring.kdf)
  try {
    return { dek: unwrapDek(libs, masterKey, ring.id, wrapped), containerId: container }
  } finally {
    wipe(masterKey)
  }
}

/**
 * 换主密码：用旧密码解出 DEK，用新密码重新包裹。
 * **数据密文完全不动** —— 这正是需求 §9.3「只重置主密码，数据仍可解」的做法。
 */
export function changePassword(libs, ring, oldPassword, newPassword) {
  if (!String(newPassword ?? '')) throw new Error('新主密码不能为空')
  const { dek } = unlockRing(libs, ring, oldPassword)
  try {
    const salt = newSalt(libs)
    const masterKey = deriveKey(libs, newPassword, salt, ring.kdf)
    const wrapped = { ...ring.wrapped }
    for (const containerId of Object.keys(wrapped)) {
      wrapped[containerId] = wrapDek(libs, masterKey, ring.id, dek)
    }
    wipe(masterKey)
    return { ...ring, kdf: { ...ring.kdf, salt }, wrapped }
  } finally {
    wipe(dek)
  }
}

/* ───────────────────────── 恢复（双路径） ───────────────────────── */

const answerAad = (ringId) => `${ringId}|recovery|answer`
const codeAad = (ringId) => `${ringId}|recovery|code`

/** 恢复码字符集：去掉 0/O/1/I（与密码生成器同一套易混淆规则） */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** 生成 24 字符恢复码（5 bit/字符 ≈ 120 bit 熵），按 4 段显示便于抄写 */
export function generateRecoveryCode(libs) {
  const raw = libs.randomBytes(24)
  let out = ''
  for (let i = 0; i < raw.length; i++) out += CODE_ALPHABET[raw[i] % CODE_ALPHABET.length]
  return out.replace(/(.{4})(?=.)/g, '$1-')
}

/** 恢复码归一化：去分隔符、转大写（用户抄写时容易漏横杠/小写） */
export function normalizeCode(code) {
  return String(code ?? '')
    .replace(/[\s-]/g, '')
    .toUpperCase()
}

/**
 * 给环加上两条恢复路径（安全问题 + 恢复码），各自独立 salt。
 *
 * DEK 被"恢复密钥"再包一份 ⇒ 用户忘记主密码时，答对问题（或输对恢复码）
 * 就能解出 DEK，然后换一套新主密码；数据密文一个字节都不动。
 */
export function setupRecovery(libs, ring, dek, { question, answer, code } = {}) {
  const q = String(question ?? '').trim()
  const a = normalizeAnswer(answer)
  const c = normalizeCode(code)
  const hasAnswer = Boolean(q) && a.length >= 2
  // 至少要有一条能走的路：只设问题不设答案 = 一定恢复不了，必须当场报错
  if (!hasAnswer && c.length < 16) {
    throw new Error('恢复设置不完整：要么「问题 + 答案」两个都填，要么给一个恢复码')
  }
  if (c && c.length < 16) throw new Error('恢复码格式不对')

  const recovery = { question: q }

  if (hasAnswer) {
    const answerSalt = newSalt(libs)
    const answerKey = deriveKey(libs, a, answerSalt, ring.kdf)
    recovery.answerSalt = answerSalt
    recovery.answerWrap = seal(libs, answerKey, answerAad(ring.id), dek)
    wipe(answerKey)
  }
  if (c) {
    const codeSalt = newSalt(libs)
    const codeKey = deriveKey(libs, c, codeSalt, ring.kdf)
    recovery.codeSalt = codeSalt
    recovery.codeWrap = seal(libs, codeKey, codeAad(ring.id), dek)
    wipe(codeKey)
  }
  return { ...ring, recovery }
}

/** 用安全问题的答案解出 DEK */
export function recoverWithAnswer(libs, ring, answer) {
  const r = ring?.recovery
  if (!r?.answerWrap) throw new Error('这个密钥环没有设置恢复问题')
  const key = deriveKey(libs, normalizeAnswer(answer), r.answerSalt, ring.kdf)
  try {
    return open(libs, key, answerAad(ring.id), r.answerWrap)
  } finally {
    wipe(key)
  }
}

/** 用恢复码解出 DEK */
export function recoverWithCode(libs, ring, code) {
  const r = ring?.recovery
  if (!r?.codeWrap) throw new Error('这个密钥环没有设置恢复码')
  const key = deriveKey(libs, normalizeCode(code), r.codeSalt, ring.kdf)
  try {
    return open(libs, key, codeAad(ring.id), r.codeWrap)
  } finally {
    wipe(key)
  }
}

/**
 * 恢复之后重设主密码：**不需要旧密码**（旧密码已经忘了），
 * 但要先解出 DEK（= 证明恢复路径正确）。
 */
export function resetPasswordWithDek(libs, ring, dek, newPassword) {
  if (!String(newPassword ?? '')) throw new Error('新主密码不能为空')
  const salt = newSalt(libs)
  const masterKey = deriveKey(libs, newPassword, salt, ring.kdf)
  const wrapped = {}
  for (const containerId of Object.keys(ring.wrapped)) {
    wrapped[containerId] = wrapDek(libs, masterKey, ring.id, dek)
  }
  wipe(masterKey)
  return { ...ring, kdf: { ...ring.kdf, salt }, wrapped }
}

/* ───────────────────────── 数据加解密 ───────────────────────── */

/** DEK + 容器 → 数据密文 */
export function encryptData(libs, dek, ringId, containerId, plaintext) {
  return seal(libs, dek, aadOf(ringId, containerId), plaintext)
}

/** 数据密文 → 明文 */
export function decryptData(libs, dek, ringId, containerId, payload) {
  return open(libs, dek, aadOf(ringId, containerId), payload)
}

/* ───────────────────────── 签名（需求 §9.4 crypto.sign / verify） ───────────────────────── */

/** 从 DEK 派生子密钥（HKDF，分域：加密与签名永不共用同一把） */
export function subKey(libs, dek, ringId, purpose) {
  return libs.hkdf(libs.sha256, dek, utf8.encode(`${ringId}|hkdf`), utf8.encode(purpose), 32)
}

/** 签名：`hs1.<b64url>` */
export function signData(libs, dek, ringId, containerId, data) {
  const key = subKey(libs, dek, ringId, `sign|${containerId}`)
  try {
    const mac = libs.hmac(libs.sha256, key, toBytes(data))
    return `${SIG_VERSION}.${toB64url(mac)}`
  } finally {
    wipe(key)
  }
}

/** 验签：任何形状不对都返回 false（不抛错，调用方按 false 处理即可） */
export function verifyData(libs, dek, ringId, containerId, data, sig) {
  if (typeof sig !== 'string' || !sig.startsWith(`${SIG_VERSION}.`)) return false
  let given
  try {
    given = fromB64url(sig.slice(SIG_VERSION.length + 1))
  } catch {
    return false
  }
  const key = subKey(libs, dek, ringId, `sign|${containerId}`)
  try {
    return equalBytes(libs.hmac(libs.sha256, key, toBytes(data)), given)
  } finally {
    wipe(key)
  }
}

/* ───────────────────────── vault 文件 ───────────────────────── */

/** `vault.json` 的空骨架 —— 只存 KDF 参数与密文，**没有任何密钥** */
export function createVault() {
  return { v: 1, rings: {} }
}

/** 取一把环；没有返回 null（不抛，UI 据此走"首次设置"） */
export function getRing(vault, ringId) {
  return vault?.rings?.[ringId] ?? null
}

/** 写回一把环（纯函数：返回新 vault，不改入参） */
export function putRing(vault, ring) {
  return { ...(vault ?? createVault()), v: 1, rings: { ...(vault?.rings ?? {}), [ring.id]: ring } }
}

/** 删除一把环（纯函数） */
export function dropRing(vault, ringId) {
  const rings = { ...(vault?.rings ?? {}) }
  delete rings[ringId]
  return { ...(vault ?? createVault()), rings }
}


const PANEL_ID = 'security.panel'
const STATUS_ID = 'security.status'
const VAULT_FILE = '.zn/security/vault.json'
const RING_IDS = ['notes', 'secrets']
const RING_LABEL = { notes: '私密笔记', secrets: '账号密码' }
const RING_HINT = {
  notes: '私密笔记用这把密码。与账号密码分开 —— 这把泄露不影响密码库。',
  secrets: '账号密码库用这把密码。与私密笔记分开，60 秒无操作自动锁。',
}
/** 空闲检查间隔（不是锁定时间；锁定时间按环的 idleLockMs 判） */
const IDLE_CHECK_MS = 3000

/** 面板 bind 名 */
const B = {
  pw1: 'security.pw1',
  pw2: 'security.pw2',
  oldPw: 'security.oldPw',
  newPw: 'security.newPw',
  question: 'security.question',
  answer: 'security.answer',
  code: 'security.code',
}

/* ───────────────────────── vendor（本地副本） ───────────────────────── */

/** 插件是 Blob 模块 ⇒ 只能用绝对 URL 动态 import（与 import-export 同一做法） */
const vendorUrl = (p) => new URL(`/vendor/noble/${p}`, location.origin).href

let libsPromise = null

/**
 * 懒加载密码学库：`scripts/vendor-noble.mjs` 生成的本地副本。
 * 失败不缓存（下次可重试），且错误原样抛出 —— 静默降级会让"加密"变成明文。
 */
function loadLibs() {
  libsPromise ??= Promise.all([
    import(vendorUrl('ciphers/chacha.js')),
    import(vendorUrl('ciphers/utils.js')),
    import(vendorUrl('hashes/argon2.js')),
    import(vendorUrl('hashes/sha2.js')),
    import(vendorUrl('hashes/hmac.js')),
    import(vendorUrl('hashes/hkdf.js')),
  ])
    .then(([chacha, ciphersUtils, argon2Mod, sha2, hmacMod, hkdfMod]) => ({
      xchacha20poly1305: chacha.xchacha20poly1305,
      randomBytes: ciphersUtils.randomBytes,
      argon2id: argon2Mod.argon2id,
      sha256: sha2.sha256,
      hmac: hmacMod.hmac,
      hkdf: hkdfMod.hkdf,
    }))
    .catch((e) => {
      libsPromise = null
      throw new Error(`密码学库加载失败（public/vendor/noble 是否随包？）：${String(e)}`)
    })
  return libsPromise
}

/* ───────────────────────── 插件内部状态 ───────────────────────── */

const store = {
  vault: createVault(),
  loaded: false,
  /** 当前选中的环（默认密码库：更敏感，先看见它） */
  selected: 'secrets',
  /** 正在做 KDF 的环（UI 显示"正在派生…"） */
  busy: '',
  message: '',
  tone: 'info',
  /** 建立环时生成的恢复码：**只显示这一次** */
  recoveryCodeShown: '',
  /** vault 文件坏了：不回退、不覆盖（见 loadVault） */
  corrupt: false,
}

/** 已解锁的环：ringId → { dek, lastActive }。DEK 只在这里和 crypto.js 之间流动 */
const live = new Map()
/** 恢复验证通过、等待重设主密码的 DEK：ringId → dek */
const recovered = new Map()
/** 最近一次 render 的面板 state 快照（命令里读输入值靠它；ViewApi 没有 getState） */
let ui = {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function setStatus(api, message, tone = 'info') {
  store.message = message
  store.tone = tone
  api.view.refresh(PANEL_ID)
}

/** 清掉输入框（内核侧的 bind 值 + 本地快照） */
function clearInputs(api, ...binds) {
  for (const bind of binds) {
    api.view.setState(bind, '')
    delete ui[bind]
  }
}

/* ───────────────────────── 落盘 ───────────────────────── */

async function loadVault(api) {
  let text
  try {
    text = await api.fs.readText(VAULT_FILE)
  } catch {
    // 文件不存在 = 首次使用（正常态）
    return createVault()
  }
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || !parsed.rings) throw new Error('结构不对')
    return parsed
  } catch {
    // 文件在、但读不懂 ⇒ 可能是坏盘 / 别的版本。**不清空、不覆盖**，让用户自己决定
    store.corrupt = true
    return createVault()
  }
}

async function saveVault(api, vault) {
  if (store.corrupt) {
    throw new Error('vault.json 读不懂，已停止写入（避免覆盖原文件）。请先备份并检查 .zn/security/')
  }
  try {
    await api.fs.mkdir('.zn/security')
  } catch {
    /* 目录已存在 */
  }
  await api.fs.writeText(VAULT_FILE, JSON.stringify(vault, null, 2))
}

/* ───────────────────────── 解锁 / 锁定 ───────────────────────── */

/** 先让界面显示"正在派生密钥…"，再算（Argon2 同步阻塞 1 s / 手机 2–4 s） */
async function withBusy(api, ringId, fn) {
  store.busy = ringId
  api.view.refresh(PANEL_ID)
  await sleep(40) // 给宿主一次提交的机会
  try {
    return await fn()
  } finally {
    store.busy = ''
    api.view.refresh(PANEL_ID)
  }
}

function touch(ringId) {
  const s = live.get(ringId)
  if (s) s.lastActive = Date.now()
}

/**
 * 锁定一把环：清内存里的 DEK、清恢复暂存、广播事件。
 * ⚠️ 只清我们持有的那份（JS 无法保证 GC 副本，见方案 §6）。
 */
function lockRing(api, ringId, reason = 'manual') {
  const s = live.get(ringId)
  const r = recovered.get(ringId)
  if (r) {
    wipe(r)
    recovered.delete(ringId)
  }
  if (!s) return false
  wipe(s.dek)
  live.delete(ringId)
  api.event.emit('security:locked', { ringId, reason })
  api.view.refresh(PANEL_ID)
  return true
}

/** 按环的 idleLockMs 判空闲；后台被冻结也能靠时间戳补判 */
function checkIdle(api) {
  const now = Date.now()
  for (const [ringId, s] of live) {
    const ring = getRing(store.vault, ringId)
    const limit = ring?.idleLockMs ?? 3 * 60 * 1000
    if (now - s.lastActive > limit) lockRing(api, ringId, 'idle')
  }
}

async function unlockWithPassword(api, ringId, password) {
  const ring = getRing(store.vault, ringId)
  if (!ring) throw new Error(`「${RING_LABEL[ringId] ?? ringId}」还没建立`)
  if (!password) throw new Error('请输入主密码')
  const L = await loadLibs()
  const { dek } = unlockRing(L, ring, password)
  live.set(ringId, { dek, lastActive: Date.now() })
  api.event.emit('security:unlocked', { ringId })
  return true
}

/* ───────────────────────── 面板 ───────────────────────── */

/** 环的状态行 */
function ringRow(ringId, { selected, unlocked, busy }) {
  const label = `${RING_LABEL[ringId] ?? ringId} ${unlocked ? '🔓' : '🔒'}`
  return {
    type: 'button',
    label: busy === ringId ? `${label} · 正在计算…` : label,
    onClick: 'security.select',
    payload: { ringId },
    variant: selected ? 'default' : 'ghost',
  }
}

/**
 * 面板结构（导出给单测断言：空库必须出现"建立密钥环"，建立后必须出现"解锁"）。
 */
export function panelNode(view) {
  const {
    vault,
    selected = 'secrets',
    unlocked = {},
    busy = '',
    message = '',
    tone = 'info',
    recoveryCodeShown = '',
    corrupt = false,
    hasRecoveryQuestion = false,
    hasRecoveryCode = false,
    recoveredPending = false,
  } = view ?? {}

  const ring = getRing(vault, selected)
  const isUnlocked = Boolean(unlocked[selected])
  const label = RING_LABEL[selected] ?? selected
  const kids = []

  kids.push({
    type: 'row',
    align: 'center',
    wrap: true,
    gap: 'sm',
    children: [
      { type: 'text', value: '安全', variant: 'title' },
      { type: 'badge', text: `${Object.values(unlocked).filter(Boolean).length} 把已解锁` },
      { type: 'button', label: '自检', onClick: 'security.self-test', variant: 'ghost' },
    ],
  })

  kids.push({
    type: 'row',
    align: 'center',
    wrap: true,
    gap: 'sm',
    children: RING_IDS.map((id) =>
      ringRow(id, { selected: id === selected, unlocked: Boolean(unlocked[id]), busy }),
    ),
  })

  kids.push({ type: 'text', value: RING_HINT[selected] ?? '', variant: 'caption', tone: 'muted' })

  if (corrupt) {
    kids.push({
      type: 'text',
      value: '⚠️ vault.json 读不懂：已按空库启动，但**不会写入**（避免覆盖原文件）。请先备份 .zn/security/。',
      variant: 'caption',
      tone: 'error',
    })
  }

  if (!ring) {
    kids.push({ type: 'divider' })
    kids.push({ type: 'text', value: `第一次使用「${label}」：设一把主密码`, variant: 'body' })
    kids.push({ type: 'input', bind: B.pw1, placeholder: '主密码（至少 8 位）' })
    kids.push({ type: 'input', bind: B.pw2, placeholder: '再输一次' })
    kids.push({ type: 'input', bind: B.question, placeholder: '恢复问题（可留空，只用恢复码）' })
    kids.push({ type: 'input', bind: B.answer, placeholder: '恢复答案（留空则不设问题）' })
    kids.push({
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        {
          type: 'button',
          label: busy === selected ? '正在派生密钥…' : '建立密钥环',
          onClick: 'security.setup',
        },
      ],
    })
  } else if (!isUnlocked) {
    kids.push({ type: 'divider' })
    kids.push({
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'text', value: `「${label}」已建立，输入主密码解锁`, variant: 'body' },
        ...(hasRecoveryCode ? [{ type: 'badge', text: '有恢复码' }] : []),
        ...(hasRecoveryQuestion ? [{ type: 'badge', text: '有恢复问题' }] : []),
      ],
    })
    kids.push({ type: 'input', bind: B.pw1, placeholder: '主密码' })
    kids.push({
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        {
          type: 'button',
          label: busy === selected ? '正在派生密钥…' : '解锁',
          onClick: 'security.unlock',
        },
        ...(hasRecoveryQuestion
          ? [{ type: 'button', label: '用恢复问题', onClick: 'security.recover-answer', variant: 'ghost' }]
          : []),
        ...(hasRecoveryCode
          ? [{ type: 'button', label: '用恢复码', onClick: 'security.recover-code', variant: 'ghost' }]
          : []),
      ],
    })
    kids.push({ type: 'divider' })
    kids.push({ type: 'text', value: '忘记主密码时：', variant: 'caption', tone: 'muted' })
    if (hasRecoveryQuestion) kids.push({ type: 'input', bind: B.answer, placeholder: '恢复答案' })
    if (hasRecoveryCode) kids.push({ type: 'input', bind: B.code, placeholder: '恢复码（形如 ABCD-EFGH-…）' })
    if (recoveredPending) {
      kids.push({ type: 'text', value: '✅ 恢复验证通过 —— 设一把新主密码', variant: 'caption', tone: 'success' })
      kids.push({ type: 'input', bind: B.newPw, placeholder: '新主密码（至少 8 位）' })
      kids.push({ type: 'button', label: '重设主密码', onClick: 'security.reset-after-recovery' })
    }
  } else {
    kids.push({ type: 'divider' })
    kids.push({
      type: 'row',
      align: 'center',
      wrap: true,
      gap: 'sm',
      children: [
        { type: 'text', value: `「${label}」已解锁`, variant: 'body' },
        { type: 'button', label: '立即锁定', onClick: 'security.lock', variant: 'danger' },
      ],
    })
    kids.push({ type: 'divider' })
    kids.push({ type: 'text', value: '换主密码（数据密文一个字节都不会动）：', variant: 'caption', tone: 'muted' })
    kids.push({ type: 'input', bind: B.oldPw, placeholder: '当前主密码' })
    kids.push({ type: 'input', bind: B.newPw, placeholder: '新主密码（至少 8 位）' })
    kids.push({ type: 'button', label: '换主密码', onClick: 'security.change-password', variant: 'ghost' })
  }

  if (recoveryCodeShown) {
    kids.push({ type: 'divider' })
    kids.push({
      type: 'text',
      value: '📋 恢复码（只显示这一次，抄下来存好）：',
      variant: 'body',
    })
    kids.push({ type: 'text', value: recoveryCodeShown, variant: 'title' })
    kids.push({
      type: 'text',
      value: '忘记主密码时，用「用恢复码」解锁并重设密码。丢了它 + 忘了密码 = 数据打不开。',
      variant: 'caption',
      tone: 'warn',
    })
  }

  if (message) kids.push({ type: 'text', value: message, variant: 'caption', tone })

  return { type: 'stack', gap: 'sm', children: kids }
}

/** 面板数据快照（render 与单测都走这里，避免两份判断） */
function panelView() {
  const unlocked = {}
  for (const id of RING_IDS) unlocked[id] = live.has(id)
  const ring = getRing(store.vault, store.selected)
  return {
    vault: store.vault,
    selected: store.selected,
    unlocked,
    busy: store.busy,
    message: store.message,
    tone: store.tone,
    recoveryCodeShown: store.recoveryCodeShown,
    corrupt: store.corrupt,
    hasRecoveryQuestion: Boolean(ring?.recovery?.answerWrap),
    hasRecoveryCode: Boolean(ring?.recovery?.codeWrap),
    recoveredPending: recovered.has(store.selected),
  }
}

/* ───────────────────────── 命令 ───────────────────────── */

/**
 * 建立一把环。
 * 输入：pw1/pw2（必填）+ question/answer（可选，留空则只有恢复码）。
 */
async function doSetup(api) {
  const ringId = store.selected
  const pw1 = String(ui[B.pw1] ?? '')
  const pw2 = String(ui[B.pw2] ?? '')
  const question = String(ui[B.question] ?? '')
  const answer = String(ui[B.answer] ?? '')

  if (pw1.length < 8) return setStatus(api, '主密码至少 8 位 —— 慢哈希只提高每次猜测的成本，挡不住 123456', 'warn')
  if (pw1 !== pw2) return setStatus(api, '两次输入的主密码不一致', 'warn')

  try {
    const { ring, code } = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      const created = createRing(L, ringId, pw1, { containerId: ringId })
      const recoveryCode = generateRecoveryCode(L)
      const withRecovery = setupRecovery(L, created.ring, created.dek, {
        question,
        answer,
        code: recoveryCode,
      })
      wipe(created.dek) // 建立后就用不到了（下次解锁时再解出来）
      return { ring: withRecovery, code: recoveryCode }
    })

    store.vault = putRing(store.vault, ring)
    await saveVault(api, store.vault)
    store.recoveryCodeShown = code
    setStatus(api, `「${RING_LABEL[ringId] ?? ringId}」已建立。请抄下上面的恢复码。`, 'success')
    api.host.notify('密钥环已建立 —— 恢复码只显示一次，请抄下来', 'info')
  } catch (e) {
    setStatus(api, `建立失败：${String(e?.message ?? e)}`, 'error')
  } finally {
    clearInputs(api, B.pw1, B.pw2, B.question, B.answer)
  }
}

async function doUnlock(api) {
  const ringId = store.selected
  const pw = String(ui[B.pw1] ?? '')
  try {
    await withBusy(api, ringId, () => unlockWithPassword(api, ringId, pw))
    // 解锁后恢复码提示可以收了（已抄过的用户不希望它一直挂在屏幕上）
    store.recoveryCodeShown = ''
    setStatus(api, `「${RING_LABEL[ringId] ?? ringId}」已解锁`, 'success')
  } catch (e) {
    // 密码错时 **不说是"密码错"以外的信息**（不给 oracle）；AEAD 失败的原文也没用
    setStatus(api, `解不开：主密码不对，或 vault 被改过`, 'error')
  } finally {
    clearInputs(api, B.pw1)
  }
}

async function doChangePassword(api) {
  const ringId = store.selected
  const oldPw = String(ui[B.oldPw] ?? '')
  const newPw = String(ui[B.newPw] ?? '')
  if (newPw.length < 8) return setStatus(api, '新主密码至少 8 位', 'warn')
  const ring = getRing(store.vault, ringId)
  if (!ring) return setStatus(api, '这个环还没建立', 'warn')

  try {
    const next = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      return changePassword(L, ring, oldPw, newPw)
    })
    store.vault = putRing(store.vault, next)
    await saveVault(api, store.vault)
    // 换完密码当前会话仍然有效（DEK 没变），但要提示一次
    setStatus(api, '主密码已换。数据密文没动，旧密码从此失效。', 'success')
  } catch (e) {
    setStatus(api, `换密码失败：${String(e?.message ?? e)}`, 'error')
  } finally {
    clearInputs(api, B.oldPw, B.newPw)
  }
}

/** 恢复：解出 DEK 暂存，等用户设新密码（不在这里改盘） */
async function doRecover(api, how) {
  const ringId = store.selected
  const ring = getRing(store.vault, ringId)
  if (!ring) return setStatus(api, '这个环还没建立', 'warn')
  const input = how === 'answer' ? String(ui[B.answer] ?? '') : String(ui[B.code] ?? '')
  if (!input) return setStatus(api, how === 'answer' ? '请输入恢复答案' : '请输入恢复码', 'warn')

  try {
    const dek = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      return how === 'answer' ? recoverWithAnswer(L, ring, input) : recoverWithCode(L, ring, input)
    })
    recovered.set(ringId, dek)
    setStatus(api, '恢复验证通过 —— 请设一把新主密码', 'success')
  } catch {
    setStatus(api, '恢复失败：答案 / 恢复码不对', 'error')
  } finally {
    clearInputs(api, B.answer, B.code)
  }
}

async function doResetAfterRecovery(api) {
  const ringId = store.selected
  const newPw = String(ui[B.newPw] ?? '')
  const dek = recovered.get(ringId)
  const ring = getRing(store.vault, ringId)
  if (!dek || !ring) return setStatus(api, '先完成恢复验证', 'warn')
  if (newPw.length < 8) return setStatus(api, '新主密码至少 8 位', 'warn')

  try {
    const next = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      return resetPasswordWithDek(L, ring, dek, newPw)
    })
    store.vault = putRing(store.vault, next)
    await saveVault(api, store.vault)

    // 重设成功 ⇒ 直接进解锁态（用户刚证明了身份）
    const old = recovered.get(ringId)
    if (old) {
      wipe(old)
      recovered.delete(ringId)
    }
    live.set(ringId, { dek, lastActive: Date.now() })
    api.event.emit('security:unlocked', { ringId })
    setStatus(api, '主密码已重设 —— 数据密文一个字节都没动', 'success')
  } catch (e) {
    setStatus(api, `重设失败：${String(e?.message ?? e)}`, 'error')
  } finally {
    clearInputs(api, B.newPw)
  }
}

/** 自检：跑一遍真实往返 + 篡改必失败，不碰用户数据 */
async function doSelfTest(api) {
  try {
    const L = await loadLibs()
    const tag = `自检-${Date.now()}`
    const tmp = new Uint8Array(32).fill(7) // 固定假密钥，不进 vault
    const payload = encryptData(L, tmp, 'selftest', 'selftest', tag)
    const back = fromBytes(decryptData(L, tmp, 'selftest', 'selftest', payload))
    const sig = signData(L, tmp, 'selftest', 'selftest', toBytes(tag))
    const okVerify = verifyData(L, tmp, 'selftest', 'selftest', toBytes(tag), sig)

    let tamperFailed = false
    try {
      const [v, n, ct] = payload.split('.')
      decryptData(L, tmp, 'selftest', 'selftest', `${v}.${n}.${ct.slice(0, -2)}AA`)
    } catch {
      tamperFailed = true
    }
    wipe(tmp)

    const ok = back === tag && okVerify && tamperFailed
    setStatus(
      api,
      ok
        ? '✅ 自检通过：往返一致 · 签名可验 · 改一字节就解不开'
        : `❌ 自检失败：往返=${back === tag} 签名=${okVerify} 篡改被拒=${tamperFailed}`,
      ok ? 'success' : 'error',
    )
  } catch (e) {
    setStatus(api, `自检出错：${String(e?.message ?? e)}`, 'error')
  }
}

/* ───────────────────────── 插件入口 ───────────────────────── */

export default {
  async apply(api) {
    store.vault = await loadVault(api)
    store.loaded = true

    /* 面板 */
    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '安全',
        location: 'main',
        render: (ctx) => {
          // ViewApi 没有 getState：把本次 ctx.state 存快照，命令里读它（tag-panel 同款做法）
          ui = { ...(ctx?.state ?? {}) }
          return panelNode(panelView())
        },
      }),
    )

    /* 状态栏：一眼看到锁没锁 */
    api.subscriptions.push(
      api.view.registerPanel({
        id: STATUS_ID,
        title: '安全',
        location: 'statusbar',
        render: () => {
          const any = live.size > 0
          return {
            type: 'row',
            align: 'center',
            gap: 'sm',
            children: [
              {
                type: 'link',
                label: any ? `🔓 安全（${live.size}）` : '🔒 安全',
                onClick: 'security.open',
              },
            ],
          }
        },
      }),
    )

    /* 空闲锁定：3 秒检查一次（时间戳判定，不依赖定时器在后台还活着） */
    const timer = setInterval(() => checkIdle(api), IDLE_CHECK_MS)
    api.subscriptions.push({ dispose: () => clearInterval(timer) })

    /* 命令 */
    const commands = [
      {
        id: 'security.open',
        title: '安全：打开面板',
        run: async () => {
          for (let i = 0; i < 5; i++) {
            try {
              await api.command.execute(`core.panel.${PANEL_ID}`)
              return
            } catch {
              await sleep(30) // 冷启动时 core.panel.* 还没注册（doc-reader / tag-panel 同款重试）
            }
          }
          api.host.notify('打不开安全面板（内核还没注册面板命令）', 'warn')
        },
      },
      {
        id: 'security.select',
        title: '安全：切换密钥环',
        run: async (payload) => {
          const ringId = String(payload?.ringId ?? '')
          if (!RING_IDS.includes(ringId)) return
          store.selected = ringId
          store.message = ''
          store.recoveryCodeShown = ''
          api.view.refresh(PANEL_ID)
        },
      },
      { id: 'security.setup', title: '安全：建立密钥环', run: (p) => doSetup(api) },
      { id: 'security.unlock', title: '安全：解锁', run: () => doUnlock(api) },
      {
        id: 'security.lock',
        title: '安全：立即锁定',
        run: async () => {
          const ringId = store.selected
          lockRing(api, ringId, 'manual')
          setStatus(api, `「${RING_LABEL[ringId] ?? ringId}」已锁定`, 'info')
        },
      },
      { id: 'security.change-password', title: '安全：换主密码', run: () => doChangePassword(api) },
      { id: 'security.recover-answer', title: '安全：用恢复问题解锁', run: () => doRecover(api, 'answer') },
      { id: 'security.recover-code', title: '安全：用恢复码解锁', run: () => doRecover(api, 'code') },
      {
        id: 'security.reset-after-recovery',
        title: '安全：恢复后重设主密码',
        run: () => doResetAfterRecovery(api),
      },
      { id: 'security.self-test', title: '安全：自检', run: () => doSelfTest(api) },
    ]
    for (const cmd of commands) api.subscriptions.push(api.command.register(cmd))

    /* 对外服务（需求 §9.4）：只给"操作"，不给密钥 */
    api.subscriptions.push(
      api.service.provide(
        'crypto',
        () => ({
          version: '1.0.0',
          isUnlocked: (ringId = 'secrets') => live.has(ringId),
          ids: () => [...live.keys()],
          unlock: async (ringId, password) => unlockWithPassword(api, ringId, password),
          lock: (ringId = 'secrets') => lockRing(api, ringId, 'service'),
          /** 加密：`{ ring, container, data }`，data 可以是字符串或 Uint8Array */
          encrypt: async ({ ring = 'secrets', container, data } = {}) => {
            const s = live.get(ring)
            if (!s) throw new Error(`密钥环「${ring}」未解锁`)
            const L = await loadLibs()
            touch(ring)
            return encryptData(L, s.dek, ring, container ?? ring, data)
          },
          /** 解密成文本（密码库这类 JSON 数据用它） */
          decryptText: async ({ ring = 'secrets', container, payload } = {}) => {
            const s = live.get(ring)
            if (!s) throw new Error(`密钥环「${ring}」未解锁`)
            const L = await loadLibs()
            touch(ring)
            return fromBytes(decryptData(L, s.dek, ring, container ?? ring, payload))
          },
          decryptBytes: async ({ ring = 'secrets', container, payload } = {}) => {
            const s = live.get(ring)
            if (!s) throw new Error(`密钥环「${ring}」未解锁`)
            const L = await loadLibs()
            touch(ring)
            return decryptData(L, s.dek, ring, container ?? ring, payload)
          },
          sign: async ({ ring = 'secrets', container, data } = {}) => {
            const s = live.get(ring)
            if (!s) throw new Error(`密钥环「${ring}」未解锁`)
            const L = await loadLibs()
            touch(ring)
            return signData(L, s.dek, ring, container ?? ring, data)
          },
          verify: async ({ ring = 'secrets', container, data, sig } = {}) => {
            const s = live.get(ring)
            if (!s) return false
            const L = await loadLibs()
            return verifyData(L, s.dek, ring, container ?? ring, data, sig)
          },
        }),
        { version: '1.0.0' },
      ),
    )

    api.host.log('info', `[security] 已加载：${Object.keys(store.vault.rings).length} 个环`)
  },
}
