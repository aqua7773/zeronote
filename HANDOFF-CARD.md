# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-10-19（rev173.39）** ｜ 细节与证据在 **`HANDOFF.md`**（rev 索引在文首）｜ 提交数一律看 `git log`
> 本卡只放**当前状态**；历史过程一律回 HANDOFF，不再在此重复。

## 是什么

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用（Tauri 2 + React 19 + Rust）。
一切功能靠插件：**全局目录** `<应用数据目录>/.zn/plugins/<id>/` —— **唯一位置**（跨库共用；rev173.5 起取消库内插件）；装卸＝放/删一个文件夹。
内核 10 原语 + 21 种 UINode + 6 个挂载位 + 真窗口 / 整窗接管。
内核自带：12 条 Markdown 标记命令（`core.mark.*`，桌面右键「标记」/ 手机键盘上方快捷栏）· 层级文件树（空目录 / 框选 / 拖拽 / 引导线）· 回收站 · 搜索 · 命令面板 · 快速切换 · **桌面「时间流」面板**（rev173.33：侧栏与编辑区之间常驻，卡片与手机起始页同一套）。
**插件预装**：新版 APK 内置 **5** 个常用插件（大纲·导图 / 文档阅读器 / 导入导出 / 米色主题 / 记账；rev173.16 加「记账」；2026-10-19 rev173.29–31 移出 `daily-note` / `editor-marks` / `tag-demo`，**rev173.35 移出 `inspiration-flow`（灵感流，搁置）**）。

## 验收基线（以输出为准，不写死数字）

```powershell
pwsh -File scripts\verify.ps1
# 五步：tsc 0 错误 · oxlint src 0 error · cargo test --lib 全过 · check-docs 全过 · vitest 全过
```

## 下个会话第一件事

1. **主线：iframe ↔ 宿主能力通道（v0.2）** —— 契约 §7.9 已写明要 `postMessage` 请求/应答协议 + **宿主侧鉴权**；再往后是插件签名 / 分发。
2. **记账文案校准**：等真实漏识别样本（「诊断」视图已就绪：遇到没记账的通知，看原文 + 原因，发来补规则）。

可选小项：卡片长按菜单没进返回键层栈（菜单开着按返回 → 直接退 App），要补就顺手。

### 本会话踩过的三个坑（务必避开）

- **按行号脚本删段**：先把最终行号定死再动手；中途再 edit 会让行号整体偏移（rev122 因此误删过 `DOC_CHANGE_DEBOUNCE_MS`，tsc `TS1128`）。
- **hook 内 `useState` 顺序**：state 必须声明在所有引用它的 `useCallback` **之前**（rev123 的 `undoDelete` 踩过，产生 `react(immutability)` warning）。
- **改 HANDOFF**：不要把 `> ## 📌 revN（…）` 标题行整行替换掉，否则 `check-docs` 报「索引有 revN 但正文无对应段」；新段插在旧标题**之前**，旧标题保留。

## 本会话（rev173.28 – 173.39 · 2026-10-19）

| rev | 内容 |
|---|---|
| 173.39 | **内嵌 HTML 白名单渲染**：DOMParser 自实现净化（属性全剔除 / script 丢弃）· 设置「内嵌 HTML」渲染 / 显示源码 · 默认渲染 |
| 173.38 | **Markdown 语法增强第二批**：脚注（上标引用 + 点击跳转 + 定义行接管）· Mermaid 图表（异步渲染）· 定义列表 |
| 173.37 | **版本管理**：单一来源 package.json · 关于页读 vite 注入 · `scripts/release.mjs` 同步三处 + tag · 首版 **0.2.0** |
| 173.36 | **Markdown 语法增强第一批**（内核 `editor-syntax.ts`）：上标 `^x^` / 下标 `~x~` / Emoji `:name:` / KaTeX 行内与块级数学 · 光标行显示源码 · 块级用 StateField |
| 173.35 | **灵感流插件搁置**：`inspiration-flow` 移出 `BUILTIN_PLUGINS`（预装 6→5）· 桌面 + 手机全局目录删除 · 源码留 `examples/` |
| 173.34 | **全局自绘滚动条**：所有滚动容器统一 · 无轨道 · 6px 半透明滑块（封顶 120px）· 滚动出现静止淡出 · 可拖 |
| 173.33 | 桌面「时间流」面板：侧栏与编辑区之间常驻 · 复用 `MobileNoteCards variant="panel"`（无 ＋）· 可拖宽 300px · 打开派发同文件树 · 卡流暗色滚动条 |
| 173.32 | 暗色滚动条跟随主题（`color-scheme: dark`，只挂编辑器子树 · 亮色默认 · 源码模式同覆盖） |
| 173.28 | **记账 v0.2**：统计视图（分类占比 + 近 6 月 SVG 柱状图）· CSV 导出（桌面另存为 / Android 写库根）· CSV 导入（微信/支付宝账单 + 单号去重 + GBK 兜底）· 真机端到端 |
| 173.28.1 | 记账：**原始通知诊断**（sync 留最近 20 条原文 + 未识别原因，只本机） |
| 173.29 | **移除测试插件** `daily-note`（预装 9→8）· 立**硬约束 8**「测试插件不留在功能」 |
| 173.30 | `asset-probe` / `net-demo` 退出全局（9→7）· 测试插件用法写进「环境现状」 |
| 173.31 | `editor-marks` / `tag-demo` 退出全局与预装（8→**6**）· 全局剩 **7 个**插件 |

