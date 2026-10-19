#!/usr/bin/env node
/**
 * 发版脚本（rev173.37 · 2026-10-19）。
 *
 * 单一来源 = `package.json` 的 `version`。本脚本把它同步到另外两处：
 *   · `src-tauri/tauri.conf.json` 的 "version"（Tauri 打包 / Android versionName 用）
 *   · `src-tauri/Cargo.toml` 的 `[package] version`（Rust crate 版本）
 * 前端「关于」页的版本由 vite 从 package.json 注入（`__APP_VERSION__`），无需同步。
 *
 * 用法：
 *   node scripts/release.mjs 0.2.0            # 改三处版本号（不提交、不打 tag）
 *   node scripts/release.mjs 0.2.0 --tag      # 只打 tag（要求工作区干净，版本文件已提交）
 *
 * 完整发版流程：
 *   1. node scripts/release.mjs 0.3.0
 *   2. 手工更新 CHANGELOG.md（应用版本段）
 *   3. git add -A && git commit -m "chore(release): v0.3.0"
 *   4. node scripts/release.mjs 0.3.0 --tag
 *   5. git push origin main --tags
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const version = args.find((a) => /^\d+\.\d+\.\d+$/.test(a))
const wantTag = args.includes('--tag')

if (!version) {
  console.error('用法: node scripts/release.mjs <x.y.z> [--tag]')
  process.exit(1)
}

const file = (rel) => new URL(rel, import.meta.url)
const read = (rel) => readFileSync(file(rel), 'utf-8')

const pkg = JSON.parse(read('../package.json'))
const prev = pkg.version

if (prev !== version) {
  // 1) package.json —— 单一来源
  pkg.version = version
  writeFileSync(file('../package.json'), JSON.stringify(pkg, null, 2) + '\n')

  // 2) tauri.conf.json
  const confRaw = read('../src-tauri/tauri.conf.json')
  const confNext = confRaw.replace(/"version":\s*"[^"]+"/, `"version": "${version}"`)
  if (confNext === confRaw) {
    console.error('✗ tauri.conf.json 里没找到 "version" 字段')
    process.exit(1)
  }
  writeFileSync(file('../src-tauri/tauri.conf.json'), confNext)

  // 3) Cargo.toml（[package] 块里的第一处 version）
  const cargoRaw = read('../src-tauri/Cargo.toml')
  const cargoNext = cargoRaw.replace(/^version = "[^"]+"$/m, `version = "${version}"`)
  if (cargoNext === cargoRaw) {
    console.error('✗ Cargo.toml 里没找到 version 字段')
    process.exit(1)
  }
  writeFileSync(file('../src-tauri/Cargo.toml'), cargoNext)

  console.log(`✅ 版本 ${prev} → ${version}（package.json / tauri.conf.json / Cargo.toml）`)
} else {
  console.log(`· 版本已是 ${version}`)
}

if (wantTag) {
  const dirty = execSync('git status --porcelain', { cwd: root }).toString().trim()
  if (dirty) {
    console.error('✗ 工作区有未提交改动，先提交再打 tag：')
    console.error(dirty)
    process.exit(1)
  }
  try {
    execSync(`git tag -a v${version} -m "v${version}"`, { cwd: root, stdio: 'pipe' })
    console.log(`🏷  已打 tag v${version}`)
    console.log('   推送：git push origin main --tags')
  } catch (e) {
    console.error(`✗ 打 tag 失败（可能已存在 v${version}）`, e instanceof Error ? e.message : e)
    process.exit(1)
  }
}
