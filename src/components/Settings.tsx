import { useState } from 'react'
import { Info, Plug, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ThemePref } from '@/lib/theme'
import { Dialog, DialogBody, DialogHeader } from '@/components/ui'
import { PluginPanel, type PluginRow } from './PluginPanel'

/**
 * 设置弹窗。
 *
 * 布局照抄 Lumina `src/components/layout/SettingsModal.tsx`（Apache-2.0）：
 * 左侧导航 + 右侧内容、只让内容区滚动。
 * 差异：Lumina 有 6 个 tab（AI/同步/网络/账号…），ZeroNote 的内核只有三件自己的事 ——
 * 通用（库与外观）、插件、关于。其余能力按架构都该由插件提供，不进内核设置。
 */
type TabId = 'general' | 'plugins' | 'about'

const TABS: { id: TabId; label: string; icon: typeof Settings2 }[] = [
  { id: 'general', label: '通用', icon: Settings2 },
  { id: 'plugins', label: '插件', icon: Plug },
  { id: 'about', label: '关于', icon: Info },
]

/** 一行「标签 + 说明 + 右侧控件」 */
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
    <div className="flex items-start justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-xs text-foreground">{label}</div>
        {hint ? (
          <div className="mt-0.5 break-all text-[11px] leading-relaxed text-muted-foreground">
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

export interface SettingsProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  vault: string | null
  apiVersion?: string
  appVersion?: string
  platform?: string
  onPickVault: () => void
  /** 主题偏好（第 3 组）：浅色 / 深色 / 跟随系统 */
  themePref: ThemePref
  onThemeChange: (pref: ThemePref) => void
  /** 插件段：直接把现有 PluginPanel 复用进来，不重复实现 */
  plugins: PluginRow[]
  pluginError?: string | null
  pluginLog?: string[]
  onTogglePlugin: (id: string, enabled: boolean) => void
  onReloadPlugins: () => void
}

export function Settings({
  open,
  onOpenChange,
  vault,
  apiVersion,
  appVersion,
  platform,
  onPickVault,
  themePref,
  onThemeChange,
  plugins,
  pluginError,
  pluginLog,
  onTogglePlugin,
  onReloadPlugins,
}: SettingsProps) {
  const [tab, setTab] = useState<TabId>('general')

  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={640}>
      <DialogHeader title="设置" />
      <DialogBody className="p-0">
        <div className="flex min-h-[360px]">
          <nav className="w-[132px] shrink-0 border-r border-border p-2">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-ui-sm px-2.5 py-1.5 text-xs transition-colors',
                  tab === id
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-y-auto p-4">
            {tab === 'general' ? (
              <>
                <SectionTitle>笔记库</SectionTitle>
                <Row label="当前库" hint={vault ?? '未选择 —— 选一个文件夹，里面的 .md 就是你的笔记'}>
                  <button
                    type="button"
                    onClick={onPickVault}
                    className="rounded-ui-sm border border-border-strong bg-background px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-accent"
                  >
                    切换…
                  </button>
                </Row>
                <Row
                  label="自动保存"
                  hint="停止编辑约 0.8 秒后自动落盘（原子写：临时文件 + rename）"
                />
                <Row
                  label="外观"
                  hint="「跟随系统」会随系统深浅色自动切换；选具体项则固定。"
                >
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
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Row>
              </>
            ) : null}

            {tab === 'plugins' ? (
              <PluginPanel
                plugins={plugins}
                error={pluginError}
                log={pluginLog}
                onToggle={onTogglePlugin}
                onReload={onReloadPlugins}
              />
            ) : null}

            {tab === 'about' ? (
              <>
                <SectionTitle>版本</SectionTitle>
                <Row label="ZeroNote" hint={appVersion ?? '0.1.0'} />
                <Row label="内核契约" hint={apiVersion ?? '—'} />
                <Row label="运行平台" hint={platform ?? '—'} />
                <SectionTitle>内核只做四件事</SectionTitle>
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                  <b className="text-foreground">.md 读写</b> · <b className="text-foreground">编辑</b> ·{' '}
                  <b className="text-foreground">本地存储</b> ·{' '}
                  <b className="text-foreground">插件宿主</b>
                  <br />
                  其余能力（标签、同步、AI、画布…）全部由插件提供，内核不认识这些词。
                </div>
              </>
            ) : null}
          </div>
        </div>
      </DialogBody>
    </Dialog>
  )
}
