import { useEffect, useRef } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { basicSetup } from 'codemirror'

/**
 * **源码模式**（2026-10-17 用户：「增加切换源码模式」）。
 *
 * 与 `AtomicCodeMirrorEditor`（Obsidian 风格 Live Preview）互补：
 * 这里**不加载 inline preview 装饰**，直接显示 markdown 源码（`#`、`**`、`>` 全部可见），
 * 适合排查格式问题或贴大段原始文本。
 *
 * 与 Live Preview **共用同一份 `value`**：编辑走 `onChange`，切回预览时
 * `MarkdownEditor` 的 value 同步 effect 会把内容灌进 atomic 的 view。
 */
export function SourceModeView({
  path,
  value,
  onChange,
}: {
  path: string | null
  value: string
  onChange: (next: string) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // 按笔记重建（切换源码/预览时不重建；路径变了才重建）
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'transparent' },
            '.cm-scroller': {
              fontFamily: 'var(--zn-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
              fontSize: '14px',
              lineHeight: '1.7',
            },
            /* 顶部只留正常内边距：切换按钮已移到右上角（与「关闭」并排），不再遮第一行 */
            '.cm-content': { padding: '8px 0' },
            '.cm-line': { color: 'var(--zn-fg)' },
            '.cm-gutters': {
              backgroundColor: 'transparent',
              borderRight: '1px solid var(--zn-border)',
              color: 'var(--zn-fg-muted)',
            },
          }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 只在 path 变化时重建；value 由下面的同步 effect 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // 外部 value 变化（磁盘回灌 / 切回源码模式）→ 同步进 CM6
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const cur = view.state.doc.toString()
    if (cur === value) return
    view.dispatch({ changes: { from: 0, to: cur.length, insert: value } })
  }, [value])

  return <div ref={hostRef} className="zn-source-editor" />
}
