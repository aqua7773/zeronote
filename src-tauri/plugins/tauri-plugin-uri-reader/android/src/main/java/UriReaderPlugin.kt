// ZeroNote URI 读取插件 —— Android 侧实现。
//
// 唯一职责：把系统递来的 `content://` URI 打开、**复制**到应用缓存目录，
// 返回 `{ path, name }`（绝对路径 + 文件名）。
//
// 为什么复制而不是把 fd 交给 Rust：跨 JNI 传 fd 的生命周期很容易出错，
// 而文档通常只有几 MB —— 复制一份最简单也最稳（前端随后用 asset 协议读那个路径）。
//
// 文件名取法（与 `plugins-workspace#1775` 里作者的方案一致）：
//   先问 provider 的 `OpenableColumns.DISPLAY_NAME`，拿不到再退回 URI 最后一段。

package app.tauri.urireader

import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class ReadArgs {
  var uri: String = ""
}

@TauriPlugin
class UriReaderPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun readContentUri(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ReadArgs::class.java)
      val ctx = activity.applicationContext
      val uri = Uri.parse(args.uri)

      // ① 文件名
      val name =
        ctx.contentResolver.query(uri, null, null, null, null)?.use { c ->
          if (c.moveToFirst()) {
            val i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (i >= 0) c.getString(i) else null
          } else {
            null
          }
        } ?: uri.lastPathSegment ?: "imported.bin"

      // ② 复制到 cacheDir/zn-open/<名>（同名覆盖 —— 每次打开都拿到最新内容）
      val dir = File(ctx.cacheDir, "zn-open")
      if (!dir.exists()) dir.mkdirs()
      val out = File(dir, name)
      val ins = ctx.contentResolver.openInputStream(uri)
      if (ins == null) {
        invoke.reject("打不开这个 content:// URI（provider 没有提供输入流）")
        return
      }
      ins.use { input -> out.outputStream().use { output -> input.copyTo(output) } }

      val res = JSObject()
      res.put("path", out.absolutePath)
      res.put("name", name)
      invoke.resolve(res)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "读取 content:// 失败")
    }
  }
}
