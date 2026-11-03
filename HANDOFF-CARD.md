# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-11-03（rev173.341）** ｜ 逐项历史与证据在 **`HANDOFF.md`**（rev173.125 起；更早归档 `docs/archive/handoff/`）｜ 提交一律看 `git log`
> **上限 120 行**：本卡只放当前状态与下个会话必读项；一个 rev 的过程记录一律进 `HANDOFF.md`。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.341 · 0.9.22 · 2026-11-03 |
| 测试基线 | vitest 1842 · cargo 98 · oxlint 4 warnings（2026-11-03） |
| 插件 | 市场 15 · 示例 39 |
| 文档 | README 现状 2026-11-03 · CHANGELOG 0.9.22 |
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

- **0.9.22 已发版**（tag `v0.9.22` · commit `7fbb5f1` · 5 资产）⇒ <https://github.com/aqua7773/zeronote/releases/tag/v0.9.22>
- **真人测试10 六条全过**：桌面 #1/#2/#3/#5/#6A/#6B · 手机 #1/#2/#3/#4/#5。判定表 `docs/验收卡-真人测试10-2026-11-03.md` §6，证据 `_shots/rt10-*`
- verify 最近全绿：`tsc 0` · `oxlint 4 warnings` · `cargo test --lib` 全过 · `vitest` 全过 · 质量门 8/8（具体条数见上方 FACTS 块，不在正文抄第二遍）
- **rev173.341 同类问题 6 项落地**（方案 `docs/同类问题处置方案-2026-11-03.md`）：跨端路径对拍 + Android 绝对路径收口 · select 播种 · `data-overlay` · 卡片补「详细…」「在文件夹中打开」· 复制文案统一。G2 已验：桌面 2 项（CDP）、真机 1 项（长按卡片菜单 + 详细弹窗）

## 未决 / 下一步

> 📋 **审计待修清单：[`docs/审计待修-2026-11-03.md`](docs/审计待修-2026-11-03.md)**
> （32 项已全部处理：24 项修复 + 8 项拍板落地；B4 明确不做、B7 并入 B3 —— 见文档「已拍板」表）

**真机待验（装 0.9.22 APK）**

- 手机复验真人测试10 六条
- 插件中心 → 插件市场更新：`security 0.2.2` · `secrets 0.1.2` · `sync 0.1.8` · `import-export 0.2.4` · `private-notes 0.2.1`
- ⚠️ 手机市场索引默认 raw 国内不通，先切 **ghproxy.net** 镜像

**rev173.341 剩余待验**

- P4 手机左右滑不误开侧栏（先开一张图再划）
- P6 手机文件树「复制文件」（拉左抽屉 → 长按文件）
- P1 手机点图解析（库根图 + 子目录笔记，看是否报「库里没有这个附件」）

**已知未修**

- 手机点图预览时软键盘一起弹（CodeMirror 拿焦点），预览与键盘各占半屏 → 下轮 blur 编辑器

**长期**

- `sync` 0.1.7 墓碑双端验证：手机删一篇并同步 → 桌面首次连同步应消失（进回收站），不是被传回
- 手机「自动同步」默认**关着**（测试时关的），要用就在面板点「开启自动同步」
- 手机冲突列表还剩 9 条旧测试噪声

## 环境坑位（踩过的，按需查）

- **桌面 dev**：双击 `dev.cmd`（vite 1420 · CDP 9222 · 日志 `.self-logs/desktop-dev.log`）。**别用后台 job 托管**（随会话回收）；AI 起用 `Start-Process cmd.exe /c dev.cmd -WindowStyle Minimized`；**别用管理员**（污染 WebView2 UDF ⇒ `0x800700AA`）。
- **手机截图**走 `adb shell screencap`；**CDP `shot` 抓不到 WebView 里的 canvas**。
- **改 `tauri.conf.json` / `Cargo.toml` ⇒ tauri CLI 自动重编重启**（与 `cargo test` 争 target 目录，verify 慢是排队不是卡死）。
- **编辑器 CSS 在 `MarkdownEditor.tsx` 的 JS 模板字符串里** —— 注释写反引号会提前终止 ⇒ 整页白屏。
- **改 `patches/@atomic-editor__editor@…patch` 后必须重启 dev**：结束进程树 → 删 `node_modules/.vite` → 重起（预构建缓存在内存里）。
- **Low IL 会让 dev 起不来**：`icacls src-tauri /setintegritylevel (OI)(CI)Medium`（target 同步）。判据 = `create_dir_all` 报「拒绝访问 (os error 5)」。
- **改前端只 `location.reload()`**；改 Rust / 原生插件才重装 APK；**不往测试机装 release 包**。
- **dev 崩溃**：连续多次 HMR 会 `0xc0000374`，重启即恢复 · **别用 `plugin:window|destroy` 关窗口**。
- **手机验收前先确认装的是 dev 包**：只有 `pnpm tauri android dev --config tauri.android-dev.json` 装出来的包才连 dev server；`build` 出的 `app-*-debug.apk` 是离线包（内置 dist），点不动也连不上。连通性用 `adb shell "toybox nc -w 3 192.168.1.3 1420 </dev/null && echo OK"` 验，**别用 ping**（Windows 拦 ICMP 会误判）。

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
8. **测试 / 验收产生的插件不留在「功能」里**：探针 / 夹具 / 演示只放 `examples/` 或临时目录，用完即删。
9. **改 `examples/` 后必须让页面 reload 再重扫**（`ensureBuiltinPlugins` 会用 `?raw` 内容覆盖全局目录）。

## 授权边界（给 AI）

- 已授权：工作区内建目录 / 写文档 / 装 npm 依赖 / 构建运行 / 并发子 agent / git 提交 / 项目级配置。
- 需批准：装系统级软件 · 改 PATH / 注册表 · `rustup target add` · `tauri android init` · 发 GitHub 仓库 · 任何删除。

## 细节读哪

`HANDOFF.md`（rev 索引 + 逐项历史）· `docs/内核契约-v0.2.md` · `docs/架构原则-2026-10-13.md`（**冲突时以它为准**）· `docs/README.md`（权威矩阵）· `docs/系统总览.md` · `docs/开发约定.md`
