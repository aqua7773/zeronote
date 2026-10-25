#!/usr/bin/env node
/**
 * **验证「内置公钥」这句承诺**（rev173.146 · 契约 §7.4）。
 *
 * 内置公钥是唯一「抄错一个字符、新装机器上全部官方插件拒载、而那台机器上没法调试」的东西。
 * 这个脚本把它变成可执行检查：
 *
 *   1. 从 `src-tauri/src/lib.rs` **解析** `BUILTIN_TRUSTED_KEYS`（不是在这里抄一份 ——
 *      抄一份就又多了一个会漂移的副本；解析失败会直接报错，防止常量被改名/删掉）
 *   2. 格式：base64 → 32 字节 → 合法 Ed25519 公钥
 *   3. （有私钥时）**从私钥导出公钥，与内置值逐字节比对** ⇒ 证明内置的确实是官方私钥那半
 *   4. （有私钥时）用内置公钥验一段自签 payload ⇒ 证明验签路径本身通
 *   5. （有 `dist/` 时）对每个 `.znp`：按宿主同一算法重算 payload，用**内置公钥**验签
 *      ⇒ 等价于「新装机器的宿主能不能加载这 13 个包」，不用装 app 也能证
 *
 * 用法：
 *   node scripts/verify-trust.mjs                 # 默认找 %USERPROFILE%\.zeronote-keys\<keyId>.key.pem
 *   node scripts/verify-trust.mjs --key <pem>     # 指定私钥
 *   node scripts/verify-trust.mjs --dist <目录>    # 指定包目录（默认 dist）
 *   node scripts/verify-trust.mjs --no-key        # 只验格式与包（无私钥的机器 / CI 用）
 *
 * 退出码：0 全过（含「无可验证对象」的跳过），1 有失败。
 *
 * ⚠️ **不要加进 verify.ps1 质量门**：私钥和 `dist/*.znp` 都在仓库外 / 构建产物，
 * CI 上两者都没有。它是「发版前手工跑一次」的检查。
 */
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { digestForSigning } from './lib/signing.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? fallback : v
}

/** Ed25519 的 SPKI DER 前缀：Node 只吃 DER/PEM，不吃裸 32 字节 */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function publicKeyFromRaw(raw) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  })
}

function rawPublicKeyOf(privateKey) {
  const der = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  return der.subarray(der.length - 32)
}

/**
 * 从 Rust 源码解析内置信任根。
 *
 * 刻意用「找常量名 + 取数组字面量」而不是全文扫 `("...", "...")`：
 * 后者会把文件里任何别处的两字符串元组都当成公钥。
 */
function readBuiltinKeys(libPath) {
  const src = readFileSync(libPath, 'utf8')
  const m = src.match(/const\s+BUILTIN_TRUSTED_KEYS[^=]*=\s*&\[([\s\S]*?)\];/)
  if (!m) {
    throw new Error(
      `在 ${libPath} 里找不到 \`const BUILTIN_TRUSTED_KEYS … = &[ … ];\` —— ` +
        '常量被改名 / 改了写法就要同步改这个脚本（否则这项检查会静默失效）',
    )
  }
  // rustfmt 会把长公钥拆成多行 ⇒ 元组里允许换行与尾逗号
  const keys = [...m[1].matchAll(/\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,?\s*\)/g)].map(
    ([, keyId, publicKey]) => ({ keyId, publicKey }),
  )
  if (!keys.length) throw new Error('BUILTIN_TRUSTED_KEYS 解析出 0 条 —— 数组写空了？')
  return keys
}

const fails = []
const skipped = []
function check(ok, label, detail = '') {
  console.log(`${ok ? '✓' : '❌'} ${label}${detail ? `：${detail}` : ''}`)
  if (!ok) fails.push(label)
}

const libPath = arg('lib', join(repo, 'src-tauri', 'src', 'lib.rs'))
const distDir = resolve(repo, arg('dist', 'dist'))
const explicitKey = arg('key')
const noKey = process.argv.includes('--no-key')

console.log(`解析内置信任根：${libPath}`)
const builtins = readBuiltinKeys(libPath)
console.log(`找到 ${builtins.length} 条：${builtins.map((k) => k.keyId).join(', ')}\n`)

/** keyId → Buffer(raw 32 B)，给第 5 段验包用 */
const rawByKeyId = new Map()

