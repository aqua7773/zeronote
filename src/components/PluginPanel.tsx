import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, History, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/dialog'
import { clampText } from '../lib/format'
import { MarketPane } from './MarketPane'
import { PluginDevPane } from './PluginDevPane'
import { tryGlobalPluginRoot } from '../kernel/plugin-roots'
import {
  formatBytes,
  formatVersionTime,
  listPluginVersions,
  rollbackPlugin,
  type PluginVersionEntry,
  type PluginVersionsState,
} from '../kernel/plugin-versions'
import type { MarketEntry } from '../kernel/market'
import type { CapabilityName, CapabilityStatus, PluginLogEntry } from '../kernel/contract'
import type { KernelAudit } from '../kernel/kernel'
import { CAPABILITY_LABELS } from '../kernel/capability'
import {
  PLUGIN_CATEGORY_HINT,
  PLUGIN_CATEGORY_LABEL,
  PLUGIN_CATEGORY_ORDER,
  isPluginCategory,
  type PluginCategory,
} from '../lib/plugin-category'
import { RECOMMENDED_COUNT, RECOMMENDED_GROUPS } from '../lib/recommended-plugins'

/**
 * 插件中心（M2；B3 从设置页独立成页）—— 「装上出现 / 卸下消失」的可视化开关。
 *
 * 注意：**进程内插件没有沙箱**（契约 §4）——所以这里把 capability 明明白白列出来，
 * 让用户知道这个插件能看到/改动什么。
 *
 * **删除**（2026-10-12 加）：二次确认后**直接删目录**，不进回收站。
 * 理由是插件属于"把目录拷回来就能重装"的东西；回收站那套 `<时间戳>--<文件名>`
 * 命名是为 `.md` 设计的，硬塞目录进去反而没人看得懂、也没人会去手工恢复。
 */
export type PluginRow = {
  id: string
  name: string
  version: string
  description?: string
  enabled: boolean
  capabilities: string[]
  /**
   * 插件来源（2026-10-17 rev94）：
   *  - `global` —— 全局插件根（`appDataDir()`），**换库也还在**；
   *  - `vault`  —— 当前库自己的 `.zn/plugins/`，跟着库走。
   * 缺省按库内处理（旧数据 / 拿不到来源时）。
   */
  source?: 'global' | 'vault'
  /**
   * 入口完整性 / 签名（2026-10-18 rev119 · 2026-10-21 rev173.77）：
   * · `signed`   —— 有 `signature.json`，Ed25519 验签通过（**谁发布的**这一版）；
   * · `verified` —— manifest 带 `sha256` 且已比对通过（只证明**文件没坏**，谁都能算）；
   * · `none`     —— 既没签名也没 sha256（未校验，安装时也会提示）。
   */
  integrity?: 'signed' | 'verified' | 'none'
  /**
   * 平台不适用时的说明（如「不适用 · 仅桌面端」）。
   *
   * 有值 ⇒ 这个插件声明了 `manifest.platforms` 且与当前平台不符，**内核根本没加载它**。
   * 所以开关要禁用 —— 拨它不会有任何效果，让人拨一个无效开关比不给开关更糟。
   * 它**不是错误**：把桌面专属插件拷到手机上是很正常的操作，不该报红。
   */
  platformNote?: string
  /**
   * 被**启动自愈**关掉时的说明（如「因上次加载未完成已自动禁用」）。
   *
   * 来源：`zeronote.plugins.loading` 标记 —— 上次进程在加载它时死过（看门狗杀的或用户强杀）。
   * 与 `platformNote` 分开：那不是错误，**这**是"我替你关了它"，必须显眼且可一键恢复。
   */
  autoDisabledNote?: string
  /**
   * 分类（rev173.4）：插件页按它分组。
   * App 侧用 `categorizePlugin` 算好（manifest 的 `category` 优先，没写就推断）。
   */
  category?: PluginCategory
}

/** 插件页的说明最多显示 15 个字（用户 2026-10-19 要求；全文放悬停 title） */
const DESC_MAX = 15

/** 禁用一条插件后，撤销条最多挂多久（毫秒）—— 与删除笔记的撤销条同一心意：给一次后悔的机会 */
const UNDO_DISABLE_MS = 12_000

