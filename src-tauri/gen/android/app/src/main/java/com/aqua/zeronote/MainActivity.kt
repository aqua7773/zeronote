package com.aqua.zeronote

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 明确关掉"窗口自行避让系统栏"：让 WebView 真正铺到屏幕边缘，
    // 系统栏那一段的间距交给页面 CSS 的 env(safe-area-inset-*) 处理。
    WindowCompat.setDecorFitsSystemWindows(window, false)
    // 状态栏的显隐自 2026-10-12 起**由 statusbar 插件按需控制**：
    // 侧栏（抽屉）打开 → 隐藏；收起（首页）→ 显示。
    // 这里不再无条件隐藏，只保留「从顶部下拉可临时唤出」的交互行为。
    // 实现见 src-tauri/plugins/tauri-plugin-statusbar/
    WindowInsetsControllerCompat(window, window.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
  }
}
