#!/usr/bin/env node
/**
 * ZeroNote 事实快照（2026-10-20）
 *
 * 目的：把「当前事实」从手写文档里挪到机器生成 —— 版本 / rev / HEAD / 测试基线 /
 * 插件数 / 文档新鲜度，全部由本脚本读取仓库与本机状态后产出。
 *
 * 用法：
 *   node scripts/facts.mjs            # 打印事实表（只读）
 *   node scripts/facts.mjs --write    # 把事实表写进 HANDOFF-CARD.md 的 FACTS 块
 *   node scripts/facts.mjs --check    # 门：块是否最新 / README 是否落后 / CHANGELOG 是否跟上
 *
 * 数据来源（按优先级）：
 *   1. scripts/.verify-baseline.json —— verify.ps1 每次跑完写入（本机，gitignored）
 *   2. 最新的 _verify-*.log —— 手动重定向产生的历史日志
 *   3. 都没有 → 显示「未跑 verify」，不阻塞
 *
 * 设计约束：
 *   - 生成块里**不写时间戳的时分**，只写日期 → 同一天重复生成结果稳定（--check 不抖）。
 *   - --write 只改 HANDOFF-CARD.md；README 是产品门面，由人写，facts 只检查日期是否落后。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const argv = new Set(process.argv.slice(2))
const CHECK = argv.has('--check')
const WRITE = argv.has('--write')

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const maybeRead = (p) => (fs.existsSync(path.join(root, p)) ? read(p) : '')
const exists = (p) => fs.existsSync(path.join(root, p))
const listDirs = (p) => {
  const abs = path.join(root, p)
  if (!fs.existsSync(abs)) return []
  return fs.readdirSync(abs, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
}
const git = (...a) => {
  const r = spawnSync('git', a, { cwd: root, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : ''
}
const today = (d) => d.toISOString().slice(0, 10)
const localDate = (ms) => {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ---------- 采集 ----------
const handoff = maybeRead('HANDOFF.md')
const card = maybeRead('HANDOFF-CARD.md')
const pkg = JSON.parse(maybeRead('package.json') || '{}')
const handoffRev = /revision:\s*([\d.]+)/.exec(handoff)?.[1] ?? '?'
const handoffDate = /更新时间:\s*(\d{4}-\d{2}-\d{2})/.exec(handoff)?.[1] ?? '?'
const cardHead = /最后更新 \*\*(\d{4}-\d{2}-\d{2})（(rev[\d.]+)）\*\*/.exec(card)
const cardDate = cardHead?.[1] ?? '?'
const cardRev = cardHead?.[2] ?? '?'
const readmeDate = /\*\*现状（(\d{4}-\d{2}-\d{2})/.exec(maybeRead('README.md'))?.[1] ?? '?'
const changelog = maybeRead('CHANGELOG.md')
const appVersion = /## 应用版本[\s\S]*?\n\| (\d+\.\d+\.\d+) \|/.exec(changelog)?.[1] ?? '?'
const examples = listDirs('examples')
const builtinSrc = maybeRead('src/kernel/builtin-plugins.ts')
const builtinBlock = /export const BUILTIN_PLUGINS: BuiltinPlugin\[\] = \[([\s\S]*?)\n\]/.exec(builtinSrc)?.[1] ?? ''
const builtins = [...builtinBlock.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1])
const globalPluginsDir = process.env.APPDATA
  ? path.join(process.env.APPDATA, 'com.aqua.zeronote', '.zn', 'plugins')
  : ''
