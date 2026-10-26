/**
 * 文档读写域（刷新 / 三方合并 / 保存 / 编辑器变更）—— 从 `App.tsx` 原样迁出（rev124 · L3 第二刀）。
 *
 * 覆盖：`refresh`（列表+目录）· `mergeWithDisk`（rev62 三方合并）· `mergeIntoEditor`（watch 回灌）·
 * `reloadActiveFromDisk`（整篇跟进）· `saveNow`（写盘前合并 + 原子写）· `onEditorChange`（800ms 自动保存
 * + 500ms 草稿快照 + `doc.on('change')` 去抖广播）· 四个兜底 flush effect（失焦/隐藏、关窗前落盘、
 * 页面卸载写草稿）。草稿（hot exit）见 `lib/draft-snapshot.ts` 与 `docs/数据与存储.md` §5。
 *
 * ⚠️ 行为必须与迁出前**逐字一致**：
 *  - 写盘顺序：先合并再写；落盘成功才广播 `save`；失败绝不显示「已保存」；
 *  - 外部重载引起的那次 onChange 不算用户编辑（`externalReloadRef` 闸门）；
 *  - 关窗前落盘：有未保存内容时拦截一次，落盘后 `close()`，`closingRef` 防死循环。
 *
 * 状态不在这里：`notes`/`content`/`activePath`/`dirty` 仍由 App 持有（它们是渲染来源），
 * 这里只接收 setter 与对应 ref（ref 是"事件里读最新值"的那份，见 App 顶部注释）。
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import type { DocEvent, NoteMeta } from '../kernel/contract'
import type { Kernel } from '../kernel/kernel'
import { decodeForOpen, encodeForSave, isTransientPath } from '../kernel/doc-codec'
import { failMsg, type SaveState } from '../lib/fail-msg'
import { clearDraftFor, saveDraft } from '../lib/draft-snapshot'
import { mergeLines } from '../lib/merge3'

/**
 * 草稿快照的节流窗口（rev173.65 · 会话恢复 / hot exit）。
 *
 * 为什么是 500ms：自动保存是停笔 800ms，取它的一半多一点 —— 崩溃正好卡在
 * 「已经敲了但还没到自动保存」那段，草稿能覆盖住；同时也避免每个按键都写 localStorage。
 */
const DRAFT_DEBOUNCE_MS = 500

/** `doc.on` 的广播入口（App 的 fireDoc —— 读 `docSubsRef`，插件回调逐个隔离） */
type FireDoc = (ev: DocEvent, path: string | null, content: string, dirty: boolean) => void

export type DocIORefs = {
  notesRef: MutableRefObject<NoteMeta[]>
  contentRef: MutableRefObject<string>
  activeRef: MutableRefObject<string | null>
  dirtyRef: MutableRefObject<boolean>
  baseRef: MutableRefObject<string>
  saveNowRef: MutableRefObject<() => Promise<void>>
  timerRef: MutableRefObject<number | null>
  docChangeTimerRef: MutableRefObject<number | null>
  docPendingRef: MutableRefObject<{ path: string; content: string } | null>
  externalReloadRef: MutableRefObject<boolean>
}

export type UseDocIOArgs = {
  kernel: Kernel | null
  fireDoc: FireDoc
  /** 兑现去抖窗口里挂起的 `change`（切笔记/关笔记前调用） */
  flushDocChange: () => void
  /** 有值时跳过「关窗前落盘」拦截（插件独立窗口不承载编辑器） */
  pluginWindowId: string | null
  refs: DocIORefs
  setNotes: (list: NoteMeta[]) => void
  setDirs: (dirs: string[]) => void
  setError: (msg: string | null) => void
  setContent: (c: string) => void
  setDirty: (d: boolean) => void
  setSaveState: (s: SaveState) => void
  setToast: (msg: string | null) => void
  autosaveMs: number
  docChangeDebounceMs: number
}

export type DocIO = {
  refresh: () => Promise<void>
  saveNow: () => Promise<void>
  reloadActiveFromDisk: () => Promise<boolean>
  onEditorChange: (next: string) => void
}

