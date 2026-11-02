//! ZeroNote 崩溃日志插件 —— 把「上次为什么死」交还给用户。
//!
//! 背景（2026-11-02 · 用户原话「每次崩溃应该把崩溃日志复制到剪贴板上面，现在的版本都没有崩溃日志」）：
//! 原生崩溃（SIGABRT / SIGSEGV）发生在**进程已经死掉之后**，JS 侧一行代码都执行不了，
//! 所以「崩溃当下复制日志」在技术上做不到。唯一正规的获取通道是 Android 11（API 30）起的
//! `ActivityManager.getHistoricalProcessExitReasons()` —— 系统替我们保留了每次退出的
//! `ApplicationExitInfo`，原生崩溃还附带 **tombstone 全文**（`getTraceInputStream()`），
//! 不需要 root，也不需要 debuggable。
//!
//! 于是本插件只做一件最小的事：**下次启动时把上次崩溃的 trace 读出来**，
//! 由前端负责复制到剪贴板 / 弹窗展示 / 让用户发出去。
//!
//! 桌面端：没有这条通道，命令返回 `found: false`（不是错误），前端无需分支。

use tauri::{plugin::TauriPlugin, Runtime};

/// Kotlin 侧的包名（与 `android/src/main/java/CrashLogPlugin.kt` 的 `package` 一致）
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.crashlog";

#[cfg(mobile)]
use tauri::plugin::PluginHandle;

/// 插件状态：移动端持有 Kotlin 插件句柄；桌面端只占位。
pub struct CrashLog<R: Runtime> {
  #[cfg(mobile)]
  handle: PluginHandle<R>,
  #[cfg(not(mobile))]
  _marker: std::marker::PhantomData<fn() -> R>,
}

/// 读取最近一次异常退出（原生崩溃 / Java 崩溃 / 启动失败）的 trace。
///
/// 返回结构（`found = false` 时其余字段为空）：
/// ```json
/// { "found": true, "timestamp": 1762000000000, "reason": 5, "description": "crash",
///   "trace": "...", "appVersion": "0.9.14", "androidVersion": "16",
///   "device": "NX741J", "webviewVersion": "140.0.7339.207" }
/// ```
/// `reason`：4 = Java 崩溃，5 = 原生崩溃，13 = 启动失败（`ApplicationExitInfo.REASON_*`）。
#[tauri::command]
async fn read_last_crash<R: Runtime>(app: tauri::AppHandle<R>) -> Result<serde_json::Value, String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    app
      .state::<CrashLog<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("readLastCrash", serde_json::json!({}))
      .map_err(|e| e.to_string())
  }
  #[cfg(not(mobile))]
  {
    // 桌面不接这条通道 —— 返回"没有崩溃"而不是报错，调用方一行不用改
    let _ = app;
    Ok(serde_json::json!({ "found": false }))
  }
}

/// 初始化插件。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  tauri::plugin::Builder::<R>::new("crashlog")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "CrashLogPlugin")?;

      #[cfg(mobile)]
      {
        use tauri::Manager;
        app.manage(CrashLog::<R> { handle });
      }

      #[cfg(not(mobile))]
      {
        let _ = api;
        use tauri::Manager;
        app.manage(CrashLog::<R> {
          _marker: std::marker::PhantomData,
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![read_last_crash])
    .build()
}
