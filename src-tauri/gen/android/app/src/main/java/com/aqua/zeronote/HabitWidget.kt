package com.aqua.zeronote

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast

/**
 * 「今日打卡」桌面组件（rev173.242 · 需求 §15.2）
 *
 * ## 交互
 *
 * 一行一个「今天应打卡」的计划，点一下 = 打一次卡（追加一条当前时间）。
 * 写回走 [HabitStore]（插件 store）+ 快照里的 `done` 同时 +1，然后重绘组件。
 *
 * ## 一行为什么是一个 TextView 而不是 Button
 *
 * RemoteViews 的 Button 会带一层 Material 的按钮底色，5 行按钮在桌面上像一排开关，
 * 而行文本 + 右侧状态更像「清单」。点击区域靠 `padding` 撑到约 28dp（可点）。
 *
 * ## 点击为什么走广播而不是直接调函数
 *
 * `RemoteViews.setOnClickPendingIntent` 只能挂 PendingIntent（组件在 Launcher 进程里，
 * 我们的代码不在场）。`getBroadcast` → 本类的 `onReceive` 是最省的一条：
 * 不需要 Activity，打卡完不打断用户。
 */
class HabitWidget : AppWidgetProvider() {

  /** 点击一行打卡（`planId` 放在 extra 里） */
  internal class CheckInAction {
    companion object {
      const val ACTION = "com.aqua.zeronote.widget.HABIT_CHECK_IN"
      const val EXTRA_PLAN_ID = "planId"
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == CheckInAction.ACTION) {
      val planId = intent.getStringExtra(CheckInAction.EXTRA_PLAN_ID).orEmpty()
      if (planId.isEmpty()) return
      val err = HabitStore.checkIn(context, planId)
      if (err != null) {
        Toast.makeText(context, "打卡失败：$err", Toast.LENGTH_LONG).show()
      } else {
        Toast.makeText(context, "已打卡", Toast.LENGTH_SHORT).show()
      }
      refreshAll(context)
      return
    }
    super.onReceive(context, intent)
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    for (id in appWidgetIds) {
      appWidgetManager.updateAppWidget(id, buildViews(context))
    }
  }

  companion object {
    /** 最多显示几行（与布局里的 5 个行 id 对应） */
    private const val MAX_ROWS = 5

    fun refreshAll(context: Context) {
      val mgr = AppWidgetManager.getInstance(context) ?: return
      val ids = mgr.getAppWidgetIds(ComponentName(context, HabitWidget::class.java))
      if (ids.isEmpty()) return
      val views = buildViews(context)
      mgr.updateAppWidget(ids, views)
    }

    /** 行文本：「✓ 晨跑」/「晨跑 · 2/3」——打满目标后给勾 */
    internal fun rowText(plan: SnapshotPlan): String {
      val donePart = if (plan.done >= plan.target) "✓ ${plan.title}" else "${plan.title} · ${plan.done}/${plan.target}"
      return donePart
    }

    private fun rowIds(): IntArray = intArrayOf(
      R.id.widget_habit_row_1,
      R.id.widget_habit_row_2,
      R.id.widget_habit_row_3,
      R.id.widget_habit_row_4,
      R.id.widget_habit_row_5,
    )

    internal fun buildViews(context: Context): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_habit)
      val snapshot = WidgetSnapshot.read(context)
      val ids = rowIds()

      var shown = 0
      for (i in ids.indices) {
        val id = ids[i]
        val plan = snapshot.plans.getOrNull(i)
        if (plan == null) {
          views.setViewVisibility(id, View.GONE)
          continue
        }
        views.setViewVisibility(id, View.VISIBLE)
        views.setTextViewText(id, rowText(plan))
        views.setOnClickPendingIntent(id, checkInIntent(context, id, plan.id))
        shown++
      }
      views.setViewVisibility(R.id.widget_habit_empty, if (shown == 0) View.VISIBLE else View.GONE)
      // 没有应打卡计划时给一句解释，而不是留一块空地
      views.setTextViewText(
        R.id.widget_habit_empty,
        if (shown == 0) context.getString(R.string.widget_habit_empty) else "",
      )
      return views
    }

    private fun checkInIntent(context: Context, rowId: Int, planId: String): PendingIntent {
      val intent = Intent(context, HabitWidget::class.java).apply {
        action = CheckInAction.ACTION
        putExtra(CheckInAction.EXTRA_PLAN_ID, planId)
      }
      // requestCode 用行 id 区分：不同行的 PendingIntent 不能复用（否则 extra 会被串）
      return PendingIntent.getBroadcast(
        context,
        rowId,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
