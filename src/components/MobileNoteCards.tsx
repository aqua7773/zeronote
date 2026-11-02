/**
 * 移动端起始页 —— **flomo 风格卡片流**（2026-10-18 用户给截图要求「移动端起始页做成这样」）。
 *
 * 每张卡片：时间 + 正文摘要；卡片点开笔记；右上「⋯」给打开 / 删除 / 彻底删除；
 * 底部固定「＋ 点击输入」——点了走 `core.newNote`（新建并打开，等同桌面起始页那个按钮）。
 *
 * 桌面端不渲染（仍用 AppEmptyState 的起始页）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { ItemMenuContext, ItemMenuRegistration, NoteMeta } from '../kernel/contract'
import { ContextMenu, type MenuItem } from '@/components/ui'
import { RenameDialog } from './RenameDialog'
import { LONG_PRESS_MS, hapticTick, spawnRipple } from '../lib/long-press-feedback'

type Props = {
  notes: NoteMeta[]
  onOpen: (path: string) => void
  onNewNote: () => void
  /** 长按 ＋ = 打开环形快捷入口（rev173.20）；短按仍走 onNewNote。
   *  桌面时间流面板（`variant="panel"`）不传 = 没有长按。 */
  onQuickLaunch?: () => void
  readText: (path: string) => Promise<string>
  onDelete: (path: string) => void
  onPurge: (path: string) => void
  /** 重命名（同目录）：组件给完整新路径 */
  onRename: (from: string, to: string) => void
  /**
   * 渲染形态（rev173.33）：
   * · `mobile`（默认）= 手机起始页，底部**浮动**的 ＋（fixed）；
   * · `panel` = 桌面「时间流」面板，＋ 还原成流内按钮（面板宽度由外层容器给）。
   * 卡片本身两种形态完全一样。
   */
  variant?: 'mobile' | 'panel'
  /**
   * 桌面时间流面板的「关闭时间流」（rev173.48 · 用户要求）。
   * 只由 App 在 `variant="panel"` 时传；手机起始页不传 ⇒ 卡片菜单里不出现这一项。
   */
  onCloseTimeline?: () => void
  /**
   * Android 返回键的「层出口」栈（App 的 `layerExitsRef`，与 `FileTree` 同一约定）：
   * 卡片菜单打开时把关闭函数压进去，返回键**先关菜单**，而不是直接退 App（rev173.66）。
   * 桌面 / 没有返回键的环境不传也能用。
   */
  layers?: RefObject<Array<() => boolean>>
  /**
   * **条目菜单动作**（rev173.281 · J#18）—— 与 `FileTree` 共用同一套协议，
   * 这里消费 `where: 'timeline'` 的那些（手机卡片流 / 桌面时间流面板同一套）。
   */
  itemActions?: ItemMenuRegistration[]
  onItemAction?: (action: ItemMenuRegistration, ctx: ItemMenuContext) => void
}

/** 长按判定用共享的 `LONG_PRESS_MS`（300ms）；这里只留「移动多少像素算滑动」 */
const LONG_PRESS_MOVE_PX = 10

/**
 * 触摸设备：菜单**不在长按瞬间弹**，等松手再弹（rev173.321 · 用户 2026-11-02：
 * 「移动端菜单改成长按时不弹，在长按释放的时候弹菜单」）。与 `FileTree` 同一口径。
 */
