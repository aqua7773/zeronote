/**
 * fs 原语的前端实现 —— 全部落到 Rust 侧命令（写操作在 Rust 里保证原子）。
 * 对应 `docs\内核契约-v0.1.md` §1.1
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Disposable, FsApi, FsChange, NoteMeta } from './contract'

export function createFsApi(vault: string): FsApi {
  return {
    vaultPath: () => vault,

    listNotes: (dir?: string) =>
      invoke<NoteMeta[]>('list_notes', { vault, dir: dir ?? null }),

    readText: (path: string) =>
      invoke<string>('read_note', { vault, path }),

    /** 原子写：Rust 侧写临时文件再 rename，失败不动原文件 */
    writeText: (path: string, content: string) =>
      invoke<void>('write_note', { vault, path, content }),

    createNote: (path: string, content = '') =>
      invoke<void>('create_note', { vault, path, content }),

    rename: (from: string, to: string) =>
      invoke<void>('rename_note', { vault, from, to }),

    /** 移入 `.zn/trash/`，返回**回收站里的库内相对路径**（供撤销 rename 回来） */
    delete: (path: string) =>
      invoke<string>('delete_note', { vault, path }),

    exists: (path: string) =>
      invoke<boolean>('note_exists', { vault, path }),

    /**
     * v0.1 用 Rust 侧 fs 监听（notify crate）通过 Tauri event 上报；
     * 监听不可用时自动退化为 3 秒轮询比对文件清单。
     */
    watch: (cb: (e: FsChange) => void): Disposable => {
      let disposed = false
      let unlisten: (() => void) | null = null

      listen<FsChange>('zn://fs-change', (ev) => {
        if (!disposed) cb(ev.payload)
      })
        .then((fn) => {
          if (disposed) fn()
          else unlisten = fn
        })
        .catch(() => {
          /* 事件通道不可用 —— 轮询兜底 */
        })

      // 轮询兜底：比对清单，发现差异即上报
      let last = new Map<string, number>()
      const poll = window.setInterval(async () => {
        if (disposed) return
        try {
          const notes = await invoke<NoteMeta[]>('list_notes', { vault, dir: null })
          const now = new Map(notes.map((n) => [n.path, n.mtime]))
          for (const [path, mtime] of now) {
            const prev = last.get(path)
            if (prev === undefined) cb({ kind: 'create', path })
            else if (prev !== mtime) cb({ kind: 'modify', path })
          }
          for (const path of last.keys()) if (!now.has(path)) cb({ kind: 'delete', path })
          last = now
        } catch {
          /* 库不可用（被移动/删除）时静默，下一轮再试 */
        }
      }, 3000)

      return {
        dispose: () => {
          disposed = true
          window.clearInterval(poll)
          unlisten?.()
        },
      }
    },
  }
}
