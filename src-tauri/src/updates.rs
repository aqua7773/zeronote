//! 应用本体更新（rev173.292）。
//!
//! 两条路，因为两端能力不同：
//!
//! * **桌面**：官方 `tauri-plugin-updater`。它做 minisign 签名校验（**不能关**），
//!   然后把安装包交给 NSIS / WiX 安装器，装完自动重启。
//! * **Android**：官方 updater **不支持移动端**（README 的支持表只有 Linux / Windows / macOS），
//!   所以自己下载 APK（Rust + reqwest）→ 交给 `tauri-plugin-apk-install` 的 Kotlin 侧
//!   起 `ACTION_VIEW` 让系统安装器接管。
//!
//! ## 清单（没有服务端，走仓库里的静态 JSON）
//!
//! * `update/latest.json` —— 桌面，Tauri 的 static JSON 格式（`platforms.windows-x86_64`）
//! * `update/android.json` —— Android，自定义格式（`apk.url` / `apk.sha256` / `apk.size`）
//!
//! 两个都由 `scripts/gen-update-manifest.mjs` 在发版时生成、跟着 commit 进仓库。
//!
//! ## 为什么要自己挑镜像
//!
//! 2026-10-27 真机实测：Android 上 `raw.githubusercontent.com` **6/6 失败**
//! （TLS 阶段被 RST），jsDelivr 与 ghproxy 通。而 `tauri-plugin-updater` 的多个 endpoint
//! **只在返回非 2xx 时才试下一个** —— 连接被 RST 属于网络错误，它会直接失败、不会往下试。
//! 所以镜像选择必须在**我们自己的代码里**做（按顺序 try，谁先 200 用谁），
//! 选中之后再把 updater 的 endpoint 指向那一个。
//!
//! 镜像顺序：raw 第一（桌面本机实测 200、且最实时），ghproxy 第二（手机可达、发布即时），
//! jsDelivr 两条殿后（手机可达，但 `@main` 有分钟级缓存，刚发版可能还读到旧清单）。

use serde::Serialize;
use tauri::ipc::Channel;

/// 一条镜像：id + 基址（清单与安装包都从这里拼）
struct Mirror {
  id: &'static str,
  base: &'static str,
}

const MIRRORS: &[Mirror] = &[
  Mirror {
    id: "raw",
    base: "https://raw.githubusercontent.com/aqua7773/zeronote/main/",
  },
  Mirror {
    id: "ghproxy",
    base: "https://ghproxy.net/https://raw.githubusercontent.com/aqua7773/zeronote/main/",
  },
  Mirror {
    id: "jsdelivr-gcore",
    base: "https://gcore.jsdelivr.net/gh/aqua7773/zeronote@main/",
  },
  Mirror {
    id: "jsdelivr-cf",
    base: "https://testingcf.jsdelivr.net/gh/aqua7773/zeronote@main/",
  },
];

/// 查清单的超时：清单只有几百字节，12 秒足够；给得太长会让「检查更新」转圈
const CHECK_TIMEOUT_MS: u64 = 12_000;
/// 清单大小上限：正常 < 4 KB。撞上说明下到的不是清单（HTML 错误页之类）
const MAX_MANIFEST_BYTES: usize = 256 * 1024;
/// APK 大小上限：arm64 release 约 60 MB；256 MB 是「明显不对」的界线。
/// 只有 Android 的自下载会用到（桌面走官方 updater，自己的上限在插件里）。
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
const MAX_APK_BYTES: u64 = 256 * 1024 * 1024;

/// 远端清单解析后的一条更新
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
  pub version: String,
  pub notes: Option<String>,
  pub pub_date: Option<String>,
  /// 安装包地址（清单原样；Android 下载时会再拼 ghproxy 变体逐个试）
  pub url: String,
  /// 仅桌面：安装包的 minisign 签名（就是 `.sig` 文件的内容）
  pub signature: Option<String>,
  /// 仅 Android：整包 sha256，下载后逐字节核对
  pub sha256: Option<String>,
  pub size: Option<u64>,
  pub mirrors: Vec<String>,
}

