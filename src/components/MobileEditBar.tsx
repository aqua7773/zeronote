/**
 * 手机编辑器长按工具条（rev173.90）。
 *
 * 来由（用户 2026-10-23）：「手机编辑界面长按，现在菜单和桌面端一样，不适配手机，
 * 手机编辑界面长按只需要复制粘贴剪切全选，四个功能，横向并列」。
 *
 * 实测依据（2026-10-23 · 真机 33b676f6）：
 * · 不拦 `contextmenu` 时，Android 给的是 WebView 默认菜单「复制 / 分享 / 全选 / 网页搜索」——
 *   没有粘贴、没有剪切，多出的分享/搜索在编辑器里也没有意义。
 * · 拦掉 `contextmenu`（全局本就这么做）后，长按只剩选中把手，**没有任何菜单**。
 * ⇒ 四个动作由我们自己给，且只给这四个。
 *
 * 为什么单独一个组件、不复用 `ContextMenu`：后者是竖排列表 + `Ctrl+N` 这类快捷键提示，
 * 那是桌面形态；触摸屏要的是一条横向四键、拇指一次够得到。
 *
 * 定位：长按点**正上方** 56px（手指在下方挡着），放不下翻到下方；左右贴边 clamp。
 * 关闭：点空白（scrim）或按 Escape。
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export function MobileEditBar({
  x,
  y,
  onCopy,
  onCut,
  onPaste,
  onSelectAll,
  onClose,
}: {
  x: number
  y: number
  onCopy: () => void
  onCut: () => void
  onPaste: () => void
  onSelectAll: () => void
  onClose: () => void
}) {
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  /** 先量尺寸再定位（首帧隐藏，避免在 (x,y) 闪一下） */
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const GAP = 56
    const left = Math.max(8, Math.min(x - rect.width / 2, window.innerWidth - rect.width - 8))
    let top = y - rect.height - GAP
    if (top < 8) top = Math.min(window.innerHeight - rect.height - 8, y + GAP)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    el.style.visibility = 'visible'
  }, [x, y])

  const items: Array<{ label: string; run: () => void }> = [
    { label: '复制', run: onCopy },
    { label: '剪切', run: onCut },
    { label: '粘贴', run: onPaste },
    { label: '全选', run: onSelectAll },
  ]

  return createPortal(
    <>
      {/* 点空白只关工具条，点击不漏给下面的编辑器 */}
      <div className="zn-menu-scrim" onClick={onClose} />
      <div
        ref={barRef}
        className="fixed z-[70] flex items-center gap-1 rounded-ui-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        style={{ left: x, top: y, visibility: 'hidden' }}
        role="toolbar"
        aria-label="编辑操作"
      >
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            onClick={() => {
              it.run()
              onClose()
            }}
            className="min-w-[56px] rounded-ui-sm px-3 py-2 text-sm text-foreground transition-colors hover:bg-accent active:bg-accent"
          >
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body,
  )
}