/**
 * 内核服务组装 —— 把 8 个原语装到一起（契约 §1 / §2）
 *
 * 这里是**唯一的组装点**：UI 只跟 `Kernel` 打交道，插件只跟 `PluginContext` 打交道，
 * 两者都不知道对方存在。
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
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
  ShellSpec,
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
  /**
   * **整窗接管状态变了**（U2）：`null` = 内核 UI 正常显示；非 null = 那个插件接管了渲染。
   * 宿主据此决定"渲染内核 UI"还是"渲染接管容器"（DOM 挂载由宿主做，见 `App.tsx` 的 `ShellMount`）。
   */
  onShellChange?: (owner: { pluginId: string; spec: ShellSpec } | null) => void
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
  /** 当前由内核开着的**插件独立窗口** label（U1）—— 插件卸载后应当回空 */
  windows: string[]
  /** 当前接管整窗渲染的插件 id（U2）—— `null` = 内核 UI 正常 */
  shell: string | null
}

/** 插件窗口 label 前缀 —— 与 `capabilities/plugin-windows.json` 的 glob 约定必须一致 */
const PLUGIN_WINDOW_PREFIX = 'plugin-'

/**
 * Tauri 的窗口 label 只接受 `[A-Za-z0-9/:_-]`，而面板 id 常是 `outline-map.panel` 这种带点的
 * ⇒ 非白名单字符一律换 `-`。**这一步不能省**：带点的 label 会让新窗口创建失败，
 * 而失败是**异步**报的（`tauri://error` 事件）—— 不挂监听就变成"点了没反应"。
 */
