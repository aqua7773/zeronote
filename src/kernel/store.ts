/**
 * store 原语 —— 插件自己的持久化（契约 §2.3）
 *
 * 落盘位置：`<库>/.zn/plugins/<pluginId>/store.json`（不进文件树、不进 git）
 * 读取带内存缓存，写入立刻落盘。
 */
import { invoke } from '@tauri-apps/api/core'
import type { StoreApi } from './contract'

export function createStoreApi(vault: string, pluginId: string): StoreApi {
  let cache: Record<string, unknown> | null = null

  const load = async (): Promise<Record<string, unknown>> => {
    if (!cache) {
      cache = await invoke<Record<string, unknown>>('plugin_store_read', { vault, pluginId })
    }
    return cache
  }

  const flush = async (): Promise<void> => {
    await invoke<void>('plugin_store_write', {
      vault,
      pluginId,
      data: cache ?? {},
    })
  }

  return {
    async get<T>(key: string, def?: T): Promise<T> {
      const c = await load()
      return (key in c ? (c[key] as T) : (def as T))
    },
    async set(key: string, value: unknown): Promise<void> {
      const c = await load()
      c[key] = value
      await flush()
    },
    async delete(key: string): Promise<void> {
      const c = await load()
      delete c[key]
      await flush()
    },
    async all(): Promise<Record<string, unknown>> {
      return { ...(await load()) }
    },
  }
}
