/**
 * **插件市场（阶段 1）** —— 索引形状、状态判定、拉取与安装（rev173.148）。
 *
 * 为什么索引是一个**静态 JSON**：见 `docs/插件市场-调研-2026-10-25.md` §2 —— 参照 Obsidian 的
 * `community-plugins.json`，市场不需要服务端。`market/index.json` 由 `scripts/gen-market.mjs`
 * 从 `market/entries/*.json` 合并，已进 verify 质量门（条目版本与 `examples/<id>/manifest.json`
 * 不一致就红）。
 *
 * 三层分工（都在这一处，方便单测）：
 *  1. `parseMarketIndex` —— 只看形状：**坏条目跳过并记下来**，不让一条脏数据让整个市场打不开
 *  2. `marketAction` —— 已装 / 可更新 / 未装（`compareVersions`，不是字符串比较）
 *  3. `fetchMarketIndex` / `installFromMarket` —— 两个 invoke；**下载与校验都在 Rust 侧**
 *     （`install_znp_from_url`），前端只传 url + 期望的 sha256
 */

import { invoke } from '@tauri-apps/api/core'
import { compareVersions } from './version'

/** 索引里的一条插件（字段与 `scripts/pack-plugin.mjs` 产出的市场条目一一对应） */
export type MarketEntry = {
  id: string
  name: string
  author?: string
  description?: string
  category?: string
  platforms?: string[]
  apiVersion?: string
  version: string
  /** `.znp` 的下载地址（Release asset 或任意可匿名访问的地址） */
  url: string
  /** **整包** sha256（hex）—— 下载后逐字节核对，对不上不安装 */
  sha256: string
  size?: number
  files?: string[]
  /**
   * **能力自述**（rev173.156）：插件 manifest 里声明的 capability 列表。
   *
   * 索引里带它是为了「装之前就让人看见」—— 调研 §4.4 的安装确认框要求列出能力，
   * 而插件包下载完才知道就晚了。**它只是自述**：内核不会校验插件是否真的只用这些
   * （插件与内核同权限运行，见 README 免责）。
   */
  capabilities?: string[]
}

/** 解析结果：有效条目 + 被跳过的坏条目（**跳过必须可见**，硬约束 4） */
export type MarketParseResult = {
  entries: MarketEntry[]
  skipped: { id: string; reason: string }[]
}

/** 索引地址存在这里（localStorage）—— 私有仓库 / 自建源时用户自己填 */
export const MARKET_INDEX_URL_KEY = 'zn-market-index-url'

/**
 * 默认索引地址：本仓库 `main` 分支的 raw。
 *
 * ⚠️ 仓库目前是 **private** ⇒ 这个地址匿名拉是 404。届时页面会明确提示「把仓库设为公开，
 * 或填一个可匿名访问的索引地址」，不会表现为「市场是空的」。
 */
export const DEFAULT_MARKET_INDEX_URL =
  'https://raw.githubusercontent.com/aqua7773/zeronote/main/market/index.json'

/* ───── 镜像（rev173.194）───── */

/**
 * 一条市场镜像 = **索引地址 + 包地址前缀**，必须成对。
 *
 * 为什么成对：索引里的 `url` 是打包时写死的（raw）。只换索引地址、不换包前缀，结果是
 * 「列表拉得到、安装时又回 raw」—— 在 raw 不可达的网络里表现为「能看不能装」
 * （rev173.150 踩过同款：索引走 raw 通、Release 域名不通）。
 */
export type MarketMirror = {
  id: string
  /** 下拉里显示的名字（要短） */
  label: string
  /** `market/index.json` 的地址 */
  indexUrl: string
  /** 包地址前缀；装的时候拼 `market/packs/<文件名>` */
  packBase: string
}

/** 自定义源（用户自己填索引地址）的镜像 id */
export const CUSTOM_MIRROR_ID = 'custom'

/**
 * 内置镜像。**第一条是默认**。
 *
 * 2026-10-27 手机真机实测（Android · rustls，与装插件同一条 Rust 链路）：
 *  · `raw.githubusercontent.com` **6/6 失败**（`Connection reset by peer`，TLS 阶段被 RST）
 *  · jsDelivr 的 `gcore` / `testingcf` 节点 **4/4 通**，索引与包都与 raw 逐字节一致
 *    （真装过一次 `backup-0.3.1`，sha256 校验通过）
 *  · `ghproxy.net` 也通，但它是第三方反代（随时可能挂 / 限速），排最后
 *  · 桌面同一份代码连 raw = 200 ⇒ raw 仍留在列表里（局域网 / 海外直连最快）
 */
