/**
 * 手机底部导航（UI 重布局 B2 · 方案 §2.2）。
 *
 * 固定四项、固定顺序：`home / search / plugins / more` —— **全部内核能力**，
 * 零插件状态下同样可点（方案 §1.3 硬约束）。
 *
 * 只做渲染：当前项与切换回调由 App 持有（返回键层级也要读同一份 state）。
 * 贴底留 `env(safe-area-inset-bottom)`；只放点击目标，不做拖拽（避开 Android 手势区）。
 */
import { Home, MoreHorizontal, Puzzle, Search } from 'lucide-react'

export type MobileTab = 'home' | 'search' | 'plugins' | 'more'

/** 固定四项与顺序（方案 §2.2 的验收点）—— 组件私有，避免 fast-refresh 警告 */
const MOBILE_TABS: { id: MobileTab; label: string }[] = [
  { id: 'home', label: '首页' },
  { id: 'search', label: '搜索' },
  { id: 'plugins', label: '插件' },
  { id: 'more', label: '更多' },
]

export type MobileTabBarProps = {
  tab: MobileTab
  onChange: (tab: MobileTab) => void
}

const ICONS = { home: Home, search: Search, plugins: Puzzle, more: MoreHorizontal } as const

export function MobileTabBar({ tab, onChange }: MobileTabBarProps) {
  return (
    <nav className="zn-tabbar" aria-label="主导航">
      {MOBILE_TABS.map(({ id, label }) => {
        const Icon = ICONS[id]
        const active = tab === id
        return (
          <button
            key={id}
            type="button"
            className={`zn-tabbar-btn${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            onClick={() => onChange(id)}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
