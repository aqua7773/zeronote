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
 * ⇒ 所以本类**带自检**：第一次遇到「全白 + DOM 正常」时，先给页面铺一层
 * 整屏红色覆盖层再 draw 一次 —— 画不出红色（说明 draw 路径本身无效）就
 * **停用检测**，绝不在正常页面上误判 reload。
 *
 * 连续 `STALL_SAMPLES` 次（60 秒）成立 ⇒ `webView.reload()` **一次**（本进程不重复救）。
 * reload 前未落盘内容由已有的草稿钩子保护（`beforeunload` / `pagehide`，rev173.65）。
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
  /** 本进程是否已经 reload 过一次（一次启动只救一次） */
  private var rescued = false
  /** 连续「全白 + DOM 正常」的采样次数 */
  private var whiteStreak = 0
  /** draw 是否被验证为「真的能画出页面」：null=未验，true=可用，false=本设备不可用（停用） */
  private var drawVerified: Boolean? = null

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
      if (drawVerified == false) return
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

  /** 软件绘制到 1/4 缩放位图；硬件加速下 Chromium 可能画不出内容（由 `verifyDraw` 判定） */
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
      // 第一次「全白 + DOM 正常」先自检 draw 是否真的画得出内容 ——
      // 画不出就不能信这个读数，否则正常页面会被误判成白屏
      if (drawVerified == null) {
        verifyDraw()
        return@evaluateJavascript
      }
      if (drawVerified == false) return@evaluateJavascript
      whiteStreak++
      Log.i(TAG, "全白 + DOM 正常 · streak=$whiteStreak/$STALL_SAMPLES")
      if (whiteStreak >= STALL_SAMPLES) rescue()
    }
  }

  /**
   * draw 自检：给页面铺一层整屏红色覆盖层，再 draw 一次。
   * 画得出红色 ⇒ draw 路径可信；画不出 ⇒ 本设备这条路无效，停用检测（防止正常页面被误判）。
   */
  private fun verifyDraw() {
    Log.i(TAG, "draw 自检开始（铺红色覆盖层，看 draw 能否画出来）")
    webView.evaluateJavascript(VERIFY_ON_JS) { _ ->
      if (!running) return@evaluateJavascript
      handler.postDelayed({
        if (!running) return@postDelayed
        val bmp = drawScaled()
        val sawRed = bmp != null && hasRed(bmp)
        bmp?.recycle()
        webView.evaluateJavascript(VERIFY_OFF_JS, null)
        drawVerified = sawRed
        if (sawRed) {
          Log.i(TAG, "draw 自检通过 —— 采样可信，继续检测")
        } else {
          Log.w(TAG, "draw 自检失败 —— 本设备 webView.draw() 画不出内容，停用检测（防误判）")
          stop()
        }
      }, 400)
    }
  }

  private fun hasRed(bmp: Bitmap): Boolean {
    var x = 0
    while (x < bmp.width) {
      var y = 0
      while (y < bmp.height) {
        val c = bmp.getPixel(x, y)
        val r = (c shr 16) and 0xFF
        val g = (c shr 8) and 0xFF
        val b = c and 0xFF
        if (r >= 200 && g <= 80 && b <= 80) return true
        y += 4
      }
      x += 4
    }
    return false
  }

  /**
   * 自救动作：**软复位**（`onPause` → 800ms → `onResume`），不是 `reload()`。
   *
   * 依据（用户真机实测 2026-11-04）：白屏后「切后台 10 秒再回来」画面自动恢复正常 ——
   * 说明这条渲染停摆**可以被 WebView 的 pause/resume 生命周期打断**，不需要重新加载页面
   * （reload 实测无效：00:56:44 reload 后仍全白，且会丢未保存内容）。
   *
   * 本进程只做一次；正常页面上执行最多是极短的一次不可见停顿，代价可接受。
   */
  private fun rescue() {
    if (rescued) return
    rescued = true
    whiteStreak = 0
    Log.w(TAG, "渲染停摆成立 —— 软复位一次（pause → 800ms → resume，本进程只做一次）")
    try {
      webView.onPause()
    } catch (t: Throwable) {
      Log.w(TAG, "onPause 抛错: ${t.message}")
    }
    handler.postDelayed({
      try {
        webView.onResume()
        Log.i(TAG, "软复位完成")
      } catch (t: Throwable) {
        Log.w(TAG, "onResume 抛错: ${t.message}")
      }
    }, RESUME_DELAY_MS)
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

    /** 软复位里 pause 后等多久再 resume（模拟「切后台再回来」） */
    const val RESUME_DELAY_MS = 800L

    /**
     * DOM 是否「正常」：`.zn-app` 在、有子元素、body 有内容。
     * 返回字符串 `"true"` / `"false"`（`evaluateJavascript` 的原样返回）。
     */
    const val DOM_PROBE_JS =
      """(function(){var a=document.querySelector('.zn-app');var b=document.body;""" +
        """return !!(a&&a.children&&a.children.length>0&&b&&b.children&&b.children.length>0);})()"""

    /** 自检：铺整屏红色覆盖层（pointer-events:none，不挡交互） */
    const val VERIFY_ON_JS =
      """(function(){var d=document.getElementById('zn-draw-probe');if(!d){d=document.createElement('div');""" +
        """d.id='zn-draw-probe';document.body.appendChild(d);}""" +
        """d.style.cssText='position:fixed;left:0;top:0;width:100%;height:100%;background:#ff0000;""" +
        """z-index:2147483647;pointer-events:none';return true;})()"""

    /** 自检结束：移除覆盖层 */
    const val VERIFY_OFF_JS =
      """(function(){var d=document.getElementById('zn-draw-probe');if(d){d.remove();}return true;})()"""
  }
}
