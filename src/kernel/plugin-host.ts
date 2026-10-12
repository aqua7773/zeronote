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
  ServiceApi,
  EditorApi,
  PluginManifest,
  PluginPlatform,
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
  // 上轮加「编辑器底部工具栏」挂载点时漏登记，插件老实声明它会被判"未知 capability"而拒载
  'view:editor-toolbar',
  // editor 原语（行内标记）
  'editor:mark',
  'store',
  'net',
  'proc',
]

/**
 * 「默认拒」的两项 —— 不是永远拒，而是**没被用户逐个授权就拒**。
 *
 * 授权记录 `<私有根>/.zn/permissions.json`（`kernel/permissions.ts`），
 * 由设置页「插件 → 网络访问」区块写入。
 * ⚠️ 这是**可绕过的边界**（插件与宿主同上下文），兑现的是知情与承诺，不是隔离 —— 契约 §4。
 */
const NEEDS_GRANT: readonly Capability[] = ['net', 'proc']

/** 查授权记录：这个插件的这项能力被用户开过吗 */
export type IsGranted = (pluginId: string, capability: string) => boolean

/** 缺省（没接线时）一律视为未授权 —— 宁可拒载，不可静默放行 */
const neverGranted: IsGranted = () => false

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
  /**
   * 当前平台（与 `host.platform` 同源）。**平台门的输入** ——
   * 声明了 `platforms` 的插件拿它比对，不符就不加载（见 `supportsPlatform`）。
   */
  platform: HostApi['platform']
  fs: FsApi
  doc: DocApi
  index: IndexApi
  event: EventApi
  command: CommandApi
  view: ViewApi
  store: (pluginId: string) => StoreApi
  host: HostApi
  /** 服务注册表（按插件 id 视图化）—— 「前置插件」靠它互调 */
  service: (pluginId: string) => ServiceApi
  /** 编辑器标记规则的注册表（按插件 id 视图化） */
  editor: (pluginId: string) => EditorApi
  onLog: (msg: string, level?: 'info' | 'warn' | 'error') => void
  /**
   * 查授权记录（`.zn/permissions.json`）。**不接线 = 一律未授权**。
   *
   * 之所以是函数而不是一份表：`assertCapabilities` 在加载路径里是**同步**判定的，
   * 而权限表是异步从磁盘读的 —— 调用方用 ref 提供"当前值"，就不会读到旧闭包，
   * 也不会因为读表失败而放行。
   */
  isGranted?: IsGranted
}

/* ───────── 校验 ───────── */

/* ── 平台门：manifest.platforms ↔ host.platform ── */

/**
 * 把 `host.platform` 归一到 manifest 用的两档词汇。
 *
 * 两套词汇表不一致是历史遗留：`host.platform` 是 `windows | android | other`
 * （插件运行时自己查询用），manifest 里是 `desktop | android`（作者关心的粒度）。
 * **`other`（macOS / Linux 桌面）算 `desktop`** —— 桌面就是桌面，
 * 不该因为不是 Windows 就把桌面插件判成"不适用"。
 */
export function platformOf(host: HostApi['platform']): PluginPlatform {
  return host === 'android' ? 'android' : 'desktop'
}

/** 这个插件能在当前平台跑吗 —— **缺省（没写 `platforms`）= 全平台** */
export function supportsPlatform(
  m: Pick<PluginManifest, 'platforms'>,
  current: PluginPlatform,
): boolean {
  const declared = m.platforms
  if (!Array.isArray(declared) || declared.length === 0) return true
  return declared.includes(current)
}

/**
 * 平台不符时抛的**专用错误**。
 *
 * 为什么要单独一个类型：调用方必须能把它和"真失败"分开 —— 平台不符是**正常跳过**，
 * 不能进错误横幅（把桌面专属插件拷到手机上、再打开手机看一眼，太常见了）。
 */
