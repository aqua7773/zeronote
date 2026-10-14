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
import android.content.Intent
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
  /**
   * ⚠️ **热启动的 VIEW intent 必须自己接**（2026-10-14 真机实测的根因）。
   *
   * Tauri 的 `TauriActivity.onNewIntent` **只**把 intent 交给 `PluginManager`（再分发给各插件），
   * **没有**转给 tao 的 JNI ⇒ tao 的 `handle_intent` 不执行 ⇒ `RunEvent::Opened`
   * 在"**应用已经在运行**时"根本不触发。原文只有两行（tauri-2.12.3
   * `mobile/android-codegen/TauriActivity.kt`）：
   * `super.onNewIntent(intent)` + `PluginManager.onNewIntent(intent)`。
   *
   * 症状：从文件管理器"打开方式"选 ZeroNote —— **冷启动正常**（启动 intent 走另一条路），
   * **热启动什么都不发生**（应用切到前台、不打开文件、也没有任何提示）。
   * 实测对照：`am force-stop` 后发同一个内容 URI ⇒ 有反应（能报权限错）；
   * 应用在运行时发同一个 URI ⇒ 毫无反应。
   *
   * 修法：自己把 data URI 用**插件事件**推给前端（前端用
   * `addPluginListener('uri-reader', 'open-uri', …)` 接），复用既有的 `openExternalFile`。
   */
  override fun onNewIntent(intent: Intent) {
    android.util.Log.i("ZN-URI", "onNewIntent data=" + intent.data)
    super.onNewIntent(intent)
    val data = intent.data ?: return
    val payload = JSObject()
    payload.put("uri", data.toString())
    trigger("open-uri", payload)
  }

  @Command
  fun readContentUri(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(ReadArgs::class.java)
      android.util.Log.i("ZN-URI", "readContentUri uri=" + args.uri)
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
