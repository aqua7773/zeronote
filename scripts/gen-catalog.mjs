#!/usr/bin/env node
/**
 * ZeroNote 功能目录生成器（2026-10-20）
 *
 * 从 manifest 扫描生成 docs/功能目录.md —— 「有哪些插件 / 各自声明了什么」不再手写。
 *
 * 用法：
 *   node scripts/gen-catalog.mjs --write   # 生成/更新 docs/功能目录.md
 *   node scripts/gen-catalog.mjs --check   # 门：生成结果与文件是否一致（漂移即失败）
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const OUT = 'docs/功能目录.md'
const CHECK = process.argv.includes('--check')

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))
const listDirs = (p) => fs.readdirSync(path.join(root, p), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)

/**
 * rev173.259：**不再有内置/预装插件**（用户「不设置内置插件，之前预装的改为推荐优先安装」）——
 * 应用第一次启动就是零插件，装插件统一走 插件中心 → 插件市场，或手动装 `.znp`。
 * 本表只描述「仓库里有哪些插件源码 / 市场包从哪来」。
 */

const plugins = []
for (const dir of listDirs('examples').sort()) {
  const mf = path.join(root, 'examples', dir, 'manifest.json')
  if (!fs.existsSync(mf)) continue
  try {
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'))
    plugins.push({
      id: m.id ?? dir,
      name: m.name ?? dir,
      category: m.category ?? '—',
      platforms: (m.platforms ?? []).join(' / ') || '全平台',
      caps: (m.capabilities ?? []).length,
      commands: (m.contributes?.commands ?? []).length,
      activation: (m.activationEvents ?? []).join(' / ') || '立即',
    })
  } catch (e) {
    console.error(`⚠️  examples/${dir}/manifest.json 解析失败：${e.message}`)
  }
}

const native = []
if (exists('src-tauri/plugins')) {
  for (const dir of listDirs('src-tauri/plugins').sort()) {
    const cargo = path.join(root, 'src-tauri', 'plugins', dir, 'Cargo.toml')
    const desc = fs.existsSync(cargo) ? /description\s*=\s*"([^"]*)"/.exec(fs.readFileSync(cargo, 'utf8'))?.[1] : ''
    native.push({ dir, desc: desc ?? '' })
  }
}

const byCategory = new Map()
for (const p of plugins) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1)

const table = (rows) => [
  '| id | 名称 | 分类 | 平台 | 能力 | 命令 | 激活 |',
  '|---|---|---|---|---|---|---|',
  ...rows.map(
    (p) =>
      `| ${p.id} | ${p.name} | ${p.category} | ${p.platforms} | ${p.caps} | ${p.commands || '—'} | ${p.activation} |`,
  ),
]

const md = [
  '# 功能目录（自动生成）',
  '',
  `> 状态：**generated** ｜来源：\`examples/*/manifest.json\` + \`src-tauri/plugins/*/Cargo.toml\` ｜生成：\`node scripts/gen-catalog.mjs --write\`（勿手改）`,
  '> 改功能请改 manifest，再重新生成；本文件由 `scripts/gen-catalog.mjs --check` 校验是否最新。',
  '> **应用不预装任何插件**（rev173.259）：第一次启动是零插件，装插件一律走 插件中心 → 插件市场（或手动装 `.znp`）。',
  '',
  '## 概览',
  '',
  '| 项 | 数量 |',
  '|---|---|',
  `| 插件 | ${plugins.length} |`,
  `| 原生 Tauri 插件 | ${native.length} |`,
  ...['editor', 'reader', 'theme', 'tool', 'demo', '—'].filter((c) => byCategory.has(c)).map((c) => `| 分类 ${c} | ${byCategory.get(c)} |`),
  '',
  '## 插件（`examples/` 是源码；市场包由 `scripts/pack-plugin.mjs` 从这里打）',
  '',
  ...table(plugins),
  '',
  '## 原生 Tauri 插件（`src-tauri/plugins/`，随 App 编译）',
  '',
  '| 目录 | 说明 |',
  '|---|---|',
  ...native.map((n) => `| ${n.dir} | ${n.desc || '—'} |`),
  '',
  '## 内核原语（不在本表：见契约 §1–§2）',
  '',
  '`fs` / `doc` / `index` / `event` / `command` / `view` / `store` / `host` / `service` / `editor` —— 唯一权威是 `docs/内核契约-v0.2.md`。',
  '',
].join('\n')

if (CHECK) {
  const current = exists(OUT) ? read(OUT) : ''
  if (current !== md) {
    const a = current.split('\n').length
    const b = md.split('\n').length
    console.error(`❌ 功能目录已漂移（文件 ${a} 行 / 生成 ${b} 行）：跑 node scripts/gen-catalog.mjs --write`)
    process.exit(1)
  }
  console.log(`✅ 功能目录：${plugins.length} 个示例插件 / ${native.length} 个原生插件，与 manifest 一致`)
  process.exit(0)
}

fs.writeFileSync(path.join(root, OUT), md, 'utf8')
console.log(`✅ 已生成 ${OUT}：${plugins.length} 个插件 / ${native.length} 个原生（不再有内置预装）`)
