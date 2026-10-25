/**
 * 插件签名的**共享约定**（rev173.77 起 · 契约 §7.4；rev173.142 升到 v2）。
 *
 * 为什么单独一个模块：签名格式有三处实现（签名的 `scripts/sign.mjs`、验签前的
 * `plugin-host.ts`、以及 Rust 的 `verify_plugin_signature` 只看 payload 字符串），
 * 任何一处不一致都会变成"签了但验不过"的哑谜 —— 把可共享的部分集中在这里。
 *
 * 覆盖范围 = **身份 + 全部声明文件**：
 *   payload = `zn-plugin-v2|<id>|<version>|<入口 sha256>|<path:sha256 排序拼接>`
 * ⇒ 改入口 / 改 manifest.files 里任何一个文件 / 改 id / 改 version 都让签名失效。
 *
 * **v1 → v2（2026-10-25 · rev173.142）**：v1 只签入口 ⇒ 多文件插件里 `lib/*.js`
 * 被替换后签名仍通过（详见 `docs/插件市场-调研-2026-10-25.md` §5）。v2 把
 * `manifest.files` 的路径与摘要一并签进去。**v1 签名在 v2 下一律验不过** ——
 * 升级时没有任何插件带 signature.json（实测 0 个），所以不存在兼容问题。
 *
 * `signature.json`（与 manifest 并列）只认这三个字段：
 *   { "alg": "ed25519", "keyId": "<信任根里的 id>", "sig": "<base64 64 字节>" }
 * **其它字段一律不信** —— payload 由加载时重算，避免"签名文件里自带 payload"的偷换。
 */

export const PLUGIN_SIGNATURE_ALG = 'ed25519' as const
/** v2：入口 + manifest.files 全量摘要 */
export const PLUGIN_SIGNATURE_PREFIX = 'zn-plugin-v2'
/** signature.json 的文件名（插件目录根） */
export const PLUGIN_SIGNATURE_FILE = 'signature.json'
/**
 * 信任根文件：`<全局插件根>/.zn/trusted-keys.json`。
 *
 * ⚠️ 它**不再是唯一信任根**（rev173.146）：官方公钥已内置在 Rust
 * （`BUILTIN_TRUSTED_KEYS`），这个文件只用于**追加**外部作者公钥，
 * 或用同一个 `keyId` 覆盖内置那条（轮换 / 撤销）。验签在 Rust，这里只留形状常量。
 */
export const TRUSTED_KEYS_REL = '.zn/trusted-keys.json'

/** 参与签名的一个文件（`path` 用 POSIX 相对路径，与 manifest.files 写法一致） */
export type SignedFileDigest = { path: string; sha256: string }

export type PluginSignature = {
  alg: typeof PLUGIN_SIGNATURE_ALG
  keyId: string
  /** base64（64 字节 Ed25519 签名） */
  sig: string
}

/**
 * 签名载荷。**改这里 = 旧签名全部失效**，与 `scripts/sign.mjs` 逐字一致。
 *
 * `files` 按路径字典序排序后拼接（保证同一份内容永远得到同一串 payload，
 * 不受操作系统的目录遍历顺序影响）。没有额外文件时末尾是空段：
 * `zn-plugin-v2|demo|1.0.0|<entrySha>|`
 */
export function signingPayload(
  id: string,
  version: string,
  entrySha256: string,
  files: SignedFileDigest[] = [],
): string {
  const tail = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}:${f.sha256}`)
    .join('|')
  return `${PLUGIN_SIGNATURE_PREFIX}|${id}|${version}|${entrySha256}|${tail}`
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
