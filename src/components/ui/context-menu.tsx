import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * 右键菜单原语。
 *
 * 结构照抄 Lumina `src/components/toolbar/ContextMenu.tsx`（Apache-2.0），
 * 三个行为细节刻意保留（都是踩过坑才有的）：
 *   ① 用 `mousedown` 而不是 `click` 关菜单 —— 否则右键后紧接着的第一次左键点击会被吞掉
 *   ② Escape 关闭
 *   ③ 超出视口时自动翻转位置（右边界→左移，下边界→上移）
 *
 * 适配点：Lumina 用 `bg-popover` / `shadow-elev-2` / 自定义动画；
 * 这里 popover token 已在 styles.css 的 @theme 里补上，阴影改用 Tailwind 内置 shadow-lg，
 * 动画省略（内核壳的动效统一由后续 motion token 处理）。
 *
 * ## 子菜单（2026-10-12 加）
 *
 * `MenuItem.children` 非空 = 这一项是**子菜单**（如编辑器右键的「标记」——
 * 12 个 Markdown 标记塞进主菜单会有 13 行，滚都滚不完）。三条实现约束：
 *   · 子面板用 `position: fixed` —— 主菜单是 `overflow-y-auto`，普通绝对定位会被裁掉；
 *     fixed 相对视口，用父项 rect 算坐标即可（打开时若贴边界，量完再翻到左侧/上移）。
 *   · 子面板**留在主菜单的 DOM 内**（不 portal）—— 主菜单靠 `menuRef.contains(target)`
 *     判"点了外面"，portal 出去的子菜单会被当成外面 ⇒ 一点就整个关掉。
 *   · 鼠标从父项移到子面板之间的几像素**不能立刻关**，留 180ms 宽限（进入任一侧就取消）。
 */
export interface MenuItem {
  label: string
  icon?: React.ReactNode
  /** 点了做什么。**有 `children` 的父项可以不写** —— 它只负责展开子菜单，本身不是动作 */
  onClick?: () => void
  danger?: boolean
  /** 在这一项上方画一条分隔线 */
  divider?: boolean
  /**
   * 点了不关菜单 —— 用于「原地二次确认」：
   * 第一项点了把菜单内容换成「确认删除 / 取消」，而不是关掉再开一个新菜单。
   */
  keepOpen?: boolean
  /** 右侧的快捷键提示，如 "Ctrl+K"（菜单栏用） */
  hint?: string
  /**
   * **子菜单项**。非空 ⇒ 这一项是父项：鼠标悬停（或点击）在右侧展开一层，
   * `onClick` 不再执行（父项本身不是动作）。
   */
  children?: MenuItem[]
}

/** 所有菜单行（主菜单与子菜单）共用的一套外观 */
function rowClass(danger?: boolean): string {
  return cn(
    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
    danger ? 'text-destructive hover:bg-destructive/10' : 'text-foreground hover:bg-accent',
  )
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  anchor = 'pointer',
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  /**
   * 定位方式（2026-10-18 用户定）：
   *  · `pointer`（默认，桌面）—— **跟在鼠标右下角**（+8/+10），超出视口自动翻转；
   *  · `below-pointer`（手机）—— 挂在**长按点下方固定 72px**（离长按位置拉开一段距离），
   *    左缘在长按点右 16px；下方放不下就翻到长按点上方 12px。
   *  · `above-pointer` —— 长按点上方固定 12px（备选）。
   *  · `bottom-right` —— 固定在视口右下角（备选）。
   */
  anchor?: 'pointer' | 'bottom-right' | 'above-pointer' | 'below-pointer'
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  /**
   * 定位：`bottom-right` 直接贴视口右下；`pointer` 贴在指针**右下角**，
   * 放不下时翻到指针左侧/上方（经典右键菜单行为）。
   * 首帧先隐藏，量完尺寸再显示 —— 否则 `bottom-right` 会在 (x,y) 闪一下。
   */
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left: number
    let top: number
    if (anchor === 'bottom-right') {
      left = window.innerWidth - rect.width - 8
      top = window.innerHeight - rect.height - 8
    } else if (anchor === 'below-pointer') {
      // 手机：菜单固定在**点按处右下**（右 16 / 下 56 的固定距离）；
      // 屏幕边缘放不下就**贴边 clamp**（不翻到反侧，保持"右下"这个方向）
      const DX = 16
      const DY = 56
      left = Math.max(8, Math.min(x + DX, window.innerWidth - rect.width - 8))
      top = y + DY
      if (top + rect.height > window.innerHeight - 8) top = Math.max(8, y - rect.height - DY)
    } else if (anchor === 'above-pointer') {
      // 手机长按：菜单放在**长按点上方**（手指在下面挡着），固定拉开 12px
      left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))
      top = y - rect.height - 12
      if (top < 8) top = Math.min(window.innerHeight - rect.height - 8, y + 12)
    } else {
      left = x + 8
      top = y + 10
      if (left + rect.width > window.innerWidth) left = Math.max(0, x - rect.width - 8)
      if (top + rect.height > window.innerHeight) top = Math.max(0, y - rect.height - 10)
    }
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = 'visible'
  }, [x, y, anchor, items])

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[70] max-h-[85vh] min-w-[190px] overflow-y-auto rounded-ui-md border border-border bg-popover py-1 text-popover-foreground shadow-lg"
      style={{ left: x, top: y, visibility: 'hidden' }}
      role="menu"
    >
      <MenuItems items={items} onClose={onClose} />
    </div>,
    document.body,
  )
}

