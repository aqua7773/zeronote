# 项目交接

revision: 36
更新时间: 2026-10-12（夜 · Markdown 标记**收进内核**：手机底栏 ＋ 顶部提示条 ＋ 右键「标记」子菜单）
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

> ## 📌 rev31（同日 13:00 · 文件关联落地：双击 .md 用 ZeroNote 打开）
>
> **提交 `9fd7e1d`**（6 文件 / 821 行）。用户选 **D（文件关联）**，落点用**方案 A**。
>
> | 侧 | 状态 | 证据 |
> |---|---|---|
> | **桌面（Windows）** | ✅ **全通** | `bundle.fileAssociations`（md/markdown → `text/markdown`）随安装包注册；exe 带 `.md` 参数启动即切库并打开；**单实例转发**（第二个进程把 argv 交给已运行实例，进程数仍 1） |
> | **Android** | ⚠️ **`file://` 通、`content://` 不通** | `am start -a VIEW -d file://…` 库内/库外两例都对；`content://…` 只能如实提示"读不了" |
> | macOS / iOS | 代码路径已接（`RunEvent::Opened`），**未验证** | — |
>
> **怎么做的**（按官方《File Associations on Mobile》+ 同类项目 Marko 实证，未自创）
> · Android 的 intent-filter 由 Tauri 构建系统**自动注入**（`gen/android/.../AndroidManifest.xml` 那处 diff 是 `AUTO-GENERATED`，未手改）
> · Windows 拿不到 `RunEvent::Opened`（tauri 2.12 把它 `cfg` 到 macos/ios/android）⇒ 走 **`tauri-plugin-single-instance`（必须是第一个插件）+ argv 转发**
> · 三条入口最后汇进 `OpenedUrls` state：`opened_urls` 命令（启动时拉）+ `zn:open-file` 事件（运行期）
>
> **落点 = 方案 A**：接到路径 → 把**父目录当库打开** → 再打开该文件。
> · **`resolve()` 一字未改**（已复核）、**未加任何库外读写命令** ⇒ 未突破安全边界
> · 库外直接读写（方案 C）**仍需用户单独授权**，不在本批
>
> **⚠️ Android 的真实缺口**：文件管理器「打开方式」递的多半是 `content://`（SAF），而 `std::fs` 读不了
> ⇒ **手机上"双击打开"日常还不可用**。下一步两条路：接官方 `@tauri-apps/plugin-fs`（走 contentResolver），
> 或自写 Kotlin 取 fd 中转（参考 `src-tauri/plugins/tauri-plugin-statusbar` 的 JNI 做法）。
> 建议做成**只读**通道（`read_content_uri`），字节流交给现有库内白名单落盘/显示 —— 不碰 `resolve()`。
>
> **验收（我独立复核，非采信子代理自述）**：`tsc -b` 0 · `oxlint` 4 · `cargo test --lib` **16 passed**；
> 截图 `_shots/fa-desktop-open.png`、`fa-desktop-single-instance.png`、`fa-android-open-in-vault.png`、
> `fa-android-outside-vault.png`、`fa-android-content-uri.png`。
>
> **新增入口**：`☰` 菜单「打开文件…」（桌面不装安装包也能用；Android 用系统「打开方式」选 ZeroNote）。