export const MARKET_MIRRORS: MarketMirror[] = [
  {
    id: 'raw',
    label: 'GitHub raw',
    indexUrl: 'https://raw.githubusercontent.com/aqua7773/zeronote/main/market/index.json',
    packBase: 'https://raw.githubusercontent.com/aqua7773/zeronote/main/',
  },
  {
    id: 'jsdelivr-gcore',
    label: 'jsDelivr · GCore',
    indexUrl: 'https://gcore.jsdelivr.net/gh/aqua7773/zeronote@main/market/index.json',
    packBase: 'https://gcore.jsdelivr.net/gh/aqua7773/zeronote@main/',
  },
  {
    id: 'jsdelivr-testingcf',
    label: 'jsDelivr · Cloudflare',
    indexUrl: 'https://testingcf.jsdelivr.net/gh/aqua7773/zeronote@main/market/index.json',
    packBase: 'https://testingcf.jsdelivr.net/gh/aqua7773/zeronote@main/',
  },
  {
    id: 'jsdelivr',
    label: 'jsDelivr（cdn，国内常断）',
    indexUrl: 'https://cdn.jsdelivr.net/gh/aqua7773/zeronote@main/market/index.json',
    packBase: 'https://cdn.jsdelivr.net/gh/aqua7773/zeronote@main/',
  },
  {
    id: 'ghproxy',
    label: 'ghproxy.net（第三方）',
    indexUrl:
      'https://ghproxy.net/https://raw.githubusercontent.com/aqua7773/zeronote/main/market/index.json',
    packBase: 'https://ghproxy.net/https://raw.githubusercontent.com/aqua7773/zeronote/main/',
  },
]

/** 选中的镜像 id 存这里（自定义源另存 `MARKET_INDEX_URL_KEY`） */
export const MARKET_MIRROR_KEY = 'zn-market-mirror'

/**
 * 自定义索引地址 → 猜包前缀（同仓库同分支的 `market/packs/`）。
 *
 * 猜错不至于装坏：包地址最后还要过 Rust 的 sha256 校验，对不上就不落盘。
 * 猜对了才能让自定义源和内置镜像一样「一换全换」。
 */
export function guessPackBase(indexUrl: string): string {
  const u = indexUrl.trim()
  const idx = u.toLowerCase().lastIndexOf('/market/index.json')
  if (idx > 0) return u.slice(0, idx + 1)
  const cut = u.lastIndexOf('/')
  return cut >= 0 ? u.slice(0, cut + 1) : u
}

/**
 * 本仓库打包脚本产出的包地址形态（`pack-plugin.mjs` 的默认输出）。
 * **只有这种地址才允许被镜像改写** —— 外部作者 / 自建源 / Release 地址一律原样。
 */
const OWN_REPO_PACK_RE = /^https:\/\/raw\.githubusercontent\.com\/aqua7773\/zeronote\//

/** 把条目里的下载地址换成镜像前缀（只取文件名 —— 包名唯一且稳定） */
export function mirrorPackUrl(mirror: MarketMirror, entryUrl: string): string {
  const u = entryUrl.trim()
  // 不做「只取文件名再拼前缀」的粗暴改写：那会把 `https://example.com/x.znp`
  // （外部作者 / 自建源）也搬到本仓库前缀下，装错或装不上。
  if (!OWN_REPO_PACK_RE.test(u)) return entryUrl
  const file = u.split('?')[0].split('/').pop() ?? ''
  if (!file.endsWith('.znp')) return entryUrl
  return `${mirror.packBase.replace(/\/+$/, '')}/market/packs/${file}`
}

/** 当前镜像：内置 id 优先 → 其次自定义地址 → 最后默认（raw） */
export function loadMirror(): MarketMirror {
  const l = storage()
  const id = l?.getItem(MARKET_MIRROR_KEY)?.trim() ?? ''
  const builtin = MARKET_MIRRORS.find((m) => m.id === id)
  if (builtin) return builtin
  const custom = l?.getItem(MARKET_INDEX_URL_KEY)?.trim() ?? ''
  if (custom && custom !== DEFAULT_MARKET_INDEX_URL) {
    return {
      id: CUSTOM_MIRROR_ID,
      label: '自定义',
      indexUrl: custom,
      packBase: guessPackBase(custom),
    }
  }
  return MARKET_MIRRORS[0]
}