/// 「检查更新」的结果。
///
/// **失败也走 `Ok`**：网络不通 / 清单还没建，UI 需要区分「已是最新」与「查不到」，
/// 而不是弹一个红叉。真正的错误放在 `error` 里。
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
  pub current_version: String,
  pub has_update: bool,
  /// 清单里的版本（无论新旧 —— UI 用它显示「已是最新 x.y.z」）
  pub remote_version: Option<String>,
  pub latest: Option<AppUpdate>,
  /// 命中的镜像 id（桌面安装时要传回来，保证与检查走同一镜像）
  pub mirror: String,
  pub error: Option<String>,
}

/// 下载进度事件（桌面 updater 与 Android 自下载共用同一条 channel 协议）
#[derive(Serialize, Clone)]
#[serde(tag = "event", content = "data", rename_all = "camelCase")]
pub enum Progress {
  Progress {
    /// 本次新增的字节数（前端自己累加 —— 桌面 updater 只给增量）
    chunk: u64,
    downloaded: u64,
    total: Option<u64>,
  },
  Finished,
}

/// 当前平台读哪份清单
fn manifest_file() -> &'static str {
  if cfg!(target_os = "android") {
    "android.json"
  } else {
    "latest.json"
  }
}

/// 桌面端在 static JSON 的 `platforms` 里查哪个键
#[cfg(desktop)]
fn platform_key() -> String {
  // 与 tauri-plugin-updater 的默认查询顺序一致：`{os}-{arch}-{bundle_type}` 再 `{os}-{arch}`。
  // 这里只可能命中后者（我们只发 NSIS/MSI，不分 bundle type 键）。
  tauri_plugin_updater::target().unwrap_or_else(|| "windows-x86_64".to_string())
}

/// 拿一条镜像（按 id）
fn mirror(id: &str) -> Option<&'static Mirror> {
  MIRRORS.iter().find(|m| m.id == id)
}

/// 三段数字比较：`is_newer("1.10.0", "1.9.0") == true`。
///
/// 与前端 `src/kernel/version.ts` 的 `compareVersions` 同一口径（非数字段当 0，
/// 先剥掉 `v` 前缀）—— 两处都叫「版本比较」，不一致会让「列表说可更新、检查说已最新」。
fn is_newer(current: &str, remote: &str) -> bool {
  fn parts(v: &str) -> [i64; 3] {
    let mut out = [0i64; 3];
    let s = v.trim_start_matches(|c: char| !c.is_ascii_digit() && c != '.' && c != '-');
    for (i, seg) in s.split('.').take(3).enumerate() {
      let digits: String = seg.chars().take_while(|c| c.is_ascii_digit()).collect();
      out[i] = digits.parse::<i64>().unwrap_or(0);
    }
    out
  }
  let a = parts(current);
  let b = parts(remote);
  b > a
}

/// 拉一份 JSON（带大小上限）
async fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
  let client = crate::net::http_client(CHECK_TIMEOUT_MS)?;
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|e| format!("拉取更新清单失败：{url} —— {e}"))?;
  let status = resp.status();
  if !status.is_success() {
    return Err(format!("拉取更新清单失败：HTTP {status}（{url}）"));
  }
  let bytes = resp
    .bytes()
    .await
    .map_err(|e| format!("读取更新清单失败：{url} —— {e}"))?;
  if bytes.len() > MAX_MANIFEST_BYTES {
    return Err(format!("更新清单过大（{} 字节）：{url}", bytes.len()));
  }
  serde_json::from_slice(&bytes).map_err(|e| format!("更新清单不是合法 JSON：{url} —— {e}"))
}

