/**
 * 「最近打开过的库 / 最近用过的命令」持久化 —— 从 `App.tsx` 原样迁出（rev122 · L1）。
 *
 * 都走 localStorage，**配额不足 / 隐私模式下写不进不影响调用方**（读失败返回空表）。
 */
import { invoke } from '@tauri-apps/api/core'

/** 命令面板的「最近使用」——持久化，重启后依然置顶（上限 8 条） */
export const LS_RECENT_CMDS = 'zeronote.commands.recent'
export const RECENT_CMDS_MAX = 8
/** 最近打开过的库（侧栏底部的「切换笔记库」菜单用；上限 8 条，最近在前） */
const LS_RECENT_VAULTS = 'zeronote.vaults.recent'
export const RECENT_VAULTS_MAX = 8

export function loadRecentVaults(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_RECENT_VAULTS) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_VAULTS_MAX)
  } catch {
    return []
  }
}

/** 写回「最近打开过的库」（配额不足 / 隐私模式下写不进也不影响调用方） */
export function persistRecentVaults(list: string[]): void {
  try {
    localStorage.setItem(LS_RECENT_VAULTS, JSON.stringify(list))
  } catch {
    /* 存不下就算了 —— 本次照常展示，只是重启后可能回到旧值 */
  }
}

/**
 * 库目录是否**仍然存在**（Rust 侧只读探测，什么都不建）。
 *
 * 失败时保守返回 `true`：宁可留着一条过期记录，也不要误删用户的库记录
 * —— 老内核没有这条命令、浏览器预览里也没有。
 */
export async function vaultExists(dir: string): Promise<boolean> {
  try {
    return await invoke<boolean>('vault_exists', { vault: dir })
  } catch {
    return true
  }
}

export function loadRecentCommands(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(LS_RECENT_CMDS) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_CMDS_MAX)
  } catch {
    return []
  }
}
