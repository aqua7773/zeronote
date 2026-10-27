/**
 * **插件版本回滚**（rev173.230 · 需求 §2.14）—— Rust 两个命令的薄封装 + 文案。
 *
 * 磁盘形态（Rust 侧 `lib.rs` 的「插件版本存档 / 回滚」一节）：
 *  · `<应用数据目录>/.zn/plugin-versions/<id>/<stamp>/` —— 装新版前的旧目录整份存档，保留最近 3 份；
 *  · `<应用数据目录>/.zn/plugin-versions/<id>/_backup/` —— 回滚前对当前 `store.json` 的备份，保留 10 份。
 *
 * 这里**不缓存**任何东西：版本列表随列表页打开现查，回滚完再查一次 ——
 * 缓存一写就多一类「界面显示 3 份、磁盘只剩 2 份」的错觉（硬约束 4）。
 */
import { invoke } from '@tauri-apps/api/core'

/** 一份历史版本存档（对应磁盘上一个 `<stamp>/` 目录） */
export type PluginVersionEntry = {
  /** 存档目录名（`<version>-<ms>`）—— 回滚时原样传回 Rust */
  stamp: string
  version: string
  name: string
  /** 存档时刻（毫秒；取目录名尾部的时间戳，不是文件 mtime） */
  installedAt: number
  sizeBytes: number
  /** manifest 的 `storeVersion`（数据格式代际；没声明 = null） */
  storeVersion: number | null
  /** 存档里有没有该版本当时的 `store.json` */
  hasStore: boolean
}

/** `list_plugin_versions` 的返回：当前版本 + 历史存档（按时间倒序） */
export type PluginVersionsState = {
  current: {
    version: string
    name: string
    storeVersion: number | null
    hasStore: boolean
  } | null
  versions: PluginVersionEntry[]
}

/** 回滚结果：`ok` = 已换回旧版；`needConfirm` = 要用户拍板（**磁盘没动**） */
export type RollbackResult =
  | {
      status: 'ok'
      fromVersion: string
      toVersion: string
      /** 回滚前当前 store.json 的备份路径（没有 store 时为 null） */
      dataBackup: string | null
      /** 数据是否被换成该版本存档里的快照 */
      storeRestored: boolean
      warning: string | null
    }
  | {
      status: 'needConfirm'
      fromVersion: string
      toVersion: string
      /** 为什么需要确认（代际降级的说明） */
      reason: string
      dataBackup: string | null
    }

/** 列出某个插件的历史版本（`root` = 全局插件根，`appDataDir()`） */
export async function listPluginVersions(
  root: string,
  pluginId: string,
): Promise<PluginVersionsState> {
  return invoke<PluginVersionsState>('list_plugin_versions', { vault: root, pluginId })
}

/**
 * 回滚到某份存档。
 *
 * `force: false`（缺省）时，若目标版本的数据代际更低，返回 `needConfirm` 且**不改磁盘**；
 * 用户确认后带 `force: true` 再调一次即可。
 */
export async function rollbackPlugin(
  root: string,
  pluginId: string,
  stamp: string,
  force = false,
): Promise<RollbackResult> {
  return invoke<RollbackResult>('rollback_plugin', { vault: root, pluginId, stamp, force })
}

/** 字节数 → 人看的 `12.3 KB`（版本对话框里显示存档体积） */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${i === 0 ? String(Math.round(v)) : v.toFixed(1)} ${units[i]}`
}

/** 存档时刻 → `2026-10-28 04:12`（本地时区；时间戳缺失给 `—`） */
export function formatVersionTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
