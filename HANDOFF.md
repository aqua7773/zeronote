# 项目交接

revision: 6
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
| **内核补齐·容错围栏** | `_shots\fix-05~08.png`：崩溃插件只坏自己那格（改前白屏 `boom-07-crash-tab.png`） | `65386cd` | 2026-10-11 |
| **Tailwind 4 + ui 原语** | `tsc -b` 0 error / `oxlint` 0 error；`--zn-*` 经 `@theme inline` 映射成 shadcn 命名 | `65386cd` | 2026-10-11 |
| **文件操作** | `_shots\fm-02~07.png`：右键菜单、行内重命名、两步删除；磁盘实测 `灵感流.md`→`linggan-test.md`→`.zn/trash/<ms>--linggan-test.md` | `65386cd` | 2026-10-11 |
| **设置页** | `_shots\st-01/02.png`：Dialog 居中 + 左导航（通用/插件/关于）+ 库路径 + 外观选择器；顶栏「设置」按钮 | `c6bc326` | 2026-10-11 |
| **主题三态** | `_shots\kb-01-modcomma.png`：浅色/深色/跟随系统三选一，当前项高亮 | `c6bc326` | 2026-10-11 |
| **快捷键派发器** | `_shots\kb-01-modcomma.png`：`Ctrl+,` 打开设置（**该 keybinding 此前声明了但完全失效**）；`Ctrl+Shift+F` 打开搜索 | `c6bc326` | 2026-10-11 |
| **index 原语 + 搜索** | `_shots\sr-05/06.png`：搜单字母 `u` 命中 1 条（内容「# 新笔记」不含 u，只有文件名含 ⇒ 证明文件名进了索引）；状态栏「已索引 1 篇 · 11 ms」；子 agent 30/30 行为自测 | `c6bc326` | 2026-10-11 |
| **面板位置分流** | `_shots\loc-01/03/04/05/06/10.png`：statusbar→状态栏 widget（不进 tab）、sidebar→右栏、main→主编辑区（带返回条）、modal→Dialog 弹窗，四种位置逐个验收 | `c6bc326` | 2026-10-11 |
| **即时渲染** | `_shots\ed-03-tree.png`：打开笔记后 `# 新笔记` 渲染为加粗大字、源码 `#` 隐藏 | `c6bc326` | 2026-10-11 |
| **关闭当前笔记**（用户反馈补） | `_shots\cn-01-opened.png`（✕ 出现）→ `cn-04-closed.png`（点击后路径变「没有打开笔记」、主区回欢迎页）。用户原话：「编辑页面没有返回的办法」 | 见下 | 2026-10-11 |

## UI / 交互改进（2026-10-11 晚）

依据两份调研（`_research\成熟产品布局规范.md` 与 `成熟产品交互规范.md`，均逐条附来源）
分三批推进，规划见 `docs\UI规划-v0.1.md`。**P0 七项已全部完成**：

| # | 事项 | 提交 | 验收证据 |
|---|---|---|---|
| 1 | 命令面板 `Ctrl+K` → **`Ctrl+P`**（`Ctrl+K` 留给插入链接） | `63a9dd6` | `_shots\kp-01-ctrlp.png` |
| 2 | 删除改「一步完成 + 撤销条」（去掉两步确认） | `046b8e9` | `_shots\del-03-undo-bar.png` → `del-04-restored.png` |
| 3 | 每笔记独立撤销栈（CM6 EditorState 缓存，LRU 20） | `7c3fbfb` | `_shots\uz-11-content.png` → `uz-12-restored.png` |
| 4 | 光标 + 滚动位置记忆 | `f016273` | `_shots\sc-06-scrolled.png` → `sc-07-back.png` |
| 5 | 自动保存兜底 flush（失焦 / 隐藏 / 关窗前） | `29bbac4` | 输入后 ~400ms 最小化，文件已含新内容 |
| 6 | 统一焦点圈（WCAG 2.4.13）+ Esc 一次只吃一层 | `ef3bf13` | `_shots\fr-01-focusring.png` |
| 7 | 错误提示改说人话（NN/g 文案规范） | `c9da1e8` | **未实测截图**（造真实错误的尝试均失败，理由见该提交信息） |

期间顺带修掉的真实 bug 与调整：

- **按钮文字看不见**（用户反馈）：`tailwind-merge` 不认识本项目自定义色名，把 `text-primary-foreground`
  误判进「字号」组、与 `text-sm` 冲突后**静默丢掉颜色**。修法：`extendTailwindMerge({ extend: { theme: { color: [...] } } })`
  —— v3 的键是 **`color` 单数**（写 `colors` 会 TS2561）。影响面：所有 `cn()` + 自定义色名的组件（Button/Dialog/ContextMenu）。
