/** 文件大小的「大概多大」格式化（回收站列表用）—— rev123 · L3 抽出（纯函数，可测） */
export function fmtSize(n: number): string {
  return n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`
}
