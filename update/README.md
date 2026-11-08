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
仓库 raw 镜像列表（raw / Gitee / ghproxy）已经覆盖国内网络；用户还能在「关于 → 更新」
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

## 渠道（rev173.440）：一个渠道 = 一个完整源

「关于 → 更新」只有一个**更新渠道**下拉（**手动「测速」按钮保留**）。
渠道表与插件市场 `MARKET_MIRRORS` 同一套 id 与顺序（前端 `src/kernel/app-update.ts` 的
`UPDATE_MIRRORS` / Rust `updates.rs` 的 `MIRRORS`）：

| 渠道 | 清单 | 安装包 |
|---|---|---|
| `raw`（GitHub raw） | ✅ | GitHub Release 直连（同一家） |
| `gitee`（国内直连） | ✅ | Gitee 同名 Release 附件（前缀替换） |
| `gitlab`（极狐，国内直连） | ✅ | 极狐分发仓库的 generic package：`https://jihulab.com/api/v4/projects/384964/packages/generic/zeronote/<版本>/<文件>`（**匿名可下，实测 11.7 MB/s、支持 Range**；网页式 `/-/packages/…` 需登录，别用） |
| `ghproxy`（第三方反代） | ✅ | `https://ghproxy.net/<Release 地址>` |

> **极狐分发仓库**（rev173.441）：`aqua7773/zeronote-dist`，**只放 `market/` 与 `update/`，不含源码**。
> 同步：`node scripts/sync-dist.mjs`；传安装包：`node scripts/sync-dist.mjs --assets <版本> <exe> [apk]`。
> 配置放**用户级环境变量** `GITLAB_SITE` / `GITLAB_USER` / `GITLAB_REPO` / `GITLAB_PROJECT_ID` / `GITLAB_TOKEN`
> （2026-11-08 用户拍板：存环境变量，不落盘明文；脚本会回读 `HKCU\Environment`，当前会话刚写入也能用），**不进仓库**。

**同源规则（2026-11-08 用户拍板）**：校验更新和实际下载必须走**同一个渠道**；
测速测的是**这个源下载安装包的速度**，不再是「能不能拉到清单」。

* 旧设计（rev173.300–311）里有「渠道」+「下载通道」两个下拉：渠道只管清单，安装包在
  `direct / ghproxy / gh-proxy` 三条里并发测速。**已废弃** —— 它让用户看到「清单是新的、包下不来」，
  而且 jsDelivr 这类只能镜像仓库文件的源在应用更新里没有意义（拿不到 Release 附件，还会缓存旧清单）。
* **jsDelivr 三条已全部移除**（应用更新 + 插件市场）。别再加回来：它不满足「完整源」。
* 选中的渠道存 `localStorage['zn-app-update-mirror']`；启动静默检查不指定渠道，按表顺序自动探测。
* 清单里的 `url` 仍写成 ghproxy 前缀 —— 客户端先 `canonical_asset_url()` 剥回 GitHub 直链，
  再按**当前渠道**改写（`rewrite_asset_url`）。这样 ≤0.9.3 的旧客户端（只会原样用清单 url）不会被改坏；
  **别把脚本改成直链**。
* 测速命令 `probe_update_mirror`：拉清单拿版本 **+ 用这个源实下安装包前 256 KB 算速度**。
  「可用」= 清单能解析 **且** 包下得动（只看状态码会被错误页骗）。

## 安装包下载（rev173.440）：只用当前渠道那一条

* 检查更新时：命中渠道 + 有新版 ⇒ `probe_mirror_asset()` 只测**这一个源**那一条路径
  （`Range: bytes=0-262143`，256 KB 算速度；先跟随系统代理，失败再直连重测一次）。
  已是最新时不测 —— 不为不会发生的下载多花几秒。
* 点「安装」直接用检查阶段测好的地址；Rust 侧再核一次「这个地址是否等于本源改写结果」，
  不等于就忽略并记日志 —— **校验走哪个源，下载就走哪个源**。
* 桌面另加 minisign、Android 另加 sha256；Android 断点续传不变（**换源 = 用户自己换渠道重来**）。
* 直连不是「有墙才用反代」：`release-assets` 的 DNS 间歇性被污染 —— raw 渠道优先直连，
  但失败时它**不会**偷偷换到别的渠道（那会变成「清单是新源、包是旧源」）。

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
| ~~jsDelivr `@main`~~ | ❌ 已移除（rev173.440）：缓存小时级，常显示旧版本 |

所以镜像顺序把 **raw 放第一**（应用内探测也是这个顺序）：内容一更新，桌面端立刻就能拿到新清单；
ghproxy 只在前两个都不通时才用，滞后可接受。
急的时候别反复请求 raw（触发限流），等一两分钟再验。

## 私钥在哪

`~/.tauri/zeronote.key`（**不进仓库**，`bundle.createUpdaterArtifacts: true` 后每次打包都要它）。

> ⚠️ 私钥丢了 = **所有已装用户永远收不到自动更新**（签名校验不可关闭，只能让他们手动下一版）。
> 请把它备份到密码管理器或离线介质；不要贴进聊天、issue、commit。
