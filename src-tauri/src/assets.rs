// ZeroNote 内核（Rust 侧）—— 附件跨设备搬运（rev173.238 · 附件同步期 4）
//
// 链路（`docs/附件与同步-需求-2026-10-28.md` §5）：
//   本地 → 云端临时 → 另一端本地同步完成 → 引用本地原文件 → 云端删除
//   状态机：local → staged（已上传临时区）→ landed（对端已落地并改写引用）→
//   cleaned（云端临时文件已删）
//
// 触发：**用户主动调用 + 每次确认**（需求 §5：启动 / 保存 / 定时 / 打开笔记都**不自动搬**）。
//
// 后端（需求 §5 表）：
//   · `local-folder` —— 共享目录（Syncthing / 坚果云同步的文件夹）。先做：无依赖、可测。
//   · `webdav`       —— 第二个；复用 `net::http_client`（CORS 在 WebView 里是死路）。
//   · Git **不做** —— 大文件会炸历史，且 git 没有「临时区」语义。
//
// 云端临时布局（两种后端同一套**相对**路径，方便换后端）：
//   `<root>/.zn-asset-staging/<sha16>/<文件名>`
//   `<root>/.zn-asset-staging/<sha16>/.zn-ack`   （内容 = 落地设备的 id）
//
// 状态**实时算**（云端目录 + ack 文件），不在本地再记一份会陈旧的副本：
//   云端有、无 ack ⇒ staged；有 ack ⇒ landed；ack 且云端已删 ⇒ cleaned。

use std::path::{Path, PathBuf};

use serde_json::json;

use crate::{
  atomic_write, private_root, read_assets_ledger, resolve, sha256_file, write_assets_ledger,
  ASSETS_DIR, PRIVATE_DIR,
};

/// 云端临时区的相对目录名（需求 §5：`<云端>/.zn-asset-staging/<hash>/<文件名>`）。
const STAGING_DIR: &str = ".zn-asset-staging";
/// 落地目录（需求 §6.3：`<库>/.zn-assets/external/`）。
const EXTERNAL_DIR: &str = "external";
/// ack 文件名（放在每个 hash 目录里）。
const ACK_FILE: &str = ".zn-ack";
/// WebDAV 密码在系统凭据库里的 account。
const WEBDAV_SECRET_ACCOUNT: &str = "zn-asset-relay";

/* ───────────── 配置 ───────────── */

/// 搬运后端（配置里**不含密码**；密码单独进系统凭据库）。
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum RelayBackend {
  /// 共享目录：两台机各自把 `root` 指向同一个被同步工具托管的目录
  #[serde(rename_all = "camelCase")]
  LocalFolder { root: String },
  /// WebDAV：`base_url` 如 `https://dav.jianguoyun.com/dav/`，`root` 是其中的子目录（可空）
  #[serde(rename_all = "camelCase")]
  WebDav {
    base_url: String,
    root: String,
    username: String,
  },
}

/// 读配置；文件不存在 = 没配过（正常状态，不是错误）。
fn read_relay_config(vault: &str) -> Result<serde_json::Value, String> {
  let path = Path::new(vault).join(ASSETS_DIR).join("relay.json");
  if !path.is_file() {
    return Ok(json!({ "version": 1, "backend": null }));
  }
  let raw = std::fs::read_to_string(&path)
    .map_err(|e| format!("读取搬运配置失败（{}）：{e}", path.display()))?;
  let v: serde_json::Value = serde_json::from_str(&raw)
    .map_err(|e| format!("搬运配置不是合法 JSON（{}）：{e}", path.display()))?;
  if v.get("version").is_none() {
    return Err(format!("搬运配置形状不对（缺 version）：{}", path.display()));
  }
  Ok(v)
}

fn write_relay_config(vault: &str, config: &serde_json::Value) -> Result<(), String> {
  let path = Path::new(vault).join(ASSETS_DIR).join("relay.json");
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir)
      .map_err(|e| format!("创建搬运配置目录失败（{}）：{e}", dir.display()))?;
  }
  let text =
    serde_json::to_string_pretty(config).map_err(|e| format!("序列化搬运配置失败：{e}"))?;
  atomic_write(&path, &text)
}

fn parse_backend(config: &serde_json::Value) -> Result<RelayBackend, String> {
  let b = config
    .get("backend")
    .filter(|b| !b.is_null())
    .ok_or_else(|| "还没配置搬运后端：先在「附件同步」里填共享目录或 WebDAV 地址".to_string())?;
  serde_json::from_value(b.clone()).map_err(|e| format!("搬运后端配置不合法：{e}"))
}

/// 本机设备 id（`<私有根>/.zn/device-id`）。
///
/// 为什么放私有根而不是库内：同一个设备上的多个库共用它 —— 台账的 `devices`
/// 是「设备」维度，同一个设备在两个库里露出两个 id 会让对端误以为是两台机。
fn device_id(vault: &str) -> Result<String, String> {
  let path = private_root(vault)
    .join(PRIVATE_DIR)
    .join("device-id");
  if let Ok(raw) = std::fs::read_to_string(&path) {
    let id = raw.trim();
    if !id.is_empty() {
      return Ok(id.to_string());
    }
  }
  let id = gen_device_id();
  if let Some(dir) = path.parent() {
    std::fs::create_dir_all(dir).map_err(|e| format!("创建设备标识目录失败：{e}"))?;
  }
  atomic_write(&path, &id)?;
  Ok(id)
}

/// 不引入 `rand`：时间 + 进程 id + 栈地址混一个 16 位十六进制。
/// 只要「同一设备稳定、不同设备不撞」—— 没有安全用途。
fn gen_device_id() -> String {
  use std::collections::hash_map::DefaultHasher;
  use std::hash::{Hash, Hasher};
  let mut h = DefaultHasher::new();
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_nanos())
    .unwrap_or(0)
    .hash(&mut h);
  std::process::id().hash(&mut h);
  let probe = Box::new(0u8);
  ((&*probe as *const u8) as usize).hash(&mut h);
  format!("{:016x}", h.finish())
}

/* ───────────── 凭据（WebDAV 密码）───────────── */

fn secret_store() -> tauri_plugin_keyring_store::KeyringStore {
  tauri_plugin_keyring_store::KeyringStore::new("com.aqua.zeronote")
}

fn load_webdav_password() -> Option<String> {
  secret_store()
    .get_password(WEBDAV_SECRET_ACCOUNT)
    .ok()
    .flatten()
}

fn save_webdav_password(pw: &str) -> Result<(), String> {
  secret_store()
    .set_password(WEBDAV_SECRET_ACCOUNT, pw)
    .map_err(|e| format!("写入系统凭据失败：{e}"))
}

fn clear_webdav_password() {
  let _ = secret_store().delete(WEBDAV_SECRET_ACCOUNT);
}

