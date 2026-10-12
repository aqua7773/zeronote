# 项目交接

revision: 30
更新时间: 2026-10-12（下午 · ⑧ net 授权通道 + ⑩ WebView 逃生口落地；CSP 从 null 变成白名单；
                     并修掉"重载后命令 id 重复"的双重根因）
项目: ZeroNote

> ## 📌 rev30 一次看懂（2026-10-12 下午）
>
> **用户当场授权「⑧ 和 ⑩ 都做」**（原话：选「⑧ 和 ⑩ 都授权」），两项都落地并真机验收：
>
> 1. **⑧ `net` 授权通道** —— 设置页「插件 → 网络访问」逐插件开关；授权记录
>    `库/.zn/permissions.json`；`assertCapabilities` 对 `net` 从"声明即拒"改成**查授权记录**
>    （未授权仍拒；文件损坏也 fail closed）；契约 §4 **诚实改写**：这是**可绕过的边界**，不是隔离。
> 2. **⑩ WebView 逃生口** —— `registerWebView` 最小版：`<iframe sandbox="allow-scripts">`
>    （**无** allow-same-origin）+ 主题令牌 `postMessage` 送达并随主题切换自动重发。
>    **`tauri.conf.json` 的 `csp` 从 `null` 落地成一份白名单**（`default/connect/img/style/font/script/frame-src`）。
> 3. **顺带修掉两个真 bug**（做 ⑧ 时被"重扫/授权触发重载"这条路径暴露）：
>    · **插件注册的资源没有自动登记** —— `examples/` 里 **8 个**示例（ui-kit / tag-demo / cdn-* /
>      yank-style / dep-crypto / index-scope / editor-marks 的一部分）只写了 `command.register({...})`
>      **没接返回值** ⇒ 卸载不撤命令 ⇒ **第二次加载同一个插件必撞「命令 id 重复」**。
>      修法：宿主在 `ctx.command` / `ctx.view` 外层**自动登记**（不再指望插件作者记得 push）。
>    · **新旧两代插件会同时注册命令** —— 卸载是异步的、加载也是异步的，两代重叠就撞 id。
>      修法：把「卸上一代 + 装本代」**整段挂到同一条 promise 链上**，被取代的一代在每个检查点退出。
>      **真机压力测试**：连点 6 次「重新扫描」零错误（`_shots/perm-22-rescan-ok.png`、`perm-23-rescan-bottom.png`）。
>
> ⚠️ **验收基线有一处变化（有意，已记录）**：`oxlint` 从 **5 warnings → 4 warnings**。
> 原因是 `setPluginError(null)` 从 effect 体里挪进了异步回调，`react(set-state-in-effect)` 不再命中。
> 是"警告减少"，不是新问题；**新基线 = 4**（`tsc -b` 仍 0 错误、`cargo test --lib` 仍 16 passed）。
>
> 📷 **本次证据**：`_shots/perm-05…23*.png`（⑧ 全链路 + 重扫压力测试）、
> `_shots/csp-0*.png`（CSP 对 katex 无影响 + 网络边界对照）、
> `_shots/webview-0*.png`（iframe 令牌 + 深色跟随）。

> ## 📌 rev30.1（同日 12:30 · CSP 放宽 + 一处**结论纠正** + 插件能力盘点）
>
> 1. **用户裁决：`connect-src` 放宽**（原话「放宽」）—— 配置从域名白名单
>    `… https://esm.sh https://cdn.jsdelivr.net ws://…` 改为 `'self' ipc: http://ipc.localhost https: http: ws: wss:`。
>    `script-src` **未放宽**（远端模块仍限 `esm.sh`）；`frame-src` / `img-src` 未动。
> 2. ⚠️ **纠错（重要，已改三份文档）**：我此前把「`fetch(example.com)` 报 `Failed to fetch`」
>    归因成 **CSP 拦截**——**错了**。`adb logcat` 显示真相是
>    `has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header`。
>    **教训**：CORS 与 CSP 在插件侧报的是**同一句** `TypeError: Failed to fetch`，
>    分辨只能看 logcat（CORS → `blocked by CORS policy`；CSP → `Refused to connect …`）。
>    ⇒ **插件联网第一道真正会撞上的墙是 CORS**（目标服务必须回 `Access-Control-Allow-Origin`），
>    这对做 WebDAV / AI 插件的实际意义远大于 CSP。
>    **未验证项**：白名单期是否真的拦过某次 `fetch`（本轮无回测，已如实标注）。
> 3. **真机三重对照**（`examples/net-demo/` 三个按钮，证据 `_shots/csp-14…15*.png`）：
>    ① `esm.sh`（有 CORS）→ **200**；② `www.baidu.com`（无 CORS）→ 被 CORS 拦；
>    ③ `registry.npmmirror.com`（有 CORS、**原本不在白名单**）→ **200（7184 字节）⇒ 放宽生效**。
> 4. **插件能力盘点 + 六家对比**（子代理产出）：新增 `docs/插件能力盘点-2026-10-12.md`（361 行）。
>    结论摘要：**领先** = 声明式 `UINode`（调研称「六家无对等先例」）/ 入口形态 4 种通吃 / 21 节点；
>    **落后** = 无沙箱无超时（对照 NoteGen 的 32 MiB + 75 ms）/ capability 只真裁 **2/13** 且授权不绑指纹 /
>    无市场无签名无更新 + `platforms` 不强制。**最值得先做：`platforms` 强制（1–2 小时）**。
> 5. **顺手修掉三处文档自相矛盾**（子代理发现）：契约 §0「8 个原语」→ **10**；§2 标题「五原语」→ **六**；
>    §2.2 的 `url` 注释曾写「接受 `data:`/`blob:`/`asset:`」，与同节 ④ 的实测结论打架 → 已改为「必须是独立 origin」。
> 6. **基线未变**：`tsc -b` 0 错误 · `oxlint` 4 warnings · `cargo test --lib` **16 passed**。

