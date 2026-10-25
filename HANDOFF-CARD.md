# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-10-26（rev173.163）** ｜ 细节与证据在 **`HANDOFF.md`**（只保留 0.5.0 周期；0.2 / 0.3 / 0.4 已归档到 `docs/archive/handoff/`）｜ 提交数一律看 `git log`
> 本卡只放**当前状态**（目标 ≤ 120 行）；历史过程一律回 HANDOFF，不再在此重复。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.163 · 0.5.0 · 2026-10-26 |
| 测试基线 | vitest 1030 · cargo 52 · oxlint 3 warnings（2026-10-26） |
| 插件 | 内置 13 · 示例 39 |
| 文档 | README 现状 2026-10-26 · CHANGELOG 0.5.0 |
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
# 六步：tsc 0 错误 · oxlint src 0 error · cargo test --lib · check-docs · vitest · 质量门 7 项（facts / 依赖方向 / 本地链接 / 功能目录 / 键位表 / 市场索引 / 外部条目审查）
```

## 未决 / 下一步

> **密码库（rev173.163）已完成**：`examples/secrets/` 消费 `security` 的 `crypto` 服务（软依赖，缺了降级提示）·
> 整库密文 `.zn/secrets/secrets.zn`（AAD `secrets|secrets`）· 平台/账号两级 · 搜索**不含密码** · 16 位生成器（排除 `0O1lI`）·
> 显示 15 秒收起 · 复制 **60 秒清剪贴板** · 回收站 7 天 · **空闲 60 秒自动锁** · 内核加了 `input.secret`（`type=password`）·
> 27 条单测 + CDP 实测 12 项 · **未签名发市场**（要装得手动放 `.zn/plugins/`）。方案 §4.5。
> **安全插件（rev173.160–162）已完成并上线**：`examples/security/` **双密钥环**（私密笔记 / 账号密码**各一把主密码**，
> 互不派生）· XChaCha20-Poly1305 + Argon2id · `crypto` 服务**只给操作不给密钥** · 25 条单测 + CDP 实测九项 ·
> **已签名发到市场（14 条）、不预装**（用户决定）· 已推送 `981b114`、CI 全绿。方案见 `docs/安全插件-方案-2026-10-25.md`。
> **上一个会话（rev173.154–158）**：CI 从「每个 run 都红」修到全绿（`localeCompare` 不传 locale）· 开源配套
> （issue/PR 模板 + `CONTRIBUTING.md`）· 市场第二批 UX（详情页 / 更新角标 / 24h 检查）· CI Rust 缓存 · 审查材料生成器。
> **下一步**：
> ① **期 1c 同步放行 `.zn/secrets/`**（四个同步插件；现在 `.zn/` 整段被排除 ⇒ 密码库同步不出去），冲突保留两份 ·
> ② `secrets` 签名发市场（与 `security` 同路，一行 `pack-plugin` + `gen-market --write`）·
> ③ 插件数涨到几十个时换 CDN / 自建源（raw 偶发连不上 + 按 IP 限流，见 rev173.151）·
> ④ 第一个外部作者投稿时按 `market/README.md` 的「审 PR」走（`--online` 出材料）·
> ⑤ 卡点表前三行要外部输入（sync-git 手机端 / Gitee 令牌 / 记账样本）。
> 公开仓库配套**已齐**：topics 14 个、CI 缓存、`CONTRIBUTING.md`、issue/PR 模板、审查材料生成器。

> 完整候选池（含成本与做法）在 `docs/ROADMAP.md` §3。这里只列**卡点**。

| 项 | 卡在哪 |
|---|---|
| `sync-git` 手机端 | 手机没有 token，桌面也没配过 `sync-git` |
| Gitee 分支实测 | 没有账号令牌（代码走 `POST + token`，与 GitHub 路径不同） |
| 记账文案校准 | 等真实漏识别样本（「诊断」视图已就绪） |
| 性能基线 | 用户暂缓（2026-10-19 裁决） |
| AI 标签 / 密级 | 需求 2 暂不采用，方向待定 |
| 插件市场 | ✅ **已完成**（rev173.142–158）：签名 v2 / 打包 / 索引 / 原子安装 / 公钥内置 / 「发现」tab（装 · 升 · 详情页含能力自述 · 更新角标 · 24h 检查）/ 外部投稿审查材料生成器。逐 rev 证据见 `HANDOFF.md`；待办只剩「插件数到几十个时换 CDN」。 |
| `D-008` 插件市场 / 更新通道 | ✅ **已完成**（rev173.142–158 落地，不需要服务端）：形态 §4.4 + 开发者流程 §4.5 见 `docs/插件市场-调研-2026-10-25.md`。 |

## 环境现状（活信息 · 2026-10-25）

- **桌面 dev**：双击 `dev.cmd`（vite 1420 · CDP 9222 · 日志 `.self-logs/desktop-dev.log`）。**别用后台 job 托管**（会随会话回收）；
  AI 自己要起时用 `Start-Process -FilePath cmd.exe -ArgumentList "/c","dev.cmd" -WindowStyle Minimized`（独立进程，等价双击，rev173.152 实测可用）；
  **别用管理员跑**（污染 WebView2 UDF ⇒ `0x800700AA`，已污染就用 `scripts\dev.ps1` 绕开）。
  ⚠️ 本卡最后更新时 **dev 是开着的**（pid **11660** · 19:47 启动），日志在 `.self-logs/desktop-dev.log`。
- **Low IL 会让 dev 起不来**：`icacls src-tauri /setintegritylevel (OI)(CI)Medium`（`target` 同步）。判据 = `create_dir_all` 报「拒绝访问 (os error 5)」。
- **改 `tauri.conf.json` / `Cargo.toml` ⇒ tauri CLI 自动重编并重启**（重编期间与 `cargo test` 争 `CARGO_TARGET_DIR`，verify 等几分钟是排队不是卡死）。dev 窗口「关于」的版本号由 **vite 启动时**求值，改 `package.json` 不热更新。
- **Android dev**：`android-dev.cmd`（日志 `.self-logs/android-dev.log`）· gradle wrapper 走腾讯镜像 · `rustup` 操作必须串行。
- **手机 `33b676f6` = 测试机，只跑已装的 dev 包**：当前装的是 **0.5.0**（2026-10-25 19:34 装，含 `install_znp_from_url`；
  再早的 0.4.0 包没有市场安装命令）。启动：`adb -s 33b676f6 shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity`。
  adb 里有两个离线残留 ⇒ 所有命令带 `-s 33b676f6`。改前端不用重装（连桌面 dev 的 vite，reload 即生效）；**改 Rust 必须重装**。
  - ⚠️ **`adb reverse tcp:1420 tcp:1420` 会丢** —— 丢了表现为「启动 15 秒后无声退出」（看门狗杀进程）。重连 adb / 重启后先补这条再 `am start`。
  - ⚠️ **☰ 短按 = 抽屉 · 长按 600ms = 菜单**；CDP `click` 点不动长按，得 `adb shell input motionevent DOWN/UP`。
  - 手机 CDP：`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`（换进程先 `forward --remove`），`ZN_CDP=http://127.0.0.1:9333 ZN_TARGET=tauri.localhost`。
