/**
 * 命令快捷键派发器。
 *
 * **解决的问题**：`command.register({ keybinding })` 里声明的快捷键**此前从未生效** ——
 * App.tsx 只有一个手写的 keydown 处理器（Ctrl+K / Escape），插件与内核声明的键位
 * 全部被静默忽略（`hotkeys-js` 躺在 package.json 里，src 里 0 处使用）。
 *
 * 键位格式按契约写 VS Code 风格（`Mod+Shift+K`）：
 *   Mod = Ctrl（Windows/Android）/ Command（macOS）
 */
import hotkeys from 'hotkeys-js'
import type { CommandRegistry } from './command'

const IS_MAC = /Mac|iPhone|iPad/i.test(
  typeof navigator === 'undefined' ? '' : navigator.userAgent,
)

/** `Mod+Shift+K` → hotkeys-js 的 `ctrl+shift+k` */
export function toHotkeysSpec(keybinding: string): string {
  return keybinding
    .split('+')
    .map((part) => {
      const p = part.trim().toLowerCase()
      if (p === 'mod') return IS_MAC ? 'command' : 'ctrl'
      if (p === 'cmd' || p === 'command') return 'command'
      if (p === 'control') return 'ctrl'
      if (p === 'option') return 'alt'
      return p
    })
    .join('+')
}

/**
 * 把命令注册表里所有已声明 keybinding 的命令绑到键盘。返回解绑函数。
 *
 * 调用方应在「命令表可能变化」时重建（插件装卸会增删命令），所以返回的
 * 解绑函数必须被 effect 的 cleanup 调用，否则会残留幽灵绑定。
 */
export function bindCommandKeybindings(registry: CommandRegistry): () => void {
  // hotkeys-js 默认在 input/textarea/contenteditable 内不触发；
  // 保存、命令面板、搜索这些需要全局可用，所以放开过滤。
  hotkeys.filter = () => true

  const bound: string[] = []
  for (const cmd of registry.all()) {
    if (!cmd.keybinding) continue
    const spec = toHotkeysSpec(cmd.keybinding)
    hotkeys(spec, (e) => {
      e.preventDefault()
      void registry.api.execute(cmd.id)
    })
    bound.push(spec)
  }

  return () => {
    for (const spec of bound) hotkeys.unbind(spec)
  }
}
