/**
 * event 原语 —— 内核事件总线（契约 §1.4）
 *
 * 用途：
 *  - 内核向插件广播（app:ready / note:saved / vault:open …）
 *  - 插件之间通信（自定义 topic，建议带自身前缀）
 *
 * 一个插件抛异常**不能**影响其它订阅者 → 每个 handler 单独 try/catch。
 */
import type { Disposable, EventApi, KernelEvent } from './contract'

type Handler = (payload: unknown) => void

export type EventBus = EventApi & {
  /** 卸载插件时一次性清掉它的全部订阅 */
  disposeAll: (subs: Disposable[]) => void
  /**
   * 诊断用：topic → 当前订阅者数。**给内核审计出口用**（接管协议验收判据之一：
   * 卸载插件后订阅表要回到基线）——不暴露给插件，所以不在 `EventApi` 契约上。
   */
  stats: () => Record<string, number>
}

export function createEventApi(
  onHandlerError: (topic: string, err: unknown) => void = () => {},
): EventBus {
  const handlers = new Map<string, Set<Handler>>()

  return {
    on(topic: KernelEvent | string, cb: Handler): Disposable {
      let set = handlers.get(topic)
      if (!set) {
        set = new Set()
        handlers.set(topic, set)
      }
      set.add(cb)
      return {
        dispose: () => {
          set.delete(cb)
          if (set.size === 0) handlers.delete(topic)
        },
      }
    },

    emit(topic: string, payload: unknown): void {
      const set = handlers.get(topic)
      if (!set) return
      for (const h of [...set]) {
        try {
          h(payload)
        } catch (err) {
          onHandlerError(topic, err)
        }
      }
    },

    disposeAll(subs: Disposable[]): void {
      for (const s of subs) {
        try {
          s.dispose()
        } catch {
          /* 卸载时单个 dispose 失败不阻断其它 */
        }
      }
    },

    stats(): Record<string, number> {
      const out: Record<string, number> = {}
      for (const [topic, set] of handlers) out[topic] = set.size
      return out
    },
  }
}
