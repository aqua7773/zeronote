/**
 * 笔记独立窗口（rev173.51 · 用户「标签页做成窗口级的，可以拿出来单独放」）。
 *
 * 纯函数：只拼窗口 label 与 URL —— 建窗本身在 `App.tsx`（它要拿 `vault` 与回调）。
 * 单独成文件是为了能直接单测「URL 里该带什么、不该带什么」：
 * 带错一个参数，新窗口就会以另一种模式（插件窗口 / 默认库）启动，界面上看不出原因。
 */

/** 新窗口 label 的前缀 —— `capabilities/default.json` 的 windows glob 必须覆盖它（`note-*`） */
export const NOTE_WINDOW_PREFIX = 'note-'

/** 窗口 label：同一进程内唯一即可（`note-1` / `note-2` …） */
export function noteWindowLabel(seq: number): string {
  return `${NOTE_WINDOW_PREFIX}${seq}`
}

/**
 * 笔记窗口的 URL：`<origin><path>?note=<库内路径>&vault=<库绝对路径>`。
 *
 * 两条硬要求：
 *  · **不带主窗口原有的 query**：主窗口可能正好是 `?pluginWindow=…`（插件窗口）或被手工加了参数，
 *    照抄过去会让新窗口以错误的模式启动；
 *  · `vault` 必须显式带上：新窗口虽然与主窗口共享 localStorage，但「库」是**启动时**解析的，
 *    万一主窗口刚从 URL 参数进库（没写 localStorage）就会退回默认库 —— 打开一条不存在的路径。
 */
export function noteWindowUrl(href: string, path: string, vault: string | null): string {
  /**
   * 用 `URL` 对象改 `search`，**不要**手工拼 `${u.origin}${u.pathname}`：
   * 生产环境的 `tauri://localhost/index.html` 是非特殊协议，`URL.origin` 会变成字符串 `"null"`
   * （单测第一版就这么栽的）。`toString()` 保留原协议与路径。
   */
  const u = new URL(href)
  u.hash = ''
  const q = new URLSearchParams({ note: path })
  if (vault) q.set('vault', vault)
  u.search = q.toString()
  return u.toString()
}
