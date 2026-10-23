import { invoke } from '@tauri-apps/api/core'

/**
 * **内置插件**（2026-10-17；2026-10-18 rev173.5 起只写全局根）。
 *
 * 用户反馈：安卓上插件目录在应用私有空间，用户没法像桌面那样自己拷 ——
 * 「安卓插件能不能不用自己一道目录，而是默认放在目录，要安装其他插件的时候再自己添加到目录里面」。
 *
 * 做法：把常用插件的源码用 vite 的 `?raw` **打进前端包**，App 启动时通过
 * `write_plugin_file` 写进**全局插件根**（`appDataDir()/.zn/plugins/<id>/`，已存在则覆盖为内置版本）。
 * 用户之后要装别的插件，仍然是往同一个目录里加（桌面/安卓一致、所有库共用）。
 *
 * ⚠️ 只打包**运行必需**的文件（index.js / manifest.json / 样式），不带 selftest / store。
 */

// outline-map（大纲 · 导图）
import outlineMapIndex from '../../examples/outline-map/index.js?raw'
import outlineMapManifest from '../../examples/outline-map/manifest.json?raw'
import outlineMapCss from '../../examples/outline-map/outline.css?raw'
// doc-reader（文档阅读器）
import docReaderIndex from '../../examples/doc-reader/index.js?raw'
import docReaderManifest from '../../examples/doc-reader/manifest.json?raw'
// import-export（导入导出）
import importExportIndex from '../../examples/import-export/index.js?raw'
import importExportManifest from '../../examples/import-export/manifest.json?raw'
// inspiration-flow（灵感流）—— **已搁置**（rev173.35 · 2026-10-19 用户要求）：源码留在 examples/，不再预装
// theme-sepia（米色主题，纯 CSS）
import sepiaManifest from '../../examples/theme-sepia/manifest.json?raw'
import sepiaCss from '../../examples/theme-sepia/theme.css?raw'
// accounting（记账：通知捕获 + 自动分类，2026-10-19 rev173.16）
import accountingIndex from '../../examples/accounting/index.js?raw'
import accountingManifest from '../../examples/accounting/manifest.json?raw'
// tag-panel（标签面板，2026-10-23 rev173.93）
import tagPanelIndex from '../../examples/tag-panel/index.js?raw'
import tagPanelManifest from '../../examples/tag-panel/manifest.json?raw'

type BuiltinPlugin = { id: string; files: Record<string, string> }

export const BUILTIN_PLUGINS: BuiltinPlugin[] = [
  {
    id: 'outline-map',
    files: {
      'index.js': outlineMapIndex,
      'manifest.json': outlineMapManifest,
      'outline.css': outlineMapCss,
    },
  },
  { id: 'doc-reader', files: { 'index.js': docReaderIndex, 'manifest.json': docReaderManifest } },
  {
    id: 'import-export',
    files: { 'index.js': importExportIndex, 'manifest.json': importExportManifest },
  },
  { id: 'theme-sepia', files: { 'manifest.json': sepiaManifest, 'theme.css': sepiaCss } },
  {
    id: 'accounting',
    files: { 'index.js': accountingIndex, 'manifest.json': accountingManifest },
  },
  {
    id: 'tag-panel',
    files: { 'index.js': tagPanelIndex, 'manifest.json': tagPanelManifest },
  },
]

/**
 * 把内置插件写进当前库的私有插件目录。
 *
 * 幂等：每次都覆盖为内置版本（保证升级后代码一致）；用户自己加的插件不受影响。
 * 单个文件失败只警告、不中断（少一个图标样式不该让整个 App 起不来）。
 */
/**
 * 把内置插件写进**全局插件根**（`root` = `appDataDir()`；rev173.5 起插件只有全局一处）。
 * 幂等：内容一样就跳过（原因见下面的注释）。
 *
 * 返回值 = 写失败的文件清单（rev173.41）。以前失败只 `console.warn` ——
 * 用户看到的是「导图 / 阅读器 / 记账莫名没了」，没有任何线索；调用方据此出提示。
 */
export async function ensureBuiltinPlugins(
  root: string,
): Promise<{ failed: { pluginId: string; rel: string; error: string }[] }> {
  const failed: { pluginId: string; rel: string; error: string }[] = []
  for (const plugin of BUILTIN_PLUGINS) {
    for (const [rel, content] of Object.entries(plugin.files)) {
      try {
        /**
         * **幂等**：内容一样就不写（rev137）。
         *
         * 原先无条件覆盖 ⇒ 每次启动/每次插件重载都改写 18 个文件。dev 下这些文件在项目树内，
         * watcher 会当成源码变化 ⇒ HMR ⇒ React Refresh 重放 effect ⇒ 插件加载链重跑 ⇒
         * 再写一遍 —— 形成每 ~6 秒一轮的循环（主题样式每轮消失几百毫秒 = 闪深色）。
         * 内容比较能让「没变化」的启动完全静默；真正的升级/首次安装照常写入。
         */
        try {
          const cur = await invoke<string>('read_plugin_file', {
            vault: root,
            pluginId: plugin.id,
            rel,
          })
          if (cur === content) continue
        } catch {
          /* 文件不存在 / 读失败 ⇒ 走写入 */
        }
        await invoke('write_plugin_file', { vault: root, pluginId: plugin.id, rel, content })
      } catch (e) {
        failed.push({ pluginId: plugin.id, rel, error: String(e) })
        console.warn(`[zn] 内置插件 ${plugin.id}/${rel} 写入失败`, e)
      }
    }
  }
  return { failed }
}
