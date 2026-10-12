/**
 * 内核服务组装 —— 把 8 个原语装到一起（契约 §1 / §2）
 *
 * 这里是**唯一的组装点**：UI 只跟 `Kernel` 打交道，插件只跟 `PluginContext` 打交道，
 * 两者都不知道对方存在。
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { API_VERSION } from './contract'
import type {
  Disposable,
  DocApi,
  EditorApi,
  FsApi,
  HostApi,
  IndexApi,
  PanelLocation,
  ServiceApi,
  StoreApi,
  UINode,
  ViewApi,
  ViewCtx,
} from './contract'
import { createCommandApi, type CommandRegistry } from './command'
import { createScopedEditorApi, editorMarkEntries, releaseEditorMarks } from './editor-marks'
import { createEventApi, type EventBus } from './event'
import { createFsApi } from './fs'
import { createIndexApi } from './index-api'
import { createServiceRegistry } from './service'
import { createStoreApi } from './store'

export type PanelRegistration = {
  id: string
  title: string
  icon?: string
  location: PanelLocation
  render: (ctx: ViewCtx) => UINode
  /** 由插件宿主注入（面板归属哪个插件，UI 上用于标注来源） */
  pluginId?: string
  /**
   * 非空 = 这个面板是「WebView 逃生口」（契约 §2.2 / §7.9）：
   * 宿主用 `<iframe sandbox="allow-scripts">` 承载它，**不调用** `render`。
   * 主题令牌靠 postMessage 送达 —— CSS 自定义属性不跨文档边界（见 WebViewFrame）。
   */
  webview?: { url: string }
}

export type KernelHooks = {
  onPanelsChange: (panels: PanelRegistration[]) => void
  onNotify: (msg: string, level?: 'info' | 'warn' | 'error') => void
  onLog: (msg: string, level?: 'debug' | 'info' | 'warn' | 'error') => void
  /** 插件通过 `view.setState` 写面板状态时回调 */
  onPanelStateChange: (bind: string, value: unknown) => void
  /** 服务登记表变了（宿主一般不需要处理 —— kernel 已经把它转成 event 广播） */
  onServicesChange?: (list: { name: string; pluginId: string; version?: string; loaded: boolean }[]) => void
}

/**
 * **内核审计快照**（接管协议验收判据 · 2026-10-13 rev49）。
 *
 * 用途只有一个：让"卸载插件后内核回到基线"这句话**可判定**。
 * CDP 侧在加载插件前拍一份，卸载后再拍一份，逐项比对即可 —— 不靠人眼、不靠推断。
 *
 * 刻意只收**可稳定比较**的东西（列表已排序 / 不缺省造数）：多一个少一个都是信号。
 * 内核 DOM 的基线比对不在这里 —— 那由验收脚本自己采关键节点属性（宿主 DOM 千变万化，
 * 内核提供一个"什么都收"的快照反而会天天误报）。
 */
export type KernelAudit = {
  /** 命令表（id 升序）—— 插件卸载后必须与基线逐字相同 */
  commands: { id: string; impl: string | null }[]
  /** 事件订阅表：topic → 订阅者数（无订阅者的 topic 不出现） */
  eventTopics: Record<string, number>
  /** 已登记面板：id / 位置 / 归属插件 */
  panels: { id: string; location: PanelLocation; pluginId?: string }[]
  /** 服务表：名字 / 提供者 / 是否已实例化 */
  services: { name: string; pluginId: string; loaded: boolean }[]
  /** 编辑器标记规则（`pluginId/ruleId`） */
  editorMarks: { id: string; pluginId: string }[]
  /** 插件注入的 `<style>` 数（纯样式插件 / `manifest.styles`） */
  pluginStyles: number
}

export type Kernel = {
  vault: string
  fs: FsApi
  doc: DocApi
  index: IndexApi
  event: EventBus
  commands: CommandRegistry
  view: ViewApi
  store: (pluginId: string) => StoreApi
  host: HostApi
  /** 「前置插件」用的服务注册表（按插件 id 视图化，卸载即回收） */
  service: (pluginId: string) => ServiceApi
  /**
   * 插件卸载时**强制**回收它提供的服务。
   * 不指望插件自己把 `provide` 的 Disposable 推进 subscriptions ——
   * 漏推一次的后果是服务表里留下"幽灵提供者"，别的插件还在 consume 一个死对象。
   */
  releaseServices: (pluginId: string) => void
  /** 编辑器标记规则注册表（`[[引用]]` 这类渲染靠它） */
  editor: (pluginId: string) => EditorApi
  /** 插件卸载时强制回收它登记的编辑器规则 */
  releaseEditorMarks: (pluginId: string) => void
  /**
   * 审计快照：命令表 / 订阅表 / 面板 / 服务 / 编辑器规则 / 插件样式。
   * 宿主把它挂到 `window.__znKernelAudit` 供 CDP 自动验收（见 `KernelAudit`）。
   */
  audit: () => KernelAudit
}

