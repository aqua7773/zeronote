/**
 * 主区空态（三种情况）—— 从 `App.tsx` 原样迁出（rev122 · L2）。
 *
 * 按 NN/g「空态三原则」组织：
 *  ① 说清当前状态（是"还没打开"，不是"加载中"）
 *  ② 给学习线索（快捷键就地教学）
 *  ③ 给一个真正能点的开始动作
 * 分三种情况，不用同一句话糊弄「有库但没打开」的场景。
 */
import type { NoteMeta } from '../kernel/contract'
import { Button } from '@/components/ui'

/**
 * 起始页的 **Markdown 标记速查表**（2026-10-17 用户：「起始页改成markdown各种标记提示，
 * 新建笔记可以保留」）。左列是写法、右列是作用；点「新建笔记」照抄即可。
 */
const MARKDOWN_CHEATS: { syntax: string; desc: string }[] = [
  { syntax: '# 标题', desc: '一到六级标题' },
  { syntax: '**粗体**', desc: '加粗' },
  { syntax: '*斜体*', desc: '斜体' },
  { syntax: '~~删除~~', desc: '删除线' },
  { syntax: '- 项目', desc: '无序列表（Tab 缩进）' },
  { syntax: '1. 第一项', desc: '有序列表' },
  { syntax: '- [ ] 待办', desc: '任务列表（[x] 已完成）' },
  { syntax: '> 引用', desc: '引用（> > 二级嵌套）' },
  { syntax: '`行内代码`', desc: '行内代码' },
  { syntax: '```', desc: '代码块' },
  { syntax: '[文字](链接)', desc: '链接（点 ↗ 打开）' },
  { syntax: '![说明](图片)', desc: '图片' },
  { syntax: '| A | B |', desc: '表格（:---: 控制对齐）' },
  { syntax: '---', desc: '分割线' },
]

export type AppEmptyStateProps = {
  vault: string | null
  notes: NoteMeta[]
  onPickVault: () => void
  onNewNote: () => void
}

export function AppEmptyState({ vault, notes, onPickVault, onNewNote }: AppEmptyStateProps) {
  return (
    <div className="zn-empty">
      {!vault ? (
        <>
          <h1>ZeroNote</h1>
          <p>
            还没有打开笔记库。选一个文件夹 —— 里面的 <code>.md</code> 就是你的笔记；
            内核只负责 <b>读写</b>、<b>编辑</b>、<b>本地存储</b> 与 <b>插件宿主</b>。
          </p>
          <Button variant="primary" size="lg" onClick={onPickVault}>
            选择笔记库
          </Button>
        </>
      ) : notes.length === 0 ? (
        <>
          <h1>这个库还没有笔记</h1>
          <p>
            <code>{vault.split(/[\\/]/).pop()}</code> 里还没有 <code>.md</code> 文件。
          </p>
          <Button variant="primary" size="lg" onClick={onNewNote}>
            新建第一条
          </Button>
        </>
      ) : (
        <>
          <h1>选一篇开始</h1>
          <p>从左侧列表打开，或新建一篇。常用 Markdown 标记：</p>
          <Button variant="primary" size="lg" onClick={onNewNote}>
            新建笔记
          </Button>
          {/* Markdown 速查表（2026-10-17 用户：起始页改成标记提示，新建按钮保留） */}
          <div className="zn-md-cheatsheet">
            {MARKDOWN_CHEATS.map((c) => (
              <div key={c.syntax} className="zn-md-cheat">
                <code>{c.syntax}</code>
                <span>{c.desc}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <div className="zn-empty-keys">
        <span>
          <kbd>Ctrl</kbd>+<kbd>N</kbd> 新建
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>P</kbd> 命令面板
        </span>
        <span>
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd> 搜索
        </span>
      </div>
    </div>
  )
}