> ## 📌 rev31.1（同日 13:10 · 桌面侧栏可直接切库）
>
> 用户反馈「侧栏那块界面应该能直接进行库切换」。**提交 `03bd25e`**（2 文件 / +134 −5，纯前端）。
>
> - 侧栏底部库名 `div → button`，点击弹出「切换笔记库」菜单（复用 `ContextMenu` 原语）
> - 菜单 = **最近打开过的库**（当前项标「·当前」）+ 分隔线 +「打开其它文件夹…」（复用原 `pickVault`）
> - 最近库持久化 `localStorage['zeronote.vaults.recent']`（最多 8、去重、最近在前）
> - 侧栏空白区右键菜单加一条「切换笔记库…」，指向同一菜单
> - 切库一律复用 `applyVault`（**没另写换库逻辑**）；未碰移动端 `VaultPanel` 的 `.vaults` 模型、未碰 `src-tauri`
>
> **验收**：`tsc -b` 0 · `oxlint` 4（= 基线）· 13 张截图 `_shots/vault-switch-*.png`
> （弹菜单 → 列出最近库 → 点即切、无对话框 → 侧栏库名/笔记树/状态栏同步变化 → 切回恢复）
>
> **遗留（诚实标注）**
> 1. **未做冷启动验证** —— 只验了 HMR 路径（重启会 kill 用户正在用的窗口）
> 2. ~~**最近库没有「移除」入口**~~ ✅ **已补（rev32）** —— 打开菜单即只读探测 + 自动剔除 + 提示；
>    `applyVault` 另加一道门（菜单弹出后目录才被删 ⇒ 拒绝切换并剔除）。见下方 rev32。
> 3. 测试产物 `_shots\vault-demo-b\` 已删；剪贴板曾被测试占用（现值 `C:\Users\AQUA\Desktop`，无害）。

> ## 📌 rev32（同日 13:40 · 缺口 3「最近库没有移除入口」补齐）
>
> 用户本轮选定做交接卡里的 **#3 最近库「移除」入口**。
>
> **症状**（本轮开头实测复现，不是转述）：上一次会话留下的失效库
> `_shots\vault-demo-b` 还挂在「最近打开过的库」里，底栏一直报
> 「读取笔记库失败：笔记库可能已被移动或删除…（库目录不存在：…）」，
> 而菜单里**没有任何能清掉这条记录的入口** —— 点它只会再把同一句错报一遍。
>
> **做法**（两层，都只读探测、**绝不建目录**）：
> 1. **打开菜单时探测**：新增 Tauri 命令 `vault_exists(vault) -> bool`（`Path::is_dir()`，1 行）。
>    `openVaultMenu` 改异步，对**非当前库**的每条记录并行探测；不存在的一律剔出菜单、
>    同步写回 `localStorage`，并 toast「已从最近笔记库移除（想加回来用「打开其它文件夹…」）」。
>    **当前库不探测** —— 它正在用，即便目录被删也先据实显示，由文件树的报错去说。
> 2. **切库时的门**：`applyVault` 开头先探测，目录不存在就**拒绝切换** + 剔记录 + 提示，
>    返回 `false`；`openExternalFile` 据此清掉「待打开」ref —— 否则那个 pending 会一直等着这个库，
>    等用户哪天真又建出同名目录、切过去时**突然弹出一篇笔记**。
>
> **为什么不用 `ensure_vault` 探测**：它会 `create_dir_all`。拿它探测等于把"库没了"
> 静默变成"库还在，只是空的" —— **只读**是这条命令的硬约束，单测专门钉住了它。
>
> **验收**（桌面实测 5 张截图 + 1 条新单测）
> - `_shots/gap3-02-menu-before.png`：失效库 `vault-demo-b` 在列表里（当前库，底栏报错）= 缺口现场
> - `_shots/gap3-04-menu-cleaned.png`：切走后打开菜单 ⇒ **它消失了 + toast 提示**
> - `_shots/gap3-06-persisted.png`：`Ctrl+R` 重载 WebView 后再开菜单 ⇒ 列表依旧干净、**无 toast**
>   ⇒ 证明是**真写掉了**，不是每次现场过滤
> - `_shots/gap3-16-menu-zoom3.png`：临时库 `_tmp-vault-gap3` 目录仍在 ⇒ **不误杀**，正常列出
> - `_shots/gap3-17-gate-toast-zoom.png`：菜单**已弹出后**才删掉该目录，再点它 ⇒
>   toast「「_tmp-vault-gap3」已不存在，已从最近笔记库移除。」+ **库没切换、底栏无报错**
>   （这条文案没有"想加回来"后缀，正好与探测路径**可区分** ⇒ 走的是 `applyVault` 的门）
> - `cargo test --lib` **17 passed**（新增 `vault_exists_is_read_only`：真目录 true / 幽灵目录 false /
>   **探测本身不创建目录** / 文件不算库目录）
>
> **基线**：`tsc -b` **0 错误** · `oxlint` **4 warnings**（= 基线）· `cargo test --lib` **17 passed**。
> **未碰安全模型**：新命令是纯只读存在性检查 —— 不进 capability 名单、不改 CSP、不动授权记录。
>
> **测试残留**：临时库 `_tmp-vault-gap3/`（含 `probe.md`）验证完即已删除；
> `_shots/gap3-*.png` 十张留在截图目录（该目录在 `.gitignore` 里，不进提交）。

> ## 📌 rev33（同日 14:00 · 缺口 1「`platforms` 声明不强制」→ **平台门落地**）
>
> 用户原话：「**改插件应该有桌面或者移动端或者双端的声明**」。
> 此前 `manifest.platforms` 有字段、18 个示例里 17 个都写了，但 `loadPlugin` **根本不读它** ——
> 声明纯装饰，Android 照样会拉桌面专属插件。
>
> **三档语义（定稿）**
>
> | 写法 | 含义 |
> |---|---|
> | `["desktop"]` | 仅桌面（Windows / macOS / Linux） |
> | `["android"]` | 仅移动端 |
> | `["desktop", "android"]` | 双端 |
> | 字段整个不写 | 全平台（**向后兼容**，老插件零改动） |
>
> 取值从 `desktop | android | web` **收窄为 `desktop | android`** —— `web` 档从来没有任何宿主来源
> （`host.platform` 只可能是 `windows | android | other`），留着只会让人以为能声明"浏览器版"。
> 拼错（`"windwos"`）以前是**静默失效**（插件照常加载，作者以为限住了），现在**拒载 + 报错并列出合法取值**。
>
> **两套词汇表的归一是本轮的暗坑**：manifest 用 `desktop`，而 `host.platform` 用 `windows`。
> 归一边界定为 **`other`（macOS / Linux）= `desktop`** —— 桌面就是桌面，不该因为不是 Windows 被判"不适用"。
>
> **两道门（同一个 `supportsPlatform`，不是两套判据）**
> 1. `loadPlugin` 里的 `assertPlatform` —— 所有加载路径的**单一真相**；
> 2. `App.tsx` 加载循环**开头提前判** —— 必须提前，才能连**懒激活**插件一起挡住：
>    否则它的 `contributes.commands` 会被静态登记，手机的命令面板里就多出一条永远跑不通的桌面命令。
>
> **不匹配 = 正常跳过，不是错误**：插件页显示「不适用 · 仅桌面端 / 仅移动端」+ 开关**禁用**
> （让人拨一个无效开关比不给开关更糟），且**不进错误横幅** —— 把桌面专属插件拷到手机上太常见了。
> `PlatformMismatch` 做成专用错误类型，就是为了让调用方能把它和"真失败"分开。
>
> **验收（桌面 5 张 + 对照三组）**
> - `_shots/gate-04-plugins-page.png`：`["android"]` 插件在桌面 ⇒ **「不适用 · 仅移动端」+ 开关禁用 + 无报错**
> - `_shots/gate-05-dual-loaded.png`：**对照 A** 改双端 ⇒ **已启用**（证明只挡不匹配的，没有误杀）
> - `_shots/gate-06-lazy-skipped.png`：**对照 B** 懒激活 + 仅移动端 ⇒ 仍被跳过
> - `_shots/gate-07-palette-no-cmd.png`：同一状态下的命令面板 ⇒ **列不出它的命令**（懒激活分支未被登记）
> - `_shots/gate-08-invalid-rejected.png`：**对照 C** `"windwos"` 拼错 ⇒ 拒载 + 错误横幅
>   「manifest.platforms 有非法取值：windwos（只接受 "desktop" / "android"；要双端就两个都写）」
> - `_shots/gate-10-cleanup.png`：测试库删掉后最近库**自动移除**它（顺带二次验证 rev32 那条）
>
> **新增示例** `examples/platform-locked/`（`platforms: ["android"]`）—— 把 `platforms` 改成
> `["desktop"]` 推到手机上即可反向验一遍。
>
> **基线**：`tsc -b` **0 错误** · `oxlint` **4**（= 基线）· `cargo test --lib` **17 passed**（本轮未动 Rust）。
> **踩坑**：`tsconfig` 开了 `erasableSyntaxOnly` —— 构造函数参数属性（`constructor(readonly x: T)`）
> 会被 tsc 直接拒（`TS1294`），得写显式字段赋值。
>
> **未做**：真机复验（桌面已验；手机上要重装 APK，用户本轮选择不跑）。
>
> **补充（同日 19:10 · release 打包版首次验证）**：`pnpm tauri build --no-bundle` 产出
> `cargo-targets\zeronote\release\zeronote.exe`（**10.5 MB**，release 全量编译 **2m46s**），
> 在带 `ui-kit` 插件的库上启动 —— 三条独立证据：
> ① 编辑器底部工具栏渲染（插件的 `view:editor-toolbar` 面板）② `☰` 菜单出现「UI 组件演示」入口
> （插件的 `view:sidebar` 面板）③ 插件页显示「UI 组件演示 v0.1.0 **已启用**」。
> ⇒ **打包版能读库里的插件**（此前只有 dev 模式与 Android debug APK 验过；桌面包从没打过）。
> 证据 `_shots/rel-01-started.png`、`rel-02-menu.png`、`rel-03-plugin-page.png`。
> **同时也说明：插件不在二进制里** —— 换个库/换台机器，库里没有 `.zn/plugins/` 就没有插件，
> 要带插件必须连库目录一起拷。
> ⚠️ **一处误判（已纠正，教训留下）**：我最初把截图最右侧那条 16px「窄条」当成应用内的**右栏布局 bug**，
> 还写进了本文档并提交。**用户当场指出：那是截图越界，截到了后面的 DSH 窗口** —— 不是 ZeroNote 的内容。
> 根因：`GetWindowRect` 返回的矩形**含 DWM 边框**（Win10/11 每边约 8px），按它取矩形截图，
> 右/下边缘会截进窗口外的画面。dev/release 两版都"复现"也正是因为**误判与代码无关**（两次都越界）。
> 规避办法见文末「自动化验收方法论」新增的那条。

> ## 📌 rev34（同日 19:30 · Markdown 快捷输入栏 —— 落在手机软键盘正上方）
>
> 用户要求：「**键盘上面做 markdown 标记的快捷输入**」。
>
> **先补了内核原语 `doc.insertAt(pos, text, cursorOffset?)`** —— 不然这事做不成：
> `insertAtCursor` 只能插在光标处，而工具栏的**行首标记**（`# ` 标题 / `- ` 列表 / `> ` 引用）
> 在光标停于行中时会被插进句子中间；**成对标记**（`**粗体**`）也没法把光标放进两个标记之间。
> 按偏移插入让这两件事都成立（偏移越界夹进 `[0,len]`，不抛错）。同步补进 `doc:write` 的**裁剪名单**
> —— 新原语漏裁等于开了后门；契约 §1.2 已更新。
>
> **插件** `examples/md-toolbar/`：**12 个按钮、三类行为**
> · 成对标记（粗体 / 斜体 / 行内代码 / 删除线）—— 有选中就包住，没有就插一对、光标落中间
> · 行首标记（标题 / 列表 / 待办 / 引用）—— 插到**光标所在那一行的行首**
> · 固定片段（代码块 / 链接 / 表格 / 分隔线）—— 光标落在"该填内容"那一格（如链接的 `[]` 里）
>
> 界面纯 UINode（`row` + `button`），插件里零 React；每个按钮背后是一条 `command`
> ⇒ 命令面板里同样能找到这些动作。
>
> **挂载位置**：`view` 的 `editor-toolbar`，渲染在**编辑器底部**；手机上键盘弹起时视口被压缩，
> 它自然落在**键盘正上方**（不是浮动定位，是布局的自然结果）。
> 为该场景把 `.zn-editor-toolbar` 改成**一条到底 + 横向滑动**（折行会吃掉半屏编辑区），
> 窄屏按钮加大到 **40px 见方**（手指点得准）。
>
> **验收**
> - **插件逻辑 9/9**：用 node 直接跑插件、mock 掉内核 API 做断言（`PASS 9 / FAIL 0`，EXIT=0）——
>   行首标记落到行首 0（**不是**光标处 3）· 第 2 行行首 = 4 · 成对标记光标落中间 · 有选中时包住 ·
>   多行逐行加前缀 · 链接光标落 `[]` 内 · 面板挂 `editor-toolbar` · 按钮 12 个 · 每个 `onClick` 都命中已注册命令
> - 基线：`tsc -b` **0** · `oxlint` **4**（= 基线）· Rust 未动（`cargo test --lib` 仍 **18 passed**）
> - APK 已构建（**274.9 MB**，19:26）
>
> **✅ 真机验证通过（19:35，Redmi Turbo 3 / `33b676f6`）**
> - `_shots/phone-tb-08.png`：**键盘弹起时工具栏正好落在键盘上沿** ——
>   自上而下是「编辑器 → 工具栏 `B I <> S H • ☑ ❝ {} 🔗` → 状态栏 → 键盘」
> - `_shots/phone-tb-09/11*.png` + **文件实测**：光标停在标题行**中间**时点「• 列表」，
>   落盘结果是 `- # 来自 PC 的测试笔记` —— `- ` **插在行首**，不是光标处
>   ⇒ `doc.insertAt` 的核心价值真机成立（用旧原语会插成 `# 来自 PC 的- 测试笔记`）
>
> **两个坑（都花了轮次，别再踩）**
> 1. **`adjustResize` 在 targetSdk 35 上不生效**：`AndroidManifest.xml` 里明明写了
>    `windowSoftInputMode="adjustResize"`，但 edge-to-edge 强制之后系统**不再自动压矮 WebView** ——
>    键盘是"盖"在页面上的，底部工具栏被整个挡住（`phone-tb-05/06.png` 两轮都是这个现象）。
>    最终解法是**前端监听 `visualViewport`**（`resize` + `scroll`）把可见高度写进 `--zn-viewport-h`，
>    `.zn-app` 用 `height: var(--zn-viewport-h, 100%)`。manifest 那条**保留**（旧机型上仍有效，
>    与前端方案收敛到同一高度）。**教训：手机上"键盘上方"不要指望 Android 帮你让位，自己量。**
> 2. **`adb shell input` 吃的是物理像素，而截图看的是预览图**（1220 → 838，差 **1.4565** 倍）：
>    按预览坐标点了一次，落在编辑器空白处 ⇒ **把光标挪到了文档末尾**，
>    于是第一个 `- ` 插在末尾，一度被误判成"点工具栏会失焦"的 bug。
>    **换算规则：adb 坐标 = 预览坐标 × (截图物理宽 ÷ 预览宽)**。
>    （这与文末验收方法论里"不要目测截图坐标"是同一条，我这次栽在没做换算。）
>
> **仍未做**：桌面 UI 实测（实施时用户在操作电脑，没抢窗口）。真机已覆盖同一套代码路径，
> 优先级降低；临时库 `_tmp-vault-tb/` 留着，随时可验。

