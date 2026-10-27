/**
 * **核心能力接管**（需求 §2.15 · rev173.231）。
 *
 * ## 它是什么
 *
 * 内核有几种「人人都要、但形状可以换」的能力：搜索查询、笔记存储读写。
 * 这个注册表让**插件**能给同一能力再提供一个实现，内核消费者（搜索面板、编辑器打开/保存链路）
 * 不用知道换没换 —— 它们只调 `capability.invoke('search.query', …)`。
 *
 * ## 需求 §2.15 的四条，逐条落在这里
 *
 * 1. **启用即接管 / 禁用即回退**：`provide` 返回 `Disposable`，插件卸载时宿主调
 *    `release(pluginId)`，提供者从表里消失 ⇒ 下一次调用自动落到内核默认实现。
 * 2. **多插件冲突按优先级选**：`priority` 大的胜出（缺省 0）。
 * 3. **同优先级弹窗让用户选并记住**：`selectFrom()` 返回 `needsChoice`，
 *    UI 用 `setChoice()` 写进 `localStorage`（key `zn-capability-choice`）。
 * 4. **接管者被禁用/卸载时自动回退**：默认实现由内核注册，**插件永远盖不掉它** ——
 *    它只作为「没有插件接管时」的兜底存在。
 *
 * ## 两条必须守住的语义
 *
 * - **防重入**：插件实现内部大概率要继续用内核能力（否则读不到真实数据）。
 *   例如 `search.query` 的接管者会调 `ctx.index.query()` 拿原始结果再加工 —— 若这时
 *   再次命中「插件实现」就是无限递归。所以**实现执行期间**的任何能力调用都直接走默认实现。
 * - **坏实现不掀内核**：插件实现抛错时，调用方拿到 reject（不是静默空表）——
 *    搜索面板会显示「搜索失败」，比「搜不到」更接近真相（硬约束 4：静默失效比报错危险）。
 *    但**不会**因此自动摘掉插件：是不是坏到要禁用它，由用户判断（插件页的开关就是）。
 */
import type { CapabilityApi, CapabilityName, CapabilityStatus } from './contract'

export const CAPABILITY_NAMES: CapabilityName[] = [
  'search.query',
  'storage.read',
  'storage.write',
  'storage.exists',
  'storage.list',
]

/** 给人看的名字（设置页 / 日志） */
export const CAPABILITY_LABELS: Record<CapabilityName, string> = {
  'search.query': '搜索查询',
  'storage.read': '读取笔记',
  'storage.write': '写入笔记',
  'storage.exists': '笔记是否存在',
  'storage.list': '列出笔记',
}

/** localStorage：`{ [capabilityName]: pluginId }` —— 用户在同优先级冲突里选的那个 */
export const CAPABILITY_CHOICE_KEY = 'zn-capability-choice'

type Impl = (...args: unknown[]) => unknown

type Provider = {
  pluginId: string
  priority: number
  impl: Impl
  /** 登记序号（同优先级里"先登记的"就是它） */
  seq: number
}

type Entry = {
  /** 内核默认实现（插件永远盖不掉，只做兜底） */
  fallback?: Impl
  providers: Provider[]
}

export type CapabilityDeps = {
  onLog: (msg: string, level?: 'info' | 'warn' | 'error') => void
  /** 提供者表变了（UI 刷新用） */
  onChange?: () => void
}

export type CapabilitySelection = {
  /** 实际生效的实现来源：`'kernel'` 或插件 id */
  active: 'kernel' | string
  needsChoice: boolean
  /** 同优先级的候选（needsChoice 时给 UI 用） */
  top: { pluginId: string; priority: number; chosen: boolean }[]
  providers: { pluginId: string; priority: number }[]
}

export type CapabilityRegistry = {
  /** 内核在组装点登记默认实现（每个能力一次） */
  setDefault: (name: CapabilityName, impl: Impl) => void
  /** 给插件用的视图：`provide` 自动带上它的 id */
  scoped: (pluginId: string) => CapabilityApi
  /** 插件卸载 / 禁用时调用 */
  release: (pluginId: string) => void
  /** 调用能力（消费者用）。实现执行期间再次调用 ⇒ 走默认实现（防递归） */
  invoke: <T = unknown>(name: CapabilityName, ...args: unknown[]) => Promise<T>
  /** 当前生效的是谁（UI / 诊断） */
  selection: (name: CapabilityName) => CapabilitySelection
  /** 全部能力的状态（设置页） */
  status: () => CapabilityStatus[]
  /** 记住用户在同优先级冲突里的选择 */
  setChoice: (name: CapabilityName, pluginId: string | null) => void
}

