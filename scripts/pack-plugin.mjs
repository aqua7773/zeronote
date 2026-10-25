#!/usr/bin/env node
/**
 * 把一个插件目录打成 **`.znp`**（单文件 JSON 包）并生成它的 **市场条目**。
 * 2026-10-25 rev173.143 —— 插件市场阶段 0 的第一件工具。
 *
 * 用法：
 *   node scripts/pack-plugin.mjs <插件 id 或目录> [选项]
 *
 * 选项：
 *   --key <私钥.pem>        签名（不给则不签；对外分发的包必须签）
 *   --key-id <id>           signature.json 里的 keyId（默认 manifest.sigKeyId 或 default）
 *   --out <目录>            `.znp` 落点（默认 `dist`）
 *   --entries <目录>        市场条目落点（默认 `market/entries`；传空串则不写）
 *   --repo <owner/repo>     用于拼下载 URL（默认 `aqua7773/zeronote`）
 *   --tag <tag>             Release tag（默认 `plugins-v<version>`）
 *   --author <名字>         条目里的作者（默认 `aqua7773`）
 *   --check                 只打印将产出什么，不写文件
 *
 * 产物：
 *   <out>/<id>-<version>.znp       插件包（内含 manifest + files [+ signature.json]）
 *   <entries>/<id>.json            市场条目（展示字段 + 下载地址 + 整个包的 sha256）
 *
 * 为什么条目里存的是**整包 sha256**而不是入口的：市场下载完要能一眼校验「这个文件没被动过」，
 * 入口 sha256 只能证明入口没改（见 docs/插件市场-调研 §5 三条路径）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectPluginFiles, digestForSigning, readManifest, sha256, signFiles } from './lib/signing.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? fallback : v
}

const target = process.argv[2]
if (!target || target.startsWith('--')) {
  console.error('用法：node scripts/pack-plugin.mjs <插件 id 或目录> [--key <pem>] [--out dist] [--entries market/entries]')
  process.exit(1)
}

const dir = target.includes('/') || target.includes('\\') || target === '.' ? resolve(repo, target) : join(repo, 'examples', target)
const outDir = resolve(repo, arg('out', 'dist'))
const entriesArg = arg('entries', 'market/entries')
const entriesDir = entriesArg ? resolve(repo, entriesArg) : null
const keyPath = arg('key') ? resolve(repo, arg('key')) : null
const repoSlug = arg('repo', 'aqua7773/zeronote')
const author = arg('author', 'aqua7773')
const check = process.argv.includes('--check')

const manifest = readManifest(dir)
const { id, version } = manifest
if (!id || !version) {
  console.error('manifest 缺 id 或 version')
  process.exit(1)
}
const tag = arg('tag', `plugins-v${version}`)

// ── 1. 收文件（排除 manifest.json / signature.json，它们单独处理） ──
const files = collectPluginFiles(dir, manifest)

// ── 2. 签名（可选） ──
if (!manifest.entry) {
  // 纯样式插件：宿主对它恒为 `unsigned`（没有入口就没有可签的东西），见 plugin-host.ts
  console.log('ℹ️  纯样式插件（无 entry）：宿主恒为 unsigned，跳过签名')
} else if (keyPath) {
  const { signature } = signFiles(manifest, files, { keyPath, keyId: arg('key-id') })
  files['signature.json'] = JSON.stringify(signature, null, 2) + '\n'
  console.log(`🔏 已签名（keyId=${signature.keyId}）`)
} else {
  console.log('⚠️  未签名 —— 对外分发的包应该带 --key')
}

// ── 3. 入口 sha256 填进 manifest（加载时的完整性提示，不是签名） ──
const entrySha = manifest.entry ? digestForSigning(manifest, files).entrySha : null
const manifestOut = entrySha ? { ...manifest, sha256: entrySha } : { ...manifest }

// ── 4. 组装 .znp ──
const packObj = { znp: 1, manifest: manifestOut, files }
const packText = JSON.stringify(packObj, null, 2) + '\n'
const packSha = sha256(Buffer.from(packText, 'utf8'))
const packName = `${id}-${version}.znp`
const url = `https://github.com/${repoSlug}/releases/download/${tag}/${packName}`

// ── 5. 市场条目 ──
const entry = {
  id,
  name: manifest.name,
  author,
  description: manifest.description ?? '',
  category: manifest.category ?? 'tool',
  platforms: manifest.platforms ?? ['desktop', 'android'],
  apiVersion: manifest.apiVersion,
  version,
  url,
  sha256: packSha,
  size: Buffer.byteLength(packText, 'utf8'),
  files: Object.keys(files).sort(),
}

console.log(`\n插件：${manifest.name}（${id}@${version}）`)
console.log(`文件：${entry.files.length} 个（${entry.files.join(', ')}）`)
console.log(`入口 sha256：${entrySha}`)
console.log(`整包 sha256：${packSha}`)
console.log(`大小：${(entry.size / 1024).toFixed(1)} KB`)

if (check) {
  console.log('\n（--check：不写文件）')
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, packName), packText, 'utf8')
console.log(`\n✅ 包：${join(outDir, packName)}`)

if (entriesDir) {
  mkdirSync(entriesDir, { recursive: true })
  writeFileSync(join(entriesDir, `${id}.json`), JSON.stringify(entry, null, 2) + '\n', 'utf8')
  console.log(`✅ 条目：${join(entriesDir, `${id}.json`)}`)
  console.log(`\n下一步：把 ${packName} 传到 Release「${tag}」，再跑 node scripts/gen-market.mjs --write`)
}
