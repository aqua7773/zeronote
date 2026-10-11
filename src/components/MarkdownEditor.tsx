import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'

type Props = {
  /** 当前笔记的库内相对路径；null = 未打开 */
  path: string | null
  /** 打开时载入的初始内容 */
  value: string
  onChange: (next: string) => void
  onSave: () => void
}

/**
 * CM6 封装（M1 版）：直接编辑 Markdown 纯文本 ⇒ 天然保真。
 * - 切换笔记时只 dispatch 替换文档，不重建 EditorView（保住 undo 之外的性能）
 * - Ctrl/Cmd+S 走 onSave
 * - 外部内容变化（如重新载入）也同步进编辑器，但避免与用户输入打架
 */
export function MarkdownEditor({ path, value, onChange, onSave }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)

  // 最新回调同步进 ref（编辑器实例只建一次，不能每次渲染重建）
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
  }, [onChange, onSave])

  // 建 view（只一次）
  useEffect(() => {
    if (!hostRef.current) return
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          markdown(),
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString())
          }),
          keymap.of([
            {
              key: 'Mod-s',
              preventDefault: true,
              run: () => {
                onSaveRef.current()
                return true
              },
            },
          ]),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // 切换笔记：整篇替换
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      selection: { anchor: Math.min(view.state.selection.main.anchor, value.length) },
    })
  }, [path, value])

  return <div className="zn-editor" ref={hostRef} />
}