function readChoices(): Record<string, string> {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(CAPABILITY_CHOICE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeChoices(choices: Record<string, string>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(CAPABILITY_CHOICE_KEY, JSON.stringify(choices))
  } catch {
    // 配额满 / 隐私模式：不持久也要能用（本次会话里选择仍然生效）
  }
}

export function createCapabilityRegistry(deps: CapabilityDeps): CapabilityRegistry {
  const table = new Map<CapabilityName, Entry>()
  let seq = 0
  /** 防重入深度：>0 表示「正在跑某个插件实现」，此时再调用能力一律走默认 */
  let depth = 0

  const entryOf = (name: CapabilityName): Entry => {
    let entry = table.get(name)
    if (!entry) {
      entry = { providers: [] }
      table.set(name, entry)
    }
    return entry
  }

  function selection(name: CapabilityName): CapabilitySelection {
    const entry = table.get(name)
    const providers = [...(entry?.providers ?? [])].sort((a, b) => b.priority - a.priority || a.seq - b.seq)
    if (providers.length === 0) {
      return { active: 'kernel', needsChoice: false, top: [], providers: [] }
    }
    const max = providers[0].priority
    const top = providers.filter((p) => p.priority === max)
    const chosen = readChoices()[name]
    if (top.length === 1) {
      return {
        active: top[0].pluginId,
        needsChoice: false,
        top: top.map((p) => ({ pluginId: p.pluginId, priority: p.priority, chosen: true })),
        providers: providers.map((p) => ({ pluginId: p.pluginId, priority: p.priority })),
      }
    }
    const hit = top.find((p) => p.pluginId === chosen)
    return {
      active: (hit ?? top[0]).pluginId,
      needsChoice: !hit,
      top: top.map((p) => ({
        pluginId: p.pluginId,
        priority: p.priority,
        chosen: (hit ?? top[0]).pluginId === p.pluginId,
      })),
      providers: providers.map((p) => ({ pluginId: p.pluginId, priority: p.priority })),
    }
  }

  function implFor(name: CapabilityName): { impl: Impl; active: 'kernel' | string } {
    const sel = selection(name)
    const entry = table.get(name)
    if (sel.active !== 'kernel') {
      const provider = entry?.providers.find((p) => p.pluginId === sel.active)
      if (provider) return { impl: provider.impl, active: provider.pluginId }
    }
    if (!entry?.fallback) throw new Error(`能力「${name}」没有默认实现（内核组装点漏登记了）`)
    return { impl: entry.fallback, active: 'kernel' }
  }

  async function invoke<T>(name: CapabilityName, ...args: unknown[]): Promise<T> {
    const entry = table.get(name)
    // 防重入：插件实现执行期间再调用能力 ⇒ 走默认实现（它就是要拿"原始结果"）
    if (depth > 0) {
      if (!entry?.fallback) throw new Error(`能力「${name}」没有默认实现`)
      return (await entry.fallback(...args)) as T
    }
    const { impl } = implFor(name)
    depth++
    try {
      return (await impl(...args)) as T
    } finally {
      depth--
    }
  }

  function scoped(pluginId: string): CapabilityApi {
    return {
      provide(name, impl, opts) {
        if (typeof impl !== 'function') {
          throw new Error(`能力「${name}」的实现必须是函数`)
        }
        const entry = entryOf(name)
        // 同一个插件重复提供同一能力：后登记的替换掉自己那份（热重载常见）
        entry.providers = entry.providers.filter((p) => p.pluginId !== pluginId)
        entry.providers.push({
          pluginId,
          priority: Number.isFinite(opts?.priority) ? (opts?.priority as number) : 0,
          impl: impl as Impl,
          seq: ++seq,
        })
        const sel = selection(name)
        deps.onLog(`插件 ${pluginId} 接管了核心能力「${name}」（当前生效：${sel.active}）`, 'info')
        deps.onChange?.()
        return {
          dispose: () => {
            const cur = table.get(name)
            if (!cur) return
            const before = cur.providers.length
            cur.providers = cur.providers.filter((p) => p.pluginId !== pluginId)
            if (cur.providers.length !== before) {
              deps.onLog(`插件 ${pluginId} 不再提供「${name}」，回退到 ${selection(name).active}`, 'info')
              deps.onChange?.()
            }
          },
        }
      },
      status: () => status(),
    }
  }

  function status(): CapabilityStatus[] {
    return CAPABILITY_NAMES.map((name) => {
      const sel = selection(name)
      const entry = table.get(name)
      return {
        name,
        label: CAPABILITY_LABELS[name],
        active: sel.active,
        needsChoice: sel.needsChoice,
        top: sel.top,
        providers: sel.providers,
        hasFallback: !!entry?.fallback,
      }
    })
  }

  function release(pluginId: string) {
    for (const [name, entry] of [...table]) {
      const before = entry.providers.length
      entry.providers = entry.providers.filter((p) => p.pluginId !== pluginId)
      if (entry.providers.length !== before) {
        deps.onLog(`插件 ${pluginId} 卸载 ⇒ 能力「${name}」回退到 ${selection(name).active}`, 'info')
        deps.onChange?.()
      }
    }
  }

  function setChoice(name: CapabilityName, pluginId: string | null) {
    const choices = readChoices()
    if (pluginId) choices[name] = pluginId
    else delete choices[name]
    writeChoices(choices)
    deps.onChange?.()
  }

  return {
    setDefault(name, impl) {
      entryOf(name).fallback = impl
    },
    scoped,
    release,
    invoke,
    selection,
    status,
    setChoice,
  }
}