**结果**：`#标签` 不再着色、`[[双链]]` 点击不再跳转（原语与源码都在 `examples/`，随时可装回）。

### 本轮踩坑（内置插件开发必读）

- 改 `examples/` 后**必须让页面 reload**（CDP `location.reload()`）再重扫：`ensureBuiltinPlugins` 会用 vite `?raw` 的旧内容覆盖全局目录。
- WebView2 的 CDP 端点只认 `node fetch`（`Invoke-WebRequest` 一律 404）。
- 手机 SAF 看不到新文件 = MediaStore 没索引（先广播扫描 / VIEW 打开一次）。

## 未决 / 下一步

| 项 | 状态 |
|---|---|
| 导图点击偶发不生效（手机） | ✅ **rev173.11**：行号改为 `data-zn-line`（不再靠 `posAtDOM` 反查）+ 手机端补整窗接管；真机 3 轮验证 |
| 手机工具栏缩进 | ✅ **rev173.8**：`⇤` / `⇥` 按钮（与 Tab / Shift+Tab 同一份逻辑） |
| 手机端导图入口 | ✅ **rev173.11**：点 ❖ → `overrideShell` 整窗接管（mind-elixir 真画布），右下角「释放接管」返回 |
| 插件存放 | ✅ **rev173.6**：只全局一处；两库 `.zn/plugins` 已删（备份在 `_tmp-plugin-backup/`） |
| 插件分类 | ✅ **rev173.4**：manifest.category + 插件页分组 + 存量插件全部补齐 |
| 图片 / 附件 | ✅ **rev173.3**：附件入口（文件树分组 + 预览）+ 右键「插入附件…」统一入口；桌面 / 手机实测 |
| App.tsx 拆分 | ✅ **L3 收官**：rev122 L1+L2 · rev123 useFileOps · rev124 useDocIO · rev125 useDocSession · rev126 useDocApi · rev127 useExternalFile · rev128 usePluginHost → **2285 行** |
| 前端单测 | ✅ rev120 起持续扩充，已并入 `verify.ps1` 第 5 步（数字看输出） |
| 远程仓库 / CI（P3-3） | ✅ **rev130**：`github.com/aqua7773/zeronote`（private）+ `.github/workflows/verify.yml`（五步） |
| App 编排层集成测试 | ✅ **rev131**：`tests/app-smoke.test.tsx` 3 条（真实挂载 App，覆盖三种启动分支） |
| atomic-editor 补丁回归 | ✅ **rev131**：`tests/atomic-editor-patch.test.tsx` 4 条（升级忘重打会红 + 真实渲染断言） |
| 快照备份 | ✅ **rev131**：`_kernel-snapshots/` 不入库是设计（与仓库重复）；分层见 `docs/开发约定.md §7` |
| merge3 同点插入语义 | ✅ rev121：判冲突、mine 赢（theirs 那段丢弃） |
| command 还原链残留 | ✅ rev121：接管改层栈，A 先卸后 B 卸落回内核 |
| 测试报告（2026-10-17 · 16 项） | ✅ rev117：7 项已修；P2-3 作废（用户实测 png 可导出，**无 zip 导出**）；剩 P2-7 观察项（工程债已 rev131 清） |
| 插件签名 / 分发 | ⚠️ rev119 已做 A+B：完整性 sha256 + `.znp` 安装 + 未签名提示；**真签名（公私钥）/ 市场 / 更新通道未做** |
| capability 安装确认 | ✅ rev119 安装 `.znp` 时弹出自述能力清单（内核仍不拦截） |
| iframe ↔ 宿主能力通道 | ❌ 未做（v0.2） |
| 记账插件 | ✅ **v0.2 完成**（rev173.16 原生捕获 / rev173.17 分类学习 / rev173.18 点分类即改+自定义分类 / rev173.28 统计图表 + CSV 导入导出 / **rev173.28.1 原始通知诊断**）。待办：**真实文案校准**（诊断视图已就绪：遇到漏记看原文+原因，发来补规则）· 预算 · 分类删除/排序 · AI 分类（可选） |
| 暗色模式滚动条 | ✅ **rev173.32**：`EDITOR_CSS` 加 `:root[data-theme='dark'] .zn-editor .cm-scroller { color-scheme: dark }`（UA 级开关）· 亮色默认值 · 源码模式一并覆盖 · CDP 实测 + 截图对比 |
| 桌面时间流面板 | ✅ **rev173.33**：侧栏与编辑区之间常驻（默认 300px，可拖 160–560）· 卡片复用手机起始页 `MobileNoteCards variant="panel"`（无 ＋ / 无长按）· 点卡片按 kind 派发（doc / image / note）· 插件页 / 回收站不显示 |
| 滚动条 | ✅ **rev173.34**：全局自绘（`GlobalScrollbars`）—— 所有滚动容器统一 · 无轨道 · 6px 半透明滑块（封顶 120px）· 滚动出现静止淡出 · 可拖 · 原生滚动条全部藏掉 |
| 灵感流插件 | ⏸ **rev173.35 搁置**：移出预装 + 桌面/手机全局目录删除 · 源码留 `examples/inspiration-flow/`（要用：复制进全局目录 + 重扫） |
| Markdown 语法增强 | ✅ **rev173.36 + 173.38 + 173.39 三批完成**：上标 / 下标 / Emoji / 数学（行内 + 块级）· 脚注（编号 + 跳转）· Mermaid 图表 · 定义列表 · **内嵌 HTML 白名单渲染**（设置可关）· 内核 `src/kernel/editor-syntax.ts` |
| 版本管理 | ✅ **rev173.37**：单一来源 `package.json` · 关于页 vite 注入 · `scripts/release.mjs <x.y.z> [--tag]` · 首版 **0.2.0**（tag `v0.2.0`）· 发版流程见 HANDOFF |
| 起始页快捷入口（长按 ＋） | ✅ **rev173.20–22**：长按 500ms → **以 ＋ 为圆心**的半圆环（记账 + 4 空位，`0°/±48°/±96°`），短按仍新建；入口按面板 title 找 id；返回键先关遮罩；点空白 click 关闭不穿透。真机 dev 版验收 · 桌面端 v0.2 |
| 手机版用户使用手册 | ✅ **rev173.23**：`docs/使用手册-移动端.md` + 12 张真机截图（`docs/images/manual-mobile/`）· 面向普通用户、带入口速查表 · **rev173.24 导出 PDF**（29 页，`docs/ZeroNote-手机版使用手册.pdf`） |
| 桌面 release exe | ✅ **rev173.26（隔离版）**：`identifier=com.aqua.zeronote.release` / 标题「ZeroNote Release」· 数据目录 `%LOCALAPPDATA%\com.aqua.zeronote.release` 独立 · 已放 `_View\办公与文档\zeronote.exe` · 与 dev **可同时运行** |
| 同步 / AI 标签 / 密级 | ❌ 未开工（需求2 暂不采用，方向待定） |
| M3 收尾④：真机「编辑→保存」人工确认 | ⏳ 旧悬置项（实机早已能保存，可忽略） |
| 沙箱 | ⏸ 搁置（用户裁决） |

