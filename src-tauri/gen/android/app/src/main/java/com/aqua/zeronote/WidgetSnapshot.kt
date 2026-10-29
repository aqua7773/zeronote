package com.aqua.zeronote

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** 快照里的一条最近笔记 */
data class SnapshotNote(
  val path: String,
  val title: String,
  val mtime: Long,
)

/** 快照里的一行今日计划 */
data class SnapshotPlan(
  val id: String,
  val title: String,
  val done: Int,
  val target: Int,
)

/**
 * 桌面组件的数据快照（rev173.242）
 *
 * 由内核写入（`src/kernel/widget-data.ts` → Rust `widget_data_write`），
 * 组件只读。**任何解析失败都退化成空快照**，不抛异常 ——
 * 一个坏 JSON 不该让 Launcher 上的组件变成系统级崩溃。
 *
 * 字段口径见 `src/kernel/widget-data.ts` 的 `WidgetData`：
 * - `notes` 只含**公开笔记**（不含 `.zn/` 私有目录、不含附件）；
 * - `plans` 只含**今天应打卡**的计划（已按插件里的顺序过滤好）；
 * - `updatedAt` 是毫秒时间戳，组件用它判断「数据是不是今天生成的」。
 */
data class WidgetSnapshot(
  val vault: String,
  val updatedAt: Long,
  val notes: List<SnapshotNote>,
  val plans: List<SnapshotPlan>,
) {
  companion object {
    /** 读快照；文件不存在 / JSON 坏了 / 字段类型不对 ⇒ 全空快照 */
    fun read(context: Context): WidgetSnapshot = read(WidgetPaths.snapshotFile(context))

    internal fun read(file: File): WidgetSnapshot {
      if (!file.exists()) return empty()
      return try {
        parse(file.readText(Charsets.UTF_8))
      } catch (_: Throwable) {
        empty()
      }
    }

    /**
     * 纯解析（单测入口：不碰文件系统）。
     *
     * **永不抛异常**：坏 JSON / 缺字段一律退化成空快照。组件渲染路径上任何一次抛出
     * 都会让 Launcher 的 `onUpdate` 崩（用户看到的是「组件一直是空白」）。
     */
    internal fun parse(text: String): WidgetSnapshot = try {
      val json = JSONObject(text)
      WidgetSnapshot(
        vault = json.optString("vault", "").trim(),
        updatedAt = json.optLong("updatedAt", 0L),
        notes = parseNotes(json.optJSONArray("notes")),
        plans = parsePlans(json.optJSONArray("plans")),
      )
    } catch (_: Throwable) {
      empty()
    }

    private fun parseNotes(arr: JSONArray?): List<SnapshotNote> {
      if (arr == null) return emptyList()
      val out = ArrayList<SnapshotNote>(arr.length())
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val path = o.optString("path", "")
        if (path.isEmpty()) continue
        out.add(
          SnapshotNote(
            path = path,
            title = o.optString("title", "").ifEmpty { path },
            mtime = o.optLong("mtime", 0L),
          ),
        )
      }
      return out
    }

    private fun parsePlans(arr: JSONArray?): List<SnapshotPlan> {
      if (arr == null) return emptyList()
      val out = ArrayList<SnapshotPlan>(arr.length())
      for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val id = o.optString("id", "")
        if (id.isEmpty()) continue
        out.add(
          SnapshotPlan(
            id = id,
            title = o.optString("title", "").ifEmpty { "未命名计划" },
            done = o.optInt("done", 0),
            target = maxOf(1, o.optInt("target", 1)),
          ),
        )
      }
      return out
    }

    private fun empty() = WidgetSnapshot(vault = "", updatedAt = 0L, notes = emptyList(), plans = emptyList())
  }
}

/** 两个毫秒时间戳是不是同一个本地日期（不能用 UTC 的 `% 86400`：东八区会差一天） */
internal fun sameLocalDay(a: Long, b: Long): Boolean {
  if (a <= 0 || b <= 0) return false
  val ca = java.util.Calendar.getInstance()
  ca.timeInMillis = a
  val cb = java.util.Calendar.getInstance()
  cb.timeInMillis = b
  return ca.get(java.util.Calendar.YEAR) == cb.get(java.util.Calendar.YEAR) &&
    ca.get(java.util.Calendar.DAY_OF_YEAR) == cb.get(java.util.Calendar.DAY_OF_YEAR)
}
