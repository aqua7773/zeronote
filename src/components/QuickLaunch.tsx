/**
 * 起始页「长按 ＋」的环形快捷入口（rev173.20 / rev173.21）。
 *
 * 形态借自手机「指纹一指直达」的**环形遮罩**（长按 → 弹一圈快捷 → 点一项进入），
 * 但入口全是**笔记内部功能**（插件面板 / 内置动作），不涉及指纹、支付、扫码。
 *
 * 2026-10-19 用户拿锁屏上的环形菜单当样子重做了两处：
 *   ① **圆心 = ＋ 按钮**（不是屏幕中心）—— ＋ 先上移到用户圈的位置，环就长在它周围；
 *   ② 角度照参考图「上三下二」：0° / ±40° / ±140°，不再 72° 均分。
 *
 * 定位做法：`--a` 决定方向，槽是 0×0 的定位容器（`rotate(θ) translateY(-R)`），
 * 条目再反向转 -θ 保持文字正立 —— 纯 CSS，不用量尺寸、不随屏幕宽度漂移。
 *
 * 关闭：点空白 → `pointerdown` 关闭（**必须 preventDefault**，否则遮罩卸载后
 * 浏览器补发的 click 会落到下面的卡片上，真机实测会直接打开后面的笔记）；
 * 点中心 × → click 关闭。Escape 也关。
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

/**
 * 环上 5 个槽的角度（0° = 正上方，顺时针为正）：
 * 正上 / 右上 / 左上 / 右下 / 左下 —— 「上三下二」，对照用户 2026-10-19 给的锁屏截图。
 */
const ANGLES = [0, 40, -40, 140, -140]

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
      onPointerDown={(e) => {
        // 只在遮罩空白处按下时**阻止默认**（别让长按选择/弹出系统菜单）；
        // 真正关闭放到 click —— 见下面的注释。
        e.preventDefault()
      }}
      onClick={(e) => {
        /**
         * 用 **click** 关闭，不用 pointerdown。
         *
         * 踩过的坑（2026-10-19 真机）：pointerdown 里就 onClose ⇒ React 立刻卸载遮罩，
         * 紧接着浏览器为这次点击补发的 click 就**没有遮挡物**了，落到下面那张卡片上
         * —— 表现为「点空白直接打开了后面的笔记」。
         * 改成 click 关闭：这次 click 已经派发给遮罩本身，卡片拿不到它。
         *
         * 那长按松手补发的那次 click 会不会误关？不会：touch 序列的 target 是
         * touchstart 命中的元素（＋ 按钮），click 沿「＋ → 卡片流 → body」冒泡，
         * 根本不经过遮罩；而且 ＋ 自己的 handler 有 suppressClick 挡着。
         */
        e.stopPropagation()
        onClose()
      }}
    >
      {/* 0×0 定位容器：坐标原点 = ＋ 按钮的中心（CSS 与 .zn-mobile-compose 同一套 bottom） */}
      <div className="zn-quick-ring">
        {ANGLES.map((deg, i) => {
          const entry = entries[i]
          const angle = `${deg}deg`
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
                  onClick={(e) => {
                    e.stopPropagation()
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
      </div>

      {/* 中心圆：与 ＋ 按钮重合，点它 = 关闭 */}
      <button
        type="button"
        className="zn-quick-center"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="关闭快捷入口"
      >
        ×
      </button>
      <div className="zn-quick-hint">点空白关闭</div>
    </div>,
    document.body,
  )
}
