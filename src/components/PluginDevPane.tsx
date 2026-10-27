import { useMemo, useState } from 'react'
import { Button } from './ui/button'
import type { KernelAudit } from '../kernel/kernel'
import type { PluginLogEntry } from '../kernel/contract'
import type { PluginRow } from './PluginPanel'

/**
 * 插件调试面板（rev173.229 · 需求 §2.13）。
 *
 * 覆盖需求里的四项：**插件日志 / 错误堆栈 / 调试面板（已加载插件 · 注册命令 · 事件监听 ·
 * 权限 · 依赖）/ 模拟触发**。没做的两项（**沙箱控制台**、**资源监控的内存与 CPU**）
 * 在下方「未做」里写明 —— WebView 里拿不到内存/CPU，也不该假装能拿到。
 *
 * 数据全部来自 `kernel.audit()`（快照）+ App 收集的 `logs`（实时）。
 * 面板本身**不持有**任何状态：`onReload` / `onEmit` 交回宿主执行，
 * 这样「谁在跑、谁在听」只有内核一处真相。
 */

/** `impl: 'plugin:xxx'` → `xxx`；内核实现（`core` / `plugin:kernel`）返回 null */
function implPluginId(impl: string | null): string | null {
  if (!impl) return null
  const m = /^plugin:(.+)$/.exec(impl)
  if (!m) return null
  const id = m[1]
  // 内核自己注册的服务也走 `plugin:kernel` 这个标签，调试面板不把它算成"插件"
  return id === 'kernel' ? null : id
}

