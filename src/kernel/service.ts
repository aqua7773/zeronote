/**
 * service 原语 —— 插件间**带返回值**的互调，也是「前置插件」的载体（契约 §9）。
 *
 * 内核在这里是彻底干净的：它只维护一张 **`名字 → 懒工厂`** 的表，
 * 完全不认识 katex / mermaid / pdf / git 这些具体依赖。依赖环境由**插件**提供，
 * 于是"换一个公式渲染器"就是换一个插件，内核一行都不用改。
 *
 * 四条设计上的刻意选择：
 *
 * ① **懒工厂** —— `provide` 只登记闭包，`consume` 第一次才执行，结果缓存。
 *    没人用的前置插件**一次 import / 一次网络请求都不会发生**，这是"按需激活"的关键。
 * ② **软依赖** —— `consume` 拿不到返回 `null`，不抛错、不阻塞插件加载、不做拓扑排序
 *    （VS Code `extensionDependencies` 与 SilverBullet `redirect` 是同类做法）。
 * ③ **工厂抛错不外抛** —— 坏的依赖只让 `consume` 得到 `null` 并记一条日志，
 *    绝不把异常甩给消费者：一个前置插件坏了不该拖垮依赖它的插件。
 * ④ **调用方身份**（rev173.413 · 安全插件期 3）—— factory 收到 `{ caller }`，
 *    由 scoped 视图填入 pluginId，插件无法伪造。默认仍全局一份实例；
 *    `perCaller: true` 才按调用方各跑一次工厂、各自缓存（安全插件按「插件 ↔ 密钥环」授权）。
 */
import type { Disposable, ServiceApi } from './contract'

/** 工厂收到的调用现场（契约 §9） */
type CallSite = { caller: string }

type Entry = {
  pluginId: string
  version?: string
  factory: (ctx: CallSite) => unknown | Promise<unknown>
  /** 默认模式（全局一份）已跑出来的值 */
  value?: unknown
  /** 默认模式：已成功实例化 */
  loaded: boolean
  /** 默认模式：工厂抛错的原文 —— 记下来避免每次 consume 都重试一个坏依赖 */
  error?: string
  /** 默认模式：正在跑（并发 consume 只跑一次工厂） */
  pending?: Promise<unknown> | null
  /** perCaller 模式：工厂按调用方各跑一次 */
  perCaller?: boolean
  /** perCaller 模式：caller → 值 */
  values?: Map<string, unknown>
  /** perCaller 模式：caller → 工厂抛错原文 */
  errorByCaller?: Map<string, string>
  /** perCaller 模式：caller → 正在跑 */
  pendingByCaller?: Map<string, Promise<unknown>>
}

export type ServiceDeps = {
  /** 有新服务登记（宿主用来广播 `service:available`，让晚到的消费者补挂） */
  onAvailable: (name: string, pluginId: string) => void
  /** 服务被摘掉（提供者卸载 / 被覆盖） */
  onGone: (name: string, pluginId: string) => void
  onLog: (msg: string, level?: 'debug' | 'info' | 'warn' | 'error') => void
}

export type ServiceRegistry = {
  /** 给某个插件用的视图：`provide` 自动带上它的 id，卸载时按 id 回收 */
  scoped: (pluginId: string) => ServiceApi
  /** 插件卸载时调用 —— 摘掉它提供的全部服务（顺手清掉它作为调用方的 perCaller 缓存） */
  release: (pluginId: string) => void
  /** 诊断/验收用：当前登记表快照 */
  snapshot: () => { name: string; pluginId: string; version?: string; loaded: boolean }[]
}