/* ───────────── 云端临时区：两种后端 ───────────── */

/// 云端临时区里的一条（一个 hash 目录）。
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
  /// `sha256:` 之后的 16 位前缀（目录名）
  pub hash16: String,
  pub name: String,
  pub size: u64,
  /// 对端已经落地（存在 `.zn-ack`）
  pub acked: bool,
}

fn staging_root_local(root: &str) -> PathBuf {
  Path::new(root).join(STAGING_DIR)
}

/// 文件名清洗：云端两侧都用同一个名字，别让 `..` / 分隔符 / 平台保留字符进来。
fn sanitize_name(name: &str) -> String {
  let base = name
    .rsplit(['/', '\\'])
    .next()
    .unwrap_or("file")
    .trim()
    .to_string();
  let cleaned: String = base
    .chars()
    .map(|c| match c {
      '<' | '>' | ':' | '"' | '|' | '?' | '*' => '_',
      c if c.is_control() => '_',
      c => c,
    })
    .collect();
  let trimmed = cleaned.trim_matches('.').trim();
  if trimmed.is_empty() {
    "file".to_string()
  } else {
    trimmed.to_string()
  }
}

fn hash16_of(id: &str) -> Result<String, String> {
  let hex = id
    .strip_prefix("sha256:")
    .ok_or_else(|| format!("文件 id 不是 sha256: 开头：{id}"))?;
  if hex.len() < 16 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
    return Err(format!("文件 id 不合法：{id}"));
  }
  Ok(hex[..16].to_ascii_lowercase())
}

impl RelayBackend {
  /// 上传一份到云端临时区。
  async fn put(
    &self,
    hash16: &str,
    name: &str,
    src: &Path,
  ) -> Result<(), String> {
    match self {
      RelayBackend::LocalFolder { root } => {
        let dir = staging_root_local(root).join(hash16);
        std::fs::create_dir_all(&dir)
          .map_err(|e| format!("创建云端临时目录失败（{}）：{e}", dir.display()))?;
        let dst = dir.join(name);
        // 先写临时名再改名：共享目录可能被同步工具盯着一半的文件
        let tmp = dir.join(format!(".zn-tmp-{name}"));
        std::fs::copy(src, &tmp).map_err(|e| format!("复制到云端临时区失败：{e}"))?;
        std::fs::rename(&tmp, &dst).map_err(|e| format!("落定云端临时文件失败：{e}"))?;
        Ok(())
      }
      RelayBackend::WebDav { .. } => {
        let bytes = std::fs::read(src).map_err(|e| format!("读取源文件失败：{e}"))?;
        let url = dav_staging_url(self, &format!("{hash16}/{name}"))?;
        let resp = dav_request(self, "PUT", &url, Some(bytes)).await?;
        if !matches!(resp.status, 200 | 201 | 204) {
          return Err(format!("上传到 WebDAV 失败（HTTP {}）：{url}", resp.status));
        }
        Ok(())
      }
    }
  }

  /// 列云端临时区。
  async fn list(&self) -> Result<Vec<RemoteEntry>, String> {
    match self {
      RelayBackend::LocalFolder { root } => {
        let root = staging_root_local(root);
        if !root.is_dir() {
          return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&root)
          .map_err(|e| format!("读取云端临时目录失败（{}）：{e}", root.display()))?
        {
          let entry = entry.map_err(|e| e.to_string())?;
          if !entry.path().is_dir() {
            continue;
          }
          let hash16 = entry.file_name().to_string_lossy().to_string();
          if hash16.len() < 16 {
            continue;
          }
          let acked = entry.path().join(ACK_FILE).is_file();
          for f in std::fs::read_dir(entry.path()).map_err(|e| e.to_string())? {
            let f = f.map_err(|e| e.to_string())?;
            let name = f.file_name().to_string_lossy().to_string();
            if name.starts_with(".zn") || !f.path().is_file() {
              continue;
            }
            let size = f.metadata().map_err(|e| e.to_string())?.len();
            out.push(RemoteEntry {
              hash16: hash16.clone(),
              name,
              size,
              acked,
            });
          }
        }
        out.sort_by(|a, b| a.hash16.cmp(&b.hash16).then(a.name.cmp(&b.name)));
        Ok(out)
      }
      RelayBackend::WebDav { .. } => {
        let base = dav_staging_url(self, "")?;
        let dirs = dav_propfind_dirs(self, &base).await;
        let dirs = match dirs {
          Ok(d) => d,
          // 远端还没有临时区 = 正常状态（第一次搬运之前）
          Err(e) if e.contains("404") || e.contains("Not Found") => return Ok(Vec::new()),
          Err(e) => return Err(e),
        };
        let mut out = Vec::new();
        for hash16 in dirs {
          let dir_url = join_url(&base, &format!("{hash16}/"))?;
          let entries = match dav_propfind_entries(self, &dir_url).await {
            Ok(v) => v,
            Err(_) => continue,
          };
          let acked = dav_exists(self, &join_url(&base, &format!("{hash16}/{ACK_FILE}"))?).await;
          for (name, size) in entries {
            if name.starts_with(".zn") {
              continue;
            }
            out.push(RemoteEntry {
              hash16: hash16.clone(),
              name,
              size,
              acked,
            });
          }
        }
        out.sort_by(|a, b| a.hash16.cmp(&b.hash16).then(a.name.cmp(&b.name)));
        Ok(out)
      }
    }
  }

  /// 下载到 `dst`（调用方给临时文件名，校验后再改名）。
  async fn get_to(&self, hash16: &str, name: &str, dst: &Path) -> Result<(), String> {
    match self {
      RelayBackend::LocalFolder { root } => {
        let src = staging_root_local(root).join(hash16).join(name);
        if !src.is_file() {
          return Err(format!("云端没有这个文件：{}", src.display()));
        }
        std::fs::copy(&src, dst).map_err(|e| format!("下载失败：{e}"))?;
        Ok(())
      }
      RelayBackend::WebDav { .. } => {
        let url = dav_staging_url(self, &format!("{hash16}/{name}"))?;
        let client = crate::net::http_client(120_000)?;
        let mut resp = client
          .get(url.clone())
          .header("Authorization", dav_auth(self))
          .send()
          .await
          .map_err(|e| format!("下载失败：{url} —— {e}"))?;
        let status = resp.status().as_u16();
        if !(200..300).contains(&status) {
          return Err(format!("下载失败（HTTP {status}）：{url}"));
        }
        let mut file = std::fs::File::create(dst).map_err(|e| format!("创建落地文件失败：{e}"))?;
        use std::io::Write as _;
        while let Some(chunk) = resp.chunk().await.map_err(|e| format!("读响应失败：{e}"))? {
          file.write_all(&chunk).map_err(|e| format!("写入落地文件失败：{e}"))?;
        }
        file.flush().map_err(|e| e.to_string())?;
        Ok(())
      }
    }
  }

