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

/** 回收站条目（`fs.listTrash`） */
export type TrashEntry = {
  /** 稳定标识：新格式 = 时间戳目录名；旧格式 = `<时间戳>--<名>` 整个文件名 */
  id: string
  /** 展示名 */
  name: string
  /**
   * 原库内相对路径。**旧格式（扁平的 `<时间戳>--<名>`）为 `null`** ——
   * 那时只存了文件名没存位置，恢复只能落库根。
   */
  originalPath: string | null
  /** 删除时间（毫秒时间戳） */
  deletedAt: number
  isDir: boolean
  size: number
}

/** 1. fs —— 文件读写。所有写入必须原子（临时文件 + rename）。 */
export interface FsApi {
  vaultPath(): string
  listNotes(dir?: string): Promise<NoteMeta[]>
  /**
   * 库内**目录清单**（库内相对路径、`/` 分隔、已排序）。
   * `listNotes` 只上报 `.md` 文件，前端若只靠它反推目录树，**空文件夹不会出现**
   * ⇒ 文件树要显示空目录（"新建文件夹"看得见）必须用这条。
   */
  listDirs(): Promise<string[]>
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
  /**
   * 复制文件或**整个目录树**（语义与 `move` 对齐：`to` 是已存在目录 ⇒ 复制进去；
   * 目标已存在 ⇒ 报错不覆盖）。复制时跳过 `.zn` 等私有/忽略目录。
   */
  copy(from: string, to: string): Promise<void>
  /** 移入 .zn/trash/（不是物理删除）；返回回收站里的库内相对路径，供撤销 rename 回来 */
  delete(path: string): Promise<string>
  exists(path: string): Promise<boolean>
  /** 回收站列表（**新旧两种格式都认**，最近删的在最前） */
  listTrash(): Promise<TrashEntry[]>
  /** 从回收站恢复一项，返回恢复到的**库内相对路径**；原位置已有同名项 ⇒ 拒绝，不覆盖 */
  restoreTrash(id: string): Promise<string>
  /** **真删除**一项（不可撤销 —— UI 必须二次确认） */
  purgeTrash(id: string): Promise<void>
  /** 清空回收站，返回清掉的条目数 */
  emptyTrash(): Promise<number>
  watch(cb: (e: FsChange) => void): Disposable
}

export type NoteDoc = {
  path: string
  content: string
  frontmatter: Record<string, unknown>
  dirty: boolean
}

/** `doc.on` 能订阅的四种文档生命周期事件（U3b 起是真事件，此前是空桩）。 */
export type DocEvent = 'open' | 'change' | 'save' | 'close'

