package com.aqua.zeronote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 桌面组件的纯逻辑（rev173.242 · 需求 §15）
 *
 * 这里只测**不依赖 Android 运行时**的部分：快照解析、条数分档、行文本。
 * 真正的渲染（RemoteViews）与点击（PendingIntent）靠真机 —— 见 HANDOFF。
 */
class WidgetLogicTest {

  /* ── 快照解析 ── */

  @Test
  fun parsesFullSnapshot() {
    val json = """
      {"version":1,"vault":"/storage/emulated/0/Documents/ZeroNote","updatedAt":1700000000000,
       "plans":[{"id":"p1","title":"晨跑","done":2,"target":3}],
       "notes":[{"path":"工作/周报.md","title":"周报","mtime":1699999999000}]}
    """.trimIndent()
    val s = WidgetSnapshot.parse(json)
    assertEquals("/storage/emulated/0/Documents/ZeroNote", s.vault)
    assertEquals(1700000000000L, s.updatedAt)
    assertEquals(1, s.plans.size)
    assertEquals("晨跑", s.plans[0].title)
    assertEquals(2, s.plans[0].done)
    assertEquals(3, s.plans[0].target)
    assertEquals(1, s.notes.size)
    assertEquals("工作/周报.md", s.notes[0].path)
  }

  @Test
  fun badJsonDegradesToEmpty() {
    val s = WidgetSnapshot.parse("not json at all")
    assertEquals("", s.vault)
    assertEquals(0L, s.updatedAt)
    assertTrue(s.plans.isEmpty())
    assertTrue(s.notes.isEmpty())
  }

  @Test
  fun skipsEntriesWithoutIdOrPath() {
    val json = """{"notes":[{"title":"没路径"},{"path":"a.md"}]}"""
    val s = WidgetSnapshot.parse(json)
    assertEquals(1, s.notes.size)
    assertEquals("a.md", s.notes[0].path)
    // 标题缺失时退回路径（组件不能显示空行）
    assertEquals("a.md", s.notes[0].title)
  }

  @Test
  fun targetAtLeastOne() {
    val s = WidgetSnapshot.parse("""{"plans":[{"id":"p","title":"x","target":0}]}""")
    assertEquals(1, s.plans[0].target)
  }

  @Test
  fun missingArraysAreEmpty() {
    val s = WidgetSnapshot.parse("""{"vault":"/v"}""")
    assertTrue(s.plans.isEmpty())
    assertTrue(s.notes.isEmpty())
  }

  /* ── 条数分档（需求 §15.3：1 / 3 / 5 / 7） ── */

  @Test
  fun rowsFollowHeight() {
    // 默认 minHeight = 180dp ⇒ 5 条
    assertEquals(5, RecentNotesWidget.rowsForHeight(180))
    // 一行都放不下的极矮组件给 1 条（不是 0）
    assertEquals(1, RecentNotesWidget.rowsForHeight(0))
    assertEquals(1, RecentNotesWidget.rowsForHeight(40))
    assertEquals(3, RecentNotesWidget.rowsForHeight(120))
    assertEquals(7, RecentNotesWidget.rowsForHeight(260))
    // 再高也不超过需求上限 7
    assertEquals(7, RecentNotesWidget.rowsForHeight(2000))
  }

  /* ── 行文本 ── */

  @Test
  fun habitRowText() {
    assertEquals("晨跑 · 1/3", HabitWidget.rowText(SnapshotPlan("p", "晨跑", 1, 3)))
    assertEquals("✓ 晨跑", HabitWidget.rowText(SnapshotPlan("p", "晨跑", 3, 3)))
    assertEquals("✓ 晨跑", HabitWidget.rowText(SnapshotPlan("p", "晨跑", 5, 3)))
  }

  @Test
  fun recentNoteRowTextUsesTodayOrMonthDay() {
    val cal = java.util.Calendar.getInstance()
    cal.set(2026, 9, 29, 20, 15, 0)
    val now = cal.timeInMillis
    assertEquals("20:15 · 周报", RecentNotesWidget.rowText(SnapshotNote("a.md", "周报", now), now))
    val yesterday = now - 24L * 3600 * 1000
    assertEquals("10-28 · 周报", RecentNotesWidget.rowText(SnapshotNote("a.md", "周报", yesterday), now))
  }

  @Test
  fun sameLocalDayIsNotUtcDay() {
    val cal = java.util.Calendar.getInstance()
    cal.set(2026, 9, 29, 0, 5, 0)
    val early = cal.timeInMillis
    cal.set(2026, 9, 29, 23, 55, 0)
    val late = cal.timeInMillis
    assertTrue(sameLocalDay(early, late))
    assertFalse(sameLocalDay(early, late + 24L * 3600 * 1000))
    assertFalse(sameLocalDay(0, late))
  }
}
