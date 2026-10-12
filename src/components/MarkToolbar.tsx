import type { ReactNode } from 'react'
import { keyLabel } from '@/kernel/keybindings'
import type { MarkSpec } from '@/kernel/markdown-marks'

/**
 * Markdown 标记的两处**内核工具栏**（2026-10-12 从 `examples/md-toolbar` 上收）。
 *
 * 一个组件两种形态 —— 因为它们本就是同一批按钮的两种排布：
 *   · `bar`  —— 编辑器**底部**：手机软键盘弹起时视口被压缩，这条正好落在
 *               **键盘正上方**（不是浮动定位，是布局的自然结果）。用短标签，
 *               一条横滑到底（CSS 在 `styles.css` 的 `.zn-editor-toolbar`）。
 *   · `hint` —— 编辑器**顶部**：桌面用的快捷键提示条，把键位印在按钮上，
 *               点一下同样能执行。**可开关**（开关状态由宿主存 localStorage）。
 *
 * 用的是插件面板同一套 class（`zn-ui-row` / `zn-btn` / `zn-ui-btn-ghost`），
 * 所以内核工具栏与插件注册到同一位置的面板**看起来是一回事**，不会一左一右两种风格。
 */
type Props = {
  /** 要渲染的标记。底部 = 全部 12 条；顶部 = 只挑带键位的那几条 */
  marks: readonly MarkSpec[]
  mode: 'bar' | 'hint'
  /** 点按钮 → 交给宿主执行命令（内核工具栏只认命令 id，不自己动手） */
  onRun: (id: string) => void
  /** 仅 `hint` 用：点最左那个 ✕ 收起提示条 */
  onHide?: () => void
  /** 插件注册到同一位置的面板 —— 跟在工具栏后面一起横滑 */
  children?: ReactNode
}

export function MarkToolbar({ marks, mode, onRun, onHide, children }: Props) {
  return (
    <div className={mode === 'bar' ? 'zn-editor-toolbar' : 'zn-editor-topbar'}>
      {/* 这一层 `zn-ui-row` 不是装饰：样式表里的间距、"关掉提示"按钮钉在左端
          （`.zn-editor-topbar .zn-ui-row > *:first-child { position: sticky }`）
          都挂在这个结构上。 */}
      <div className="zn-ui-row">
        {mode === 'hint' && onHide ? (
          <button
            type="button"
            className="zn-btn zn-ui-btn-ghost"
            title="隐藏快捷键提示"
            onClick={onHide}
          >
            ✕
          </button>
        ) : null}
        {marks.map((m) => (
          <button
            key={m.id}
            type="button"
            className="zn-btn zn-ui-btn-ghost"
            title={m.name}
            onClick={() => onRun(m.id)}
          >
            {mode === 'hint' && m.keybinding ? `${keyLabel(m.keybinding)} ${m.name}` : m.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  )
}