/** 2. doc —— 当前文档 / 选区。编辑类入口：replaceSelection / insertAtCursor / insertAt / replaceRange。 */
export interface DocApi {
  active(): NoteDoc | null
  open(path: string): Promise<void>
  close(path?: string): void
  save(path?: string): Promise<void>
  selection(): { from: number; to: number; text: string } | null
  replaceSelection(text: string): void
  insertAtCursor(text: string): void
  /**
   * 在**指定字符偏移**处插入文本。
   *
   * `cursorOffset` = 插入完成后光标距**插入内容开头**的字符数（缺省 = 内容末尾，越界会被夹进范围）。
   *
   * 为什么需要它（`insertAtCursor` 不够用）：
   *  - **行首标记**（`# ` 标题 / `- ` 列表 / `> ` 引用）必须落在**行首** ——
   *    光标停在行中或行尾时，`insertAtCursor` 会把标记插进句子中间。
   *    有了按偏移插入，插件可以用 `active().content` + `selection().from` 自己算出目标位置。
   *  - **成对标记**（`**粗体**`）希望光标落在两个标记**中间**，用户接着打字就是粗体；
   *    传 `cursorOffset` 即可（否则每次点按钮都得手动把光标挪回去）。
   *
   * 偏移越界不抛错：夹到 `[0, content.length]`，把编辑动作做成幂等的"尽力而为"。
   */
  insertAt(pos: number, text: string, cursorOffset?: number): void
  /**
   * 按**区间**替换正文；`text === ''` 即删除该区间。
   *
   * 为什么需要它（`insertAt` / `replaceSelection` 都不够用）：
   *  - `insertAt` **只能插**，删不掉已有内容；
   *  - `replaceSelection` 只作用于用户当前选区，插件没法指定"就是第 40–52 个字符"。
   * 结构化编辑（导图 ⇄ 大纲双向同步、表格单元格改写、任务勾选回写）需要的是
   * "**改掉任意一段已知区间**" —— 插件从 `active().content` 里解析出节点位置后，
   * 直接把那一段换掉即可，不必依赖用户光标在哪。
   *
   * 偏移一律夹进 `[0, doc.length]`，`from`/`to` 顺序颠倒会自动交换（与 `insertAt` 同一套宽容策略）。
   * `cursorOffset` = 替换后光标距**新内容开头**的字符数（缺省 = 新内容末尾）。
   */
  replaceRange(from: number, to: number, text: string, cursorOffset?: number): void
  /**
   * 订阅文档生命周期事件。返回 `Disposable` —— 插件按项目约定把它 `push` 进
   * `ctx.subscriptions` 后，卸载时由宿主统一 dispose（`plugin-host.ts` 的"卸载即净"）；不登记就得自己管。
   *
   * - `open` / `save` / `close` 每次动作各触发一次；
   * - `change` **已去抖 200ms**（每次击键都回调会打爆插件），payload 里是**最新**内容；
   * - 回调抛错不会影响其它订阅者，也不会中断编辑器（内核逐个 try/catch 并 `console.error`）。
   */
  on(ev: DocEvent, cb: (d: NoteDoc) => void): Disposable
}

export type SearchHit = { path: string; title: string; excerpt: string; score: number }

/** 3. index —— 可删可重建的索引（v0.2 实现） */
export interface IndexApi {
  /**
   * 多关键词 **AND** 检索。`opts.tag` 是**字段过滤**：只返回带该标签的笔记
   * （标签来自 frontmatter 的 `tags`/`标签`，以及正文里的 `#标签`）。
   */
  query(q: string, opts?: { limit?: number; dir?: string; tag?: string }): Promise<SearchHit[]>
  upsert(path: string, text: string): Promise<void>
  remove(path: string): Promise<void>
  rebuild(): Promise<{ count: number; ms: number }>
  /**
   * 当前索引里的**标签统计**（按笔记数降序）—— 规格 §2.3 的「标签聚合查看」用它。
   * `count` 是**带该标签的笔记篇数**（同一篇里出现多次只算一次）。
   * 只统计**已经 upsert/rebuild 进本分区**的笔记（分区隔离照旧生效）。
   */
  tags(): Promise<{ tag: string; count: number }[]>
  /**
   * 取一个**独立分区**的索引视图（契约 §2.6 的"按密级分索引"靠它）。
   *
   * 分区之间**互不可见**：各自的文档表、各自的 rebuild。名字是**绝对的**，
   * 不做层级嵌套（`scoped('a').scoped('b')` 得到的是 `b` 而不是 `a/b`）；
   * 同名分区共享同一份索引，所以前置插件与消费者可以约好往同一个分区写。
   *
   * ⚠️ 分区**只隔离可见性，不改变数据源**：`rebuild()` 照样扫全库，
   * 只是写进自己那份。**要按密级/标签筛，由插件决定 upsert 什么** ——
   * "哪些笔记算机密"是业务策略，内核不替它判断。
   */
  scoped(partition: string): IndexApi
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
  /** 元数据 + 实现一起登记（老写法，仍然支持） */
  register(cmd: CommandSpec): Disposable
  /**
   * **只绑定实现** —— 懒激活插件的写法。
   *
   * 元数据已经由宿主从 `manifest.contributes.commands` 静态登记过了
   * （所以命令面板不用加载插件就能列出它），这里只补上"点了之后干什么"。
   * 没静态声明而直接 bind 也能用（元数据退化为 id）。
   */
  bind(id: string, run: (...args: unknown[]) => unknown): Disposable
  execute(id: string, ...args: unknown[]): Promise<unknown>
  list(): { id: string; title: string }[]
}

