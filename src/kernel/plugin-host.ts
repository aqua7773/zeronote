/**
 * 插件宿主 —— 加载 / 卸载 / capability 校验 / 生命周期（契约 §3 加载规则）
 *
 * 设计要点：
 *  - 插件源码从 `.zn/plugins/<id>/<entry>` 读出来 → Blob URL → 动态 import
 *    （v0.1 **只支持单文件插件**：Blob 里无法解析相对导入）
 *  - 声明了未授权的 capability → 拒绝加载，并说人话
 *  - 插件抛异常 → 只卸载该插件，内核继续跑
 *  - 卸载即净：dispose 所有登记资源 + 撤销命令/面板
 */
import { invoke } from '@tauri-apps/api/core'
import { API_VERSION } from './contract'
import type {
  Capability,
  CommandApi,
  Disposable,
  DocApi,
  EventApi,
  FsApi,
  HostApi,
  IndexApi,
  Plugin,
  PluginContext,
  PluginManifest,
  StoreApi,
  ViewApi,
} from './contract'

/** 契约 §4 的 capability 白名单 */
const ALLOWED_CAPABILITIES: readonly Capability[] = [
  'fs:read',
  'fs:write',
  'doc:read',
  'doc:write',
  'index:query',
  'index:write',
  'command',
  'view:sidebar',
  'view:main',
  'view:statusbar',
  'view:modal',
  'store',
  'net',
  'proc',
]

/** v0.1 默认拒绝的两项 —— 需要用户在设置里显式开启（M2 第二版） */
const DENIED_BY_DEFAULT: readonly Capability[] = ['net', 'proc']

export type LoadedPlugin = {
  /** `.zn/plugins/` 下的目录名 */
  dir: string
  manifest: PluginManifest
  instance: Plugin
  /** 插件登记的全部资源（卸载时逐个 dispose） */
  subs: Disposable[]
}

export type PluginHostDeps = {
  vault: string
  fs: FsApi
  doc: DocApi
  index: IndexApi
  event: EventApi
  command: CommandApi
  view: ViewApi
  store: (pluginId: string) => StoreApi
  host: HostApi
  onLog: (msg: string, level?: 'info' | 'warn' | 'error') => void
}

/* ───────── 校验 ───────── */

function assertManifest(m: unknown, dir: string): asserts m is PluginManifest {
  const o = m as Partial<PluginManifest> | null
  const need = ['id', 'name', 'version', 'apiVersion', 'entry'] as const
  if (!o || typeof o !== 'object') throw new Error(`manifest 不是对象（${dir}）`)
  if (o.manifestVersion !== 1) {
    throw new Error(`manifest.manifestVersion 必须是 1（${dir}）`)
  }
  for (const k of need) {
    if (typeof o[k] !== 'string' || !o[k]) {
      throw new Error(`manifest 缺字段或类型不对：${k}（${dir}）`)
    }
  }
  if (!Array.isArray(o.capabilities)) throw new Error(`manifest.capabilities 必须是数组（${dir}）`)
  if (o.platforms && !Array.isArray(o.platforms)) {
    throw new Error(`manifest.platforms 必须是数组（${dir}）`)
  }
}

/** major 相同即可加载（契约 §5：同一 major 内插件不改代码必须可用） */
function assertApiVersion(range: string, pluginId: string): void {
  const wantMajor = range.replace(/^[\^~>=<\s]*/, '').split('.')[0]
  const haveMajor = API_VERSION.split('.')[0]
  if (wantMajor !== haveMajor) {
    throw new Error(
      `插件 ${pluginId} 要求契约 ${range}，当前内核契约 ${API_VERSION} —— major 不匹配，拒绝加载`,
    )
  }
}

function assertCapabilities(caps: string[], pluginId: string): void {
  const unknown = caps.filter((c) => !ALLOWED_CAPABILITIES.includes(c as Capability))
  if (unknown.length) {
    throw new Error(`插件 ${pluginId} 声明了未知 capability：${unknown.join(', ')}`)
  }
  const denied = caps.filter((c) => DENIED_BY_DEFAULT.includes(c as Capability))
  if (denied.length) {
    throw new Error(
      `插件 ${pluginId} 要求默认拒绝的 capability：${denied.join(', ')}（需用户在设置里开启）`,
    )
  }
}