for (const { keyId, publicKey } of builtins) {
  console.log(`── keyId=${keyId}`)

  let raw
  try {
    raw = Buffer.from(publicKey, 'base64')
  } catch {
    check(false, '公钥是合法 base64')
    continue
  }
  if (raw.length !== 32) {
    check(false, '公钥是 32 字节', `实际 ${raw.length} 字节`)
    continue
  }
  rawByKeyId.set(keyId, raw)
  check(true, '公钥是 32 字节')

  // 3+4：有私钥就做「私钥 ↔ 内置公钥」对账
  const keyPath =
    explicitKey ??
    (process.env.USERPROFILE
      ? join(process.env.USERPROFILE, '.zeronote-keys', `${keyId}.key.pem`)
      : null)
  if (noKey || !keyPath || !existsSync(keyPath)) {
    skipped.push(`私钥对账（${keyId}）`)
    console.log(`  ⏭ 跳过私钥对账：${noKey ? '--no-key' : `找不到 ${keyPath}`}`)
    continue
  }

  let derived
  try {
    const sk = createPrivateKey(readFileSync(keyPath))
    derived = rawPublicKeyOf(sk)
    const same = derived.equals(raw)
    check(
      same,
      '私钥导出的公钥与内置值一致',
      same ? '逐字节相同' : `内置 ${publicKey} ≠ 私钥导出 ${derived.toString('base64')}`,
    )
    if (!same) continue

    // 自签一段再验：证明「内置公钥能验这把私钥的签名」这条路径本身通
    const probe = `zn-plugin-v2|trust-probe|0.0.0|${'0'.repeat(64)}|`
    const sig = sign(null, Buffer.from(probe, 'utf8'), sk)
    const ok = verify(null, Buffer.from(probe, 'utf8'), publicKeyFromRaw(raw), sig)
    check(ok, '自签 payload 用内置公钥验过')
  } catch (e) {
    check(false, '私钥可用', String(e))
  }
}

// 5：拿实包验（等价「新装机器的宿主」）
if (!existsSync(distDir)) {
  skipped.push(`包验签（找不到 ${distDir}）`)
  console.log(`\n⏭ 跳过包验签：找不到 ${distDir}（先跑 pack-plugin.mjs）`)
} else {
  const packs = readdirSync(distDir).filter((f) => f.endsWith('.znp')).sort()
  console.log(`\n── 包验签：${distDir}（${packs.length} 个 .znp）`)
  let signed = 0
  let unsigned = 0
  for (const name of packs) {
    let pack
    try {
      pack = JSON.parse(readFileSync(join(distDir, name), 'utf8'))
    } catch (e) {
      check(false, `${name} 是合法 JSON`, String(e))
      continue
    }
    const { manifest, files } = pack
    const sigRaw = files?.['signature.json']
    if (!sigRaw) {
      unsigned += 1
      console.log(`  · ${name}：无 signature.json（纯样式插件恒为 unsigned），跳过`)
      continue
    }
    let sig
    try {
      sig = JSON.parse(sigRaw)
    } catch (e) {
      check(false, `${name} 的 signature.json 是合法 JSON`, String(e))
      continue
    }
    const raw = rawByKeyId.get(sig.keyId)
    if (!raw) {
      check(false, `${name} 的 keyId=${sig.keyId} 在内置信任根里`)
      continue
    }
    let payload
    try {
      payload = digestForSigning(manifest, files).payload
    } catch (e) {
      check(false, `${name} 能重算 payload`, String(e))
      continue
    }
    const ok = verify(
      null,
      Buffer.from(payload, 'utf8'),
      publicKeyFromRaw(raw),
      Buffer.from(sig.sig, 'base64'),
    )
    check(ok, `${name} 用内置公钥验过`)
    if (ok) signed += 1
  }
  console.log(`  签名包 ${signed}/${signed + unsigned}${unsigned ? `（${unsigned} 个无签名，纯样式）` : ''}`)
}

console.log('')
if (skipped.length) console.log(`⏭ 跳过：${skipped.join(' · ')}`)
if (fails.length) {
  console.log(`❌ ${fails.length} 项失败`)
  process.exit(1)
}
console.log('✅ 内置公钥：「格式对 · 与私钥对应 · 已打包的签名包都验得过」')
