/**
 * ZeroNote 内核契约 v0.1 —— 类型定义
 * 对应 `docs\内核契约-v0.1.md` §1 / §2
 *
 * 铁律：内核与插件之间**只**通过这些接口通信；内核不认识任何具体功能
 * （标签 / 同步 / AI / 画布 / 灵感流 都不在本文件里）。
 */

export type Disposable = { dispose(): void }

import type { PluginCategory } from '../lib/plugin-category'

/* ───────────────── 数据面 ───────────────── */

export type NoteMeta = {
  /** 库内相对路径，统一 POSIX 分隔符（`notes/a.md`） */
  path: string
  /**
   * **独立笔记 ID**（2026-10-18 rev118）：改名/移动不变，存在 `<库>/.zn/ids.json`。
   * 索引与链接优先按它定位；外部程序移动文件后可能换新 ID（内核在 `list_notes` 补发）。
   */
  id: string
  title: string
  /** 毫秒时间戳 */
  mtime: number
  size: number
  frontmatter: Record<string, unknown>
  /**
   * `note` = Markdown 笔记（内核可编辑，走编辑器）；
   * `doc`  = 只读文档（pdf / epub / mobi / cbz / txt …）；
   * `image` = 图片附件（png / jpg / gif / webp / svg …，rev173.3 起进文件树）；
   * `media` = 音视频附件（mp4 / mp3 / mkv …，rev173.226 起进文件树）。
   *
   * 2026-10-13 加 doc：内核此前只列 `.md`，库里放了 PDF 也看不见。
   * 2026-10-18 加 image：「插入图片」把图复制进笔记目录后，文件树里什么都看不到 ⇒
   * 用户「附件的入口也没做」。现在四类都进文件树，但：
   * **只有 `note` 进索引、只有 `note` 走 `openNote`**；`doc` 交给插件
   * （`core.openDocument` 派发）；`image` 由内核自己弹图片预览；
   * `media` 只是「在正文里用 `![](clip.mp4)` 内联播放」，单独点开给提示
   * （播放要放在笔记上下文中，不是独立窗口）。
   */
  kind: 'note' | 'doc' | 'image' | 'media'
}

export type FsChange = {
  kind: 'create' | 'modify' | 'delete' | 'rename'
  path: string
}

/* ───────────────── 插件调试（rev173.229） ───────────────── */

/** 插件日志级别（`host.log` 的入参；`debug` 只在开发者模式下显示） */
export type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * 一条**结构化**插件日志（rev173.229 · 需求 §2.13「插件日志 / 错误堆栈」）。
 *
 * 此前是一整串 `string`（面板里 `<pre>` 全量打出来）：
 * 分不清哪条来自哪个插件、error 也没有堆栈。现在每条带归属与级别；
 * `stack` 只对 error 记（info / warn 记了也没人看，还占内存）。
 */
