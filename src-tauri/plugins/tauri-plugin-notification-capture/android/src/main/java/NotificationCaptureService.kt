// ZeroNote 通知捕获插件 —— NotificationListenerService。
//
// 职责（只做捕获，不做解析 —— 解析规则放 JS 插件，可热更新）：
//   ① 白名单包名过滤（微信 / 支付宝 / 云闪付 / 短信，可被前端 setWhitelist 覆盖）
//   ② 合并多个文本字段（EXTRA_TITLE / TEXT / BIG_TEXT / SUB_TEXT / SUMMARY_TEXT / infoText / ticker）
//   ③ MD5 去重（同一通知重复上屏只收一次）
//   ④ 原文写入 SharedPreferences 环形缓存（上限 200 条），等前端 drain()
//
// 进程生命周期：Service 由系统绑定；App 被杀后系统重建 Service 时本类仍能收通知并写缓存，
// 因此「App 没开时收到的支付通知」不会丢。

package app.tauri.notificationcapture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

class NotificationCaptureService : NotificationListenerService() {
  companion object {
    const val PREFS = "zn_notification_capture"
    const val KEY_CACHE = "pending"
    const val KEY_WHITELIST = "whitelist"
    const val KEY_SEEN = "seen"
    const val MAX_CACHE = 200
    const val MAX_SEEN = 64

    /** 默认只收这几类：支付与银行短信。其余 App 的通知一律不落盘。 */
    val DEFAULT_WHITELIST = listOf(
      "com.tencent.mm", // 微信
      "com.eg.android.AlipayGphone", // 支付宝
      "com.unionpay", // 云闪付
      "com.android.mms", // 短信
    )
  }

  private val lock = Any()

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val sbn = sbn ?: return
    val pkg = sbn.packageName ?: return
    try {
      val prefs = getSharedPreferences(PREFS, MODE_PRIVATE)
      val whitelist = (prefs.getString(KEY_WHITELIST, null) ?: DEFAULT_WHITELIST.joinToString(","))
        .split(",")
        .map { it.trim() }
        .filter { it.isNotEmpty() }
      if (!whitelist.contains(pkg)) return

      val notification = sbn.notification ?: return
      val extras = notification.extras ?: return
      val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
      val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
      val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
      val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""
      val summary = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString() ?: ""
      val info = extras.getCharSequence("android.infoText")?.toString() ?: ""
      val ticker = notification.tickerText?.toString() ?: ""

      // 文本可能出现在任意一个字段 —— 全部合并再交给 JS 解析（同 WhereIsMyMoney 的做法）
      val merged = listOf(title, bigText, text, subText, summary, info, ticker)
        .filter { it.isNotBlank() }
        .joinToString(" | ")
      if (merged.isBlank()) return

      val hash = md5("$pkg|$merged")
      synchronized(lock) {
        val seen = JSONArray(prefs.getString(KEY_SEEN, "[]") ?: "[]")
        for (i in 0 until seen.length()) {
          if (seen.optString(i) == hash) return
        }
        seen.put(hash)
        while (seen.length() > MAX_SEEN) seen.remove(0)

        val cache = JSONArray(prefs.getString(KEY_CACHE, "[]") ?: "[]")
        cache.put(
          JSONObject().apply {
            put("pkg", pkg)
            put("app", appLabel(pkg))
            put("title", title)
            put("text", merged)
            put("time", System.currentTimeMillis())
          },
        )
        while (cache.length() > MAX_CACHE) cache.remove(0)

        prefs.edit()
          .putString(KEY_SEEN, seen.toString())
          .putString(KEY_CACHE, cache.toString())
          .apply()
      }
    } catch (_: Exception) {
      // 通知服务绝不能因为一条坏通知崩掉系统回调
    }
  }

  override fun onListenerDisconnected() {
    // 被系统回收后请求重新绑定（AutoAccounting 同做法），否则用户会以为监听还开着
    try {
      requestRebind(
        android.content.ComponentName(this, NotificationCaptureService::class.java),
      )
    } catch (_: Exception) {
      // 某些 ROM 不允许主动 rebind —— 不影响正常使用
    }
  }

  private fun appLabel(pkg: String): String = try {
    val pm = packageManager
    val ai = pm.getApplicationInfo(pkg, 0)
    pm.getApplicationLabel(ai).toString()
  } catch (_: Exception) {
    pkg
  }

  private fun md5(s: String): String {
    val digest = MessageDigest.getInstance("MD5").digest(s.toByteArray())
    return digest.joinToString("") { b ->
      val v = b.toInt() and 0xff
      v.toString(16).padStart(2, '0')
    }
  }
}
