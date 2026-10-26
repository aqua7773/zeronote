/**
 * 文档原语 + 事件广播（`docApi` / `fireDoc` / `flushDocChange`）—— 从 `App.tsx` 原样迁出
 * （rev126 · L3 第四刀）。
 *
 * 为什么这一刀最安全：它**不依赖 kernel**（全是 ref + `editorRef`），迁出后 App 里
 * `kernel` 的 `useMemo` 仍依赖返回的 `docApi` —— 无循环依赖。
 *
 * ⚠️ 行为必须与迁出前**逐字一致**（这些点不报错、但错了极难查）：
 *  - `fireDoc` 由调用方显式传 path/content/dirty 快照 —— 三个 fire 点（open/save/change）
 *    都发生在 `setContent` / `setActivePath` **之后**，而 `contentRef` / `activeRef` 在
 *    effect 里才同步，那一刻 ref 还停在旧值；读 ref 会广播出"上一秒的文档"。
 *  - `change` 去抖窗口由 App 的 `onEditorChange` 填 `docPendingRef`，`flushDocChange`
 *    在切笔记 / 关笔记前兑现（不兑现会乱序：`change(old)` 落在 `open(new)` 之后）。
 *  - `docApi.close()` 的快照必须在清空状态**之前**取，否则订阅者拿到空文档。
 */
import { useCallback, useMemo, type MutableRefObject } from 'react'
import type { EditorView } from '@codemirror/view'
import type { DocApi, DocEvent, NoteDoc } from '../kernel/contract'
import { forgetOpenedVia, registerDocCodec } from '../kernel/doc-codec'

/** `doc.on` 的广播入口（本 hook 的 `fireDoc`） */
type FireDoc = (ev: DocEvent, path: string | null, content: string, dirty: boolean) => void

export type DocApiRefs = {
  /** `doc.on` 订阅表 */
  docSubsRef: MutableRefObject<Map<DocEvent, Set<(d: NoteDoc) => void>>>
  frontmatterRef: MutableRefObject<Record<string, unknown>>
  activeRef: MutableRefObject<string | null>
  contentRef: MutableRefObject<string>
  dirtyRef: MutableRefObject<boolean>
  /** 关闭笔记时清空（没有"与磁盘一致的那份"可言） */
  baseRef: MutableRefObject<string>
  /** CM6 实例 —— ⚠️ 必须留在 App（`MarkdownEditor.onReady` 与右键「标记」命令都用它），只作参数传入 */
  editorRef: MutableRefObject<EditorView | null>
  /** `change` 去抖窗口里待广播的内容 */
  docPendingRef: MutableRefObject<{ path: string; content: string } | null>
  /** `change` 去抖计时器 */
  docChangeTimerRef: MutableRefObject<number | null>
  saveNowRef: MutableRefObject<() => Promise<void>>
  openNoteRef: MutableRefObject<(p: string) => Promise<void>>
}

export type UseDocApiArgs = {
  refs: DocApiRefs
  setActivePath: (p: string | null) => void
  setContent: (c: string) => void
  setDirty: (d: boolean) => void
}

export type DocApiHandle = {
  fireDoc: FireDoc
  flushDocChange: () => void
  docApi: DocApi
}

