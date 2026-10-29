/**
 * 版本号比较 —— 从 `builtin-plugins.ts` 迁出（rev173.259 取消内置预装后，那里只剩历史）。
 *
 * `1.10.0 > 1.9.0` —— 字符串比较在这里是错的。市场用它判断「安装 / 可更新 / 已安装」，
 * 插件版本判断只有这一份口径。
 *
 * 返回 >0 表示 a 更新，<0 表示 b 更新，0 表示相等。
 * 非数字段当 0（`0.2.0-beta` 与 `0.2.0` 同序）；`v` / `^` / `>=` 之类前缀先剥掉。
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .replace(/^[v^~>=<\s]+/, '')
      .split('.')
      .slice(0, 3)
      .map((p) => {
        const n = Number.parseInt(p, 10)
        return Number.isFinite(n) ? n : 0
      })
  const pa = parts(a)
  const pb = parts(b)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}
