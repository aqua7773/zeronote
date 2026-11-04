# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-11-04（rev173.362）** ｜ 逐项历史与证据在 **`HANDOFF.md`**（rev173.125 起；更早归档 `docs/archive/handoff/`）｜ 提交一律看 `git log`
> **上限 120 行**：本卡只放当前状态与下个会话必读项；一个 rev 的过程记录一律进 `HANDOFF.md`。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.362 · 0.9.29 · 2026-11-04 |
| 测试基线 | vitest 1886 · cargo 102 · oxlint 4 warnings（2026-11-04） |
| 插件 | 市场 16 · 示例 40 |
| 文档 | README 现状 2026-11-04 · CHANGELOG 0.9.29 |
<!-- FACTS:END -->

## 📱 环境与设备（动 adb / 装包 / 判版本前先看这张表，别凭印象）

> 两张手机 + 两个只差两个字母的目录，历史上混淆过多次。**表外的事先问，不猜。**

| 名称 | 标识 | 是什么 / 装什么 | 默认用途 | 注意 |
|---|---|---|---|---|
| 源码仓库 | `C:\Users\AQUA\Documents\deepseek\ZeroNote` | 代码 / 测试 / 文档 | 改代码、跑 `verify.ps1`、提交 | 不往这里放用户笔记 |
| 桌面测试库 | `C:\Users\AQUA\Documents\ZreoNote`（**ZreoNote ≠ ZeroNote**） | 真人测试用的笔记库（`.zn/device-id` = `f6456d22…`） | 让用户在桌面点 UI 验 | **不是源码目录**，别在这里改代码 |
| 手机测试机 | serial `33b676f6` · Redmi `24069RA21C`（peridot）· **adb 默认连的就是它** | `com.aqua.zeronote.debug`，连 `192.168.1.3:1420` dev server | 日常开发 / 真机 debug 验证 | 改 `src/` 1–3 秒热重载，**不用重编 APK** |
| 手机 release 机 | serial `324652868237`（model `NX741J`）· 努比亚 | `com.aqua.zeronote` 正式包 | **只做 release 包验收** | 不做调试 / 不 push / 不改系统设置；S10 会话里被 adb 误操作过 26 次 |
| 手机库路径 | `/storage/emulated/0/Documents/ZeroNote` | 手机上 push 测试文件的地方 | 真机测附件 / 同步 | — |
| dev server | `pnpm dev`（只起 vite `1420`）· 桌面 CDP `9222` · 手机 CDP forward `9333` | — | 热重载验证 | 别用 `dev.ps1`（会起桌面 tauri 抢单实例） |

**包类型速记**：debug 包 = 连 dev server 的最新源码；release 包 = 打包产物，**只有它能代表「用户手上那一版」**。
真机报 bug 时先确认「哪台机 + 什么包 + 什么版本」，三者缺一就先问。

## ✅ 验收铁律（发版前必过，详见 `docs/开发约定.md` §5.1）

**G1 自动化** `pwsh -File scripts\verify.ps1` 全绿 → **G2 自验** 桌面 dev + 真机 debug 亲手走一遍并留证据 → **G3 用户验收** 用户人眼确认。
**三条全过才提「发版」**；只过 G1 就提发版 = 违规。修完 bug 先问「要不要在 dev 上先看一眼」，不直接问「发不发」。

> 已由 `dsh-dev-gate` 插件工具级强制：设备白名单 / 一轮改 3+ 文件先问 / 发版前必须有 G1+G2（改过代码即作废）。

## 当前状态

