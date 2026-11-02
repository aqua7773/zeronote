import { invoke } from '@tauri-apps/api/core'

/**
 * 崩溃日志（rev173.327 · 用户原话「每次崩溃应该把崩溃日志复制到剪贴板上面，
 * 现在的版本都没有崩溃日志」）。
 *
 * **为什么不能在崩溃当下复制**：原生崩溃（SIGABRT / SIGSEGV）是进程被系统直接
 * 干掉，JS 一行都跑不了。唯一能拿到日志的通道是 Android 11+ 的
 * `ActivityManager.getHistoricalProcessExitReasons()` —— 系统替我们保留了每次
 * 退出的记录，原生崩溃还带 tombstone 全文。所以流程只能是：
 *
 *   崩溃 → 进程死 → 用户下次打开 → 本模块读系统记录 → 自动复制到剪贴板 + 弹窗
 *
 * 原生实现见 `src-tauri/plugins/tauri-plugin-crashlog/`（桌面返回 `found: false`）。
 */

/** 原生命令返回的结构（`found = false` 时其余字段缺省） */
export interface CrashInfo {
  found: boolean
  /** 退出发生的时刻（epoch ms）—— 也用作"是否已处理过"的去重键 */
  timestamp: number
  /** `ApplicationExitInfo.REASON_*`：4 Java 崩溃 / 5 原生崩溃 / 6 ANR / 13 启动失败 / 9 低内存 / 1 主动退出 */
  reason: number
  /** 是不是真崩溃（只有崩溃才有 tombstone） */
  isCrash: boolean
  /** 分文案用：crash / anr / lmk / watchdog / other */
  kind: 'crash' | 'anr' | 'lmk' | 'watchdog' | 'other'
  /** 退出码 / 信号（watchdog 约定 101） */
  exitStatus: number
  reasonLabel: string
  description: string
  /** tombstone 全文（系统没留 / 非崩溃时为空串） */
  trace: string
  /**
   * 原生侧**直接导出的文件绝对路径**（手机 = `Download/ZeroNote-crash/zeronote-crash-<时间>.txt`）。
   * 用户 2026-11-02 的要求是「崩溃就导出日志、我转发就可以了」⇒ 原生读到时顺手落盘，
   * 用户从文件管理器 / 系统分享面板一转手就发出去了。桌面与写失败时为空串。
   */
  exportPath: string
  appVersion: string
  androidVersion: string
  device: string
  webviewVersion: string
}

/** localStorage：上次**已处理**（复制过 / 看过）的崩溃时间戳 */
export const CRASH_HANDLED_KEY = 'zn-crash-handled-ts'

/** 弹窗里展示的 trace 预览上限 —— 超了只显示开头，完整内容已在剪贴板 */
export const TRACE_PREVIEW_CHARS = 4000

/** 读系统记录。桌面或读不到时返回 null（不是错误，界面无需提示）。 */
export async function readLastCrash(): Promise<CrashInfo | null> {
  try {
    const raw = await invoke<Partial<CrashInfo>>('plugin:crashlog|read_last_crash')
    if (!raw || !raw.found) return null
    return {
      found: true,
      timestamp: Number(raw.timestamp ?? 0),
      reason: Number(raw.reason ?? 0),
      // 老版本插件不返回这两项 —— 按"崩溃"处理，行为与 0.9.14 一致
      isCrash: Boolean(raw.isCrash ?? true),
      kind: String(raw.kind ?? 'crash') as CrashInfo['kind'],
      exitStatus: Number(raw.exitStatus ?? 0),
      reasonLabel: String(raw.reasonLabel ?? ''),
      description: String(raw.description ?? ''),
      trace: String(raw.trace ?? ''),
      exportPath: String(raw.exportPath ?? ''),
      appVersion: String(raw.appVersion ?? ''),
      androidVersion: String(raw.androidVersion ?? ''),
      device: String(raw.device ?? ''),
      webviewVersion: String(raw.webviewVersion ?? ''),
    }
  } catch {
    // 插件没注册 / 命令被拒 / 老版本 —— 都当作"没有崩溃记录"，不打扰用户
    return null
  }
}

/** 这次崩溃是不是"还没处理过的新崩溃" */
export function isNewCrash(info: CrashInfo | null, handledTs: number): boolean {
  if (!info || !info.found) return false
  if (!(info.timestamp > 0)) return false
  return info.timestamp > handledTs
}

export function loadHandledTs(): number {
  try {
    const raw = localStorage.getItem(CRASH_HANDLED_KEY)
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function saveHandledTs(ts: number): void {
  try {
    if (ts > 0) localStorage.setItem(CRASH_HANDLED_KEY, String(ts))
  } catch {
    // 隐私模式 / 存储满 —— 下次会再提示一次，可接受
  }
}

/** 弹窗里的 trace 预览（截断 + 注明原长） */
export function tracePreview(trace: string, max = TRACE_PREVIEW_CHARS): string {
  if (!trace) return ''
  if (trace.length <= max) return trace
  return `${trace.slice(0, max)}\n\n…（预览截断；完整 ${trace.length} 字符已复制到剪贴板）`
}

/** 拼成一段可直接粘进反馈的纯文本 */
export function formatCrashReport(info: CrashInfo): string {
  const when = info.timestamp > 0 ? new Date(info.timestamp).toLocaleString() : '未知'
  const env = [
    info.appVersion ? `ZeroNote ${info.appVersion}` : '',
    info.androidVersion ? `Android ${info.androidVersion}` : '',
    info.device,
    info.webviewVersion ? `WebView ${info.webviewVersion}` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const head = [
    info.isCrash ? '【ZeroNote 崩溃报告】' : '【ZeroNote 异常退出报告】',
    `时间：${when}`,
    `环境：${env || '未知'}`,
    `原因：${info.reasonLabel || `退出码 ${info.reason}`}${info.description ? `（${info.description}）` : ''}`,
  ]
  if (!info.isCrash && info.exitStatus) head.push(`退出码 / 信号：${info.exitStatus}`)

  const body = info.trace
    ? ['', '—— 崩溃堆栈（tombstone）——', info.trace]
    : info.isCrash
      ? ['', '—— 系统没有保留堆栈 ——', '（这台机型的 ROM 清掉了 tombstone，只能提供上面的退出原因）']
      : ['', '—— 这类退出没有堆栈 ——', '（不是崩溃：进程是主动退出或被系统回收，系统不会为它保留 tombstone）']

  return [...head, ...body].join('\n')
}