export function createServiceRegistry(deps: ServiceDeps): ServiceRegistry {
  /** 全局注册表。**内核只认识字符串 key，不认识任何具体依赖** */
  const table = new Map<string, Entry>()

  function emitAvailable(name: string, pluginId: string) {
    deps.onAvailable(name, pluginId)
  }

  /** 是否已经实例化（诊断用；perCaller 只要有一个调用方拿到过就算） */
  function isLoaded(entry: Entry): boolean {
    if (entry.perCaller) return (entry.values?.size ?? 0) > 0
    return entry.loaded
  }

  /** perCaller 分支：每个 caller 各跑一次工厂、各自缓存（含错误，坏的调用方不污染别人） */
  async function consumePerCaller(entry: Entry, name: string, caller: string): Promise<unknown> {
    const values = (entry.values ??= new Map())
    if (values.has(caller)) return values.get(caller) ?? null

    const errors = (entry.errorByCaller ??= new Map())
    // 已经确认这个 caller 是坏依赖：不反复重试
    if (errors.has(caller)) return null

    const pendings = (entry.pendingByCaller ??= new Map())
    // 同一 caller 并发 consume 共享同一次工厂调用
    const running = pendings.get(caller)
    if (running) return await running

    const task = (async () => {
      try {
        const value = await entry.factory({ caller })
        values.set(caller, value)
        return value
      } catch (err) {
        errors.set(caller, String(err))
        deps.onLog(
          `服务「${name}」的工厂抛错（提供者 ${entry.pluginId} · 调用方 ${caller}）：${String(err)}`,
          'warn',
        )
        // 关键：**不把异常抛给消费者** —— 返回 null 让它走降级分支
        return null
      } finally {
        pendings.delete(caller)
      }
    })()
    pendings.set(caller, task)
    return await task
  }

  function scoped(pluginId: string): ServiceApi {
    /** 调用方身份：内核自身省略 id 时按 'kernel' 记（与 `services.scoped('kernel')` 一致） */
    const caller = pluginId || 'kernel'

    return {
      provide(name, factory, opts) {
        const prev = table.get(name)
        if (prev && prev.pluginId !== pluginId) {
          deps.onLog(
            `服务「${name}」被 ${pluginId} 覆盖（原提供者 ${prev.pluginId}）——` +
              `两个插件提供了同名服务，后登记的有效`,
            'warn',
          )
        }
        table.set(name, {
          pluginId,
          version: opts?.version,
          factory,
          loaded: false,
          pending: null,
          perCaller: opts?.perCaller,
        })
        emitAvailable(name, pluginId)

        return {
          dispose: () => {
            // 只有"当前登记的还是我"才摘 —— 否则旧实例的 dispose 会干掉新登记的服务
            if (table.get(name)?.pluginId === pluginId) {
              table.delete(name)
              deps.onGone(name, pluginId)
            }
          },
        }
      },

      async consume<T = unknown>(name: string): Promise<T | null> {
        const entry = table.get(name)
        if (!entry) return null

        if (entry.perCaller) {
          return (await consumePerCaller(entry, name, caller)) as T | null
        }

        if (entry.loaded) return (entry.value ?? null) as T | null
        // 已经确认是坏依赖：不反复重试工厂（每次 consume 都炸一次没意义）
        if (entry.error) return null
        // 并发 consume 共享同一次工厂调用
        if (entry.pending) return (await entry.pending) as T | null

        entry.pending = (async () => {
          try {
            const value = await entry.factory({ caller })
            entry.value = value
            entry.loaded = true
            return value
          } catch (err) {
            entry.error = String(err)
            deps.onLog(
              `服务「${name}」的工厂抛错（提供者 ${entry.pluginId}）：${String(err)}`,
              'warn',
            )
            // 关键：**不把异常抛给消费者** —— 返回 null 让它走降级分支
            return null
          } finally {
            entry.pending = null
          }
        })()

        return (await entry.pending) as T | null
      },

      list: () =>
        [...table.entries()].map(([name, e]) => ({
          name,
          pluginId: e.pluginId,
          version: e.version,
          loaded: isLoaded(e),
        })),
    }
  }

  function release(pluginId: string) {
    for (const [name, entry] of [...table]) {
      if (entry.pluginId === pluginId) {
        table.delete(name)
        deps.onGone(name, pluginId)
        continue
      }
      // 卸载的插件作为**调用方**：清掉它的 perCaller 缓存（闭包里可能持有它自己的状态）
      entry.values?.delete(pluginId)
      entry.errorByCaller?.delete(pluginId)
      entry.pendingByCaller?.delete(pluginId)
    }
  }

  function snapshot() {
    return [...table.entries()].map(([name, e]) => ({
      name,
      pluginId: e.pluginId,
      version: e.version,
      loaded: isLoaded(e),
    }))
  }

  return { scoped, release, snapshot }
}

/** 无操作实现：给"内核以外"的场景（测试、没有 service 的旧调用点）兜底 */
export function createNoopServiceApi(): ServiceApi {
  return {
    provide: (): Disposable => ({ dispose: () => {} }),
    consume: async () => null,
    list: () => [] as { name: string; pluginId: string; version?: string; loaded: boolean }[],
  }
}