/** 分类折叠状态 —— 全局一份（插件本身就是全局的，不按库隔离） */
const COLLAPSED_KEY = 'zn-plugin-groups-collapsed'

function readCollapsed(): Set<PluginCategory> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return new Set()
    const arr: unknown = JSON.parse(raw)
    return Array.isArray(arr) ? new Set(arr.filter(isPluginCategory)) : new Set()
  } catch {
    // 记录坏了就按全展开算 —— 折叠状态不值得让插件页打不开
    return new Set()
  }
}

function writeCollapsed(next: Set<PluginCategory>) {
  try {
    if (next.size === 0) localStorage.removeItem(COLLAPSED_KEY)
    else localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
  } catch {
    // 配额满 / 隐私模式：不持久也要能用
  }
}

export function PluginPanel({
  plugins,
  error,
  logs,
  globalRoot,
  onToggle,
  onDelete,
  onInstall,
  onMarketInstall,
  updates,
  audit,
  devMode = false,
  onToggleDevMode,
  onReloadPlugins,
  onReloadPlugin,
  onEmitEvent,
  onClearLogs,
  onTestLog,
  panels = [],
  onOpenPanel,
  capabilities = [],
  onCapabilityChoice,
}: {
  plugins: PluginRow[]
  error?: string | null
  /** 结构化插件日志（rev173.229）—— 调试 tab 与底部折叠区共用 */
  logs?: PluginLogEntry[]
  /** 全局插件根（`appDataDir()`）—— 空态与列表底部都要告诉用户"拷到哪能全库生效" */
  globalRoot?: string | null
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  /** 安装 `.znp` 插件包（rev119）—— 空态与列表都能看到入口 */
  onInstall?: () => void
  /**
   * 从市场安装 / 更新（rev173.148）—— App 传 hook 的实现：下载 + 整包 sha256 + 解包 + 重扫，
   * 在 Rust 侧一次完成（失败不落盘）。不传 ⇒ 不显示「插件市场」tab（独立窗口 / 测试环境）。
   */
  onMarketInstall?: (entry: MarketEntry) => Promise<string | null>
  /**
   * 可更新项（rev173.156）：`{ [插件 id]: 索引里的最新版本 }`。
   *
   * 来自 App 的 24h 节流检查（只查、只标角标，**不下载不安装**）。
   * 缺省 / 空对象 ⇒ 不显示任何「可更新」提示。
   */
  updates?: Record<string, string>
  /**
   * 调试面板数据源（rev173.229 · 需求 §2.13）：`kernel.audit()` 的快照。
   * 不传 ⇒ 不显示「调试」tab（独立窗口 / 测试环境）。
   */
  audit?: KernelAudit | null
  /** 开发者模式（localStorage，由 App 持有）—— 关着时调试 tab 只显示一个开关 */
  devMode?: boolean
  onToggleDevMode?: (on: boolean) => void
  /** 重载全部插件（就是 `setReloadToken` bump 一次） */
  onReloadPlugins?: () => void
  /** 只重载一个插件（rev173.240 · 调试面板的单插件热重载） */
  onReloadPlugin?: (id: string) => Promise<void>
  /** 模拟触发：把 topic + payload 交给内核 event.emit；返回错误文案或 null */
  onEmitEvent?: (topic: string, payload: unknown) => string | null
  /** 清空日志 */
  onClearLogs?: () => void
  /** 写一条测试日志（验证日志面板与堆栈展开） */
  onTestLog?: () => void
  /**
   * 各插件注册的**页面面板**（B1）—— 行内「打开」按钮用。
   * 菜单不再列插件面板（方案 §4 规则 2），入口改到这里 + 命令面板；
   * B3 的插件中心会接管这块。
   */
  panels?: { id: string; title: string; pluginId?: string; location?: string }[]
  /** 打开某个面板（App 的 `setMainView(panelId)`） */
  onOpenPanel?: (id: string) => void
  /**
   * 核心能力接管状态（B3 · 需求 §2.15）—— **从设置页迁来**。
   * 不传 / 空数组 ⇒ 不显示「核心能力」块（独立窗口 / 测试环境）。
   */
  capabilities?: CapabilityStatus[]
  /** 同优先级冲突时记住用户的选择（`null` = 清除记忆，回到最早登记的） */
  onCapabilityChoice?: (name: CapabilityName, pluginId: string | null) => void
}) {
  /** 待确认删除的插件（null = 没有确认框） */
  const [pending, setPending] = useState<PluginRow | null>(null)
  /**
   * 版本记录对话框（rev173.230 · 需求 §2.14）。
   *
   * `versionFor` = 给哪个插件看（null = 关着）；`versionState` = 现查的版本列表
   * （**不缓存** —— 回滚完立刻重查，免得界面与磁盘对不上）。
   */
  const [versionFor, setVersionFor] = useState<PluginRow | null>(null)
  const [versionState, setVersionState] = useState<PluginVersionsState | null>(null)
  const [versionBusy, setVersionBusy] = useState(false)
  const [versionNote, setVersionNote] = useState<string | null>(null)
  /** 代际降级：Rust 返回 `needConfirm` 时的待确认项（磁盘这时还没动） */
  const [versionConfirm, setVersionConfirm] = useState<{
    entry: PluginVersionEntry
    reason: string
  } | null>(null)
  /** 当前 tab（rev173.148 / B3 改名）：已安装 / 插件市场 / 调试（rev173.229，仅开发者模式） */
  const [tab, setTab] = useState<'installed' | 'discover' | 'dev'>('installed')
  /** 删除的是不是全局那份 —— 决定确认框里说哪个路径 */
  const pendingIsGlobal = pending?.source === 'global'

  /**
   * 刚被禁用、还能撤销的那一条（B3 · 方案 §6 验收「禁用插件可撤销」）。
   *
   * 只记**用户刚拨掉的那一个**：插件中心的开关是即时生效的（会重建内核），
   * 拨错一次就得翻列表拨回来；给一条 12 秒的撤销条，代价最小。
   */
  const [lastDisabled, setLastDisabled] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (!lastDisabled) return
    const t = window.setTimeout(() => setLastDisabled(null), UNDO_DISABLE_MS)
    return () => window.clearTimeout(t)
  }, [lastDisabled])

  /** 开关包装：禁用时记下撤销项；重新启用 / 撤销都把它清掉 */
  const toggleWithUndo = (p: PluginRow, enabled: boolean) => {
    onToggle(p.id, enabled)
    if (!enabled) setLastDisabled({ id: p.id, name: p.name })
    else setLastDisabled((prev) => (prev?.id === p.id ? null : prev))
  }

  /** 正在为哪个核心能力挑提供者（null = 对话框关着）—— 从设置页迁来（B3） */
  const [pickFor, setPickFor] = useState<CapabilityName | null>(null)
  const pickStatus = pickFor ? capabilities.find((c) => c.name === pickFor) : null

  /**
   * 折叠的分类（2026-10-19 用户「插件分类加折叠功能」）。
   *
   * 默认全展开 —— 与升级前观感一致；折叠状态全局记 1 份（插件不分库）。
   * 用 state + effect 落盘：不在 setState updater 里写 localStorage
   * （开发模式 updater 可能被调用两次，副作用放外面更稳）。
   */
  const [collapsed, setCollapsed] = useState<Set<PluginCategory>>(readCollapsed)

  useEffect(() => {
    writeCollapsed(collapsed)
  }, [collapsed])

  const toggleGroup = (cat: PluginCategory) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  /**
   * 打开「版本记录」（rev173.230）。
   *
   * 插件只有全局一份 ⇒ 版本存档也只在全局根里（`appDataDir()`），
   * 所以这里直接用 `tryGlobalPluginRoot()` 而不是插件行上的 `source`。
   */
  const openVersions = async (p: PluginRow) => {
    setVersionFor(p)
    setVersionState(null)
    setVersionNote(null)
    setVersionConfirm(null)
    try {
      const root = await tryGlobalPluginRoot()
      if (!root) {
        setVersionNote('拿不到应用数据目录，无法读取版本记录')
        return
      }
      setVersionState(await listPluginVersions(root, p.id))
    } catch (e) {
      setVersionNote(`读取版本记录失败：${String(e)}`)
    }
  }

  /** 重查版本列表（回滚后）—— 缓存会让界面显示过期条目 */
  const refreshVersions = async (p: PluginRow) => {
    const root = await tryGlobalPluginRoot()
    if (root) setVersionState(await listPluginVersions(root, p.id))
  }

  /**
   * 回滚到某份存档。
   *
   * 两段式：`force: false` 先问 Rust「这个回滚会不会降级数据代际」——
   * 会的话返回 `needConfirm`、**磁盘不动**；用户在对话框里选「仍要回滚」再带 `force: true`。
   */
  const doRollback = async (p: PluginRow, entry: PluginVersionEntry, force: boolean) => {
    setVersionBusy(true)
    setVersionNote(null)
    try {
      const root = await tryGlobalPluginRoot()
      if (!root) throw new Error('拿不到应用数据目录')
      const r = await rollbackPlugin(root, p.id, entry.stamp, force)
      if (r.status === 'needConfirm') {
        setVersionConfirm({ entry, reason: r.reason })
        return
      }
      setVersionConfirm(null)
      setVersionNote(
        `已回滚：v${r.fromVersion || '?'} → v${r.toVersion}` +
          (r.storeRestored ? '（数据也回退到该版本快照）' : '') +
          (r.warning ? ` · ${r.warning}` : ''),
      )
      onReloadPlugins?.()
      await refreshVersions(p)
    } catch (e) {
      setVersionNote(`回滚失败：${String(e)}`)
    } finally {
      setVersionBusy(false)
    }
  }

  /**
   * 有几个插件在市场里有新版本（rev173.156）。
   *
   * 只数**真装着的**：`updates` 是索引算出来的，可能还留着已经删掉的插件 id ——
   * 直接 `Object.keys(updates).length` 会把它们也算进去，角标就永远归零不了。
   */
  const updateCount = useMemo(
    () => plugins.filter((p) => updates?.[p.id]).length,
    [plugins, updates],
  )

  /**
   * 按分类分组（rev173.4 · 用户「插件越来越多了，开始做插件分类存放」）。
   *
   * 空组不画（只装了 3 个插件却铺 5 个标题会很吵）；组内保持 App 给的顺序
   * （manifest 列表本身按目录名排）。分类只影响展示，不影响加载 / 安装路径。
   */
  const groups = useMemo(() => {
    const byCat = new Map<PluginCategory, PluginRow[]>()
    for (const p of plugins) {
      const cat = p.category ?? 'tool'
      const list = byCat.get(cat)
      if (list) list.push(p)
      else byCat.set(cat, [p])
    }
    return PLUGIN_CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      label: PLUGIN_CATEGORY_LABEL[c],
      hint: PLUGIN_CATEGORY_HINT[c],
      rows: byCat.get(c) ?? [],
    }))
  }, [plugins])

  return (
    <div className="zn-plugins">
      {/* 这里原本有一条「插件」标题栏 + 重新扫描按钮 + 下横线。
          用户要求去掉标题和横线，扫描按钮挪到主区顶栏（见 App 的 .zn-main-panel-bar）。 */}
      {error && <div className="zn-plugins-error">⚠ {error}</div>}

      {/* tab（rev173.148；B3 改名）：已安装 / 插件市场 / 调试（rev173.229） */}
      {(onMarketInstall || audit) && (
        <div className="zn-plugins-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'installed'}
            className={`zn-plugins-tab${tab === 'installed' ? ' is-active' : ''}`}
            onClick={() => setTab('installed')}
          >
            已安装 <span className="zn-plugins-tab-count">{plugins.length}</span>
            {updateCount > 0 && (
              <span
                className="zn-plugin-update-count"
                title={`${updateCount} 个插件在市场里有新版本（不会自动升级，去「插件市场」里手动更新）`}
              >
                ↑ {updateCount}
              </span>
            )}
          </button>
          {onMarketInstall && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'discover'}
              className={`zn-plugins-tab${tab === 'discover' ? ' is-active' : ''}`}
              onClick={() => setTab('discover')}
            >
              插件市场
            </button>
          )}
          {audit && (
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'dev'}
              className={`zn-plugins-tab${tab === 'dev' ? ' is-active' : ''}`}
              onClick={() => setTab('dev')}
            >
              调试
              {devMode && <span className="zn-plugins-tab-count">{plugins.filter((p) => p.enabled).length}</span>}
            </button>
          )}
        </div>
      )}

      {tab === 'dev' && audit && (
        <PluginDevPane
          plugins={plugins}
          logs={logs ?? []}
          audit={audit}
          devMode={devMode}
          onToggleDevMode={(on) => onToggleDevMode?.(on)}
          onReload={() => onReloadPlugins?.()}
          onReloadOne={onReloadPlugin}
          onEmit={(topic, payload) =>
            onEmitEvent ? onEmitEvent(topic, payload) : '宿主没有提供 event.emit'
          }
          onClearLogs={onClearLogs}
          onTestLog={onTestLog}
        />
      )}

      {tab === 'discover' && onMarketInstall && (
        <MarketPane
          installed={plugins}
          onInstall={onMarketInstall}
          onSwitchToInstalled={() => setTab('installed')}
        />
      )}

      {tab === 'installed' && (
        <>
      {/* 已装插件时：顶部一条动作行。空态自己带按钮组（同一套动作不重复画两次）。 */}
      {plugins.length > 0 && (
        <div className="zn-plugins-actions">
          {/* 安装 .znp（2026-10-18 rev119）：确认框会列出它自称要的能力与签名状态 */}
          <Button onClick={() => onInstall?.()}>安装插件包（.znp）…</Button>
          {onMarketInstall && (
            <Button variant="secondary" onClick={() => setTab('discover')}>
              浏览插件市场
            </Button>
          )}
        </div>
      )}

      {/* 核心能力接管（需求 §2.15 · rev173.231）—— B3 从设置页迁来，插件的事留在插件中心 */}
      {capabilities.length > 0 && (
        <details className="zn-capability-box">
          <summary>
            核心能力 · {capabilities.filter((c) => c.active !== 'kernel').length} 项被插件接管
            {capabilities.some((c) => c.needsChoice) && (
              <span className="zn-capability-need">有同优先级冲突，请选择</span>
            )}
          </summary>
          <div className="zn-capability-list">
            <p className="zn-capability-hint">
              插件启用即接管、禁用即回退本体。多个插件同时提供时按优先级选；同级由你决定，选择会记住。
            </p>
            {capabilities.map((c) => (
              <div key={c.name} className="zn-capability-row">
                <div className="zn-capability-meta">
                  <span className="zn-capability-label">{CAPABILITY_LABELS[c.name] ?? c.name}</span>
                  <code className="zn-capability-name">{c.name}</code>
                  <span className="zn-capability-active">
                    {c.active === 'kernel' ? '本体' : c.active}
                  </span>
                  {c.needsChoice && <span className="zn-capability-warn">同级冲突</span>}
                </div>
                {c.providers.length > 0 && (
                  <button type="button" className="zn-plain-btn" onClick={() => setPickFor(c.name)}>
                    选择…
                  </button>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {plugins.length === 0 ? (
        <div className="zn-plugins-empty">
          <div className="zn-plugins-empty-title">还没有安装插件</div>
          <p className="zn-plugins-empty-text">
            ZeroNote 的内核只做四件事，其余能力都由插件加进来 —— 标签、反向链接、历史版本、同步、AI。
            装错了随时可以禁用或删除，不会动你的笔记。
          </p>
          <div className="zn-plugins-empty-actions">
            <Button onClick={() => onInstall?.()}>安装插件包（.znp）…</Button>
            {onMarketInstall && (
              <Button variant="secondary" onClick={() => setTab('discover')}>
                浏览插件市场
              </Button>
            )}
          </div>
          {onMarketInstall && (
            <div className="zn-plugins-recommend">
              <div className="zn-plugins-recommend-title">
                推荐优先安装（{RECOMMENDED_COUNT} 个）
              </div>
              <p className="zn-plugins-recommend-hint">
                应用不预装插件 —— 这些原来是随包带的，现在从
                <strong className="font-semibold text-foreground">插件市场</strong> 装（需要联网；
                离线时也可以用「安装插件包」装 <code>.znp</code>）。
              </p>
              {RECOMMENDED_GROUPS.map((g) => (
                <div key={g.title} className="zn-plugins-recommend-group">
                  <div className="zn-plugins-recommend-sub">
                    {g.title}
                    {g.hint ? (
                      <span className="zn-plugins-recommend-subhint">{g.hint}</span>
                    ) : null}
                  </div>
                  <ul className="zn-plugins-recommend-list">
                    {g.items.map((r) => (
                      <li key={r.id}>
                        <span className="zn-plugins-recommend-name">{r.name}</span>
                        <span className="zn-plugins-recommend-why">{r.why}</span>
                        <button
                          type="button"
                          className="zn-plain-btn"
                          onClick={() => setTab('discover')}
                          title={`在「插件市场」里找 ${r.name}（索引里叫 ${r.id}）`}
                        >
                          去安装
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="zn-plugins-empty-hint">
            也可以把插件文件夹放到 <code>{globalRoot ?? '<应用数据目录>'}</code> 下的{' '}
            <code>.zn/plugins/&lt;id&gt;/</code>，点「重新扫描」。
          </p>
        </div>
      ) : (
        <div className="zn-plugin-list">
          {groups.map((g) => (
            <section
              className={`zn-plugin-group${collapsed.has(g.category) ? ' is-collapsed' : ''}`}
              key={g.category}
            >
              <button
                type="button"
                className="zn-plugin-group-head"
                title={g.hint}
                aria-expanded={!collapsed.has(g.category)}
                onClick={() => toggleGroup(g.category)}
              >
                <ChevronDown size={14} className="zn-plugin-group-chevron" aria-hidden="true" />
                {g.label}
                <span className="zn-plugin-group-count">{g.rows.length}</span>
              </button>
              {!collapsed.has(g.category) && g.rows.map((p) => (
            <div className="zn-plugin-row" key={p.id}>
              <input
                type="checkbox"
                className="zn-plugin-switch"
                checked={p.enabled}
                disabled={!!p.platformNote}
                title={
                  p.platformNote
                    ? '这个插件声明了只支持特定平台，当前平台不加载它'
                    : undefined
                }
                onChange={(e) => toggleWithUndo(p, e.target.checked)}
                aria-label={`启用 ${p.name}`}
              />
              <div className="zn-plugin-meta">
                <div className="zn-plugin-name">
                  {p.name} <span className="zn-plugin-ver">v{p.version}</span>
                  {p.platformNote && (
                    <span className="zn-plugin-ver"> {p.platformNote}</span>
                  )}
                  {/* 可更新角标（rev173.156）：来自 24h 节流检查，点它不会自动升级 */}
                  {updates?.[p.id] && (
                    <span
                      className="zn-plugin-update"
                      title={`市场里有 v${updates[p.id]}，去「插件市场」tab 手动更新（不会自动升级）`}
                    >
                      ↑ 可更新 v{updates[p.id]}
                    </span>
                  )}
                  {p.integrity === 'signed' ? (
                    <span
                      className="zn-plugin-source"
                      title="有 signature.json 且 Ed25519 验签通过（证明这一版是谁发布的）"
                    >
                      已签名
                    </span>
                  ) : p.integrity === 'verified' ? (
                    <span
                      className="zn-plugin-source"
                      title="manifest 带 sha256，加载时已比对入口文件（只证明文件没坏，不是签名）"
                    >
                      已校验
                    </span>
                  ) : (
                    <span
                      className="zn-plugin-ver"
                      title="既没有签名也没有 sha256：内核不校验入口文件（本地自用可以，分发请签名）"
                    >
                      未签名
                    </span>
                  )}
                  {/* 卡死兜底 C 段：被启动自愈关掉的 —— 用醒目色，别让它看起来像普通备注 */}
                  {p.autoDisabledNote && (
                    <span className="zn-plugin-autodisabled"> {p.autoDisabledNote}</span>
                  )}
                </div>
                {p.description && (
                  <div className="zn-plugin-desc" title={p.description}>
                    {clampText(p.description, DESC_MAX)}
                  </div>
                )}
              </div>
              <button
                type="button"
                className="zn-plugin-hist"
                onClick={() => void openVersions(p)}
                title={`版本记录 / 回滚（当前 v${p.version}，最多保留 3 份旧版）`}
                aria-label={`查看 ${p.name} 的版本记录`}
              >
                <History size={14} />
              </button>
              {/* 打开面板（B1）：菜单不再列插件面板，这里是主入口之一（另一个是命令面板）。
                  没有任何页面面板的插件不渲染这个按钮（不留灰位）。 */}
              {(() => {
                const own = panels.filter(
                  (pn) =>
                    pn.pluginId === p.id &&
                    pn.location !== 'statusbar' &&
                    pn.location !== 'modal' &&
                    pn.location !== 'editor-toolbar' &&
                    pn.location !== 'editor-topbar',
                )
                const first = own[0]
                if (!first || !onOpenPanel) return null
                return (
                  <button
                    type="button"
                    className="zn-plugin-hist"
                    onClick={() => onOpenPanel(first.id)}
                    title={
                      own.length > 1
                        ? `打开「${first.title}」（本插件共 ${own.length} 个面板，其余在命令面板）`
                        : `打开「${first.title}」`
                    }
                    aria-label={`打开 ${first.title}`}
                  >
                    <ChevronRight size={14} />
                  </button>
                )
              })()}
              <button
                type="button"
                className="zn-plugin-del"
                onClick={() => setPending(p)}
                title="删除插件"
                aria-label={`删除插件 ${p.name}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
              ))}
            </section>
          ))}
        </div>
      )}
        </>
      )}

      {logs && logs.length > 0 && (
        <details className="zn-plugins-log">
          <summary>插件日志（{logs.length}）</summary>
          <pre>
            {logs
              .slice(-50)
              .map((l) => {
                const t = new Date(l.ts)
                const p = (n: number) => String(n).padStart(2, '0')
                return `${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())} [${l.level}] ${l.pluginId ?? '内核'} ${l.msg}`
              })
              .join('\n')}
          </pre>
        </details>
      )}

      {/* 全局插件根：告诉用户"拷到哪能全库生效"，且让"本库插件"有对照物（rev94） */}
      {globalRoot && (
        <div className="zn-plugins-globalroot">
          插件目录：<code>{globalRoot}</code> 下的 <code>.zn/plugins/</code>
          <span className="zn-plugins-globalroot-hint"> 所有笔记库共用这一份</span>
        </div>
      )}

      {/* 禁用撤销条（B3 · 方案 §6 验收「禁用插件可撤销」）——
          开关即时生效，拨错一次不该只能再翻一遍列表拨回来。条子在列表下方、随内容流，
          不与 App 底部那条 fixed 撤销条抢位置。 */}
      {lastDisabled && (
        <div className="zn-plugin-undo" role="status">
          <span>
            已禁用「{lastDisabled.name}」
          </span>
          <button
            type="button"
            className="zn-undo-btn"
            onClick={() => {
              onToggle(lastDisabled.id, true)
              setLastDisabled(null)
            }}
          >
            撤销
          </button>
          <button
            type="button"
            className="zn-plugin-undo-close"
            aria-label="关闭撤销条"
            onClick={() => setLastDisabled(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* 同优先级冲突：让用户选一个并记住（需求 §2.15）—— B3 从设置页迁来 */}
      <Dialog
        open={pickFor !== null}
        onOpenChange={(next) => {
          if (!next) setPickFor(null)
        }}
        width={420}
      >
        <DialogHeader
          title="选择核心能力的实现"
          description={pickFor ? CAPABILITY_LABELS[pickFor] : undefined}
        />
        <DialogBody>
          <p className="text-xs leading-relaxed text-muted-foreground">
            同优先级的插件只能有一个生效；选中的那个会被记住。插件被禁用 / 卸载后自动回到本体。
          </p>
          <div className="zn-capability-pick">
            {(pickStatus?.top ?? []).map((c) => (
              <button
                key={c.pluginId}
                type="button"
                className={`zn-capability-pick-row${c.chosen ? ' is-active' : ''}`}
                onClick={() => {
                  if (pickFor) onCapabilityChoice?.(pickFor, c.pluginId)
                  setPickFor(null)
                }}
              >
                <span className="zn-capability-pick-id">{c.pluginId}</span>
                <span className="zn-capability-pick-pri">优先级 {c.priority}</span>
                {c.chosen && <span className="zn-capability-pick-now">当前</span>}
              </button>
            ))}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              if (pickFor) onCapabilityChoice?.(pickFor, null)
              setPickFor(null)
            }}
          >
            清除记忆
          </Button>
          <Button variant="ghost" size="md" onClick={() => setPickFor(null)}>
            关闭
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        width={380}
      >
        <DialogHeader
          title="删除这个插件？"
          description={pending ? `${pending.name} v${pending.version}` : undefined}
        />
        <DialogBody>
          <p className="text-xs leading-relaxed text-muted-foreground">
            删掉插件目录{' '}
            <code>
              {pendingIsGlobal ? (globalRoot ?? '全局插件根') : '<当前库>'} 下的 .zn/plugins/
              {pending?.id ?? ''}
            </code>
            （含 manifest 与 store.json），
            <strong className="font-semibold text-foreground">不可撤销</strong>
            ；要装回来重新拷回即可。
            {pendingIsGlobal && ' 这是全局插件，所有笔记库都不再有它。'}
          </p>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={() => setPending(null)}>
            取消
          </Button>
          <Button
            variant="danger"
            size="md"
            onClick={() => {
              if (pending) onDelete(pending.id)
              setPending(null)
            }}
          >
            删除
          </Button>
        </DialogFooter>
      </Dialog>

      {/* 版本记录 / 回滚（rev173.230 · 需求 §2.14） */}
      <Dialog
        open={versionFor !== null}
        onOpenChange={(next) => {
          if (!next) {
            setVersionFor(null)
            setVersionConfirm(null)
          }
        }}
        width={460}
      >
        <DialogHeader
          title="版本记录"
          description={
            versionFor
              ? `${versionFor.name} · 当前 v${versionState?.current?.version ?? versionFor.version}`
              : undefined
          }
        />
        <DialogBody>
          <p className="text-xs leading-relaxed text-muted-foreground">
            每次安装 / 更新前会把旧版本整份存档（最多留 3 份）。回滚前会先把当前{' '}
            <code>store.json</code> 备份到
            <code>.zn/plugin-versions/&lt;id&gt;/_backup/</code>。
          </p>

          {versionNote && <p className="zn-plugin-version-note">{versionNote}</p>}

          {versionConfirm && (
            <div className="zn-plugin-version-warn" role="alert">
              <div className="zn-plugin-version-warn-text">
                {versionConfirm.reason}
                <br />
                确认后才会动数据（会先把当前 store.json 备份）；现在取消则什么都不改。
              </div>
              <div className="zn-plugin-version-warn-actions">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setVersionConfirm(null)
                    setVersionNote('已取消，什么都没改')
                  }}
                >
                  取消
                </Button>
                <Button
                  variant="danger"
                  size="md"
                  disabled={versionBusy}
                  onClick={() => {
                    if (versionFor) void doRollback(versionFor, versionConfirm.entry, true)
                  }}
                >
                  仍要回滚
                </Button>
              </div>
            </div>
          )}

          {!versionState ? (
            <p className="text-xs text-muted-foreground">{versionNote ? '' : '读取中…'}</p>
          ) : versionState.versions.length === 0 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              还没有历史版本 —— 从下一次安装 / 更新开始存档。
            </p>
          ) : (
            <ul className="zn-plugin-version-list">
              {versionState.versions.map((v) => (
                <li key={v.stamp} className="zn-plugin-version-row">
                  <div className="zn-plugin-version-meta">
                    <span className="zn-plugin-version-ver">v{v.version || '?'}</span>
                    <span className="zn-plugin-version-time">
                      {formatVersionTime(v.installedAt)}
                    </span>
                    <span className="zn-plugin-version-size">{formatBytes(v.sizeBytes)}</span>
                    {v.hasStore && (
                      <span
                        className="zn-plugin-version-tag"
                        title="存档里有这个版本当时的 store.json（插件数据快照）"
                      >
                        含数据
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="md"
                    disabled={versionBusy}
                    onClick={() => {
                      if (versionFor) void doRollback(versionFor, v, false)
                    }}
                  >
                    回滚
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={() => setVersionFor(null)}>
            关闭
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
