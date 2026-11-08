/**
 * 应用本体更新（rev173.292）—— 前端这一层只做三件事：判平台、控节流、转发进度。
 *
 * 真正的检查 / 下载 / 安装都在 Rust（`src-tauri/src/updates.rs`）：
 *  · 桌面要用官方 updater 的 **minisign 签名校验**（WebView 里没有）；
 *  · 手机要下几十 MB 的 APK 并起**系统安装器**（WebView 做不了，且官方 updater 不支持 Android）。
 *
 * ⚠️ 与「启动时检查插件更新」是两码事：那条只查**插件市场索引**的角标（`market.ts`），
 * 这条查的是**应用自身**的新版本。
 */

import { Channel, invoke } from '@tauri-apps/api/core'

/** 清单里的最新版本（Rust `AppUpdate`） */
export type AppUpdate = {
  version: string
  notes?: string | null
  pubDate?: string | null
  /** 安装包地址（桌面 = NSIS/MSI；Android = APK） */
  url: string
  /** 仅桌面：minisign 签名（`.sig` 文件内容） */
  signature?: string | null
  /** 仅 Android：整包 sha256 */
  sha256?: string | null
  size?: number | null
  /** 备用下载地址（ghproxy 等），「手动下载」时列出 */
  mirrors: string[]
}

/** 检查结果（Rust `UpdateCheck`）。`error` 有值 = 所有镜像都拉不到清单 */
export type UpdateCheck = {
  currentVersion: string
  hasUpdate: boolean
  remoteVersion?: string | null
  latest?: AppUpdate | null
  /** 命中的镜像 id（桌面安装要传回 Rust，保证检查与下载走同一镜像） */
  mirror: string
  error?: string | null
  /**
   * 安装包各条路径的**实测速度**（rev173.311，降序）。
   *
   * 「检查更新」时顺便测掉 —— 用户点「安装」直接用 `[0]`，不用再等一轮。
   * 空数组 = 没什么可测的（已是最新 / 本平台没发 / 清单拉不到）。
   */
  routes?: RouteProbe[]
}

/**
 * 一条安装包路径的测速结果（Rust `RouteProbe`）。
 *
 * 目前三条：`direct`（GitHub 直连，实测最快）、`ghproxy`、`gh-proxy-com`。
 * `bps` = 实测字节/秒，0 表示没测成。
 */
export type RouteProbe = {
  id: string
  label: string
  url: string
  ok: boolean
  ms: number
  bps: number
  detail: string
}

/** 下载进度 */
export type UpdateProgress = {
  downloaded: number
  total: number | null
}

/** Rust 侧 `Progress` 枚举的 channel 事件 */
type ProgressEvent =
  | { event: 'progress'; data: { chunk: number; downloaded: number; total: number | null } }
  | { event: 'finished' }

/** 上次检查的时间戳（毫秒）—— 24h 节流用 */
export const APP_UPDATE_LAST_CHECK_KEY = 'zn-app-update-last-check'
/** 「启动时检查应用更新」开关（`'0'` = 关；缺省 = 开） */
export const APP_UPDATE_AUTO_KEY = 'zn-app-update-auto'
/** 节流窗口 24 小时 —— 与插件市场的 24h 检查同一口径（`MARKET_CHECK_TTL_MS`） */
export const APP_UPDATE_TTL_MS = 24 * 60 * 60 * 1000

/** 当前是不是 Android（与 `App.tsx` 的 `platform` 同一判据：UA 里有 Android） */
export function isAndroidApp(): boolean {
  return /Android/i.test(navigator.userAgent)
}

/** 检查有没有新版本。网络失败不抛异常 —— 结果里的 `error` 会说明原因 */
export async function checkAppUpdate(mirrorId?: string): Promise<UpdateCheck> {
  return invoke<UpdateCheck>('check_app_update', { mirrorId: mirrorId ?? null })
}

/* ───── 更新渠道（rev173.300）：与插件市场同一套 id ───── */

/** 一条更新渠道（清单与安装包都按它路由；安装包的实际能力见 Rust `AssetRoute`） */
export type UpdateMirror = { id: string; label: string }

/**
 * 内置渠道。**id / label 与 `src-tauri/src/updates.rs` 的 `MIRRORS` 逐字一致**，
 * 也与插件市场 `MARKET_MIRRORS` 同序（raw 第一）。
 *
 * rev173.440（2026-11-08 用户拍板）：**渠道 = 完整源** —— 清单与安装包必须同源。
 * jsDelivr 三条已移除：它只镜像仓库文件，拿不到 GitHub Release 附件，还会缓存旧清单
 * （用户实测：jsDelivr 显示 v0.10.1、raw / Gitee 显示 v0.10.2）。
 * 剩下的每个渠道都能同时给出清单与安装包。
 */