> ## 📌 rev35（同日 19:50 · 编辑器顶部「可开关的 Markdown 快捷键提示」）
>
> 用户要求：「**桌面端编辑界面的顶部做可开关的标记快捷键提示**」。
>
> **内核加了一个挂载位 `editor-topbar`**（对称于 `editor-toolbar`）—— 编辑器**顶部**的提示条。
> 同样是"没人注册就一个 DOM 都不渲染"；面板 `dispose()` 掉，整条就消失
> ⇒ **"可开关"就是这么实现的，内核不需要再提供可见性开关**。
> 契约的 `PanelLocation`、capability 白名单（`view:editor-topbar`）、宿主渲染与 `pagePanel`/☰ 菜单的
> 过滤都同步登记 —— **漏登记 capability 会让插件被判"未知 capability ⇒ 拒载"**，这是加新位置的固定动作。
>
> **插件（md-toolbar 0.2.0）**
> · **9 条命令配了 `keybinding`**：`Mod+B` 粗体 / `Mod+I` 斜体 / `Mod+E` 行内代码 / `Mod+Shift+X` 删除线 /
>   `Mod+1` 标题 / `Mod+Shift+L` 列表 / `Mod+Shift+T` 待办 / `Mod+Shift+Q` 引用 / `Mod+K` 链接。
>   键位由内核的 `bindCommandKeybindings` 自动绑定，插件只**声明**（不自己监听）。
> · 顶部提示条把键位印在按钮上（点一下同样执行）；左端 `✕` 关掉。**只有桌面挂** ——
>   手机没有 Ctrl 键，"快捷键提示"在那边是伪概念（手机上由底部工具栏承担同一件事）。
> · 开关状态存插件自己的 `store`（落盘 `{"hint": false}`），下次打开还记得。
>
> **两个真 bug（都是这轮实测挖出来的，不是想出来的）**
> 1. **Rust `list_plugins` 会漏掉 junction 插件目录**：判断用的是 `entry.file_type().is_dir()`，
>    而 `file_type()` 对 junction / 符号链接返回 **symlink** 类型（`is_dir()` == false）⇒
>    插件被整个漏掉，界面上看起来就是"插件没加载"（顶部提示条与底部工具栏**一起消失**）。
>    改成 `entry.path().is_dir()`（**跟随链接**）—— 把插件目录 junction 到源码目录本来就是插件开发者的
>    正常用法（改完即生效，不必反复拷）。`list_vaults` 一并改；
>    **`collect()`（笔记树递归扫描）故意不跟随**，防链接成环。
> 2. **提示条的 `✕` 原本放在右端，与编辑区右上角的「关闭」按钮挤在同一角** ——
>    实测点偏，把**笔记关掉**了；而"提示条消失了"其实是笔记被关、编辑器区整个不渲染。
>    我一度误判成"开关没记住状态"。现在 `✕` 放**最前**，CSS 用
>    `:first-child { position: sticky; left: 0 }` 钉住（横滑也跑不掉）。
>
> **验收（桌面实测 + 单测）**
> · `_shots/topbar-10-loaded.png`：顶部提示条（左端 `✕` + 9 条键位）与底部工具栏**同时在**
> · `topbar-11-hidden-ok.png`：点 `✕` ⇒ 提示条消失、**笔记仍在**（没有误关）
> · **磁盘实测**：`_tmp-vault-tb/.zn/plugins/md-toolbar/store.json` = `{"hint": false}`
> · `topbar-12-remembered.png`：切库重载插件后**仍隐藏**（截图 sha256 与上一张**完全一致**）⇒ 选择被记住
> · **插件逻辑 21/21**（node 直跑插件 + mock 内核 API）：行首标记落**行首** / 成对标记光标落中间 /
>   多行加前缀 / 9 条键位无重复 / 桌面挂提示条而**手机不挂** / toggle 开→关→开 + 写 store /
>   上次选隐藏则开局不显示
> · **快捷键实测**：按 `Ctrl+B` 后 `probe.md` 末尾出现 `****`（成对标记插入成功）
> · 基线：`tsc -b` **0** · `oxlint` **4** · `cargo test --lib` **18 passed**
>
> **踩坑补记（花了整整两轮）**：改 `examples/` 里的插件后，**测试库里的那份是复制品、不会自动同步** ——
> 我改了三次插件，应用一直跑的是最早那版（于是"新键位不生效""✕ 不在左端"全都被误判成 bug）。
> 现在测试库 `_tmp-vault-tb/.zn/plugins/md-toolbar` 是 **junction → `examples/md-toolbar`**，
> 改完只切库重载即可。副作用：插件的 `store.json` 会被写进 `examples/`，已加 `.gitignore`。