/** 选中一个镜像。自定义源同时把地址写进 `MARKET_INDEX_URL_KEY`（老字段，保持兼容） */
export function saveMirror(m: MarketMirror): void {
  const l = storage()
  if (!l) return
  l.setItem(MARKET_MIRROR_KEY, m.id)
  if (m.id === CUSTOM_MIRROR_ID) l.setItem(MARKET_INDEX_URL_KEY, m.indexUrl)
}

/** 一次测速的结果 */
export type MirrorProbe = {
  id: string
  ok: boolean
  ms: number
  /** 给人看的一句话（成功 = 条目数，失败 = 原因） */
  detail: string
}

/**
 * 判定一次测速（纯函数，方便测）。
 *
 * **只看状态码会被错误页骗** —— 2026-10-27 实测 `ghps.cc` 返回 200 但只有 508 字节（是个错误页）。
 * 所以「可用」= 200 **且**能解析出至少一条插件。
 */
export function judgeMirrorProbe(
  id: string,
  status: number,
  entryCount: number,
  ms: number,
): MirrorProbe {
  if (status !== 200) return { id, ok: false, ms, detail: `HTTP ${status}` }
  if (entryCount <= 0) return { id, ok: false, ms, detail: '索引为空或被改坏' }
  return { id, ok: true, ms, detail: `${entryCount} 条` }
}

/** 错误文本里的最后一段（Rust 侧的错误带 `←` 源链，最后一段最有信息量） */
function shortError(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  const parts = s
    .split('←')
    .map((x) => x.trim())
    .filter(Boolean)
  const last = parts.length > 1 ? parts[parts.length - 1] : s
  return last.slice(0, 60)
}

/** 测一条镜像：拉索引 + 解析（与真正装插件走同一条 Rust 链路，不是浏览器的 fetch） */
export async function probeMirror(m: MarketMirror): Promise<MirrorProbe> {
  const t0 = Date.now()
  try {
    const resp = await invoke<NetResponse>('net_request', {
      req: { url: m.indexUrl, method: 'GET', timeoutMs: 8_000 },
    })
    const ms = Date.now() - t0
    let count = 0
    if (resp.status === 200) {
      try {
        count = parseMarketIndex(decodeBase64Utf8(resp.body_b64)).entries.length
      } catch {
        count = 0
      }
    }
    return judgeMirrorProbe(m.id, resp.status, count, ms)
  } catch (e) {
    return { id: m.id, ok: false, ms: Date.now() - t0, detail: shortError(e) }
  }
}

const SHA256_RE = /^[0-9a-f]{64}$/i

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 解析索引文本。
 *
 * **坏条目跳过、好条目照常显示**：索引是手写 PR + 脚本合并出来的，一条少了 sha256 的条目
 * 不该让整个「发现」页空白 —— 但要让用户看到「跳过了 1 条（缺 sha256）」。
 */
