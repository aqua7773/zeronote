# update/ —— 应用本体更新的清单（rev173.292）

应用更新没有服务端，靠这两个**静态 JSON**（由 `scripts/gen-update-manifest.mjs` 在发版时生成）：

| 文件 | 谁读 | 内容 |
|---|---|---|
| `latest.json` | 桌面（`tauri-plugin-updater`） | Tauri static JSON：`version` / `notes` / `pub_date` / `platforms.windows-x86_64.{url,signature}` |
| `android.json` | Android（`src-tauri/src/updates.rs`） | `version` / `notes` / `pub_date` / `apk.{url,sha256,size}` |

## 发版顺序（别搞反）

```powershell
# 1. 改版本号（三处同步）
node scripts/release.mjs 0.9.2

# 2. 构建（脚本会自动带上 updater 签名密钥 ~/.tauri/zeronote.key）
node scripts/build-release.mjs --desktop
node scripts/build-release.mjs --android

# 3. 生成清单（读产物里的 .sig 与 APK 的 sha256）
node scripts/gen-update-manifest.mjs

# 4. 建 Release 并上传产物（文件名必须与清单里的 url 一致）
gh release create v0.9.2 --title "..." --notes "..." `
  "src-tauri/target/release/bundle/nsis/*.exe" `
  "src-tauri/target/release/bundle/nsis/*.exe.sig" `
  "src-tauri/gen/android/app/build/outputs/apk/universal/release/*.apk"

# 5. 清单进仓库（客户端从仓库里读它，不是从 Release 读）
git add update && git commit -m "chore(update): v0.9.2" && git push
```

**第 5 步不能省**：客户端按用户选的渠道（默认按表顺序自动探测）读**仓库里**的清单；
Release 上那份只是给人下载用的备份。

## 为什么清单不进 Release

`plugins.updater.endpoints` 的语义是「非 2xx 才试下一个」，连接被 RST 属于网络错误 ——
它会直接失败、不会换镜像（详见 `src-tauri/src/updates.rs` 头部注释）。
所以镜像选择必须在我们自己的代码里做，清单也就必须能在**任意一个可达的静态地址**上取到。
仓库 raw 镜像列表（raw / jsDelivr ×3 / ghproxy）已经覆盖国内网络；用户还能在「关于 → 更新」
里选渠道或跑一次测速。

## 安装包地址为什么是 `ghproxy.net/...`

`latest.json` 里 `platforms.windows-x86_64.url` 由脚本写成 **ghproxy 反代前缀 + 原始 Release 地址**：

```
https://ghproxy.net/https://github.com/aqua7773/zeronote/releases/download/v0.9.2/ZeroNote_0.9.2_x64-setup.exe
```

原因：updater 拿到这个 URL 就直接下载安装包，而 ≤0.9.3 的老客户端**只会原样用它** ——
2026-10-31 实测国内直连 `github.com:443` 不通（本机 `git push` 撞 `curl 28 Failed to connect`），
写成直链会让老客户端直接下不动。ghproxy 前缀那条实测两端都 200、字节数一致。

> **2026-11-01 复测：这条链路是间歇性的。** 同一台机器 `github.com` 回 302、
> `release-assets.githubusercontent.com` 2 MB 跑到 **1.16 MB/s**。所以「国内直连一定不通」
> 不是结论 —— 新客户端（≥ 本 rev）会剥掉前缀并按**下载通道**三路实测选最快（见下节）。
> 清单里保留 ghproxy 前缀只是为了**兼容老客户端**，不是为了「直连必然失败」。

* 想在海外 / 自建反代环境用原始地址：`$env:NO_GH_MIRROR=1; node scripts/gen-update-manifest.mjs`
* ghproxy 挂了怎么办：应用内更新会报错，用户到 Release 页面手动下（浏览器可配代理）。

## 渠道（rev173.300）：和插件市场同一套

「关于 → 更新」里有 **更新渠道下拉 + 测速**，渠道表与插件市场 `MARKET_MIRRORS` 同一套
id 与顺序（前端 `src/kernel/app-update.ts` 的 `UPDATE_MIRRORS` / Rust `updates.rs` 的 `MIRRORS`）：

| 渠道 | 清单 | 安装包 |
|---|---|---|
| `raw`（GitHub raw） | ✅ | 走**下载通道**（见下节），与渠道无关 |
| `jsdelivr-gcore` · `jsdelivr-testingcf` · `jsdelivr` | ✅ | 同上（**jsDelivr 只服务仓库文件，拿不到 Release 附件**） |
| `ghproxy`（第三方反代） | ✅ | 同上 |

> **rev173.311 起渠道只决定「清单从哪拉」**，安装包不再绑死在某条渠道上（见下节）。
> 上表「安装包」列的旧口径已不成立。

* 选中的渠道存 `localStorage['zn-app-update-mirror']`；
  启动时的静默检查**不指定渠道**（按表顺序自动探测，谁先 200 用谁）。
* 清单里的 `url` 仍写成 ghproxy 前缀 —— 客户端先 `canonical_asset_url()` 剥回 GitHub
  直链，再按**下载通道**路由。这样 ≤0.9.3 的旧客户端（只会原样用清单 url）不会被改坏；
  **别把脚本改成直链**。
* 测速命令 `probe_update_mirror`：只验**清单**（拉下来并解析出版本 —— 只看状态码会被
  错误页骗）。桌面**不再 HEAD 安装包**：jsDelivr 拿不到 Release 附件，那条 HEAD 必然红，
  会把好好的清单渠道显示成「安装包不可达」（2026-11-01 那张截图的误导就来自这里）。

## 下载通道（rev173.311）：三路并发实测，谁快走谁

安装包有**三条独立路径**（`updates.rs` 的 `ASSET_ROUTES`），与清单渠道解耦：

| id | 路径 | 2026-11-01 本机无代理实测 |
|---|---|---|
| `direct` | GitHub 直连 → `release-assets.githubusercontent.com` | ✅ **1.16 MB/s**（最快） |
| `ghproxy` | `https://ghproxy.net/<Release 地址>` | ✅ 270 KB/s |
| `gh-proxy-com` | `https://gh-proxy.com/<Release 地址>` | ✅ 144 KB/s |

