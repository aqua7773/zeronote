package com.aqua.zeronote

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews

/**
 * 「快速输入」桌面组件（rev173.242 · 需求 §15.1）
 *
 * ## 为什么组件里没有输入框
 *
 * `RemoteViews` 里的 `EditText` 是 API 26 才有的实验性支持，**多数 Launcher 不弹软键盘**、
 * 也没法把焦点交给它 —— 放进去等于「点了没反应」。所以组件本体只用一个按钮，
 * 真正的输入交给对话框样式的 [QuickCaptureActivity]（同一个 app 进程，写库文件有权限）。
 *
 * ## 为什么不显示数据
 *
 * 这个组件只做一件事：一键开输入框。给「收件箱里还有 N 条待整理」这类信息，
 * 会把一个 1×1 的按钮变成信息面板，而需求 §15.1 要的是**最小摩擦**。
 * 最近笔记 / 今日打卡分别有自己的组件（§15.2 / §15.3）。
 */
class QuickCaptureWidget : AppWidgetProvider() {

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    // 有组件在用 ⇒ 把「快照变了就刷新」的监听接回来（幂等；rev173.243）
    WidgetRefresher.ensureWatching(context)
    for (id in appWidgetIds) {
      appWidgetManager.updateAppWidget(id, buildViews(context))
    }
  }

  companion object {
    /** 把整张桌面上的「快速输入」组件刷一遍（保存后调用，让计数 / 状态即时更新） */
    fun refreshAll(context: Context) {
      val mgr = AppWidgetManager.getInstance(context) ?: return
      val ids = mgr.getAppWidgetIds(ComponentName(context, QuickCaptureWidget::class.java))
      if (ids.isEmpty()) return
      val views = buildViews(context)
      mgr.updateAppWidget(ids, views)
    }

    /** 组件布局 + 点击目标（Pure function：没有副作用，方便 appWidgetManager 复用它） */
    private fun buildViews(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_quick_capture)
      val pi = PendingIntent.getActivity(
        context,
        // requestCode 固定 0：只有一个入口，不需要区分
        0,
        QuickCaptureActivity.intent(context),
        // FLAG_IMMUTABLE 是 Android 12+ 的硬要求（可变 PendingIntent 会被直接拒）；
        // FLAG_UPDATE_CURRENT 让「换库后重新点」拿到最新的 Intent
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      views.setOnClickPendingIntent(R.id.widget_quick_capture_button, pi)
      // 整块也可以点：按钮小的时候手指容易点偏
      views.setOnClickPendingIntent(R.id.widget_quick_capture_root, pi)
      return views
    }
  }
}
