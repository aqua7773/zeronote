# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-10-25（rev173.148）** ｜ 细节与证据在 **`HANDOFF.md`**（只保留 0.5.0 周期；0.2 / 0.3 / 0.4 已归档到 `docs/archive/handoff/`）｜ 提交数一律看 `git log`
> 本卡只放**当前状态**（目标 ≤ 120 行）；历史过程一律回 HANDOFF，不再在此重复。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.148 · 0.5.0 · 2026-10-25 |
| 测试基线 | vitest 949 · cargo 52 · oxlint 3 warnings（2026-10-25） |
| 插件 | 内置 13 · 示例 37 |
| 文档 | README 现状 2026-10-25 · CHANGELOG 0.5.0 |
<!-- FACTS:END -->

## 是什么

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用（Tauri 2 + React 19 + Rust）。
一切功能靠插件：**全局目录** `<应用数据目录>/.zn/plugins/<id>/` —— 唯一位置（跨库共用；装卸＝放/删一个文件夹）。
内核 **11 原语 + 21 种 UINode + 6 个挂载位** + 真窗口 / 整窗接管 / 面板 DOM。

**内核自带**：文件树 · 回收站 · 搜索（增量索引 + 标签/目录/正则筛选）· 命令面板 · 多标签（`Ctrl+Tab`）与标签拆独立窗口 · 时间流 · 主窗口记忆 · 会话恢复 · 粘贴图片 · 全局替换 · Markdown 增强（数学 / 脚注 / Mermaid / 内嵌 HTML 白名单）· 白屏兜底。

**预装 13 个**：大纲导图 · 文档阅读器 · 导入导出 · 米色主题 · 记账 · 标签 · 反向链接 · 历史版本 · 打卡 · 同步 ×4（本地文件夹 / WebDAV / S3 / Git）。

## 验收基线（以输出为准，不写死数字）

```powershell
pwsh -File scripts\verify.ps1
# 六步：tsc 0 错误 · oxlint src 0 error · cargo test --lib · check-docs · vitest · 质量门 5 项（facts / 依赖方向 / 本地链接 / 功能目录 / 键位表）
```

## 未决 / 下一步

> **插件市场阶段 1 已完成**（rev173.148）：插件管理页「发现」tab 能列、能装、能升，装不坏（sha256 不符不落盘，
> 端到端验过）。**下一步按成本挑**：① 手机端走查一遍市场（~30 min，逻辑零平台分支，只要 `adb forward` + 点一遍）
> ② 设置页那段插件区也接市场（~1 h，它用的是 `SettingsPanel` 里的另一个列表）
> ③ 第二批 UX：详情页 / 更新角标 / 启动 24h 节流检查（调研 §4.4 第二档，~1 天）
> ④ **真要给别人用**：仓库开源（或自建可匿名访问的索引 + Release），否则默认索引匿名拉不到 —— 这是唯一的外部阻塞。

> 完整候选池（含成本与做法）在 `docs/ROADMAP.md` §3。这里只列**卡点**。

