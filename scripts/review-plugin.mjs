#!/usr/bin/env node
/**
 * **插件审查材料生成器**（rev173.158 · 插件市场外部分发前的最后一块）。
 *
 * 用途：收到外部作者的 PR（`market/external.json` 加一行）时，生成一份**人能读的材料**，
 * 照着看几行就能决定 merge 还是打回。调研 §4.5 的口径：
 *
 *   > 只审格式，不审代码 —— 内核本来就不为插件提供安全保证，假装审过反而危险。
 *
 * 所以本脚本只回答四个问题：
 *   ① 格式对不对（必填字段、id 规范、不撞官方、不重复）
 *   ② 地址通不通（entry 与 .znp 都真的能下载）
 *   ③ 包有没有被换过（**整包 sha256** 与 entry 一致；包内 manifest 与 entry 同 id 同版本）
 *   ④ 谁签的（有 signature.json 就报 keyId；**不验签** —— 作者的公钥不在信任根里，
 *      验了也只是证明"这把钥匙签的"，而这个事实用户需要自己决定是否接受）
 *
 * 用法：
 *   node scripts/review-plugin.mjs                     # 离线：只审 external.json 的格式与 id
 *   node scripts/review-plugin.mjs --online            # 联网：再多拉 entry + 下包核 sha256
 *   node scripts/review-plugin.mjs <id> --online       # 只审某一条
 *   node scripts/review-plugin.mjs --entry <url>       # 直接审一个 market-entry.json（不必先进索引）
 *   node scripts/review-plugin.mjs --entry <url> --out market/review-2026-10-25.md
 *
 * 退出码：0 = 可 merge（可能带警告）；1 = 有 error（打回）。
 * **离线模式没有网络依赖**，所以它进了 `check-gates.mjs`（external.json 一加脏数据就红）；
 * 联网模式只在人工审 PR 时跑，不进 CI —— 外部源会抖，别让 CI 红在别人的服务器上。
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARKET = join(repo, 'market')
const ENTRIES_DIR = join(MARKET, 'entries')

/** 与 `src/kernel/contract.ts` 的 API_VERSION 对齐（改契约时这两处一起改） */
const API_VERSION = '0.2.0'
const TIMEOUT_MS = 20_000
const ID_RE = /^[a-z0-9][a-z0-9-]*$/
const SHA_RE = /^[0-9a-f]{64}$/i

/**
 * 能力自述的精简中文映射。
 *
 * ⚠️ 这是 `src/lib/capability-label.ts` 的**精简副本** —— 脚本不能 import TS，
 * 所以只能抄一份；两处改动要一起改（那一份是应用里的权威，含更多老写法）。
 */
const CAP_LABEL = {
  'fs:read': '读文件',
  'fs:write': '写文件',
  fs: '读写文件',
  'doc:read': '读当前笔记',
  'doc:write': '改当前笔记',
  'index:query': '查索引',
  'index:write': '改索引',
  command: '注册命令',
  'view:main': '主区面板',
  'view:modal': '浮层',
  'view:statusbar': '状态栏',
  'view:sidebar': '侧栏',
  'editor:mark': '正文标记',
  store: '自己的存储',
  net: '联网',
  event: '监听事件',
  host: '宿主能力',
  service: '后台服务',
}
const capLabel = (c) => CAP_LABEL[String(c ?? '').trim()] ?? String(c ?? '').trim()

// ── CLI ──
const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith('--')))
const opt = (name) => {
  const i = argv.indexOf(`--${name}`)
  if (i < 0) return undefined
  const v = argv[i + 1]
  return v && !v.startsWith('--') ? v : ''
}
const ONLINE = flags.has('--online')
const OUT = opt('out') ?? ''
const ENTRY_URL = opt('entry') ?? ''
/** 换一份索引文件（默认 `market/external.json`）—— 用于演练 / 别的仓库复用 */
const EXTERNAL_ARG = opt('external') ?? ''
const EXTERNAL_PATH = EXTERNAL_ARG ? resolve(repo, EXTERNAL_ARG) : join(MARKET, 'external.json')
/** 位置参数 = 只审某个 id（先把各选项的值剔掉，否则 `--external x.json` 会被当成 id） */
const OPT_VALUES = new Set([OUT, ENTRY_URL, EXTERNAL_ARG].filter(Boolean))
const ID_FILTER = argv.find((a) => !a.startsWith('--') && !OPT_VALUES.has(a)) ?? ''

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))
const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

