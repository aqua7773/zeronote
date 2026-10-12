#!/usr/bin/env node
/**
 * 内核恢复 —— 从 `_kernel-snapshots/<id>/` 把内核文件还原到快照那一刻，
 * 并（可选）重新构建。这是 `docs/架构原则-2026-10-13.md` §1.3「**修复优先于防护**」的落地：
 * 内核不设防，但**改坏了能回到已知 good**。
 *
 * ## 三条设计规矩（都是拿"最坏情况"倒推出来的）
 *
 * 1. **恢复前先验快照自己**：备份也可能被插件写坏（插件有全盘读写）。
 *    逐文件重算 SHA256，与 manifest 不符 ⇒ **拒绝恢复**（拿坏快照覆盖好代码，比不恢复更糟）。
 * 2. **恢复前先把当前状态另存一份**（pre-restore 快照）：修错了还能退回来 —— "一切可回退"。
 * 3. **默认不删**：快照里没有的文件不动（插件新塞的垃圾不碍事），要删得显式 `--prune`。
 *
 * 用法：
 *   node scripts/kernel-restore.mjs --list                  列快照
 *   node scripts/kernel-restore.mjs --latest --dry-run      只看会改什么
 *   node scripts/kernel-restore.mjs --latest                恢复最近一份
 *   node scripts/kernel-restore.mjs --id 20261013-012345 --build   恢复 + 重新构建
 *   node scripts/kernel-restore.mjs                         交互模式（列出 → 问你 → 恢复）
 *   双击「修复内核.cmd」= 交互模式（**应用起不来时唯一的路** —— 它不依赖应用本体）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectKernelFiles, createSnapshot, sha256 } from './kernel-snapshot.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SNAP_ROOT = join(REPO, '_kernel-snapshots')

function parseArgs(argv) {
  const out = { list: false, latest: false, dryRun: false, build: false, prune: false, force: false, id: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list') out.list = true
    else if (a === '--latest') out.latest = true
    else if (a === '--dry-run') out.dryRun = true
    else if (a === '--build') out.build = true
    else if (a === '--prune') out.prune = true
    else if (a === '--force') out.force = true
    else if (a === '--id') out.id = argv[++i] ?? null
    else if (a === '-h' || a === '--help') out.help = true
  }
  return out
}

/** 列出全部快照（按 id 降序 = 时间降序），坏 manifest 也列出来但标记 */
export function listSnapshots() {
  if (!existsSync(SNAP_ROOT)) return []
  const out = []
  for (const name of readdirSync(SNAP_ROOT)) {
    const dir = join(SNAP_ROOT, name)
    const mf = join(dir, 'manifest.json')
    if (!statSync(dir).isDirectory() || !existsSync(mf)) continue
    try {
      out.push({ id: name, dir, manifest: JSON.parse(readFileSync(mf, 'utf8')) })
    } catch (e) {
      out.push({ id: name, dir, manifest: null, broken: String(e) })
    }
  }
  out.sort((a, b) => (a.id < b.id ? 1 : -1))
  return out
}

function fmtSnapshot(s, i) {
  if (!s.manifest) return `  [${i}] ${s.id}  ⚠ manifest 读不出来：${s.broken}`
  const m = s.manifest
  const when = new Date(m.createdAt).toLocaleString('zh-CN')
  const head = m.git?.head ? m.git.head.slice(0, 8) : '非git'
  const dirty = m.git?.dirty ? ' · 含未提交改动' : ''
  const mb = (m.totalBytes / 1024 / 1024).toFixed(2)
  return `  [${i}] ${s.id}  ${when}  ${m.fileCount} 文件 ${mb}MB  ${head}${dirty}\n      理由：${m.reason}`
}

/** 校验快照自身：逐文件重算哈希。返回 `{ ok, bad[], missing[], checked }` */
function verifySnapshot(snap) {
  const bad = []
  const missing = []
  for (const e of snap.manifest.files) {
    const f = join(snap.dir, 'files', e.path)
    if (!existsSync(f)) {
      missing.push(e.path)
      continue
    }
    const got = sha256(readFileSync(f))
    if (got !== e.sha256) bad.push({ path: e.path, expect: e.sha256, got })
  }
  return { ok: bad.length === 0 && missing.length === 0, bad, missing, checked: snap.manifest.files.length }
}

