/**
 * **推荐优先安装**（rev173.259 · 用户「不设置内置插件，之前预装的改为推荐优先安装」）。
 *
 * 这 9 个就是原来的预装清单（`D-010` 的「核心体验」）。2026-10-30 起应用**不再预装任何插件**：
 * 第一次启动是零插件，装它们走 插件中心 → 插件市场（离线时只能手动装 `.znp`）。
 *
 * 为什么单独一个模块：插件中心（`PluginPanel`）与插件市场（`MarketPane`）都要用这份清单，
 * 而两者互相 import 会成环。id 用**市场条目 id**（与 `market/index.json` 一致）。
 */
export type RecommendedItem = { id: string; name: string; why: string }
export type RecommendedGroup = { title: string; hint?: string; items: RecommendedItem[] }

export const RECOMMENDED_GROUPS: RecommendedGroup[] = [
  {
    title: '基础体验',
    hint: '不开这些，笔记应用少了最常用的几件事',
    items: [
      { id: 'tag-panel', name: '标签', why: '给笔记打标签，按标签浏览' },
      { id: 'backlinks', name: '反向链接', why: '看哪些笔记引用了当前这篇' },
      { id: 'history', name: '历史版本', why: '每次保存留一档，能回滚' },
      { id: 'import-export', name: '导入导出', why: '把 md / txt / docx / pdf 搬进来，或导出带走' },
      { id: 'backup', name: '备份', why: '整库快照 + 恢复，换机 / 误删的兜底' },
    ],
  },
  {
    title: '多设备同步',
    hint: '用自己的网盘 / Git / 本地文件夹，不经过任何官方服务器',
    items: [
      { id: 'sync-folder', name: '同步 · 本地文件夹', why: '库放同步盘（坚果云 / OneDrive）就能走' },
      { id: 'sync-webdav', name: '同步 · WebDAV', why: '坚果云 / Nextcloud / 群晖直连' },
      { id: 'sync-s3', name: '同步 · S3', why: 'AWS S3 / MinIO / R2 / B2' },
      { id: 'sync-git', name: '同步 · Git', why: 'GitHub / Gitea / Gitee，sha 当乐观锁' },
    ],
  },
]

/** 推荐安装的总条数（空态与市场 tab 的提示文案要用） */
export const RECOMMENDED_COUNT = RECOMMENDED_GROUPS.reduce((n, g) => n + g.items.length, 0)

/** 推荐清单的 id（市场里给条目打「推荐」标；顺序即推荐顺序） */
export const RECOMMENDED_IDS: string[] = RECOMMENDED_GROUPS.flatMap((g) => g.items.map((i) => i.id))
