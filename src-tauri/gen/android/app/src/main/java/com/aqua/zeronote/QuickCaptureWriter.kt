package com.aqua.zeronote

import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 「快速输入」的落盘逻辑（rev173.242 · 需求 §15.1）
 *
 * ## 为什么从 Activity 里抽出来
 *
 * 需求里最容易错的一条是**落点**（收件箱目录 + 文件名规则 + 同秒不覆盖），
 * 而它在 Activity 里就没法自动化验证。抽成不依赖 Android 的纯逻辑后，
 * `QuickCaptureWriterTest` 可以直接用临时目录跑（`gradlew testDebugUnitTest`）。
 *
 * ## 文件名为什么是时间戳
 *
 * 用户这时只记一句话，还没有标题。`YYYY-MM-DD-HHmmss` 排序自然、不撞名、
 * 不会被正文里的 `/`、emoji、换行污染。正文原样保存，整理时改标题即可。
 */
object QuickCaptureWriter {
  /** 临时收件箱目录名（需求 §15.1 原文；AI 的排除名单里也是这个名字） */
  const val INBOX_DIR = "收件箱"

  /**
   * 写一条进收件箱。
   *
   * @return 落盘的文件；**空内容返回 null**（不制造空笔记）
   * @throws SecurityException / java.io.IOException 写不进去时抛出（调用方负责提示用户）
   */
  fun write(vaultDir: File, text: String, now: Long = System.currentTimeMillis()): File? {
    val body = text.trim()
    if (body.isEmpty()) return null
    val dir = File(vaultDir, INBOX_DIR)
    if (!dir.isDirectory && !dir.mkdirs()) {
      throw java.io.IOException("无法创建目录 ${dir.absolutePath}")
    }
    val file = uniqueFile(dir, stamp(now))
    // UTF-8 无 BOM：与内核 `write_note` 的口径一致
    file.writeText(body, Charsets.UTF_8)
    return file
  }

  /** `2026-10-29-201533`（本地时区；不用 UTC —— 东八区夜里会差一天） */
  internal fun stamp(now: Long): String =
    SimpleDateFormat("yyyy-MM-dd-HHmmss", Locale.CHINA).format(Date(now))

  /** 同一秒连按两次也不覆盖：`…-2.md` / `…-3.md` … */
  internal fun uniqueFile(dir: File, stamp: String): File {
    val direct = File(dir, "$stamp.md")
    if (!direct.exists()) return direct
    for (i in 2..99) {
      val f = File(dir, "$stamp-$i.md")
      if (!f.exists()) return f
    }
    // 极端（同一秒 99 条）：加毫秒后缀，仍然不覆盖
    return File(dir, "$stamp-${System.currentTimeMillis() % 1000}.md")
  }
}
