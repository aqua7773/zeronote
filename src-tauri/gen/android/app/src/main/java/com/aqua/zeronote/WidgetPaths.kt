package com.aqua.zeronote

import android.content.Context
import org.json.JSONObject
import java.io.File

/**
 * 桌面组件的数据落点（rev173.242 · 需求 §15）
 *
 * ## 为什么是「读一个 JSON」而不是「问内核」
 *
 * 桌面组件活在 Launcher 的渲染流程里 —— 没有 WebView、没有 IPC、没有内存态。
 * 唯一稳定的共享介质是磁盘。内核在笔记变化时把快照写到
 * `<app_data_dir>/.zn/widget-data.json`（Rust `widget_data_write`），
 * 组件只做只读渲染 + 把用户动作写回磁盘。
 *
 * ## 路径为什么两端都对得上
 *
 * Android 上 Tauri 的 `app_data_dir()` 就是 `context.dataDir`（`/data/user/0/<pkg>`），
 * 所以 `<dataDir>/.zn/` 与全局插件根 `<app_data_dir>/.zn/plugins/` 是同一个目录树
 * （见 `src-tauri/src/widgets.rs` 的模块注释）。
 */
object WidgetPaths {
  /** 私有目录名（与 Rust 的 `PRIVATE_DIR` 一致） */
  private const val PRIVATE_DIR = ".zn"

  /** 快照文件名（与 Rust 的 `WIDGET_DATA_FILE` 一致） */
  private const val SNAPSHOT = "widget-data.json"

  /**
   * 没拿到快照时的兜底库路径。
   *
   * 只在「用户从没打开过 app（因而没有快照）」时用到；正常路径一律以快照里的 `vault` 为准 ——
   * 用户可以在设置里换库，硬编码只会把笔记写到错的地方。
   */
  const val DEFAULT_VAULT = "/storage/emulated/0/Documents/ZeroNote"

  /** 私有目录 `<dataDir>/.zn` */
  fun privateDir(context: Context): File = File(context.dataDir, PRIVATE_DIR)

  /** 快照文件 `<dataDir>/.zn/widget-data.json` */
  fun snapshotFile(context: Context): File = File(privateDir(context), SNAPSHOT)

  /**
   * 当前库的绝对路径。
   *
   * 读快照里的 `vault`；快照不存在 / 坏 JSON / 字段缺失时退回 [DEFAULT_VAULT]。
   * **不抛异常** —— 组件的任何一条路径都不该因为一个坏文件把 Launcher 桌面弄崩。
   */
  fun vaultPath(context: Context): String {
    val file = snapshotFile(context)
    if (!file.exists()) return DEFAULT_VAULT
    return try {
      val json = JSONObject(file.readText(Charsets.UTF_8))
      val v = json.optString("vault", "").trim()
      if (v.isEmpty()) DEFAULT_VAULT else v
    } catch (_: Throwable) {
      DEFAULT_VAULT
    }
  }

  /** 当前库根目录 */
  fun vaultDir(context: Context): File = File(vaultPath(context))
}
