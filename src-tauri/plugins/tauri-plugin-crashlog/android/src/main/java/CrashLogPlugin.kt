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
          val crash = reasons.firstOrNull { isCrash(it.reason) }
          if (crash != null) {
            val trace = readTrace(crash)
            out.put("found", true)
            out.put("timestamp", crash.timestamp)
            out.put("reason", crash.reason)
            out.put("reasonLabel", reasonLabel(crash.reason))
            out.put("description", crash.description ?: "")
            out.put("trace", trace)
            // 导出文件：同一次崩溃 → 同一文件名（时间戳命名）⇒ 重复读只会覆盖同一份
            out.put("exportPath", exportFile(crash, trace))
          }
        }
      }
      invoke.resolve(out)
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  /** 只认"崩"：Java 崩溃 / 原生崩溃 / 启动失败。正常退出、被系统清理都不算。 */
  private fun isCrash(reason: Int): Boolean =
    reason == ApplicationExitInfo.REASON_CRASH ||
      reason == ApplicationExitInfo.REASON_CRASH_NATIVE ||
      reason == ApplicationExitInfo.REASON_INITIALIZATION_FAILURE

  private fun reasonLabel(reason: Int): String = when (reason) {
    ApplicationExitInfo.REASON_CRASH -> "Java 崩溃"
    ApplicationExitInfo.REASON_CRASH_NATIVE -> "原生崩溃（SIGABRT / SIGSEGV）"
    ApplicationExitInfo.REASON_INITIALIZATION_FAILURE -> "启动失败"
    ApplicationExitInfo.REASON_ANR -> "ANR（无响应）"
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
    sb.appendLine("【ZeroNote 崩溃报告】")
    sb.appendLine("时间：$whenText")
    sb.appendLine("环境：$env")
    sb.appendLine("原因：${reasonLabel(info.reason)}${if (info.description != null) "（${info.description}）" else ""}")
    sb.appendLine("设备指纹：${Build.FINGERPRINT}")
    sb.appendLine()
    if (trace.isEmpty()) {
      sb.appendLine("—— 系统没有保留堆栈 ——")
      sb.appendLine("（这台机型的 ROM 清掉了 tombstone，只能提供上面的退出原因）")
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