export function useDocApi({ refs, setActivePath, setContent, setDirty }: UseDocApiArgs): DocApiHandle {
  const {
    docSubsRef,
    frontmatterRef,
    activeRef,
    contentRef,
    dirtyRef,
    baseRef,
    editorRef,
    docPendingRef,
    docChangeTimerRef,
    saveNowRef,
    openNoteRef,
  } = refs

  /**
   * 把文档事件广播给所有订阅者。
   *
   * 单个订阅者抛错**不影响**其它订阅者，也不会把编辑动作带崩：逐个 try/catch 后 `console.error`。
   */
  const fireDoc = useCallback(
    (ev: DocEvent, path: string | null, content: string, dirty: boolean) => {
      const subs = docSubsRef.current.get(ev)
      if (!subs || subs.size === 0 || !path) return
      const d: NoteDoc = { path, content, frontmatter: frontmatterRef.current, dirty }
      for (const cb of [...subs]) {
        try {
          cb(d)
        } catch (e) {
          console.error(`[doc.on:${ev}] 插件回调抛错（已隔离）`, e)
        }
      }
    },
    // 依赖只到 ref（docSubsRef / frontmatterRef 都是 useRef 的稳定对象）。
    // 写成 `.current` 会让 fireDoc 随订阅表变化重建 ⇒ docApi 重建 ⇒ kernel 重建，方向是错的。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /**
   * 兑现去抖窗口里挂起的 `change`（切笔记 / 关笔记前调用）。
   *
   * 不兑现的话会**乱序**：`change(old)` 落在 `open(new)` 之后才广播，插件会拿旧内容去改新文档。
   * 所以切走之前先把"这篇笔记的最后状态"播出去，再播 `open` / `close`。
   */
  const flushDocChange = useCallback(() => {
    if (docChangeTimerRef.current !== null) {
      window.clearTimeout(docChangeTimerRef.current)
      docChangeTimerRef.current = null
    }
    const pending = docPendingRef.current
    docPendingRef.current = null
    if (pending) fireDoc('change', pending.path, pending.content, true)
    // 定时器 / 待播内容都是 ref（.current 会变，不能进依赖 —— 否则 docApi 与 kernel 跟着重建）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fireDoc])

  /* ── doc 原语：React 状态 + CM6 实例 → 契约形状 ── */
  const docApi: DocApi = useMemo(
    () => ({
      active: () =>
        activeRef.current
          ? {
              path: activeRef.current,
              content: contentRef.current,
              frontmatter: frontmatterRef.current,
              dirty: dirtyRef.current,
            }
          : null,
      open: (p) => openNoteRef.current(p),
      close: () => {
        // 与 closeNote 同一套语义：快照必须**在清空之前**取，否则订阅者拿到的是空文档
        const p = activeRef.current
        const c = contentRef.current
        flushDocChange()
        forgetOpenedVia(p) // 关掉了：清掉"这个路径由哪个 codec 打开"的记录
        setActivePath(null)
        setContent('')
        baseRef.current = '' // 关掉了：没有"与磁盘一致的那份"可言
        frontmatterRef.current = {} // P1-2：文档关了，frontmatter 也跟着清掉
        setDirty(false)
        fireDoc('close', p, c, false)
      },
      save: () => saveNowRef.current(),
      selection: () => {
        const v = editorRef.current
        if (!v) return null
        const { from, to } = v.state.selection.main
        return { from, to, text: v.state.sliceDoc(from, to) }
      },
      replaceSelection: (text) => {
        const v = editorRef.current
        if (!v) return
        const { from, to } = v.state.selection.main
        v.dispatch({ changes: { from, to, insert: text } })
        v.focus()
      },
      insertAtCursor: (text) => {
        const v = editorRef.current
        if (!v) return
        const pos = v.state.selection.main.head
        v.dispatch({
          changes: { from: pos, insert: text },
          selection: { anchor: pos + text.length },
        })
        v.focus()
      },
      /**
       * 按**偏移**插入 —— 行首标记（`# ` 标题）与成对标记（`**粗体**` 光标落中间）都靠它。
       * 偏移一律夹进 `[0, doc.length]`：插件自己算行首时偶尔会差一两个字符（比如文档刚被改过），
       * 那种情况该"尽力插进去"，而不是抛错把整条命令打断。
       */
      insertAt: (pos, text, cursorOffset) => {
        const v = editorRef.current
        if (!v) return
        const len = v.state.doc.length
        const at = Math.min(Math.max(pos, 0), len)
        const caret = at + Math.min(Math.max(cursorOffset ?? text.length, 0), text.length)
        v.dispatch({
          changes: { from: at, insert: text },
          selection: { anchor: caret },
        })
        v.focus()
      },
      /**
       * 按**区间**替换 —— 结构化编辑（导图 ⇄ 大纲双向回写、表格单元格、任务勾选）靠它。
       * `from` / `to` 顺序颠倒自动交换；两端夹进 `[0, doc.length]`；`text === ''` 即删除该区间。
       * 与 `insertAt` 同一套"尽力而为、不抛错"策略：插件算出的偏移差一两个字符时，
       * 该把改动落下去，而不是抛错把整条命令打断。
       */
      replaceRange: (from, to, text, cursorOffset) => {
        const v = editorRef.current
        if (!v) return
        const len = v.state.doc.length
        const a = Math.min(Math.max(Math.min(from, to), 0), len)
        const b = Math.min(Math.max(Math.max(from, to), 0), len)
        const caret = a + Math.min(Math.max(cursorOffset ?? text.length, 0), text.length)
        v.dispatch({
          changes: { from: a, to: b, insert: text },
          selection: { anchor: caret },
        })
        v.focus()
      },
      /**
       * 订阅文档事件（U3b —— 此前这里返回的是永远不触发的空桩）。
       * 注册进 `docSubsRef`；`dispose` 幂等，集合空了就把 key 删掉（不给长会话留泄漏）。
       */
      on: (ev, cb) => {
        let set = docSubsRef.current.get(ev)
        if (!set) {
          set = new Set()
          docSubsRef.current.set(ev, set)
        }
        set.add(cb)
        const owner = set
        return {
          dispose: () => {
            owner.delete(cb)
            if (owner.size === 0) docSubsRef.current.delete(ev)
          },
        }
      },
      /**
       * 内容转换器（rev173.180）—— 读盘后 decode / 写盘前 encode。
       * 注册表是**模块级单例**（`src/kernel/doc-codec.ts`）：useDocSession（打开）与
       * useDocIO（保存 / 合并）各自 import 即看到同一份，不需要一路传 props。
       */
      registerCodec: (codec) => registerDocCodec(codec),
    }),
    /**
     * 依赖只写 `[]`：docApi 的回调**全部**读 ref（activeRef / editorRef / docSubsRef …），
     * fireDoc / flushDocChange 也是 ref 语义（重建与否行为完全一致），setter 都是稳定的。
     *
     * 为什么不列依赖（rev136 实测）：dev 下 `fireDoc` 会周期性被重建（先记下来源未定位，
     * 与 fs 轮询的 3 秒节律接近）。把它写进依赖 ⇒ docApi 跟着变 ⇒ **kernel 每几秒重建
     * ⇒ 插件全部卸载重载 ⇒ 主题样式消失几百毫秒（页面闪一下内核深色）**。
     * 这里写 `[]` 把抖动挡在 docApi 之外 —— kernel 只随 vault 重建。
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  return { fireDoc, flushDocChange, docApi }
}