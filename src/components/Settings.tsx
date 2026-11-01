import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { ThemePref } from '@/lib/theme'
import { Dialog, DialogBody, DialogHeader } from '@/components/ui'
import { AssetRelayPanel } from './AssetRelayPanel'
import { AppUpdatePanel } from './AppUpdatePanel'
import { MORE_GROUPS, type MoreActionId, type TabId } from './more-items'
import type { ImageInsertMode } from '../kernel/attachment'

/**
 * **「更多」页**（rev173.313 由「设置弹窗」升级而来）。
 *
 * 用户 2026-11-01：「设置现在移动端还是悬浮窗口……把更多的那些项目都放到设置页
 * （或者改名叫更多，因为不止设置功能），然后这个页面在桌面端的形态是悬浮窗口，
 * 在移动端的形态就是右侧栏」。
 *
 * 于是：
 *  · **内容只有一份** —— `SettingsSections`（通用 / 附件 / 插件 / 关于四组）；
 *  · **两种外壳** —— 桌面 = `Settings`（本文件，Dialog 浮窗、左列表右内容）；
 *    手机 = `MobileMoreDrawer`（右侧抽屉、单栏钻入）；
 *  · 条目也统一为 8 项：4 个「动作」（搜索 / 回收站 / 切换笔记库 / 插件中心）
 *    + 4 个「设置分组」，两种外壳摆的是同一张表。
 *
 * 布局照抄 Lumina `src/components/layout/SettingsModal.tsx`（Apache-2.0）：
 * 左侧导航 + 右侧内容、只让内容区滚动。
 * **B3 瘦身**（`docs/UI重布局-方案-2026-10-29.md` §5）：插件列表、市场、调试、
 * 核心能力接管全部搬到**插件中心**。这里只留摘要 + 入口。
 */

/** 条目表（4 个动作 + 4 个设置分组）在 `./more-items` —— 两种外壳共读那一份。 */

/**
 * 一行「标签 + 说明 + 右侧控件」。
 *
 * **窄屏（手机 CSS 视口约 444px）改成上下排列**：横排时右侧控件是 `shrink-0`（绝不收缩），
 * 而左列只有 `min-w-0`（允许被压到 0）⇒ 真机实测「外观」那行的左列只剩一个字宽，
 * 标签变成竖排、说明逐字一行（用户反馈：「外观那里字体显示有问题」）。
 * `min-[520px]` 以上保持原来的左右布局（桌面观感不变）。
 *
 * hint 同时由 `break-all` 改为 `break-words` —— 前者允许**任意断行**，
 * 在极窄列里就等于"一行一个字"；后者只在单个词真放不下时才断（长路径仍能换行）。
 */
function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-border py-2.5 last:border-b-0 min-[520px]:flex-row min-[520px]:items-start min-[520px]:justify-between min-[520px]:gap-4">
      <div className="min-w-0 min-[520px]:flex-1">
        <div className="text-xs text-foreground">{label}</div>
        {hint ? (
          <div className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
            {hint}
          </div>
        ) : null}
      </div>
      {children ? <div className="shrink-0">{children}</div> : null}
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground first:mt-0">
      {children}
    </h3>
  )
}

/**
 * 四组设置的**内容**（不含任何外壳）。
 *
 * 桌面浮窗与手机右侧栏都渲染它 —— 同一份开关只有一处实现，改一处两端一起变。
 * 宿主若在别处（如 toast 里的「设置 → 关于 → 更新」）需要落到某一组，
 * 用 `initialTab` 选中对应壳的初始页即可。
 */