export function useDocIO({
  kernel,
  fireDoc,
  flushDocChange,
  pluginWindowId,
  refs,
  setNotes,
  setDirs,
  setError,
  setContent,
  setDirty,
  setSaveState,
  setToast,
  autosaveMs,
  docChangeDebounceMs,
}: UseDocIOArgs): DocIO {
  const {
    notesRef,
    contentRef,
    activeRef,
    dirtyRef,
    baseRef,
    saveNowRef,
    timerRef,
    docChangeTimerRef,
    docPendingRef,
    externalReloadRef,
  } = refs

  /**
   * 草稿快照的节流定时器（rev173.65 · 会话恢复）。
   * 放 hook 内部：它只是「500ms 后再写一次 localStorage」的技术细节，
   * 不参与渲染，也不该让 App 多背一个 ref。
   */
  const draftTimerRef = useRef<number | null>(null)

  const refresh = useCallback(async () => {
    if (!kernel) return
    try {
      const [list, dirList] = await Promise.all([kernel.fs.listNotes(), kernel.fs.listDirs()])
      setNotes(list)
      notesRef.current = list
      setDirs(dirList)
      setError(null)
    } catch (e) {
      setError(failMsg('list', e))
    }
  }, [kernel, notesRef, setNotes, setDirs, setError])

  /**
   * 把磁盘与编辑器**合并**（三方：`baseRef` / 编辑器内存 / 磁盘）。
   *
   * 这是 rev62「自动合并」的核心。为什么必须三方、而不是二选一：
   * 导图写盘与用户手改**各自改的可能不是同一块地方** —— 整篇覆盖任一方都会丢内容。
   * 规则与冲突策略见 `lib/merge3.ts`（冲突 ⇒ 保留编辑器那份：**手写优先**）。
   *
   * `applied` = 磁盘确实被外部改过、且已经算过合并；`merged` 是合并结果
   * （**可能等于 `contentRef.current`** —— 那表示外部改动全落在冲突区、被放弃了）。
   */
  const mergeWithDisk = useCallback(async () => {
    const k = kernel
    const path = activeRef.current
    if (!k || !path) return { ok: false as const }
    let theirs: string
    try {
      // 读盘后过一遍内容转换（rev173.180）：密文内容在合并前必须是明文，否则三方合并没意义
      theirs = await decodeForOpen(await k.fs.readText(path), path)
    } catch {
      return { ok: false as const }
    }
    const base = baseRef.current
    const mine = contentRef.current
    if (theirs === base) return { ok: true as const, applied: false as const } // 磁盘没动，不用合并
    if (theirs === mine) {
      baseRef.current = theirs // 磁盘和我们完全一样：把 base 对齐上去就好
      return { ok: true as const, applied: false as const }
    }
    const r = mergeLines(base, mine, theirs)
    // 诊断出口（CDP）：每次**真合并**留一条 —— 冲突几处、各方多长，界面上看不出来
    const w = window as unknown as { __znMergeLog?: unknown[] }
    const log = (w.__znMergeLog ??= [])
    log.push({
      at: new Date().toISOString().slice(11, 23),
      base: base.length,
      mine: mine.length,
      theirs: theirs.length,
      conflicts: r.conflicts,
    })
    if (log.length > 12) log.shift()
    return { ok: true as const, applied: true as const, merged: r.text, conflicts: r.conflicts }
  }, [kernel, activeRef, baseRef, contentRef])

  /**
   * 有手改时被 `fs.watch` 叫起来：**把外部改动合进编辑器**，而不是覆盖。
   *
   * 合完仍是"脏"的（结果还没落盘），那一步交给 800ms 的自动保存 ——
   * 而 `saveNow` **在写盘前还会再合并一次**（真正的防线在那边，watch 只是让画面早点跟上）。
   */
  const mergeIntoEditor = useCallback(async () => {
    const m = await mergeWithDisk()
    if (!m.ok || !m.applied) return
    if (m.conflicts) setToast(`已自动合并磁盘上的改动（${m.conflicts} 处冲突保留了你这边）`)
    if (m.merged !== undefined && m.merged !== contentRef.current) {
      externalReloadRef.current = true
      setContent(m.merged)
      setDirty(true) // 合并结果还没落盘
      setSaveState('idle')
    }
  }, [mergeWithDisk, contentRef, externalReloadRef, setToast, setContent, setDirty, setSaveState])

  const reloadActiveFromDisk = useCallback(async () => {
    const k = kernel
    const path = activeRef.current
    /**
     * 诊断出口（CDP / 排查"为什么不刷新"）：最近 12 次尝试与结果。
     * 起因：「磁盘变了但界面没动」这种静默失效只能靠读数定位 —— 是 watch 没来、
     * 内容被判成一样、还是读了盘失败，三种原因从界面上一模一样。
     */
    const trace = (why: string) => {
      const w = window as unknown as { __znReloadLog?: unknown[] }
      const log = (w.__znReloadLog ??= [])
      log.push({ at: new Date().toISOString().slice(11, 23), why, path })
      if (log.length > 12) log.shift()
    }
    if (!k || !path) return false
    let text: string
    try {
      // 外部重载同样过内容转换（rev173.180）：磁盘上是密文时先解密再比较
      text = await decodeForOpen(await k.fs.readText(path), path)
    } catch {
      trace('read-fail')
      return false // 文件被删/读不了/解密失败：**不动编辑器**（免得把用户的文档清空）
    }
    if (text === contentRef.current) {
      trace('same')
      return false
    }
    trace('reloaded')
    baseRef.current = text // 整篇替换过 ⇒ 内存与磁盘又一致了
    externalReloadRef.current = true // 接下来那次 onChange 是本次替换的副产物，不算用户编辑
    setContent(text)
    setDirty(false)
    setSaveState('idle')
    setError(null)
    // 广播 open：插件（大纲 / 导图）跟着重读，否则它们手里还是旧内容
    fireDoc('open', path, text, false)
    return true
  }, [kernel, fireDoc, activeRef, contentRef, baseRef, externalReloadRef, setContent, setDirty, setSaveState, setError])

  useEffect(() => {
    if (!kernel) return
    void refresh()
    const sub = kernel.fs.watch(() => {
      void refresh()
      /**
       * 磁盘变了，分两条路（rev61 / rev62）：
       *   · **没有未保存手改** ⇒ 整篇跟上（"导图写回 → 笔记立刻可见"的主路径）；
       *   · **有手改** ⇒ 走三方合并，把外部改动**并进来**，而不是覆盖（用户在打字，手写优先）。
       *
       * ⚠️ watch 只是"让画面早点跟上"；**真正的防线在 `saveNow`** 里写盘前那次合并 ——
       * 实测 watch 会迟到好几秒，那时 800ms 的自动保存早就把插件写的内容盖掉了。
       */
      if (dirtyRef.current) void mergeIntoEditor()
      else void reloadActiveFromDisk()
    })
    return () => sub.dispose()
  }, [kernel, refresh, reloadActiveFromDisk, mergeIntoEditor, dirtyRef])

  /* ── 保存：原子写，失败绝不显示「已保存」── */
  const saveNow = useCallback(async () => {
    const k = kernel
    const path = activeRef.current
    if (!k || !path) return
    setSaveState('saving')
    try {
      /**
       * **写盘之前先合并** —— 自动合并真正生效的地方。
       *
       * 不能只靠 `fs.watch`：实测它会迟到好几秒，而这里 800ms 就落盘，
       * 那一下会把插件刚写进磁盘的内容**整篇盖掉**（这正是"改了没回传"的另一面：
       * 反过来也会发生 —— 用户的自动保存把导图的改动抹了）。
       * 合并之后写的是"两边改动都在"的那一份，磁盘与内存重新一致。
       */
      const m = await mergeWithDisk()
      let text = contentRef.current
      if (m.ok && m.applied && m.merged !== undefined) {
        text = m.merged
        if (m.conflicts) setToast(`保存前已与磁盘合并（${m.conflicts} 处冲突保留了你这边）`)
        if (text !== contentRef.current) {
          externalReloadRef.current = true
          setContent(text)
        }
      }
      // 写盘前过一遍内容转换（rev173.180）：密文落盘的笔记在这里加密。
      // encode 抛错（例如插件已锁定 / 转换器被卸载）⇒ 整次保存失败，原子写不留半截。
      await k.fs.writeText(path, await encodeForSave(text, path))
      baseRef.current = text
      setDirty(false)
      setSaveState('saved')
      setError(null)
      // 落盘成功才广播 —— 失败时插件不该以为内容安全了（与"失败绝不显示已保存"同一原则）
      fireDoc('save', path, text, false)
      /**
       * 会话恢复（rev173.65）：这篇已经真正落盘 ⇒ 清掉它的草稿，并撤掉还挂着的
       * 500ms 写入（Ctrl+S / 关窗 / 切篇可能在节流窗口内先到）。
       *
       * 这是「正常退出不弹恢复」的**唯一保证**：saveNow 成功过一次，就不再是"未保存内容"；
       * 关窗前 flush 走的也是这里，所以正常关窗同样覆盖。失败分支**不清** ——
       * 草稿留着，下次启动还能恢复（与"失败绝不显示已保存"同一原则）。
       */
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current)
        draftTimerRef.current = null
      }
      clearDraftFor(path)
    } catch (e) {
      setSaveState('error')
      setError(failMsg('write', e))
    }
  }, [kernel, fireDoc, mergeWithDisk, activeRef, contentRef, baseRef, externalReloadRef, setSaveState, setDirty, setError, setContent, setToast, draftTimerRef])

  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow, saveNowRef])

  /**
   * 兜底 flush 之一：**失焦 / 页面隐藏**立即落盘。
   *
   * 除了「停止输入 800ms」自动保存之外再补这两道 —— 对应 VS Code 的
   * onFocusChange / onWindowChange 语义：自动保存产品最怕「已经切走了还没写盘」。
   */
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) void saveNowRef.current()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('blur', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', flush)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [dirtyRef, saveNowRef])

  /**
   * 兜底 flush 之二：**关窗前**先落盘再放行。
   *
   * 有个未保存内容就拦一次关闭：写盘完成后调 `close()`，第二次进来直接放行
   * （`closingRef` 做闸门），避免死循环；也不用申请 `window:allow-destroy` 权限。
   */
  const closingRef = useRef(false)
  useEffect(() => {
    /**
     * 插件独立窗口**跳过这层"关窗前落盘"**：它不承载编辑器、没有未保存内容要兜底。
     * （原因与「必须有一个 close 监听器」的细节见 App 里那个极简监听器。）
     */
    if (pluginWindowId) return
    let unlisten: (() => void) | null = null
    let disposed = false
    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const fn = await win.onCloseRequested(async (e) => {
          // 卡死兜底 C 段：正常关窗 ⇒ 清掉"正在加载"标记。
          // 否则"加载途中用户自己关窗"会留下标记，下次启动就被误判成卡死（白误伤一个插件）。
          try {
            localStorage.removeItem('zeronote.plugins.loading')
          } catch {
            /* 无所谓 */
          }
          if (closingRef.current) return // 上一次关闭请求已经处理过：放行
          /**
           * 从这里开始 = **正常退出**。先立标记：
           *  · 紧接着 saveNow 成功后 `close()` 会再发一次 close-requested，靠它直接放行；
           *  · `beforeunload` 的草稿 flush 看到它就不再写 —— 否则 saveNow 清键之后
           *    又被写回一份，下次启动会误弹「恢复」（rev173.65 会话恢复的坑①）。
           */
          closingRef.current = true
          if (!dirtyRef.current) {
            // 已经落盘：顺手清掉可能还属于这篇的草稿（正常退出不留恢复提示）
            clearDraftFor(activeRef.current)
            return // 放行
          }
          e.preventDefault()
          /**
           * 关窗前先同步落一份草稿：saveNow 成功会清掉（正常退出不留），
           * 失败则它就是最后一次保护 —— 否则「Ctrl+S 之后写盘失败再关窗」会两头落空。
           */
          const p = activeRef.current
          // 内容敏感（私密笔记）：关窗前也不落草稿 —— 同上，草稿是明文
          if (p && !isTransientPath(p)) saveDraft(p, contentRef.current)
          try {
            await saveNowRef.current()
          } finally {
            await win.close()
          }
        })
        if (disposed) fn()
        else unlisten = fn
      } catch {
        /* 非 Tauri 环境（浏览器预览）没有这个 API —— 忽略即可 */
      }
    })()
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [pluginWindowId, dirtyRef, activeRef, contentRef, saveNowRef, closingRef])

  /**
   * 会话恢复（hot exit）兜底：**页面卸载前**把最后一次未落盘内容写进草稿（rev173.65）。
   *
   * 500ms 节流可能刚好被 HMR 整页重载撞上（reload 不触发 blur / visibilitychange，
   * 800ms 自动保存还没到）—— 这里同步写 localStorage，来不及 await。
   * `closingRef` 为真表示这是**正常关窗**（saveNow 已经跑过 / 正在跑）：不再写，
   * 否则会在清键之后又写回一份，导致下次启动误弹恢复（坑①）。
   */
  useEffect(() => {
    const flush = () => {
      if (closingRef.current || !dirtyRef.current) return
      const p = activeRef.current
      // 内容敏感（私密笔记）：页面卸载前也不落草稿 —— 草稿是 localStorage 明文
      if (p && !isTransientPath(p)) saveDraft(p, contentRef.current)
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current)
        draftTimerRef.current = null
      }
    }
  }, [closingRef, dirtyRef, activeRef, contentRef, draftTimerRef])

  const onEditorChange = useCallback(
    (next: string) => {
      // 外部重载引起的那一次回调：文档已经被我们替换过了，不算用户编辑
      // （见 `externalReloadRef` 的注释 —— 不拦就会白闪一次"未保存"、再把同样内容写一遍）
      if (externalReloadRef.current) {
        externalReloadRef.current = false
        return
      }
      setContent(next)
      setDirty(true)
      setSaveState('idle')
      if (timerRef.current) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => void saveNowRef.current(), autosaveMs)
      /**
       * 会话恢复（rev173.65）：~500ms 后把「还没落盘的手改」写进 localStorage 草稿。
       *
       * 只留最新一篇（后一次覆盖前一次）。定时器触发时**再校验一次**：
       * 这段里可能已经切篇（`activeRef` 变了 —— 不校验就会把旧内容挂到新篇名下）、
       * 关笔记，或 saveNow 先成功了（后者会清键并撤掉定时器）。
       */
      const editPath = activeRef.current
      if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current)
      draftTimerRef.current = window.setTimeout(() => {
        draftTimerRef.current = null
        if (!editPath || activeRef.current !== editPath || !dirtyRef.current) return
        // 内容敏感（私密笔记 / 密码库）：**不落草稿** —— 草稿是 localStorage 明文
        if (isTransientPath(editPath)) return
        saveDraft(editPath, contentRef.current)
      }, DRAFT_DEBOUNCE_MS)
      /**
       * `doc.on('change')` 广播（U3b）—— trailing 去抖，与上面 800ms 的自动保存**互相独立**：
       * change 先到（插件看到新内容）、save 后到（内容已落盘），顺序稳定。
       * `activeRef.current` 为空时（没打开笔记）不广播 —— 没有"哪篇"可言。
       */
      const path = activeRef.current
      if (path) {
        docPendingRef.current = { path, content: next }
        if (docChangeTimerRef.current !== null) window.clearTimeout(docChangeTimerRef.current)
        docChangeTimerRef.current = window.setTimeout(() => {
          docChangeTimerRef.current = null
          flushDocChange()
        }, docChangeDebounceMs)
      }
    },
    [
      externalReloadRef,
      setContent,
      setDirty,
      setSaveState,
      timerRef,
      saveNowRef,
      autosaveMs,
      activeRef,
      dirtyRef,
      contentRef,
      draftTimerRef,
      docPendingRef,
      docChangeTimerRef,
      flushDocChange,
      docChangeDebounceMs,
    ],
  )

  return { refresh, saveNow, reloadActiveFromDisk, onEditorChange }
}
