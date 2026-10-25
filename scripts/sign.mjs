#!/usr/bin/env node
/**
 * 给一个插件目录生成 `signature.json`（rev173.77 起 · 契约 §7.4；rev173.142 升到 v2）。
 *
 * 用法：
 *   node scripts/sign.mjs <插件目录> <私钥.pem> [--key-id <id>] [--check]
 *
 * 签名覆盖的是 **身份 + 全部声明文件**：
 *   payload = "zn-plugin-v2|<manifest.id>|<manifest.version>|<入口 sha256>|<path:sha256 排序拼接>"
 *   ⇒ 改入口 / 改 manifest.files 里任何一个文件 / 改 id / 改 version 都让签名失效；
 *     改 README、加不在 files 里的附件不受影响。
 *
 * **v1 → v2（2026-10-25）**：v1 只签入口，多文件插件里 lib/*.js 被换掉也验得过。
 * v2 把 `manifest.files` 一起签进去。升级时实测没有任何插件带 signature.json，
 * 所以不存在兼容问题；旧签名在 v2 下一律验不过（宿主会拒载并报原因）。
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
function signingPayload(id, version, entrySha256, files = []) {
  const tail = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => `${f.path}:${f.sha256}`)
    .join('|')
  return `zn-plugin-v2|${id}|${version}|${entrySha256}|${tail}`
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

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
const entrySha256 = sha256(readFileSync(entryPath))
const files = []
for (const rel of manifest.files ?? []) {
  if (rel === manifest.entry) continue
  const p = join(dir, rel)
  if (!existsSync(p)) {
    console.error(`manifest.files 声明了 ${rel}，但文件不存在：${p}`)
    process.exit(1)
  }
  files.push({ path: rel, sha256: sha256(readFileSync(p)) })
}
const payload = signingPayload(manifest.id, manifest.version, entrySha256, files)

console.log(`插件：${manifest.id}@${manifest.version}`)
console.log(`入口：${manifest.entry} · sha256 ${entrySha256}`)
if (files.length) console.log(`另签 ${files.length} 个文件：${files.map((f) => f.path).join(', ')}`)
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
