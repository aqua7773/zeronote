/**
 * 路径与文件类型判断 —— 从 `App.tsx` 原样迁出（rev122 · 拆分方案 L1）。
 *
 * 全部是无状态纯函数 / 常量：Windows 与 POSIX 两种分隔符都要认
 * （桌面是 Windows 路径，Android 是 POSIX 路径）。
 */

/**
 * 库路径的去重口径：Windows 下大小写与斜杠方向都不敏感，
 * 同一个库写成 `C:\a\b` 和 `c:/a/b/` 得算同一条。
 */
export function vaultKey(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** 路径最后一段（库目录名）；末位斜杠先吃掉 */
export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** 只认 `.md` / `.markdown`（与 Rust 侧 `is_markdown` 同一口径） */
export const MD_RE = /\.(md|markdown)$/i

/**
 * **只读文档**的扩展名（pdf / epub / …），2026-10-14 加。
 * ⚠️ 口径必须与 Rust 侧 `DOC_EXTS`（`src-tauri/src/lib.rs`）**一致** ——
 * 那边决定"文件树里列不列"，这边决定"系统「打开方式」递进来时认不认"。改一处要改两处。
 */
export const DOC_RE = /\.(pdf|epub|mobi|azw3|azw|fb2|cbz|txt)$/i

/**
 * **从别的 App 递进来**（`content://`）时允许阅读的扩展名 —— 比 `DOC_RE` **多 md / markdown**。
 *
 * 为什么单独一份：库内的 `.md` 是**笔记**，必须走编辑器（`openNote`）；只有"库外的 md"
 * 才用阅读器只读打开。共用一个常量会把库内 md 也推进阅读器 ⇒ 笔记没法编辑了。
 *
 * ⚠️ **2026-10-14 踩过**：content:// 分支一开始复用了 `DOC_RE`（不含 md），于是从文件管理器
 * 打开 md 被自己的检查拦掉，而 toast 还写着"支持 pdf / epub / txt / md 等" —— 自相矛盾
 * （用户截图报的就是这个）。
 */
export const SAF_READABLE_RE = /\.(pdf|epub|mobi|azw3|azw|fb2|cbz|txt|md|markdown)$/i

/**
 * `file:///C:/a/b.md` → 本地路径。
 *
 * Rust 侧其实已经转过一道（`url_to_path`），这里是**第二道保险** ——
 * 系统递进来的 URI 形态随平台而变，前端不该假设它一定是干净的路径。
 * 非 file scheme（`content://…`）原样返回，交给调用方给出说明。
 */
export function toLocalPath(raw: string): string {
  const s = raw.trim()
  if (!/^file:\/\//i.test(s)) return s
  let p = s.slice('file://'.length)
  try {
    p = decodeURIComponent(p)
  } catch {
    /* 含裸 `%` 的路径解不开就用原文 —— 总比抛异常强 */
  }
  // file:///C:/x ⇒ /C:/x；Windows 上得去掉盘符前那条斜杠
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1)
  return p
}

/** 拆出父目录与文件名（两种分隔符都认：Android 是 POSIX 路径，桌面是 Windows 路径） */
export function splitPath(p: string): { dir: string; name: string } {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i < 0 ? { dir: '', name: p } : { dir: p.slice(0, i), name: p.slice(i + 1) }
}

/** 路径比较：统一分隔符、去尾斜杠、忽略大小写（Windows 不区分大小写；放宽比较在其它平台无害） */
export function samePath(a: string, b: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * 若 `path` 落在库 `vault` 之内，返回**库内相对路径**（`/` 分隔）；否则 `null`。
 * 返回 `null` 的两种情况：不在库里，或它本身就是库目录。
 */
export function relPathIn(vault: string, path: string): string | null {
  const v = vault.replace(/\\/g, '/').replace(/\/+$/, '')
  const p = path.replace(/\\/g, '/')
  if (!v) return null
  const prefix = `${v.toLowerCase()}/`
  if (p.toLowerCase() === v.toLowerCase() || !p.toLowerCase().startsWith(prefix)) return null
  return p.slice(prefix.length) || null
}
