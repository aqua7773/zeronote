// ZeroNote 状态栏插件 —— Android 侧实现。
//
// 唯一职责：按前端的请求显示 / 隐藏**状态栏**。
// 刻意只动 `Type.statusBars()`：导航栏（底部手势条）不受影响。

package app.tauri.statusbar

import android.app.Activity
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg
class SetVisibleArgs {
  var visible: Boolean = true
}

@TauriPlugin
class StatusBarPlugin(private val activity: Activity) : Plugin(activity) {
  @Command
  fun setVisible(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SetVisibleArgs::class.java)
      // 系统栏只能在 UI 线程操作
      activity.runOnUiThread {
        try {
          val window = activity.window
          val controller = WindowInsetsControllerCompat(window, window.decorView)
          if (args.visible) {
            controller.show(WindowInsetsCompat.Type.statusBars())
          } else {
            controller.hide(WindowInsetsCompat.Type.statusBars())
          }
          // 隐藏时保留「从顶部下拉临时唤出」，否则用户彻底够不着时间/电量
          controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
          invoke.resolve()
        } catch (ex: Exception) {
          invoke.reject(ex.message)
        }
      }
    } catch (ex: Exception) {
      invoke.reject(ex.message)
    }
  }
}