export type PluginLogEntry = {
  /** 毫秒时间戳 */
  ts: number
  /** 来源插件 id；`null` = 内核自身（fs 事件、市场、启动等） */
  pluginId: string | null
  level: PluginLogLevel
  msg: string
  /** 仅 error：捕获时的调用栈（含插件的帧，定位到文件与行号） */
  stack?: string
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

/**
 * `fs.writeText` 的来源标记（rev173.120）。
 *
 * · `'user'`（不传即此）—— 用户保存 ⇒ 发 `note:saved`
 * · `'plugin'` —— 插件程序写 ⇒ 只更新索引，发 `note:changed`（`origin: 'plugin'`）
 */
export type FsWriteOrigin = 'user' | 'plugin'

/** `fs.writeText` 的可选项 */
export interface FsWriteOptions {
  /** 谁在写。见 {@link FsWriteOrigin} */
  origin?: FsWriteOrigin
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
  /**
   * 某个子目录下的**文件清单**（库内相对路径、`/` 分隔、已排序、**不递归**）。
   *
   * 与 `listNotes` / `listDirs` 的关键差别：**不跳过 `.zn`** —— 调用方显式给了目录，
   * 就是要看它（历史版本快照在 `<库>/.zn/history/`）。目录不存在 ⇒ 空表，不报错。
   */
  listFiles(dir?: string): Promise<string[]>
  readText(path: string): Promise<string>
  /**
   * 写一篇笔记。
   *
   * `opts.origin`（rev173.120）区分**谁在写**：
   * · `'user'`（默认）—— 用户保存（编辑器 / 全局替换）。写盘后发 `note:saved`。
   * · `'plugin'` —— **插件程序写的**（合并结果、导入、批量整理…）。内核仍会更新搜索索引，
   *   但**不发 `note:saved`**，改发 `note:changed`（带 `origin: 'plugin'`）。
   *
   * 为什么要分：`note:saved` 的语义是「用户改了这篇」——同步插件据此记 pending
   * （本机改过、还没同步出去）。插件自己写盘如果也发 `note:saved`，就会被当成用户编辑，
   * 留下永远清不掉的 pending，之后任何外部改动都被误判成冲突（rev173.116 用 `selfWrites`
   * 抑制表绕过的正是这个，那是补丁不是根治）。
   *
   * 插件侧不用记得传：`ctx.fs.writeText` 由宿主强制标 `origin: 'plugin'`。
   */
  writeText(path: string, content: string, opts?: FsWriteOptions): Promise<void>
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
  /**
   * **真删除**（不进回收站），且**只允许 `.zn/` 下的路径**。
   *
   * 为什么不让它删用户笔记：历史版本的「四档精简」要淘汰旧快照，`delete` 会把它们
   * 全塞进回收站（垃圾场）。真删除必须有边界 —— 越界路径在 Rust 侧直接拒绝。
   * 幂等：目标不存在也算成功。
   */
  purgePrivate(path: string): Promise<void>
  /**
   * 删掉一份**旧备份目录**（整棵树）—— 只认 `<库>/.zn/backups/` 下的**一级名字**。
   *
   * 为什么不让备份插件顺手用 `purgePrivate`（rev173.175）：那条只删文件与**空**目录，
   * 备份是几十个文件的树，逐文件删要几十次 IPC。也不该用 `delete` —— 30 份轮换会把
   * 回收站塞满。名字里带分隔符 / `..` / 以 `.` 开头一律拒绝，越界在 Rust 侧硬拒。
   * 幂等：目标不存在也算成功。
   */
  purgeBackup(name: string): Promise<void>
  /**
   * 读**二进制**（图片 / PDF / 附件）—— rev173.106 加。
   *
   * `readText` 只吃 UTF-8，读一张 PNG 只会得到乱码；这条经 base64 过桥，字节原样返回。
   * 同步插件上传附件靠它（文本笔记仍走 `readText` —— 那条才有 frontmatter / 换行语义）。
   */
  readBytes(path: string): Promise<Uint8Array>
  /**
   * 写**二进制**（原子写，与 `writeText` 同一套：临时文件 + rename）。
   *
   * 同步下载附件靠它。传 `Uint8Array`；字符串会按 UTF-8 编码写入，能跑但没必要。
   */
  writeBytes(path: string, data: Uint8Array): Promise<void>
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

/**
 * 文档内容转换器（`doc.registerCodec` · rev173.180）。
 *
 * 内核的编辑器只有一条链路：读盘 → 编辑器明文 → 写盘。加密 / 压缩 / 任意容器格式因此没法用编辑器。
 * 这个钩子把「磁盘字节 ⇄ 编辑器文本」变成可插拔的一步 —— **内核不认识加密**，只认识
 * 「这个路径的内容要过一次转换」。
 *
 * 只在四个真读写磁盘的点发生：`doc.open`（读盘后 decode）· 保存（写盘前 encode）·
 * 外部重载 · 三方合并读盘。合并 / 脏标记 / 自动保存 / 广播全部仍在**明文层面**跑。
 */
export interface DocCodec {
  /** 唯一 id（建议 `<插件id>:<用途>`）。同 id 重复注册 = 后注册的覆盖前一个 */
  id: string
  /** 哪些库内相对路径归我管（纯函数、必须快：每次读写都会问） */
  match(path: string): boolean
  /** 磁盘字节 → 编辑器明文。抛错 = 打开失败（错误给用户看） */
  decode(raw: string, path: string): Promise<string>
  /** 编辑器明文 → 磁盘字节。抛错 = 保存失败（原子写，不留半截） */
  encode(plain: string, path: string): Promise<string>
  /**
   * 内容敏感：**不写会话恢复草稿**（草稿是 localStorage 明文）。
   * 私密笔记 / 密码库类内容必须置 true。
   */
  transient?: boolean
}

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
  /**
   * 注册一个**内容转换器**（rev173.180）—— 读盘后 `decode`、写盘前 `encode`。
   *
   * 用途：密文落盘的笔记（私密文件夹）、压缩 / 容器格式等「编辑器看到明文、磁盘上不是明文」的内容。
   * 内核不提供加密——只提供"这一步由插件来"的钩子；密钥与算法全在插件里。
   *
   * 语义（别退化，`src/kernel/doc-codec.ts` 有完整注释）：
   * - 只在**真读写磁盘**的四个点生效：打开 / 保存 / 外部重载 / 保存前的三方合并读盘；
   * - 文档打开时用过某个 codec ⇒ 保存**必须**还用它；codec 被卸载 ⇒ 保存**失败**（绝不退回明文写盘）；
   * - `transient: true` ⇒ 不写会话恢复草稿（草稿是 localStorage 明文）；
   * - 返回的 `Disposable` 按项目约定 push 进 `ctx.subscriptions`（卸载即净）。
   *
   * ⚠️ `decode` / `encode` 里不要递归调用 `doc.open` / `doc.save`（会自触发）。
   */
  registerCodec(codec: DocCodec): Disposable
}

export type SearchHit = { path: string; title: string; excerpt: string; score: number }

/** 3. index —— 可删可重建的索引（v0.2 实现） */
export interface IndexApi {
  /**
   * 多关键词 **AND** 检索。字段过滤（可与关键词组合）：
   *  · `opts.tag` —— 只返回带该标签的笔记（标签来自 frontmatter 的 `tags`/`标签`，
   *    以及正文里的 `#标签`）；
   *  · `opts.dir` —— 只返回该目录（含子目录）下的笔记；
   *  · `opts.regex` —— `q` 整个当作**正则表达式**（不切词、忽略大小写、`^`/`$` 按行匹配）；
   *    语法错误时返回空表，**不抛错**（由 UI 提示「正则无效」）。
   *
   * `q` 为空时，带 `tag` / `dir` 也算合法查询（"列出这个标签下的全部笔记"）；
   * 什么条件都没给才返回空表。
   */
  query(
    q: string,
    opts?: { limit?: number; dir?: string; tag?: string; regex?: boolean },
  ): Promise<SearchHit[]>
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
  | {
      type: 'input'
      bind: string
      placeholder?: string
      onSubmit?: string
      /**
       * 渲染成密码框（`type="password"`，输入回显为圆点）。rev173.163 加，为 `secrets` 密码库用。
       *
       * 为什么在**节点上**而不是让插件自己画：插件拿不到样式与 DOM，只有声明式节点；
       * 而"密码默认隐藏"是需求 §8.6 的硬要求 —— 明文 input 会把密码摊在屏幕上。
       * 注意这只是**显示层**的遮掩：`state[bind]` 里仍是明文（受控输入），
       * 所以它防的是肩窥，不是"内存里没有明文"（那件事本方案做不到，见安全插件方案 §6）。
       */
      secret?: boolean
    }
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
  /**
   * ⚠️ **内核当前没有独立侧栏载体**：右侧栏已取消 ⇒ `sidebar` 与 `main` 一样**渲染在主区**
   * （见 `App.tsx` 的 `pagePanel` 分流）。这条注释是 2026-10-13 补的 —— 在此之前
   * 文档说"侧栏"，插件作者会以为它能与编辑器同屏（真踩过：`doc.replaceRange` 因为编辑器
   * 被顶掉而静默 no-op）。要"与编辑器同屏"的位置，用 `editor-topbar` / `editor-toolbar`。
   */
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
    /** 声明式渲染（UINode）。与 `mount` **二选一**。 */
    render?: (ctx: ViewCtx) => UINode
    /**
     * **DOM 直挂**（rev173.81）。与 `render` **二选一**（都给会抛错）。
     *
     * 为什么需要它：`render` 只能返回 21 种 UINode，`html` 节点只做 `innerHTML`、
     * **不执行脚本** ⇒ PDF（pdf.js + canvas）、思维导图（mind-elixir）这类界面
     * 塞不进去，只能走整窗接管 `overrideShell`（把内核 UI 全请下场）。
     * 有了 `mount`，同一个面板就能在**主区**或**独立窗口**里画真 DOM，内核保留顶栏与返回键。
     *
     * 语义（与 `ShellMount` 相同，别在校验时退化）：
     * · `mount(el, ctx)` **只调用一次** —— 面板切走再切回会重新调用；`view.refresh()` **不会**重挂
     *   （否则插件自己的滚动位置 / 焦点 / 画布会被毁掉）。
     * · 释放时**先调**返回的 `Disposable`，**再清空容器**。
     * · `ctx.state` 用 getter 读**最新**面板状态（`view.setState` 仍然生效），但改状态**不会**触发重挂。
     * · `mount` 抛错不白屏：错误文本写进容器，其余界面照常（与 `render` 的第一层容错对齐）。
     */
    mount?: (el: HTMLElement, ctx: ViewCtx) => void | Disposable
    /**
     * **不进「☰ 菜单」/ 起始页快捷入口**（rev173.86）—— 给"动态实例面板"用。
     *
     * 典型：文档阅读器每个文档注册一个面板（`doc-reader.view.<hash>`），它们是一次性的
     * 实例、不是功能入口；全列进菜单会把菜单撑爆（打开 10 份文档 ⇒ 10 项）。
     * 标签条、`core.panel.<id>` 命令、拖出成窗口**照常可用** —— 只是不主动出现在菜单里。
     */
    hidden?: boolean
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
   * **库外绝对路径** → asset URL（2026-10-14 加）。
   *
   * 为什么需要：Android 系统「打开方式」递来的文件是 `content://`（SAF），
   * 内核的原生插件会把它复制到应用缓存（**库外绝对路径**）⇒ 阅读器要读它，
   * 而 `assetUrl` 只接受**库内相对路径**。
   *
   * ⚠️ 与 `assetUrl` 一样不做任何校验 —— 权限边界不在内核（原则 4），
   * 调用方自己清楚拿到的是什么路径。
   */
  assetUrlAbs(absPath: string): string
  /**
   * 弹系统**文件选择器**，让用户挑一个文件（**导入用**）。
   *
   * 返回什么取决于平台（2026-10-15 加）：
   * · **桌面** ⇒ 绝对路径（能直接交给路径型 API）
   * · **Android** ⇒ `content://` **内容 URI**（SAF）—— `std::fs` 读不了它，
   *   必须经原生插件 `tauri-plugin-uri-reader` 的 `read_content_uri` 复制到缓存后再用
   *
   * 用户取消 ⇒ 返回 `null`（不是抛错）。
   *
   * ⚠️ **Android 一律不传 `filters`**（真机实测，2026-10-15）：那边弹的是 MIUI 的
   * 「安全访问」，它按 **MIME** 过滤自己那四个分类，而 `md` 经
   * `MimeTypeMap.getMimeTypeFromExtension` 转出来的名字不在它的白名单里
   * ⇒ 传了 filter 的结果是**一个文件都列不出来**（目录能进、进去是空的）。
   * 这条平台差异封装在内核里，插件不用自己分平台。
   */
  pickFile(): Promise<string | null>
  /**
   * 读一个 Android SAF 的 `content://` URI（**导入用**）。
   *
   * 为什么必须由宿主提供：插件是 **Blob 模块**，`import` 不到 `@tauri-apps/api`
   * （独立 ESM、没有 node_modules）⇒ 拿不到 `invoke`，原生插件
   * `tauri-plugin-uri-reader` 的命令只能由内核转发。
   *
   * 原生侧会把内容**复制到应用缓存**再返回 `{ path, name }`（**绝对路径**）——
   * 拿到之后用 `host.assetUrlAbs(path)` ＋ `fetch()` 就能读内容。
   *
   * **桌面**没有 SAF：传进来的应当是普通绝对路径，内核**原样返回、不复制**（零开销）。
   */
  readContentUri(uri: string): Promise<{ path: string; name: string }>
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
  /**
   * **系统凭据库**（rev173.106 · 2026-10-24 用户裁决「一开始就走钥匙串」）。
   *
   * 落点：Windows Credential Manager · Android Keystore + SharedPreferences ·
   * macOS 登录钥匙串 —— **不是** `.zn/` 下的明文 JSON。
   *
   * 用途：同步插件的 WebDAV 账号密码 / S3 密钥这类**不该进笔记库**的东西。
   * 只存**字符串**（结构化数据自己 `JSON.stringify`）。同名覆盖，读不到返回 `null`。
   *
   * ⚠️ 它在**系统**作用域，不随库切换 —— 换库不会换凭据。
   */
  secrets: {
    get(account: string): Promise<string | null>
    set(account: string, secret: string): Promise<void>
    delete(account: string): Promise<void>
  }
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
 * **行首动作按钮**（`editor.addLineAction`，2026-10-13 rev54）。
 *
 * 与 `EditorMarkRule` 的区别：mark 给**区间**加样式（文字里的标签/链接），
 * lineAction 在**整行左外侧**插一个真按钮（视图元素，不进文档、不占偏移）。
 */
export type EditorLineAction = {
  /** 插件内唯一即可；宿主会加上插件前缀防冲突 */
  id: string
  /** 正则源（字符串）。宿主自动补 `g`；**按行匹配请自己带 `m`**（`^`/`$` 才按行生效） */
  pattern: string
  flags?: string
  /**
   * **跨行条件的最后一道关**（rev65）。
   *
   * 正则只看得见字节，而像"**这个标题下面到底有没有列表**"这种条件要看整篇 ——
   * 所以给一个谓词：返回 `false` 的行**不画按钮**（不传则行为与以前完全一样）。
   *
   * `line` 与 `onClick` 的 payload **同一口径（0 起）**，免得插件两处各写一套行号换算。
   * 它是**同步**的，且会被逐行调用 ⇒ 插件侧请自行缓存"按整篇解析一次"的结果
   * （同一篇文本在一次装饰器重建里会被问很多遍）。
   */
  filter?: (ctx: { doc: string; line: number; text: string }) => boolean
  /** 按钮文字（短：1–3 个字符或 emoji） */
  label: string
  /** 悬停提示 */
  title?: string
  /** 点击时执行的命令 id；payload = `{ line, from }`（`line` 从 0 起） */
  onClick: string
  /** 语义档位 —— 具体颜色由宿主映射到 `--zn-*` token */
  className?: 'accent' | 'muted'
}

/**
 * **按行加 class**（`editor.addLineClass`，2026-10-14 rev78 新增）。
 *
 * 与 `EditorLineAction` 的区别：lineAction 在行首插一个**按钮**；lineClass 只给**整行**加一个
 * class（不插任何视图元素）—— 用途是"按结构给行上样式"，典型就是**大纲竖线**：
 * 插件算出每行的缩进层级、返回 `zn-ol-d2` 这种 class，样式表再用它画导轨。
 *
 * 为什么不让插件用 `pattern` 数缩进空格：**渲染后的缩进由 CM6 按层级给**
 * （`padding-left` 实测第 1 级 34px、每级 +10.2px），源码里的空格数与之无关
 * ⇒ 只有"内核解析出层级、逐行告诉宿主"这一条路。
 */
export type EditorLineClassRule = {
  /** 插件内唯一即可；宿主会加上插件前缀防冲突 */
  id: string
  /**
   * 逐行问：这一行要加什么 class（`null` / 空串 = 不加）。
   *
   * `line` 从 0 起（与 `addLineAction.onClick` 的 payload 同一口径）。
   * 与 `EditorLineAction.filter` 一样：**同步**、**会被逐行调用** ⇒ 按整篇解析的结果请自行缓存
   * （`outline-map` 里 `mapButtonTargets` 的缓存写法可直接照抄）。
   *
   * `folded`（2026-10-14 加）：这一行**当前是否处于折叠状态**，由内核从 CM6 官方折叠状态
   * （`foldedRanges`）里读出来告诉你 ⇒ "折叠态的行要加什么 class"不必插件自己记账，
   * 也就不存在"插件记的和编辑器里显示的不是同一个状态"这类错位。
   */
  classAt: (ctx: { doc: string; line: number; text: string; folded: boolean }) => string | null
}

/**
 * **折叠 / 展开**（`editor.addFold`，rev80 新增 · **rev81 换成官方状态机**）。
 *
 * 与上面三条的区别：mark / lineAction / lineClass 都是"翻译成装饰"的**纯函数**，
 * 而折叠牵涉**有状态**的交互与**文档结构**（藏掉一整块子行）。
 *
 * **rev81 起：折点由插件给，状态机用 CM6 官方的。** 背景（查一手来源得到）：
 * · `@codemirror/language`（**早就在依赖树里**，随 `@atomic-editor/editor` 装上）导出
 *   `foldService` · `codeFolding` · `foldedRanges` · `foldEffect`/`unfoldEffect` ·
 *   `foldCode`/`unfoldCode`/`foldAll` · `foldKeymap` —— 折叠的**状态机（StateField + 事务 +
 *   位置映射 + 键位）官方全都有**，而 atomic-editor 自己没用（它的 dist 里搜不到这些名字）。
 * · rev80 我们在内核里手写了一套等价的（`Decoration.replace({block:true})` 的 StateField +
 *   自己管折叠集合 + `refresh()` 广播）。**那部分是重复造**，本轮删掉。
 * · ⚠️ **但"markdown 列表折叠"上游确实不做**：`@codemirror/lang-markdown` 的 `foldNodeProp`
 *   显式 `isList(type) ? undefined : …`（它只给标题整节折叠 + 代码块/引用/表格）。
 *   ⇒ 所以**折点规则（`foldEndAt`）必须由插件提供**，这是上游留的空白，不是重复劳动。
 * · 还有一条硬约束：CM6 扩展必须是**同一个库实例**产出的 ⇒ 插件**不可能**自己 import
 *   `@codemirror/language`（插件是库内一个独立 ESM，没有 node_modules）⇒ 官方 API 只能由内核装，
 *   插件通过下面这三个回调/方法参与。
 *
 * **职责划分**
 * · **插件**：`foldEndAt`（哪些行能折、折到哪）+ `initialFolded`（挂载时恢复上次的折叠）
 *   + `onToggle`（折叠态变了 ⇒ 写盘）+ 外观（`manifest.styles`）与点击（事件委托，
 *   点击后调 `api.editor.toggleFold(line)`）。
 * · **内核**：把 `foldEndAt` 接成官方 `foldService`、装 `codeFolding()`、把
 *   `toggleFold` / `foldAt` / `restoreFolds` 三个方法接到官方 `foldEffect` / `foldedRanges` 上。
 */
export type EditorFoldRule = {
  /** 插件内唯一即可；宿主会加上插件前缀防冲突 */
  id: string
  /**
   * 逐行问：这一行**能否折叠**、能折叠时范围的**结束行号（0 起，含）**；`null` = 不可折叠。
   *
   * 与 `classAt` / `filter` 同一要求：**同步**、**会被逐行调用** ⇒ 请按整篇缓存解析结果。
   */
  foldEndAt: (ctx: { doc: string; line: number; text: string }) => number | null
  /**
   * **挂载时**这一行要不要折起来（`restoreFolds()` 也会重新问一遍）。
   *
   * 只在这两个时机问 —— 之后"折不折"由 CM6 的状态说了算（`foldedRanges`），
   * 插件不用再维护一份镜像（rev80 那套"插件自己记账 + 内核来问"就此消失）。
   * 典型实现：读自己的持久化文件（`.zn/outline-folded.json`）里记的行签名。
   */
  initialFolded?: (ctx: { doc: string; line: number; text: string }) => boolean
  /**
   * **折叠集合变了**时通知插件 —— 把"当前哪些行折着"**整份**交给它（**对账式**，不是逐行加减）。
   *
   * 为什么不是逐行的 `onToggle(line, folded)`（rev81 第一版正是那样，实测有漏洞）：
   * 折叠可以**嵌套**，而展开祖先时子孙的折叠会**一起消失**（官方一次 unfold 就全撤了）
   * ⇒ 逐行通知只为祖先调一次，**子孙的签名留在记录里**；下次打开笔记 `initialFolded`
   * 又照这些残留把它们折起来 —— 用户看到的是"我明明展开过，重开又折上了"
   * （本地测试库上实测残留 2 项）。对账式没有这种漂移：内核把**真实**折叠集合
   * （`foldedLines`，0 起行号、升序）交给你，你整份重写即可。
   *
   * ⚠️ 它不只在你调 `toggleFold` 后触发：**用户用官方折叠键位折的**同样会对账
   * （内核比较两份 `foldedRanges` 的引用，任何来源的折叠变化都算）。
   */
  onFoldChange?: (ctx: { doc: string; foldedLines: number[] }) => void
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
  /**
   * 在**匹配行的左侧**放一个可点的小按钮（2026-10-13 rev54 新增）。
   *
   * 用途（用户当场提的需求）：把"每组一个按钮"这种**行级入口**放到它该在的地方 ——
   * 比如大纲/导图插件在每个 `# 标题` 行左边放一个「❖」，点了把那组开成独立窗口。
   * 之前做不到：`addMark` 只能给**区间**加样式，塞不进按钮；`PanelLocation` 里也没有
   * "贴在某一行旁边"的位置。
   *
   * 实现走 CM6 的 **Widget decoration**（`Decoration.widget`，`side: -1` = 行首之前）——
   * 官方 *Decoration Example* 给布尔值加可点 checkbox 用的就是它；`ignoreEvent()` 返回 false
   * 让点击不被编辑器吞掉。
   *
   * ```js
   * api.editor.addLineAction({
   *   id: 'map-btn',
   *   pattern: '^#{1,6}\\s',   // 带 m 才按行匹配（宿主自动补 g）
   *   flags: 'm',
   *   label: '❖',
   *   title: '把这一组开成导图窗口',
   *   onClick: 'outline-map.open-map-at-line',
   * })
   * // 点击时命令收到 payload = { line, from }（line 从 0 起）
   * ```
   *
   * ⚠️ 边界（rev65 起第一条已被 `filter` 解决）：
   * · 正则只能按**单行**判断"哪一行有按钮"。凡是要看整篇的条件（典型：**这个标题下面
   *   有没有列表**），用 `filter` —— 它拿到全文与行号，返回 false 的行不画按钮。
   * · 按钮是**视图元素**，不进文档、不占偏移 ⇒ 不会污染 Markdown 源。
   */
  addLineAction(rule: EditorLineAction): Disposable
  /**
   * 给**整行**加 class（2026-10-14 rev78 新增）。
   *
   * ```js
   * const depth = depthByLine(doc) // 插件自己解析一次并缓存
   * api.editor.addLineClass({
   *   id: 'outline-lines',
   *   classAt: ({ line }) => (depth.get(line) ? `zn-ol-d${depth.get(line)}` : null),
   * })
   * ```
   *
   * 只加 class、不插视图元素 ⇒ 与 `addLineAction`（行首按钮）可以同时用在同一行上：
   * 按钮在**行盒左侧的 gutter**（实测右边缘 293），竖线画在**内容盒**左侧
   * （`background-origin: content-box`）—— 两者不打架。
   */
  addLineClass(rule: EditorLineClassRule): Disposable
  /**
   * 登记一条**折叠 / 展开**规则（rev80 新增 · rev81 换成官方状态机，见上面的类型注释）。
   *
   * ```js
   * api.editor.addFold({
   *   id: 'outline-fold',
   *   foldEndAt: ({ line }) => tree.lastChildLine(line),      // 折点（子项末行，0 起）
   *   initialFolded: ({ text }) => foldedSet.has(sig(text)),  // 持久化恢复
   *   onToggle: ({ text, folded }) => save(foldedSet, sig(text), folded),
   * })
   * // 点击（插件自己的事件委托）→ api.editor.toggleFold(line)
   * ```
   */
  addFold(rule: EditorFoldRule): Disposable
  /**
   * **切换**某一行的折叠状态（`line` 从 0 起）。返回"这一行能不能折"。
   *
   * 状态机在 CM6 手里（官方 `foldEffect` / `unfoldEffect`），所以这是**命令式**的：
   * 插件点击时调它即可，不用自己记账。切换后会调对应规则的 `onToggle`（供写盘）。
   */
  toggleFold(line: number): boolean
  /** 这一行**当前**是否已折叠（读 CM6 的折叠状态，不是插件记的那份）。 */
  foldAt(line: number): boolean
  /**
   * 重新问一遍各规则的 `initialFolded` 并把结果应用上去（rev81）。
   *
   * 用途：插件**异步**读完自己的持久化记录之后（典型：`.zn/outline-folded.json` 读完），
   * 让内核按它恢复折叠。挂载时内核已自动问过一遍 —— 那次多半读盘还没回来。
   */
  restoreFolds(): void
  /**
   * 把一个编辑器里的 DOM 元素换算成**行号（0 起）**；换算不出来给 `null`。
   *
   * 给**插件自己做事件委托**用（2026-10-14 加）：插件要接"点圆点折叠"这类交互，
   * 而 **DOM 子元素的索引不等于行号** —— 折叠时被隐藏的行根本不渲染，
   * 索引会整体错位。只有内核手上有 `EditorView`（`posAtDOM`），所以这一步由内核提供。
   */
  lineAtElement(el: Element): number | null
  /** 当前生效的规则（诊断用） */
  list(): { id: string; pluginId: string }[]
}

/**
 * 11. net —— HTTP 请求（rev173.106 加 · 2026-10-24）。
 *
 * **为什么由内核发、而不是插件自己 `fetch`**：WebDAV 用自定义方法
 * （`PROPFIND` / `MKCOL` / `MOVE`）与非简单头，浏览器必然先发 CORS preflight；
 * 服务器不回 CORS 头时插件只能看到 `TypeError: Failed to fetch`，分不清
 * 「CORS 被拒 / 断网 / 401」。这条原语把请求交给 Rust（`reqwest`），没有 CORS，
 * 拿得到真实状态码与响应头。依据 `docs/同步插件-调研与方案-2026-10-24.md` §3。
 *
 * 内核**不认识 WebDAV** —— 方法与协议语义全在插件里。
 */
export type NetHeaders = Record<string, string>

export type NetRequestSpec = {
  /** 绝对 URL（`http:` / `https:`） */
  url: string
  /** 默认 `GET`。WebDAV 的 `PROPFIND` / `MKCOL` / `MOVE` / `PROPPATCH` 都从这里传 */
  method?: string
  headers?: NetHeaders
  /** 请求体：字符串按 UTF-8，`Uint8Array` 原样发送 */
  body?: string | Uint8Array
  /** 超时毫秒（默认 30000，夹在 1000–120000） */
  timeoutMs?: number
}

export type NetResponse = {
  /**
   * HTTP 状态码。**4xx / 5xx 不抛错** —— 内核只负责把服务端的话原样带回来：
   * 401 该重试、404 该跳过、409/412 该判定冲突，都由调用方按业务决定。
   */
  status: number
  /** 响应头，键已小写。重复头按出现顺序用 `, ` 合并 */
  headers: NetHeaders
  /** 响应体按 UTF-8 解码（**不猜编码**；非 UTF-8 响应请用 `bytes()`） */
  text(): string
  /** 响应体原始字节 */
  bytes(): Uint8Array
}

export interface NetApi {
  fetch(spec: NetRequestSpec): Promise<NetResponse>
}

/**
 * 内核契约版本（2026-10-18 rev118：0.1.0 → **0.2.0**）。
 *
 * 为什么升：契约文档 2026-10-17 已写成 v0.2（补 3 capability + host 3 方法 + editor 6 方法 +
 * 插件三种来源），而代码一直停在 `0.1.0` —— 文档与代码各说一个版本。
 * 加载校验只看 **major**（`plugin-host.ts` 的 `assertApiVersion`），所以 0.1 / 0.2 互通；
 * 升号不会让现装插件失载。插件 manifest 一并写成 `^0.2.0`，让「声明值 = 内核值」。
 */
export const API_VERSION = '0.2.0'

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
  /** HTTP 请求（Rust 侧发出，不受 CORS 限制）—— 同步插件靠它，见上面 `NetApi` */
  net: NetApi
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
  /** 编辑器**行首动作按钮**（`editor.addLineAction`，rev54） */
  | 'editor:line-action'
  /** 编辑器**逐行 class**（`editor.addLineClass`，rev78） */
  | 'editor:line-class'
  /** 编辑器**折叠/展开**（`editor.addFold`，rev80） */
  | 'editor:fold'
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
   * **入口文件的 SHA-256**（小写 hex；2026-10-18 rev119 加）。可选。
   *
   * 有值 ⇒ 加载前比对 `entry` 内容的摘要，不符则**拒载**（文件被改过 / 装坏了）。
   * 没有 ⇒ 插件管理页标「未签名」（若同时没有 `signature.json`）。
   *
   * ⚠️ 只覆盖入口**一个文件**（多文件插件的 `files` 不校验），所以它是
   * 「完整性提示」而不是「签名」—— 谁都算得出同一个 hash。
   *
   * **真签名**：插件目录里的 `signature.json`（Ed25519，2026-10-21 rev173.77；
   * 载荷 2026-10-25 rev173.142 升到 v2 = 入口 + `manifest.files` 全量摘要），
   * 信任根 = **内置官方公钥**（Rust `BUILTIN_TRUSTED_KEYS`，rev173.146）
   * ∪ `<应用数据目录>/.zn/trusted-keys.json`（同 keyId 用户那条覆盖内置）。
   * 有签名文件就必须验过才加载（见契约 §3）。
   */
  sha256?: string
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
   * **插件分类**（2026-10-18 rev173.4，可选）：插件页按它分组展示。
   *
   * `editor` 编辑增强 · `reader` 阅读 · `theme` 主题外观 · `tool` 工具 · `demo` 示例与探针。
   * 不写 ⇒ 宿主按形状与 id 关键词推断（`lib/plugin-category.ts` 的 `categorizePlugin`）：
   * 纯 CSS（只有 `styles` 没有 `entry`）算主题，id 带 demo/probe 算示例，其余按关键词猜。
   *
   * ⚠️ 它只影响**展示分组**：加载、安装路径（`.zn/plugins/<id>/`）、权限都不看这个字段。
   */
  category?: PluginCategory
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
