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

/// 插件包（`.znp`）的大小上限（rev173.148）。现有 13 个官方包 0.7 KB – 80 KB；
/// 8 MB 是「明显不对」的界线 —— 撞上它说明下载到的不是插件包（HTML 错误页 / 别的大文件）。
pub const MAX_PLUGIN_PACK_BYTES: usize = 8 * 1024 * 1024;

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

/// 装上 rustls 的 crypto provider —— **仅 Android 需要**，但少了它整个 App 起不来。
///
/// 为什么：`Cargo.toml` 在 Android 上给 reqwest 选的是 `rustls-no-provider`（要避开 OpenSSL），
/// 而 rustls 0.23 起默认**不带** provider —— 不装就直接在 `Client::builder().build()` 里
/// `panic!("No rustls crypto provider is configured")`（2026-10-24 真机实测：SIGABRT，
/// 崩溃点还在 `onFirstActivityCreate`，看上去像启动就挂）。
///
/// **必须在 `run()` 的最开头调**（不是等第一次 `net_request`）：启动阶段有可能已经有
/// 别的东西建 Client，那时再装就晚了 —— 实测只在命令里装，App 仍然启动即崩。
///
/// 桌面走 native-tls，`cfg` 掉，不会把 rustls 拉进桌面依赖。
pub fn ensure_tls_provider() {
  #[cfg(target_os = "android")]
  {
    use std::sync::Once;
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
      // 重复装会返回 Err，忽略即可（进程内只成功一次）
      match rustls::crypto::ring::default_provider().install_default() {
        Ok(()) => println!("[net] rustls ring provider installed"),
        Err(_) => println!("[net] rustls provider already configured"),
      }
    });
  }
}

/// 建一个 HTTP 客户端（统一超时 / UA / Android 根证书）。
///
/// **pub 出来是因为插件包下载也用同一个**（`lib.rs` 的 `install_znp_from_url`）。
/// 两处各写一份的话，下面 Android 那段「必须自己给根证书」的修法一定会漏在第二处 ——
/// 表现是「手机上下载插件永远 pending」，而且和同步时的症状一模一样、极难认。
pub fn http_client(timeout_ms: u64) -> Result<reqwest::Client, String> {
  build_client(timeout_ms, false)
}

/**
 * **不跟随系统代理**的客户端（rev173.306）。
 *
 * 为什么得有：`tauri-plugin-updater` 在 Cargo.toml 里打开了 reqwest 的 `system-proxy` feature，
 * 而 Cargo 的特性是**全局合并**的 —— 于是本文件建的 client 也会读系统代理
 * （`cargo tree -e features -i reqwest` 可复现：`reqwest feature "system-proxy"` ←
 * `tauri-plugin-updater feature "system-proxy"`）。后果两件：
 * ① 本地回环 / 局域网请求被代理吞掉 —— `cargo test --lib` 的 net 测试因此**挂死**（桩 accept 不到），
 *    同步插件的本地 DAV 桩一个请求也收不到；
 * ② 系统代理「开着但不可用」时（例如只关了加速器、代理进程还在监听），整个应用断网。
 *
 * 所以：loopback / 私网请求一律走这个，公网请求仍用 `http_client`（跟随系统代理）。
 */
pub fn http_client_direct(timeout_ms: u64) -> Result<reqwest::Client, String> {
  build_client(timeout_ms, true)
}

fn build_client(timeout_ms: u64, direct: bool) -> Result<reqwest::Client, String> {
  let timeout = timeout_ms.clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);

  // 桌面上 `mut` 用不到（只有 Android 的 cfg 段会改它），但去掉会让 Android 编译不过
  #[allow(unused_mut)]
  let mut cb = reqwest::Client::builder()
    .timeout(Duration::from_millis(timeout))
    // 有些 WebDAV 服务端（如旧版 Nextcloud 反代）会拒空 UA。
    .user_agent(concat!("ZeroNote/", env!("CARGO_PKG_VERSION")));

  if direct {
    cb = cb.no_proxy();
  }

  /**
   * **Android 上必须自己给根证书**（rev173.108 真机实测）。
   *
   * `rustls-no-provider` 默认的证书验证器是 `rustls-platform-verifier`，它要经 JNI 调
   * Android 的 TrustManager；Tauri 没替我们初始化它 ⇒ **HTTPS 请求永远 pending**
   * （实测：`http://www.baidu.com` 200，`https://www.baidu.com` 挂死，连 `timeout` 都不触发）。
   *
   * 改用内置的 Mozilla 根证书（`webpki-roots`）：不依赖平台验证器，两端行为一致。
   * 代价是系统自定义的根证书（企业代理 / 抓包工具）不会被信任 —— 对自用笔记应用可接受。
   */
  #[cfg(target_os = "android")]
  {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = rustls::ClientConfig::builder()
      .with_root_certificates(roots)
      .with_no_client_auth();
    cb = cb.use_preconfigured_tls(tls);
  }

  cb.build()
    .map_err(|e| format!("初始化 HTTP 客户端失败：{e}"))
}

