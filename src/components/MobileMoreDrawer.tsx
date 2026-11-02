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
 * 2026-11-01 第三轮（用户）：「更多页面里同时存在笔记-插件中心，和设置-插件，
 * 两个同类项目没有合并」—— 条目表合并成 7 项（`more-items.ts`），插件只留「插件中心」一条，
 * 并挪进「设置」组；原来「设置 → 插件」里的启动检查开关搬进插件中心页。
 *
 * 入口两处：
 *  · 屏幕右边缘往左划（`lib/swipe.ts` 的 `moreSwipeIntent`）；
 *  · 左侧文件树抽屉头部的「更多」按钮。
 *
 * 规则沿用 B2（方案 §4 规则 3）：来源是插件的行，插件未启用时**整行消失**，不留灰位；
 * 每条入口一个可点行，最少 44px 高（触摸目标）。
 */
import { Fragment } from 'react'
import { ChevronLeft, ChevronRight, Puzzle, X } from 'lucide-react'
import { baseName } from '../lib/app-paths'
import { SettingsSections, type SettingsSectionProps } from './Settings'
import { MORE_GROUPS, type MoreActionId, type MoreItemDef, type TabId } from './more-items'

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
  /**
   * 抽屉是否展开（rev173.332）。
   *
   * **不再负责"卸载"**：宿主已改成常驻挂载（与左抽屉同一套写法），关闭只是移除 `is-open`
   * —— CSS 用 `visibility: hidden` 让层真正退出合成。原因见 styles.css 的
   * `.zn-more-drawer` 注释（nubia HWC 对"新建全屏合成层"的竞态）。
   */
  open?: boolean
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

/** 每行的副标题（按 id 给，不给就只显示标题） */
function hintOf(it: MoreItemDef, vault: string | null): string | undefined {
  if (it.kind === 'tab') return undefined
  switch (it.id) {
    case 'search':
      return '全文 / 标签 / 目录'
    case 'trash':
      return '删除的笔记可恢复'
    case 'vaults':
      return vault ? baseName(vault) : '未选择'
    case 'plugin-center':
      return '安装 / 启用 / 插件市场'
    default:
      return undefined
  }
}

export function MobileMoreDrawer({
  noteCount,
  onClose,
  onAction,
  view,
  onViewChange,
  pluginEntries = [],
  vault,
  open = false,
  ...sections
}: MobileMoreDrawerProps) {
  const tabLabel = view === 'menu' ? null : MORE_GROUPS.flatMap((g) => g.items).find((i) => i.kind === 'tab' && i.id === view)?.label

  return (
    <aside
      className={`zn-more-drawer${open ? ' is-open' : ''}`}
      aria-label="更多"
      aria-hidden={!open}
    >
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

          {/* 两组共 7 项（`more-items.ts`）：动作类点了离开这一页，分组类在栏内钻进去。 */}
          {MORE_GROUPS.map((group) => (
            <Fragment key={group.title}>
              <div className="zn-more-group-title">{group.title}</div>
              {group.items.map((it) => (
                <Row
                  key={it.id}
                  icon={<it.icon size={20} />}
                  label={it.label}
                  hint={hintOf(it, vault)}
                  onClick={() => (it.kind === 'tab' ? onViewChange(it.id) : onAction(it.id))}
                />
              ))}
            </Fragment>
          ))}

          {/* 插件类入口（标签 / 导入导出）：单独一组排在最后 —— 夹在设置组中间会让
              「通用 / 附件 / 关于」看起来不像一组。零插件时整组消失，不留灰位。 */}
          {pluginEntries.length > 0 ? (
            <Fragment>
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
            </Fragment>
          ) : null}
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
