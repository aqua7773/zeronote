/**
 * 插件宿主 —— 加载 / 卸载 / capability 校验 / 生命周期（契约 §3 加载规则）
 *
 * 设计要点：
 *  - 插件源码从 `.zn/plugins/<id>/<entry>` 读出来 → Blob URL → 动态 import
 *    （v0.1 **只支持单文件插件**：Blob 里无法解析相对导入）
 *  - capability 只做**自述**校验：未知取值只警告、不拒载（2026-10-13 拆权限门）
 *  - 插件抛异常 → 只卸载该插件，内核继续跑
 *  - 卸载即净：dispose 所有登记资源 + 撤销命令/面板
 */
import { invoke } from '@tauri-apps/api/core'
import { API_VERSION } from './contract'
import { tagCommandImpl } from './command'
import { createWebviewBridge, type WebviewBridgeHandler } from './webview-bridge'
import { UsageRecorder } from './plugin-usage'
import {
  PLUGIN_SIGNATURE_FILE,
  parsePluginSignature,
  signingPayload,
} from '../lib/plugin-signing'
import {
  cachePluginStyle,
  dropBootPluginStyles,
  uncachePluginStyle,
} from '../lib/boot-plugin-styles'
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
  // 上轮加「编辑器底部工具栏」挂载点时漏登记 —— 2026-10-13 拆门后**只会警告**，不再拒载
  'view:editor-toolbar',
  // 编辑器**顶部**提示条（与工具栏对称）—— 加位置时漏登记同样只警告
  'view:editor-topbar',
  // editor 原语（行内标记）
  'editor:mark',
  // 2026-10-13 rev54：编辑器**行首动作按钮**（`editor.addLineAction`）—— 同理，未知值只警告
  'editor:line-action',
  // 2026-10-14 rev78：编辑器**逐行 class**（`editor.addLineClass`）—— 大纲竖线用
  'editor:line-class',
  // 2026-10-14 rev80：编辑器**折叠/展开**（`editor.addFold`）—— 大纲折叠用
  'editor:fold',
  'store',
  'net',
  'proc',
]

/* ───────── 2026-10-13 拆权限门（原则 4）：这里原本是三道门，全部移除 ─────────
 *
 * 删掉的是：`NEEDS_GRANT`（`net`/`proc` 默认拒）· `IsGranted` / `neverGranted`（查授权记录）·
 * `scopedFs` / `scopedDoc`（按 capability 裁剪写方法）· 未知 capability 的拒载。
 *
 * **为什么删而不是修**：`docs/架构原则-2026-10-13.md` §2 是实测，不是推断 ——
 * 插件与宿主跑在同一个 JS 上下文里，`window.__TAURI_INTERNALS__.invoke` 就在手边：
 * 能绕开原语表直连 IPC、能往**库外**写文件、能裸 `fetch`（manifest 没声明 `net` 也照样 200）。
 * 所以这张表**从来不是边界**，留着只制造"插件明明能用却加载不了"的摩擦。
 *
 * 用户 2026-10-13 的裁决：**全部拆掉**，`capabilities` 降级为**自述**
 * （插件页展示"它要什么" + UI 挂载位合法性提示）。内核不再做权限判定、不承诺任何安全保证；
 * 出事的兜底是**修复机制**（`scripts/kernel-restore.mjs` / `修复内核.cmd`），不是防护。
 */

/**
 * 插件住在**哪一个** `.zn/plugins/` 下。
 *
 * 2026-10-17 起插件有两个来源（见 `plugin-roots.ts`）：
 *  - `global` —— 应用级共享目录（`appDataDir()`），**所有笔记库都能用**；
 *  - `vault`  —— 当前库自己的目录（`<库>/.zn/plugins/`，Android 多库时是库根那份）。
 *
 * 身份必须跟着插件走，不能只记目录名：同一个 `dir` 可能两处都有，
 * 而读 manifest / 读入口 / 写 store / 删除的路径算法全靠这个根。
 */
export type PluginSource = 'global' | 'vault'

/** 一次扫描得到的插件条目 */
export type PluginDirEntry = {
  /** `.zn/plugins/` 下的目录名 */
  dir: string
  /** 该插件所在的根（全局根 / 库根）—— 读文件、写 store、删除都按它算路径 */
  root: string
  source: PluginSource
}

