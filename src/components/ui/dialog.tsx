import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 弹窗原语。
 *
 * 结构照抄 Lumina `src/components/ui/dialog.tsx`（Apache-2.0），**去掉 framer-motion 依赖**
 * （内核壳暂不引动画库），保留它的三个行为细节 —— 都是踩过坑才有的：
 *   ① ESC 关闭（并 stopPropagation，避免外层也响应）
 *   ② 关闭时把焦点还给**打开前的那个元素**（否则焦点掉回 body，键盘用户迷失）
 *   ③ 打开时聚焦面板内第一个可聚焦元素
 *
 * 配套的 DialogHeader / DialogBody / DialogFooter 负责固定头尾、只让中间滚动。
 */
export interface DialogProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  /** 面板宽度，默认 480 */
  width?: number | string
  className?: string
  /** 点遮罩是否关闭，默认 true。需要「必须明确选择」的弹窗传 false */
  dismissOnBackdropClick?: boolean
  children: ReactNode
}

export function Dialog({
  open,
  onOpenChange,
  width = 480,
  className,
  dismissOnBackdropClick = true,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const prevFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    prevFocus.current = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prevFocus.current?.focus()
    }
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open || !panelRef.current) return
    panelRef.current
      .querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      ?.focus()
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="zn-dialog-backdrop absolute inset-0 bg-foreground/40"
        onClick={dismissOnBackdropClick ? () => onOpenChange(false) : undefined}
      />
      <div
        ref={panelRef}
        style={{ width }}
        className={cn(
          'zn-dialog-panel relative flex max-h-[calc(100vh-4rem)] max-w-[calc(100vw-2rem)] flex-col',
          'rounded-ui-lg border border-border bg-popover text-popover-foreground shadow-2xl',
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="关闭"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-ui-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X size={14} />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function DialogHeader({
  title,
  description,
}: {
  title: ReactNode
  description?: ReactNode
}) {
  return (
    <div className="shrink-0 border-b border-border px-5 pb-3 pt-4">
      <h2 className="pr-8 text-sm font-semibold tracking-tight text-foreground">{title}</h2>
      {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}

export function DialogBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)}>{children}</div>
}

export function DialogFooter({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-3',
        className,
      )}
    >
      {children}
    </div>
  )
}
