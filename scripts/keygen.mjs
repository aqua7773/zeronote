#!/usr/bin/env node
/**
 * 生成插件签名用的 **Ed25519 密钥对**（rev173.77 · 契约 §7.4）。
 *
 * 用法：
 *   node scripts/keygen.mjs                        # 默认 keyId = aqua-<日期>
 *   node scripts/keygen.mjs --key-id aqua-2026 --out _tmp-keys
 *
 * 产物（`--out` 默认 `_tmp-keys/`，已被 `_tmp-*` 规则忽略，**别提交**）：
 *   <out>/<keyId>.key.pem    私钥（PKCS8 PEM）—— 泄露 = 任何人可用你的身份签插件
 *   <out>/<keyId>.pub.json   `{ keyId, publicKey }`，publicKey = base64(32 字节 raw)
 *
 * 下一步：把 publicKey 填进全局信任根
 *   `<应用数据目录>/.zn/trusted-keys.json`（Windows：%APPDATA%\com.aqua.zeronote\.zn\trusted-keys.json）
 * 本脚本会在 stdout 直接打印一段可直接粘贴的 JSON 片段。
 */
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const keyId = arg('key-id', `aqua-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`)
const outDir = resolve(repo, arg('out', '_tmp-keys'))
mkdirSync(outDir, { recursive: true })

const { publicKey, privateKey } = generateKeyPairSync('ed25519')

// 私钥：PKCS8 PEM（Node 能再读回来给 sign.mjs 用）
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
writeFileSync(join(outDir, `${keyId}.key.pem`), pem, { mode: 0o600 })

// 公钥：SPKI DER 的最后 32 字节就是 raw Ed25519 公钥（Rust 侧 VerifyingKey::from_bytes 要这个）
const spki = publicKey.export({ type: 'spki', format: 'der' })
const raw = spki.subarray(spki.length - 32)
const pubJson = { keyId, publicKey: raw.toString('base64') }
writeFileSync(join(outDir, `${keyId}.pub.json`), JSON.stringify(pubJson, null, 2), 'utf8')

console.log(`✅ 密钥对已生成（keyId = ${keyId}）`)
console.log(`   私钥：${join(outDir, `${keyId}.key.pem`)}  ← 别提交、别外传`)
console.log(`   公钥：${join(outDir, `${keyId}.pub.json`)}`)
console.log('')
console.log('把这段追加进 <应用数据目录>/.zn/trusted-keys.json 的 keys 数组：')
console.log(JSON.stringify(pubJson))
console.log('')
console.log(`之后签名插件：node scripts/sign.mjs <插件目录> ${join(outDir, `${keyId}.key.pem`)}`)