export type LoadedPlugin = {
  /** `.zn/plugins/` 下的目录名 */
  dir: string
  /** 这份插件从哪个根加载（卸载/重扫时读文件、写 store 仍按它算） */
  root: string
  source: PluginSource
  manifest: PluginManifest
  instance: Plugin
  /** 插件登记的全部资源（卸载时逐个 dispose） */
  subs: Disposable[]
  /**
   * WebView 面板的**能力通道执行器**（rev173.76 · 契约 §7.9）。
   * 面板渲染时由宿主按 `pluginId` 找到它，把 iframe 发来的 `zn:call` 翻译成插件自己的 API 调用。
   */
  webviewBridge: WebviewBridgeHandler
  /**
   * 签名状态（rev173.77 · 契约 §7.4）：`signed` = 有 `signature.json` 且验签通过；
   * `unsigned` = 没签名文件。**签名无效的插件到不了这一步**（加载时直接拒绝）。
   */
  signature: 'signed' | 'unsigned'
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
  store: (pluginId: string, root?: string) => StoreApi
  host: HostApi
  /** 服务注册表（按插件 id 视图化）—— 「前置插件」靠它互调 */
  service: (pluginId: string) => ServiceApi
  /** 编辑器标记规则的注册表（按插件 id 视图化） */
  editor: (pluginId: string) => EditorApi
  /**
   * 能力使用审计（rev173.78，可选）—— 只记录"用了哪个 API"，不记参数与内容。
   * 不传则完全不记录（单测 / 无宿主环境）。
   */
  usage?: UsageRecorder
  onLog: (msg: string, level?: 'info' | 'warn' | 'error') => void
  /* 2026-10-13 拆权限门：`isGranted` 接线**已删除**（内核不再做权限判定）。
   * 同日清尾：`.zn/permissions.json` 与 Rust 的 `read_permissions` / `set_permission`
   * **已整体删除** —— 内核不再读写任何授权记录。见 `docs/架构原则-2026-10-13.md` §6.1。 */
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
/** 入口文件内容的 SHA-256（hex）—— 完整性校验用（2026-10-18 rev119），Web Crypto 零依赖 */
async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 插件签名验证（rev173.77 · 契约 §7.4）。
 *
 * 有 `signature.json` ⇒ 必须验过；没有 ⇒ `unsigned` 照常加载。
 * payload 由这里**重算**（`zn-plugin-v1|<id>|<version>|<入口 sha256>`），
 * 不信签名文件里可能夹带的其它字段 —— 校验与 `scripts/sign.mjs` 用同一份格式常量
 * （`src/lib/plugin-signing.ts`）。
 *
 * 验签本身在 Rust（`verify_plugin_signature`）：旧 Android WebView 不一定有
 * Web Crypto 的 Ed25519，宿主端做才能保证两个平台结论一致。
 */
async function verifyPluginSignature(opts: {
  root: string
  dir: string
  manifest: PluginManifest
  entryContent: string
}): Promise<'signed' | 'unsigned'> {
  let raw: string
  try {
    raw = await invoke<string>('read_plugin_file', {
      vault: opts.root,
      pluginId: opts.dir,
      rel: PLUGIN_SIGNATURE_FILE,
    })
  } catch {
    // 读不到 = 没有签名文件（这是**正常状态**：本地自用插件不签）
    return 'unsigned'
  }
  const sig = parsePluginSignature(raw)
  if (!sig) {
    throw new Error(
      `插件 ${opts.manifest.id} 的 ${PLUGIN_SIGNATURE_FILE} 格式不对（应为 { alg:'ed25519', keyId, sig }）—— 拒绝加载`,
    )
  }
  const entrySha = await sha256Hex(opts.entryContent)
  const payload = signingPayload(opts.manifest.id, opts.manifest.version, entrySha)
  const status = await invoke<string>('verify_plugin_signature', {
    vault: opts.root,
    pluginId: opts.dir,
    payload,
  })
  return status === 'signed' ? 'signed' : 'unsigned'
}


function assertApiVersion(range: string, pluginId: string): void {
  const wantMajor = range.replace(/^[\^~>=<\s]*/, '').split('.')[0]
  const haveMajor = API_VERSION.split('.')[0]
  if (wantMajor !== haveMajor) {
    throw new Error(
      `插件 ${pluginId} 要求契约 ${range}，当前内核契约 ${API_VERSION} —— major 不匹配，拒绝加载`,
    )
  }
}

/**
 * capability **自述检查**（2026-10-13 拆门后不再拒载）。
 *
 * 只做一件事：声明了内核不认识的取值时**警告**（多半是拼错了）—— **不抛错、不拦加载**。
 * 为什么不再拒：见本文件顶部墓碑注释与 `docs/架构原则-2026-10-13.md` §2 的实测。
 * 保留这个警告是因为它**没有代价**（不制造摩擦），而拼错的 capability 是作者真想知道的。
 */
export function warnUnknownCapabilities(
  caps: string[],
  pluginId: string,
  onLog: (msg: string, level?: 'info' | 'warn' | 'error') => void,
): void {
  const unknown = caps.filter((c) => !ALLOWED_CAPABILITIES.includes(c as Capability))
  if (unknown.length) {
    onLog(
      `插件 ${pluginId} 声明了内核不认识的 capability：${unknown.join(', ')}` +
        `（**不拦加载** —— 内核不做权限判定；但多半是拼错了，合法取值见契约 §4）`,
      'warn',
    )
  }
}

/* ───────── capability 裁剪：2026-10-13 **已整体移除** ─────────
 *
 * 原来这里有 `deny()` + `scopedFs` + `scopedDoc`：没声明 `fs:write` / `doc:write` 的插件，
 * 写方法会被换成抛错的替身。
 *
 * 拆掉的直接理由（原则 4：「权限完全由插件控制，内核不提供任何安全保证」）：
 * 插件与宿主同上下文，`window.__TAURI_INTERNALS__.invoke` 就能绕过这层裁剪去写任意文件
 * （实测见 `docs/架构原则-2026-10-13.md` §2）。留着它只会让"声明了才能写"看起来像约束。
 *
 * ⚠️ 一条曾经的教训值得记：这段代码的注释里写过"新原语必须与老的两条一起裁 ——
 * 漏一个就等于开了后门"。那份小心翼翼的维护成本，花的正是"守一道能被绕过的门"的钱。
 */

/** 登记一个 Disposable，并把它原样返回（方便 `return collect(...)` 链式写法） */
function collect<T extends Disposable>(subs: Disposable[], d: T): T {
  subs.push(d)
  return d
}

/**
 * command 视图：**自动登记**插件注册的每一条命令。
 *
 * 背景（真机实测）：`examples/` 里**8 个**示例都只写了
 * `command.register({…})` 而没接返回值 ⇒ 删除时 `subscriptions` 里没有它 ⇒
 * 卸载不撤销命令 ⇒ **第二次加载同一个插件必撞「命令 id 重复」**。
 * 重扫 / 授权 / 切库都会触发重载，所以这条路径一击即中。
 *
 * 契约里虽然写着「所有资源必须登记」，但宿主**有能力**兜住的事就不该留给插件作者去记。
 * （`service` / `editor` 早就是宿主强制回收，命令与面板现在跟上。）
 */
function scopedCommand(
  cmd: CommandApi,
  pluginId: string,
  subs: Disposable[],
  /**
   * 这个插件**注册过**的命令 id（rev173.76）。
   * 用途只有一个：WebView 通道的 `command.execute` 白名单 —— 页面只能执行
   * "它自己那个插件"注册的命令，碰不到内核命令和其它插件的命令。
   */
  owned?: Set<string>,
): CommandApi {
  const tag = `plugin:${pluginId}`
  return {
    ...cmd,
    // 顺带给实现打归属标记：审计快照靠它判断「这条命令现在是谁在实现」
    // （`core.newNote` 被接管后，命令表本身完全看不出区别）
    register: (spec) => {
      owned?.add(spec.id)
      return collect(subs, cmd.register({ ...spec, run: tagCommandImpl(spec.run, tag) }))
    },
    bind: (id, run) => collect(subs, cmd.bind(id, tagCommandImpl(run, tag))),
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
    // 独立窗口也是"插件开出去的东西"：不登记就会在卸载后继续挂着（窗口里的插件还在跑）
    openWindow: (spec) => collect(subs, view.openWindow(spec)),
    // 整窗接管要注入归属：内核那份 view 不认识调用者，而"谁在接管"正是还原的依据
    overrideShell: (spec) =>
      collect(subs, view.overrideShell({ ...spec, pluginId } as typeof spec)),
  }
}

/*
 * ───────── 接管协议：内核给出的每条注册/接管入口，返回值一律由宿主自动登记 ─────────
 *
 * 契约原本写「所有资源必须登记，插件自己 push 进 `subscriptions`」。实测靠不住：
 * `command.register` / `view.registerPanel` 当初也是这么写的，结果 8 个示例插件
 * 一个都没接返回值（见 `scopedCommand` 的注释）。`event.on` / `fs.watch` / `doc.on`
 * 是同一类东西，且漏登记的后果更隐蔽 —— 卸载后回调仍挂在总线/监听通道上，
 * 闭包仍引用着已卸载插件的状态，要等**下一次事件**才炸（静默失效 > 报错）。
 *
 * **宿主有能力兜住的事，就不该留给插件作者去记。** 所以这三个原语统一包装：
 * 只做登记，**不做能力裁剪**（2026-10-13 拆门后插件拿到的就是内核那一份）。
 */
function scopedEvent(event: EventApi, subs: Disposable[]): EventApi {
  // 展开而非枚举方法：EventApi 将来加方法时这里不会静默漏转发
  return { ...event, on: (topic, cb) => collect(subs, event.on(topic, cb)) }
}

function scopedFs(fs: FsApi, subs: Disposable[]): FsApi {
  return { ...fs, watch: (cb) => collect(subs, fs.watch(cb)) }
}

function scopedDoc(doc: DocApi, subs: Disposable[]): DocApi {
  return { ...doc, on: (ev, cb) => collect(subs, doc.on(ev, cb)) }
}

/**
 * host 包装：**只加一个登记点** `onRollback`，别的原样透传。
 *
 * 为什么需要它（原则 4 之下的唯一出路）：内核**不拦**插件自绘/自改宿主 DOM
 * （插件与宿主同上下文，拦也拦不住 —— §2 实测）。但"不得破坏、卸载即还原"
 * （原则 3）总得有个可操作的落点 ⇒ 提供**登记点**：
 *
 *   · 登记过 ⇒ 内核在卸载时替你调还原函数（并保证只调一次、抛错不连累别的插件）
 *   · 没登记 ⇒ 自己负责（插件作者在 `dispose()` 里写回去）
 *
 * 语义上它和 `subscriptions.push` 等价，但**意图明确**：这是"对外部世界
 * （宿主 DOM、全局变量、document 级监听）做的不可记账改动"的还原声明 ——
 * 而不是又一份需要作者记得手动 push 的 Disposable。
 */
function scopedHost(host: HostApi, pluginId: string, subs: Disposable[]): HostApi {
  return {
    ...host,
    onRollback(fn: () => void): Disposable {
      let disposed = false
      const sub: Disposable = {
        dispose: () => {
          if (disposed) return
          disposed = true
          try {
            fn()
          } catch (e) {
            host.log('warn', `插件 ${pluginId} 的 onRollback 回调抛错：${String(e)}`)
          }
          // 执行过就从账上摘掉：卸载流程里不会再被调第二次
          const i = subs.indexOf(sub)
          if (i >= 0) subs.splice(i, 1)
        },
      }
      subs.push(sub)
      return sub
    },
  }
}

/**
 * 给一个原语套「使用审计」代理（rev173.78）。
 *
 * 只记 **API 名**（`fs.read` / `store.get`），不碰参数、不碰返回值 —— 调用时把 `this`
 * 绑回原对象，行为与未包装时完全一致。没注入 recorder 时原样返回（零开销）。
 *
 * 为什么用 Proxy 而不是逐方法手写：10 个原语几十个方法，手写清单必然漏新方法；
 * Proxy 只拦截"取属性"，新方法自动被覆盖。
 */
function audited<T extends object>(
  pluginId: string,
  apiName: string,
  usage: UsageRecorder | undefined,
  target: T,
): T {
  if (!usage) return target
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver)
      if (typeof prop !== 'string') return value
      if (typeof value !== 'function') {
        // 读属性（`host.platform` / `apiVersion`）也算"用到了这一项"
        if (!prop.startsWith('_')) usage.record(pluginId, `${apiName}.${prop}`)
        return value
      }
      // 只有**真正调用**才记账：只取引用不调用不算使用
      return (...args: unknown[]) => {
        usage.record(pluginId, `${apiName}.${prop}`)
        return (value as (...a: unknown[]) => unknown).apply(t, args)
      }
    },
  })
}

