/**
 * **加密存储前置插件** —— 演示"安全存储不需要动内核"。
 *
 * 规格 §2.6 要求「密钥管理：主密码 + 设备密钥 + 恢复码」，而内核的 `store` 是**明文 JSON**。
 * 按"内核保持干净"的原则，正确的解法不是往内核里塞加密，而是：
 *
 *   内核：只给 `fs`（读写文件）与 `store`（明文 KV）
 *   本插件：用 **WebCrypto**（浏览器原生，零依赖）提供加密能力，密文自己落盘
 *
 * 于是"换一套加密方案"= 换这个插件，内核一行都不用改。
 *
 * 算法（都是 WebCrypto 原生）：
 *   · **PBKDF2-HMAC-SHA256，210,000 次迭代** —— 主密码 → 256 位密钥（`crypto.subtle.deriveKey`）
 *   · **AES-GCM 256** —— 每次加密随机 12 字节 IV，附带认证标签（防篡改）
 *   · 输出格式：`v1:<saltB64>:<ivB64>:<cipherB64>` —— 自描述，将来换算法好迁移
 *
 * ⚠️ **诚实的边界**：
 *   · 密钥只在**内存**里，锁屏/退出即丢 —— 本插件不负责"记住密码"
 *   · 它保护的是**落盘的密文**；进程内的明文与密钥仍可被同上下文的其他插件看到
 *     （契约 §4 已声明 v0.1 无沙箱）
 *   · 迭代次数按桌面/手机折中取 21 万；真机实测约几十毫秒量级
 */
const enc = new TextEncoder()
const dec = new TextDecoder()

const PBKDF2_ITER = 210000
const KEY_ALGO = { name: 'AES-GCM', length: 256 }
const VERSION = 'v1'

/** Uint8Array → base64（小数据量够用，避免一次 spread 爆栈） */
function toB64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromB64(text) {
  const raw = atob(text)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function randomBytes(n) {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    base,
    KEY_ALGO,
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 一台"保险箱"：解锁后才能加解密 */
function createVault() {
  /** @type {CryptoKey | null} */
  let key = null
  let unlockedAt = 0

  return {
    get unlocked() {
      return key !== null
    },
    /** 已解锁多久（毫秒）—— 消费者可以据此做自动上锁 */
    get unlockedMs() {
      return key ? Date.now() - unlockedAt : 0
    },

    /**
     * 用主密码解锁。没给 salt 就新生成一个（首次使用），返回它供调用方**持久化**。
     * 同一个密码 + 同一个 salt ⇒ 同一把钥匙（所以 salt 必须存下来）。
     */
    async unlock(password, saltB64) {
      if (typeof password !== 'string' || password.length === 0) {
        throw new Error('主密码不能为空')
      }
      const salt = saltB64 ? fromB64(saltB64) : randomBytes(16)
      key = await deriveKey(password, salt)
      unlockedAt = Date.now()
      return { salt: toB64(salt) }
    },

    lock() {
      key = null
    },

    /** 明文 → 自描述密文串 */
    async encrypt(plain) {
      if (!key) throw new Error('保险箱还没解锁（先调 unlock）')
      const iv = randomBytes(12)
      const buf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(String(plain)))
      return `${VERSION}::${toB64(iv)}::${toB64(new Uint8Array(buf))}`
    },

    /** 自描述密文串 → 明文。改过一个字节都会抛（GCM 的认证标签） */
    async decrypt(payload) {
      if (!key) throw new Error('保险箱还没解锁（先调 unlock）')
      const parts = String(payload).split('::')
      if (parts.length !== 3 || parts[0] !== VERSION) {
        throw new Error('密文格式不认识（期望 v1::iv::cipher）')
      }
      const iv = fromB64(parts[1])
      const data = fromB64(parts[2])
      const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data)
      return dec.decode(buf)
    },
  }
}

export default {
  apply(api) {
    // 懒工厂：没有插件 consume 时，连这台保险箱对象都不会被创建
    api.service.provide('crypto.vault', () => createVault(), { version: '1.0.0' })

    /**
     * 自检命令：跑一遍完整往返（含"错密码解不开"的负向验证）。
     * 这是本插件唯一的 UI —— 用命令 + toast，不需要任何面板。
     */
    api.command.register({
      id: 'crypto.self-test',
      title: '加密自检：往返 + 错密码必须失败',
      run: async () => {
        const vault = await api.service.consume('crypto.vault')
        if (!vault) {
          api.host.notify('拿不到 crypto.vault 服务', 'warn')
          return
        }
        const secret = '这是一段会被加密的明文 zzyzx'

        // ① 首次解锁（生成 salt）→ 加密 → 解密，必须还原
        const { salt } = await vault.unlock('主密码-abc')
        const cipher = await vault.encrypt(secret)
        const back = await vault.decrypt(cipher)
        const roundTripOk = back === secret

        // ② 换一把钥匙（同密码 + 另一个 salt）再解，必须失败
        vault.lock()
        await vault.unlock('主密码-abc', toB64(randomBytes(16)))
        let wrongKeyFailed = false
        try {
          await vault.decrypt(cipher)
        } catch {
          wrongKeyFailed = true
        }

        // ③ 错误密码也必须失败
        vault.lock()
        await vault.unlock('错的密码', salt)
        let wrongPwFailed = false
        try {
          await vault.decrypt(cipher)
        } catch {
          wrongPwFailed = true
        }

        api.host.log('info', `[dep-crypto] 密文样例 ${cipher.slice(0, 48)}…`)
        api.host.notify(
          roundTripOk && wrongKeyFailed && wrongPwFailed
            ? '✅ 加密自检通过：往返一致 + 错 key/错密码都解不开'
            : `❌ 自检失败：往返=${roundTripOk} 错key=${wrongKeyFailed} 错密码=${wrongPwFailed}`,
          roundTripOk && wrongKeyFailed && wrongPwFailed ? 'info' : 'error',
        )
      },
    })
  },
}
