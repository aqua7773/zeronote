package com.aqua.zeronote

import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 明确关掉"窗口自行避让系统栏"：让 WebView 真正铺到屏幕边缘，
    // 系统栏那一段的间距交给页面 CSS 的 env(safe-area-inset-*) 处理。
    // 不这么做的话，系统栏那一条会露出 Activity 的窗口底色 —— 也就是
    // 用户看到的"上下两端没覆盖的灰"。
    WindowCompat.setDecorFitsSystemWindows(window, false)
  }
}