/**
 * 懒激活触发条件（`manifest.activationEvents`）。
 *
 * · `onStartup` / `onVaultOpen` —— 库打开就激活（等价于不写，写出来是**显式表态**）
 * · `onCommand:<命令 id>` —— **那条命令被执行时**才激活。命令面板不用加载插件
 *   就能列出它（元数据来自 `contributes.commands`），点下去才跑代码。
 * · `onView:<面板 id>` —— 面板被打开时激活（类型先留，宿主 v0.1 暂按启动处理）
 */
export type ActivationEvent =
  | 'onStartup'
  | 'onVaultOpen'
  | `onCommand:${string}`
  | `onView:${string}`

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
  /**
   * 编辑器**顶部**的提示条（2026-10-12 加）—— 与 `editor-toolbar` 对称：
   * 放"看着有用、不点也行"的东西，比如 Markdown 标记的**快捷键提示**。
   * 同样**只在该位置有面板注册时才渲染**；面板 dispose 掉它就整条消失
   * （插件据此实现"可开关"，不需要内核再提供可见性开关）。
   */
  | 'editor-topbar'

/** 6. view —— 视图挂载 */
export interface ViewApi {
  registerPanel(spec: {
    id: string
    title: string
    icon?: string
    location: PanelLocation
    render: (ctx: ViewCtx) => UINode
  }): Disposable
  /**
   * 挂一个**插件自己的页面**（WebView 逃生口）—— 画布、视频、地图这类
   * 「声明式 UINode 表达不了」的东西走这里（契约 §2.2 / §7.9）。
   *
   * 宿主用 `<iframe sandbox="allow-scripts">` 承载，**刻意不给 `allow-same-origin`**：
   * 页面里的脚本照跑，但它与宿主互为 opaque origin —— 碰不到宿主的 DOM / localStorage / IPC。
   *
   * ⚠️ 主题令牌**没法"灌"进去**（CSS 自定义属性不跨文档边界），宿主改用 `postMessage` 送达，
   * 页面自己应用：
   * ```js
   * window.addEventListener('message', (e) => {
   *   const d = e.data
   *   if (!d || d.type !== 'zn:theme') return
   *   for (const [name, value] of Object.entries(d.tokens)) {
   *     document.documentElement.style.setProperty(name, value)
   *   }
   *   document.body.dataset.theme = d.mode   // 'light' | 'dark'
   * })
   * ```
   * `d.tokens` 是宿主当前生效的**全部 `--zn-*` 设计令牌**；**主题一变化就自动重发**，
   * 所以画布能跟着深浅色与主题切换走。
   *
   * `url` **必须**是独立 origin 的 `http(s):` 页面。
   * 本地 scheme（`data:` / `blob:` / `srcdoc`）会**继承宿主 CSP**，而 Tauri 编译时注入的 `sha256`
   * 会让 `'unsafe-inline'` 失效 ⇒ 页面里的内联脚本一律被拦（真机 logcat 实测，见契约 §2.2 ④）；
   * Tauri 的 asset 协议在 Android 上也不服务 `.html`（`net::ERR_INVALID_RESPONSE`）。
   */
  registerWebView(spec: {
    id: string
    title: string
    location: 'sidebar' | 'main' | 'modal'
    url: string
  }): Disposable
  /**
   * 把一个面板放进**独立窗口**（U1 · 2026-10-13 rev50）。
   *
   * 用途：导图 / 预览 / 画布这类"想摊开来看、想跟编辑器并排"的东西 —— 以前只能挤在
   * 主区里顶掉编辑器（§2.2 的 `location: 'main'`），现在可以开自己的窗口（可拖 / 可缩放 / 能多开）。
   *
   * ```js
   * const win = api.view.openWindow({ panel: 'my-map.panel', title: '我的导图', width: 900, height: 640 })
   * api.subscriptions.push(win)   // 卸载插件 ⇒ 窗口自动关掉
   * ```
   *
   * **语义与边界**
   * · `panel` 必须是**已经 `registerPanel` 过的面板 id**（窗口里渲染的就是它的 `render`）。
   * · **窗口是新的 webview**：它有自己的 JS 上下文，会**重新加载一遍插件**再渲染该面板
   *   （不是把主窗口的 DOM 搬过去）。所以插件在新窗口里 `apply()` 会再跑一次 —— 那是独立的
   *   一份命令表 / 面板表，互不影响。想在新窗口里区分"我是窗口模式"，读 `host.platform` 之外
   *   请用面板 `render(ctx)` 收到的数据自己判断（内核不额外注入标记）。
   * · 窗口 label 由内核生成、**一律以 `plugin-` 开头**；`capabilities/default.json` 的
   *   `windows` 用 glob `plugin-*` 覆盖它们。**权限与主窗口完全一致**（2026-10-13 用户裁决：
   *   完全放行、不按窗口分级 —— 内核不设防，权限由插件自己控制）。
   * · 返回的 `Disposable` = **关掉这个窗口**并撤账；`dispose()` 幂等，宿主在插件卸载时统一调
   *   （与其它资源一样由宿主自动登记，插件不接返回值也不会漏关）。
   * · **平台**：桌面可用；Android 上 Tauri 多窗口支持尚不完整（未实测），失败时抛错。
   */
  openWindow(spec: {
    panel: string
    title?: string
    width?: number
    height?: number
  }): Disposable
  /** 面板数据变了，请宿主重渲染 —— `render` 是纯函数，插件靠这个把新数据推上去 */
  refresh(panelId?: string): void
  /** 写面板状态（输入框等 bind 值）→ 宿主重渲染。插件清空/预填输入框的标准做法 */
  setState(bind: string, value: unknown): void
  /**
   * **接管整窗渲染**（U2 · 2026-10-13 rev51）—— 插件把内核 UI 整个请下场，自己画。
   *
   * ```js
   * const d = api.view.overrideShell({
   *   mount(el, ctx) {
   *     el.innerHTML = '<div style="padding:24px">我的界面</div>'
   *     return { dispose: () => { el.innerHTML = '' } }   // 可选：释放时的清理
   *   },
   * })
   * api.subscriptions.push(d)      // 卸载插件 ⇒ dispose ⇒ 内核 UI 自动复原
   * ```
   *
   * **语义**
   * · `mount(el, ctx)` 在宿主给出的容器元素上执行**一次**（插件直接用 DOM 画 —— 这正是
   *   "声明式 UINode 表达不了"的那类界面：画布、多窗格、自定义布局）。
   *   返回 `Disposable` 可选；`dispose()` 时会先调它、再清空容器。
   * · **同一时刻只允许一个接管者**：第二个插件来接管会**抛明确错误**（而不是静默顶掉前一个 ——
   *   那样两边都不知道发生了什么）。要换人：前一个 `dispose()` 或卸载它。
   * · `dispose()`（或卸载插件）⇒ 内核 UI 立刻复原（原则 3：关掉插件内核还能用）。
   * · **窗口模式**下接管的是"那个窗口的内容区"，标题条与关闭按钮**保留**（否则窗口没法关）。
   * · 风格统一靠插件自觉：内核提供 `--zn-*` 设计令牌与 `.zn-ui-*` 类
   *   （用户 2026-10-13 已裁决：不防"插件把界面改成任意样子"，同一套风格即可）。
   *
   * ⚠️ 两条边界（**已实测**，见 `docs/内核契约-v0.1.md` §2.8）：
   * ① 接管期间内核不提供"退出接管"的按钮 —— 退出路径是插件自己给的 UI，或卸载插件；
   * ② 主窗口 `decorations: false`，所以**拖动区由内核保留**（`data-tauri-drag-region` 热区），
   *   否则接管后窗口没法拖动。
   */
  overrideShell(spec: ShellSpec): Disposable
}

