# 项目交接

revision: 4
更新时间: 2026-10-11
标识: DSH-SUPERVISOR-V1
项目: ZeroNote

> **主管模式尚未启用**（用户未说「负责 ZeroNote 项目」）。当前由普通会话直接执行；用户已授权**并发调用子 agent**。

## 当前目标

做一个**空内核**的本地 Markdown 笔记应用：内核只负责 `.md` 读写 / 编辑 / 本地存储 / 插件宿主，其余功能全部插件化、可独立装卸升级；桌面 + Android 双端。

## 验收证据

| 项 | 证据（命令 / 输出 / 文件） | 基线版本 | 时间 |
|---|---|---|---|
| 需求分析冻结 | `_笔记应用选型\内核需求分析-v0.1.md` | — | 2026-10-11 |
| 内核契约 v0.1 | `docs\内核契约-v0.1.md`（8 原语 + manifest + capability + 无沙箱声明 + §7 未决 6–9） | — | 2026-10-11 |
| **M1 内核单测** | `cargo test` → **9 passed / 0 failed** | `cargo-targets\zeronote` | 2026-10-11 |
| **M1 前端检查** | `tsc -b` 0 错误；`oxlint` 0 error | — | 2026-10-11 |
| **M1 窗口实跑** | `_shots\m1-01.png` | — | 2026-10-11 |
| **M2 插件加载** | `_shots\m2-02.png`：文件树递归（含中文目录）、**`.zn` 私有目录被跳过**、插件列出且 capability 徽章正确、状态栏「插件 1/1」 | — | 2026-10-11 |
| **M2 两插件共存** | `_shots\m2-04.png`：右栏 3 个 tab（插件 / Hello 插件 / 灵感流），插件 2/2 | — | 2026-10-11 |
| **声明式 UI 渲染** | `_shots\m2-05.png`：灵感流面板（title / caption / input / button / 空态）**全部由 UINode 渲染，插件零 React 代码** | — | 2026-10-11 |
| **命令注册** | `_shots\m2-11-palette.png`：`Ctrl+K` 命令面板列出 8 条（5 `core.*` + `hello.say` + 2 `inspiration-flow.*`） | — | 2026-10-11 |
| **命令执行 + 拒发** | `_shots\m2-13-click-cmd.png`：空 payload 执行 `inspiration-flow.capture` → toast「内容为空，没有落盘」 | — | 2026-10-11 |
| **🎯 端到端落盘** | `_shots\m2-14-btn-empty.png`：面板显示「已捕捉 1 条」+ 列表项 + status「已捕捉 → 灵感/2026-10-11/16-22-44.md」+ toast；**磁盘实测** `_test-vault\灵感\2026-10-11\16-22-44.md`（12 B，**UTF-8 无 BOM、LF**，目录自动创建） | — | 2026-10-11 |
| 子 agent 调研 | `_research\插件API对比.md`（535 行）、`_research\android-env-check.md`（185 行 / 25 项） | — | 2026-10-11 |

## 未完成项

- [ ] **M3 Android** —— 环境检查已完成，**2 项阻塞待用户批准**：① `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` ② `pnpm tauri android init`
- [ ] **`devUrl` 改回**：现在是 `http://localhost:1420/?vault=C:/…/\_test-vault`（本轮验证用），应改回 `http://localhost:1420`
      —— 已改回 ✅（2026-10-11，`6c56865`）
- [ ] **Android 首次启动要自动建库**：Android 默认库是 `<appDataDir>/vault`，首次不存在时 Rust `list_notes` 会返回「库目录不存在」⇒ 需要加 `ensure_vault` 命令（或在首次启动放一篇欢迎笔记）。当前临时可行：点「＋」新建一篇即会自动建目录
- [ ] 内核契约 v0.1 待用户过目（§1 八原语、§4 capability、§7 未决）
- [ ] 面板 `location` 未分流（`sidebar`/`main`/`modal` 目前都进右栏 tab）—— 灵感流声明的是 `main`（全宽），v0.2 支持
- [ ] `index` 原语（v0.2，现调用抛「未实现」）；`doc.on` 文档事件订阅（v0.2）
- [ ] UI 打磨（Tailwind + shadcn/ui 未引入，当前自建 `--zn-*` token）
- [ ] 更多真插件（画布 / 同步 / AI 等，用户说清单「先保留」）

