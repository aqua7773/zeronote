#!/usr/bin/env node
/**
 * 内核快照 —— ZeroNote「**修复优先于防护**」原则（`docs/架构原则-2026-10-13.md` §1.3/§4.5）的执行者之一，
 * 另一半是 `scripts/kernel-restore.mjs`（恢复）。
 *
 * 为什么要有它：内核**完全不设防**（插件权限等同内核、能改任意文件），
 * 所以唯一的安全网是"**改坏了能回到已知 good**"。
 *
 * ## 什么算「内核」—— 白名单，唯一定义
 *
 * 用的是**白名单**而不是黑名单：`node_modules/` `target/` `dist/` `gen/` 这些
 * "大而无所谓"的东西靠黑名单很容易漏，而白名单的每一项都能一句话解释"为什么它是内核"。
 * 想加东西就往 `KERNEL_PATHS` 里加一行 —— 这个数组就是"内核边界"的可执行定义。
 *
 * **不含**：`node_modules/`、cargo target、`dist/`、`src-tauri/gen/`（Android 生成物，
 * `tauri android init` 可重建）、`_shots/`、`_tmp-*`、`examples/`（插件示例，删了不影响内核）、
 * **库数据**（`.md` 不在内核快照范围内 —— 用户已裁定内核不提供数据安全保证）。
 *
 * 用法：
 *   node scripts/kernel-snapshot.mjs --reason "U3 完成后"
 *   node scripts/kernel-snapshot.mjs                  # 不给理由也行
 * 产物：`<repo>/_kernel-snapshots/<YYYYMMDD-HHmmss>/`（`files/` + `manifest.json`）
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SNAP_ROOT = join(REPO, '_kernel-snapshots')

/**
 * **内核边界**（可重建应用所需的一切源码与配置）。
 *
 * 每项都要能回答"删了它还能重建吗"：
 * - `patches/` —— atomic-editor 的第三方补丁，**重建必需**（漏了它编辑器行为就不一致）
 * - `src-tauri/plugins/` —— 自写的 Tauri 移动插件（状态栏那个）
 * - `tools/`、`scripts/` —— 内核自己的工具链（**包括本脚本**：脚本自己被改坏时也得能修回来）
 * - `docs/` —— 契约与原则文档（内核的一部分，不是"附属文档"）
 * - `.gitattributes` —— **不包含它会让 `.jar` 之类二进制在换机 clone 后损坏**（踩过）
 */
const KERNEL_PATHS = [
  // 前端内核
  'src',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  '.oxlintrc.json',
  'public',
  // 依赖与补丁（重建必需）
  'package.json',
  'pnpm-lock.yaml',
  'patches',
  // Rust 内核
  'src-tauri/src',
  'src-tauri/capabilities',
  'src-tauri/plugins',
  'src-tauri/icons',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/build.rs',
  'src-tauri/tauri.conf.json',
  // 工具与文档（内核的一部分）
  'scripts',
  'tools',
  'docs',
  'dev.cmd',
  'android-dev.cmd',
  'tauri.android-dev.json',
  '.gitattributes',
  '.gitignore',
  'README.md',
]

/** 恢复后建议跑的构建命令（写进 manifest，恢复脚本照此执行） */
const BUILD_COMMANDS = ['pnpm install --frozen-lockfile', 'pnpm tauri build --no-bundle']

function parseArgs(argv) {
  const out = { reason: '', quiet: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--reason') out.reason = argv[++i] ?? ''
    else if (a === '--quiet') out.quiet = true
    else if (a === '-h' || a === '--help') out.help = true
  }
  return out
}

/** 快照 id：本地时间 `YYYYMMDD-HHmmss`（人一眼能读，排序即时间序） */
export function stampId(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  )
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

/** git 元信息：快照要能回答"它对应仓库的哪个版本"；不在 git 环境里也不该崩 */
export function gitInfo() {
  const run = (args) =>
    execFileSync('git', args, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  try {
    return {
      head: run(['rev-parse', 'HEAD']),
      branch: run(['rev-parse', '--abbrev-ref', 'HEAD']),
      dirty: run(['status', '--porcelain']).length > 0,
    }
  } catch {
    return { head: null, branch: null, dirty: null }
  }
}

/** 递归收集文件（**只收普通文件**；符号链接/其它类型跳过 —— 内核里不该有链接） */
function collectFiles(absPath, out) {
  const st = statSync(absPath)
  if (st.isDirectory()) {
    for (const name of readdirSync(absPath).sort()) collectFiles(join(absPath, name), out)
  } else if (st.isFile()) {
    out.push(absPath)
  }
}

/** 内核文件全集（去重后的绝对路径） */
export function collectKernelFiles() {
  const seen = new Set()
  const files = []
  const missing = []
  for (const rel of KERNEL_PATHS) {
    const abs = join(REPO, rel)
    if (!existsSync(abs)) {
      missing.push(rel)
      continue
    }
    const batch = []
    collectFiles(abs, batch)
    for (const f of batch) {
      if (!seen.has(f)) {
        seen.add(f)
        files.push(f)
      }
    }
  }
  files.sort()
  return { files, missing }
}

/** 建一份快照，返回 `{ id, dir, manifest }` */
export function createSnapshot({ reason = '' } = {}) {
  const id = stampId()
  const dir = join(SNAP_ROOT, id)
  if (existsSync(dir)) throw new Error(`快照目录已存在（同一秒内重复建？）：${dir}`)

  const { files, missing } = collectKernelFiles()
  const entries = []
  for (const src of files) {
    const rel = relative(REPO, src).split(sep).join('/')
    const dst = join(dir, 'files', rel)
    mkdirSync(dirname(dst), { recursive: true })
    cpSync(src, dst)
    const buf = readFileSync(src)
    entries.push({ path: rel, size: buf.length, sha256: sha256(buf) })
  }

  const manifest = {
    kind: 'zeronote-kernel-snapshot',
    version: 1,
    id,
    createdAt: new Date().toISOString(),
    reason: reason || '(未填理由)',
    git: gitInfo(),
    buildCommands: BUILD_COMMANDS,
    kernelPaths: KERNEL_PATHS,
    missingPaths: missing,
    fileCount: entries.length,
    totalBytes: entries.reduce((n, e) => n + e.size, 0),
    files: entries,
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
  return { id, dir, manifest }
}

/* ── CLI ── */

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('用法: node scripts/kernel-snapshot.mjs [--reason "说明"] [--quiet]')
    process.exit(0)
  }
  const { id, dir, manifest } = createSnapshot({ reason: args.reason })
  if (!args.quiet) {
    const mb = (manifest.totalBytes / 1024 / 1024).toFixed(2)
    console.log(`✅ 内核快照已建立：${id}`)
    console.log(`   位置：${dir}`)
    console.log(`   文件：${manifest.fileCount} 个 · ${mb} MB`)
    console.log(`   来源版本：${manifest.git.head ? manifest.git.head.slice(0, 8) : '(非 git 环境)'}` +
      ` ${manifest.git.dirty ? '⚠ 工作区有未提交改动（快照含这些改动）' : ''}`)
    if (manifest.missingPaths.length) {
      console.log(`   ⚠ 清单里有 ${manifest.missingPaths.length} 项在磁盘上不存在：${manifest.missingPaths.join(', ')}`)
    }
    console.log(`   恢复：node scripts/kernel-restore.mjs --latest   或双击「修复内核.cmd」`)
  }
}
