/**
 * 手机「更多」全屏页（UI 重布局 B2 · 方案 §2.2）。
 *
 * 不是抽屉，是**整页**：设置 / 回收站 / 切换库 / 插件类入口（启用才出现）/ 关于。
 * 规则（方案 §4 规则 3）：来源是插件的行，插件未启用时**整行消失**，不留灰位；
 * 每条入口一个可点行，最少 44px 高（触摸目标）。
 */
import { ChevronRight, Info, Puzzle, Settings, Settings2, Store, Trash2 } from 'lucide-react'
import { baseName } from '../lib/app-paths'

export type MoreEntry = {
  key: string
  label: string
  hint?: string
  /** 插件类入口（禁用即消失）—— 仅用于分组显示 */
  plugin?: boolean
  onClick: () => void
}

export type MobileMorePageProps = {
  vault: string | null
  noteCount: number
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

export function MobileMorePage({
  vault,
  noteCount,
  onOpenSettings,
  onOpenTrash,
  onOpenVaults,
  onOpenPlugins,
  onAbout,
  pluginEntries = [],
}: MobileMorePageProps) {
  return (
    <div className="zn-mobile-page zn-more-page">
      <div className="zn-more-head">
        <div className="zn-more-title">更多</div>
        <div className="zn-more-sub">
          {vault ? `${baseName(vault)} · ${noteCount} 篇` : '还没选择笔记库'}
        </div>
      </div>

      <div className="zn-more-group-title">笔记</div>
      <Row icon={<Trash2 size={18} />} label="回收站" hint="删除的笔记可恢复" onClick={onOpenTrash} />
      <Row
        icon={<Store size={18} />}
        label="切换笔记库"
        hint={vault ? baseName(vault) : '未选择'}
        onClick={onOpenVaults}
      />
      <Row icon={<Settings2 size={18} />} label="插件中心" hint="安装 / 启用 / 插件市场" onClick={onOpenPlugins} />

      {/* 插件类入口：启用才出现（零插件时这一整组不存在） */}
      {pluginEntries.length > 0 ? (
        <>
          <div className="zn-more-group-title">插件</div>
          {pluginEntries.map((e) => (
            <Row
              key={e.key}
              icon={<Puzzle size={18} />}
              label={e.label}
              hint={e.hint}
              onClick={e.onClick}
            />
          ))}
        </>
      ) : null}

      <div className="zn-more-group-title">其他</div>
      <Row icon={<Settings size={18} />} label="设置" hint="外观 / 编辑器 / 附件" onClick={onOpenSettings} />
      <Row icon={<Info size={18} />} label="关于 ZeroNote" onClick={onAbout} />
    </div>
  )
}
