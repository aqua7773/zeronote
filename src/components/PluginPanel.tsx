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
   * 插件来源（2026-10-17 rev94）：
   *  - `global` —— 全局插件根（`appDataDir()`），**换库也还在**；
   *  - `vault`  —— 当前库自己的 `.zn/plugins/`，跟着库走。
   * 缺省按库内处理（旧数据 / 拿不到来源时）。
   */
  source?: 'global' | 'vault'
  /**
   * 入口完整性（2026-10-18 rev119）：
   * · `verified` —— manifest 带 `sha256`，加载时已比对通过；
   * · `none`     —— 没有 `sha256`（未校验 / 未签名，安装时也会提示）。
   */
  integrity?: 'verified' | 'none'
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
}

export function PluginPanel({
  plugins,
  error,
  log,
  globalRoot,
  onToggle,
  onDelete,
  onInstall,
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
}) {
  /** 待确认删除的插件（null = 没有确认框） */
  const [pending, setPending] = useState<PluginRow | null>(null)
  /** 删除的是不是全局那份 —— 决定确认框里说哪个路径 */
  const pendingIsGlobal = pending?.source === 'global'

  return (
    <div className="zn-plugins">
      {/* 这里原本有一条「插件」标题栏 + 重新扫描按钮 + 下横线。
          用户要求去掉标题和横线，扫描按钮挪到主区顶栏（见 App 的 .zn-main-panel-bar）。 */}
      {error && <div className="zn-plugins-error">⚠ {error}</div>}

      {/* 安装 .znp（2026-10-18 rev119）：确认框会列出它自称要的能力与签名状态 */}
      <div style={{ display: 'flex', gap: 8, padding: '2px 0 10px' }}>
        <Button onClick={() => onInstall?.()}>安装插件包（.znp）…</Button>
      </div>

      {plugins.length === 0 ? (
        <div className="zn-plugins-empty">
          还没有插件。两种放法（放好点「重新扫描」，不用重启）：
          <br />
          <br />
          · <strong>所有笔记库共用</strong> →{' '}
          <code>{globalRoot ? `${globalRoot}` : '<应用数据目录>'}</code> 下的{' '}
          <code>.zn/plugins/&lt;id&gt;/</code>
          <br />
          · 只在这个库用 → <code>&lt;当前库&gt;/.zn/plugins/&lt;id&gt;/</code>
          <br />
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
                  {p.source === 'global' && (
                    <span
                      className="zn-plugin-source"
                      title="装在全局插件目录：所有笔记库都能用"
                    >
                      全局
                    </span>
                  )}
                  {p.source === 'vault' && (
                    <span className="zn-plugin-source zn-plugin-source-vault" title="只在这个库生效">
                      本库
                    </span>
                  )}
                  {p.platformNote && (
                    <span className="zn-plugin-ver"> {p.platformNote}</span>
                  )}
                  {p.integrity === 'verified' ? (
                    <span
                      className="zn-plugin-source"
                      title="manifest 带 sha256，加载时已比对入口文件"
                    >
                      已校验
                    </span>
                  ) : (
                    <span
                      className="zn-plugin-ver"
                      title="manifest 没有 sha256：内核不校验入口文件（未签名）"
                    >
                      未校验
                    </span>
                  )}
                  {/* 卡死兜底 C 段：被启动自愈关掉的 —— 用醒目色，别让它看起来像普通备注 */}
                  {p.autoDisabledNote && (
                    <span className="zn-plugin-autodisabled"> {p.autoDisabledNote}</span>
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

      {/* 全局插件根：告诉用户"拷到哪能全库生效"，且让"本库插件"有对照物（rev94） */}
      {globalRoot && (
        <div className="zn-plugins-globalroot">
          全局插件目录：<code>{globalRoot}</code> 下的 <code>.zn/plugins/</code>
          <span className="zn-plugins-globalroot-hint"> 放这里的插件所有笔记库都能用</span>
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
            会把插件目录{' '}
            <code>
              {pendingIsGlobal ? (globalRoot ?? '全局插件根') : '<当前库>'} 下的 .zn/plugins/
              {pending?.id ?? ''}
            </code>{' '}
            整个删掉 —— 入口脚本、manifest、以及它自己的 store.json 一起。
            <br />
            <br />
            这步
            <strong className="font-semibold text-foreground">不可撤销</strong>
            ；要装回来就把插件目录重新拷回去。
            {pendingIsGlobal && (
              <>
                <br />
                <br />
                这是<strong className="font-semibold text-foreground">全局</strong>插件 ——
                删掉后所有笔记库都不再有它。
              </>
            )}
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
