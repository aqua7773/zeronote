/**
 * 起始页「长按 ＋」的环形快捷入口（rev173.20 / rev173.21 / rev173.281）。
 *
 * 形态借自手机「指纹一指直达」的**环形遮罩**（长按 → 弹一圈快捷 → 点一项进入），
 * 但入口全是**笔记内部功能**（插件面板 / 内置动作），不涉及指纹、支付、扫码。
 *
 * 2026-10-19 用户拿锁屏上的环形菜单当样子重做了两处：
 *   ① **圆心 = ＋ 按钮**（不是屏幕中心）—— ＋ 先上移到用户圈的位置，环就长在它周围；
 *   ② 角度照参考图「上三下二」：0° / ±48° / ±96°，不再 72° 均分。
 *
 * **2026-10-30 用户拍板 J#9：共 6 个位置** ——
 *   · 中心「＋」= **新建笔记（固定）**；
 *   · 周围 5 格 = 功能入口（**可配**，配置存 `lib/quick-slots.ts`，入口在设置 → 通用）。
 *   改造前中心是「× 关闭」，用户更正过：「本来那个加号就是新建笔记」。
 *
 * 定位做法：`--a` 决定方向，槽是 0×0 的定位容器（`rotate(θ) translateY(-R)`），
 * 条目再反向转 -θ 保持文字正立 —— 纯 CSS，不用量尺寸、不随屏幕宽度漂移。
 *
 * 关闭：点空白 → `pointerdown` 阻止默认、`click` 关闭（**必须 preventDefault**，否则
 * 遮罩卸载后浏览器补发的 click 会落到下面的卡片上，真机实测会直接打开后面的笔记）；
 * 点中心 ＋ / 「换入口」→ 各自动作后再关。Escape 也关。
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
  /**
   * 最多 5 个槽位；`null`（或数组不够长）⇒ 该位置补虚线空位，不可点。
   * 槽位顺序 = `ANGLES` 的顺序（正上 → 右上 → 左上 → 右下 → 左下）。
   */
  entries: Array<QuickEntry | null>
  /**
   * 中心 ＋ 的动作：**新建笔记**（J#9 起固定）。
   * 不传 ⇒ 中心只负责关闭（兼容旧调用方 / 单测）。
   */
  onNewNote?: () => void
  /** 「换入口」→ 去设置里配置这 5 格（不传就不显示这个入口） */
  onEdit?: () => void
}

/**
 * 环上 5 个槽的角度（0° = 正上方，顺时针为正）—— 照用户 2026-10-19 锁屏截图的**上半圆**：
 * 正上 1 个 + 两侧斜上各 1 个（±48°）+ 水平线略下方左右各 1 个（±96°）。
 * 关键在两端那两点：它们和圆心**几乎同高**（只低 ~12px），整体才是一个"扣在"圆心上的半圆。
 * ⚠️ 别改成 ±140°：那样下方两个会掉到圆心下面，看起来是"下半圈"，用户已经否掉一次。
 */
const ANGLES = [0, 48, -48, 96, -96]

export function QuickLaunch({ open, onClose, entries, onNewNote, onEdit }: Props) {
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
        /**
         * 只在**遮罩空白处**按下时阻止默认（别让长按选择/弹出系统菜单）。
         *
         * ⚠️ 必须判 `target === currentTarget`（rev173.281 J#9 真机发现）：
         * 按钮上的 pointerdown 也会冒泡到这里，无条件 `preventDefault()` 会吞掉
         * 中心 ＋ 的后续 click —— 表现为「环开着，点 ＋ 没反应」。
         */
        if (e.target === e.currentTarget) e.preventDefault()
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
          const entry = entries[i] ?? null
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

      {/*
       * 中心圆：**与 ＋ 按钮重合**（同一套 bottom/尺寸）。
       * J#9（2026-10-30 用户拍板）起它是**新建笔记**，不再是 × 关闭 ——
       * 「本来那个加号就是新建笔记」。关闭走点空白 / Escape / 点任一入口。
       */}
      <button
        type="button"
        className="zn-quick-center"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onNewNote?.()
          onClose()
        }}
        aria-label="新建笔记"
        title="新建笔记"
      >
        ＋
      </button>
      <div className="zn-quick-hint">
        <span>点空白关闭</span>
        {onEdit ? (
          <button
            type="button"
            className="zn-quick-edit"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
          >
            换入口
          </button>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
