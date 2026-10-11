import { invoke } from '@tauri-apps/api/core'

/**
 * Android 状态栏的按需显隐。
 *
 * 需求（用户 2026-10-12）：**侧栏（抽屉）打开时隐藏状态栏，收起（首页）时显示**；
 * 导航栏不受影响。原生实现见 `src-tauri/plugins/tauri-plugin-statusbar/`。
 *
 * 平台判断放在这里而不是调用点：桌面端根本没有系统栏可控制，
 * 让调用方（App.tsx）无脑调用 `setStatusBarVisible(!sidebarOpen)` 更省心。
 */
const isAndroid =
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)

/** 上一次下发的状态，用于去重 —— 避免每次无关重渲染都跨进程调用一次 */
let last: boolean | null = null

export async function setStatusBarVisible(visible: boolean): Promise<void> {
  if (!isAndroid) return
  if (last === visible) return
  last = visible
  try {
    await invoke('plugin:statusbar|set_status_bar_visible', { visible })
  } catch (e) {
    // 失败不该打断界面：状态栏最多是"没跟着变"，记一条日志便于排查
    console.warn('[systemBar] 状态栏显隐失败：', e)
  }
}