/// 从清单 JSON 里取出本平台的安装包信息。字段缺失 → `None`（= 这个版本对本平台没发）
fn parse_manifest(v: &serde_json::Value) -> Option<AppUpdate> {
  let version = v.get("version")?.as_str()?.to_string();
  let notes = v.get("notes").and_then(|x| x.as_str()).map(str::to_string);
  let pub_date = v
    .get("pub_date")
    .and_then(|x| x.as_str())
    .map(str::to_string);

  let mut mirrors: Vec<String> = Vec::new();

  #[cfg(desktop)]
  {
    let key = platform_key();
    let p = v.get("platforms")?.get(&key)?;
    let url = p.get("url")?.as_str()?.to_string();
    let signature = p
      .get("signature")
      .and_then(|x| x.as_str())
      .map(str::to_string);
    if url.starts_with("https://github.com/") {
      mirrors.push(format!("https://ghproxy.net/{url}"));
    }
    return Some(AppUpdate {
      version,
      notes,
      pub_date,
      url,
      signature,
      sha256: None,
      size: None,
      mirrors,
    });
  }

  #[cfg(not(desktop))]
  {
    let apk = v.get("apk")?;
    let url = apk.get("url")?.as_str()?.to_string();
    let sha256 = apk
      .get("sha256")
      .and_then(|x| x.as_str())
      .map(str::to_string);
    let size = apk.get("size").and_then(|x| x.as_u64());
    if url.starts_with("https://github.com/") {
      mirrors.push(format!("https://ghproxy.net/{url}"));
    }
    Some(AppUpdate {
      version,
      notes,
      pub_date,
      url,
      signature: None,
      sha256,
      size,
      mirrors,
    })
  }
}

/// 检查有没有新版本。**只在所有镜像都失败时才把 error 填上**。
#[tauri::command]
pub async fn check_app_update() -> Result<UpdateCheck, String> {
  let current = env!("CARGO_PKG_VERSION").to_string();
  let file = manifest_file();
  let mut last_err = String::new();

  for m in MIRRORS {
    let url = format!("{}update/{}", m.base, file);
    match fetch_json(&url).await {
      Ok(v) => {
        let remote_version = v
          .get("version")
          .and_then(|x| x.as_str())
          .map(str::to_string);
        let latest = parse_manifest(&v);
        let has_update = remote_version
          .as_deref()
          .map(|r| is_newer(&current, r))
          .unwrap_or(false);
        return Ok(UpdateCheck {
          current_version: current,
          has_update,
          remote_version,
          latest,
          mirror: m.id.to_string(),
          error: None,
        });
      }
      Err(e) => last_err = e,
    }
  }

  Ok(UpdateCheck {
    current_version: current,
    has_update: false,
    remote_version: None,
    latest: None,
    mirror: String::new(),
    error: Some(last_err),
  })
}

/// 桌面：下载并安装更新（调官方 updater，签名校验由它做）。
///
/// ⚠️ Windows 上这个函数**不会正常返回** —— updater 在起安装器之前会 `exit(0)`，
/// 前端不要指望拿到 `Ok(())` 之后还能做什么，进度到 `Finished` 就该显示「正在安装」。
#[tauri::command]
pub async fn install_desktop_update(
  app: tauri::AppHandle,
  mirror_id: String,
  on_event: Channel<Progress>,
) -> Result<(), String> {
  #[cfg(desktop)]
  {
    use tauri_plugin_updater::UpdaterExt;

    let m = mirror(&mirror_id).ok_or_else(|| format!("不认识的镜像：{mirror_id}"))?;
    let endpoint = tauri::Url::parse(&format!("{}update/latest.json", m.base))
      .map_err(|e| format!("镜像地址不合法：{e}"))?;
    let updater = app
      .updater_builder()
      .endpoints(vec![endpoint])
      .map_err(|e| format!("初始化更新器失败：{e}"))?
      .build()
      .map_err(|e| format!("初始化更新器失败：{e}"))?;

    let Some(update) = updater.check().await.map_err(|e| format!("检查更新失败：{e}"))? else {
      return Err("已经是最新版本".to_string());
    };

    log::info!(
      "开始下载更新 {} → {}",
      update.current_version,
      update.version
    );

    let ch = on_event.clone();
    let mut downloaded: u64 = 0;
    update
      .download_and_install(
        move |chunk, total| {
          downloaded += chunk as u64;
          let _ = ch.send(Progress::Progress {
            chunk: chunk as u64,
            downloaded,
            total,
          });
        },
        || {},
      )
      .await
      .map_err(|e| format!("下载或安装更新失败：{e}"))?;

    let _ = on_event.send(Progress::Finished);
    // Windows 上执行不到这里（安装器接管前进程已退出）；macOS / Linux 需要自己重启。
    app.restart();
  }

  #[cfg(not(desktop))]
  {
    let _ = (&app, &mirror_id, &on_event);
    Err("desktop-only".to_string())
  }
}

