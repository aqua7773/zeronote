/**
 * 插件来源解析 —— 「装一次，所有笔记库都能用」（2026-10-17 rev94）
 *
 * 两个根：
 *  - **全局根**：`appDataDir()`（桌面 `%APPDATA%\com.aqua.zeronote`，Android 应用私有目录）。
 *    插件目录 = `<appDataDir>/.zn/plugins/` —— 与库无关，切库不掉插件。
 *  - **库根**：当前库自己（`<库>/.zn/plugins/`）。库位于 `<根>/.vaults/<名字>/` 时，
 *    Rust 的 `private_root()` 已经把它上提到库根，于是同一个多库容器里的库共用一份
 *    （Android 的既有行为，不变）。
 *
 * 为什么全局根**不新增 Rust 命令**：`list_plugins` / `read_plugin_file` / `delete_plugin` /
 * `plugin_store_*` 的路径全是 `private_root(vault).join(".zn/plugins/<id>")` ——
 * 把 `appDataDir()` 当 `vault` 传进去，算出来的就是 `<appDataDir>/.zn/plugins/<id>`。
 * Rust 只做路径数学，不关心传进来的是不是"真库"。少改一处内核 = 少一次全量编译
 * 与一整类回归风险。
 *
 * **冲突规则**：同一个目录名两处都有 ⇒ **库内那份优先**（更具体，像"这个库特意覆盖"）。
 * 被覆盖的全局那份不加载、也不在插件页出现第二行 —— 一个插件一个开关。
 */
import { appDataDir } from '@tauri-apps/api/path'
import { listPluginDirs, type PluginDirEntry } from './plugin-host'

let cachedGlobalRoot: string | null = null

/** 全局插件根（`appDataDir()`）。拿不到就抛，由调用方决定降级方式。 */
export async function globalPluginRoot(): Promise<string> {
  if (!cachedGlobalRoot) {
    const dir = await appDataDir()
    // 去掉尾部斜杠：后面还要 join，避免出现 `C:\x\\.zn` 这种重复分隔
    cachedGlobalRoot = dir.replace(/[\\/]+$/, '')
  }
  return cachedGlobalRoot
}

/** 给 UI 展示用：拿不到全局根时返回 null（插件页显示"未知"而不是弹错） */
export async function tryGlobalPluginRoot(): Promise<string | null> {
  try {
    return await globalPluginRoot()
  } catch {
    return null
  }
}

/** 路径归一化（只用于判"两个根是不是同一个"，不用于发命令） */
function normRoot(p: string): string {
  return p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
}

/**
 * 收集本代要加载的插件条目：**库内 + 全局**，按目录名去重（库内优先）。
 *
 * 全局根读失败 ⇒ 只返回库内插件（不让"全局目录不存在"拖垮整个插件系统）。
 */
export async function collectPluginDirs(vault: string): Promise<PluginDirEntry[]> {
  const out: PluginDirEntry[] = []
  const seen = new Set<string>()

  const vaultDirs = await listPluginDirs(vault)
  for (const dir of vaultDirs) {
    seen.add(dir)
    out.push({ dir, root: vault, source: 'vault' })
  }

  let globalRoot: string | null = null
  try {
    globalRoot = await globalPluginRoot()
  } catch {
    return out
  }
  // 极端情况：全局根与当前库是同一个目录（用户把库设成了 appDataDir）—— 别扫两遍
  if (normRoot(globalRoot) === normRoot(vault)) return out

  const globalDirs = await listPluginDirs(globalRoot).catch(() => [] as string[])
  for (const dir of globalDirs) {
    if (seen.has(dir)) continue // 库内优先：同名全局插件被覆盖
    out.push({ dir, root: globalRoot, source: 'global' })
  }
  return out
}
