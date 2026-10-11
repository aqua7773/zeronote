import { invoke } from '@tauri-apps/api/core'

/**
 * 多库（应用内）—— 移动端专用。
 *
 * 背景：Tauri 在 Android 上**没有目录选择器**（`dialog.open({ directory: true })`
 * 在移动端源码级返回 `FolderPickerNotImplemented`），所以手机端不能像桌面那样
 * 挑任意文件夹。改成应用内管理：
 *
 *   默认库 = 库根（`Documents/ZeroNote`，现有内容原地不动）
 *   其它库 = 库根下的 `.vaults/<名字>/`
 *
 * `.vaults` 刻意以 `.` 开头 —— Rust 的 `collect()` 会跳过所有 `.` 开头的名字，
 * 所以容器里的库不会串进默认库的文件树。**与 Rust 侧 `VAULTS_DIR` 必须一致。**
 */
export const VAULTS_DIR = '.vaults'

/** 列出库根下的其它库（名字，已排序）；容器不存在时返回空表 */
export function listOtherVaults(root: string): Promise<string[]> {
  return invoke<string[]>('list_vaults', { root })
}

/** 库名（`null` = 默认库）→ 绝对路径 */
export function vaultPathOf(root: string, name: string | null): string {
  return name ? `${root}/${VAULTS_DIR}/${name}` : root
}

/** 绝对路径 → 库名（不在容器里视为默认库，返回 `null`） */
export function vaultNameOf(root: string, path: string): string | null {
  const prefix = `${root}/${VAULTS_DIR}/`
  if (!path.startsWith(prefix)) return null
  return path.slice(prefix.length).replace(/\/+$/, '')
}

/** 新建库时的名字校验：非空、不太长、不含路径分隔符、不以 `.` 开头 */
export function isValidVaultName(name: string): boolean {
  const n = name.trim()
  return n.length > 0 && n.length <= 40 && !/[\\/]/.test(n) && !n.startsWith('.')
}
