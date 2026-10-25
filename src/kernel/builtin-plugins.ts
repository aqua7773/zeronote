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
// backlinks（反向链接，2026-10-23 rev173.95）
import backlinksIndex from '../../examples/backlinks/index.js?raw'
import backlinksManifest from '../../examples/backlinks/manifest.json?raw'
// history（历史版本，2026-10-23 rev173.99）
import historyIndex from '../../examples/history/index.js?raw'
import historyManifest from '../../examples/history/manifest.json?raw'
// habit（打卡，2026-10-24 rev173.103）
import habitIndex from '../../examples/habit/index.js?raw'
import habitManifest from '../../examples/habit/manifest.json?raw'
// sync-folder（同步 · 本地文件夹，2026-10-24 rev173.107）
// 用户拍板「加入内置预装」（9 → 10）：库放同步目录的人开箱就能用，
// 判定与冲突副本全在插件里，内核只提供事件与 fs。
import syncFolderIndex from '../../examples/sync-folder/index.js?raw'
import syncFolderManifest from '../../examples/sync-folder/manifest.json?raw'
// sync-webdav（同步 · WebDAV，2026-10-24 rev173.108）
// 用户拍板「进预装」（10 → 11）：坚果云 / Nextcloud / 群晖直连，新手机不用手动装插件。
import syncWebdavIndex from '../../examples/sync-webdav/index.js?raw'
import syncWebdavManifest from '../../examples/sync-webdav/manifest.json?raw'
// sync-s3（同步 · S3 兼容，2026-10-25 rev173.121）
// 用户「逐项进行」里的第三个后端：AWS S3 / MinIO / R2 / B2 直连。与另两个同步插件并列预装（11 → 12）。
import syncS3Index from '../../examples/sync-s3/index.js?raw'
import syncS3Manifest from '../../examples/sync-s3/manifest.json?raw'
// sync-git（同步 · Git 类，2026-10-25 rev173.122）
// 第四个后端：GitHub / Gitea / Gitee 的 Contents API（sha 当乐观锁）。12 → 13。
import syncGitIndex from '../../examples/sync-git/index.js?raw'
import syncGitManifest from '../../examples/sync-git/manifest.json?raw'

type BuiltinPlugin = { id: string; files: Record<string, string> }

