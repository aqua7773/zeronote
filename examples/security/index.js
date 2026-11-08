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
    // 自定义环的显示名（内置两环用固定中文名，不写这个字段）
    ...(opts.label ? { label: String(opts.label) } : {}),
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

/* ───────────────────────── 生物识别（期 2b / 2c） ───────────────────────── */

/**
 * 适配器接口：`{ platform, seal(dek, ringId) → Promise<string>, open(wrapped, ringId) → Promise<Uint8Array> }`
 *
 * - **Android**：`plugin:biometric|biometric_cipher` —— Keystore 里一把不可导出的 AES-256-GCM 密钥，
 *   每次加解密都要一次 fresh 指纹（实测 2026-10-26）。
 * - **Windows**：`hello_sign` 签名 → HKDF 出 KEK → 用本文件的 XChaCha 包裹（方案 §8.5）。
 *
 * 本层是纯函数：只依赖 seal/open 两个动作，单测注入假适配器即可，不需要真机。
 */

/** 把 DEK 绑到**这台设备**的生物识别上（纯函数：返回新 ring，别的设备那几份一个字节不动） */
export async function bindBiometric(ring, dek, adapter, deviceId = 'local') {
  if (!adapter?.seal) throw new Error('这台设备没有可用的生物识别')
  if (!(dek instanceof Uint8Array) || dek.length !== 32) throw new Error('DEK 形状不对')
  const wrapped = await adapter.seal(new Uint8Array(dek), ring.id)
  if (typeof wrapped !== 'string' || !wrapped) throw new Error('生物识别没有返回包裹结果')
  const all = { ...(ring.biometrics ?? {}) }
  all[deviceId] = { platform: adapter.platform, wrapped, at: Date.now() }
  return { ...ring, biometrics: all }
}

/**
 * 本机设备 id 存在**凭据管理器**里（`api.host.secrets`）—— 不随库同步、不进 vault.json。
 * 丢了（清凭据 / 重装）只让这一台的绑定失效，别的设备不受影响。
 */
export const DEVICE_ID_ACCOUNT = 'zeronote.device.id'

/**
 * 读「这台设备那一份」绑定（纯函数）。
 *
 * 数据结构（`vault.json` 的 `rings.<id>`）：
 * ```json
 * { "biometrics": { "<deviceId>": { "platform": "windows", "wrapped": "hello1.…", "at": 123 } } }
 * ```
 * rev173.171 及以前是单段 `biometric`（没有设备维度）—— 由 `migrateBiometrics` 一次性迁到 `biometrics[<本机>]`。
 */
export function deviceBinding(ring, deviceId) {
  const all = ring?.biometrics
  if (!all || typeof all !== 'object') return null
  const bound = all[deviceId]
  return bound?.wrapped ? bound : null
}

/** 这台设备之外还有几台绑过（UI 提示用；纯函数） */
export function otherDeviceCount(ring, deviceId) {
  const all = ring?.biometrics
  if (!all || typeof all !== 'object') return 0
  return Object.entries(all).filter(([id, v]) => id !== deviceId && v?.wrapped).length
}

/**
 * 把旧的单段 `biometric` 迁到 `biometrics[<本机>]`（纯函数；没东西可迁返回 `null`）。
 *
 * 迁移默认「旧段就是这台机器的」—— 单设备用户升级后指纹照常可用；真是换机过来的 vault，
 * 解开时会报 AEAD 失败并提示重新绑定（与改造前同一条引导）。
 */
export function migrateBiometrics(vault, deviceId) {
  const rings = vault?.rings
  if (!rings) return null
  let changed = false
  const next = {}
  for (const [id, ring] of Object.entries(rings)) {
    if (ring?.biometric?.wrapped) {
      const all = { ...(ring.biometrics ?? {}), [deviceId]: { ...ring.biometric } }
      const copy = { ...ring, biometrics: all }
      delete copy.biometric
      next[id] = copy
      changed = true
    } else {
      next[id] = ring
    }
  }
  return changed ? { ...vault, rings: next } : null
}

/**
 * 用生物识别解出 DEK。失败**原样抛**：取消 / 换过指纹 / 密钥失效 是不同的语义，
 * 由适配器给错误码，UI 再翻成人话（不要在这里统一成"失败"）。
 */
export async function unlockWithBiometric(ring, adapter, deviceId = 'local') {
  const bound = deviceBinding(ring, deviceId)
  if (!bound) throw new Error('这个密钥环没有绑定生物识别')
  if (!adapter?.open) throw new Error('这台设备没有可用的生物识别')
  const dek = await adapter.open(bound.wrapped, ring.id)
  if (!(dek instanceof Uint8Array) || dek.length !== 32) {
    throw new Error('生物识别解出的密钥长度不对')
  }
  return dek
}

/** 解除**这台设备**的绑定（纯函数；别的设备那几份保留） */
export function unbindBiometric(ring, deviceId = 'local') {
  const next = { ...(ring ?? {}) }
  const all = { ...(next.biometrics ?? {}) }
  delete all[deviceId]
  if (Object.keys(all).length) next.biometrics = all
  else delete next.biometrics
  // 旧单段同源：既然用户在“解除本机绑定”，它也不该留着（迁移只会把它归给本机）
  delete next.biometric
  return next
}

/* ───────────────────────── 设备级解锁密钥 DK（期 3 · 统一指纹） ───────────────────────── */

/**
 * **一次绑定、多环继承**（2026-11-07 用户拍板）。
 *
 * 旧做法是每个环各自用 Keystore 包一份 DEK ⇒ 每建一个环都要再绑一次指纹。
 * 现在引入设备级 `DK`（32 字节随机）：
 *
 * ```
 * 指纹认证一次 → adapter.open(device.<本机>.json) → DK
 * 每个环：rings.<id>.deviceWrapped = XChaCha(DK, "<环id>|device", DEK)
 * 解锁：DK → unwrap(deviceWrapped) → DEK（同一会话再解别的环不用再认证）
 * ```
 *
 * `DK` 只在本机文件里（`.zn/security/device.<本机>.json`，**不进 PRIVATE_FILES 不同步**）；
 * 别的设备解不了、也没必要搬。
 */
export function deviceFileOf(deviceId) {
  return `${VAULT_DIR}/device.${deviceId}.json`
}

const deviceAad = (ringId) => `${ringId}|device`

export function wrapDeviceDek(libs, dk, ringId, dek) {
  return seal(libs, dk, deviceAad(ringId), dek)
}

export function unwrapDeviceDek(libs, dk, ringId, wrapped) {
  return open(libs, dk, deviceAad(ringId), wrapped)
}

/** 设备绑定文件的明文内容（纯函数） */
export function deviceFileContent(platform, wrapped, at = Date.now()) {
  return JSON.stringify({ v: 1, platform, wrapped, at }, null, 2)
}

