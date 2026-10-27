/**
 * 内核服务组装 —— 把 8 个原语装到一起（契约 §1 / §2）
 *
 * 这里是**唯一的组装点**：UI 只跟 `Kernel` 打交道，插件只跟 `PluginContext` 打交道，
 * 两者都不知道对方存在。
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { watchAcceleratorKeys } from '../lib/accelerator'
import { mergeLines } from '../lib/merge3'
import { API_VERSION } from './contract'
import type {
  CapabilityApi,
  CapabilityName,
  CapabilityStatus,
  Disposable,
  DocApi,
  EditorApi,
  FsApi,
  HostApi,
  IndexApi,
  NetApi,
  NoteMeta,
  PanelLocation,
  SearchHit,
  ServiceApi,
  ShellSpec,
  StoreApi,
  UINode,
  ViewApi,
  ViewCtx,
} from './contract'
import { createCapabilityRegistry } from './capability'
import { createCommandApi, type CommandRegistry } from './command'
import { createScopedEditorApi, editorMarkEntries, releaseEditorMarks } from './editor-marks'
import { createEventApi, type EventBus } from './event'
import { createFsApi } from './fs'
import { withFsEvents } from './fs-events'
import { createIndexApi } from './index-api'
import { allPluginTopics } from './plugin-host'
import { createNetApi } from './net'
import { createServiceRegistry } from './service'
import { createStoreApi } from './store'

/**
 * `Uint8Array` → base64 —— **必须分块**。
 *
 * 一次性 `String.fromCharCode(...arr)` 在几百 KB 上就会 `Maximum call stack size exceeded`；
 * 导出长图 / PDF 时正好会踩到，所以从第一行就分块（二进制导出统一走这里）。
 */
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let bin = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

