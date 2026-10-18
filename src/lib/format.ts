/** 文件大小的「大概多大」格式化（回收站列表用）—— rev123 · L3 抽出（纯函数，可测） */
export function fmtSize(n: number): string {
  return n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`
}

/**
 * 截到 `max` 个字（按 Unicode 码点数，中文 1 字 = 1），超出补「…」。
 *
 * 用途：插件页的说明只露一行 —— 用户 2026-10-19 要求「插件说明控制在 15 个字」。
 * 只改**展示**，manifest 里的原文不动（悬停用 title 看全文）。
 */
export function clampText(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length <= max ? s : `${chars.slice(0, max).join('')}…`
}
