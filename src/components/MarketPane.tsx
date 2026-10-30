import { useEffect, useMemo, useState } from 'react'
import { Gauge, RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/dialog'
import {
  CUSTOM_MIRROR_ID,
  MARKET_MIRRORS,
  fetchMarketIndex,
  guessPackBase,
  loadMirror,
  marketAction,
  probeMirror,
  saveMirror,
  type MarketEntry,
  type MarketMirror,
  type MarketParseResult,
  type MirrorProbe,
} from '../kernel/market'
import type { PluginRow } from './PluginPanel'
import { capabilityLabels } from '../lib/capability-label'


/**
 * **插件市场**（原「发现」· 插件市场阶段 1 · rev173.148）。
 *
 * 只做三件事：拉索引 → 列出来 → 点安装。安装本身在宿主（`onInstall` → Rust
 * `install_znp_from_url`：下载 + 整包 sha256 + 解包一步到位，失败不落盘）。
 *
 * 三条刻意的取舍：
 *  1. **没有静默升级**：启动不检查、后台不下载。这里只有用户点了才动 ——
 *     插件能读任意文件、能 invoke 命令，换代码必须让人看见（调研 §6）。
 *  2. **索引地址可改**：本仓库现在是 private，raw 匿名拉不到；地址填在输入框里，
 *     换成任何可匿名访问的 `index.json`（将来的公开仓库 / 自建源 / 本机静态服务）都能用。
 *  3. **坏条目跳过要可见**：索引是 PR + 脚本合并的产物，一条脏数据不该让整页空白。
 */

function formatSize(bytes?: number): string | null {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return null
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 一条市场条目的详情（rev173.156）—— 不触发安装，只把信息摊开。
 *
 * 导出成独立组件是为了能直接单测：详情页最容易犯的错是「索引里没有的字段直接崩掉」，
 * 所以每个字段都要能缺失。
 */
export function MarketDetailBody({
  entry,
  installedVersion,
}: {
  entry: MarketEntry
  installedVersion?: string
}) {
  const caps = capabilityLabels(entry.capabilities)
  const size = formatSize(entry.size)
  const platforms = entry.platforms?.length ? entry.platforms.join(' + ') : null
  return (
    <div className="text-xs leading-relaxed text-muted-foreground">
      <p>
        {entry.category ? `${entry.category} · ` : ''}
        {platforms ?? '全平台'}
        {size ? ` · ${size}` : ''}
        {entry.apiVersion ? ` · 接口 ${entry.apiVersion}` : ''}
      </p>

      {entry.description && (
        <p className="mt-2 whitespace-pre-wrap text-foreground">{entry.description}</p>
      )}

      <div className="mt-3">
        <div className="font-medium text-foreground">自称需要</div>
        {caps.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
            {caps.map((c) => (
              <span key={c} className="zn-market-cap">
                {c}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 opacity-70">
            索引里没有这个字段（老索引或作者没写）—— 安装后可在插件列表看到。
          </p>
        )}
        <p className="mt-1 opacity-70">
          只是自述：插件与内核<strong className="font-semibold text-foreground">同权限运行</strong>
          ，内核不拦它做别的事。
        </p>
      </div>

      {installedVersion && (
        <p className="mt-3">
          已装 <span className="text-foreground">v{installedVersion}</span>
          {marketAction(entry, installedVersion) === 'update' ? '（索引里更新）' : '（已是最新）'}
        </p>
      )}

      <div className="mt-3">
        <div className="font-medium text-foreground">下载地址</div>
        <p className="mt-1 break-all opacity-80">{entry.url}</p>
        <p className="mt-1">
          sha256 <code className="break-all">{entry.sha256.slice(0, 16)}…</code>
          {entry.files?.length ? ` · 包内 ${entry.files.length} 个文件` : ''}
        </p>
      </div>
    </div>
  )
}

export function MarketPane({
  installed,
  onInstall,
  onSwitchToInstalled,
}: {
  /** 已装插件（只用到 id / version 判断「已安装 / 可更新」） */
  installed: PluginRow[]
  /** 下载 + 校验 + 安装 + 重扫（App 传 hook 里的实现）；返回装好的 id，失败返回 null */
  onInstall: (entry: MarketEntry) => Promise<string | null>
  /** 装完切回「已安装」tab —— 用户要能立刻看到「装上了」 */
  onSwitchToInstalled: () => void
}) {
  /** 当前镜像（rev173.194）：索引地址 + 包前缀成对，换源 = 一换全换 */
  const [mirror, setMirror] = useState<MarketMirror>(() => loadMirror())
  const [indexUrl, setIndexUrl] = useState(mirror.indexUrl)
  const [draft, setDraft] = useState(mirror.indexUrl)
  const [data, setData] = useState<MarketParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 用户点了「刷新」——只由事件处理器设置（effect 里同步 setState 会触发级联渲染，oxlint 也会报） */
  const [refreshing, setRefreshing] = useState(false)
  /** 测速结果（null = 没测过；数组按镜像顺序逐条追加，能边测边看） */
  const [probes, setProbes] = useState<MirrorProbe[] | null>(null)
  const [probing, setProbing] = useState(false)
  /** 正在下载 / 安装的插件 id */
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pending, setPending] = useState<MarketEntry | null>(null)
  /** 详情（rev173.156）：点某一条看它的完整信息，不触发安装 */
  const [detail, setDetail] = useState<MarketEntry | null>(null)

  const installedVersion = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of installed) m.set(p.id, p.version)
    return m
  }, [installed])

  /**
   * 首次进入 / 换索引地址时拉一次。
   *
   * 刻意**不调一个内部 load()**：那样 `setLoading(true)` 会在 effect 里同步执行
   * （级联渲染 + `react(set-state-in-effect)` 告警）。这里只在 promise 回落后 setState ——
   * 加载态由 `data === null && !error` 推导出来，不需要额外的 loading state。
   */
  useEffect(() => {
    let alive = true
    fetchMarketIndex(indexUrl).then(
      (r) => {
        if (!alive) return
        setData(r)
        setError(null)
      },
      (e) => {
        if (!alive) return
        setError(e instanceof Error ? e.message : String(e))
        setData(null)
      },
    )
    return () => {
      alive = false
    }
  }, [indexUrl])

  const loading = refreshing || (data === null && error === null)

  /** 换索引地址：写进 localStorage 并立刻重拉（输入框里的草稿不动，方便改错再改回） */
  const applyIndexUrl = () => {
    const next = draft.trim()
    if (!next || next === indexUrl) return
    // 手工改地址 = 自定义源：包前缀按同目录猜（猜错也只是装不上，sha256 会拦住）
    const custom: MarketMirror = {
      id: CUSTOM_MIRROR_ID,
      label: '自定义',
      indexUrl: next,
      packBase: guessPackBase(next),
    }
    setMirror(custom)
    saveMirror(custom)
    setIndexUrl(next)
  }

  /** 下拉换镜像：索引地址与包前缀一起换（rev173.194） */
  const switchMirror = (id: string) => {
    if (id === CUSTOM_MIRROR_ID) {
      const addr = draft.trim() || indexUrl
      const custom: MarketMirror = {
        id: CUSTOM_MIRROR_ID,
        label: '自定义',
        indexUrl: addr,
        packBase: guessPackBase(addr),
      }
      setMirror(custom)
      saveMirror(custom)
      setDraft(addr)
      setIndexUrl(addr)
      return
    }
    const next = MARKET_MIRRORS.find((m) => m.id === id)
    if (!next || next.indexUrl === indexUrl) {
      if (next) setMirror(next)
      return
    }
    setMirror(next)
    saveMirror(next)
    setDraft(next.indexUrl)
    setIndexUrl(next.indexUrl)
  }

  /** 测速：逐条串行测（并发会互相抢带宽，测出来的数没意义） */
  const probeAll = async () => {
    setProbing(true)
    setProbes([])
    const acc: MirrorProbe[] = []
    for (const m of MARKET_MIRRORS) {
      acc.push(await probeMirror(m))
      setProbes([...acc])
    }
    setProbing(false)
  }

  /** 「刷新」按钮：显式重拉（事件处理器里，可以同步 setState） */
  const refresh = async () => {
    setRefreshing(true)
    try {
      setData(await fetchMarketIndex(indexUrl))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setData(null)
    } finally {
      setRefreshing(false)
    }
  }

  const doInstall = async () => {
    const entry = pending
    if (!entry) return
    setPending(null)
    setBusyId(entry.id)
    try {
      const id = await onInstall(entry)
      if (id) onSwitchToInstalled()
    } finally {
      setBusyId(null)
    }
  }

  const entries = data?.entries ?? []
  const skipped = data?.skipped ?? []

  return (
    <div className="zn-market">
      <div className="zn-market-source">
        <select
          className="zn-market-mirror"
          value={mirror.id}
          onChange={(e) => switchMirror(e.target.value)}
          aria-label="市场镜像"
          title="索引与插件包走同一条源。当前网络哪条能通，点「测速」看。"
        >
          {MARKET_MIRRORS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          <option value={CUSTOM_MIRROR_ID}>自定义地址…</option>
        </select>
        <input
          className="zn-market-url"
          value={draft}
          spellCheck={false}
          readOnly={mirror.id !== CUSTOM_MIRROR_ID}
          placeholder="索引地址（market/index.json 的 http(s) 地址）"
          title="插件的「货架」就是这个 JSON。换仓库 / 换镜像 / 换成自己的源都改这里。"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyIndexUrl()
          }}
          onBlur={applyIndexUrl}
          aria-label="市场索引地址"
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={loading || probing}
          title="依次测各镜像：能不能拉到**真**索引（只看状态码会被错误页骗）"
          onClick={() => void probeAll()}
        >
          <Gauge size={16} />
          {probing ? '测速中' : '测速'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={loading || probing}
          title="重新拉取索引"
          onClick={() => void refresh()}
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : undefined} />
          {loading ? '拉取中' : '刷新'}
        </Button>
      </div>

      {probes && (
        <div className="zn-market-probes">
          {probes.map((p) => (
            <span key={p.id} className={`zn-market-probe ${p.ok ? 'is-ok' : 'is-bad'}`}>
              {MARKET_MIRRORS.find((m) => m.id === p.id)?.label ?? p.id}
              {' · '}
              {p.ok ? `${p.ms} ms · ${p.detail}` : p.detail}
            </span>
          ))}
          {probing && <span className="zn-market-probe">测速中…</span>}
        </div>
      )}

      {error && (
        <div className="zn-plugins-error">
          ⚠ {error}
          <div className="zn-market-hint">
            当前网络连不上这条源？点上面的「测速」，挑一条能通的再刷新。
          </div>
        </div>
      )}

      {skipped.length > 0 && (
        <div className="zn-market-skipped">
          索引里有 {skipped.length} 条被跳过：
          {skipped
            .slice(0, 3)
            .map((s) => `${s.id}（${s.reason}）`)
            .join('、')}
          {skipped.length > 3 && ' …'}
        </div>
      )}

      {!error && !loading && data && entries.length === 0 && (
        <div className="zn-plugins-empty">这个索引里没有可安装的插件。</div>
      )}


      {entries.length > 0 && (
        <div className="zn-plugin-list">
          {entries.map((e) => {
            const action = marketAction(e, installedVersion.get(e.id))
            const size = formatSize(e.size)
            const busy = busyId === e.id

            return (
              <div className="zn-plugin-row" key={e.id}>
                <div className="zn-plugin-meta">
                  <div className="zn-plugin-name">
                    {e.name} <span className="zn-plugin-ver">v{e.version}</span>

                    {e.author && <span className="zn-plugin-ver"> · {e.author}</span>}
                    {size && <span className="zn-plugin-ver"> · {size}</span>}
                    {installedVersion.get(e.id) && action === 'update' && (
                      <span className="zn-plugin-ver"> · 已装 v{installedVersion.get(e.id)}</span>
                    )}
                  </div>
                  {e.description && (
                    <div className="zn-plugin-desc" title={e.description}>
                      {e.description}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="查看详情（描述 / 能力自述 / 下载地址）"
                    onClick={() => setDetail(e)}
                  >
                    详情
                  </Button>
                  {action === 'installed' ? (
                    <span className="zn-market-done" title="已安装同一版本或更新版本">
                      已安装
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant={action === 'update' ? 'primary' : 'secondary'}
                      disabled={busy || busyId !== null}
                      onClick={() => setPending(e)}
                    >
                      {busy ? '下载中…' : action === 'update' ? `↑ 更新 ${e.version}` : '安装'}
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 来源说明已删（rev173.273 · 真人使用测试 #15「多余的说明」）：
          每次打开市场都摆一遍「来自下载地址 / sha256 对得上才装」，条目本身比这句话重要；
          详情弹窗里仍有「下载地址」一行可查。 */}

      {/* 详情（rev173.156）：装之前先把「它是什么、要什么、从哪来」摊开 */}
      <Dialog
        open={detail !== null}
        onOpenChange={(next) => {
          if (!next) setDetail(null)
        }}
        width={460}
      >
        <DialogHeader
          title={detail ? `${detail.name} v${detail.version}` : '插件详情'}
          description={detail?.author ? `作者 ${detail.author}` : undefined}
        />
        <DialogBody>
          {detail && (
            <MarketDetailBody entry={detail} installedVersion={installedVersion.get(detail.id)} />
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={() => setDetail(null)}>
            关闭
          </Button>
          {detail &&
            (() => {
              const action = marketAction(detail, installedVersion.get(detail.id))
              if (action === 'installed') return null
              return (
                <Button
                  variant={action === 'update' ? 'primary' : 'secondary'}
                  size="md"
                  disabled={busyId !== null}
                  onClick={() => {
                    const d = detail
                    setDetail(null)
                    setPending(d)
                  }}
                >
                  {action === 'update' ? `↑ 更新 ${detail.version}` : '安装'}
                </Button>
              )
            })()}
        </DialogFooter>
      </Dialog>

      <Dialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null)
        }}
        width={420}
      >
        <DialogHeader
          title="安装这个插件？"
          description={pending ? `${pending.name} v${pending.version}` : undefined}
        />
        <DialogBody>
          {pending && (
            <div className="text-xs leading-relaxed text-muted-foreground">
              <p>
                作者：{pending.author || '（未注明）'}
                {formatSize(pending.size) ? ` · 大小 ${formatSize(pending.size)}` : ''}
              </p>
              {pending.capabilities?.length ? (
                <p className="mt-2">
                  自称需要：
                  <span className="text-foreground">
                    {capabilityLabels(pending.capabilities).join('、')}
                  </span>
                </p>
              ) : null}
              <p className="mt-2 break-all opacity-80">{pending.url}</p>
              <p className="mt-2">
                安装前会核对<strong className="font-semibold text-foreground">整包 sha256</strong>
                ，包里有 <code>signature.json</code> 还会验签 —— 任一不过就
                <strong className="font-semibold text-foreground">不写入磁盘</strong>。
              </p>
              <p className="mt-2">
                插件与内核<strong className="font-semibold text-foreground">同权限运行</strong>
                ：它能看到你的笔记、也能发网络请求。装之前请确认你信任这个作者。
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="md" onClick={() => setPending(null)}>
            取消
          </Button>
          <Button variant="primary" size="md" onClick={() => void doInstall()}>
            安装
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  )
}
