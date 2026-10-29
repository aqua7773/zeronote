#!/usr/bin/env node
/**
 * ZeroNote 文档锚点检查（2026-10-30）
 *
 * 背景：UI 调研文档里出现过「`styles.css:1676` 其实是进度条」「空态写成 `App.tsx:4219`
 * 但那里是编辑器容器」这类硬错——行号只 grep 没回读。本脚本把这些断言变成可自动检查的门：
 *
 *   ① 提取文档里的 `文件:行号` / `文件:起-止` 引用（跳过 fenced code block 里的示例）；
 *   ② 解析目标文件（带路径直接查；只给文件名则按后缀在仓库里找）；
 *   ③ 检查：文件存在、行号不越界、区间不倒序、区间不是全空白；
 *   ④ 打印每条锚点落在哪一行（`--verbose`），让人能一眼看出「指向的东西对不对」。
 *
 * 用法：
 *   node scripts/check-doc-anchors.mjs                 # 只扫 docs/ + _research/ 里的 draft 文档
 *   node scripts/check-doc-anchors.mjs docs/UI重布局-方案-2026-10-29.md   # 只扫指定文件
 *   node scripts/check-doc-anchors.mjs --active        # 连 active 文档一起扫（历史行号会有噪音）
 *   node scripts/check-doc-anchors.mjs --all           # 连 historical/archive 也扫
 *   node scripts/check-doc-anchors.mjs --verbose       # 每条都打印落点摘要
 *
 * 退出码：有 ❌（文件缺失 / 越界 / 区间倒序）则 1；⚠️（区间空 / 歧义）只打印，不失败。
 */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const verbose = args.includes('--verbose')
const scanAll = args.includes('--all')
const targets = args.filter((a) => !a.startsWith('--'))

/** 扫描时跳过的目录（依赖 / 产物 / 证据 / 归档 / 内核快照） */
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|_build|_shots|_tmp[^/]*|target|archive|_kernel-snapshots)(\/|$)/

/**
 * 默认只扫 **draft** 文档（新写、未定稿、行号最密）。
 * active 文档里散落着大量历史行号（2026-10 前的调研），全量扫会制造噪音；
 * 要审计它们用 `--active` 或 `--all`。
 */
const scanActive = args.includes('--active')

/* ───────── 文件索引：basename → 仓库内相对路径 ───────── */

/** @type {Map<string, string[]>} */
const byBase = new Map()
const walked = []
function walk(dir) {
  let entries
  try {
    entries = fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (SKIP_DIR.test(rel + '/')) continue
      walk(rel)
    } else {
      walked.push(rel)
      const base = e.name
      if (!byBase.has(base)) byBase.set(base, [])
      byBase.get(base).push(rel)
    }
  }
}
walk('')

/* ───────── 收集文档 ───────── */

/** 只收 active / draft（历史文档的行号本来就该漂移，扫它们只会淹没有效告警） */
function isLiveDoc(abs) {
  if (scanAll) return true
  let head = ''
  try {
    head = fs.readFileSync(abs, 'utf8').split('\n').slice(0, 8).join('\n')
  } catch {
    return false
  }
  if (/状态：\s*\*\*draft/.test(head)) return true
  return scanActive && /状态：\s*\*\*(active|implemented|current|generated)\*\*/.test(head)
}

