package com.aqua.zeronote

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
  /**
   * 渲染停摆看门狗（rev173.347 · `RenderWatchdog.kt`）——
   * JS 层三套判据被真机证伪后的原生兜底：直接看合成出来的画面。
   */
  private var renderWatchdog: RenderWatchdog? = null

  /** 当前是否处于前台（`start()` 幂等，这里只是避免在后台里白跑定时器） */
  private var resumed = false

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

  /**
   * Wry 创建完 WebView 后回调这里（`WryActivity.setWebView` → `onWebViewCreate`）。
   * 只存引用，不在这里 start —— 此时 WebView 还没 attach 到窗口，
   * PixelCopy 拿不到 surface；真正启动放在 `onResume`。
   */
  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    /*
     * 渲染停摆看门狗**只在 debug 构建里跑**（rev173.360）。
     *
     * 为什么：它的判据（`webView.draw()` 抓画面）在真机上画不出 Chromium 内容 ⇒ 页面
     * 正常也判「全白」，每进程会闪一次整屏红（draw 自检）并在 5 分钟后软复位一次。
     * 这是调试工具，不该出现在用户手上的 release 包里 —— 2026-11-04 用户看到
     * 「屏幕时不时闪一下红色」就是它。
     *
     * debug 包保留：白屏排障还要靠 `ZN-RENDER` 日志与这套采样。
     */
    if (!BuildConfig.DEBUG) return
    renderWatchdog = RenderWatchdog(this, webView)
    if (resumed) renderWatchdog?.start()
  }

  override fun onResume() {
    super.onResume()
    resumed = true
    renderWatchdog?.start()
  }

  override fun onPause() {
    resumed = false
    renderWatchdog?.stop()
    super.onPause()
  }
}
