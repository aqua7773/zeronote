package com.aqua.zeronote

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView

/**
 * 渲染停摆看门狗（rev173.347 · 原生层）。
 *
 * ## 为什么必须在这一层
 *
 * 2026-11-03 / 11-04 真机实测的白屏（`docs/白屏-渲染停摆-2026-11-04.md`）：
 * 首页放着约 13 分钟后画面**纯白**，点击 / 旋转都不重绘，但 ——
 *   · DOM 完好（`.zn-app` 在、rect 正常、有子元素）
 *   · `requestAnimationFrame` 照转、CSS 动画事件照派发
 *   · Rust 看门狗没杀进程（JS `setInterval` 心跳照发）
 *   · WebView 渲染进程 CPU **0.0%**
 *
 * ⇒ 挂的是**渲染进程的合成输出**（不出新帧），JS 主线程与 App 主进程都活着。
 * JS 层的三套判据（DOM / rAF / CSS 动画）全部跑在主线程，测不到「合成停摆」，
 * 已逐一被真机证伪（见 `useWindowGuard.ts` 的 `useRenderStallRescue` 注释）。
 *
 * ## 本层用什么判据（以及两条已作废的路）
 *
 * 判据 = **五条全宽横带都几乎纯白** 且 **JS 确认 DOM 还正常**：
 *   · 纯白：白屏现场就是整窗纯白；正常页面（深色/米色/浅色主题）五条横带里
 *     至少有一条落着文字、卡片边框或工具栏。
 *   · DOM 正常：区分「渲染停摆」与「真空白页 / 加载失败」。后者 DOM 会挂，
 *     交给 JS 层与 `onPageFinished` 那套处理，这里不动手。
 *
 * **作废路径 1：`PixelCopy.request(window, …)`**（真机实测 2026-11-04 00:48）——
 * 只抓窗口主 Surface，而 Tauri 的 WebView 内容在独立 `SurfaceControl` 子层
 * （`dumpsys SurfaceFlinger --list`：`MainActivity#40938` 下面还有 `#40939`；
 * `uiautomator dump` 显示 WebView 是叶子节点、没有 SurfaceView）。结果：页面有内容
 * （截图 88 KB），抓回来五条横带全是 1.00 纯白。
 *
 * **作废路径 2：`webView.draw(canvas)`**（真机实测 2026-11-04 00:53）——
 * 硬件加速下 Chromium 不往软件 Canvas 里画内容，同样全白。
 *
 * 【2026-11-04 已停用 · 用户拍板 A】真机实测 `webView.draw()` 在正常页面上也是全白
 * （红色覆盖层自检能画、Chromium 内容画不出）⇒ 「全白」判据不可信，自动软复位必然误判。
 * 现在**只采样记日志，不做任何自救动作**（软复位实现已删，`git log` 可找回）。
 * 后续若走方案 C（找「渲染进程真出帧」的可读信号），从这里接着做。
 *
 * 日志 tag = `ZN-RENDER`，`adb logcat -s ZN-RENDER` 可看每 10 秒的采样读数
 * （验收时唯一的现场证据来源，别删）。
 */
