/**
 * 起始页「长按 ＋」的环形快捷入口（rev173.20 · 2026-10-19 用户要求）。
 *
 * 形态借自手机「指纹一指直达」的**环形遮罩**（长按 → 弹一圈快捷 → 点一项进入），
 * 但入口全是**笔记内部功能**（插件面板 / 内置动作），不涉及指纹、支付、扫码。
 *
 * 结构：全屏遮罩 + 环形 5 槽（从正上方起每 72° 一个）+ 中心关闭圆。
 * 槽位定位用「整层旋转 + 条目反向旋转」的纯 CSS 做法 —— 不需要量容器尺寸、
 * 也不随屏幕宽度漂移（外层 rotate(θ)，条目自身 rotate(-θ) 保持文字正立）。
 *
 * 关闭有两个入口，故意用**不同事件**：
 *   · 点空白 → `onPointerDown`。长按触发时手指还按在 ＋ 上，松手会补一个 click；
 *     若空白用 click 关，遮罩会在刚弹出的一瞬间被那次 click 关掉。
 *     pointerdown 不会在松手时重放，天然避开这个坑。
 *   · 中心 × → 普通 click。
 */
import { useEffect, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'

/** 一个快捷入口。`disabled` = 指向的东西不可用（如插件没装），灰化但仍在环上占位 */
export type QuickEntry = {
  key: string
  label: string
  disabled?: boolean
  /** 灰化时圆内第二行小字（如「未安装」） */
  hint?: string
  onClick?: () => void
}

type Props = {
  open: boolean
  onClose: () => void
  /** 最多 5 个；不足的补空位（虚线圆，不可点） */
  entries: QuickEntry[]
}

/** 环上固定 5 个槽位（调研 §3.2：记账 + 4 空位，以后可放搜索 / 回收站 / 设置…） */
const SLOTS = 5
const STEP_DEG = 360 / SLOTS

export function QuickLaunch({ open, onClose, entries }: Props) {
  // Escape 关闭（桌面快捷键顺手也能用；手机不依赖）
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="zn-quick-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="快捷入口"
      onPointerDown={onClose}
    >
      {/* 环本体：吃掉冒泡，点圆环空白处不算「点空白关闭」 */}
      <div className="zn-quick-ring" onPointerDown={(e) => e.stopPropagation()}>
        {Array.from({ length: SLOTS }, (_, i) => {
          const entry = entries[i]
          const angle = `${i * STEP_DEG}deg`
          return (
            <div
              key={entry?.key ?? `slot-${i}`}
              className="zn-quick-slot"
              style={{ '--a': angle } as CSSProperties}
            >
              {entry ? (
                <button
                  type="button"
                  className={`zn-quick-item${entry.disabled ? ' is-empty' : ''}`}
                  disabled={entry.disabled}
                  title={entry.disabled ? `${entry.label}（${entry.hint ?? '不可用'}）` : entry.label}
                  onClick={() => {
                    entry.onClick?.()
                    onClose()
                  }}
                >
                  <span className="zn-quick-item-label">{entry.label}</span>
                  {entry.disabled && entry.hint ? (
                    <span className="zn-quick-item-hint">{entry.hint}</span>
                  ) : null}
                </button>
              ) : (
                <div className="zn-quick-item is-empty" aria-hidden="true" />
              )}
            </div>
          )
        })}
        <button type="button" className="zn-quick-center" onClick={onClose} aria-label="关闭快捷入口">
          ×
        </button>
      </div>
      <div className="zn-quick-hint">长按进入 · 点空白关闭</div>
    </div>,
    document.body,
  )
}
