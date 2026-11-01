/**
 * 「更多」页的**条目表**（rev173.313）。
 *
 * 独立成文件是因为 `react-refresh` 规则：组件文件里导出常量会让 HMR 退化
 * （`oxlint` 的 only-export-components 会报）。桌面浮窗（`Settings`）与手机右侧栏
 * （`MobileMoreDrawer`）都读这一份 —— 两种外壳摆同一张表，条目不会各写一份。
 */
import { FolderOpen, HardDrive, Info, Plug, Search, Settings2, Store, Trash2 } from 'lucide-react'

/** 设置分组 id。手机右侧栏要按它直达某一组（rev173.312）。 */
export type TabId = 'general' | 'assets' | 'plugins' | 'about'

/** 设置分组（四组，内容由 `SettingsSections` 渲染） */
export const TABS: { id: TabId; label: string; icon: typeof Settings2 }[] = [
  { id: 'general', label: '通用', icon: Settings2 },
  // rev173.238：附件跨设备搬运（需求 §5）——配置云端临时区 + 上传 / 接收 / 清理
  { id: 'assets', label: '附件', icon: HardDrive },
  { id: 'plugins', label: '插件', icon: Plug },
  { id: 'about', label: '关于', icon: Info },
]

/**
 * 「动作」条目：点了就**离开这一页**去做事（不是设置分组）。
 *
 * `vaults` 走宿主的多库面板、`plugin-center` 切主区 —— 宿主要自己关掉外壳再执行，
 * 所以这里只把 id 交回去（`onAction`）。
 */
export type MoreActionId = 'search' | 'trash' | 'vaults' | 'plugin-center'

export const MORE_ACTIONS: { id: MoreActionId; label: string; icon: typeof Search }[] = [
  { id: 'search', label: '搜索', icon: Search },
  { id: 'trash', label: '回收站', icon: Trash2 },
  { id: 'vaults', label: '切换笔记库', icon: FolderOpen },
  { id: 'plugin-center', label: '插件中心', icon: Store },
]
