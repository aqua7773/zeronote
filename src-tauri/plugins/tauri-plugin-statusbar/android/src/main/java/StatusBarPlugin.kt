// ZeroNote 状态栏插件 —— Android 侧实现。
//
// 两个命令：
//  · `setVisible` —— 显示 / 隐藏**状态栏**。刻意只动 `Type.statusBars()`：导航栏（底部手势条）不受影响。
//  · `vibrate`    —— 长按到点的轻震动（rev173.331 · 真人测试7 #1）。
//    为什么不用 WebView 的 `navigator.vibrate`：多数国产 ROM 的 WebView 直接忽略它，
//    用户实测「没有振动效果」；`Vibrator` 服务只要 VIBRATE 普通权限，稳定得多。

package app.tauri.statusbar

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
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

@InvokeArg
class VibrateArgs {
  var ms: Long = 12
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

  @Command
  fun vibrate(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(VibrateArgs::class.java)
      // 夹到 5–80ms：这是「到点了可以松手」的提示，不是通知级震动
      val ms = args.ms.coerceIn(5L, 80L)
      val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          (activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
        } else {
          @Suppress("DEPRECATION")
          activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
      if (vibrator == null || !vibrator.hasVibrator()) {
        // 没有振动器不是错误（模拟器 / 部分平板）—— 反馈失败不能反过来影响长按功能
        invoke.resolve()
        return
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        vibrator.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
      } else {
        @Suppress("DEPRECATION")
        vibrator.vibrate(ms)
      }
      invoke.resolve()
    } catch (ex: Exception) {
      // 静默：抛给前端只会变成一条无意义的 console 噪声
      invoke.resolve()
    }
  }
}