  /// 落地方写 ack（内容 = 设备 id）。
  async fn ack(&self, hash16: &str, device: &str) -> Result<(), String> {
    match self {
      RelayBackend::LocalFolder { root } => {
        let dir = staging_root_local(root).join(hash16);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        atomic_write(&dir.join(ACK_FILE), device)
      }
      RelayBackend::WebDav { .. } => {
        let url = dav_staging_url(self, &format!("{hash16}/{ACK_FILE}"))?;
        let resp = dav_request(self, "PUT", &url, Some(device.as_bytes().to_vec())).await?;
        if !matches!(resp.status, 200 | 201 | 204) {
          return Err(format!("写 ack 失败（HTTP {}）：{url}", resp.status));
        }
        Ok(())
      }
    }
  }

  /// 删云端临时区（整个 hash 目录）。
  async fn remove(&self, hash16: &str) -> Result<(), String> {
    match self {
      RelayBackend::LocalFolder { root } => {
        let dir = staging_root_local(root).join(hash16);
        match std::fs::remove_dir_all(&dir) {
          Ok(()) => Ok(()),
          Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
          Err(e) => Err(format!("删除云端临时目录失败（{}）：{e}", dir.display())),
        }
      }
      RelayBackend::WebDav { .. } => {
        // 先删文件再删目录：有些 WebDAV 服务拒绝对非空目录 DELETE
        let dir_url = dav_staging_url(self, &format!("{hash16}/"))?;
        let entries = dav_propfind_entries(self, &dir_url)
          .await
          .unwrap_or_default();
        for (name, _) in entries {
          let url = dav_staging_url(self, &format!("{hash16}/{name}"))?;
          let _ = dav_request(self, "DELETE", &url, None).await;
        }
        let ack_url = dav_staging_url(self, &format!("{hash16}/{ACK_FILE}"))?;
        let _ = dav_request(self, "DELETE", &ack_url, None).await;
        let resp = dav_request(self, "DELETE", &dir_url, None).await?;
        if matches!(resp.status, 200 | 204 | 404) {
          Ok(())
        } else {
          Err(format!("删除云端临时目录失败（HTTP {}）：{dir_url}", resp.status))
        }
      }
    }
  }
}

/* ───────────── WebDAV 小工具（只做搬运，不认同步语义）───────────── */

struct DavResp {
  status: u16,
  text: String,
}

fn dav_auth(backend: &RelayBackend) -> String {
  use base64::Engine as _;
  match backend {
    RelayBackend::WebDav {
      username,
      ..
    } => {
      let pw = load_webdav_password().unwrap_or_default();
      let raw = format!("{username}:{pw}");
      format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(raw.as_bytes())
      )
    }
    _ => String::new(),
  }
}

/// 拼云端临时区的 URL（`path` 为空 = staging 根；以 `/` 结尾表示目录）。
fn dav_staging_url(backend: &RelayBackend, path: &str) -> Result<reqwest::Url, String> {
  let (base_url, root) = match backend {
    RelayBackend::WebDav { base_url, root, .. } => (base_url, root),
    _ => return Err("不是 WebDAV 后端".to_string()),
  };
  let base = base_url.trim_end_matches('/');
  let root = root.trim_matches('/');
  let middle = if root.is_empty() {
    String::new()
  } else {
    format!("/{root}")
  };
  let tail = if path.is_empty() {
    format!("/{STAGING_DIR}/")
  } else {
    format!("/{STAGING_DIR}/{path}")
  };
  join_url_str(&format!("{base}{middle}{tail}"))
}

fn join_url_str(raw: &str) -> Result<reqwest::Url, String> {
  reqwest::Url::parse(raw).map_err(|e| format!("URL 不合法（{raw}）：{e}"))
}

fn join_url(base: &reqwest::Url, path: &str) -> Result<reqwest::Url, String> {
  base.join(path).map_err(|e| format!("URL 拼接失败（{path}）：{e}"))
}

async fn dav_request(
  backend: &RelayBackend,
  method: &str,
  url: &reqwest::Url,
  body: Option<Vec<u8>>,
) -> Result<DavResp, String> {
  let client = crate::net::http_client(120_000)?;
  let m = reqwest::Method::from_bytes(method.as_bytes())
    .map_err(|e| format!("HTTP 方法不合法（{method}）：{e}"))?;
  let mut rb = client
    .request(m, url.clone())
    .header("Authorization", dav_auth(backend));
  if let Some(b) = body {
    rb = rb.header(reqwest::header::CONTENT_LENGTH, b.len().to_string()).body(b);
  }
  let resp = rb
    .send()
    .await
    .map_err(|e| format!("请求失败：{url} —— {e}"))?;
  let status = resp.status().as_u16();
  let text = resp.text().await.unwrap_or_default();
  Ok(DavResp { status, text })
}

async fn dav_exists(backend: &RelayBackend, url: &reqwest::Url) -> bool {
  match dav_request(backend, "HEAD", url, None).await {
    Ok(r) => (200..300).contains(&r.status),
    Err(_) => false,
  }
}

/// PROPFIND 列**目录**（staging 根下的一级目录名）。
async fn dav_propfind_dirs(
  backend: &RelayBackend,
  url: &reqwest::Url,
) -> Result<Vec<String>, String> {
  let resp = propfind(backend, url).await?;
  if !matches!(resp.status, 207 | 200) {
    return Err(format!("PROPFIND 失败（HTTP {}）：{url} —— 404", resp.status));
  }
  Ok(collect_dirs(&resp.text))
}

/// PROPFIND 列**文件**（名字 + 大小）。
async fn dav_propfind_entries(
  backend: &RelayBackend,
  url: &reqwest::Url,
) -> Result<Vec<(String, u64)>, String> {
  let resp = propfind(backend, url).await?;
  if !matches!(resp.status, 207 | 200) {
    return Err(format!("PROPFIND 失败（HTTP {}）：{url}", resp.status));
  }
  Ok(collect_files(&resp.text))
}

async fn propfind(backend: &RelayBackend, url: &reqwest::Url) -> Result<DavResp, String> {
  let client = crate::net::http_client(30_000)?;
  let body = br#"<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>"#
    .to_vec();
  let resp = client
    .request(
      reqwest::Method::from_bytes(b"PROPFIND").unwrap(),
      url.clone(),
    )
    .header("Depth", "1")
    .header("Content-Type", "application/xml; charset=utf-8")
    .header("Authorization", dav_auth(backend))
    .header(reqwest::header::CONTENT_LENGTH, body.len().to_string())
    .body(body)
    .send()
    .await
    .map_err(|e| format!("PROPFIND 失败：{url} —— {e}"))?;
  let status = resp.status().as_u16();
  let text = resp.text().await.unwrap_or_default();
  Ok(DavResp { status, text })
}

