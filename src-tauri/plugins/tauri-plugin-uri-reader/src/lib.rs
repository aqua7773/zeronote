//! ZeroNote URI 读取插件 —— 把 Android SAF 的 `content://` URI 变成**可读的本地文件路径**。
//!
//! ## 为什么必须走原生
//! 系统「打开方式」递来的文件是 `content://…`（SAF / DocumentsProvider），
//! **`std::fs` 读不了**（它不是文件路径），只有 Android 的 `ContentResolver` 能打开它。
//! 链路：
//! ```text
//! JS invoke('plugin:uri-reader|read_content_uri', { uri })
//!   → 本 crate 的命令 → JNI → Kotlin UriReaderPlugin.readContentUri
//!   → contentResolver.openInputStream(uri) 复制到 cacheDir/zn-open/<名>
//!   → 返回 { path, name }（**绝对路径**）
//!   → 前端/Rust 用 asset 协议读那个临时文件
//! ```
//!
//! ## 两条设计决定
//! 1. **复制**而不是跨 JNI 传 fd：fd 的生命周期跨语言很容易出错，而文档通常只有几 MB
//!    —— 复制一份最简单也最稳。
//! 2. 这也是**官方 fs 插件至今没有的能力**：`plugins-workspace#1775` 里作者只能自己在
//!    `FsPlugin.kt` 里加 Kotlin 才解决（维护者只回"要不要我给你写个临时插件"）。
//!
//! 桌面端：明确返回错误（桌面没有 SAF）—— 但桌面本来也不会走这条路。

use serde::Serialize;
use tauri::{plugin::TauriPlugin, Runtime};

/// Kotlin 侧的包名（与 `android/src/main/java/UriReaderPlugin.kt` 的 `package` 一致）
#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.urireader";

#[cfg(mobile)]
use tauri::plugin::PluginHandle;

/// 插件状态：移动端持有到 Kotlin 插件实例的句柄；桌面端只占位。
pub struct UriReader<R: Runtime> {
  #[cfg(mobile)]
  handle: PluginHandle<R>,
  /// 桌面端用 `fn() -> R` 保持 `Send + Sync`，同时消除未使用泛型参数的报错
  #[cfg(not(mobile))]
  _marker: std::marker::PhantomData<fn() -> R>,
}

/// 读一个 `content://` URI 的结果 —— `path` 是**绝对路径**（应用缓存里的一份副本）
#[derive(Serialize)]
pub struct ReadResult {
  path: String,
  name: String,
}

/// 把 `content://` 读成缓存里的临时文件，返回 `{ path, name }`。
#[tauri::command]
async fn read_content_uri<R: Runtime>(
  app: tauri::AppHandle<R>,
  uri: String,
) -> Result<ReadResult, String> {
  #[cfg(mobile)]
  {
    use tauri::Manager;
    let v = app
      .state::<UriReader<R>>()
      .handle
      .run_mobile_plugin::<serde_json::Value>("readContentUri", serde_json::json!({ "uri": uri }))
      .map_err(|e| e.to_string())?;
    let path = v
      .get("path")
      .and_then(|x| x.as_str())
      .unwrap_or_default()
      .to_string();
    let name = v
      .get("name")
      .and_then(|x| x.as_str())
      .unwrap_or_default()
      .to_string();
    if path.is_empty() {
      return Err("原生侧没有返回可用路径".to_string());
    }
    Ok(ReadResult { path, name })
  }
  #[cfg(not(mobile))]
  {
    let _ = (app, uri);
    Err("content:// 是 Android 专有协议，桌面端没有 SAF".to_string())
  }
}

/// 初始化插件。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
  tauri::plugin::Builder::<R>::new("uri-reader")
    .setup(|app, api| {
      #[cfg(target_os = "android")]
      let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "UriReaderPlugin")?;

      #[cfg(mobile)]
      {
        use tauri::Manager;
        app.manage(UriReader::<R> { handle });
      }

      #[cfg(not(mobile))]
      {
        let _ = api;
        use tauri::Manager;
        app.manage(UriReader::<R> {
          _marker: std::marker::PhantomData,
        });
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![read_content_uri])
    .build()
}
