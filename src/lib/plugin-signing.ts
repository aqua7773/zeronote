/**
 * 插件签名的**共享约定**（rev173.77 · 契约 §7.4）。
 *
 * 为什么单独一个模块：签名格式有三处实现（签名的 `scripts/sign.mjs`、验签前的
 * `plugin-host.ts`、以及 Rust 的 `verify_signature` 只看 payload 字符串），
 * 任何一处不一致都会变成"签了但验不过"的哑谜 —— 把可共享的部分集中在这里。
 *
 * 覆盖范围 = **身份 + 内容**，不是整个目录：
 *   payload = `zn-plugin-v1|<id>|<version>|<入口文件 sha256>`
 * ⇒ 改入口 / 改 id / 改 version 让签名失效；改 README、加附件不受影响。
 *
 * `signature.json`（与 manifest 并列）只认这三个字段：
 *   { "alg": "ed25519", "keyId": "<信任根里的 id>", "sig": "<base64 64 字节>" }
 * **其它字段一律不信** —— payload 由加载时重算，避免"签名文件里自带 payload"的偷换。
 */

export const PLUGIN_SIGNATURE_ALG = 'ed25519' as const
export const PLUGIN_SIGNATURE_PREFIX = 'zn-plugin-v1'
/** signature.json 的文件名（插件目录根） */
export const PLUGIN_SIGNATURE_FILE = 'signature.json'
/** 信任根：`<全局插件根>/.zn/trusted-keys.json` */
export const TRUSTED_KEYS_REL = '.zn/trusted-keys.json'

export type PluginSignature = {
  alg: typeof PLUGIN_SIGNATURE_ALG
  keyId: string
  /** base64（64 字节 Ed25519 签名） */
  sig: string
}

/** 签名载荷。**改这里 = 旧签名全部失效**，与 `scripts/sign.mjs` 逐字一致。 */
export function signingPayload(id: string, version: string, entrySha256: string): string {
  return `${PLUGIN_SIGNATURE_PREFIX}|${id}|${version}|${entrySha256}`
}

/**
 * 解析 `signature.json` 的文本。形状不对返回 `null`（当"没签名"处理还是当错误处理，
 * 由调用方决定 —— 这里只负责"能不能读懂"）。
 */
export function parsePluginSignature(raw: string): PluginSignature | null {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.alg !== PLUGIN_SIGNATURE_ALG) return null
  if (typeof o.keyId !== 'string' || !o.keyId) return null
  if (typeof o.sig !== 'string' || !o.sig) return null
  return { alg: PLUGIN_SIGNATURE_ALG, keyId: o.keyId, sig: o.sig }
}

/** 信任根文件形状：`{ "keys": [{ "keyId", "publicKey" }] }`（publicKey = base64 raw 32 字节） */
export type TrustedKeys = { keys: { keyId: string; publicKey: string }[] }

export function parseTrustedKeys(raw: string): TrustedKeys | null {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const list = (v as Record<string, unknown>).keys
  if (!Array.isArray(list)) return null
  const keys: TrustedKeys['keys'] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const k = item as Record<string, unknown>
    if (typeof k.keyId === 'string' && k.keyId && typeof k.publicKey === 'string' && k.publicKey) {
      keys.push({ keyId: k.keyId, publicKey: k.publicKey })
    }
  }
  return { keys }
}

/** 从信任根里找公钥；找不到返回 undefined */
export function findTrustedKey(trusted: TrustedKeys | null, keyId: string): string | undefined {
  return trusted?.keys.find((k) => k.keyId === keyId)?.publicKey
}