/** 对比快照与当前磁盘：谁被改了、谁丢了、谁多了 */
function diffAgainstDisk(snap) {
  const changed = []
  const same = []
  for (const e of snap.manifest.files) {
    const cur = join(REPO, e.path)
    if (!existsSync(cur)) {
      changed.push({ path: e.path, how: '补回（磁盘上已丢失）' })
      continue
    }
    const got = sha256(readFileSync(cur))
    if (got !== e.sha256) changed.push({ path: e.path, how: '覆盖（内容已被改）' })
    else same.push(e.path)
  }
  const inSnap = new Set(snap.manifest.files.map((e) => e.path))
  const extra = []
  const { files } = collectKernelFiles()
  for (const abs of files) {
    const rel = relative(REPO, abs).split(sep).join('/')
    if (!inSnap.has(rel)) extra.push(rel)
  }
  return { changed, same, extra }
}

function restoreFiles(snap, diff) {
  let n = 0
  for (const { path } of diff.changed) {
    const src = join(snap.dir, 'files', path)
    const dst = join(REPO, path)
    mkdirSync(dirname(dst), { recursive: true })
    writeFileSync(dst, readFileSync(src))
    n++
  }
  return n
}

function pruneFiles(diff) {
  let n = 0
  for (const rel of diff.extra) {
    const abs = join(REPO, rel)
    if (existsSync(abs)) {
      rmSync(abs)
      n++
    }
  }
  return n
}

function runBuild(snap) {
  const cmds = snap.manifest.buildCommands ?? []
  console.log(`\n🔨 重新构建（${cmds.length} 步，可能要几分钟）`)
  if (!process.env.CARGO_TARGET_DIR) {
    console.log('   ⚠ 未设 CARGO_TARGET_DIR —— 本机铁律要求 Rust 产物在工作区之外，')
    console.log('     否则 cl.exe 会报 D8050。示例：$env:CARGO_TARGET_DIR = \'C:\\Users\\AQUA\\cargo-targets\\zeronote\'')
  }
  for (const c of cmds) {
    const [bin, ...rest] = c.split(' ')
    console.log(`\n$ ${c}`)
    const r = spawnSync(bin, rest, { cwd: REPO, stdio: 'inherit', shell: true })
    if (r.status !== 0) {
      console.log(`\n❌ 构建失败（退出码 ${r.status}）—— 源码已还原，可修完再跑一次 §${c}`)
      return false
    }
  }
  console.log('\n✅ 构建完成')
  return true
}