export function parseMarketIndex(raw: string): MarketParseResult {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch (e) {
    throw new Error(`市场索引不是合法 JSON：${e instanceof Error ? e.message : String(e)}`)
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('市场索引形状不对：顶层应为对象')
  }
  const list = (v as Record<string, unknown>).plugins
  if (!Array.isArray(list)) throw new Error('市场索引形状不对：缺 plugins 数组')

  const entries: MarketEntry[] = []
  const skipped: { id: string; reason: string }[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      skipped.push({ id: '?', reason: '不是对象' })
      continue
    }
    const o = item as Record<string, unknown>
    const id = str(o.id)
    const name = str(o.name)
    const version = str(o.version)
    const url = str(o.url)
    const sha256 = str(o.sha256)
    const label = id || name || '?'
    if (!id) {
      skipped.push({ id: label, reason: '缺 id' })
      continue
    }
    if (seen.has(id)) {
      skipped.push({ id, reason: '重复条目' })
      continue
    }
    if (!name || !version) {
      skipped.push({ id, reason: '缺 name 或 version' })
      continue
    }
    if (!/^https?:\/\//i.test(url)) {
      skipped.push({ id, reason: '下载地址不是 http(s)' })
      continue
    }
    if (!SHA256_RE.test(sha256)) {
      skipped.push({ id, reason: '缺 sha256（或不是 64 位十六进制）' })
      continue
    }
    seen.add(id)
    entries.push({
      id,
      name,
      version,
      url,
      sha256: sha256.toLowerCase(),
      author: str(o.author) || undefined,
      description: str(o.description) || undefined,
      category: str(o.category) || undefined,
      platforms: Array.isArray(o.platforms)
        ? o.platforms.filter((p): p is string => typeof p === 'string')
        : undefined,
      apiVersion: str(o.apiVersion) || undefined,
      size: typeof o.size === 'number' && Number.isFinite(o.size) ? o.size : undefined,
      files: Array.isArray(o.files)
        ? o.files.filter((f): f is string => typeof f === 'string')
        : undefined,
      capabilities: Array.isArray(o.capabilities)
        ? o.capabilities.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
        : undefined,
    })
  }
  return { entries, skipped }
}

/** 「发现」列表里每条右下角该显示什么 */
export type MarketAction = 'install' | 'update' | 'installed'

/**
 * 状态判定。`installedVersion` 是**当前已装**的版本（没装就不传）。
 *
 * 用 `compareVersions` 而不是 `!==`：索引里是 0.10.0、本地是 0.9.0 时，
 * 字符串比较会判成「已装」，用户就永远看不到更新。
 */
export function marketAction(entry: MarketEntry, installedVersion?: string): MarketAction {
  if (!installedVersion) return 'install'
  return compareVersions(entry.version, installedVersion) > 0 ? 'update' : 'installed'
}

/* ───────────────── 更新检查（rev173.156 · 第二批 UX） ───────────────── */

/**
 * 24 小时节流：启动时最多每 24 小时查一次「有没有新版本」。
 *
 * **只查、只标角标，不下载不安装** —— 插件能读任意文件、能 invoke 命令，
 * 换代码必须让人看见（调研 §4.4 的「自动安装 ❌ 不做」）。
 */
export const MARKET_CHECK_TTL_MS = 24 * 60 * 60 * 1000
/** 上次检查的时间戳（毫秒） */
export const MARKET_CHECK_AT_KEY = 'zn-market-check-at'
/** 上次检查的结论：`{ [id]: 最新版本 }`，只存可更新的 */
export const MARKET_UPDATES_KEY = 'zn-market-updates'
/** 启动静默检查的开关（`'0'` = 关；缺省 = 开） */
export const MARKET_AUTO_CHECK_KEY = 'zn-market-auto-check'

/** 可更新项：插件 id → 索引里的最新版本（**只含比本地新的**） */
export type MarketUpdates = Record<string, string>

/**
 * 算「哪些已装插件在索引里有更新」。
 *
 * 只返回可更新的：同版本 / 本地比索引还新 / 没装，全部不算 —— 角标只该在真有事时出现。
 */
export function computeUpdates(
  entries: MarketEntry[],
  installed: { id: string; version: string }[],
): MarketUpdates {
  const have = new Map(installed.map((p) => [p.id, p.version]))
  const out: MarketUpdates = {}
  for (const e of entries) {
    const local = have.get(e.id)
    if (local && marketAction(e, local) === 'update') out[e.id] = e.version
  }
  return out
}

/**
 * 该不该去查更新。
 *
 * · 没记录 / 记录坏了 ⇒ 查（第一次装就该知道有没有新版）
 * · `now < lastAt`（系统时间被调回 / 时区跳）⇒ 查，宁多查一次也不要「永远不查」
 */
export function shouldCheckUpdates(
  lastAt: number | null | undefined,
  now: number,
  ttlMs = MARKET_CHECK_TTL_MS,
): boolean {
  if (!lastAt || !Number.isFinite(lastAt) || lastAt <= 0) return true
  if (now < lastAt) return true
  return now - lastAt >= ttlMs
}

