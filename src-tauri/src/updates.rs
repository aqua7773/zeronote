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
///
/// id / label 与前端插件市场（`src/kernel/market.ts` 的 `MARKET_MIRRORS`）**同一套** ——
/// 用户在「关于 → 更新」里选渠道时，看到的顺序与插件市场一致（rev173.300）。
struct Mirror {
  id: &'static str,
  /// 给人看的名字（与 market.ts 的 label 逐字一致）
  label: &'static str,
  /// `update/<平台>.json` 的基址
  base: &'static str,
  /// 安装包（GitHub Release 附件）走法 —— 见 `AssetRoute`
  asset: AssetRoute,
}

/// 安装包（Release 附件）的渠道能力。
///
/// **为什么和清单分开**：清单是仓库里的文件，5 个渠道都能镜像；安装包在
/// GitHub Release 附件里，而 jsDelivr **只服务仓库文件、拿不到 Release 附件** ——
/// 这些渠道只能镜像清单，安装包退回 GitHub 直链（或反代）。
#[derive(Clone, Copy)]
enum AssetRoute {
  /// 原样（GitHub 直连）
  Direct,
  /// `https://github.com/…` 前加反代前缀
  Prefix(&'static str),
}

impl AssetRoute {
  /// 反代前缀（没有就是空串）
  fn prefix(self) -> &'static str {
    match self {
      AssetRoute::Direct => "",
      AssetRoute::Prefix(p) => p,
    }
  }
}

