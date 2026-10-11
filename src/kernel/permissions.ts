/**
 * 授权记录 —— `net` 授权通道（契约 §4）
 *
 * 存放位置：`<私有根>/.zn/permissions.json`，结构 `{ "<pluginId>": ["net"] }`。
 *
 * ⚠️ **这不是隔离，是一条可绕过的边界。** 插件跟宿主跑在同一个 JS 上下文里，
 * 至少有三条路不经过这张表：
 *   ① `globalThis.fetch` / `XMLHttpRequest` / `WebSocket`（宿主从不碰这些 API，拦不住）
 *   ② ESM 静态 `import`（`examples/cdn-import` 就是靠这条联网的）
 *   ③ 直接 `invoke('write_note', …)` —— Rust 的 12 个命令经 Tauri IPC 全局可达
 * 它兑现的是**知情与承诺**：用户在设置页明确为某个插件开了网，宿主据此
 * 拒绝加载"没被开过"的插件；作者也少一个"我声明了却跑不起来"的坑。
 * **别把它当沙箱**，详见 `docs/内核契约-v0.1.md` §4。
 */
import { invoke } from '@tauri-apps/api/core'

/** 插件 id → 已授权的 capability 列表 */
export type PermissionTable = Record<string, string[]>

/** 能走授权通道的项：契约 §4 里「默认拒」的两项 */
export const GRANTABLE_CAPABILITIES = ['net', 'proc'] as const
export type GrantableCapability = (typeof GRANTABLE_CAPABILITIES)[number]

export async function readPermissions(vault: string): Promise<PermissionTable> {
  return invoke<PermissionTable>('read_permissions', { vault })
}

/**
 * 授权 / 撤销一项，返回**最新全表**。
 *
 * 合并逻辑在 Rust 侧一次做完（原子读改写）⇒ 前端不必自己合表，
 * 两个开关先后点也不会互相覆盖。
 */
export async function setPermission(
  vault: string,
  pluginId: string,
  capability: GrantableCapability,
  granted: boolean,
): Promise<PermissionTable> {
  return invoke<PermissionTable>('set_permission', { vault, pluginId, capability, granted })
}

/** 查表：这个插件的这项能力被授权了吗（缺省 = 没授权） */
export function isGranted(table: PermissionTable, pluginId: string, capability: string): boolean {
  return (table[pluginId] ?? []).includes(capability)
}