| 项 | 卡在哪 |
|---|---|
| `sync-git` 手机端 | 手机没有 token，桌面也没配过 `sync-git` |
| Gitee 分支实测 | 没有账号令牌（代码走 `POST + token`，与 GitHub 路径不同） |
| 记账文案校准 | 等真实漏识别样本（「诊断」视图已就绪） |
| 性能基线 | 用户暂缓（2026-10-19 裁决） |
| AI 标签 / 密级 | 需求 2 暂不采用，方向待定 |
| 插件市场（rev173.142 起） | **已拍板**：① 做 ② 外部作者开放 ③ 索引放本仓库 `market/index.json` ④ 签名扩到多文件（✅ **rev173.142：payload v2 覆盖 `manifest.files`**）· **阶段 0 已完成（rev173.143）**：`pack-plugin.mjs` 打包签名 → `gen-market.mjs` 合并索引（进质量门）→ `market/` 目录；`install_znp` 改**原子** · **rev173.144：正式密钥 `aqua-2026` + 13 个插件打包签名（12 签 / 1 纯样式），端到端验签 12/12** · **rev173.145：13 个包已上传 Release `plugins-v0.5.0`，sha256 与索引一致** · **rev173.146：公钥已内置进应用**（`BUILTIN_TRUSTED_KEYS` + 用户文件叠加；新装机器不再因缺 `trusted-keys.json` 拒载；`scripts/verify-trust.mjs` 用内置公钥验过 12/12 包）· **rev173.147：`ensureBuiltinPlugins` 不再覆盖市场版**（有 `signature.json` 一个字节都不写 · 已装版本更新就跳过 · 新增 `compareVersions`）· **rev173.148：应用内「发现」tab 已落地**（列表 / 安装确认 / 整包 sha256 / 失败不落盘 / 索引地址可改 / 坏条目跳过可见 / 不静默升级；桌面端到端验过装+升+篡改拒绝）· 剩余：手机走查 · 设置页接入 · 第二批 UX（详情页 / 更新角标 / 24h 检查）· 对外分发要先开源 |
| `D-008` 插件市场 / 更新通道 | 重议条件**已满足**（预装 13 > 10）⇒ **调研 + 形态设计已做**：`docs/插件市场-调研-2026-10-25.md`（**§4.4 形态**：市场 = 插件管理页第二个 tab，入口沿用现有三个，安装 4 步含「验签失败不落盘」，**不做静默升级**；**§4.5 开发者**：官方插件零手工、外部作者索引不存版本号只存 `entry`）· **不需要服务端** · 阶段 0 = 纯脚本 **2 h** / 零内核改动 / 随时可停 · 待拍板 4 点：做不做/哪层 · 外部作者现在开放吗 · 索引托管在哪 · **签名扩不扩**（已给建议：**现在扩** —— 0 个插件签过名、1.5 h；分发后再扩 = 已签名包全部失效、用户侧表现为插件加载失败） |
| M3 收尾④ 真机「编辑→保存」人工确认 | 旧悬置（实机早已能保存，可忽略） |

## 环境现状（活信息 · 2026-10-25）

- **桌面 dev**：双击 `dev.cmd`（vite 1420 · CDP 9222 · 日志 `.self-logs/desktop-dev.log`）。**别用后台 job 托管**（会随会话回收）；**别用管理员跑**（污染 WebView2 UDF ⇒ `0x800700AA`，已污染就用 `scripts\dev.ps1` 绕开）。
- **Low IL 会让 dev 起不来**：`icacls src-tauri /setintegritylevel (OI)(CI)Medium`（`target` 同步）。判据 = `create_dir_all` 报「拒绝访问 (os error 5)」。
- **改 `tauri.conf.json` / `Cargo.toml` ⇒ tauri CLI 自动重编并重启**（重编期间与 `cargo test` 争 `CARGO_TARGET_DIR`，verify 等几分钟是排队不是卡死）。dev 窗口「关于」的版本号由 **vite 启动时**求值，改 `package.json` 不热更新。
- **Android dev**：`android-dev.cmd`（日志 `.self-logs/android-dev.log`）· gradle wrapper 走腾讯镜像 · `rustup` 操作必须串行。
- **手机 `33b676f6` = 测试机，只跑已装的 dev 包**：`adb -s 33b676f6 shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity`。adb 里有两个离线残留 ⇒ 所有命令带 `-s 33b676f6`。
  - ⚠️ **`adb reverse tcp:1420 tcp:1420` 会丢** —— 丢了表现为「启动 15 秒后无声退出」（看门狗杀进程）。重连 adb / 重启后先补这条再 `am start`。
  - ⚠️ **☰ 短按 = 抽屉 · 长按 600ms = 菜单**；CDP `click` 点不动长按，得 `adb shell input motionevent DOWN/UP`。
  - 手机 CDP：`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`（换进程先 `forward --remove`），`ZN_CDP=http://127.0.0.1:9333 ZN_TARGET=tauri.localhost`。
