import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

/**
 * 编辑器上方的标签条（rev173.50 · 用户待办 #2「多标签页」）。
 *
 * 只收 props、只有渲染：
 *  · 打开 / 切换 / 关闭的动作由宿主（`App`）提供 —— 它才知道怎么落盘与读盘；
 *  · 「该切到哪篇」「超出上限丢谁」这类规则在 `lib/tabs.ts`（纯函数、有单测）。
 *
 * 手机上同样显示（`isDesktop` 不参与）：手机没有快捷键，标签条就是唯一的切换入口。
 */
export type TabItem = {
  /** 库内相对路径 —— React key 与关闭回调的标识 */
  path: string
  /** 显示名（去扩展名的文件名） */
  title: string
  /** 有未保存改动 → 标题前一个圆点 */
  dirty?: boolean
}

export interface TabBarProps {
  tabs: TabItem[]
  activePath: string | null
  onSelect: (path: string) => void
  onClose: (path: string) => void
}

export function TabBar({ tabs, activePath, onSelect, onClose }: TabBarProps) {
  /**
   * 标签开得多了会横向溢出 —— 切换后把当前那个滚进视野（否则用户按 Ctrl+Tab
   * 切到了看不见的标签，界面上像"没反应"）。`scrollIntoView` 在 happy-dom 里是
   * 空实现，用可选调用兜底。
   */
  const activeRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activePath])

  // 一篇都没开（或正在起始页）：整条不渲染，别占走那一行高度
  if (!tabs.length) return null
  return (
    <div className="zn-tabs" role="tablist" aria-label="打开的笔记">
      {tabs.map((t) => {
        const active = t.path === activePath
        return (
          <div
            key={t.path}
            ref={active ? activeRef : undefined}
            className={cn('zn-tab', active && 'is-active', t.dirty && 'is-dirty')}
            role="tab"
            aria-selected={active}
          >
            {/* 标签主体：点击切换。文字溢出用 CSS 省略号，title 给全路径 */}
            <button
              type="button"
              className="zn-tab-label"
              title={t.path}
              onClick={() => onSelect(t.path)}
            >
              {t.dirty ? <span className="zn-tab-dot" aria-label="未保存" /> : null}
              <span className="zn-tab-name">{t.title}</span>
            </button>
            {/* 关闭：stopPropagation 不必要（与主体是兄弟节点），但手机点 × 时别让它误触发切换 */}
            <button
              type="button"
              className="zn-tab-close"
              title={`关闭 ${t.title}`}
              aria-label={`关闭 ${t.title}`}
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.path)
              }}
            >
              ×
            </button>
          </div>
        )
      })}
    </div>
  )
}