export type SettingsSectionProps = {
  vault: string | null
  apiVersion?: string
  appVersion?: string
  platform?: string
  onPickVault: () => void
  /** 主题偏好（第 3 组）：浅色 / 深色 / 跟随系统 */
  themePref: ThemePref
  onThemeChange: (pref: ThemePref) => void
  /**
   * 专注模式（目标态 ③ · 方案 §2.1）：开启后标题栏自动隐藏，
   * 鼠标移到窗口顶部或键盘 Tab 到标题栏时滑回。默认关（标题栏常驻）。
   */
  focusMode?: boolean
  onFocusModeChange: (on: boolean) => void
  /**
   * 内嵌 HTML 是否渲染（rev173.39）：开 = 白名单标签（ins/strong/kbd 等）渲染成真样式，
   * 关 = 编辑器里显示源码。属性一律剔除，脚本/iframe 永不渲染。
   */
  renderHtml: boolean
  onRenderHtmlChange: (v: boolean) => void
  /**
   * 图片插入模式（rev173.234 · 附件同步期 2）：A 引入原图（默认）/ B 压到 1 MiB 以下入库。
   * 只影响**超过 1 MiB 的图片** —— 小图两种模式都是直接复制原图。
   */
  imageMode?: ImageInsertMode
  onImageModeChange: (mode: ImageInsertMode) => void
  /**
   * 环形快捷入口的 **5 格**（rev173.281 · J#9）：值 = 槽 key 或 `null`（空槽）。
   * 中心 ＋ 固定是新建笔记，不在这里配。
   * 不传 ⇒ 不显示这一块（测试 / 独立窗口不需要）。
   */
  quickSlots?: (string | null)[]
  /** 可选入口（插件面板 + 内置动作） */
  quickSlotOptions?: { key: string; label: string }[]
  onQuickSlotChange?: (index: number, key: string | null) => void
}

