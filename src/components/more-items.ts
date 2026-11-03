/**
 * 「更多」页的**条目表**（rev173.313；rev173.315 合并「插件中心」与「设置 → 插件」）。
 *
 * 独立成文件是因为 `react-refresh` 规则：组件文件里导出常量会让 HMR 退化
 * （`oxlint` 的 only-export-components 会报）。桌面浮窗（`Settings`）与手机右侧栏
 * （`MobileMoreDrawer`）都读这一份 —— 两种外壳摆同一张表，条目不会各写一份。
 *
 * ## 为什么分「笔记 / 设置」两组
 *
 * 动作类（搜索 / 回收站 / 切换库 / 插件中心）点了就离开这一页去别处；
 * 分组类（通用 / 附件 / 关于）在这一页里钻进去。用户 2026-11-01 指出
 * 「更多页面里同时存在笔记-插件中心，和设置-插件，两个同类项目没有合并」——
 * 现在插件只留「插件中心」一条，并且从「笔记」组挪到「设置」组（它不是笔记功能），
 * 原来「设置 → 插件」里的「启动时检查更新」开关搬进了插件中心页。
 */
import { FolderOpen, HardDrive, Info, Lock, Search, Settings2, Store, Trash2 } from 'lucide-react'

/** 设置分组 id（在这一页里钻进去的那几组） */
export type TabId = 'general' | 'assets' | 'about'

/** 动作条目 id（点了就离开这一页） */
export type MoreActionId = 'search' | 'trash' | 'vaults' | 'private' | 'plugin-center'

export type MoreItemDef =
  | { kind: 'action'; id: MoreActionId; label: string; icon: typeof Search }
  | { kind: 'tab'; id: TabId; label: string; icon: typeof Search }

/**
 * 条目表：两组、共 7 项。
 *
 * 顺序 = 视觉顺序；两种外壳都按这个数组渲染，别在组件里另写一份。
 */
export const MORE_GROUPS: { title: string; items: MoreItemDef[] }[] = [
  {
    title: '笔记',
    items: [
      /**
       * 私密笔记（rev173.336 · 真人测试10 #2「正常模式和私密笔记怎么切换？」）。
       *
       * 以前它只藏在「插件 → 私密文件夹」里：手机没有常驻侧栏 ⇒ 用户找不到入口，
       * 也不知道「公开笔记 / 私密笔记」是两套。放「笔记」组第一项 = 一拉抽屉就能看见。
       */
      { kind: 'action', id: 'private', label: '私密笔记', icon: Lock },
      { kind: 'action', id: 'search', label: '搜索', icon: Search },
      { kind: 'action', id: 'trash', label: '回收站', icon: Trash2 },
      { kind: 'action', id: 'vaults', label: '切换笔记库', icon: FolderOpen },
    ],
  },
  {
    title: '设置',
    items: [
      // 插件中心：原来「笔记」组一条 + 「设置」组一条（摘要 + 开关），两处都指向插件。
      // rev173.315 合并成这一条，开关搬进插件中心页（`PluginPanel`）。
      { kind: 'action', id: 'plugin-center', label: '插件中心', icon: Store },
      { kind: 'tab', id: 'general', label: '通用', icon: Settings2 },
      { kind: 'tab', id: 'assets', label: '附件', icon: HardDrive },
      { kind: 'tab', id: 'about', label: '关于', icon: Info },
    ],
  },
]

/** 只有分组类条目（桌面左栏与手机二级页共用） */
export const TABS = MORE_GROUPS.flatMap((g) => g.items).filter(
  (i): i is Extract<MoreItemDef, { kind: 'tab' }> => i.kind === 'tab',
)