/// 从 PROPFIND 响应里抓 `<d:href>`（或 `<D:href>`）列表。
fn collect_hrefs(xml: &str) -> Vec<String> {
  let mut out = Vec::new();
  let lower = xml.to_ascii_lowercase();
  let mut pos = 0usize;
  while let Some(rel) = lower[pos..].find(":href>") {
    let start = pos + rel + ":href>".len();
    let Some(end_rel) = lower[start..].find("</") else {
      break;
    };
    let raw = &xml[start..start + end_rel];
    out.push(percent_decode(raw.trim()));
    pos = start + end_rel;
  }
  out
}

/// staging 根下一级目录名（PROPFIND 会包含自身，去掉）。
fn collect_dirs(xml: &str) -> Vec<String> {
  let mut out = Vec::new();
  for href in collect_hrefs(xml) {
    let trimmed = href.trim_end_matches('/');
    let name = trimmed.rsplit('/').next().unwrap_or("").to_string();
    if name.is_empty() || name == STAGING_DIR || name == "." {
      continue;
    }
    if name.len() >= 16 && !out.contains(&name) {
      out.push(name);
    }
  }
  out
}

/// 目录 PROPFIND 里的文件名 + 大小。
fn collect_files(xml: &str) -> Vec<(String, u64)> {
  let mut out = Vec::new();
  // 每个 `<d:response …>…</d:response>` 是一段；href 与 getcontentlength 在同一段里
  let lower = xml.to_ascii_lowercase();
  let mut pos = 0usize;
  while let Some(rel) = lower[pos..].find("<d:response") {
    let start = pos + rel;
    let Some(open_end) = lower[start..].find('>') else {
      break;
    };
    let block_start = start + open_end + 1;
    let Some(end_rel) = lower[block_start..].find("</d:response") else {
      break;
    };
    let block = &xml[block_start..block_start + end_rel];
    let block_lower = block.to_ascii_lowercase();
    if let Some(h) = block_lower.find(":href>") {
      let hstart = h + ":href>".len();
      if let Some(hend) = block_lower[hstart..].find("</") {
        let raw = &block[hstart..hstart + hend];
        let href = percent_decode(raw.trim());
        let name = href
          .trim_end_matches('/')
          .rsplit('/')
          .next()
          .unwrap_or("")
          .to_string();
        if !name.is_empty() && name != STAGING_DIR {
          let size = block_lower
            .find(":getcontentlength>")
            .and_then(|p| {
              let s = p + ":getcontentlength>".len();
              block_lower[s..].find("</").map(|e| &block[s..s + e])
            })
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0);
          out.push((name, size));
        }
      }
    }
    pos = block_start + end_rel;
  }
  out
}

/// `%20` → 空格；其余逐字节还原（UTF-8）。
fn percent_decode(s: &str) -> String {
  let bytes = s.as_bytes();
  let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      let hex = &s[i + 1..i + 3];
      if let Ok(v) = u8::from_str_radix(hex, 16) {
        out.push(v);
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).to_string()
}

/* ───────────── 命令：配置 ───────────── */

/// 读搬运配置（**不含密码**，只告诉前端「密码存过没有」）。
#[tauri::command]
pub fn asset_relay_config(vault: String) -> Result<serde_json::Value, String> {
  let mut cfg = read_relay_config(&vault)?;
  let has_pw = load_webdav_password().is_some();
  cfg["hasPassword"] = json!(has_pw);
  Ok(cfg)
}

/// 写搬运配置。`password` **只用于写系统凭据库**，不落 `relay.json`。
///
/// 传 `password: null` + `clearPassword: true` ⇒ 删掉已存密码（断开连接）。
#[tauri::command]
pub fn asset_relay_config_set(
  vault: String,
  backend: serde_json::Value,
  password: Option<String>,
) -> Result<(), String> {
  let parsed: RelayBackend =
    serde_json::from_value(backend.clone()).map_err(|e| format!("搬运后端配置不合法：{e}"))?;
  match &parsed {
    RelayBackend::LocalFolder { root } => {
      let p = Path::new(root);
      if !p.is_absolute() {
        return Err(format!("共享目录必须是绝对路径：{root}"));
      }
      std::fs::create_dir_all(p.join(STAGING_DIR))
        .map_err(|e| format!("创建共享目录失败（{}）：{e}", p.display()))?;
    }
    RelayBackend::WebDav { base_url, .. } => {
      if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
        return Err(format!("WebDAV 地址必须以 http:// 或 https:// 开头：{base_url}"));
      }
    }
  }
  if let Some(pw) = password {
    if !pw.is_empty() {
      save_webdav_password(&pw)?;
    }
  } else {
    clear_webdav_password();
  }
  write_relay_config(
    &vault,
    &json!({ "version": 1, "backend": parsed, "updatedAt": crate::now_ms() }),
  )
}

/* ───────────── 命令：本地清单 ───────────── */

/// 本地可搬清单 = 引用台账里的条目（>1 MiB 的引用型 / 模式 B 的压缩版）。
///
/// **不联网**：面板打开就该立刻有内容，不能因为云端慢就整片空白。
#[tauri::command]
pub fn asset_relay_pending(vault: String) -> Result<serde_json::Value, String> {
  let ledger = read_assets_ledger(&vault)?;
  let me = device_id(&vault)?;
  let entries = ledger
    .get("entries")
    .and_then(|x| x.as_array())
    .ok_or_else(|| "引用台账形状不对（缺 entries 数组）".to_string())?;
  let mut items = Vec::new();
  for e in entries {
    let id = e.get("id").and_then(|x| x.as_str()).unwrap_or_default();
    if id.is_empty() {
      continue;
    }
    let original = e.get("original").and_then(|x| x.as_str()).unwrap_or_default();
    let stored = e.get("storedInVault").and_then(|x| x.as_str());
    let local = local_source_path(&vault, original, stored);
    items.push(json!({
      "id": id,
      "original": original,
      "size": e.get("size").cloned().unwrap_or(json!(0)),
      "storedInVault": stored,
      "preview": e.get("preview").cloned().unwrap_or(json!(null)),
      "localPath": local.as_ref().map(|p| p.to_string_lossy().to_string()),
      "exists": local.is_some(),
      "devices": e.get("devices").cloned().unwrap_or(json!({})),
      // 本机上传过、且云端临时区已清理（relay 链走完）—— 状态机里这是终态，
      // 不记的话「云端已删」会让文件重新显示成「待上传」，用户会以为没传成功。
      "relayCleanedAt": e.get("relayCleanedAt").cloned().unwrap_or(json!(null)),
    }));
  }
  Ok(json!({ "deviceId": me, "items": items }))
}