/** 时间戳 → `HH:MM:SS`（日志里看时间点就够，日期没有信息量） */
function timeOf(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function PluginDevPane({
  plugins,
  logs,
  audit,
  devMode,
  onToggleDevMode,
  onReload,
  onEmit,
  onClearLogs,
  onTestLog,
}: {
  plugins: PluginRow[]
  logs: PluginLogEntry[]
  audit: KernelAudit | null
  devMode: boolean
  onToggleDevMode: (on: boolean) => void
  onReload: () => void
  /** 返回错误文案（JSON 解析失败等）；成功返回 null */
  onEmit: (topic: string, payload: unknown) => string | null
  onClearLogs?: () => void
  /** 写一条带堆栈的测试日志 —— 验证「日志面板活着 + 堆栈能展开」 */
  onTestLog?: () => void
}) {
  const [filter, setFilter] = useState('')
  const [topic, setTopic] = useState('')
  const [payloadText, setPayloadText] = useState('{}')
  const [emitNote, setEmitNote] = useState<string | null>(null)

  /** 每插件的资源计数：命令 / 面板 / 服务 / 订阅 topic（全部从 audit 快照里数） */
  const diag = useMemo(() => {
    const map = new Map<string, { commands: number; panels: number; services: number; topics: string[] }>()
    const get = (id: string) => {
      let v = map.get(id)
      if (!v) {
        v = { commands: 0, panels: 0, services: 0, topics: [] }
        map.set(id, v)
      }
      return v
    }
    // 先按「已启用的插件」铺满 —— 没有注册任何资源的插件（纯样式 / 主题）也要出现在表里
    for (const p of plugins) if (p.enabled) get(p.id)
    for (const c of audit?.commands ?? []) {
      const id = implPluginId(c.impl)
      if (id) get(id).commands += 1
    }
    for (const p of audit?.panels ?? []) if (p.pluginId) get(p.pluginId).panels += 1
    for (const s of audit?.services ?? []) get(s.pluginId).services += 1
    for (const [id, topics] of Object.entries(audit?.pluginTopics ?? {})) get(id).topics = topics
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }, [audit, plugins])

  const shownLogs = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const list = q
      ? logs.filter(
          (l) =>
            (l.pluginId ?? 'kernel').toLowerCase().includes(q) || l.msg.toLowerCase().includes(q),
        )
      : logs
    return list.slice(-200)
  }, [logs, filter])

  const errorCount = logs.filter((l) => l.level === 'error').length

  const emit = () => {
    const t = topic.trim()
    if (!t) {
      setEmitNote('先填 topic（例如 `note:saved`）')
      return
    }
    let parsed: unknown = null
    try {
      parsed = payloadText.trim() ? JSON.parse(payloadText) : null
    } catch {
      setEmitNote('payload 不是合法 JSON')
      return
    }
    const err = onEmit(t, parsed)
    setEmitNote(err ?? `已发射 ${t}`)
  }

  return (
    <div className="zn-dev">
      <div className="zn-dev-head">
        <label className="zn-dev-mode">
          <input
            type="checkbox"
            checked={devMode}
            onChange={(e) => onToggleDevMode(e.target.checked)}
          />
          开发者模式（显示调试信息 · 不跳过任何安全检查）
        </label>
        <div className="zn-dev-actions">
          <Button onClick={onReload}>重载全部插件</Button>
          {onTestLog && <Button onClick={onTestLog}>写一条测试日志</Button>}
          {onClearLogs && <Button onClick={onClearLogs}>清空日志</Button>}
        </div>
      </div>

      {!devMode ? (
        <p className="zn-dev-hint">
          打开「开发者模式」后显示：插件诊断表（命令 / 面板 / 服务 / 事件订阅）、模拟触发、结构化日志与错误堆栈。
          <br />
          ⚠️ 需求 §2.13 的「跳过权限确认」这条**刻意没做** —— 本项目的立场是能力自述 + 签名可见，
          不给一条能一键绕过它的开关。
        </p>
      ) : (
        <>
          <div className="zn-dev-stats">
            <span>
              已安装 <b>{plugins.length}</b>
            </span>
            <span>
              启用 <b>{plugins.filter((p) => p.enabled).length}</b>
            </span>
            <span>
              命令 <b>{audit?.commands.length ?? '—'}</b>
            </span>
            <span>
              事件 topic <b>{Object.keys(audit?.eventTopics ?? {}).length}</b>
            </span>
            <span>
              日志 <b>{logs.length}</b>
              {errorCount > 0 && <em className="zn-dev-err-count"> · 错误 {errorCount}</em>}
            </span>
          </div>

          <h4 className="zn-dev-title">插件诊断（来自 kernel.audit 快照）</h4>
          {diag.length === 0 ? (
            <p className="zn-dev-hint">没有已加载的插件。</p>
          ) : (
            <div className="zn-dev-table">
              <div className="zn-dev-row zn-dev-row-head">
                <span>插件</span>
                <span>命令</span>
                <span>面板</span>
                <span>服务</span>
                <span>事件订阅</span>
              </div>
              {diag.map((d) => {
                const row = plugins.find((p) => p.id === d.id)
                return (
                  <div className="zn-dev-row" key={d.id}>
                    <span title={d.id}>
                      {row?.name ?? d.id}
                      <em className="zn-dev-id">{d.id}</em>
                      {row && <em className="zn-dev-ver">v{row.version}</em>}
                    </span>
                    <span>{d.commands}</span>
                    <span>{d.panels}</span>
                    <span>{d.services}</span>
                    <span className="zn-dev-topics" title={d.topics.join('\n')}>
                      {d.topics.length ? d.topics.slice(0, 3).join('、') + (d.topics.length > 3 ? ` +${d.topics.length - 3}` : '') : '—'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          <h4 className="zn-dev-title">模拟触发一个事件</h4>
          <div className="zn-dev-emit">
            <input
              className="zn-dev-input"
              placeholder="topic，如 note:saved / myplugin:ping"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
            <textarea
              className="zn-dev-payload"
              rows={3}
              placeholder='payload JSON（可空），如 {"path":"a.md"}'
              value={payloadText}
              onChange={(e) => setPayloadText(e.target.value)}
            />
            <div className="zn-dev-emit-foot">
              <Button onClick={emit}>发射</Button>
              {emitNote && <span className="zn-dev-note">{emitNote}</span>}
            </div>
          </div>

          <h4 className="zn-dev-title">日志（最近 200 条 · 错误带堆栈）</h4>
          <input
            className="zn-dev-input"
            placeholder="按插件 id 或内容过滤…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="zn-dev-logs">
            {shownLogs.length === 0 ? (
              <p className="zn-dev-hint">还没有日志。</p>
            ) : (
              shownLogs.map((l, i) => (
                <div className={`zn-dev-log is-${l.level}`} key={`${l.ts}-${i}`}>
                  <span className="zn-dev-log-time">{timeOf(l.ts)}</span>
                  <span className="zn-dev-log-src" title={l.pluginId ?? '内核'}>
                    {l.pluginId ?? '内核'}
                  </span>
                  <span className="zn-dev-log-msg">{l.msg}</span>
                  {l.stack && (
                    <details className="zn-dev-stack">
                      <summary>堆栈</summary>
                      <pre>{l.stack}</pre>
                    </details>
                  )}
                </div>
              ))
            )}
          </div>

          <p className="zn-dev-hint">
            **未做**（需求 §2.13 的一部分）：沙箱控制台（插件是独立 Blob 模块，宿主拿不到它的作用域，
            伪造一个"插件上下文"只会骗人）；资源监控里的内存 / CPU（WebView 没有对应 API）。
          </p>
        </>
      )}
    </div>
  )
}
