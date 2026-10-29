/**
 * **附件跨设备搬运**（rev173.238 · 附件同步期 4）。
 *
 * 链路（`docs/附件与同步-需求-2026-10-28.md` §5）：
 *   本地 → 云端临时 → 另一端落地 → 引用本地原文件 → 云端删除
 *   状态机：local → staged → landed → cleaned
 *
 * 触发是**用户主动 + 每次确认**（不自动搬）：启动 / 保存 / 定时 / 打开笔记都不搬。
 * 后端两种：`local-folder`（共享目录）· `webdav`；Git 不做（大文件炸历史）。
 *
 * 这里只放类型、IPC 包装与**纯函数**（状态判定 / 确认文案 / 大小汇总）——
 * 真正的搬运全在 Rust `assets.rs`（文件系统 + HTTP 在 WebView 里都不可靠）。
 */
import { invoke } from '@tauri-apps/api/core'
import { formatSize, isLocalAbsPath } from './attachment'

export type RelayBackend =
  | { kind: 'local-folder'; root: string }
  | { kind: 'webdav'; baseUrl: string; root: string; username: string }

export type RelayConfig = {
  version: number
  backend: RelayBackend | null
  hasPassword?: boolean
}

/** 本地可达的台账条目（`asset_relay_pending`） */
export type RelayPendingItem = {
  id: string
  original: string
  size: number
  storedInVault: string | null
  preview: string | null
  /** 本机可用源文件（优先入库副本，其次原文件） */
  localPath: string | null
  exists: boolean
  devices: Record<string, string | null>
  /** 本机上传过、云端临时区已清理（relay 链走完的终态标记）；从未走过为 null */
  relayCleanedAt?: number | null
}

/** 云端临时区里的一条（`asset_relay_remote`） */
export type RelayRemoteItem = {
  /** `sha256:` 之后的 16 位前缀（目录名） */
  hash16: string
  name: string
  size: number
  /** 对端已经落地 */
  acked: boolean
}

export type RelayUploadItemResult = {
  id: string
  ok: boolean
  size?: number
  name?: string
  error?: string
}

export type RelayUploadResult = {
  uploaded: number
  totalBytes: number
  items: RelayUploadItemResult[]
}

export type RelayLandItemResult = {
  id: string
  ok: boolean
  /** 落地后的**库内相对路径**（`external/<hash8>-<名>`） */
  path?: string
  /** 原文件绝对路径（改写引用时用） */
  original?: string
  error?: string
}

export type RelayLandResult = {
  landed: number
  totalBytes: number
  items: RelayLandItemResult[]
}

export type RelayRemoteResult = { items: RelayRemoteItem[]; total: number }

export type RelayCleanupResult = { cleaned: number; kept: number; errors: string[] }

export type RelayRelinkResult = { changedNotes: number; hits: number }

/** `sha256:abcd…` → `abcd…`（取前 16 位，与云端目录名一致） */
export function hash16Of(id: string): string {
  const hex = id.startsWith('sha256:') ? id.slice('sha256:'.length) : id
  return hex.slice(0, 16).toLowerCase()
}

/**
 * 一个文件现在的状态（**纯函数**，面板与测试共用）。
 *
 * - `absent`：本机与云端都没有（源文件被移走 / 删了、云端也清理了）
 * - `local`：本机有，云端没有 ⇒ 可以上传
 * - `staged`：云端有、对端还没落地 ⇒ 等对端
 * - `landed`：对端已落地（有 ack）⇒ 可以清理云端
 * - `pulled`：**本机**已经落地过（devices[本机] 有值），不需要再拉
 */
export type RelayState = 'absent' | 'local' | 'staged' | 'landed' | 'pulled'

export function relayStateOf(
  item: RelayPendingItem,
  remote: RelayRemoteItem[],
  deviceId: string | null,
): RelayState {
  const pulledHere = deviceId ? Boolean(item.devices?.[deviceId]) : false
  const hits = remote.filter((r) => r.hash16 === hash16Of(item.id))
  if (hits.some((r) => r.acked)) return pulledHere ? 'pulled' : 'landed'
  if (hits.length > 0) return pulledHere ? 'pulled' : 'staged'
  if (pulledHere) return 'pulled'
  return item.exists ? 'local' : 'absent'
}

