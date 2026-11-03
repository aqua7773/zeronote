#!/usr/bin/env node
/**
 * ZeroNote 文档一致性检查（2026-10-17；2026-11-03 扩门）
 * 用法：node scripts/check-docs.mjs
 *
 * 检查：
 *   ① 契约 vs contract.ts 的 capability / API 方法 / PluginContext 成员
 *   ② docs 状态头 + 状态词 ∈ 允许集
 *   ③ HANDOFF 索引 vs 段落；新段 ≤80 行；旧段标题只增不减；最新段有「证据 / 未做」
 *   ④ 文档引用的具体文件是否存在
 *   ⑤ 规模门：交接卡 ≤120 行 · docs/README ≤150 行 · 规范类 ≤300 行
 *   ⑥ docs 根每份文档都进 `docs/README.md` 权威矩阵
 *   ⑦ 坑位知识不许回流交接卡：环境坑位段 ≤3 条 + 必须指向 `docs/开发环境坑位.md`
 *   ⑧ 共享逻辑「禁止写法」全仓 grep（§7 表同源）
 *
 * 任一失败退出码 1。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const problems = []
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))
const lineCount = (p) => read(p).split('\n').length

// ① 契约 vs code
const ct = read('src/kernel/contract.ts')
const capBlock = /export type Capability =([\s\S]*?)\n\n\/\*\*/.exec(ct)
const caps = capBlock
  ? [...capBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((c) => !['desktop', 'android', 'web'].includes(c))
  : []
const contractPath = 'docs/内核契约-v0.2.md'
const contract = exists(contractPath) ? read(contractPath) : ''
for (const c of caps) if (!contract.includes(c)) problems.push('契约 §4 缺 capability: ' + c)

const apiNames = ['FsApi', 'DocApi', 'IndexApi', 'EventApi', 'CommandApi', 'ItemMenuApi', 'ViewApi', 'StoreApi', 'HostApi', 'ServiceApi', 'EditorApi', 'NetApi', 'CapabilityApi']
for (const name of apiNames) {
  const m = new RegExp('export interface ' + name + ' \\{([\\s\\S]*?)\\n\\}').exec(ct)
  if (!m) continue
  const methods = [...m[1].matchAll(/^  ([a-zA-Z]\w*)\s*[(:<]/gm)].map((x) => x[1])
  for (const meth of methods) if (!contract.includes(meth)) problems.push('契约缺 ' + name + '.' + meth)
}

// ①b PluginContext 成员（2026-11-03：itemMenu / capability 曾只在章节里、签名块漏列）
const stripTsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
const ctxMembers = (src) => {
  const m = /export interface PluginContext \{([\s\S]*?)\n\}/.exec(src)
  if (!m) return []
  return [...stripTsComments(m[1]).matchAll(/([a-zA-Z]\w*)\s*:\s*[A-Za-z]/g)].map((x) => x[1])
}
const codeCtx = ctxMembers(ct)
const docCtx = ctxMembers(contract)
for (const m of codeCtx) if (!docCtx.includes(m)) problems.push('契约 PluginContext 缺成员: ' + m)
if (!/修订记录（minor）/.test(contract)) problems.push('契约头部缺「修订记录（minor）」')

// ② docs 状态头 + 状态词
// B2 已拍板（2026-11-03）：允许集=现状（保留 accepted / implemented 等子态），新增词必须先进这里再写文档。
const ALLOWED_STATES = new Set([
  'active', 'accepted', 'implemented', 'current', 'proposed', 'open',
  'draft', 'historical', 'archived', 'generated', 'superseded', 'disposable',
  '已裁决', '待验收', '已实施', '全部完成', '调研', 'closed',
])
const docsDir = path.join(root, 'docs')
const docNames = fs.readdirSync(docsDir).filter((x) => x.endsWith('.md'))
for (const n of docNames) {
  const head = fs.readFileSync(path.join(docsDir, n), 'utf8').split('\n').slice(0, 6).join('\n')
  if (!/状态：/.test(head)) problems.push('docs/' + n + ' 缺状态头')
  const sm = /状态：\s*(?:\*\*)?(?:✅\s*)?([^*｜|·（(\n]+)/.exec(head)
  const word = sm ? sm[1].replace(/[（(].*$/, '').trim() : ''
  if (word && !ALLOWED_STATES.has(word)) problems.push('docs/' + n + ' 状态词越界: ' + word)
}

// ③ HANDOFF：索引 vs 段、段长度、只增不减、最新段两行
const handoff = read('HANDOFF.md')
const handoffLines = handoff.split('\n')
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

/** 存量超限段白名单（2026-11-03 审计）：只减不增；拆小后请从这里删掉。 */
const LONG_SEG_ALLOW = new Map([
  ['rev173.288', 91],
  ['rev173.238', 94],
  ['rev173.230', 93],
  ['rev173.125', 103],
])
const segs = []
for (let i = 0; i < handoffLines.length; i++) {
  const m = /^> ## 📌 (rev[\d.]+)/.exec(handoffLines[i])
  if (m) segs.push({ rev: m[1], start: i })
}
for (let i = 0; i < segs.length; i++) {
  const end = i + 1 < segs.length ? segs[i + 1].start : handoffLines.length
  const n = end - segs[i].start
  const allow = LONG_SEG_ALLOW.get(segs[i].rev)
  if (n > 80 && allow === undefined) problems.push('HANDOFF ' + segs[i].rev + ' 段 ' + n + ' 行（新段上限 80）')
  if (allow !== undefined && n <= 80) problems.push('HANDOFF ' + segs[i].rev + ' 已回到 80 行内，请从 LONG_SEG_ALLOW 删掉')
}
// 只增不减：拿 HEAD 版本的段标题对比（无 git 历史时跳过）
try {
  const headHandoff = execFileSync('git', ['show', 'HEAD:HANDOFF.md'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  for (const m of headHandoff.matchAll(/^> ## 📌 (rev[\d.]+)/gm)) {
    if (!segs.some((s) => s.rev === m[1])) problems.push('HANDOFF 旧段标题消失（只允许追加）: ' + m[1])
  }
} catch {
  // 没有 git 或没有 HEAD（CI 浅克隆 / 下载 zip）⇒ 跳过此项，不误报
}
// 最新段必须带「证据 / 未做」两行（2026-11-03 模板）
if (segs.length) {
  const first = segs[0]
  const end = segs.length > 1 ? segs[1].start : handoffLines.length
  const body = handoffLines.slice(first.start, end).join('\n')
  if (!/\*\*证据\*\*/.test(body)) problems.push('HANDOFF 最新段 ' + first.rev + ' 缺「**证据**：」')
  if (!/\*\*未做\*\*/.test(body)) problems.push('HANDOFF 最新段 ' + first.rev + ' 缺「**未做**：」')
}

// ④ 引用文件存在
// `_shots/` 是**本地证据目录**（被 .gitignore 排除、CI 不检出）⇒ 不参与「引用存在」判定，
// 否则本地通过、CI 必红（rev130 首次 CI 实测：HANDOFF 里几十条 `_shots/*.png` 全部报缺）。
const scanFiles = ['README.md', 'HANDOFF.md', 'HANDOFF-CARD.md', 'docs/README.md', ...docNames.map((n) => 'docs/' + n)]
for (const f of [...new Set(scanFiles)]) {
  if (!exists(f)) continue
  const txt = read(f)
  for (const m of txt.matchAll(/`((?:tools|examples|scripts)\/[^`\s*]+\.(?:png|mjs|ps1))`/g)) {
    if (!exists(m[1])) problems.push(f + ' 引用了不存在的文件: ' + m[1])
  }
}

// ⑤ 规模门（2026-11-03）
if (lineCount('HANDOFF-CARD.md') > 120) problems.push('HANDOFF-CARD.md 超过 120 行: ' + lineCount('HANDOFF-CARD.md'))
if (lineCount('docs/README.md') > 150) problems.push('docs/README.md 超过 150 行: ' + lineCount('docs/README.md'))
/** 规范类文档 ≤300 行；契约是接口字典，B1 拍板（2026-11-03）单独上限 1500 行。 */
const NORM_DOCS = [
  'docs/README.md', 'docs/架构原则-2026-10-13.md', 'docs/开发约定.md', 'docs/文档编写规范.md',
  'docs/系统总览.md', 'docs/UI交互规范.md', 'docs/数据与存储.md', 'docs/内核契约-v0.2.md', 'CONTRIBUTING.md',
]
const NORM_LIMIT = 300
const CONTRACT_LIMIT = 1500
for (const f of NORM_DOCS) {
  if (!exists(f)) continue
  const n = lineCount(f)
  const limit = f === 'docs/内核契约-v0.2.md' ? CONTRACT_LIMIT : NORM_LIMIT
  if (n > limit) problems.push(f + ' 超过上限 ' + limit + ' 行: ' + n)
}

// ⑥ 权威矩阵登记（docs 根每份文档都要能在 docs/README.md 里找到）
const docsReadme = read('docs/README.md')
for (const n of docNames) {
  if (n === 'README.md') continue
  if (!docsReadme.includes(n)) problems.push('docs/README.md 权威矩阵未登记: docs/' + n)
}

// ⑦ 坑位知识不许回流交接文件（2026-11-03）
// 背景：HANDOFF-CARD 是交接快照、会随 rev 覆写瘦身；踩坑知识必须住在 docs/开发环境坑位.md。
const PIT_DOC = 'docs/开发环境坑位.md'
if (!exists(PIT_DOC)) problems.push('缺长期坑位文档: ' + PIT_DOC)
const card = read('HANDOFF-CARD.md')
const pitBlock = (card.match(/## 环境坑位[\s\S]*?(?=\n## |$)/) || [''])[0]
if (pitBlock) {
  if (!pitBlock.includes(PIT_DOC)) problems.push('交接卡「环境坑位」段缺指针 ' + PIT_DOC)
  const bullets = pitBlock.split('\n').filter((l) => /^\s*-\s/.test(l))
  // 上限 3：超过就是又把坑堆回交接卡了
  if (bullets.length > 3) {
    problems.push('交接卡「环境坑位」段有 ' + bullets.length + ' 条（上限 3）—— 坑要写进 ' + PIT_DOC)
  }
}

// ⑧ 共享逻辑「禁止写法」全仓 grep（docs/共享逻辑.md 的登记表同源，改表必须同步改这里）
const SHARED_RULES = [
  { re: /\bnoteDir\b/, allow: ['src/lib/insert-image.ts'], why: '附件路径候选只在 linkCandidates 里拼（docs/共享逻辑.md）' },
  { re: /\.split\('\/'\)\.slice\(0,\s*-1\)/, allow: [], why: '库内目录切分用 dirnamePosix（docs/共享逻辑.md）' },
]
const srcFiles = []
const walkSrc = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walkSrc(p)
    else if (/\.(ts|tsx)$/.test(e.name)) srcFiles.push(p)
  }
}
walkSrc(path.join(root, 'src'))
for (const f of srcFiles) {
  const rel = path.relative(root, f).replace(/\\/g, '/')
  const lines = read(rel).split('\n')
  for (const rule of SHARED_RULES) {
    if (rule.allow.includes(rel)) continue
    lines.forEach((line, i) => {
      if (rule.re.test(line)) problems.push(rel + ':' + (i + 1) + ' 命中禁止写法（' + rule.why + '）')
    })
  }
}

if (problems.length) {
  console.error('❌ 文档一致性：' + problems.length + ' 个问题')
  for (const p of problems.slice(0, 40)) console.error('  - ' + p)
  process.exit(1)
}
console.log(
  '✅ 文档一致性：capability ' + caps.length + ' 项 / API ' + apiNames.length + ' 组 / PluginContext ' + codeCtx.length +
    ' 成员 / 状态头 ' + docNames.length + ' 份 / 索引 / 段长 / 只增不减 / 规模门 / 矩阵 全通过',
)