/** 一组菜单项 —— 主菜单与子菜单都是它（子菜单就是再来一组） */
function MenuItems({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  return (
    <>
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          {/* divider 画在「该项上方」；第一项上面就是菜单边框，再画一条就多余了 */}
          {item.divider && i > 0 && <div className="my-1 border-t border-border" />}
          {item.children?.length ? (
            <SubMenuRow item={item} onClose={onClose} />
          ) : (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                item.onClick?.()
                if (!item.keepOpen) onClose()
              }}
              className={rowClass(item.danger)}
            >
              {item.icon ? <span className="flex h-4 w-4 items-center">{item.icon}</span> : null}
              <span className="flex-1">{item.label}</span>
              {item.hint ? (
                <span className="ml-4 shrink-0 text-[10px] tracking-wide text-muted-foreground">
                  {item.hint}
                </span>
              ) : null}
            </button>
          )}
        </div>
      ))}
    </>
  )
}

/** 带子菜单的一行：悬停/点击展开，位置按父项 rect 现算 */
function SubMenuRow({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const timer = useRef<number | null>(null)
  /**
   * 点击展开 = **钉住**（鼠标离开也不收），悬停展开 = 临时（离开就收）。
   *
   * 钉住不是锦上添花：**触摸屏根本没有 hover** —— 手机/平板上长按出菜单后
   * 只能"点一下展开"，若那时还按鼠标规矩离开就收，子菜单在触摸下永远点不中。
   */
  const pinned = useRef(false)

  const cancelClose = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }
  // 卸载时清掉待执行的关闭（否则定时器会在组件没了之后再 setState）
  useEffect(() => cancelClose, [])

  const show = (pin: boolean) => {
    cancelClose()
    pinned.current = pin
    const r = btnRef.current?.getBoundingClientRect()
    // 先按父项右侧给个初值（第一帧就在正确位置），量到实际尺寸后再修正
    if (r) setPos({ left: r.right + 2, top: r.top - 5 })
    setOpen(true)
  }

  const scheduleClose = () => {
    if (pinned.current) return
    cancelClose()
    timer.current = window.setTimeout(() => setOpen(false), 180)
  }

  useLayoutEffect(() => {
    if (!open) return
    const btn = btnRef.current
    const panel = panelRef.current
    if (!btn || !panel) return
    const r = btn.getBoundingClientRect()
    const w = panel.getBoundingClientRect().width
    // 右边界翻转用**宽度**（首帧量宽度是准的）；纵向**不量高度、也不上移** ——
    // 首帧量到的高度常常还没算上字体度量/换行，据此上移会算错，
    // 改用渲染时的 `max-height: calc(100vh - top)` 兜底（超出部分内部滚动）。
    let left = r.right + 2
    if (left + w > window.innerWidth - 4) left = Math.max(4, r.left - w - 2)
    setPos((cur) => (cur && cur.left === left ? cur : { left, top: r.top - 5 }))
  }, [open])

  const children = item.children ?? []

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        // 已经展开（不管是钉住的还是悬停出来的）就别动它 —— 别把钉住状态冲掉
        if (!open) show(false)
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={btnRef}
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          /**
           * 三种情形要分开（否则"鼠标划过去顺手一点"会把刚看到的子菜单关掉）：
           *   · 已**钉住** → 点击 = 收起
           *   · 只是**悬停展开**（鼠标一路划过来，`onMouseEnter` 已经开过）→ 点击 = 钉住，
           *     不是收起。触摸设备没有 hover，走的也是这一支。
           *   · 没展开 → 点击 = 展开并钉住
           */
          if (open && pinned.current) {
            pinned.current = false
            setOpen(false)
          } else {
            show(true)
          }
        }}
        className={rowClass(item.danger)}
      >
        {item.icon ? <span className="flex h-4 w-4 items-center">{item.icon}</span> : null}
        <span className="flex-1">{item.label}</span>
        <span className="ml-4 shrink-0 text-[10px] text-muted-foreground">›</span>
      </button>
      {open && pos ? (
        <div
          ref={panelRef}
          role="menu"
          className="fixed z-[71] max-h-[85vh] min-w-[170px] overflow-y-auto rounded-ui-md border border-border bg-popover py-1 text-popover-foreground shadow-lg"
          style={{
            left: pos.left,
            top: pos.top,
            // 贴着视口底部就**别再长出去** —— 多余的部分内部滚动。
            // 比"量高度再整体上移"稳：首帧高度不可靠（见上面的 useLayoutEffect）。
            maxHeight: `calc(100vh - ${Math.max(pos.top, 0) + 8}px)`,
          }}
        >
          <MenuItems items={children} onClose={onClose} />
        </div>
      ) : null}
    </div>
  )
}
