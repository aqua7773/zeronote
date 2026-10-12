import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from './ui/button'
import { Dialog, DialogBody, DialogFooter, DialogHeader } from './ui/dialog'

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
   * 平台不适用时的说明（如「不适用 · 仅桌面端」）。
   *
   * 有值 ⇒ 这个插件声明了 `manifest.platforms` 且与当前平台不符，**内核根本没加载它**。
   * 所以开关要禁用 —— 拨它不会有任何效果，让人拨一个无效开关比不给开关更糟。
   * 它**不是错误**：把桌面专属插件拷到手机上是很正常的操作，不该报红。
   */
  platformNote?: string
}

export function PluginPanel({
  plugins,
  error,
  log,
  onToggle,
  onDelete,
}: {
  plugins: PluginRow[]
  error?: string | null
  log?: string[]
  onToggle: (id: string, enabled: boolean) => void
  onDelete: (id: string) => void
}) {
  /** 待确认删除的插件（null = 没有确认框） */
  const [pending, setPending] = useState<PluginRow | null>(null)

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
                </div>
                {p.description && <div className="zn-plugin-desc">{p.description}</div>}
                <div className="zn-plugin-caps">
                  {p.capabilities.length ? p.capabilities.join(' · ') : '未声明任何能力'}
                </div>
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
        </div>
      )}

      {log && log.length > 0 && (
        <details className="zn-plugins-log">
          <summary>插件日志（{log.length}）</summary>
          <pre>{log.slice(-50).join('\n')}</pre>
        </details>
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
            会把插件目录 <code>.zn/plugins/{pending?.id ?? ''}</code> 整个删掉 ——
            入口脚本、manifest、以及它自己的 store.json 一起。
            <br />
            <br />
            这步
            <strong className="font-semibold text-foreground">不可撤销</strong>
            ；要装回来就把插件目录重新拷进 <code>.zn/plugins/</code>。
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
