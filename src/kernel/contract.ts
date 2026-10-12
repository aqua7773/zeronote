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
  on(ev: 'open' | 'change' | 'save' | 'close', cb: (d: NoteDoc) => void): Disposable
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
  /** 所有资源必须登记，卸载即净 */
  subscriptions: Disposable[]
}

/**
 * capability 白名单（契约 §4）—— 插件只能声明这些。
 *
 * `net` / `proc` 标的是「**默认拒**」：不是永远拒，而是**没被用户逐个授权就拒**。
 * 授权记录在 `<私有根>/.zn/permissions.json`（`src/kernel/permissions.ts`）。
 * ⚠️ 这是一条**可绕过的边界**（插件与宿主同上下文），兑现的是知情与承诺，不是隔离。
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
