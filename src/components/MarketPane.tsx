import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/dialog'
import {
  DEFAULT_MARKET_INDEX_URL,
  MARKET_INDEX_URL_KEY,
  fetchMarketIndex,
  marketAction,
  type MarketEntry,
  type MarketParseResult,
} from '../kernel/market'
import type { PluginRow } from './PluginPanel'

/**
 * **发现**（插件市场阶段 1 · rev173.148）。
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
  const [indexUrl, setIndexUrl] = useState(
    () => localStorage.getItem(MARKET_INDEX_URL_KEY)?.trim() || DEFAULT_MARKET_INDEX_URL,
  )
  const [draft, setDraft] = useState(indexUrl)
  const [data, setData] = useState<MarketParseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 用户点了「刷新」——只由事件处理器设置（effect 里同步 setState 会触发级联渲染，oxlint 也会报） */
  const [refreshing, setRefreshing] = useState(false)
  /** 正在下载 / 安装的插件 id */
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pending, setPending] = useState<MarketEntry | null>(null)

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
    localStorage.setItem(MARKET_INDEX_URL_KEY, next)
    setIndexUrl(next)
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
        <input
          className="zn-market-url"
          value={draft}
          spellCheck={false}
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
          disabled={loading}
          title="重新拉取索引"
          onClick={() => void refresh()}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : undefined} />
          {loading ? '拉取中' : '刷新'}
        </Button>
      </div>

      {error && <div className="zn-plugins-error">⚠ {error}</div>}

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
            )
          })}
        </div>
      )}

      <div className="zn-plugins-globalroot">
        插件来自索引里的下载地址；<strong>整包 sha256 对得上才安装</strong>
        ，有签名还会验签（不通过不落盘）。不会自动升级。
      </div>

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
