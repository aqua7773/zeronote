/**
 * command 原语 —— 命令 / 快捷键 / 命令面板（契约 §2.1）
 *
 * 规则（契约里写死的）：
 *  - 命令 id **必须带命名空间前缀**（`inspiration-flow.capture`）—— 防止插件互相覆盖
 *  - id 重复 → 抛错，让插件作者立刻发现冲突
 *  - 卸载插件 → 它的命令全消失（dispose 由宿主在插件卸载时统一调用）
 *
 * ## 懒激活（2026-10-12 加）
 *
 * 以前 `register({id,title,run})` 把**元数据与实现绑在一起** ⇒ 命令面板要列出命令，
 * 插件就必须已经 `apply()` 过 ⇒ 装上 N 个插件 = 启动即 N 次 apply，移动端冷启动很难看。
 *
 * 现在分两步：
 *   ① 宿主读 `manifest.contributes.commands` ⇒ `declare()` **只登记元数据**（插件代码一行没跑）
 *   ② 命令真被执行时 ⇒ `execute()` 发现没有实现 ⇒ 调 activator 先激活那个插件 ⇒
 *      插件在 `apply()` 里 `bind(id, run)` 补上实现 ⇒ 再执行
 *
 * 老的 `register()` 原样保留：没写 `activationEvents` 的插件走的还是"启动即 apply"的老路，
 * 现有插件一个都不用改。
 *
 * ## 接管是"层栈"，不是"单槽 + 还原点"（rev121 重构）
 *
 * 以前每条命令只存**一份**实现，覆盖时把上一层塞进 dispose 的闭包；dispose 只在
 * 「当前实现还是我自己」时才还原。于是 A、B 先后接管、A 先卸载时：A 的 dispose 被跳过
 * （对，不能抹 B），但 A 那层还原点也没了 ⇒ B 卸载后还原到**已卸载的 A**（"僵尸实现"，
 * rev120 单测记录、rev121 修）。
 *
 * 现在每条命令维护 `layers` 栈：register / bind / declare 各 push 一层，dispose **只摘自己那层**。
 * 谁先卸都不会影响别人，栈空才算命令消失 —— 还原链天然正确：A 卸掉后 B 直接落回内核。
 */
import type { CommandApi, CommandSpec, Disposable } from './contract'

/**
 * 一层：实现和元数据都可能来自不同层。
 * `bind` 只带 `run`（元数据沿用下面那层）· `declare` 只带元数据（没有实现）·
 * `register` 两样都带。
 */
type Layer = {
  run?: (...args: unknown[]) => unknown
  title?: string
  keybinding?: string
  when?: string
}

/** 注册表内部条目：id + 拥有者 + 层栈（栈顶 = 当前生效） */
type Entry = {
  id: string
  /** 拥有者插件 id —— 静态声明时就知道，用它找到该激活谁 */
  pluginId?: string
  /** **非空**；栈顶那层是当前实现/元数据的来源 */
  layers: Layer[]
}

/**
 * 实现归属标记的键名。宿主给插件接管的实现打上 `plugin:<id>`，
 * 审计快照据此回答「这条命令**现在**是谁在实现」—— `core.newNote` 的接管还原
 * 就得靠它才可判定（命令表本身看不出实现被换过，更看不出被换成了"没有实现"）。
 */
const IMPL_TAG = '__znImplTag'

/** 打归属标记。函数对象加属性在 JS 里合法；万一将来实现被冻结，退化成"未标注"也不影响功能 */
export function tagCommandImpl<T>(run: T, tag: string): T {
  try {
    ;(run as unknown as Record<string, unknown>)[IMPL_TAG] = tag
  } catch {
    /* 标不上就算了 —— 审计会把它算作 'core'，不该因为诊断信息拖垮功能 */
  }
  return run
}

export type CommandDecl = {
  id: string
  title: string
  keybinding?: string
  when?: string
  pluginId: string
}

export type CommandRegistry = {
  api: CommandApi
  /** 命令面板用：按标题/ID 模糊筛选 */
  search(query: string): { id: string; title: string }[]
  /** 全部命令（含快捷键声明），快捷键绑定用 */
  all(): { id: string; title: string; keybinding?: string; when?: string }[]
  /** 宿主用：静态登记 manifest 里声明的命令（**不加载插件**） */
  declare(decl: CommandDecl): Disposable
  /** 宿主用：注入"这条命令需要先激活某个插件"的钩子 */
  setActivator(fn: (pluginId: string) => Promise<void>): void
  /** 宿主用：插件卸载时清掉它的命令（静态声明的也要清） */
  release(pluginId: string): void
  /** 实现是否已绑定（UI 可以据此标注"未激活"） */
  isBound(id: string): boolean
  /**
   * 审计用：这条命令当前实现者的归属 —— `plugin:<id>`（插件接管）·
   * `'core'`（内核注册或未标注）· `null`（静态声明了但实现未绑定）。
   */
  implTag(id: string): string | null
}

/** 从栈顶往下取第一个定义了该字段的层 —— bind 层不带元数据，自然沿用下面那层 */
function metaOf<K extends 'title' | 'keybinding' | 'when'>(e: Entry, key: K): Layer[K] {
  for (let i = e.layers.length - 1; i >= 0; i--) {
    const v = e.layers[i][key]
    if (v !== undefined) return v
  }
  return undefined
}

/** 当前生效的实现 = **栈顶那层**的 run（栈顶是 declare 的空层时 = 未绑定） */
function currentRun(e: Entry): ((...args: unknown[]) => unknown) | undefined {
  return e.layers[e.layers.length - 1]?.run
}

