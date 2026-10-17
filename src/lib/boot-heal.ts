/**
 * 卡死兜底 C 段：启动自愈 —— 从 `App.tsx` 原样迁出（rev122 · L1）。
 *
 * `LS_LOADING` 是"即将加载某个插件"时落下的标记（见插件加载循环里那两行）：
 * 正常路径（加载成功 / 加载失败 / 正常关窗）都会清掉它。所以**启动时还能读到它**，
 * 只可能是**上一次进程在加载那个插件时死掉了** —— 主线程被占死（看门狗杀的），
 * 或用户/系统强杀（这两种情况分不出来，所以一律按前者处置）。
 *
 * 处置：并入禁用集合 —— **宁可少加载一个插件，也不要一开就再卡一次**。
 * 代价是"强杀应用"也会误伤一个插件，所以必须 **可见 + 可一键恢复 + 有日志**
 *（不许静默：静默失效比报错危险）。
 *
 * ⚠️ 为什么在**模块级**执行而不是组件里：`toast` 的 `useState` 在 `disabled` 之前，
 * 组件里跑就没法同时喂给两个初值；模块级只在加载时跑一次，顺序与次数都确定
 *（本仓库已移除 StrictMode，不存在双跑）。
 *
 * ⚠️ 迁出后语义不变：`bootSelfHeal()` 仍在模块**顶层**调用 —— import 本模块即执行一次。
 */

export const LS_DISABLED = 'zeronote.plugins.disabled'

export const LS_LOADING = 'zeronote.plugins.loading'

/** 启动自愈认出的插件（`loadDisabled()` 与插件页共用） */
export const bootAutoDisabled = new Set<string>()

/** 给用户看的那句话（`toast` 初值直接用） */
export let bootAutoDisabledNotice: string | null = null

function bootSelfHeal() {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LS_LOADING)
  } catch {
    return
  }
  if (!raw) return
  try {
    localStorage.removeItem(LS_LOADING) // 用过即清：下次启动不再重复判定
  } catch {
    /* 清不掉也不影响本次判定 */
  }
  try {
    const id = (JSON.parse(raw) as { id?: unknown })?.id
    if (typeof id !== 'string' || !id) return
    bootAutoDisabled.add(id)
    bootAutoDisabledNotice = `上次加载「${id}」时卡死，已自动禁用它（可在「插件管理」里重新启用）`
  } catch {
    /* 标记坏了就当没有 —— 不能因为一条坏标记卡住启动 */
  }
}

bootSelfHeal()

export function loadDisabled(): Set<string> {
  let set: Set<string>
  try {
    set = new Set<string>(JSON.parse(localStorage.getItem(LS_DISABLED) ?? '[]'))
  } catch {
    set = new Set()
  }
  // C 段：把启动自愈认出的插件并进去，**并落盘** —— 否则用户下次刷新它又被加载（又卡一次）
  if (bootAutoDisabled.size) {
    for (const id of bootAutoDisabled) set.add(id)
    try {
      localStorage.setItem(LS_DISABLED, JSON.stringify([...set]))
    } catch {
      /* 写不进去就只在本次会话生效（总比再卡一次好） */
    }
  }
  return set
}
