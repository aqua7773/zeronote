// ZeroNote 内核（Rust 侧）—— 本地媒体 HTTP 服务（rev173.240）
//
// 为什么需要它（Android 上大视频播不了 —— rev173.238 手机实测记录，tauri#12019）：
//
//   Tauri 的 asset 协议在**桌面**走 Rust 的 HTTP 响应器
//   （`tauri-2.12.3/src/protocol/asset.rs`：解析 `Range` 头 → 206 + `Content-Range`，
//   单段最多 1000 KiB、多段走 `multipart/byteranges`），所以桌面 `<video>` 能随便 seek。
//
//   但在 **Android** 上，asset 协议走的是 wry 的 `RustWebViewClient.shouldInterceptRequest`
//   （`wry-0.55.1/src/android/kotlin/RustWebViewClient.kt:26`）：那个 API 只能返回一个
//   完整的 `WebResourceResponse`，**没有 206 分片**。大文件播放器必须先拿到
//   `Content-Range` 才能决定能否流式播放 ⇒ `readyState` 永远停在 0
//   （实测：1.4 MB MP3 与 11 KB 小视频正常，几 MB 的 mp4 `networkState=2 / buffered=0`、等 12 秒零字节）。
//
// 对策：在 `127.0.0.1` 上起一个**只读、只服务音视频、带 Range** 的小服务；
//   前端在 Android 上把 `<video src>` / `<audio src>` 指向它，桌面继续用 asset 协议
//   （桌面本来就支持 Range，没必要多一跳 HTTP）。
//
// 安全边界（这个服务只有本机进程能连，但仍然当作"暴露面"处理）：
//   · 只绑 `127.0.0.1`，随机端口；
//   · URL 里带一次性随机 token（启动时生成，进程内不变）—— 别的 App 扫不到端口也猜不到 token；
//   · 只允许读**白名单媒体扩展名**（与内核 `MEDIA_EXTS` 同一份），不看目录；
//   · 只实现 GET / HEAD，其他方法一律 405。
//
// 不引入 HTTP 框架：播放器只会发 `GET` + `Range: bytes=…` 这一种请求，
// 手写 200 行比拉 hyper server + hyper-util 更容易审，也不增加编译量与 Android 交叉编译风险。

use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;

use crate::MEDIA_EXTS;

/// URL 形态：`/m/<token>/<percent-encoded 绝对路径>`
const PATH_PREFIX: &str = "/m/";
/// 请求头上限 —— 播放器实际只发几百字节，超过就是异常流量
const MAX_HEAD_BYTES: usize = 16 * 1024;
/// 单次响应最多发的字节数（与 tauri 桌面 asset 协议同口径：1000 KiB）。
/// 播放器会接着请求下一段 —— 这是 HTTP Range 的正常用法，不是"截断错误"。
const MAX_RANGE_LEN: u64 = 1000 * 1024;
/// 连接读超时：一条请求最多给 10 秒，防止僵尸连接占线程
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// `(port, token)` —— 进程内只起一次（`OnceLock`）
static INFO: OnceLock<(u16, String)> = OnceLock::new();

/// 起服务（幂等）。返回 `(port, token)`，前端据此拼媒体 URL。
pub fn ensure_started() -> Result<(u16, String), String> {
  if let Some(v) = INFO.get() {
    return Ok(v.clone());
  }
  let listener =
    TcpListener::bind("127.0.0.1:0").map_err(|e| format!("无法绑定本机端口（媒体服务）：{e}"))?;
  let port = listener
    .local_addr()
    .map_err(|e| format!("读取媒体服务端口失败：{e}"))?
    .port();
  let token = gen_token();
  let info = (port, token.clone());
  if INFO.set(info.clone()).is_err() {
    // 并发首调：另一条路已经启动过，用它的
    return Ok(INFO.get().cloned().unwrap_or(info));
  }
  let thread_token = token;
  std::thread::Builder::new()
    .name("zn-media-server".into())
    .spawn(move || {
      for conn in listener.incoming() {
        match conn {
          Ok(stream) => {
            let token = thread_token.clone();
            // 每条连接一个线程：视频 seek 会并发发多个 range 请求，串行会让拖动卡住
            let _ = std::thread::Builder::new()
              .name("zn-media-conn".into())
              .spawn(move || {
                if let Err(e) = handle(stream, &token) {
                  log::debug!("媒体服务连接结束：{e}");
                }
              });
          }
          Err(e) => log::warn!("媒体服务 accept 失败：{e}"),
        }
      }
    })
    .map_err(|e| format!("无法启动媒体服务线程：{e}"))?;
  Ok(info)
}

