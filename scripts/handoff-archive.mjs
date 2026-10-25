#!/usr/bin/env node
/**
 * HANDOFF 分卷（2026-10-25 · rev173.139）
 *
 * 问题：HANDOFF.md 是「逐 rev 追加」的单一文件，14 天就长到 890 KB / 10672 行。
 * 每个新会话开头都要读它 —— 这不是代码债，是**每个会话都要付的上下文税**。
 *
 * 做法：主文件只保留**当前版本周期**的 rev，更早的按版本切进 `docs/archive/handoff/`。
 * 每份归档自带索引，可单独读；主文件顶部有指路表。
 *
 * 用法：
 *   node scripts/handoff-archive.mjs --dry-run   # 只打印计划，不写盘
 *   node scripts/handoff-archive.mjs             # 执行（幂等：已归档的卷跳过）
 *
 * 每次发版后要改的只有 KEEP_FROM，以及把上一代 KEEP_FROM 卷进 VOLUMES。
 * 校验：`node scripts/check-docs.mjs` —— 它要求主文件「索引表 rev 集合 == 正文段 rev 集合」，
 * 本脚本同时切索引与正文，因此分卷后仍然一致。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const HANDOFF = path.join(root, 'HANDOFF.md')
const ARCHIVE_REL = 'docs/archive/handoff'

// ── 边界：主文件保留「该 rev 及更新」 ───────────────────────────────
const KEEP_FROM = 'rev173.125'

// ── 归档分卷：按时间倒序，每卷 [from 起 … to 止]（含两端） ─────────────
const VOLUMES = [
  { file: '0.4.md', version: '0.4.0', from: 'rev173.124', to: 'rev173.71' },
  { file: '0.3.md', version: '0.3.0', from: 'rev173.70', to: 'rev173.28' },
  { file: '0.2.md', version: '0.2 及更早', from: 'rev173.27', to: 'rev30' },
]

const dryRun = process.argv.includes('--dry-run')
const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(0)

const text = fs.readFileSync(HANDOFF, 'utf8')
const lines = text.split('\n')

// 1. 段落定位
const segs = []
for (let i = 0; i < lines.length; i++) {
  const m = /^> ## 📌 (rev[\d.]+)/.exec(lines[i])
  if (m) segs.push({ line: i, rev: m[1] })
}
if (!segs.length) fail('找不到任何 `> ## 📌 rev…` 段')

const notesLine = lines.findIndex((l) => /^## 备注\s*$/.test(l))
const idxHeadLine = lines.findIndex((l) => /^## rev 索引/.test(l))
if (notesLine < 0) fail('找不到 `## 备注` 段')
if (idxHeadLine < 0 || idxHeadLine > segs[0].line) fail('找不到 `## rev 索引` 段（或位置不对）')

// 2. 索引行（rev → 行文本）
const idxLines = new Map()
for (let i = idxHeadLine; i < segs[0].line; i++) {
  const m = /^\| (rev[\d.]+) \|/.exec(lines[i])
  if (m) idxLines.set(m[1], lines[i])
}

// 3. 段区间：第 i 段 = [segs[i].line, 下一段起始) / 最后一段到 `## 备注` 前
const segRange = (i) => ({
  start: segs[i].line,
  end: i + 1 < segs.length ? segs[i + 1].line : notesLine,
})
const segText = (i) => lines.slice(segRange(i).start, segRange(i).end).join('\n').replace(/\s+$/, '')
const revIndex = (rev) => segs.findIndex((s) => s.rev === rev)

// 4. 保留区与各卷
const keepTo = revIndex(KEEP_FROM)
if (keepTo < 0) fail(`主文件里找不到 ${KEEP_FROM}，无法确定保留区`)

const keepRevs = segs.slice(0, keepTo + 1).map((s) => s.rev)
const plans = VOLUMES.map((v) => {
  const a = revIndex(v.from)
  const b = revIndex(v.to)
  if (a < 0 && b < 0) return { ...v, skip: true, a, b }
  if (a < 0 || b < 0) fail(`${v.file} 的边界只存在一半：${v.from}=${a} / ${v.to}=${b}`)
  if (b < a) fail(`${v.file} 的 from 必须比 to 更新：${v.from} 在 ${v.to} 之后`)
  return { ...v, skip: false, a, b, first: segs[a].rev, last: segs[b].rev, count: b - a + 1 }
})

// 5. 构建归档内容（不写盘）
const dateMatch = /（(\d{4}-\d{2}-\d{2})/.exec(lines[segs[0].line])
const today = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10)
const archives = []
for (const p of plans) {
  if (p.skip) continue
  const idx = segs.slice(p.a, p.b + 1).map((s) => idxLines.get(s.rev) || `| ${s.rev} | （原索引缺失） |`)
  const body = []
  for (let i = p.a; i <= p.b; i++) body.push(segText(i))
  const md = [
    `# 项目交接归档 · ${p.version}（${p.first} – ${p.last}）`,
    '',
    `> 状态：**archived**（只读历史）｜${today} 从 \`HANDOFF.md\` 切出 ｜主文件：[HANDOFF.md](../../../HANDOFF.md)`,
    '> 用途：查「某个功能哪一版做的 / 当时踩了什么坑」。**现状以主文件 + `HANDOFF-CARD.md` 为准。**',
    '',
    `## rev 索引（${p.count} 段 · 最新在前）`,
    '',
    '| rev | 内容 |',
    '|---|---|',
    ...idx,
    '',
    '---',
    '',
    body.join('\n\n'),
    '',
  ].join('\n')
  archives.push({ p, md, file: path.join(root, ARCHIVE_REL, p.file) })
}

// 6. 构建主文件
const revisionLine = lines.find((l) => /^revision:/.test(l)) || `revision: ${segs[0].rev.replace(/^rev/, '')}`
const nav = plans.map((p) =>
  p.skip
    ? `> | ${p.version} | — | [${path.basename(p.file)}](${ARCHIVE_REL}/${p.file}) |`
    : `> | ${p.version} | ${p.first} – ${p.last} | [${path.basename(p.file)}](${ARCHIVE_REL}/${p.file}) |`,
)
const next = [
  '# 项目交接',
  '',
  revisionLine,
  `更新时间: ${today} · 最新 ${segs[0].rev}`,
  '项目: ZeroNote',
  '',
  `> **只保留最近 ${keepRevs.length} 个 rev（当前版本周期 · ${KEEP_FROM} 起）。更早的按版本归档：**`,
  '>',
  '> | 版本 | rev 范围 | 归档 |',
  '> |---|---|---|',
  ...nav,
  '>',
  '> 按 rev 号查：`git grep -n "rev173.100" -- docs/archive/handoff/`',
  `> 为什么分卷：每个新会话都要读本文件，分卷前 ${kb(text)} KB（rev173.139）。`,
  '',
  `## rev 索引（最新在前 · 按 rev 号搜本文件即可跳转）`,
  '',
  '| rev | 内容 |',
  '|---|---|',
  ...keepRevs.map((r) => idxLines.get(r) || `| ${r} | （原索引缺失） |`),
  '',
  lines.slice(segs[0].line, segRange(keepTo).end).join('\n').replace(/\s+$/, ''),
  '',
  lines.slice(notesLine).join('\n').replace(/\s+$/, ''),
  '',
].join('\n')

// 7. 报告
console.log(`主文件：${keepRevs.length} 段（${keepRevs[0]} … ${keepRevs[keepRevs.length - 1]}）`)
for (const p of plans) {
  if (p.skip) console.log(`  · ${p.file}：已归档，跳过`)
  else if (archives.find((a) => a.p === p)) {
    const a = archives.find((x) => x.p === p)
    console.log(`  + ${ARCHIVE_REL}/${p.file}：${p.count} 段（${p.first} … ${p.last}）· ${kb(a.md)} KB`)
  }
}
console.log(`体积：HANDOFF.md ${kb(text)} KB → ${kb(next)} KB（${segs.length} 段 → ${keepRevs.length} 段）`)

if (dryRun) {
  console.log('（--dry-run：未写盘）')
  process.exit(0)
}

// 8. 写盘
fs.mkdirSync(path.join(root, ARCHIVE_REL), { recursive: true })
for (const a of archives) fs.writeFileSync(a.file, a.md, 'utf8')
fs.writeFileSync(HANDOFF, next, 'utf8')
console.log('写盘完成。下一步：node scripts/check-docs.mjs')

function fail(msg) {
  console.error('❌ ' + msg)
  process.exit(1)
}
