/**
 * 插件来源解析（2026-10-17 rev94 引入两处根；2026-10-18 rev173.5 **取消库内插件**）
 *
 * rev173.5 起**只有一处**：全局根（`appDataDir()/.zn/plugins/`）。
 * 用户：「取消库内插件这种形式，所有插件都是全局的」。
 * 于是：切库不掉插件、每个库不再各自存一份；装在库内 `.zn/plugins/` 的旧副本
 * 由迁移脚本搬进全局根（见 `scripts/plugin-migrate-global.mjs`）。
 *
 * 为什么全局根**不新增 Rust 命令**：`list_plugins` / `read_plugin_file` / `delete_plugin` /
 * `plugin_store_*` 的路径全是 `private_root(vault).join(".zn/plugins/<id>")` ——
 * 把 `appDataDir()` 当 `vault` 传进去，算出来的就是 `<appDataDir>/.zn/plugins/<id>`。
 * Rust 只做路径数学，不关心传进来的是不是"真库"。少改一处内核 = 少一次全量编译
 * 与一整类回归风险。
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

/**
 * 收集本代要加载的插件条目：**只有全局根**（rev173.5）。
 *
 * 全局根读失败 ⇒ 返回空列表（不让"全局目录不存在"拖垮整个插件系统），
 * 但**必须把失败原因交出去**（rev173.41）：静默返回空数组时，用户只看到
 * 「插件全没了」，没有任何线索；插件页的 `pluginError` 就是这条通道。
 *
 * 首次运行时全局目录不存在是**正常状态**（还没有插件），所以错误只在
 * 真正读目录失败时上报 —— 由 Rust 的 `list_plugins` 区分（目录不存在返回空表）。
 */
export async function collectPluginDirs(
  onError?: (msg: string) => void,
): Promise<PluginDirEntry[]> {
  let root: string
  try {
    root = await globalPluginRoot()
  } catch (e) {
    onError?.(`插件根目录解析失败：${String(e)}`)
    return []
  }
  const dirs = await listPluginDirs(root).catch((e: unknown) => {
    onError?.(`读取插件目录失败（${root}）：${String(e)}`)
    return [] as string[]
  })
  return dirs.map((dir) => ({ dir, root, source: 'global' }))
}
