package com.aqua.zeronote

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 「最近笔记」桌面组件（rev173.242 · 需求 §15.3）
 *
 * ## 需求 → 实现
 *
 * | 需求 | 这里 |
 * |---|---|
 * | 只显示公开笔记 | 快照里的 `notes` 由内核过滤（排除 `.zn/` 私有目录与附件），组件**再不会自己去扫库** |
 * | 默认 5 条 | `widget_recent_notes_info.xml` 的 `minHeight=180dp` ⇒ 中档 = 5 行 |
 * | 可调 1 / 3 / 5 / 7 | 用户在桌面拉高/拉矮组件 ⇒ `onAppWidgetOptionsChanged` 按高度分档 |
 *
 * ## 为什么按高度算条数，而不是给一个「设置」 Activity
 *
 * 桌面组件的标准交互就是拉大小。多一个配置页会让「加个组件」变成三步操作，
 * 而拉高拉矮本来就是用户已经在做的事（Remarks：这是 Android 原生习惯）。
 *
 * ## 数据什么时候刷新
 *
 * `updatePeriodMillis = 1800000`（30 分钟，系统下限）：只为了让「昨天/今天」的
 * 时间前缀与笔记顺序不至于停在前天。**真正的实时刷新**靠内核写快照后主动
 * `refreshAll()`（没做跨进程通知 —— 组件读的是同一个文件，下次 update 就是新的）。
 */
class RecentNotesWidget : AppWidgetProvider() {

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray,
  ) {
    for (id in appWidgetIds) {
      appWidgetManager.updateAppWidget(id, buildViews(context, id, appWidgetManager))
    }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: android.os.Bundle,
  ) {
    appWidgetManager.updateAppWidget(appWidgetId, buildViews(context, appWidgetId, appWidgetManager))
  }

  companion object {
    /** 需求 §15.3 的四档 */
    private val ROW_STEPS = intArrayOf(1, 3, 5, 7)

    /**
     * 按组件的可用高度（dp）挑档位。
     *
     * 分界值 = 「标题 + N 行」的估算高度：标题约 24dp，每行约 28dp
     * （13sp 文本 ≈ 18dp + 上下各 5dp padding）。
     * 取**不超过可用高度的最大档** —— 拉矮时先丢行，而不是把标题截成「…」
     * （`ellipsize=end` 截出来的半句话比少一行更难读）。
     *
     * 180dp（默认 `minHeight`）⇒ 24 + 28×5 = 164 ≤ 180 ⇒ **5 条** ✓
     */
    internal fun rowsForHeight(heightDp: Int): Int {
      var picked = ROW_STEPS.first()
      for (n in ROW_STEPS) {
        if (heightDp >= TITLE_DP + ROW_DP * n) picked = n
      }
      return picked
    }

    /** 标题行高度（估算） */
    private const val TITLE_DP = 24
    /** 一行笔记的高度（估算） */
    private const val ROW_DP = 28

    /** 刷新桌面上所有「最近笔记」组件 */
    fun refreshAll(context: Context) {
      val mgr = AppWidgetManager.getInstance(context) ?: return
      val ids = mgr.getAppWidgetIds(ComponentName(context, RecentNotesWidget::class.java))
      if (ids.isEmpty()) return
      for (id in ids) mgr.updateAppWidget(id, buildViews(context, id, mgr))
    }

    /** 一行文本：「时间 · 标题」——今天的只给时分，更早的给月日 */
    internal fun rowText(note: SnapshotNote, now: Long = System.currentTimeMillis()): String {
      val stamp = if (sameLocalDay(note.mtime, now)) {
        SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(note.mtime))
      } else {
        SimpleDateFormat("MM-dd", Locale.CHINA).format(Date(note.mtime))
      }
      return "$stamp · ${note.title}"
    }

    private fun rowIds(): IntArray = intArrayOf(
      R.id.widget_rn_row_1,
      R.id.widget_rn_row_2,
      R.id.widget_rn_row_3,
      R.id.widget_rn_row_4,
      R.id.widget_rn_row_5,
      R.id.widget_rn_row_6,
      R.id.widget_rn_row_7,
    )

    /** 组装 RemoteViews（纯函数式：只读快照 + options，无副作用） */
    internal fun buildViews(
      context: Context,
      appWidgetId: Int,
      appWidgetManager: AppWidgetManager,
    ): RemoteViews {
      val views = RemoteViews(context.packageName, R.layout.widget_recent_notes)
      val snapshot = WidgetSnapshot.read(context)
      val rows = rowsForHeight(readHeightDp(context, appWidgetId, appWidgetManager))
      val ids = rowIds()

      // 整块点开应用（点单行也一样 —— 未做「直达某篇」，需求 §15.3 没要求）
      val openApp = openAppIntent(context)
      views.setOnClickPendingIntent(R.id.widget_recent_notes_root, openApp)

      var shown = 0
      for (i in ids.indices) {
        val id = ids[i]
        if (i >= rows) {
          views.setViewVisibility(id, View.GONE)
          continue
        }
        val note = snapshot.notes.getOrNull(i)
        if (note == null) {
          views.setViewVisibility(id, View.GONE)
          continue
        }
        views.setViewVisibility(id, View.VISIBLE)
        views.setTextViewText(id, rowText(note))
        views.setOnClickPendingIntent(id, openApp)
        shown++
      }
      views.setViewVisibility(R.id.widget_rn_empty, if (shown == 0) View.VISIBLE else View.GONE)
      return views
    }

    /** 组件高度（dp）；拿不到 options 时按默认 5 条那档给 */
    private fun readHeightDp(
      context: Context,
      appWidgetId: Int,
      appWidgetManager: AppWidgetManager,
    ): Int {
      val opts = appWidgetManager.getAppWidgetOptions(appWidgetId) ?: return 180
      val minHeight = opts.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 180)
      // ⚠️ Android 的 options 里高度是**像素无关的 dp**，直接按它分档
      return if (minHeight <= 0) 180 else minHeight
    }

    private fun openAppIntent(context: Context): PendingIntent {
      val intent = Intent(context, MainActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      }
      return PendingIntent.getActivity(
        context,
        1,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }
  }
}
