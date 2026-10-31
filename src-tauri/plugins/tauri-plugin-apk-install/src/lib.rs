//! ZeroNote APK 安装插件 —— 把下载好的 APK 交给 **Android 系统安装器**。
//!
//! ## 为什么需要原生
//!
//! Tauri 的官方 updater **不支持 Android**（README 的支持表只有 Linux / Windows / macOS），
//! 应用内更新只能自己走：Rust 下载 APK（`crate::updates::download_android_update`）→
//! 本插件起 `ACTION_VIEW` + `application/vnd.android.package-archive` → 系统安装器接管。
//!
//! 文件通过已有的 `FileProvider`（`gen/android/app/src/main/AndroidManifest.xml` 里
//! authorities `${applicationId}.fileprovider`，`res/xml/file_paths.xml` 已放开 `cache-path .`）
//! 暴露给安装器 —— **不能让安装器读 `file://` 路径**（Android 7 起 `FileUriExposedException`）。
//!
//! ## 为什么还要 `can_install_apk` / `open_install_settings`
//!
//! Android 8.0 起「安装未知应用」是按应用授权的（`REQUEST_INSTALL_PACKAGES` +
//! 用户在系统设置里单独允许）。没授权时起 Intent 会**静默什么都不发生** ——
//! 用户只会觉得「点了没反应」。所以先查 `canRequestPackageInstalls()`，
//! 没授权就引导去设置页。
//!
//! ## 桌面端
//!
//! 明确返回 `desktop-no-apk-install`（不静默成功）：桌面的更新走
//! `crate::updates::install_desktop_update`（官方 updater + 签名校验）。

use serde::Serialize;
use tauri::{plugin::TauriPlugin, Runtime};

/// Kotlin 侧的包名（与 `android/src/main/java/ApkInstallPlugin.kt` 的 `package` 一致）
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.apkinstall";

#[cfg(mobile)]
use tauri::plugin::PluginHandle;

/// 插件状态：移动端持有到 Kotlin 插件实例的句柄；桌面端只占位。
pub struct ApkInstall<R: Runtime> {
  #[cfg(mobile)]
  handle: PluginHandle<R>,
  #[cfg(not(mobile))]
  _marker: std::marker::PhantomData<fn() -> R>,
}

/// 结果：`ok` + 是否已经真的把安装器调起来（`started`）
#[derive(Serialize)]
pub struct InstallResult {
  ok: bool,
  started: bool,
}

/// 起系统安装器安装指定路径的 APK。
///
/// `path` 必须是本应用可读的**绝对路径**（`download_android_update` 返回的那个缓存路径）。
#[tauri::command]
async fn install_apk<R: Runtime>(
  app: tauri::AppHandle<R>,
  path: String,
) -> Result<InstallResult, String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    let v = app
      .state::<ApkInstall<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("installApk", serde_json::json!({ "path": path }))
      .map_err(|e| e.to_string())?;
    Ok(InstallResult {
      ok: v.get("ok").and_then(|x| x.as_bool()).unwrap_or(true),
      started: v.get("started").and_then(|x| x.as_bool()).unwrap_or(true),
    })
  }
  #[cfg(not(mobile))]
  {
    let _ = (app, path);
    Err("desktop-no-apk-install".to_string())
  }
}

/// 当前应用有没有「安装未知应用」的授权。
///
/// Android 8.0 以下恒为 `true`（那时是全局开关）。查询失败一律当 `false` ——
/// 宁可多引导一次去设置，也不要让用户点了「安装」却什么也没发生。
#[tauri::command]
async fn can_install_apk<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    let v = app
      .state::<ApkInstall<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("canInstall", serde_json::json!({}))
      .map_err(|e| e.to_string())?;
    Ok(v.get("allowed").and_then(|x| x.as_bool()).unwrap_or(false))
  }
  #[cfg(not(mobile))]
  {
    let _ = app;
    Ok(false)
  }
}

/// 打开系统的「安装未知应用」授权页（针对本应用）。
#[tauri::command]
async fn open_install_settings<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    app
      .state::<ApkInstall<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("openInstallSettings", serde_json::json!({}))
      .map_err(|e| e.to_string())?;
    Ok(())
  }
  #[cfg(not(mobile))]
  {
    let _ = app;
    Err("desktop-no-apk-install".to_string())
  }
}

/// 初始化插件。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  tauri::plugin::Builder::<R>::new("apk-install")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "ApkInstallPlugin")?;

      #[cfg(mobile)]
      {
        use tauri::Manager;
        app.manage(ApkInstall::<R> { handle });
      }

      #[cfg(not(mobile))]
      {
        let _ = api;
        use tauri::Manager;
        app.manage(ApkInstall::<R> {
          _marker: std::marker::PhantomData,
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      install_apk,
      can_install_apk,
      open_install_settings
    ])
    .build()
}