export const UPDATE_MIRRORS: UpdateMirror[] = [
  { id: 'raw', label: 'GitHub raw' },
  { id: 'gitee', label: 'Gitee（国内直连）' },
  { id: 'ghproxy', label: 'ghproxy.net（第三方）' },
]

/** 选中的更新渠道存这里（与插件市场的 `zn-market-mirror` 分开存） */
export const APP_UPDATE_MIRROR_KEY = 'zn-app-update-mirror'

/** 当前渠道：存过且认识用存的，否则第一条（raw） */
export function loadUpdateMirror(): UpdateMirror {
  try {
    const id = window.localStorage.getItem(APP_UPDATE_MIRROR_KEY)?.trim() ?? ''
    return UPDATE_MIRRORS.find((m) => m.id === id) ?? UPDATE_MIRRORS[0]
  } catch {
    return UPDATE_MIRRORS[0]
  }
}

export function saveUpdateMirror(id: string): void {
  try {
    window.localStorage.setItem(APP_UPDATE_MIRROR_KEY, id)
  } catch {
    /* 存不下就只在本次会话生效 */
  }
}

/** 一条渠道的探测结果（Rust `PathProbe`） */
export type PathProbe = {
  id: string
  label: string
  ok: boolean
  ms: number
  /** 给人看的一句话（成功 = 版本 + 安装包大小；失败 = 原因） */
  detail: string
}

/** 测一条渠道：拉清单（桌面再 HEAD 一下安装包） */
export async function probeUpdateMirror(mirrorId: string): Promise<PathProbe> {
  return invoke<PathProbe>('probe_update_mirror', { mirrorId })
}

/**
 * 桌面：下载并安装。
 *
 * `assetUrl` = 检查阶段测出来的那条路径（`check.routes[0].url`，或用户手选的）。
 * 传了就**不再测速**，直接按它下 —— 用户点安装就该立刻开始。
 * 不传 / 传了个不被认的地址时，Rust 会自己再测一轮。
 *
 * ⚠️ Windows 上**不会正常返回**：官方 updater 在起安装器之前就退出进程
 * （安装器接管）。调用方把「进度 finished」当成终点，别再等这个 Promise 做 UI 收尾。
 */
export async function installDesktopUpdate(
  mirrorId: string,
  assetUrl: string | null,
  onProgress: (p: UpdateProgress) => void,
): Promise<void> {
  const channel = new Channel<ProgressEvent>()
  channel.onmessage = (e) => {
    if (e.event === 'progress') {
      onProgress({ downloaded: e.data.downloaded, total: e.data.total })
    }
  }
  await invoke('install_desktop_update', { mirrorId, assetUrl, onEvent: channel })
}

/**
 * Android：把 APK 下到缓存目录，返回落盘路径。
 *
 * 支持**断点续传**（rev173.311）：上次没下完的部分留在 `.part` 里，
 * 这次从断点接着下；换路径也会接着续（直连断了换 ghproxy 续）。
 *
 * `assetUrl` 同桌面：检查阶段选好的那条，省掉安装前再测一轮。
 */
export async function downloadAndroidUpdate(
  update: AppUpdate,
  assetUrl: string | null,
  onProgress: (p: UpdateProgress) => void,
): Promise<string> {
  const channel = new Channel<ProgressEvent>()
  channel.onmessage = (e) => {
    if (e.event === 'progress') {
      onProgress({ downloaded: e.data.downloaded, total: e.data.total })
    }
  }
  return invoke<string>('download_android_update', {
    url: update.url,
    mirrors: update.mirrors,
    sha256: update.sha256 ?? null,
    version: update.version,
    size: update.size ?? null,
    preferred: assetUrl,
    onEvent: channel,
  })
}

/** Android：有没有「安装未知应用」授权 */
export async function canInstallApk(): Promise<boolean> {
  try {
    return await invoke<boolean>('plugin:apk-install|can_install_apk')
  } catch {
    return false
  }
}

/** Android：起系统安装器。返回 true 只代表安装器已调起（用户点没点安装系统不回报） */
export async function installApk(path: string): Promise<boolean> {
  const r = await invoke<{ ok: boolean; started: boolean }>('plugin:apk-install|install_apk', {
    path,
  })
  return r.started
}

/** Android：跳到「安装未知应用」授权页 */
export async function openInstallSettings(): Promise<void> {
  await invoke('plugin:apk-install|open_install_settings')
}