> ## 📌 rev36（同日 · Markdown 标记**收进内核**：移动端快捷栏 ＋ 桌面右键「标记」子菜单）
>
> **用户裁决（分两次给，第二次把范围收窄了）**
> 1. 「**收进内核，同时手机的提示也是内核应有的功能**」—— 起因：本轮开场在查 rev35 遗留的
>    未决问题（点顶部提示条的 `Ctrl+B` 疑似关掉笔记），用户改向要求把标记搬进内核，
>    并追问「**内核不是能够编辑 markdown 吗**」。
> 2. 「**不用做顶部提示条了，去掉；桌面的底部提示也去掉。桌面只有右键菜单，
>    移动只有键盘顶部快捷栏**」—— 入口收敛成**一桌一移**（见下）。
>
> **先把那个追问回答清楚（本轮核实的事实，写下来防再争）**
> 内核"看得懂" Markdown —— **渲染**（`@atomic-editor/editor` 的 Live Preview：光标行显源码、
> 其余行渲染成标题/粗体/表格）与**打字补全**（`extendEmphasisPair` / `startAsteriskList` /
> `autoCloseCodeFence`，见 `node_modules/@atomic-editor/editor/dist/index.d.ts:12`）都在内核依赖里。
> 但"**把选中变成标题**"这个**动作**此前一件都没有：`**` / `# ` / `- [ ] ` 全写在
> `examples/md-toolbar/index.js`，连 `Ctrl+B` 也是插件声明的
> ⇒ **解析层在内核、动作层在插件**，这就是缺口。
>
> **改法：12 条命令 + 两处入口，一份实现**
> · 新增 `src/kernel/markdown-marks.ts` —— 12 个标记的**唯一真相**
>   （`core.mark.bold` … `core.mark.hr`；三类行为：成对 / 行首 / 固定片段，逻辑与插件时代一字不改）。
>   挂的是**已有的内核命令层**（`core.save` / `core.newNote` … 同一张表）
>   ⇒ **契约零变更、capability 白名单零变更**，键位照旧由 `bindCommandKeybindings` 自动绑定。
> · 新增 `src/components/MarkToolbar.tsx` —— **移动端**那条快捷栏（`platform === 'android'` 才渲染），
>   落在软键盘正上方。用插件面板同一套 class（`zn-ui-row` / `zn-btn` / `zn-ui-btn-ghost`）
>   ⇒ 外观与插件时代一致，插件注册到同位置的面板跟在后面一起横滑。
> · **桌面唯一入口 = 右键菜单的「标记」子菜单** —— 为此给右键菜单原语长出子菜单能力
>   （`ui/context-menu.tsx` 的 `MenuItem.children`）：编辑器右键 → 「标记 ›」→
>   12 项（右侧带快捷键提示）。四条约束都写进注释了：子面板必须 `fixed`（主菜单是 `overflow-y-auto`，
>   绝对定位会被裁）、**不能 portal**（主菜单靠 `contains(target)` 判"点了外面"）、
>   鼠标离开留 180ms 宽限、**点击展开要"钉住"**（触摸屏根本没有 hover，否则手机上子菜单永远点不中）；
>   底部贴视口时内部滚动。
> · **`examples/md-toolbar/` 退役删除**：能力已全部收进内核，留着会**双重注册键位**
>   （按一次 `Ctrl+B` 插两组 `**`）。测试库里的 junction 上个会话已清掉，无需再动。
>
> **顺手修掉一个真 bug（桌面实测挖出来的，不是想出来的）**
> 顶部面板上的按钮在**桌面点了没反应** —— 根因不是按钮，是 `.zn-titlebar-hotzone`
> （`position:absolute; height:20px; z-index:59`，唤出标题栏 + 兜底拖动区）**压在窗口顶部 20px**，
> 而面板正好落在那 20px 里 ⇒ 点上去实际点在热区上（而它还是 drag-region）。
> 修法：`.zn-editor-topbar` 加 `position:relative; z-index:61`（抬到热区之上）＋
> `align-self:flex-start`（只占内容宽 —— 撑满会把热区整条吃掉，编辑器里就再也唤不出标题栏）。
> **这很可能就是 rev35 那个未决问题的答案**：用户"点提示条按钮把笔记关掉"，
> 大概率是点击被热区吃掉/内容位移之后的错位点击。顶部提示条现已按用户要求撤掉、症状载体不复存在，
> 但**"热区压顶部 20px"这件事本身修好了**（插件把面板挂 `editor-topbar` 同样受益）。
>
> **验收（桌面实测 + 基线）**
> · `_shots/mk-02-editor.png`（收窄范围**前**录的，留作对照：内核顶栏 + 底栏同时在的样子）
> · `_shots/mk-03-menu.png`：编辑器右键 → 菜单里出现「标记 ›」（内核化之前没有这一栏）
> · `_shots/mk-04-submenu.png` / `mk-06-after-hmr.png`：展开 12 项（带快捷键提示），底部内部滚动
> · `_shots/mk-12-desktop-final.png`：**收窄范围后**的桌面 —— 顶部无提示条、底部无工具栏，
>   右键「标记」仍在（桌面只剩这一个入口）
> · `_shots/mk-07-after-insert.png`：点子菜单「粗体」⇒ 编辑器出现 `****`（光标落中间）、
>   `untitled-20261012-195714.md` 磁盘 `14 B → 18 B` 落盘，**笔记没被关**
> · 基线：`tsc -b` **0** · `oxlint` **4** · `cargo test --lib` **18 passed**
>
> ⚠️ **本轮未处理的那个未决问题**（用户改向，不是遗忘）：点顶部提示条左侧 `Ctrl+B` 疑似关掉笔记。
> 收进内核后提示条左端仍是 `✕`、其右第一个才是 `Ctrl+B 粗体` —— 下次排查先确认用户说的"最左"
> 是哪一个，别再从零复现（两侧观测相反的证据仍留在 `_shots/watch-frames.log` 与 `_shots/frames/`）。
>
> ✅ **移动端已真机验证**（当晚补验，走 `android-dev.cmd` 的 HMR 模式）：
> · 手机上出现内核那条快捷栏（`_shots/android-markbar.png`）—— 手机库里**没有** md-toolbar 插件，
>   所以只可能来自内核
> · 软键盘弹起时它正好落在**键盘正上方**（`_shots/android-keyboard-bar.png`；`f1e38dd` 的
>   visualViewport 修复与本次内核化叠加生效）
> · 点「B」真能插入：`test-from-pc.md` 磁盘 `0 → 4` 字节（`****`，`_shots/android-bar-insert.png`）
> · **怎么起 dev**（下次照做）：`android-dev.cmd` 用 WMI 起（**脱离 DSH 会话**，不要用后台 job ——
>   会随会话回收）；它不自起 vite，直接连桌面 dev 的 `192.168.1.3:1420`（**前提：桌面 dev 开着**）。
>   **判据**：logcat 里出现 `tauri.localhost/node_modules/.vite/deps/react-dom_client.js`
>   —— 只有 vite dev 提供这个路径，打包版不会有；主机 `netstat :1420` 里也应看到手机 IP 的连接。
>   从"起"到"手机跑起来"约 **2–3 分钟**（Rust 有缓存时）。
> 若日后又想要桌面顶部提示条：`70ef21a` 里有 `hint` 形态的 `MarkToolbar`（含可开关 + 存 localStorage）可取回。
>
> 📎 **当晚追加的一条答疑（不是 bug，记下防重查）**：用户写了一段「段落 + 下面一行只有一个 `-`」，
> 结果**上面整段变成加粗大标题**，问是不是渲染错了。**这是 Markdown 标准的 Setext 标题**
> （`=` → H1 / `-` → H2，**整段**一起变，不是只有上一行）。用 ZeroNote 自己那个解析器验过：
> `Document(ATXHeading1, SetextHeading2, Paragraph)`（临时脚本 `_shots/parse-check.mjs`，可直接复跑）；
> `@atomic-editor/editor` 的 `dist/inline-preview.js` 里确实有 `SetextHeading1` / `SetextHeading2` 分支
> —— 它只是照解析结果渲染，没做错。**用户 2026-10-12 裁决：不改**（与 Obsidian / Typora / VS Code 一致）。
> **规避写法**：分隔线用 `---` 且**前后各留一个空行**；别在段落正下方写只有 `-` / `=` 的行。
>
> 🔧 **当晚打了本仓库唯一的第三方补丁**（`patches/@atomic-editor__editor@0.6.2.patch`，现 3.9 KB）：
> **分两批，都是改 `@atomic-editor/editor` 的渲染规则**。
>
> **① 空标题不隐藏 `#`**（用户报：`#` 后直接换行 ⇒ 光标离开那行后整行空白，像内容丢了）
> 根因：`HIDEABLE_SYNTAX` 含 `HeaderMark`，非活动行 `pushReplace` 掉；空标题没有内容可显示 ⇒ 什么都不剩。
>
> **② 整套对齐 Typora 的「标记后必须有空格」规则**（用户要求「整套 Markdown 语法都对齐 Typora」）
> · 先**实测** Typora 1.14.10（本机当晚刚装）把规则测出来，再逐条对照 —— **48 个 case**；
>   测试集 + 结论 + **离线解析脚本**存在 **`_research/typora-parity/`**（下次接手直接续，别重测）。
> · 结论：**差异只有一条规则的推论**（裸 `-`/`*`/`+`/`1.`、段落 + 单个 `-`、`#` 裸 / `# ` 空标题）；
>   其余语法（强调 / 代码 / 链接 / 图片 / 表格 / 删除线 / 任务 / 自动链接 / 引用 / 分隔线 / HTML / 转义）
>   **实测一致**。
> · 实现：**一条判据**（标记后面是不是空格）落在三处 —— 标题行 class、标题标记隐藏、列表标记。
> · **没做**：脚注 / 数学公式是 Typora 的**扩展功能**（ZeroNote 根本没有），不属"对齐语法"范围。
> · **未核清**：段落 + `---` 的标题级别（Typora 视觉像 H1，CommonMark 是 H2）。
>
> **升级注意**：以后升 `@atomic-editor/editor` **必须重打**这个补丁（`pnpm patch` → 改 → `pnpm patch-commit`）；
> npm 上 0.6.2 已是最新（查过），暂时没得升。
> **改了 node_modules 之后 vite 必须重启**才会重新预打包（日志会打
> `Re-optimizing dependencies because lockfile has changed`）；只删 `.vite/deps` 不重启不够。
> 证据：`_shots/eh-02-empty-heading.png`（① —— 同一屏里两种行为都在）、
> `_shots/zn-suite-02.png`（② 对齐后的 ZeroNote 渲染）、
> `_shots/tp-suite-top.png` / `tj-x*-typora.png`（Typora 侧的对照）。