/* ───────── 入口形态兼容层 ───────── *
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
  // 真实样式已注入 ⇒ 预热样式让位（它只是首屏那一下的替身，见 lib/boot-plugin-styles.ts）
  dropBootPluginStyles()
  /**
   * 同 id 的旧样式先移除（2026-10-18 实测踩到）：dev 下 React Refresh 重挂载 `App` 后，
   * 旧一代插件实例的 `loaded` 数组没人消费（新 hook 实例是新的 ref）⇒ 旧样式永远留在 DOM 里，
   * 一份叠一份（实测累积到 3 份主题样式）。生产没有 HMR，但同 id 本来也只该有一份 ——
   * 统一在这里做幂等注入。
   */
  for (const old of document.querySelectorAll('style[data-zn-plugin]')) {
    if ((old as HTMLElement).dataset.znPlugin === pluginId) old.remove()
  }
  const el = document.createElement('style')
  el.dataset.znPlugin = pluginId
  el.textContent = css
  document.head.appendChild(el)
  styleTags.set(pluginId, el)
  // 记进 localStorage：下次启动在 React 挂载前先摆上，避免主题闪一下深色
  cachePluginStyle(pluginId, css)
  return {
    dispose: () => {
      el.remove()
      styleTags.delete(pluginId)
      uncachePluginStyle(pluginId)
    },
  }
}

