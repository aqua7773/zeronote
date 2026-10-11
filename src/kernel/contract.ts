/**
 * ZeroNote 内核契约 v0.1 —— 类型定义
 * 对应 `docs\内核契约-v0.1.md` §1 / §2
 *
 * 铁律：内核与插件之间**只**通过这些接口通信；内核不认识任何具体功能
 * （标签 / 同步 / AI / 画布 / 灵感流 都不在本文件里）。
 */

export type Disposable = { dispose(): void }

/* ───────────────── 数据面 ───────────────── */

export type NoteMeta = {
  /** 库内相对路径，统一 POSIX 分隔符（`notes/a.md`） */
  path: string
  title: string
  /** 毫秒时间戳 */
  mtime: number
  size: number
  frontmatter: Record<string, unknown>
}

export type FsChange = {
  kind: 'create' | 'modify' | 'delete' | 'rename'
  path: string
}

/** 1. fs —— 文件读写。所有写入必须原子（临时文件 + rename）。 */
export interface FsApi {
  vaultPath(): string
  listNotes(dir?: string): Promise<NoteMeta[]>
  readText(path: string): Promise<string>
  writeText(path: string, content: string): Promise<void>
  createNote(path: string, content?: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  /**
   * 新建目录（多级一起建，幂等）。**文件夹功能的基础** —— 在此之前插件没法在库里造目录，
   * 「按年/月/日归档」这类结构只能靠 `createNote` 顺带建父目录。
   */
  mkdir(path: string): Promise<void>
  /**
   * 移动 / 重命名**文件或整个目录树**（与 `rename` 的区别就在能搬目录）。
   * 语义同 `mv`：`to` 是已存在的目录 ⇒ 移入其中；否则当新路径（已存在则报错，不静默覆盖）。
   * 禁止把目录移进自己的子孙。
   */
  move(from: string, to: string): Promise<void>
  /** 移入 .zn/trash/（不是物理删除）；返回回收站里的库内相对路径，供撤销 rename 回来 */
  delete(path: string): Promise<string>
  exists(path: string): Promise<boolean>
  watch(cb: (e: FsChange) => void): Disposable
}

export type NoteDoc = {
  path: string
  content: string
  frontmatter: Record<string, unknown>
  dirty: boolean
}

/** 2. doc —— 当前文档 / 选区。编辑类操作只有 replaceSelection / insertAtCursor 两个入口。 */
export interface DocApi {
  active(): NoteDoc | null
  open(path: string): Promise<void>
  close(path?: string): void
  save(path?: string): Promise<void>
  selection(): { from: number; to: number; text: string } | null
  replaceSelection(text: string): void
  insertAtCursor(text: string): void
  on(ev: 'open' | 'change' | 'save' | 'close', cb: (d: NoteDoc) => void): Disposable
}

export type SearchHit = { path: string; title: string; excerpt: string; score: number }

/** 3. index —— 可删可重建的索引（v0.2 实现） */
export interface IndexApi {
  query(q: string, opts?: { limit?: number; dir?: string }): Promise<SearchHit[]>
  upsert(path: string, text: string): Promise<void>
  remove(path: string): Promise<void>
  rebuild(): Promise<{ count: number; ms: number }>
}

/** 内核固定事件（不改名） */
export type KernelEvent =
  | 'app:ready'
  | 'app:quit'
  | 'vault:open'
  | 'note:created'
  | 'note:changed'
  | 'note:saved'
  | 'note:renamed'
  | 'note:deleted'
  | 'index:rebuilt'

/** 4. event —— 事件总线 */
export interface EventApi {
  on(topic: KernelEvent | string, cb: (payload: unknown) => void): Disposable
  emit(topic: string, payload: unknown): void
}

/* ───────────────── 扩展面 ───────────────── */

export type CommandSpec = {
  /** 必须带插件前缀：`inspiration-flow.capture` */
  id: string
  title: string
  keybinding?: string
  when?: string
  run: (...args: unknown[]) => unknown
}

/** 5. command —— 命令 / 快捷键 / 命令面板 */
export interface CommandApi {
  register(cmd: CommandSpec): Disposable
  execute(id: string, ...args: unknown[]): Promise<unknown>
  list(): { id: string; title: string }[]
}

/** 间距档位（避免插件写死 px，保持版式一致） */
export type UIGap = 'sm' | 'md' | 'lg'

/** 语义色（映射到 --zn-* token；插件不要自己指定颜色） */
export type UITone = 'default' | 'muted' | 'success' | 'warn' | 'danger'

/**
 * 列表项：**强烈建议给 `key`**。
 * 过去 `items: UINode[]` 只能用下标做 React key ⇒ 增删一项会让后面所有行错位
 * （受控输入尤其明显：删除第 1 行后，第 2 行的输入框会"继承"它的值）。
 * 为兼容旧插件，裸 `UINode` 仍然接受（内部退化为下标）。
 */
export type UIListItem = UINode | { key: string; node: UINode }

export type UITableColumn = {
  key: string
  label: string
  /** CSS 宽度，如 `40%` / `80px`；缺省按内容自适应 */
  width?: string
  align?: 'left' | 'right'
}

/** 单元格可以是纯文本/数字（宿主按文本渲染），也可以是任意 UINode（内嵌按钮、徽标等） */
export type UITableRow = Record<string, UINode | string | number>

/**
 * 声明式 UI：插件只「声明」界面，宿主用统一组件渲染 ⇒ 风格 100% 统一、框架无关。
 *
 * 三条铁律（改这个类型之前先读）：
 * ① **纯数据**：没有函数、没有 DOM、没有样式对象 —— 全部可 JSON 序列化，
 *    将来插件进 Worker / iframe 沙箱时这套声明不用改。
 * ② **不给颜色**：视觉一律走 `variant` / `tone` / `gap` 这些语义档位，
 *    由宿主映射到 `--zn-*` token ⇒ 主题切换 / 暗色模式自动跟随。
 * ③ **加 type 必须同步改 `UIRenderer.tsx`** —— 那边有穷尽性检查（`never`），
 *    漏了会编译报错，这是有意的。
 */
export type UINode =
  /* ── 布局 ── */
  | { type: 'stack'; children: UINode[]; gap?: UIGap }
  | {
      type: 'row'
      children: UINode[]
      gap?: UIGap
      align?: 'start' | 'center' | 'end'
      /** 窄容器（手机）里是否允许换行 */
      wrap?: boolean
    }
  | { type: 'divider' }
  | { type: 'spacer'; size?: UIGap }
  /* ── 文本 ── */
  | { type: 'text'; value: string; variant?: 'body' | 'caption' | 'title'; tone?: UITone }
  | { type: 'markdown'; value: string }
  | { type: 'code'; value: string; lang?: string }
  /**
   * 富内容：插件把**已经生成好的 HTML** 交给宿主内联渲染。
   *
   * 用途：公式（katex）· 图表（mermaid → svg）· markdown 渲染结果 · 代码高亮。
   * ⚠️ **这是用安全性换表达力**：宿主用 `dangerouslySetInnerHTML` 注入，
   * 插件（或它拉的 CDN 库）返回什么就渲染什么。v0.1 的插件全是本机可信代码，
   * 可以接受；**装第三方插件前请先读它的源码**（契约 §4 已声明无沙箱）。
   * 只想要代码块/纯文本时请用 `code` / `text`，别用这个。
   */
  | { type: 'html'; value: string }
  /** 命令驱动的"链接"外观：不做真实导航（WebView 里跳转会顶掉应用），点它执行命令 */
  | { type: 'link'; label?: string; onClick: string; payload?: Record<string, unknown> }
  /* ── 媒体 ── */
  /**
   * 图片。`src` 接受：
   *   · `http(s)://` 或 `data:` / `blob:` URL —— 原样用
   *   · 库内相对路径（`attachments/a.png`）—— **请先用 `host.assetUrl(rel)` 转换**
   */
  | {
      type: 'image'
      src: string
      alt?: string
      /** 高度上限（px）；缺省不限，宽度始终 100% 不溢出 */
      height?: number
      fit?: 'contain' | 'cover'
    }
  /* ── 交互 ── */
  | {
      type: 'button'
      label: string
      onClick: string
      /**
       * 把 `state[send]` 的当前值作为 `{ value }` 传给命令 —— 插件按钮读输入框的标准做法。
       * 需要传更多字段时用 `payload`（它会与 `{ value }` 合并，`send` 优先）。
       */
      send?: string
      /** 静态参数，原样合并进命令 payload —— 例如"点第 3 行的删除"传 `{ index: 3 }` */
      payload?: Record<string, unknown>
      variant?: 'default' | 'ghost' | 'danger'
      disabled?: boolean
    }
  | { type: 'input'; bind: string; placeholder?: string; onSubmit?: string }
  | { type: 'textarea'; bind: string; placeholder?: string; rows?: number; onSubmit?: string }
  | { type: 'select'; bind: string; options: { value: string; label: string }[]; onSubmit?: string }
  | { type: 'checkbox'; bind: string; label?: string; onSubmit?: string }
  /* ── 数据展示 ── */
  | {
      type: 'list'
      items: UIListItem[]
      empty?: string
      /** 有它时**整行可点**，命令 payload 带 `{ index, key }` */
      onClick?: string
    }
  | { type: 'table'; columns: UITableColumn[]; rows: UITableRow[]; empty?: string }
  /** 进度：`value / max`；`max` 缺省 100 */
  | { type: 'progress'; value: number; max?: number; label?: string }
  | { type: 'badge'; text: string; tone?: UITone }
  /* ── 表单 ── */
  /** 标签 + 提示 + 控件的组合行（插件做设置项的标准写法） */
  | { type: 'field'; label: string; hint?: string; children: UINode }
  /** 分组切换：`bind` 存当前选中 tab 的 key（插件自己读 state 决定渲染哪个） */
  | { type: 'tabs'; bind: string; tabs: { key: string; label: string; node: UINode }[] }

export type ViewCtx = {
  pluginId: string
  state: Record<string, unknown>
}

/**
 * 面板挂载位置。**新增位置只改这里** —— 契约、内核与宿主渲染端都引用它；
 * 之前这套字面量在 4 处各写一遍，加一个位置得满仓库找。
 */
export type PanelLocation =
  | 'sidebar'
  | 'main'
  | 'statusbar'
  | 'modal'
  /**
   * 编辑器底部的辅助工具栏（手机端输入辅助、格式化按钮、快捷标签…）。
   * **只在有面板注册到它时才渲染** —— 没有插件用它时，界面与现在完全一样。
   */
  | 'editor-toolbar'

/** 6. view —— 视图挂载 */
export interface ViewApi {
  registerPanel(spec: {
    id: string
    title: string
    icon?: string
    location: PanelLocation
    render: (ctx: ViewCtx) => UINode
  }): Disposable
  registerWebView(spec: {
    id: string
    title: string
    location: 'sidebar' | 'main' | 'modal'
    url: string
  }): Disposable
  /** 面板数据变了，请宿主重渲染 —— `render` 是纯函数，插件靠这个把新数据推上去 */
  refresh(panelId?: string): void
  /** 写面板状态（输入框等 bind 值）→ 宿主重渲染。插件清空/预填输入框的标准做法 */
  setState(bind: string, value: unknown): void
}

/** 7. store —— 插件自己的持久化（落 .zn/plugins/<id>/store.json） */
export interface StoreApi {
  get<T>(key: string, def?: T): Promise<T>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  all(): Promise<Record<string, unknown>>
}

/** 8. host —— 宿主信息与生命周期 */
export interface HostApi {
  apiVersion: string
  appVersion: string
  platform: 'windows' | 'android' | 'other'
  log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void
  notify(msg: string, level?: 'info' | 'warn' | 'error'): void
  /**
   * 把**库内相对路径**转成 WebView 能直接用的 URL（Tauri asset 协议）。
   *
   * `ui.image` 想显示库里的图片（`attachments/a.png`）时**必须先过这道** ——
   * 相对路径直接塞进 `<img src>` 会被浏览器当成"相对当前页面"去解析，必然 404。
   * `http(s):` / `data:` / `blob:` 这类现成 URL 不用转，直接传给 `image.src` 即可。
   */
  assetUrl(relPath: string): string
  /**
   * 弹系统「另存为」对话框，把内容写到用户选的位置（**导出用**）。
   *
   * 返回实际保存的**绝对路径**；用户取消 ⇒ 返回 `null`（不是抛错，插件不用 try/catch）。
   * 注意这是**写到库外**的通道 —— 库内写入请走 `fs.writeText`，那条路才有原子写与范围校验。
   * v0.1 只收字符串；PDF / 图片 / zip 这类二进制导出需要插件先转成 `data:` URL 或
   * 用 `html` 节点让用户右键另存（二进制直写排在下一版）。
   */
  saveFile(params: { defaultName?: string; content: string }): Promise<string | null>
}

export const API_VERSION = '0.1.0'

export interface PluginContext {
  fs: FsApi
  doc: DocApi
  index: IndexApi
  event: EventApi
  command: CommandApi
  view: ViewApi
  store: StoreApi
  host: HostApi
  pluginId: string
  /** 所有资源必须登记，卸载即净 */
  subscriptions: Disposable[]
}

/** capability 白名单（契约 §4）—— 插件只能声明这些；`net` / `proc` 默认拒 */
export type Capability =
  | 'fs:read'
  | 'fs:write'
  | 'doc:read'
  | 'doc:write'
  | 'index:query'
  | 'index:write'
  | 'command'
  | 'view:sidebar'
  | 'view:main'
  | 'view:statusbar'
  | 'view:modal'
  | 'store'
  | 'net'
  | 'proc'

/** 插件清单：`.zn/plugins/<id>/manifest.json` */
export type PluginManifest = {
  /** manifest 结构版本（防将来改字段分不清新旧） */
  manifestVersion: 1
  id: string
  name: string
  version: string
  /** 契约版本范围，如 `^0.1.0` */
  apiVersion: string
  /**
   * 入口脚本，插件目录内相对路径（POSIX）。
   * **可选** —— 纯样式（主题类）插件可以只声明 `styles` 而不写 JS。
   * 入口形态由宿主按内容嗅探：ESM / CommonJS / 全局注册（IIFE）三种都能吃。
   */
  entry?: string
  /**
   * 除入口外还需要被 `require()` 的文件（POSIX 相对路径）。
   * 声明后宿主会把它们与入口一起读出来，装进一个极简的虚拟 CommonJS 运行时
   * ⇒ 单文件限制解除，插件可以正常拆 `lib/util.js` 这类模块。
   * 注意：只有 CommonJS 风格的 `require('./x.js')` 能被解析；ESM 的相对导入
   * 需要打包器，v0.1 不支持（见 docs/内核契约-v0.1.md §3）。
   */
  files?: string[]
  /** 要注入的样式表（POSIX 相对路径）。主题类插件只写 CSS 即可，不必有 entry */
  styles?: string[]
  description?: string
  /** 支持的平台；缺省 = 全平台。M3 的 Android 必需项（桌面子进程语义在真机会失败） */
  platforms?: ('desktop' | 'android' | 'web')[]
  capabilities: Capability[]
  contributes?: {
    commands?: { id: string; title: string; keybinding?: string }[]
    panels?: {
      id: string
      title: string
      location: PanelLocation
    }[]
  }
}

export interface Plugin {
  apply(ctx: PluginContext): void | Promise<void>
  dispose?(): void | Promise<void>
}
