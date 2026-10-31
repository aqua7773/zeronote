#!/usr/bin/env node
/**
 * 生成应用更新的**两份静态清单**（rev173.292）。
 *
 * 应用本体更新没有服务端，靠仓库里的两个 JSON：
 *  · `update/latest.json`  —— 桌面。Tauri 的 static JSON 格式，`platforms.windows-x86_64`
 *    里放 Release 资产地址与 `.sig` 内容（tauri-plugin-updater 用它做 minisign 校验）。
 *  · `update/android.json` —— Android。自定义格式，`apk.url` / `apk.sha256` / `apk.size`，
 *    由 `src-tauri/src/updates.rs` 读取并在下载后逐字节核对 sha256。
 *
 * 用法（在 `scripts/build-release.mjs` 之后跑）：
 *   node scripts/gen-update-manifest.mjs                  # 两端产物都在时都生成
 *   node scripts/gen-update-manifest.mjs --notes "修了…"  # 覆盖 notes（默认从 CHANGELOG 取）
 *   node scripts/gen-update-manifest.mjs --dry            # 只看会写什么，不落盘
 *
 * ⚠️ 顺序很重要：**先构建、再生成清单、最后上传 Release**。清单里的 url 用的是
 * `releases/download/<tag>/<实际文件名>` —— 文件名必须与上传的资产名一模一样，
 * 否则 updater 会 404（现象是「检查到了新版，下载总是失败」）。
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const argv = process.argv.slice(2)
const dry = argv.includes('--dry')
const notesArg = (() => {
  const i = argv.indexOf('--notes')
  return i >= 0 ? (argv[i + 1] ?? '') : ''
})()

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const productName = JSON.parse(
  readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf-8'),
).productName
const version = pkg.version
const tag = `v${version}`
const REPO = 'aqua7773/zeronote'
const releaseBase = `https://github.com/${REPO}/releases/download/${tag}/`

/**
 * 桌面清单里的下载地址**走 ghproxy 反代**（2026-10-31 实测得出）。
 *
 * 为什么：`tauri-plugin-updater` 从清单的 `platforms.windows-x86_64.url` 直接下载安装包，
 * 而这里填的通常是 `github.com/releases/download/...`。国内网络直连 `github.com:443`
 * 是不通的（本轮 `git push` 就撞过一次 `curl 28 Failed to connect`）；用户开着系统代理
 * （如 Steam++）时 reqwest 能借代理出去，关掉代理就必然失败。ghproxy 前缀的同一地址
 * 两端实测都能下（200 + 字节数一致），且不依赖本机代理。
 *
 * 代价：ghproxy 是第三方反代，可能限速或临时不可用 —— 所以要保留「手动下载」
 * （Release 页面），见 UI 与 `update/README.md` 的说明。
 * 环境变量 `NO_GH_MIRROR=1` 可退回原始 GitHub 地址（海外 / 自建反代时用）。
 *
 * ⚠️ **从 rev173.300 起这层前缀是有意保留的**：客户端会把它**剥回 GitHub 直链**，
 * 再按用户在「关于 → 更新」里选的渠道重新路由（`updates.rs` 的 `canonical_asset_url` /
 * `rewrite_asset_url`）。原因：
 *  · 旧客户端（≤0.9.3）只会用清单里的 url 原样下载 ⇒ 这里写直链会让它们下不动；
 *  · 新客户端剥掉前缀后按渠道走 ⇒ 不受影响。
 * **换渠道是客户端的事，别把这里改成直链。**
 */
const GH_MIRROR = 'https://ghproxy.net/'
const downloadBase = process.env.NO_GH_MIRROR ? releaseBase : GH_MIRROR + releaseBase

/**
 * 产物名过滤：**必须按版本号挑，不能取第一个 .exe**。
 * `target/release/bundle/nsis/` 里常年躺着历史版本的安装包（第一次跑这条脚本就撞上
 * 0.8.0 的 exe，差点把 0.8.0 的包当成 0.9.1 发出去）。
 */
const exePrefix = `${productName}_${version}_`

