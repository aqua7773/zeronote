//! ZeroNote 分享插件 —— 把一段**纯文本**或**一个文件**交给 Android 的系统分享面板。
//!
//! ## 为什么需要原生
//!
//! Tauri 没有内置「系统分享」，Android 的分享面板（`ACTION_SEND`）只能在 Kotlin 里起。
//! J#13（2026-10-30 用户拍板）把系统分享归 `import-export` 插件：插件把笔记转成纯文本，
//! 再 `invoke('plugin:share|share_text', { title, text })` 交给这里。
//!
//! **rev173.310（真人测试4 #2）加 `share_file`**：用户要的是"直接分享带图片的 markdown 文件"，
//! 纯文本会把图片丢掉。文件通道走 FileProvider（manifest 已注册 `${applicationId}.fileprovider`）——
//! 见 `android/src/main/java/SharePlugin.kt` 的 `shareFile`。
//!
//! ```text
//! JS invoke('plugin:share|share_text', { title, text })
//!   → 本 crate 命令 → JNI → Kotlin SharePlugin.shareText
//!   → Intent.ACTION_SEND / text/plain + createChooser
//!
//! JS invoke('plugin:share|share_file', { title, path, mime })
//!   → 本 crate 命令 → JNI → Kotlin SharePlugin.shareFile
//!   → FileProvider content:// + ACTION_SEND / EXTRA_STREAM + createChooser
//! ```
//!
//! ## 桌面端
//!
//! **明确返回错误**（`desktop-no-share`），而不是静默成功：桌面没有系统分享面板，
//! 调用方（import-export）据此改走「复制到剪贴板」。静默成功会让用户以为发出去了。

use serde::Serialize;
use tauri::{plugin::TauriPlugin, Runtime};

/// Kotlin 侧的包名（与 `android/src/main/java/SharePlugin.kt` 的 `package` 一致）
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.share";

#[cfg(mobile)]
use tauri::plugin::PluginHandle;

/// 插件状态：移动端持有到 Kotlin 插件实例的句柄；桌面端只占位。
pub struct Share<R: Runtime> {
  #[cfg(mobile)]
  handle: PluginHandle<R>,
  /// 桌面端用 `fn() -> R` 保持 `Send + Sync`，同时消除未使用泛型参数的报错
  #[cfg(not(mobile))]
  _marker: std::marker::PhantomData<fn() -> R>,
}

/// 分享结果（Kotlin 侧的回执；目前只有 `ok`）
#[derive(Serialize)]
pub struct ShareResult {
  ok: bool,
}

/// 调起系统分享面板（`ACTION_SEND` / `text/plain`）。
///
/// - `title` 同时作为分享面板标题与 `EXTRA_SUBJECT`（邮件类应用会用它当主题）
/// - `text` 是**纯文本**（调用方负责把 Markdown 压成纯文本）
///
/// 返回 `true` = 面板已调起（用户选哪个应用由系统面板决定，这里不追踪结果）。
#[tauri::command]
async fn share_text<R: Runtime>(
  app: tauri::AppHandle<R>,
  title: String,
  text: String,
) -> Result<ShareResult, String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    let v = app
      .state::<Share<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>(
        "shareText",
        serde_json::json!({ "title": title, "text": text }),
      )
      .map_err(|e| e.to_string())?;
    Ok(ShareResult {
      ok: v.get("ok").and_then(|x| x.as_bool()).unwrap_or(true),
    })
  }
  #[cfg(not(mobile))]
  {
    let _ = (app, title, text);
    Err("desktop-no-share".to_string())
  }
}

/// 调起系统分享面板（一个文件，`ACTION_SEND` / `EXTRA_STREAM`）。
///
/// - `path`：**绝对路径**（调用方负责把内容落盘）
/// - `mime`：空串 ⇒ 由 Kotlin 侧按扩展名推断
///
/// 返回 `true` = 面板已调起（用户选哪个应用由系统面板决定，这里不追踪结果）。
#[tauri::command]
async fn share_file<R: Runtime>(
  app: tauri::AppHandle<R>,
  title: String,
  path: String,
  mime: String,
) -> Result<ShareResult, String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    let v = app
      .state::<Share<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>(
        "shareFile",
        serde_json::json!({ "title": title, "path": path, "mime": mime }),
      )
      .map_err(|e| e.to_string())?;
    Ok(ShareResult {
      ok: v.get("ok").and_then(|x| x.as_bool()).unwrap_or(true),
    })
  }
  #[cfg(not(mobile))]
  {
    let _ = (app, title, path, mime);
    Err("desktop-no-share".to_string())
  }
}

/// 初始化插件。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  tauri::plugin::Builder::<R>::new("share")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "SharePlugin")?;

      #[cfg(mobile)]
      {
        use tauri::Manager;
        app.manage(Share::<R> { handle });
      }

      #[cfg(not(mobile))]
      {
        let _ = api;
        use tauri::Manager;
        app.manage(Share::<R> {
          _marker: std::marker::PhantomData,
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![share_text, share_file])
    .build()
}