- **0.9.27 已发版**（tag `v0.9.27` · commit `ba51b0a` · GitHub 3 资产：桌面 `ZeroNote_0.9.27_x64-setup.exe` + `.sig` + Android APK）⇒ <https://github.com/aqua7773/zeronote/releases/tag/v0.9.27> · Gitee 已推 main+tag（**Release 附件待网页手动上传**，无 token）；⚠️ APK 仍为 **arm64 单架构**，0.9.25 的 127 MB 是 4 ABI，老 32 位设备装不上
- **rev173.359 轮询首轮不再误报新建**：0.9.26 release 上启动后 **8222ms** 仍有 ~400ms 长任务 —— 首轮把 126 篇全判成 `create`，而刷新回调不看事件内容、每条跑一次 `listNotes + listDirs` ⇒ 126 次全库扫描。改成首轮只建基线 + 同一 tick 合并刷新。dev 包冷启动长任务只剩 **78/59ms**、8 秒处无长任务
- **rev173.360 白屏探针只给 debug 构建**：`RenderWatchdog` 之前**无条件**启动，它的 draw 自检会铺一层 `#ff0000` 全屏覆盖层（每进程一次、启动后约 40 秒）—— 这就是用户看到的「时不时闪一下红色」；判据早被证伪（`webView.draw()` 画不出 Chromium 内容），还会在 5 分钟后误软复位一次。改成 `if (!BuildConfig.DEBUG) return`，**release 包彻底没有探针**（debug 保留白屏排障）。**待发 0.9.28**
- **rev173.362 私密笔记入口跟着插件走**：把「私密文件夹」插件关掉后，桌面锁形按钮 / 手机「更多 → 私密笔记」还在 = **内核写死了入口**，违反「空内核 · 功能全靠插件」。改成 `privateAvailable`（插件目录里有 + 未被禁用）控制，`visibleMoreGroups()` 一处过滤（桌面浮窗与手机右侧栏共用）。**已改未发版**
- **真人测试10 六条全过**：桌面 #1/#2/#3/#5/#6A/#6B · 手机 #1/#2/#3/#4/#5。判定表 `docs/验收卡-真人测试10-2026-11-03.md` §6，证据 `_shots/rt10-*`
- verify 最近全绿：`tsc 0` · `oxlint 4 warnings` · `cargo test --lib` 全过 · `vitest` 全过 · 质量门 8/8（具体条数见上方 FACTS 块，不在正文抄第二遍）
- **rev173.345–347 白屏检测三代方案（全部被真机证伪）**：rAF 时间戳（白屏时主进程 CPU 59%、rAF 照转）→ CSS 动画探针（120 秒没触发）→ 原生 `RenderWatchdog.kt`（`PixelCopy(window)` 抓不到 SurfaceControl 子层、`webView.draw()` 画不出 Chromium 内容）。探针日志 tag `ZN-RENDER` 保留
- **rev173.348 Gitee 镜像**：插件市场 + 应用更新各加 Gitee 渠道（`market.ts` / `app-update.ts` / `updates.rs` 三处）；Gitee raw 的索引 / 包 / 更新清单三条 URL 实测 200。安装包仍在 GitHub Release（Gitee 未传附件）
- **rev173.349 启动兜底（白屏类型 A：页面没挂载）**：`index.html` 内联脚本（不依赖模块）—— `main.tsx` 挂载后置 `window.__znBooted`，25 秒没标记 ⇒ 自动重载一次，再失败显示「页面没能加载起来」卡片 + 重载按钮；`<script>`/`<link>` 的 error 立即触发。真机 CDP 拦截 `main.tsx` 实测：卡片出现 → 解除后恢复、标记清空。单测 `tests/boot-guard.test.ts` 7 个
- **rev173.351 启动打点 + 0.9.24 发版**：`src/lib/boot-marks.ts` 记 `entry`/`first-frame`/`plugins-ready` + 启动期 >50ms 长任务（CDP `__znBootMarks()`；dev 包 logcat 里在 `Tauri/Console`，**release 包不回传**）。真机 dev 两次冷启动：JS 侧 ~700ms（插件加载 693–714ms）· 长任务最大 77ms。**release 0.9.24 实测**：`am start -W` 五次冷启动 TotalTime 173–189ms、内容可见 ~835ms（含 adb 截图开销）⇒ 启动不慢。0.9.24 已打 tag `v0.9.24`（`e739618`），Gitee 已推 main+tag，**GitHub + Gitee Release 均已发（3 附件逐个 HEAD 200）**

