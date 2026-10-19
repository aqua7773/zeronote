// ZeroNote 通知捕获插件 —— Android 侧实现（前端命令）。
//
// 五个命令：isEnabled / openSettings / drain / setWhitelist / getWhitelist。
// 真正的通知接收在 NotificationCaptureService.kt；这里只负责权限引导与缓存读取。

package app.tauri.notificationcapture

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class WhitelistArgs {
  var packages: String = ""
}

@TauriPlugin
class NotificationCapturePlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun isEnabled(invoke: Invoke) {
    try {
      val enabled = NotificationManagerCompat.getEnabledListenerPackages(activity)
        .contains(activity.packageName)
      invoke.resolve(JSObject().put("enabled", enabled))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @Command
  fun openSettings(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        activity.startActivity(intent)
        invoke.resolve()
      } catch (ex: Exception) {
        invoke.reject(ex.message)
      }
    }
  }

  @Command
  fun drain(invoke: Invoke) {
    try {
      val prefs = activity.getSharedPreferences(
        NotificationCaptureService.PREFS,
        Context.MODE_PRIVATE,
      )
      val raw = prefs.getString(NotificationCaptureService.KEY_CACHE, "[]") ?: "[]"
      // 取走即清空：记账插件处理失败会留在它自己的 pending 里，不依赖这里重放
      prefs.edit().putString(NotificationCaptureService.KEY_CACHE, "[]").apply()
      invoke.resolve(JSObject().put("json", raw))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @Command
  fun setWhitelist(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(WhitelistArgs::class.java)
      val prefs = activity.getSharedPreferences(
        NotificationCaptureService.PREFS,
        Context.MODE_PRIVATE,
      )
      prefs.edit().putString(NotificationCaptureService.KEY_WHITELIST, args.packages).apply()
      invoke.resolve()
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }

  @Command
  fun getWhitelist(invoke: Invoke) {
    try {
      val prefs = activity.getSharedPreferences(
        NotificationCaptureService.PREFS,
        Context.MODE_PRIVATE,
      )
      val raw = prefs.getString(NotificationCaptureService.KEY_WHITELIST, null)
        ?: NotificationCaptureService.DEFAULT_WHITELIST.joinToString(",")
      invoke.resolve(JSObject().put("packages", raw))
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }
}
