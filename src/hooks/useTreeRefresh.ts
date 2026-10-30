/**
 * 内核写盘事件 → 文件树刷新（rev173.283 · 真人测试二 #1）。
 *
 * ## 修的是什么
 *
 * 真机现场（release）：手机写进来的几篇笔记，桌面端"同步显示已成功"，但文件树一篇都看不到；
 * 用户在桌面端新建一篇，那几篇才一起冒出来。
 *
 * 根因**不在同步插件** —— 文件真落盘了、搜索索引也更新了，断的是**刷新触发**：
 * 桌面端 Rust watcher 对"本进程写过的路径"有 1.5 秒静默窗口
 * （`SELF_WRITE_SILENCE_MS`，为了不让每次自动保存都触发全库扫描）⇒ `fs.watch` 那条刷新路径
 * 收不到「同步刚写进来几个文件」。手机上更直接：`watch_vault` 明确返回错误、走 3 秒轮询，
 * 本来就不该指望它。一次多文件同步（十篇）在轮询下也要 3 秒才可能被发现，而实际
 * `listNotes` 的差异判定是逐条 mtime —— 同步插件写的文件 mtime 会被下一次写入刷新，
 * 但**新建**的路径只有轮询那一轮才可能撞上。
 *
 * ## 为什么听内核事件而不是改 watcher
 *
 * 内核在**写盘成功后**一定会发事件（`src/kernel/fs-events.ts` 的包装层），与平台 watcher
 * 无关：插件写 ⇒ `note:changed`（`origin: 'plugin'`）、新建 ⇒ `note:created`、
 * 改名 ⇒ `note:renamed`、删除 ⇒ `note:deleted`。所以这里订阅的是**事实**，不是猜测。
 *
 * `note:saved` 刻意**不在**订阅列表里：那是用户改正文，库里还是那几篇，列表不需要重扫 ——
 * 否则每次自动保存（800ms 一次）都来一次全库 `list_notes` + `list_dirs`。
 *
 * 去抖 150ms：一轮同步拉十篇只扫一次。
 */
import { useEffect } from 'react'
import type { Kernel } from '../kernel/kernel'

/** 连续写盘事件的合并窗口（毫秒） */
export const TREE_REFRESH_DEBOUNCE_MS = 150

/** 「库里有哪几篇 / 哪几个目录」可能变了的事件（`note:saved` 不算） */
export const TREE_REFRESH_TOPICS = [
  'note:created',
  'note:changed',
  'note:renamed',
  'note:deleted',
] as const

/**
 * @param kernel 内核（换库时重建）
 * @param refresh 重新拉 `listNotes` / `listDirs` 的那个函数（useDocIO 的 refresh）
 */
export function useTreeRefresh(kernel: Kernel | null, refresh: () => void | Promise<void>): void {
  useEffect(() => {
    if (!kernel) return
    let timer: number | null = null
    const bump = () => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        void refresh()
      }, TREE_REFRESH_DEBOUNCE_MS)
    }
    const subs = TREE_REFRESH_TOPICS.map((t) => kernel.event.on(t, bump))
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      for (const s of subs) s.dispose()
    }
  }, [kernel, refresh])
}