- **rev173.357 启动卡顿定位 + 轮询兜底改造**：卡顿 = `fs.ts` 轮询兜底每轮全库 `list_notes`（CDP 实测 **1455ms**，`list_dirs` 另 411ms）⇒ 启动后 3.2 秒 1730ms 长任务、之后每 3 秒一次；触摸全部排队、恢复后一次性派发。已改：首次轮询延迟 8 秒、间隔 ≥10 秒、单次 >800ms 自动退避 6 倍（上限 60s）、`setInterval` → 递归 `setTimeout`；启动窗口降到 **59–127ms**（3 次冷启动稳定）
- **rev173.358 轮询治本（本轮）**：① `list_notes` 加 `(mtime, size)` 元数据缓存 —— 文件没变就不重读 frontmatter，**9 个写盘命令**落盘后显式失效（`set_mtime` 会把时间写回远端值，只靠 mtime 不够）；② 新命令 `list_notes_light(vault)`（只回 path+mtime，与完整版共用集合谓词）+ `fs.ts` 的 `pollOnce` 改调它。**桌面实测（合成库 126 篇 / 9.2 MB / NTFS · CDP）**：冷缓存 `list_notes` **390ms** → light **9ms**；热缓存 14–53ms → 7–13ms。⚠️ touch 大批文件会触发 watcher 风暴，风暴期首个 invoke 被主线程排队污染到 2.3 秒，测耗时必须在风暴后取数

## 未决 / 下一步

> 📋 **审计待修清单：[`docs/审计待修-2026-11-03.md`](docs/审计待修-2026-11-03.md)**
> （32 项已全部处理：24 项修复 + 8 项拍板落地；B4 明确不做、B7 并入 B3 —— 见文档「已拍板」表）

**真机待验（装 0.9.23 APK）**

- **rev173.358 待真机**：重编 debug 包后冷启动，启动后 8 秒那次轮询不应再出现 >800ms 长任务（`adb logcat` 看 `[zn-longtask]`）；桌面已测 390ms→9ms，手机 FUSE IO 更慢、绝对值会更大
- 插件市场切「**Gitee（国内直连）**」刷新 → 列表出来、能装一个插件（不用梯子）；应用更新渠道下拉也应有 Gitee（**rev173.350 起安装包也走 Gitee** —— 前缀替换，待真机验下载）
- **rev173.350 待真机**：插件市场装一个插件后应**停在市场**（不再跳已安装）；「详细…」大小不再显示 0 KB；私密文件夹解锁页出现「用指纹解锁」（先在列表里点「绑定指纹」）
- 白屏探针：**已实测（2026-11-04 01:57）—— 软复位能跑，但判据误判**（页面正常时也判全白，每进程空做一次 800 ms 复位）。处置 A（停用自动判据）/ B（改手动触发）/ C（继续找判据）见 `docs/白屏-渲染停摆-2026-11-04.md` §8，**待用户拍板，不要自行改**
- 白屏类型 A（页面没挂载）已由 rev173.349 的 `index.html` 内联兜底覆盖（真机验证过）；**整个导航失败**（dev server 挂 / 连不上）仍显示 Chromium 错误页，那条要原生 `onReceivedError`，未做

- 手机复验真人测试10 六条
- 插件中心 → 插件市场更新：`security 0.2.2` · `secrets 0.1.2` · `sync 0.1.8` · `import-export 0.2.4` · `private-notes 0.2.1`
- ⚠️ 手机市场索引默认 raw 国内不通，先切 **ghproxy.net** 镜像

**rev173.341 剩余待验 → 2026-11-03 已全部真机验完（rev173.343）**：P4 预览开着左右滑不误开侧栏 · P6 文件树长按是「复制文件」 · P1 子目录笔记引上级图点开正常（证据 `_shots/rev343-*`）

**已知未修**