- **桌面 CDP**：9222 · 坐标有 **32px 垂直偏移**（`.zn-titlebar`）· 菜单入口 = **右键 ☰**（左键开文件树栏）。
- **测试库** `_tmp-vault-tb/`（不入库）· **插件只有全局目录一处**，测试插件只放 `examples/`、用完即删。
- **Git**：GitHub `aqua7773`（gh 已登录、keyring）· `git push` **先直连，被 reset 再挂本机代理 `$env:HTTPS_PROXY='http://127.0.0.1:26561'`**。
- **Rust**：`CARGO_TARGET_DIR` 必须在工作区外（本机铁律）；Rust 测试临时目录 `<repo>/_tmp-test/`。
- **补丁**：`patches/@atomic-editor__editor@0.6.2.patch`（空标题不隐藏 `#`），升级必须重打 · `.gitignore` 排除 `_shots/` `_tmp-*/` `examples/*/store.json`。
- **插件签名密钥（2026-10-25 生成）**：keyId **`aqua-2026`** · 私钥 `%USERPROFILE%\.zeronote-keys\aqua-2026.key.pem`（**仓库外，绝不入库**）· **公钥已内置进应用**（rev173.146，`src-tauri/src/lib.rs` 的 `BUILTIN_TRUSTED_KEYS`；改它要跑 `node scripts/verify-trust.mjs`）· 本机那份 `<APPDATA>\com.aqua.zeronote\.zn\trusted-keys.json` **不再是必需**（同 keyId 只会覆盖内置值），留着无害 · 公钥值 `iOIIUrkdKmP0w+pwpgqGiqSsLJYfl9Pa5VeUCBCjh6E=`
- **插件包与市场**：`dist/*.znp` 是构建产物（不入库）；13 个包已上传 Release **`plugins-v0.5.0`**；索引 `market/index.json` 13 条（`node scripts/gen-market.mjs --write` 重建，已进质量门）；打包用 `node scripts/pack-plugin.mjs <id> --key <私钥> --tag plugins-v0.5.0`
- **dev 崩溃**：连续多次 HMR 会 `0xc0000374`，重启即恢复 · **别用 `plugin:window|destroy` 关窗口**（会连主窗口一起没）。

## 硬约束

1. capability / 安全模型变更 → 先拿用户对「具体方案」的同意（方向同意 ≠ 方案同意）。
2. 每批交付：`verify.ps1` 全过 ＋ 实测证据 ＋ 提交 ＋ HANDOFF 新 rev。
3. 手机截图走 `adb shell screencap`；**CDP `shot` 抓不到 WebView 里的 canvas**。
4. **内核保持薄**；**静默失效比报错危险**（看数字，不只看 "ok"）。
5. GUI 验收用 `gentle_*`；截图按窗口 `rect` 向内缩 ~10px。
6. **动手前先查现成**（`docs/开发约定.md` §0.5：同类案例 / 官方文档 / 项目内已有能力）；改代码 / 重构前先读该文档。
7. **安卓测试机只跑已装的 dev 包，不重新编译 / 安装**：改前端 → 页面 `location.reload()` 即生效；只有改 Rust / 原生插件才需要重装 APK；**不装 release 包**。
8. **测试 / 验收产生的插件不留在「功能」里**：探针 / 夹具 / 演示只放 `examples/` 或临时目录，用完即删；不进 `BUILTIN_PLUGINS`、不进预装。
9. **改 `examples/` 后必须让页面 reload 再重扫**：`ensureBuiltinPlugins` 会用 vite `?raw` 的内容**覆盖**全局目录。

## 授权边界（给 AI）

- 已授权：工作区内建目录 / 写文档 / 装 npm 依赖 / 构建运行 / 并发子 agent / git 提交 / 项目级配置。
- 需批准：装系统级软件 · 改 PATH / 注册表 · `rustup target add` · `tauri android init` · 发 GitHub 仓库 · 任何删除。

## 细节读哪

`HANDOFF.md`（当前版本周期的索引）· `docs/内核契约-v0.2.md` · `docs/架构原则-2026-10-13.md`（**冲突时以它为准**）· `docs/README.md`（权威矩阵）· `docs/系统总览.md` · `docs/同步插件-调研与方案-2026-10-24.md` · `tools/verify-*.mjs`

> 旧卡（539 行，含 2026-10-19 ~ 25 的逐项历史）看 git 历史：`git show ea3288e:HANDOFF-CARD.md`
