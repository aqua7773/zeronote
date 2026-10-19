//! ZeroNote 通知捕获插件 —— Android `NotificationListenerService` 的原生桥。
//!
//! ## 为什么必须走原生
//! Web 层拿不到系统通知：要读通知必须由 `NotificationListenerService` 接收，
//! 而它只能由 Android 系统绑定，并且需要用户在「通知使用权」里手动授权。
//!
//! ## 链路
//! ```text
//! [Android 系统]
//!   → Kotlin NotificationCaptureService（白名单包名 + 字段合并 + MD5 去重 + 环形缓存）
//!   ← JS invoke('plugin:notification-capture|drain') 取走缓存原文（JSON 数组文本）
//!   → 记账插件解析 / 分类 / 落库（规则放在 JS 侧，可热更新，不用重装 APK）
//! ```
//!
//! ## 三个设计决定
//! 1. **原生只捕获、不解析** —— 金额/商户/分类规则会随微信/支付宝文案变化，
//!    放 JS 插件里改文件即生效；原生只保证「通知不丢」。
//! 2. **缓存落 SharedPreferences** —— App 进程被杀后系统仍会重建 Service，
//!    通知先缓存，等下次 `drain()` 回放。
//! 3. **桌面端全部 no-op / 空结果** —— 前端可以无脑调用，不必分支判断平台。

use tauri::{plugin::TauriPlugin, Runtime};

/// Kotlin 侧的包名（与 `android/src/main/java/NotificationCapturePlugin.kt` 的 `package` 一致）
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.notificationcapture";

#[cfg(mobile)]
use tauri::plugin::PluginHandle;

/// 插件状态：移动端持有到 Kotlin 插件实例的句柄；桌面端只占位。
pub struct NotificationCapture<R: Runtime> {
  #[cfg(mobile)]
  handle: PluginHandle<R>,
  /// 桌面端用 `fn() -> R` 保持 `Send + Sync`，同时消除未使用泛型参数的报错
  #[cfg(not(mobile))]
  _marker: std::marker::PhantomData<fn() -> R>,
}

/// 通知监听是否已被用户授权（「通知使用权」开关）。
#[tauri::command]
async fn is_enabled<R: Runtime>(app: tauri::AppHandle<R>) -> Result<bool, String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    let v = app
      .state::<NotificationCapture<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("isEnabled", serde_json::json!({}))
      .map_err(|e| e.to_string())?;
    Ok(v.get("enabled").and_then(|x| x.as_bool()).unwrap_or(false))
  }
  #[cfg(not(mobile))]
  {
    let _ = app;
    Ok(false)
  }
}

/// 打开系统的「通知使用权」设置页（用户在那里授予本应用）。
#[tauri::command]
async fn open_settings<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    app
      .state::<NotificationCapture<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("openSettings", serde_json::json!({}))
      .map(|_| ())
      .map_err(|e| e.to_string())
  }
  #[cfg(not(mobile))]
  {
    let _ = app;
    Ok(())
  }
}

/// 取走缓存的未处理通知（JSON 数组文本），取完即清空。
#[tauri::command]
async fn drain<R: Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    let v = app
      .state::<NotificationCapture<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("drain", serde_json::json!({}))
      .map_err(|e| e.to_string())?;
    Ok(
      v
        .get("json")
        .and_then(|x| x.as_str())
        .unwrap_or("[]")
        .to_string(),
    )
  }
  #[cfg(not(mobile))]
  {
    let _ = app;
    Ok("[]".to_string())
  }
}

/// 设置要监听哪些包名的通知（逗号分隔）。空串表示回到默认白名单。
#[tauri::command]
async fn set_whitelist<R: Runtime>(
  app: tauri::AppHandle<R>,
  packages: String,
) -> Result<(), String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    app
      .state::<NotificationCapture<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>(
        "setWhitelist",
        serde_json::json!({ "packages": packages }),
      )
      .map(|_| ())
      .map_err(|e| e.to_string())
  }
  #[cfg(not(mobile))]
  {
    let _ = (app, packages);
    Ok(())
  }
}

/// 读当前白名单（逗号分隔；未设置过时返回默认值）。
#[tauri::command]
async fn get_whitelist<R: Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    let v = app
      .state::<NotificationCapture<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("getWhitelist", serde_json::json!({}))
      .map_err(|e| e.to_string())?;
    Ok(
      v
        .get("packages")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string(),
    )
  }
  #[cfg(not(mobile))]
  {
    let _ = app;
    Ok("".to_string())
  }
}

/// 初始化插件。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  tauri::plugin::Builder::<R>::new("notification-capture")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "NotificationCapturePlugin")?;

      #[cfg(mobile)]
      {
        use tauri::Manager;
        app.manage(NotificationCapture::<R> { handle });
      }

      #[cfg(not(mobile))]
      {
        let _ = api;
        use tauri::Manager;
        app.manage(NotificationCapture::<R> {
          _marker: std::marker::PhantomData,
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      is_enabled,
      open_settings,
      drain,
      set_whitelist,
      get_whitelist
    ])
    .build()
}