export function SettingsSections({
  tab,
  vault,
  apiVersion,
  appVersion,
  platform,
  onPickVault,
  themePref,
  onThemeChange,
  focusMode = false,
  onFocusModeChange,
  renderHtml,
  onRenderHtmlChange,
  imageMode = 'original',
  onImageModeChange,
  quickSlots,
  quickSlotOptions = [],
  onQuickSlotChange,
}: SettingsSectionProps & { tab: TabId }) {
  return (
    <>
      {tab === 'general' ? (
        <>
          <SectionTitle>笔记库</SectionTitle>
          <Row label="当前库" hint={vault ?? '选一个文件夹作为笔记库'}>
            <button
              type="button"
              onClick={onPickVault}
              className="rounded-ui-sm border border-border-strong bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
            >
              切换…
            </button>
          </Row>
          <Row label="自动保存" hint="停手约 0.8 秒后自动保存" />
          <Row
            label="内嵌 HTML"
            hint="按白名单渲染（ins / strong / kbd 等）；脚本与事件属性一律剔除"
          >
            <div className="flex overflow-hidden rounded-ui-sm border border-border-strong">
              {(
                [
                  [true, '渲染'],
                  [false, '显示源码'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => onRenderHtmlChange(value)}
                  className={cn(
                    'px-2.5 py-1 text-xs transition-colors',
                    renderHtml === value
                      ? 'bg-primary zn-on-accent'
                      : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row
            label="图片插入模式"
            hint={
              imageMode === 'compress'
                ? '超过 1 MiB 的图片压到 1 MiB 以下再入库（正文与点开都是压缩版，原图路径记进引用台账）'
                : '引入原图：≤1 MiB 复制进库；更大的引用原文件，另存一张预览图'
            }
          >
            <div className="flex overflow-hidden rounded-ui-sm border border-border-strong">
              {(
                [
                  ['original', '引入原图'],
                  ['compress', '压缩入库'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onImageModeChange(value)}
                  className={cn(
                    'px-2.5 py-1 text-xs transition-colors',
                    imageMode === value
                      ? 'bg-primary zn-on-accent'
                      : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="外观" hint="跟随系统时自动切换深浅色">
            <div className="flex overflow-hidden rounded-ui-sm border border-border-strong">
              {(
                [
                  ['light', '浅色'],
                  ['dark', '深色'],
                  ['system', '跟随系统'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onThemeChange(value)}
                  className={cn(
                    'px-2.5 py-1 text-xs transition-colors',
                    themePref === value
                      ? 'bg-primary zn-on-accent'
                      : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          {/* 目标态 ③ · 方案 §2.1：自动隐藏只在专注模式下启用；默认常驻 */}
          <Row
            label="专注模式"
            hint="标题栏自动隐藏；鼠标移到窗口顶部、或键盘 Tab 到标题栏时滑回"
          >
            <div className="flex overflow-hidden rounded-ui-sm border border-border-strong">
              {(
                [
                  [true, '开'],
                  [false, '关'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  onClick={() => onFocusModeChange(value)}
                  className={cn(
                    'px-2.5 py-1 text-xs transition-colors',
                    focusMode === value
                      ? 'bg-primary zn-on-accent'
                      : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Row>
          {/* J#9（rev173.281）：环形快捷入口的 5 格 —— 中心 ＋ 固定新建笔记 */}
          {onQuickSlotChange ? (
            <>
              <SectionTitle>环形快捷入口</SectionTitle>
              <Row
                label="长按 ＋ 打开的 5 个入口"
                hint="中心 ＋ 固定是「新建笔记」；下面 5 格对应环上的位置（第 1 格在正上方）"
              />
              {(quickSlots ?? []).map((slot, i) => (
                <Row key={i} label={`第 ${i + 1} 格`}>
                  <select
                    aria-label={`第 ${i + 1} 格快捷入口`}
                    value={slot ?? ''}
                    onChange={(e) => onQuickSlotChange(i, e.target.value || null)}
                    className="rounded-ui-sm border border-border-strong bg-background px-2 py-1 text-xs text-foreground"
                  >
                    <option value="">（空位）</option>
                    {quickSlotOptions.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Row>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'assets' ? <AssetRelayPanel vault={vault} /> : null}

      {tab === 'about' ? (
        <>
          <SectionTitle>版本</SectionTitle>
          <Row label="ZeroNote" hint={appVersion ?? '0.1.0'} />
          <Row label="内核契约" hint={apiVersion ?? '—'} />
          <Row label="运行平台" hint={platform ?? '—'} />
          {/**
           * 应用本体更新（rev173.292）：检查 / 下载 / 安装的状态全在这里。
           * 与「插件」tab 里那个「启动时检查更新」不是一回事 —— 那个查市场索引角标。
           */}
          <SectionTitle>更新</SectionTitle>
          <AppUpdatePanel appVersion={appVersion} />
          <SectionTitle>内核只做四件事</SectionTitle>
          <div className="text-[11px] leading-relaxed text-muted-foreground">
            <b className="text-foreground">.md 读写</b> · <b className="text-foreground">编辑</b> ·{' '}
            <b className="text-foreground">本地存储</b> ·{' '}
            <b className="text-foreground">插件宿主</b>
            <br />
            其余能力全部由插件提供。
          </div>
        </>
      ) : null}
    </>
  )
}

export interface SettingsProps extends SettingsSectionProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  /**
   * 打开时默认停在哪个分组（B1）—— ☰ 主菜单的「关于」直接落到「关于」页。
   * 宿主用 `key` 让它生效（切分组由内部 state 管，不反向受控）。
   */
  initialTab?: TabId
  /** 动作条目：宿主负责关掉这一页再做（搜索 / 回收站 / 切换库 / 插件中心） */
  onAction?: (id: MoreActionId) => void
}

/**
 * 桌面外壳：**悬浮窗**。
 *
 * 左栏 = 8 项（4 动作 + 4 设置分组），右栏 = 当前分组的内容。
 * 手机不用它 —— 手机走 `MobileMoreDrawer`（右侧栏、单栏钻入），内容仍是 `SettingsSections`。
 */
export function Settings({
  open,
  onOpenChange,
  initialTab,
  onAction,
  ...sections
}: SettingsProps) {
  const [tab, setTab] = useState<TabId>(initialTab ?? 'general')

  const itemClass = (active: boolean) =>
    cn(
      'flex w-full items-center gap-2 rounded-ui-sm px-2.5 py-1.5 text-xs transition-colors',
      active
        ? 'bg-primary font-medium zn-on-accent'
        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={640}>
      <DialogHeader title="更多" />
      <DialogBody className="p-0">
        <div className="flex min-h-[360px]">
          <nav className="w-[132px] shrink-0 overflow-y-auto border-r border-border p-2">
            {/* 条目表与手机右侧栏共用 `more-items.ts`（rev173.315：两组共 7 项） */}
            {MORE_GROUPS.map((group) => (
              <div key={group.title}>
                <div className="mb-1 mt-3 px-2.5 text-[11px] text-muted-foreground first:mt-0">
                  {group.title}
                </div>
                {group.items.map((it) =>
                  it.kind === 'tab' ? (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setTab(it.id)}
                      className={itemClass(tab === it.id)}
                    >
                      <it.icon size={16} />
                      <span>{it.label}</span>
                    </button>
                  ) : (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => onAction?.(it.id)}
                      className={itemClass(false)}
                    >
                      <it.icon size={16} />
                      <span>{it.label}</span>
                    </button>
                  ),
                )}
              </div>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            <SettingsSections tab={tab} {...sections} />
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}