/** 可以上传的（本机有、且云端还没有这份） */
export function uploadableIds(items: RelayPendingItem[], remote: RelayRemoteItem[], deviceId: string | null): string[] {
  return items
    .filter((it) => {
      const state = relayStateOf(it, remote, deviceId)
      return state === 'local'
    })
    .map((it) => it.id)
}

/** 可以接收的（云端有、本机还没落地） */
export function receivableIds(items: RelayPendingItem[], remote: RelayRemoteItem[], deviceId: string | null): string[] {
  return items
    .filter((it) => {
      const state = relayStateOf(it, remote, deviceId)
      return state === 'staged' || state === 'landed'
    })
    .map((it) => it.id)
}

/** 可以清理的（云端有、且对端已 ack） */
export function cleanable(remote: RelayRemoteItem[]): string[] {
  const set = new Set<string>()
  for (const r of remote) if (r.acked) set.add(r.hash16)
  return [...set]
}

/** 一组条目的总字节数 */
export function totalBytesOf(items: { size: number }[]): number {
  return items.reduce((sum, it) => sum + (Number.isFinite(it.size) ? it.size : 0), 0)
}

/**
 * 确认文案（需求 §5：每次触发前都要确认，且**点名 + 写体积**）。
 * `kind` 决定动词与语气：上传 / 接收 / 清理。
 */
export function confirmText(
  kind: 'upload' | 'land' | 'cleanup',
  items: { size: number; original?: string; name?: string }[],
): string {
  const count = items.length
  const bytes = totalBytesOf(items)
  if (kind === 'upload') {
    const names = items
      .slice(0, 3)
      .map((it) => it.original?.split(/[\\/]/).pop() ?? it.name ?? '')
      .filter(Boolean)
      .join('、')
    const more = count > 3 ? ` 等 ${count} 个` : ''
    return `即将把「${names}」${more}上传到云端临时区（共 ${formatSize(bytes)}），继续？`
  }
  if (kind === 'land') {
    return `即将从云端接收 ${count} 个文件（共 ${formatSize(bytes)}）并落地到本库，继续？`
  }
  return `即将删除云端临时区里的 ${count} 份文件（共 ${formatSize(bytes)}）—— 对端都已落地，删除后不再可取回。继续？`
}

/* ───────────── 正文入口的匹配（rev173.239 · 期 4 的两个正文入口）───────────── */

/**
 * 比对用路径规范化（**只用于匹配台账，不用于读文件**）。
 *
 * 三件事：剥尖括号目标（`![](<a b.mp4>)`）、解 `%xx`、`\` → `/`。
 * 不做大小写折叠 —— Android 的库路径区分大小写，折叠会把两个不同文件认成一个。
 */
export function normalizeRelayPath(path: string): string {
  let raw = (path ?? '').trim()
  if (raw.length >= 2 && raw.startsWith('<') && raw.endsWith('>')) raw = raw.slice(1, -1).trim()
  if (raw.includes('%')) {
    try {
      raw = decodeURIComponent(raw)
    } catch {
      /* 非法转义按原样用（文件名里本来就可能真有 %） */
    }
  }
  // `./` 前缀与反斜杠都是同一个文件的另一种写法（App 的 openLocalLink 也这么剥）
  return raw.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
}

/**
 * 正文里的**音视频源** → 台账条目（rev173.239）。
 *
 * 音视频超过 1 MiB 一律「引用原文件」⇒ 正文写的是**库外绝对路径**，台账 `original`
 * 是同一串（Rust `absolute_posix`）。所以按路径精确匹配即可。
 */
export function findEntryForMedia(
  items: RelayPendingItem[],
  raw: string,
): RelayPendingItem | null {
  const target = normalizeRelayPath(raw)
  if (!target) return null
  return items.find((it) => normalizeRelayPath(it.original) === target) ?? null
}

/**
 * 正文里的**库内相对路径**（模式 B 的压缩版 / 模式 A 的预览图）→ 台账条目（rev173.239）。
 *
 * 模式 B 的「同步原图」就靠它：正文引用的是压缩版，原图路径只在台账里。
 */
