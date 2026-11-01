/**
 * 手机「更多」**右侧抽屉**（rev173.308，rev173.313 升级为「更多」页）。
 *
 * 取代 B2 的「更多」底部 tab 全屏页：用户 2026-10-31 要求
 * 「移动端不做底部导航栏，首页就是默认的时间流，搜索放进更多里面，
 * 插件本来就在更多有入口，更多改成右滑出现的右侧栏」。
 *
 * 2026-11-01 第二轮（用户）：「设置现在移动端还是悬浮窗口……把更多的那些项目都放到设置页
 * （或者改名叫更多，因为不止设置功能），然后这个页面在桌面端的形态是悬浮窗口，
 * 在移动端的形态就是右侧栏」。
 *
 * 于是这一页不再只是「入口表」：**设置四组（通用 / 附件 / 插件 / 关于）直接在这里展开**
 * —— 点一项就钻进去，内容渲染的是 `SettingsSections`（与桌面浮窗**同一份**），
 * 不再弹第二个浮窗。桌面外壳见 `Settings.tsx`。
 *
 * 入口两处：
 *  · 屏幕右边缘往左滑（`lib/swipe.ts` 的 `moreSwipeIntent`）；
 *  · 左侧文件树抽屉头部的「更多」按钮。
 *
 * 规则沿用 B2（方案 §4 规则 3）：来源是插件的行，插件未启用时**整行消失**，不留灰位；
 * 每条入口一个可点行，最少 44px 高（触摸目标）。
 */
import { ChevronLeft, ChevronRight, Puzzle, X } from 'lucide-react'
import { baseName } from '../lib/app-paths'
import { SettingsSections, type SettingsSectionProps } from './Settings'
import { MORE_ACTIONS, TABS, type MoreActionId, type TabId } from './more-items'

export type MoreEntry = {
  key: string
  label: string
  hint?: string
  /** 插件类入口（禁用即消失）—— 仅用于分组显示 */
  plugin?: boolean
  onClick: () => void
}

export type MobileMoreDrawerProps = SettingsSectionProps & {
  noteCount: number
  onClose: () => void
  /** 动作条目（搜索 / 回收站 / 切换库 / 插件中心）—— 宿主负责收起抽屉再做 */
  onAction: (id: MoreActionId) => void
  /**
   * 当前屏（rev173.313）：`menu` = 条目表，其余 = 某一组设置（单栏钻入）。
   * **受控** —— 返回键要先「回菜单」再「关抽屉」，这个层级由宿主（App）管。
   */
  view: 'menu' | TabId
  onViewChange: (next: 'menu' | TabId) => void
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
  noteCount,
  onClose,
  onAction,
  view,
  onViewChange,
  pluginEntries = [],
  vault,
  ...sections
}: MobileMoreDrawerProps) {
  const tabLabel = view === 'menu' ? null : TABS.find((t) => t.id === view)?.label

  return (
    <aside className="zn-more-drawer" aria-label="更多">
      {view === 'menu' ? (
        <>
          <div className="zn-more-head">
            <div className="zn-more-head-row">
              <div className="zn-more-title">更多</div>
              <button
                type="button"
                className="zn-icon-btn"
                onClick={onClose}
                aria-label="关闭更多"
                title="关闭"
              >
                <X size={20} />
              </button>
            </div>
            <div className="zn-more-sub">
              {vault ? `${baseName(vault)} · ${noteCount} 篇` : '还没选择笔记库'}
            </div>
          </div>

          <div className="zn-more-group-title">笔记</div>
          {MORE_ACTIONS.map(({ id, label, icon: Icon }) => (
            <Row
              key={id}
              icon={<Icon size={20} />}
              label={label}
              hint={
                id === 'vaults'
                  ? vault
                    ? baseName(vault)
                    : '未选择'
                  : id === 'plugin-center'
                    ? '安装 / 启用 / 插件市场'
                    : undefined
              }
              onClick={() => onAction(id)}
            />
          ))}

          {/* 插件类入口：启用才出现（零插件时这一整组不存在） */}
          {pluginEntries.length > 0 ? (
            <>
              <div className="zn-more-group-title">插件</div>
              {pluginEntries.map((e) => (
                <Row
                  key={e.key}
                  icon={<Puzzle size={20} />}
                  label={e.label}
                  hint={e.hint}
                  onClick={e.onClick}
                />
              ))}
            </>
          ) : null}

          <div className="zn-more-group-title">设置</div>
          {TABS.map(({ id, label, icon: Icon }) => (
            <Row key={id} icon={<Icon size={20} />} label={label} onClick={() => onViewChange(id)} />
          ))}
        </>
      ) : (
        <>
          {/* 二级页头部：返回 + 分组名（单栏钻入，不再弹浮窗） */}
          <div className="zn-more-head zn-more-head-back">
            <button
              type="button"
              className="zn-icon-btn"
              onClick={() => onViewChange('menu')}
              aria-label="返回更多"
              title="返回"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="zn-more-title">{tabLabel}</div>
            <button
              type="button"
              className="zn-icon-btn"
              onClick={onClose}
              aria-label="关闭更多"
              title="关闭"
            >
              <X size={20} />
            </button>
          </div>
          <div className="zn-more-body">
            <SettingsSections tab={view} vault={vault} {...sections} />
          </div>
        </>
      )}
    </aside>
  )
}
