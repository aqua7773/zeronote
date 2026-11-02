/**
 * 「更多 → 插件」组的条目来源（rev173.331 · 真人测试7 #2）。
 *
 * 用户原话：「移动端右边侧栏，插件那栏，装了导出导入和同步，但是同步插件不显示在侧栏中」。
 *
 * 旧的 App.tsx 写死了两个插件 id（`tag-panel` / `import-export`）——
 * `sync` 的面板挂在 `main`，于是手机端「更多 → 插件」里看不到它；而手机没有常驻侧栏
 * （左抽屉的 `SidebarPlugins` 也不渲染），插件在移动端**等于没有入口**。
 *
 * 现在按「注册了可当页面的面板」自动列：新插件不用再改宿主代码。
 * 抽成纯函数是为了能直接测这条判定（面板位置 / hidden / 副标题回落）。
 */
/** 面板挂载位置（与 `kernel/contract.ts` 的 `PanelLocation` **同一组字面量**）
 *
 * 为什么不直接 import 那个类型：`lib/` → `kernel/` 是反向依赖，`scripts/check-gates.mjs`
 * 的「依赖方向」门会红（实测踩过）。这里只需要读 `location`，复制字面量集合就够了；
 * 两边不一致时 TS 会在 App 的传参处报错（结构类型不兼容），不会静默错。
 */
export type PanelLocationLike =
  | 'sidebar'
  | 'main'
  | 'statusbar'
  | 'modal'
  | 'editor-toolbar'
  | 'editor-topbar'

/** 面板的最小形状（只取判定要用的字段，方便测试造数据） */
export type PanelLike = {
  id: string
  title: string
  location: PanelLocationLike
  pluginId?: string
  hidden?: boolean
}

/**
 * 能当「入口页」打开的挂载位置。
 *
 * 排除 `statusbar`（常驻小部件）、`modal`（弹窗）、`editor-toolbar` / `editor-topbar`
 * （编辑器里的工具条）—— 它们不是"点一下打开一个页面"的东西。
 */
export const PLUGIN_PAGE_LOCATIONS: readonly PanelLocationLike[] = ['main', 'sidebar']

/** 已知插件的副标题（没登记的插件回落到「xxx 插件」） */
export const MORE_PLUGIN_HINTS: Record<string, string> = {
  'tag-panel': '按标签浏览',
  'import-export': '导入外部文件 / 导出笔记',
  sync: '同步状态与冲突处理',
}

export type MorePluginEntry = {
  /** React key（面板 id 唯一） */
  key: string
  label: string
  hint?: string
  /** 点开哪个面板 */
  panelId: string
}

export function pluginPanelEntries(
  panels: readonly PanelLike[],
  hints: Record<string, string> = MORE_PLUGIN_HINTS,
): MorePluginEntry[] {
  return panels
    .filter((p) => !p.hidden && PLUGIN_PAGE_LOCATIONS.includes(p.location))
    .map((p) => ({
      key: p.id,
      label: p.title,
      hint: hints[p.pluginId ?? ''] ?? (p.pluginId ? `${p.pluginId} 插件` : undefined),
      panelId: p.id,
    }))
}
