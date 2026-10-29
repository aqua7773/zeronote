import type { ReactNode } from 'react'
import type { MarkSpec } from '@/kernel/markdown-marks'

/**
 * Markdown 标记快捷栏 —— **移动端键盘正上方**那一条（2026-10-12 从 `examples/md-toolbar` 收进内核）。
 *
 * 位置是编辑器**底部**：手机上软键盘弹起时视口被压缩，这条正好落在键盘正上方
 * （不是浮动定位，是布局的自然结果 —— 内核用 `visualViewport` 把根容器钉到可见视口高度）。
 *
 * **桌面端不渲染它**：用户 2026-10-12 定「桌面只留右键菜单的『标记』子菜单，
 * 移动端只留键盘上方这条快捷栏」。两处入口用的是**同一批命令**（`core.mark.*`，
 * 见 `kernel/markdown-marks.ts`），所以行为不会分叉。
 *
 * 用插件面板同一套 class（`zn-ui-row` / `zn-btn` / `zn-ui-btn-ghost`），
 * 插件注册到 `editor-toolbar` 的面板跟在后面一起横滑，看不出哪个是内核、哪个是插件。
 */
type Props = {
  /** 要渲染的标记（数组顺序即按钮顺序） */
  marks: readonly MarkSpec[]
  /** 点按钮 → 交给宿主执行命令（这条栏只认命令 id，不自己动手） */
  onRun: (id: string) => void
  /**
   * 「插入附件」内置按钮（rev173.253 · 手机端）。
   * 不传就不画 —— 桌面端这条栏本来就不渲染，宿主只在 android 传。
   */
  onInsertAttachment?: () => void
  /** 「在正文里查找」内置按钮（rev173.253 · 手机端）；不传不画 */
  onFind?: () => void
  /** 插件注册到同一位置的面板 */
  children?: ReactNode
}

export function MarkToolbar({ marks, onRun, onInsertAttachment, onFind, children }: Props) {
  return (
    <div className="zn-editor-toolbar">
      {/* 手机键盘上没有 Tab 键 —— 缩进 / 反缩进用按钮补上（rev173.8）。
          命令与编辑器里的 Tab / Shift+Tab 走同一份逻辑（只对列表行生效）。
          内核没有标记要画、又只有插件面板时，别留一个空的按钮行占位。 */}
      {marks.length > 0 ? (
        <div className="zn-ui-row">
          <button
            type="button"
            className="zn-btn zn-ui-btn-ghost"
            title="取消缩进（Shift+Tab）"
            onClick={() => onRun('core.outdent')}
          >
            ⇤
          </button>
          <button
            type="button"
            className="zn-btn zn-ui-btn-ghost"
            title="缩进（Tab）"
            onClick={() => onRun('core.indent')}
          >
            ⇥
          </button>
          {onInsertAttachment ? (
            <button
              type="button"
              className="zn-btn zn-ui-btn-ghost"
              title="插入附件（图片 / 文件）"
              aria-label="插入附件"
              onClick={onInsertAttachment}
            >
              📎
            </button>
          ) : null}
          {onFind ? (
            <button
              type="button"
              className="zn-btn zn-ui-btn-ghost"
              title="在正文里查找"
              aria-label="查找"
              onClick={onFind}
            >
              🔍
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
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
      {children}
    </div>
  )
}