- **桌面 CDP**：9222 · 坐标有 **32px 垂直偏移**（`.zn-titlebar`）· 菜单入口 = **右键 ☰**（左键开文件树栏）。
- **测试库** `_tmp-vault-tb/`（不入库）· **插件只有全局目录一处**，测试插件只放 `examples/`、用完即删。
- **Git**：GitHub `aqua7773`（gh 已登录、keyring）· `git push` **先直连，被 reset 再挂本机代理 `$env:HTTPS_PROXY='http://127.0.0.1:26561'`**。
- **Rust**：`CARGO_TARGET_DIR` 必须在工作区外（本机铁律）；Rust 测试临时目录 `<repo>/_tmp-test/`。
- **补丁**：`patches/@atomic-editor__editor@0.6.2.patch`（空标题不隐藏 `#`），升级必须重打 · `.gitignore` 排除 `_shots/` `_tmp-*/` `examples/*/store.json`。
- **插件签名密钥（2026-10-25 生成）**：keyId **`aqua-2026`** · 私钥 `%USERPROFILE%\.zeronote-keys\aqua-2026.key.pem`（**仓库外，绝不入库**）· **公钥已内置进应用**（rev173.146，`src-tauri/src/lib.rs` 的 `BUILTIN_TRUSTED_KEYS`；改它要跑 `node scripts/verify-trust.mjs`）· 本机那份 `<APPDATA>\com.aqua.zeronote\.zn\trusted-keys.json` **不再是必需**（同 keyId 只会覆盖内置值），留着无害 · 公钥值 `iOIIUrkdKmP0w+pwpgqGiqSsLJYfl9Pa5VeUCBCjh6E=`
- **插件包与市场（rev173.150 起）**：包**入库**在 `market/packs/*.znp`（13 个 · 573 KB），索引 `market/index.json` 13 条，
  下载 URL = `raw.githubusercontent.com/aqua7773/zeronote/main/market/packs/…`（**不是 Release**：`github.com:443` 国内直连不通，
  走 Release 会「能看不能送」）。打包 `node scripts/pack-plugin.mjs <id> --key <私钥>`（默认就写 `market/packs/` + raw url）→
  `node scripts/gen-market.mjs --write`（会校验「包在不在 + sha256 对不对」）→ 提交 `market/`。
  `dist/*.znp` 仍是不入库的构建产物；Release `plugins-v0.5.0` 那 13 个包**留着当镜像**，索引不再指向它。
- **仓库已开源**（2026-10-25 · MIT）：https://github.com/aqua7773/zeronote（public）。`LICENSE` + README 顶部免责已补。
  **topics** 14 个（2026-10-25 加，便于搜索发现）；描述已在。改：`gh repo edit aqua7773/zeronote --add-topic <t>`。
- **CI**：`.github/workflows/verify.yml`（windows-latest，push / PR 都跑）＝ `verify.ps1` 六步，质量门走
  `check-gates.mjs`（与本地唯一入口一致，别在 workflow 里逐条重列）。2026-10-25 之前**每个 run 都是红的**
  （根因：`localeCompare` 不传 locale，runner 的 en-US 下中文排序与本机 zh-CN 不同）⇒ rev173.154 修，
  **rev173.155 首次确认全绿**（15 步 · 4m45s · run `40192229548`）；
  **rev173.157 起有 Rust 缓存**（`Swatinem/rust-cache@v2`）：命中时整 run **2m33s**、Cargo 步骤 **41s**
  （未命中 5m17s —— 首次要把缓存打包上传）。改 `Cargo.lock` / 升 rustc 会让缓存失效一次，属正常。
  **交接时最近三次 run 全 success**：2m24s（rev173.158）/ 2m39s / 2m39s。
- **市场实测要看新字段时**（rev173.156 实证过）：索引默认拉 GitHub raw、**推送前的改动看不到** ⇒
  仓库根起 `python -m http.server 8931 --bind 127.0.0.1`，页面里
  `localStorage.setItem('zn-market-index-url','http://127.0.0.1:8931/market/index.json')` → reload；
  测完 `removeItem` 恢复并停服务。`window.__znExec('core.plugins' / 'core.settings')` 可直接进页面，不必点菜单。
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