> 三角色（主管 / plan / act）与 `DSH-SUPERVISOR-V1` 标识**已于 2026-10-12 按用户要求废止** ——
> 主会话可直接实现，也可派任意子 agent（规范见 `~/.dsh/AGENTS.md`「子 agent 的使用（允许，不强制角色分工）」）。

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
| **🔄 真机 HMR 修复** | `_shots\android-hmr-test.png`：改 `App.tsx` 文案后真机界面**自动**出现 `HMR-OK`，无需重新构建安装；设备日志 `[vite] connected.` + `hot updated: /src/App.tsx` | `7cace9e` | 2026-10-12 |
| **📚 手机端多库** | `_shots\android-vault-listed3.png`（面板列出「默认库·当前」+ `.vaults/Work`）· `android-vault-switched.png`（切到 Work：顶栏变 Work、底栏 **5 篇 → 0 篇**）· `android-vault-new-ok.png`（新建「1231」目录建出并自动切过去）· `android-vault-final.png`（切回默认库恢复 5 篇） | `3e2886d` | 2026-10-12 |
| **🔗 插件跨库共用 + 面板视觉** | `_shots\android-vault-T-plugins.png`：切到**空库 T**（底栏 0 篇、且 T 里没有 `.zn`）而 `☰` 菜单里 **Hello 插件 / 灵感流照旧在** ⇒ 插件确是从**库根**加载 · `android-vault-divider2.png`：去掉深色块后白底深字可读，库之间是 `rgb(228,228,231)` 的横线（像素扫描 y=1301 / 1458 / 1664 各 3px 高） | `24f7b46` | 2026-10-12 |
| **📐 设置页窄屏布局修复** | `_shots\android-appearance-issue.png`（修前：「外 观」竖排 + 说明**逐字一行**）→ `android-appearance-fixed.png`（修后：上下排列，「外观」正常、说明正常折行、主题三段控件独占一行） | `8273c57` | 2026-10-12 |
| **🗑 插件可删除** | `_shots\verify-plugins-page.png`（每行右侧出现垃圾桶）→ `verify-delete-confirm.png`（二次确认框，写明删哪个目录 + 不可撤销）→ `verify-delete-done.png`（列表只剩灵感流 + toast「插件已删除」）；**磁盘实测** `.zn/plugins/hello` 消失 · `cargo test` **11 passed / 0 failed**（新增 2 个：删除路径 + 越界/不存在 id 必须报错） | `9ed1469` | 2026-10-12 |
| **🧩 UINode 9 → 21 种** | `_shots\uikit-rendered.png`（第一屏：tone 三色 / badge 5 档 / progress / image(data URL) / code / html / field+input / field+textarea / select）· `uikit-rendered-2.png`（第二屏：button 三档+禁用 / `send` / link / 可点列表 / **table 且单元格内嵌 badge** / tabs）· `uikit-interact.png`（点按钮后底部 payload 变 `{"variant":"default"}` ⇒ **命令 → state → 重渲染**链路通）· 演示插件 `examples/ui-kit/` | `da377a7` | 2026-10-12 |
| **🧰 插件能力第 1 批**（fs 文件夹 · 编辑器工具栏 · 导出落盘） | `_shots\toolbar-with-plugin.png`（编辑器底部出现工具栏：H1/待办/代码块/引用/表格 + 徽标）↔ `toolbar-without-plugin.png`（**把插件移出插件目录后，工具栏整条消失**，界面回到纯净态 ⇒ **按需激活的直接证据**）· `cargo test` **12 passed / 0 failed**（新增 `dir_ops_create_and_move_safely`：多级建目录幂等 / 整树搬迁 / `mv` 语义 / 拒绝移进自己子孙 / 越界被挡） | `f4aaa23` | 2026-10-12 |
| **🔌 service 原语 + 前置插件** | `_shots\dep-katex-final.png`：`dep-consumer` 用 `service.consume('katex')` 拿到 `dep-katex` 提供的渲染器 —— 两条公式（求根公式 / 求和公式）正确排版 + 绿标「katex 0.16.11（由前置插件提供）」⇒ **依赖环境插件化 + 懒加载 + 软依赖**全链路通 · 示例 `examples/dep-katex` `examples/dep-consumer` | `0766529` | 2026-10-12 |
| **✍️ editor 原语（编辑器行内标记）** | `_shots\editor-marks-rendered.png`（`#测试标签` / `#编辑器标记` 呈灰底标签样式 ⇒ 插件正则装饰生效）· `editor-marks-click2.png`（点击标签后 toast 出现，抓到动画中态 ⇒ **点击 → 命令 → notify** 链路通）· 示例 `examples/editor-marks/` | `80d4c57` | 2026-10-12 |
| **⚡ 懒激活（activationEvents）** | 三段证据：① 启动后 `adb logcat` **无** `lazy-demo` 任何输出 ⇒ **确实没加载** ② 命令面板**列得出**「懒加载示例：打个招呼」(`lazy-demo.ping`)，同列表 `hello.say` / `ui-kit.hit` 是启动即加载的老插件**形成对照** ⇒ 静态声明生效 ③ 点它 ⇒ toast「这个插件是被你点的那条命令激活的」⇒ **懒激活 → bind → 执行**全通 · 截图 `_shots\lazy-palette2.png` · `_shots\lazy-activated.png` · 示例 `examples/lazy-demo/` | `47772f0` | 2026-10-12 |
| **🗂 index 分区（按密级隔离）** | 同一关键词 `zzyzx-plugh` 在两个分区查 —— `_shots\scope-default.png`：**默认分区 0 条** `[]` · `_shots\scope-secret.png`：**机密分区 1 条** `["机密/绝密草稿.md"]` ⇒ **隔离生效**（规格 §2.6 的"机密/绝密只用本地索引"靠它）· 示例 `examples/index-scope/` | `213bd81` | 2026-10-12 |
| **🔐 安全存储（加密前置插件）** | `_shots\crypto-selftest.png`：命令面板跑「加密自检」⇒ toast「**✅ 加密自检通过：往返一致 + 错 key/错密码都解不开**」—— 一次验收证明三件事：**WebCrypto 在真机 WebView 可用**（`crypto.subtle`）· PBKDF2+AES-GCM 往返正确 · **负向验证成立**（换 salt 或换密码都解不开）· 插件 `examples/dep-crypto/` —— **内核零改动** | `321a434` | 2026-10-12 |
| **🏷 标签能力（抽取 / 聚合 / 筛选）** | `_shots\tag-stats-fixed.png`：toast「索引 6 篇 / 38ms；共 4 种标签：工作(1)、会议(1)、项目A(1)、正文标签(1)」—— **修复前**是「工作(1)、**工作。(1)**、项目A(1)、正文标签(1)」，对照可见"句号被吸进标签名"与"中文键 `标签:` 被吞"两个 bug · `tag-query-ok.png`：toast「标签「工作」下 **1 篇：tag-test**」· 示例 `examples/tag-demo/` | `8eb647d` | 2026-10-12 |
| **🎯 内核命令可被插件接管** | `_shots\daily-note-takeover.png`：装上 `examples/daily-note`（它 `bind` 了 `core.newNote`）后点菜单「新建笔记」⇒ toast「**已建在当天目录：笔记/2026/10/12/02-23-46.md**」+ 编辑器自动打开 + 磁盘上确实出现 `笔记/2026` 目录 ⇒ **规格 §2.2 的「'笔记'目录下只能在当天时间目录新建」达成** | `7a70829` | 2026-10-12 |
| **📤 导出二进制 + Android SAF 差异** | `_shots\bin-dialog.png`：系统「另存为」正确带出文件名 `ui-kit-1px.png`（`defaultName` 生效）· **真机暴露一个桌面测不出的平台差异**：保存后磁盘上是 **0 字节** —— Android 的 `save()` 返回 `content://` **SAF URI** 而非文件路径，`std::fs` 处理不了 ⇒ 已加特判 + 专门报错，契约标注「桌面可用 / Android 受限」 · `cargo test` **14 passed**（含 `b64_decode` 与 `export_target` 两条新测试） | `3e722db` | 2026-10-12 |
| **⚡ 灵感流按规格重写 + 竞态幽灵 bug** | `_shots\flow-panel.png`：面板「落在 笔记/年/月/日/ 下 · 共 2 条」+ 时间流倒序列表 · `flow-saved.png`：输入 `hello` 点捕捉 ⇒ toast「已捕捉 ✎」+ 状态行「已捕捉 → 笔记/2026/10/12/02-39-08.md」+ **输入框自动清空** + 列表 2→3 条 · **磁盘实测** `笔记/2026/10/12/02-39-08.md`（18 B，内容 `# 02-39-08` + `hello`）· 同时修掉插件重载的竞态幽灵 | `848ba61` | 2026-10-12 |
| **🔐 ⑧ net 授权通道（真机全链路）** | `_shots/perm-05-plugins.png`：装上 `examples/net-demo` 后**拒载**，错误信息直接指路「（到「设置 → 插件 → 网络访问」里为它开启；授权记录 .zn/permissions.json）」→ `perm-08-net-section.png`：设置页出现「网络访问」区块 + 诚实措辞 → `perm-13-granted.png`：打开开关 ⇒ toast「已允许「net-demo」访问网络」+ 状态行变「**已授权联网**」+ 插件日志 13→33 → `perm-14-menu-after.png`：`☰` 菜单里出现「网络访问示例」⇒ **插件真的被加载了**；**磁盘实测** `.zn/permissions.json` = `{"net-demo":["net"]}`（撤销开关即恢复拒载）· `cargo test` **16 passed**（新增 2 条：授权往返 + 坏文件 fail closed） | 本次 |
| **🖼 ⑩ WebView 逃生口** | `_shots/webview-06-http.png`：`WebView 示例` 面板里是**插件自己的页面**，页面自证三行 —— 「令牌 <b>32</b> 个 · 模式 <b>light</b> · 第 1 次收到」/「--zn-bg = #fff」/「我的 origin: http://192.168.1.20:8791（**与宿主不同源**）」；`webview-08-dark.png`：切深色后变「模式 **dark** · 第 **2** 次收到」+ `--zn-bg = #18181b` + **整页背景跟着变** ⇒ postMessage 令牌 + 跟随主题切换全通 · 示例 `examples/webview-demo/` | 本次 |
| **📊 CSP 落地 + 白名单内外对照实验** | `tauri.conf.json` 的 `csp` 从 `null` → 白名单；`_shots/csp-02-katex.png`：**katex 的 CDN 加载完全不受影响**（两条公式正常排版 + 绿标「katex 0.16.11（由前置插件提供）」）；对照实验 `csp-05-whitelist.png`（`fetch('https://esm.sh/…')` → **HTTP 200 —— 通**）vs `csp-06-blocked.png`（`fetch('https://example.com/')` → **`TypeError: Failed to fetch` —— 被拦**）⇒ **CSP 真的拦网络**（结论写进契约 §4.2） | 本次 |
| **🧬 插件资源自动登记 + 生命期串行链** | `_shots/perm-23-rescan-bottom.png`：连点 6 次「重新扫描」后 **ui-kit / tag-demo 全部已启用**（修前稳定报「命令 id 重复：ui-kit.hit」并变未启用）；`perm-22-rescan-ok.png` 为同一状态下的顶部（**无错误横幅**） | 本次 |

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
- **主色去紫**（用户反馈「那些紫色底图标还是没改」「紫底灰字，字都看不清」）：
  · 根因有两层 —— 主色从建立起就是紫；**更致命的是选中态用同色系**
    （设置页左导航是 `bg-primary/10` 淡紫底 + `text-primary` 紫字，天然糊）
  · `--zn-accent` 亮色 `#4f46e5` → `#3f3f46`，暗色反相为 `#e4e4e7` + 深字
  · 选中态改「实心底 + 反色字」；新增 `--zn-highlight`（亮黄/暗棕）专供高亮，
    搜索结果与编辑器内搜索命中都走它；焦点圈改用 `--zn-fg`
  · **应用图标**也从 Tauri 默认（青黄双螺旋）换成深灰圆角底 + 白色 Z
    （源图 `icon-source.png`，用 `tauri icon` 生成全套，含 Android 的 mipmap）
