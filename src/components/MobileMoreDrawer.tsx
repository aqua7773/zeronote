/**
 * 手机「更多」**右侧抽屉**（rev173.308）。
 *
 * 取代 B2 的「更多」底部 tab 全屏页：用户 2026-10-31 要求
 * 「移动端不做底部导航栏，首页就是默认的时间流，搜索放进更多里面，
 * 插件本来就在更多有入口，更多改成右滑出现的右侧栏」。
 *
 * 入口两处：
 *  · 屏幕右边缘往左滑（`lib/swipe.ts` 的 `moreSwipeIntent`）；
 *  · 左侧文件树抽屉头部的「更多」按钮（原来那里是设置齿轮 —— 设置本来就在这一页里）。
 *
 * 规则沿用 B2（方案 §4 规则 3）：来源是插件的行，插件未启用时**整行消失**，不留灰位；
 * 每条入口一个可点行，最少 44px 高（触摸目标）。
 */
import { ChevronRight, Info, Puzzle, Search, Settings, Settings2, Store, Trash2, X } from 'lucide-react'
import { baseName } from '../lib/app-paths'

export type MoreEntry = {
  key: string
  label: string
  hint?: string
  /** 插件类入口（禁用即消失）—— 仅用于分组显示 */
  plugin?: boolean
  onClick: () => void
}

export type MobileMoreDrawerProps = {
  vault: string | null
  noteCount: number
  onClose: () => void
  onOpenSearch: () => void
  onOpenSettings: () => void
  onOpenTrash: () => void
  onOpenVaults: () => void
  onOpenPlugins: () => void
  onAbout: () => void
  /** 插件提供的入口（标签 / 导入导出 / …）—— 只传「当前已启用」的 */
  pluginEntries?: MoreEntry[]
}

function Row({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  onClick: () => void
}) {
  return (
    <button type="button" className="zn-more-row" onClick={onClick}>
      <span className="zn-more-icon">{icon}</span>
      <span className="zn-more-label">{label}</span>
      {hint ? <span className="zn-more-hint">{hint}</span> : null}
      <ChevronRight size={16} className="zn-more-chev" />
    </button>
  )
}

export function MobileMoreDrawer({
  vault,
  noteCount,
  onClose,
  onOpenSearch,
  onOpenSettings,
  onOpenTrash,
  onOpenVaults,
  onOpenPlugins,
  onAbout,
  pluginEntries = [],
}: MobileMoreDrawerProps) {
  return (
    <aside className="zn-more-drawer" aria-label="更多">
      <div className="zn-more-head">
        <div className="zn-more-head-row">
          <div className="zn-more-title">更多</div>
          <button type="button" className="zn-icon-btn" onClick={onClose} aria-label="关闭更多" title="关闭">
            <X size={20} />
          </button>
        </div>
        <div className="zn-more-sub">
          {vault ? `${baseName(vault)} · ${noteCount} 篇` : '还没选择笔记库'}
        </div>
      </div>

      <div className="zn-more-group-title">笔记</div>
      <Row icon={<Search size={20} />} label="搜索" hint="全文 / 标签 / 目录" onClick={onOpenSearch} />
      <Row icon={<Trash2 size={20} />} label="回收站" hint="删除的笔记可恢复" onClick={onOpenTrash} />
      <Row
        icon={<Store size={20} />}
        label="切换笔记库"
        hint={vault ? baseName(vault) : '未选择'}
        onClick={onOpenVaults}
      />
      <Row icon={<Settings2 size={20} />} label="插件中心" hint="安装 / 启用 / 插件市场" onClick={onOpenPlugins} />

      {/* 插件类入口：启用才出现（零插件时这一整组不存在） */}
      {pluginEntries.length > 0 ? (
        <>
          <div className="zn-more-group-title">插件</div>
          {pluginEntries.map((e) => (
            <Row key={e.key} icon={<Puzzle size={20} />} label={e.label} hint={e.hint} onClick={e.onClick} />
          ))}
        </>
      ) : null}

      <div className="zn-more-group-title">其他</div>
      <Row icon={<Settings size={20} />} label="设置" hint="外观 / 编辑器 / 附件" onClick={onOpenSettings} />
      <Row icon={<Info size={20} />} label="关于 ZeroNote" onClick={onAbout} />
    </aside>
  )
}
