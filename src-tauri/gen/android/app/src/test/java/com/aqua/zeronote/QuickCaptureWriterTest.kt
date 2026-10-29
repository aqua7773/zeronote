package com.aqua.zeronote

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

/**
 * 快速输入落点（rev173.242 · 需求 §15.1）
 *
 * 守着三件事 —— 每条都对应一个真实会出错的点：
 * 1. **落点**必须是 `<库>/收件箱/`（需求原文），不是库根、也不是 `.zn/` 私有目录；
 * 2. **空输入不写**（否则用户误点按钮就在收件箱里留一个空文件）；
 * 3. **同秒两条不互相覆盖**（时间戳精确到秒，连点两下是很常见的操作）。
 */
class QuickCaptureWriterTest {
  private lateinit var vault: File

  @Before
  fun setUp() {
    vault = File(System.getProperty("java.io.tmpdir"), "zn-qc-test-${System.nanoTime()}")
    assertTrue(vault.mkdirs())
  }

  @After
  fun tearDown() {
    vault.deleteRecursively()
  }

  @Test
  fun writesIntoInboxDir() {
    val f = QuickCaptureWriter.write(vault, "  买牛奶  ", 1_700_000_000_000L)
    assertNotNull(f)
    assertEquals("收件箱", f!!.parentFile!!.name)
    assertEquals(vault.absolutePath, f.parentFile!!.parentFile!!.absolutePath)
    // 前后空白被裁掉，正文原样
    assertEquals("买牛奶", f.readText(Charsets.UTF_8))
  }

  @Test
  fun keepsUtf8AndNewlines() {
    val body = "第一行\n第二行 🙂"
    val f = QuickCaptureWriter.write(vault, body)!!
    assertEquals(body, f.readText(Charsets.UTF_8))
  }

  @Test
  fun emptyInputWritesNothing() {
    assertNull(QuickCaptureWriter.write(vault, "   \n  "))
    val inbox = File(vault, QuickCaptureWriter.INBOX_DIR)
    // 空输入连目录都不建（写盘路径根本没走到）
    assertTrue(!inbox.exists() || (inbox.listFiles()?.isEmpty() ?: true))
  }

  @Test
  fun sameSecondDoesNotOverwrite() {
    val now = 1_700_000_123_000L
    val a = QuickCaptureWriter.write(vault, "第一条", now)!!
    val b = QuickCaptureWriter.write(vault, "第二条", now)!!
    assertTrue(a.absolutePath != b.absolutePath)
    assertEquals("第一条", a.readText(Charsets.UTF_8))
    assertEquals("第二条", b.readText(Charsets.UTF_8))
    assertEquals(2, File(vault, QuickCaptureWriter.INBOX_DIR).listFiles()!!.size)
  }

  @Test
  fun createsInboxWhenMissing() {
    assertTrue(!File(vault, QuickCaptureWriter.INBOX_DIR).exists())
    QuickCaptureWriter.write(vault, "x")
    assertTrue(File(vault, QuickCaptureWriter.INBOX_DIR).isDirectory)
  }

  @Test
  fun stampUsesLocalDate() {
    // 本地 2026-10-29 20:15:33
    val d = java.util.Calendar.getInstance()
    d.set(2026, 9, 29, 20, 15, 33)
    d.set(java.util.Calendar.MILLISECOND, 0)
    assertEquals("2026-10-29-201533", QuickCaptureWriter.stamp(d.timeInMillis))
  }
}
