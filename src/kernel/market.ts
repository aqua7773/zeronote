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
import { compareVersions } from './builtin-plugins'

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
  return invoke<string>('install_znp_from_url', {
    vault: root,
    url: entry.url,
    expectedSha256: entry.sha256,
  })
}
