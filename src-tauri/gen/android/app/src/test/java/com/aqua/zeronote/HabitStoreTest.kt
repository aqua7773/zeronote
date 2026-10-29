package com.aqua.zeronote

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 打卡组件的写回语义（rev173.242 · 需求 §15.2）
 *
 * 这里只测**纯 JSON 变换**（不碰文件、不碰 Android）：组件写的是插件自己的
 * `checks` 结构，写歪了不会报错 —— 只会让面板里的打卡记录少一条/多一条，
 * 所以每一条语义都要钉住。
 */
class HabitStoreTest {

  private fun storeJson(): JSONObject =
    JSONObject("""{"usages":{},"checks":{},"plans":[{"id":"p1","title":"晨跑"}]}""")

  @Test
  fun appendsCheckIntoEmptyStore() {
    val root = storeJson()
    HabitStore.addCheckIn(root, "p1", "2026-10-29", "20:12")
    val day = root.getJSONObject("checks").getJSONObject("p1").getJSONArray("2026-10-29")
    assertEquals(1, day.length())
    assertEquals("20:12", day.getString(0))
  }

  @Test
  fun appendsToExistingDay() {
    val root = JSONObject(
      """{"checks":{"p1":{"2026-10-29":["08:00"]}}}""",
    )
    HabitStore.addCheckIn(root, "p1", "2026-10-29", "21:30")
    val day = root.getJSONObject("checks").getJSONObject("p1").getJSONArray("2026-10-29")
    assertEquals(2, day.length())
    assertEquals("08:00", day.getString(0))
    assertEquals("21:30", day.getString(1))
  }

  @Test
  fun doesNotTouchOtherPlansOrDays() {
    val root = JSONObject(
      """{"checks":{"p1":{"2026-10-28":["09:00"]},"p2":{"2026-10-29":["07:00"]}}}""",
    )
    HabitStore.addCheckIn(root, "p1", "2026-10-29", "20:12")
    val checks = root.getJSONObject("checks")
    assertEquals(1, checks.getJSONObject("p1").getJSONArray("2026-10-28").length())
    assertEquals(1, checks.getJSONObject("p2").getJSONArray("2026-10-29").length())
    assertEquals(1, checks.getJSONObject("p1").getJSONArray("2026-10-29").length())
  }

  @Test
  fun rebuildsBrokenLevelsInsteadOfThrowing() {
    // 旧版 / 半截数据：checks 是数组、某计划的当天记录是字符串
    val root = JSONObject("""{"checks":[]}""")
    HabitStore.addCheckIn(root, "p1", "2026-10-29", "20:12")
    assertTrue(root.get("checks") is JSONObject)

    val root2 = JSONObject("""{"checks":{"p1":{"2026-10-29":"oops"}}}""")
    HabitStore.addCheckIn(root2, "p1", "2026-10-29", "20:12")
    assertTrue(
      root2.getJSONObject("checks").getJSONObject("p1").get("2026-10-29") is JSONArray,
    )
  }

  @Test
  fun keepsPlansUntouched() {
    val root = storeJson()
    HabitStore.addCheckIn(root, "p1", "2026-10-29", "20:12")
    assertEquals(1, root.getJSONArray("plans").length())
    assertEquals("晨跑", root.getJSONArray("plans").getJSONObject(0).getString("title"))
  }
}