/// 按 URL 挑客户端：本机 / 内网 ⇒ 直连（别让系统代理吞掉），其余 ⇒ 跟随系统代理
pub fn client_for_url(url: &str, timeout_ms: u64) -> Result<reqwest::Client, String> {
  if is_local_url(url) {
    http_client_direct(timeout_ms)
  } else {
    http_client(timeout_ms)
  }
}

/// 是不是「本机 / 内网」地址（loopback · 私网段 · 链路本地 · `.local`）
pub fn is_local_url(raw: &str) -> bool {
  let host = match reqwest::Url::parse(raw)
    .ok()
    .and_then(|u| u.host_str().map(str::to_string))
  {
    Some(h) => h,
    None => return false,
  };
  is_local_host(&host)
}

fn is_local_host(host: &str) -> bool {
  let h = host.trim_start_matches('[').trim_end_matches(']');
  if h.eq_ignore_ascii_case("localhost") || h == "::1" || h.ends_with(".local") {
    return true;
  }
  if h.starts_with("127.")
    || h.starts_with("10.")
    || h.starts_with("192.168.")
    || h.starts_with("169.254.")
  {
    return true;
  }
  // 172.16.0.0/12
  if let Some(rest) = h.strip_prefix("172.") {
    if let Ok(n) = rest.split('.').next().unwrap_or("").parse::<u8>() {
      return (16..=31).contains(&n);
    }
  }
  false
}

/**
 * 大文件下载用的客户端（rev173.292 · 应用本体更新）。
 *
 * 为什么不复用 `http_client`：它的超时是 reqwest 的**整体**超时（连接 + 读完 body），
 * 上限 120 秒（`MAX_TIMEOUT_MS`）—— APK 几十 MB，手机流量下 120 秒必然被截断，
 * 表现为「下载到最后一段总是失败」。
 *
 * 这里只限制**连接**阶段，读完 body 的时间由调用方自己的分块循环掌握
 * （块与块之间可以报进度、也可以判断「卡住」）。TLS 配置与 `http_client` 完全一致 ——
 * 道理同上面那段注释：两处各写一份，Android 的根证书修法一定会漏。
 *
 * 目前只有 Android 的 APK 下载用它（桌面走 `tauri-plugin-updater`，下载在插件内部）。
 */
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub fn download_client() -> Result<reqwest::Client, String> {
  // 桌面上 `mut` 用不到（只有 Android 的 cfg 段会改它）
  #[allow(unused_mut)]
  let mut cb = reqwest::Client::builder()
    .connect_timeout(Duration::from_secs(20))
    .user_agent(concat!("ZeroNote/", env!("CARGO_PKG_VERSION")));

  #[cfg(target_os = "android")]
  {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = rustls::ClientConfig::builder()
      .with_root_certificates(roots)
      .with_no_client_auth();
    cb = cb.use_preconfigured_tls(tls);
  }

  cb.build()
    .map_err(|e| format!("初始化下载客户端失败：{e}"))
}