## 唯一下一步

二选一：
- **A（推荐）**：批 M3 的两条命令 → 打通 Android 双端（系统件已全齐）
- **B**：继续写插件（下一批候选：Git 同步 / 画布 / 标签搜索）

## 授权边界

- 已授权：工作区内建目录/写文档/装 npm 依赖/构建运行本地应用/**并发调用子 agent**/git 提交/项目级配置/URL 参数启动/**窗口截图与合成鼠标键盘操作（用于自动化验收）**
- 需用户批准：装系统级软件、改 PATH / 注册表、**`rustup target add`**、**`tauri android init`**、发 GitHub 仓库、任何删除操作
- 明确不做：浏览器版；以 HTML 为笔记真源；把功能写进内核（一律走插件）

## 备注

### 自动化验收方法论（本轮实测，别再踩）

- **窗口截图**：`PrintWindow(hwnd, hdc, 2)`（`PW_RENDERFULLCONTENT`）能抓到 WebView2 内容；配合 `GetWindowRect` 得到窗口坐标。**最小化窗口返回 (-32000,-32000)** → 必须先 `ShowWindow(h, 9)`（SW_RESTORE）再取坐标。
- **合成键盘**：字母键（`keybd_event`）能进 WebView2 ✅；**Enter（VK 0x0D）进不去** ❌（已用命令面板对照实验确认）⇒ **不要用合成 Enter 做验收**。
- **合成鼠标**：可行，但**悬停要 ≥300ms、按压 ≥90ms**，否则 React 的 click 可能不触发（悬停 200ms + 按压 60ms 时实测失败）。
- **中文输入法会转换合成输入**：输入 `zntest` 落盘变成「只能testx」——测试文本请用不含拼音歧义的字符串。

### 技术事实

- 本机铁律：Rust 产物必须 `CARGO_TARGET_DIR` 外移（工作区内编 C 依赖报 MSVC D8050）；crates.io 直连仅 ~34 KB/s ⇒ 项目级 `.cargo\config.toml` 走 rsproxy
- **启动（桌面）**：双击 `dev.cmd`；**不要用 DSH 后台 job 起**（会随会话回收）。改 `src-tauri\tauri.conf.json` 会被 tauri CLI 自动检测并**重启应用**；改 `src/**` 只热更新；**改库内 `.zn\plugins\**` 需要重启或点「重新扫描」**（vite 不监视库目录）
- **启动（Android）**：`android-dev.cmd`（WMI 起，日志落 `.self-logs\android-dev.log`）。三条硬前置：① 默认工具链装 4 个 android target（`rustup target add`）② **vite 必须 `host: true`**（真机经局域网 IP 访问 dev server；否则卡在 "Waiting for your frontend dev server"）③ Android 上**不能**用 PC 路径当库 ⇒ 已改为「应用数据目录/vault」
- **gradle wrapper 必须走国内镜像**：默认 `services.gradle.org` 在本机**5 分钟 0 字节卡死**；已把 `src-tauri\gen\android\gradle\wrapper\gradle-wrapper.properties` 改为 `mirrors.cloud.tencent.com/gradle/`（**8 秒下完**）
- **rustup 操作必须串行**：`tauri android init` 自己也会装 target，与手动 `rustup target add` 并发会报 `detected conflict ... rolling back changes`
- **`.gitattributes` 的 `* text=auto eol=lf` 会损坏二进制**：gradle wrapper 的 `.jar` 必须显式 `*.jar binary`（否则入库即坏）
- 已移除 StrictMode（`src\main.tsx`）：插件加载是异步 + 副作用密集，双调用会与异步清理竞争
- git 分支 `main`；本地身份 `git config --local`
- 交接不保存密钥、不保存完整会话正文