/// Android：把 APK 下到缓存目录，顺便算 sha256 并与清单核对。
///
/// 返回落盘路径，交给 `plugin:apk-install|install_apk` 起系统安装器。
#[tauri::command]
pub async fn download_android_update(
  app: tauri::AppHandle,
  url: String,
  mirrors: Vec<String>,
  sha256: Option<String>,
  version: String,
  on_event: Channel<Progress>,
) -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use tauri::Manager;

    let dir = app
      .path()
      .app_cache_dir()
      .map_err(|e| format!("拿不到缓存目录：{e}"))?
      .join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建缓存目录失败：{e}"))?;
    // 版本号进文件名：装完新版后旧文件还躺着时，下一次下载不会覆盖正在被安装器读取的那个
    let path = dir.join(format!("zeronote-{version}.apk"));

    let mut candidates = vec![url];
    candidates.extend(mirrors);
    let client = crate::net::download_client()?;
    let mut last_err = String::new();

    for candidate in candidates {
      let resp = match client.get(&candidate).send().await {
        Ok(r) => r,
        Err(e) => {
          last_err = format!("下载 APK 失败：{candidate} —— {e}");
          continue;
        }
      };
      let status = resp.status();
      if !status.is_success() {
        last_err = format!("下载 APK 失败：HTTP {status}（{candidate}）");
        continue;
      }
      let total = resp.content_length();
      let mut body = resp;
      let mut file = match std::fs::File::create(&path) {
        Ok(f) => f,
        Err(e) => return Err(format!("创建 APK 文件失败：{e}")),
      };
      let mut hasher = Sha256::new();
      let mut downloaded: u64 = 0;
      loop {
        match body.chunk().await {
          Ok(Some(chunk)) => {
            downloaded += chunk.len() as u64;
            if downloaded > MAX_APK_BYTES {
              return Err(format!(
                "APK 超过上限（{} 字节）：{candidate}",
                MAX_APK_BYTES
              ));
            }
            if let Err(e) = file.write_all(&chunk) {
              return Err(format!("写 APK 失败：{e}"));
            }
            hasher.update(&chunk);
            let _ = on_event.send(Progress::Progress {
              chunk: chunk.len() as u64,
              downloaded,
              total,
            });
          }
          Ok(None) => break,
          Err(e) => {
            last_err = format!("读取 APK 失败：{candidate} —— {e}");
            break;
          }
        }
      }
      if downloaded == 0 {
        continue;
      }

      if let Some(want) = sha256.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let got = format!("{:x}", hasher.finalize());
        if !got.eq_ignore_ascii_case(want) {
          let _ = std::fs::remove_file(&path);
          return Err(format!(
            "APK 校验失败：清单记 sha256={want}，实际 {got} —— 已删除，不安装"
          ));
        }
      }

      let _ = on_event.send(Progress::Finished);
      log::info!("APK 已落盘：{} ({downloaded} 字节)", path.display());
      return Ok(path.to_string_lossy().to_string());
    }

    Err(if last_err.is_empty() {
      "下载 APK 失败：没有可用的地址".to_string()
    } else {
      last_err
    })
  }

  #[cfg(not(target_os = "android"))]
  {
    let _ = (&app, &url, &mirrors, &sha256, &version, &on_event);
    Err("android-only".to_string())
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn version_compare_handles_multi_digit_segments() {
    assert!(is_newer("0.9.1", "0.9.2"));
    assert!(is_newer("0.9.1", "0.10.0"));
    assert!(!is_newer("0.9.2", "0.9.1"));
    assert!(!is_newer("0.9.1", "0.9.1"));
    assert!(is_newer("1.9.0", "1.10.0"));
  }

  #[test]
  fn version_compare_strips_prefix_and_suffixes() {
    assert!(is_newer("0.9.1", "v0.9.2"));
    assert!(is_newer("0.9.1", "0.9.2-beta"));
    assert!(!is_newer("0.9.1", "0.9.1+build5"));
  }
}
