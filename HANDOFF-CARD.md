# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-10-18（rev117）** ｜ 细节与证据在 **`HANDOFF.md`**（rev 索引在文首）｜ 提交数一律看 `git log`
> 本卡只放**当前状态**；历史过程一律回 HANDOFF，不再在此重复。

## 是什么

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用（Tauri 2 + React 19 + Rust）。
一切功能靠插件：**全局目录** `<应用数据目录>/.zn/plugins/<id>/`（跨库共用）或**库内** `.zn/plugins/<id>/`（只在本库生效，同名库内优先）；装卸＝放/删一个文件夹。
内核 10 原语 + 21 种 UINode + 6 个挂载位 + 真窗口 / 整窗接管。
内核自带：12 条 Markdown 标记命令（`core.mark.*`，桌面右键「标记」/ 手机键盘上方快捷栏）· 层级文件树（空目录 / 框选 / 拖拽 / 引导线）· 回收站 · 搜索 · 命令面板 · 快速切换。
**插件预装**：新版 APK 内置 8 个常用插件（rev110）。

## 验收基线（以输出为准，不写死数字）

```powershell
pwsh -File scripts\verify.ps1
# 四步：tsc 0 错误 · oxlint src 0 error · cargo test --lib 全过 · check-docs 全过
```

## 最近一轮（rev117）

- **测试报告 16 项逐条实测**：11 成立 · 1 作废 · 2 待验 · 2 不算缺陷；**修了 7 项** —— P1-1 折叠竖线 · P1-2 frontmatter 透传 · P1-3 原子写 `.bak` · P2-1 暗色竖线 · P2-2 `[[链接]]` 点击 · P2-5 轮询兜底 · P2-6 engines。
- **P1-4 不是代码问题**：1000 篇冷启动 12s、热态 90–607ms；同目录 `pwsh` 读 1000 篇全文仅 379ms ⇒ Windows 首次访问 / Defender 主导。
- **P2-3 待真机**：Android 二进制导出（png/zip）需真机 UI 操作复验。
- **验收**：`verify.ps1` 四步全过（tsc 0 · oxlint 6 warnings · cargo 23 passed）；`verify-outline-fold.mjs` 10/10。
- **已知问题**：dev 连续多次 HMR 会 `0xc0000374 STATUS_HEAP_CORRUPTION` 崩溃，重启即恢复（本轮又踩一次）。

## 未决 / 下一步

| 项 | 状态 |
|---|---|
| 测试报告（2026-10-17 · 16 项） | ✅ rev117 已修 7 项（P1-1/2/3 · P2-1/2/5/6）；剩 P2-3 待真机、P2-7 观察项、P3 工程债 |
| 插件签名 / 分发 / 更新通道 | ❌ 未做（只有全局根，无市场 / 签名） |
| iframe ↔ 宿主能力通道 | ❌ 未做（v0.2） |
| 同步 / AI 标签 / 密级 | ❌ 未开工（需求2 暂不采用，方向待定） |
| M3 收尾④：真机「编辑→保存」人工确认 | ⏳ 旧悬置项（实机早已能保存，可忽略） |
| 沙箱 | ⏸ 搁置（用户裁决） |

> 已结清：文档阅读器（rev72–74）· 卡死兜底（rev70/71）· 触屏三件（rev67/68）· 插件跨库（rev94）· 内置预装（rev110）· 文档对齐（rev93 + 2026-10-17 契约 v0.2）。

## 环境现状（活信息）

- **桌面 dev**：`tauri dev`（vite 1420），日志 `.self-logs/desktop-dev.log`；**android-dev** 另起（WMI，日志 `.self-logs/android-dev.log`）。
- **手机 `33b676f6`（ARIA 24069RA21C）**：2026-10-15 实测装的是 **dev 版**（连 `192.168.1.3:1420`，桌面 dev 一关就白屏）。判据：logcat 出现 `node_modules/.vite/deps/…`。
- **防火墙**：1420 已放行（TCP，仅 `192.168.1.0/24`；网络被识别为 Public、手机 2.4G / 电脑 5G 跨 SSID）。
- **手机 CDP**（默认手机断言手段）：`adb forward tcp:93xx localabstract:webview_devtools_remote_<pid>` → `ZN_CDP=http://127.0.0.1:93xx node tools/cdp.mjs …`。
- **手机模拟点击**：`input tap` 无效；用 `input motionevent DOWN x y` ＋ `UP x y`（间隔 ~120 ms）。`screencap` 是物理像素。
- **测试库 `_tmp-vault-tb/`**：5 篇笔记；`.zn/plugins` 有 junction（outline-map / net-demo）。验收夹具**按需挂**，别常驻。
- **安全区**：三处各吃 `env(safe-area-inset-*)` —— `.zn-app` / `.zn-plugin-window` / `.zn-shell-host > .zn-shell-mount`。
- **手机库插件会与仓库漂移**：与 `examples/<id>/index.js` **比大小**；同步只能手动 `adb push`（推到明确文件路径）。
- **Rust 测试临时目录**：`<repo>/_tmp-test/`（不是 `%TEMP%`，受限上下文写不了）。
- **第三方补丁**：`patches/@atomic-editor__editor@0.6.2.patch`（空标题不隐藏 `#`）；升级必须重打。
- `.gitignore`：`_shots/`、`_tmp-*/`、`examples/*/store.json`。

## 硬约束

1. capability / 安全模型变更 → 先拿用户对「具体方案」的同意（方向同意 ≠ 方案同意）。
2. 每批交付：`verify.ps1` 全过 ＋ 实测证据 ＋ 提交 ＋ HANDOFF 新 rev。
3. 手机截图走 `adb shell screencap`；**CDP `shot` 抓不到 WebView 里的 canvas**。
4. **内核保持薄**；**静默失效比报错危险**（看数字，不只看 "ok"）。
5. GUI 验收用 `gentle_*`；截图按窗口 `rect` 向内缩 ~10px。

## 授权边界（给 AI）

- 已授权：工作区内建目录 / 写文档 / 装 npm 依赖 / 构建运行 / 并发子 agent / git 提交 / 项目级配置。
- 需批准：装系统级软件 · 改 PATH / 注册表 · `rustup target add` · `tauri android init` · 发 GitHub 仓库 · 任何删除。

## 细节读哪

`HANDOFF.md`（rev 索引）· `docs/内核契约-v0.2.md` · `docs/架构原则-2026-10-13.md`（**冲突时以它为准**）· `docs/README.md`（权威矩阵）· `docs/文档阅读器-调研-2026-10-13.md` · `docs/卡死兜底方案-2026-10-13.md` · `tools/verify-*.mjs`（自动验收）
