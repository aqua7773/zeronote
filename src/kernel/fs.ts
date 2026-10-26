/**
 * fs 原语的前端实现 —— 全部落到 Rust 侧命令（写操作在 Rust 里保证原子）。
 * 对应 `docs\内核契约-v0.1.md` §1.1
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { Disposable, FsApi, FsChange, NoteMeta, TrashEntry } from './contract'
import { base64ToBytes, bytesToBase64 } from './base64-codec'

export function createFsApi(
  vault: string,
  onWatchError?: (err: unknown) => void,
): FsApi {
  return {
    vaultPath: () => vault,

    listNotes: (dir?: string) =>
      invoke<NoteMeta[]>('list_notes', { vault, dir: dir ?? null }),

    /** 目录清单（含空目录）—— 文件树显示空文件夹的依据 */
    listDirs: () => invoke<string[]>('list_dirs', { vault }),

    /**
     * 某个子目录下的**文件清单**（库内相对路径、不递归）。
     * 与 `listDirs` / `listNotes` 不同：**不跳过 `.zn`** —— 历史版本快照就在 `<库>/.zn/history/`。
     */
    listFiles: (dir?: string) =>
      invoke<string[]>('list_files', { vault, dir: dir ?? null }),

    /** **真删除**（不进回收站），只允许 `.zn/` 下的路径 —— 历史版本精简旧快照用 */
    purgePrivate: (path: string) =>
      invoke<void>('purge_private', { vault, path }),

    /** 真删除一份旧备份目录（整棵树）—— 只认 `.zn/backups/` 下的一级名字，rev173.175 */
    purgeBackup: (name: string) =>
      invoke<void>('purge_backup', { vault, name }),

    readText: (path: string) =>
      invoke<string>('read_note', { vault, path }),

    /** 原子写：Rust 侧写临时文件再 rename，失败不动原文件 */
    writeText: (path: string, content: string) =>
      invoke<void>('write_note', { vault, path, content }),

    /** 读二进制（附件 / 图片 / PDF）—— base64 过桥，rev173.106 */
    readBytes: async (path: string): Promise<Uint8Array> => {
      const b64 = await invoke<string>('read_note_bytes', { vault, path })
      return base64ToBytes(b64)
    },

    /** 写二进制（原子写，与 writeText 同一套）—— rev173.106 */
    writeBytes: (path: string, data: Uint8Array) =>
      invoke<void>('write_note_bytes', { vault, path, base64: bytesToBase64(data) }),

    createNote: (path: string, content = '') =>
      invoke<void>('create_note', { vault, path, content }),

    rename: (from: string, to: string) =>
      invoke<void>('rename_note', { vault, from, to }),

    /** 多级建目录（幂等）—— 文件夹功能的基础 */
    mkdir: (path: string) => invoke<void>('create_dir', { vault, path }),

    /** 移动 / 重命名文件或**整个目录树**（mv 语义：`to` 是已存在目录时移入其中） */
    move: (from: string, to: string) => invoke<void>('move_entry', { vault, from, to }),

    /** 复制文件或整个目录树（跳过 .zn 等私有目录；目标已存在则报错不覆盖） */
    copy: (from: string, to: string) => invoke<void>('copy_entry', { vault, from, to }),

    /** 移入 `.zn/trash/`，返回**回收站里的库内相对路径**（供撤销 rename 回来） */
    delete: (path: string) =>
      invoke<string>('delete_note', { vault, path }),

    exists: (path: string) =>
      invoke<boolean>('note_exists', { vault, path }),

    /** 回收站列表（含旧格式的扁平条目） */
    listTrash: () => invoke<TrashEntry[]>('list_trash', { vault }),

    /** 恢复一项，返回恢复到的库内相对路径 */
    restoreTrash: (id: string) => invoke<string>('restore_trash', { vault, id }),

    /** 真删除一项 —— 不可撤销 */
    purgeTrash: (id: string) => invoke<void>('purge_trash', { vault, id }),

    /** 清空回收站，返回清掉的条目数 */
    emptyTrash: () => invoke<number>('empty_trash', { vault }),

    /**
     * v0.1 用 Rust 侧 fs 监听（notify crate）通过 Tauri event 上报；
     * 监听不可用时自动退化为 3 秒轮询比对文件清单。
     */
    watch: (cb: (e: FsChange) => void): Disposable => {
      let disposed = false
      let unlisten: (() => void) | null = null

      /**
       * 插件的 watch 回调抛错，不能掀掉内核的监听通道 ——
       * 与 event 总线同一条规矩：每个回调单独兜底。
       * （Tauri 事件分发与轮询定时器都在内核这一侧，一次未捕获异常就可能让后续
       *   通知全断，而插件作者写错一个字段名是最常见的事。）
       */
      const safeCb = (e: FsChange) => {
        try {
          cb(e)
        } catch (err) {
          if (onWatchError) onWatchError(err)
          else console.warn('[zn] fs.watch 回调抛错（已忽略，不影响其它监听）', err)
        }
      }

      let watched = false

      listen<FsChange>('zn://fs-change', (ev) => {
        if (!disposed) safeCb(ev.payload)
      })
        .then(async (fn) => {
          if (disposed) {
            fn()
            return
          }
          unlisten = fn
          /*
           * rev173.59：**事件通道可用 ≠ 有人在发事件**。
           * `listen` 对任何事件名都会订阅成功；此前这里一成功就 `stopPoll()`，而 Rust 侧
           * 根本没人发 `zn://fs-change` ⇒ 事件永远不来、轮询又被关掉，外部改动完全不刷新（P0）。
           * 现在改成「让 Rust 真把 watcher 起起来」才算数：
           *   · 起成功 ⇒ 停轮询（桌面：接到真实事件后几乎立刻刷新）；
           *   · 起失败（移动端 / 库不存在 / 系统 watcher 不可用）⇒ 保留 3 秒轮询兜底。
           */
          try {
            await invoke<void>('watch_vault', { vault })
            watched = true
            if (disposed) {
              // 等 IPC 期间订阅被销毁 ⇒ 立刻退订，别把 watcher 留给一个没人听的库
              watched = false
              void invoke('unwatch_vault', { vault }).catch(() => {})
              return
            }
            // P2-5：事件通道真的可用 ⇒ 关掉轮询（它每个订阅者一条、3 秒一次全库 list_notes）
            stopPoll()
          } catch (e) {
            if (onWatchError) onWatchError(e)
            else console.warn('[zn] 系统文件监听不可用，改用 3 秒轮询兜底', e)
            if (!disposed) startPoll()
          }
        })
        .catch(() => {
          // Tauri 事件系统本身不可用（非预期）⇒ 轮询兜底
          startPoll()
        })

      // 轮询兜底（**只在事件通道不可用时启动**）：比对清单，发现差异即上报
      let last = new Map<string, number>()
      let poll: number | null = null
      const pollOnce = async () => {
        if (disposed) return
        try {
          const notes = await invoke<NoteMeta[]>('list_notes', { vault, dir: null })
          const now = new Map(notes.map((n) => [n.path, n.mtime]))
          for (const [path, mtime] of now) {
            const prev = last.get(path)
            if (prev === undefined) safeCb({ kind: 'create', path })
            else if (prev !== mtime) safeCb({ kind: 'modify', path })
          }
          for (const path of last.keys()) if (!now.has(path)) safeCb({ kind: 'delete', path })
          last = now
        } catch {
          /* 库不可用（被移动/删除）时静默，下一轮再试 */
        }
      }

      const startPoll = () => {
        if (poll !== null || disposed) return
        poll = window.setInterval(() => {
          void pollOnce()
        }, 3000)
      }
      const stopPoll = () => {
        if (poll !== null) {
          window.clearInterval(poll)
          poll = null
        }
      }

      return {
        dispose: () => {
          disposed = true
          stopPoll()
          unlisten?.()
          // 引用计数 -1（主窗口 + note-* 窗口可能共享同一个库的 watcher）；
          // 失败无声：进程退出时 Rust 侧状态一并释放
          if (watched) {
            watched = false
            void invoke('unwatch_vault', { vault }).catch(() => {})
          }
        },
      }
    },
  }
}
