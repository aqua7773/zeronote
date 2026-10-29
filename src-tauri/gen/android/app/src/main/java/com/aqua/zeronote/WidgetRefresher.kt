package com.aqua.zeronote

import android.content.Context
import android.os.FileObserver
import android.util.Log

/**
 * 「快照变了就把桌面组件刷一遍」（rev173.243 修：组件加早了就永远停在空状态）
 *
 * ## 为什么必须有它
 *
 * 组件的 `onUpdate` 只在三个时机被系统调用：**添加组件时** / `updatePeriodMillis` 到点 /
 * Launcher 重建 host。内核写快照（笔记变了、打了卡）都**不在**这三个时机里 ——
 * 于是「先加组件、后建计划」的用户看到的是**永远的空状态**（本轮实测：
 * 快照 `plans` 有「跑步 / 早起」两条，组件却一直显示「今天没有要打卡的计划」）。
 *
 * 真正的通知通道只有一条：**在同一个进程里盯着那个文件**。App 写快照时进程一定活着，
 * 所以 `FileObserver` 覆盖的正是「数据会变」的全部时刻：
 *
 * - 前端 `widget_data_write` 是**原子替换**（写 `.tmp` 再 rename）⇒ 目录里收到 `MOVED_TO`
 *   （path = `widget-data.json`）；
 * - 打卡组件自己也会改快照（`done` +1）⇒ 同样走替换 ⇒ 也会触发一次（幂等，无害）。
 *
 * ## 为什么不常驻开始监听
 *
 * 监听器挂在进程上，进程被系统回收就没了 —— 但那时快照也不会变（写快照的 WebView 同进程），
 * 所以不存在「数据变了却没人通知」。每个 provider 的 `onUpdate` 都会调
 * [ensureWatching]（幂等），重建进程后第一次更新就把监听接回来。
 */
object WidgetRefresher {
  private const val TAG = "zn-widget"
  /** 快照文件名（与 `WidgetPaths` 内部常量一致） */
  private const val SNAPSHOT = "widget-data.json"

  @Volatile
  private var observer: FileObserver? = null

  /** 幂等：已经盯着就不重复注册（每个 provider 的 onUpdate 都会调） */
  @Synchronized
  fun ensureWatching(context: Context) {
    if (observer != null) return
    val app = context.applicationContext
    val dir = WidgetPaths.privateDir(app)
    if (!dir.isDirectory) {
      // `.zn` 还不存在（App 从没跑过）⇒ 等下次 onUpdate 再试
      return
    }
    // 用 deprecated 的单参数构造：带 mask 的那个是 API 29+，而 minSdk = 24。
    // 单参数版本监听「全部事件」，反正下一行就按文件名过滤了。
    @Suppress("DEPRECATION")
    val o = object : FileObserver(dir.path) {
      override fun onEvent(event: Int, path: String?) {
        if (path != SNAPSHOT) return
        try {
          RecentNotesWidget.refreshAll(app)
          HabitWidget.refreshAll(app)
        } catch (e: Throwable) {
          // 刷新失败只影响「桌面上还是旧内容」，不能让它把进程带崩
          Log.w(TAG, "快照变化后刷新组件失败：${e.message}")
        }
      }
    }
    try {
      o.startWatching()
      observer = o
    } catch (e: Throwable) {
      Log.w(TAG, "无法监听快照变化（组件将只在系统回调时刷新）：${e.message}")
    }
  }
}
