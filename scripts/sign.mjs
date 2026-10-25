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
 * ⚠️ **签名只覆盖 manifest.files 声明的文件**（外加入口）。你在插件目录里多放一个
 * `helper.js` 但没写进 manifest.files ⇒ 它既不会被加载，也不会被签 —— 这是有意的：
 * 签名的是「宿主会执行的东西」，不是「目录里有什么」。
 *
 * 产物写进插件目录：`signature.json`
 *   { "alg": "ed25519", "keyId": "...", "sig": "<base64 64B>" }
 * 宿主加载时会**自己重算 payload 再验签**，不信这个文件里的任何其它字段。
 *
 * `--check`：只重新计算并打印将签的 payload，不写文件（核对用）。
 *
 * 实现细节在 `scripts/lib/signing.mjs`（`pack-plugin.mjs` 也用同一份）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SIGNATURE_FILE, collectPluginFiles, digestForSigning, readManifest, signFiles } from './lib/signing.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

const manifest = readManifest(dir)
if (!manifest.id || !manifest.version) {
  console.error('manifest 缺 id 或 version，无法签名')
  process.exit(1)
}
if (!manifest.entry) {
  console.error('纯样式插件（无 entry）不可签名 —— 宿主对它恒为 unsigned')
  process.exit(1)
}
if (!existsSync(join(dir, manifest.entry))) {
  console.error(`找不到入口文件 ${join(dir, manifest.entry)}`)
  process.exit(1)
}

const files = collectPluginFiles(dir, manifest)
const { entrySha, files: extra, payload } = digestForSigning(manifest, files)

console.log(`插件：${manifest.id}@${manifest.version}`)
console.log(`入口：${manifest.entry} · sha256 ${entrySha}`)
if (extra.length) console.log(`另签 ${extra.length} 个文件：${extra.map((f) => f.path).join(', ')}`)
console.log(`将签：${payload}`)

if (check) {
  console.log('（--check：不写文件）')
  process.exit(0)
}

const { signature } = signFiles(manifest, files, { keyPath, keyId: arg('key-id') })
writeFileSync(join(dir, SIGNATURE_FILE), JSON.stringify(signature, null, 2) + '\n', 'utf8')
console.log(`✅ 已写入 ${join(dir, SIGNATURE_FILE)}`)
console.log(`   keyId = ${signature.keyId}（必须存在于全局 .zn/trusted-keys.json，否则宿主拒绝加载）`)
