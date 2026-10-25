#!/usr/bin/env node
/**
 * 生成**插件市场索引** `market/index.json`（2026-10-25 rev173.143）。
 *
 * 用法：
 *   node scripts/gen-market.mjs           # 只校验 + 打印摘要（默认；verify 用它）
 *   node scripts/gen-market.mjs --write   # 重写 market/index.json
 *
 * 数据来源（两者合并）：
 *   market/entries/*.json   官方插件条目 —— 由 `pack-plugin.mjs` 生成，**别手改**
 *   market/external.json    外部作者条目 —— 手工维护，PR 加一行（只有展示字段 + `entry` 地址）
 *
 * 形状差别（有意的，见 docs/插件市场-调研 §4.5）：
 *   · 官方条目**直接带** version / url / sha256 —— 因为包就在本仓库的 Release 里，索引能直接给全
 *   · 外部条目**不带** version，只带 `entry`（指向作者仓库的 market-entry.json）
 *     ⇒ 作者发版不用改我们的索引，也就不会出现「索引说 0.3、实际 0.4」的漂移
 *
 * 校验（任一不过 ⇒ 退出码 1，verify 的第 6 步会拦住）：
 *   ① 每个官方条目的 version 与 `examples/<id>/manifest.json` 一致（改了插件忘重新打包 = 红）
 *   ② 条目里的 id 不重复、必填字段齐全
 *   ③ 外部条目的 `entry` 必须是 http(s)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const marketDir = join(repo, 'market')
const entriesDir = join(marketDir, 'entries')
const externalPath = join(marketDir, 'external.json')
const indexPath = join(marketDir, 'index.json')
const write = process.argv.includes('--write')

const problems = []
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

// ── 官方条目 ──
const official = []
if (existsSync(entriesDir)) {
  for (const name of readdirSync(entriesDir).filter((n) => n.endsWith('.json')).sort()) {
    const p = join(entriesDir, name)
    let e
    try {
      e = readJson(p)
    } catch (err) {
      problems.push(`${name} 不是合法 JSON：${err}`)
      continue
    }
    for (const field of ['id', 'name', 'version', 'url', 'sha256', 'apiVersion']) {
      if (!e[field]) problems.push(`${name} 缺字段 ${field}`)
    }
    // 与 examples 里的真实 manifest 对齐（防「改了插件版本忘了重新打包」）
    const manifestPath = join(repo, 'examples', e.id, 'manifest.json')
    if (!existsSync(manifestPath)) {
      problems.push(`${name} 指向的 examples/${e.id}/manifest.json 不存在`)
    } else {
      const m = readJson(manifestPath)
      if (m.version !== e.version) {
        problems.push(`${name} 版本 ${e.version} 与 examples/${e.id}/manifest.json 的 ${m.version} 不一致（重新打包）`)
      }
      if (m.id !== e.id) problems.push(`${name} 的 id ${e.id} 与 manifest 的 ${m.id} 不一致`)
    }
    official.push(e)
  }
}

// ── 外部条目 ──
const external = []
if (existsSync(externalPath)) {
  let doc
  try {
    doc = readJson(externalPath)
  } catch (err) {
    problems.push(`market/external.json 不是合法 JSON：${err}`)
  }
  for (const e of doc?.plugins ?? []) {
    for (const field of ['id', 'name', 'author', 'entry']) {
      if (!e[field]) problems.push(`external.json 的条目缺字段 ${field}（id=${e.id ?? '?'}）`)
    }
    if (e.entry && !/^https?:\/\//.test(e.entry)) problems.push(`external.json 的 ${e.id}.entry 必须是 http(s)`)
    external.push(e)
  }
}

// ── 重复 id ──
const seen = new Map()
for (const e of [...official, ...external]) {
  if (seen.has(e.id)) problems.push(`id 重复：${e.id}（官方与外部同名，或两处都写了）`)
  seen.set(e.id, true)
}

if (problems.length) {
  console.error('❌ 市场索引：' + problems.length + ' 个问题')
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}

const index = {
  schema: 1,
  updated: new Date().toISOString().slice(0, 10),
  plugins: [...official, ...external],
}

console.log(`✅ 市场索引检查通过：官方 ${official.length} · 外部 ${external.length}`)
for (const e of official) console.log(`   · ${e.id}@${e.version}（${(e.size / 1024).toFixed(1)} KB）`)
for (const e of external) console.log(`   · ${e.id}（外部，entry=${e.entry}）`)

if (!write) {
  console.log('（未写盘；加 --write 重写 market/index.json）')
  process.exit(0)
}

mkdirSync(marketDir, { recursive: true })
writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8')
console.log(`\n✅ 已写入 market/index.json（${index.plugins.length} 条）`)