- **标题栏自动隐藏**（用户要求）：鼠标移开顶部停 0.5 秒后收起、移到顶部滑回，
  展开与收回同为 450ms（`.zn-titlebar` 用 margin-top 做 **push**，把内容挤下去而不是浮在上面）；
  ☰ 悬挂菜单贴窗口左边 + 标题栏下沿（`(0, 32)`），`ContextMenu` 的 z-index 提到 70 才不被标题栏盖住
- **笔记库栏可拖拽调宽**：侧栏与主区之间加分隔线（160–560px，localStorage 持久化），
  侧栏空白区右键可「关闭笔记库栏」；栏头那个 ✕ 已按用户要求移除
- **多选 + 批量删除**（用户明确要求，属破例 —— 多选原在「内核不做」清单里）：
  Ctrl/⌘ 点选、Shift 范围选（按显示顺序切片，树是嵌套的），右键已选中的多项可
  「删除选中的 N 篇」；`deleteNote` 扩成 `deleteNotes(paths[])`，撤销条支持多篇
- **自制右键菜单**（禁用 WebView 原生菜单）：主区与侧栏空白区共用，8 项四组
  （新建笔记 / 复制·粘贴 / 查找·复制路径·关闭笔记 / 设置·笔记库栏开关）。
  要点：全程用 `onContextMenuCapture`（CodeMirror 会吃掉冒泡阶段的 contextmenu）、
  树项自带菜单靠 `closest('.zn-tree-item')` 让路、ContextMenu 的 z-index 提到 70
  才不被标题栏（60）盖住
