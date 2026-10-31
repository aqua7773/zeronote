// ZeroNote 分享插件 —— Android 侧实现。
//
// 两条通道：
//  · `shareText`：一段**纯文本**交给系统分享面板（`Intent.ACTION_SEND` / `text/plain`）；
//  · `shareFile`（rev173.310 · 真人测试4 #2）：一个**文件**交给系统分享面板
//    （`ACTION_SEND` / `EXTRA_STREAM` + FileProvider 授权的 `content://`）。
//
// 为什么文件要走 FileProvider：Android 7（API 24）起禁止把 `file://` 塞进 Intent
// （`FileUriExposedException`）；FileProvider 把真实路径映射成临时的 `content://`，
// 并靠 `FLAG_GRANT_READ_URI_PERMISSION` 只把读权限授予**收到 Intent 的那个应用**。
// manifest 里已注册 `androidx.core.content.FileProvider`
// （authority `${applicationId}.fileprovider`，paths = `@xml/file_paths`：external-path + cache-path）。
//
// ⚠️ `file_paths` 只覆盖**外部存储根**与 **cache**。库若落在别处（未来改私有目录），
// `getUriForFile` 会抛 `IllegalArgumentException` ⇒ 这里兜底复制进 `cacheDir/share/` 再分享，
// 而不是把失败抛给用户。

package app.tauri.share

import android.app.Activity
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ShareArgs {
  var title: String = ""
  var text: String = ""
}

@InvokeArg
class ShareFileArgs {
  var title: String = ""
  var path: String = ""
  var mime: String = ""
}

@TauriPlugin
class SharePlugin(private val activity: Activity) : Plugin(activity) {
  /**
   * 调起系统分享面板（纯文本）。
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

  /**
   * 调起系统分享面板（一个文件）。
   *
   * `path` 是**绝对路径**（调用方已把要分享的内容落盘 —— 导出插件写在库内
   * `.zn/share/`，图片内嵌的 Markdown 也在那里）。`mime` 空着时按扩展名推断。
   *
   * 与 `shareText` 同样的语义：返回 `{ ok: true }` 只代表面板已调起。
   */
  @Command
  fun shareFile(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ShareFileArgs::class.java)
      Log.i("ZN-SHARE", "shareFile title=" + args.title + " path=" + args.path + " mime=" + args.mime)

      if (args.path.isBlank()) {
        invoke.reject("没有可分享的文件")
        return
      }
      val src = File(args.path)
      if (!src.isFile) {
        invoke.reject("文件不存在：" + args.path)
        return
      }

      val uri = contentUriFor(src)
      val mime = args.mime.ifBlank { mimeOf(src.name) }
      val send = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, args.title)
        // 部分接收方（老版 QQ / 邮件客户端）只认 ClipData 里的授权，不认 EXTRA_STREAM
        clipData = ClipData.newUri(activity.contentResolver, args.title.ifBlank { "分享" }, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      val chooser = Intent.createChooser(send, args.title.ifBlank { "分享" })
      chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.startActivity(chooser)

      val res = JSObject()
      res.put("ok", true)
      invoke.resolve(res)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "调起系统分享失败")
    }
  }

  /** 真实路径 → FileProvider 的 `content://`；不在 paths 覆盖范围时复制进 cache 再取 */
  private fun contentUriFor(file: File): Uri {
    val authority = activity.packageName + ".fileprovider"
    return try {
      FileProvider.getUriForFile(activity, authority, file)
    } catch (e: IllegalArgumentException) {
      val dst = File(File(activity.cacheDir, "share"), file.name)
      dst.parentFile?.mkdirs()
      file.copyTo(dst, overwrite = true)
      Log.i("ZN-SHARE", "路径不在 file_paths 覆盖范围 ⇒ 复制到 cache：" + dst.absolutePath)
      FileProvider.getUriForFile(activity, authority, dst)
    }
  }

  /** 按扩展名猜 MIME；认不出就 `application/octet-stream`（比瞎猜成 text/plain 更安全） */
  private fun mimeOf(name: String): String {
    val ext = name.substringAfterLast('.', "").lowercase()
    if (ext.isEmpty()) return "application/octet-stream"
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: when (ext) {
      "md", "markdown" -> "text/markdown"
      else -> "application/octet-stream"
    }
  }
}