- **正文宽度**：按用户要求改为「占满 + 四周留白」，取消固定列宽（token `--zn-editor-pad-*`）。
- **空态**：改成三态引导（没选库 / 库是空 / 有笔记没打开）+ 一行快捷键线索（依 NN/g 空态三原则）。
- **状态栏**：降到 22px / 12px，把配置类计数「插件 N/M」移出（属设置页信息）。

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
- [x] **面板 `location` 未分流** ✅（2026-10-11，`c6bc326`）—— 四种位置此前全塞进右栏 tab；现按 location 分别渲染：sidebar → 右栏 tab / main → 主编辑区（带「返回编辑器」条）/ statusbar → 状态栏 widget（不进 tab 列表）/ modal → Dialog 弹窗。真机逐个验收（`_shots\loc-*.png`）
- [x] **`index` 原语** ✅（2026-10-11，`c6bc326`）—— 内存全文索引：多关键词 AND（空格分隔）+ 中文子串（纯 indexOf、不构造正则）+ excerpt 哨兵 + score 排序；顺带修掉「文件名不进索引」（内容首行标题非空时 `titleFromPath` 兜底不触发，按文件名搜不到）
- [x] **UI 打磨（Tailwind）** ✅（2026-10-11，`65386cd` + `c6bc326`）—— Tailwind 4 + `@theme inline` 映射 `--zn-*`（**没引 shadcn 全量**，只取了 Button / ContextMenu / Dialog 三个原语 + `lucide-react` 图标）
- [ ] `doc.on` 文档事件订阅（v0.2）
- [x] **编辑器缺「关闭当前笔记」** ✅（用户 2026-10-11 反馈「编辑页面没有返回的办法」）—— 顶栏路径右侧加 ✕（有打开笔记时才出现）+ 命令 `core.closeNote`（`Mod+W`）；`closeNote()` 有未保存内容先落盘，语义与切笔记/切库一致
- [ ] **移动端「回列表」入口是否够明显**（待用户确认）：窄屏抽屉由顶栏 `☰` 开关，打开笔记后抽屉会自动收起；若用户期望的是"返回列表"而非"关闭笔记"，需把 ✕ 改成返回语义或补一个显式返回键
- [ ] **编辑器内「替换」缺失**（P1 第 4 项只完成一半）：`Ctrl+F` 查找可用（atomic 内置面板：
      查找框 / 上下一个 / 关闭 / 匹配高亮 / 命中计数），但**替换不可用**。已查明原因：
      · 面板**不是** CM6 原生 `defaultSearchPanel`（placeholder 是 "Search" 而非 "Find"，
        `EditorState.phrases` 覆盖对它无效）→ atomic 实际渲染的是自己那套面板
      · atomic handle 只暴露 `openSearch / closeSearch / revealText / isSearchOpen /
        getMarkdown / getContentDOM / setReadOnly / focus / undo / redo` —— **没有 replace**
      · `Ctrl+H` 无绑定；用 CSS 强制显示替换行也无效 → 该行在 DOM 里根本没渲染
      两条实现路径（择一）：① 自带替换 UI（用 handle 的 getMarkdown + doc 原语做替换）
      ② 不用 atomic 的 search，自己在 extensions 里挂 CM6 的 search 扩展
      （会与它内置的重复，需先确认能否关掉它的）
- [ ] 更多真插件（画布 / 同步 / AI 等，用户说清单「先保留」）

## 唯一下一步

**0. 继续 UI 第三批（P1）**：标题栏尺寸对齐 Windows 规范（32px 高 / 46px 按钮 / 图标距左 16px）
→ 侧栏折叠入口去重（`☰` 与目录栏 `✕` 留一个）→ `Ctrl+O` 快速切换 → `Ctrl+F`/`Ctrl+H` 查找替换
→ 命令面板与搜索面板增强。规划与依据见 `docs\UI规划-v0.1.md` §3。

**1. 等人工确认 M3 最后一步**：手机上点 `☰` → `＋` → 输入 → 停 1 秒 → 库里应出现 `untitled-*.md`
（`adb shell run-as com.aqua.zeronote.debug ls -la /data/user/0/com.aqua.zeronote.debug/vault`）
—— 合成点击（`adb shell input tap`）在 WebView 内命中不稳定，已试 6 次不再试。

**2. 之后的议程（M4 候选，按价值排序）**：