> 已结清：文档阅读器（rev72–74）· 卡死兜底（rev70/71）· 触屏三件（rev67/68）· 插件跨库（rev94）· 内置预装（rev110）· 文档对齐（rev93 + 2026-10-17 契约 v0.2）· 前端单测（rev120）。

## 环境现状（活信息）

- **桌面 dev**：直接 `pnpm tauri dev`（vite 1420）即可——IL 已修，默认 UDF 正常；`scripts\dev.ps1` 是备用启动（UDF 放项目内 `_tmp-ebwebview`），两种都行。日志 `.self-logs/desktop-dev.log`；**android-dev** 另起（WMI，日志 `.self-logs/android-dev.log`）。
- **交接时 dev 状态**：`dev.cmd` 起的（**CDP 9222 在**，`node tools/cdp.mjs` 直接可用）；库 `_tmp-vault-tb`。**别用后台 job 托管 GUI 进程**（job 结束会连带杀进程树）；`dev.cmd` 自带 `ZN_WATCHDOG=off`。
- **别用管理员跑 dev**：管理员实例会污染默认的 WebView2 用户数据目录（普通权限再跑 = `0x800700AA`；
  注意这只是**多因之一**，不是最初那次报错的原因）—— 已污染就用 `scripts\dev.ps1` 绕开（项目内目录，普通权限稳定）。