/** 解析设备绑定文件；坏内容返回 `null`（面板只是不显示指纹入口） */
export function parseDeviceFile(text) {
  try {
    const p = JSON.parse(text)
    if (!p || typeof p !== 'object' || !p.wrapped) return null
    return { platform: String(p.platform ?? ''), wrapped: String(p.wrapped), at: Number(p.at ?? 0) }
  } catch {
    return null
  }
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

/**
 * **vault 按环拆文件**（rev173.182 · 私密文件夹期 3）。
 *
 * 为什么要拆：`vault.json` 是整文件同步的 —— 两台设备各改一个环的密码（重包裹 DEK）时，
 * 两边都改了同一个文件 ⇒ 同步判定冲突 ⇒ 取远端 ⇒ **另一边的重包裹丢了**，那台设备
 * 直接解不开自己的数据。拆成「每环一个文件、各自一个同步单元」就没有这个交叉冲突了。
 *
 * 文件名固定（`vault.<环id>.json`）而不是动态扫描：同步插件要靠**固定清单**搬文件
 * （见三个网络后端的 `PRIVATE_FILES`），动态文件名会让"要同步哪些"变成运行时才发现的事。
 */
export const VAULT_DIR = '.zn/security'
/** 某个环的 vault 文件（库内相对路径） */
export function vaultFileOf(ringId) {
  return `${VAULT_DIR}/vault.${ringId}.json`
}
/** 旧版单文件（按环拆之前的）—— 只读兼容 + 迁移时删除 */
export const LEGACY_VAULT_FILE = `${VAULT_DIR}/vault.json`

/**
 * 迁移收尾「删不掉旧文件」时给用户的提示（纯函数，单测覆盖 · rev173.184）。
 *
 * 为什么要有这句话：手机走查实测 —— Android 上 `purgePrivate` 可能**静默失败**
 * （面板照样报「主密码已换」，旧 `vault.json` 留在原地）。旧文件留着不是"没影响"：
 * 同步插件仍会把它当私有文件搬、备份也会收它。所以失败必须说出来。
 */
export function legacyPurgeWarning(error) {
  const why = error
    ? `：${error}`
    : '（删除调用没报错，但文件还在 —— 可能被同步 / 备份又写了回来）'
  return `vault 已按环拆好，但旧的 ${LEGACY_VAULT_FILE} 删不掉${why}。请手动删除它，否则同步 / 备份会继续收它`
}

/** 单环 vault 文件的明文内容（写盘前用） */
export function vaultPartPayload(ring) {
  return JSON.stringify({ v: 2, ring: { id: ring.id, ...ring } }, null, 2)
}

/**
 * 解析单环 vault 文件。结构不对就抛（调用方据此标记 `corrupt`，**不覆盖**原文件）。
 * `v` 只做记录、不校验：将来加字段时不想因为版本号把用户的环判成坏的。
 */
export function parseVaultPart(text) {
  let p
  try {
    p = JSON.parse(text)
  } catch {
    throw new Error('不是合法 JSON')
  }
  if (!p || typeof p !== 'object' || !p.ring || typeof p.ring !== 'object' || !p.ring.id) {
    throw new Error('结构不对（缺 ring.id）')
  }
  return p.ring
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


/* ───────────────────────── 插件授权（期 3 · 环分配） ───────────────────────── */

/**
 * 授权表：**哪个插件可以用哪个密钥环**。
 *
 * 落 `.zn/security/grants.json` —— **本机文件、不进 `PRIVATE_FILES`**（不同步：
 * 换设备是另一套信任关系，要重新授权）。默认拒绝：没登记的插件一律不许碰环。
 */
export const GRANTS_FILE = `${VAULT_DIR}/grants.json`

/** 未分配时给的行动指引（消费者原样显示给用户） */
const AUTH_HINT = '去「安全 → 密钥环分配」给它分配一个'

export function emptyGrants() {
  return { v: 2, rings: {}, demand: {} }
}

/**
 * 把磁盘内容读成分配表 —— **只认 v2**。
 *
 * v1（`{ grants: { 插件: [环] } }`）按用户 2026-11-07 拍板**不迁移**：当空表，
 * 用户重新分配一次（旧表结构是「插件挑环」，与现在的方向正好相反）。
 */
export function parseGrants(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return emptyGrants()
  }
  if (!raw || typeof raw !== 'object' || raw.v !== 2) return emptyGrants()
  const taken = new Set()
  const rings = {}
  for (const [ringId, pluginId] of Object.entries(raw.rings ?? {})) {
    if (!isRingId(ringId)) continue
    const pid = typeof pluginId === 'string' ? pluginId.trim() : ''
    // 双向 1:1：同一个插件只留第一个环（坏数据不让它同时占两个）
    if (!pid || taken.has(pid)) continue
    taken.add(pid)
    rings[ringId] = pid
  }
  const demand = {}
  for (const [pluginId, on] of Object.entries(raw.demand ?? {})) {
    const pid = String(pluginId ?? '').trim()
    if (pid && on === true) demand[pid] = true
  }
  return { v: 2, rings, demand }
}

/** 这个环分配给了谁（没分配 ⇒ null） */
export function ringOwner(grants, ringId) {
  return grants?.rings?.[ringId] ?? null
}

/** 这个插件拿到了哪个环（没分配 ⇒ null） */
export function pluginRing(grants, pluginId) {
  for (const [ringId, owner] of Object.entries(grants?.rings ?? {})) {
    if (owner === pluginId) return ringId
  }
  return null
}

/**
 * 分配 / 解除（纯函数）。`pluginId` 为空 = 解除分配。
 *
 * **双向 1:1**（用户 2026-11-07 拍板）：一个环只给一个插件、一个插件只拿一个环。
 * 本函数保持这条不变量（脏数据 / 绕过检查时**让位与顶替**），但正常路径**不会走到让位**
 * —— 面板命令先用 `assignConflict` 拦下冲突并提示（用户 2026-11-07：「新密钥无法分配给
 * 已分配密钥的插件，直接提示已有密钥」）。
 */
export function withAssign(grants, ringId, pluginId) {
  const base = grants ?? emptyGrants()
  const rings = { ...(base.rings ?? {}) }
  const demand = { ...(base.demand ?? {}) }
  const pid = String(pluginId ?? '').trim()
  if (!pid) {
    delete rings[ringId]
    return { v: 2, rings, demand }
  }
  for (const [id, owner] of Object.entries(rings)) {
    if (owner === pid) delete rings[id]
  }
  rings[ringId] = pid
  // 主动分配给一个还没声明过需求的插件 ⇒ 也记进 demand，下次下拉里还找得到它
  demand[pid] = true
  return { v: 2, rings, demand }
}

/**
 * 分配前的冲突检查（纯函数）：**已占位的分配不自动替换**，直接给理由。
 *
 * 用户 2026-11-07：「新密钥无法分配给已分配密钥的插件，直接提示已有密钥」
 * ⇒ 一个插件已有环时，新环分不下去；一个环已有主人时，也换不了人。
 * 返回 `null` 表示可以分配；返回字符串 = 给用户看的拒绝理由（命令层只提示、不落盘）。
 */
export function assignConflict(grants, ringId, pluginId) {
  const pid = String(pluginId ?? '').trim()
  if (!pid) return null // 解除分配永远允许
  const holder = ringOwner(grants, ringId)
  if (holder && holder !== pid) {
    return `密钥环「${ringLabel(ringId)}」已经分配给「${holder}」—— 先在那一行选「未分配」再分配`
  }
  const mine = pluginRing(grants, pid)
  if (mine && mine !== ringId) {
    return `插件「${pid}」已经有密钥环「${ringLabel(mine)}」—— 先在那一行选「未分配」再分配`
  }
  return null
}

/**
 * 登记「这个插件需要一个密钥环」（纯函数、幂等）。
 *
 * **不带环 id** —— 插件只声明需求，具体给哪个环由用户在面板下拉里决定。
 */
export function withDemand(grants, pluginId) {
  const base = grants ?? emptyGrants()
  const pid = String(pluginId ?? '').trim()
  if (!pid) return base
  if (base.demand?.[pid]) return base
  return { v: 2, rings: { ...(base.rings ?? {}) }, demand: { ...(base.demand ?? {}), [pid]: true } }
}

/** 没分配到环时的报错文案（消费者原样显示给用户） */
export function noRingError(pluginId) {
  return `插件「${pluginId}」还没分配到密钥环 —— ${AUTH_HINT}`
}

/**
 * 面板用的分配行（纯函数）：**每个环一行**。
 *
 * `options` = 声明过需求的插件 ∪ 当前分到它的插件 ∪ **已安装插件**（rev173.420）。
 * 排序后给下拉用；「未分配」由渲染层自己加在最前面。
 *
 * 为什么要并入「已安装插件」：部分消费者插件（手机上没更新的旧版）只硬编码自己的环、
 * 不调 `crypto.demand()` ⇒ 只按 demand 渲染时用户看到的是一张空列表，
 * 明明装着插件却没法分配。宿主经 `host.installedPlugins()` 给出真实清单，下拉里就能选。
 */
export function assignRows(grants, ringIds = BUILTIN_RINGS, installed = []) {
  const demanded = Object.keys(grants?.demand ?? {})
  const known = (Array.isArray(installed) ? installed : [])
    .map((p) => (typeof p === 'string' ? p : p?.id))
    .filter((id) => typeof id === 'string' && id)
  return ringIds.map((ringId) => {
    const owner = ringOwner(grants, ringId)
    const options = [...new Set([...demanded, ...(owner ? [owner] : []), ...known])].sort()
    return { ringId, owner, options }
  })
}

/**
 * 删除一把环时，把分配表里「这个环」那一行也清掉（纯函数 · rev173.420）。
 *
 * 环没了，分配就是幽灵 —— 留着会让面板的播种 / 冲突检查指向一个不存在的环。
 * `demand` 不动：插件仍然需要「某个」环，需求不因删环而消失。
 */
export function dropRingGrants(grants, ringId) {
  const rings = { ...(grants?.rings ?? {}) }
  delete rings[ringId]
  return { v: 2, rings, demand: { ...(grants?.demand ?? {}) } }
}

const PANEL_ID = 'security.panel'
const STATUS_ID = 'security.status'
/** 内置环 id：消费者（私密笔记 / 密码库）硬编码这两个名字，**永远存在** */
const BUILTIN_RINGS = ['notes', 'secrets']
/** 兼容旧引用（内置两环） */
const RING_IDS = BUILTIN_RINGS
const RING_LABEL = { notes: '私密笔记', secrets: '账号密码' }

/**
 * **当前所有环 id**（内置两个在前，用户新建的按 id 排序在后）。
 *
 * 环 id 是 `.zn/security/vault.<id>.json` 的文件名片段，也是 AAD 的一部分 ⇒
 * 只允许 `[a-z0-9-]`（用户输入的中文名称只做显示用，id 由 `newRingId` 生成）。
 */
export function allRingIds(vault) {
  const extra = Object.keys(vault?.rings ?? {}).filter((id) => !BUILTIN_RINGS.includes(id))
  return [...BUILTIN_RINGS, ...extra.sort()]
}

/** 环 id 合法性（文件名 + AAD 共用这一条） */
export const RING_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/
export function isRingId(id) {
  return typeof id === 'string' && RING_ID_RE.test(id)
}

/** 用户输入的名称 → 安全 id（中文等非 ASCII 字符归到 `ring` / `ring-2` …） */
export function slugifyRingName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

/** 生成不冲突的环 id（纯函数，单测覆盖） */
export function newRingId(name, taken = []) {
  const base = slugifyRingName(name) || 'ring'
  let id = base
  let n = 2
  while (taken.includes(id)) id = `${base}-${n++}`
  return id
}

/** 环名（给用户看的）—— `device` 是期 3 的设备级指纹伪环，不参与授权。
 *  rev173.424：环自己存的 `label` 优先（允许「修改密钥环名称」对内置环也生效） */
function ringLabel(id, vault) {
  if (id === 'device') return '本机设备'
  const ring = getRing(vault ?? store.vault, id)
  return ring?.label || RING_LABEL[id] || id
}

const RING_HINT = {
  notes: '私密笔记用这把密码。与账号密码分开 —— 这把泄露不影响密码库。',
  secrets: '账号密码库用这把密码。与私密笔记分开，60 秒无操作自动锁。',
}
/** 面板提示：自定义环没有专属文案 */
function ringHint(id) {
  return RING_HINT[id] ?? '这把密码只用来解开这个环；与别的环互不派生。'
}
/** 空闲检查间隔（不是锁定时间；锁定时间按环的 idleLockMs 判） */
const IDLE_CHECK_MS = 3000
/** 外部写入后重读 vault 的间隔（rev173.393；只在前台 + 未解锁时生效） */
const VAULT_RECHECK_MS = 30_000
/** 锁定后自动弹生物识别：先让面板切到「已锁定」再弹，免得弹窗盖住刷新 */
const AUTO_UNLOCK_DELAY_MS = 600
/** 锁定时应用不在前台 ⇒ 挂起这次自动弹；用户 5 分钟没回来就当他不想要 */
const AUTO_UNLOCK_PENDING_MS = 5 * 60 * 1000

/** 面板 bind 名 */
const B = {
  pw1: 'security.pw1',
  pw2: 'security.pw2',
  oldPw: 'security.oldPw',
  newPw: 'security.newPw',
  /** 修改弹窗里「再次输入新主密码」（rev173.424） */
  newPw2: 'security.newPw2',
  question: 'security.question',
  answer: 'security.answer',
  code: 'security.code',
  /** 新建自定义密钥环（期 3 · 动态环）：名称 + 独立的两只密码框 */
  ringName: 'security.ringName',
  ringPw1: 'security.ringPw1',
  ringPw2: 'security.ringPw2',
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

/* ───────────────────────── 生物识别适配器（真机实现） ───────────────────────── */

const isAndroid = () => /android/i.test(globalThis.navigator?.userAgent ?? '')

/** Tauri 2 的 IPC 入口（插件宿主跑在同一个 WebView 里，直接用内部 invoke） */
function tauriInvoke() {
  return globalThis.__TAURI_INTERNALS__?.invoke
}

/**
 * Android 适配器：官方 `tauri-plugin-biometric`（0.5.0 起随包装入）。
 *
 * `biometric_cipher` 的语义：Keystore 里的 AES-256-GCM 密钥 `setUserAuthenticationRequired(true)`，
 * **每次调用都要一次指纹**；返回 `base64(密文);base64(iv)`。明文只在这次 IPC 里出现。
 */
export function androidBiometricAdapter(invoke) {
  return {
    platform: 'android',
    async seal(dek, ringId) {
      const r = await invoke('plugin:biometric|biometric_cipher', {
        reason: '绑定指纹，之后免输主密码解锁 ZeroNote',
        title: `绑定指纹 · ${ringLabel(ringId)}`,
        dataToEncrypt: toB64url(dek),
      })
      return r?.data
    },
    async open(wrapped, ringId) {
      const r = await invoke('plugin:biometric|biometric_cipher', {
        reason: '用指纹解锁 ZeroNote',
        title: `指纹解锁 · ${ringLabel(ringId)}`,
        dataToDecrypt: wrapped,
      })
      return fromB64url(r?.data ?? '')
    },
  }
}

/**
 * Windows 适配器（期 2c · rev173.169）：`KeyCredentialManager` 签名 → HKDF → KEK →
 * 用本文件的 XChaCha 包裹 DEK。
 *
 * 签名是 **RSA-PKCS1 v1.5 + SHA256**（确定性）⇒ 同一个 challenge 每次签出同一份签名 ⇒
 * HKDF 出同一把 KEK。challenge 随机、随包裹一起存在 vault 里（它本身不是秘密）。
 *
 * 包裹格式：`hello1.<challenge>.<zn1.nonce.ct>`（`zn1` 段里还有两个点，解析时按前两段切）。
 */
export function windowsHelloAdapter(invoke, libs) {
  const aad = (ringId) => `hello|${ringId}|dek`
  const kekOf = (sig, ringId) =>
    libs.hkdf(libs.sha256, sig, utf8.encode(`ZeroNote:${ringId}`), utf8.encode('zn-hello-kek'), 32)

  return {
    platform: 'windows',
    async seal(dek, ringId) {
      const accountId = `ZeroNote:${ringId}`
      await invoke('hello_enroll', { accountId })
      const challenge = libs.randomBytes(32)
      const sigB64 = await invoke('hello_sign', { accountId, challenge: toB64url(challenge) })
      const kek = kekOf(fromB64url(sigB64), ringId)
      try {
        return `hello1.${toB64url(challenge)}.${seal(libs, kek, aad(ringId), dek)}`
      } finally {
        wipe(kek)
      }
    },
    async open(blob, ringId) {
      const parts = String(blob ?? '').split('.')
      if (parts[0] !== 'hello1' || parts.length < 4) {
        throw new Error('Windows Hello 包裹格式不认识')
      }
      const challenge = fromB64url(parts[1])
      const wrapped = parts.slice(2).join('.')
      const accountId = `ZeroNote:${ringId}`
      const sigB64 = await invoke('hello_sign', { accountId, challenge: toB64url(challenge) })
      const kek = kekOf(fromB64url(sigB64), ringId)
      try {
        return open(libs, kek, aad(ringId), wrapped)
      } finally {
        wipe(kek)
      }
    },
  }
}

/**
 * 探测本机可用的生物识别适配器。失败一律返回 null（静默 = 面板不显示入口），
 * 但**不吞掉"有硬件没录指纹"**：status.isAvailable=false 时同样返回 null，
 * 用户去系统设置录一枚指纹后重新打开面板即可。
 */
/**
 * 本机设备 id（rev173.173）：生物识别绑定按设备存，本机 id 放**凭据管理器**（不随库同步）。
 * 拿不到（老内核 / 凭据管理器不可用）⇒ 退回 `'local'`，行为等同改造前的单段。
 */
async function resolveDeviceId(api) {
  try {
    const saved = await api.host.secrets.get(DEVICE_ID_ACCOUNT)
    if (saved) return String(saved)
    const fresh =
      globalThis.crypto?.randomUUID?.() ??
      `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
    await api.host.secrets.set(DEVICE_ID_ACCOUNT, fresh)
    return fresh
  } catch {
    return 'local'
  }
}

async function detectBiometric() {
  if (isAndroid()) {
    const invoke = tauriInvoke()
    if (!invoke) return null
    try {
      const st = await invoke('plugin:biometric|status')
      if (!st?.isAvailable) return null
      return androidBiometricAdapter(invoke)
    } catch {
      return null
    }
  }
  // Windows：Kernel 的 hello_* 命令（rev173.169）。非 Windows 桌面直接跳过。
  if (/Windows/i.test(globalThis.navigator?.userAgent ?? '')) {
    const invoke = tauriInvoke()
    if (!invoke) return null
    try {
      if (!(await invoke('hello_available'))) return null
      return windowsHelloAdapter(invoke, await loadLibs())
    } catch {
      return null
    }
  }
  return null
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
  /** 本机生物识别适配器（探测失败 = null，面板不显示入口） */
  biometric: null,
  /** 本机设备 id（rev173.173：`biometrics` 按设备存；resolved 在 apply 里 —— 见 resolveDeviceId） */
  deviceId: 'local',
  /** 密钥环分配表（期 3 · rev173.416）：`{ rings: { 环: 插件 }, demand: { 插件: true } }`，本机文件、不同步 */
  grants: emptyGrants(),
  /** 本机设备级指纹绑定（期 3）：`{ platform, wrapped, at }`；没有 = 这台没绑过 */
  deviceFile: null,
  /** 分配菜单展开在哪把环的行下（rev173.424 · 用户：点「未分配」文字弹出选择菜单） */
  assignMenuFor: '',
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

/* ───────────────────────── 落盘（按环拆文件 · rev173.182） ───────────────────────── */

/**
 * 读 vault：**先新结构、再旧单文件**。
 *
 * 新结构 = 每个环一个 `vault.<环id>.json`，各自一个同步单元（见 `vaultFileOf` 的注释）。
 * 旧单文件只在"还没迁移过"的库上出现；读到时内存里拼成 `{ rings }`，**下一次保存顺手迁移**。
 */
async function loadVault(api) {
  // ① 新结构：扫 `.zn/security/vault.*.json` —— 内置两个 + 用户新建的环都靠文件名发现
  const rings = {}
  let found = false
  let files = []
  try {
    files = await api.fs.listFiles(VAULT_DIR)
  } catch {
    files = [] // 目录还没建（首次使用，正常态）
  }
  const ids = new Set(BUILTIN_RINGS)
  for (const rel of files) {
    const name = String(rel).split('/').pop() ?? ''
    const m = /^vault\.([a-z0-9-]+)\.json$/.exec(name)
    if (m) ids.add(m[1])
  }
  for (const id of ids) {
    const file = vaultFileOf(id)
    let text
    try {
      text = await api.fs.readText(file)
    } catch {
      continue // 没有这个文件是正常态（那个环还没建）
    }
    try {
      rings[id] = parseVaultPart(text)
      found = true
    } catch {
      // 文件在、却读不懂 ⇒ 坏盘 / 别的版本。**不清空、不覆盖**
      store.corrupt = true
      return createVault()
    }
  }
  if (found) return { v: 1, rings }

  // ② 回落旧单文件（还带两个环的合集）
  let text
  try {
    text = await api.fs.readText(LEGACY_VAULT_FILE)
  } catch {
    return createVault() // 首次使用（正常态）
  }
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || !parsed.rings) throw new Error('结构不对')
    return parsed
  } catch {
    store.corrupt = true
    return createVault()
  }
}

/** vault 内容指纹：只在「磁盘真的变了」时刷新面板，定时器每轮不重渲染 */
export function vaultSignature(v) {
  try {
    return JSON.stringify(v ?? null)
  } catch {
    return ''
  }
}

/**
 * 重读判定（rev173.393 纯函数，单测覆盖）：
 * 「有环已解锁」「坏盘」「内容没变」三种情况都不该重读。
 *
 * 为什么解锁中不重读：内存里的 DEK 与磁盘环必须对应 —— 同步把环换掉后重读，
 * 会让刚解锁的会话对着新环的 KDF 参数加密，下一次保存就写出一堆解不开的密文。
 */
export function vaultNeedsReload({ liveCount, corrupt, prevSig, nextVault }) {
  if (liveCount > 0 || corrupt) return false
  return vaultSignature(nextVault) !== prevSig
}

/**
 * 重读 vault（rev173.393）：同步 / 外部写入 `.zn/security/vault.*.json` 后，
 * 面板原本只在 `apply()` 读一次 ⇒ 一直显示「还没建立密钥环」。
 *
 * 边界见 `vaultNeedsReload`；只在内容真变了才 refresh，避免定时器每轮重渲染。
 */
async function reloadVaultIfChanged(api, reason) {
  const next = await loadVault(api).catch(() => null)
  if (!next) return false
  const ok = vaultNeedsReload({
    liveCount: live.size,
    corrupt: store.corrupt,
    prevSig: store.sig,
    nextVault: next,
  })
  if (!ok) return false
  store.vault = next
  store.sig = vaultSignature(next)
  api.host.log?.('info', `[security] vault 变化（${reason}）⇒ 面板已重读`)
  api.view.refresh(PANEL_ID)
  return true
}

/**
 * 删掉迁移前的旧单文件（`saveVault` 的收尾 + 插件加载时的残留自愈）。
 *
 * ⚠️ **不能**写成 `.catch(() => {})`（rev173.184 手机走查踩到）：Android 上删除可能**静默失败**，
 * 面板照样报「主密码已换」。实测还有第二种形态 —— **删掉之后又被写回来**（mtime 更新、内容与
 * 迁移前逐字节相同，主窗口的 invoke hook 抓不到是谁写的）。所以这里删完**等一拍再看一眼**，
 * 还在就再删一轮；两轮都不行才通知用户（文案带真实错误，方便定位）。
 */
async function purgeLegacy(api) {
  let err = ''
  for (let round = 0; round < 2; round++) {
    try {
      await api.fs.purgePrivate(LEGACY_VAULT_FILE)
      err = ''
    } catch (e) {
      err = String(e?.message ?? e)
    }
    // 还在 ⇒ 下一轮再删
    if (await api.fs.exists(LEGACY_VAULT_FILE).catch(() => false)) continue
    // 删掉了 —— 等一拍确认不是「删掉又被写回」
    await new Promise((r) => setTimeout(r, 1500))
    if (!(await api.fs.exists(LEGACY_VAULT_FILE).catch(() => false))) return
  }
  api.host.notify(legacyPurgeWarning(err), 'warn')
}

/**
 * 写 vault —— **只写改动的那一把环**（`onlyRing`）。
 *
 * 为什么必须按环写而不是整份：两台设备各改一个环的密码时，只有各自那个文件变 ⇒
 * 同步不会误判冲突。传 `null` 表示"全部写一遍"（一次性迁移 / 全量修复时用）。
 *
 * 迁移：旧单文件还在 ⇒ 这次把**所有环**都写出来，成功后再删旧文件。
 * 它现在会过期（拆开后就没人再更新它），留着反而会被同步插件当成第二份数据搬来搬去。
 */
async function saveVault(api, vault, onlyRing = null) {
  if (store.corrupt) {
    throw new Error('vault 读不懂，已停止写入（避免覆盖原文件）。请先备份并检查 .zn/security/')
  }
  try {
    await api.fs.mkdir(VAULT_DIR)
  } catch {
    /* 目录已存在 */
  }
  const legacyExists = await api.fs.exists(LEGACY_VAULT_FILE).catch(() => false)
  const ids = legacyExists || !onlyRing ? Object.keys(vault.rings) : [onlyRing]
  for (const id of ids) {
    const ring = vault.rings[id]
    if (!ring) {
      await api.fs.purgePrivate(vaultFileOf(id)).catch(() => {})
      continue
    }
    await api.fs.writeText(vaultFileOf(id), vaultPartPayload(ring))
  }
  if (legacyExists) await purgeLegacy(api)
}

/* ───────────────────────── 授权表落盘（本机 · 不同步） ───────────────────────── */

async function loadGrants(api) {
  try {
    return parseGrants(await api.fs.readText(GRANTS_FILE))
  } catch {
    return emptyGrants() // 第一次用（正常态）：默认谁都没授权
  }
}

async function saveGrants(api, grants) {
  try {
    await api.fs.mkdir(VAULT_DIR)
  } catch {
    /* 目录已存在 */
  }
  await api.fs.writeText(GRANTS_FILE, JSON.stringify(grants, null, 2))
}

/** 串行写：多个插件同时声明需求时别互相覆盖 */
let grantsWrite = Promise.resolve()

/**
 * 登记一次「这个插件需要一个密钥环」（面板下拉 + 落盘）。
 * 同一个插件只登记一次 —— 不重复写盘、不重复刷新。
 */
function noteDemand(api, pluginId) {
  if (store.grants.demand?.[pluginId]) return Promise.resolve()
  store.grants = withDemand(store.grants, pluginId)
  api.view.refresh(PANEL_ID)
  grantsWrite = grantsWrite
    .then(() => saveGrants(api, store.grants))
    .catch((e) => api.host.log('warn', `[security] 密钥需求没落盘：${String(e?.message ?? e)}`))
  return grantsWrite
}

/**
 * 解析调用方拿到的环（crypto 服务的每个动作都过它）。
 *
 * - 没分配 ⇒ 登记需求 + 抛**可操作**的错误（「请先分配一个密钥环」）
 * - 分配了但调用方还传了别的环 id ⇒ 一律以**分配表**为准（插件不能借别人的环）
 *
 * 抛错而不是返回空：`crypto` 是硬返回服务，静默给空会让消费者把「没分配」
 * 当成「数据坏了 / 密码不对」，排查成本远高于一条明确报错（2026-11-07 用户拍板）。
 */
function needRing(api, caller) {
  const ringId = pluginRing(store.grants, caller)
  if (ringId) return ringId
  void noteDemand(api, caller)
  throw new Error(noRingError(caller))
}

/* ───────────────────────── 解锁 / 锁定 ───────────────────────── */

/**
 * 锁定时应用在不在前台（rev173.171）—— 两平台的判据不一样：
 *
 * - **桌面**：窗口失焦就等。Windows Hello 的验证对话框会**抢焦点**，
 *   用户人已经在别的应用里时弹出来是打扰；等他点回窗口（`focus`）再弹。
 * - **手机**：WebView 常常没有真实键焦点（`document.hasFocus()` 恒 false），
 *   只看可见性 —— 切后台是 `hidden`，回到前台触发一次 `visibilitychange` / `focus`。
 */
export function shouldWaitForFocus({ platform, visibility, hasFocus }) {
  if (visibility === 'hidden') return true
  if (platform === 'android') return false
  return hasFocus !== true
}

/**
 * 锁定后要不要自动弹生物识别（纯函数，单测覆盖）。
 * `'go'` 立刻弹 · `'wait'` 等窗口回到前台 · `'skip'` 完全不弹。
 */
export function planAutoUnlock({
  hasBiometric,
  adapterReady,
  unlocked,
  busy,
  reason,
  platform,
  visibility,
  hasFocus,
}) {
  if (!hasBiometric) return 'skip' // 这个环没绑生物识别
  if (!adapterReady) return 'skip' // 本机没有可用适配器
  if (unlocked) return 'skip' // 已经解锁（锁的瞬间又解了）
  if (busy) return 'skip' // 正在派生密钥 = 用户正在主动解锁，别插队
  if (reason === 'service') return 'skip' // 别的插件程序性锁定：用户可能不在这个界面
  return shouldWaitForFocus({ platform, visibility, hasFocus }) ? 'wait' : 'go'
}

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
  // 最后一个环锁了 ⇒ 设备级 DK 也清掉（期 3：一次认证只在这一段解锁期内有效）
  if (live.size === 0 && deviceKey) {
    wipe(deviceKey)
    deviceKey = null
  }
  // 锁定时不把主密码留在输入框里（自动弹的「用户正在输入」判据也靠它）
  clearInputs(api, B.pw1)
  api.event.emit('security:locked', { ringId, reason })
  api.view.refresh(PANEL_ID)
  scheduleAutoUnlock(api, ringId, reason)
  return true
}

/* ───────────── 锁定后自动弹生物识别（rev173.171） ───────────── */

let autoUnlockTimer = null
/** 锁定时不在前台 ⇒ 挂起这一次等用户回来：`{ ringId, until }` */
let autoUnlockPending = null
/** 生物识别请求进行中（自动 / 手动都算），防重入 */
let biometricInFlight = false
/** 设备级解锁密钥 DK（期 3）：解出后只在内存，最后一个环锁定时清空 */
let deviceKey = null

function cancelAutoUnlock() {
  if (autoUnlockTimer) clearTimeout(autoUnlockTimer)
  autoUnlockTimer = null
  autoUnlockPending = null
}

/** 当前前台状态 + 适配器平台（判据在纯函数里，单测覆盖） */
function appVisibility() {
  try {
    return {
      platform: store.biometric?.platform ?? '',
      visibility: globalThis.document?.visibilityState ?? 'visible',
      hasFocus: globalThis.document?.hasFocus?.() === true,
    }
  } catch {
    return { platform: '', visibility: 'visible', hasFocus: true }
  }
}

/** 锁定后安排一次自动弹（同一时刻只排一个） */
function scheduleAutoUnlock(api, ringId, reason) {
  if (ringId !== store.selected) return // 锁的不是用户正看的环：面板上给按钮，不打扰
  cancelAutoUnlock()
  const ring = getRing(store.vault, ringId)
  const plan = planAutoUnlock({
    hasBiometric: Boolean(deviceBinding(ring, store.deviceId)),
    adapterReady: Boolean(store.biometric),
    unlocked: live.has(ringId),
    busy: Boolean(store.busy),
    reason,
    ...appVisibility(),
  })
  if (plan === 'skip') return
  if (plan === 'wait') {
    autoUnlockPending = { ringId, until: Date.now() + AUTO_UNLOCK_PENDING_MS }
    return
  }
  autoUnlockTimer = setTimeout(() => {
    autoUnlockTimer = null
    runAutoUnlock(api, ringId)
  }, AUTO_UNLOCK_DELAY_MS)
}

/** 到点了再核一遍：这几百毫秒里用户可能已经自己解锁 / 开始输主密码 */
function runAutoUnlock(api, ringId) {
  if (live.has(ringId)) return cancelAutoUnlock()
  if (String(ui[B.pw1] ?? '').trim()) return cancelAutoUnlock() // 用户正在输主密码
  return doBiometricUnlock(api, { auto: true, ringId })
}

/** 窗口回到前台：把挂起的那次补弹出来（超过 5 分钟就作废，让用户自己点） */
function resumeAutoUnlock(api) {
  const pending = autoUnlockPending
  if (!pending) return
  if (Date.now() > pending.until) return cancelAutoUnlock()
  if (shouldWaitForFocus(appVisibility())) return
  autoUnlockPending = null
  autoUnlockTimer = setTimeout(() => {
    autoUnlockTimer = null
    runAutoUnlock(api, pending.ringId)
  }, AUTO_UNLOCK_DELAY_MS)
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
  if (!ring) throw new Error(`「${ringLabel(ringId)}」还没建立`)
  if (!password) throw new Error('请输入主密码')
  const L = await loadLibs()
  const { dek } = unlockRing(L, ring, password)
  live.set(ringId, { dek, lastActive: Date.now() })
  api.event.emit('security:unlocked', { ringId })
  return true
}

/* ───────────────────────── 面板 ───────────────────────── */

/**
 * 面板结构（导出给单测断言：空库必须出现"建立密钥环"，建立后必须出现"解锁"）。
 */
/**
 * 面板结构（导出给单测断言）—— **rev173.421：列表页**。
 *
 * 每个环一行：环名（点开解锁 / 管理弹窗）/ 分配下拉 / ✓ / 测试 / 删除。
 * 建立、解锁、换密码、新建全部走**宿主真弹窗**（`host.dialog`），不再嵌在面板里。
 *
 * 为什么改：旧面板把「环切换 + 建立 + 解锁 + 恢复 + 换密码 + 新建 + 分配」全堆一屏，
 * 手机上一屏根本放不下；用户 2026-11-08 给的示意图就是「列表 + 弹窗」。
 */
export function panelNode(view) {
  const {
    vault,
    unlocked = {},
    busy = '',
    message = '',
    tone = 'info',
    recoveryCodeShown = '',
    corrupt = false,
    grants = emptyGrants(),
    plugins = [],
    /** 这台设备绑过指纹没有（`store.deviceFile`）—— 决定顶部按钮是「绑定」还是「解除」 */
    deviceBound = false,
    /** 分配选择菜单展开在哪把环（rev173.424） */
    assignMenuFor = '',
  } = view ?? {}

  const kids = []

  /* 顶栏（rev173.424，用户 2026-11-08 的示意图）：左「安全 · 自检 · 指纹」，右「新建密钥环」。
     「指纹」= 设备级绑定开关（没绑就绑、已绑就解）；不 disabled —— 绑定不需要先解锁某把环。 */
  kids.push({
    type: 'row',
    align: 'center',
    wrap: true,
    gap: 'sm',
    cssClass: 'zn-sec-ring-row',
    children: [
      {
        type: 'row',
        align: 'center',
        gap: 'sm',
        cssClass: 'zn-sec-ring-left',
        children: [
          { type: 'text', value: '安全', variant: 'title' },
          { type: 'button', label: '自检', onClick: 'security.self-test', variant: 'ghost' },
          {
            type: 'button',
            label: deviceBound ? '指纹（已绑定）' : '指纹',
            onClick: 'security.biometric-toggle',
            variant: 'ghost',
          },
        ],
      },
      {
        type: 'row',
        align: 'center',
        gap: 'sm',
        children: [
          { type: 'button', label: '新建密钥环', onClick: 'security.create-ring', variant: 'ghost' },
        ],
      },
    ],
  })

  /* rev173.432：busy 时给一条**看得见**的反馈 —— 建环点保存后到恢复码弹窗之间有 1–4 秒
     （Argon2 慢哈希），以前只有按钮变灰，用户以为「点了没反应」（rev173.431 手机实测 2.6 秒空窗）。 */
  if (busy) {
    kids.push({
      type: 'text',
      value: `⏳ 正在处理「${ringLabel(busy, vault)}」…（派生密钥需要 1–4 秒，别重复点）`,
      variant: 'caption',
    })
  }

  if (corrupt) {
    kids.push({
      type: 'text',
      value: '⚠️ vault 读不懂：已按空库启动，但**不会写入**（避免覆盖原文件）。请先备份 .zn/security/。',
      variant: 'caption',
      tone: 'error',
    })
  }

  kids.push({ type: 'divider' })

  /* 每个环一行（rev173.424 按示意图）：左「🔒 环名 | 已绑定 X / 未分配」，右「修改 · 解锁 · 删除」。
     「测试」和 ✓ 不再占行（rev173.424 用户：「按截图去掉」）—— 测试命令仍留在命令面板。 */
  const assign = assignRows(grants, allRingIds(vault), plugins)
  for (const row of assign) {
    const ring = getRing(vault, row.ringId)
    const isUnlocked = Boolean(unlocked[row.ringId])
    const owner = row.owner
    kids.push({
      type: 'row',
      align: 'center',
      gap: 'sm',
      cssClass: 'zn-sec-ring-card',
      children: [
        {
          type: 'row',
          align: 'center',
          gap: 'sm',
          cssClass: 'zn-sec-ring-name',
          children: [
            {
              type: 'button',
              label: `${ring ? (isUnlocked ? '🔓' : '🔒') : '＋'} ${ringLabel(row.ringId, vault)}`,
              onClick: 'security.open-ring',
              payload: { ringId: row.ringId },
              variant: 'ghost',
              disabled: busy === row.ringId,
            },
          ],
        },
        {
          /* 绑定状态：卡片正中一列（用户 2026-11-08：「绑定状态居中」） */
          type: 'row',
          align: 'center',
          gap: 'sm',
          cssClass: 'zn-sec-ring-state',
          children: [
            {
              /* rev173.424：点这几个字展开选择菜单（用户：「点击字体后弹出选择菜单」） */
              type: 'link',
              label: owner ? `已绑定${owner}` : ring ? '未分配' : '未建立',
              onClick: ring ? 'security.assign-menu' : 'security.open-ring',
              payload: { ringId: row.ringId },
            },
          ],
        },
        {
          type: 'row',
          align: 'center',
          gap: 'sm',
          cssClass: 'zn-sec-ring-actions',
          children: ring
            ? [
                {
                  type: 'button',
                  label: '修改',
                  onClick: 'security.change-password',
                  payload: { ringId: row.ringId },
                  variant: 'ghost',
                  disabled: busy === row.ringId,
                },
                {
                  type: 'button',
                  /* rev173.432：解锁后按钮直接写「已解锁」（原来只有变灰，用户看不出解没解开） */
                  label: isUnlocked ? '已解锁' : '解锁',
                  onClick: 'security.unlock-ring',
                  payload: { ringId: row.ringId },
                  variant: 'ghost',
                  disabled: busy === row.ringId || isUnlocked,
                },
                {
                  type: 'button',
                  label: '删除',
                  onClick: 'security.delete-ring',
                  payload: { ringId: row.ringId },
                  variant: 'ghost',
                  disabled: busy === row.ringId,
                },
              ]
            : [
                {
                  type: 'button',
                  label: '建立',
                  onClick: 'security.open-ring',
                  payload: { ringId: row.ringId },
                  variant: 'ghost',
                },
              ],
        },
      ],
    })
    /* 选择菜单（rev173.424）：点「未分配 / 已绑定 X」这几个字后，在行下展开。
       **只列「申请了密钥环」的插件**（调过 `crypto.demand()` 的；用户 2026-11-08 要求），
       外加当前已绑定的那一个（历史分配可能来自 demand 之外的旧数据，别让它看不见）。
       每项一行：左插件名（点它就分配），右当前状态「已绑定 / 未绑定」。 */
    if (ring && assignMenuFor === row.ringId) {
      const demanded = Object.keys(grants?.demand ?? {}).filter((pid) => typeof pid === 'string' && pid)
      const menuIds = [...new Set([...demanded, ...(owner ? [owner] : [])])].sort()
      kids.push({
        type: 'stack',
        gap: 'sm',
        cssClass: 'zn-sec-assign-menu',
        children: [
          {
            type: 'button',
            label: owner ? '未分配' : '未分配（当前）',
            onClick: 'security.assign-ring',
            payload: { ringId: row.ringId, pluginId: '' },
            variant: 'ghost',
          },
          ...menuIds.map((pid) => ({
            type: 'button',
            label: `${pid}${pluginRing(grants, pid) ? ' · 已绑定' : ' · 未绑定'}`,
            onClick: 'security.assign-ring',
            payload: { ringId: row.ringId, pluginId: pid },
            variant: 'ghost',
          })),
          ...(menuIds.length
            ? []
            : [
                {
                  type: 'text',
                  value: '还没有插件申请密钥环 —— 打开一次「密码库 / 私密笔记」后会自动申请',
                  variant: 'caption',
                  tone: 'muted',
                },
              ]),
        ],
      })
    }
  }

  kids.push({ type: 'divider' })
  kids.push({
    type: 'text',
    value: '自定义环随笔记本同步；「密钥环分配」是本机信任关系，不同步。',
    variant: 'caption',
    tone: 'muted',
  })

  if (recoveryCodeShown) {
    kids.push({ type: 'divider' })
    kids.push({ type: 'text', value: '📋 恢复码（只显示这一次，抄下来存好）：', variant: 'body' })
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
function panelView(plugins = []) {
  const ringIds = allRingIds(store.vault)
  const unlocked = {}
  for (const id of ringIds) unlocked[id] = live.has(id)
  const ring = getRing(store.vault, store.selected)
  return {
    ringIds,
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
    hasBiometric: Boolean(deviceBinding(ring, store.deviceId)),
    biometricReady: Boolean(store.biometric),
    /** 期 3：这台设备绑过指纹（设备级 DK 文件在） */
    deviceBound: Boolean(store.deviceFile),
    /** 期 3：当前这个环继承了本机指纹（`deviceWrapped` 在） */
    ringInherited: Boolean(ring?.deviceWrapped),
    /** 别的设备绑过几份（本机没有时提示「别的设备已绑定」） */
    otherBiometrics: otherDeviceCount(ring, store.deviceId),
    /** 密钥环分配表（期 3）：面板底部始终显示，值 `{ rings, demand }` */
    grants: store.grants,
    /** 已安装插件 id（rev173.420）：分配下拉的候选来源之一 */
    plugins,
    /** 分配菜单当前展开在哪把环（rev173.424） */
    assignMenuFor: store.assignMenuFor,
  }
}

/**
 * 已安装插件 id（rev173.420）。
 *
 * - 宿主新版本才有 `host.installedPlugins()` ⇒ 老宿主用可选链兜底成空数组
 *   （面板退回「只列声明过需求的插件」，不会因为方法缺失整页崩掉）
 * - **排除自己**：安全插件不是密钥环的消费者，列出来只会让下拉多一个永远无效的选项
 */
function installedPluginIds(api) {
  try {
    const list = api?.host?.installedPlugins?.()
    if (!Array.isArray(list)) return []
    return list
      .map((p) => (typeof p === 'string' ? p : p?.id))
      .filter((id) => typeof id === 'string' && id && id !== 'security')
  } catch {
    return []
  }
}

/* ───────────────────────── 命令 ───────────────────────── */

/**
 * 把某个密钥环分配给一个插件 / 解除分配（rev173.416 · 冲突拒绝见 rev173.417）。
 *
 * 下拉的 `value` 编成 `<ringId>::<pluginId>`（空 pluginId = 未分配）—— 契约的 select
 * 只回传 `{ value }`，环 id 只能编码进值里。改动立即落盘：provider 闭包每次调用
 * 都读 `store.grants`，不需要重跑工厂、也不需要重载插件。
 *
 * **冲突不替换**（用户 2026-11-07）：「新密钥无法分配给已分配密钥的插件，直接提示已有密钥」
 * ⇒ 插件已有环 / 环已有主人时只提示、不落盘，并 refresh 让下拉弹回真实值。
 */
/**
 * 点「未分配 / 已绑定 X」这几个字：展开 / 收起该环的选择菜单（rev173.424）。
 * 菜单在 `panelNode` 里就地渲染（宿主 dialog 的正文按钮点了不会自动关，内联更顺手）。
 */
async function doAssignMenu(api, payload) {
  const ringId = String(payload?.ringId ?? '')
  if (!isRingId(ringId)) return
  store.assignMenuFor = store.assignMenuFor === ringId ? '' : ringId
  api.view.refresh(PANEL_ID)
}

async function doAssignRing(api, payload) {
  /* rev173.424：选择菜单直接给 { ringId, pluginId }；旧的 select 值 `<ringId>::<pluginId>` 仍兼容 */
  const hasDirect = payload && typeof payload === 'object' && 'pluginId' in payload
  const raw = String(payload?.value ?? '')
  let ringId
  let pluginId
  if (hasDirect) {
    ringId = String(payload.ringId ?? '')
    pluginId = String(payload.pluginId ?? '').trim()
  } else {
    const cut = raw.indexOf('::')
    if (cut < 0) return
    ringId = raw.slice(0, cut)
    pluginId = raw.slice(cut + 2).trim()
  }
  if (!isRingId(ringId)) return
  store.assignMenuFor = '' // 选完就收起菜单
  const before = ringOwner(store.grants, ringId)
  if ((before ?? '') === pluginId) {
    api.view.refresh(PANEL_ID)
    return
  }
  const why = assignConflict(store.grants, ringId, pluginId)
  if (why) {
    // 宿主已经把下拉的新值写进 state ⇒ 重渲染时 render 的播种会把它改回真实值
    setStatus(api, why, 'warn')
    api.view.refresh(PANEL_ID)
    return
  }
  store.grants = withAssign(store.grants, ringId, pluginId)
  const label = ringLabel(ringId)
  try {
    await saveGrants(api, store.grants)
    setStatus(
      api,
      pluginId ? `已把「${label}」分配给「${pluginId}」` : `已解除「${label}」的分配`,
      pluginId ? 'success' : 'info',
    )
  } catch (e) {
    setStatus(api, `分配没保存：${String(e?.message ?? e)}`, 'error')
  }
}

/**
 * 删除一把密钥环（rev173.420）。用户 2026-11-08 拍板：「密钥环无法删除」⇒ 加删除入口，
 * **删除前必须输入该环主密码**（二次确认就是这把密码 —— 空点一下就删太容易误删，
 * 而环里的数据删掉不可恢复）。
 *
 * 顺序刻意如此：
 *  ① 先校验密码（解包裹成功 = 密码对；DEK 立刻 wipe，不进 `live`、不触发自动锁定计时）
 *  ② 再删磁盘文件，并**确认真的删掉了**（Android 上 `purgePrivate` 可能静默失败）
 *  ③ 最后才动内存（vault / live / 分配表）—— 文件删不掉时内存与磁盘必须保持一致，
 *     否则 next `loadVault()` 会把「删过」的环重新扫回来（用户看到环复活却不知道为什么）
 */
async function doDeleteRing(api, payload) {
  const ringId = String(payload?.ringId ?? '')
  if (!isRingId(ringId)) return
  const ring = getRing(store.vault, ringId)
  if (!ring) return setStatus(api, `密钥环「${ringLabel(ringId)}」还没建立，没有可删的东西`, 'warn')
  const label = ringLabel(ringId, store.vault)

  if (typeof api.host?.prompt !== 'function') {
    return setStatus(api, '当前应用版本过旧（没有输入对话框），无法删除密钥环 —— 请更新 ZeroNote', 'warn')
  }

  let password
  try {
    password = await api.host.prompt({
      title: `删除密钥环「${label}」`,
      message: '输入这把环的主密码确认删除。删除后这个环里的数据（用它加密的笔记 / 账号）无法恢复。',
      placeholder: '主密码',
      secret: true,
      okText: '删除',
      cancelText: '取消',
    })
  } catch (e) {
    return setStatus(api, `没法弹出输入框：${String(e?.message ?? e)}`, 'error')
  }
  if (password === null) return setStatus(api, '已取消删除', 'info')
  if (!password) return setStatus(api, '没有输入主密码，已取消删除', 'warn')

  /* ① 密码校验：能解包裹 = 密码对；DEK 不进内存 */
  try {
    const L = await loadLibs()
    const { dek } = unlockRing(L, ring, password)
    wipe(dek)
  } catch (e) {
    return setStatus(api, `主密码不对，没有删除：${String(e?.message ?? e)}`, 'error')
  }

  /* ② 删文件 + 复核（静默失败必须说出来 —— 项目规矩「静默失效比报错危险」） */
  const file = vaultFileOf(ringId)
  try {
    await api.fs.purgePrivate(file)
  } catch (e) {
    return setStatus(api, `删除失败（文件没删掉）：${String(e?.message ?? e)}`, 'error')
  }
  if (await api.fs.exists(file).catch(() => false)) {
    return setStatus(api, `删除失败：${file} 还在（可能被同步 / 备份写了回来）—— 再试一次`, 'error')
  }

  /* ③ 内存：环 / 解锁态 / 分配表 */
  store.vault = dropRing(store.vault, ringId)
  live.delete(ringId)
  if (store.selected === ringId) {
    store.selected = allRingIds(store.vault).find((id) => getRing(store.vault, id)) ?? 'notes'
  }
  if (ringOwner(store.grants, ringId)) {
    store.grants = dropRingGrants(store.grants, ringId)
    try {
      await saveGrants(api, store.grants)
    } catch (e) {
      api.host.log?.('warn', `[security] 删环后分配表没落盘：${String(e?.message ?? e)}`)
    }
  }
  setStatus(api, `已删除密钥环「${label}」—— 这个环里的数据已无法恢复`, 'success')
}

/**
 * 新建一把**自定义密钥环**（期 3 · 动态环）：名称 + 主密码两次 → slug 生成 id → 建环。
 *
 * 建完**不自动授权**给任何插件（用户 2026-11-07 拍板：建完在授权区手动勾）。
 * 插件请求的 `ring` 就是它自己传的 id —— 用同名建环即可对上。
 */
/* ───────────────────────── 弹窗（rev173.421 · 列表 + host.dialog） ───────────────────────── */

/** 当前宿主有没有真弹窗（老应用只有 `host.prompt`） */
function hostDialog(api) {
  return typeof api.host?.dialog === 'function'
}

/** 老宿主降级：一次只问一个值（`host.prompt`）；取消 ⇒ null */
async function askOne(api, opts) {
  return api.host.prompt(opts)
}

/**
 * 打开某把环的弹窗：未建立 ⇒ 建立；未解锁 ⇒ 解锁；已解锁 ⇒ 管理。
 * 这是列表页「点环名」的唯一入口 —— 面板里不再内嵌任何表单。
 */
async function doOpenRing(api, payload) {
  const ringId = String(payload?.ringId ?? '')
  if (!isRingId(ringId)) return
  store.selected = ringId
  store.message = ''
  store.recoveryCodeShown = ''
  const ring = getRing(store.vault, ringId)
  if (!ring) return doSetupDialog(api, ringId)
  if (live.has(ringId)) return doManageDialog(api, ringId)
  return doUnlockDialog(api, ringId)
}

/** 建立密钥环的弹窗（恢复问题可选，与旧面板一致） */
async function doSetupDialog(api, ringId) {
  const label = ringLabel(ringId, store.vault)
  if (!hostDialog(api)) {
    const pw1 = await askOne(api, {
      title: `建立「${label}」`,
      message: '主密码至少 8 位',
      placeholder: '主密码',
      secret: true,
      okText: '下一步',
    })
    if (pw1 === null) return setStatus(api, '已取消建立', 'info')
    const pw2 = await askOne(api, {
      title: '再输一次主密码',
      placeholder: '主密码',
      secret: true,
      okText: '建立',
    })
    if (pw2 === null) return setStatus(api, '已取消建立', 'info')
    return doSetup(api, ringId, { pw1, pw2 })
  }
  let res
  try {
    res = await api.host.dialog({
      title: `建立密钥环「${label}」`,
      message: '主密码只用来解这一把环；至少 8 位。',
      body: {
        type: 'stack',
        gap: 'sm',
        children: [
          { type: 'input', bind: B.pw1, secret: true, placeholder: '主密码（至少 8 位）' },
          { type: 'input', bind: B.pw2, secret: true, placeholder: '再输一次' },
          { type: 'input', bind: B.question, placeholder: '恢复问题（可留空，只用恢复码）' },
          { type: 'input', bind: B.answer, secret: true, placeholder: '恢复答案（留空则不设问题）' },
        ],
      },
      actions: [
        { id: 'cancel', label: '取消', variant: 'ghost' },
        { id: 'save', label: '建立密钥环' },
      ],
      width: 460,
    })
  } catch (e) {
    return setStatus(api, `没法弹出对话框：${String(e?.message ?? e)}`, 'error')
  }
  if (!res || res.action !== 'save') return setStatus(api, '已取消建立', 'info')
  return doSetup(api, ringId, {
    pw1: String(res.state[B.pw1] ?? ''),
    pw2: String(res.state[B.pw2] ?? ''),
    question: String(res.state[B.question] ?? ''),
    answer: String(res.state[B.answer] ?? ''),
  })
}

/** 解锁弹窗：主密码 + 指纹（可用时）+ 恢复入口（设过才显示） */
async function doUnlockDialog(api, ringId) {
  const label = ringLabel(ringId, store.vault)
  const ring = getRing(store.vault, ringId)
  const canBio = Boolean(
    (deviceBinding(ring, store.deviceId) || ring?.deviceWrapped) && store.biometric,
  )
  const canAnswer = Boolean(ring?.recovery?.answerWrap)
  const canCode = Boolean(ring?.recovery?.codeWrap)
  if (!hostDialog(api)) {
    const pw = await askOne(api, {
      title: `解锁「${label}」`,
      placeholder: '主密码',
      secret: true,
      okText: '解锁',
    })
    if (pw === null) return setStatus(api, '已取消解锁', 'info')
    return doUnlock(api, ringId, pw)
  }
  const actions = [
    ...(canBio ? [{ id: 'biometric', label: '指纹解锁', variant: 'ghost' }] : []),
    { id: 'cancel', label: '取消', variant: 'ghost' },
    { id: 'unlock', label: '解锁' },
  ]
  const body = {
    type: 'stack',
    gap: 'sm',
    children: [
      { type: 'input', bind: B.pw1, secret: true, placeholder: '主密码' },
      ...(canCode || canAnswer ? [{ type: 'divider' }] : []),
      ...(canCode
        ? [
            {
              type: 'link',
              label: '用恢复码解锁',
              onClick: 'security.recover-code',
              payload: { ringId },
            },
          ]
        : []),
      ...(canAnswer
        ? [
            {
              type: 'link',
              label: '用恢复问题解锁',
              onClick: 'security.recover-answer',
              payload: { ringId },
            },
          ]
        : []),
    ],
  }
  let res
  try {
    res = await api.host.dialog({ title: `解锁「${label}」`, body, actions, width: 420 })
  } catch (e) {
    return setStatus(api, `没法弹出对话框：${String(e?.message ?? e)}`, 'error')
  }
  if (!res) return setStatus(api, '已取消解锁', 'info')
  if (res.action === 'biometric') return doBiometricUnlock(api)
  if (res.action !== 'unlock') return setStatus(api, '已取消解锁', 'info')
  return doUnlock(api, ringId, String(res.state[B.pw1] ?? ''))
}

/**
 * 「修改」弹窗（rev173.424，用户 2026-11-08 的示意图）：
 * 名称 + 三种身份证明（原主密码 / 恢复码 / 恢复问题）+ 新主密码两遍；
 * 底部「指纹验证修改」可以不给原密码，直接用本机指纹解出 DEK 重包。
 */
async function doManageDialog(api, ringId) {
  const label = ringLabel(ringId, store.vault)
  const ring = getRing(store.vault, ringId)
  if (!ring) return setStatus(api, '这个环还没建立', 'warn')
  /* 「指纹验证修改」在**这台设备绑过指纹**时就给（用户图里有这一按钮）——
     环自己还没继承时点它会有明确提示，而不是干脆看不到入口 */
  const bound = Boolean(store.deviceFile)
  const canAnswer = Boolean(ring?.recovery?.answerWrap)
  const canCode = Boolean(ring?.recovery?.codeWrap)
  if (!hostDialog(api)) {
    const oldPw = await askOne(api, {
      title: `换「${label}」的主密码`,
      placeholder: '当前主密码',
      secret: true,
      okText: '下一步',
    })
    if (oldPw === null) return setStatus(api, '已取消', 'info')
    const newPw = await askOne(api, {
      title: '新主密码',
      placeholder: '新主密码（至少 8 位）',
      secret: true,
      okText: '换主密码',
    })
    if (newPw === null) return setStatus(api, '已取消', 'info')
    return doChangePassword(api, ringId, oldPw, newPw)
  }
  const body = {
    type: 'stack',
    gap: 'sm',
    children: [
      { type: 'input', bind: B.ringName, placeholder: '修改密钥环名称' },
      { type: 'input', bind: B.oldPw, secret: true, placeholder: '使用原主密码修改' },
      ...(canCode ? [{ type: 'input', bind: B.code, secret: true, placeholder: '使用恢复码修改' }] : []),
      ...(canAnswer
        ? [
            {
              /* 用户 2026-11-08：不显示「使用恢复问题修改」，直接把当时设的问题读出来当提示词 */
              type: 'input',
              bind: B.answer,
              secret: true,
              placeholder: `请输入《${String(ring?.recovery?.question ?? '恢复问题').trim() || '恢复问题'}》的答案`,
            },
          ]
        : []),
      { type: 'input', bind: B.newPw, secret: true, placeholder: '输入新主密码' },
      { type: 'input', bind: B.newPw2, secret: true, placeholder: '再次输入新主密码' },
    ],
  }
  const actions = [
    ...(bound ? [{ id: 'biometric', label: '指纹验证修改', variant: 'ghost' }] : []),
    { id: 'cancel', label: '取消', variant: 'ghost' },
    { id: 'save', label: '保存修改' },
  ]
  let res
  try {
    res = await api.host.dialog({
      title: '修改密钥环',
      /* 名称预填当前环名（DialogOptions.value 会播种进 state） */
      value: { [B.ringName]: label },
      body,
      actions,
      width: 440,
    })
  } catch (e) {
    return setStatus(api, `没法弹出对话框：${String(e?.message ?? e)}`, 'error')
  }
  if (!res || res.action === 'cancel') return setStatus(api, '已取消', 'info')
  const state = {
    name: String(res.state[B.ringName] ?? '').trim(),
    oldPw: String(res.state[B.oldPw] ?? ''),
    code: String(res.state[B.code] ?? ''),
    answer: String(res.state[B.answer] ?? ''),
    newPw: String(res.state[B.newPw] ?? ''),
    newPw2: String(res.state[B.newPw2] ?? ''),
  }
  if (res.action === 'biometric') return doModifyByBiometric(api, ringId, state)
  return doModifyRing(api, ringId, state)
}

/**
 * 修改弹窗的「保存修改」：改名 / 换主密码（原密码或恢复路径证明身份）。
 * 数据密文一个字节都不动 —— 只重包 DEK。
 */
async function doModifyRing(api, ringId, state) {
  const ring = getRing(store.vault, ringId)
  if (!ring) return setStatus(api, '这个环还没建立', 'warn')
  const oldLabel = ringLabel(ringId, store.vault)
  const name = String(state.name ?? '').trim()
  const newPw = String(state.newPw ?? '')
  const byOld = String(state.oldPw ?? '').length > 0
  const byCode = String(state.code ?? '').trim().length > 0
  const byAnswer = String(state.answer ?? '').length > 0
  const hasPw = newPw.length > 0
  const changedName = Boolean(name) && name !== oldLabel

  if (hasPw) {
    if (newPw.length < 8) {
      return setStatus(api, '新主密码至少 8 位 —— 慢哈希只提高每次猜测的成本，挡不住 123456', 'warn')
    }
    if (newPw !== String(state.newPw2 ?? '')) return setStatus(api, '两次输入的新主密码不一致', 'warn')
  }
  if (!hasPw && !changedName) return setStatus(api, '没有要改的东西：改名称，或填新主密码', 'info')
  if (hasPw && !byOld && !byCode && !byAnswer) {
    return setStatus(
      api,
      '改主密码要先证明身份：原主密码 / 恢复码 / 恢复问题 任填一个，或点「指纹验证修改」',
      'warn',
    )
  }

  try {
    const next = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      let out = ring
      if (hasPw) {
        if (byOld) {
          out = changePassword(L, ring, state.oldPw, newPw)
        } else {
          const dek = byCode ? recoverWithCode(L, ring, state.code) : recoverWithAnswer(L, ring, state.answer)
          try {
            out = resetPasswordWithDek(L, ring, dek, newPw)
          } finally {
            wipe(dek)
          }
        }
      }
      if (changedName) out = { ...out, label: name }
      return out
    })
    store.vault = putRing(store.vault, next)
    await saveVault(api, store.vault, next.id)
    setStatus(
      api,
      hasPw
        ? `「${name || oldLabel}」主密码已换 —— 数据密文一个字节都没动，旧密码从此失效`
        : `已把密钥环名称改为「${name}」`,
      'success',
    )
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (hasPw && byOld) {
      return setStatus(api, '修改失败：原主密码不对（或这个环被改过）', 'error')
    }
    setStatus(api, `修改失败：${msg}`, 'error')
  }
}

/**
 * 「指纹验证修改」：先用本机指纹解出 DEK，再用新主密码重包。
 * 不需要原密码（指纹就是身份证明）；新密码必须填。
 */
async function doModifyByBiometric(api, ringId, state) {
  const ring = getRing(store.vault, ringId)
  if (!ring) return setStatus(api, '这个环还没建立', 'warn')
  const newPw = String(state.newPw ?? '')
  const name = String(state.name ?? '').trim()
  const oldLabel = ringLabel(ringId, store.vault)
  if (!newPw) return setStatus(api, '先填「输入新主密码」（指纹只负责证明身份）', 'warn')
  if (newPw.length < 8) return setStatus(api, '新主密码至少 8 位', 'warn')
  if (newPw !== String(state.newPw2 ?? '')) return setStatus(api, '两次输入的新主密码不一致', 'warn')

  let dek
  try {
    dek = ring.deviceWrapped
      ? await unlockRingByDevice(ringId)
      : await unlockWithBiometric(ring, store.biometric, store.deviceId)
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (/还没绑定|没有绑定|还没继承/.test(msg)) {
      return setStatus(api, '这个环还没继承本机指纹 —— 先用主密码解锁一次，再回来点「指纹验证修改」', 'warn')
    }
    return setStatus(api, `指纹验证失败：${biometricErrorMessage(e)}`, 'error')
  }
  try {
    const next = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      let out = resetPasswordWithDek(L, ring, dek, newPw)
      if (name && name !== oldLabel) out = { ...out, label: name }
      /* 刚才认证过设备指纹（DK 在内存）⇒ 顺手把本环的指纹包裹补上（rev173.430）。
         本环不在 `live` 里，`inheritRings` 覆盖不到它 */
      if (deviceKey && !out.deviceWrapped) {
        try {
          out = { ...out, deviceWrapped: wrapDeviceDek(L, deviceKey, ringId, dek) }
        } catch {
          /* 补不上不影响改密码 */
        }
      }
      return out
    })
    store.vault = putRing(store.vault, next)
    await saveVault(api, store.vault, next.id)
    setStatus(api, `「${name || oldLabel}」主密码已改（指纹验证）`, 'success')
  } catch (e) {
    setStatus(api, `修改失败：${String(e?.message ?? e)}`, 'error')
  } finally {
    wipe(dek)
  }
}

/** 「测试」按钮：只验主密码对不对，**不改锁定状态**（示意图里的「测试」） */
async function doTestRing(api, payload) {
  const ringId = String(payload?.ringId ?? '')
  if (!isRingId(ringId)) return
  const ring = getRing(store.vault, ringId)
  if (!ring) return setStatus(api, `密钥环「${ringLabel(ringId)}」还没建立`, 'warn')
  const label = ringLabel(ringId, store.vault)
  let pw
  if (hostDialog(api)) {
    let res
    try {
      res = await api.host.dialog({
        title: `测试「${label}」`,
        message: '输入主密码验证这个环能不能解开。不会改变锁定状态。',
        body: {
          type: 'stack',
          children: [{ type: 'input', bind: B.pw1, secret: true, placeholder: '主密码' }],
        },
        actions: [
          { id: 'cancel', label: '取消', variant: 'ghost' },
          { id: 'test', label: '验证' },
        ],
        width: 420,
      })
    } catch (e) {
      return setStatus(api, `没法弹出对话框：${String(e?.message ?? e)}`, 'error')
    }
    if (!res || res.action !== 'test') return setStatus(api, '已取消', 'info')
    pw = String(res.state[B.pw1] ?? '')
  } else {
    pw = await askOne(api, {
      title: `测试「${label}」`,
      placeholder: '主密码',
      secret: true,
      okText: '验证',
    })
    if (pw === null) return setStatus(api, '已取消', 'info')
  }
  try {
    const L = await loadLibs()
    const { dek } = unlockRing(L, ring, pw)
    wipe(dek)
    setStatus(api, `「${label}」主密码正确 —— 这个环能解开`, 'success')
  } catch {
    setStatus(api, `「${label}」主密码不对（或这个环被改过）`, 'error')
  }
}

/* ───────────── 环的建立 / 解锁 / 换密码 / 恢复（内部实现，只吃参数） ───────────── */

/**
 * 新建一把**自定义密钥环**（rev173.427）：
 * ① 弹窗收 名称 + 主密码两次；② 建环（内含恢复码）；③ **先弹恢复码**（只显示一次，必须确认）；
 * ④ **再弹恢复问题**（可跳过，跳过就只靠恢复码）。
 * 用户 2026-11-08：「新建密钥环点保存之后，没有弹出恢复码和设置恢复问题」→「先弹恢复码，然后弹恢复问题（可以跳过）」。
 * 建完**不自动授权**给任何插件：回列表点「未分配」分配。
 */
async function doCreateRing(api) {
  let name = ''
  let pw1 = ''
  let pw2 = ''
  if (hostDialog(api)) {
    let res
    try {
      res = await api.host.dialog({
        title: '新建密钥环',
        body: {
          type: 'stack',
          gap: 'sm',
          children: [
            { type: 'input', bind: B.ringName, placeholder: '输入密钥环名称' },
            { type: 'input', bind: B.ringPw1, secret: true, placeholder: '输入主密码' },
            { type: 'input', bind: B.ringPw2, secret: true, placeholder: '再次输入主密码' },
          ],
        },
        actions: [
          { id: 'cancel', label: '取消', variant: 'ghost' },
          { id: 'save', label: '保存密钥环' },
        ],
        width: 440,
      })
    } catch (e) {
      return setStatus(api, `没法弹出对话框：${String(e?.message ?? e)}`, 'error')
    }
    if (!res || res.action !== 'save') return setStatus(api, '已取消新建', 'info')
    name = String(res.state[B.ringName] ?? '').trim()
    pw1 = String(res.state[B.ringPw1] ?? '')
    pw2 = String(res.state[B.ringPw2] ?? '')
  } else {
    const n = await askOne(api, {
      title: '新建密钥环',
      placeholder: '密钥环名称（如 Todo）',
      okText: '下一步',
    })
    if (n === null) return setStatus(api, '已取消新建', 'info')
    const a = await askOne(api, {
      title: '主密码',
      placeholder: '主密码（至少 8 位）',
      secret: true,
      okText: '下一步',
    })
    if (a === null) return setStatus(api, '已取消新建', 'info')
    const b = await askOne(api, {
      title: '再输一次主密码',
      placeholder: '再输一次',
      secret: true,
      okText: '保存密钥环',
    })
    if (b === null) return setStatus(api, '已取消新建', 'info')
    name = n.trim()
    pw1 = a
    pw2 = b
  }

  if (!name) return setStatus(api, '先给这个密钥环起个名字', 'warn')
  if (pw1.length < 8) {
    return setStatus(api, '主密码至少 8 位 —— 慢哈希只提高每次猜测的成本，挡不住 123456', 'warn')
  }
  if (pw1 !== pw2) return setStatus(api, '两次输入的主密码不一致', 'warn')

  const id = newRingId(name, allRingIds(store.vault))
  let code = ''
  try {
    const made = await withBusy(api, id, async () => {
      const L = await loadLibs()
      const created = createRing(L, id, pw1, { containerId: id, label: name })
      /* 恢复码**总是生成**（建环当场就要显示给用户）；恢复问题随后单独问 */
      const recoveryCode = generateRecoveryCode(L)
      let withRecovery = setupRecovery(L, created.ring, created.dek, { code: recoveryCode })
      // 本机已绑定指纹且 DK 在内存 ⇒ 新环直接继承（与内置环建环一致）
      if (deviceKey) {
        try {
          withRecovery = { ...withRecovery, deviceWrapped: wrapDeviceDek(L, deviceKey, id, created.dek) }
        } catch {
          /* 继承失败不影响建环本身 */
        }
      }
      wipe(created.dek)
      return { ring: withRecovery, code: recoveryCode }
    })
    store.vault = putRing(store.vault, made.ring)
    await saveVault(api, store.vault, made.ring.id)
    store.selected = made.ring.id
    code = made.code
    setStatus(api, `已新建密钥环「${name}」—— 请抄下恢复码（只显示这一次）`, 'success')
  } catch (e) {
    return setStatus(api, `新建失败：${String(e?.message ?? e)}`, 'error')
  }

  if (!hostDialog(api)) return

  /* ① 先弹恢复码：必须确认抄下（不可点背景 / ESC 关掉） */
  try {
    await api.host.dialog({
      title: '恢复码（只显示这一次）',
      message: '抄下来存好。忘记主密码时，用它可以重设密码；丢了它 + 忘了密码 = 数据打不开。',
      body: { type: 'stack', gap: 'sm', children: [{ type: 'text', value: code, variant: 'title' }] },
      actions: [{ id: 'ok', label: '我抄好了，下一步' }],
      dismissible: false,
      width: 420,
    })
  } catch {
    /* 弹不出就算了：恢复码已写在 vault 里，用户也能从建环流程再来一次 */
  }

  /* ② 再弹恢复问题：可跳过（跳过 = 只用恢复码） */
  let r2
  try {
    r2 = await api.host.dialog({
      title: '设置恢复问题（可跳过）',
      message: '忘记主密码时还可以答对问题来重设。不填也行 —— 恢复码那条路仍然有效。',
      body: {
        type: 'stack',
        gap: 'sm',
        children: [
          { type: 'input', bind: B.question, placeholder: '恢复问题（如：第一只宠物的名字）' },
          { type: 'input', bind: B.answer, secret: true, placeholder: '恢复答案（至少 2 个字）' },
        ],
      },
      actions: [
        { id: 'skip', label: '跳过', variant: 'ghost' },
        { id: 'save', label: '保存' },
      ],
      width: 420,
    })
  } catch {
    return
  }
  if (!r2 || r2.action !== 'save') {
    return setStatus(api, `「${name}」已建立（恢复问题跳过，仍可用恢复码）—— 点「未分配」分配插件`, 'info')
  }
  const q = String(r2.state[B.question] ?? '').trim()
  const a2 = String(r2.state[B.answer] ?? '').trim()
  if (!q || a2.length < 2) {
    return setStatus(api, '恢复问题 / 答案没填全 —— 这次没设问题，恢复码仍然有效', 'warn')
  }
  await attachRecovery(api, id, pw1, code, q, a2)
}

/**
 * 给已建立的环补上恢复问题（rev173.427）：用刚输入的主密码重新解出 DEK，
 * 再连同**同一个恢复码**一起重包。数据密文一个字节都不动。
 */
async function attachRecovery(api, ringId, password, code, question, answer) {
  const ring = getRing(store.vault, ringId)
  if (!ring) return
  try {
    const next = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      const { dek } = unlockRing(L, ring, password)
      try {
        return setupRecovery(L, ring, dek, { question, answer, code })
      } finally {
        wipe(dek)
      }
    })
    store.vault = putRing(store.vault, next)
    await saveVault(api, store.vault, next.id)
    setStatus(api, `「${ringLabel(ringId, store.vault)}」已建立，恢复问题也设好了`, 'success')
  } catch (e) {
    setStatus(api, `恢复问题没保存：${String(e?.message ?? e)}（恢复码仍然有效）`, 'error')
  }
}

async function doSetup(api, ringId, { pw1 = '', pw2 = '', question = '', answer = '' } = {}) {
  if (pw1.length < 8) {
    return setStatus(api, '主密码至少 8 位 —— 慢哈希只提高每次猜测的成本，挡不住 123456', 'warn')
  }
  if (pw1 !== pw2) return setStatus(api, '两次输入的主密码不一致', 'warn')

  try {
    const { ring, code } = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      const created = createRing(L, ringId, pw1, { containerId: ringId })
      const recoveryCode = generateRecoveryCode(L)
      let withRecovery = setupRecovery(L, created.ring, created.dek, {
        question,
        answer,
        code: recoveryCode,
      })
      // 期 3：本机已绑定且有 DK 在内存 ⇒ 新环**立刻继承**指纹（不额外弹一次认证）
      if (deviceKey) {
        withRecovery = {
          ...withRecovery,
          deviceWrapped: wrapDeviceDek(L, deviceKey, ringId, created.dek),
        }
      }
      wipe(created.dek) // 建立后就用不到了（下次解锁时再解出来）
      return { ring: withRecovery, code: recoveryCode }
    })

    store.vault = putRing(store.vault, ring)
    await saveVault(api, store.vault, ring.id)
    store.recoveryCodeShown = code
    setStatus(api, `「${ringLabel(ringId)}」已建立。请抄下恢复码。`, 'success')
    api.host.notify('密钥环已建立 —— 恢复码只显示一次，请抄下来', 'info')
  } catch (e) {
    setStatus(api, `建立失败：${String(e?.message ?? e)}`, 'error')
  }
}

async function doUnlock(api, ringId, pw) {
  cancelAutoUnlock() // 用户已经在走主密码这条路，别再弹指纹
  try {
    await withBusy(api, ringId, () => unlockWithPassword(api, ringId, String(pw ?? '')))
    // 解锁后恢复码提示可以收了（已抄过的用户不希望它一直挂在屏幕上）
    store.recoveryCodeShown = ''
    setStatus(api, `「${ringLabel(ringId)}」已解锁`, 'success')
  } catch {
    // 密码错时不说是"密码错"以外的信息（不给 oracle）；AEAD 失败的原文也没用
    setStatus(api, '解不开：主密码不对，或 vault 被改过', 'error')
  }
}

async function doChangePassword(api, ringId, oldPw, newPw) {
  if (String(newPw ?? '').length < 8) return setStatus(api, '新主密码至少 8 位', 'warn')
  const ring = getRing(store.vault, ringId)
  if (!ring) return setStatus(api, '这个环还没建立', 'warn')

  try {
    const next = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      return changePassword(L, ring, String(oldPw ?? ''), String(newPw ?? ''))
    })
    store.vault = putRing(store.vault, next)
    await saveVault(api, store.vault, next.id)
    // 换完密码当前会话仍然有效（DEK 没变），但要提示一次
    setStatus(api, '主密码已换。数据密文没动，旧密码从此失效。', 'success')
  } catch (e) {
    setStatus(api, `换密码失败：${String(e?.message ?? e)}`, 'error')
  }
}

/**
 * 恢复：解出 DEK 暂存 → 弹窗让用户设新密码（不在这里改盘）。
 *
 * 返回 true = 恢复验证通过（调用方据此决定是否继续弹「设新主密码」）。
 */
async function doRecover(api, ringId, how, input) {
  const ring = getRing(store.vault, ringId)
  if (!ring) return false
  if (!input) {
    setStatus(api, how === 'answer' ? '请输入恢复答案' : '请输入恢复码', 'warn')
    return false
  }

  try {
    const dek = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      return how === 'answer' ? recoverWithAnswer(L, ring, input) : recoverWithCode(L, ring, input)
    })
    recovered.set(ringId, dek)
    setStatus(api, '恢复验证通过 —— 请设一把新主密码', 'success')
    return true
  } catch {
    setStatus(api, '恢复失败：答案 / 恢复码不对', 'error')
    return false
  }
}

/** 恢复入口（弹窗）：收码 / 答案 → 验过再收新主密码 */
async function doRecoverFlow(api, payload, how) {
  const ringId = String(payload?.ringId ?? store.selected)
  const ring = getRing(store.vault, ringId)
  if (!ring) return setStatus(api, '这个环还没建立', 'warn')
  const label = ringLabel(ringId, store.vault)
  const isCode = how === 'code'

  let input = ''
  if (hostDialog(api)) {
    let res
    try {
      res = await api.host.dialog({
        title: `恢复「${label}」`,
        message: isCode ? '输入建环时抄下的恢复码。' : '回答建环时设的恢复问题。',
        body: {
          type: 'stack',
          children: [
            {
              type: 'input',
              bind: isCode ? B.code : B.answer,
              secret: true,
              placeholder: isCode ? '恢复码（形如 ABCD-EFGH-…）' : '恢复答案',
            },
          ],
        },
        actions: [
          { id: 'cancel', label: '取消', variant: 'ghost' },
          { id: 'ok', label: '验证' },
        ],
        width: 420,
      })
    } catch (e) {
      return setStatus(api, `没法弹出对话框：${String(e?.message ?? e)}`, 'error')
    }
    if (!res || res.action !== 'ok') return setStatus(api, '已取消', 'info')
    input = String(res.state[isCode ? B.code : B.answer] ?? '')
  } else {
    const v = await askOne(api, {
      title: `恢复「${label}」`,
      placeholder: isCode ? '恢复码' : '恢复答案',
      secret: true,
      okText: '验证',
    })
    if (v === null) return setStatus(api, '已取消', 'info')
    input = v
  }

  const ok = await doRecover(api, ringId, how, input)
  if (ok) await doResetDialog(api, ringId)
}

/** 恢复后设新主密码（弹窗） */
async function doResetDialog(api, ringId) {
  const label = ringLabel(ringId, store.vault)
  let newPw = ''
  if (hostDialog(api)) {
    let res
    try {
      res = await api.host.dialog({
        title: `给「${label}」设新主密码`,
        body: {
          type: 'stack',
          children: [
            { type: 'input', bind: B.newPw, secret: true, placeholder: '新主密码（至少 8 位）' },
          ],
        },
        actions: [
          { id: 'cancel', label: '取消', variant: 'ghost' },
          { id: 'ok', label: '重设主密码' },
        ],
        width: 420,
      })
    } catch (e) {
      return setStatus(api, `没法弹出对话框：${String(e?.message ?? e)}`, 'error')
    }
    if (!res || res.action !== 'ok') return setStatus(api, '已取消重设', 'info')
    newPw = String(res.state[B.newPw] ?? '')
  } else {
    const v = await askOne(api, {
      title: '新主密码',
      placeholder: '新主密码（至少 8 位）',
      secret: true,
      okText: '重设主密码',
    })
    if (v === null) return setStatus(api, '已取消重设', 'info')
    newPw = v
  }
  return doResetAfterRecovery(api, ringId, newPw)
}

async function doResetAfterRecovery(api, ringId, newPw) {
  const dek = recovered.get(ringId)
  const ring = getRing(store.vault, ringId)
  if (!dek || !ring) return setStatus(api, '先完成恢复验证', 'warn')
  if (String(newPw ?? '').length < 8) return setStatus(api, '新主密码至少 8 位', 'warn')

  try {
    const next = await withBusy(api, ringId, async () => {
      const L = await loadLibs()
      return resetPasswordWithDek(L, ring, dek, String(newPw))
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
  }
}

/* ───────────── 生物识别命令：绑定 / 解锁 / 解除 ───────────── */

/** 把系统错误翻成人话（Android 给错误码，Windows 给 HRESULT/状态字符串） */
export function biometricErrorMessage(error) {
  const raw = String(error?.message ?? error ?? '')
  if (/AEADBadTag|Failed to decrypt|decrypt the data/i.test(raw)) {
    return '指纹解不开这把密文 —— 多半是换过 / 新增过指纹。请用主密码解锁后重新绑定'
  }
  if (/userCancel|Cancel|canceled|cancelled/i.test(raw)) return '已取消'
  if (/biometryLockout|Lockout|too many/i.test(raw)) return '指纹尝试次数过多，请稍后再试或用主密码'
  if (/biometryNotEnrolled|not enrolled/i.test(raw)) return '系统里没有录入指纹'
  if (/biometryNotAvailable|No hardware|unavailable/i.test(raw)) return '这台设备当前用不了指纹'
  return `生物识别失败：${raw}`
}

/* ───────────────────────── 设备级指纹（期 3 · 一次绑定多环继承） ───────────────────────── */

async function loadDeviceFile(api) {
  try {
    return parseDeviceFile(await api.fs.readText(deviceFileOf(store.deviceId)))
  } catch {
    return null // 没绑过（正常态）
  }
}

async function saveDeviceFile(api, content) {
  try {
    await api.fs.mkdir(VAULT_DIR)
  } catch {
    /* 目录已存在 */
  }
  await api.fs.writeText(deviceFileOf(store.deviceId), content)
}

/** 给一把已解锁的环补上 `deviceWrapped`（要求 DK 在内存） */
async function inheritRing(api, ringId, dek) {
  if (!deviceKey) return false
  const ring = getRing(store.vault, ringId)
  if (!ring || ring.deviceWrapped) return false
  const L = await loadLibs()
  const next = { ...ring, deviceWrapped: wrapDeviceDek(L, deviceKey, ringId, dek) }
  store.vault = putRing(store.vault, next)
  await saveVault(api, store.vault, null)
  return true
}

/** 把所有已解锁的环都补上 `deviceWrapped`（绑定后 / 新环建立后） */
async function inheritAllUnlocked(api) {
  if (!deviceKey) return 0
  let n = 0
  for (const [ringId, s] of [...live]) {
    try {
      if (await inheritRing(api, ringId, s.dek)) n += 1
    } catch (e) {
      api.host.log('warn', `[security] 环 ${ringId} 继承指纹失败：${String(e?.message ?? e)}`)
    }
  }
  return n
}

/**
 * 绑定 / 补绑本机指纹。
 *
 * - **没绑过**：生成 DK → 一次认证包起来 → 已解锁的环全部继承。
 * - **已绑过**：**绝不重建 DK**（重建会让旧环的 `deviceWrapped` 全失效）——
 *   解出现有 DK（一次认证），把还没继承的环补上。
 */
async function bindDevice(api) {
  const adapter = store.biometric
  if (!adapter) throw new Error('这台设备没有可用的生物识别')
  if (store.deviceFile) {
    await unlockDeviceKey()
    return inheritAllUnlocked(api)
  }
  const L = await loadLibs()
  const dk = L.randomBytes(32)
  const wrapped = await adapter.seal(dk, 'device')
  await saveDeviceFile(api, deviceFileContent(adapter.platform, wrapped))
  store.deviceFile = { platform: adapter.platform, wrapped, at: Date.now() }
  deviceKey = dk
  return inheritAllUnlocked(api)
}

/** 解出设备 DK（一次 fresh 认证；本会话内复用） */
async function unlockDeviceKey() {
  const adapter = store.biometric
  if (!adapter) throw new Error('这台设备没有可用的生物识别')
  if (!store.deviceFile) throw new Error('这台设备还没绑定生物识别')
  if (deviceKey) return deviceKey
  deviceKey = await adapter.open(store.deviceFile.wrapped, 'device')
  return deviceKey
}

/** 用指纹解某个环的 DEK（设备级 DK → 解该环 deviceWrapped） */
async function unlockRingByDevice(ringId) {
  const ring = getRing(store.vault, ringId)
  if (!ring) throw new Error('这个密钥环还没建立')
  if (!ring.deviceWrapped) throw new Error('这个环还没继承本机指纹 —— 先用主密码解锁一次，再绑定')
  const dk = await unlockDeviceKey()
  const L = await loadLibs()
  return unwrapDeviceDek(L, dk, ringId, ring.deviceWrapped)
}

/**
 * 用指纹解出某把环的 DEK 并进解锁态；失败原样抛（调用方决定翻人话 / 回落主密码）。
 * rev173.424：抽出来给「列表行的解锁按钮」复用 —— 它要和密码库一样先弹指纹、取消再回落。
 */
async function biometricUnlockRing(api, ringId) {
  const ring = getRing(store.vault, ringId)
  if (!ring) throw new Error('这个环还没建立')
  const dek = ring.deviceWrapped
    ? await unlockRingByDevice(ringId)
    : await unlockWithBiometric(ring, store.biometric, store.deviceId)
  live.set(ringId, { dek, lastActive: Date.now() })
  /* 这一次认证刚拿到 DK ⇒ 顺手把「所有已解锁但还没继承指纹」的环一次性补齐（rev173.430）——
     用户一次指纹 = 整个会话全局生效，不用每个环单独绑 */
  await inheritRings(api)
  api.event.emit('security:unlocked', { ringId })
}

/**
 * 一次设备指纹认证之后，把「已解锁但还没继承本机指纹」的环**全部**补上 `deviceWrapped`
 * （rev173.430，用户：「只能每次建立都验证一次吗，不能做到指纹设置之后就是全局生效的吗」）。
 *
 * 为什么必须等一次认证：DK 只在内存里，程序不能把它常驻磁盘（那等于任何本机程序都能取走
 * 所有环的钥匙）。所以策略是「一次认证、全局补齐」—— 用户在本次会话里认证过一次之后，
 * 之前 / 之后已解锁的环都会带上指纹包裹，此后再不用单独绑。
 */
async function inheritRings(api) {
  if (!deviceKey) return 0
  let changed = 0
  for (const [id, s] of live.entries()) {
    if (await inheritOneRing(api, id, s.dek)) changed++
  }
  if (changed) api.view.refresh(PANEL_ID)
  return changed
}

/** 给某一把环补 `deviceWrapped`（要求 DK 与这把环的 DEK 都在手上）。返回是否写入。 */
async function inheritOneRing(api, ringId, dek) {
  if (!deviceKey || !dek) return false
  const ring = getRing(store.vault, ringId)
  if (!ring || ring.deviceWrapped) return false
  try {
    const L = await loadLibs()
    store.vault = putRing(store.vault, {
      ...ring,
      deviceWrapped: wrapDeviceDek(L, deviceKey, ringId, dek),
    })
    await saveVault(api, store.vault, ringId)
    return true
  } catch {
    return false
  }
}

/**
 * 列表行的「解锁」按钮（rev173.424 · 用户 2026-11-08）：
 * **与密码库 / 私密笔记同一套流程** —— 这把环绑过本机指纹就先弹系统指纹；
 * 取消 / 失败回落主密码输入框（`host.prompt`）；解锁成功**不跳转**（只标记已解锁）。
 */
async function doUnlockRing(api, payload) {
  const ringId = String(payload?.ringId ?? '')
  if (!isRingId(ringId)) return
  const ring = getRing(store.vault, ringId)
  if (!ring) return doSetupDialog(api, ringId)
  const label = ringLabel(ringId, store.vault)
  store.selected = ringId
  if (live.has(ringId)) return setStatus(api, `「${label}」已经解锁`, 'info')

  const canBio = Boolean(
    (deviceBinding(ring, store.deviceId) || ring?.deviceWrapped) && store.biometric,
  )
  if (canBio && !biometricInFlight) {
    cancelAutoUnlock()
    biometricInFlight = true
    try {
      await biometricUnlockRing(api, ringId)
      setStatus(api, `「${label}」已用指纹解锁`, 'success')
      return
    } catch (e) {
      /* 取消 / 失败都不算错误路径 —— 回落到主密码框（与密码库一致） */
      const msg = biometricErrorMessage(e)
      if (msg !== '已取消' && typeof api.host?.notify === 'function') api.host.notify(msg, 'warn')
    } finally {
      biometricInFlight = false
    }
  }

  if (typeof api.host?.prompt !== 'function') return doUnlockDialog(api, ringId)
  const pw = await api.host.prompt({
    title: `解锁「${label}」`,
    message: canBio ? '指纹已取消 —— 也可以输入主密码' : `输入「${label}」的主密码`,
    placeholder: '主密码',
    secret: true,
    okText: '解锁',
  })
  if (pw === null) return setStatus(api, '已取消解锁', 'info')
  return doUnlock(api, ringId, pw)
}

/**
 * 用生物识别解锁。
 *
 * - **手动**（面板按钮 / 命令）：失败原样报错。
 * - **自动**（`{ auto: true }`，锁定后由 `scheduleAutoUnlock` 触发，rev173.171）：
 *   取消 / 超时只给中性提示 —— 用户没主动做错什么；面板本来就有「用指纹解锁」
 *   和主密码框兜底（需求 §13「失败或取消显示手动验证按钮」）。
 */
async function doBiometricUnlock(api, opts = {}) {
  const { auto = false, ringId = store.selected } = opts
  const ring = getRing(store.vault, ringId)
  const adapter = store.biometric
  if (!ring) return setStatus(api, '这个环还没建立', 'warn')
  if (!adapter) return setStatus(api, '这台设备没有可用的生物识别', 'warn')
  if (biometricInFlight) return // 自动弹与手点叠在一起时只认第一个
  if (!auto) cancelAutoUnlock() // 用户主动点了按钮：撤掉还没弹的那次自动弹
  biometricInFlight = true
  if (auto) setStatus(api, '正在请求指纹…', 'info')
  try {
    // 期 3：新格式优先（一次认证解 DK，多环共用）；旧格式兜底
    await biometricUnlockRing(api, ringId)
    setStatus(api, `「${ringLabel(ringId)}」已用指纹解锁`, 'success')
  } catch (e) {
    const msg = biometricErrorMessage(e)
    if (auto && msg === '已取消') {
      setStatus(api, '已取消 —— 输入主密码，或点「用指纹解锁」', 'info')
    } else {
      setStatus(api, msg, 'error')
    }
  } finally {
    biometricInFlight = false
  }
}

/**
 * 顶部「绑定指纹」按钮（rev173.423）：一个按钮两种含义 —— 没绑就绑、已绑就解。
 *
 * 用户 2026-11-08：「绑定指纹点了没用」。两个原因都改了：
 * ① 旧按钮在 0 把已解锁时 **disabled** —— 点了完全没反应，也没有任何提示；
 *    但绑定本身是**设备级**的（`bindDevice` 只创建 DK，不要求先解锁某把环）。
 * ② 按钮永远写「绑定指纹」，绑过之后看不出状态、也找不到解除入口。
 */
async function doBiometricToggle(api) {
  if (store.deviceFile) return doBiometricUnbind(api)
  return doBiometricBind(api)
}

async function doBiometricBind(api) {  if (!store.biometric) return setStatus(api, '这台设备没有可用的生物识别', 'warn')
  try {
    // 期 3：绑**设备**（一次认证），已解锁的环立刻继承；以后新建的环自动继承
    const n = await bindDevice(api)
    setStatus(
      api,
      `已绑定这台设备${n ? ` —— ${n} 把已解锁的环已继承` : ''}；之后锁定可直接用指纹解锁（新建的环会自动继承）`,
      'success',
    )
  } catch (e) {
    setStatus(api, `绑定失败：${biometricErrorMessage(e)}`, 'error')
  }
}

async function doBiometricUnbind(api) {
  if (!store.deviceFile) return setStatus(api, '这台设备没有绑定指纹', 'warn')
  try {
    // 期 3：解除是**设备级**的 —— 删本机 DK 文件 + 清掉所有环的本机包裹（别的设备不动）
    await api.fs.purgePrivate(deviceFileOf(store.deviceId)).catch(() => {})
    store.deviceFile = null
    if (deviceKey) {
      wipe(deviceKey)
      deviceKey = null
    }
    let changed = false
    for (const [id, ring] of Object.entries(store.vault.rings)) {
      let next = ring
      if (next.deviceWrapped) {
        next = { ...next }
        delete next.deviceWrapped
        changed = true
      }
      if (deviceBinding(next, store.deviceId)) {
        next = unbindBiometric(next, store.deviceId)
        changed = true
      }
      if (next !== ring) store.vault = putRing(store.vault, next)
    }
    if (changed) await saveVault(api, store.vault, null)
    setStatus(api, '已解除这台设备的指纹绑定（主密码与别的设备不受影响）', 'success')
  } catch (e) {
    setStatus(api, `解除失败：${String(e?.message ?? e)}`, 'error')
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
    store.sig = vaultSignature(store.vault)
    store.loaded = true
    /**
     * 旧单文件的残留自愈（rev173.184 手机走查）：迁移时 `saveVault` 会删 `vault.json`，但实测
     * Android 上它可能**删掉又被写回来**（mtime 更新、内容与迁移前逐字节相同）。所以每次加载时
     * 顺手再清一次 —— 前置是**新结构确实存在**，否则可能把唯一的 vault 删掉。
     */
    if (!store.corrupt) {
      const rings = Object.keys(store.vault.rings)
      const hasNew = (
        await Promise.all(rings.map((id) => api.fs.exists(vaultFileOf(id)).catch(() => false)))
      ).some(Boolean)
      if (hasNew && (await api.fs.exists(LEGACY_VAULT_FILE).catch(() => false))) {
        await purgeLegacy(api)
      }
    }
    // 设备 id（rev173.173）：生物识别按设备存，本机 id 在凭据管理器里（不随库同步）
    store.deviceId = await resolveDeviceId(api)
    // 旧的单段 biometric → biometrics[<本机>]（一次性；别的环原样不动）
    const migrated = migrateBiometrics(store.vault, store.deviceId)
    if (migrated && !store.corrupt) {
      try {
        await saveVault(api, migrated)
        store.vault = migrated
      } catch (e) {
        api.host.log('warn', `[security] 生物识别按设备迁移没落盘：${String(e?.message ?? e)}`)
      }
    }
    // 生物识别探测（Android 官方插件 / Windows hello_*）：失败静默，面板只是不显示入口
    store.biometric = await detectBiometric()
    // 密钥环分配表（期 3 · rev173.416）：本机文件，默认空 ⇒ 所有消费者都要先在下拉里分配
    store.grants = await loadGrants(api)
    // 设备级指纹（期 3）：本机绑定文件，没有 = 这台没绑过
    store.deviceFile = await loadDeviceFile(api)

    /* 面板 */
    api.subscriptions.push(
      api.view.registerPanel({
        id: PANEL_ID,
        title: '安全',
        location: 'main',
        render: (ctx) => {
          // ViewApi 没有 getState：把本次 ctx.state 存快照，命令里读它（tag-panel 同款做法）
          ui = { ...(ctx?.state ?? {}) }
          // 播种分配下拉（rev173.416）：宿主的 select 值只取 `ctx.state[bind]`，
          // 不写就永远显示第一项（「未分配」）—— 值一致时不写，避免重渲染自激。
          for (const row of assignRows(store.grants, allRingIds(store.vault))) {
            const bind = `${B.assignPrefix}${row.ringId}`
            const want = `${row.ringId}::${row.owner ?? ''}`
            if (ui[bind] !== want) {
              api.view.setState(bind, want)
              ui[bind] = want
            }
          }
          return panelNode(panelView(installedPluginIds(api)))
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

    /* 外部写入后的自动重读（rev173.393）：同步插件写 vault 不经过本插件，
       30 秒轮一次、只在前台、只在没解锁时（见 reloadVaultIfChanged） */
    const vaultTimer = setInterval(() => {
      try {
        if (document.visibilityState !== 'visible') return
      } catch {
        /* 无 DOM（单测）：照常检查 */
      }
      void reloadVaultIfChanged(api, 'timer')
    }, VAULT_RECHECK_MS)
    api.subscriptions.push({ dispose: () => clearInterval(vaultTimer) })

    /* 锁定时人不在前台 ⇒ 这次自动弹先挂起，等用户回来再补（rev173.171）：
       桌面的 Hello 对话框会抢焦点、手机切后台时 CPU 冻结 —— 都该等用户回来。
       判据在 shouldWaitForFocus 里（纯函数，单测覆盖）。 */
    const onAppActive = () => {
      void reloadVaultIfChanged(api, 'focus')
      resumeAutoUnlock(api)
    }
    try {
      document.addEventListener('visibilitychange', onAppActive)
      window.addEventListener('focus', onAppActive)
    } catch {
      /* 无 DOM（单测 / 极端环境）：自动弹只在锁定当时立即尝试一次 */
    }
    api.subscriptions.push({
      dispose: () => {
        try {
          document.removeEventListener('visibilitychange', onAppActive)
          window.removeEventListener('focus', onAppActive)
        } catch {
          /* 同上 */
        }
        cancelAutoUnlock()
      },
    })

    /* 命令 */
    const commands = [
      {
        id: 'security.open',
        title: '安全：打开面板',
        run: async () => {
          // 打开前先看一眼磁盘（rev173.393）：同步可能在后台换掉了 vault
          await reloadVaultIfChanged(api, 'open')
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
          if (!allRingIds(store.vault).includes(ringId)) return
          store.selected = ringId
          store.message = ''
          store.recoveryCodeShown = ''
          api.view.refresh(PANEL_ID)
        },
      },
      /* rev173.421：列表页只留一个入口（点环名）；下面这些都变成弹窗命令，
         保留命令 id 是为了命令面板 / 快捷键仍然可用 */
      { id: 'security.open-ring', title: '安全：打开密钥环（解锁 / 管理）', run: (p) => doOpenRing(api, p) },
      { id: 'security.test-ring', title: '安全：测试密钥环主密码', run: (p) => doTestRing(api, p) },
      { id: 'security.setup', title: '安全：建立密钥环', run: (p) => doSetupDialog(api, String(p?.ringId ?? store.selected)) },
      { id: 'security.unlock', title: '安全：解锁', run: (p) => doUnlockDialog(api, String(p?.ringId ?? store.selected)) },
      {
        /* rev173.424：列表行的「解锁」—— 与密码库 / 私密笔记同一套（指纹优先，回落主密码），不跳转 */
        id: 'security.unlock-ring',
        title: '安全：解锁密钥环（指纹优先，回落主密码）',
        run: (p) => doUnlockRing(api, p),
      },
      {
        id: 'security.lock',
        title: '安全：立即锁定',
        run: async () => {
          const ringId = store.selected
          lockRing(api, ringId, 'manual')
          setStatus(api, `「${ringLabel(ringId)}」已锁定`, 'info')
        },
      },
      {
        id: 'security.change-password',
        title: '安全：换主密码',
        run: (p) => doManageDialog(api, String(p?.ringId ?? store.selected)),
      },
      {
        id: 'security.recover-answer',
        title: '安全：用恢复问题解锁',
        run: (p) => doRecoverFlow(api, p, 'answer'),
      },
      {
        id: 'security.recover-code',
        title: '安全：用恢复码解锁',
        run: (p) => doRecoverFlow(api, p, 'code'),
      },
      { id: 'security.reset-after-recovery',
        title: '安全：恢复后重设主密码',
        run: (p) => doResetDialog(api, String(p?.ringId ?? store.selected)),
      },
      { id: 'security.biometric-unlock', title: '安全：用生物识别解锁', run: () => doBiometricUnlock(api) },
      {
        id: 'security.biometric-toggle',
        title: '安全：绑定 / 解除这台设备的指纹',
        run: () => doBiometricToggle(api),
      },
      { id: 'security.biometric-bind', title: '安全：绑定生物识别', run: () => doBiometricBind(api) },
      { id: 'security.biometric-unbind', title: '安全：解除生物识别', run: () => doBiometricUnbind(api) },
      { id: 'security.assign-ring', title: '安全：把密钥环分配给插件 / 解除分配', run: (payload) => doAssignRing(api, payload) },
      { id: 'security.assign-menu', title: '安全：展开密钥环分配菜单', run: (payload) => doAssignMenu(api, payload) },
      { id: 'security.create-ring', title: '安全：新建密钥环', run: () => doCreateRing(api) },
      { id: 'security.delete-ring', title: '安全：删除密钥环（需输入主密码）', run: (payload) => doDeleteRing(api, payload) },
      { id: 'security.self-test', title: '安全：自检', run: () => doSelfTest(api) },
    ]
    for (const cmd of commands) api.subscriptions.push(api.command.register(cmd))

    /* 对外服务（需求 §9.4）：只给"操作"，不给密钥。
       rev173.416：**环由分配表决定** —— 插件只声明「我需要密钥环」，具体是哪个环由
       用户在下拉里分配；消费者传进来的旧 `ring` 参数一律忽略，不能借别人的环。 */
    api.subscriptions.push(
      api.service.provide(
        'crypto',
        ({ caller }) => {
          /** 我这个插件分到的环（每次调用现查：面板改分配后立刻生效） */
          const mine = () => needRing(api, caller)
          return {
            version: '2.0.0',
            /** 声明「我需要一个密钥环」（幂等；返回当前分到的环 id，可能 null） */
            demand: () => {
              const got = pluginRing(store.grants, caller)
              if (!got) void noteDemand(api, caller)
              return pluginRing(store.grants, caller)
            },
            /** 分配给我的环 id（没有 ⇒ 抛可操作错误） */
            ring: () => mine(),
            isUnlocked: () => live.has(mine()),
            ids: () => [mine()].filter((id) => live.has(id)),
            unlock: async (_ringId, password) => unlockWithPassword(api, mine(), password),
            lock: () => {
              const rid = pluginRing(store.grants, caller)
              if (rid) lockRing(api, rid, 'service')
            },
            /** 加密：`{ container, data }`，data 可以是字符串或 Uint8Array */
            encrypt: async ({ container, data } = {}) => {
              const ring = mine()
              const s = live.get(ring)
              if (!s) throw new Error(`密钥环「${ring}」未解锁`)
              const L = await loadLibs()
              touch(ring)
              return encryptData(L, s.dek, ring, container ?? ring, data)
            },
            /** 解密成文本（密码库这类 JSON 数据用它） */
            decryptText: async ({ container, payload } = {}) => {
              const ring = mine()
              const s = live.get(ring)
              if (!s) throw new Error(`密钥环「${ring}」未解锁`)
              const L = await loadLibs()
              touch(ring)
              return fromBytes(decryptData(L, s.dek, ring, container ?? ring, payload))
            },
            decryptBytes: async ({ container, payload } = {}) => {
              const ring = mine()
              const s = live.get(ring)
              if (!s) throw new Error(`密钥环「${ring}」未解锁`)
              const L = await loadLibs()
              touch(ring)
              return decryptData(L, s.dek, ring, container ?? ring, payload)
            },
            sign: async ({ container, data } = {}) => {
              const ring = mine()
              const s = live.get(ring)
              if (!s) throw new Error(`密钥环「${ring}」未解锁`)
              const L = await loadLibs()
              touch(ring)
              return signData(L, s.dek, ring, container ?? ring, data)
            },
            verify: async ({ container, data, sig } = {}) => {
              const ring = mine()
              const s = live.get(ring)
              if (!s) return false
              const L = await loadLibs()
              return verifyData(L, s.dek, ring, container ?? ring, data, sig)
            },
          /**
           * **生物识别（rev173.336 · 真人测试10 #1「密码库解锁界面无法调用指纹」）**。
           *
           * 消费者（密码库）只拿到四个动作，**拿不到 DEK**（需求 §9.4 不变）：
           * 解锁成功后 DEK 写进本插件的 `live` 表，消费者接着用 `decryptText` 读自己的密文。
           *
           * 为什么放服务里而不是让密码库自己读 ring：ring 的落盘格式与 `saveVault(onlyRing)`
           * 的同步语义都归本插件管；让第二个插件写同一个文件，两台设备同时改不同环时会撞车。
           */
          biometric: {
            /** 这台设备有没有可用的适配器（Windows Hello / Android 指纹） */
            available: () => Boolean(store.biometric),
            /** 这个环在这台设备上能用指纹解锁吗（新格式 `deviceWrapped` / 旧格式本机包裹） */
            bound: () => {
              const ring = getRing(store.vault, mine())
              if (!ring) return false
              return Boolean(ring.deviceWrapped || deviceBinding(ring, store.deviceId))
            },
            /** 用指纹解出 DEK 并解锁该环；失败原样抛给调用方（它负责翻人话） */
            unlock: async () => {
              const ringId = mine()
              const ring = getRing(store.vault, ringId)
              if (!ring) throw new Error('这个密钥环还没建立')
              if (!store.biometric) throw new Error('这台设备没有可用的生物识别')
              if (!ring.deviceWrapped && !deviceBinding(ring, store.deviceId)) {
                throw new Error('这个环还没绑定本机指纹 —— 先用主密码解锁，再在安全面板里让它继承')
              }
              if (biometricInFlight) throw new Error('指纹请求正在进行，请稍候')
              biometricInFlight = true
              try {
                const dek = ring.deviceWrapped
                  ? await unlockRingByDevice(ringId)
                  : await unlockWithBiometric(ring, store.biometric, store.deviceId)
                live.set(ringId, { dek, lastActive: Date.now() })
                api.event.emit('security:unlocked', { ringId })
                return true
              } finally {
                biometricInFlight = false
              }
            },
            /** 绑定 / 补绑本机指纹（设备级；要求该环已解锁） */
            bind: async () => {
              if (!live.has(mine())) throw new Error('先解锁，再绑定指纹')
              await bindDevice(api)
              return true
            },
            /** 解除本机绑定（设备级；不影响主密码与别的设备） */
            unbind: async () => {
              mine()
              if (!store.deviceFile) throw new Error('这台设备没有绑定生物识别')
              await api.fs.purgePrivate(deviceFileOf(store.deviceId)).catch(() => {})
              store.deviceFile = null
              if (deviceKey) {
                wipe(deviceKey)
                deviceKey = null
              }
              let changed = false
              for (const [id, r] of Object.entries(store.vault.rings)) {
                let next = r
                if (next.deviceWrapped) {
                  next = { ...next }
                  delete next.deviceWrapped
                  changed = true
                }
                if (deviceBinding(next, store.deviceId)) {
                  next = unbindBiometric(next, store.deviceId)
                  changed = true
                }
                if (next !== r) store.vault = putRing(store.vault, next)
              }
              if (changed) await saveVault(api, store.vault, null)
              return true
            },
          },
          }
        },
        { version: '2.0.0', perCaller: true },
      ),
    )

    api.host.log('info', `[security] 已加载：${Object.keys(store.vault.rings).length} 个环`)
  },
}
