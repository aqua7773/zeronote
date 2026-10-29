package com.aqua.zeronote

import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import java.io.File

/**
 * 「快速输入」桌面组件的输入框（rev173.242 · 需求 §15.1）
 *
 * ## 需求原文与实现对应
 *
 * | 需求 | 这里怎么做的 |
 * |---|---|
 * | 点击后弹出轻量输入框 | 一个 **对话框样式的独立 Activity**（不是 RemoteViews 里的 EditText —— 那东西 API 26+ 才勉强支持、多数 Launcher 根本不弹键盘） |
 * | 不打开主应用 | 只启动本 Activity，`MainActivity` 一行都不碰（不建 WebView） |
 * | 输入完保存后消失 | 保存 ⇒ 写文件 ⇒ `finish()` |
 * | 存到临时收件箱文件夹 | 交给 [QuickCaptureWriter]：`<库>/收件箱/<时间戳>.md` |
 * | 固定公开 | 走公共存储的普通 `.md`，不经 `security` 插件的私密目录 |
 * | 不即时走 AI 分类 | 只写文件；整理由用户自己触发（AI 排除名单里本来就有 `收件箱`） |
 *
 * 失败**不静默**：写不进去时 Toast 指出原因（最常见是没有「所有文件访问」权限）。
 */
class QuickCaptureActivity : AppCompatActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.activity_quick_capture)

    val input = findViewById<EditText>(R.id.quick_capture_input)
    val save = findViewById<Button>(R.id.quick_capture_save)
    val cancel = findViewById<Button>(R.id.quick_capture_cancel)

    input.requestFocus()
    save.setOnClickListener { saveNote(input.text.toString()) }
    cancel.setOnClickListener { finish() }
  }

  /** 写一条进收件箱；空内容不写（不要制造空笔记） */
  private fun saveNote(raw: String) {
    val vault = WidgetPaths.vaultDir(this)
    if (!vault.isDirectory) {
      Toast.makeText(this, getString(R.string.widget_capture_no_vault, vault.absolutePath), Toast.LENGTH_LONG)
        .show()
      return
    }
    val written: File? = try {
      QuickCaptureWriter.write(vault, raw)
    } catch (e: Throwable) {
      val reason = e.localizedMessage ?: e.javaClass.simpleName
      Toast.makeText(this, getString(R.string.widget_capture_failed, reason), Toast.LENGTH_LONG).show()
      return
    }
    if (written == null) {
      Toast.makeText(this, R.string.widget_capture_empty, Toast.LENGTH_SHORT).show()
      return
    }
    Toast.makeText(this, getString(R.string.widget_capture_saved), Toast.LENGTH_SHORT).show()
    // 桌面上的「最近笔记」立刻反映这条（同进程、同一份快照文件）
    RecentNotesWidget.refreshAll(this)
    finish()
  }

  companion object {
    /** 从桌面组件打开输入框（`NEW_TASK` 是必须的：Activity 从非 Activity 上下文启动） */
    fun intent(context: android.content.Context): android.content.Intent =
      android.content.Intent(context, QuickCaptureActivity::class.java)
        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
  }
}
