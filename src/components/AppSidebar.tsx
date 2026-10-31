/**
 * 侧栏外壳（UI 重布局 B1 · 方案 §2.1）。
 *
 * 两个形态，同一个组件：
 *  - **桌面（视图容器）**：头部 = 搜索框 + 收起按钮（`«`）；中部 = `children`（文件树 /
 *    搜索结果 / 时间流三选一，由 App 按 `view` 决定）；底部 = 回收站 + 库名（切库）。
 *    **视图切换本身归图标栏**（AppRail）—— 这里不再放一排 tab，避免两个入口重复。
 *  - **手机（抽屉）**：头部 = 应用名 + 「更多」（rev173.308 起；原来是设置齿轮，
 *    但设置本来就在「更多」里，用户要求这里改开「更多」抽屉）；中部 = `children`（文件树）。
 *
 * 只做渲染：状态与回调全部由 `App` 传入（宽度拖拽在 App 的 resizer 里）。
 */
import { ChevronLeft, MoreHorizontal, Search } from 'lucide-react'
import { baseName } from '../lib/app-paths'

export type AppSidebarView = 'notes' | 'search' | 'timeline'

export type AppSidebarProps = {
  vault: string | null
  /** 移动端抽屉是否展开（桌面端恒为 false，宽度由 `width` 决定） */
  open: boolean
  /**
   * 桌面收起态（rev173.267）：**不卸载**，宽度滑到 0 —— 这样「点击收起/展开」才有 220ms 过渡，
   * 文件树的滚动位置与展开状态也不会因为卸载而丢。收起时加 `inert`（不可 Tab / 不可点）。
   */
  collapsed?: boolean
  width: number
  /** 桌面：侧栏当前视图；不传 = 抽屉模式（手机） */
  view?: AppSidebarView
  /** 桌面：视图内容（文件树 / 搜索 / 时间流） */
  children?: React.ReactNode
  /**
   * 桌面：`location: 'sidebar'` 的插件面板分组（B6 · 方案 §7.2 A 案）。
   * 不传 / 空 ⇒ 整块不渲染（零插件基线不留空壳）。手机不传。
   */
  pluginSlot?: React.ReactNode
  /** 桌面：侧栏头搜索框（点/输入 → 切到搜索视图） */
  onSearchIntent?: () => void
  /** 桌面：收起侧栏（`«`） */
  onCollapse?: () => void
  /** 手机抽屉：「更多」入口（桌面走图标栏，不再在侧栏里放） */
  onOpenMore?: () => void
  onOpenTrash: () => void
  /** 弹出「切换笔记库」菜单（坐标 = 按钮的 client 坐标） */
  onOpenVaultMenu: (x: number, y: number) => void
}

export function AppSidebar({
  vault,
  open,
  collapsed = false,
  width,
  view,
  children,
  pluginSlot,
  onSearchIntent,
  onCollapse,
  onOpenMore,
  onOpenTrash,
  onOpenVaultMenu,
}: AppSidebarProps) {
  /** 有 `view` = 桌面视图容器；没有 = 手机抽屉 */
  const desktop = view !== undefined
  return (
    <aside
      className={`zn-sidebar${open ? ' is-open' : ''}${collapsed ? ' is-collapsed' : ''}`}
      style={{ width: collapsed ? 0 : width }}
      /* 收起时整块不可交互：不能 Tab 进去，也不能点到看不见的按钮 */
      inert={collapsed || undefined}
      aria-hidden={collapsed || undefined}
    >
      <div className="zn-sidebar-head">
        {desktop ? (
          <>
            {/* 搜索视图里不再重复一个「搜索笔记…」按钮（视图内已有输入框） */}
            {view === 'search' ? (
              <span className="zn-sidebar-view-name">搜索</span>
            ) : (
              <button
                type="button"
                className="zn-sidebar-search"
                onClick={onSearchIntent}
                title="搜索笔记（Ctrl+Shift+F）"
              >
                <Search size={16} />
                <span>搜索笔记…</span>
              </button>
            )}
            <button
              type="button"
              className="zn-icon-btn zn-sidebar-collapse"
              onClick={onCollapse}
              title="收起笔记库栏（Ctrl+\）"
              aria-label="收起笔记库栏"
            >
              <ChevronLeft size={16} />
            </button>
          </>
        ) : (
          <>
            {/* 固定显示应用名；具体是哪个库看底部库名（完整路径在 tooltip 上） */}
            <span className="zn-vault-name" title={vault ?? ''}>
              ZeroNote
            </span>
            {onOpenMore ? (
              <button
                type="button"
                className="zn-icon-btn"
                onClick={onOpenMore}
                title="更多"
                aria-label="更多"
              >
                <MoreHorizontal size={16} />
              </button>
            ) : null}
          </>
        )}
      </div>

      {children ? <div className="zn-sidebar-view">{children}</div> : null}

      {/* 侧栏插件分组（B6）：文件树下方、回收站上方；高度受限、内部滚动 */}
      {pluginSlot ? <div className="zn-sidebar-plugin-slot">{pluginSlot}</div> : null}

      {/* 库信息归侧栏底部；状态栏留给文档级信息。库名是**按钮**：点一下弹「切换笔记库」。 */}
      <button
        type="button"
        className="zn-sidebar-foot"
        onClick={onOpenTrash}
        title="回收站：删除的笔记都在这里，可恢复"
      >
        🗑 回收站
      </button>
      <button
        type="button"
        className="zn-sidebar-foot"
        title={vault ?? ''}
        aria-haspopup="menu"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          onOpenVaultMenu(r.left, r.top)
        }}
      >
        {vault ? baseName(vault) : '未选择笔记库'}
      </button>
    </aside>
  )
}
