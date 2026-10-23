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
  pickStuckWindows,
  SCAN_MS,
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
