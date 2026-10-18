#!/usr/bin/env node
/**
 * 给「已安装的插件」补 `category` 字段（rev173.4 · 用户「现有插件也加上这个字段」）。
 *
 * 背景：分类是插件页的分组依据。`examples/` 里的 manifest 已经带上；
 * 但**已安装的副本**（全局根 / 库内 `.zn/plugins/`）是安装当时的拷贝，里面没有这个字段。
 * 这个脚本就地补齐，规则与 `src/lib/plugin-category.ts` 的 `categorizePlugin` 一致：
 *
 *   ① 已有合法 category → 跳过（幂等）；
 *   ② `examples/` 里有同名插件 → 抄它的分类（同一份插件，别推断出不同结果）；
 *   ③ 只有 styles、没有 entry → theme；
 *   ④ 名字带 demo / probe / hello… → demo；
 *   ⑤ 关键词 reader / theme / editor → 对应组；都不命中 → tool。
 *
 * 用法：
 *   node scripts/plugin-category-backfill.mjs <插件根目录> [更多根目录…]
 *   node scripts/plugin-category-backfill.mjs            # 默认：examples + 全局根
 *
 * 只改 manifest.json 的一个字段，不碰 entry / styles 等其它内容；解析失败的文件跳过并打印。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

const CATEGORIES = new Set(['editor', 'reader', 'theme', 'tool', 'demo'])

/** 与 src/lib/plugin-category.ts 的 categorizePlugin 保持一致（脚本不能 import TS） */
function categorize(m) {
  if (typeof m.category === 'string' && CATEGORIES.has(m.category)) return m.category
  const id = String(m.id ?? '').toLowerCase()
  if (!m.entry && Array.isArray(m.styles) && m.styles.length > 0) return 'theme'
  if (/(demo|probe|hello|example|sample|playground)/.test(id)) return 'demo'
  if (/(theme|skin)/.test(id)) return 'theme'
  if (/(reader|pdf|epub)/.test(id)) return 'reader'
  if (/(editor|mark|outline|mindmap|inspiration|tag|index)/.test(id)) return 'editor'
  return 'tool'
}

/** examples/<dir>/manifest.json 的 id → category 映射（优先抄它） */
function exampleCategories() {
  const map = new Map()
  const dir = join(REPO, 'examples')
  if (!existsSync(dir)) return map
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (!name.isDirectory()) continue
    const p = join(dir, name.name, 'manifest.json')
    if (!existsSync(p)) continue
    try {
      const m = JSON.parse(readFileSync(p, 'utf8'))
      if (m.id && CATEGORIES.has(m.category)) map.set(m.id, m.category)
    } catch {
      /* 坏的例子跳过 */
    }
  }
  return map
}

function defaultGlobalRoot() {
  // 桌面：%APPDATA%\com.aqua.zeronote\.zn\plugins
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'com.aqua.zeronote', '.zn', 'plugins')
  }
  return null
}

const fromExamples = exampleCategories()
const roots = process.argv.slice(2)
if (roots.length === 0) {
  roots.push(join(REPO, 'examples'))
  const g = defaultGlobalRoot()
  if (g) roots.push(g)
}

let changed = 0
let scanned = 0
const skipped = []

for (const root of roots) {
  if (!existsSync(root)) {
    console.log(`跳过（不存在）：${root}`)
    continue
  }
  for (const ent of readdirSync(root, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue
    const file = join(root, ent.name, 'manifest.json')
    if (!existsSync(file)) continue
    scanned++
    let m
    try {
      m = JSON.parse(readFileSync(file, 'utf8'))
    } catch (e) {
      skipped.push(`${file}: ${e.message}`)
      continue
    }
    if (typeof m.category === 'string' && CATEGORIES.has(m.category)) continue
    const cat = fromExamples.get(m.id) ?? categorize(m)
    // 保持字段顺序：插到 description（或 capabilities）之前，读起来像"元信息一段"
    const entries = Object.entries(m)
    const at = entries.findIndex(([k]) => k === 'capabilities')
    entries.splice(at < 0 ? entries.length : at, 0, ['category', cat])
    const out = Object.fromEntries(entries)
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, 'utf8')
    changed++
    console.log(`+ ${cat.padEnd(6)} ${file}`)
  }
}

console.log(`\n扫描 ${scanned} 个 manifest，补齐 ${changed} 个${skipped.length ? `，跳过 ${skipped.length} 个解析失败` : ''}`)
for (const s of skipped) console.log(`  ! ${s}`)
