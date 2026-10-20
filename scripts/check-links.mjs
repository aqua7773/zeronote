#!/usr/bin/env node
/**
 * ZeroNote 本地链接门（2026-10-20）
 *
 * 只查**仓库内的本地链接**（不联网）：
 *   - markdown 相对路径 → 相对文档所在目录解析
 *   - 绝对路径 C:/Users/.../ZeroNote/xxx → 映射回仓库根
 *   - 跳过 http(s) / 锚点 / _shots / _tmp-* 等 gitignored 过程目录
 *
 * 用法：node scripts/check-links.mjs
 * 任一死链退出码 1。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const SKIP_PREFIX = ['_shots/', '_tmp-', '_build/', 'docs/images/manual-mobile/'] // 本地证据/过程产物（CI 不检出）
const SKIP_HTTP = /^(https?:|mailto:|tel:|asset:|data:)/i

const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const exists = (p) => fs.existsSync(path.join(root, p))

const files = []
for (const f of ['README.md', 'HANDOFF-CARD.md', 'CHANGELOG.md', 'docs/README.md']) if (exists(f)) files.push(f)
const walkDocs = (dir) => {
  for (const d of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, d.name)
    if (d.isDirectory()) walkDocs(rel)
    else if (d.name.endsWith('.md')) files.push(rel)
  }
}
walkDocs('docs')

const problems = []
let checked = 0
const seen = new Set()
for (const f of files) {
  // 行内代码里的 `![](相对路径)` 是示例，不是链接 —— 先剥掉再匹配
  const text = read(f).replace(/`[^`\n]*`/g, '')
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let target = m[1].trim()
    if (SKIP_HTTP.test(target) || target.startsWith('#') || target.startsWith('/')) continue
    const key = f + ' → ' + target
    if (seen.has(key)) continue
    seen.add(key)
    target = decodeURIComponent(target.split('#')[0].split('?')[0])
    if (!target) continue
    if (SKIP_PREFIX.some((p) => target.includes(p))) continue
    let abs
    if (/^[A-Za-z]:[\\/]/.test(target)) {
      const norm = target.replace(/\\/g, '/')
      const i = norm.indexOf('/ZeroNote/')
      if (i < 0) continue // 仓库外的绝对路径不判
      abs = path.join(root, norm.slice(i + '/ZeroNote/'.length))
    } else {
      abs = path.resolve(path.dirname(path.join(root, f)), target)
    }
    checked++
    if (!fs.existsSync(abs)) problems.push(`${f} → ${m[1]}（不存在）`)
  }
}

if (problems.length) {
  console.error(`❌ 本地链接：${problems.length} 个死链`)
  for (const p of problems.slice(0, 40)) console.error('  - ' + p)
  process.exit(1)
}
console.log(`✅ 本地链接：${checked} 条，全部存在`)
