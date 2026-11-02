// ZeroNote 崩溃日志插件 —— Android 侧实现。
//
// 唯一职责：把系统替我们留下的「上一次异常退出」读出来，并**直接导出成文件**，
// 用户从系统文件管理器 / 分享面板一转手就能发出去（用户 2026-11-02 要求：
// 「每次崩溃直接导出崩溃日志，我转发就可以了」）。
//
// 崩溃当下进程已死，JS 跑不了；能拿到日志的唯一正规通道是
// `ActivityManager.getHistoricalProcessExitReasons()`（API 30+），
// 原生崩溃时它附带 tombstone 全文（`getTraceInputStream()`），不需要 root。

package app.tauri.crashlog

import android.app.Activity
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import android.os.Environment
import android.webkit.WebView
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@TauriPlugin
class CrashLogPlugin(private val activity: Activity) : Plugin(activity) {

  /** trace 上限：IPC 与剪贴板都受不了几 MB 的 tombstone，超了就截断并注明。
      2026-11-02（rev173.328）：6 份真机 tombstone 原始长度 **45–48 万字符**，64 K 的旧上限把
      **崩溃线程之外的线程块**整段截掉了（看门狗线程按 tid 排序靠后时直接看不到 ⇒ 误判成
      「系统层独立崩溃」）⇒ 提到 512 K，足以装下正常 tombstone 全文。 */
  private val maxTraceChars = 512 * 1024

  /** 看门狗退出码（Rust `spawn_watchdog` 里 `libc::_exit(101)` 的约定值） */
  private val watchdogExitCode = 101

  @Command
  fun readLastCrash(invoke: Invoke) {
    try {
      val out = JSObject()
      out.put("found", false)
      out.put("appVersion", appVersion())
      out.put("androidVersion", Build.VERSION.RELEASE ?: "")
      out.put("device", "${Build.MANUFACTURER} ${Build.MODEL}".trim())
      out.put("webviewVersion", webViewVersion())

      // API 30 才有 ApplicationExitInfo；低版本如实返回"没有"
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val am = activity.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager
        if (am != null) {
          val reasons = am.getHistoricalProcessExitReasons(activity.packageName, 0, 12)
          val hit = reasons.firstOrNull { isReportable(it) }
          if (hit != null) {
            val crash = isCrash(hit.reason)
            // 只有崩溃才有 tombstone；看门狗 / LMK / ANR 只有退出原因
            val trace = if (crash) readTrace(hit) else ""
            out.put("found", true)
            out.put("timestamp", hit.timestamp)
            out.put("reason", hit.reason)
            out.put("isCrash", crash)
            out.put("kind", kindOf(hit))
            out.put("exitStatus", hit.status)
            out.put("reasonLabel", reasonLabel(hit.reason, hit.status))
            out.put("description", hit.description ?: "")
            out.put("trace", trace)
            // 导出文件：同一次退出 → 同一文件名（时间戳命名）⇒ 重复读只会覆盖同一份
            out.put("exportPath", exportFile(hit, trace))
          }
        }
      }
      invoke.resolve(out)
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** 只认"崩"：Java 崩溃 / 原生崩溃 / 启动失败。 */
  private fun isCrash(reason: Int): Boolean =
    reason == ApplicationExitInfo.REASON_CRASH ||
      reason == ApplicationExitInfo.REASON_CRASH_NATIVE ||
      reason == ApplicationExitInfo.REASON_INITIALIZATION_FAILURE

  /**
   * 值得在下次启动时提示的退出（rev173.329 · 2026-11-02 18:54）。
   *
   * 起因：用户装 0.9.15 后闪退一次却**没有弹窗** —— 看门狗已改 `libc::_exit(101)`，
   * 退出原因变成 `REASON_EXIT_SELF`，而这里原先只认三种 crash ⇒ 证据被静默丢掉。
   *
   * 收录：崩溃 / ANR / 低内存回收 / 看门狗 exit(101)。
   * 不收录：用户主动退出、被系统 SIGKILL 滑掉 —— 那是正常使用，不该打扰。
   */
  private fun isReportable(info: ApplicationExitInfo): Boolean = when {
    isCrash(info.reason) -> true
    info.reason == ApplicationExitInfo.REASON_ANR -> true
    info.reason == ApplicationExitInfo.REASON_LOW_MEMORY -> true
    info.reason == ApplicationExitInfo.REASON_EXIT_SELF -> info.status == watchdogExitCode
    else -> false
  }

  /** 给前端分文案用的一档：crash / anr / lmk / watchdog / other */
  private fun kindOf(info: ApplicationExitInfo): String = when {
    isCrash(info.reason) -> "crash"
    info.reason == ApplicationExitInfo.REASON_ANR -> "anr"
    info.reason == ApplicationExitInfo.REASON_LOW_MEMORY -> "lmk"
    info.reason == ApplicationExitInfo.REASON_EXIT_SELF -> "watchdog"
    else -> "other"
  }

  private fun reasonLabel(reason: Int, status: Int = 0): String = when (reason) {
    ApplicationExitInfo.REASON_CRASH -> "Java 崩溃"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "原生崩溃（SIGABRT / SIGSEGV）"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "启动失败"
    ApplicationExitInfo.REASON_ANR -> "ANR（无响应）"
    ApplicationExitInfo.REASON_LOW_MEMORY -> "被系统回收（内存不足）"
    ApplicationExitInfo.REASON_EXIT_SELF ->
      if (status == watchdogExitCode) "看门狗判定卡死（exit 101）" else "进程主动退出（exit $status）"
    ApplicationExitInfo.REASON_SIGNALED -> "被系统信号终止（status $status）"
    ApplicationExitInfo.REASON_USER_REQUESTED -> "用户主动退出"
    else -> "未知（$reason）"
  }

  /**
   * 读 tombstone。系统没留（部分 ROM 会清）时返回空串 —— 前端据此提示
   * 「只有退出原因，没有堆栈」，而不是当成插件坏了。
   */
  private fun readTrace(info: ApplicationExitInfo): String {
    val raw = try {
      info.traceInputStream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
    } catch (ex: Exception) {
      ""
    }
    if (raw.isEmpty()) return ""
    if (raw.length <= maxTraceChars) return raw
    val head = raw.substring(0, maxTraceChars)
    return "$head\n\n…（已截断，原长 ${raw.length} 字符）"
  }

  /**
   * 导出到公共 Download 目录，路径对用户可见、微信/QQ 的「选择文件」也能直接选到。
   * 文件名带崩溃时刻 ⇒ 同一次崩溃反复读只会覆盖同一份，不会堆垃圾。
   * 写失败返回空串（前端会退回"只给文本"）。
   */
  private fun exportFile(info: ApplicationExitInfo, trace: String): String {
    return try {
      val dir = File(
        Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
        "ZeroNote-crash",
      )
      if (!dir.exists()) dir.mkdirs()
      val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(info.timestamp))
      val file = File(dir, "zeronote-crash-$stamp.txt")
      file.writeText(buildReport(info, trace), Charsets.UTF_8)
      file.absolutePath
    } catch (ex: Exception) {
      ""
    }
  }