/**
 * 按 `x.y.z` 比较两个版本号（`1.10.0 > 1.9.0` —— 字符串比较在这里是错的）。
 * 返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相等。非数字段当 0（`0.2.0-beta` 与 `0.2.0` 同序）。
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .replace(/^[v^~>=<\s]+/, '')
      .split('.')
      .slice(0, 3)
      .map((p) => {
        const n = Number.parseInt(p, 10)
        return Number.isFinite(n) ? n : 0
      })
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/** 内置版本自带 `manifest.json` —— 从里面读 `version`（读不出返回 undefined，按"未知"处理） */
function builtinVersion(plugin: BuiltinPlugin): string | undefined {
  try {
    const v = JSON.parse(plugin.files['manifest.json'] ?? '')
    return typeof v?.version === 'string' ? v.version : undefined
  } catch {
    return undefined
  }
}

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
  {
    id: 'backlinks',
    files: { 'index.js': backlinksIndex, 'manifest.json': backlinksManifest },
  },
  {
    id: 'history',
    files: { 'index.js': historyIndex, 'manifest.json': historyManifest },
  },
  {
    id: 'habit',
    files: { 'index.js': habitIndex, 'manifest.json': habitManifest },
  },
  {
    id: 'sync-folder',
    files: { 'index.js': syncFolderIndex, 'manifest.json': syncFolderManifest },
  },
  {
    id: 'sync-webdav',
    files: { 'index.js': syncWebdavIndex, 'manifest.json': syncWebdavManifest },
  },
  {
    id: 'sync-s3',
    files: { 'index.js': syncS3Index, 'manifest.json': syncS3Manifest },
  },
  {
    id: 'sync-git',
    files: { 'index.js': syncGitIndex, 'manifest.json': syncGitManifest },
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
 *
 * **不覆盖的两种情况**（rev173.147，插件市场的前置修复）：
 *  · 目录里有 `signature.json` ⇒ 这是从市场 / 签名渠道装的，内置版本没有签名也无法签
 *    ⇒ 写下去就变成「内容与签名对不上 ⇒ 插件被拒载」。市场包装的东西让市场包管。
 *  · 已装版本**比内置新**（`compareVersions`）⇒ 当初写「覆盖为内置版本」时还没有市场渠道，
 *    现在有市场了，覆盖等于把用户装的更新版**偷偷回退**。
 * 其余情况（首装 / 内置更新 / 同版本内容不同）照旧覆盖：升级应用时内置插件要跟着走。
 */
export async function ensureBuiltinPlugins(root: string): Promise<{
  failed: { pluginId: string; rel: string; error: string }[]
  /** 被跳过、没动的插件（有签名 / 版本更新）—— 调用方可以只看 failed，这里便于测试与排障 */
  skipped: { pluginId: string; reason: 'signed' | 'newer' }[]
}> {
  const failed: { pluginId: string; rel: string; error: string }[] = []
  const skipped: { pluginId: string; reason: 'signed' | 'newer' }[] = []
  for (const plugin of BUILTIN_PLUGINS) {
    /**
     * **幂等**：内容一样就不写（rev137）。
     *
     * 原先无条件覆盖 ⇒ 每次启动/每次插件重载都改写 18 个文件。dev 下这些文件在项目树内，
     * watcher 会当成源码变化 ⇒ HMR ⇒ React Refresh 重放 effect ⇒ 插件加载链重跑 ⇒
     * 再写一遍 —— 形成每 ~6 秒一轮的循环（主题样式每轮消失几百毫秒 = 闪深色）。
     * 内容比较能让「没变化」的启动完全静默；真正的升级/首次安装照常写入。
     */
    const stale: string[] = []
    for (const [rel, content] of Object.entries(plugin.files)) {
      try {
        const cur = await invoke<string>('read_plugin_file', {
          vault: root,
          pluginId: plugin.id,
          rel,
        })
        if (cur === content) continue
      } catch {
        /* 文件不存在 / 读失败 ⇒ 算作要写 */
      }
      stale.push(rel)
    }
    if (stale.length === 0) continue

    // 有差异 ⇒ 先判断「该不该覆盖」（内容一致时一次额外 invoke 都不发，启动成本不变）
    if (await hasSignature(root, plugin.id)) {
      skipped.push({ pluginId: plugin.id, reason: 'signed' })
      continue
    }
    const installed = await readInstalledVersion(root, plugin.id)
    const builtin = builtinVersion(plugin)
    if (installed && builtin && compareVersions(installed, builtin) > 0) {
      skipped.push({ pluginId: plugin.id, reason: 'newer' })
      continue
    }

    for (const rel of stale) {
      const content = plugin.files[rel]
      try {
        await invoke('write_plugin_file', { vault: root, pluginId: plugin.id, rel, content })
      } catch (e) {
        failed.push({ pluginId: plugin.id, rel, error: String(e) })
        console.warn(`[zn] 内置插件 ${plugin.id}/${rel} 写入失败`, e)
      }
    }
  }
  return { failed, skipped }
}

/** 目录里有没有 `signature.json`（有 ⇒ 这个插件归签名渠道管，内置版不碰） */
async function hasSignature(root: string, pluginId: string): Promise<boolean> {
  try {
    await invoke<string>('read_plugin_file', { vault: root, pluginId, rel: 'signature.json' })
    return true
  } catch {
    return false
  }
}

/** 目录里现有 `manifest.json` 的版本；读不到 / 不是合法 JSON ⇒ undefined（按"未知"处理，走覆盖） */
async function readInstalledVersion(root: string, pluginId: string): Promise<string | undefined> {
  try {
    const raw = await invoke<string>('read_plugin_file', { vault: root, pluginId, rel: 'manifest.json' })
    const v = JSON.parse(raw)
    return typeof v?.version === 'string' ? v.version : undefined
  } catch {
    return undefined
  }
}