/// 已启动时的 `(port, token)`；没启动过 ⇒ None（前端据此决定用不用它）
pub fn info() -> Option<(u16, String)> {
  INFO.get().cloned()
}

/// 一次性随机 token（不引入 rand：与 device-id 同款混时间 + pid + 栈地址）
fn gen_token() -> String {
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
  format!("{:016x}{:016x}", h.finish(), h.finish().wrapping_mul(0x9E37_79B9_7F4A_7C15))
}

struct Head {
  method: String,
  target: String,
  range: Option<String>,
}

fn handle(mut stream: TcpStream, token: &str) -> std::io::Result<()> {
  stream.set_read_timeout(Some(READ_TIMEOUT))?;
  stream.set_nodelay(true)?;
  let mut reader = BufReader::new(stream.try_clone()?);
  let head = read_head(&mut reader)?;
  let Some(head) = head else {
    return Ok(());
  };

  if head.method == "OPTIONS" {
    return respond_empty(&mut stream, 204, &[("Access-Control-Allow-Origin", "*")]);
  }
  if head.method != "GET" && head.method != "HEAD" {
    return respond_text(&mut stream, 405, "只支持 GET / HEAD");
  }

  let rest = match head.target.strip_prefix(PATH_PREFIX) {
    Some(r) => r,
    None => return respond_text(&mut stream, 404, "not found"),
  };
  // `<token>/<path>`
  let Some((got_token, raw_path)) = rest.split_once('/') else {
    return respond_text(&mut stream, 404, "not found");
  };
  if got_token != token {
    return respond_text(&mut stream, 403, "forbidden");
  }
  let decoded = percent_decode(raw_path);
  let Some(path) = media_path(&decoded) else {
    return respond_text(&mut stream, 403, "不是可播放的音视频文件");
  };
  let len = match std::fs::metadata(&path) {
    Ok(m) if m.is_file() => m.len(),
    _ => return respond_text(&mut stream, 404, "文件不存在"),
  };

  let mime = mime_of(&path);
  match head.range.as_deref().map(|r| parse_range(r, len)) {
    Some(Err(())) => {
      // 416：回 `Content-Range: bytes */len`，播放器据此知道总长度
      let unsat = format!("bytes */{len}");
      return respond_empty(
        &mut stream,
        416,
        &[
          ("Accept-Ranges", "bytes"),
          ("Content-Range", unsat.as_str()),
        ],
      );
    }
    Some(Ok((start, end))) => {
      let end = start + (end - start).min(MAX_RANGE_LEN.saturating_sub(1));
      let n = end - start + 1;
      let mut f = std::fs::File::open(&path)?;
      f.seek(SeekFrom::Start(start))?;
      let mut buf = vec![0u8; n as usize];
      let mut read = 0usize;
      while read < buf.len() {
        match f.read(&mut buf[read..])? {
          0 => break,
          k => read += k,
        }
      }
      buf.truncate(read);
      let content_range = format!(
        "bytes {start}-{}/{len}",
        start + (read as u64).saturating_sub(1)
      );
      let content_len = buf.len().to_string();
      let headers = vec![
        ("Content-Type", mime.as_str()),
        ("Content-Length", content_len.as_str()),
        ("Accept-Ranges", "bytes"),
        ("Content-Range", content_range.as_str()),
        ("Cache-Control", "no-store"),
      ];
      return write_response(&mut stream, 206, &headers, if head.method == "HEAD" { &[] } else { &buf });
    }
    None => {}
  }

  // 没有 Range：整段 200（小文件 / 音频通常会走这条）
  let mut buf = Vec::with_capacity(len as usize);
  std::fs::File::open(&path)?.read_to_end(&mut buf)?;
  let content_len = buf.len().to_string();
  let headers = vec![
    ("Content-Type", mime.as_str()),
    ("Content-Length", content_len.as_str()),
    ("Accept-Ranges", "bytes"),
    ("Cache-Control", "no-store"),
  ];
  write_response(&mut stream, 200, &headers, if head.method == "HEAD" { &[] } else { &buf })
}

fn read_head(reader: &mut BufReader<TcpStream>) -> std::io::Result<Option<Head>> {
  let mut request_line = String::new();
  if reader.read_line(&mut request_line)? == 0 {
    return Ok(None); // 空连接（端口探测 / 连接被提前关掉）
  }
  let mut parts = request_line.split_whitespace();
  let method = parts.next().unwrap_or_default().to_string();
  let target = parts.next().unwrap_or_default().to_string();
  let mut range = None;
  let mut total = request_line.len();
  loop {
    let mut line = String::new();
    let n = reader.read_line(&mut line)?;
    if n == 0 {
      break;
    }
    total += n;
    if total > MAX_HEAD_BYTES {
      return Ok(None);
    }
    if line == "\r\n" || line == "\n" {
      break;
    }
    if let Some((k, v)) = line.split_once(':') {
      if k.eq_ignore_ascii_case("range") {
        range = Some(v.trim().to_string());
      }
    }
  }
  Ok(Some(Head {
    method,
    target,
    range,
  }))
}