/// 台账条目在本机的**可用源文件**：优先入库副本（模式 B 压缩版），其次原文件路径。
fn local_source_path(vault: &str, original: &str, stored: Option<&str>) -> Option<PathBuf> {
  if let Some(rel) = stored {
    if let Ok(abs) = resolve(vault, rel) {
      if abs.is_file() {
        return Some(abs);
      }
    }
  }
  let p = PathBuf::from(original);
  if p.is_file() {
    return Some(p);
  }
  None
}

/* ───────────── 命令：上传 ───────────── */

/// 上传选中的文件到云端临时区（**调用前 UI 必须已让用户确认**）。
#[tauri::command]
pub async fn asset_relay_upload(
  vault: String,
  ids: Vec<String>,
) -> Result<serde_json::Value, String> {
  let config = read_relay_config(&vault)?;
  let backend = parse_backend(&config)?;
  let me = device_id(&vault)?;
  let mut ledger = read_assets_ledger(&vault)?;

  let mut items = Vec::new();
  let mut uploaded = 0usize;
  let mut total_bytes: u64 = 0;

  for id in ids {
    let result = upload_one(&vault, &backend, &mut ledger, &me, &id).await;
    match result {
      Ok((size, remote_name)) => {
        uploaded += 1;
        total_bytes += size;
        items.push(json!({ "id": id, "ok": true, "size": size, "name": remote_name }));
      }
      Err(e) => items.push(json!({ "id": id, "ok": false, "error": e })),
    }
  }
  // 设备映射与上传放在同一次落盘里：中途失败也不会留下「传了但台账不知道」的条目
  write_assets_ledger(&vault, &ledger)?;
  Ok(json!({
    "uploaded": uploaded,
    "totalBytes": total_bytes,
    "items": items,
  }))
}

async fn upload_one(
  vault: &str,
  backend: &RelayBackend,
  ledger: &mut serde_json::Value,
  me: &str,
  id: &str,
) -> Result<(u64, String), String> {
  let hash16 = hash16_of(id)?;
  let entry = find_entry(ledger, id)
    .ok_or_else(|| "引用台账里没有这个文件（可能已被移除）".to_string())?;
  let original = entry
    .get("original")
    .and_then(|x| x.as_str())
    .unwrap_or_default()
    .to_string();
  let stored = entry.get("storedInVault").and_then(|x| x.as_str()).map(|s| s.to_string());
  // 源文件：**优先 `original`**，其次入库副本。
  //
  // 为什么不能只信 `local_source_path`（它优先入库副本）：模式 B（rev173.234 图片压缩）
  // 的 `storedInVault` 是**压缩版**，而台账 id 是**原图**的内容摘要 ⇒ 拿压缩版去上传必然
  // 卡在下面的 sha256 校验（rev173.239 实测：报「文件内容已变化」）。压缩版只是正文显示用的，
  // 跨设备要搬的始终是原图。原文件不在本机时才退回副本 —— 那时 sha 不符是**正确**的报错。
  let original_path = PathBuf::from(&original);
  let src = if !original.is_empty() && original_path.is_file() {
    original_path
  } else {
    local_source_path(vault, &original, stored.as_deref())
      .ok_or_else(|| format!("源文件不存在，无法同步：{original}"))?
  };

  // 内容校验：台账 id 是内容摘要，源文件被换过/改过就必须明确报错，不能把错东西传上去
  let actual = sha256_file(&src)?;
  if actual != id {
    return Err(format!(
      "文件内容已变化（台账记的是 {id}，实际 {actual}）——请重新插入这份附件"
    ));
  }

  let size = std::fs::metadata(&src).map_err(|e| e.to_string())?.len();
  let name = sanitize_name(&original);
  backend.put(&hash16, &name, &src).await?;

  let entry = find_entry_mut(ledger, id).unwrap();
  if let Some(devices) = entry.get_mut("devices").and_then(|d| d.as_object_mut()) {
    devices.insert(me.to_string(), json!(original));
  } else {
    entry["devices"] = json!({ me: original });
  }
  Ok((size, name))
}

fn find_entry<'a>(ledger: &'a serde_json::Value, id: &str) -> Option<&'a serde_json::Value> {
  ledger
    .get("entries")?
    .as_array()?
    .iter()
    .find(|e| e.get("id").and_then(|x| x.as_str()) == Some(id))
}

fn find_entry_mut<'a>(
  ledger: &'a mut serde_json::Value,
  id: &str,
) -> Option<&'a mut serde_json::Value> {
  ledger
    .get_mut("entries")?
    .as_array_mut()?
    .iter_mut()
    .find(|e| e.get("id").and_then(|x| x.as_str()) == Some(id))
}

/* ───────────── 命令：对端清单 / 落地 / 清理 ───────────── */

/// 列云端临时区（联网）。
#[tauri::command]
pub async fn asset_relay_remote(vault: String) -> Result<serde_json::Value, String> {
  let config = read_relay_config(&vault)?;
  let backend = parse_backend(&config)?;
  let entries = backend.list().await?;
  Ok(json!({
    "items": entries,
    "total": entries.len(),
  }))
}

/// 落地选中的文件：下载 → 校验 sha256 → 写 `<库>/.zn-assets/external/` →
/// 台账 `devices[本机] = 库内相对路径` → 写 ack。
///
/// 返回每项的 `{ id, path（库内相对）, original }`，前端据此改写笔记引用
/// （`asset_relay_relink`）。
#[tauri::command]
pub async fn asset_relay_land(
  vault: String,
  ids: Vec<String>,
) -> Result<serde_json::Value, String> {
  let config = read_relay_config(&vault)?;
  let backend = parse_backend(&config)?;
  let me = device_id(&vault)?;
  let remote = backend.list().await?;
  let mut ledger = read_assets_ledger(&vault)?;

  let mut items = Vec::new();
  let mut landed = 0usize;
  let mut total_bytes: u64 = 0;

  for id in ids {
    let result = land_one(&vault, &backend, &remote, &me, &mut ledger, &id).await;
    match result {
      Ok((rel, rel_size, original)) => {
        landed += 1;
        total_bytes += rel_size;
        items.push(json!({ "id": id, "ok": true, "path": rel, "original": original }));
      }
      Err(e) => items.push(json!({ "id": id, "ok": false, "error": e })),
    }
  }
  write_assets_ledger(&vault, &ledger)?;
  Ok(json!({
    "landed": landed,
    "totalBytes": total_bytes,
    "items": items,
  }))
}

