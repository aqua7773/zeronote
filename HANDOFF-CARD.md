# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-10-27（rev173.192）** ｜ 细节与证据在 **`HANDOFF.md`**（只保留当前周期，rev173.125 起；0.2 / 0.3 / 0.4 已归档到 `docs/archive/handoff/`）｜ 提交数一律看 `git log`
> 本卡只放**当前状态**（目标 ≤ 120 行）；历史过程一律回 HANDOFF，不再在此重复。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.192 · 0.6.0 · 2026-10-27 |
| 测试基线 | vitest 1147 · cargo 55 · oxlint 3 warnings（2026-10-27） |
| 插件 | 内置 9 · 示例 41 |
| 文档 | README 现状 2026-10-27 · CHANGELOG 0.6.0 |
<!-- FACTS:END -->

## 是什么

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用（Tauri 2 + React 19 + Rust）。
一切功能靠插件：**全局目录** `<应用数据目录>/.zn/plugins/<id>/` —— 唯一位置（跨库共用；装卸＝放/删一个文件夹）。
内核 **11 原语 + 21 种 UINode + 6 个挂载位** + 真窗口 / 整窗接管 / 面板 DOM。

**内核自带**：文件树 · 回收站 · 搜索（增量索引 + 标签/目录/正则筛选）· 命令面板 · 多标签（`Ctrl+Tab`）与标签拆独立窗口 · 时间流 · 主窗口记忆 · 会话恢复 · 粘贴图片 · 全局替换 · Markdown 增强（数学 / 脚注 / Mermaid / 内嵌 HTML 白名单）· 白屏兜底。

**预装 9 个**（核心体验，判定见 `D-010`）：标签 · 反向链接 · 历史版本 · 导入导出 · 备份 · 同步 ×4（本地文件夹 / WebDAV / S3 / Git）。**走市场**的「增强」类：大纲导图 · 文档阅读器 · 记账 · 米色主题 · 打卡（rev173.179 移出，源码仍在 `examples/`）；安全 / 密码库同样只走市场。

## 验收基线（以输出为准，不写死数字）

```powershell
pwsh -File scripts\verify.ps1
# 六步：tsc 0 错误 · oxlint src 0 error · cargo test --lib · check-docs · vitest · 质量门 7 项（facts / 依赖方向 / 本地链接 / 功能目录 / 键位表 / 市场索引 / 外部条目审查）
```

## 未决 / 下一步

> **「旧 `vault.json` 自己回来」已稳定（rev173.187），不用再追**：写回走内核 `write_note`（`vault.zn-tmp` 铁证），
> 但它是**内存态** —— 一次 reload + 彻底删干净后就终止；桌面从不复现。手机现在反复删 + 60 s 观察都不复活。
> 真要再查（前提是让旧文件重新「在场并被缓存」）：**二分每轮等 ≥ 60 s**（12–15 s 会误判；rev173.187 踩过），
> 或用 `inotifyd` 挂着。防御已就位（`security` 0.2.1）：purge 不静默 + 删后复查 + `apply()` 自愈。
> 手机库 `PhoneTest123` · 桌面库 `TestPass123`。