/// `bytes=start-end` / `bytes=start-` / `bytes=-N`（多段退化为整段 —— 播放器实际不用）
fn parse_range(header: &str, len: u64) -> Result<(u64, u64), ()> {
  let spec = header
    .strip_prefix("bytes=")
    .or_else(|| header.strip_prefix("BYTES="))
    .ok_or(())?
    .trim();
  if spec.contains(',') {
    return Err(());
  }
  let (a, b) = spec.split_once('-').ok_or(())?;
  if a.is_empty() {
    let n: u64 = b.parse().map_err(|_| ())?;
    if n == 0 || len == 0 {
      return Err(());
    }
    return Ok((len.saturating_sub(n), len - 1));
  }
  let start: u64 = a.parse().map_err(|_| ())?;
  if start >= len {
    return Err(());
  }
  let end = if b.is_empty() {
    len - 1
  } else {
    b.parse::<u64>().map_err(|_| ())?.min(len - 1)
  };
  if end < start {
    return Err(());
  }
  Ok((start, end))
}

/// 只允许白名单媒体扩展名 —— 这个服务不是通用文件服务器
fn media_path(decoded: &str) -> Option<PathBuf> {
  if decoded.contains('\0') {
    return None;
  }
  let p = PathBuf::from(decoded);
  let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("");
  if !MEDIA_EXTS.iter().any(|x| ext.eq_ignore_ascii_case(x)) {
    return None;
  }
  if p.is_file() {
    Some(p)
  } else {
    None
  }
}

fn mime_of(path: &PathBuf) -> String {
  let ext = path
    .extension()
    .and_then(|e| e.to_str())
    .unwrap_or("")
    .to_ascii_lowercase();
  match ext.as_str() {
    "mp4" | "m4v" => "video/mp4",
    "webm" => "video/webm",
    "mov" => "video/quicktime",
    "ogv" => "video/ogg",
    "mp3" => "audio/mpeg",
    "m4a" | "aac" => "audio/mp4",
    "ogg" | "oga" | "opus" => "audio/ogg",
    "wav" => "audio/wav",
    "flac" => "audio/flac",
    "weba" => "audio/webm",
    // 不转码就播不了的那些：照样给一个像样的 MIME，让播放器自己报"不支持"而不是 404
    _ => "application/octet-stream",
  }
  .to_string()
}

/// `%xx` → 字符（与 `assets.rs` 的 relink 解码同一套；非法转义原样保留）
fn percent_decode(s: &str) -> String {
  if !s.contains('%') {
    return s.to_string();
  }
  let bytes = s.as_bytes();
  let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
  let mut i = 0;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("").trim();
      match u8::from_str_radix(hex, 16) {
        Ok(b) => {
          out.push(b);
          i += 3;
          continue;
        }
        Err(_) => {}
      }
    }
    out.push(bytes[i]);
    i += 1;
  }
  String::from_utf8_lossy(&out).to_string()
}

fn write_response(
  stream: &mut TcpStream,
  code: u16,
  headers: &[(&str, &str)],
  body: &[u8],
) -> std::io::Result<()> {
  let mut out = Vec::with_capacity(256 + body.len());
  out.extend_from_slice(format!("HTTP/1.1 {code} {}\r\n", reason(code)).as_bytes());
  out.extend_from_slice(b"Connection: close\r\n");
  for (k, v) in headers {
    out.extend_from_slice(format!("{k}: {v}\r\n").as_bytes());
  }
  out.extend_from_slice(b"\r\n");
  out.extend_from_slice(body);
  stream.write_all(&out)?;
  stream.flush()
}

fn respond_empty(stream: &mut TcpStream, code: u16, headers: &[(&str, &str)]) -> std::io::Result<()> {
  write_response(stream, code, headers, &[])
}

fn respond_text(stream: &mut TcpStream, code: u16, msg: &str) -> std::io::Result<()> {
  write_response(
    stream,
    code,
    &[("Content-Type", "text/plain; charset=utf-8")],
    msg.as_bytes(),
  )
}

