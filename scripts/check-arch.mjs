#!/usr/bin/env node
/**
 * ZeroNote 依赖方向门（2026-10-20）
 *
 * 规则来自 docs/开发约定.md §1：`lib ← kernel ← hooks ← App`，
 * `components → kernel/lib`。反方向 import 一律视为错误。
 *
 * 用法：node scripts/check-arch.mjs
 * 任一违规退出码 1。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const src = path.join(root, 'src')

/** 区域 → 禁止依赖的区域（比“允许”更好维护：新增区域默认不禁止） */
const FORBIDDEN = {
  lib: ['kernel', 'hooks', 'components', 'app'],
  kernel: ['hooks', 'components', 'app'],
  hooks: ['components', 'app'],
  components: ['hooks', 'app'],
  app: [],
}

const areaOf = (abs) => {
  const rel = path.relative(src, abs).replace(/\\/g, '/')
  if (rel.startsWith('lib/')) return 'lib'
  if (rel.startsWith('kernel/')) return 'kernel'
  if (rel.startsWith('hooks/')) return 'hooks'
  if (rel.startsWith('components/')) return 'components'
  if (rel === 'App.tsx' || rel === 'main.tsx') return 'app'
  return null
}

const walk = (dir, out = []) => {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name)
    if (d.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(d.name)) out.push(p)
  }
  return out
}

const SPEC = /(?:^|\n)\s*(?:import|export)\s[^\n]*?from\s+['"]([^'"]+)['"]/g
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g

const problems = []
let checked = 0
for (const file of walk(src)) {
  const area = areaOf(file)
  if (!area || FORBIDDEN[area].length === 0) continue
  const text = fs.readFileSync(file, 'utf8')
  const rel = path.relative(root, file).replace(/\\/g, '/')
  const hits = []
  for (const re of [SPEC, DYNAMIC]) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) hits.push({ spec: m[1], index: m.index })
  }
  for (const { spec, index } of hits) {
    if (!spec.startsWith('.')) continue
    const target = path.resolve(path.dirname(file), spec)
    const targetArea = areaOf(target.replace(/\.[cm]?[jt]sx?$/, '').replace(/\/index$/, '') + '.tsx')
      ?? areaOf(target)
    if (!targetArea) continue
    checked++
    if (FORBIDDEN[area].includes(targetArea)) {
      const line = text.slice(0, index).split('\n').length
      problems.push(`${rel}:${line} ${area} → ${targetArea}（${spec}）`)
    }
  }
}

if (problems.length) {
  console.error(`❌ 依赖方向：${problems.length} 处反向 import`)
  for (const p of problems.slice(0, 40)) console.error('  - ' + p)
  process.exit(1)
}
console.log(`✅ 依赖方向：${checked} 条内部 import，无反向依赖`)
