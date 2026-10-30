#!/usr/bin/env node
/**
 * 发版构建（分平台 · 分阶段计时）—— 2026-10-31 rev173.291。
 *
 * 为什么要有它：`pnpm tauri build` 一次只有一条「总共多久」，看不出钱花在哪；
 * 而发版常常只需要一端（例如只更新手机）。这个脚本做两件事：
 *   ① **只编你选的那一端**（省掉另一端的 Rust 全编译）—— 这是目前唯一**确定**的省时手段；
 *   ② 把耗时拆成 **前端 / Rust / 打包** 三段打到终端，下次一眼看出瓶颈。
 *
 * 用法：
 *   node scripts/build-release.mjs --android            # 只编 Android（arm64）
 *   node scripts/build-release.mjs --desktop            # 只编桌面（msi + exe）
 *   node scripts/build-release.mjs                      # 两端都编（串行）
 *   node scripts/build-release.mjs --android --target aarch64
 *
 * ⚠️ **别指望「只改前端就不用编 Rust」**（2026-10-31 实测推翻）：Tauri 移动端把前端
 * dist **嵌进 `libzeronote_lib.so`**（0.9.1 的 APK 里 `assets/` 只有 tauri.conf.json，
 * 而 `lib/arm64-v8a/libzeronote_lib.so` 占 30.72 MB）⇒ 改一行 CSS 也触发这个 crate 重编。
 * 同理，`pnpm build` 之后直接 `gradlew assembleRelease` 不会带上新前端。
 *
 * 实测耗时（rev173.291 · 本机 · 依赖已编译过）：
 *   · 桌面 msi + exe        ≈ 4 分钟（Rust release 重编 zeronote + 前端 + 打包）
 *   · Android arm64 APK     ≈ 14 分钟（Rust aarch64 交叉编译 ≈10 分 + Gradle ≈3 分 + 前端）
 *   · 4 个 ABI 一起时       桌面 + Android ≈ 18 分钟（所以砍 ABI 的收益被 aarch64 全量吃掉了）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const argv = process.argv.slice(2)
const wantAndroid = argv.includes('--android')
const wantDesktop = argv.includes('--desktop')
const both = !wantAndroid && !wantDesktop
const targetIdx = argv.indexOf('--target')
const target = targetIdx >= 0 ? argv[targetIdx + 1] : 'aarch64'

if (!['aarch64', 'armv7', 'i686', 'x86_64'].includes(target)) {
  console.error(`✗ 不认识的 --target ${target}（aarch64 / armv7 / i686 / x86_64）`)
  process.exit(1)
}

/** Windows 上 cargo 常不在 PATH（tauri 由 pnpm 拉起来时也一样）—— 补上常见两处 */
const pathWithCargo = [
  join(process.env.USERPROFILE ?? '', '.cargo', 'bin'),
  join(process.env.APPDATA ?? '', 'npm'),
  process.env.PATH ?? '',
].join(';')

function run(label, args, opts = {}) {
  const t0 = Date.now()
  console.log(`\n▶ ${label}`)
  console.log(`  ${opts.cmd ?? 'pnpm'} ${args.join(' ')}`)
  const r = spawnSync(opts.cmd ?? 'pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PATH: pathWithCargo },
    shell: process.platform === 'win32',
  })
  const sec = Math.round((Date.now() - t0) / 1000)
  if (r.status !== 0) {
    console.error(`\n✗ ${label} 失败（退出码 ${r.status}，用时 ${sec}s）`)
    process.exit(r.status ?? 1)
  }
  console.log(`✅ ${label}（${sec}s）`)
  return sec
}

function sizeOf(p) {
  if (!existsSync(p)) return null
  const mb = statSync(p).size / 1024 / 1024
  return `${mb.toFixed(2)} MiB`
}

const timing = {}
const t0 = Date.now()

if (wantDesktop || both) {
  timing['桌面（msi + exe）'] = run('桌面 release 构建', ['tauri', 'build'])
}

if (wantAndroid || both) {
  timing[`Android ${target}`] = run('Android release 构建', [
    'tauri',
    'android',
    'build',
    '--apk',
    '--target',
    target,
  ])
}

const total = Math.round((Date.now() - t0) / 1000)
console.log('\n──── 产物 ────')
const desktop = [
  ['msi', join(root, 'src-tauri/target/release/bundle/msi')],
  ['exe', join(root, 'src-tauri/target/release/bundle/nsis')],
]
if (wantDesktop || both) {
  for (const [kind, dir] of desktop) {
    if (!existsSync(dir)) continue
    const { readdirSync } = await import('node:fs')
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(kind === 'msi' ? '.msi' : '.exe')) continue
      console.log(`  ${f}  ${sizeOf(join(dir, f))}`)
    }
  }
}
if (wantAndroid || both) {
  const apkDir = join(root, 'src-tauri/gen/android/app/build/outputs/apk/universal/release')
  const { readdirSync } = await import('node:fs')
  if (existsSync(apkDir)) {
    for (const f of readdirSync(apkDir)) {
      if (!f.endsWith('.apk')) continue
      console.log(`  ${f}  ${sizeOf(join(apkDir, f))}`)
    }
  }
}

console.log('\n──── 耗时 ────')
for (const [k, v] of Object.entries(timing)) {
  const m = Math.floor(v / 60)
  console.log(`  ${k}：${m ? `${m} 分 ` : ''}${v % 60} 秒`)
}
const tm = Math.floor(total / 60)
console.log(`  合计：${tm ? `${tm} 分 ` : ''}${total % 60} 秒`)
