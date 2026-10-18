/**
 * 插件分类（rev173.4 · 2026-10-18 用户「插件越来越多了，开始做插件分类存放」）。
 *
 * 分类只是**插件页的展示分组**，不影响加载、安装路径与权限 ——
 * 插件文件仍然平铺在 `.zn/plugins/<id>/`（改目录会动到 `.znp` 安装、跨库、删除那一整套）。
 *
 * 优先用 manifest 里显式声明的 `category`；没写的（第三方插件、老插件）按下面的规则推断。
 */

/** 插件分类。顺序即插件页的展示顺序（编辑 → 阅读 → 主题 → 工具 → 示例）。 */
export type PluginCategory = 'editor' | 'reader' | 'theme' | 'tool' | 'demo'

export const PLUGIN_CATEGORY_ORDER: PluginCategory[] = [
  'editor',
  'reader',
  'theme',
  'tool',
  'demo',
]

/** 分组标题（人话；插件页直接用） */
export const PLUGIN_CATEGORY_LABEL: Record<PluginCategory, string> = {
  editor: '编辑增强',
  reader: '阅读',
  theme: '主题外观',
  tool: '工具',
  demo: '示例与探针',
}

export const PLUGIN_CATEGORY_HINT: Record<PluginCategory, string> = {
  editor: '给编辑器加能力：标记、大纲、灵感流、索引…',
  reader: '打开库里的只读文档（PDF / EPUB / …）',
  theme: '只改外观：配色、字体、圆角，不掺功能',
  tool: '日常操作：新建、导入导出、加密存储…',
  demo: '示例插件与验收探针（可以随时关掉或删掉）',
}

const CATEGORIES = new Set<string>(PLUGIN_CATEGORY_ORDER)

export function isPluginCategory(v: unknown): v is PluginCategory {
  return typeof v === 'string' && CATEGORIES.has(v)
}

/**
 * 判断一个插件归到哪一类。
 *
 * 显式 `category` 优先；否则按「形状 + 名字」推断：
 *  · 只有 `styles`、没有 `entry` ⇒ 主题（纯 CSS 插件，见 examples/theme-sepia）；
 *  · id 带 demo / probe / hello / test… ⇒ 示例与探针；
 *  · 其余按关键词猜（theme / reader / editor），猜不出来归工具。
 * 推断只是**兜底**：想让插件固定在某组，就在 manifest 里写 `category`。
 */
export function categorizePlugin(m: {
  id: string
  name?: string
  category?: unknown
  styles?: string[]
  entry?: string
}): PluginCategory {
  if (isPluginCategory(m.category)) return m.category
  const id = m.id.toLowerCase()
  // 纯样式插件 = 主题（最常见的一类老插件，形状判断比名字可靠）
  if (!m.entry && (m.styles?.length ?? 0) > 0) return 'theme'
  if (/(demo|probe|hello|example|sample|playground)/.test(id)) return 'demo'
  if (/(theme|skin)/.test(id)) return 'theme'
  if (/(reader|pdf|epub)/.test(id)) return 'reader'
  if (/(editor|mark|outline|mindmap|inspiration|tag|index)/.test(id)) return 'editor'
  return 'tool'
}