> **安全线进度（rev173.160–171，逐 rev 细节全在 HANDOFF）**：
> `security` 双密钥环 + `crypto` 服务（160–162）→ `secrets` 密码库（163：整库加密 / 平台账号 / 生成器 /
> 复制 60 s 清剪贴板 / 回收站 7 天 / 空闲 60 s 锁，内核加 `input.secret`）→ 同步放行 `.zn/secrets/`（164：
> 三后端 `syncPrivate` 搬 `secrets.zn`+`vault.json`，sync-folder 给放行规则）→ KDF 定档（165：**t=3/64MiB**，
> 手机实测 812 ms，比桌面快 0.8×）→ 手机走查（166：**10 项全过**）→ Windows Hello 可行性验证（167）→
> **Android 指纹解锁（168）** → **Windows Hello 解锁（169：手写 winmd 里的带窗口 interop，`hello1.<challenge>.<zn1…>` 包裹，桌面走通 绑定 → 锁定 → 解锁）** →
> **锁定后自动弹生物识别（171：桌面失焦挂起、手机看可见性；桌面点回窗口 600 ms 弹 Hello、手机空闲锁后自动弹指纹并解锁、取消给中性提示）** →
> **`security` 0.1.1 发市场（172：版本 bump + 签名 keyId `aqua-2026` + 索引重建 + 本地安装实测；旧 0.1.0 用户需等提示或手动重装）** →
> **生物识别按设备（173：`biometrics[<deviceId>]` + 本机 id 在凭据管理器 + 旧单段自动迁移；换机只失效那一台。`security` 0.1.2 发市场；桌面与手机都实测「迁移后按指纹 → 已用指纹解锁」）** →
> **发版 0.6.0（174：0.5.0 之后 57 个提交一次收口；CHANGELOG 补上 `security` / `secrets` 本体与两平台生物识别五条主线 —— 原 `[Unreleased]` 只记了自动弹与按设备）**。
> 市场 16 条（`security` / `secrets` 已签名发市、不预装；**`backup` 预装且已发市**，rev173.189 —— 预装与市场不互替，签名包不被内置覆盖）。
> ⚠️ 已知局限：**`vault.json` 已按环拆（173.182）** —— 旧客户端（`security` ≤ 0.1.2）只认旧单文件，迁移后会以为"没建环" ⇒ **共用同一份 vault 的设备都要升到 0.2.0** · 手机端 reload 后 app 偶发退出一次（重启即好）·
> **Windows Hello 签名必须有窗口**（无 HWND 挂死；已用 `IKeyCredentialWithWindow` 解决）·
> **Android 换/加指纹会让旧密文失效**（N+ 默认）⇒ 提示「用主密码解锁后重新绑定」·
> **Hello 是受保护的系统 UI**（171 实测：合成键鼠 / `Esc` / UIA / `FindWindow` 都触达不到）⇒ 自动弹只在窗口前台时发生，
> 一旦弹了就得真人按指纹或取消；点取消 ⇒ 面板给中性提示「已取消 —— 输入主密码，或点「用指纹解锁」」（实测）·
> **旧客户端读新结构会认为「没绑定」**（173 迁移删了旧单段 `biometric`，≤0.1.1 静默看不到指纹按钮）⇒ 共用同一把 vault 的设备都要把 `security` 升到 **≥ 0.1.2**。
> **下一步**：
> ① **私密文件夹收尾**（期 1 ✅173.180 · 期 2 ✅173.181 · 期 3 ✅173.182 —— 三件事都已落地，**包也已
>    重打签名发市**：`security` 0.2.0 / `sync-webdav` 0.3.2 / `sync-s3` 0.4.2 / `sync-git` 0.5.2 /
>    `sync-folder` 0.3.4，索引 16 条 —— rev173.189 加了 `backup`）。**只剩一件没有真机证据**：
>    (a) ✅ **vault 按环拆的迁移链**已桌面实测（rev173.183：旧单文件 → 换一次主密码 → 两个
>        `vault.*.json` + 旧文件消失 + reload 后两环都能解锁 + 「按环写」只动改动的那个文件）；
>    (b) ✅ **手机端走查**已做（rev173.184）；迁移收尾的静默失败已修（rev173.185：`security` 0.2.1，
>        purge 不再吞错 + 加载时自愈）。剩「文件自己回来」的平台级问题，见「下个会话第一件事」·
> ② 插件数涨到几十个时换 CDN / 自建源（raw 偶发连不上 + 按 IP 限流，见 rev173.151）·
> ③ 第一个外部作者投稿时按 `market/README.md` 的「审 PR」走（`--online` 出材料）·
> ④ 卡点表前三行要外部输入（sync-git 手机端 / Gitee 令牌 / 记账样本）。
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
| 私密文件夹 | ✅ **三期全部落地（rev173.180 / 181 / 182）+ 已发市**（`security` 已到 **0.2.1**，索引 16 条）· **桌面与手机的迁移链都已实测**（173.183 桌面 / 173.184 手机）· 迁移收尾的静默失败已修（173.185）；剩 Android 上「旧 `vault.json` 自己回来」（平台级，见「下个会话第一件事」） |