/** `overrideShell` 的挂载上下文 —— 静态信息，**只在 mount 时给一次** */
export type ShellMountCtx = {
  pluginId: string
  /** 当前库（绝对路径）—— 接管界面里想读笔记时用它，不用再问内核 */
  vault: string
  platform: 'windows' | 'android' | 'other'
}

/** `overrideShell` 的参数（契约 §2.8） */
export type ShellSpec = {
  /** 在宿主给的容器上画界面。返回 Disposable 可选（释放时先调它，再清空容器） */
  mount: (el: HTMLElement, ctx: ShellMountCtx) => void | Disposable
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
   *
   * `content` 收字符串或 `Uint8Array`：后者给**二进制导出**（图片、zip、PDF）用 ——
   * 文本走原样写入，二进制经 base64 过桥（Tauri 的 `Vec<u8>` 参数会被序列化成
   * JSON 数字数组，1 MB 就上百万个元素，所以不走那条路）。
   *
   * ⚠️ **平台差异（真机实测）**：**桌面可用**；**Android 受限** —— 那边的「另存为」
   * 走 SAF，返回 `content://…` **内容 URI**而不是文件路径，当前实现只认真实路径，
   * 会给出明确报错（不会静默写出 0 字节文件）。Android 上导出请改为写进库内再分享。
   */
  saveFile(params: {
    defaultName?: string
    content: string | Uint8Array
  }): Promise<string | null>

  /**
   * **还原登记点**（接管协议 · 2026-10-13 rev49）。
   *
   * 给"插件自绘 / 自改宿主 DOM、登记全局变量、挂 document 级监听"这类**内核记不了账**
   * 的改动一个可声明的还原入口：
   *
   * ```js
   * const bar = document.querySelector('.zn-statusbar')
   * const old = bar.style.backgroundImage
   * api.host.onRollback(() => { bar.style.backgroundImage = old })   // 登记 ⇒ 卸载时内核替你调
   * bar.style.backgroundImage = 'repeating-linear-gradient(45deg, #ef4444 0 12px, #7f1d1d 12px 24px)'
   * ```
   *
   * 规矩（契约 §4.4）：
   * - **登记过 ⇒ 内核负责还原**（卸载时按登记逆序逐个调用；单个回调抛错只记日志，不连累别的插件）
   * - **没登记 ⇒ 自己负责**（在 `dispose()` 里写回去）—— 内核不拦、也管不了
   * - 手动 `dispose()` 该返回值 = **立刻**执行还原并从账上摘掉（与"取消接管"同义，不会重复调用）
   *
   * ⚠️ 它不是沙箱、不是权限门（原则 4：内核不提供任何安全保证）——
   * 它只是把"卸载即净"从"内核记账的资源"扩展到"插件愿意申报的资源"。
   */
  onRollback(fn: () => void): Disposable
}

