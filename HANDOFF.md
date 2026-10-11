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
| **🎯 M3 真机跑通** | `docs\evidence\m3-android-real-device.png`：APK 152.2 MB 装到真机 **User 0**、进程运行、UI 完整渲染、库路径 `/data/user/0/com.aqua.zeronote.debug/files/vault` | APK debug | 2026-10-11 16:36 |
| 子 agent 调研 | `_research\插件API对比.md`（535 行）、`_research\android-env-check.md`（185 行 / 25 项） | — | 2026-10-11 |

## 未完成项

- [x] **M3 Android 真机跑通**（2026-10-11 16:36）：`tauri android init` + `rustup target add`（4 ABI）+ gradle 走腾讯镜像 → APK **152.2 MB** → 装到真机 **User 0** 并启动 ✅
      证据：`docs\evidence\m3-android-real-device.png`（包名 `com.aqua.zeronote.debug`，进程 `u0_a317 16231`，库路径 `/data/user/0/com.aqua.zeronote.debug/files/vault`）
- [x] **M3 收尾①：响应式布局** ✅（2026-10-11）—— 窄屏单栏 + ☰ 抽屉侧栏 + 遮罩 + 选完自动收抽屉；真机截图确认（`_shots\android-07.png`）
- [x] **M3 收尾②：Android 首次自动建库** ✅ —— 新增 Rust 命令 `ensure_vault`（建库目录 + `.zn`），前端在设默认库后调用；真机确认 `/data/user/0/com.aqua.zeronote.debug/vault/.zn` 已建出
- [x] **M3 收尾③：移动端安全区** ✅（真机实测暴露的额外问题）—— Android 状态栏遮挡顶栏与抽屉（`☰`/`＋` 点不到）；已加 `viewport-fit=cover` + `env(safe-area-inset-*)`（`.zn-app` 与两个抽屉都吃安全区）
- [ ] **M3 收尾④：真机「编辑 → 保存」待人工验证** —— 合成点击（`adb shell input tap`）点「＋」未触发新建（WebView 内的命中不稳定），不再耗轮次猜坐标。
      **请人工在手机上点一次**：`☰` → `＋` → 随便输入 → 停 1 秒（自动保存）→ 库目录应出现 `untitled-*.md`
      核对命令：`adb shell run-as com.aqua.zeronote.debug ls -la /data/user/0/com.aqua.zeronote.debug/vault`
- [ ] **`devUrl` 改回**：现在是 `http://localhost:1420/?vault=C:/…/\_test-vault`（本轮验证用），应改回 `http://localhost:1420`
      —— 已改回 ✅（2026-10-11，`6c56865`）
- [ ] **Android 首次启动要自动建库**：Android 默认库是 `<appDataDir>/vault`，首次不存在时 Rust `list_notes` 会返回「库目录不存在」⇒ 需要加 `ensure_vault` 命令（或在首次启动放一篇欢迎笔记）。当前临时可行：点「＋」新建一篇即会自动建目录
- [ ] 内核契约 v0.1 待用户过目（§1 八原语、§4 capability、§7 未决）
- [ ] 面板 `location` 未分流（`sidebar`/`main`/`modal` 目前都进右栏 tab）—— 灵感流声明的是 `main`（全宽），v0.2 支持
- [ ] `index` 原语（v0.2，现调用抛「未实现」）；`doc.on` 文档事件订阅（v0.2）
- [ ] UI 打磨（Tailwind + shadcn/ui 未引入，当前自建 `--zn-*` token）
- [ ] 更多真插件（画布 / 同步 / AI 等，用户说清单「先保留」）

## 唯一下一步

**1. 等人工确认 M3 最后一步**：手机上点 `☰` → `＋` → 输入 → 停 1 秒 → 库里应出现 `untitled-*.md`
（`adb shell run-as com.aqua.zeronote.debug ls -la /data/user/0/com.aqua.zeronote.debug/vault`）
—— 合成点击（`adb shell input tap`）在 WebView 内命中不稳定，已试 6 次不再试。

**2. 之后的议程（M4 候选，按价值排序）**：

| # | 议题 | 为什么现在做 |
|---|---|---|
| **A** | ~~Android 库位置 + 插件分发~~ → **✅ 已采纳方案 D 并真机实测通过（2026-10-11 17:03）** | **调研结论**（两份报告：`_research\移动端插件分发调研.md` 337 行 + `_research\tauri-android-file-access.md`）：① 移动端可以有插件（Joplin 官方支持，Android 能 `Install from file`；限制只有 iOS 商店政策 + 沙箱只跑 HTML/JS —— 我们正好是 JS+声明式 UI）② 库放共享存储是主流（Obsidian 官方推荐 device storage；**SiYuan 用私有目录被社区 fork 修掉**）③ **Tauri 在 Android 上没有 SAF 支持**（issue #11733 open），`dialog.open({directory:true})` 移动端**源码级返回 `FolderPickerNotImplemented`** ④ 唯一活的 SAF 插件 `tauri-plugin-android-fs`。<br>**采纳 D 的实施**：`AndroidManifest.xml` 加 `MANAGE_EXTERNAL_STORAGE`；`src\App.tsx` 的 Android 库路径改为公共存储常量 `ANDROID_VAULT = /storage/emulated/0/Documents/ZeroNote`；开发期授权 `adb shell appops set com.aqua.zeronote.debug MANAGE_EXTERNAL_STORAGE allow`。<br>**真机证据**：库建在公共 `Documents/`（与 HYKB/qqmusic 等并列）；PC `adb push test-from-pc.md` 后应用状态栏 **`0 篇` → `1 篇`** ⇒ 数据通路打通（`_shots\android-14.png`）。<br>**待补**：① 正式版需在应用内引导用户去设置授权（Kotlin 启动 `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`；**Tauri 2 的 Android 插件怎么写要先去查**，别再自创）② `.zn/plugins/` 现在可用文件管理器直接拷插件 —— 待验证，即为 M2 插件体系的**真机首验** |
| B | **`index` 原语（v0.2）** | 契约 §6 已排期；搜索是笔记刚需，现在调用会抛「未实现」 |
| C | 第二个真插件（画布 / Git 同步） | 用户 04:15 点名的四件（笔记/记录/画布/同步）里还剩画布与同步 |
| D | UI 打磨（Tailwind + shadcn） | 自建 `--zn-*` token 已保证风格统一，属锦上添花 |

**验收条件**：M4 任一项完成时都必须能在**真机上**用截图或 adb 命令证明 —— 这是 M3 学到的最贵一课：**桌面截图永远看不出移动端问题**（响应式、状态栏遮挡、私有目录，全是真机才暴露的）。

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
