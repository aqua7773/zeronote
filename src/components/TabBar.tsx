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
 *
 * **B5（rev173.261 · 方案 §2.1）**：
 *  · 右侧固定两个按钮 —— `＋`（新建笔记 / 打开面板）与 `»`（全部标签）。
 *    没有标签时也渲染这一条，`＋` 是「无标签也能新建」的入口（验收点）。
 *  · `»` **常显**而不是「溢出才出现」：位置不该忽隐忽现；标签少时它也就是一份可点的全列表。
 *    溢出时仍可直接横滑（`.zn-tabs-scroll`），`»` 只是清单式的替代入口。
 *  · 两个按钮的菜单是**组件内 popover**（绝对定位在标签条下方），不走宿主的 `ContextMenu` ——
 *    它需要出现在标签条正下方、且不依赖宿主坐标状态。
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
  /**
   * `＋` 的第一项：新建笔记（B5 · 方案 §2.1）。
   * 不传 ⇒ 不渲染 `＋`；**没有标签且没有 `＋`** 时整条不渲染（与 B5 之前一致）。
   */
  onNewNote?: () => void
  /** `＋` 菜单里的「打开面板」候选（`location: main / sidebar` 的面板）；空 ⇒ 只显示新建笔记 */
  panelItems?: { id: string; title: string }[]
  onOpenPanel?: (id: string) => void
}

/** 标签条右侧 popover 的两种来源 */
type PopKind = 'new' | 'more'

export function TabBar({
  tabs,
  activePath,
  onSelect,
  onClose,
  onContextMenu,
  onDragEnd,
  dragHint = '拖出窗口 → 独立窗口',
  onNewNote,
  panelItems = [],
  onOpenPanel,
}: TabBarProps) {
  /**
   * 标签开得多了会横向溢出 —— 切换后把当前那个滚进视野（否则用户按 Ctrl+Tab
   * 切到了看不见的标签，界面上像"没反应"）。
   *
   * B5 改手动算 `scrollLeft` 而不用 `scrollIntoView`：后者在真实 WebView2 里
   * 会先处理纵向、且只在这里"碰巧"有效过一次；显式比较「元素左右边 vs 容器可视区」
   * 最直白，也不依赖滚动容器的祖先链。
   */
  const activeRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = activeRef.current
    const box = scrollRef.current
    if (!el || !box) return
    const left = el.offsetLeft
    const right = left + el.offsetWidth
    if (left < box.scrollLeft) box.scrollLeft = left
    else if (right > box.scrollLeft + box.clientWidth) box.scrollLeft = right - box.clientWidth
  }, [activePath, tabs.length])

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

  /* ── 右侧 popover（B5）── */
  const [pop, setPop] = useState<PopKind | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!pop) return
    const onDown = (e: MouseEvent) => {
      // 点面板内部不算「点外面」（菜单项自己会在 onClick 里关）
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return
      setPop(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [pop])

  // 一篇都没开、也没有「＋」入口：整条不渲染，别占走那一行高度（B5 之前的行为）
  if (!tabs.length && !onNewNote) return null
  return (
    <div ref={rootRef} className={cn('zn-tabs', dragging && 'is-dragging')}>
      <div ref={scrollRef} className="zn-tabs-scroll" role="tablist" aria-label="打开的笔记">
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

      {/* 右侧固定动作（B5）：＋ 新建 / 选面板 · » 全部标签 */}
      {onNewNote ? (
        <div className="zn-tabs-actions">
          <button
            type="button"
            className="zn-tabs-action"
            title="新建笔记 / 打开面板"
            aria-label="新建笔记或打开面板"
            aria-haspopup="menu"
            aria-expanded={pop === 'new'}
            onClick={() => setPop((p) => (p === 'new' ? null : 'new'))}
          >
            ＋
          </button>
          {tabs.length > 0 ? (
            <button
              type="button"
              className="zn-tabs-action"
              title="全部标签（切换）"
              aria-label="全部标签"
              aria-haspopup="menu"
              aria-expanded={pop === 'more'}
              onClick={() => setPop((p) => (p === 'more' ? null : 'more'))}
            >
              »
            </button>
          ) : null}
        </div>
      ) : null}

      {pop === 'new' ? (
        <div className="zn-tabs-pop" role="menu" aria-label="新建">
          <button
            type="button"
            role="menuitem"
            className="zn-tabs-pop-item"
            onClick={() => {
              setPop(null)
              onNewNote?.()
            }}
          >
            <span className="zn-tabs-pop-name">新建笔记</span>
            <span className="zn-tabs-pop-hint">Ctrl+N</span>
          </button>
          {panelItems.length > 0 && onOpenPanel ? (
            <>
              <div className="zn-tabs-pop-sep" />
              {panelItems.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  className="zn-tabs-pop-item"
                  title={p.id}
                  onClick={() => {
                    setPop(null)
                    onOpenPanel(p.id)
                  }}
                >
                  <span className="zn-tabs-pop-name">打开 · {p.title}</span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      {pop === 'more' ? (
        <div className="zn-tabs-pop" role="menu" aria-label="全部标签">
          {tabs.map((t) => (
            <button
              key={t.path}
              type="button"
              role="menuitem"
              className={cn('zn-tabs-pop-item', t.path === activePath && 'is-active')}
              title={t.path}
              onClick={() => {
                setPop(null)
                onSelect(t.path)
              }}
            >
              <span className="zn-tabs-pop-name">{t.title}</span>
              {t.dirty ? <span className="zn-tab-dot" aria-label="未保存" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