/* ───────── 加载 / 卸载 ───────── */

/**
 * 列出某个根下的插件目录（`<root>/.zn/plugins/` 的子目录，已排序）。
 *
 * `root` 既可以是**当前库**，也可以是**全局插件根**（`appDataDir()`）——
 * Rust 侧 `private_root()` 只做路径计算，不关心传进来的是不是"真库"。
 */
export async function listPluginDirs(root: string): Promise<string[]> {
  return invoke<string[]>('list_plugins', { vault: root })
}

/**
 * 删除插件目录（连同 manifest / 入口 / store.json）。
 *
 * `root` 决定删的是**全局**那份还是**库内**那份 —— 必须与加载时的根一致，
 * 否则会删错位置（或报"插件不存在"）。
 *
 * **不可撤销**，而且刻意不进回收站 —— 插件属于"把目录拷回来就能重装"的东西；
 * 回收站的命名规则是为 `.md` 设计的，塞目录进去反而没人看得懂。删完调
 * `setReloadToken` 就会走一遍正常的重扫 / 卸载流程。
 */
export async function deletePluginDir(root: string, pluginId: string): Promise<void> {
  return invoke<void>('delete_plugin', { vault: root, pluginId })
}

export async function readManifest(root: string, dir: string): Promise<PluginManifest> {
  const raw = await invoke<string>('read_plugin_file', {
    vault: root,
    pluginId: dir,
    rel: 'manifest.json',
  })
  const parsed: unknown = JSON.parse(raw)
  assertManifest(parsed, dir)
  return parsed
}