## 环境现状（活信息 · 2026-10-26）

- **桌面 dev**：双击 `dev.cmd`（vite 1420 · CDP 9222 · 日志 `.self-logs/desktop-dev.log`）。**别用后台 job 托管**（会随会话回收）；
  AI 自己要起时用 `Start-Process -FilePath cmd.exe -ArgumentList "/c","dev.cmd" -WindowStyle Minimized`（独立进程，等价双击，rev173.152 实测可用）；
  **别用管理员跑**（污染 WebView2 UDF ⇒ `0x800700AA`，已污染就用 `scripts\dev.ps1` 绕开）。
  ⚠️ 本卡最后更新时 **dev 是开着的**（pid **5944** · 2026-10-26 14:14 启动 —— 13:50 那次的 pid 6772 被发版后的自动重编换掉了；vite 1420 / CDP 9222 都在），日志在 `.self-logs/desktop-dev.log`。
- **Low IL 会让 dev 起不来**：`icacls src-tauri /setintegritylevel (OI)(CI)Medium`（`target` 同步）。判据 = `create_dir_all` 报「拒绝访问 (os error 5)」。
- **改 `tauri.conf.json` / `Cargo.toml` ⇒ tauri CLI 自动重编并重启**（重编期间与 `cargo test` 争 `CARGO_TARGET_DIR`，verify 等几分钟是排队不是卡死）。dev 窗口「关于」的版本号由 **vite 启动时**求值，改 `package.json` 不热更新。
- **Android dev**：`android-dev.cmd`（日志 `.self-logs/android-dev.log`）· gradle wrapper 走腾讯镜像 · `rustup` 操作必须串行。
- **手机 `33b676f6` = 测试机，只跑已装的 dev 包**：`versionName` 仍写 **0.5.0**，但 **2026-10-27 00:36 已被 `android-dev` 重编重装成最新代码**（`lastUpdateTime` 实测；rev173.191 走查确认手机 Rust 已含 rev173.190 的 store 保留）⇒ **别再按 0.5.0 的功能边界判断**；
  启动：`adb -s 33b676f6 shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity`。
  adb 里有两个离线残留 ⇒ 所有命令带 `-s 33b676f6`。改前端不用重装（连桌面 dev 的 vite，reload 即生效）；**改 Rust 必须重装**。
  - **手机插件根 = `/data/user/0/com.aqua.zeronote.debug/.zn/plugins/`**（**不是** `files/.zn/`；`run-as ls files/` 只有 `profileInstalled`）。
    装开发版：`adb push <文件> /data/local/tmp/x` → `adb shell run-as com.aqua.zeronote.debug cp /data/local/tmp/x .zn/plugins/<id>/<名>` → reload。
  - 现有插件 **17 个**（9 预装 + 记账 / 阅读器 / 打卡 / 导图 / 两个主题 + **`security` / `secrets` 开发版**，rev173.166 手装；`backup` 已是**市场签名包 0.3.1**（rev173.191 装、带 `signature.json`，此后内置不再覆盖它））。手机主库 `secrets` 环主密码 = `PhoneTest123`，**已绑指纹**（rev173.168）。
  - ⚠️ **PowerShell 的 `$pid` 是只读变量** —— 存 app pid 要用 `$appPid`，否则 `adb forward` 会指向错误 socket（rev173.166 踩过）。
  - ⚠️ **`adb reverse tcp:1420 tcp:1420` 会丢** —— 丢了表现为「启动 15 秒后无声退出」（看门狗杀进程）。重连 adb / 重启后先补这条再 `am start`。
  - ⚠️ **☰ 短按 = 抽屉 · 长按 600ms = 菜单**；CDP `click` 点不动长按，得 `adb shell input motionevent DOWN/UP`。
  - 手机 CDP：`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`（换进程先 `forward --remove`），`ZN_CDP=http://127.0.0.1:9333 ZN_TARGET=tauri.localhost`。
