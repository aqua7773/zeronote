import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { dragStarted, isOutsideWindow } from '@/lib/tab-drag'

/**
 * 编辑器上方的标签条（rev173.50 · 用户待办 #2「多标签页」）。
 *
 * 只收 props、只有渲染：
 *  · 打开 / 切换 / 关闭的动作由宿主（`App`）提供 —— 它才知道怎么落盘与读盘；
 *  · 「该切到哪篇」「超出上限丢谁」这类规则在 `lib/tabs.ts`（纯函数、有单测）。
 *
 * 手机上同样显示（`isDesktop` 不参与）：手机没有快捷键，标签条就是唯一的切换入口。
 *
 * rev173.52 起多一种手势：**把标签拖出窗口**（`onDragEnd`）。组件只负责判定
 * 「这次是拖拽还是点击」「指针有没有越出窗口」（`lib/tab-drag.ts`），
 * 至于越界之后是拆成独立窗口还是收回主窗口 —— 由宿主决定（同一份手势，两个方向）。
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
  /**
   * 右键某个标签（rev173.51 · 桌面入口：在新窗口打开 / 关闭）。
   * 手机上不传 —— 手机没有右键，独立窗口也不成立。
   */
  onContextMenu?: (path: string, at: { x: number; y: number }) => void
  /**
   * 拖拽松手（rev173.52）。`outside` 已由组件按窗口边界算好：
   * 主窗口里 = 拆成独立窗口，独立窗口里 = 收回主窗口。
   * 不传 ⇒ 不出拖拽手势（手机 / 不需要的调用方）。
   */
  onDragEnd?: (
    path: string,
    at: { clientX: number; clientY: number; screenX: number; screenY: number; outside: boolean },
  ) => void
  /** 拖拽中的提示文案（主窗口「拖出 → 独立窗口」/ 独立窗口「拖出 → 收回主窗口」） */
  dragHint?: string
}

export function TabBar({
  tabs,
  activePath,
  onSelect,
  onClose,
  onContextMenu,
  onDragEnd,
  dragHint = '拖出窗口 → 独立窗口',
}: TabBarProps) {
  /**
   * 标签开得多了会横向溢出 —— 切换后把当前那个滚进视野（否则用户按 Ctrl+Tab
   * 切到了看不见的标签，界面上像"没反应"）。`scrollIntoView` 在 happy-dom 里是
   * 空实现，用可选调用兜底。
   */
  const activeRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activePath])

  /* ── 拖拽手势（rev173.52）── */
  /** 按下点 + 是否已过阈值；`null` = 没在拖 */
  const dragRef = useRef<{ path: string; x: number; y: number; moved: boolean } | null>(null)
  /** 正在被拖的路径（渲染用：半透明） */
  const [dragging, setDragging] = useState<string | null>(null)
  /**
   * 拖完松手会补发一次 click —— 必须吃掉，否则「拖出拆窗口」会顺带把被拖的标签
   * 又切换一次（用户看到的是"拆出去了但主窗口乱跳"）。
   */
  const suppressClickRef = useRef(false)

  useEffect(() => {
    if (!onDragEnd) return
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      if (!d.moved && !dragStarted({ x: d.x, y: d.y }, { x: e.clientX, y: e.clientY })) return
      d.moved = true
      setDragging(d.path)
    }
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current
      dragRef.current = null
      setDragging(null)
      if (!d || !d.moved) return
      suppressClickRef.current = true
      onDragEnd(d.path, {
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        outside: isOutsideWindow(e.clientX, e.clientY, window.innerWidth, window.innerHeight),
      })
    }
    // 挂在 window 上：拖到标签条外面（甚至贴边）时组件本身早就收不到事件了
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [onDragEnd])

  // 一篇都没开（或正在起始页）：整条不渲染，别占走那一行高度
  if (!tabs.length) return null
  return (
    <div
      className={cn('zn-tabs', dragging && 'is-dragging')}
      role="tablist"
      aria-label="打开的笔记"
    >
      {tabs.map((t) => {
        const active = t.path === activePath
        return (
          <div
            key={t.path}
            ref={active ? activeRef : undefined}
            className={cn(
              'zn-tab',
              active && 'is-active',
              t.dirty && 'is-dirty',
              dragging === t.path && 'is-dragging',
            )}
            role="tab"
            aria-selected={active}
            onContextMenu={(e) => {
              if (!onContextMenu) return
              e.preventDefault()
              onContextMenu(t.path, { x: e.clientX, y: e.clientY })
            }}
          >
            {/* 标签主体：点击切换。文字溢出用 CSS 省略号，title 给全路径 */}
            <button
              type="button"
              className="zn-tab-label"
              title={t.path}
              onPointerDown={(e) => {
                if (!onDragEnd || e.button !== 0) return
                dragRef.current = { path: t.path, x: e.clientX, y: e.clientY, moved: false }
              }}
              onClick={() => {
                // 刚拖完那一记 click 不算「切换」（见 suppressClickRef 的注释）
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                onSelect(t.path)
              }}
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
      {/* 拖拽中的提示：宿主按自己的场景给文案（主窗口=拆出 / 独立窗口=收回） */}
      {dragging ? <span className="zn-tabs-hint">{dragHint}</span> : null}
    </div>
  )
}
