/**
 * 插件管理面板（M2）—— 「装上出现 / 卸下消失」的可视化开关。
 *
 * 注意：**进程内插件没有沙箱**（契约 §4）——所以这里把 capability 明明白白列出来，
 * 让用户知道这个插件能看到/改动什么。
 */
export type PluginRow = {
  id: string
  name: string
  version: string
  description?: string
  enabled: boolean
  capabilities: string[]
}

export function PluginPanel({
  plugins,
  error,
  log,
  onToggle,
}: {
  plugins: PluginRow[]
  error?: string | null
  log?: string[]
  onToggle: (id: string, enabled: boolean) => void
}) {
  return (
    <div className="zn-plugins">
      {/* 这里原本有一条「插件」标题栏 + 重新扫描按钮 + 下横线。
          用户要求去掉标题和横线，扫描按钮挪到主区顶栏（见 App 的 .zn-main-panel-bar）。 */}
      {error && <div className="zn-plugins-error">⚠ {error}</div>}

      {plugins.length === 0 ? (
        <div className="zn-plugins-empty">
          还没有插件。把插件目录放进 <code>&lt;库&gt;/.zn/plugins/&lt;id&gt;/</code> 后点「重新扫描」。
          <br />
          参考实现：<code>examples/hello-plugin/</code>
        </div>
      ) : (
        <div className="zn-plugin-list">
          {plugins.map((p) => (
            <div className="zn-plugin-row" key={p.id}>
              <input
                type="checkbox"
                className="zn-plugin-switch"
                checked={p.enabled}
                onChange={(e) => onToggle(p.id, e.target.checked)}
                aria-label={`启用 ${p.name}`}
              />
              <div className="zn-plugin-meta">
                <div className="zn-plugin-name">
                  {p.name} <span className="zn-plugin-ver">v{p.version}</span>
                </div>
                {p.description && <div className="zn-plugin-desc">{p.description}</div>}
                <div className="zn-plugin-caps">
                  {p.capabilities.length ? p.capabilities.join(' · ') : '未声明任何能力'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {log && log.length > 0 && (
        <details className="zn-plugins-log">
          <summary>插件日志（{log.length}）</summary>
          <pre>{log.slice(-50).join('\n')}</pre>
        </details>
      )}
    </div>
  )
}