- **桌面 CDP**：9222 · 坐标有 **32px 垂直偏移**（`.zn-titlebar`）· 菜单入口 = **右键 ☰**（左键开文件树栏）。
- ⚠️ **全局插件目录里的插件是「拷贝」，不是链接**（`<APPDATA>\com.aqua.zeronote\.zn\plugins\<id>\`）—— 改了
  `examples/` 里的源码**不会**自动生效，要么删掉那份再建 junction，要么在插件页重装。本会话实测：
  测试库的 `security` 里仍是 0.1.x（不含 vault 按环拆），所以**换设备验证 vault 迁移前先把 `security`
  同步进全局目录**。
- **测试库** `_tmp-vault-tb/`（不入库）· **插件只有全局目录一处**，测试插件只放 `examples/`、用完即删 · **开发中要试的插件 = 在 `<APPDATA>\com.aqua.zeronote\.zn\plugins\` 下建 junction 指向 `examples/<id>`**（库内 `.zn/plugins/` **不再被扫描**，rev173.5 起只有全局根 —— rev173.180 踩过：挂测试库后 reload 命令表里什么都没有）· 全局目录里的 `secrets` 是**开发版（无签名）**（rev173.163 实测拷入；市场版已签名，重装即覆盖）· 测试库 `secrets` 环测试主密码 **`TestPass123`**，库内有 1 个 `GitHub / aqua@example.com` 测试账号，**已绑 Windows Hello**（rev173.169）· 测试库 **`notes` 环主密码 `NotesTest123`**（rev173.180 建，私密笔记测试数据已清，环保留）。
- ⚠️ **桌面全局目录的 `security` 也是开发版**（rev173.169 换成带 Hello 适配器的版本；旧文件备份在 `_tmp-plugin-backup/`）。手换插件 `index.js` 后**必须同步 `manifest.json` 的 `sha256`**（入口哈希），否则插件加载但命令全部不存在 —— 本会话踩过。
- **Git**：GitHub `aqua7773`（gh 已登录、keyring）· `git push` **先直连，被 reset 再挂本机代理 `$env:HTTPS_PROXY='http://127.0.0.1:26561'`**。
- **Rust**：`CARGO_TARGET_DIR` 必须在工作区外（本机铁律）；Rust 测试临时目录 `<repo>/_tmp-test/`。
- **补丁**：`patches/@atomic-editor__editor@0.6.2.patch`（空标题不隐藏 `#`），升级必须重打 · `.gitignore` 排除 `_shots/` `_tmp-*/` `examples/*/store.json`。
- **插件签名密钥（2026-10-25 生成）**：keyId **`aqua-2026`** · 私钥 `%USERPROFILE%\.zeronote-keys\aqua-2026.key.pem`（**仓库外，绝不入库**）· **公钥已内置进应用**（rev173.146，`src-tauri/src/lib.rs` 的 `BUILTIN_TRUSTED_KEYS`；改它要跑 `node scripts/verify-trust.mjs`）· 本机那份 `<APPDATA>\com.aqua.zeronote\.zn\trusted-keys.json` **不再是必需**（同 keyId 只会覆盖内置值），留着无害 · 公钥值 `iOIIUrkdKmP0w+pwpgqGiqSsLJYfl9Pa5VeUCBCjh6E=`
- **插件包与市场（rev173.150 起）**：包**入库**在 `market/packs/*.znp`（30 个 · 约 1.5 MB —— **含各历史版本，别在这里写死个数**），索引 `market/index.json` **16 条**，
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
