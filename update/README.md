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

**第 5 步不能省**：客户端按 `raw / ghproxy / jsDelivr` 的镜像顺序读**仓库里**的清单；
Release 上那份只是给人下载用的备份。

## 为什么清单不进 Release

`plugins.updater.endpoints` 的语义是「非 2xx 才试下一个」，连接被 RST 属于网络错误 ——
它会直接失败、不会换镜像（详见 `src-tauri/src/updates.rs` 头部注释）。
所以镜像选择必须在我们自己的代码里做，清单也就必须能在**任意一个可达的静态地址**上取到。
仓库 raw 镜像列表（raw / ghproxy / jsDelivr ×2）已经覆盖国内网络。

## 私钥在哪

`~/.tauri/zeronote.key`（**不进仓库**，`bundle.createUpdaterArtifacts: true` 后每次打包都要它）。

> ⚠️ 私钥丢了 = **所有已装用户永远收不到自动更新**（签名校验不可关闭，只能让他们手动下一版）。
> 请把它备份到密码管理器或离线介质；不要贴进聊天、issue、commit。