/**
 * 10. editor —— **编辑器的声明式标记规则**（`[[引用]]` / `#标签` / `==高亮==` 这类）。
 *
 * 为什么不直接暴露 CodeMirror 的 `Extension`：那是**宿主依赖里的类实例**，
 * 插件塞不进来（插件代码是字符串 / 将来要进 Worker），而且一旦暴露，
 * 插件就能把宿主编辑器改造成任何样子 —— 主路又会被绕过。
 *
 * 所以这里只收**可序列化的规则**：正则源是字符串、样式是语义档位、点击是命令 id。
 * 宿主负责把它翻译成 CM6 装饰器。插件**完全不接触编辑器实例**。
 */
export type EditorMarkRule = {
  /** 插件内唯一即可；宿主会加上插件前缀防冲突 */
  id: string
  /** 正则源（字符串）。宿主自动补 `g` 标志扫全文 */
  pattern: string
  flags?: string
  /** 语义档位 —— 具体颜色/下划线由宿主映射到 `--zn-*` token */
  className?: 'link' | 'tag' | 'code' | 'highlight' | 'muted'
  /** 点击时执行的命令 id；payload 带 `{ text, from }`（`from` 是文档内偏移） */
  onClick?: string
  /** 悬停提示 */
  title?: string
}

/**
 * 编辑器侧的能力。
 *
 * 生效时机：规则在**编辑器挂载 / 切换笔记**时被读取（atomic 那时才捕获扩展数组），
 * 所以插件应在 `apply()` 里注册 —— 之后再加规则要等下次打开笔记才可见。
 */
