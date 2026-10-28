/**
 * **附件同步面板**（rev173.238 · 附件同步期 4）。
 *
 * 需求（`docs/附件与同步-需求-2026-10-28.md` §5）：
 *   · 后端先做「本地共享文件夹」，再做 WebDAV（Git 不做）
 *   · 触发 = 用户主动 + **每次确认**（启动 / 保存 / 定时都不自动搬）
 *   · 链路 = 本地 → 云端临时 → 对端落地 → 引用改本地 → 云端删除
 *
 * 这一期把三件事放在一个面板里：**配置后端 / 上传待搬 / 接收并清理**。
 * 正文内的两个快捷入口（音视频「原文件不在本机 · 同步」、模式 B 图片「同步原图」）
 * 复用同一个 `landRelay` + `relinkRelay`，后续接线。
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { formatSize } from '../kernel/attachment'
import {
  cleanable,
  cleanupRelay,
  confirmText,
  hash16Of,
  landRelay,
  loadRelayConfig,
  loadRelayPending,
  loadRelayRemote,
  receivableIds,
  relinkRelay,
  relayStateLabel,
  relayStateOf,
  saveRelayConfig,
  uploadRelay,
  type RelayBackend,
  type RelayConfig,
  type RelayPendingItem,
  type RelayRemoteItem,
} from '../kernel/asset-relay'

type BackendKind = 'local-folder' | 'webdav'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export interface AssetRelayPanelProps {
  vault: string | null
}

export function AssetRelayPanel({ vault }: AssetRelayPanelProps) {
  const [config, setConfig] = useState<RelayConfig | null>(null)
  const [kind, setKind] = useState<BackendKind>('local-folder')
  const [root, setRoot] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [pending, setPending] = useState<RelayPendingItem[]>([])
  const [remote, setRemote] = useState<RelayRemoteItem[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refreshLocal = useCallback(async () => {
    if (!vault) return
    try {
      const local = await loadRelayPending(vault)
      setDeviceId(local.deviceId)
      setPending(local.items)
    } catch (e) {
      setError(errorText(e))
    }
  }, [vault])

  useEffect(() => {
    if (!vault) return
    let cancelled = false
    void (async () => {
      try {
        const cfg = await loadRelayConfig(vault)
        if (cancelled) return
        setConfig(cfg)
        if (cfg.backend) {
          setKind(cfg.backend.kind)
          if (cfg.backend.kind === 'local-folder') setRoot(cfg.backend.root)
          else {
            setBaseUrl(cfg.backend.baseUrl)
            setUsername(cfg.backend.username)
          }
        }
      } catch (e) {
        if (!cancelled) setError(errorText(e))
      }
      if (!cancelled) await refreshLocal()
    })()
    return () => {
      cancelled = true
    }
  }, [vault, refreshLocal])

  const currentBackend = (): RelayBackend | null => {
    if (kind === 'local-folder') {
      return root.trim() ? { kind: 'local-folder', root: root.trim() } : null
    }
    return baseUrl.trim()
      ? { kind: 'webdav', baseUrl: baseUrl.trim(), root: '', username: username.trim() }
      : null
  }

  const onSaveConfig = async () => {
    if (!vault) return
    const backend = currentBackend()
    if (!backend) {
      setError(kind === 'local-folder' ? '请填写共享目录的绝对路径' : '请填写 WebDAV 地址')
      return
    }
    setBusy('save')
    setError(null)
    setMessage(null)
    try {
      await saveRelayConfig(vault, backend, kind === 'webdav' ? password : null)
      const cfg = await loadRelayConfig(vault)
      setConfig(cfg)
      setPassword('')
      setMessage('搬运后端已保存')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const onRefreshRemote = async () => {
    if (!vault || !config?.backend) return
    setBusy('remote')
    setError(null)
    try {
      const r = await loadRelayRemote(vault)
      setRemote(r.items)
      // 不在这里写 message：它常被「上传 / 接收 / 清理」的结果紧跟着调用，
      // 会把这些结果提示冲掉（实测：接收成功后只看到「云端有 1 个文件」）。
      if (r.total === 0) setMessage(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const togglePick = (id: string) => {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedItems = pending.filter((it) => picked.has(it.id))

  const onUpload = async () => {
    if (!vault) return
    const items = selectedItems.filter((it) => relayStateOf(it, remote, deviceId) === 'local')
    if (items.length === 0) {
      setError('选中的文件没有可上传的（要么已上传，要么源文件不在本机）')
      return
    }
    if (!window.confirm(confirmText('upload', items))) return
    setBusy('upload')
    setError(null)
    setMessage(null)
    try {
      const r = await uploadRelay(vault, items.map((it) => it.id))
      const failed = r.items.filter((x) => !x.ok)
      setMessage(`已上传 ${r.uploaded} 个（${formatSize(r.totalBytes)}）${failed.length ? ` · ${failed.length} 个失败` : ''}`)
      if (failed.length > 0) setError(failed.map((f) => `${f.id}：${f.error ?? '未知错误'}`).join('\n'))
      setPicked(new Set())
      await refreshLocal()
      await onRefreshRemote()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const onLand = async () => {
    if (!vault) return
    const ids = receivableIds(pending, remote, deviceId)
    if (ids.length === 0) {
      setError('云端没有待接收的文件（先点「刷新云端」）')
      return
    }
    const items = pending.filter((it) => ids.includes(it.id))
    if (!window.confirm(confirmText('land', items))) return
    setBusy('land')
    setError(null)
    setMessage(null)
    try {
      const r = await landRelay(vault, ids)
      const ok = r.items.filter((x) => x.ok)
      let rewritten = 0
      for (const item of ok) {
        if (!item.original || !item.path) continue
        try {
          const rl = await relinkRelay(vault, item.original, item.path)
          rewritten += rl.hits
        } catch {
          /* 改写失败不影响已落地的文件本身；下面统一提示 */
        }
      }
      const failed = r.items.filter((x) => !x.ok)
      setMessage(
        `已落地 ${r.landed} 个（${formatSize(r.totalBytes)}）` +
          (rewritten > 0 ? ` · 改写引用 ${rewritten} 处` : ''),
      )
      if (failed.length > 0) setError(failed.map((f) => `${f.id}：${f.error ?? '未知错误'}`).join('\n'))
      await refreshLocal()
      await onRefreshRemote()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const onCleanup = async () => {
    if (!vault) return
    const hashes = cleanable(remote)
    if (hashes.length === 0) {
      setError('没有可清理的文件（对端还没落地）')
      return
    }
    const items = remote.filter((r) => hashes.includes(r.hash16))
    if (!window.confirm(confirmText('cleanup', items))) return
    setBusy('cleanup')
    setError(null)
    setMessage(null)
    try {
      const r = await cleanupRelay(vault)
      setMessage(`已清理 ${r.cleaned} 个云端临时文件${r.kept ? ` · 保留 ${r.kept} 个（对端未落地）` : ''}`)
      if (r.errors.length > 0) setError(r.errors.join('\n'))
      await onRefreshRemote()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  if (!vault) {
    return <div className="text-xs text-muted-foreground">先选一个笔记库</div>
  }

  const reload = config?.backend
  return (
    <div className="flex flex-col gap-3 text-xs">
      {/* ── 后端配置 ── */}
      <div className="rounded-ui-sm border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            云端临时区
          </span>
          <span className="text-[11px] text-muted-foreground">
            {config?.backend
              ? config.backend.kind === 'local-folder'
                ? '共享目录'
                : 'WebDAV'
              : '未配置'}
          </span>
        </div>
        <div className="mb-2 flex overflow-hidden rounded-ui-sm border border-border-strong">
          {(
            [
              ['local-folder', '共享目录'],
              ['webdav', 'WebDAV'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={`px-2.5 py-1 transition-colors ${
                kind === value
                  ? 'bg-primary zn-on-accent'
                  : 'bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {kind === 'local-folder' ? (
          <input
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            placeholder="共享目录绝对路径（如 D:/zn-relay，两台机指向同一个同步目录）"
            className="mb-2 w-full rounded-ui-sm border border-border-strong bg-background px-2 py-1 text-xs"
          />
        ) : (
          <div className="mb-2 flex flex-col gap-1.5">
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="WebDAV 地址（如 https://dav.jianguoyun.com/dav/）"
              className="w-full rounded-ui-sm border border-border-strong bg-background px-2 py-1 text-xs"
            />
            <div className="flex gap-1.5">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="用户名"
                className="w-1/2 rounded-ui-sm border border-border-strong bg-background px-2 py-1 text-xs"
              />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                placeholder={config?.hasPassword ? '密码已保存（留空不改）' : '密码'}
                className="w-1/2 rounded-ui-sm border border-border-strong bg-background px-2 py-1 text-xs"
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void onSaveConfig()}>
            {busy === 'save' ? '保存中…' : '保存'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || !reload}
            onClick={() => void onRefreshRemote()}
          >
            {busy === 'remote' ? '读取中…' : '刷新云端'}
          </Button>
          <span className="text-[11px] text-muted-foreground">设备 {deviceId?.slice(0, 8) ?? '—'}</span>
        </div>
      </div>

      {/* ── 本机文件 ── */}
      <div className="rounded-ui-sm border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            引用台账（{pending.length}）
          </span>
          <button
            type="button"
            className="zn-plain-btn"
            disabled={busy !== null}
            onClick={() => void onUpload()}
          >
            {busy === 'upload' ? '上传中…' : `上传选中（${selectedItems.length}）`}
          </button>
        </div>
        {pending.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">
            台账是空的 —— 插入超过 1 MiB 的图片 / 音视频后才会出现在这里
          </div>
        ) : (
          <ul className="flex max-h-[38vh] flex-col gap-1 overflow-y-auto">
            {pending.map((it) => {
              const state = relayStateOf(it, remote, deviceId)
              const name = it.original.split(/[\\/]/).pop() ?? it.original
              return (
                <li
                  key={it.id}
                  className="flex items-center gap-2 rounded-ui-sm px-1 py-0.5 hover:bg-accent/50"
                >
                  <input
                    type="checkbox"
                    checked={picked.has(it.id)}
                    onChange={() => togglePick(it.id)}
                    aria-label={`选择 ${name}`}
                  />
                  <span className="min-w-0 flex-1 truncate" title={it.original}>
                    {name}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{formatSize(it.size)}</span>
                  <span
                    className={`shrink-0 text-[11px] ${
                      state === 'local'
                        ? 'text-foreground'
                        : state === 'absent'
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                    }`}
                    title={hash16Of(it.id)}
                  >
                    {relayStateLabel(state)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* ── 云端 ── */}
      <div className="rounded-ui-sm border border-border p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            云端临时区（{remote.length}）
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="zn-plain-btn"
              disabled={busy !== null || !reload}
              onClick={() => void onLand()}
            >
              {busy === 'land' ? '接收中…' : '接收云端文件'}
            </button>
            <button
              type="button"
              className="zn-plain-btn"
              disabled={busy !== null || !reload}
              onClick={() => void onCleanup()}
            >
              {busy === 'cleanup' ? '清理中…' : '清理已落地'}
            </button>
          </div>
        </div>
        {remote.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">点「刷新云端」查看</div>
        ) : (
          <ul className="flex max-h-[26vh] flex-col gap-1 overflow-y-auto">
            {remote.map((r) => (
              <li key={`${r.hash16}/${r.name}`} className="flex items-center gap-2 px-1 py-0.5">
                <span className="min-w-0 flex-1 truncate" title={r.hash16}>
                  {r.name}
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatSize(r.size)}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {r.acked ? '已落地' : '等对端'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {message ? <div className="text-[11px] text-foreground">{message}</div> : null}
      {error ? <div className="whitespace-pre-wrap text-[11px] text-destructive">{error}</div> : null}
    </div>
  )
}