class RenderWatchdog(
  @Suppress("unused") private val activity: Activity,
  private val webView: WebView,
) {
  private val handler = Handler(Looper.getMainLooper())

  private var running = false
  /** 连续「全白 + DOM 正常」的采样次数 */
  private var whiteStreak = 0

  /** 横带在窗口高度上的位置（比例）。五条都白才算「画面全白」。 */
  private val bands = floatArrayOf(0.10f, 0.30f, 0.50f, 0.70f, 0.90f)

  fun start() {
    if (running) return
    running = true
    whiteStreak = 0
    handler.removeCallbacks(tick)
    handler.postDelayed(tick, WARMUP_MS)
    Log.i(TAG, "start · warmup=${WARMUP_MS}ms tick=${TICK_MS}ms")
  }

  fun stop() {
    if (!running) return
    running = false
    handler.removeCallbacks(tick)
    whiteStreak = 0
    Log.i(TAG, "stop")
  }

  private val tick = object : Runnable {
    override fun run() {
      if (!running) return
      if (!webView.isAttachedToWindow || webView.width <= 0 || webView.height <= 0) {
        handler.postDelayed(this, TICK_MS)
        return
      }
      sampleFrame()
      handler.postDelayed(this, TICK_MS)
    }
  }

  /** 把 WebView 画到 1/4 缩放的 Bitmap，再按横带算白色占比。 */
  private fun sampleFrame() {
    if (!running) return
    val bmp = drawScaled() ?: return
    val ratios = FloatArray(bands.size) { i -> bandWhiteRatio(bmp, bands[i]) }
    bmp.recycle()
    onBandsDone(ratios)
  }

  /** 软件绘制到 1/4 缩放位图；硬件加速下 Chromium 画不出内容（本机实测，见类注释） */
  private fun drawScaled(): Bitmap? {
    val w = webView.width
    val h = webView.height
    if (w <= 0 || h <= 0) return null
    val scale = SAMPLE_SCALE
    val bw = (w * scale).toInt().coerceAtLeast(1)
    val bh = (h * scale).toInt().coerceAtLeast(1)
    return try {
      val b = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
      val c = Canvas(b)
      c.scale(scale, scale)
      webView.draw(c)
      b
    } catch (t: Throwable) {
      Log.w(TAG, "draw 抛错: ${t.javaClass.simpleName} ${t.message}")
      null
    }
  }

  /** 缩放图上一段横带里近白像素的占比 */
  private fun bandWhiteRatio(bmp: Bitmap, band: Float): Float {
    val bh = bmp.height
    val bandPx = (BAND_H * SAMPLE_SCALE).toInt().coerceAtLeast(1)
    val centerY = (bh * band).toInt().coerceIn(0, bh - 1)
    val top = (centerY - bandPx / 2).coerceIn(0, (bh - bandPx).coerceAtLeast(0))
    var white = 0
    var total = 0
    var y = top
    while (y < (top + bandPx).coerceAtMost(bh)) {
      var x = 0
      while (x < bmp.width) {
        val c = bmp.getPixel(x, y)
        val r = (c shr 16) and 0xFF
        val g = (c shr 8) and 0xFF
        val b = c and 0xFF
        if (r >= WHITE_LEVEL && g >= WHITE_LEVEL && b >= WHITE_LEVEL) white++
        total++
        x += 2
      }
      y += 1
    }
    return if (total == 0) 0f else white.toFloat() / total
  }

  private fun onBandsDone(ratios: FloatArray) {
    if (!running) return
    val allWhite = ratios.all { it >= WHITE_RATIO }
    Log.i(
      TAG,
      "bands=[" + ratios.joinToString(",") { String.format("%.2f", it) } + "] allWhite=" +
        allWhite + " streak=$whiteStreak",
    )
    if (!allWhite) {
      whiteStreak = 0
      return
    }
    // 画面全白 —— 再问 JS：DOM 正常 ⇒ 可能是渲染停摆（不是空白页 / 加载失败）
    webView.evaluateJavascript(DOM_PROBE_JS) { raw ->
      if (!running) return@evaluateJavascript
      val domAlive = raw == "true"
      Log.i(TAG, "domProbe=$raw domAlive=$domAlive")
      if (!domAlive) {
        // DOM 也挂了 ⇒ 归 JS 层 / 加载那套处理，这里不动手
        whiteStreak = 0
        return@evaluateJavascript
      }
      // 自动判据已停用（rev173.367 · 2026-11-04 用户拍板 A）：`webView.draw()` 在本机画不出
      // Chromium 内容，判据必然误判；这里只记日志，不再铺红色自检、不再软复位。
      whiteStreak++
      Log.i(TAG, "全白 + DOM 正常 · streak=$whiteStreak/$STALL_SAMPLES（自动判据已停用，不动手）")
      if (whiteStreak >= STALL_SAMPLES) {
        Log.w(TAG, "连续 ${STALL_SAMPLES} 次全白 + DOM 正常 —— 自动判据已停用（rev173.367），只记日志")
        whiteStreak = 0
      }
    }
  }

  private companion object {
    const val TAG = "ZN-RENDER"

    /** 采样间隔：10 秒一条 */
    const val TICK_MS = 10_000L

    /** 启动 / 回到前台后先等这么久（页面加载、首帧合成都可能还没完成） */
    const val WARMUP_MS = 30_000L

    /** 横带高度（原始像素，缩放后按比例） */
    const val BAND_H = 8

    /** 画到 bitmap 时的缩放比（1/4：1220×2712 → 305×678） */
    const val SAMPLE_SCALE = 0.25f

    /** 单通道 ≥ 这个值算「近白」 */
    const val WHITE_LEVEL = 240

    /** 一条横带里近白像素占比 ≥ 这个值算「这条是白的」 */
    const val WHITE_RATIO = 0.97f

    /** 连续多少次「全白 + DOM 正常」才动手（30 × 10s = 5 分钟 —— 拉宽是因为 draw 判据可能误判） */
    const val STALL_SAMPLES = 30

    /**
     * DOM 是否「正常」：`.zn-app` 在、有子元素、body 有内容。
     * 返回字符串 `"true"` / `"false"`（`evaluateJavascript` 的原样返回）。
     */
    const val DOM_PROBE_JS =
      """(function(){var a=document.querySelector('.zn-app');var b=document.body;""" +
        """return !!(a&&a.children&&a.children.length>0&&b&&b.children&&b.children.length>0);})()"""

  }
}
