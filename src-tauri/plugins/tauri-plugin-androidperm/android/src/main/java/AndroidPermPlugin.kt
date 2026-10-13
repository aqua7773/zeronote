// ZeroNote Android 权限插件 —— Android 侧实现。
//
// 唯一职责：**把用户送到「所有文件访问」的系统授权页**。
// 不做也不该做"偷偷授权" —— 那是系统设置里的用户动作。
//
// 两个 action 的取舍（实测/文档）：
//   · `ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` + `package:` URI
//     ⇒ **直达本应用的"所有文件访问"开关页**（首选）。少数 ROM 不认这个组合会抛异常。
//   · 抛异常时退化为 `ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION`
//     ⇒ 打开该权限的**总列表页**，用户在那里也能找到本应用（多一步，但不会卡死）。
//
// 为什么值得单独做个插件：没有这个权限时，应用读公共存储只会报
// `Permission denied (os error 13)`，而它是 Android 的**特殊权限、系统不弹窗申请** ——
// 用户无从得知该去哪开（rev64 踩到的原话）。

package app.tauri.androidperm

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@TauriPlugin
class AndroidPermPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun requestAllFilesAccess(invoke: Invoke) {
    // Android 11（API 30）才有分区存储与这个权限；更低版本自由读写，不需要授权
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
      invoke.resolve()
      return
    }
    // 起系统页面只能在 UI 线程
    activity.runOnUiThread {
      try {
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
        intent.data = Uri.fromParts("package", activity.packageName, null)
        activity.startActivity(intent)
        invoke.resolve()
      } catch (ex: Exception) {
        // 个别 ROM 不认带 package 的那个 action ⇒ 退化成总列表页
        try {
          activity.startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
          invoke.resolve()
        } catch (ex2: Exception) {
          invoke.reject(ex2.message)
        }
      }
    }
  }
}
