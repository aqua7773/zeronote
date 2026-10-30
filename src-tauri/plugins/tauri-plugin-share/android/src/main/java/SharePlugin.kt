// ZeroNote 分享插件 —— Android 侧实现。
//
// 唯一职责：把一段**纯文本**交给系统分享面板（`Intent.ACTION_SEND` / `text/plain`）。
//
// 为什么不做文件分享：文件要走 FileProvider（manifest provider + paths 资源 + 缓存目录），
// 而笔记分享的常见去处（微信 / QQ / 邮件 / 备忘录）都能接收纯文本 —— 纯文本没有
// provider 配置、没有 URI 权限授予、也没有"分享出去的文件被谁读过"的生命周期问题。
// J#13（2026-10-30 用户拍板）按"把笔记内容发出去"这个语义落地，文件分享留作后续。

package app.tauri.share

import android.app.Activity
import android.content.Intent
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class ShareArgs {
  var title: String = ""
  var text: String = ""
}

@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
  /**
   * 调起系统分享面板。
   *
   * ⚠️ 必须在 **Activity** 上 `startActivity`（不是 applicationContext）——
   * 后者需要 `FLAG_ACTIVITY_NEW_TASK`，且在部分机型上分享面板会跳到另一个任务栈，
   * 选完应用回来时原页面被重建。
   *
   * 返回 `{ ok: true }` = 面板已调起；用户选哪个应用、有没有真的发送，系统不回报
   * （不要在这里声称"已分享"）。
   */
  @Command
  fun shareText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ShareArgs::class.java)
      Log.i("ZN-SHARE", "shareText title=" + args.title + " textLen=" + args.text.length)

      if (args.text.isEmpty()) {
        invoke.reject("没有可分享的内容")
        return
      }

      val send = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, args.title)
        putExtra(Intent.EXTRA_TEXT, args.text)
      }
      val chooser = Intent.createChooser(send, args.title.ifBlank { "分享" })
      activity.startActivity(chooser)

      val res = JSObject()
      res.put("ok", true)
      invoke.resolve(res)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "调起系统分享失败")
    }
  }
}