/** 从 CHANGELOG 里截出当前版本那一段（没有就返回空串），并压成纯文本 */
function changelogNotes() {
  try {
    const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8')
    const lines = text.split(/\r?\n/)
    const start = lines.findIndex((l) => new RegExp(`^##\\s+.*${version.replace(/\./g, '\\.')}`).test(l))
    if (start < 0) return ''
    const body = []
    for (let i = start + 1; i < lines.length; i++) {
      if (/^##\s+/.test(lines[i])) break
      body.push(lines[i])
    }
    return body
      .join('\n')
      .replace(/^#{1,6}\s*/gm, '') // 标题井号
      .replace(/\*\*/g, '') // 粗体星号（更新提示里按纯文本显示）
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 1200)
  } catch {
    return ''
  }
}

const notes = notesArg || changelogNotes() || `ZeroNote ${version}`
const pubDate = new Date().toISOString()

function sha256Of(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function writeJson(rel, obj) {
  const out = JSON.stringify(obj, null, 2) + '\n'
  if (dry) {
    console.log(`\n── ${rel}（dry，不落盘）──\n${out}`)
    return
  }
  writeFileSync(join(root, rel), out)
  console.log(`✅ 写入 ${rel}`)
}

/* ── 桌面：NSIS 安装器 + 它的 .sig ── */
const nsisDir = join(root, 'src-tauri/target/release/bundle/nsis')
let desktopOk = false
if (existsSync(nsisDir)) {
  const entries = readdirSync(nsisDir)
  const exe = entries.find(
    (f) => f.endsWith('.exe') && f.startsWith(exePrefix) && !f.toLowerCase().includes('uninstall'),
  )
  if (exe) {
    const sigPath = join(nsisDir, `${exe}.sig`)
    if (!existsSync(sigPath)) {
      console.error(
        `✗ 找到 ${exe} 但没有 ${exe}.sig —— 构建时缺 TAURI_SIGNING_PRIVATE_KEY。\n` +
          '  先设环境变量再重编：$env:TAURI_SIGNING_PRIVATE_KEY="C:\\Users\\AQUA\\.tauri\\zeronote.key"',
      )
    } else {
      const signature = readFileSync(sigPath, 'utf-8').trim()
      const url = downloadBase + encodeURIComponent(exe)
      writeJson('update/latest.json', {
        version,
        notes,
        pub_date: pubDate,
        platforms: {
          'windows-x86_64': { url, signature },
        },
      })
      console.log(`   · 安装器 ${exe} · 签名 ${signature.slice(0, 24)}…`)
      desktopOk = true
    }
  } else {
    console.log(
      `· nsis 目录里没有 ${exePrefix}*.exe（跳过 latest.json）—— 先跑 node scripts/build-release.mjs --desktop`,
    )
  }
} else {
  console.log('· 没有桌面产物目录（先跑 node scripts/build-release.mjs --desktop）')
}

/* ── Android：APK ── */
const apkDirs = [
  'src-tauri/gen/android/app/build/outputs/apk/universal/release',
  'src-tauri/gen/android/app/build/outputs/apk/arm64/release',
]
let androidOk = false
for (const rel of apkDirs) {
  const dir = join(root, rel)
  if (!existsSync(dir)) continue
  // Gradle 的输出名固定是 `app-universal-release.apk`（不含版本号），目录里会留历史产物。
  // 优先用**人工重命名**成 `ZeroNote_<版本>_*.apk` 的那份（名字与上传资产一致、肉眼可核对）；
  // 没有才退回「最新修改时间」的那个。
  const apks = readdirSync(dir).filter((f) => f.endsWith('.apk'))
  const preferred = apks.find((f) => f.startsWith(exePrefix))
  const apk =
    preferred ??
    apks
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]?.f
  if (!apk) continue
  if (!preferred) {
    console.warn(
      `· 提示：APK 用的是 Gradle 原名 ${apk}（不含版本号）。建议先复制成 ${exePrefix}arm64.apk，发布后更好认。`,
    )
  }
  const full = join(dir, apk)
  const sha256 = sha256Of(full)
  const size = readFileSync(full).length
  const mtime = new Date(statSync(full).mtimeMs).toISOString().slice(0, 19).replace('T', ' ')
  writeJson('update/android.json', {
    version,
    notes,
    pub_date: pubDate,
    apk: {
      url: releaseBase + encodeURIComponent(apk),
      sha256,
      size,
    },
  })
  console.log(
    `   · APK ${apk} · ${(size / 1024 / 1024).toFixed(1)} MiB · 构建于 ${mtime} · sha256 ${sha256.slice(0, 16)}…`,
  )
  androidOk = true
  break
}
if (!androidOk) console.log('· 没有 APK 产物（先跑 node scripts/build-release.mjs --android）')

if (!dry) {
  console.log('\n下一步：')
  if (desktopOk) {
    console.log(
      `  gh release upload ${tag} "src-tauri/target/release/bundle/nsis/*.exe" "src-tauri/target/release/bundle/nsis/*.exe.sig" --clobber`,
    )
  }
  if (androidOk) {
    console.log(
      `  gh release upload ${tag} "src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk" --clobber`,
    )
  }
  console.log('  然后提交清单：git add update && git commit -m "chore(update): ' + tag + '" && git push')
}