* **点「检查更新」就测**（`Range: bytes=0-65535` 拉 64 KB 算速度，三条并发；**全灭**才换
  直连再测一轮 —— 系统代理「开着但不可用」时第一轮会全灭）。结果在 `UpdateCheck.routes`
  里按速度降序，前端「下载通道」一行显示。
* **点「安装」直接用** `routes[0]`（或用户在「下载通道」下拉里手选的那条），不再等测速。
  Rust 侧仍做白名单校验（只认候选三条），桌面另加 minisign、Android 另加 sha256。
* 直连不是「有墙才用反代」：`release-assets` 的 DNS 是**间歇性**被污染 —— 直连优先、
  断了自动降级，这才是这套设计的重点。只配一条路（无论哪条）都会在某个时刻整段不可用。
* ⚠️ 2026-11-01 试过的 16 条反代里只有上表 2 条活着。腾讯云那篇「2026 最新收集」里的 7 条
  （`ghproxy.homeboyc` / `github.akams` / `gh.xxooo` / `gh-proxy.net` / `cf.ghproxy.cc` /
  `gh.nodeku` / `gh.072103`）**全部不可用**，`github.akams` 还要先选节点子域（直接拼是 404）。
  要加新反代先按上表口径实测，别照抄合集。
* **未做的第四条路**：把安装包当**仓库文件**发（`raw.githubusercontent.com` 实测 941 KB/s，
  与 `release-assets` 是不同域名 = 独立故障域），代价是每版仓库 +50 MB（APK 34.6 + exe 15.1）。

## 断点续传与状态（rev173.311）

* APK 先写 `zeronote-<版本>.apk.part`，sha256 通过才改名成正式文件 —— **半成品永不冒充
  完整包**。有 `.part` 就发 `Range: bytes=<已有>-`；206 追加、200 从头；**换路也接着续**。
* `localStorage['zn-app-update-last-result']` 存上次检查结果；`find_apk_cache(version)`
  报告 `{path, size, partial}` ⇒ 关掉设置面板再打开，「已下载」还在、「下到一半」能续。

## 改了清单后，镜像会有一段时间是旧的

2026-10-31 实测：改完 `latest.json` 并 push 后立刻验证 ——

| 源 | 立刻拿到新内容？ |
|---|---|
| `raw.githubusercontent.com` | ✅ 几乎实时（偶发限流，会返回非 JSON） |
| `ghproxy.net` | ⏱ 缓存几分钟 |
| jsDelivr `@main` | ⏱ 缓存较长（小时级） |

所以镜像顺序把 **raw 放第一**（应用内探测也是这个顺序）：内容一更新，桌面端立刻就能拿到新清单；
ghproxy / jsDelivr 只在前两个都不通时才用，滞后可接受。
急的时候别反复请求 raw（触发限流），等一两分钟再验。

## 私钥在哪

`~/.tauri/zeronote.key`（**不进仓库**，`bundle.createUpdaterArtifacts: true` 后每次打包都要它）。

> ⚠️ 私钥丢了 = **所有已装用户永远收不到自动更新**（签名校验不可关闭，只能让他们手动下一版）。
> 请把它备份到密码管理器或离线介质；不要贴进聊天、issue、commit。
