//! ZeroNote Android 权限插件 —— 请求「所有文件访问」（`MANAGE_EXTERNAL_STORAGE`）。
//!
//! **为什么必须走原生**：能不能读写公共存储由 Android 的 appop 决定，Web 层碰不到。
//! 链路：
//!   JS `invoke('plugin:androidperm|request_all_files_access')`
//!     → 本 crate 的命令 → JNI → Kotlin `AndroidPermPlugin.requestAllFilesAccess`
//!     → `Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)` 起系统授权页
//!
//! **为什么需要它**（rev64 的真实教训）：库放在公共存储时，没有这个权限的表现只是
//! `Permission denied (os error 13)` —— 用户既不知道是哪个权限、也不知道去哪开
//! （它是 Android 的特殊权限，**系统不会弹窗申请**）。本命令就是那个"去哪开"的入口。
//!
//! 桌面端：**no-op 并返回 Ok**，前端可以无脑调用、不必分支判断。

use tauri::{plugin::TauriPlugin, Runtime};

/// Kotlin 侧的包名（与 `android/src/main/java/AndroidPermPlugin.kt` 的 `package` 一致）
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.androidperm";

#[cfg(mobile)]
use tauri::plugin::PluginHandle;

/// 插件状态：移动端持有到 Kotlin 插件实例的句柄；桌面端只占位。
pub struct AndroidPerm<R: Runtime> {
  #[cfg(mobile)]
  handle: PluginHandle<R>,
  /// 桌面端用 `fn() -> R` 保持 `Send + Sync`，同时消除未使用泛型参数的报错
  #[cfg(not(mobile))]
  _marker: std::marker::PhantomData<fn() -> R>,
}

/// 跳到「所有文件访问」的系统授权页。Android 11 以下没有这个权限概念 ⇒ 直接返回 Ok。
#[tauri::command]
async fn request_all_files_access<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    app
      .state::<AndroidPerm<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("requestAllFilesAccess", serde_json::json!({}))
      .map(|_| ())
      .map_err(|e| e.to_string())
  }
  #[cfg(not(mobile))]
  {
    // 桌面没有这个权限 —— 明确返回成功，让调用方无需区分平台
    let _ = app;
    Ok(())
  }
}

/// 初始化插件。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  tauri::plugin::Builder::<R>::new("androidperm")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "AndroidPermPlugin")?;

      #[cfg(mobile)]
      {
        use tauri::Manager;
        app.manage(AndroidPerm::<R> { handle });
      }

      #[cfg(not(mobile))]
      {
        let _ = api;
        use tauri::Manager;
        app.manage(AndroidPerm::<R> {
          _marker: std::marker::PhantomData,
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![request_all_files_access])
    .build()
}