/**
 * 取消后台仍在跑的 APK 下载（rev173.334 · 真人测试8 #2）。
 *
 * 面板关掉不会停下载，再点「继续下载」就会撞 Rust 的并发闸
 * （报「上一次下载还没结束」而旧任务还在涨进度）。点下载前先取消旧的。
 * 老应用包没有这条命令 ⇒ 调用方 catch 后照旧继续。
 */
export async function cancelApkDownload(): Promise<void> {
  await invoke('cancel_apk_download')
}

/** 启动静默检查开关（默认开） */
export function isAppAutoCheckEnabled(): boolean {
  try {
    return window.localStorage.getItem(APP_UPDATE_AUTO_KEY) !== '0'
  } catch {
    return true
  }
}

export function setAppAutoCheckEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(APP_UPDATE_AUTO_KEY, on ? '1' : '0')
  } catch {
    /* 存不下就只在本次会话生效 */
  }
}

/** 距上次检查满 24 小时了吗（且开关是开的）—— 启动时只问这一句 */
export function shouldAutoCheck(now: number = Date.now()): boolean {
  if (!isAppAutoCheckEnabled()) return false
  try {
    const raw = window.localStorage.getItem(APP_UPDATE_LAST_CHECK_KEY)
    const last = raw ? Number(raw) : 0
    return !Number.isFinite(last) || last <= 0 || now - last >= APP_UPDATE_TTL_MS
  } catch {
    return false
  }
}

/** 记下本次检查时间（无论成功与否都记 —— 否则断网时会每次启动都重试一遍） */
export function markChecked(now: number = Date.now()): void {
  try {
    window.localStorage.setItem(APP_UPDATE_LAST_CHECK_KEY, String(now))
  } catch {
    /* 同上 */
  }
}

/** 上次检查的时刻（毫秒；0 = 没查过） */
export function lastCheckedAt(): number {
  try {
    return Number(window.localStorage.getItem(APP_UPDATE_LAST_CHECK_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}

/* ───── 状态持久化（rev173.311） ─────
 *
 * 解决两个「白做一遍」：
 *  ① 关掉设置面板再打开 ⇒ 重新拉清单（这里存上次的检查结果）
 *  ② 下载完没点安装就切走 ⇒ 重新下 34 MB（Rust `find_downloaded_apk` 捡回缓存里的包）
 *
 * ⚠️ 存的是**展示用的结果**，不是信任凭据：真安装时 Android 还核 sha256、
 * 桌面还走 minisign。所以这里被手动改坏最多显示错个版本号，装不上。
 */

const APP_UPDATE_LAST_RESULT_KEY = 'zn-app-update-last-result'

/** 记下本次检查结果（打开面板时先拿它铺满界面，不必再等一轮网络） */
export function saveLastCheck(check: UpdateCheck): void {
  try {
    window.localStorage.setItem(
      APP_UPDATE_LAST_RESULT_KEY,
      JSON.stringify({ at: Date.now(), check }),
    )
  } catch {
    /* 存不下就只在本次会话生效 */
  }
}

/** 上次的检查结果；没有 / 坏掉 / 没有版本号 ⇒ null */
export function loadLastCheck(): UpdateCheck | null {
  try {
    const raw = window.localStorage.getItem(APP_UPDATE_LAST_RESULT_KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { at?: number; check?: UpdateCheck }
    // 没有 latest 的结果（「已是最新」或「查不到」）也能用，但至少要有版本号
    if (!v?.check?.currentVersion) return null
    return v.check
  } catch {
    return null
  }
}

/** 缓存目录里跟「这个版本」有关的 APK 状态（Rust `ApkCache`） */
export type ApkCache = {
  /** 已经下完的正式文件；空串 = 没有 */
  path: string
  /** 正式文件大小；0 = 没有 */
  size: number
  /** 半成品已下载的字节数；0 = 没有半成品（或属于别的版本） */
  partial: number
}

/**
 * Android：查「这个版本」的 APK 缓存状态。
 *
 * - `path` 非空 ⇒ 已经下完，直接进「安装」按钮
 * - `partial > 0` ⇒ 上次下到一半，点下载会从断点续
 *
 * 桌面恒为空（桌面更新由官方 updater 管，进程会被安装器接管）。
 */
export async function findApkCache(version: string): Promise<ApkCache> {
  const empty: ApkCache = { path: '', size: 0, partial: 0 }
  try {
    return (await invoke<ApkCache>('find_apk_cache', { version })) ?? empty
  } catch {
    return empty
  }
}

/** 字节/秒 → 人读的「1.2 MB/s」（路径测速结果用） */
export function fmtSpeed(bps: number | null | undefined): string {
  if (!bps || bps <= 0) return '—'
  const mb = bps / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`
  return `${Math.max(1, Math.round(bps / 1024))} KB/s`
}
