import { invoke } from '@tauri-apps/api/core'

/**
 * Android 状态栏的按需显隐。
 *
 * 需求变更（rev173.279 · 真人使用测试 #11，用户原话「不需要留系统状态栏」）：
 * 现在是**常驻沉浸式** —— App 挂载时下发 `false`、卸载时显回来。
 * 旧需求（2026-10-12「抽屉打开时隐藏、收起时显示」）已作废：
 * 首页顶部一直挂一条系统状态栏，底色与应用顶栏对不上，视觉割裂。
 *
 * 导航栏不受影响；隐藏时原生设了 `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`，
 * 从屏幕顶部下拉仍能临时唤出时间 / 电量。
 * 原生实现见 `src-tauri/plugins/tauri-plugin-statusbar/`。
 *
 * 平台判断放在这里而不是调用点：桌面端根本没有系统栏可控制，
 * 让调用方（App.tsx）无脑调用 `setStatusBarVisible(false)` 更省心。
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
