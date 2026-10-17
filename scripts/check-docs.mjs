#!/usr/bin/env node
/**
 * ZeroNote 文档一致性检查（2026-10-17）
 * 用法：node scripts/check-docs.mjs
 * 检查：① 契约 vs contract.ts 的 capability / API 方法 ② docs 状态头
 *       ③ HANDOFF 索引 vs 段落 ④ 文档引用的具体文件是否存在
 * 任一失败退出码 1。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const problems = []
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))

// ① 契约 vs code
const ct = read('src/kernel/contract.ts')
const capBlock = /export type Capability =([\s\S]*?)\n\n\/\*\*/.exec(ct)
const caps = capBlock
  ? [...capBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((c) => !['desktop', 'android', 'web'].includes(c))
  : []
const contractPath = 'docs/内核契约-v0.2.md'
const contract = exists(contractPath) ? read(contractPath) : ''
for (const c of caps) if (!contract.includes(c)) problems.push('契约 §4 缺 capability: ' + c)

const apiNames = ['FsApi', 'DocApi', 'IndexApi', 'EventApi', 'CommandApi', 'ViewApi', 'StoreApi', 'HostApi', 'ServiceApi', 'EditorApi']
for (const name of apiNames) {
  const m = new RegExp('export interface ' + name + ' \\{([\\s\\S]*?)\\n\\}').exec(ct)
  if (!m) continue
  const methods = [...m[1].matchAll(/^  ([a-zA-Z]\w*)\s*[(:<]/gm)].map((x) => x[1])
  for (const meth of methods) if (!contract.includes(meth)) problems.push('契约缺 ' + name + '.' + meth)
}

// ② docs 状态头
const docsDir = path.join(root, 'docs')
for (const n of fs.readdirSync(docsDir).filter((x) => x.endsWith('.md'))) {
  const head = fs.readFileSync(path.join(docsDir, n), 'utf8').split('\n').slice(0, 6).join('\n')
  if (!/状态：/.test(head)) problems.push('docs/' + n + ' 缺状态头')
}

// ③ HANDOFF 索引 vs 段
const handoff = read('HANDOFF.md')
const idxStart = handoff.indexOf('## rev 索引')
const segStart = handoff.indexOf('> ## 📌 rev')
if (idxStart >= 0) {
  const idxBlock = handoff.slice(idxStart, segStart > idxStart ? segStart : undefined)
  const idxRevs = [...idxBlock.matchAll(/^\| (rev[\d.]+) \|/gm)].map((m) => m[1])
  const segRevs = [...handoff.matchAll(/^> ## 📌 (rev[\d.]+)/gm)].map((m) => m[1])
  const onlyIdx = idxRevs.filter((r) => !segRevs.includes(r))
  const onlySeg = segRevs.filter((r) => !idxRevs.includes(r))
  for (const r of onlyIdx) problems.push('HANDOFF 索引有 ' + r + ' 但正文无对应段')
  for (const r of onlySeg) problems.push('HANDOFF 正文有 ' + r + ' 但索引缺')
}

// ④ 引用文件存在
// `_shots/` 是**本地证据目录**（被 .gitignore 排除、CI 不检出）⇒ 不参与「引用存在」判定，
// 否则本地通过、CI 必红（rev130 首次 CI 实测：HANDOFF 里几十条 `_shots/*.png` 全部报缺）。
const scanFiles = ['README.md', 'HANDOFF.md', 'HANDOFF-CARD.md', 'docs/README.md', ...fs.readdirSync(docsDir).filter((n) => n.endsWith('.md')).map((n) => 'docs/' + n)]
for (const f of [...new Set(scanFiles)]) {
  if (!exists(f)) continue
  const txt = read(f)
  for (const m of txt.matchAll(/`((?:tools|examples|scripts)\/[^`\s*]+\.(?:png|mjs|ps1))`/g)) {
    if (!exists(m[1])) problems.push(f + ' 引用了不存在的文件: ' + m[1])
  }
}

if (problems.length) {
  console.error('❌ 文档一致性：' + problems.length + ' 个问题')
  for (const p of problems.slice(0, 40)) console.error('  - ' + p)
  process.exit(1)
}
console.log('✅ 文档一致性：capability ' + caps.length + ' 项 / API 接口 10 组 / 状态头 / 索引 / 引用 全通过')
