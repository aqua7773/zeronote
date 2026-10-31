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
export async function checkAppUpdate(): Promise<UpdateCheck> {
  return invoke<UpdateCheck>('check_app_update')
}

/**
 * 桌面：下载并安装。
 *
 * ⚠️ Windows 上**不会正常返回**：官方 updater 在起安装器之前就退出进程
 * （安装器接管）。调用方把「进度 finished」当成终点，别再等这个 Promise 做 UI 收尾。
 */
export async function installDesktopUpdate(
  mirrorId: string,
  onProgress: (p: UpdateProgress) => void,
): Promise<void> {
  const channel = new Channel<ProgressEvent>()
  channel.onmessage = (e) => {
    if (e.event === 'progress') {
      onProgress({ downloaded: e.data.downloaded, total: e.data.total })
    }
  }
  await invoke('install_desktop_update', { mirrorId, onEvent: channel })
}

/**
 * Android：把 APK 下到缓存目录，返回落盘路径。
 *
 * `mirrors` 里是备用地址（ghproxy 前缀版）—— raw / GitHub Release 在国内手机网络上
 * 经常连不上，Rust 侧会逐个试。
 */
export async function downloadAndroidUpdate(
  update: AppUpdate,
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
