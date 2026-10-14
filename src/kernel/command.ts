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
 */
import type { CommandApi, CommandSpec, Disposable } from './contract'

/** 注册表内部条目：元数据可能来自静态声明，实现可能晚到 */
type Entry = {
  id: string
  title: string
  keybinding?: string
  when?: string
  /** 拥有者插件 id —— 静态声明时就知道，用它找到该激活谁 */
  pluginId?: string
  /** 实现。懒激活插件要等 `bind()` 之后才有 */
  run?: (...args: unknown[]) => unknown
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

  const api: CommandApi = {
    register(cmd: CommandSpec): Disposable {
      requireNamespace(cmd.id)
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
       * 现在与 `bind()` 用同一套**接管可还原**语义：后来者覆盖，`dispose` 时把上一层放回去
       * （卸掉插件 ⇒ 恢复成内核占位，而不是把内核功能一起带走）。
       * 覆盖时留一条 warn，便于诊断"谁接管了谁"。
       */
      const prev = registry.get(cmd.id)
      if (prev) {
        console.warn(`[command] ${cmd.id} 已被注册 —— 后来者接管（dispose 时还原上一条）`)
      }
      registry.set(cmd.id, {
        id: cmd.id,
        title: cmd.title,
        keybinding: cmd.keybinding,
        when: cmd.when,
        run: cmd.run,
      })
      return {
        dispose: () => {
          // 只有"当前实现还是我自己"才动 —— 免得旧实例的 dispose 干掉新接管者
          const cur = registry.get(cmd.id)
          if (cur?.run !== cmd.run) return
          if (prev) registry.set(cmd.id, prev)
          else registry.delete(cmd.id)
        },
      }
    },

    bind(id: string, run: (...args: unknown[]) => unknown): Disposable {
      const entry = registry.get(id)
      if (!entry) {
        // 没静态声明就 bind ⇒ 视为"自带元数据的注册"，元数据缺省用 id 兜底
        requireNamespace(id)
        registry.set(id, { id, title: id, run })
        return {
          dispose: () => {
            const cur = registry.get(id)
            // bind 之前这条命令**根本不存在** ⇒ 撤销要整条撤掉，别留空壳条目
            if (cur && cur.run === run) registry.delete(id)
          },
        }
      }

      /**
       * **接管（覆盖）语义的还原点** —— `bind` 到一条已存在的命令（典型就是
       * `core.newNote` 这类内核命令）时，先记下被覆盖的实现，`dispose` 时放回去。
       *
       * 此前这里只 `delete cur.run`：dispose 之后命令**还在表里但没有实现** ⇒
       * 执行抛「尚未绑定实现，且没有可用的激活器」⇒ 卸载插件把内核功能一起带走了
       * （真机可复现：`examples/daily-note` 一卸，「新建笔记」四个入口全废）。
       * 这正是接管协议要立的第一条规矩：**接管必须可还原，还原到接管前的样子**。
       *
       * 嵌套接管也成立：A 先 bind、B 后 bind，则 B 的 `prevRun` 是 A 的实现；
       * B dispose 还原 A，A dispose 再还原内核。谁最后接管谁负责放回上一层。
       */
      const prevRun = entry.run
      const hadRun = prevRun !== undefined
      entry.run = run
      return {
        dispose: () => {
          const cur = registry.get(id)
          // 已经被别人重新接管 ⇒ 不是我的事，别把新实现抹掉
          if (!cur || cur.run !== run) return
          if (hadRun) cur.run = prevRun
          // 原本就是"静态声明过、实现还没绑"的懒激活条目 ⇒ 回到未绑定状态
          else delete cur.run
        },
      }
    },

    async execute(id: string, ...args: unknown[]): Promise<unknown> {
      let entry = registry.get(id)
      if (!entry) throw new Error(`命令不存在：${id}`)

      // 静态声明过、实现还没上来 ⇒ 先激活它的插件（这正是懒激活发生的地方）
      if (!entry.run) {
        if (!entry.pluginId || !activator) {
          throw new Error(`命令 ${id} 尚未绑定实现，且没有可用的激活器`)
        }
        await activator(entry.pluginId)
        entry = registry.get(id)
      }

      const run = entry?.run
      if (!run) throw new Error(`命令 ${id} 激活后仍未绑定实现`)

      try {
        return await run(...args)
      } catch (err) {
        onError(id, err)
        throw err
      }
    },

    list() {
      return [...registry.values()].map(({ id, title }) => ({ id, title }))
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
      return [...registry.values()].map(({ id, title, keybinding, when }) => ({
        id,
        title,
        keybinding,
        when,
      }))
    },

    declare(decl: CommandDecl): Disposable {
      requireNamespace(decl.id)
      const existing = registry.get(decl.id)
      if (existing) {
        throw new Error(`命令 id 重复：${decl.id}`)
      }
      registry.set(decl.id, {
        id: decl.id,
        title: decl.title,
        keybinding: decl.keybinding,
        when: decl.when,
        pluginId: decl.pluginId,
      })
      return {
        dispose: () => {
          registry.delete(decl.id)
        },
      }
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
      return Boolean(registry.get(id)?.run)
    },

    implTag(id: string) {
      const run = registry.get(id)?.run
      if (!run) return null
      const tag = (run as unknown as Record<string, unknown>)[IMPL_TAG]
      return typeof tag === 'string' ? tag : 'core'
    },
  }
}
