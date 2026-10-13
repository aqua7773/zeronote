/**
 * Android「所有文件访问」（`MANAGE_EXTERNAL_STORAGE`）—— **请求入口**。
 *
 * 为什么需要它（rev64 的真实教训）：把库放进**公共存储**（`/storage/emulated/0/…`）后，
 * 没有这个权限时应用只会报 `Permission denied (os error 13)` —— 而它是 Android 的
 * **特殊权限，系统不弹窗申请**，用户既不知道是哪个权限、也不知道该去哪开。
 * 这个模块把「去哪开」变成一次调用。
 *
 * 平台差异：**只在 Android 上真正跳转**；桌面调用是 no-op（Rust 侧直接返回 Ok），
 * 所以调用方不需要自己判断平台。
 */
import { invoke } from '@tauri-apps/api/core'

/** 打开系统的「所有文件访问」授权页（带 `package:` 直达本应用那一页；个别 ROM 会退化成总列表页）。 */
export async function requestAllFilesAccess(): Promise<void> {
  await invoke('plugin:androidperm|request_all_files_access')
}

/**
 * 这条错误看起来是不是「缺所有文件访问权限」？
 *
 * 判据来自实测：库在公共存储、权限未授时，读文件报的是
 * `读取插件文件失败 … Permission denied (os error 13)`（Android errno 13 / EACCES）。
 * 用它把"普通读失败"和"该去授权"分开 —— 后者要给用户一条明确的路，而不是干瞪眼。
 */
export function looksLikeStoragePermissionError(message: unknown): boolean {
  const m = String(message ?? '')
  return /Permission denied/i.test(m) || /os error 13/i.test(m) || /EACCES/i.test(m)
}