/** localStorage 可能不存在（SSR / 隐私模式 / 测试没有 DOM）—— 拿不到就当"没有记录" */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 读上次检查的结论（`at` = 检查时刻；`updates` 可能是空的） */
export function readCachedUpdates(): { at: number | null; updates: MarketUpdates } {
  const l = storage()
  if (!l) return { at: null, updates: {} }
  try {
    const rawAt = Number(l.getItem(MARKET_CHECK_AT_KEY))
    const parsed: unknown = JSON.parse(l.getItem(MARKET_UPDATES_KEY) ?? 'null')
    const updates: MarketUpdates = {}
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v) updates[k] = v
      }
    }
    return { at: Number.isFinite(rawAt) && rawAt > 0 ? rawAt : null, updates }
  } catch {
    return { at: null, updates: {} }
  }
}

/** 写上次检查的结论（同时把 `at` 记下来给 24h 节流用） */
export function writeCachedUpdates(at: number, updates: MarketUpdates): void {
  const l = storage()
  if (!l) return
  try {
    l.setItem(MARKET_CHECK_AT_KEY, String(at))
    l.setItem(MARKET_UPDATES_KEY, JSON.stringify(updates))
  } catch {
    // 配额满 / 隐私模式：不持久也要能用（下次启动再查一次而已）
  }
}

/**
 * 装完 / 更新完某个插件后，把它从「可更新」里摘掉。
 *
 * 不摘的话角标会一直挂着到下一次 24h 检查 —— 用户刚更新完却还看到「可更新」，
 * 会以为更新没成功（静默失效比报错更糟，硬约束 4）。
 */
export function clearCachedUpdate(updates: MarketUpdates, id: string): MarketUpdates {
  if (!(id in updates)) return updates
  const next = { ...updates }
  delete next[id]
  return next
}

/** 启动静默检查开关（默认开） */
export function isAutoCheckEnabled(): boolean {
  const l = storage()
  if (!l) return true
  try {
    return l.getItem(MARKET_AUTO_CHECK_KEY) !== '0'
  } catch {
    return true
  }
}

export function setAutoCheckEnabled(on: boolean): void {
  const l = storage()
  if (!l) return
  try {
    if (on) l.removeItem(MARKET_AUTO_CHECK_KEY)
    else l.setItem(MARKET_AUTO_CHECK_KEY, '0')
  } catch {
    // 同上：不持久也能用
  }
}

type NetResponse = { status: number; headers: Record<string, string>; body_b64: string }

/** base64 → UTF-8 文本（`net_request` 的响应体统一是 base64，文本也要解一次） */
export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
}

/**
 * 拉取并解析市场索引。
 *
 * 走 `net_request`（Rust 侧 reqwest）而不是 webview 的 fetch：GitHub raw 会 302 到
 * `raw.githubusercontent.com`，浏览器里同样会撞 CORS；Rust 侧没有这个概念，
 * 而且 404 / 401 能拿到**真实状态码**（用来区分「私有仓库」与「索引写坏了」）。
 */
export async function fetchMarketIndex(url: string): Promise<MarketParseResult> {
  const target = url.trim()
  if (!/^https?:\/\//i.test(target)) {
    throw new Error(`索引地址必须是 http(s)：${target}`)
  }
  const resp = await invoke<NetResponse>('net_request', {
    req: { url: target, method: 'GET', timeoutMs: 20_000 },
  })
  if (resp.status !== 200) {
    const hint =
      resp.status === 401 || resp.status === 404
        ? '（私有仓库的 raw 地址匿名拉不到：把仓库设为公开，或在这里填一个可匿名访问的索引地址）'
        : ''
    throw new Error(`拉取市场索引失败：HTTP ${resp.status}${hint}`)
  }
  return parseMarketIndex(decodeBase64Utf8(resp.body_b64))
}

/**
 * 安装 / 更新一条市场条目。
 *
 * **下载、sha256 校验、解包都在 Rust**（`install_znp_from_url`）：任一步失败都不落盘。
 * 返回装好的插件 id；调用方负责重扫 + toast。
 */
export async function installFromMarket(root: string, entry: MarketEntry): Promise<string> {
  // 走**当前镜像**的包前缀（rev173.194）：索引里的 `url` 是打包时写死的 raw，
  // 在 raw 被 RST 的网络里「列表能看、装不下来」。换个前缀就跟着换源了。
  const mirror = loadMirror()
  return invoke<string>('install_znp_from_url', {
    vault: root,
    url: mirrorPackUrl(mirror, entry.url),
    expectedSha256: entry.sha256,
  })
}