export function createKernel(vault: string, doc: DocApi, hooks: KernelHooks): Kernel {
  const fs = createFsApi(vault)
  const event = createEventApi((topic, err) =>
    hooks.onLog(`事件处理器异常 topic=${topic}：${String(err)}`, 'warn'),
  )
  const commands = createCommandApi((id, err) =>
    hooks.onLog(`命令 ${id} 执行失败：${String(err)}`, 'warn'),
  )

  const panelMap = new Map<string, PanelRegistration>()
  const view: ViewApi = {
    registerPanel(spec): Disposable {
      // 幂等：同 id 重新注册 = 替换（dev 热重载 / 插件重复加载都靠它兜底）
      const self = spec as PanelRegistration
      panelMap.set(spec.id, self)
      hooks.onPanelsChange([...panelMap.values()])
      return {
        dispose: () => {
          // 只有当前登记的就是自己时才删，避免"旧 dispose 干掉新面板"
          if (panelMap.get(spec.id) === self) {
            panelMap.delete(spec.id)
            hooks.onPanelsChange([...panelMap.values()])
          }
        },
      }
    },
    registerWebView(spec): Disposable {
      /**
       * 最小版逃生口（契约 §2.2 / §7.9）：登记成一个带 `webview` 的面板，
       * 由宿主的 `WebViewFrame` 用 `<iframe sandbox="allow-scripts">` 承载 ——
       * **不给 allow-same-origin**，两个文档互为 opaque origin。
       *
       * `render` 只是占位（宿主看到 `webview` 就不走 UINode 渲染），
       * 主题令牌由宿主 postMessage 送进去。
       */
      const self: PanelRegistration = {
        id: spec.id,
        title: spec.title,
        location: spec.location,
        render: () => ({ type: 'text', value: '' }),
        webview: { url: spec.url },
      }
      panelMap.set(spec.id, self)
      hooks.onPanelsChange([...panelMap.values()])
      return {
        dispose: () => {
          if (panelMap.get(spec.id) === self) {
            panelMap.delete(spec.id)
            hooks.onPanelsChange([...panelMap.values()])
          }
        },
      }
    },
    refresh() {
      // 面板 render 是纯函数：插件改完自己的数据后调这里，宿主重渲染即拿到新内容
      hooks.onPanelsChange([...panelMap.values()])
    },
    setState(bind: string, value: unknown) {
      hooks.onPanelStateChange(bind, value)
    },
  }

  /** index 原语：内存全文索引（多关键词 AND + 中文子串），实现见 index-api.ts */
  const index: IndexApi = createIndexApi({ fs })

  /**
   * 服务注册表（**「前置插件」的载体**）。登记表一变就转成
   * `service:available` / `service:gone` 事件广播 —— 于是加载顺序不保证时，
   * 晚到的消费者能靠事件补挂，不用自己轮询。
   */
  const services = createServiceRegistry({
    onAvailable: (name, pluginId) => {
      event.emit('service:available', { name, pluginId })
      hooks.onServicesChange?.(services.snapshot())
    },
    onGone: (name, pluginId) => {
      event.emit('service:gone', { name, pluginId })
      hooks.onServicesChange?.(services.snapshot())
    },
    onLog: (msg, level) => hooks.onLog(msg, level),
  })

  const host: HostApi = {
    apiVersion: API_VERSION,
    appVersion: '0.1.0',
    platform: /Android/i.test(navigator.userAgent) ? 'android' : 'windows',
    log(level, msg) {
      hooks.onLog(`[${level}] ${msg}`, level)
    },
    notify(msg, level) {
      hooks.onNotify(msg, level)
    },
    assetUrl(relPath) {
      // 库内相对路径 → asset://（需 tauri.conf.json 的 assetProtocol.enable + scope）
      const base = vault.replace(/[\\/]+$/, '')
      const rel = relPath.replace(/^[\\/]+/, '')
      const abs = `${base}/${rel}`
      try {
        return convertFileSrc(abs)
      } catch {
        // 非 Tauri 环境（浏览器预览）没有 asset 协议，退回原路径，别让渲染整个炸掉
        return abs
      }
    },
    async saveFile({ defaultName, content }) {
      // 系统「另存为」对话框：用户取消返回 null（**不抛错** —— 取消是正常操作，不是异常）
      const picked = await save({ defaultPath: defaultName })
      if (!picked) return null
      // 库外写入走专用命令（只收绝对路径），见 src-tauri/src/lib.rs
      if (typeof content === 'string') {
        await invoke('write_absolute', { path: picked, content })
      } else {
        // 二进制经 base64 过桥：直接传 Uint8Array 会被序列化成 JSON 数字数组
        let bin = ''
        for (let i = 0; i < content.length; i++) bin += String.fromCharCode(content[i])
        await invoke('write_absolute_b64', { path: picked, base64: btoa(bin) })
      }
      return picked
    },
    /**
     * 插件拿到的 `host` 由 `scopedHost` 包过一层（`plugin-host.ts`）——**那份**才有
     * `subscriptions` 可挂。这里是内核自己用的裸 host，直接调它没有账可记 ⇒
     * 明确警告并返回空 Disposable，而不是静默把回调丢掉（静默失效比报错危险）。
     */
    onRollback() {
      hooks.onLog('裸 host.onRollback 没有订阅账可挂（插件请用 ctx.host）', 'warn')
      return { dispose: () => {} }
    },
  }

  return {
    vault,
    fs,
    doc,
    index,
    event,
    commands,
    view,
    host,
    store: (pluginId: string) => createStoreApi(vault, pluginId),
    service: (pluginId: string) => services.scoped(pluginId),
    releaseServices: (pluginId: string) => services.release(pluginId),
    editor: (pluginId: string) => createScopedEditorApi(pluginId),
    releaseEditorMarks: (pluginId: string) => releaseEditorMarks(pluginId),
    audit: () => ({
      commands: commands
        .all()
        .map((c) => ({ id: c.id, impl: commands.implTag(c.id) }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      eventTopics: event.stats(),
      panels: [...panelMap.values()].map((p) => ({
        id: p.id,
        location: p.location,
        pluginId: p.pluginId,
      })),
      services: services
        .snapshot()
        .map((s) => ({ name: s.name, pluginId: s.pluginId, loaded: s.loaded })),
      editorMarks: editorMarkEntries(),
      // 插件注入的 <style>（injectStyles 会打 data-zn-plugin 标记）—— 数出来即可
      pluginStyles: document.querySelectorAll('style[data-zn-plugin]').length,
    }),
  }
}
