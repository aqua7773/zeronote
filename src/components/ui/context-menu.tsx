import { useEffect, useRef } from 'react'
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
 */
export interface MenuItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  /** 在这一项上方画一条分隔线 */
  divider?: boolean
  /**
   * 点了不关菜单 —— 用于「原地二次确认」：
   * 第一项点了把菜单内容换成「确认删除 / 取消」，而不是关掉再开一个新菜单。
   */
  keepOpen?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
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

  // 视口边界翻转
  useEffect(() => {
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.right > window.innerWidth) el.style.left = `${Math.max(0, x - rect.width)}px`
    if (rect.bottom > window.innerHeight) el.style.top = `${Math.max(0, y - rect.height)}px`
  }, [x, y])

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[160px] rounded-ui-md border border-border bg-popover py-1 text-popover-foreground shadow-lg"
      style={{ left: x, top: y }}
      role="menu"
    >
      {items.map((item, i) => (
        <div key={`${item.label}-${i}`}>
          {item.divider && <div className="my-1 border-t border-border" />}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              item.onClick()
              if (!item.keepOpen) onClose()
            }}
            className={cn(
              'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
              item.danger
                ? 'text-destructive hover:bg-destructive/10'
                : 'text-foreground hover:bg-accent',
            )}
          >
            {item.icon ? <span className="flex h-4 w-4 items-center">{item.icon}</span> : null}
            <span>{item.label}</span>
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