export class PlatformMismatch extends Error {
  // 不用构造函数参数属性：tsconfig 开了 `erasableSyntaxOnly`，那种语法会被 tsc 拒掉
  readonly pluginId: string
  readonly declared: PluginPlatform[]
  readonly current: PluginPlatform

  constructor(pluginId: string, declared: PluginPlatform[], current: PluginPlatform) {
    super(`插件 ${pluginId} 只支持 ${declared.join(' / ')}，当前是 ${current} —— 已跳过加载`)
    this.name = 'PlatformMismatch'
    this.pluginId = pluginId
    this.declared = declared
    this.current = current
  }
}

/** 平台门本体：不符就抛 `PlatformMismatch`（**所有加载路径都得过它**） */
function assertPlatform(m: PluginManifest, current: PluginPlatform): void {
  if (!supportsPlatform(m, current)) {
    throw new PlatformMismatch(m.id, m.platforms ?? [], current)
  }
}

function assertManifest(m: unknown, dir: string): asserts m is PluginManifest {
  const o = m as Partial<PluginManifest> | null
  // entry 不再是必填：纯样式（主题类）插件只声明 styles 即可，不写 JS
  const need = ['id', 'name', 'version', 'apiVersion'] as const
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
  if (o.platforms !== undefined) {
    if (!Array.isArray(o.platforms)) {
      throw new Error(`manifest.platforms 必须是数组（${dir}）`)
    }
    // 写错一个字母（`"windwos"`）以前是**静默失效**：插件照常加载，作者却以为限住了平台。
    // 现在直接拒载并列出合法取值 —— 与"静默失效比报错危险"同一条纪律。
    const bad = o.platforms.filter((p) => p !== 'desktop' && p !== 'android')
    if (bad.length) {
      throw new Error(
        `manifest.platforms 有非法取值：${bad.join(', ')}` +
          `（只接受 "desktop" / "android"；要双端就两个都写）（${dir}）`,
      )
    }
  }
  // 至少得有一点东西可加载：一个 JS 入口，或一份要注入的样式
  if (!o.entry && !(Array.isArray(o.styles) && o.styles.length)) {
    throw new Error(`manifest 既没有 entry 也没有 styles，没有可加载的内容（${dir}）`)
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

function assertCapabilities(caps: string[], pluginId: string, isGranted: IsGranted): void {
  const unknown = caps.filter((c) => !ALLOWED_CAPABILITIES.includes(c as Capability))
  if (unknown.length) {
    throw new Error(`插件 ${pluginId} 声明了未知 capability：${unknown.join(', ')}`)
  }
  // 「默认拒」两项：**查授权记录**，不再是"声明即拒"。
  // 记录里没有 = 没授权（fail closed）；`proc` 目前没有 UI 入口 ⇒ 行为仍是拒。
  const denied = caps.filter((c) => NEEDS_GRANT.includes(c as Capability) && !isGranted(pluginId, c))
  if (denied.length) {
    throw new Error(
      `插件 ${pluginId} 要求默认拒绝的 capability：${denied.join(', ')}` +
        `（到「设置 → 插件 → 网络访问」里为它开启；授权记录 .zn/permissions.json）`,
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
    mkdir: () => deny(pluginId, 'fs:write'),
    move: () => deny(pluginId, 'fs:write'),
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

/** 登记一个 Disposable，并把它原样返回（方便 `return collect(...)` 链式写法） */
function collect<T extends Disposable>(subs: Disposable[], d: T): T {
  subs.push(d)
  return d
}

/**
 * command 视图：**自动登记**插件注册的每一条命令。
 *
 * 背景（真机实测）：`examples/ui-kit` / `tag-demo` 等**8 个**示例都只写了
 * `command.register({…})` 而没接返回值 ⇒ 删除时 `subscriptions` 里没有它 ⇒
 * 卸载不撤销命令 ⇒ **第二次加载同一个插件必撞「命令 id 重复：ui-kit.hit」**。
 * 重扫 / 授权 / 切库都会触发重载，所以这条路径一击即中。
 *
 * 契约里虽然写着「所有资源必须登记」，但宿主**有能力**兜住的事就不该留给插件作者去记。
 * （`service` / `editor` 早就是宿主强制回收，命令与面板现在跟上。）
 */
function scopedCommand(cmd: CommandApi, subs: Disposable[]): CommandApi {
  return {
    ...cmd,
    register: (spec) => collect(subs, cmd.register(spec)),
    bind: (id, run) => collect(subs, cmd.bind(id, run)),
  }
}

/**
 * view 视图：打上「来自哪个插件」的标记（UI 上标注来源），并**自动登记**注册出的资源。
 *
 * 面板/WebView 的注册是幂等的（同 id 替换），不登记也不会报错 —— 但那样"卸载即净"
 * 就名不副实了：面板会在插件删掉之后继续挂在菜单里。所以一起收进 subs。
 */
function scopedView(view: ViewApi, pluginId: string, subs: Disposable[]): ViewApi {
  return {
    ...view,
    registerPanel: (spec) =>
      collect(subs, view.registerPanel({ ...spec, pluginId } as typeof spec)),
    registerWebView: (spec) =>
      collect(subs, view.registerWebView({ ...spec, pluginId } as typeof spec)),
  }
}

/* ───────── 入口形态兼容层 ─────────
 *
 * 背景：v0.1 原先只有「读单文件 → Blob → 动态 import」，等于把成熟生态里
 * 最常见的几种写法全挡在门外（依据 `_research\插件API对比.md` §8）：
 *   · CommonJS —— Lumina-Note：`module.exports = function(api, plugin){}`
 *   · 全局注册 —— Yank Note：`window.registerPlugin({name, register})`
 *   · 多文件   —— 拆成 lib/*.js 再 require
 *   · 纯样式   —— NoteGen：`entry` 可选，主题类插件可以不写 JS
 *
 * 这一层就在 import 之前补上它们：按**内容嗅探**判断形态，转成 ESM 再交给 import。
 * Blob 里没有 require/module/exports —— 多文件的依赖解析只能自己带一个极简运行时。
 */

type EntryKind = 'esm' | 'cjs' | 'iife'

/** 路径 → 源码。键统一为 POSIX 相对路径 */
type PluginFiles = Record<string, string>

/** 粗暴地去掉注释，避免注释里的 `registerPlugin` 之类单词造成误判 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1')
}

/** 内容嗅探：这个入口是什么形态 */
export function sniffEntryKind(src: string): EntryKind {
  const code = stripComments(src)
  // 有静态 import/export 就是 ESM（含 `export default`）
  if (/(^|\n)\s*(import|export)[\s{*'"]/.test(code)) return 'esm'
  // CommonJS 的两种赋值写法
  if (/\bmodule\.exports\b|\bexports\.[A-Za-z_$]/.test(code)) return 'cjs'
  // 全局注册（Yank Note 风格）
  if (/\bregisterPlugin\s*\(/.test(code)) return 'iife'
  // 认不出就按 ESM 交给 import —— 它报的错比我们自己编的准
  return 'esm'
}

/**
 * 把一批文件装进一个极简的 CommonJS 运行时，产出一段 ESM。
 * 为什么自己写：Blob URL 里没有 require/module/exports，也没有"基础目录"
 * 让 ESM 的相对导入可以解析。这层胶水只有几十行，够用且可解释。
 */
export function buildCjsBundle(entry: string, files: PluginFiles): string {
  return `const __files = ${JSON.stringify(files)};
const __cache = {};
function __dirOf(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
function __norm(base, rel) {
  const parts = (base ? base.split('/') : []).concat(rel.split('/'));
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}
function __resolve(spec, from) {
  const base = __dirOf(from);
  const cands = spec.startsWith('.') ? [__norm(base, spec)] : [spec];
  for (const c of cands) {
    if (__files[c] !== undefined) return c;
    if (__files[c + '.js'] !== undefined) return c + '.js';
    if (__files[c + '/index.js'] !== undefined) return c + '/index.js';
  }
  throw new Error('require 找不到模块：' + spec + '（来自 ' + from + '）'
    + '。多文件插件需要在 manifest.files 里声明它。');
}
function __load(id) {
  if (__cache[id]) return __cache[id].exports;
  const module = { exports: {} };
  __cache[id] = module;
  let fn;
  try {
    fn = new Function('module', 'exports', 'require', __files[id]);
  } catch (e) {
    throw new Error('模块语法错误（' + id + '）：' + (e && e.message ? e.message : e));
  }
  fn(module, module.exports, function (spec) { return __load(__resolve(spec, id)); });
  return module.exports;
}
export default __load(${JSON.stringify(entry)});
`
}

/** 全局注册形态：把 `registerPlugin(obj)` 收到手里再导出 */
export function buildIifeBundle(src: string): string {
  return `let __p = null;
globalThis.registerPlugin = function (p) { __p = p; };
try { globalThis.window.registerPlugin = globalThis.registerPlugin; } catch (e) {}
;(function () {
${src}
})();
if (!__p) throw new Error('入口调用了 registerPlugin，但没有传入插件对象');
export default __p;
`
}

/**
 * 把 import 出来的东西归一成契约要求的 `{ apply, dispose? }`。
 * 四种真实存在的导出形态都要吃：
 *   1. `export default { apply }`            —— 契约标准写法
 *   2. `export function apply`               —— 具名导出
 *   3. `module.exports = function (api) {}`  —— Lumina-Note 风格，导出的是函数本身
 *   4. `registerPlugin({ register })`        —— Yank Note 风格，字段名是 register
 */
export function toPlugin(mod: unknown): Plugin | undefined {
  const m = mod as Record<string, unknown> | null
  if (!m) return undefined
  const cand = (m.default ?? m) as unknown
  // 形态 3：导出函数本身
  if (typeof cand === 'function') return { apply: cand as Plugin['apply'] }
  if (typeof cand === 'object' && cand) {
    const o = cand as Record<string, unknown>
    // 形态 1 / 2
    if (typeof o.apply === 'function') return cand as Plugin
    // 形态 4：{ name, register }
    if (typeof o.register === 'function') {
      return {
        apply: (o.register as Plugin['apply']).bind(cand),
        dispose: typeof o.dispose === 'function' ? (o.dispose as () => void).bind(cand) : undefined,
      }
    }
  }
  // 兜底：模块本身具名导出了 apply（`export function apply` 在 default 为空时会走到这）
  if (typeof m.apply === 'function') return m as unknown as Plugin
  return undefined
}

/** 纯样式插件的注入目标；卸载时按 id 移除 */
const styleTags = new Map<string, HTMLStyleElement>()

function injectStyles(pluginId: string, css: string): Disposable {
  const el = document.createElement('style')
  el.dataset.znPlugin = pluginId
  el.textContent = css
  document.head.appendChild(el)
  styleTags.set(pluginId, el)
  return {
    dispose: () => {
      el.remove()
      styleTags.delete(pluginId)
    },
  }
}

/* ───────── 加载 / 卸载 ───────── */

export async function listPluginDirs(vault: string): Promise<string[]> {
  return invoke<string[]>('list_plugins', { vault })
}

/**
 * 删除插件目录（连同 manifest / 入口 / store.json）。
 *
 * **不可撤销**，而且刻意不进回收站 —— 插件属于"把目录拷回来就能重装"的东西；
 * 回收站的命名规则是为 `.md` 设计的，塞目录进去反而没人看得懂。删完调
 * `setReloadToken` 就会走一遍正常的重扫 / 卸载流程。
 */
export async function deletePluginDir(vault: string, pluginId: string): Promise<void> {
  return invoke<void>('delete_plugin', { vault, pluginId })
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
  // 平台门排在 capability 之前：一个跑不起来的插件，先说"它不适用于这台机器"，
  // 比先说"你还得去授权 net"更接近用户真正需要知道的事。
  assertPlatform(manifest, platformOf(deps.platform))
  assertCapabilities(manifest.capabilities, manifest.id, deps.isGranted ?? neverGranted)

  const subs: Disposable[] = []
  const readFile = (rel: string) =>
    invoke<string>('read_plugin_file', { vault: deps.vault, pluginId: dir, rel })

  /** 登记的资源要在任何一步失败时清干净，避免留下「半个插件」 */
  const rollback = () => {
    for (const s of subs.splice(0)) {
      try {
        s.dispose()
      } catch {
        /* 单个清理失败不阻断其余 */
      }
    }
  }

  // ── 纯样式插件：没有 JS 入口，注入 CSS 即可（主题类） ──
  if (!manifest.entry) {
    try {
      for (const rel of manifest.styles ?? []) {
        subs.push(injectStyles(manifest.id, await readFile(rel)))
      }
    } catch (e) {
      rollback()
      throw e
    }
    deps.onLog(`插件已加载（纯样式）：${manifest.name}（${manifest.id}）`, 'info')
    return { dir, manifest, instance: { apply: () => {} }, subs }
  }

  // ── 有 JS 入口：先嗅探形态，再组装成 ESM 交给 import ──
  const entrySrc = await readFile(manifest.entry)
  const kind = sniffEntryKind(entrySrc)

  let code: string
  if (kind === 'esm') {
    // 已经有 ESM 语法，原样加载（相对导入在 Blob 里解析不了 —— 见契约 §3 的限制）
    code = entrySrc
  } else if (kind === 'cjs') {
    // 单文件与多文件走同一条路：把声明过的文件全部读出来交给虚拟 CommonJS 运行时
    const files: PluginFiles = { [manifest.entry]: entrySrc }
    try {
      for (const rel of manifest.files ?? []) {
        if (rel !== manifest.entry) files[rel] = await readFile(rel)
      }
    } catch (e) {
      throw new Error(`插件 ${manifest.id} 的 manifest.files 读取失败：${String(e)}`)
    }
    code = buildCjsBundle(manifest.entry, files)
  } else {
    code = buildIifeBundle(entrySrc)
  }

  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  let mod: unknown
  try {
    mod = await import(/* @vite-ignore */ url)
  } catch (e) {
    throw new Error(`插件 ${manifest.id} 入口加载失败（判定形态：${kind}）：${String(e)}`)
  } finally {
    URL.revokeObjectURL(url)
  }

  const instance = toPlugin(mod)
  if (!instance || typeof instance.apply !== 'function') {
    throw new Error(
      `插件 ${manifest.id} 的入口没有可用的 apply()（判定形态：${kind}）。` +
        `支持四种写法：export default { apply }、export function apply、` +
        `module.exports = function (api) {}、registerPlugin({ register })`,
    )
  }

  // 与 JS 入口并存的样式（可选）：先登记，失败一起回滚
  try {
    for (const rel of manifest.styles ?? []) {
      subs.push(injectStyles(manifest.id, await readFile(rel)))
    }
  } catch (e) {
    rollback()
    throw new Error(`插件 ${manifest.id} 的 manifest.styles 读取失败：${String(e)}`)
  }

  const ctx: PluginContext = {
    fs: scopedFs(deps.fs, manifest.capabilities, manifest.id),
    doc: scopedDoc(deps.doc, manifest.capabilities, manifest.id),
    index: deps.index,
    event: deps.event,
    command: scopedCommand(deps.command, subs),
    view: scopedView(deps.view, manifest.id, subs),
    store: deps.store(manifest.id),
    host: deps.host,
    service: deps.service(manifest.id),
    editor: deps.editor(manifest.id),
    pluginId: manifest.id,
    subscriptions: subs,
  }

  try {
    await instance.apply(ctx)
  } catch (e) {
    rollback()
    throw e
  }

  const fileNote = manifest.files?.length ? `，${manifest.files.length + 1} 个文件` : ''
  deps.onLog(`插件已加载：${manifest.name}（${manifest.id}｜${kind}${fileNote}）`, 'info')
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
