/**
 * 桌面左侧图标栏（Activity Rail）—— UI 重布局 B1（方案 §2.1）。
 *
 * 只放**内核能力**的固定 5 项：笔记 / 搜索 / 时间流 / 插件 / 设置。
 * 插件能力不写死在这里（零插件状态下会变成死按钮）—— 插件固定区（分隔线以下）
 * 由用户从插件中心 pin 进来，B1 阶段默认空，**空的时候整块不渲染**。
 *
 * 状态全部由 App 持有：组件只收 props，不读 localStorage、不读 kernel。
 */
import type { ComponentType } from 'react'
import { Clock, FileText, Puzzle, Search, Settings } from 'lucide-react'

/** 侧栏三个内核视图 —— 图标栏上半区前 3 项与侧栏视图容器一一对应 */
export type RailView = 'notes' | 'search' | 'timeline'

export type AppRailProps = {
  /** 侧栏当前视图（'notes' | 'search' | 'timeline'） */
  activeView: RailView
  /** 侧栏是否展开 —— 收起时三个视图按钮不显示选中态（点一下 = 回到该视图并展开） */
  sidebarVisible: boolean
  /** 插件中心 / 插件管理页是否打开 */
  pluginsOpen: boolean
  /** 设置是否打开 */
  settingsOpen: boolean
  onSelectView: (view: RailView) => void
  /** 插件：打开插件管理页；再点回到之前的文档 */
  onTogglePlugins: () => void
  /** 设置：打开设置；再点关闭 */
  onToggleSettings: () => void
  /**
   * 插件固定区（分隔线以下），最多 3 个；默认空数组 ⇒ **整块不渲染**（零插件不留灰位）。
   * B1 只保留结构，pin 的交互在 B3 插件中心里做。
   */
  pins?: { id: string; title: string; icon?: ComponentType<{ size?: number }> }[]
  /** 点 pin 项 */
  onPinClick?: (id: string) => void
}

/** 图标栏按钮：tooltip 里带快捷键（方案 §2.1 / 验收：tooltip 带快捷键） */
function RailButton({
  label,
  hint,
  active,
  children,
  onClick,
}: {
  label: string
  hint?: string
  active: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={`zn-rail-btn${active ? ' is-active' : ''}`}
      onClick={onClick}
      title={hint ? `${label}（${hint}）` : label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      {children}
    </button>
  )
}

export function AppRail({
  activeView,
  sidebarVisible,
  pluginsOpen,
  settingsOpen,
  onSelectView,
  onTogglePlugins,
  onToggleSettings,
  pins = [],
  onPinClick,
}: AppRailProps) {
  /** 视图按钮的选中态：只有侧栏展开时才算「当前页」 */
  const viewActive = (v: RailView) => sidebarVisible && activeView === v

  return (
    <nav className="zn-rail" aria-label="主导航">
      <RailButton label="笔记" hint="Ctrl+1" active={viewActive('notes')} onClick={() => onSelectView('notes')}>
        <FileText size={18} />
      </RailButton>
      <RailButton
        label="搜索"
        hint="Ctrl+2"
        active={viewActive('search')}
        onClick={() => onSelectView('search')}
      >
        <Search size={18} />
      </RailButton>
      <RailButton
        label="时间流"
        hint="Ctrl+3"
        active={viewActive('timeline')}
        onClick={() => onSelectView('timeline')}
      >
        <Clock size={18} />
      </RailButton>

      {/* 下半区：插件固定区。空 ⇒ 一条分隔线也不画（零插件不留视觉残迹） */}
      {pins.length > 0 ? (
        <>
          <div className="zn-rail-sep" role="separator" aria-orientation="horizontal" />
          {pins.slice(0, 3).map((p) => {
            const Icon = p.icon
            return (
              <RailButton
                key={p.id}
                label={p.title}
                active={false}
                onClick={() => onPinClick?.(p.id)}
              >
                {Icon ? <Icon size={18} /> : <Puzzle size={18} />}
              </RailButton>
            )
          })}
        </>
      ) : null}

      {/* 底部分组：插件 + 设置（NavigationView 惯例：设置固定在底部） */}
      <div className="zn-rail-sep" role="separator" aria-orientation="horizontal" />
      <div className="zn-rail-bottom">
        <RailButton label="插件" active={pluginsOpen} onClick={onTogglePlugins}>
          <Puzzle size={18} />
        </RailButton>
        <RailButton label="设置" hint="Ctrl+," active={settingsOpen} onClick={onToggleSettings}>
          <Settings size={18} />
        </RailButton>
      </div>
    </nav>
  )
}