export function createCommandApi(
  onError: (id: string, err: unknown) => void = () => {},
): CommandRegistry {
  const registry = new Map<string, Entry>()
  let activator: ((pluginId: string) => Promise<void>) | null = null

  function requireNamespace(id: string) {
    if (!id.includes('.')) {
      throw new Error(`命令 id 必须带命名空间前缀（如 plugin-id.command）：${id}`)
    }
  }

  /**
   * 从栈里摘掉一层；摘空就删条目。
   * 幂等 —— 重复 dispose、或者条目已被 `release` 掉，都不该抛。
   */
  function dropLayer(id: string, layer: Layer) {
    const e = registry.get(id)
    if (!e) return
    const i = e.layers.lastIndexOf(layer)
    if (i < 0) return
    e.layers.splice(i, 1)
    if (e.layers.length === 0) registry.delete(id)
  }

  const api: CommandApi = {
    register(cmd: CommandSpec): Disposable {
      requireNamespace(cmd.id)
      const layer: Layer = {
        title: cmd.title,
        keybinding: cmd.keybinding,
        when: cmd.when,
        run: cmd.run,
      }
      /**
       * ⚠️ **同 id 不再是"抛错"，而是"接管"**（rev81 修，真机实测的 bug）。
       *
       * 内核自己会先注册几条**占位命令**（典型：`core.openDocument` —— 没插件时给一句
       * 「到「插件管理」装一个文档阅读器」的友好提示）。插件随后想接管同 id 时，
       * 原来那句 `throw new Error('命令 id 重复')` 直接把它**拒之门外**：
       * 插件日志照打「已就绪（接管 core.openDocument）」、插件页也显示已启用，
       * 可**执行时跑的还是内核占位** ⇒ 打开外部 PDF 弹
       * 「没有能打开 .该 的插件 —— 到「插件管理」装一个文档阅读器」
       * （用户 2026-10-14 报的"显示没有装插件、但插件已经在运行"就是这个）。
       *
       * 现在把新层压上栈顶：后来者接管，`dispose` 时只摘掉自己那层
       * ⇒ 卸掉插件恢复成内核占位，而不是把内核功能一起带走。
       * 覆盖时留一条 warn，便于诊断"谁接管了谁"。
       */
      const prev = registry.get(cmd.id)
      if (prev) {
        console.warn(`[command] ${cmd.id} 已被注册 —— 后来者接管（dispose 时还原上一条）`)
        prev.layers.push(layer)
      } else {
        registry.set(cmd.id, { id: cmd.id, layers: [layer] })
      }
      return { dispose: () => dropLayer(cmd.id, layer) }
    },

    bind(id: string, run: (...args: unknown[]) => unknown): Disposable {
      const layer: Layer = { run }
      const entry = registry.get(id)
      if (!entry) {
        // 没静态声明就 bind ⇒ 视为"自带元数据的注册"，元数据缺省用 id 兜底
        requireNamespace(id)
        layer.title = id
        registry.set(id, { id, layers: [layer] })
      } else {
        /**
         * 只压实现层、不动元数据：`declare` 登记过的标题/快捷键/条件继续沿用。
         * dispose 时摘掉这层 ⇒ 回到"静态声明过、实现未绑定"的状态（懒激活语义）。
         */
        entry.layers.push(layer)
      }
      return { dispose: () => dropLayer(id, layer) }
    },

    async execute(id: string, ...args: unknown[]): Promise<unknown> {
      const entry = registry.get(id)
      if (!entry) throw new Error(`命令不存在：${id}`)

      let run = currentRun(entry)
      // 静态声明过、实现还没上来 ⇒ 先激活它的插件（这正是懒激活发生的地方）
      if (!run) {
        if (!entry.pluginId || !activator) {
          throw new Error(`命令 ${id} 尚未绑定实现，且没有可用的激活器`)
        }
        await activator(entry.pluginId)
        const after = registry.get(id)
        run = after ? currentRun(after) : undefined
      }

      if (!run) throw new Error(`命令 ${id} 激活后仍未绑定实现`)

      try {
        return await run(...args)
      } catch (err) {
        onError(id, err)
        throw err
      }
    },

    list() {
      return [...registry.values()].map((e) => ({ id: e.id, title: metaOf(e, 'title') ?? e.id }))
    },
  }

  return {
    api,

    search(query: string) {
      const q = query.trim().toLowerCase()
      const items = api.list()
      if (!q) return items
      return items.filter(
        (c) => c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
      )
    },

    all() {
      return [...registry.values()].map((e) => ({
        id: e.id,
        title: metaOf(e, 'title') ?? e.id,
        keybinding: metaOf(e, 'keybinding'),
        when: metaOf(e, 'when'),
      }))
    },

    declare(decl: CommandDecl): Disposable {
      requireNamespace(decl.id)
      const existing = registry.get(decl.id)
      if (existing) {
        throw new Error(`命令 id 重复：${decl.id}`)
      }
      const layer: Layer = {
        title: decl.title,
        keybinding: decl.keybinding,
        when: decl.when,
      }
      registry.set(decl.id, { id: decl.id, pluginId: decl.pluginId, layers: [layer] })
      return { dispose: () => dropLayer(decl.id, layer) }
    },

    setActivator(fn) {
      activator = fn
    },

    release(pluginId: string) {
      for (const [id, e] of [...registry]) {
        if (e.pluginId === pluginId) registry.delete(id)
      }
    },

    isBound(id: string) {
      const e = registry.get(id)
      return Boolean(e && currentRun(e))
    },

    implTag(id: string) {
      const e = registry.get(id)
      const run = e ? currentRun(e) : undefined
      if (!run) return null
      const tag = (run as unknown as Record<string, unknown>)[IMPL_TAG]
      return typeof tag === 'string' ? tag : 'core'
    },
  }
}
