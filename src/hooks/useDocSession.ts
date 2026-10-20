/**
 * 文档会话（打开 / `[[链接]]` 跳转 / 关闭）—— 从 `App.tsx` 原样迁出（rev125 · L3 第三刀）。
 *
 * 与 `useDocIO`（读写/合并/保存）的分工：这里只管「哪篇文档是当前打开的」这件事的切换，
 * 不碰保存与合并 —— 但切换前会用 `saveNowRef` 落盘（与迁出前同一套语义）。
 */
import { useCallback, useEffect, type MutableRefObject } from 'react'
import type { DocEvent, NoteMeta } from '../kernel/contract'
import type { Kernel } from '../kernel/kernel'
import { failMsg } from '../lib/fail-msg'

/** `doc.on` 的广播入口（App 的 fireDoc） */
type FireDoc = (ev: DocEvent, path: string | null, content: string, dirty: boolean) => void

export type DocSessionRefs = {
  activeRef: MutableRefObject<string | null>
  contentRef: MutableRefObject<string>
  dirtyRef: MutableRefObject<boolean>
  baseRef: MutableRefObject<string>
  frontmatterRef: MutableRefObject<Record<string, unknown>>
  notesRef: MutableRefObject<NoteMeta[]>
  saveNowRef: MutableRefObject<() => Promise<void>>
  openNoteRef: MutableRefObject<(p: string) => Promise<void>>
}

export type UseDocSessionArgs = {
  kernel: Kernel | null
  notes: NoteMeta[]
  fireDoc: FireDoc
  /** 兑现去抖窗口里挂起的 `change`（切笔记前调用） */
  flushDocChange: () => void
  refs: DocSessionRefs
  setActivePath: (p: string | null) => void
  setContent: (c: string) => void
  setDirty: (d: boolean) => void
  setSaveState: (s: 'idle' | 'saving' | 'saved' | 'error') => void
  setError: (msg: string | null) => void
  setToast: (msg: string | null) => void
  /** 窄屏：选完笔记自动收抽屉 */
  setSidebarOpen: (open: boolean) => void
  /**
   * 一篇文档**真正打开成功后**通知宿主（rev173.50 · 多标签页）。
   *
   * 为什么挂在这里而不是让宿主监听 `activePath`：标签页要的是「打开过哪些」，
   * 只能从"打开"这个动作得到 —— 用 effect 盯 `activePath` 会在改名 / 删库这类
   * 路径变化上误判，也会踩 lint 的 `set-state-in-effect`。`openNote` 是唯一入口
   * （文件树 / 起始页 / `[[链接]]` / 外部文件 / 命令全走它），在这里登记最全。
   */
  onOpened?: (path: string) => void
}

export type DocSession = {
  openNote: (path: string) => Promise<void>
  openWikiLink: (target: string) => void
  closeNote: () => Promise<void>
  /** 不落盘的关闭 —— 文件已经被删掉时用（见实现处的注释） */
  discardNote: () => Promise<void>
}

