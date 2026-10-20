#!/usr/bin/env node
/**
 * 给一个插件目录生成 `signature.json`（rev173.77 · 契约 §7.4）。
 *
 * 用法：
 *   node scripts/sign.mjs <插件目录> <私钥.pem> [--key-id <id>] [--check]
 *
 * 签名覆盖的是 **身份 + 内容**，不是整个目录：
 *   payload = "zn-plugin-v1|<manifest.id>|<manifest.version>|<入口文件 sha256>"
 * 所以：改入口文件 / 改 id / 改 version 都让签名失效；改 README 之类不受影响。
 *
 * 产物写进插件目录：`signature.json`
 *   { "alg": "ed25519", "keyId": "...", "sig": "<base64 64B>" }
 * 宿主加载时会**自己重算 payload 再验签**，不信这个文件里的任何其它字段。
 *
 * `--check`：只重新计算并打印将签的 payload，不写文件（核对用）。
 */
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 与前端 `src/lib/plugin-signing.ts` 的 signingPayload() **必须逐字一致** */
function signingPayload({ id, version, entrySha256 }) {
  return `zn-plugin-v1|${id}|${version}|${entrySha256}`
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const dirArg = process.argv[2]
const keyArg = process.argv[3]
if (!dirArg || !keyArg) {
  console.error('用法：node scripts/sign.mjs <插件目录> <私钥.pem> [--key-id <id>] [--check]')
  process.exit(1)
}

const dir = resolve(repo, dirArg)
const keyPath = resolve(repo, keyArg)
const check = process.argv.includes('--check')

const manifestPath = join(dir, 'manifest.json')
if (!existsSync(manifestPath)) {
  console.error(`找不到 ${manifestPath}`)
  process.exit(1)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (!manifest.id || !manifest.version || !manifest.entry) {
  console.error('manifest 缺 id / version / entry，无法签名')
  process.exit(1)
}

const entryPath = join(dir, manifest.entry)
if (!existsSync(entryPath)) {
  console.error(`找不到入口文件 ${entryPath}`)
  process.exit(1)
}
const entrySha256 = createHash('sha256').update(readFileSync(entryPath)).digest('hex')
const payload = signingPayload({ id: manifest.id, version: manifest.version, entrySha256 })

console.log(`插件：${manifest.id}@${manifest.version}`)
console.log(`入口：${manifest.entry} · sha256 ${entrySha256}`)
console.log(`将签：${payload}`)

if (check) {
  console.log('（--check：不写文件）')
  process.exit(0)
}

const keyId = arg('key-id') ?? manifest.sigKeyId ?? 'default'
const privateKey = createPrivateKey(readFileSync(keyPath))
const sig = sign(null, Buffer.from(payload, 'utf8'), privateKey)

const out = { alg: 'ed25519', keyId, sig: sig.toString('base64') }
writeFileSync(join(dir, 'signature.json'), JSON.stringify(out, null, 2) + '\n', 'utf8')
console.log(`✅ 已写入 ${join(dir, 'signature.json')}`)
console.log(`   keyId = ${keyId}（必须存在于全局 .zn/trusted-keys.json，否则宿主拒绝加载）`)