/* ───────── capability 裁剪 ───────── */

function deny(pluginId: string, cap: Capability): never {
  throw new Error(`插件 ${pluginId} 未声明 capability「${cap}」，该调用被拒绝`)
}

function scopedFs(fs: FsApi, caps: Capability[], pluginId: string): FsApi {
  if (caps.includes('fs:write')) return fs
  return {
    ...fs,
    writeText: () => deny(pluginId, 'fs:write'),
    createNote: () => deny(pluginId, 'fs:write'),
    rename: () => deny(pluginId, 'fs:write'),
    delete: () => deny(pluginId, 'fs:write'),
  }
}

function scopedDoc(doc: DocApi, caps: Capability[], pluginId: string): DocApi {
  if (caps.includes('doc:write')) return doc
  return {
    ...doc,
    replaceSelection: () => deny(pluginId, 'doc:write'),
    insertAtCursor: () => deny(pluginId, 'doc:write'),
  }
}

/** 给面板打上「来自哪个插件」的标记（卸载时靠 subs 清理，标记只用于 UI 展示） */
function scopedView(view: ViewApi, pluginId: string): ViewApi {
  return {
    registerPanel: (spec) => view.registerPanel({ ...spec, pluginId } as typeof spec),
    registerWebView: (spec) => view.registerWebView(spec),
  }
}

/* ───────── 加载 / 卸载 ───────── */

export async function listPluginDirs(vault: string): Promise<string[]> {
  return invoke<string[]>('list_plugins', { vault })
}

export async function readManifest(vault: string, dir: string): Promise<PluginManifest> {
  const raw = await invoke<string>('read_plugin_file', {
    vault,
    pluginId: dir,
    rel: 'manifest.json',
  })
  const parsed: unknown = JSON.parse(raw)
  assertManifest(parsed, dir)
  return parsed
}

export async function loadPlugin(dir: string, deps: PluginHostDeps): Promise<LoadedPlugin> {
  const manifest = await readManifest(deps.vault, dir)
  assertApiVersion(manifest.apiVersion, manifest.id)
  assertCapabilities(manifest.capabilities, manifest.id)

  const source = await invoke<string>('read_plugin_file', {
    vault: deps.vault,
    pluginId: dir,
    rel: manifest.entry,
  })

  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
  let mod: { default?: Plugin } & Partial<Plugin>
  try {
    mod = (await import(/* @vite-ignore */ url)) as typeof mod
  } finally {
    URL.revokeObjectURL(url)
  }

  const instance: Plugin | undefined = mod.default ?? (mod.apply ? (mod as Plugin) : undefined)
  if (!instance || typeof instance.apply !== 'function') {
    throw new Error(`插件 ${manifest.id} 的入口没有导出 apply()（需要 export default 或具名 apply）`)
  }

  const subs: Disposable[] = []
  const ctx: PluginContext = {
    fs: scopedFs(deps.fs, manifest.capabilities, manifest.id),
    doc: scopedDoc(deps.doc, manifest.capabilities, manifest.id),
    index: deps.index,
    event: deps.event,
    command: deps.command,
    view: scopedView(deps.view, manifest.id),
    store: deps.store(manifest.id),
    host: deps.host,
    pluginId: manifest.id,
    subscriptions: subs,
  }

  await instance.apply(ctx)
  deps.onLog(`插件已加载：${manifest.name}（${manifest.id}）`, 'info')
  return { dir, manifest, instance, subs }
}

/** 卸载即净：先 dispose 插件自己登记的，再兜底 dispose 全部 subs */
export async function unloadPlugin(loaded: LoadedPlugin, deps: PluginHostDeps): Promise<void> {
  try {
    await loaded.instance.dispose?.()
  } catch (e) {
    deps.onLog(`插件 ${loaded.manifest.id} 的 dispose 抛异常：${String(e)}`, 'warn')
  }
  for (const s of loaded.subs.splice(0)) {
    try {
      s.dispose()
    } catch {
      /* 单个资源清理失败不阻断 */
    }
  }
  deps.onLog(`插件已卸载：${loaded.manifest.id}`, 'info')
}
