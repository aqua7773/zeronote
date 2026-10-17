/**
 * 文件操作域（剪贴板 / 回收站 / 删除 / 撤销）—— 从 `App.tsx` 原样迁出（rev123 · L3）。
 *
 * 为什么抽这一个先做：它只依赖 `kernel` + `refresh` + 几个 ref/setter，
 * 与文档域、插件域没有双向数据流 —— 是 L3 里风险最低的一块（方案见 `docs/App拆分方案-2026-10-18.md`）。
 *
 * ⚠️ 行为必须与迁出前**逐字一致**：
 *  - 删除：先落盘未保存改动 → 逐个 delete → 打开着的笔记/目录被删则清空编辑器 → 挂撤销条；
 *  - 彻底删除：delete → listTrash 按 originalPath 找 id → purge（不拿 delete 返回值当 id）；
 *  - 剪切：撞名报错、粘回原位静默跳过；复制：撞名自动退成「 副本」。
 */
import { useCallback, useEffect, useState, type MutableRefObject } from 'react'
import type { TrashEntry } from '../kernel/contract'
import type { Kernel } from '../kernel/kernel'
import type { SaveState } from '../lib/fail-msg'
import { failMsg } from '../lib/fail-msg'
import { fmtSize } from '../lib/format'

export type UseFileOpsArgs = {
  kernel: Kernel | null
  /** 库内文件变化后的统一刷新（App 的 `refresh`） */
  refresh: () => Promise<void>
  activeRef: MutableRefObject<string | null>
  dirtyRef: MutableRefObject<boolean>
  saveNowRef: MutableRefObject<() => Promise<void>>
  setActivePath: (p: string | null) => void
  setContent: (c: string) => void
  setDirty: (d: boolean) => void
  setSaveState: (s: SaveState) => void
  setError: (msg: string | null) => void
  setToast: (msg: string | null) => void
  setMainView: (view: string) => void
}

export type FileOps = {
  clipboard: { mode: 'cut' | 'copy'; paths: string[] } | null
  cutPaths: (paths: string[]) => void
  copyPaths: (paths: string[]) => void
  pasteInto: (dir: string) => Promise<void>
  duplicateEntry: (path: string) => Promise<void>
  trash: TrashEntry[]
  confirmPurge: string | null
  confirmEmpty: boolean
  setConfirmPurge: (id: string | null) => void
  setConfirmEmpty: (v: boolean) => void
  openTrash: () => void
  restoreTrashItem: (id: string) => Promise<void>
  purgeTrashItem: (id: string) => Promise<void>
  emptyTrashAll: () => Promise<void>
  deleteNotes: (paths: string[]) => Promise<void>
  purgeNotes: (paths: string[]) => Promise<void>
  undoDelete: { path: string; trash: string }[] | null
  undoDeleteNote: () => Promise<void>
  fmtSize: (n: number) => string
}

