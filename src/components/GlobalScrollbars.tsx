/**
 * 全局自绘滚动条（rev173.34 · 2026-10-19 用户要求：
 * 「所有滚动条统一，隐藏轨道，做沉浸式滑块」）。
 *
 * ## 为什么不用原生
 * 原生滚动条的**滑块长度**由「可视 / 内容」比例决定，CSS 改不了
 * （实测 `::-webkit-scrollbar-thumb { height }` 被忽略，`min-height` 只对极短内容有用）；
 * 轨道背景也只能靠 `::-webkit-scrollbar-track` 做，但做不到「悬浮、不占布局、随滚动淡出」。
 * 所以：把扫描到的每个可滚动容器的原生滚动条藏掉（加 `.zn-sb-host` class），
 * 在**一个全屏 fixed 层**里给每个容器画一条 6px 的悬浮滑块。
 *
 * ## 工作方式
 * 1. `scan()` 找出所有 `overflow-y: auto|scroll` 且 `scrollHeight > clientHeight` 的元素；
 * 2. 每个元素对应一条 `.zn-sb-thumb`（绝对定位在 fixed 层里），位置按容器 rect + 滚动比例实时算；
 * 3. 滑块长度 = clamp(比例 × 轨道, 28px, 120px) —— 封顶「短」；
 * 4. 无轨道、半透明、滚动时出现、静止 900ms 后淡出（鼠标悬停滑块时不淡出）；
 * 5. 滑块可拖动；滚动 / resize / DOM 变化时重算。
 *
 * 为什么用 fixed 层而不是给容器加子元素：滚动容器里的 absolute 子元素会**跟着内容滚**，
 * 要覆盖层就必须放进容器外 —— 逐容器加 wrapper 会改动大量 DOM 结构，fixed 层零侵入。
 */
import { useEffect } from 'react'

const THUMB_MIN_H = 28
const THUMB_MAX_H = 120
const THUMB_W = 6
/** 静止多久后淡出（ms） */
const FADE_AFTER_MS = 900
/** 全文档重扫间隔（ms）—— 兜底：容器内容变化不触发 ResizeObserver 时也能修正 */
const RESCAN_MS = 4000

type Entry = {
  el: HTMLElement
  bar: HTMLDivElement
  ro: ResizeObserver
  hideTimer: number
}

export function GlobalScrollbars() {
  useEffect(() => {
    const layer = document.createElement('div')
    layer.className = 'zn-scroll-layer'
    document.body.appendChild(layer)

    const map = new Map<HTMLElement, Entry>()
    let raf = 0
    let scanTimer = 0
    let alive = true

    const isScrollable = (el: HTMLElement) => {
      if (el === layer || el.closest('.zn-scroll-layer')) return false
      if (el.tagName === 'IFRAME' || el.tagName === 'TEXTAREA') return false
      const s = getComputedStyle(el)
      if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') return false
      return el.scrollHeight > el.clientHeight + 2
    }

    const update = (e: Entry) => {
      const r = e.el.getBoundingClientRect()
      const ch = e.el.clientHeight
      const sh = e.el.scrollHeight
      if (r.width <= 0 || r.height <= 0 || ch <= 0) {
        e.bar.style.display = 'none'
        return
      }
      const natural = (ch / sh) * r.height
      const h = Math.min(THUMB_MAX_H, Math.max(THUMB_MIN_H, natural))
      const maxScroll = sh - ch
      const ratio = maxScroll > 0 ? e.el.scrollTop / maxScroll : 0
      const top = r.top + ratio * (r.height - h)
      const left = r.right - THUMB_W - 3
      e.bar.style.display = 'block'
      e.bar.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
      e.bar.style.height = `${Math.round(h)}px`
    }

    const updateAll = () => {
      raf = 0
      if (!alive) return
      map.forEach(update)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(updateAll)
    }

    const show = (e: Entry) => {
      e.bar.classList.add('is-visible')
      window.clearTimeout(e.hideTimer)
      e.hideTimer = window.setTimeout(() => {
        if (!e.bar.matches(':hover')) e.bar.classList.remove('is-visible')
      }, FADE_AFTER_MS)
    }

    const scan = () => {
      if (!alive) return
      // 失效的（元素移除 / 不再可滚动）→ 拆掉
      map.forEach((e, el) => {
        if (!el.isConnected || !isScrollable(el)) {
          e.ro.disconnect()
          e.bar.remove()
          map.delete(el)
        }
      })
      // 新出现的 → 挂一条
      document.querySelectorAll<HTMLElement>('body *').forEach((el) => {
        if (map.has(el)) return
        if (!isScrollable(el)) return
        el.classList.add('zn-sb-host')
        const bar = document.createElement('div')
        bar.className = 'zn-sb-thumb'
        layer.appendChild(bar)
        const entry: Entry = { el, bar, ro: new ResizeObserver(schedule), hideTimer: 0 }
        entry.ro.observe(el)
        map.set(el, entry)
        update(entry)
      })
    }

    const onScroll = (ev: Event) => {
      const el = ev.target
      if (!(el instanceof HTMLElement)) return
      const e = map.get(el)
      if (!e) return
      update(e)
      show(e)
    }

    // 拖动滑块（与原生一致：按下后按位移换算 scrollTop）
    const onThumbPointerDown = (ev: PointerEvent) => {
      const thumb = ev.target
      if (!(thumb instanceof HTMLElement) || !thumb.classList.contains('zn-sb-thumb')) return
      const entry = [...map.values()].find((v) => v.bar === thumb)
      if (!entry) return
      ev.preventDefault()
      const startY = ev.clientY
      const startTop = entry.el.scrollTop
      const r = entry.el.getBoundingClientRect()
      const maxScroll = entry.el.scrollHeight - entry.el.clientHeight
      const track = Math.max(1, r.height - thumb.offsetHeight)
      const onMove = (mv: PointerEvent) => {
        entry.el.scrollTop = startTop + ((mv.clientY - startY) / track) * maxScroll
      }
      const onUp = () => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
      }
      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
    }

    scan()
    const mo = new MutationObserver(() => {
      window.clearTimeout(scanTimer)
      scanTimer = window.setTimeout(scan, 150)
    })
    mo.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', schedule)
    layer.addEventListener('pointerdown', onThumbPointerDown)
    const interval = window.setInterval(() => {
      scan()
      map.forEach(update)
    }, RESCAN_MS)

    return () => {
      alive = false
      mo.disconnect()
      window.clearTimeout(scanTimer)
      window.clearInterval(interval)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', schedule)
      layer.removeEventListener('pointerdown', onThumbPointerDown)
      if (raf) cancelAnimationFrame(raf)
      map.forEach((e) => {
        e.ro.disconnect()
        window.clearTimeout(e.hideTimer)
        e.bar.remove()
        e.el.classList.remove('zn-sb-host')
      })
      layer.remove()
    }
  }, [])

  return null
}
