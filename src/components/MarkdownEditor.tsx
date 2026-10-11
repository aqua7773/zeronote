import { useCallback, useEffect, useRef } from 'react'
import { type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import { AtomicCodeMirrorEditor } from '@atomic-editor/editor'
import type { AtomicCodeMirrorEditorHandle } from '@atomic-editor/editor'
import '@atomic-editor/editor/styles.css'

type Props = {
  /** 当前笔记的库内相对路径；null = 未打开 */
  path: string | null
  /** 打开时载入的初始内容 */
  value: string
  onChange: (next: string) => void
  onSave: () => void
  /** 把底层 EditorView 交给宿主，供 doc 原语使用（读选区 / 替换 / 插入）；销毁时回调 null */
  onReady?: (view: EditorView | null) => void
}

/**
 * 组件级样式：把 atomic-editor 的 `--atomic-editor-*` 主题变量桥接到本项目的
 * `--zn-*` token 上。**只作用于编辑器子树，不动全局 styles.css。**
 *
 * 用 `!important` 的原因：atomic 自带一条 `[data-theme="light"] .atomic-cm-editor`
 * （特异性 0,2,0），与本选择器完全相同；同特异性下靠源顺序（Vite 注入的 CSS
 * 在 head，本 style 在 body）胜出虽可行，但一旦打包顺序变化就会静默失效 ——
 * 显式压过更可解释。
 *
 * 刻意**不覆盖**的：`--atomic-editor-body-size`（阅读型正文 1.0625rem）与
 * `--atomic-editor-measure`（70ch 居中阅读宽度）。它们是 atomic 的排版设计，
 * 覆盖它会改变既有观感；如需贴齐 --zn-text 或铺满宽度，各自加一行即可。
 */
const EDITOR_CSS = `
.zn-editor .atomic-cm-editor {
  --atomic-editor-font: var(--zn-font) !important;
  --atomic-editor-font-mono: var(--zn-font-mono) !important;
  --atomic-editor-fg: var(--zn-fg) !important;
  --atomic-editor-fg-muted: var(--zn-fg-muted) !important;
  --atomic-editor-fg-faint: var(--zn-fg-subtle) !important;
  --atomic-editor-border: var(--zn-border) !important;
  --atomic-editor-accent: var(--zn-accent) !important;
  --atomic-editor-link: var(--zn-accent) !important;
}
.zn-editor .cm-editor.cm-focused { outline: none !important; }
`

/**
 * 行内即时渲染编辑器（Obsidian 风格 Live Preview）。
 *
 * 由 `@atomic-editor/editor` 承担渲染：光标所在行显示 markdown 源码，其余行
 * 渲染成标题 / 粗体 / 表格 / 列表 / 图片 / 代码块等。markdown 纯文本始终是
 * 唯一真相（装饰只作用于视图），所以读写仍然保真。
 *
 * 两个必须自己接的缝：
 * 1. **裸 EditorView**：atomic 的 React 组件不导出 view —— `editorHandleRef` 只
 *    给 focus / undo / getMarkdown / getContentDOM / setReadOnly 这类动作，没有
 *    读选区、dispatch 的通道。宿主 `docApi` 要的就是裸 view，所以这里用它的
 *    官方扩展点 `extensions` 注入一个 `ViewPlugin`：CM6 保证 ViewPlugin 的构造
 *    函数在 `new EditorView()` 时**同步**收到 view，拿它转交 onReady 即可。
 * 2. **外部 value 同步**：atomic 的 `markdownSource` 只在 mount 时读一次（后续以
 *    编辑器自身为真相），所以要自己 compare + dispatch 替换。
 *
 * 文档身份用 `documentId={path}`：切换笔记时 atomic 重建 view（丢弃上一篇的
 * undo 历史与选区），其余时候不重建 —— 若不给 documentId，它会把
 * `markdownSource` 当身份，等于每次输入都重建编辑器。
 */
export function MarkdownEditor({ path, value, onChange, onSave, onReady }: Props) {
  const viewRef = useRef<EditorView | null>(null)
  const handleRef = useRef<AtomicCodeMirrorEditorHandle | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onReadyRef = useRef(onReady)

  // 最新回调同步进 ref（编辑器实例不能每次渲染重建）
  useEffect(() => {
    onChangeRef.current = onChange
    onSaveRef.current = onSave
    onReadyRef.current = onReady
  }, [onChange, onSave, onReady])

  // 下面三个都是稳定引用（useCallback([])），所以扩展数组可以在首帧安全地
  // 捕获它们。全部放在 useCallback 里，也顺带满足 oxlint 的 react(refs)：
  // render 期一律不出现 `*.current`，ref 只在事件/生命周期回调里读写。
  const adoptView = useCallback((view: EditorView) => {
    viewRef.current = view
    onReadyRef.current?.(view)
  }, [])

  const releaseView = useCallback((view: EditorView) => {
    if (viewRef.current === view) viewRef.current = null
    onReadyRef.current?.(null)
  }, [])

  const handleSaveKey = useCallback(() => {
    onSaveRef.current()
    return true
  }, [])

  // Ctrl/Cmd+S → onSave。
  // 不用 CM6 的 keymap：一是不必把持 ref 的回调塞进 render 期构造的扩展里，
  // 二是挂在 window 上比 CM6 keymap 覆盖面更广 —— 焦点在搜索面板 / 侧边栏时
  // 也能保存（App 的全局快捷键只管 Ctrl+K 与 Escape，不会与之重叠）。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      if (e.key.toLowerCase() !== 's') return
      e.preventDefault()
      handleSaveKey()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSaveKey])

  const handleMarkdownChange = useCallback((next: string) => {
    onChangeRef.current(next)
  }, [])

  // extensions 在**每次 render 现场构造**即可：atomic 只在 mount（以及
  // documentId 变化）时捕获这个数组，之后换引用不会作用到已挂载的 view
  // （它的 mount effect 只依赖 documentId）。因此不需要 useRef/useState 缓存 ——
  // 也顺带避免了在 render 期读 `*.current`（oxlint 的 react(refs) 会报）。
  const extensions: Extension[] = [
    ViewPlugin.fromClass(
      class {
        readonly view: EditorView
        constructor(view: EditorView) {
          this.view = view
          adoptView(view)
        }
        destroy() {
          releaseView(this.view)
        }
      },
    ),
  ]

  // 兜底（正常走不到）：万一将来 atomic 的内部实现不再触发我们注入的
  // ViewPlugin，就借它公开的 handle 拿到 contentDOM，再向 CM6 反查 view，
  // 避免 onReady 静默失效后宿主 docApi 全部失灵。
  useEffect(() => {
    if (viewRef.current) return
    const contentDOM = handleRef.current?.getContentDOM()
    const view = contentDOM ? EditorView.findFromDOM(contentDOM) : null
    if (!view) return
    adoptView(view)
  }, [path, adoptView])

  // 切换笔记 / 外部内容变化：整篇替换（doc 身份变了则由 atomic 自己重建）
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

  return (
    <div className="zn-editor">
      <style>{EDITOR_CSS}</style>
      <AtomicCodeMirrorEditor
        documentId={path ?? ''}
        markdownSource={value}
        onMarkdownChange={handleMarkdownChange}
        editorHandleRef={handleRef}
        extensions={extensions}
      />
    </div>
  )
}