export function findEntryForStoredImage(
  items: RelayPendingItem[],
  relPath: string,
): RelayPendingItem | null {
  const target = normalizeRelayPath(relPath)
  if (!target) return null
  return (
    items.find(
      (it) =>
        (it.storedInVault && normalizeRelayPath(it.storedInVault) === target) ||
        (it.preview && normalizeRelayPath(it.preview) === target),
    ) ?? null
  )
}

/**
 * 本机的原图在哪（可直接喂 `convertFileSrc` 的绝对路径）；本机没有 ⇒ null。
 *
 * ⚠️ `devices[本机]` 有**两种写法**（Rust 侧决定的，别当成一种）：
 *  - 上传方：记的是**原文件绝对路径**（`D:/Music/a.mp3`）—— 这份文件本来就在本机；
 *  - 落地方：记的是**库内相对路径**（`.zn-assets/external/6ea73b45-a.mp3`）—— 从云端收下来的。
 * 直接拿它拼 `root + '/' + rel` 会把前一种拼成 `root/D:/...`（rev173.239 写第一版时差点踩）。
 */
export function localOriginalAbsPath(
  item: RelayPendingItem,
  deviceId: string | null,
  vaultRoot: string,
): string | null {
  const rel = deviceId ? item.devices?.[deviceId] : null
  if (!rel) return null
  const root = (vaultRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  // 盘符 / UNC / Unix 绝对 = 上传方记的绝对路径，原样用
  if (isLocalAbsPath(rel)) return rel.replace(/\\/g, '/')
  return root ? `${root}/${rel}` : null
}

/**
 * 「同步大文件」的确认文案（需求 §5 原文：「即将同步大文件「a.mp4」（52 MiB），继续？」）。
 *
 * 与面板的上传 / 接收文案分开：那两个是批量动作，这里是**单个文件、点名 + 体积**。
 */
export function syncConfirmText(item: { size: number; original?: string; name?: string }): string {
  const name =
    item.original?.split(/[\\/]/).pop() ?? item.name ?? '这个文件'
  return `即将同步大文件「${name}」（${formatSize(item.size)}），继续？`
}

/** 状态的中文标签（面板用） */
export function relayStateLabel(state: RelayState): string {
  switch (state) {
    case 'local':
      return '待上传'
    case 'staged':
      return '云端暂存 · 等对端'
    case 'landed':
      return '对端已落地 · 可清理'
    case 'pulled':
      return '已在本机'
    case 'absent':
      return '源文件不在本机'
  }
}

/* ───────────── IPC ───────────── */

export function loadRelayConfig(vault: string): Promise<RelayConfig> {
  return invoke<RelayConfig>('asset_relay_config', { vault })
}

export function saveRelayConfig(
  vault: string,
  backend: RelayBackend,
  password?: string | null,
): Promise<void> {
  return invoke('asset_relay_config_set', { vault, backend, password: password ?? null })
}

export function loadRelayPending(
  vault: string,
): Promise<{ deviceId: string; items: RelayPendingItem[] }> {
  return invoke('asset_relay_pending', { vault })
}

export function loadRelayRemote(vault: string): Promise<RelayRemoteResult> {
  return invoke<RelayRemoteResult>('asset_relay_remote', { vault })
}

export function uploadRelay(vault: string, ids: string[]): Promise<RelayUploadResult> {
  return invoke<RelayUploadResult>('asset_relay_upload', { vault, ids })
}

export function landRelay(vault: string, ids: string[]): Promise<RelayLandResult> {
  return invoke<RelayLandResult>('asset_relay_land', { vault, ids })
}

export function cleanupRelay(vault: string): Promise<RelayCleanupResult> {
  return invoke<RelayCleanupResult>('asset_relay_cleanup', { vault })
}

/** 把库内笔记里对 `from` 的引用改写成 `to`（库内相对路径） */
export function relinkRelay(vault: string, from: string, to: string): Promise<RelayRelinkResult> {
  return invoke<RelayRelinkResult>('asset_relay_relink', { vault, from, to })
}
