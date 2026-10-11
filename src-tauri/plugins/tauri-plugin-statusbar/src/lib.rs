//! ZeroNote 状态栏插件 —— Android 状态栏的按需显隐。
//!
//! 需求（用户 2026-10-12）：**侧栏（抽屉）打开时隐藏状态栏，收起（首页）时显示**；
//! **导航栏不受影响**（与 `MainActivity` 只 `hide(statusBars())` 的语义保持一致）。
//!
//! 为什么必须走原生：状态栏是 Android 的窗口装饰，由 `WindowInsetsControllerCompat`
//! 控制，Web 层碰不到。所以链路是：
//!   JS `invoke('plugin:statusbar|set_status_bar_visible')`
//!     → 本 crate 的命令 → JNI → Kotlin `StatusBarPlugin.setVisible`
//!     → `WindowInsetsControllerCompat.show/hide(Type.statusBars())`
//!
//! 桌面端：本命令是 **no-op 并返回 Ok**，所以前端可以无脑调用、不必分支判断。

use tauri::{plugin::TauriPlugin, Runtime};

/// Kotlin 侧的包名（与 `android/src/main/java/StatusBarPlugin.kt` 的 `package` 一致）
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.statusbar";

#[cfg(mobile)]
use tauri::plugin::PluginHandle;

/// 插件状态：移动端持有到 Kotlin 插件实例的句柄；桌面端只占位。
pub struct StatusBar<R: Runtime> {
  #[cfg(mobile)]
  handle: PluginHandle<R>,
  /// 桌面端用 `fn() -> R` 保持 `Send + Sync`，同时消除未使用泛型参数的报错
  #[cfg(not(mobile))]
  _marker: std::marker::PhantomData<fn() -> R>,
}

/// 设置状态栏是否可见。`visible = true` 显示，`false` 隐藏。
#[tauri::command]
async fn set_status_bar_visible<R: Runtime>(
  app: tauri::AppHandle<R>,
  visible: bool,
) -> Result<(), String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    app
      .state::<StatusBar<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>(
        "setVisible",
        serde_json::json!({ "visible": visible }),
      )
      .map(|_| ())
      .map_err(|e| e.to_string())
  }
  #[cfg(not(mobile))]
  {
    // 桌面没有系统栏可控制 —— 明确返回成功，让调用方无需区分平台
    let _ = (app, visible);
    Ok(())
  }
}

/// 初始化插件。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  tauri::plugin::Builder::<R>::new("statusbar")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "StatusBarPlugin")?;

      #[cfg(mobile)]
      {
        use tauri::Manager;
        app.manage(StatusBar::<R> { handle });
      }

      #[cfg(not(mobile))]
      {
        let _ = api;
        use tauri::Manager;
        app.manage(StatusBar::<R> {
          _marker: std::marker::PhantomData,
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![set_status_bar_visible])
    .build()
}
