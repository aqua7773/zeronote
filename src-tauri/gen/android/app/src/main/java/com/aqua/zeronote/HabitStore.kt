package com.aqua.zeronote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 打卡组件的写回通道（rev173.242 · 需求 §15.2「点击某个计划，直接完成一次打卡」）
 *
 * ## 为什么要写**插件自己的 store**，而不是一份组件专用的副本
 *
 * 打卡数据是 `habit` 插件的 `store.json`（`plans` + `checks`），面板、日历、连续天数
 * 全从它来。组件另存一份「今天打了卡」的副本 ⇒ 两套账，第二天就对不上。
 *
 * ## 已知边界（不静默，写进 HANDOFF）
 *
 * 组件在 Launcher 侧写盘，而插件在 WebView 里有**内存态**：如果 App 正活在后台，
 * 插件手里的 `checks` 还是旧的，用户回 App 再点一次打卡就会把组件这一笔覆盖掉。
 * 对策 = 写盘后留一个 **dirty 标记**（`.zn/widget-habit-dirty`），前端回到前台时
 * 见到标记就 `reloadPlugin('habit')`（重载即重新 `apply` → 从磁盘重读）。
 *
 * ⚠️ 这是「尽力而为」的一致性：极端时序下（App 后台被冻、插件内存态从未落地）
 * 仍可能丢一次记录。把它当成「桌面上的快捷打卡」，不是数据库事务。
 */
object HabitStore {
  /** 打卡插件 id（与 `src/kernel/widget-data.ts` 的 `HABIT_PLUGIN_ID` 一致） */
  private const val PLUGIN_ID = "habit"

  /** dirty 标记文件名（父目录 = `<dataDir>/.zn/`） */
  private const val DIRTY_FILE = "widget-habit-dirty"

  private const val KEY_PLANS = "plans"
  private const val KEY_CHECKS = "checks"

  /** `<dataDir>/.zn/plugins/habit/store.json` */
  fun storeFile(context: Context): File =
    File(File(WidgetPaths.privateDir(context), "plugins"), "$PLUGIN_ID/store.json")

  /** dirty 标记（前端消费后自行删除） */
  fun dirtyFile(context: Context): File = File(WidgetPaths.privateDir(context), DIRTY_FILE)

  private fun todayKey(now: Long): String =
    SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(Date(now))

  private fun timeKey(now: Long): String =
    SimpleDateFormat("HH:mm", Locale.CHINA).format(Date(now))

  /**
   * 给某个计划打一次卡。
   *
   * 返回 `null` = 成功；否则是给用户看的原因（toast）。
   * 语义与插件里的 `habit.check` 一致：**往当天记录数组里追加一条时间**，
   * 不判断「有没有打满目标次数」（一天可多次是需求 §7.2，打满后还能继续记）。
   */
  fun checkIn(context: Context, planId: String): String? {
    val file = storeFile(context)
    if (!file.isFile) return "没有找到打卡数据（插件可能还没装）"
    val now = System.currentTimeMillis()
    return try {
      val root = JSONObject(file.readText(Charsets.UTF_8))
      addCheckIn(root, planId, todayKey(now), timeKey(now))
      writeAtomic(file, root.toString())
      // 快照里的 done 也要跟着 +1：组件下次 onUpdate 之前（用户还没离开桌面）
      // 就会因为 updateAppWidget 立刻重绘，不更新快照的话会闪回旧数字
      bumpSnapshotDone(context, planId)
      markDirty(context, now)
      null
    } catch (e: Throwable) {
      e.localizedMessage ?: e.javaClass.simpleName
    }
  }

  /**
   * 往 store 的 JSON 里给某计划追加一条当天打卡记录（**纯函数**，JVM 单测入口）。
   *
   * 结构与插件的 `checks` 一致：`{ [planId]: { 'YYYY-MM-DD': ['HH:mm', …] } }`。
   * 任何一级不是预期的对象/数组都**重建那一级**，而不是抛异常 ——
   * 用户手上的 store 可能是旧版 / 半截的，组件不该因为一个坏字段就点不动。
   */
  internal fun addCheckIn(root: JSONObject, planId: String, day: String, time: String): JSONObject {
    val checks = root.optJSONObject(KEY_CHECKS) ?: JSONObject().also { root.put(KEY_CHECKS, it) }
    val planChecks = checks.optJSONObject(planId) ?: JSONObject().also { checks.put(planId, it) }
    val dayArr = planChecks.optJSONArray(day) ?: JSONArray().also { planChecks.put(day, it) }
    dayArr.put(time)
    return root
  }

  /** 把快照里该计划的 `done` +1（快照坏了就算了 —— 组件会显出旧数字，不影响 store 已落盘） */
  private fun bumpSnapshotDone(context: Context, planId: String) {
    val file = WidgetPaths.snapshotFile(context)
    if (!file.isFile) return
    try {
      val root = JSONObject(file.readText(Charsets.UTF_8))
      val plans = root.optJSONArray("plans") ?: return
      for (i in 0 until plans.length()) {
        val p = plans.optJSONObject(i) ?: continue
        if (p.optString("id", "") != planId) continue
        p.put("done", p.optInt("done", 0) + 1)
        break
      }
      root.put("updatedAt", System.currentTimeMillis())
      writeAtomic(file, root.toString())
    } catch (_: Throwable) {
      // 快照是纯展示层：写不进去就不写，别让它挡住真正的打卡记录
    }
  }

  /** 原子写（tmp + rename）：组件与 WebView 可能同时在读这个文件 */
  private fun writeAtomic(file: File, text: String) {
    val tmp = File(file.parentFile, "${file.name}.tmp")
    tmp.writeText(text, Charsets.UTF_8)
    if (!tmp.renameTo(file)) {
      // Windows 上 rename 不会覆盖已有文件；Android 上则可以。失败时退回「写 + 删」
      file.writeText(text, Charsets.UTF_8)
      tmp.delete()
    }
  }

  /** 留标记告诉前端「插件内存态可能过期了」 */
  private fun markDirty(context: Context, now: Long) {
    try {
      dirtyFile(context).writeText(now.toString(), Charsets.UTF_8)
    } catch (_: Throwable) {
      // 标记写不进去只是「下次打开要手动重载插件」，不值得中断打卡
    }
  }
}