const docs = []
if (targets.length) {
  for (const t of targets) {
    const abs = path.resolve(root, t)
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) docs.push(path.relative(root, abs).replace(/\\/g, '/'))
    else console.error(`⚠️ 找不到文档：${t}`)
  }
} else {
  for (const dir of ['docs', '_research']) {
    const base = path.join(root, dir)
    if (!fs.existsSync(base)) continue
    const stack = [dir]
    while (stack.length) {
      const d = stack.pop()
      for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`
        if (e.isDirectory()) {
          if (/\/archive$/.test(rel) && !scanAll) continue
          stack.push(rel)
        } else if (e.name.endsWith('.md')) {
          const abs = path.join(root, rel)
          if (isLiveDoc(abs)) docs.push(rel)
        }
      }
    }
  }
}

/* ───────── 提取锚点 ───────── */

/**
 * 文件名允许中文（`使用手册-移动端.md`）、字母数字、点、下划线、连字符；
 * 路径分隔符 `/`；行号 1 个或 `起-止`。
 * 前面不能紧贴字母（避免把 `abc.ts:12` 里的 `bc.ts:12` 再匹配一遍）。
 */
const ANCHOR = /(?<![\w./-])((?:[\w\u4e00-\u9fa5.-]+\/)*[\w\u4e00-\u9fa5.-]+\.(?:tsx?|jsx?|mjs|css|json|md|rs|toml|kt|ps1|html)):(\d+)(?:-(\d+))?/g

/** 去掉 fenced code block（``` / ~~~），里面的行号是示例，不当作断言 */
function stripFences(text) {
  return text.replace(/^(`{3,}|~{3,})[\s\S]*?^\1[^\n]*$/gm, '')
}

const anchors = []
const seen = new Set()
for (const doc of docs) {
  const text = stripFences(fs.readFileSync(path.join(root, doc), 'utf8'))
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(ANCHOR)) {
      const target = m[1]
      const start = Number(m[2])
      const end = m[3] ? Number(m[3]) : start
      // 文档自身：`docs/xxx.md:12` 这种引用也查，但不查文档引用自己同一行（无意义）
      const key = `${doc}|${target}|${start}|${end}`
      if (seen.has(key)) continue
      seen.add(key)
      anchors.push({ doc, line: i + 1, target, start, end })
    }
  })
}

/* ───────── 解析目标 ───────── */

const cache = new Map()
function linesOf(rel) {
  if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(root, rel), 'utf8').split('\n'))
  return cache.get(rel)
}

function resolveTarget(target) {
  const clean = target.replace(/\\/g, '/')
  // ① 直接相对仓库根
  if (fs.existsSync(path.join(root, clean))) return { rel: clean }
  // ② 后缀匹配（`components/TitleBar.tsx` → `src/components/TitleBar.tsx`）
  const candidates = [...new Set(walked.filter((f) => f === clean || f.endsWith('/' + clean)))]
  if (candidates.length === 1) return { rel: candidates[0] }
  if (candidates.length > 1) {
    // 多个同名文件：选路径最短的（通常就是 src/ 下那个），并在结果里标一下
    const sorted = candidates.sort((a, b) => a.length - b.length)
    return { rel: sorted[0], pickedFrom: sorted }
  }
  // ③ 只给文件名：按 basename 找
  const base = clean.split('/').pop()
  const list = [...new Set(byBase.get(base) ?? [])]
  if (list.length === 1) return { rel: list[0] }
  if (list.length > 1) {
    const sorted = list.sort((a, b) => a.length - b.length)
    return { rel: sorted[0], pickedFrom: sorted }
  }
  return { missing: true }
}

/* ───────── 检查 ───────── */

const fails = []
const warns = []
const oks = []

for (const a of anchors) {
  const r = resolveTarget(a.target)
  const where = `${a.doc}:${a.line} → ${a.target}:${a.start}${a.end !== a.start ? '-' + a.end : ''}`
  if (r.missing) {
    // 外部依赖源码（如 Tauri crate）或构建产物：不在本仓库里。
    // 文件存在性由 check-docs ④「引用文件存在」负责，这里只提示，不判失败。
    warns.push(`${where}（仓库内找不到；可能是外部路径或已删除，文件存在性见 check-docs ④）`)
    continue
  }
  if (r.pickedFrom) {
    warns.push(`${where}（同名文件 ${r.pickedFrom.length} 个，按最短路径取 ${r.rel}）`)
  }
  const lines = linesOf(r.rel)
  if (a.start < 1 || a.end > lines.length) {
    fails.push(`${where}（越界：${r.rel} 只有 ${lines.length} 行）`)
    continue
  }
  if (a.start > a.end) {
    fails.push(`${where}（区间倒序）`)
    continue
  }
  const slice = lines.slice(a.start - 1, a.end).join('\n').trim()
  if (!slice) {
    warns.push(`${where}（区间全空白）`)
    continue
  }
  oks.push({ where, rel: r.rel, summary: slice.split('\n').find((l) => l.trim())?.trim().slice(0, 100) ?? '' })
}

/* ───────── 输出 ───────── */

console.log(`📄 扫描 ${docs.length} 个文档，提取 ${anchors.length} 条锚点（去重后）`)
if (verbose) {
  for (const o of oks) console.log(`  ✅ ${o.where}\n       ${o.rel}: ${o.summary}`)
}
if (warns.length) {
  console.log(`\n⚠️ 可疑 ${warns.length} 条（不判失败，请人工回读）`)
  for (const w of warns.slice(0, 30)) console.log('  - ' + w)
  if (warns.length > 30) console.log(`  … 其余 ${warns.length - 30} 条省略`)
}
if (fails.length) {
  console.error(`\n❌ 文档锚点：${fails.length} 条无效`)
  for (const f of fails.slice(0, 40)) console.error('  - ' + f)
  if (fails.length > 40) console.error(`  … 其余 ${fails.length - 40} 条省略`)
  process.exit(1)
}
console.log(`✅ 文档锚点：${oks.length} 条有效` + (warns.length ? `，${warns.length} 条待人工核对` : ''))