const TOUCH_UI = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** mtime（毫秒）→ `2026-10-18 14:08:32`（2026-10-18 用户要求：精确到秒） */
const fmtTime = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 把 Markdown 压成纯文本摘要（去 frontmatter / 标题符号 / 列表与强调标记 / 代码块） */
const plain = (md: string) => {
  let t = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
  t = t.replace(/```[\s\S]*?```/g, ' ')
  t = t.replace(/^#{1,6}\s+/gm, '')
  t = t.replace(/^\s*[-*+]\s+/gm, '')
  t = t.replace(/^\s*\d+\.\s+/gm, '')
  t = t.replace(/^\s*>\s?/gm, '')
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/[*_~`#]/g, '')
  return t.replace(/\s+/g, ' ').trim()
}

export function MobileNoteCards({
  notes,
  onOpen,
  onNewNote,
  onQuickLaunch,
  readText,
  onDelete,
  onPurge,
  onRename,
  variant = 'mobile',
  onCloseTimeline,
  layers,
  itemActions = [],
  onItemAction,
}: Props) {
  /**
   * 按修改时间倒序，最多 100 条（足够看，也不会一次读太多文件）。
   *
   * 只列**笔记**（rev173.273 · 真人使用测试 #7）：附件（图片 / 文档 / 音视频）也会进
   * `notes` 列表（文件树要按类型分组显示它们），但时间流 / 卡片流里出现一张 png
   * 点的还是「打开附件」—— 用户要的是「按时间看写过的东西」，附件在文件树「附件」分组里。
   */
  const sorted = useMemo(
    () =>
      notes
        /* `kind` 缺省按笔记算：内核现在每条都带，但老的 store / 测试 fixture 可能没有 —— 缺字段
           不该让整条时间流空掉（app-smoke 的移动端用例就是这么炸出来的）。 */
        .filter((n) => (n.kind ?? 'note') === 'note')
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 100),
    [notes],
  )
  const [contents, setContents] = useState<Record<string, string>>({})
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  /**
   * 长按释放才弹菜单（rev173.321）。三个局部状态：
   *  · `pressRef` 记按下时刻与位置；
   *  · `movedRef` 标记"手指划动过"（划动 = 滚列表，不是长按）；
   *  · `suppressClickRef` 吃掉松手后系统补发的那次 click（否则顺手把笔记打开了）。
   */
  const pressRef = useRef<{ t: number; x: number; y: number } | null>(null)
  const suppressClickRef = useRef(false)
  /**
   * 卡片长按到点的反馈定时器（rev173.325 · 真人测试6 #3）：
   * 按住满 300ms 振一下 + 按下点涟漪，告诉用户"现在抬手会弹菜单"。
   */
  const cardFeedbackRef = useRef<number | null>(null)
  const clearCardFeedback = useCallback(() => {
    if (cardFeedbackRef.current !== null) {
      window.clearTimeout(cardFeedbackRef.current)
      cardFeedbackRef.current = null
    }
  }, [])

  /**
   * 卡片菜单压进 Android 返回键的层出口栈（rev173.66）。
   *
   * 为什么：菜单状态在本组件里，App 的 `backRef` 看不到 —— 菜单开着按返回会被判成
   * "都没得关" ⇒ 直接 `exit(0)`，**应用退出而菜单还开着**（与 rev68 修过的 ☰ 菜单同一缺口）。
   * 与 `FileTree` 同一套约定：拿 App 的 `layerExitsRef`，打开时 push、关闭 / 卸载时 remove。
   */
  useEffect(() => {
    const stack = layers?.current
    if (!menu || !stack) return
    const close = () => {
      setMenu(null)
      return true
    }
    stack.push(close)
    return () => {
      const i = stack.indexOf(close)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [menu, layers])

  /* ── 长按 ＋（rev173.20；rev173.321 改成松手才打开）──
   * 短按 = 新建笔记（不变）；按住 500ms 后**松手** = 打开环形快捷入口。
   * 四个 ref 分工：定时器、按下起点（判滑动）、「长按已上膛」标记、「吃掉松手后补发的 click」标记。 */
  const pressTimer = useRef<number | null>(null)
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  /** 定时器到点 = 上膛；真正触发在 pointerup（长按期间界面保持干净） */
  const armed = useRef(false)

  const cancelPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
    pressStart.current = null
    armed.current = false
  }, [])

  // 卸载时清掉挂起的定时器，别让它在组件没了之后调 onQuickLaunch
  useEffect(() => cancelPress, [cancelPress])
  // 卡片长按反馈定时器同理
  useEffect(() => clearCardFeedback, [clearCardFeedback])

  const onComposePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    // 每一次新按压都重置抑制标记（上一次长按留下的标记不能影响这次短按）
    suppressClick.current = false
    cancelPress()
    // 桌面时间流面板没有环形快捷入口（那是手机起始页的能力）—— 不注册长按
    if (!onQuickLaunch) return
    pressStart.current = { x: e.clientX, y: e.clientY }
    const at = { x: e.clientX, y: e.clientY }
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null
      pressStart.current = null
      // rev173.321：到点只上膛，**松手时**才真正打开环形入口
      armed.current = true
      // rev173.325 · 真人测试6 #3：到点振一下 + 按下点涟漪
      hapticTick()
      spawnRipple(at.x, at.y)
    }, LONG_PRESS_MS)
  }

  const onComposePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = pressStart.current
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) cancelPress()
  }

  /** 松手：长按够久才打开环形入口（长按期间什么都不弹） */
  const onComposePointerUp = () => {
    const fired = armed.current
    cancelPress()
    if (!fired) return
    suppressClick.current = true
    onQuickLaunch?.()
  }

  /** 短按才新建；长按那一下松手会补发 click，必须吃掉 */
  const onComposeClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    onNewNote()
  }

  useEffect(() => {
    let alive = true
    void (async () => {
      const next: Record<string, string> = {}
      await Promise.all(
        sorted.map(async (n) => {
          if (n.kind !== 'note') return
          try {
            next[n.path] = plain(await readText(n.path))
          } catch {
            next[n.path] = ''
          }
        }),
      )
      if (alive) setContents(next)
    })()
    return () => {
      alive = false
    }
  }, [sorted, readText])

  /**
   * 重命名：自绘对话框，**预填当前文件名**（rev173.276 · 反馈 #16 / #17）。
   *
   * 以前是 `window.prompt`：wry 的 `onJsPrompt` 不用 `defaultValue` ⇒ 永远空框；
   * Android 原生对话框还出过「输入到一半闪退」。现在不经过原生壳。
   */
  const [renameTarget, setRenameTarget] = useState<{ path: string; base: string } | null>(null)

  const startRename = (path: string) => {
    setRenameTarget({ path, base: path.slice(path.lastIndexOf('/') + 1) })
  }

  const submitRename = (raw: string) => {
    if (!renameTarget) return
    const { path, base } = renameTarget
    setRenameTarget(null)
    const name = raw.trim()
    if (!name || name === base) return
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const finalName = /\.md$/i.test(path) && !/\.[a-z0-9]+$/i.test(name) ? `${name}.md` : name
    onRename(path, dir ? `${dir}/${finalName}` : finalName)
  }

  /* 重命名对话框压进 Android 返回键的层出口栈 —— 与卡片菜单同一套约定 */
  useEffect(() => {
    const stack = layers?.current
    if (!renameTarget || !stack) return
    const close = () => {
      setRenameTarget(null)
      return true
    }
    stack.push(close)
    return () => {
      const i = stack.indexOf(close)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [renameTarget, layers])

  /** 长按 / 右上「⋯」都能弹这张菜单（2026-10-18 用户要求「长按卡片可以重命名和删除」） */
  const items: MenuItem[] = menu
    ? (() => {
        const list: MenuItem[] = [{ label: '打开', onClick: () => onOpen(menu.path) }]
        /**
         * ── 插件贡献的**条目菜单动作**（rev173.281 · J#18）──
         * 位置：紧挨「打开」（都是对这篇笔记的入口），与下面的管理动作用分隔线隔开。
         * 卡片流只列 `kind === 'note'` 的条目，所以这里恒为 `note`。
         */
        if (onItemAction) {
          const ctx: ItemMenuContext = { path: menu.path, kind: 'note', where: 'timeline' }
          const matches = itemActions
            .filter((a) => (a.where ?? ['file-tree', 'timeline']).includes('timeline'))
            .filter((a) => (a.kinds ?? ['note']).includes('note'))
          for (const a of matches) {
            list.push(
              a.children?.length
                ? {
                    label: a.title,
                    danger: a.danger,
                    divider: true,
                    children: a.children.map((c, i) => ({
                      label: c.title,
                      danger: c.danger,
                      // 子菜单第一行上面就是父项，不再画线
                      divider: i > 0 ? c.divider : undefined,
                      onClick: () => onItemAction({ ...c, pluginId: a.pluginId }, ctx),
                    })),
                  }
                : {
                    label: a.title,
                    danger: a.danger,
                    divider: true,
                    onClick: () => onItemAction(a, ctx),
                  },
            )
          }
        }
        list.push({ label: '重命名…', divider: true, onClick: () => startRename(menu.path) })
        list.push({
          label: '删除（回收站）',
          danger: true,
          divider: true,
          onClick: () => onDelete(menu.path),
        })
        list.push({
          label: '彻底删除…',
          danger: true,
          onClick: () => {
            if (window.confirm('彻底删除？不进回收站，永久抹掉 —— 撤不回来。')) onPurge(menu.path)
          },
        })
        // 桌面时间流：卡片菜单也能关掉这一栏（rev173.48 · 用户要求「时间流右键菜单加关闭时间流」）
        if (onCloseTimeline) {
          list.push({
            label: '关闭时间流',
            divider: true,
            onClick: () => {
              setMenu(null)
              onCloseTimeline()
            },
          })
        }
        return list
      })()
    : []

  return (
    <div className={variant === 'panel' ? 'zn-mobile-home zn-mobile-home--panel' : 'zn-mobile-home'}>
      <div className="zn-mobile-cards">
        {sorted.length === 0 && (
          <div className="zn-mobile-empty">还没有笔记 —— 点下面的输入框记一条。</div>
        )}
        {sorted.map((n) => {
          // 非 note（文档/附件）不读正文，直接拿标题 —— 否则永远停在「…」（2026-10-19 面板里看到）
          const c = contents[n.path]
          const body = n.kind !== 'note' ? n.title : c === undefined ? '…' : c || '（空笔记）'
          return (
            <article
              key={n.path}
              className="zn-mobile-card"
              onClick={() => {
                // 长按释放弹过菜单 ⇒ 这一次 click 是"松手"补发的，别打开笔记
                if (suppressClickRef.current) {
                  suppressClickRef.current = false
                  return
                }
                onOpen(n.path)
              }}
              onTouchStart={(e) => {
                if (!TOUCH_UI || e.touches.length !== 1) return
                const t = e.touches[0]
                pressRef.current = { t: Date.now(), x: t.clientX, y: t.clientY }
                clearCardFeedback()
                cardFeedbackRef.current = window.setTimeout(() => {
                  cardFeedbackRef.current = null
                  hapticTick()
                  spawnRipple(t.clientX, t.clientY)
                }, LONG_PRESS_MS)
              }}
              onTouchMove={(e) => {
                const p = pressRef.current
                if (!p) return
                const t = e.touches[0]
                if (!t) return
                const dx = t.clientX - p.x
                const dy = t.clientY - p.y
                if (dx * dx + dy * dy > LONG_PRESS_MOVE_PX * LONG_PRESS_MOVE_PX) {
                  // 划动了 ⇒ 用户在滚列表，这次不是长按
                  pressRef.current = null
                  clearCardFeedback()
                }
              }}
              onTouchEnd={() => {
                clearCardFeedback()
                const p = pressRef.current
                pressRef.current = null
                if (!p) return
                if (Date.now() - p.t < LONG_PRESS_MS) return
                // 长按**释放**才弹菜单（长按期间界面保持干净）
                suppressClickRef.current = true
                window.setTimeout(() => {
                  suppressClickRef.current = false
                }, 0)
                setMenu({ path: n.path, x: p.x, y: p.y })
              }}
              onTouchCancel={() => {
                pressRef.current = null
                clearCardFeedback()
              }}
              onContextMenu={(e) => {
                // 手机长按（Android 转 contextmenu）与桌面右键同一个菜单（2026-10-18 用户要求）
                e.preventDefault()
                // rev173.321：手机不在长按瞬间弹，等松手（见 onTouchEnd）
                if (TOUCH_UI) return
                setMenu({ path: n.path, x: e.clientX, y: e.clientY })
              }}
            >
              <div className="zn-mobile-card-time">
                <span>{fmtTime(n.mtime)}</span>
                <button
                  type="button"
                  className="zn-mobile-card-more"
                  aria-label="更多"
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenu({ path: n.path, x: e.clientX, y: e.clientY })
                  }}
                >
                  ⋯
                </button>
              </div>
              <div className="zn-mobile-card-body">{body}</div>
            </article>
          )
        })}
      </div>
      {/* ＋ 按钮只属于手机起始页（rev173.33：桌面时间流面板不要加号——用户要求） */}
      {variant !== 'panel' && (
        <button
          type="button"
          className="zn-mobile-compose"
          onClick={onComposeClick}
          onPointerDown={onComposePointerDown}
          onPointerMove={onComposePointerMove}
          onPointerUp={onComposePointerUp}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          aria-label="新建一条（长按打开快捷入口）"
          title="点击新建 · 长按快捷入口"
        >
          <span className="zn-mobile-compose-plus">＋</span>
        </button>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      {/* 条件渲染（不是 open 开关）：每次打开都是新实例，初值由 useState 拿到，不靠 effect 重置 */}
      {renameTarget && (
        <RenameDialog
          open
          initial={renameTarget.base}
          onCancel={() => setRenameTarget(null)}
          onConfirm={submitRename}
        />
      )}
    </div>
  )
}
