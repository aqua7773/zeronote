/**
 * 本地媒体 URL（rev173.240）—— **Android 上 `<video>` / `<audio>` 走它**。
 *
 * 为什么要有这一层（一手依据）：
 *  · 桌面：Tauri 的 asset 协议在 Rust 侧实现（`tauri-2.12.3/src/protocol/asset.rs`），
 *    解析 `Range` → 206 + `Content-Range`，`<video>` 能正常 seek ⇒ 用 asset 协议就够。
 *  · Android：asset 协议走 wry 的 `shouldInterceptRequest`
 *    （`wry-0.55.1/src/android/kotlin/RustWebViewClient.kt:26`），返回的
 *    `WebResourceResponse` **没有 206 分片** ⇒ 大文件 `readyState` 永远 0（tauri#12019）。
 *    对策是内核在 `127.0.0.1` 起一个只读媒体服务（`src-tauri/src/media_server.rs`），
 *    这里负责把绝对路径拼成它的 URL。
 *
 * 时序：服务要等 App 初始化时调 `media_server_start` 才有 `{port, token}`；
 * 在那之前 `mediaServerUrl()` 返回 null，调用方回落到 asset URL，服务就绪后
 * App 递增 `mediaEpoch` 让编辑器重跑一遍媒体重写（见 `MarkdownEditor` 的 `mediaEpoch`）。
 */

type MediaServerInfo = { port: number; token: string }

let server: MediaServerInfo | null = null

/** 设服务信息（`null` = 停用 / 非 Android）。参数不合法时按"没启动"处理，不抛错。 */
export function setMediaServer(info: MediaServerInfo | null | undefined): void {
  if (!info || !Number.isFinite(info.port) || info.port <= 0 || !info.token) {
    server = null
    return
  }
  server = { port: info.port, token: info.token }
}

/** 当前服务信息（诊断 / CDP 实测用） */
export function mediaServerInfo(): MediaServerInfo | null {
  return server ? { ...server } : null
}

/**
 * 绝对路径 → 本地媒体服务 URL；服务没起时返回 null（调用方回落 asset 协议）。
 *
 * 整段 `encodeURIComponent`：`/` 会被编码成 `%2F`，但 Rust 侧 `percent_decode`
 * 会还原（同一套解码在 `assets.rs` 的 relink 里已用过）—— 不用尖括号/空格做特判。
 */
export function mediaServerUrl(absPath: string): string | null {
  if (!server) return null
  const p = (absPath ?? '').replace(/\\/g, '/')
  if (!p) return null
  return `http://127.0.0.1:${server.port}/m/${server.token}/${encodeURIComponent(p)}`
}

/**
 * 媒体 src 的最终形态：能走本地服务就走，否则交给调用方（`convertFileSrc` 的 asset 协议）。
 *
 * 返回 `{ url }` 表示已解决；返回 `null` 表示"该用 asset 协议"。
 */
export function mediaHttpUrl(absPath: string): string | null {
  return mediaServerUrl(absPath)
}