/// 发一次 HTTP 请求。成功与否只看「请求有没有发出去」，HTTP 错误码（401/404/500）
/// 一律走 `Ok(status)` —— 调用方要能读到 `WWW-Authenticate` 这类头来判断怎么重试。
#[tauri::command]
pub async fn net_request(req: NetRequest) -> Result<NetResponse, String> {
  ensure_tls_provider();
  let method_name = req.method.unwrap_or_else(|| "GET".to_string());
  let method = reqwest::Method::from_bytes(method_name.as_bytes())
    .map_err(|e| format!("HTTP 方法不合法（{method_name}）：{e}"))?;

  let timeout = req
    .timeout_ms
    .unwrap_or(DEFAULT_TIMEOUT_MS)
    .clamp(MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);

  let url = req.url;
  // 本机 / 内网直接绕开系统代理（rev173.306），公网跟随它
  let client = client_for_url(&url, timeout)?;

  let headers: Vec<(String, String)> = req.headers.unwrap_or_default().into_iter().collect();
  let body: Option<Vec<u8>> = match req.body_b64 {
    Some(b64) => Some(
      base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| format!("请求体不是合法 base64：{e}"))?,
    ),
    None => None,
  };

  let make = |c: &reqwest::Client| {
    let mut rb = c.request(method.clone(), &url);
    for (k, v) in &headers {
      rb = rb.header(k.as_str(), v.as_str());
    }
    if let Some(bytes) = &body {
      // 显式带 Content-Length（**含 0**）。
      //
      // reqwest 对 `Vec::new()` 不发 CL、也不发 Transfer-Encoding —— 2026-10-25 抓包实测
      // `cl=null te=null bytes=0`；rclone `serve s3` 对没有长度的 PUT 回 411 Length Required，
      // 表现为「同步到一篇空笔记就永远卡住、每 5 秒重试同一篇」。
      // 长度与实际 body 一致，reqwest 发送阶段不会拒绝。
      rb = rb
        .body(bytes.clone())
        .header(reqwest::header::CONTENT_LENGTH, bytes.len().to_string());
    }
    rb
  };

  let mut attempt = make(&client).send().await;
  /**
   * 代理「开着但不可用」时（只关了加速器、代理进程还在监听），公网请求会直接失败 ——
   * 换直连再试一次（rev173.306）。这正是 2026-10-31 用户「关掉代理后所有渠道都显示
   * 安装包不可达」的场景：应用全走系统代理，而代理已经不转发。
   * 本机地址本来就用直连 client，不重复试。
   */
  if attempt.is_err() && !is_local_url(&url) {
    if let Ok(direct) = http_client_direct(timeout) {
      attempt = make(&direct).send().await;
    }
  }

  let resp = attempt.map_err(|e| {
    // 把**错误源链**一起打出来（rev173.192 真机排障需要）。
    // reqwest 的 Display 只有「error sending request for url」，真正原因（DNS / TCP / TLS / 证书）
    // 全在 source 链里 —— 排障时没有它等于没信息。桌面与 Android 走的 TLS 栈不同
    // （桌面 native-tls / Android rustls+webpki-roots），同一个 URL 两端表现可以完全不同。
    let mut chain = String::new();
    let mut cur = std::error::Error::source(&e);
    while let Some(s) = cur {
      chain.push_str(&format!(" ← {s}"));
      cur = std::error::Error::source(s);
    }
    // 分类给出「人能懂的原因」—— 笼统的 request failed 在同步排障里毫无用处。
    if e.is_timeout() {
      format!("请求超时（{timeout} ms）：{url}{chain}")
    } else if e.is_connect() {
      format!("连不上服务器（地址 / 端口 / 证书 / DNS 之一）：{url} —— {e}{chain}")
    } else if e.is_decode() || e.is_body() {
      format!("响应读取失败：{url} —— {e}{chain}")
    } else {
      format!("请求失败：{url} —— {e}{chain}")
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

/* ───────────── 请求头回归（rev173.132） ───────────── */

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{Read, Write};

  /// 起一个只接一次的本地 HTTP 服务器；返回 (URL, 服务器线程)。
  /// 服务器线程读出完整请求头后回 200，并把**收到的请求**交回来。
  fn capture_one_request() -> (String, std::thread::JoinHandle<String>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("绑定本地端口");
    let addr = listener.local_addr().expect("取端口");
    let handle = std::thread::spawn(move || {
      let (mut sock, _) = listener.accept().expect("接受连接");
      let mut buf = Vec::new();
      let mut tmp = [0u8; 1024];
      loop {
        match sock.read(&mut tmp) {
          Ok(0) | Err(_) => break,
          Ok(n) => buf.extend_from_slice(&tmp[..n]),
        }
        if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16_384 {
          break;
        }
      }
      let _ = sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
      String::from_utf8_lossy(&buf).to_string()
    });
    (format!("http://{addr}/probe"), handle)
  }

  fn put(body_b64: &str) -> (NetResponse, String) {
    let (url, handle) = capture_one_request();
    let resp = tauri::async_runtime::block_on(net_request(NetRequest {
      url,
      method: Some("PUT".into()),
      headers: None,
      body_b64: Some(body_b64.to_string()),
      timeout_ms: Some(5_000),
    }))
    .expect("请求应成功");
    (resp, handle.join().expect("服务器线程"))
  }

  /// 根因回归：reqwest 对空 body 默认**既不发 Content-Length 也不发 Transfer-Encoding**，
  /// S3 兼容服务（rclone）会回 411。空笔记同步不上就是这么来的（rev173.131）。
  #[test]
  fn empty_body_carries_content_length_zero() {
    let (resp, req) = put("");
    assert_eq!(resp.status, 200);
    let lower = req.to_lowercase();
    assert!(
      lower.contains("content-length: 0"),
      "空 body 的 PUT 必须带 Content-Length: 0，实际请求：{req}"
    );
  }

  /// 非空 body 走 reqwest 自己的长度（这里不重复添加），只确认长度正确。
  #[test]
  fn non_empty_body_carries_matching_content_length() {
    let (resp, req) = put("eA=="); // base64("x")
    assert_eq!(resp.status, 200);
    let lower = req.to_lowercase();
    assert!(
      lower.contains("content-length: 1"),
      "非空 body 应带 Content-Length: 1，实际请求：{req}"
    );
  }

  /// 本机 / 内网判定（rev173.306）：这些地址必须走**直连**客户端，
  /// 否则系统代理（Steam++）会把它们吞掉 —— 本地 DAV 桩收不到请求、net 测试挂死。
  #[test]
  fn local_urls_are_detected() {
    for u in [
      "http://127.0.0.1:8899/dav/",
      "http://localhost:1420/",
      "http://192.168.1.5:8080/x",
      "http://10.0.0.7/x",
      "http://172.16.0.1/x",
      "http://172.31.255.1/x",
      "http://[::1]:9000/x",
      "http://nas.local/x",
    ] {
      assert!(is_local_url(u), "{u} 应判为本机/内网");
    }
    for u in [
      "https://github.com/aqua7773/zeronote",
      "https://ghproxy.net/https://github.com/a/x",
      "http://172.32.0.1/x",
      "https://example.com/127.0.0.1",
    ] {
      assert!(!is_local_url(u), "{u} 不应判为本机");
    }
  }
}