- **dev 日志只进 stdout**（rev173.11 起）：`tauri-plugin-log` 去掉了 `LogDir` target，不再写 `%LOCALAPPDATA%\com.aqua.zeronote\logs`（那里被管理员实例写过后，普通权限会 `os error 5` 直接 panic）。
- **GitHub**：账号 `aqua7773`（gh 已登录，keyring）；**github.com 直连超时，必须走本地代理 `http://127.0.0.1:26561`**（`HTTPS_PROXY`）。gh 不在当前 PATH，用 `C:\Program Files\GitHub CLI\gh.exe`。
- **dev 崩溃**：连续多次 HMR 会 `0xc0000374 STATUS_HEAP_CORRUPTION`，重启即恢复（rev117 / rev118 各踩一次）。
- **手机 `33b676f6`（ARIA 24069RA21C）= 测试机，只跑已装的 dev 包**（`com.aqua.zeronote.debug`，连电脑 1420）：
  启动 `adb shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity`；前端改动 reload 即生效。
  **别为测试重编 APK**（硬约束 7）；判据：logcat 出现 `node_modules/.vite/deps/…`。**不装 release**。
- **防火墙**：1420 已放行（TCP，仅 `192.168.1.0/24`；网络被识别为 Public、手机 2.4G / 电脑 5G 跨 SSID）。
- **手机 CDP**（默认手机断言手段）：`adb forward tcp:93xx localabstract:webview_devtools_remote_<pid>` → `ZN_CDP=http://127.0.0.1:93xx node tools/cdp.mjs …`。
- **手机模拟点击**：`input tap` 无效；用 `input motionevent DOWN x y` ＋ `UP x y`（间隔 ~120 ms）。`screencap` 是物理像素。
- **手机白屏（HMR 失败）**：vite 报 `Failed to reload /src/App.tsx` 后页面不回滚 ⇒ 白屏
  （先看 logcat 是不是 `tauri::protocol::tauri: Failed to request …: error sending request`）；
  `adb shell am force-stop com.aqua.zeronote.debug` 重开即恢复（2026-10-19 实测）。
- **测试库 `_tmp-vault-tb/`**：3 篇笔记（`新笔记-15/18/19`）+ 3 个只读文档；**插件都在全局根**（7 个目录；rev173.5 起库内不放插件）。验收夹具**按需挂、用完即删**（rev117 的夹具已清）。
- **测试插件只在 `examples/`，不预装**（2026-10-19 用户定，硬约束 8）：
  要用时 `Copy-Item examples\<id> $env:APPDATA\com.aqua.zeronote\.zn\plugins\ -Recurse` → 重扫；用完删。
  已清出全局：`asset-probe` / `net-demo` / `daily-note` / `tag-showcase` / `editor-marks` / `tag-demo`。
- **安全区**：三处各吃 `env(safe-area-inset-*)` —— `.zn-app` / `.zn-plugin-window` / `.zn-shell-host > .zn-shell-mount`。
- **手机库插件会与仓库漂移**：与 `examples/<id>/index.js` **比大小**；同步只能手动 `adb push`（推到明确文件路径）。
  实测路径（dev 版）：`adb push <本地文件> /data/local/tmp/x.js` → `adb shell run-as com.aqua.zeronote.debug cp /data/local/tmp/x.js .zn/plugins/<id>/index.js`（`run-as` 的 cwd = `/data/user/0/com.aqua.zeronote.debug`），再页面 reload。