export interface EditorApi {
  /**
   * 登记一条标记规则（返回 Disposable，卸载即撤销）。
   *
   * 重叠的匹配**先到先得**（前一条规则吃掉的区间，后面的规则不再着色）——
   * 这样多条规则叠在一起时行为可预期，也不会把 CM6 的 RangeSet 搞崩。
   */
  addMark(rule: EditorMarkRule): Disposable
  /** 当前生效的规则（诊断用） */
  list(): { id: string; pluginId: string }[]
}

export const API_VERSION = '0.1.0'

/**
 * 9. service —— 插件之间的**带返回值**互调，也是「前置插件」的载体。
 *
 * 为什么不能只靠 `event`：事件总线是 fire-and-forget，没有返回值也没有"对方在不在"。
 * 「AI 插件调用 Git 插件的提交能力」这类需求，用事件只能靠全局变量 hack。
 *
 * **内核在这里是彻底干净的**：它只维护一张 `名字 → 懒工厂` 的表，
 * 完全不认识 katex / mermaid / pdf 这些具体依赖 —— 依赖环境由**插件**提供，
 * 于是"换一个公式渲染器"只是换一个插件，不用动内核。
 *
 * 依赖关系刻意做成**软依赖**（VS Code `extensionDependencies` / SilverBullet `redirect`
 * 的同类做法）：`consume` 拿不到就返回 `null`，**不抛错、不阻塞加载、不做拓扑排序**。
 * 插件自己决定降级成什么样（显示"请先安装 XX 前置插件"是最常见的做法）。
 */
export interface ServiceApi {
  /**
   * 提供一项服务（**「前置插件」就是靠它**）。名字建议带命名空间：`katex` / `git.commit`。
   *
   * `factory` **是懒的** —— 只有第一次有人 `consume` 时才执行，结果缓存起来复用。
   * 这一点是"按需激活"的关键：前置插件自己可以极轻（只登记一个闭包），
   * 真正重的东西（拉 CDN 上的 katex / pdf.js）推迟到被需要那一刻。
   * **没人用 ⇒ 一次网络请求、一次 import 都不会发生。**
   *
   * factory 抛错 ⇒ `consume` 返回 `null`（**不把异常抛给消费者** ——
   * 一个前置插件坏了不该拖垮依赖它的插件），错误会写进插件日志。
   */
  provide<T>(name: string, factory: () => T | Promise<T>, opts?: { version?: string }): Disposable
  /** 取服务（异步：要等 factory 跑完）。**没有就返回 `null`**。 */
  consume<T = unknown>(name: string): Promise<T | null>
  /** 当前已登记的服务（含提供者、是否已实例化）—— 给诊断面板/调试用 */
  list(): { name: string; pluginId: string; version?: string; loaded: boolean }[]
}