- **手机白屏（渲染停摆）**：首页放着约 13 分钟后画面纯白，点击 / 旋转都不重绘，只能重启；实测渲染进程 CPU 0.0%、主进程 60–75%。**JS 层三套判据全部证伪**（DOM / rAF / CSS 动画），**原生层两条抓画面路径也失败**（`PixelCopy(window)` 抓不到 SurfaceControl 子层；`webView.draw()` 画不出 Chromium 内容）。**rev173.349 已实测软复位：动作能跑，但 draw 判据在正常页面上也判全白 ⇒ 误触发**（§8）。⏳ 处置待拍板 —— 数据与方案见 [`docs/白屏-渲染停摆-2026-11-04.md`](docs/白屏-渲染停摆-2026-11-04.md)

**长期**

- `sync` 0.1.7 墓碑双端验证：手机删一篇并同步 → 桌面首次连同步应消失（进回收站），不是被传回
- 手机「自动同步」默认**关着**（测试时关的），要用就在面板点「开启自动同步」
- 手机冲突列表还剩 9 条旧测试噪声

## 环境坑位

> **长期有效的那份在 [`docs/开发环境坑位.md`](docs/开发环境坑位.md)** —— 本卡是交接快照、会随 rev 覆写瘦身，坑不再堆在这里。
> 最短三条：桌面 dev 用 `dev.cmd`（别后台 job）· 手机只认 `pnpm tauri android dev` 装的 dev 包（`build` 出的是离线包）· 截图走 `adb shell screencap`。

## 是什么（三行）

**空内核**本地 Markdown 笔记应用（Tauri 2 + React 19 + Rust）：内核 12 原语 + 21 种 UINode + 6 个挂载位，功能全靠插件。
插件放**全局目录** `<应用数据目录>/.zn/plugins/<id>/`（跨库共用，装卸 = 放/删一个文件夹）。
**不预装任何插件**（`D-011`）：首次启动零插件，装插件走「插件中心 → 插件市场」或手动装 `.znp`。

## 验收基线（以输出为准，不写死数字）

```powershell
pwsh -File scripts\verify.ps1
# 六步：tsc 0 错误 · oxlint src 0 error · cargo test --lib · check-docs · vitest · 质量门 8 项
```

## 硬约束

1. capability / 安全模型变更 → 先拿用户对「具体方案」的同意（方向同意 ≠ 方案同意）。
2. 每批交付：`verify.ps1` 全过 ＋ 实测证据 ＋ 提交 ＋ HANDOFF 新 rev。
3. 手机截图走 `adb shell screencap`；**CDP `shot` 抓不到 WebView 里的 canvas**。
4. **内核保持薄**；**静默失效比报错危险**（看数字，不只看 "ok"）。
5. GUI 验收用 `gentle_*`；截图按窗口 `rect` 向内缩 ~10px。
6. **动手前先查现成**（`docs/开发约定.md` §0.5）；改代码 / 重构前先读该文档。
7. **安卓测试机只跑已装的 dev 包**，不重新编译 / 安装；**不装 release 包**。
8. **测试 / 验收产生的插件不留在「功能」里**：探针 / 夹具 / 演示只放 `examples/` 或临时目录，用完即删；**改 `examples/` 后必须让页面 reload 再重扫**（`ensureBuiltinPlugins` 会用 `?raw` 内容覆盖全局目录）。

## 授权边界（给 AI）

- 已授权：工作区内建目录 / 写文档 / 装 npm 依赖 / 构建运行 / 并发子 agent / git 提交 / 项目级配置。
- 需批准：装系统级软件 · 改 PATH / 注册表 · `rustup target add` · `tauri android init` · 发 GitHub 仓库 · 任何删除。

## 细节读哪

`HANDOFF.md`（rev 索引 + 逐项历史）· `docs/内核契约-v0.2.md` · `docs/架构原则-2026-10-13.md`（**冲突时以它为准**）· `docs/README.md`（权威矩阵）· `docs/系统总览.md` · `docs/开发约定.md`
