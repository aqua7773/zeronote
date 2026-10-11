/**
 * 内核服务组装 —— 把 8 个原语装到一起（契约 §1 / §2）
 *
 * 这里是**唯一的组装点**：UI 只跟 `Kernel` 打交道，插件只跟 `PluginContext` 打交道，
 * 两者都不知道对方存在。
 */
import { API_VERSION } from './contract'
import type {
  Disposable,
  DocApi,
  FsApi,
  HostApi,
  IndexApi,
  StoreApi,
  UINode,
  ViewApi,
  ViewCtx,
} from './contract'
import { createCommandApi, type CommandRegistry } from './command'
import { createEventApi, type EventBus } from './event'
import { createFsApi } from './fs'
import { createIndexApi } from './index-api'
import { createStoreApi } from './store'

export type PanelRegistration = {
  id: string
  title: string
  icon?: string
  location: 'sidebar' | 'main' | 'statusbar' | 'modal'
  render: (ctx: ViewCtx) => UINode
  /** 由插件宿主注入（面板归属哪个插件，UI 上用于标注来源） */
  pluginId?: string
}

export type KernelHooks = {
  onPanelsChange: (panels: PanelRegistration[]) => void
  onNotify: (msg: string, level?: 'info' | 'warn' | 'error') => void
  onLog: (msg: string, level?: 'debug' | 'info' | 'warn' | 'error') => void
  /** 插件通过 `view.setState` 写面板状态时回调 */
  onPanelStateChange: (bind: string, value: unknown) => void
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
    registerWebView(): Disposable {
      throw new Error('v0.1 还不支持 WebView 视图（契约 §7 第 9 条，排在 v0.2）')
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
  }
}
