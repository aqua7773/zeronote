/**
 * 图标栏「插件固定区」（UI 重布局目标态 ② · 方案 §2.1）。
 *
 * 规则（方案原文）：
 *   · 用户从插件中心把插件 pin 到图标栏下半区，**最多 3 个**；
 *   · 默认空 ⇒ **整块不渲染**（零插件不留虚位）；
 *   · 插件被禁用 / 卸载 ⇒ 固定项**自然消失**（不做灰色占位）。
 *
 * 只存**插件 id**，不存标题 / 图标 —— 那些每次从插件宿主现算。
 * 存快照的后果是：插件改名后图标栏还是旧名，而且被删的插件会留下一个永远点不开的死按钮。
 */
export const RAIL_PINS_KEY = 'zeronote.rail.pins'
export const RAIL_PINS_MAX = 3

/** 清洗：只留非空字符串、去重、截到上限 */
export function normalizePins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const id = v.trim()
    if (!id || out.includes(id)) continue
    out.push(id)
    if (out.length >= RAIL_PINS_MAX) break
  }
  return out
}

export function loadRailPins(): string[] {
  try {
    const raw = localStorage.getItem(RAIL_PINS_KEY)
    if (!raw) return []
    return normalizePins(JSON.parse(raw))
  } catch {
    /* 隐私模式 / 坏 JSON：固定区空着，不影响应用其它部分 */
    return []
  }
}

export function saveRailPins(ids: string[]): string[] {
  const pins = normalizePins(ids)
  try {
    localStorage.setItem(RAIL_PINS_KEY, JSON.stringify(pins))
  } catch {
    /* 存不下就只在本次会话生效 */
  }
  return pins
}

/**
 * 切换一个 pin。
 * 返回 `overflow: true` 表示「已经满 3 个，这次没加进去」—— UI 据此提示用户先取消一个，
 * 而不是静默失败（静默失效是这个项目最怕的失败方式）。
 */
export function toggleRailPin(current: string[], id: string): { pins: string[]; overflow: boolean } {
  const pins = normalizePins(current)
  if (pins.includes(id)) return { pins: pins.filter((p) => p !== id), overflow: false }
  if (pins.length >= RAIL_PINS_MAX) return { pins, overflow: true }
  return { pins: [...pins, id], overflow: false }
}