const globalPlugins = globalPluginsDir && fs.existsSync(globalPluginsDir)
  ? fs.readdirSync(globalPluginsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
  : null

const head = git('rev-parse', '--short', 'HEAD') || '?'
const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '?'
const dirty = (git('status', '--porcelain') || '').split('\n').filter(Boolean).length

// 测试基线：baseline JSON > 最新日志 > 无
let baseline = null
let baselineSrc = ''
const baselinePath = 'scripts/.verify-baseline.json'
if (exists(baselinePath)) {
  try {
    baseline = JSON.parse(read(baselinePath).replace(/^\uFEFF/, ''))
    baselineSrc = `verify ${baseline.at ?? ''}`.trim()
  } catch {
    baseline = null
  }
}
if (!baseline) {
  const logs = fs
    .readdirSync(root)
    .filter((f) => /^_verify-.*\.log$/.test(f))
    .map((f) => ({ f, m: fs.statSync(path.join(root, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  if (logs.length) {
    const txt = read(logs[0].f)
    const v = /vitest：(\d+) passed/.exec(txt)?.[1]
    const c = /cargo test --lib：(\d+) passed/.exec(txt)?.[1]
    const o = /oxlint：0 error · (\d+) warnings/.exec(txt)?.[1]
    if (v || c) baseline = { at: localDate(logs[0].m), vitest: v, cargo: c, oxlint: o, src: logs[0].f }
    baselineSrc = `日志 ${logs[0].f}`
  }
}

// ---------- 生成块 ----------
const stale = readmeDate !== '?' && handoffDate !== '?' && readmeDate < handoffDate
const baselineStale = !!baseline?.at && handoffDate !== '?' && baseline.at < handoffDate
const baselineLine = baseline
  ? `vitest ${baseline.vitest ?? '?'} · cargo ${baseline.cargo ?? '?'} · oxlint ${baseline.oxlint ?? '?'} warnings（${baseline.at ?? '?'}${baselineStale ? `，落后于 rev${handoffRev}` : ''}）`
  : '—（未跑 verify）'
const block = [
  '<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->',
  '| 事实 | 当前值 |',
  '|---|---|',
  `| rev / 版本 | rev${handoffRev} · ${pkg.version ?? '?'} · ${handoffDate} |`,
  `| 测试基线 | ${baselineLine} |`,
  `| 插件 | 内置 ${builtins.length} · 示例 ${examples.length} |`,
  `| 文档 | README 现状 ${readmeDate}${stale ? '（落后）' : ''} · CHANGELOG ${appVersion} |`,
  '<!-- FACTS:END -->',
].join('\n')

const BEGIN = '<!-- FACTS:BEGIN'
const END = '<!-- FACTS:END -->'
function splice(text, body) {
  const b = text.indexOf(BEGIN)
  const e = text.indexOf(END)
  if (b >= 0 && e > b) {
    // 替换已有块：块后保证一个空行（Markdown 段落需要）
    return text.slice(0, b) + body + text.slice(e + END.length).replace(/^\n(?!\n)/, '\n\n')
  }
  const i = text.indexOf('\n## ')
  if (i < 0) return text + '\n' + body + '\n'
  return text.slice(0, i) + '\n' + body + '\n\n' + text.slice(i + 1)
}

// ---------- 模式 ----------
if (WRITE) {
  if (!card) {
    console.error('❌ 找不到 HANDOFF-CARD.md')
    process.exit(1)
  }
  const next = splice(card, block)
  if (next !== card) {
    fs.writeFileSync(path.join(root, 'HANDOFF-CARD.md'), next, 'utf8')
    console.log('✅ 已刷新 HANDOFF-CARD.md 的 FACTS 块')
  } else {
    console.log('✅ FACTS 块已是最新')
  }
  process.exit(0)
}

const problems = []
if (cardDate !== '?' && handoffDate !== '?' && cardDate < handoffDate) {
  problems.push(`HANDOFF-CARD 头部 ${cardDate} 落后于 HANDOFF 更新时间 ${handoffDate}`)
}
if (cardRev !== '?' && `rev${handoffRev}` !== cardRev) {
  problems.push(`HANDOFF-CARD 头部 ${cardRev} 与 HANDOFF revision rev${handoffRev} 不一致`)
}
if (readmeDate === '?') problems.push('README.md 缺「**现状（YYYY-MM-DD）**」行')
else if (stale) problems.push(`README.md 现状 ${readmeDate} 落后于 HANDOFF 更新时间 ${handoffDate}`)
if (appVersion !== '?' && pkg.version && appVersion !== pkg.version) {
  problems.push(`CHANGELOG 最新应用版本 ${appVersion} 与 package.json ${pkg.version} 不一致`)
}

if (CHECK) {
  const current = card.slice(card.indexOf(BEGIN), card.indexOf(END) + END.length)
  // 「测试基线」这一行只有本机有（baseline JSON / _verify-*.log 都不入库）⇒ CI 上必然对不上。
  // CI 里 `baseline` 为 null 时忽略该行；本机有基线时照旧整块比较（否则本地门会失去意义）。
  const ignoreBaseline = (s) => s.replace(/^\| 测试基线 \|.*$/m, '| 测试基线 | （本机才有） |')
  const norm = (s) => (baseline ? s : ignoreBaseline(s))
  if (!current) problems.push('HANDOFF-CARD.md 缺 FACTS 块（跑 node scripts/facts.mjs --write）')
  else if (norm(current) !== norm(block)) problems.push('HANDOFF-CARD.md 的 FACTS 块不是最新（跑 node scripts/facts.mjs --write）')
}

console.log('事实快照')
console.log(block.split('\n').filter((l) => l.startsWith('|') && !l.startsWith('|---')).join('\n'))
if (baselineSrc && !baseline?.src) console.log(`来源：${baselineSrc}`)
if (baseline?.src) console.log(`来源：${baselineSrc}`)

if (problems.length) {
  console.error(`\n❌ facts：${problems.length} 个问题`)
  for (const p of problems) console.error('  - ' + p)
  process.exit(1)
}
console.log(`\n✅ facts：rev${handoffRev} · HEAD ${head} · 内置 ${builtins.length} · 示例 ${examples.length}`)
