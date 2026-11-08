#!/usr/bin/env node
/**
 * 读出 APK 里**真正**的 versionName / versionCode（rev173.437 · 2026-11-08 发版事故之后加的）。
 *
 * 为什么必须有它：0.10.2 发出去的 Android 包，文件名是 `ZeroNote_0.10.2_arm64.apk`、
 * 清单里的 sha256 与大小也自洽，但 `aapt2` 读出来是 **0.9.16 / versionCode 9016** ——
 * 用户装上必然被系统拒绝（降级安装）。事故链：
 *   ① `tauri android build --apk` 不带 `--split-per-abi` ⇒ 产物落在 `apk/universal/release/`，
 *      而 `apk/arm64/release/` 里是上一次 `--split-per-abi` 留下的旧文件（Gradle 输出名不含版本号）；
 *   ② 取文件时按「目录名 + 体积」判断，选了 arm64 那份旧产物；
 *   ③ 清单脚本只算 sha256 / size —— 对旧包**同样自洽**，三道校验全部放行。
 *
 * 判据只有一条：**文件名叫什么、多大都不算数，aapt2 读出来的 versionName 才算数。**
 *
 * 用法：
 *   node scripts/apk-version.mjs <apk> [--expect 0.10.2]
 *   退出码 0 = 通过（或纯查询），1 = 版本不符 / 读不出来。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

/** 版本号目录排序（10.0.0 > 9.1.2，别按字符串排） */
function compareDirVersion(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

/**
 * 找 aapt2：先看 ANDROID_HOME / ANDROID_SDK_ROOT，再退回默认 SDK 目录，最后看 PATH。
 * 找不到返回 null —— 调用方必须把「找不到」当失败，不许静默放行。
 */
export function findAapt2() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : '',
    process.env.HOME ? join(process.env.HOME, 'Android', 'Sdk') : '',
  ].filter(Boolean)
  const exeName = process.platform === 'win32' ? 'aapt2.exe' : 'aapt2'
  for (const r of roots) {
    const bt = join(r, 'build-tools')
    if (!existsSync(bt)) continue
    const dirs = readdirSync(bt)
      .filter((d) => /^\d+(\.\d+)+$/.test(d))
      .sort(compareDirVersion)
      .reverse()
    for (const d of dirs) {
      const exe = join(bt, d, exeName)
      if (existsSync(exe)) return exe
    }
  }
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['aapt2'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  const first = (probe.stdout ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0]
  return first && existsSync(first) ? first : null
}

/**
 * 读 APK 版本。
 * @returns {{ ok: true, versionName: string, versionCode: number } | { ok: false, error: string }}
 */
export function readApkVersion(apkPath) {
  if (!existsSync(apkPath)) return { ok: false, error: `APK 不存在：${apkPath}` }
  const aapt = findAapt2()
  if (!aapt) {
    return {
      ok: false,
      error: '找不到 aapt2 —— 设 ANDROID_HOME，或安装 Android build-tools（不能跳过这一步校验）',
    }
  }
  const r = spawnSync(aapt, ['dump', 'badging', apkPath], { encoding: 'utf8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const m = /versionCode='(\d+)'\s+versionName='([^']*)'/.exec(out)
  if (!m) {
    return { ok: false, error: `aapt2 没解析出版本号：${out.slice(0, 300) || '（无输出）'}` }
  }
  return { ok: true, versionName: m[2], versionCode: Number(m[1]) }
}

/**
 * 校验 APK 的 versionName 等于期望版本；不符返回失败原因（不抛异常，方便两个脚本各按自己的口吻报错）。
 */
export function checkApkVersion(apkPath, expectVersion) {
  const v = readApkVersion(apkPath)
  if (!v.ok) return v
  if (v.versionName !== expectVersion) {
    return {
      ok: false,
      error:
        `APK 里的版本是 ${v.versionName}（versionCode ${v.versionCode}），` +
        `但 package.json 是 ${expectVersion} —— 这个文件不能发（多半是拿错了旧产物）`,
      actual: v,
    }
  }
  return { ok: true, versionName: v.versionName, versionCode: v.versionCode }
}

/**
 * 从构建产物里挑出「可以发布」的那几份（rev173.439）。
 *
 * 规则（rev173.437 事故 + rev173.438 误报之后定）：
 *   ① 有**本次新写出**的 APK ⇒ 只认这些（Gradle 这次确实重新打了包，旧产物一律不看）；
 *   ② 一个都没有 ⇒ Gradle 判定「无需重打」（app 本体没变；只改了插件 / 脚本 / 文档时常见）
 *      —— 回退到已有产物，但**每一份都必须 aapt2 读出的版本正确**，否则不算；
 *   ③ 两份都为空 ⇒ 调用方报错退出（绝不能把历史产物改名发出去）。
 *
 * 回退不是放松校验：rev173.438 那次误报正是「Gradle 没重写，但 universal 里的包是新的 0.10.2」，
 * 旧实现只按 mtime 过滤 ⇒ 空集 ⇒ 直接失败。校验强度不变，只是多了「版本对就用」这条呼吸口。
 *
 * @param {Array<{ variant: string, apk: string }>} apks
 * @param {{ isFresh: (a: { variant: string, apk: string }) => boolean, expectVersion: string,
 *           check?: (apk: string, expect: string) => any }} opts
 * @returns {{ mode: 'fresh' | 'existing',
 *             picks: Array<{ variant: string, apk: string, versionName: string, versionCode: number }>,
 *             rejected: Array<{ variant: string, apk: string, error: string }> }}
 */
export function pickReleaseApks(apks, { isFresh, expectVersion, check = checkApkVersion }) {
  const fresh = apks.filter((a) => {
    try {
      return isFresh(a)
    } catch {
      return false
    }
  })
  const mode = fresh.length > 0 ? 'fresh' : 'existing'
  const pool = mode === 'fresh' ? fresh : apks
  const picks = []
  const rejected = []
  for (const a of pool) {
    const v = check(a.apk, expectVersion)
    if (v.ok) {
      picks.push({
        variant: a.variant,
        apk: a.apk,
        versionName: v.versionName,
        versionCode: v.versionCode,
      })
    } else {
      rejected.push({ variant: a.variant, apk: a.apk, error: v.error })
    }
  }
  return { mode, picks, rejected }
}

/** 列出 Gradle 各变体 release 目录里的 APK（供构建脚本统一校验） */
export function listReleaseApks() {
  const base = join(root, 'src-tauri/gen/android/app/build/outputs/apk')
  if (!existsSync(base)) return []
  const out = []
  for (const variant of readdirSync(base)) {
    const dir = join(base, variant, 'release')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.apk')) continue
      out.push({ variant, apk: join(dir, f) })
    }
  }
  return out
}

/* ── CLI ── */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argv = process.argv.slice(2)
  const expectIdx = argv.indexOf('--expect')
  const expect = expectIdx >= 0 ? argv[expectIdx + 1] : ''
  const apk = argv.find((a) => !a.startsWith('--') && a !== expect)
  if (!apk) {
    console.error('用法：node scripts/apk-version.mjs <apk> [--expect 0.10.2]')
    process.exit(2)
  }
  const v = expect ? checkApkVersion(apk, expect) : readApkVersion(apk)
  if (!v.ok) {
    console.error(`✗ ${v.error}`)
    process.exit(1)
  }
  console.log(`✅ ${apk}\n   versionName=${v.versionName} versionCode=${v.versionCode}`)
}
