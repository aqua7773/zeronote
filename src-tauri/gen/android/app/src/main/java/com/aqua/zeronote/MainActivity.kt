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
    // 隐藏顶部系统状态栏 —— 用户要求：「红框的信息直接不显示更好」
    //（时间/信号/电量那一条）。用 TRANSIENT_BARS_BY_SWIPE，用户从顶部下拉时
    // 仍能临时唤出，不至于彻底够不着。
    // 隐藏后 WebView 的 env(safe-area-inset-top) 归 0，侧栏的 padding-top 也随之
    // 归零，内容自然顶到屏幕最上沿。
    WindowInsetsControllerCompat(window, window.decorView).apply {
      hide(WindowInsetsCompat.Type.statusBars())
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
    }
  }
}