- **布局分工**：侧栏头 = 应用名（ZeroNote）、侧栏底 = 库名、状态栏左 = 篇数、
  状态栏右 = 当前文档字数（**剥掉 Markdown 标记后**再数，见 App 的 charCount）
- **触屏适配**（同步 Android 时补的）：分隔线改用 Pointer Events（Android 无 mousedown）、
  `.zn-resizer` 加 `touch-action: none`；标题栏在 `pointer: coarse` 设备上常驻显示
  （触屏收不到 mousemove）。**仍待真机确认**：多选缺修饰键、长按能否触发
  contextmenu、返回键接管
- **Android 相关必须知道的四件事**（踩过）：
  ① **手动敲 tauri android dev/build 时必须设 `CARGO_TARGET_DIR=~/cargo-targets/zeronote`**。
     不设会落到默认的 `src-tauri/target`，cargo 在那里为 android 目标重新解依赖，
     连 **Windows 专用**的 `vswhom-sys` 都拉进来编译 → `cl.exe` D8050 → 构建退出 101
     （`android-dev.cmd` 里本来就设了，手动敲命令容易漏）。
     **并且命令要用绝对路径**（`$tauri = Join-Path $root 'node_modules\.bin\tauri.cmd'`）——
     设 `$root = '...'` 变量**不会改变当前目录**，`& '.\node_modules\...'` 会按会话 CWD 解析而找不到。
  ② ~~**热重载不会自动建长连接**~~ → **2026-10-12 已修复**（`7cace9e`）。根因：vite 客户端的
     HMR 地址取自页面 `location.hostname`，而安卓 WebView 里那是 `tauri.localhost`（Tauri 的 origin），
     手机连不到 ⇒ 每次冷启动必报 `[vite] failed to connect to websocket`。
     修法：`vite.config.ts` 新增 `lanIp()`（**排除 vEthernet / Hyper-V / WSL 等虚拟网卡**，优先
     `192.168.*` —— 本机同时有 `192.168.1.20`(WLAN) 与 `172.31.32.1`(vEthernet)，取错比不设更糟）
     并设 `server.hmr.host`，可用 `ZN_HMR_HOST` 覆盖。
     **现在改 `src/` 真机自动热更新**：设备日志会出现 `[vite] connected.` + `hot updated: /src/xxx`。
     ⚠️ 改 `vite.config.ts` 时**不要并行 edit** —— vite watcher 会读到半成品配置（首次没生效就是这原因）。
     ⚠️ **Rust 改动**由 android dev 自动重编（日志 `Compiling zeronote` + symlink `.so`），
     但**新增 Tauri 命令**后要等它重新装 APK 才在真机可用。
  ③ **原生资源（themes.xml / MainActivity.kt）改动热重载不覆盖**，必须重新构建安装。
  ④ **Android 构建会卡在 Gradle 文件锁**（2026-10-11 深夜实测）：日志停在
     `Blocking waiting for file lock on Android` 然后 `EXIT=-1`（Windows 上 =-1 通常是被强制终止）。
     成因是**之前被 kill 的构建留下了 Gradle/Java 进程**占着锁（实测残留两个 java，起于最早那次
     构建被 kill 的时刻）。修法：
     `Get-Process | Where-Object { $_.ProcessName -match 'java|gradle' } | Stop-Process -Force`
     清干净再重跑（Gradle daemon 会自动重建）。**别用字符串匹配杀 android-dev 相关进程** ——
     匹配串会命中**执行该命令的 pwsh 自身**（实测把自己杀了，命令异常退出 4294967295）；
     要杀就按 PID 精确杀。
  ⑤ **前端的三个渲染坑**（2026-10-12 实测）：
     · **`divide-y divide-border` 在真机上一条线都不渲染**。像素级扫描整个面板中部
       （x 420–800 逐行找非白像素）→ **无任何非白行**；换成显式 `border-t border-border`
       后立刻出现 3px 高、色 `rgb(228,228,231)` 的整行横线。**要分隔线就写 border，别信 divide。**
     · **`tailwind-merge` 不认识自定义色名**：`text-primary-foreground` 会被归进**字号**组，
       与同元素的 `text-xs` 冲突后**静默丢掉颜色** ⇒ 深色底上的字变成"深灰压深灰"看不见
       （用户反馈的原话：「挡住默认库的那个黑框影响阅读」正是这个）。
       写组件时**别把自定义色名与字号类写在同一个元素上**，深色底能不用就不用。
     · **横排 flex 里「左列 `min-w-0` + 右列 `shrink-0`」= 左列被压成竖排**：
       设置页 `Row` 原来就是 `flex` + 左列 `min-w-0` + 右列 `shrink-0`，
       窄屏（手机 CSS 视口 ≈444px）遇到「浅色/深色/跟随系统」三段控件时，左列被压到约 16px
       ⇒「外观」竖排、说明**逐字一行**（用户：「外观那里字体显示有问题」）；
       hint 的 `break-all`（允许任意断行）又放大了这个效果。
       修法：窄屏 `flex-col` 上下排列、`min-[520px]` 以上才横排；左列补 `flex-1`；
       hint 用 `break-words` 而非 `break-all`。**移动端先按竖排设计，别指望横排能挤下。**
  ⑥ **改完 `src/` 后，真机上看到的还是旧前端** —— 打包版 APK **没有 HMR**，
     前端资源是**构建那一刻的快照**。补 UINode 新节点时第一次验收就撞了：
     面板里糊了一片 `{"type":"badge","text":"默认"}` 的**原始 JSON** ——
     旧渲染器不认识这些 type，全走了 `default` 分支的 `JSON.stringify`。
     ⇒ 改完前端必须二选一：重新 `pnpm tauri android build --apk --target aarch64 --debug`
     ＋ `adb install -r`（约 2 分钟，可靠）；或起 `android-dev.cmd` 走 HMR（但有多实例抢锁的坑，见上方 ①）。
     **一眼判断**：改一句明显可见的文案，界面没变 ⇒ 就是这个。
     （`src-tauri/` 的 Rust 改动同理，除了 `tauri android dev` 会自动重编 `.so`。）
  ⑦ **`[[x]]` 这类语法在 atomic 编辑器里"已经是它自己的"** —— 实测写 `[[test-from-pc]]`
     会渲染成**黄底 + 外链图标**，说明 atomic 自己识别 wikilink，且用的是
     **`replace`/widget 类装饰**；CM6 里那类装饰**优先级高于 `Decoration.mark`**
     ⇒ 插件用 `editor.addMark` 叠加的样式与点击**都轮不到**（点击被它的 widget 吃掉）。
     **`#标签` 这类它不认识的语法才是 `addMark` 的主场**（实测着色 + 点击命令都正常）。
     想真正接管 `[[ ]]` 得跟 atomic 的扩展点协商（未做，不等于做不到）。
  ⑧ **`#[test]` 被粘到注释行末尾 ⇒ 测试静默不跑**（2026-10-12 自查发现）。
     一次 edit 把 `#[test]` 合并进了上一行的 `///` 注释，`cargo test` 的
     `running N tests` 从 13 悄悄变成 12 —— **不报错、不警告**，那个测试永远不跑了。
     与 `doc.on` 的"订阅成功但永不触发"是同一类陷阱：**静默失效比报错危险**。
     **自查办法**：动过测试相关代码后，看 `cargo test --lib` 的 `running N tests`
     数字有没有按预期变化 —— **别只看 `test result: ok`**。
  ⑨ **插件加载"中途被打断" ⇒ 幽灵命令污染之后所有重载**（2026-10-12 真机踩到）。
     症状极具误导性：给某个插件换新版后它显示**未启用**（旧版本的 `disabled` 状态被
     同 id 的新版本继承了），手动勾选启用后，**别的插件**报
     「命令 id 重复：ui-kit.hit」并接连变成未启用。
     根因是**竞态**：插件加载是 `await` 的，而"已加载清单"原本是 effect 内的
     **局部数组**；用户在加载途中操作（点启用 / 切库 / 重新扫描）⇒ cleanup 跑，
     但那时正在加载的那个插件**还没被 push 进数组** ⇒ cleanup 漏掉它 ⇒
     它已注册的命令/面板留在宿主里成了幽灵 ⇒ 下次同 id 注册必撞，
     **一次污染之后每次重载都失败**。
     **修法**：清单改成跨 effect 的 `useRef`，cleanup 用 `splice(0)` 消费；
     两条加载路径（启动扫描 + 懒激活）在 `await` 之后都检查 `cancelled`，
     已取消就当场卸掉并回收 service/editor 资源。
     **教训**：**异步初始化的 cleanup 必须能覆盖"进行中"的那一项。**
