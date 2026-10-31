// ZeroNote APK 安装插件 —— Android 侧实现。
//
// 职责：把一个**已经下载好的 APK** 交给系统安装器，并提供「安装未知应用」授权
// 的查询与跳转。
//
// 三个坑（都踩过或必然踩到）：
//  1. **不能 `file://`**：Android 7 起跨应用传文件必须走 FileProvider，否则
//     `FileUriExposedException`。主工程已有 provider（`${applicationId}.fileprovider`），
//     `res/xml/file_paths.xml` 里 `<cache-path path="."/>` 覆盖我们下载的
//     `<cache>/updates/*.apk`。
//  2. **Android 8.0+ 要按应用授权**：没开「安装未知应用」时 `startActivity` 不报错也不弹窗，
//     用户只会觉得「点了没用」。所以先 `canRequestPackageInstalls()` 检查。
//  3. **Android 11+ 包可见性**：`<queries>` 已在插件 manifest 里声明，否则可能解析不到安装器。

package app.tauri.apkinstall

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.FileProvider
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class InstallArgs {
  var path: String = ""
}

@TauriPlugin
class ApkInstallPlugin(private val activity: Activity) : Plugin(activity) {

  /**
   * 起系统安装器。
   *
   * 返回 `{ ok, started }`：`started = true` 只代表**安装器已调起**，
   * 用户点「安装 / 取消」的结果系统不回报 —— 不要在这里声称「已更新」。
   */
  @Command
  fun installApk(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(InstallArgs::class.java)
      val file = File(args.path)
      Log.i("ZN-APK", "installApk path=${args.path} exists=${file.exists()} len=${file.length()}")

      if (!file.exists() || file.length() == 0L) {
        invoke.reject("APK 文件不存在或为空：${args.path}")
        return
      }
      if (!canInstallInternal()) {
        invoke.reject("未授予「安装未知应用」权限 —— 请先在系统设置里允许本应用安装应用")
        return
      }

      val uri: Uri = FileProvider.getUriForFile(
        activity,
        activity.packageName + ".fileprovider",
        file
      )
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      activity.startActivity(intent)

      val res = JSObject()
      res.put("ok", true)
      res.put("started", true)
      invoke.resolve(res)
    } catch (ex: Exception) {
      Log.e("ZN-APK", "installApk failed", ex)
      invoke.reject(ex.message ?: "起系统安装器失败")
    }
  }

  /** 「安装未知应用」授权状态。Android 8.0 以下恒为 true（那时是全局开关）。 */
  @Command
  fun canInstall(invoke: Invoke) {
    try {
      val res = JSObject()
      res.put("allowed", canInstallInternal())
      invoke.resolve(res)
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "查询安装权限失败")
    }
  }

  /** 打开本应用的「安装未知应用」系统设置页。 */
  @Command
  fun openInstallSettings(invoke: Invoke) {
    try {
      val intent = Intent(
        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
        Uri.parse("package:" + activity.packageName)
      )
      activity.startActivity(intent)
      invoke.resolve(JSObject())
    } catch (ex: Exception) {
      invoke.reject(ex.message ?: "打不开安装权限设置页")
    }
  }

  private fun canInstallInternal(): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        activity.packageManager.canRequestPackageInstalls()
      } catch (ex: Exception) {
        // 查询本身失败时按「没授权」处理：多引导一次设置，好过点了没反应
        false
      }
    } else {
      true
    }
}
