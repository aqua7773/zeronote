import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/dialog'
import { clampText } from '../lib/format'
import { MarketPane } from './MarketPane'
import type { MarketEntry } from '../kernel/market'
import {
  PLUGIN_CATEGORY_HINT,
  PLUGIN_CATEGORY_LABEL,
  PLUGIN_CATEGORY_ORDER,
  isPluginCategory,
  type PluginCategory,
} from '../lib/plugin-category'

/**
 * 插件管理面板（M2）—— 「装上出现 / 卸下消失」的可视化开关。
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
  log,
  globalRoot,
  onToggle,
  onDelete,
  onInstall,
  onMarketInstall,
}: {
  plugins: PluginRow[]
  error?: string | null
  log?: string[]
  /** 全局插件根（`appDataDir()`）—— 空态与列表底部都要告诉用户"拷到哪能全库生效" */
  globalRoot?: string | null
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
  /** 安装 `.znp` 插件包（rev119）—— 空态与列表都能看到入口 */
  onInstall?: () => void
  /**
   * 从市场安装 / 更新（rev173.148）—— App 传 hook 的实现：下载 + 整包 sha256 + 解包 + 重扫，
   * 在 Rust 侧一次完成（失败不落盘）。不传 ⇒ 不显示「发现」tab（独立窗口 / 测试环境）。
   */
  onMarketInstall?: (entry: MarketEntry) => Promise<string | null>
}) {
  /** 待确认删除的插件（null = 没有确认框） */
  const [pending, setPending] = useState<PluginRow | null>(null)
  /** 当前 tab（rev173.148）：已安装 / 发现（插件市场） */
  const [tab, setTab] = useState<'installed' | 'discover'>('installed')
  /** 删除的是不是全局那份 —— 决定确认框里说哪个路径 */
  const pendingIsGlobal = pending?.source === 'global'

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

      {/* 两个 tab（rev173.148）：「已安装」= 原来的列表；「发现」= 插件市场 */}
      {onMarketInstall && (
        <div className="zn-plugins-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'installed'}
            className={`zn-plugins-tab${tab === 'installed' ? ' is-active' : ''}`}
            onClick={() => setTab('installed')}
          >
            已安装 <span className="zn-plugins-tab-count">{plugins.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'discover'}
            className={`zn-plugins-tab${tab === 'discover' ? ' is-active' : ''}`}
            onClick={() => setTab('discover')}
          >
            发现
          </button>
        </div>
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
      {/* 安装 .znp（2026-10-18 rev119）：确认框会列出它自称要的能力与签名状态 */}
      <div style={{ display: 'flex', gap: 8, padding: '2px 0 10px' }}>
        <Button onClick={() => onInstall?.()}>安装插件包（.znp）…</Button>
      </div>

      {plugins.length === 0 ? (
        <div className="zn-plugins-empty">
          还没有插件。把插件文件夹放到 <code>{globalRoot ?? '<应用数据目录>'}</code> 下的{' '}
          <code>.zn/plugins/&lt;id&gt;/</code>，点「重新扫描」即可。
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
                onChange={(e) => onToggle(p.id, e.target.checked)}
                aria-label={`启用 ${p.name}`}
              />
              <div className="zn-plugin-meta">
                <div className="zn-plugin-name">
                  {p.name} <span className="zn-plugin-ver">v{p.version}</span>
                  {p.platformNote && (
                    <span className="zn-plugin-ver"> {p.platformNote}</span>
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

      {log && log.length > 0 && (
        <details className="zn-plugins-log">
          <summary>插件日志（{log.length}）</summary>
          <pre>{log.slice(-50).join('\n')}</pre>
        </details>
      )}

      {/* 全局插件根：告诉用户"拷到哪能全库生效"，且让"本库插件"有对照物（rev94） */}
      {globalRoot && (
        <div className="zn-plugins-globalroot">
          插件目录：<code>{globalRoot}</code> 下的 <code>.zn/plugins/</code>
          <span className="zn-plugins-globalroot-hint"> 所有笔记库共用这一份</span>
        </div>
      )}

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
    </div>
  )
}
