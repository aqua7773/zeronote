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

/**
 * updater 签名密钥（rev173.292）。
 *
 * `tauri.conf.json` 里 `bundle.createUpdaterArtifacts: true` 之后，**每次打包都会给安装包签名**
 * —— 找不到私钥就直接构建失败（`A public key has been found, but no private key`）。
 * 私钥默认放 `~/.tauri/zeronote.key`（`pnpm tauri signer generate` 的产物，不进仓库）；
 * 已经在环境变量里设了的不覆盖（CI / 换机场景）。
 */
const signingKeyPath = join(process.env.USERPROFILE ?? '', '.tauri', 'zeronote.key')
const signingEnv = (() => {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) return {}
  if (existsSync(signingKeyPath)) {
    console.log(`· updater 签名密钥：${signingKeyPath}`)
    return { TAURI_SIGNING_PRIVATE_KEY: signingKeyPath }
  }
  console.warn(
    '⚠️ 没找到 updater 签名密钥（~/.tauri/zeronote.key）—— 打包会在签名阶段失败。\n' +
      '   生成：pnpm tauri signer generate -w ~/.tauri/zeronote.key',
  )
  return {}
})()

/**
 * sccache（可选，2026-10-31 装）：跨构建复用**依赖**的编译产物。
 *
 * 说清楚它救什么、不救什么（别指望它让发版飞起来）：
 * · **救**：`cargo clean` / 换 target 目录 / 换机器之后，tauri、image、rustls 这些依赖
 *   不必重编（实测单个依赖 crate 动辄 30–90 秒）。
 * · **不救**：改自己的代码（`zeronote` crate 本身、新增原生插件）—— 输入变了就必须重编，
 *   这部分是发版的固定成本（增量时约 1.5–3 分钟/端）。
 *
 * 装了就用；没装静默跳过（不因为缺一个可选工具让构建挂掉）。
 */
const sccacheEnv = (() => {
  if (process.env.RUSTC_WRAPPER) {
    console.log(`· sccache：沿用已有 RUSTC_WRAPPER=${process.env.RUSTC_WRAPPER}`)
    return {}
  }
  const probe = spawnSync('where', ['sccache'], { shell: process.platform === 'win32', encoding: 'utf8' })
  if (probe.status !== 0 || !probe.stdout?.trim()) return {}
  console.log('· sccache：已启用（依赖编译产物跨构建复用）')
  return { RUSTC_WRAPPER: 'sccache' }
})()

function run(label, args, opts = {}) {
  const t0 = Date.now()
  console.log(`\n▶ ${label}`)
  console.log(`  ${opts.cmd ?? 'pnpm'} ${args.join(' ')}`)
  const r = spawnSync(opts.cmd ?? 'pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PATH: pathWithCargo, ...signingEnv, ...sccacheEnv },
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

if (sccacheEnv.RUSTC_WRAPPER) {
  const st = spawnSync('sccache', ['--show-stats'], {
    shell: process.platform === 'win32',
    encoding: 'utf8',
  })
  if (st.status === 0 && st.stdout) {
    const hit = /Cache hits\s+(\d+)/.exec(st.stdout)?.[1]
    const miss = /Cache misses\s+(\d+)/.exec(st.stdout)?.[1]
    if (hit != null && miss != null) {
      const n = Number(hit)
      const m = Number(miss)
      const rate = n + m > 0 ? Math.round((n / (n + m)) * 100) : 0
      console.log(`  sccache：命中 ${hit} · 未命中 ${miss} · 命中率 ${rate}%`)
    }
  }
}