async fn land_one(
  vault: &str,
  backend: &RelayBackend,
  remote: &[RemoteEntry],
  me: &str,
  ledger: &mut serde_json::Value,
  id: &str,
) -> Result<(String, u64, String), String> {
  let hash16 = hash16_of(id)?;
  let entry = remote
    .iter()
    .find(|r| r.hash16 == hash16)
    .ok_or_else(|| "云端没有这个文件（可能已被清理，或还没上传）".to_string())?;
  let original = find_entry(ledger, id)
    .and_then(|e| e.get("original").and_then(|o| o.as_str()))
    .unwrap_or_default()
    .to_string();

  let dir = Path::new(vault).join(ASSETS_DIR).join(EXTERNAL_DIR);
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建落地目录失败：{e}"))?;
  // 文件名带 hash 前缀：不同文件同名时不会互相覆盖
  let name = format!("{}-{}", &hash16[..8], sanitize_name(&entry.name));
  let dst = dir.join(&name);
  let tmp = dir.join(format!(".zn-tmp-{name}"));

  backend.get_to(&hash16, &entry.name, &tmp).await?;
  let actual = sha256_file(&tmp)?;
  if actual != id {
    let _ = std::fs::remove_file(&tmp);
    return Err(format!(
      "下载到的文件内容不对（期望 {id}，实际 {actual}）——已丢弃，请重传"
    ));
  }
  std::fs::rename(&tmp, &dst).map_err(|e| format!("落定失败：{e}"))?;
  let size = std::fs::metadata(&dst).map_err(|e| e.to_string())?.len();
  // 库内相对路径（与台账 / 笔记引用同一套：`resolve(vault, rel)` 直接可用）
  let rel = format!("{ASSETS_DIR}/{EXTERNAL_DIR}/{name}");

  let entry = find_entry_mut(ledger, id).unwrap();
  if let Some(devices) = entry.get_mut("devices").and_then(|d| d.as_object_mut()) {
    devices.insert(me.to_string(), json!(rel));
  } else {
    entry["devices"] = json!({ me: rel });
  }

  backend.ack(&hash16, me).await?;
  Ok((rel, size, original))
}

/// 清理云端临时区：**只删已有 ack 的**（对端还没拿到就删 = 文件丢了）。
#[tauri::command]
pub async fn asset_relay_cleanup(vault: String) -> Result<serde_json::Value, String> {
  let config = read_relay_config(&vault)?;
  let backend = parse_backend(&config)?;
  let remote = backend.list().await?;
  let mut hashes: Vec<String> = remote
    .iter()
    .filter(|r| r.acked)
    .map(|r| r.hash16.clone())
    .collect();
  hashes.sort();
  hashes.dedup();
  let mut cleaned = 0usize;
  let mut errors = Vec::new();
  for hash16 in &hashes {
    match backend.remove(hash16).await {
      Ok(()) => cleaned += 1,
      Err(e) => errors.push(format!("{hash16}: {e}")),
    }
  }
  // 在台账里标「这份已经走完 relay 链」——否则云端删掉后状态会退回「待上传」，
  // 用户会以为没传成功、再传一遍（需求 §5 的状态机里 cleaned 是终态）。
  if cleaned > 0 {
    let mut ledger = read_assets_ledger(&vault)?;
    let now = crate::now_ms();
    if let Some(entries) = ledger.get_mut("entries").and_then(|x| x.as_array_mut()) {
      for e in entries.iter_mut() {
        let id = e
          .get("id")
          .and_then(|x| x.as_str())
          .unwrap_or_default()
          .to_string();
        if let Ok(h) = hash16_of(&id) {
          if hashes.contains(&h) {
            e["relayCleanedAt"] = json!(now);
          }
        }
      }
    }
    write_assets_ledger(&vault, &ledger)?;
  }
  Ok(json!({
    "cleaned": cleaned,
    "errors": errors,
    "kept": remote.iter().filter(|r| !r.acked).count(),
  }))
}

/* ───────────── 命令：改写笔记引用 ───────────── */

/// 把库内笔记里指向 `from`（原文件绝对路径）的引用改写成 `to`（库内相对路径）。
///
/// 只做**精确字符串**替换的三种形态（正文 / 尖括号目标 / 百分号编码目标），
/// 不碰其它内容；返回改动的笔记数。
#[tauri::command]
pub fn asset_relay_relink(
  vault: String,
  from: String,
  to: String,
) -> Result<serde_json::Value, String> {
  if from.trim().is_empty() || to.trim().is_empty() {
    return Err("改写引用需要给出原路径与目标路径".to_string());
  }
  let target = md_target(&to);
  let from_forms = [
    format!("]({from})"),
    format!("](<{from}>)"),
    format!("]({})", percent_encode_path(&from)),
  ];
  let to_target = format!("]({target})");
  let mut changed = 0usize;
  let mut total_hits = 0usize;
  for entry in walk_markdown(&vault)? {
    let text = match std::fs::read_to_string(&entry) {
      Ok(t) => t,
      Err(_) => continue,
    };
    let mut next = text.clone();
    let mut hits = 0usize;
    for form in &from_forms {
      let n = next.matches(form.as_str()).count();
      if n > 0 {
        next = next.replace(form.as_str(), &to_target);
        hits += n;
      }
    }
    if hits > 0 && next != text {
      // 走内核自己的原子写（与 editor 保存同一条通道）
      atomic_write(&entry, &next)?;
      changed += 1;
      total_hits += hits;
    }
  }
  Ok(json!({ "changedNotes": changed, "hits": total_hits }))
}

/// 库内所有 `.md`（跳过 `.` 开头与 `SKIP` 目录，与 `list_notes` 同一套边界）。
fn walk_markdown(vault: &str) -> Result<Vec<PathBuf>, String> {
  let mut out = Vec::new();
  walk_md(Path::new(vault), &mut out)?;
  Ok(out)
}

fn walk_md(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
  let entries = match std::fs::read_dir(dir) {
    Ok(e) => e,
    Err(_) => return Ok(()),
  };
  for entry in entries {
    let entry = entry.map_err(|e| e.to_string())?;
    let path = entry.path();
    let name = entry.file_name().to_string_lossy().to_string();
    if name.starts_with('.') {
      continue;
    }
    if path.is_dir() {
      walk_md(&path, out)?;
    } else if path.extension().map(|e| e.eq_ignore_ascii_case("md")).unwrap_or(false) {
      out.push(path);
    }
  }
  Ok(())
}

/// Markdown 链接目标：含空白 / 括号 / 尖括号时用 `<...>` 包起来（与前端 `mdTarget` 同口径）。
fn md_target(path: &str) -> String {
  if path
    .chars()
    .any(|c| c.is_whitespace() || matches!(c, '(' | ')' | '<' | '>'))
  {
    format!("<{path}>")
  } else {
    path.to_string()
  }
}

/// 路径的百分号编码形态（与插入端 `mdTarget` 的编码一致：空格 → `%20`）。
fn percent_encode_path(path: &str) -> String {
  let mut out = String::with_capacity(path.len());
  for ch in path.chars() {
    if ch == ' ' {
      out.push_str("%20");
    } else {
      out.push(ch);
    }
  }
  out
}