> ## 📌 rev37（同日 21:50 · 修基线第三条：测试临时目录移出 `%TEMP%`）
>
> **起因**：本轮接手先跑三条基线，第三条 **6 passed / 12 failed** —— 12 个用例全挂在
> `tmpdir()` 的 `create_dir_all`（`Os code 5 PermissionDenied`），而**代码一行未改**
> （`git status` 干净、HEAD `e43da6e` 与交接卡一致）⇒ **是环境，不是回归**。
>
> **实测到的边界（两条对照，缺一不可）**
> · 测试进程往 `%TEMP%`（`C:\Users\AQUA\AppData\Local\Temp`）建目录 ⇒ **拒绝访问**
> · **同一个路径，pwsh 里 `New-Item` 建目录成功** ⇒ 不是磁盘满、也不是权限表坏，
>   挡住的是**跑测试的那个受限上下文**
> · 顺带发现 `%TEMP%` 里堆了 **238 个 `zn-test-*` 残留**（旧实现 `let _ = fs::remove_dir_all`
>   静默忽略失败 ＋ 目录名带 pid ⇒ 每跑一次多留 12 个）
>
> **改法（`1a297b6`，只动 `src-tauri\src\lib.rs` 的测试辅助函数，内核逻辑零改动）**
> · 临时目录改到 **`<repo>/_tmp-test/`** —— 前缀已在 `.gitignore`（`_tmp-*/`），
>   与既有 `_tmp-vault-tb/` 同一约定，路径可预测；**不再用 `std::env::temp_dir()`**
> · 目录名**去掉 pid**（`zn-test-<tag>`）：cargo 在 target 上有锁、同一 target 的两个 cargo
>   命令串行 ⇒ 固定名无并发风险，且不再累积
> · 清理失败**不再静默忽略**：`NotFound` 放过，其它错误直接 panic 并带路径 ——
>   原来那句 `let _ =` 正是把"不可写"藏起来的地方（本项目"静默失效比报错危险"那条）
>
> **验收（默认环境，未改 TEMP）**：`cargo test --lib` **18 passed / 0 failed** ·
> `tsc -b` **0 错误** · `oxlint` **4 warnings / 0 errors**
>
> ⚠️ **遗留两条**：① `%TEMP%` 里那 238 个空目录（合计 **0 MB**）**没动** —— 在工作区外，
> 按"删除前先确认"的规矩留给用户定；测试复跑不再新增。② **根因未深挖**（为什么那个受限
> 上下文写不了 `%TEMP%`）：本会话 approval 被禁用，跑不了 `diagnose-windows-sandbox-acl`
> 那条**必须非受限执行**的诊断脚本；这次选择先绕开、让基线恢复可跑。