- **Android 系统栏（三阶段）**：
  ① 起初只做**透明**：`values/themes.xml` + `values-night/themes.xml` 里
     statusBarColor/navigationBarColor 透明 + windowLightStatusBar，
     `MainActivity.kt` 里 `WindowCompat.setDecorFitsSystemWindows(false)`
     —— 不补的话那一条露出 Activity 窗口底色，看着像"没覆盖的灰"。
  ② 用户看完 ① 后要求**彻底隐藏**（"红框的信息直接不显示更好"）：`MainActivity.kt` 再加
     `WindowInsetsControllerCompat.hide(statusBars())`，behavior 用
     `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`（顶部下拉仍能临时唤出）。
     隐藏后 `env(safe-area-inset-top)` 归 0，内容自然顶到屏幕最上沿。**已真机验证**（`cfcc9bf`）。
  ③ **2026-10-12 改成按需显隐**（用户：「改成侧栏打开的时候隐藏，首页的时候显示」）：
     不再无条件隐藏，改由新插件 `src-tauri\plugins\tauri-plugin-statusbar\` 控制 ——
     侧栏（抽屉）打开 → 隐藏；收起（首页）→ 显示。`MainActivity.kt` 只保留 behavior 设置。
     **导航栏刻意不碰**（只用 `Type.statusBars()`）。实现细节、真机证据与接入方式见
     下方「未完成项 → 待真机复验」里那条。
- **手机端多库的目录约定**（2026-10-12，`3e2886d`）：

  ```
  Documents/ZeroNote/          ← 库根（默认库就是它，现有内容原地不动、零迁移）
  ├── .zn/                     ← 插件 + store（**跨库共用**）；trash 也在这层
  ├── .vaults/<库名>/          ← 其它库都在这（**里面不再有 .zn**）
  └── *.md + 灵感/             ← 默认库的内容
  ```

  **私有目录落在哪由 `private_root()` 决定**（`lib.rs`）：默认就是库自己；
  库在 `.vaults/<名字>/` 里时落在**库根** ⇒ 插件与 store 跨库共用，切库不会再
  「插件全没了」（**真机已验**：切到空库 `T`，`☰` 菜单里 Hello 插件 / 灵感流照旧在，
  而 `T` 里根本没有 `.zn`）。`ensure_vault` 同样建在 `private_root` 上，
  所以新库目录里不会再冒出空的 `.zn`。
  ⚠️ **回收站刻意例外**（仍写库内的 `.zn/trash/`）：删的是库内笔记，而且 `resolve()`
  只接受库内相对路径，库根方向的 `../.zn/...` 会被它拒掉、撤销删除会失效。
  桌面端用户自选的库路径不含 `.vaults` ⇒ 走默认分支，行为与以前完全一致。

  为什么用 `.vaults` 这种 `.` 开头的名字：`lib.rs` 的 `collect()` **跳过所有 `.` 开头的名字**，
  于是容器里的库不会串进默认库的文件树，**不需要额外维护黑名单**
  （Rust 的 `VAULTS_DIR` 与前端 `src/lib/vaults.ts` 的常量必须保持一致）。
  ⚠️ 安卓**没有**目录选择器（Tauri 源码级返回 `FolderPickerNotImplemented`），
  所以手机端不提供「选任意文件夹」这个能力；桌面端仍走系统选择器，两端互不干扰。

## 插件系统进展（2026-10-11 深夜，本次会话）

用户指示：「先不做具体插件，把**入口兼容**补足，以及**内核隔离**做好」。

### ✅ 入口兼容层（已完成并真机/桌面验收）

原先只有「读单文件 → Blob → 动态 import」，把成熟生态最常见的写法全挡在门外。
现按**内容嗅探**自动判断，插件作者不必改代码（依据 `_research\插件API对比.md` §8：
Lumina 是 `module.exports = function`、Yank Note 是 `window.registerPlugin`、
NoteGen 的 `entry` 可选支持纯资源型）：

| 形态 | 判定 | 实现 |
|---|---|---|
| **ESM** | 有 `import`/`export` | 原样 import |
| **CommonJS** | 有 `module.exports` / `exports.x` | `buildCjsBundle()`：装进一个约 40 行的虚拟 CommonJS 运行时 |
| **全局注册** | 有 `registerPlugin(` | `buildIifeBundle()`：把 `registerPlugin(obj)` 收下来再导出 |
| **纯样式** | 无 `entry`、只有 `styles` | 注入 `<style>`，卸载时移除（主题类插件不必写 JS） |

- **多文件**：`manifest.files` 声明的文件一并读出，相对 `require` 以**当前文件所在目录**为基准
  （按 `spec` → `spec+.js` → `spec+/index.js` 试探）⇒ v0.1 的「只能单文件」限制解除。
  ⚠️ 只有 CommonJS 的 `require` 能解析；**ESM 相对导入在 Blob 里没有 base 目录，v0.1 不支持**。
- **导出形状归一**：`export default {apply}` / `export function apply` /
  `module.exports = function`（导出函数本身）/ `registerPlugin({register})` 四种都认。
- **失败回滚**：样式注入或 `apply()` 失败时清掉已登记资源，不留"半个插件"。
- **契约同步**：`docs\内核契约-v0.1.md` 新增 §3.1 入口形态表 / §3.2 files 解析 / §3.3 纯样式插件；
  `contract.ts` 的 `PluginManifest.entry` 变可选，新增 `files` / `styles`。
- **示例**：`examples\` 下新增 cjs-single / cjs-multi（含 lib 二级目录互相 require）/
  yank-style / theme-sepia / cdn-import 五个，覆盖全部形态。
- **验收证据**：`_shots\plug-04-status.png`、`plug-05-statusbar.png`（四个插件同时装进库，
  状态栏一次显示 `Multi15✓ CJS通用 Yank✓`，背景被纯 CSS 插件改成米色）、
  `_shots\plug-06-cdn.png`（`CDN✓`）。

### ✅ 内核隔离（逐项核实，只剩一个缺口，已补）

插件代码能进来的**每个入口**都查过一遍：

| 入口 | 兜底 |
|---|---|
| 面板 `render()` | `kernel\panel-safe.ts` 的 `renderPanelSafe()` ✅ |
| 提交阶段 / 子孙组件 | `components\PanelBoundary.tsx` ✅ |
| 单个 UINode | `components\UIRenderer.tsx` ✅ |
| 命令 `run()` | `command.ts` try/catch + onError ✅ |
| 事件回调 | `event.ts` 每 handler 单独 try/catch ✅ |
| **`fs.watch` 回调** | ❌ → **本次补上**（`safeCb` + `onWatchError`） |
| `loadPlugin`（含 `apply()`） | App 的调用点 try/catch ✅ |
| `unloadPlugin`（含 `dispose`） | try/catch ✅ |

**未做（明确边界）**：真沙箱（Worker + 内存/时长上限）—— 契约 §4 排在 v0.2。
进程内插件目前一个 `while(true)` 仍能卡死整个应用；capability 只是**接口可见性**，不是安全边界。

### ⚠️ 插件面剩余短板（**2026-10-11 二次接管逐条核实，带行号**）

> 核实方式：只读通读 `plugin-host.ts`（442 行）/ `contract.ts`（244 行）/ `tauri.conf.json` / `lib.rs`（429 行）+ 全局 grep。
> **用户 2026-10-11 裁决：①②③ 本轮先不动**（含「Tauri invoke 边界」）—— 下表**只记录，不实施**。
> 核实同时纠正一条过时结论：旧表「`index` 四个方法全抛」**已失效**（`index-api.ts` 早已实现内存全文索引，
> 见「未完成项」里 `c6bc326` 那条），已删除。

| # | 问题 | 根因（精确位置） |
|---|---|---|
| **1** | 不声明 `net` 也能联网 | 宿主从不碰网络 API；**`src-tauri\tauri.conf.json:26` 的 `csp` 为 `null`**；插件跑在页面主上下文。全项目 grep `fetch\|XMLHttpRequest\|WebSocket` **仅命中 IIFE 兼容层**，无任何网络拦截 |
| **2** | 声明 `net` 反被拒 | `plugin-host.ts:48` `DENIED_BY_DEFAULT=['net','proc']` → `:113` 抛「需用户在设置里开启」；而**全项目 grep `granted\|permission` 零命中** ⇒ 无授权存储、无授权 UI ⇒ **永久拒绝**（契约 §4 承诺的开关从未存在） |
| **3** | capability 只裁 **2/13** | 仅 `fs:write`（`:127-136`）与 `doc:write`（`:138-145`）落地。`fs:read` / `doc:read` / `index:query` / `index:write` / `command`（`:407`）/ `view:sidebar\|main\|statusbar\|modal`（`:148-153` 只加 pluginId 标记）/ `store`（`:409`）/ `event`（`:406`）**声明与不声明完全一样** |
| **4** | **裁剪可被整体绕过** | Rust 侧 12 个 `#[tauri::command]`（`lib.rs:151`–`305+`）经 Tauri IPC 全局可达 ⇒ 插件直接 `invoke('write_note', {vault, path, content})` 即可写盘，`ctx.fs` 的全部裁剪形同不存在 |
| **5** | `doc.save` 漏拦 | `scopedDoc`（`:138-145`）只拦 `replaceSelection` / `insertAtCursor`；**`save()` 与 `close()`（后者会触发保存）是写操作，却不在 `doc:write` 名单里** |
| **6** | IIFE 兼容层污染全局 | `plugin-host.ts:241-242` 写 `globalThis.registerPlugin` + `globalThis.window.registerPlugin`；`unloadPlugin`（`:428+`）未见恢复 |
| 7 | `doc.on()` 未实现 | 契约 §1.2 已声明；实况核实：grep `  on(` 只命中 `event.ts` 的事件总线与 `contract.ts` 的类型声明，**无 doc 实现**（v0.2） |
| 8 | `registerWebView` 未做 | 契约 §7.9 有意不进 v0.1 |
| 9 | `platforms` 声明了没强制 | manifest 有 `platforms` 字段（`contract.ts:229`），`loadPlugin` 不读它 ⇒ Android 会尝试加载桌面专属插件 |

**🔑 关键认知（决定后续方案取舍，别再绕）**：在「进程内插件」前提下，capability **不可能**成为安全边界 ——
三条绕过路径：① `globalThis.fetch` ② **ESM 静态 `import`**（`examples\cdn-import` 正是靠这条联网，本轮刚验收过）
③ 上表第 4 条的 `invoke`。**唯一能兑现「不声明就不能联网」的是沙箱**（原 ③）。
⇒ **① 与 ③ 是同一件事的两半**：不引入 ③ 的机制，① 永远只能是「接口可见性」。

**若将来重启 ①，可选强度**（2026-10-11 已向用户列出，**未采纳**，留档备查）：
**A** 诚实裁剪（13 项全落接口 + 设置页授权 UI + 裸网络 API 遮蔽；契约明写「挡手滑、不挡恶意」，约半天）·
**B** 最小修正（只全裁接口，不遮蔽、不做 UI；契约直说无法阻断联网，约 2 小时）·
**C** 直接上 iframe 沙箱（`csp="connect-src 'none'"`，数天，需先实测 WebView2 对 iframe `csp` 属性的支持）·
**D** 只补第 2、5 条矛盾（约 30 分钟）

### ✅ 客户端 UI（插件管理页，用户标注三处）

- 「返回编辑器」改成与编辑页「关闭」同款的**纯文字按钮**（新增 `.zn-plain-btn`）
- 「重新扫描」从面板标题栏挪到主区顶栏，与「返回编辑器」并排
- 面板里那条「插件」标题 + 下横线整块去掉（`PluginPanel` 的 head 拆除，
  `Settings.tsx` 的插件 tab 补一个同款按钮，免得设置页失去扫描能力）
- 提交 `ca0889c`

## 本次会话新增的环境能力

- **`@dsh-external/dsh-gentle-input`**（自写 DSH 插件，位于
  `C:\Users\AQUA\Documents\deepseek\dsh-gentle-input`）：解决「AI 用 `SetCursorPos` +
  `mouse_event` 模拟点击会抢走用户鼠标」。三个工具 + 一个发键工具：
  `gentle_probe`（只读探测光标/空闲时长/前台窗口）· `gentle_capture`（截图，只读）·
  `gentle_click`（**用户空闲低于 1200ms 时直接拒绝**，点完**把光标还原原位**）· `gentle_keys`。
  已 `dev_install_package` 持久化（进了 desktop profile 的 dependencies + bundles）。
  **以后做 UI 验收请用 `gentle_*`，不要再用 pwsh 模拟鼠标。**
  ⚠️ 它不是真·虚拟光标：用户空闲时点击仍会让真实光标跳一下再回来（约 50ms）。
  现成的 `dsh-computer-use` 有真虚拟光标，但代价是要装 Rust 驱动 + 最高权限开机任务 + 遥测。
- **Android 热重载的正确姿势**：见下方"三个坑"②。
- **dev 端口可配置**：`vite.config.ts` 读 `ZN_PORT`（缺省 1420），桌面与安卓 dev 可同时跑。

## 未完成项

- [x] **⑧ `net` 授权通道** ✅（2026-10-12 下午）—— 设置页逐插件开关 + `.zn/permissions.json` +
      契约 §4 诚实改写。⚠️ **授权记录不绑定插件指纹**：插件升一版后旧授权仍有效（那属 §7.6 的未决项）。
- [x] **⑩ WebView 逃生口** ✅（2026-10-12 下午）—— `registerWebView` 最小版 + CSP 落地。
      ⚠️ 页面必须来自**独立 origin**（`http(s):`）：`data:`/`blob:`/`srcdoc` 继承宿主 CSP
      会被 hash 压掉 inline；Tauri asset 协议在 Android 上不服务 `.html`。见契约 §2.2 ④。
- [x] **插件的命令/面板资源自动登记** ✅（2026-10-12）—— 宿主兜底 + 生命期串行链，见 rev30 摘要。
- [ ] **iframe ↔ 宿主的能力通道**（v0.2）—— 现在 WebView 只能"收"令牌，不能调 `ctx.*`；
      要做需先定 `postMessage` 请求/应答协议 + 宿主侧鉴权（别把 IPC 暴露给 opaque origin）。
- [ ] **`platforms` 声明强制**（缺口 9）—— manifest 有 `platforms` 字段，`loadPlugin` 仍不读它。
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
- [x] **编辑器内查找 / 替换** ✅（2026-10-11，`71a3714`）—— 查找用 `Ctrl+F`（atomic 内置面板），
      替换由**自带替换栏**补齐（`Ctrl+H` = `core.replace`）：纯字符串 `indexOf`/`split` 实现
      「替换」与「全部替换」，零新依赖、不碰 atomic 内部。实测查 `1` 替 `9` → 「已替换 215 处」。
      **背景**（省得以后重查）：atomic 的查找面板没有替换行 —— 它渲染的是自己那套面板
      （不是 CM6 原生 `defaultSearchPanel`，`EditorState.phrases` 覆盖无效），handle 没暴露
      replace API，`Ctrl+H` 无绑定，CSS 强制显示替换行也无效（该行在 DOM 里根本没渲染）。
- [ ] 更多真插件（画布 / 同步 / AI 等，用户说清单「先保留」）

## 唯一下一步

**0. UI 规划已全部完成** —— P0 七项 + P1 六项，逐条证据见 `docs\UI规划-v0.1.md` §6 / §8。
   **插件入口兼容层也已完成**（2026-10-11 深夜）；**⑧⑩ 两项阻塞已解除并落地**（2026-10-12 下午，见 rev30 摘要）。

   **下一步（插件面，按严重程度排序）**：

   > 🔄 **2026-10-12 更新**：原先"①②③ 先不动"三项里的 **①（capability 真裁剪）已经做了**（⑧），
   > 而且拿到一个此前没有的结论：**加了 CSP 之后"裸 fetch"被 `connect-src` 真拦住了**
   > （白名单内 200 / 白名单外 `Failed to fetch`，见契约 §4.2 的实测表）。
   > **② `platforms` 强制**与**③ 沙箱（Worker + 内存/时长上限）**仍未动。
   > **下一次从哪接手由用户指定**。

   | # | 议题 | 说明 |
   |---|---|---|
   | **1** | **capability 真裁剪** | 实测「不声明 `net` 也能联网，声明了反被拒」——**安全假象**。精确根因与四个备选强度见上方短板表（**本轮暂缓**） |
   | **2** | **`platforms` 强制** | manifest 有字段、`loadPlugin` 不读 ⇒ Android 会拉桌面专属插件（缺口 9，**本轮暂缓**） |
   | **3** | **沙箱（Worker + 内存/时长上限）** | 契约 §4 排 v0.2；唯一能防住 `while(true)`，也是唯一能让 ① 变成真边界的（**本轮暂缓**） |

   **待真机复验**（本次交接时的悬置项）：
   - [x] **Android 状态栏改为按需显隐** ✅（2026-10-12 00:21，提交 `4f4b132`）
         用户要求：「改成侧栏打开的时候隐藏，首页的时候显示」——**只控状态栏，导航栏不动**。
         实现：最小 Tauri 2 移动插件 `src-tauri\plugins\tauri-plugin-statusbar\` ——
         Rust `set_status_bar_visible` → JNI → Kotlin `StatusBarPlugin.setVisible`
         → `WindowInsetsControllerCompat.show/hide(Type.statusBars())`；
         `MainActivity.kt` 去掉无条件 `hide`；前端 `src\lib\systemBar.ts`（Android UA 判断 +
         状态去重）由 `App.tsx` 的 `sidebarOpen` 驱动；**桌面端该命令 no-op 返回 Ok**，前端不必分平台。
         **真机三态实测**（ARIA 24069RA21C，进程 10475）：首页状态栏**可见**（`0:19`/信号/`100%`）
         → 抽屉打开**消失** → 关抽屉**恢复**（`0:20`），**底部导航栏全程保留**。
         证据 `_shots\android-sb-01-home.png` / `-03-drawer.png` / `-04-back-home.png`。
         **接入全自动**：Tauri CLI 自己写 `gen/android/tauri.settings.gradle`、`app/tauri.build.gradle.kts`
         的 `implementation`、以及 `permissions/autogenerated/` ⇒ **未手改任何 gradle 文件**。
         检查：`tsc -b` 0 错误；`oxlint` 5 warnings（基线未变）；`cargo check` EXIT=0。
         前置：② 的「始终隐藏」已于 2026-10-12 00:07 像素级验证通过（见上）。
   - [ ] **触屏多选**（缺 Ctrl/Shift）、**长按能否触发 contextmenu**、**返回键接管**

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
| E | ~~**插件入口形态兼容**（CJS / IIFE / TS / 无 JS 资源型 / 多文件）~~ → **✅ 已完成（2026-10-11 深夜）** | 四种形态（ESM / CommonJS / 全局注册 / 纯样式）+ 多文件 `require` 全部落地并验收，详见上方「插件系统进展」节。**TS 源码形态未做**（需要宿主内编译 TS，成本高于收益；契约 §3.2 已写明多文件请走 CJS 或自行打成单文件 ESM） |

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

### 🔩 rev30 新踩的五个坑（都花了轮次，别再踩）

1. **CSP 一开，local scheme 的 iframe 里 inline script 必被拦**。Tauri 编译时会给 `script-src`
   注入打包资源的 `sha256`；而 CSP 规范规定「源列表里有 hash/nonce 时 `'unsafe-inline'` 被忽略」
   ⇒ `data:` / `blob:` / `srcdoc` 的 iframe（会继承宿主 CSP）里，内联脚本一律 `blocked`
   （logcat 原话：`'unsafe-inline' is ignored if either a hash or nonce value is present`）。
   **要给插件页面跑自带脚本，页面必须来自独立 origin（`http(s):`）。**
2. **Tauri asset 协议在 Android 上不服务 `.html`**：`http://asset.localhost/…/page.html` →
   `net::ERR_INVALID_RESPONSE`（把 `assetProtocol.scope` 放宽到 `/storage/**` 也一样）。图片可以，HTML 不行。
3. **真机点击：`adb shell input tap` 在 WebView 里不生效，`input swipe x y x y 120` 有效**
   （同一坐标、同一时刻，tap 无反应而 swipe 立刻命中）。这条**补充/推翻了** M3 收尾④
   「合成点击命中不稳定」的旧结论 —— 换手势即可，不用放弃自动化验收。
4. **`adb push <目录> <已存在的目标目录>` 会多套一层**：文件被推成 `<目标>/<源目录名>/…`，
   而插件只认一层。推单个文件到明确路径，或先删目标目录再整目录推。
5. **插件注册进宿主表的资源必须由宿主兜底回收**。`command.register` / `view.registerPanel` /
   `registerWebView` 现在都由 `ctx` 外层**自动登记**进 `subscriptions`。
   指望插件作者记得 `subscriptions.push(...)` 是不现实的 —— `examples/` 里 **8 个**示例都忘了，
   代价是**重载必崩**（「命令 id 重复」），而这类"静默记账"错误在首次安装时完全看不出来。
