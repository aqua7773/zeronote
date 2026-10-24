// ZeroNote 内核（Rust 侧）—— 网络 / 凭据原语（rev173.106）
//
// 为什么请求必须在 Rust 侧发（不是 WebView 里的 fetch）：
//   WebDAV 用自定义方法（PROPFIND / MKCOL / MOVE）与非简单头，浏览器必然先发 CORS
//   preflight（OPTIONS）。服务器不回 CORS 头 ⇒ 前端只能看到 `TypeError: Failed to fetch`，
//   分不清「CORS 被拒 / 断网 / 401」。Rust 侧没有 CORS 概念，拿得到真实状态码。
//   依据：`docs/同步插件-调研与方案-2026-10-24.md` §3 缺口 1、§4.5。
//
// 这里**只做搬运**：不认 WebDAV、不认同步语义，协议全在插件里。

use std::collections::BTreeMap;
use std::time::Duration;

use base64::Engine as _;
use serde::{Deserialize, Serialize};

/// 单次响应体上限 64 MB —— 同步的是笔记与附件，超过当错误返回（不静默截断）。
const MAX_BODY_BYTES: usize = 64 * 1024 * 1024;

/// 默认超时。坚果云 / Nextcloud 偶发 3–5 秒才回 PROPFIND，留足余量。
const DEFAULT_TIMEOUT_MS: u64 = 30_000;
/// 超时上下限：太短会把慢服务器误判成失败，太长会把界面吊死。
const MIN_TIMEOUT_MS: u64 = 1_000;
const MAX_TIMEOUT_MS: u64 = 120_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetRequest {
  url: String,
  /// 默认 GET。WebDAV 的 PROPFIND / MKCOL / MOVE 都从这里进。
  #[serde(default)]
  method: Option<String>,
  #[serde(default)]
  headers: Option<BTreeMap<String, String>>,
  /// 请求体 base64 —— 文本也走它，前端统一 encode，避免「文本 / 二进制」两条路。
  #[serde(default)]
  body_b64: Option<String>,
  #[serde(default)]
  timeout_ms: Option<u64>,
}

#[derive(Serialize)]
pub struct NetResponse {
  status: u16,
  /// 响应头（键为原始小写名字）。重复头用 `, ` 合并 —— WebDAV 关心的
  /// `ETag` / `Last-Modified` / `DAV` 都是单值，合并不影响判断。
  headers: BTreeMap<String, String>,
  body_b64: String,
}

/// 发一次 HTTP 请求。成功与否只看「请求有没有发出去」，HTTP 错误码（401/404/500）
/// 一律走 `Ok(status)` —— 调用方要能读到 `WWW-Authenticate` 这类头来判断怎么重试。
#[tauri::command]
pub async fn net_request(req: NetRequest) -> Result<NetResponse, String> {
  let method_name = req.method.unwrap_or_else(|| "GET".to_string());
  let method = reqwest::Method::from_bytes(method_name.as_bytes())
    .map_err(|e| format!("HTTP 方法不合法（{method_name}）：{e}"))?;

  let timeout = req
    .timeout_ms
    .unwrap_or(DEFAULT_TIMEOUT_MS)
    .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);

  let client = reqwest::Client::builder()
    .timeout(Duration::from_millis(timeout))
    // 有些 WebDAV 服务端（如旧版 Nextcloud 反代）会拒空 UA。
    .user_agent(concat!("ZeroNote/", env!("CARGO_PKG_VERSION")))
    .build()
    .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))?;

  let url = req.url;
  let mut rb = client.request(method, &url);
  for (k, v) in req.headers.unwrap_or_default() {
    rb = rb.header(k, v);
  }
  if let Some(b64) = req.body_b64 {
    let bytes = base64::engine::general_purpose::STANDARD
      .decode(b64.as_bytes())
      .map_err(|e| format!("请求体不是合法 base64：{e}"))?;
    rb = rb.body(bytes);
  }

  let resp = rb.send().await.map_err(|e| {
    // 分类给出「人能懂的原因」—— 笼统的 request failed 在同步排障里毫无用处。
    if e.is_timeout() {
      format!("请求超时（{timeout} ms）：{url}")
    } else if e.is_connect() {
      format!("连不上服务器（地址 / 端口 / 证书 / DNS 之一）：{url} —— {e}")
    } else if e.is_decode() || e.is_body() {
      format!("响应读取失败：{url} —— {e}")
    } else {
      format!("请求失败：{url} —— {e}")
    }
  })?;

  let status = resp.status().as_u16();

  // 先按声明长度拦一道，避免把超大响应整个读进内存
  if let Some(len) = resp.content_length() {
    if len > MAX_BODY_BYTES as u64 {
      return Err(format!("响应体过大（{len} 字节，上限 {MAX_BODY_BYTES}）：{url}"));
    }
  }

  let mut headers = BTreeMap::new();
  for (k, v) in resp.headers().iter() {
    let name = k.as_str().to_string();
    let value = v.to_str().unwrap_or("").to_string();
    headers
      .entry(name)
      .and_modify(|old: &mut String| {
        old.push_str(", ");
        old.push_str(&value);
      })
      .or_insert(value);
  }

  let bytes = resp
    .bytes()
    .await
    .map_err(|e| format!("读取响应体失败：{url} —— {e}"))?;
  if bytes.len() > MAX_BODY_BYTES {
    return Err(format!("响应体过大（{} 字节，上限 {MAX_BODY_BYTES}）：{url}", bytes.len()));
  }

  Ok(NetResponse {
    status,
    headers,
    body_b64: base64::engine::general_purpose::STANDARD.encode(&bytes),
  })
}

/* ───────────── 系统凭据库（同步插件的账号密码 · rev173.106） ───────────── */

/// 凭据的 service 名 = bundle identifier。
///
/// 用 identifier 而不是自定义字符串：Windows 凭据管理器里会显示成
/// `com.aqua.zeronote`，用户要清理时找得到；换 App identifier 也不会串。
const SECRET_SERVICE: &str = "com.aqua.zeronote";

fn secret_store() -> tauri_plugin_keyring_store::KeyringStore {
  // `new` 是纯结构体构造（首次读写才碰系统库），不缓存也无所谓开销
  tauri_plugin_keyring_store::KeyringStore::new(SECRET_SERVICE)
}

/// 读一条凭据。**没存过 ⇒ `Ok(None)`**（不是报错）—— 插件靠这个判断「还没配置」。
#[tauri::command]
pub fn secret_get(account: String) -> Result<Option<String>, String> {
  secret_store()
    .get_password(&account)
    .map_err(|e| format!("读取系统凭据失败（{account}）：{e}"))
}

/// 写一条凭据（同名覆盖）。
#[tauri::command]
pub fn secret_set(account: String, secret: String) -> Result<(), String> {
  secret_store()
    .set_password(&account, &secret)
    .map_err(|e| format!("写入系统凭据失败（{account}）：{e}"))
}

/// 删一条凭据。**不存在也算成功**（幂等）—— 同步插件「断开连接」不该失败。
#[tauri::command]
pub fn secret_delete(account: String) -> Result<(), String> {
  match secret_store().delete(&account) {
    Ok(()) => Ok(()),
    // 各平台对「删不存在的条目」返回的错误文案不一致，这里不猜错误码，
    // 用「读一次确认它确实不在」来判断：不在就是幂等成功。
    Err(_) => match secret_store().get_password(&account) {
      Ok(None) => Ok(()),
      _ => Err(format!("删除系统凭据失败（{account}）")),
    },
  }
}