> ## 📌 rev38（同日 22:20 · 层级文件夹：目录右键菜单 ＋ 空目录显示 ＋ 库内新建/重命名/删除）
>
> **用户裁决**：「参考 NoteGen 这种结构做」（截图里的右键菜单：新建文件 / 新建文件夹 /
> 查看目录 / 知识库 / 剪切复制粘贴 / 上传下载文件夹 / 重命名 / 删除本地·远程文件夹）。
> **逐条对照后的取舍**：NoteGen 的「查看目录 / 知识库 / 上传·下载文件夹 / 删除远程文件夹」
> ZeroNote 没有对应概念（无多库树、无远程；`查看目录`要新增 opener capability）⇒ **这四项不列出**
> （宁缺勿假）；`剪切 / 复制 / 创建副本 / 粘贴` 与 `F2 / Del` 快捷键**留到下一批**。
>
> **先回答那个问题（"不依赖插件能做层级文件夹吗"）**：能，而且**内核本来就有** ——
> `create_dir` / `move_entry`（能搬整棵目录树）/ `delete_note`（进回收站）早就在，
> 缺的只是 UI 入口：`fs.mkdir` 与 `fs.move` 此前**零调用点**。
> 而且**插件本来就做不了**：`plugin-host.ts` 把插件的 `mkdir` 直接 deny（`fs:write`）。
>
> **本轮真正的内核改动只有一条只读命令**
> · `list_dirs`（`collect_dirs`）：递归列库内目录，跳过 `.zn`/`.git`/`node_modules`/`.obsidian`。
>   **为什么必须加**：`list_notes` 只上报 `.md`，前端是**从文件路径反推**目录树的 ⇒
>   **空文件夹在文件树里根本不会出现**，"新建文件夹"会像没反应（静默失效）。
> · 既有命令**语义零变更**；契约 §1.1 已补这一行；单测 +1（空目录要上报 / 忽略目录不上报）。
>
> **前端（`FileTree.tsx` 大改 ＋ `App.tsx` 接线）**
> · 目录节点第一次有右键菜单：**新建文件 / 新建文件夹 / 重命名 / 删除文件夹**；
>   空白处右键 = 在**库根**新建（与 NoteGen 一致）
> · 新建后**立刻内联命名**（复用重命名那套输入框）；新建的笔记**自动打开**
> · 重命名按类型分流：文件走 `rename`（自动补 `.md`），目录走 `move`（不补后缀、能搬树）
> · **两个此前不存在的正确性处理**：① 打开的笔记在**所在目录**被改名 ⇒ `activePath` 前缀一起换；
>   ② 所在目录被删 ⇒ 编辑器清空 ＋ 撤销条 —— 否则下一次自动保存会写向一条不存在的路径
> · **修掉一处本轮自己引入的重叠**：侧栏的应用级右键菜单挂在 `.zn-body` 的**捕获阶段**
>   （它已排除 `.zn-tree-item`），空白右键会同时弹两个菜单 ⇒ 加 `.zn-filetree` 判断：
>   文件列表区域的空白归文件树，侧栏头部 / 底部库名那行的右键菜单照旧
>
> **验收（桌面 dev ＋ HMR；截图在 `_shots/`）**
> · `folder-02-menu.png` 空白右键**只出一层**菜单（含「新建文件 / 新建文件夹」）
> · `folder-03-newdir-renaming.png` 新建文件夹 → 内联命名（输入框已全选）
> · `folder-04-newdir-renamed.png` 命名 `a` 提交 ⇒ 树里出现 `▾ a`、toast「已重命名：a」、
>   磁盘 `_tmp-vault-tb/a/` 出现（**空目录可见**就是这条命令的意义）
> · `folder-05-dir-menu.png` 目录右键菜单：新建文件 / 新建文件夹 / 重命名 / 删除文件夹
> · `folder-06-newfile-in-dir.png` 目录内新建文件 ⇒ 磁盘 `a/untitled-20261012-221304.md`、
>   编辑器自动打开、状态栏 `3 篇`
> · `folder-07-dir-deleted.png` 删除文件夹 ⇒ 整棵 `a` 进 `.zn/trash/1791814407307--a/`（含里面的 .md）、
>   撤销条出现、编辑器回到「选一篇开始」
> · 基线：`tsc -b` **0** · `oxlint` **4** · `cargo test --lib` **19 passed**（原 18 ＋ 新增 1）
>
> **下一批（未做）**：剪切 / 复制 / 创建副本 / 粘贴（**复制需要内核新增递归复制命令**）
> ＋ `F2` / `Del` / `Ctrl+X/C/V` 快捷键（**只在文件树聚焦时**生效，免得抢编辑器的复制粘贴）
> ＋ 移动端长按出菜单（触屏没有 hover）。
>
> **顺带记一条实测到的坑**：`gentle_probe` 返回的 `rect` 是 **(left, top, right, bottom)**，
> 不是 `(x, y, w, h)` —— 按后者算截图宽度会**截进窗口外**（本轮第一张图右侧多出 ~170px 的
> 桌面与别的窗口）。判据：截图里出现与窗口无关的内容、且只在外侧一条 ⇒ 先怀疑它。

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
| **🗂 最近库过期记录自动清理**（缺口 3） | `_shots/gap3-02-menu-before.png`：失效库 `vault-demo-b` 仍在最近列表、底栏报「库目录不存在」→ `gap3-04-menu-cleaned.png`：打开菜单即**自动剔除 + toast 提示** → `gap3-06-persisted.png`：`Ctrl+R` 重载后列表仍干净且**无 toast** ⇒ 真持久化；对照 `gap3-16-menu-zoom3.png`（目录在就不误杀）vs `gap3-17-gate-toast-zoom.png`（菜单弹出后才删目录 ⇒ `applyVault` 的门拦下：**不切库、不报错**）· `cargo test` **17 passed**（新增 `vault_exists_is_read_only`：只读、不建目录） | 本次 |
| **🚧 平台门（缺口 1）** | `_shots/gate-04-plugins-page.png`：`platforms:["android"]` 的插件在桌面 ⇒ **「不适用 · 仅移动端」+ 开关禁用 + 无错误横幅**；三组对照 —— `gate-05`（改成双端 ⇒ **已启用**，证明只挡不匹配的、没误杀）· `gate-06` + `gate-07`（懒激活 + 仅移动端 ⇒ 仍跳过，且命令面板里**列不出**它的命令）· `gate-08`（`"windwos"` 拼错 ⇒ **拒载 + 报错并列出合法取值**，不再静默失效）；新增示例 `examples/platform-locked/` | 本次 |
| **📦 release 打包版加载插件（首次）** | `cargo-targets\zeronote\release\zeronote.exe`（10.5 MB，`tauri build --no-bundle`，2m46s）；带 `ui-kit` 的库上：`_shots/rel-01-started.png`（**编辑器底部工具栏**＝插件的 `editor-toolbar` 面板渲染）· `rel-02-menu.png`（`☰` 菜单出现「UI 组件演示」＝插件的 `sidebar` 面板入口）· `rel-03-plugin-page.png`（插件页「**已启用**」）⇒ 打包版能读库内插件 · ⚠️ 附带一说「右栏被挤窄」**是误判**（截图越界截到后面的 DSH 窗口，用户指出，已纠正） | 本次 |
| **⌨️ Markdown 快捷输入栏（手机键盘上方）** | 内核新原语 `doc.insertAt(pos,text,cursorOffset?)`（行首标记落行首 / 成对标记光标落中间；并入 `doc:write` 裁剪）· 插件 `examples/md-toolbar/`（12 按钮、三类行为）· `.zn-editor-toolbar` 改横滑 + 窄屏 40px 触控；**插件逻辑 node 断言 `PASS 9 / FAIL 0`**（行首 0 而非光标 3 / 第 2 行行首 4 / 光标落中间 / 多行加前缀 / 链接落 `[]` / 面板位置 + 12 按钮 + onClick 全命中）；`tsc` 0 · `oxlint` 4 · APK 274.9 MB ⚠️ **手机与桌面 UI 实测待补**（adb 设备掉线 / 用户占用桌面） | 本次 |
| **⌨️ 编辑器顶部「可开关的快捷键提示」** | 内核新增挂载位 **`editor-topbar`**（对称于底部工具栏；面板 dispose 掉整条消失 ⇒ 可开关）· 插件 9 条命令配 `keybinding`（`Mod+B/I/E/1/K`…）+ 顶部提示条（只桌面挂，手机由底部工具栏承担）· 开关存 `store`；实测：`topbar-10-loaded.png`（提示条 + 底部工具栏同时在）→ 点 `✕` → `topbar-11-hidden-ok.png`（消失且**笔记未被误关**）+ 磁盘 `store.json = {"hint":false}` → `topbar-12-remembered.png`（重载后仍隐藏，sha256 与上一张一致）· **插件逻辑 21/21** · `Ctrl+B` 实测插入 `****` · **顺带修 Rust `list_plugins` 漏掉 junction 插件目录**（`file_type().is_dir()` 对链接返回 false）| 本次 |

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
   > 而且当时拿到一个结论：**加了 CSP 之后"裸 fetch"被 `connect-src` 真拦住了**
   > （白名单内 200 / 白名单外 `Failed to fetch`，见契约 §4.2 的实测表）。
   > ⚠️ **但那条结论随后失效了**：用户同日 12:30 裁决把 `connect-src` 放宽成 `https: http: ws: wss:`
   > ⇒ 「**不声明 `net` 也能联网**」这条短板**又回来了**（⑧ 的授权是**加载期**检查，不是运行期拦截；
   > 契约 §4.2 那张表已注明是"放宽前"的实测）。
   > **② `platforms` 强制：已完成**（rev33 平台门）。
   > **③ 沙箱：2026-10-12 用户裁决「先搁置」**（原话「沙箱先搁置」，**不是遗忘**）——
   > 判断依据：插件目前都是自己写的，"本机可信代码"前提成立，沙箱的剩余收益主要是**防 `while(true)` 卡死**；
   > 将来若要**插件分发 / 装别人写的插件**，它是前置条件，届时再评估（三种形态强度对比见对话记录与
   > `契约 §4.3` / `插件能力盘点` G1 行）。
   > **下一次从哪接手由用户指定**。

   | # | 议题 | 说明 |
   |---|---|---|
   | **1** | **capability 真裁剪** | 实测「不声明 `net` 也能联网，声明了反被拒」——**安全假象**。⑧ 已把 `net`/`proc` 做成授权通道；但**运行期边界仍是零**（见上：CSP 放宽后裸 fetch 又能连）。精确根因与四个备选强度见上方短板表 |
   | ~~2~~ | ~~**`platforms` 强制**~~ | ✅ **已完成（rev33）** —— 三档声明 + 两道门 + 取值校验；示例 `examples/platform-locked/` |
   | **3** | **沙箱（Worker + 内存/时长上限）** | 契约 §4 排 v0.2；唯一能防住 `while(true)`、也是唯一能让 ① 变成真边界的。**2026-10-12 用户裁决：搁置** |

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
- ⚠️ **`GetWindowRect` 含 DWM 边框（Win10/11 每边约 8px）—— 按它取矩形截图会截进窗口外的画面**（2026-10-12 实物踩坑）：
  ZeroNote 右侧那条 16px「窄条」被我当成应用内的**右栏布局 bug**（还写进本文档并提交了一次），
  实际是截图越界、截到了**后面的 DSH 窗口**（`_shots/rel-01-started.png` ↔ `rel-12-dev-control.png`），
  **是用户看屏幕当场发现的**。**判据**：异常内容若只出现在**最外侧约 16px**、且"文字像别的东西"
  （竖排单字、莫名其妙的拉丁字母）⇒ **先怀疑截图越界，别怀疑布局**。**规避**：截图区域按 `rect` 向内缩 ~10px。
  （同一条也解释了为什么"dev 与 release 都复现"——误判本来就与代码无关。）

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