export function useDocSession({
  kernel,
  notes,
  fireDoc,
  flushDocChange,
  refs,
  setActivePath,
  setContent,
  setDirty,
  setSaveState,
  setError,
  setToast,
  setSidebarOpen,
  onOpened,
}: UseDocSessionArgs): DocSession {
  const { activeRef, contentRef, dirtyRef, baseRef, frontmatterRef, notesRef, saveNowRef, openNoteRef } =
    refs

  const openNote = useCallback(
    async (path: string) => {
      const k = kernel
      if (!k || path === activeRef.current) return
      flushDocChange() // 上一篇挂起的 change 先兑现，别让它落在 open(new) 之后（会乱序）
      if (dirtyRef.current) await saveNowRef.current()
      try {
        const text = await k.fs.readText(path)
        // P1-2：这篇笔记的 frontmatter 跟着文档一起走（见 `frontmatterRef`）。
        // 列表里暂时找不到（刚新建、还没刷新）就退化成空对象，别让它 undefined。
        frontmatterRef.current = notesRef.current.find((n) => n.path === path)?.frontmatter ?? {}
        baseRef.current = text // 三方合并的 BASE = 刚读到的这份
        setContent(text)
        setActivePath(path)
        setDirty(false)
        setSaveState('idle')
        setError(null)
        setSidebarOpen(false) // 窄屏：选完笔记自动收抽屉
        fireDoc('open', path, text, false)
        onOpened?.(path) // 标签页登记（见 args 上的注释）
      } catch (e) {
        setError(failMsg('read', e))
      }
    },
    [
      kernel,
      fireDoc,
      flushDocChange,
      activeRef,
      dirtyRef,
      saveNowRef,
      notesRef,
      frontmatterRef,
      baseRef,
      setContent,
      setActivePath,
      setDirty,
      setSaveState,
      setError,
      setSidebarOpen,
      onOpened,
    ],
  )

  useEffect(() => {
    openNoteRef.current = openNote
  }, [openNote, openNoteRef])

  /**
   * `[[笔记名]]` 点击跳转（P2-2 · 2026-10-18）。
   *
   * 匹配顺序：库内相对路径（去 `.md`）→ 路径后缀（`[[日记/今天]]`）→ 显示标题。
   * 找不到就提示 —— 静默无反应正是这条问题原来的样子（用户点了没动静，以为功能坏了）。
   */
  const openWikiLink = useCallback(
    (target: string) => {
      const norm = (s: string) => s.replace(/\\/g, '/').replace(/\.md$/i, '').trim()
      const want = norm(target)
      const hit =
        notes.find((n) => n.id === target) ??
        notes.find((n) => norm(n.path) === want) ??
        notes.find((n) => norm(n.path).endsWith(`/${want}`)) ??
        notes.find((n) => norm(n.title) === want)
      if (hit) void openNote(hit.path)
      else setToast(`没有找到「${target}」这篇笔记`)
    },
    [notes, openNote, setToast],
  )

  /**
   * 关闭当前笔记，回到「未打开」的空态。
   * 有未保存内容先落盘（与切笔记、切库同一套语义）。
   * 此前**完全没有这个动作** —— 库里只有一篇笔记时，文件树点它还是它，等于出不去。
   */
  const closeNoteImpl = useCallback(
    async (saveFirst: boolean) => {
      if (saveFirst && dirtyRef.current) await saveNowRef.current()
      // 顺序：兑现挂起的 change → 取快照（清空之前！）→ 清空 → 广播 close
      flushDocChange()
      const p = activeRef.current
      const c = contentRef.current
      setActivePath(null)
      setContent('')
      baseRef.current = '' // 关掉了：没有"与磁盘一致的那份"可言
      frontmatterRef.current = {} // P1-2：文档关了，frontmatter 也跟着清掉
      setDirty(false)
      setSaveState('idle')
      setError(null)
      fireDoc('close', p, c, false)
    },
    [
      dirtyRef,
      saveNowRef,
      flushDocChange,
      activeRef,
      contentRef,
      baseRef,
      frontmatterRef,
      setActivePath,
      setContent,
      setDirty,
      setSaveState,
      setError,
      fireDoc,
    ],
  )

  /** 正常关闭：有未保存内容先落盘 */
  const closeNote = useCallback(() => closeNoteImpl(true), [closeNoteImpl])

  /**
   * **丢弃式关闭**（rev173.50 · 多标签页删除场景）：清空编辑器但不落盘。
   *
   * 为什么必须有这一条：文件已经被删进回收站、宿主要给剩下的标签让位时，
   * 若照常 `saveNow` 就会把**刚删掉的文件重新写出来**（内核的 `write_text` 会建文件）。
   * 删除流程在删之前已经落过盘，这里没有任何内容会丢。
   */
  const discardNote = useCallback(() => closeNoteImpl(false), [closeNoteImpl])

  return { openNote, openWikiLink, closeNote, discardNote }
}