  /** 导出的报告全文 —— 用户直接转发这一份就够；字段与前端展示保持同一套。 */
  private fun buildReport(info: ApplicationExitInfo, trace: String): String {
    val whenText = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(info.timestamp))
    val env = listOf(
      if (appVersion().isNotEmpty()) "ZeroNote ${appVersion()}" else "",
      "Android ${Build.VERSION.RELEASE}",
      "${Build.MANUFACTURER} ${Build.MODEL}",
      if (webViewVersion().isNotEmpty()) "WebView ${webViewVersion()}" else "",
    ).filter { it.isNotEmpty() }.joinToString(" · ")

    val sb = StringBuilder()
    sb.appendLine(if (isCrash(info.reason)) "【ZeroNote 崩溃报告】" else "【ZeroNote 异常退出报告】")
    sb.appendLine("时间：$whenText")
    sb.appendLine("环境：$env")
    sb.appendLine("原因：${reasonLabel(info.reason, info.status)}${if (info.description != null) "（${info.description}）" else ""}")
    if (!isCrash(info.reason)) sb.appendLine("退出码 / 信号：${info.status}")
    sb.appendLine("设备指纹：${Build.FINGERPRINT}")
    sb.appendLine()
    if (trace.isEmpty()) {
      sb.appendLine("—— 系统没有保留堆栈 ——")
      if (isCrash(info.reason)) {
        sb.appendLine("（这台机型的 ROM 清掉了 tombstone，只能提供上面的退出原因）")
      } else {
        sb.appendLine("（不是崩溃：进程是主动退出或被系统回收，系统不会为它保留 tombstone）")
      }
    } else {
      sb.appendLine("—— 崩溃堆栈（tombstone）——")
      sb.appendLine(trace)
    }
    return sb.toString()
  }

  private fun appVersion(): String = try {
    activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: ""
  } catch (ex: Exception) {
    ""
  }

  private fun webViewVersion(): String = try {
    WebView.getCurrentWebViewPackage()?.versionName ?: ""
  } catch (ex: Exception) {
    ""
  }
}