| # | 议题 | 为什么现在做 |
|---|---|---|
| **A** | ~~Android 库位置 + 插件分发~~ → **✅ 已采纳方案 D 并真机实测通过（2026-10-11 17:03）** | **调研结论**（两份报告：`_research\移动端插件分发调研.md` 337 行 + `_research\tauri-android-file-access.md`）：① 移动端可以有插件（Joplin 官方支持，Android 能 `Install from file`；限制只有 iOS 商店政策 + 沙箱只跑 HTML/JS —— 我们正好是 JS+声明式 UI）② 库放共享存储是主流（Obsidian 官方推荐 device storage；**SiYuan 用私有目录被社区 fork 修掉**）③ **Tauri 在 Android 上没有 SAF 支持**（issue #11733 open），`dialog.open({directory:true})` 移动端**源码级返回 `FolderPickerNotImplemented`** ④ 唯一活的 SAF 插件 `tauri-plugin-android-fs`。<br>**采纳 D 的实施**：`AndroidManifest.xml` 加 `MANAGE_EXTERNAL_STORAGE`；`src\App.tsx` 的 Android 库路径改为公共存储常量 `ANDROID_VAULT = /storage/emulated/0/Documents/ZeroNote`；开发期授权 `adb shell appops set com.aqua.zeronote.debug MANAGE_EXTERNAL_STORAGE allow`。<br>**真机证据**：库建在公共 `Documents/`（与 HYKB/qqmusic 等并列）；PC `adb push test-from-pc.md` 后应用状态栏 **`0 篇` → `1 篇`** ⇒ 数据通路打通（`_shots\android-14.png`）。<br>**✅ 2026-10-11 17:09 完成 M2 插件体系的真机首验**：`adb push examples\hello-plugin` → `/storage/emulated/0/Documents/ZeroNote/.zn/plugins/hello` → 重启应用 → 右栏出现「Hello 插件」tab、声明式面板（标题/说明/按钮）正常渲染、点「打个招呼」弹出 toast「你好，ZeroNote！这条通知来自一个插件。」 ⇒ **库内读插件 → capability 校验 → Blob 动态 import → 面板注册 → 声明式渲染 → 命令执行 → notify，全链路在 Android 上跑通**（证据 `docs\evidence\m4-android-plugin-first-run.png`）。**插件分发路径确认可行：文件管理器把插件目录拷进 `.zn/plugins/` 即可，不需要 adb。**<br>**移动端已知小问题**：右栏展开时同一次 tap 会落到新渲染出的按钮上（点击穿透）⇒ 移动端 UI 需要防误触（展开动画期间禁用穿透 / 加 debounce）。<br>**待补**：正式版需在应用内引导用户去设置授权（Kotlin 启动 `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`；**Tauri 2 的 Android 插件怎么写要先去查官方文档 + 社区示例**，别再自创） |
| B | ~~`index` 原语~~ → **✅ 已完成（2026-10-11，`c6bc326`）** | 内存全文索引 + 搜索面板；`core.search` = `Mod+Shift+F` |
| C | **第二个真插件（画布 / Git 同步）** | 用户 04:15 点名的四件（笔记/记录/画布/同步）里还剩画布与同步 |
| D | ~~UI 打磨（Tailwind + shadcn）~~ → **✅ 已完成（`65386cd` + `c6bc326`）** | Tailwind 4 + 主题三态 + 设置页 + 快捷键派发器 |
| E | **插件入口形态兼容**（CJS / IIFE / TS / 无 JS 资源型 / 多文件） | 现状只吃 ESM 单文件（Blob + 动态 import），方案见 `_research\插件API对比.md`；这是「插件生态能长多大」的天花板 |

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
- **不要目测截图里的坐标**（2026-10-11 连栽三次）：① PrintWindow 画布 1800px 而预览图 1554px，目测值差约 15%；② **tab 栏的横向滚动位置会变**，上一轮扫到的坐标下一轮就失效。**正确做法：同一个脚本里先 `PrintWindow` 扫描目标元素的像素列段，拿扫描结果直接去点**，绝不跨轮沿用坐标。命中失败时先怀疑坐标，别怀疑功能没实现。
- **`PrintWindow` 可能返回同一帧**：连续两次截图 sha256 完全相同 ⇒ 别当成"功能坏了"。**2026-10-11 二次踩坑**：WebView 未重绘时它会把**旧的缓存帧**原样吐出来（实测连续三张图字节完全一致，而界面早已变了），一度误判成"代码没生效"。**正确做法：改用 `Graphics.CopyFromScreen(窗口矩形)` 抓屏**，抓到的才是实时内容（体积也明显更大：86 KB vs 32 KB 缓存帧）。
- **HMR 会断——`F5` 也可能救不回来，这时只能重启 dev**（2026-10-11 实测）：vite 日志显示 `[vite] (client) hmr update /src/App.tsx` 一直在发（watcher 没死），但 WebView 里始终是旧界面，连 F5 都不生效。根因是 WebView 的 HMR WebSocket 断了、页面重载也没接上。**判据**：改了 `src/**`、vite 日志有对应 `hmr update`，但界面纹丝不动 ⇒ 直接重启 dev（`Stop-Process` 掉 `zeronote` + `cargo` + 占 1420 的 node，再 `Start-Process cmd /c dev.cmd`），别再去查代码。**副产物**：`file watcher error: EBUSY ... .tmpdir\App.tsx.tmp` 是 dsh 的 edit 工具用「临时文件 + rename」写盘造成的噪音，无害，不是 HMR 断线的原因。
- **点击前先点一下空白处**消耗窗口激活 —— 非活动窗口的第一次点击会被系统吃掉用于激活。
- **验收要挑"只可能由被测功能产生"的信号**：验证「文件名进索引」时用单字母 `u`（笔记内容「新笔记」不含 u，只有文件名含），命中即铁证；比搜一个标题正文都有的词强得多。
- **改 `tauri.conf.json` 的 `devUrl` 加 `?vault=` 可切测试库**（tauri CLI 自动重启，~40 秒），**验完必须改回**。

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