async function fetchBytes(url) {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'follow' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

/** 内核只比 major（`assertApiVersion`，plugin-host.ts:309）—— 这里照抄同一条规则 */
function apiMajorOk(range) {
  const want = String(range ?? '').replace(/^[\^~>=<\s]*/, '').split('.')[0]
  const have = API_VERSION.split('.')[0]
  return { ok: want === have, want, have }
}

/** 官方插件 id（外部条目不能撞名） */
function officialIds() {
  if (!existsSync(ENTRIES_DIR)) return new Set()
  const ids = new Set()
  for (const f of readdirSync(ENTRIES_DIR).filter((n) => n.endsWith('.json'))) {
    try {
      const e = readJson(join(ENTRIES_DIR, f))
      if (e?.id) ids.add(String(e.id))
    } catch {
      /* 坏条目由 gen-market 报，这里只管 id 冲突 */
    }
  }
  return ids
}

/* ───────────────────────── 审查一条 ───────────────────────── */

/**
 * @param {{id?:string,name?:string,author?:string,description?:string,entry:string}} row 索引行
 * @returns {Promise<{errors:string[], warns:string[], info:Record<string,unknown>, body:string}>}
 */
async function reviewOne(row) {
  const errors = []
  const warns = []
  /**
   * `--entry <url>` 模式：手里只有作者那份 `market-entry.json`，**没有索引行**
   * ⇒ id / name / author 全部从 entry 反推（不能反过来要求索引行有值，
   * 否则「还没进索引的插件」永远审不过 —— 那正是这个入口的用途）。
   */
  const fromEntry = !row.id && !!row.entry
  const info = { id: row.id ?? '(从 entry 反推)', author: row.author ?? '(未填)', entry: row.entry ?? '' }

  // ① 索引行本身的格式（离线）—— --entry 模式跳过这一步，等拉到 entry 再补
  if (!fromEntry) {
    if (!row.id) errors.push('缺 id')
    else if (!ID_RE.test(row.id)) errors.push(`id 不规范（应是小写字母/数字/连字符）：${row.id}`)
    if (!row.name) errors.push('缺 name')
    if (!row.author) errors.push('缺 author')
    if (!row.entry) errors.push('缺 entry')
    else if (!/^https?:\/\//i.test(row.entry)) errors.push(`entry 不是 http(s)：${row.entry}`)
  }
  if (fromEntry && !ONLINE) {
    errors.push('--entry 模式必须配 --online（离线时手里没有任何 entry 内容可看）')
    return { errors, warns, info, body: '' }
  }

  if (!ONLINE) return { errors, warns, info, body: '' }

  // ② entry 可达 + 字段（联网）
  let entry = null
  let entryBytes = 0
  try {
    const buf = await fetchBytes(row.entry)
    entryBytes = buf.length
    entry = JSON.parse(buf.toString('utf8'))
  } catch (e) {
    errors.push(`拉不到 market-entry.json：${String(e)}`)
    return { errors, warns, info, body: '' }
  }
  info.entryBytes = entryBytes
  if (!entry || typeof entry !== 'object') {
    errors.push('market-entry.json 顶层不是对象')
    return { errors, warns, info, body: '' }
  }

  const id = String(entry.id ?? '')
  const version = String(entry.version ?? '')
  const entryUrl = String(entry.url ?? '')
  const sha = String(entry.sha256 ?? '')
  info.version = version

  // --entry 模式：把索引行该有的字段从 entry 补上（材料里才好认）
  if (fromEntry) {
    if (!row.id) row.id = id
    if (!row.name) row.name = String(entry.name ?? '') || id || '(未命名)'
    if (!row.author) row.author = String(entry.author ?? '') || '(未填)'
    info.id = row.id
    info.author = row.author
    if (!entry.name) warns.push('entry 里没有 name（索引行必须补一个，否则「发现」列表显示 id）')
    if (!entry.author) warns.push('entry 里没有 author（索引行必须补一个）')
  }

  if (row.id && id !== row.id) errors.push(`entry.id（${id || '空'}）与索引行的 id（${row.id}）不一致`)
  if (!ID_RE.test(id)) errors.push(`entry.id 不规范：${id || '(空)'}`)
  if (!/^\d+\.\d+\.\d+/.test(version)) errors.push(`entry.version 不像语义版本：${version || '(空)'}`)
  if (!/^https?:\/\//i.test(entryUrl)) errors.push(`entry.url 不是 http(s)：${entryUrl || '(空)'}`)
  const major = apiMajorOk(entry.apiVersion)
  info.apiVersion = `${entry.apiVersion ?? '(空)'} · major ${major.want} vs 内核 ${major.have}`
  if (!major.ok) errors.push(`apiVersion major 不匹配：插件要 ${major.want}，内核是 ${major.have}（客户端会拒载）`)

  if (!SHA_RE.test(sha)) {
    errors.push('entry.sha256 不是 64 位十六进制')
    return { errors, warns, info, body: '' }
  }

  // ③ 下载包核 sha256 + 包内结构
  let pack = null
  let packBytes = 0
  try {
    const buf = await fetchBytes(entryUrl)
    packBytes = buf.length
    const got = createHash('sha256').update(buf).digest('hex')
    info.sha = got
    if (got !== sha.toLowerCase()) {
      errors.push(`整包 sha256 不符（包 ${got.slice(0, 12)}… ≠ entry ${sha.slice(0, 12)}…）`)
      return { errors, warns, info, body: '' }
    }
    pack = JSON.parse(buf.toString('utf8'))
  } catch (e) {
    errors.push(`下载 / 解析 .znp 失败：${String(e)}`)
    return { errors, warns, info, body: '' }
  }
  info.packBytes = packBytes

  if (!pack || pack.znp !== 1 || typeof pack.manifest !== 'object' || typeof pack.files !== 'object') {
    errors.push('包结构不是 { znp:1, manifest, files }')
    return { errors, warns, info, body: '' }
  }
  const m = pack.manifest
  const files = Object.keys(pack.files)
  info.files = files
  info.manifest = { id: m.id, version: m.version, entry: m.entry }

  if (m.id !== id) errors.push(`包内 manifest.id（${m.id ?? '空'}）与 entry.id（${id}）不一致`)
  if (m.version !== version) errors.push(`包内 manifest.version（${m.version ?? '空'}）与 entry.version（${version}）不一致`)
  if (!m.entry || !files.includes(m.entry)) errors.push(`包内 manifest.entry（${m.entry ?? '空'}）不在包里`)

  // ④ 签名（只报，不验）
  if (files.includes('signature.json')) {
    try {
      const sig = JSON.parse(String(pack.files['signature.json']))
      info.sigKeyId = sig?.keyId ?? '(缺 keyId)'
      if (sig?.alg !== 'ed25519') warns.push(`签名 alg 不是 ed25519：${sig?.alg ?? '(空)'}`)
      warns.push(
        `有签名（keyId=${info.sigKeyId}）但**不在内置信任根**：客户端会把这条签名当"未知作者"——` +
          '想让它验签通过，用户需要手动把作者公钥加进 `.zn/trusted-keys.json`',
      )
    } catch {
      warns.push('signature.json 存在但不是合法 JSON（客户端会拒绝加载）')
    }
  } else {
    warns.push('包里没有 signature.json —— 用户会在插件页看到「未签名」')
  }

  info.capabilities = Array.isArray(m.capabilities) ? m.capabilities.map(capLabel) : []

  const body = renderBody()
  return { errors, warns, info, body }

  function renderBody() {
    const kb = (n) => `${(n / 1024).toFixed(1)} KB`
    return [
      `- **索引行**：id \`${row.id}\` · 作者 \`${row.author}\``,
      `- **entry**：${row.entry} · ${kb(entryBytes)}`,
      `- **版本**：${version} · apiVersion \`${entry.apiVersion ?? '?'}\`（${major.ok ? '兼容' : '不兼容'}）`,
      `- **包**：${kb(packBytes)} · sha256 ✓ 与 entry 一致（\`${info.sha.slice(0, 16)}…\`）`,
      `- **包内**：${files.map((f) => `\`${f}\``).join(' · ')}`,
      `- **签名**：${info.sigKeyId ? `keyId \`${info.sigKeyId}\`` : '无'}`,
      `- **能力自述**：${info.capabilities.length ? info.capabilities.join(' · ') : '（未声明）'}`,
    ].join('\n')
  }
}

/* ───────────────────────── 汇总 ───────────────────────── */

function loadRows() {
  if (ENTRY_URL) {
    // 直接审一个 entry：索引行只能从 entry 本身推
    return [{ id: '', name: '', author: '', entry: ENTRY_URL }]
  }
  if (!existsSync(EXTERNAL_PATH)) {
    console.error(`❌ 找不到 ${EXTERNAL_PATH}`)
    process.exit(1)
  }
  let doc
  try {
    doc = readJson(EXTERNAL_PATH)
  } catch (e) {
    console.error(`❌ market/external.json 不是合法 JSON：${e}`)
    process.exit(1)
  }
  const list = Array.isArray(doc?.plugins) ? doc.plugins : []
  if (ID_FILTER) {
    const hit = list.filter((p) => p?.id === ID_FILTER)
    if (!hit.length) {
      console.error(`❌ external.json 里没有 id=${ID_FILTER} 的条目`)
      process.exit(1)
    }
    return hit
  }
  return list
}

const rows = loadRows()
const official = officialIds()

// 跨条目检查（离线）：id 唯一 + 不撞官方
const seen = new Set()
/** 有全局问题的 id —— 用来把那一行的结论也改成「打回」（否则材料里会自相矛盾：全局红、单条绿） */
const badIds = new Set()
const globalErrors = new Set()
for (const r of rows) {
  if (!r?.id) continue
  if (seen.has(r.id)) {
    globalErrors.add(`id 重复：${r.id}`)
    badIds.add(r.id)
  }
  seen.add(r.id)
  if (official.has(r.id)) {
    globalErrors.add(`id 与官方插件冲突：${r.id}（外部条目不能覆盖官方）`)
    badIds.add(r.id)
  }
}
const globalErrorList = [...globalErrors]

const results = []
for (const r of rows) results.push(await reviewOne(r ?? {}))

/** 单条自己的错误 + 全局问题（撞官方 / 重复 id）都算「这条打回」 */
const isBlocked = (i) =>
  results[i].errors.length > 0 || (rows[i]?.id ? badIds.has(rows[i].id) : false)
const blockedCount = results.reduce((n, _x, i) => n + (isBlocked(i) ? 1 : 0), 0)
const ok = results.length - blockedCount
const warnCount = results.reduce((n, x) => n + x.warns.length, 0)
const totalErrors =
  globalErrorList.length + results.reduce((n, x) => n + x.errors.length, 0)

const out = []
out.push(`# 插件审查材料（${today}）`)
out.push('')
out.push(
  '> 自动检查：格式 / 可达性 / 整包 sha256 / 包内结构 / id 一致 / apiVersion(major) / 签名 keyId。',
)
out.push(
  '> **不审代码** —— 插件与内核同权限运行、内核不提供沙箱。这份材料只证明「格式对、包没被换过、谁签的」，',
)
out.push('> 不证明作者善意（`docs/架构原则-2026-10-13.md` §4.1）。')
out.push('')
out.push(`模式：${ONLINE ? '联网（拉 entry + 下包核 sha256）' : '离线（只看 external.json 格式）'} · 共 ${rows.length} 条 · ✅ ${ok} / ❌ ${blockedCount}`)
out.push('')

if (globalErrorList.length) {
  out.push('## 全局问题')
  out.push('')
  for (const e of globalErrorList) out.push(`- ❌ ${e}`)
  out.push('')
}

for (let i = 0; i < results.length; i++) {
  const r = results[i]
  const row = rows[i]
  const verdict = isBlocked(i) ? '❌ 打回' : r.warns.length ? '✅ 可合并（有警告）' : '✅ 可合并'
  out.push(`## ${row?.name || row?.id || '(未命名)'} · ${verdict}`)
  out.push('')
  if (r.body) out.push(r.body)
  else out.push(`- **索引行**：id \`${row?.id ?? '?'}\` · 作者 \`${row?.author ?? '?'}\``)
  for (const e of r.errors) out.push(`- ❌ ${e}`)
  for (const w of r.warns) out.push(`- ⚠️ ${w}`)
  out.push('')
}

const text = out.join('\n')
if (OUT) {
  writeFileSync(resolve(repo, OUT), text, 'utf8')
  console.log(`✅ 审查材料已写入 ${OUT}`)
} else {
  console.log(text)
}

if (rows.length === 0) console.log('\n（external.json 里没有外部条目 —— 这是当前正常状态）')
if (totalErrors) {
  console.error(`\n❌ 审查不通过：${totalErrors} 个错误（见上）`)
  process.exit(1)
}
console.log(`\n✅ 审查通过：${results.length} 条${warnCount ? ` · ${warnCount} 条警告` : ''}${ONLINE ? '' : '（离线）'}`)