function doRestore(snap, args) {
  console.log(`\n🎯 目标快照：${snap.id}（${new Date(snap.manifest.createdAt).toLocaleString('zh-CN')}）`)
  console.log(`   理由：${snap.manifest.reason}`)

  // ① 先验备份自己 —— 备份也可能是坏的
  process.stdout.write('① 校验快照自身… ')
  const v = verifySnapshot(snap)
  if (!v.ok) {
    console.log(`❌ 快照已损坏（${v.bad.length} 个内容不符 / ${v.missing.length} 个缺失）`)
    for (const b of v.bad.slice(0, 10)) console.log(`   ✗ ${b.path}`)
    for (const m of v.missing.slice(0, 10)) console.log(`   ✗ 缺失 ${m}`)
    if (!args.force) {
      console.log('\n拒绝用损坏的备份覆盖当前代码（这比不恢复更糟）。')
      console.log('若你确定要继续，加 --force。')
      return 1
    }
    console.log('（--force 已指定，继续）')
  } else {
    console.log(`✅ ${v.checked} 个文件哈希全部一致`)
  }

  // ② 与当前磁盘对比
  const diff = diffAgainstDisk(snap)
  console.log(`② 与当前对比：需要改动 ${diff.changed.length} 个 · 未变 ${diff.same.length} 个 · 快照外的多出文件 ${diff.extra.length} 个`)
  for (const c of diff.changed.slice(0, 20)) console.log(`   • ${c.how}  ${c.path}`)
  if (diff.changed.length > 20) console.log(`   … 还有 ${diff.changed.length - 20} 个`)
  if (diff.extra.length && !args.prune) {
    console.log(`   （多出的文件**不会**被动 —— 要删请加 --prune；先看几眼：${diff.extra.slice(0, 5).join(', ')}${diff.extra.length > 5 ? ' …' : ''}）`)
  }

  if (args.dryRun) {
    console.log('\n--dry-run：什么都没改。')
    return 0
  }

  // ③ 恢复前先把现在这份另存 —— 修错了还能退回来
  const pre = createSnapshot({ reason: `pre-restore: 恢复到 ${snap.id}` })
  console.log(`③ 已把当前状态另存为 pre-restore 快照：${pre.id}（修错了就恢复回它）`)

  // ④ 还原
  const n = restoreFiles(snap, diff)
  console.log(`④ 已还原 ${n} 个文件`)

  if (args.prune) {
    const p = pruneFiles(diff)
    console.log(`⑤ --prune：删掉了 ${p} 个快照外多出的文件`)
  }

  // ⑤ 复核：还原后再算一次哈希，必须与快照逐字节一致
  const after = verifySnapshot({ ...snap, dir: snap.dir })
  const disk = diffAgainstDisk(snap)
  console.log(`\n🔎 复核：快照内 ${after.checked} 个文件 · 与磁盘仍有差异的 ${disk.changed.length} 个`)
  if (disk.changed.length === 0) console.log('   ✅ 内核已与快照逐字节一致')
  else for (const c of disk.changed.slice(0, 10)) console.log(`   ✗ 仍有差异：${c.path}`)

  console.log('\n下一步（三条验收基线）：')
  console.log('   pnpm exec tsc -b && pnpm exec oxlint')
  console.log('   cd src-tauri; cargo test --lib')

  if (args.build) {
    const ok = runBuild(snap)
    if (!ok) return 1
  } else {
    console.log('\n要顺带重新构建，加 --build（或恢复完手动跑 `pnpm tauri build`）。')
  }
  return 0
}

async function interactive(snaps) {
  console.log('ZeroNote 内核修复 —— 从快照还原（不依赖应用本体，应用起不来时也能跑）\n')
  if (snaps.length === 0) {
    console.log('还没有任何快照。先建一份：node scripts/kernel-snapshot.mjs --reason "基线"')
    return 0
  }
  console.log('可用快照（新 → 旧）：')
  snaps.forEach((s, i) => console.log(fmtSnapshot(s, i)))
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const ask = (q) => new Promise((res) => rl.question(q, res))
  const pick = (await ask('\n输入要恢复的快照 id（直接回车 = 最近一个，q = 退出）：')).trim()
  if (pick === 'q' || pick === 'Q') {
    rl.close()
    return 0
  }
  const target = pick ? snaps.find((s) => s.id === pick) : snaps[0]
  if (!target) {
    rl.close()
    console.log(`没有这个 id：${pick}`)
    return 1
  }
  const build = (await ask('恢复后要重新构建吗？(y/N)：')).trim().toLowerCase()
  rl.close()
  return doRestore(target, { ...parseArgs([]), build: build === 'y' })
}

/* ── CLI ── */

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('用法: node scripts/kernel-restore.mjs [--list | --latest | --id <快照id>] [--dry-run] [--build] [--prune] [--force]')
    process.exit(0)
  }
  const snaps = listSnapshots()
  if (args.list) {
    if (snaps.length === 0) console.log('（还没有快照：node scripts/kernel-snapshot.mjs）')
    else snaps.forEach((s, i) => console.log(fmtSnapshot(s, i)))
    process.exit(0)
  }
  const noTarget = !args.id && !args.latest
  if (noTarget) {
    interactive(snaps).then((code) => process.exit(code))
  } else {
    const target = args.id ? snaps.find((s) => s.id === args.id) : snaps[0]
    if (!target) {
      console.log(args.id ? `没有这个快照 id：${args.id}` : '还没有任何快照，先跑 node scripts/kernel-snapshot.mjs')
      process.exit(1)
    }
    if (!target.manifest) {
      console.log(`快照 ${target.id} 的 manifest 读不出来：${target.broken}`)
      process.exit(1)
    }
    process.exit(doRestore(target, args))
  }
}
