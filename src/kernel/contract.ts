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
  /** 移入 .zn/trash/，不是物理删除 */
  delete(path: string): Promise<void>
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

/** 声明式 UI：插件只「声明」界面，宿主用统一组件渲染 ⇒ 风格 100% 统一 */
export type UINode =
  | { type: 'stack'; children: UINode[] }
  | { type: 'row'; children: UINode[] }
  | { type: 'text'; value: string; variant?: 'body' | 'caption' | 'title' }
  | { type: 'markdown'; value: string }
  | { type: 'button'; label: string; onClick: string; variant?: 'default' | 'ghost' | 'danger' }
  | { type: 'input'; bind: string; placeholder?: string; onSubmit?: string }
  | { type: 'select'; bind: string; options: { value: string; label: string }[] }
  | { type: 'list'; items: UINode[]; empty?: string }
  | { type: 'divider' }

export type ViewCtx = {
  pluginId: string
  state: Record<string, unknown>
}

/** 6. view —— 视图挂载 */
export interface ViewApi {
  registerPanel(spec: {
    id: string
    title: string
    icon?: string
    location: 'sidebar' | 'main' | 'statusbar' | 'modal'
    render: (ctx: ViewCtx) => UINode
  }): Disposable
  registerWebView(spec: {
    id: string
    title: string
    location: 'sidebar' | 'main' | 'modal'
    url: string
  }): Disposable
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

export interface Plugin {
  apply(ctx: PluginContext): void | Promise<void>
  dispose?(): void | Promise<void>
}
