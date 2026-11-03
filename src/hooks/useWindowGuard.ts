/**
 * 白屏兜底的两个钩子（rev173.104）—— 实现与判据见 `src/lib/window-guard.ts` 的文件头。
 *
 * ```
 *   窗口（?pluginWindow= / ?note=）          主窗口
 *   ┌────────────────────┐   emitTo('main')  ┌──────────────────────┐
 *   │ useWindowHeartbeat │ ────────────────▶ │ useStuckWindowReaper │
 *   │ 每 3 s 报一次活     │  { label, ok }    │ 每 5 s 扫窗口列表     │
 *   └────────────────────┘                   │ 卡死 ⇒ destroy()      │
 *                                            └──────────────────────┘
 * ```
 *
 * 为什么清理端在主窗口而不是各窗口自己：窗口里的 JS 全挂时**它自己不会自救**，
 * 只有另一个活着的进程（主窗口）能把它关掉。
 */
import { useEffect } from 'react'
import {
  applyBeat,
  BEAT_MS,
  domLooksAlive,
  MAIN_CHECK_MS,
  MAIN_RESCUE_FLAG,
  mainDomLooksAlive,
  pickStuckWindows,
  RENDER_CHECK_MS,
  RENDER_PROBE_WARMUP_MS,
  RENDER_RESCUE_FLAG,
  SCAN_MS,
  shouldRescueMain,
  shouldRescueRender,
  WINDOW_BEAT_EVENT,
  type WindowBeat,
} from '../lib/window-guard'

/**
 * 窗口端：每 `BEAT_MS` 向主窗口报一次活（带自检结果）。
 *
 * **不检查 Tauri 环境**：`import('@tauri-apps/api/…')` 在浏览器预览里也能解析，
 * 只是 `emitTo` 会抛 —— 已 catch，等价于静默不发。
 */
export function useWindowHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let timer = 0
    let disposed = false
    void (async () => {
      try {
        const [{ getCurrentWindow }, { emitTo }] = await Promise.all([
          import('@tauri-apps/api/window'),
          import('@tauri-apps/api/event'),
        ])
        if (disposed) return
        const label = getCurrentWindow().label
        const beat = () => {
          if (disposed) return
          void emitTo('main', WINDOW_BEAT_EVENT, {
            label,
            ok: domLooksAlive(document),
          }).catch(() => {
            /* 主窗口不在 / 事件通道关着 —— 下次再试 */
          })
        }
        beat() // 先报一次，别让宽限期白等
        timer = window.setInterval(beat, BEAT_MS)
      } catch {
        /* 非 Tauri 环境（浏览器预览）—— 没有窗口可守护 */
      }
    })()
    return () => {
      disposed = true
      if (timer) window.clearInterval(timer)
    }
  }, [enabled])
}

/**
 * 主窗口端：定期扫窗口列表，把**没心跳 / 心跳停了 / 自报白屏**的 `plugin-*` / `note-*` 关掉。
 *
 * @param enabled 只在主窗口开（窗口模式里调它没有意义，还会自己关自己）
 * @param onReaped 关掉一个窗口后的回调（宿主用来 toast；label 是窗口名）
 */
export function useStuckWindowReaper(enabled: boolean, onReaped: (label: string) => void): void {
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let unlisten: (() => void) | undefined
    let timer = 0
    /** 心跳表（label → 最近一次） */
    const beats: Record<string, WindowBeat> = {}
    /** 主窗口首次看到某窗口的时间（宽限期起点） */
    const firstSeen: Record<string, number> = {}

    const scan = async () => {
      if (disposed) return
      try {
        const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow')
        const wins = await getAllWebviewWindows()
        if (disposed) return
        const now = Date.now()
        const labels = wins.map((w) => w.label)
        for (const label of labels) if (firstSeen[label] == null) firstSeen[label] = now
        for (const label of Object.keys(firstSeen)) {
          if (!labels.includes(label)) delete firstSeen[label]
        }
        const stuck = pickStuckWindows(labels, beats, firstSeen, now)
        for (const label of stuck) {
          const win = wins.find((w) => w.label === label)
          if (!win) continue
          try {
            /**
             * 用 `destroy()` 不用 `close()`：close 只发 close-requested，要靠**目标窗口里**的
             * 监听器去 destroy —— 而这里的目标正是"页面已经不可用"的那个窗口（rev53 的机制结论）。
             */
            await win.destroy()
            delete beats[label]
            delete firstSeen[label]
            onReaped(label)
          } catch {
            /* 已经被关 / 权限不足（浏览器预览）—— 下一轮再看 */
          }
        }
      } catch {
        /* 浏览器预览没有窗口 API */
      }
    }

    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten = await listen<{ label?: unknown; ok?: unknown }>(WINDOW_BEAT_EVENT, (e) => {
          const p = e.payload
          if (!p || typeof p.label !== 'string') return
          Object.assign(beats, applyBeat(beats, p.label, p.ok === true, Date.now()))
        })
      } catch {
        /* 非 Tauri 环境 */
      }
      timer = window.setInterval(() => void scan(), SCAN_MS)
      void scan() // 启动时立刻扫一轮（清掉上个会话残留的僵尸窗口）
    })()

    return () => {
      disposed = true
      if (timer) window.clearInterval(timer)
      unlisten?.()
    }
  }, [enabled, onReaped])
}