fn reason(code: u16) -> &'static str {
  match code {
    200 => "OK",
    204 => "No Content",
    206 => "Partial Content",
    403 => "Forbidden",
    404 => "Not Found",
    405 => "Method Not Allowed",
    416 => "Range Not Satisfiable",
    431 => "Request Header Fields Too Large",
    _ => "OK",
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::io::{Read, Write};

  fn tmpdir(tag: &str) -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
      .join("..")
      .join("_tmp-test");
    let d = root.join(format!("zn-media-{tag}"));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
  }

  #[test]
  fn parse_range_handles_three_forms() {
    assert_eq!(parse_range("bytes=0-99", 1000), Ok((0, 99)));
    assert_eq!(parse_range("bytes=100-", 1000), Ok((100, 999)));
    assert_eq!(parse_range("bytes=-100", 1000), Ok((900, 999)));
    assert_eq!(parse_range("bytes=0-99999", 1000), Ok((0, 999)), "越界 end 夹到 len-1");
    assert_eq!(parse_range("bytes=1000-", 1000), Err(()), "起点越界 ⇒ 416");
    assert_eq!(parse_range("bytes=abc", 1000), Err(()));
    assert_eq!(parse_range("kilobytes=0-1", 1000), Err(()));
  }

  /// 起真实 TCP 连接跑一遍：Range ⇒ 206 + 正确字节；无 Range ⇒ 200；坏 token ⇒ 403
  #[test]
  fn serves_ranges_over_real_tcp() {
    let d = tmpdir("range");
    let f = d.join("clip.mp4");
    let bytes: Vec<u8> = (0..2048u32).map(|i| (i % 251) as u8).collect();
    std::fs::write(&f, &bytes).unwrap();

    let (port, token) = ensure_started().unwrap();
    let enc = f.to_string_lossy().replace('\\', "/");
    // 只编码 `%` 与空格以外没必要 —— 服务端只做 percent_decode，原样字符也能过
    let url_path = format!("/m/{token}/{enc}");

    let req = |extra: &str| -> String {
      let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
      let head = format!("GET {url_path} HTTP/1.1\r\nHost: 127.0.0.1\r\n{extra}\r\n");
      s.write_all(head.as_bytes()).unwrap();
      let mut buf = Vec::new();
      s.read_to_end(&mut buf).unwrap();
      String::from_utf8_lossy(&buf).to_string()
    };

    // 1) 无 Range ⇒ 200 整段
    let full = req("");
    assert!(full.starts_with("HTTP/1.1 200 "), "{full}");
    assert!(full.contains("Accept-Ranges: bytes"), "要声明支持 Range");
    assert!(full.contains(&format!("Content-Length: {}", bytes.len())));

    // 2) 单段 Range ⇒ 206 + Content-Range + 正确字节
    let part = req("Range: bytes=10-19\r\n");
    assert!(part.starts_with("HTTP/1.1 206 "), "{part}");
    assert!(part.contains(&format!("Content-Range: bytes 10-19/{}", bytes.len())), "{part}");
    let body = part.split("\r\n\r\n").nth(1).unwrap().as_bytes();
    assert_eq!(body, &bytes[10..20]);

    // 3) HEAD ⇒ 有头无体
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.write_all(format!("HEAD {url_path} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes())
      .unwrap();
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).unwrap();
    let head = String::from_utf8_lossy(&buf).to_string();
    assert!(head.starts_with("HTTP/1.1 200 "));
    assert_eq!(head.split("\r\n\r\n").nth(1).unwrap_or(""), "");

    // 4) 坏 token ⇒ 403
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    s.write_all(format!("GET /m/deadbeef/{enc} HTTP/1.1\r\nHost: x\r\n\r\n").as_bytes())
      .unwrap();
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).unwrap();
    assert!(String::from_utf8_lossy(&buf).starts_with("HTTP/1.1 403 "));
  }

  #[test]
  fn rejects_non_media_extension() {
    let d = tmpdir("ext");
    let f = d.join("secret.md");
    std::fs::write(&f, b"# hi").unwrap();
    assert!(media_path(&f.to_string_lossy()).is_none(), "非媒体扩展名必须拒绝");
    let ok = d.join("a.mp3");
    std::fs::write(&ok, b"x").unwrap();
    assert!(media_path(&ok.to_string_lossy()).is_some());
  }

  #[test]
  fn percent_decode_handles_utf8() {
    assert_eq!(percent_decode("a%20b.mp4"), "a b.mp4");
    assert_eq!(percent_decode("%E4%B8%AD%E6%96%87.mp4"), "中文.mp4");
    assert_eq!(percent_decode("plain.mp4"), "plain.mp4");
    assert_eq!(percent_decode("bad%zz.mp4"), "bad%zz.mp4");
  }

  #[test]
  fn mime_by_extension() {
    assert_eq!(mime_of(&PathBuf::from("a.mp4")), "video/mp4");
    assert_eq!(mime_of(&PathBuf::from("a.MP3")), "audio/mpeg");
    assert_eq!(mime_of(&PathBuf::from("a.mkv")), "application/octet-stream");
  }
}