export function useFileOps({
  kernel,
  refresh,
  activeRef,
  dirtyRef,
  saveNowRef,
  setActivePath,
  setContent,
  setDirty,
  setSaveState,
  setError,
  setToast,
  setMainView,
}: UseFileOpsArgs): FileOps {
  /* ── 文件树的剪贴板：剪切 / 复制 / 粘贴 / 创建副本 ──
     状态放**应用级**而不是文件树内部：粘贴后要 refresh，剪切态在树重渲染之间要保持。 */
  const [clipboard, setClipboard] = useState<{ mode: 'cut' | 'copy'; paths: string[] } | null>(null)

  /** 最近一次删除（可能一次多篇），供撤销条在几秒内恢复（deleteNotes 与撤销条都要用，先于它们声明） */
  const [undoDelete, setUndoDelete] = useState<{ path: string; trash: string }[] | null>(null)

  const cutPaths = useCallback(
    (paths: string[]) => {
      if (!paths.length) return
      setClipboard({ mode: 'cut', paths })
      setToast(paths.length > 1 ? `已剪切 ${paths.length} 项` : '已剪切')
    },
    [setToast],
  )

  const copyPaths = useCallback(
    (paths: string[]) => {
      if (!paths.length) return
      setClipboard({ mode: 'copy', paths })
      setToast(paths.length > 1 ? `已复制 ${paths.length} 项` : '已复制')
    },
    [setToast],
  )

  /** 同目录下的不撞名副本名：`a.md` → `a 副本.md` → `a 副本 2.md`…（目录同理，不拆后缀） */
  const uniqueCopyTarget = useCallback(
    async (path: string): Promise<string> => {
      const k = kernel
      const slash = path.lastIndexOf('/')
      const dir = slash >= 0 ? path.slice(0, slash + 1) : ''
      const name = slash >= 0 ? path.slice(slash + 1) : path
      const ext = /\.(md|markdown)$/i.exec(name)?.[0] ?? ''
      const stem = ext ? name.slice(0, -ext.length) : name
      let cand = `${dir}${stem} 副本${ext}`
      let i = 2
      while (k && (await k.fs.exists(cand))) {
        cand = `${dir}${stem} 副本 ${i}${ext}`
        i += 1
      }
      return cand
    },
    [kernel],
  )

  /**
   * 粘贴到 `dir`（`''` = 库根）：剪切走 `move`、复制走 `copy`。
   * 撞名不是一律报错：**复制**自动退成「 副本」，**剪切**才报错（移动没有合理的改名策略）；
   * 粘回原位时剪切静默跳过（等价于什么都没做），复制则生成副本 —— 与资源管理器一致。
   */
  const pasteInto = useCallback(
    async (dir: string) => {
      const k = kernel
      if (!k || !clipboard?.paths.length) return
      const { mode, paths } = clipboard
      try {
        for (const p of paths) {
          const name = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p
          let target = dir ? `${dir}/${name}` : name
          if (target === p) {
            if (mode === 'cut') continue
            target = await uniqueCopyTarget(p)
          } else if (await k.fs.exists(target)) {
            if (mode === 'cut') throw new Error(`目标已存在，不覆盖：${target}`)
            target = await uniqueCopyTarget(target)
          }
          await (mode === 'cut' ? k.fs.move(p, target) : k.fs.copy(p, target))
        }
        if (mode === 'cut') setClipboard(null)
        await refresh()
        setError(null)
        setToast(mode === 'cut' ? '已移动' : '已粘贴')
      } catch (e) {
        // 中途失败：已经搬过去的那些要保持可见，先刷新再报错
        await refresh()
        setError(failMsg(mode === 'cut' ? 'rename' : 'create', e))
      }
    },
    [kernel, refresh, clipboard, uniqueCopyTarget, setError, setToast],
  )

  /** 创建副本（同目录 + 「 副本」）—— 文件与目录都支持（内核 `copy_entry` 是递归的） */
  const duplicateEntry = useCallback(
    async (path: string) => {
      const k = kernel
      if (!k) return
      try {
        const target = await uniqueCopyTarget(path)
        await k.fs.copy(path, target)
        await refresh()
        setError(null)
        setToast(`已创建副本：${target}`)
      } catch (e) {
        setError(failMsg('create', e))
      }
    },
    [kernel, refresh, uniqueCopyTarget, setError, setToast],
  )

  /* ── 回收站（主区整页视图）──
     删除一直是进 `.zn/trash/` 的，但此前**只有 5 秒撤销条**这一个入口，一过就够不到。
     这里给它一个常驻入口：侧栏底部 + 主区页面（列表 / 恢复 / 彻底删除 / 清空）。 */
  const [trash, setTrash] = useState<TrashEntry[]>([])
  /** 待二次确认的条目 id —— 「彻底删除」是不可撤销的，点两次才执行 */
  const [confirmPurge, setConfirmPurge] = useState<string | null>(null)
  /** 「清空回收站」同理，也是不可撤销的 */
  const [confirmEmpty, setConfirmEmpty] = useState(false)

  const loadTrash = useCallback(async () => {
    const k = kernel
    if (!k) return
    try {
      setTrash(await k.fs.listTrash())
      setError(null)
    } catch (e) {
      setError(failMsg('list', e))
    }
  }, [kernel, setError])

  /**
   * 打开回收站。**在入口处取数据，而不是在 effect 里**：
   * ① lint 的 `set-state-in-effect` 盯着这条（加载即 setState，等于用 effect 做事件的事）；
   * ② 语义上它本来就是个"打开这一页"的事件 —— 谁打开谁去取。
   */
  const openTrash = useCallback(() => {
    setMainView('trash')
    if (kernel) void loadTrash()
  }, [kernel, loadTrash, setMainView])

  const restoreTrashItem = useCallback(
    async (id: string) => {
      const k = kernel
      if (!k) return
      try {
        const back = await k.fs.restoreTrash(id)
        await loadTrash()
        await refresh()
        setError(null)
        setToast(`已恢复：${back}`)
      } catch (e) {
        setError(failMsg('rename', e))
      }
    },
    [kernel, loadTrash, refresh, setError, setToast],
  )

  const purgeTrashItem = useCallback(
    async (id: string) => {
      const k = kernel
      if (!k) return
      try {
        await k.fs.purgeTrash(id)
        setConfirmPurge(null)
        await loadTrash()
        setError(null)
        setToast('已彻底删除')
      } catch (e) {
        setError(failMsg('delete', e))
      }
    },
    [kernel, loadTrash, setConfirmPurge, setError, setToast],
  )

  const emptyTrashAll = useCallback(async () => {
    const k = kernel
    if (!k) return
    try {
      const n = await k.fs.emptyTrash()
      setConfirmEmpty(false)
      await loadTrash()
      setError(null)
      setToast(`已清空回收站（${n} 项）`)
    } catch (e) {
      setError(failMsg('delete', e))
    }
  }, [kernel, loadTrash, setConfirmEmpty, setError, setToast])

  /**
   * 删除笔记，**支持一次多篇**（笔记库栏的多选走这条）。
   * 删前先把未保存改动落盘，删掉的才是磁盘上的最新版本（Rust 侧是移入 .zn/trash/，不是物理删）。
   * 一步删掉 + 一次撤销机会、不弹确认框 —— 依据 Apple HIG：
   * 「常见且可撤销的破坏操作不该弹窗，只有不可逆的才必须确认」。
   */
  const deleteNotes = useCallback(
    async (paths: string[]) => {
      const k = kernel
      if (!k || !paths.length) return
      const done: { path: string; trash: string }[] = []
      try {
        if (paths.includes(activeRef.current ?? '') && dirtyRef.current) {
          await saveNowRef.current()
        }
        for (const path of paths) {
          done.push({ path, trash: await k.fs.delete(path) })
        }
        // 打开的笔记被删，或它**所在的目录**被删 ⇒ 编辑器必须清空，
        // 否则界面还留着一篇"磁盘上已经没有了"的笔记，下一次自动保存直接报错
        const cur = activeRef.current
        const gone = !!cur && paths.some((p) => cur === p || cur.startsWith(`${p}/`))
        if (gone) {
          setActivePath(null)
          setContent('')
          setDirty(false)
          setSaveState('idle')
        }
        await refresh()
        setError(null)
        setUndoDelete(done)
        setToast(null)
      } catch (e) {
        // 中途失败：前面几篇已经进回收站了，仍然把撤销条挂上，别让它们找不回来
        await refresh()
        if (done.length) setUndoDelete(done)
        setError(failMsg('delete', e))
      }
    },
    [kernel, refresh, activeRef, dirtyRef, saveNowRef, setActivePath, setContent, setDirty, setSaveState, setError, setToast],
  )

  /**
   * **彻底删除**（不可撤销）—— 内核没有"直接抹掉库内文件"的命令，所以是两步：
   * `delete` 移进回收站 → `listTrash` 按 `originalPath` 找回 id → `purgeTrash` 真删。
   *
   * ⚠️ **不能拿 `delete` 的返回值当 id**：它返回 `.zn/trash/<stamp>/<名>`（带斜杠），
   * 而 `purge_trash` 明确拒绝带斜杠的 id（`src-tauri/src/lib.rs:561`）。
   * 中途失败就停在"已在回收站"那一步 —— 文件还能找回来，不会直接丢。
   * ⚠️ 也不用 `emptyTrash`：那会把**用户之前删的**一并清掉，这里只该删本次选中的。
   */
  const purgeNotes = useCallback(
    async (paths: string[]) => {
      const k = kernel
      if (!k || !paths.length) return
      try {
        if (paths.includes(activeRef.current ?? '') && dirtyRef.current) {
          await saveNowRef.current()
        }
        for (const path of paths) await k.fs.delete(path)
        const list = await k.fs.listTrash()
        let purged = 0
        for (const path of paths) {
          const entry = list.find((t) => t.originalPath === path)
          if (!entry) continue
          await k.fs.purgeTrash(entry.id)
          purged++
        }
        const cur = activeRef.current
        if (cur && paths.some((p) => cur === p || cur.startsWith(`${p}/`))) {
          setActivePath(null)
          setContent('')
          setDirty(false)
          setSaveState('idle')
        }
        await refresh()
        setError(null)
        setUndoDelete(null) // 彻底删除**不给撤销条**（挂上会误导成"还能恢复"）
        const msg =
          purged === paths.length
            ? purged > 1
              ? `已彻底删除 ${purged} 项`
              : '已彻底删除'
            : `已删除 ${purged} / ${paths.length} 项，其余留在回收站`
        setToast(msg)
      } catch (e) {
        await refresh()
        setError(failMsg('delete', e))
      }
    },
    [kernel, refresh, activeRef, dirtyRef, saveNowRef, setActivePath, setContent, setDirty, setSaveState, setError, setToast],
  )

  /** 撤销删除：把回收站里的东西逐个恢复回原位 */
  const undoDeleteNote = useCallback(async () => {
    const k = kernel
    if (!k || !undoDelete) return
    try {
      for (const it of undoDelete) {
        /**
         * 走内核的 `restore_trash`，**不要用裸 rename**（2026-10-17 修）：
         * 回收站里存的是**整棵目录树**，而 Windows 上非空目录的 rename 会 ACCESS_DENIED
         * （见 `lib.rs` 的 `move_tree`）。`restore_trash` 已经带降级路径。
         * id 从回收站路径 `.zn/trash/<stamp>/<名字>` 的第二段取。
         */
        const m = /^\.zn\/trash\/([^/]+)\//.exec(it.trash)
        if (m) await k.fs.restoreTrash(m[1])
        else await k.fs.rename(it.trash, it.path) // 兜底：不认识的老形态
      }
      await refresh()
      setError(null)
      setToast(undoDelete.length > 1 ? `已恢复 ${undoDelete.length} 篇` : '已恢复')
    } catch (e) {
      setError(failMsg('rename', e))
    } finally {
      setUndoDelete(null)
    }
  }, [kernel, refresh, undoDelete, setError, setToast])

  // 撤销条 5 秒后自动消失
  useEffect(() => {
    if (!undoDelete) return
    const t = window.setTimeout(() => setUndoDelete(null), 5000)
    return () => window.clearTimeout(t)
  }, [undoDelete])

  return {
    clipboard,
    cutPaths,
    copyPaths,
    pasteInto,
    duplicateEntry,
    trash,
    confirmPurge,
    confirmEmpty,
    setConfirmPurge,
    setConfirmEmpty,
    openTrash,
    restoreTrashItem,
    purgeTrashItem,
    emptyTrashAll,
    deleteNotes,
    purgeNotes,
    undoDelete,
    undoDeleteNote,
    fmtSize,
  }
}
