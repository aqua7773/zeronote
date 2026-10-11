/**
 * command 原语 —— 命令 / 快捷键 / 命令面板（契约 §2.1）
 *
 * 规则（契约里写死的）：
 *  - 命令 id **必须带命名空间前缀**（`inspiration-flow.capture`）—— 防止插件互相覆盖
 *  - id 重复 → 抛错，让插件作者立刻发现冲突
 *  - 卸载插件 → 它的命令全消失（dispose 由宿主在插件卸载时统一调用）
 */
import type { CommandApi, CommandSpec, Disposable } from './contract'

export type CommandRegistry = {
  api: CommandApi
  /** 命令面板用：按标题/ID 模糊筛选 */
  search(query: string): { id: string; title: string }[]
  /** 全部命令（含快捷键声明），快捷键绑定用 */
  all(): CommandSpec[]
}

export function createCommandApi(
  onError: (id: string, err: unknown) => void = () => {},
): CommandRegistry {
  const registry = new Map<string, CommandSpec>()

  const api: CommandApi = {
    register(cmd: CommandSpec): Disposable {
      if (!cmd.id.includes('.')) {
        throw new Error(`命令 id 必须带命名空间前缀（如 plugin-id.command）：${cmd.id}`)
      }
      if (registry.has(cmd.id)) {
        throw new Error(`命令 id 重复：${cmd.id}`)
      }
      registry.set(cmd.id, cmd)
      return {
        dispose: () => {
          registry.delete(cmd.id)
        },
      }
    },

    async execute(id: string, ...args: unknown[]): Promise<unknown> {
      const cmd = registry.get(id)
      if (!cmd) throw new Error(`命令不存在：${id}`)
      try {
        return await cmd.run(...args)
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
      return [...registry.values()]
    },
  }
}