export async function loadPlugin(entry: PluginDirEntry, deps: PluginHostDeps): Promise<LoadedPlugin> {
  const { root, dir } = entry
  const manifest = await readManifest(root, dir)
  assertApiVersion(manifest.apiVersion, manifest.id)
  // 平台门排在 capability 之前：一个跑不起来的插件，先说"它不适用于这台机器"，
  // 比先说"你还得去授权 net"更接近用户真正需要知道的事。
  assertPlatform(manifest, platformOf(deps.platform))
  warnUnknownCapabilities(manifest.capabilities, manifest.id, deps.onLog)

  const subs: Disposable[] = []
  const readFile = (rel: string) =>
    invoke<string>('read_plugin_file', { vault: root, pluginId: dir, rel })

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
    return {
      dir,
      root,
      source: entry.source,
      manifest,
      instance: { apply: () => {} },
      subs,
      // 纯样式插件没有 JS，也就没有能力通道 —— 明确报错优于静默返回 undefined
      webviewBridge: async () => {
        throw new Error(`插件 ${manifest.id} 是纯样式插件，没有 WebView 能力通道`)
      },
      // 纯样式插件没有 entry，签名 payload 无从算起 ⇒ 恒为未签名
      signature: 'unsigned',
    }
  }

  // ── 有 JS 入口：先嗅探形态，再组装成 ESM 交给 import ──
  const entrySrc = await readFile(manifest.entry)
  /**
   * **完整性校验**（2026-10-18 rev119）：manifest 声明了 `sha256` 就必须对得上。
   * 只覆盖入口一个文件 —— 它是"文件被改过/装坏了"的提示，不是签名（见契约 §3）。
   * 用 Web Crypto，零新依赖。
   */
  if (manifest.sha256) {
    const got = await sha256Hex(entrySrc)
    const want = manifest.sha256.trim().toLowerCase()
    if (got !== want) {
      throw new Error(
        `插件 ${manifest.id} 完整性校验失败：入口文件 sha256 不符（manifest 声明 ${want.slice(0, 12)}…，实际 ${got.slice(0, 12)}…）—— 文件可能被改过`,
      )
    }
  }

  /**
   * **签名验证**（rev173.77 · 契约 §7.4）：有 `signature.json` 就必须验过，否则**拒绝加载**。
   *
   * 与上面的 sha256 是两件事：
   *  · sha256 只证明"文件没被改坏"，谁都算得出来；
   *  · 签名证明"**是谁**发布的这一版"—— 换了人 / 改了 id / 改了版本号都会失效。
   * 没有签名文件 ⇒ `unsigned`，照常加载（本地自用插件不必签）。
   */
  const signature = await verifyPluginSignature({
    root,
    dir,
    manifest,
    entryContent: entrySrc,
  })
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

  /** 这个插件注册过的命令 id（WebView 通道 `command.execute` 的白名单来源） */
  const ownedCommands = new Set<string>()
  /** 使用审计包装（rev173.78）：没注入 recorder 时这些调用是零开销的直通 */
  const audit = <T extends object>(api: string, target: T): T =>
    audited(manifest.id, api, deps.usage, target)

  const ctx: PluginContext = {
    // 2026-10-13 拆门：不再按 capability 裁剪 —— 插件拿到的就是内核那一份。
    // 这里的包装**只做"返回值自动登记"**（接管协议第一、二条规矩），别的一律透传。
    fs: audit('fs', scopedFs(deps.fs, subs)),
    doc: audit('doc', scopedDoc(deps.doc, subs)),
    index: audit('index', deps.index),
    event: audit('event', scopedEvent(deps.event, subs)),
    command: audit('command', scopedCommand(deps.command, manifest.id, subs, ownedCommands)),
    view: audit('view', scopedView(deps.view, manifest.id, subs)),
    // store 跟着**插件所在的那份根**走：全局插件的数据全局共享（装一次、配置一次），
    // 库内插件的数据落库内（换库就是另一份）。与"文件即真相"的落盘语义一致。
    store: audit('store', deps.store(manifest.id, root)),
    host: audit('host', scopedHost(deps.host, manifest.id, subs)),
    service: audit('service', deps.service(manifest.id)),
    editor: audit('editor', deps.editor(manifest.id)),
    pluginId: manifest.id,
    subscriptions: subs,
  }

  deps.usage?.markLoaded(manifest.id)

  try {
    await instance.apply(ctx)
  } catch (e) {
    rollback()
    throw e
  }

  /**
   * WebView 能力通道（rev173.76 · 契约 §7.9）：`apply()` 之后建，
   * 这样 `ownedCommands` 已经被 `command.register` 填过一轮（引用同一个 Set，执行时再查）。
   */
  const webviewBridge = createWebviewBridge({
    pluginId: manifest.id,
    store: ctx.store,
    host: ctx.host,
    command: deps.command,
    ownedCommands,
  })

  const fileNote = manifest.files?.length ? `，${manifest.files.length + 1} 个文件` : ''
  deps.onLog(`插件已加载：${manifest.name}（${manifest.id}｜${kind}${fileNote}）`, 'info')
  return { dir, root, source: entry.source, manifest, instance, subs, webviewBridge, signature }
}

/** 卸载即净：先 dispose 插件自己登记的，再兜底 dispose 全部 subs */
export async function unloadPlugin(loaded: LoadedPlugin, deps: PluginHostDeps): Promise<void> {
  // 审计先记一笔「不在跑了」；历史 API 记录保留（审计要的是历史）
  deps.usage?.markUnloaded(loaded.manifest.id)
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