/// 渠道表。**顺序 = 自动探测顺序**，与插件市场同序（raw 第一）。
///
/// 实测（2026-10-27 手机 / 2026-10-31 桌面）：raw 常被 TLS RST 或超时，jsDelivr 节点稳；
/// ghproxy 通但下载只有 ~10 KB/s（15 MB 装包要 20 分钟以上）。所以渠道**必须能选、能测**，
/// 不能替用户拍一个（rev173.300 用户要求「和插件渠道一样做多渠道测试分发」）。
const MIRRORS: &[Mirror] = &[
  Mirror {
    id: "raw",
    label: "GitHub raw",
    base: "https://raw.githubusercontent.com/aqua7773/zeronote/main/",
    asset: AssetRoute::Direct,
  },
  Mirror {
    id: "jsdelivr-gcore",
    label: "jsDelivr · GCore",
    base: "https://gcore.jsdelivr.net/gh/aqua7773/zeronote@main/",
    asset: AssetRoute::Direct,
  },
  Mirror {
    id: "jsdelivr-testingcf",
    label: "jsDelivr · Cloudflare",
    base: "https://testingcf.jsdelivr.net/gh/aqua7773/zeronote@main/",
    asset: AssetRoute::Direct,
  },
  Mirror {
    id: "jsdelivr",
    label: "jsDelivr（cdn，国内常断）",
    base: "https://cdn.jsdelivr.net/gh/aqua7773/zeronote@main/",
    asset: AssetRoute::Direct,
  },
  Mirror {
    id: "ghproxy",
    label: "ghproxy.net（第三方）",
    base: "https://ghproxy.net/https://raw.githubusercontent.com/aqua7773/zeronote/main/",
    asset: AssetRoute::Prefix("https://ghproxy.net/"),
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
  /// 安装包各条路径的**实测速度**（rev173.311，按降序）。
  ///
  /// 空 = 没什么可测的：已是最新 / 本平台没发 / 清单拉不到。
  /// 「检查更新」时顺便测掉，安装就不用再等一轮 —— 用户点「安装」时直接拿 `[0]`。
  pub routes: Vec<RouteProbe>,
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
#[cfg_attr(target_os = "android", allow(dead_code))]
fn mirror(id: &str) -> Option<&'static Mirror> {
  MIRRORS.iter().find(|m| m.id == id)
}

/// 已知反代前缀。清单历史上写死过 ghproxy 地址（0.9.2 / 0.9.3 的生成脚本就是这么写的），
/// 客户端要能把它剥回 GitHub 直链，否则「选了 raw 也还是走 ghproxy」。
const ASSET_PROXY_PREFIXES: &[&str] = &["https://ghproxy.net/", "https://gh-proxy.com/"];

/**
 * **安装包**的可达路径（rev173.311）—— 与 5 条「清单渠道」是两张表。
 *
 * 为什么分开：清单是仓库文件，5 条渠道都能镜像；安装包在 Release 附件里，
 * jsDelivr 拿不到，所以「渠道」对安装包没有意义。用户选的渠道只决定**清单**从哪拉
 * （`MIRRORS`），安装包永远按这张表逐条试。
 *
 * ## 2026-11-01 本机无代理（`ProxyEnable=0`）实测 · 16 条候选
 *
 * | 路径 | 结果 | 速度 |
 * |---|---|---|
 * | GitHub 直连 → `release-assets.githubusercontent.com` | ✅ | **1.16 MB/s** |
 * | `ghproxy.net` | ✅ | 270 KB/s |
 * | `gh-proxy.com` | ✅ | 144 KB/s |
 * | ghfast / gh.llkk / github.moeyy / ghproxy.homeboyc / gh.nodeku | ❌ 12s 超时 | — |
 * | ghproxy.cc / gh.xxooo / gh-proxy.net / cf.ghproxy.cc / gh.072103 | ❌ 立即失败 | — |
 * | ghp.ci / hub.gitmirror / gh.api.99988866 | ❌ 立即失败 | — |
 * | github.akams.cn | ❌ 404（要先选节点子域，不能直接拼） | — |
 *
 * 结论：**直连是最快的一条**（比最好的反代还快 4.3 倍），但它对
 * `release-assets.githubusercontent.com` 的 DNS 是**间歇性**被污染的 —— 所以
 * 不是「有墙才用反代」，而是「直连优先、断了自动降级」。这正是这张表 + `pick_routes`
 * 存在的理由；只配一条路（无论哪条）都会在特定时刻整段不可用。
 *
 * 反代只留实测活的 2 条：多加一条死链只会让「逐个试」多等一个超时。
 */
#[derive(Debug)]
struct AssetRoute2 {
  /// 日志与 UI 里的短名
  id: &'static str,
  label: &'static str,
  /// 空串 = 直连
  prefix: &'static str,
}

const ASSET_ROUTES: &[AssetRoute2] = &[
  AssetRoute2 {
    id: "direct",
    label: "GitHub 直连（最快）",
    prefix: "",
  },
  AssetRoute2 {
    id: "ghproxy",
    label: "ghproxy.net",
    prefix: "https://ghproxy.net/",
  },
  AssetRoute2 {
    id: "gh-proxy-com",
    label: "gh-proxy.com",
    prefix: "https://gh-proxy.com/",
  },
];

/// 把安装包地址规范化成 **GitHub 直链**（剥掉已知反代前缀）
fn canonical_asset_url(url: &str) -> String {
  for p in ASSET_PROXY_PREFIXES {
    if let Some(rest) = url.strip_prefix(p) {
      return rest.to_string();
    }
  }
  url.to_string()
}

/// 按渠道改写安装包地址（纯函数，方便测）。
///
/// 规则：
///  · 非本仓库的地址（外部 / 自建源）**原样**，不瞎改
///  · 渠道不认识 / 该渠道拿不到 Release 附件（jsDelivr）⇒ 回 GitHub 直链
///  · 反代渠道 ⇒ `<前缀><GitHub 直链>`（清单已带前缀时不会叠两层）
fn rewrite_asset_url(mirror_id: &str, url: &str) -> String {
  let canonical = canonical_asset_url(url);
  if !canonical.starts_with("https://github.com/") {
    return canonical;
  }
  match mirror(mirror_id).map(|m| m.asset.prefix()) {
    Some(p) if !p.is_empty() => format!("{p}{canonical}"),
    _ => canonical,
  }
}

/// 各渠道下的安装包地址（去重，首项 = 清单里的直链）——「手动下载」与逐个试都用它
fn asset_candidates(url: &str) -> Vec<String> {
  asset_routes(url).into_iter().map(|(_, u)| u).collect()
}

/// 安装包的全部可达路径（带 id / label，供测速与日志用）。首项恒为直连。
fn asset_routes(url: &str) -> Vec<(&'static AssetRoute2, String)> {
  let canonical = canonical_asset_url(url);
  // 外部 / 自建源（不是本仓库的 GitHub 地址）：不瞎拼反代，原样一条
  if !canonical.starts_with("https://github.com/") {
    return vec![(&ASSET_ROUTES[0], canonical)];
  }
  let mut out: Vec<(&'static AssetRoute2, String)> = Vec::new();
  for r in ASSET_ROUTES {
    let u = if r.prefix.is_empty() {
      canonical.clone()
    } else {
      format!("{}{canonical}", r.prefix)
    };
    if !out.iter().any(|(_, x)| *x == u) {
      out.push((r, u));
    }
  }
  out
}

/// 字节数 → 人读的大小（探针 detail 用）
fn human_size(bytes: u64) -> String {
  let mib = bytes as f64 / 1024.0 / 1024.0;
  if mib >= 1.0 {
    format!("{mib:.1} MB")
  } else {
    format!("{} KB", std::cmp::max(1, bytes / 1024))
  }
}

/* ───── 多策略选路（rev173.311） ───── */

/// 一条可达路径的测速结果（`pick_routes` 的产出，也直接序列化给 UI）
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RouteProbe {
  pub id: String,
  pub label: String,
  pub url: String,
  pub ok: bool,
  pub ms: u64,
  /// 实测字节/秒（0 = 没测成）
  pub bps: u64,
  pub detail: String,
}

/// 测速拉这么多。
///
/// **64 KB 不够**（2026-11-01 live 实测教训）：握手 + TTFB 占了大头，把 2 MB 实测
/// 1.16 MB/s 的直连压成 42 KB/s、把 144 KB/s 的 gh-proxy 压成 25 KB/s —— 排序虽然没反，
/// 但数量级全错，靠它「看哪条快」就没意义了。256 KB 在 1 MB/s 下 0.25 秒、
/// 在 100 KB/s 下 2.5 秒，既能跑出真实带宽又不至于让「检查更新」明显变慢。
const PROBE_BYTES: usize = 256 * 1024;
/// 单条路线的测速超时（整条请求：连接 + 读满 `PROBE_BYTES`）
const ROUTE_TIMEOUT_MS: u64 = 8_000;

/// 测一条路线：Range 拉 64 KB，用**实际耗时**算速度。
///
/// ⚠️ 用 `chunk()` 流式读到够数就停，**不能用 `bytes()`** —— 有的反代无视 `Range`
/// 头、直接回整包（34 MB 的 APK），`bytes()` 会老实等它下完，测速变成真下载。
async fn probe_route(
  client: reqwest::Client,
  r: &'static AssetRoute2,
  url: String,
) -> RouteProbe {
  let started = std::time::Instant::now();
  let fail = |detail: String| RouteProbe {
    id: r.id.to_string(),
    label: r.label.to_string(),
    url: url.clone(),
    ok: false,
    ms: started.elapsed().as_millis() as u64,
    bps: 0,
    detail,
  };

  let mut resp = match client
    .get(&url)
    .header(reqwest::header::RANGE, format!("bytes=0-{}", PROBE_BYTES - 1))
    .send()
    .await
  {
    Ok(r) => r,
    Err(e) => return fail(short_error(&e.to_string())),
  };
  // 响应头到手 = 连接 + 握手 + TTFB 都吃完了；下面这段才是真正的**传输**耗时。
  // 不把它扣掉，测出来的速度会被握手开销拉低一个数量级（见 PROBE_BYTES 的注释）。
  let ttfb = started.elapsed();
  if !resp.status().is_success() {
    return fail(format!("HTTP {}", resp.status().as_u16()));
  }

  let mut got = 0usize;
  loop {
    match resp.chunk().await {
      Ok(Some(chunk)) => {
        got += chunk.len();
        if got >= PROBE_BYTES {
          break;
        }
      }
      Ok(None) => break,
      Err(e) => {
        // 已经读到一些字节：断在尾巴上不代表这条路不能用，按已读的算速度
        if got == 0 {
          return fail(short_error(&e.to_string()));
        }
        break;
      }
    }
  }
  if got == 0 {
    return fail("0 字节".to_string());
  }

  // 速度 = 字节 / **扣掉 TTFB 的传输耗时**。
  //
  // 试过的两种更「精确」的算法都被实测推翻，别再走回头路：
  //  · **末段瞬时速度**：ghproxy 首包 6.3 秒后数据一次性灌进来，最后 64 KB 只用了几毫秒
  //    ⇒ 算出 **28.6 MB/s** 并把直连挤到第三（第三次 live 实测）。
  //  · **只扣 TTFB 的平均值**：快路被 TCP 慢启动低估（直连 502 KB/s vs curl 2 MB 实测
  //    1.16 MB/s），但**不会给出荒谬值**，排序靠下面的「直连优先」兜底。
  //
  // 结论：测速只用来判「通不通」和「大致量级」，几百 KB 的样本撑不起精确带宽。
  let elapsed = started.elapsed();
  let transfer = elapsed.saturating_sub(ttfb).as_secs_f64().max(0.001);
  // 上限保护：超过 20 MB/s 只可能是缓冲/压缩假象，不是真带宽
  let bps = ((got as f64 / transfer) as u64).min(20 * 1024 * 1024);
  RouteProbe {
    id: r.id.to_string(),
    label: r.label.to_string(),
    url,
    ok: true,
    ms: elapsed.as_millis() as u64,
    bps,
    detail: format!("{}/s · 首包 {}ms", human_size(bps), ttfb.as_millis()),
  }
}

/// 并发测一批路线（`direct` = 绕开系统代理）
async fn probe_all(
  routes: &[(&'static AssetRoute2, String)],
  direct: bool,
) -> Vec<RouteProbe> {
  let built = if direct {
    crate::net::http_client_direct(ROUTE_TIMEOUT_MS)
  } else {
    crate::net::http_client(ROUTE_TIMEOUT_MS)
  };
  let Ok(client) = built else {
    return Vec::new();
  };
  let futs = routes
    .iter()
    .map(|(r, u)| probe_route(client.clone(), r, u.clone()));
  futures::future::join_all(futs).await
}

/**
 * 并发测所有可达路径，**按实测速度降序**返回（不可用的沉底，`ok=false`）。
 *
 * 两轮：第一轮跟随系统代理；**全部失败**才换直连再测一轮 —— 与 `fetch_json`
 * 同一套回退（rev173.306）。系统代理「开着但不可用」时（只关了加速器、
 * 代理进程还在监听）第一轮会全灭，其实直连是通的。
 *
 * 调用方约定：`[0]` 就是要走的那条；下载/安装失败时按顺序试 `[1..]`。
 */
async fn pick_routes(url: &str) -> Vec<RouteProbe> {
  let routes = asset_routes(url);
  let mut out = probe_all(&routes, false).await;
  if out.iter().all(|r| !r.ok) {
    out = probe_all(&routes, true).await;
  }
  out.sort_by(|a, b| b.bps.cmp(&a.bps));

  // **直连能通就直接用直连**，不比速度；反代之间才按实测速度排。
  //
  // 依据（2026-11-01 同一台机的两套实测）：
  //  · `curl` 拉 **2 MB**：直连 1.16 MB/s、ghproxy.net 270 KB/s、gh-proxy.com 144 KB/s；
  //  · `probe_route` 拉 **256 KB**：直连常常只有 350 KB/s 上下（TCP 还没爬满、小 Range
  //    在 CDN 上被限速），于是四轮 live 里直连有三次被排到第二、第三。
  //
  // 小样本的绝对值撑不起排序，但「通不通」是可靠的 —— 所以只拿它做可达性判断，
  // 速度只在**同类**反代之间比较（它们都是同一个转发层，可比）。
  if let Some(i) = out.iter().position(|r| r.id == "direct" && r.ok) {
    let d = out.remove(i);
    out.insert(0, d);
  }
  out
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

/// 拉一份 JSON（带大小上限）。
///
/// 先按默认策略（公网请求跟随系统代理）发；失败且不是本机地址时**直连再试一次** ——
/// 与 `net::net_request` 同一套回退（rev173.306）：系统代理「开着但不可用」时
/// （只关了加速器、代理进程还在监听），检查更新会直接报错，其实直连是通的。
async fn fetch_json(url: &str) -> Result<serde_json::Value, String> {
  let first = fetch_json_with(crate::net::http_client(CHECK_TIMEOUT_MS)?, url).await;
  if first.is_ok() || crate::net::is_local_url(url) {
    return first;
  }
  match crate::net::http_client_direct(CHECK_TIMEOUT_MS) {
    Ok(c) => fetch_json_with(c, url).await.or(first),
    Err(_) => first,
  }
}

async fn fetch_json_with(client: reqwest::Client, url: &str) -> Result<serde_json::Value, String> {
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

  #[cfg(desktop)]
  {
    let key = platform_key();
    let p = v.get("platforms")?.get(&key)?;
    let url = p.get("url")?.as_str()?.to_string();
    let signature = p
      .get("signature")
      .and_then(|x| x.as_str())
      .map(str::to_string);
    // 首项是清单里的直链本身，mirrors 只留其余渠道（给「手动下载 / 逐个试」）
    let mirrors = asset_candidates(&url).into_iter().skip(1).collect();
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
    // 首项是清单里的直链本身，mirrors 只留其余渠道（Android 下载时逐个试）
    let mirrors = asset_candidates(&url).into_iter().skip(1).collect();
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

/// 检查有没有新版本。**只在候选渠道全失败时才把 error 填上**。
///
/// `mirror_id`：指定渠道（用户在下拉里选的）就只试它；不给（启动静默检查）就按
/// `MIRRORS` 顺序自动探测 —— 保证「用户没选」时仍能找到一条通的。
#[tauri::command]
pub async fn check_app_update(mirror_id: Option<String>) -> Result<UpdateCheck, String> {
  let current = env!("CARGO_PKG_VERSION").to_string();
  let file = manifest_file();
  let candidates: Vec<&'static Mirror> = match mirror_id.as_deref() {
    Some(id) => match mirror(id) {
      Some(m) => vec![m],
      None => {
        return Ok(UpdateCheck {
          current_version: current,
          has_update: false,
          remote_version: None,
          latest: None,
          mirror: String::new(),
          error: Some(format!("不认识的更新渠道：{id}")),
          routes: Vec::new(),
        })
      }
    },
    None => MIRRORS.iter().collect(),
  };
  let mut last_err = String::new();

  for m in candidates {
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
        // rev173.311：**有新版才测安装包路径**。已是最新时没人会下载，
        // 不该为「哪条路快」多花几秒 —— 检查更新不该变慢。
        let routes = match (has_update, latest.as_ref()) {
          (true, Some(u)) => pick_routes(&u.url).await,
          _ => Vec::new(),
        };
        for r in &routes {
          log::info!(
            "安装包路径：{} {} {}",
            r.label,
            if r.ok { "可用" } else { "不可用" },
            r.detail
          );
        }
        return Ok(UpdateCheck {
          current_version: current,
          has_update,
          remote_version,
          latest,
          mirror: m.id.to_string(),
          error: None,
          routes,
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
    routes: Vec::new(),
  })
}

/// 一条渠道的探测结果（「关于 → 更新」的测速用，rev173.300）
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PathProbe {
  pub id: String,
  pub label: String,
  pub ok: bool,
  pub ms: u64,
  /// 给人看的一句话（成功 = 版本 + 安装包大小；失败 = 原因）
  pub detail: String,
}

/// 错误文本的最后一小段（Rust 侧错误常带「… —— 原因」，最后一段最有信息量）
fn short_error(e: &str) -> String {
  e.rsplit("——")
    .next()
    .unwrap_or(e)
    .trim()
    .chars()
    .take(80)
    .collect()
}

/// 测一条渠道：拉清单，桌面再顺手 HEAD 一下安装包。
///
/// **只看状态码会被骗**（2026-10-27 实测某反代回 200 但只有 508 字节的错误页），
/// 所以「可用」= 200 **且**能解析出 version。安装包那一问只看**可达性**（HEAD），
/// 不代表下载速度 —— 文案里写「安装包 15.0 MB 320ms」，别让人把「可达」当「快」。
#[tauri::command]
pub async fn probe_update_mirror(mirror_id: String) -> Result<PathProbe, String> {
  let Some(m) = mirror(&mirror_id) else {
    return Ok(PathProbe {
      id: mirror_id.clone(),
      label: mirror_id,
      ok: false,
      ms: 0,
      detail: "不认识的渠道".to_string(),
    });
  };

  let started = std::time::Instant::now();
  let url = format!("{}update/{}", m.base, manifest_file());
  let parsed = match fetch_json(&url).await {
    Ok(v) => v,
    Err(e) => {
      return Ok(PathProbe {
        id: m.id.to_string(),
        label: m.label.to_string(),
        ok: false,
        ms: started.elapsed().as_millis() as u64,
        detail: short_error(&e),
      })
    }
  };

  let version = parsed
    .get("version")
    .and_then(|x| x.as_str())
    .unwrap_or("?")
    .to_string();
  let latest = parse_manifest(&parsed);
  let manifest_ms = started.elapsed().as_millis() as u64;

  // rev173.311：桌面不再在这里 HEAD 安装包。
  //
  // 原因：jsDelivr / raw 这类渠道**本来就不镜像 Release 附件**，它的安装包地址一定退回
  // GitHub 直链 —— 于是一条好好的清单渠道会被显示成「安装包不可达」，看着像全线故障。
  // 安装包现在由 `pick_routes` 单独测（直连 / ghproxy / gh-proxy），结果在
  // `check_app_update` 的 `routes` 里，「下载通道」那一行显示。
  #[cfg(desktop)]
  let asset_note = if latest.is_some() {
    " · 清单可用（安装包走下载通道）".to_string()
  } else {
    " · 本平台无安装包".to_string()
  };
  #[cfg(not(desktop))]
  let asset_note = latest
    .as_ref()
    .map(|u| {
      u.size
        .map(|s| format!(" · {}", human_size(s)))
        .unwrap_or_default()
    })
    .unwrap_or_else(|| " · 本平台无安装包".to_string());

  Ok(PathProbe {
    id: m.id.to_string(),
    label: m.label.to_string(),
    ok: true,
    ms: manifest_ms,
    detail: format!("v{version}{asset_note}"),
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
  // 检查阶段选好的安装包地址（前端传 `check.routes[0].url`，或用户手选的那条）。
  // `None` / 不在白名单里 ⇒ 这里自己再测一轮（rev173.311）。
  asset_url: Option<String>,
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

    let Some(mut update) = updater.check().await.map_err(|e| format!("检查更新失败：{e}"))? else {
      return Err("已经是最新版本".to_string());
    };

    // ① 先按用户选的渠道改写（清单里的 url 可能是 GitHub 直链，也可能带着旧的反代前缀）
    let by_channel = rewrite_asset_url(&mirror_id, update.download_url.as_str());

    // ② 用「检查更新」时测出来的那条（用户点安装就直接下，不再等一轮测速）；
    //    没传 / 传了个白名单外的地址 ⇒ 现测一轮兜底。
    let allowed = asset_candidates(&by_channel);
    let chosen = asset_url
      .as_deref()
      .map(str::trim)
      .filter(|u| !u.is_empty())
      .filter(|u| allowed.iter().any(|a| a == u))
      .map(str::to_string);

    let best = match chosen {
      Some(u) => {
        log::info!("按检查阶段选定的路径下载：{u}");
        u
      }
      None => {
        let picked = pick_routes(&by_channel).await;
        for p in &picked {
          log::info!(
            "更新路径测速：{} {} {}",
            p.label,
            if p.ok { "可用" } else { "不可用" },
            p.detail
          );
        }
        picked
          .iter()
          .find(|r| r.ok)
          .map(|r| r.url.clone())
          // 一条都测不通（比如只是慢过 6 秒）：保持渠道改写后的地址，照常下载
          .unwrap_or(by_channel)
      }
    };
    if best != update.download_url.as_str() {
      update.download_url = tauri::Url::parse(&best)
        .map_err(|e| format!("安装包地址不合法（{best}）：{e}"))?;
    }

    log::info!(
      "开始下载更新 {} → {}（渠道 {mirror_id} · 走 {}）",
      update.current_version,
      update.version,
      update.download_url
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
    let _ = (&app, &mirror_id, &asset_url, &on_event);
    Err("desktop-only".to_string())
  }
}

/* ───── APK 下载的并发与完整性护栏（rev173.313） ─────
 *
 * 2026-11-01 真机故障：0.9.9 里点「下载安装包」下 0.9.10，34.7 MB 下完，sha256 却对不上
 * （清单 `b8d9…`，落盘 `86a9…`），包被删、装不上。
 *
 * 同一天逐项排除过（都是真的跑过的，不是推的）：
 *  · GitHub Release 资产 digest = 清单 sha256 = 本地构建产物（三处一致）
 *  · 手机在同一网络下 `curl` 整包下载 → sha256 正确
 *  · 手机 `curl` 分段（0–10 MB + 10 MB–）拼起来 → sha256 正确（说明服务端 Range 没问题）
 *
 * 剩下的解释只有一个：**两个下载任务同时往同一个 `.part` 里写**。前端面板卸载不会取消
 * Rust 侧的 async 命令（Channel 发不出去只是被忽略），关掉设置面板再打开、或换渠道重开，
 * effect 就会把下载再发一次 —— 两个任务各持一个 `have`，append 交错，长度的账还大体对得上，
 * 内容已经错了。
 *
 * 所以加三道闸：
 *  ① 同一时刻只跑一个下载任务（这里）；
 *  ② 续传必须**服务器认了 Range 且起点等于本地已有字节数**，否则从头下；
 *  ③ 校验失败不再直接判死：删掉半成品、换下一条候选**从零重下一次**，全试完才报错。
 */
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
static APK_DOWNLOAD_GATE: std::sync::atomic::AtomicBool =
  std::sync::atomic::AtomicBool::new(false);

/// 出作用域自动放行（含 `?` / `return` 提前退出）
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
struct ApkDownloadGate;

impl Drop for ApkDownloadGate {
  fn drop(&mut self) {
    APK_DOWNLOAD_GATE.store(false, std::sync::atomic::Ordering::SeqCst);
  }
}

/// 抢下载闸：抢到返回 guard，抢不到返回 `None`（已有任务在跑）
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn try_apk_download_gate() -> Option<ApkDownloadGate> {
  match APK_DOWNLOAD_GATE.compare_exchange(
    false,
    true,
    std::sync::atomic::Ordering::SeqCst,
    std::sync::atomic::Ordering::SeqCst,
  ) {
    Ok(_) => Some(ApkDownloadGate),
    Err(_) => None,
  }
}

/// `Content-Range: bytes 1234-5678/9012` → 起点 `1234`。
///
/// 续传时**必须**拿它跟本地已有字节数比对：反代忽略 Range 直接回整包（实测有），
/// 万一它回的 206 起点不是我们要求的那个，拼出来的包长度照样对、内容全错。
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn content_range_start(v: Option<&reqwest::header::HeaderValue>) -> Option<u64> {
  let raw = v?.to_str().ok()?;
  let rest = raw.trim().strip_prefix("bytes")?;
  rest.split('-').next()?.trim().parse::<u64>().ok()
}

/// 整文件 sha256（hex）—— 缓存里「看起来下完了」的包也要过这一关再交给安装器
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn sha256_file_hex(path: &std::path::Path) -> std::io::Result<String> {
  use sha2::{Digest, Sha256};
  let mut f = std::fs::File::open(path)?;
  let mut hasher = Sha256::new();
  let mut buf = [0u8; 64 * 1024];
  loop {
    let n = std::io::Read::read(&mut f, &mut buf)?;
    if n == 0 {
      break;
    }
    hasher.update(&buf[..n]);
  }
  Ok(format!("{:x}", hasher.finalize()))
}

/// 「完整文件」判定：存在、非空、（已知大小则）大小对得上。
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
fn complete_size(path: &std::path::Path, want: Option<u64>) -> Option<u64> {
  let meta = std::fs::metadata(path).ok()?;
  if !meta.is_file() || meta.len() == 0 {
    return None;
  }
  match want {
    Some(w) if meta.len() != w => None,
    _ => Some(meta.len()),
  }
}

/// Android：把 APK 下到缓存目录，顺便算 sha256 并与清单核对。
///
/// 返回落盘路径，交给 `plugin:apk-install|install_apk` 起系统安装器。
///
/// ## 断点续传（rev173.311）
///
/// 数据先写进 `zeronote-<版本>.apk.part`，sha256 校验通过才改名成正式文件 ——
/// 所以「半成品」永远不会被当成完整包交给安装器。
///
/// **三条路之间还能互相续**：直连下到一半被 RST，换 ghproxy 发 `Range: bytes=<已有>-`
/// 接着下。34 MB 的包在手机上断一次就要重来，这个代价太高。
#[tauri::command]
pub async fn download_android_update(
  app: tauri::AppHandle,
  url: String,
  mirrors: Vec<String>,
  sha256: Option<String>,
  version: String,
  // 清单里的整包大小：判断「下完没」「半成品还有没有用」都靠它
  size: Option<u64>,
  // 检查阶段选好的路径（前端传 `routes[0].url` 或用户手选的那条）。
  // 给了就不测速、直接开下；没给才现测一轮。
  preferred: Option<String>,
  on_event: Channel<Progress>,
) -> Result<String, String> {
  #[cfg(target_os = "android")]
  {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use tauri::Manager;

    // 并发闸（rev173.313）：同一时刻只允许一个下载任务写 `.part`。
    // 抢不到说明上一次下载还在跑（面板关了它也没停）—— 直接告诉用户稍等，别开第二份。
    let Some(_gate) = try_apk_download_gate() else {
      return Err("上一次下载还没结束（关掉设置面板不会取消它）—— 等它下完再试".to_string());
    };

    let dir = app
      .path()
      .app_cache_dir()
      .map_err(|e| format!("拿不到缓存目录：{e}"))?
      .join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建缓存目录失败：{e}"))?;
    // 版本号进文件名：装完新版后旧文件还躺着时，下一次下载不会覆盖正在被安装器读取的那个
    let final_path = dir.join(format!("zeronote-{version}.apk"));
    // 半成品单独一个名字 —— 只有校验通过才改名，所以「有正式文件」= 真的下完了
    let part_path = dir.join(format!("zeronote-{version}.apk.part"));

    // ① 上次已经下完了（「下载完没点安装 → 切走 → 回来」就是这条）：
    //    别再下一遍 34 MB，直接把路径交回去。
    //
    //    rev173.313：**大小对不等于内容对**。这份文件是以前某个任务写出来的，
    //    若那次是被并发踩坏的（见 `APK_DOWNLOAD_GATE` 的注释），大小刚好对得上、
    //    sha256 却是错的 —— 直接交给安装器就是「签名冲突 / 应用未安装」。
    //    所以有清单 sha256 就复核一遍，不符就删掉当没下过。
    if let Some(have) = complete_size(&final_path, size) {
      let mut trusted = true;
      if let Some(want) = sha256.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        match sha256_file_hex(&final_path) {
          Ok(got) if got.eq_ignore_ascii_case(want) => {}
          _ => {
            log::warn!("缓存里的 APK 校验不过，删掉重下：{}", final_path.display());
            let _ = std::fs::remove_file(&final_path);
            trusted = false;
          }
        }
      }
      if trusted {
        log::info!(
          "APK 已存在，跳过下载：{}（{have} 字节）",
          final_path.display()
        );
        let _ = on_event.send(Progress::Progress {
          chunk: 0,
          downloaded: have,
          total: size,
        });
        let _ = on_event.send(Progress::Finished);
        return Ok(final_path.to_string_lossy().to_string());
      }
    }

    // ② 排候选。给了 preferred 就直接拿它打头（检查阶段已经测过，安装别再等一轮）；
    //    没给才现测一圈按实测速度排。
    let mut candidates: Vec<String> = Vec::new();
    let preferred = preferred
      .map(|u| u.trim().to_string())
      .filter(|u| !u.is_empty());
    match preferred {
      Some(u) => {
        candidates.push(u);
        for c in std::iter::once(url.clone()).chain(mirrors.iter().cloned()) {
          if !candidates.contains(&c) {
            candidates.push(c);
          }
        }
      }
      None => {
        let picked = pick_routes(&url).await;
        for p in &picked {
          log::info!(
            "APK 路径测速：{} {} {}",
            p.label,
            if p.ok { "可用" } else { "不可用" },
            p.detail
          );
        }
        candidates.extend(picked.iter().filter(|r| r.ok).map(|r| r.url.clone()));
        // 清单里的 url / mirrors 可能指向本仓库以外的源（自建反代 / 自建服务器），
        // 测速拼不出来，也要留在后面兜底
        for u in std::iter::once(url.clone()).chain(mirrors.iter().cloned()) {
          if !candidates.contains(&u) {
            candidates.push(u);
          }
        }
      }
    }

    let client = crate::net::download_client()?;
    let mut last_err = String::new();

    for candidate in candidates {
      // 已经落了多少字节 —— 换路也接着它续
      let mut have = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);
      if have > 0 && size.map(|w| have > w).unwrap_or(false) {
        // 半成品比整包还大：肯定不对劲，丢掉重来
        let _ = std::fs::remove_file(&part_path);
        have = 0;
      }

      let mut req = client.get(&candidate);
      if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
      }
      let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => {
          last_err = format!("下载 APK 失败：{candidate} —— {e}");
          continue;
        }
      };
      let status = resp.status();
      // 206 = 服务器认了 Range，接着写；200 = 它不支持续传，只能从头来
      let resume = have > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
      // rev173.313：206 还得核对**起点**。
      // 反代忽略/改写 Range 时可能回「206 + 从 0 开始」—— 拼出来的包长度照样对、
      // 内容全错（就是 2026-11-01 那次 86a9… 的一种可能路径）。宁可删掉从头下。
      if resume {
        let start = content_range_start(resp.headers().get(reqwest::header::CONTENT_RANGE));
        if start != Some(have) {
          last_err = format!("续传起点对不上（要 {have}，服务器给 {start:?}）：{candidate}");
          log::warn!("{last_err} —— 丢掉半成品，换路从头下");
          let _ = std::fs::remove_file(&part_path);
          continue;
        }
      }
      if have > 0 && !resume {
        let _ = std::fs::remove_file(&part_path);
        have = 0;
      }
      if !status.is_success() {
        last_err = format!("下载 APK 失败：HTTP {status}（{candidate}）");
        continue;
      }

      let total = resp.content_length().map(|n| n + have).or(size);
      let mut body = resp;

      // 续传时 hasher 必须把已落盘的部分也算进去，否则 sha256 必然对不上
      let mut hasher = Sha256::new();
      if resume {
        if let Ok(mut f) = std::fs::File::open(&part_path) {
          let mut buf = [0u8; 64 * 1024];
          loop {
            match std::io::Read::read(&mut f, &mut buf) {
              Ok(0) | Err(_) => break,
              Ok(n) => hasher.update(&buf[..n]),
            }
          }
        }
      }

      let opened = if resume {
        std::fs::OpenOptions::new().append(true).open(&part_path)
      } else {
        std::fs::File::create(&part_path)
      };
      let mut file = match opened {
        Ok(f) => f,
        Err(e) => return Err(format!("创建 APK 文件失败：{e}")),
      };

      let mut downloaded = have;
      let mut complete = true;
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
            complete = false;
            break;
          }
        }
      }
      // 关掉再换路：否则下一条候选读 part 长度时可能还没落盘
      drop(file);

      if !complete {
        log::warn!("APK 下到 {downloaded} 字节断了，换下一条路从断点续");
        continue;
      }
      if let Some(want) = size {
        // rev173.313：**多也是错**。原来只判 `downloaded < want`，于是「206 回错起点、
        // 或半成品被重复追加」造成的超长文件会一路走到 sha256 才炸 —— 现在提前拦下，
        // 顺便把半成品清掉，好让下一条候选从零开始。
        if downloaded != want {
          last_err = format!("下载长度不符：{downloaded}/{want}（{candidate}）");
          let _ = std::fs::remove_file(&part_path);
          continue;
        }
      }
      if downloaded == 0 {
        continue;
      }

      if let Some(want) = sha256.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let got = format!("{:x}", hasher.finalize());
        if !got.eq_ignore_ascii_case(want) {
          // rev173.313：不再直接判死 —— 删掉半成品，换下一条候选**从零重下一次**。
          // 一次下载里拼坏了（并发/反代异常），换条路重来往往就好了；
          // 全部候选都试完才把最后那条错误报给用户。
          last_err = format!(
            "APK 校验失败：清单记 sha256={want}，实际 {got} —— 已删除，换路重下"
          );
          log::warn!("{last_err}（{candidate}）");
          let _ = std::fs::remove_file(&part_path);
          continue;
        }
      }

      // 校验通过才改成正式名字：半成品永不冒充完整包
      std::fs::rename(&part_path, &final_path)
        .map_err(|e| format!("APK 落盘改名失败：{e}"))?;

      let _ = on_event.send(Progress::Finished);
      log::info!("APK 已落盘：{}（{downloaded} 字节）", final_path.display());
      return Ok(final_path.to_string_lossy().to_string());
    }

    Err(if last_err.is_empty() {
      "下载 APK 失败：没有可用的地址".to_string()
    } else {
      last_err
    })
  }

  #[cfg(not(target_os = "android"))]
  {
    let _ = (
      &app, &url, &mirrors, &sha256, &version, &size, &preferred, &on_event,
    );
    Err("android-only".to_string())
  }
}

/// 缓存目录里跟「这个版本」有关的 APK 状态（rev173.311）。
///
/// 为什么需要：`phase` / `apkPath` 全是前端组件的 `useState`，关掉设置面板
/// （或切到别的应用被系统回收）就没了 —— 但文件还在缓存目录里躺着。于是
/// 「下载完 → 没点安装 → 切走 → 回来」会重新拉清单、重新下 34 MB。
/// 这条命令让前端一打开面板就能把**下完的**捡回来、把**下到一半的**接着下。
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ApkCache {
  /// 已经下完的正式文件（空串 = 没有）
  pub path: String,
  /// 正式文件大小（0 = 没有）
  pub size: u64,
  /// 半成品已下载的字节数（0 = 没有半成品，或半成品属于别的版本）
  pub partial: u64,
}

/// Android：查「这个版本」的 APK 缓存状态。桌面恒为空（桌面更新由官方 updater 管）。
#[tauri::command]
pub async fn find_apk_cache(app: tauri::AppHandle, version: String) -> ApkCache {
  #[cfg(target_os = "android")]
  {
    use tauri::Manager;
    let Ok(dir) = app.path().app_cache_dir().map(|d| d.join("updates")) else {
      return ApkCache::default();
    };
    // 文件名规则与 download_android_update 逐字一致
    let final_path = dir.join(format!("zeronote-{version}.apk"));
    let part_path = dir.join(format!("zeronote-{version}.apk.part"));
    let size = std::fs::metadata(&final_path)
      .ok()
      .filter(|m| m.is_file())
      .map(|m| m.len())
      .unwrap_or(0);
    let partial = if size > 0 {
      0
    } else {
      std::fs::metadata(&part_path)
        .ok()
        .filter(|m| m.is_file())
        .map(|m| m.len())
        .unwrap_or(0)
    };
    ApkCache {
      path: if size > 0 {
        final_path.to_string_lossy().to_string()
      } else {
        String::new()
      },
      size,
      partial,
    }
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = (&app, &version);
    ApkCache::default()
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

  /// 渠道改写（rev173.300）：直连渠道原样、反代渠道加前缀、旧清单的反代前缀先剥回直链。
  #[test]
  fn asset_url_routes_by_mirror() {
    let gh = "https://github.com/aqua7773/zeronote/releases/download/v0.9.3/ZeroNote_0.9.3_x64-setup.exe";
    // jsDelivr / raw 拿不到 Release 附件 ⇒ 回 GitHub 直链
    assert_eq!(rewrite_asset_url("raw", gh), gh);
    assert_eq!(rewrite_asset_url("jsdelivr-gcore", gh), gh);
    assert_eq!(rewrite_asset_url("jsdelivr-testingcf", gh), gh);
    assert_eq!(rewrite_asset_url("jsdelivr", gh), gh);
    // 反代渠道
    assert_eq!(
      rewrite_asset_url("ghproxy", gh),
      format!("https://ghproxy.net/{gh}")
    );
    // 清单里已带反代前缀（0.9.2 / 0.9.3 就是这么写的）：任何渠道都先剥回直链，不叠两层
    let prefixed = format!("https://ghproxy.net/{gh}");
    assert_eq!(rewrite_asset_url("raw", &prefixed), gh);
    assert_eq!(rewrite_asset_url("ghproxy", &prefixed), prefixed);
    // 外部 / 自建源的地址不瞎改
    assert_eq!(
      rewrite_asset_url("ghproxy", "https://example.com/x.exe"),
      "https://example.com/x.exe"
    );
    // 不认识的渠道 ⇒ 原样
    assert_eq!(rewrite_asset_url("nope", gh), gh);
  }

  /// 候选地址（rev173.311）：首项恒为直连，后面两条是实测活着的反代，且不重复。
  #[test]
  fn asset_candidates_lists_direct_then_live_proxies() {
    let gh = "https://github.com/aqua7773/zeronote/releases/download/v0.9.3/a.exe";
    let c = asset_candidates(gh);
    assert_eq!(c.len(), 3, "实际 {c:?}");
    assert_eq!(c[0], gh, "直连必须排第一（它是最快的一条）");
    assert_eq!(c[1], format!("https://ghproxy.net/{gh}"));
    assert_eq!(c[2], format!("https://gh-proxy.com/{gh}"));
  }

  /// 非本仓库的地址（自建源 / 外部）不拼反代：`asset_routes` 只回一条。
  #[test]
  fn asset_routes_leave_foreign_urls_alone() {
    let url = "https://example.com/ZeroNote_1.0.0_arm64.apk";
    let r = asset_routes(url);
    assert_eq!(r.len(), 1, "实际 {r:?}");
    assert_eq!(r[0].1, url);
    assert_eq!(r[0].0.id, "direct");
  }

  /// 清单里已经带着反代前缀（0.9.2 / 0.9.3 的产物）：先剥回直链再按表拼，不叠两层。
  #[test]
  fn asset_routes_strip_then_repack() {
    let gh = "https://github.com/aqua7773/zeronote/releases/download/v0.9.3/a.exe";
    let prefixed = format!("https://ghproxy.net/{gh}");
    let r = asset_routes(&prefixed);
    assert_eq!(r[0].1, gh, "直连要剥回原始 GitHub 地址");
    assert_eq!(r[1].1, prefixed, "ghproxy 那条不叠两层前缀");
    assert_eq!(r[2].1, format!("https://gh-proxy.com/{gh}"));
  }

  /// 续传起点解析：只认 `bytes <start>-<end>/<total>`。
  ///
  /// 2026-11-01 那次「大小对、sha256 错」的兜底就靠它 —— 反代若回一个起点不对的
  /// 206，这里必须能认出来（认不出的按「不可续传」处理 = 从头下，宁可多下一遍）。
  #[test]
  fn content_range_parses_start_from_bytes_form_only() {
    let hv = |s: &str| reqwest::header::HeaderValue::from_str(s).unwrap();
    assert_eq!(
      content_range_start(Some(&hv("bytes 1234-5678/9012"))),
      Some(1234)
    );
    assert_eq!(content_range_start(Some(&hv("bytes 0-0/100"))), Some(0));
    assert_eq!(
      content_range_start(Some(&hv("bytes */100"))),
      None,
      "缺起点（416 那种）不能当成 0"
    );
    assert_eq!(
      content_range_start(Some(&hv("1024-2048/4096"))),
      None,
      "没有 bytes 前缀就不认"
    );
    assert_eq!(content_range_start(None), None, "没这个头 = 不是续传响应");
  }

  /// 并发闸：同时只许一个下载任务；出作用域（含提前 return）自动放行。
  ///
  /// 这是 2026-11-01 真机故障的直接护栏 —— 两个任务同时 append 同一个 `.part`
  /// 会拼出「长度对、sha256 错」的包。
  #[test]
  fn apk_download_gate_allows_only_one_at_a_time() {
    let first = try_apk_download_gate().expect("第一次应该抢得到");
    assert!(
      try_apk_download_gate().is_none(),
      "已有任务在跑时不能再开第二份"
    );
    drop(first);
    let again = try_apk_download_gate().expect("放行后应该能再抢");
    drop(again);
  }

  /// **真网络**验证多策略选路（不跑 CI）。手动：
  /// `cargo test --lib live_route_pick -- --ignored --nocapture`
  ///
  /// 期望：三条都发一次 `Range: bytes=0-65535`，按实测速度降序；至少一条 `ok`。
  /// 用来确认「检查更新时测出来的路」在真实网络下确实能拿到字节、速度排序合理。
  #[test]
  #[ignore]
  fn live_route_pick() {
    let url = concat!(
      "https://github.com/aqua7773/zeronote/releases/download/v0.9.8/",
      "ZeroNote_0.9.8_x64-setup.exe"
    );
    let picked = tauri::async_runtime::block_on(pick_routes(url));
    for p in &picked {
      println!(
        "{:<10} ok={:<5} {:>9} B/s  {}",
        p.label, p.ok, p.bps, p.detail
      );
    }
    assert!(!picked.is_empty(), "候选为空");
    assert!(
      picked.iter().any(|p| p.ok),
      "三条路径全不通（连不上就别指望客户端能更新）：{picked:?}"
    );
    // 降序：第一条只能是可用里最快的那条
    assert!(picked[0].ok, "排序后第一条必须可用：{picked:?}");
  }
}
