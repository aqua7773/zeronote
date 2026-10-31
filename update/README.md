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

原因：updater 拿到这个 URL 就直接下载安装包，而国内网络**直连 `github.com:443` 不通**
（2026-10-31 本机 `git push` 实测 `curl 28 Failed to connect`）；用户开着系统代理时
reqwest 能借代理出去，一关代理就必然失败。ghproxy 前缀那条实测两端都 200、字节数一致。

* 想在海外 / 自建反代环境用原始地址：`$env:NO_GH_MIRROR=1; node scripts/gen-update-manifest.mjs`
* ghproxy 挂了怎么办：应用内更新会报错，用户到 Release 页面手动下（浏览器可配代理）。

## 渠道（rev173.300）：和插件市场同一套

「关于 → 更新」里有 **更新渠道下拉 + 测速**，渠道表与插件市场 `MARKET_MIRRORS` 同一套
id 与顺序（前端 `src/kernel/app-update.ts` 的 `UPDATE_MIRRORS` / Rust `updates.rs` 的 `MIRRORS`）：

| 渠道 | 清单 | 安装包 |
|---|---|---|
| `raw`（GitHub raw） | ✅ | GitHub 直链 |
| `jsdelivr-gcore` · `jsdelivr-testingcf` · `jsdelivr` | ✅ | GitHub 直链（**jsDelivr 只服务仓库文件，拿不到 Release 附件**） |
| `ghproxy`（第三方反代） | ✅ | ✅ `https://ghproxy.net/<Release 地址>` |

* 选中的渠道存 `localStorage['zn-app-update-mirror']`，检查与下载都按它走；
  启动时的静默检查**不指定渠道**（按表顺序自动探测，谁先 200 用谁）。
* 清单里的 `url` 仍写成 ghproxy 前缀 —— 客户端先 `canonical_asset_url()` 剥回 GitHub
  直链，再按渠道 `rewrite_asset_url()` 路由。这样 ≤0.9.3 的旧客户端（只会原样用清单
  url）不会被改坏；**别把脚本改成直链**。
* 测速命令 `probe_update_mirror`：拉清单并**解析出版本**（只看状态码会被错误页骗），
  桌面再 HEAD 一下安装包。**HEAD 可达 ≠ 下载快**：2026-10-31 实测 ghproxy HEAD 200，
  但 15 MB 装包只有 ~10 KB/s（20 分钟以上）。

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