- **CDP 关窗口的坑（rev173.11 踩过）**：别用 `plugin:window|destroy` 关插件窗口 —— 实测**主窗口一起没了**（进程只剩插件窗口、9222 消失）。关窗口让用户点，或只 `clearShell` 不毁窗口。
- **dev 起不来的真根因：项目目录被标了 Low 完整性级别（Low IL）**（rev173.11 查到底）：
  `src-tauri` / `target\debug` / `src` / 项目根都带 `Mandatory Label\Low Mandatory Level:(I)(OI)(CI)(NW)`。
  zeronote.exe 继承 Low IL ⇒ **写不了 `%LOCALAPPDATA%`（Medium）** ⇒ `create_dir_all` 报
  `拒绝访问 (os error 5)` / WebView2 报 `0x8000FFFF` / log 插件同一错误；管理员能跑 = High IL 不受限。
  同路径 pwsh/node（Medium）完全正常 —— 所以之前误判成沙箱/ACL。
  **修复**：`icacls src-tauri /setintegritylevel (OI)(CI)Medium`（`target` 同步），重编后 exe 变 Medium，
  **dev 用默认 UDF 正常启动**（23:46 实测）。`scripts\dev.ps1` 保留（无害）。
  **规矩**：dev 只用普通权限跑；别手删 UDF 里的 `LOCK`；别用 `plugin:window|destroy` 关窗口。
- **Rust 测试临时目录**：`<repo>/_tmp-test/`（不是 `%TEMP%`，受限上下文写不了）。
- **前端单测**：`pnpm test`（vitest，`tests/**/*.test.{ts,tsx}`，条数以 `verify.ps1` 输出为准）；组件测试用 happy-dom，文件首行 `// @vitest-environment happy-dom`。
- **第三方补丁**：`patches/@atomic-editor__editor@0.6.2.patch`（空标题不隐藏 `#`）；升级必须重打。
- `.gitignore`：`_shots/`、`_tmp-*/`、`examples/*/store.json`。

## 硬约束

1. capability / 安全模型变更 → 先拿用户对「具体方案」的同意（方向同意 ≠ 方案同意）。
2. 每批交付：`verify.ps1` 全过 ＋ 实测证据 ＋ 提交 ＋ HANDOFF 新 rev。
3. 手机截图走 `adb shell screencap`；**CDP `shot` 抓不到 WebView 里的 canvas**。
4. **内核保持薄**；**静默失效比报错危险**（看数字，不只看 "ok"）。
5. GUI 验收用 `gentle_*`；截图按窗口 `rect` 向内缩 ~10px。
6. **动手前先查现成**（`docs/开发约定.md §0.5`：同类案例 / 官方文档 / 项目内已有能力；查不到再自建）；改代码 / 重构前先读该文档。
7. **安卓测试机只跑已装的 dev 包，不要重新编译/安装**（2026-10-19 用户第二次提醒，已经踩过很多次）：
   - 启动：`adb shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity`（**别再跑 `tauri android dev` / `android build`**）
   - 改前端（`.tsx/.ts/.css`）→ 页面 `location.reload()` 就生效；白屏也先 reload 一次
   - 只有改了 **Rust（`src-tauri/src`）/ 原生插件** 才需要重装 APK
   - **测试机不装 release 包**（`com.aqua.zeronote` 是分发包：内置 dist、不接 1420、与 dev 数据目录不同）
8. **测试 / 验收产生的插件不留在「功能」里**（2026-10-19 用户定）：探针、夹具、演示插件只放 `examples/` 或临时目录，验收完即删；
   **不写进 `BUILTIN_PLUGINS`、不进预装、不留在用户插件列表**。功能插件必须来自用户的明确需求（规格条目或原话），
   不接受「顺手做的」「演示用的」「为了验证某个 API 而建的」混进功能清单。
9. **改 `examples/` 后必须让页面 reload 再重扫**：`ensureBuiltinPlugins` 用 vite `?raw` 打包的内容**覆盖**全局目录；
   只点「重新扫描」或用旧 raw 的页面 reload 都会把刚删/刚改的插件写回旧版。

## 授权边界（给 AI）

- 已授权：工作区内建目录 / 写文档 / 装 npm 依赖 / 构建运行 / 并发子 agent / git 提交 / 项目级配置。
- 需批准：装系统级软件 · 改 PATH / 注册表 · `rustup target add` · `tauri android init` · 发 GitHub 仓库 · 任何删除。

## 细节读哪

`HANDOFF.md`（rev 索引）· `docs/内核契约-v0.2.md` · `docs/架构原则-2026-10-13.md`（**冲突时以它为准**）· `docs/README.md`（权威矩阵）· `docs/文档阅读器-调研-2026-10-13.md` · `docs/卡死兜底方案-2026-10-13.md` · `tools/verify-*.mjs`（自动验收）