export interface PluginContext {
  fs: FsApi
  doc: DocApi
  index: IndexApi
  event: EventApi
  command: CommandApi
  view: ViewApi
  store: StoreApi
  host: HostApi
  service: ServiceApi
  editor: EditorApi
  pluginId: string
  /**
   * 插件自己的资源账。**大部分情况下你不需要主动 push**：
   * - `command.register/bind` · `view.registerPanel/registerWebView` · `event.on` ·
   *   `fs.watch` · `doc.on` ⇒ 宿主**自动登记**（返回值收进这里）
   * - `service.provide` · `editor.addMark` ⇒ 宿主卸载时**强制回收**
   * - 自改宿主 DOM / 全局变量 ⇒ 用 `host.onRollback(fn)` 登记
   *
   * 剩下的（自己 `setInterval`、`window.addEventListener`、造了别的对象）才需要
   * 手动 `subscriptions.push(...)` —— 卸载时逐个 `dispose()`（契约 §4.4 接管协议）。
   */
  subscriptions: Disposable[]
}

/**
 * capability 清单（契约 §4）—— 插件可以声明这些。
 *
 * ⚠️ **2026-10-13 起它是「自述」，不是「门」**（用户原则 4：权限完全由插件控制，
 * 内核不提供任何安全保证）。内核**不再**据此拒载、**不再**据此刻画原语（裁剪已删）：
 * 声明就只是一个声明 —— 插件页/设置页拿它告诉用户"这个插件自称要什么"；
 * 未知取值只**警告**、不拦（`warnUnknownCapabilities`）。
 *
 * 为什么不再当门用：实测证明它守不住任何东西（插件与宿主同上下文，可直连 IPC、
 * 裸 `fetch`、读写库外路径）—— 见 `docs/架构原则-2026-10-13.md` §2 与
 * `plugin-host.ts` 里那段墓碑注释。
 */
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
  /** 编辑器底部工具栏的挂载点（手机端辅助输入那条） */
  | 'view:editor-toolbar'
  /** 编辑器顶部提示条的挂载点（与底部工具栏对称） */
  | 'view:editor-topbar'
  /** 编辑器行内标记规则（`editor.addMark`） */
  | 'editor:mark'
  | 'store'
  | 'net'
  | 'proc'

/**
 * 插件声明的运行平台。
 *
 * **只有两档**：`desktop`（Windows / macOS / Linux 桌面）与 `android`。
 * 「双端」不是一个取值，而是**两个都写**：`["desktop", "android"]`。
 * 不写整个字段 = 全平台（向后兼容：老插件一个都不用改）。
 *
 * 宿主拿它跟**当前平台**比对（`host.platform` 的 `windows | other` 都算 `desktop`）；
 * 不匹配的插件**不加载**，并在插件管理页标成「不适用」—— 这不是错误，
 * 所以**不弹错误横幅**（把桌面专属插件拷到手机上是很正常的操作）。
 */
export type PluginPlatform = 'desktop' | 'android'

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
  /**
   * 支持的平台：`["desktop"]` / `["android"]` / `["desktop","android"]`（双端）。
   * **缺省 = 全平台**。只在声明里写了、却与当前平台不符的插件上生效 —— 见 `PluginPlatform`。
   */
  platforms?: PluginPlatform[]
  capabilities: Capability[]
  /**
   * 依赖的**前置插件**（只声明，**不做拓扑排序、不做版本求解**）。
   *
   * 作用有两个：① 插件管理页可以提示"缺前置：xxx"；② 加载顺序不保证时，
   * 消费方靠 `service.consume` 拿 `null` + 等 `service:available` 事件来补挂。
   * 缺了前置**不拦加载** —— 硬依赖会让"一个插件装错版本就整个起不来"。
   */
  dependencies?: string[]
  /**
   * **懒激活触发条件**。
   *
   * 不写这个字段 ⇒ 老行为：库一打开就 `apply()`（现有插件一个都不用改）。
   * 写了 ⇒ 宿主**只静态登记** `contributes` 里的元数据（命令/面板能被列出来），
   * 直到某个条件命中才真正加载插件代码。
   *
   * 这是"装上 N 个插件 ≠ 启动 N 次 `apply()`"的解法 —— 移动端冷启动尤其明显。
   */
  activationEvents?: ActivationEvent[]
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