export type PanelRegistration = {
  id: string
  title: string
  icon?: string
  location: PanelLocation
  /**
   * 声明式渲染。与 `mount` **二选一**（rev173.81 起都可缺省，但必须有一个）。
   * 宿主渲染优先级：`webview` > `mount` > `render`。
   */
  render?: (ctx: ViewCtx) => UINode
  /**
   * DOM 直挂（rev173.81）：插件自己画真 DOM，宿主只给容器。
   * 用于 PDF / 思维导图这类「UINode 表达不了」的界面 —— 见契约 `ViewApi.registerPanel`。
   */
  mount?: (el: HTMLElement, ctx: ViewCtx) => void | Disposable
  /** 由插件宿主注入（面板归属哪个插件，UI 上用于标注来源） */
  pluginId?: string
  /**
   * 不进「☰ 菜单」（rev173.86）—— 动态实例面板用：文档阅读器**每个文档一个面板**
   * （`doc-reader.view.<hash>`），它们是"打开的那份文档"，不是功能入口。
   * 标签条 / `core.panel.<id>` 命令 / 拖出成窗口照常可用，只是不主动列进菜单。
   */
  hidden?: boolean
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
  /**
   * 日志钩子（rev173.229 起带归属）：`pluginId` 空 = 内核自身；
   * `stack` 只在 error 时由 `scopedHost` 捕获（需求 §2.13「错误堆栈」）。
   */
  onLog: (
    msg: string,
    level?: 'debug' | 'info' | 'warn' | 'error',
    pluginId?: string,
    stack?: string,
  ) => void
  /** 插件通过 `view.setState` 写面板状态时回调 */
  onPanelStateChange: (bind: string, value: unknown) => void
  /** 服务登记表变了（宿主一般不需要处理 —— kernel 已经把它转成 event 广播） */
  onServicesChange?: (list: { name: string; pluginId: string; version?: string; loaded: boolean }[]) => void
  /**
   * **整窗接管状态变了**（U2）：`null` = 内核 UI 正常显示；非 null = 那个插件接管了渲染。
   * 宿主据此决定"渲染内核 UI"还是"渲染接管容器"（DOM 挂载由宿主做，见 `App.tsx` 的 `ShellMount`）。
   */
  onShellChange?: (owner: { pluginId: string; spec: ShellSpec } | null) => void
  /**
   * 当前平台（rev173.82）。只用于 `view.openWindow` 的**手机降级**：
   * Tauri 2 在 Android 上没有多 webview（`unstable` 未开），真建窗只会落到
   * `tauri://error` 日志 ⇒ 用户看到的是"点了没反应"。降级出口见 `onOpenPanelInMain`。
   */
  platform?: 'windows' | 'android' | 'other'
  /**
   * **手机上的 openWindow 等价物**：把那个面板放进主区（宿主 `setMainView(panelId)`）。
   *
   * 为什么不是"什么都不做"：插件的意图是"把这块 UI 打开给人看"，
   * 手机上没有窗口，最接近的语义就是主区——用户按返回键回来。
   */
  onOpenPanelInMain?: (panelId: string) => void
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
  /**
   * 插件 → 它订阅的 topic（rev173.229 · 调试面板）。
   * `eventTopics` 只有计数、分不出「谁在听」，这里补归属。
   */
  pluginTopics: Record<string, string[]>
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
  /**
   * 插件私有存储工厂。`root` 缺省 = 当前库；全局插件传**全局根**，
   * 让它的 store 也跟着插件走（跨库一份配置）。
   */
  store: (pluginId: string, root?: string) => StoreApi
  host: HostApi
  /** HTTP 请求（Rust 侧发出，不受 CORS）—— rev173.106，同步插件的地基 */
  net: NetApi
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
  /**
   * 插件卸载时强制回收它登记的编辑器规则
   */
  releaseEditorMarks: (pluginId: string) => void
  /**
   * **核心能力接管**（需求 §2.15 · rev173.231）：给插件用的 `ctx.capability` 视图。
   * 插件的 `provide` 会一直生效到它被卸载 —— 宿主卸载时会调 `releaseCapabilities`。
   */
  capability: (pluginId: string) => CapabilityApi
  /** 各能力当前由谁提供（设置页「核心能力」/ 诊断 / CDP 验收） */
  capabilityStatus: () => CapabilityStatus[]
  /** 同优先级冲突时记住用户的选择（`null` = 清除，回到"取最早登记的那个"） */
  setCapabilityChoice: (name: CapabilityName, pluginId: string | null) => void
  /** 插件卸载时强制回收它接管的能力（兜底：Disposable 漏推也不会留下幽灵提供者） */
  releaseCapabilities: (pluginId: string) => void
  /**
   * **宿主侧**的「把面板开成独立窗口」（rev173.83）—— 标签拖出 / 右键「在新窗口打开」用。
   *
   * 复用 `view.openWindow` 的全套语义（面板未注册要报错 / Android 自动降级为主区 /
   * 窗口账本 / 卸载即净），宿主不重复实现一遍。
   * 返回 `false` = 没有真的开出窗口（手机上走的是降级路径）。
   */
  openPanelWindow: (panelId: string, title?: string) => boolean
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
  const rawFs = createFsApi(vault)
  /**
   * **核心能力（需求 §2.15）注册表**（rev173.231）。
   *
   * 放在最前面：搜索与存储的包装层要用它，而默认实现（`rawFs` / `indexRaw`）反而要在
   * 它们创建之后才登记 —— `setDefault` 是后置的，顺序上不冲突。
   */
  const capabilities = createCapabilityRegistry({
    onLog: (msg, level) => hooks.onLog(msg, level),
  })
  const event = createEventApi((topic, err) =>
    hooks.onLog(
      `事件处理器异常 topic=${topic}：${String(err)}`,
      // rev173.229：事件处理器抛错是**插件代码炸了**，按 error 记并带堆栈（需求 §2.13）
      'error',
      undefined,
      err instanceof Error ? err.stack : undefined,
    ),
  )
  const commands = createCommandApi((id, err) => {
    /**
     * rev173.229：命令失败也按 error + 堆栈记，并**反推归属插件**
     * （实现标签 `plugin:<id>`）—— 调试面板要能一眼看出是谁炸的。
     * `commands` 在这里是闭包引用（回调运行时早已初始化）。
     */
    const impl = commands.implTag?.(id) ?? null
    const m = impl ? /^plugin:(.+)$/.exec(impl) : null
    const pluginId = m && m[1] !== 'kernel' ? m[1] : undefined
    hooks.onLog(
      `命令 ${id} 执行失败：${String(err)}`,
      'error',
      pluginId,
      err instanceof Error ? err.stack : undefined,
    )
  })

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
      /**
       * 三种渲染方式**互斥**（rev173.81）：`webview` > `mount` > `render`。
       *
       * 为什么必须抛错而不是"挑一个用"：面板画不出来时，插件作者看到的会是
       * 一片空白 / 上一个面板的残影，排查方向完全错（静默失效最贵）。
       */
      if (spec.render && spec.mount) {
        throw new Error(
          `view.registerPanel：面板 ${spec.id} 同时给了 render 和 mount —— 只能二选一（要画 DOM 就只给 mount）`,
        )
      }
      if (!spec.render && !spec.mount) {
        throw new Error(
          `view.registerPanel：面板 ${spec.id} 既没有 render 也没有 mount —— 至少给一个（声明式 UI 用 render，真 DOM 用 mount）`,
        )
      }
      if (spec.mount && spec.location !== 'main' && spec.location !== 'sidebar') {
        throw new Error(
          `view.registerPanel：面板 ${spec.id} 的 mount 只支持 location 'main' / 'sidebar'（当前 '${spec.location}'）—— ` +
            `状态栏 / 工具栏 / 弹窗这些窄位置只接受声明式 render`,
        )
      }
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
        /**
         * rev173.76：归属要留住 —— 能力通道按 `panel.pluginId` 找执行器
         * （`plugin-host` 的 scopedView 注入，宿主渲染 WebViewFrame 时用）。
         */
        pluginId: (spec as { pluginId?: string }).pluginId,
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
      /**
       * **手机降级**（rev173.82）：Android 上没有多 webview 窗口（Tauri 2 的 `unstable`
       * 多窗口未开），`new WebviewWindow` 会失败，而失败只落到 `tauri://error` 日志
       * ⇒ 插件和用户看到的都是"点了没反应"（outline-map rev173.11 就是这么踩的）。
       * 等价语义 = **主区打开这个面板**：UI 真的出现，返回键能回来。
       */
      if (hooks.platform === 'android') {
        hooks.onOpenPanelInMain?.(spec.panel)
        hooks.onLog?.(`openWindow 在 Android 上降级为主区面板：${spec.panel}`, 'info')
        return { dispose: () => {} }
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
      // rev173.70：插件独立窗口同样要关掉 WebView2 原生查找栏（Ctrl+F 归编辑器）
      watchAcceleratorKeys(win)
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

  /**
   * index 原语：内存全文索引（多关键词 AND + 中文子串），实现见 index-api.ts。
   *
   * `onRebuilt` → `index:rebuilt` 事件（契约 §1.4）：插件不必轮询"重建完了没"。
   * 注意它用 `rawFs`：重建只需要 `listNotes` / `readText`，不该走下面那层写包装。
   */
  const indexRaw: IndexApi = createIndexApi({
    fs: rawFs,
    onRebuilt: (stats) => event.emit('index:rebuilt', stats),
  })

  /**
   * 对外的 `index` = 原始索引 + **搜索能力委托**（rev173.231 · 需求 §2.15）。
   *
   * `query` 走 `capability.invoke('search.query')`：没有插件接管时落到 `indexRaw.query`；
   * 有插件接管时用它的实现。搜索面板 / 插件 / 命令拿到的都是同一份结果。
   * `scoped(partition)` 也递归包装 —— 分区索引同样可被接管。
   */
  const capabilityQuery = (
    q: string,
    opts?: { limit?: number; dir?: string; tag?: string; regex?: boolean },
  ) => capabilities.invoke<SearchHit[]>('search.query', q, opts)
  const withCapabilityQuery = (api: IndexApi): IndexApi => ({
    ...api,
    query: capabilityQuery,
    scoped: (partition: string) => withCapabilityQuery(api.scoped(partition)),
  })
  const index: IndexApi = withCapabilityQuery(indexRaw)
  capabilities.setDefault('search.query', (q, opts) =>
    indexRaw.query(q as string, opts as Parameters<IndexApi['query']>[1]),
  )

  /**
   * 对外的 fs = rawFs + 索引跟随 + 事件派发（rev173.40，见 fs-events.ts）。
   *
   * 为什么包装必须发生在**内核组装点**：插件拿到的 `ctx.fs` 是 `kernel.fs` 的 scoped 视图，
   * 宿主（App / hooks）也调 `kernel.fs` —— 只有在这里换一次，所有写入路径才都经过它。
   */
  const fsBase: FsApi = withFsEvents(rawFs, indexRaw, event, (msg) => hooks.onLog(msg, 'warn'))

  /**
   * 存储能力的默认实现 = 内核正常链路（含索引跟随 + 事件派发）。
   * 这样"接管 → 禁用插件 → 回退"之后行为与从没接管过完全一致。
   */
  capabilities.setDefault('storage.read', (p) => fsBase.readText(p as string))
  // ⚠️ `writeText` 有第三参 `opts.origin`（user / plugin）—— 包装层必须**原样透传**，
  // 吞掉它会让插件写盘变成"用户保存"（发 note:saved ⇒ 同步插件留下永远清不掉的 pending，
  // rev173.120 的教训）。所以这里用 spread 而不是逐参转写。
  capabilities.setDefault('storage.write', (...args) =>
    fsBase.writeText(...(args as Parameters<FsApi['writeText']>)),
  )
  capabilities.setDefault('storage.exists', (p) => fsBase.exists(p as string))
  capabilities.setDefault('storage.list', (d) => fsBase.listNotes(typeof d === 'string' ? d : undefined))

  /**
   * 对外的 `fs` = fsBase + **存储能力委托**（rev173.231 · 需求 §2.15）。
   *
   * 只包四个"消费侧"方法：读 / 写 / 存在 / 列清单。其余（rename / delete / watch…）
   * 不动 —— 需求 §2.15 只要求「存储可接管」，而结构操作改由插件替换没有可解释的语义
   * （目录搬移、回收站、索引跟随全在内核侧，拦一半只会造出不一致状态）。
   */
  const fs: FsApi = {
    ...fsBase,
    readText: (path: string) => capabilities.invoke<string>('storage.read', path),
    writeText: ((...args: Parameters<FsApi['writeText']>) =>
      capabilities.invoke<void>('storage.write', ...args)) as FsApi['writeText'],
    exists: (path: string) => capabilities.invoke<boolean>('storage.exists', path),
    listNotes: (dir?: string) => capabilities.invoke<NoteMeta[]>('storage.list', dir),
  }

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

  /**
   * 内核内置服务：行级三方合并（`src/lib/merge3.ts`，rev173.115）。
   *
   * 为什么内核要提供它：插件宿主只给 10 个原语，插件**不能 import `src/lib`**。
   * 而同步插件在「双端都改」时要拿 base 做三方合并，语义必须与内核写盘前那次合并
   * （`mergeWithDisk`）**逐字一致** —— 两份实现迟早漂移，所以只留一份、经 service 借出。
   *
   * 名字带 `kernel.` 前缀：插件自己起的名字都在插件命名空间里，避免撞名。
   */
  services.scoped('kernel').provide('kernel.merge', () => ({ mergeLines }), { version: '1' })

  const host: HostApi = {
    apiVersion: API_VERSION,
    // 应用版本号：来自 package.json（vite 注入，rev173.37）—— 不再硬编码。
    // 兜底：旧 dev server（config 未重启）没有 define 时退成 '0.0.0'，而不是整页崩掉。
    appVersion: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0',
    platform: /Android/i.test(navigator.userAgent) ? 'android' : 'windows',
    log(level, msg) {
      // rev173.229：级别已由结构化日志携带，不再往消息里塞 `[warn] ` 前缀（面板会重复显示）
      hooks.onLog(msg, level)
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
    /**
     * 库外**绝对路径** → asset://（2026-10-14 加）。
     * 用途：Android SAF 的文件被原生插件复制到应用缓存后，阅读器要读那份副本
     * （缓存目录不在库里，`assetUrl` 的相对路径拼不出来）。
     */
    assetUrlAbs(absPath) {
      try {
        return convertFileSrc(absPath)
      } catch {
        return absPath
      }
    },
    /**
     * 弹系统文件选择器（**导入用**，2026-10-15 加）。
     *
     * Android 上**不传 filters** —— 那边是 MIUI 的「安全访问」，按 MIME 过滤自己那四个分类，
     * 而 `md` 经 `MimeTypeMap.getMimeTypeFromExtension` 转出来的名字不在它的白名单里
     * ⇒ 传了就**一个文件都列不出来**（真机实测）。桌面端也不传：导入要吃的格式本来就杂
     * （md / txt / pdf / epub / html / docx），让人自己选，好过让他猜"为什么我要的文件不在列表里"。
     */
    async pickFile() {
      const picked = await open({ multiple: false, title: '打开文件' })
      if (!picked || typeof picked !== 'string') return null
      return picked
    },
    /**
     * 读 SAF 的 `content://`（**导入用**，2026-10-15 加）—— 转发给原生插件
     * `tauri-plugin-uri-reader`，它用 `ContentResolver` 把文件复制到应用缓存，
     * 返回 `{ path, name }`（绝对路径 + 文件名）。
     *
     * **为什么必须由内核转发**：插件是 Blob 模块，`import` 不到 `@tauri-apps/api`，
     * 自己拿不到 `invoke`。桌面没有 SAF ⇒ 普通绝对路径原样返回，不复制。
     */
    async readContentUri(uri) {
      if (!/^content:\/\//i.test(uri)) {
        const name = uri.split(/[\\/]/).pop() ?? 'imported.bin'
        return { path: uri, name }
      }
      return await invoke<{ path: string; name: string }>(
        'plugin:uri-reader|read_content_uri',
        { uri },
      )
    },
    async saveFile({ defaultName, content }) {
      // 系统「另存为」对话框：用户取消返回 null（**不抛错** —— 取消是正常操作，不是异常）
      const picked = await save({ defaultPath: defaultName })
      if (!picked) return null
      /**
       * **Android：`save()` 返回的是 `content://` 内容 URI**（SAF 的 `ACTION_CREATE_DOCUMENT`），
       * 不是文件路径 ⇒ `write_absolute` 拿它当路径必然失败（契约里原先就标着"Android 受限"）。
       * 2026-10-15 补上：交给原生插件 `tauri-plugin-uri-reader` 的 `write_content_uri`，
       * 用 `ContentResolver.openOutputStream` 写进去 —— 这条 URI 由 CREATE_DOCUMENT 授予，**带写权限**。
       */
      if (/^content:\/\//i.test(picked)) {
        const payload =
          typeof content === 'string' ? { text: content } : { base64: toBase64(content) }
        await invoke('plugin:uri-reader|write_content_uri', { uri: picked, ...payload })
        return picked
      }
      // 库外写入走专用命令（只收绝对路径），见 src-tauri/src/lib.rs
      if (typeof content === 'string') {
        await invoke('write_absolute', { path: picked, content })
      } else {
        // 二进制经 base64 过桥：直接传 Uint8Array 会被序列化成 JSON 数字数组
        await invoke('write_absolute_b64', { path: picked, base64: toBase64(content) })
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
    /**
     * 系统凭据库（rev173.106 · 2026-10-24 用户裁决「一开始就走钥匙串」）。
     *
     * 三条命令直接落到 Rust 侧的 `keyring`（Windows 凭据管理器 / Android Keystore），
     * **不落库内 JSON** —— 所以换库不会换凭据，凭据也不会被同步插件读到 `.zn/` 里。
     */
    secrets: {
      get: (account: string) => invoke<string | null>('secret_get', { account }),
      set: (account: string, secret: string) =>
        invoke<void>('secret_set', { account, secret }),
      delete: (account: string) => invoke<void>('secret_delete', { account }),
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
    net: createNetApi(),
    store: (pluginId: string, root?: string) => createStoreApi(root ?? vault, pluginId),
    service: (pluginId: string) => services.scoped(pluginId),
    releaseServices: (pluginId: string) => services.release(pluginId),
    capability: (pluginId: string) => capabilities.scoped(pluginId),
    capabilityStatus: () => capabilities.status(),
    setCapabilityChoice: (name: CapabilityName, pluginId: string | null) =>
      capabilities.setChoice(name, pluginId),
    releaseCapabilities: (pluginId: string) => capabilities.release(pluginId),
    editor: (pluginId: string) => createScopedEditorApi(pluginId),
    releaseEditorMarks: (pluginId: string) => releaseEditorMarks(pluginId),
    /**
     * 宿主侧开面板窗口（rev173.83）：标签拖出 / 右键「在新窗口打开」。
     * 直接把 `view.openWindow` 借过来 —— 面板未注册的报错、Android 降级、
     * 窗口账本、卸载即净全在同一处，宿主不复制一份。
     */
    openPanelWindow: (panelId: string, title?: string) => {
      try {
        view.openWindow({ panel: panelId, title })
      } catch (e) {
        hooks.onLog(`openPanelWindow 失败：${String(e)}`, 'warn')
        return false
      }
      // Android 上 `openWindow` 走的是「主区打开」降级 —— 没有真窗口
      return hooks.platform !== 'android'
    },
    audit: () => ({
      commands: commands
        .all()
        .map((c) => ({ id: c.id, impl: commands.implTag(c.id) }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      eventTopics: event.stats(),
      pluginTopics: allPluginTopics(),
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