/**
 * **主窗口自救**（rev173.247 · 见 `lib/window-guard.ts` 那段注释）。
 *
 * 与上面两个钩子的分工：那对钩子守**子窗口**（页面挂了由主窗口关掉它）；
 * 这个守**主窗口自己** —— 主窗口白屏时没有"另一个窗口"能来关它，
 * 只能页面自己发现问题后 reload（JS 还活着才有这一手）。
 *
 * 只在主窗口调（`!standaloneWindow`）；`sessionStorage` 保证一次启动只自救一次。
 */
export function useMainWindowRescue(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let alreadyRescued = false
    try {
      alreadyRescued = sessionStorage.getItem(MAIN_RESCUE_FLAG) === '1'
    } catch {
      /* 隐私模式 / 禁用存储：当作没自救过（宁可救一次，也不要永远不救） */
    }
    // 这次启动已经救过 ⇒ 不再 reload。白屏原因没解决时反复刷只会更难排查。
    if (alreadyRescued) return

    let streak = 0
    let disposed = false
    const timer = window.setInterval(() => {
      if (disposed) return
      const ok = mainDomLooksAlive(document)
      if (shouldRescueMain(ok, streak, false)) {
        disposed = true
        window.clearInterval(timer)
        try {
          sessionStorage.setItem(MAIN_RESCUE_FLAG, '1')
        } catch {
          /* 存不了就救不了 —— 宁可这次不救，也不要变成死循环 */
          return
        }
        console.warn('[zn] 主窗口连续', streak + 1, '次白屏，自动重载一次')
        // 未落盘内容由 `useDocIO` 的 beforeunload 钩子写进草稿（reload 后走恢复）
        location.reload()
        return
      }
      streak = ok ? 0 : streak + 1
    }, MAIN_CHECK_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [enabled])
}

/**
 * 渲染停摆自救（rev173.346 · 2026-11-04 真机实测修正）。
 *
 * 与 `useMainWindowRescue` 互补：那条判「DOM 还在不在」，这条判「**渲染进程还干活吗**」。
 *
 * ⚠️ rev173.345 的第一版用 `requestAnimationFrame` 时间戳，真机验证**失败**：白屏 60 秒没触发。
 * 现场数据（2026-11-04 00:12）：App 主进程 CPU **59%**（JS 在跑、rAF 照转），WebView 渲染进程
 * CPU **0.0%**（完全不干活）⇒ rAF 由主进程调度器驱动，**渲染停了它照转**，判据无效。
 *
 * 改用**依赖渲染进程**的信号：一个 1px 的 CSS 动画探针。`animationiteration` 由合成器驱动，
 * 渲染进程停摆时不推进、事件不派发。
 *
 * 三条防护：
 *  1. **探针自检**：暖机期（`RENDER_PROBE_WARMUP_MS`）内零 tick ⇒ 判定这种环境下探针不跑，
 *     放弃自救 —— 宁可不救，也不能每次启动都无条件 reload 一次；
 *  2. 页面不可见（切后台/熄屏）不算停摆，重置基准；
 *  3. 只救一次（`RENDER_RESCUE_FLAG`）。
 */
export function useRenderStallRescue(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    let alreadyRescued = false
    try {
      alreadyRescued = sessionStorage.getItem(RENDER_RESCUE_FLAG) === '1'
    } catch {
      /* 存不了就当没救过（宁可救一次） */
    }
    if (alreadyRescued) return

    /* 探针：1px、不可点、不占布局。opacity 在 0 和 0.001 之间跳 —— 全程 0 会被浏览器判
       「不绘制」而跳过动画；0.001 足够让合成器认为它在动，肉眼不可见。 */
    const style = document.createElement('style')
    style.textContent = '@keyframes zn-render-probe{0%{opacity:0}50%{opacity:.001}to{opacity:0}}'
    const probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;left:0;top:0;width:1px;height:1px;pointer-events:none;z-index:-1;' +
      'animation:zn-render-probe 1s linear infinite'
    document.head.appendChild(style)
    ;(document.body ?? document.documentElement).appendChild(probe)

    let disposed = false
    let ticks = 0
    let lastTick = performance.now()
    const startedAt = performance.now()

    const onTick = () => {
      ticks += 1
      lastTick = performance.now()
    }
    probe.addEventListener('animationiteration', onTick)

    const cleanup = () => {
      disposed = true
      window.clearInterval(timer)
      probe.removeEventListener('animationiteration', onTick)
      probe.remove()
      style.remove()
    }

    const timer = window.setInterval(() => {
      if (disposed) return
      const now = performance.now()
      // 探针自检：暖机期内一次都没跑 ⇒ 这种环境里探针无效，放弃（绝不误伤）。
      if (ticks === 0) {
        if (now - startedAt > RENDER_PROBE_WARMUP_MS) cleanup()
        return
      }
      const visible = document.visibilityState === 'visible'
      if (!visible) {
        // 后台/熄屏时动画本来就会停 —— 重置基准，回前台重算
        lastTick = now
        return
      }
      const idleMs = now - lastTick
      if (!shouldRescueRender({ visible, idleMs, alreadyRescued: false })) return
      disposed = true
      window.clearInterval(timer)
      try {
        sessionStorage.setItem(RENDER_RESCUE_FLAG, '1')
      } catch {
        return
      }
      console.warn('[zn] 渲染停摆', Math.round(idleMs / 1000), '秒，自动重载一次')
      location.reload()
    }, RENDER_CHECK_MS)

    return cleanup
  }, [enabled])
}