function sanitizeLabelPart(s: string): string {
  return s.replace(/[^A-Za-z0-9/:_-]/g, '-')
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
  /**
   * **读整窗接管的账**（U2）—— 宿主渲染时直接问内核"现在谁在接管"，而不是自己镜像一份 state。
   * 好处：内核被重建（切库）时这本账随旧内核一起消失，宿主**不可能**留下"接管者已不存在"的幻影。
   * 返回值变化由 `hooks.onShellChange` 通知（宿主在那里触发一次重渲染即可）。
   */
  shellOwner: () => { pluginId: string; spec: ShellSpec } | null
  /**
   * **内核强制释放整窗接管**（U2 的逃生口）。
   *
   * 为什么必须有：接管期间内核 UI 全部不在渲染树里 ⇒ 插件管理页也点不到。
   * 插件自己要是不给退出入口（或干脆崩在半路），用户就被锁死了 ——
   * 原则 3 的"关掉插件内核还能用"必须覆盖**连插件界面都出不来**的情况。
   *
   * 清账后宿主会卸载挂载器 ⇒ 插件 `mount` 返回的 `dispose` 依然会被调用（它仍有收尾机会）。
   */
  clearShell: () => void
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
  /**
   * 插件独立窗口的账（U1）：label → 窗口。
   * 没有这张表，`view.openWindow` 就"开出去收不回来"—— 插件卸载后窗口还挂着，
   * 而那个窗口里的插件代码还在跑（原则 3：卸载即净）。
   */
  const windowMap = new Map<string, WebviewWindow>()
  let windowSeq = 0
  /**
   * **整窗接管的账**（U2）：同一时刻只允许一个接管者。
   *
   * 为什么不是"后来者顶掉前者"：那等于静默失效 —— 前一个插件不知道自己的界面被谁换了、
   * 后一个也不知道自己踩了谁。抛明确错误让人（和插件日志）都看得见，才是可解释的。
   * `pluginId` 由 `scopedView` 注入（内核这份 view 不认识调用者）。
   */
  let shellTakeover: { pluginId: string; spec: ShellSpec } | null = null
  const notifyShell = () => hooks.onShellChange?.(shellTakeover ? { ...shellTakeover } : null)
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
    /**
     * 把一个面板放进独立窗口（U1 · 契约 §2.2）。
     *
     * 窗口是**新的 webview**：它加载同一个 URL 但带 `?pluginWindow=<panelId>`，
     * 于是那个页面会重新跑一遍插件加载，再只渲染这个面板（`App.tsx` 的窗口模式分支）。
     */
    openWindow(spec): Disposable {
      if (!panelMap.has(spec.panel)) {
        // 明确报错 > 开一个永远空白的窗口（静默失效最贵）
        throw new Error(`view.openWindow：面板 ${spec.panel} 还没注册（请先 registerPanel）`)
      }
      const label = `${PLUGIN_WINDOW_PREFIX}${sanitizeLabelPart(spec.panel)}-${++windowSeq}`
      const params = new URLSearchParams({ pluginWindow: spec.panel, vault })
      const win = new WebviewWindow(label, {
        url: `${location.origin}${location.pathname}?${params.toString()}`,
        title: spec.title ?? spec.panel,
        width: spec.width ?? 900,
        height: spec.height ?? 640,
        // 与主窗口一致：无系统边框，拖动靠页面里的 `data-tauri-drag-region`
        decorations: false,
        resizable: true,
      })
      // 创建失败（capability 没放行 / 平台不支持）**异步**报 —— 不挂它就成了"点了没反应"
      try {
        win.once('tauri://error', (e: unknown) => {
          windowMap.delete(label)
          const payload = (e as { payload?: unknown } | null)?.payload
          hooks.onLog(`插件窗口 ${label} 创建失败：${String(payload ?? e)}`, 'error')
        })
        /**
         * **用户自己关掉窗口**也要销账 —— 否则 `audit().windows` 里留着已经不在的 label，
         * "账"就不再是事实（验收读数和卸载时的遍历都会跟着错）。
         * 两个事件都挂：`close-requested` 是"要关了"，`destroyed` 是"已经没了"——
         * 平台差异下不一定都发，任一到就销账，重复销账无害。
         */
        const forget = () => windowMap.delete(label)
        win.once('tauri://close-requested', forget)
        win.once('tauri://destroyed', forget)
      } catch {
        /* 事件系统不可用（浏览器预览）—— 忽略，下面 close() 一样会失败 */
      }
      windowMap.set(label, win)
      let disposed = false
      return {
        dispose: () => {
          if (disposed) return
          disposed = true
          windowMap.delete(label)
          /**
           * 用 `destroy()` 而不是 `close()` —— 实测结论（U1）：`close()` 要先过一遍
           * `CloseRequested`（前端可 preventDefault），从**别的**窗口发起时会阻塞到超时、
           * 甚至窗口根本不消失；插件卸载要的是"立刻、确定地关掉"，不需要那套确认语义。
           */
          void win.destroy().catch(() => {})
        },
      }
    },
    setState(bind: string, value: unknown) {
      hooks.onPanelStateChange(bind, value)
    },
    /**
     * 接管整窗渲染（U2 · 契约 §2.8）。内核只维护**账 + 通知**：
     * DOM 挂载交给宿主（`App.tsx` 的 `ShellMount`）—— 与 panels 同一个模式，内核不碰 React 树。
     *
     * `pluginId` 由 `scopedView` 注入；内核自己直接调这份会报错（没有归属的接管无法还原）。
     */
    overrideShell(spec: ShellSpec & { pluginId?: string }): Disposable {
      const pluginId = spec.pluginId
      if (!pluginId) {
        throw new Error(
          'view.overrideShell 必须从插件上下文调用（ctx.view）—— 内核自己调它没有归属，无法还原',
        )
      }
      if (shellTakeover && shellTakeover.pluginId !== pluginId) {
        throw new Error(
          `整窗已被插件 ${shellTakeover.pluginId} 接管：请它先释放（dispose）或卸载它，再接管`,
        )
      }
      const entry = { pluginId, spec }
      shellTakeover = entry
      notifyShell()
      let disposed = false
      return {
        dispose: () => {
          if (disposed) return
          disposed = true
          // 只有"当前接管的还是我"才清 —— 免得旧实例的 dispose 把新接管者干掉
          if (shellTakeover === entry) {
            shellTakeover = null
            notifyShell()
          }
        },
      }
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
      windows: [...windowMap.keys()].sort(),
      shell: shellTakeover?.pluginId ?? null,
    }),
    // 返回**同一引用**（接管期间不变）：宿主的挂载 effect 依赖它 —— 每次新建对象会让 mount 反复重跑
    shellOwner: () => shellTakeover,
    clearShell: () => {
      if (!shellTakeover) return
      shellTakeover = null
      notifyShell()
      hooks.onLog('内核逃生口：已强制释放整窗接管', 'warn')
    },
  }
}
