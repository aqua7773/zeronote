#!/usr/bin/env node
/**
 * 同步分发仓库到极狐 GitLab（rev173.441）。
 *
 * 背景：ZeroNote 的更新渠道与插件市场都按「一个渠道 = 一个完整源」设计
 * （`docs/handoff/02-发版与更新.md` §0.2）。极狐侧只有一个**分发仓库**，不含源码：
 *
 *   zeronote-dist/
 *     market/    ← index.json + entries/ + packs/*.znp
 *     update/    ← latest.json + android.json
 *
 * 安装包（exe / apk）不进 git，走 generic package registry（匿名可下，已实测 200/206）。
 *
 * 配置来源（**不读仓库文件，避免令牌进版本库**）：
 *   ~/.dsh/zn-gitlab.json  （面板写的）或用户级环境变量
 *   GITLAB_SITE / GITLAB_USER / GITLAB_REPO / GITLAB_TOKEN
 *
 * 用法：
 *   node scripts/sync-dist.mjs                     # 同步清单与插件包并推送
 *   node scripts/sync-dist.mjs --dry               # 只看要同步什么
 *   node scripts/sync-dist.mjs --assets <ver> <exe> [apk]   # 顺带把安装包传上去
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync } from 'node:fs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const DIST = process.env.ZERONOTE_DIST_DIR || resolve(REPO, '..', 'zeronote-dist')
const PKG = 'zeronote'

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const assetsIdx = args.indexOf('--assets')

function loadConfig() {
  const fromEnv = (k) => process.env[k] ?? ''
  const env = {
    site: fromEnv('GITLAB_SITE'),
    user: fromEnv('GITLAB_USER'),
    repo: fromEnv('GITLAB_REPO'),
    token: fromEnv('GITLAB_TOKEN'),
  }
  if (env.site && env.user && env.token) return { ...env, repo: env.repo || 'zeronote-dist' }

  const f = join(homedir(), '.dsh', 'zn-gitlab.json')
  if (existsSync(f)) {
    const j = JSON.parse(readFileSync(f, 'utf8'))
    return {
      site: j.site || '',
      user: j.user || '',
      repo: j.repo || 'zeronote-dist',
      token: j.token || '',
    }
  }
  return env
}

function die(msg) {
  console.error(`[sync-dist] ${msg}`)
  process.exit(1)
}

function walk(dir, base = dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) out.push(...walk(p, base))
    else out.push(p.slice(base.length + 1))
  }
  return out
}

function syncDir(name) {
  const src = join(REPO, name)
  const dst = join(DIST, name)
  if (!existsSync(src)) die(`源目录不存在：${src}`)
  const files = walk(src)
  let copied = 0
  let bytes = 0
  for (const rel of files) {
    const from = join(src, rel)
    const to = join(dst, rel)
    const same = existsSync(to) && statSync(to).size === statSync(from).size && readFileSync(to).equals(readFileSync(from))
    if (same) continue
    if (!dry) {
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
    }
    copied += 1
    bytes += statSync(from).size
  }
  console.log(`[sync-dist] ${name}: ${files.length} 个文件，${dry ? '将' : ''}更新 ${copied} 个（${(bytes / 1024 / 1024).toFixed(1)} MB）`)
  return copied
}

function git(cmdArgs, opts = {}) {
  return execFileSync('git', cmdArgs, { cwd: DIST, stdio: opts.capture ? 'pipe' : 'inherit', encoding: 'utf8' })
}

async function uploadAsset(version, file) {
  const name = file.split(/[\\/]/).pop()
  const url = `https://jihulab.com/api/v4/projects/${projectId()}/packages/generic/${PKG}/${version}/${name}`
  console.log(`[sync-dist] 上传 ${name} (${(statSync(file).size / 1024 / 1024).toFixed(1)} MB) → ${url}`)
  if (dry) return url
  const body = readFileSync(file)
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'PRIVATE-TOKEN': cfg.token },
    body,
  })
  if (!res.ok) die(`上传失败 ${res.status}：${(await res.text()).slice(0, 300)}`)
  console.log('[sync-dist] 上传 OK（匿名下载请用上面这个 /api/v4 地址）')
  return url
}

function projectId() {
  return process.env.GITLAB_PROJECT_ID || '384964'
}

const cfg = loadConfig()
if (!cfg.site || !cfg.user || !cfg.token) {
  die('缺配置：请设置 GITLAB_SITE / GITLAB_USER / GITLAB_TOKEN（或 ~/.dsh/zn-gitlab.json）')
}
console.log(`[sync-dist] 目标 ${cfg.site}/${cfg.user}/${cfg.repo} · 工作副本 ${DIST}`)
if (!existsSync(DIST)) die(`分发副本不存在：${DIST}（先 clone ${cfg.site}/${cfg.user}/${cfg.repo}）`)

const changed = syncDir('market') + syncDir('update')

if (dry) {
  console.log('[sync-dist] --dry：不提交、不推送')
  process.exit(0)
}

const dirty = git(['status', '--porcelain'], { capture: true }).trim()
if (!dirty) {
  console.log('[sync-dist] 无变化，跳过提交')
} else {
  git(['add', '-A'])
  git(['commit', '-m', `chore(dist): 同步 market/ 与 update/（${new Date().toISOString().slice(0, 10)}）`])
}

const remote = `https://oauth2:${cfg.token}@${cfg.site}/${cfg.user}/${cfg.repo}.git`
console.log('[sync-dist] 推送中…')
try {
  git(['push', remote, 'main'])
} catch {
  die(`推送失败：${cfg.site}/${cfg.user}/${cfg.repo}（检查令牌 write_repository 权限）`)
}
console.log('[sync-dist] 推送完成')

if (assetsIdx >= 0) {
  const version = args[assetsIdx + 1]
  const files = args.slice(assetsIdx + 2).filter((a) => !a.startsWith('--'))
  if (!version || !/^\d+\.\d+\.\d+/.test(version)) die('--assets 需要版本号，如 0.10.3')
  if (!files.length) die('--assets 至少给一个安装包路径')
  for (const f of files) {
    if (!existsSync(f)) die(`文件不存在：${f}`)
    await uploadAsset(version, f)
  }
}