/* ───────────── 测试 ───────────── */

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn tmpdir(tag: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("..")
      .join("_tmp-test");
    let d = root.join(format!("zn-asset-{tag}"));
    match fs::remove_dir_all(&d) {
      Ok(()) => {}
      Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
      Err(e) => panic!("清理测试目录失败（{}）：{e}", d.display()),
    }
    fs::create_dir_all(&d).unwrap();
    d
  }

  fn make_vault(dir: &Path, name: &str) -> String {
    let vault = dir.join(name);
    fs::create_dir_all(vault.join(".zn-assets")).unwrap();
    fs::write(vault.join("note.md"), "# hi\n").unwrap();
    vault.to_string_lossy().to_string()
  }

  /// 往台账里塞一条引用型条目（>1 MiB 的库外文件）。
  fn seed_ledger(vault: &str, original: &str, size: u64, id: &str) {
    let mut ledger = read_assets_ledger(vault).unwrap();
    ledger["entries"].as_array_mut().unwrap().push(json!({
      "id": id,
      "original": original,
      "size": size,
      "storedInVault": null,
      "storedSize": null,
      "preview": null,
      "devices": {},
    }));
    write_assets_ledger(vault, &ledger).unwrap();
  }

  fn set_local_backend(vault: &str, root: &Path) {
    write_relay_config(
      vault,
      &json!({ "version": 1, "backend": { "kind": "local-folder", "root": root.to_string_lossy() } }),
    )
    .unwrap();
  }

  #[test]
  fn local_folder_roundtrip_stage_land_ack_clean() {
    let d = tmpdir("roundtrip");
    let shared = d.join("shared");
    fs::create_dir_all(&shared).unwrap();
    let a = make_vault(&d, "vault-a");
    let b = make_vault(&d, "vault-b");

    // 大文件放在「A 机」上
    let src = d.join("clip.mp4");
    let bytes = vec![3u8; 1024 * 1024 + 7];
    fs::write(&src, &bytes).unwrap();
    let id = sha256_file(&src).unwrap();

    seed_ledger(&a, &src.to_string_lossy().to_string(), bytes.len() as u64, &id);
    seed_ledger(&b, &src.to_string_lossy().to_string(), bytes.len() as u64, &id);
    set_local_backend(&a, &shared);
    set_local_backend(&b, &shared);

    // ── A：上传 ──
    let up = tauri::async_runtime::block_on(asset_relay_upload(a.clone(), vec![id.clone()])).unwrap();
    assert_eq!(up["uploaded"], 1, "{up}");
    let hash16 = hash16_of(&id).unwrap();
    assert!(
      shared.join(STAGING_DIR).join(&hash16).join("clip.mp4").is_file(),
      "上传后云端临时区应有文件"
    );

    // ── B：看到它（未 ack）→ 落地 ──
    let rem = tauri::async_runtime::block_on(asset_relay_remote(b.clone())).unwrap();
    assert_eq!(rem["total"], 1);
    assert_eq!(rem["items"][0]["acked"], false);

    let land = tauri::async_runtime::block_on(asset_relay_land(b.clone(), vec![id.clone()])).unwrap();
    assert_eq!(land["landed"], 1, "{land}");
    let rel = land["items"][0]["path"].as_str().unwrap().to_string();
    assert!(
      rel.starts_with(".zn-assets/external/"),
      "落地到 .zn-assets/external/：{rel}"
    );
    let landed = Path::new(&b).join(&rel);
    assert_eq!(fs::read(&landed).unwrap().len(), bytes.len(), "内容长度一致");
    assert_eq!(fs::read(&landed).unwrap(), bytes, "内容逐字节一致");

    // 台账 devices[B] 指向库内相对路径
    let ledger = read_assets_ledger(&b).unwrap();
    let entry = find_entry(&ledger, &id).unwrap();
    assert_eq!(entry["devices"][device_id(&b).unwrap().as_str()], json!(rel));

    // ── A：清理（B 已 ack）──
    let clean = tauri::async_runtime::block_on(asset_relay_cleanup(a.clone())).unwrap();
    assert_eq!(clean["cleaned"], 1, "{clean}");
    assert!(!shared.join(STAGING_DIR).join(&hash16).exists(), "云端临时区应已删");
  }

  #[test]
  fn upload_rejects_missing_source() {
    let d = tmpdir("missing");
    let shared = d.join("shared");
    fs::create_dir_all(&shared).unwrap();
    let a = make_vault(&d, "vault-a");
    let missing = d.join("gone.mp4");
    let id = format!("sha256:{}", "ab".repeat(32));
    seed_ledger(&a, &missing.to_string_lossy().to_string(), 2 * 1024 * 1024, &id);
    set_local_backend(&a, &shared);

    let err_payload =
      tauri::async_runtime::block_on(asset_relay_upload(a.clone(), vec![id])).unwrap();
    assert_eq!(err_payload["uploaded"], 0);
    let msg = err_payload["items"][0]["error"].as_str().unwrap().to_string();
    assert!(msg.contains("源文件不存在"), "要明确报错：{msg}");
  }

  #[test]
  fn upload_rejects_changed_content() {
    let d = tmpdir("changed");
    let shared = d.join("shared");
    fs::create_dir_all(&shared).unwrap();
    let a = make_vault(&d, "vault-a");
    let src = d.join("clip.mp4");
    fs::write(&src, vec![1u8; 1024 * 1024 + 3]).unwrap();
    let id = sha256_file(&src).unwrap();
    // 台账记 A 的内容，但磁盘被换成别的（大小一样、内容不同）
    seed_ledger(&a, &src.to_string_lossy().to_string(), 1024 * 1024 + 3, &id);
    set_local_backend(&a, &shared);
    fs::write(&src, vec![2u8; 1024 * 1024 + 3]).unwrap();

    let payload = tauri::async_runtime::block_on(asset_relay_upload(a.clone(), vec![id])).unwrap();
    assert_eq!(payload["uploaded"], 0);
    let msg = payload["items"][0]["error"].as_str().unwrap().to_string();
    assert!(msg.contains("内容已变化"), "sha 不符要明确报错：{msg}");
  }

  /// 模式 B（图片压缩）的条目：`storedInVault` 是**压缩版**，台账 id 是**原图**的内容摘要。
  /// 上传必须挑原图 —— 拿压缩版去传会卡在 sha 校验（rev173.239 实测踩到，正文入口 2 靠它）。
  #[test]
  fn upload_prefers_original_over_compressed_copy() {
    let d = tmpdir("compressed");
    let shared = d.join("shared");
    fs::create_dir_all(&shared).unwrap();
    let a = make_vault(&d, "vault-a");
    let src = d.join("big.png");
    let original = vec![9u8; 1024 * 1024 + 11];
    fs::write(&src, &original).unwrap();
    let id = sha256_file(&src).unwrap();
    // 压缩版入库：内容不同、小得多（模式 B 的正文引用就是它）
    let stored_rel = "image-compressed.webp";
    fs::write(Path::new(&a).join(stored_rel), vec![1u8; 4096]).unwrap();
    let mut ledger = read_assets_ledger(&a).unwrap();
    ledger["entries"].as_array_mut().unwrap().push(json!({
      "id": id.clone(),
      "original": src.to_string_lossy(),
      "size": original.len(),
      "storedInVault": stored_rel,
      "storedSize": 4096,
      "preview": null,
      "devices": {},
    }));
    write_assets_ledger(&a, &ledger).unwrap();
    set_local_backend(&a, &shared);

    let payload =
      tauri::async_runtime::block_on(asset_relay_upload(a.clone(), vec![id.clone()])).unwrap();
    assert_eq!(payload["uploaded"], 1, "模式 B 上传原图应成功：{payload}");
    let hash16 = hash16_of(&id).unwrap();
    let staged = shared.join(STAGING_DIR).join(&hash16).join("big.png");
    assert_eq!(
      fs::read(&staged).unwrap(),
      original,
      "云端副本必须是原图，不能是压缩版"
    );
  }

  #[test]
  fn land_rejects_tampered_remote_file() {    let d = tmpdir("tampered");
    let shared = d.join("shared");
    fs::create_dir_all(&shared).unwrap();
    let a = make_vault(&d, "vault-a");
    let b = make_vault(&d, "vault-b");
    let src = d.join("clip.mp4");
    fs::write(&src, vec![5u8; 1024 * 1024 + 1]).unwrap();
    let id = sha256_file(&src).unwrap();
    seed_ledger(&a, &src.to_string_lossy().to_string(), 1024 * 1024 + 1, &id);
    seed_ledger(&b, &src.to_string_lossy().to_string(), 1024 * 1024 + 1, &id);
    set_local_backend(&a, &shared);
    set_local_backend(&b, &shared);

    tauri::async_runtime::block_on(asset_relay_upload(a.clone(), vec![id.clone()])).unwrap();
    // 篡改云端副本
    let hash16 = hash16_of(&id).unwrap();
    fs::write(shared.join(STAGING_DIR).join(&hash16).join("clip.mp4"), b"bad").unwrap();

    let payload =
      tauri::async_runtime::block_on(asset_relay_land(b.clone(), vec![id.clone()])).unwrap();
    assert_eq!(payload["landed"], 0);
    let msg = payload["items"][0]["error"].as_str().unwrap().to_string();
    assert!(msg.contains("内容不对"), "sha 不符要明确报错：{msg}");
    // 坏文件不能留在落地目录
    assert!(
      !Path::new(&b)
        .join(ASSETS_DIR)
        .join(EXTERNAL_DIR)
        .join(format!("{}-clip.mp4", &hash16[..8]))
        .exists(),
      "校验失败的文件必须丢弃"
    );
  }

  #[test]
  fn pending_lists_ledger_entries_with_local_state() {
    let d = tmpdir("pending");
    let a = make_vault(&d, "vault-a");
    let present = d.join("here.mp4");
    fs::write(&present, vec![1u8; 1024 * 1024 + 1]).unwrap();
    let id = sha256_file(&present).unwrap();
    seed_ledger(&a, &present.to_string_lossy().to_string(), 1024 * 1024 + 1, &id);
    let gone_id = format!("sha256:{}", "cd".repeat(32));
    seed_ledger(&a, &d.join("gone.mp4").to_string_lossy().to_string(), 2_000_000, &gone_id);

    let out = asset_relay_pending(a.clone()).unwrap();
    let items = out["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["exists"], true);
    assert_eq!(items[1]["exists"], false);
    assert!(!out["deviceId"].as_str().unwrap().is_empty());
  }

  #[test]
  fn cleanup_keeps_unacked_files() {
    let d = tmpdir("keep");
    let shared = d.join("shared");
    fs::create_dir_all(&shared).unwrap();
    let a = make_vault(&d, "vault-a");
    let src = d.join("clip.mp4");
    fs::write(&src, vec![1u8; 1024 * 1024 + 1]).unwrap();
    let id = sha256_file(&src).unwrap();
    seed_ledger(&a, &src.to_string_lossy().to_string(), 1024 * 1024 + 1, &id);
    set_local_backend(&a, &shared);

    tauri::async_runtime::block_on(asset_relay_upload(a.clone(), vec![id.clone()])).unwrap();
    let clean = tauri::async_runtime::block_on(asset_relay_cleanup(a.clone())).unwrap();
    assert_eq!(clean["cleaned"], 0, "没有 ack 的不能删");
    assert_eq!(clean["kept"], 1);
    let hash16 = hash16_of(&id).unwrap();
    assert!(shared.join(STAGING_DIR).join(&hash16).is_dir());
  }

  #[test]
  fn relink_rewrites_three_reference_forms() {
    let d = tmpdir("relink");
    let a = make_vault(&d, "vault-a");
    let from = "D:/media/clip 1.mp4";
    let to = "external/abcd1234-clip_1.mp4";
    fs::write(
      Path::new(&a).join("note.md"),
      format!(
        "a ![](D:/media/clip 1.mp4) b ![](<D:/media/clip 1.mp4>) c ![](D:/media/clip%201.mp4)\n"
      ),
    )
    .unwrap();
    let out = asset_relay_relink(a.clone(), from.to_string(), to.to_string()).unwrap();
    assert_eq!(out["changedNotes"], 1);
    assert_eq!(out["hits"], 3);
    let text = fs::read_to_string(Path::new(&a).join("note.md")).unwrap();
    // 落点没有空白 / 括号 ⇒ 不加尖括号（CommonMark 只在需要时用尖括号）
    assert!(
      text.contains("![](external/abcd1234-clip_1.mp4)"),
      "落点是不需要尖括号的相对路径：{text}"
    );
    assert!(!text.contains("D:/media/clip"), "原路径应全部替换：{text}");
  }

  #[test]
  fn sanitize_name_blocks_traversal() {
    assert_eq!(sanitize_name("a/b/c.mp4"), "c.mp4");
    assert_eq!(sanitize_name("..hidden.mp4"), "hidden.mp4");
    assert_eq!(sanitize_name("a:b*c?.mp4"), "a_b_c_.mp4");
    assert_eq!(sanitize_name(""), "file");
  }

  #[test]
  fn percent_decode_handles_utf8_and_plain() {
    assert_eq!(percent_decode("a%20b.mp4"), "a b.mp4");
    assert_eq!(percent_decode("%E4%B8%AD%E6%96%87.mp4"), "中文.mp4");
    assert_eq!(percent_decode("plain.mp4"), "plain.mp4");
    assert_eq!(percent_decode("%zz"), "%zz");
  }
}
