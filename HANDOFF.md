# 项目交接

revision: 81
更新时间: 2026-10-14（rev81 ① Android「关闭插件窗口」定型：不重载 ＋ 放接管（`clearShell`）＋ 清 URL（`replaceState`），并**更正 rev80 对「0 篇」的归因** —— 实为存储权限；② **折叠状态机由自造换成 CM6 官方 `codeFolding`**（折点仍归插件），圆点与圆托合成同一个组件 ⇒ 跨平台同心；③ 手机也能接 CDP 了（`adb forward … webview_devtools_remote_<pid>`）。rev80 大纲折叠/展开：内核 `editor.addFold` ＋ 库内 `.zn/outline-folded.json` 持久化；rev79 大纲缩进/竖线按「一个中文字符」＋ 圆点居中；rev78 大纲竖线：内核新增 `editor.addLineClass`）
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

> ## 📌 rev39（同日 22:45 · 剪切 / 复制 / 创建副本 / 粘贴 ＋ 文件树快捷键）
>
> **接着 NoteGen 那张截图把剩下的一半做完**（rev38 结尾列的"下一批"）。菜单顺序与它一致：
> 新建 → **剪切 Ctrl+X / 复制 Ctrl+C / 创建副本 / 粘贴 Ctrl+V** → 重命名 F2 → 删除。
>
> **内核：新增一条 `copy_entry`（递归复制）**
> · 语义与 `move_entry` 严格对齐：`to` 是已存在目录 ⇒ 复制**进去**；目标已存在 ⇒ 拒绝不覆盖；
>   禁止复制进自己的子孙
> · **递归时跳过 `.` 开头与 `SKIP_DIRS`** —— `.zn` 是库的私有目录（插件 / 回收站），
>   复制它等于把私货散出去；契约 §1.1 已补 `copy`
> · 单测 +1：单文件 / 子目录递归 / `.zn` 不外泄 / 三种拒绝（源不存在 / 目标同名文件 / 复制进子孙）
>   —— 写这条单测时**我先把断言写错了**：以为「复制到已存在的目录」该报错，其实那是 `cp` 的
>   "复制进去"语义，**是断言错了不是实现错了**（改成断言 `dst/src/a.md` 存在）
>
> **前端剪贴板（放应用级，不放文件树内部）**
> · 状态 `{ mode: 'cut' | 'copy'; paths: string[] }` —— 粘贴后要 `refresh`，剪切态还要跨重渲染保持
> · **撞名策略分两种**：复制 ⇒ 自动退成 `xxx 副本` / `xxx 副本 2`（「创建副本」也用这条）；
>   剪切 ⇒ 报错不覆盖（移动没有合理的自动改名策略）
> · **粘回原位**：剪切静默跳过（等于什么都没做），复制则生成副本 —— 与资源管理器一致
> · 剪贴板为空时菜单里**不显示**「粘贴」：`MenuItem` 没有 disabled 态，与其摆一个点了没反应的
>   灰项，不如让它不出现（"静默失效比报错危险"的同一条）
>
> **快捷键（只在文件树内生效）**
> · 根 div 的 `onKeyDown`：`Ctrl+X / Ctrl+C / Ctrl+V` ＋ `F2`（重命名）＋ `Del`（删除）
> · 生效范围靠**事件冒泡**界定：子 `button` 聚焦后才收得到 ⇒ 在编辑器里按 `Ctrl+C` 仍然是
>   复制文本，不会把整篇笔记复制走（这是本批最容易踩的一处）
> · `Ctrl+V` 的落点 = **选中项所在目录**（没选中 ⇒ 库根）
>
> **验收（桌面 dev ＋ HMR；截图在 `_shots/`）**
> · `clip-02-file-menu.png` 文件右键：新建 / 剪切 Ctrl+X / 复制 Ctrl+C / 创建副本 / 重命名 F2 / 删除
>   —— 剪贴板为空 ⇒ **没有「粘贴」**这一项
> · `clip-03-duplicate.png` 创建副本 ⇒ 磁盘出现 `untitled-20261012-204334 副本.md`
> · `clip-04-paste-menu.png` 复制之后**目录**右键 ⇒ 多出「粘贴 Ctrl+V」，toast「已复制」
> · `clip-05-pasted.png` 粘贴 ⇒ 磁盘 `新建文件夹 2/新建文件夹/untitled-20261012-204334 副本.md`
> · `clip-06-ctrl-c.png` **快捷键**：点中一行后 `Ctrl+C` ⇒ toast「已复制」＋ 该行选中态
> · `clip-07-ctrl-v.png` `Ctrl+V` ⇒ 磁盘出现 `untitled-20261012-204334 副本 副本.md`（同目录撞名自动退让）
> · 基线：`tsc -b` **0** · `oxlint` **4** · `cargo test --lib` **20 passed**
> · ⚠️ **未实测**：`F2` / `Del`（`gentle_keys` 不认这个键名，返回 `unknown key: F2`）。
>   三个键走的是同一个 `onKeyDown`，`Ctrl+C/V` 已实测 —— **下次接手请用真键盘补这一次**
>
> ✅ **移动端长按出菜单 —— 用户当晚实测确认可用**（这条原本列在"下一批"，理由是
> "触屏没有 hover，菜单可能够不到"，**担心不成立**）。具体是哪种手势触发的**没记下来**
> （长按 / 其他），下次真机自己复现一次再写进文档，别凭推断写死。
>
> **下一批候选**：拖拽移动 · `查看目录`（要新增 opener capability，得先拿到对具体方案的同意）

> ## 📌 rev40（同日 23:00 · 回收站：常驻入口 ＋ 主区页面）
>
> **用户报的缺口**：「没有回收站入口」—— 删除一直是进 `.zn/trash/` 的，
> 但此前**只有 5 秒撤销条**这一个入口，一过就再也够不到那些文件。
>
> **内核：4 条新命令 ＋ 改了 `delete_note` 的存法**
> · 旧存法 `.zn/trash/<时间戳>--<文件名>` **只记名字** ⇒ 恢复时知道"叫什么"、
>   不知道"原来在哪"：`a/b/x.md` 只能恢复成库根的 `x.md`。
>   新存法 `.zn/trash/<时间戳>/` ＋ 一份 `.origin`（原相对路径），内容仍放**一层**。
>   （**踩过一次**：一开始按原路径 mirrored 成多层 `trash/<stamp>/a/b/x.md`，
>   结果 `read_dir` 的"第一个条目"不再等于原路径，列表把原路径读成了 `a`）
> · `list_trash` 新旧两种格式都认（旧条目在 UI 上标「原位置未知」）；
>   `restore_trash` 新格式回**原路径**（父目录自动补）、旧格式回库根，原位置有同名项 ⇒ 拒绝不覆盖；
>   `purge_trash` / `empty_trash` 真删除（不可撤销）
> · 单测 +1（全链路 ＋ 旧格式兼容 ＋ 撞名拒绝）：cargo 20 → **21 passed**
>
> **前端**
> · 侧栏底部常驻「🗑 回收站」入口 → 主区整页视图（与插件管理共用骨架）
> · 列表：名称 / 原路径（旧格式标「原位置未知」）/ 删除时间 / 大小 ＋ 「恢复」「彻底删除」
> · 「彻底删除」「清空回收站」都**两步确认**（按钮自身切成「确认删除」，不弹窗）
> · 取数据放在**入口事件**里而不是 effect 里（lint 的 `set-state-in-effect` 盯着，
>   语义上它本来就是个"打开这一页"的事件）
>
> **顺带修一个真 bug（本轮实测挖出来的，和 rev36 是同一个坑）**
> · `.zn-main-panel` 顶部没让开 `.zn-titlebar-hotzone` 那 **20px** ⇒ 面板顶栏那排
>   「清空回收站 / 返回编辑器」**怎么点都没反应**（连点四次、换了三个坐标都没动静，
>   一度怀疑是缓存帧；改用 `CopyFromScreen` 抓屏 ＋ 点列表里的按钮立刻生效 ⇒ 才定位到热区）
> · 修法选**让开**（`padding-top: 20px`）而不是抬 z-index —— 抬了就把整条热区盖住，
>   鼠标再也唤不出标题栏（rev36 在 `.zn-editor-topbar` 上靠 `align-self: flex-start`
>   只占内容宽躲过去，主区面板是整条 bar，没有那个空间）
>
> **验收（桌面 dev；截图在 `_shots/`）**
> · `trash-01-entry.png` 侧栏底部入口 · `trash-02-panel.png` 面板 11 条（名称 / 时间 / 大小）
> · `trash-08-live.png` 恢复一条**旧格式**条目 ⇒ 回到库根（toast「已恢复：…」＋ 磁盘同步）
> · `trash-11-origin.png` 新格式条目的第二行显示**原路径**
>   `新建文件夹/新建文件夹/untitled-20261012-224013.md`（其余 10 条写「原位置未知（旧格式条目）」）
> · `trash-12-restored-origin.png` 恢复 ⇒ **回到原处**（落在 `新建文件夹/新建文件夹/` 里，父目录自动补）
> · `trash-13-confirm.png` 「彻底删除」第一次点击**只变成「确认删除」**、条目仍在（两步确认生效）
> · 基线：`tsc -b` **0** · `oxlint` **4** · `cargo test --lib` **21 passed**
> · ⚠️ **未实测**：「确认删除」的**第二次点击**（真删）与「清空回收站」的执行 ——
>   没拿用户的数据去试；内核侧 `purge_trash` / `empty_trash` 有单测覆盖，UI 走同一条 invoke。
>   —— **用户当晚自己补验了彻底删除**（截图里出现「已彻底删除」toast），这条过了
>
> **rev40.1（同日 23:15 · 修 toast 常驻）**：用户报「那些弹出提示应该有时限，会自己消失」。
> 查下来 toast **从来没有计时器** —— 全应用只有撤销条（5 秒）和标题栏有自动消失。
> 修法：加一个 effect（`setState` 写在 `setTimeout` 的**回调**里，避免 `set-state-in-effect`
> 把基线的 4 warnings 顶成 5），时长 `2500ms + 60ms/字`、上限 8 秒（短消息两秒半够读，
> SAF 那种长说明留足时间）；点击立即关闭保留。
> 证据 `_shots/toast-02-shown.png`（点恢复后 2 秒，toast 在）→
> `toast-03-gone.png`（5 秒后 toast 没了，界面其余部分一致）。
> ⚠️ **一个已知小瑕疵**：连续两次弹出**同一条**消息时字符串没变 ⇒ effect 不重跑、计时器不重置
> （第二次会提前消失）。改法是调用前先置 null，目前不值得。
>
> **下一批候选**：拖拽移动 · `查看目录`（要新增 opener capability，得先拿方案同意）
> · 回收站的**自动清理**（例如只保留 30 天）

> ## 📌 rev41（同日 23:20 · 第一个功能插件：大纲 · 导图）
>
> **用户点的活**：「接下来做第一个插件，大纲 – 兼容思维导图转换」（附 NoteGen 参考图：左大纲、右导图）。
>
> **插件 `examples/outline-map/`**（manifest + index.js + selftest.mjs）
> · 解析**标题 + 列表**成树：层级栈处理任意跳跃的层级；**跳过代码块**里的 `#` / `-`；
>   行内标记（粗体 / 链接 / 行内代码）剥成纯文本
> · 自算「横向树」布局 → **静态 SVG**：叶子等距、父节点居中于子节点、贝塞尔连线、
>   宽度按字数估（中文按 1 字号、西文 0.56）；颜色全用 `var(--zn-*)` ⇒ 主题自动跟随
> · 三视图（并排 / 大纲 / 导图，靠 UINode `tabs`）+ 一键导出 **Mermaid `mindmap`** 插进笔记
> · **取舍（写在插件文件头）**：没接 markmap —— 它的交互式渲染要真 DOM + 脚本，而 `html` 节点是
>   静态注入（生产构建里 Tauri 给 `script-src` 注入打包资源 hash，内联脚本一律被拦）；
>   走 webview 逃生口在 Android 上又不服务 `.html`。所以**自绘 SVG、零依赖、离线可用**，
>   代价是没有缩放/折叠交互 —— 要交互就得换渲染层，届时再评估。
>
> **内核只加了一条命令**：`core.panel.<面板 id>`（"打开面板：<标题>"），为**每个**插件面板注册。
> · 起因：面板此前**只能从 ☰ 菜单进**，而那个按钮在窗口最上面（`.zn-titlebar-hotzone`
>   吃点击、标题栏还要 hover 才显形）—— 既难点、也没法脚本化
> · 单独一个 effect（并进核心命令那批会让 `panels` 一变就重注册整批命令 + 重复绑键位）
>
> **自测抓到一个真 bug**：文档**单个 H1 打头**时根节点与它重复（根「绪论」底下又挂一个「绪论」）
> ⇒ 提升为根。节点 40 → 39、层级 6 → 5。
>
> **验收**
> · `_shots/om-04-filter.png` / `om-06-panel-cmd.png`：命令面板里出现插件的两条命令
>   （`outline-map.refresh` / `outline-map.insert-mermaid`）＋ 新命令「打开面板：大纲 · 导图」
>   ⇒ **插件加载成功**
> · `_shots/om-07-panel.png`：面板能打开（当时没有活动笔记 ⇒ 走空状态分支）
> · `_shots/outline-map-preview.png`：**导图实际渲染**（离线自测产出的 SVG ＋ headless Edge 截图），
>   结构与用户给的 NoteGen 参考图一致
> · 基线：`tsc -b` **0** · `oxlint` **4** · `cargo test --lib` **21 passed**
> · **离线自测**：`node examples/outline-map/selftest.mjs <笔记> [out.svg]` ⇒ 大纲文本 ＋ Mermaid ＋ SVG
>   ＋ 带颜色兜底的预览 HTML（核心全是纯函数，**不必开 GUI 就能测** —— 也避免抢用户的鼠标）
>
> ⚠️ **本轮两次事故，都要记住**
> 1. **自动化点不中 ☰**：它距窗口顶 24px，而标题栏只在鼠标进顶部 20px 时显形，
>    `gentle_click` 的"移动 → 点击 → 还原"节奏抓不住 ⇒ 后来改用命令面板（键盘）才绕开。
>    **副产品**：因此长出了 `core.panel.*` 命令（面板从此可键盘打开）。
> 2. **误触「切换笔记库」**：第二次在命令面板里点击时，输入框已经累积了上一个字符
>    （过滤结果变了），同一坐标于是落到了另一项 ⇒ **弹出了文件夹选择对话框**（用户当场看到）。
>    教训：命令面板里的点击**每次都要重新确认过滤结果**（重新截图），不能沿用上一次的坐标 ——
>    与"绝不跨轮沿用坐标"是同一条规矩。
>
> ⚠️ **未验收：插件面板在"有笔记打开"时的 GUI 渲染**（大纲列表 ＋ 导图同屏）——
> 两次尝试都撞上鼠标操作的风险（见上），改由离线自测把 SVG 渲出来看。
> **下次接手**：先打开一篇笔记，再点 ☰ →「大纲 · 导图」，确认三视图切换与滚动。
>
> **下一批候选**：导图交互（缩放 / 折叠，需换渲染层）· 点大纲项跳到笔记里对应的标题
> （要内核暴露"滚动到某处"的能力）· 拖拽移动 · `查看目录`

> ## 📌 rev42（同日 23:45 · 换掉「算坐标点鼠标」：CDP 直连 WebView）
>
> **用户批评（原话）**：「你就没有优雅一点的操作电脑的方法吗，重视调鼠标点击，慢慢算距离，
> 允许添加插件或者 mcp」——**说得对**。此前验收 GUI 全靠 `gentle_*`（截图 → 眼估坐标 → 合成鼠标），
> 代价是抢用户的鼠标、窗口一动坐标就作废、跨轮沿用坐标还会点错（rev41 真误触了「切换笔记库」）。
>
> **先查现成经验**（本机纪律：别在信息真空里自创）—— 官方做法就是这条路：
> [Haprog/tauri-cdp](https://github.com/Haprog/tauri-cdp)（Tauri 2 + WebView2 开 CDP）＋
> [playwright-cdp](https://github.com/Haprog/playwright-cdp)（Playwright `connectOverCDP` 连上去）。
>
> **落地（零依赖、零 Rust 改动）**
> · `dev.cmd` 加一行 `set "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222"`
>   —— **只写在 dev 启动脚本**，生产打包根本不经过它 ⇒ 不会开调试端口（官方模板是在 Rust
>   `run()` 里 `#[cfg(debug_assertions)]` 下 set，效果一样但要动内核；写启动脚本更干净）
> · `tools/cdp.mjs`：**零依赖**（Node 24 自带 WebSocket 与 fetch），一条命令可连做多步：
>   `shot <png>` / `text [sel]` / `html [sel]` / `eval <js>` / `click <sel|text:…>` /
>   `type <sel|text:…> <值>` / `key <Enter…>` / `wait <ms>` / `waitfor <…>` / `list`
> · 三个实现选择：**点击走 `Input.dispatchMouseEvent`**（页面内的真实输入事件，React 与任何
>   组件库都认，但**不动系统光标** ⇒ 用户能同时用电脑）；**输入走 `Input.insertText`**
>   （中文不会被输入法吃掉）；**截图走 `Page.captureScreenshot`**（没有 DWM 边框/多显示器那些坑）
>
> **它立刻结清了 rev41 的欠账**（插件面板在有笔记时的渲染）：
> · `node tools/cdp.mjs text` 直接读出面板真实内容：「39 项 · 5 级」、三视图、完整大纲列表
> · `eval` 查到导图 SVG：**40 个 `<text>` / 40 个 `<rect>` / 39 条连线**（根 + 39 子节点 ✓ 与解析数一致）
> · `_shots/om-final-panel.png`：同屏看到大纲 + 导图
> · ⚠️ **已知限制**：UINode 的 `row` 没有列宽控制，内容偏宽时"并排"会**堆叠**成上大纲下导图；
>   要看全图请切「导图」单视图（或以后给 row 加 basis）
>
> **以后验收 GUI 一律走这条路**（本文档里"算坐标点鼠标"的旧方法降级为兜底）：
> `cd ZeroNote; node tools/cdp.mjs click "text:xxx" shot _shots/y.png`
> 前置：dev 用 `dev.cmd` 起（它带着 CDP 端口）；`node tools/cdp.mjs list` 能列出 title=ZeroNote 即通。

> ## 📌 rev43（次日 00:10 · 插件视觉对齐参考图 ＋ CDP 流程实战）
>
> **用户给了新参考图**：「需要做成这种效果的大纲和思维导图，红框是切换入口，绿框的行数统计不需要」。
>
> **插件改动（`examples/outline-map`）**
> · 导图三层配色对齐参考图：**根实心大块**（更高更宽、字号 15）/ **一级实心灰块** / 其余描边块
> · **切换入口图标化**：`◫ 并排` / `☰ 大纲` / `❖ 导图`（UINode 的 `row` 没有 justify，
>   做不到"贴右上角"，所以用 `tabs` 这条更清楚的入口）
> · 大纲每项加圆点（观感接近参考图）；节点加**纯 CSS hover 高亮**（html 节点里跑不了脚本）
> · **行号标尺没做** —— 用户说不需要，本来也没有
>
> **CDP 全流程首次跑通（零鼠标）**：
> 返回编辑器 → 点「绪论」→ 唤出标题栏 → 点 ☰ → 点「大纲 · 导图」→ 截图 → 切「❖ 导图」→ 截图
> ⇒ 读到 `tabs=3`、`svg rect=40`；证据 `_shots/om-v3-both.png`（左大纲带圆点 ＋ 右导图）、`om-v3-map.png`
>
> **新方法实战撞出来的三个坑（都已修进 `tools/cdp.mjs`）**
> 1. **坐标点击对"悬停才实心"的按钮不可靠** —— 标题栏的 ☰ 隐藏时 rect 的 y 是 **-16**（视口外），
>    真实鼠标序列得先 hover 再按。⇒ 默认 `click` 改走 **DOM 的 `el.click()`**（与 hover/坐标无关），
>    另加 `rclick`（真实序列）与 `hover` 两个命令
> 2. **`text:` 的包含匹配必须取"文本最短"的候选** —— 否则 `text:导图` 会命中整个页面根容器
>    （它 innerText 里什么都含）
> 3. **模板字符串里的注释不能用反引号** —— `ACT_JS` 本身就是模板字符串，注释里写 `` `text:导图` ``
>    会把它提前终止（Node 报 SyntaxError）
> · 另一个流程注意：`location.reload()`（重扫插件用）**会丢掉"当前打开的笔记"** ⇒ 自动化序列里
>   要先点开笔记，再开面板
>
> ⚠️ **本轮我判断错过一次，记下来**：一度以为"☰ 点不开"，其实是 `Select-Object -First 34`
> 把输出**截断**了 —— 菜单当时就开着（DOM 里查得到 1 个菜单容器）。**判据不能只看被截断的文本。**
>
> **下一批候选**：节点悬浮工具条（参考图里有）· 大纲项点击跳到笔记对应标题（需内核暴露滚动能力）
> · 导图缩放 / 折叠（需换渲染层）· `查看目录`

> ## 📌 rev44（2026-10-13 · 交接：内核 UI 承载能力盘点 ＋ 插件路线重定）
>
> **本轮没有改代码** —— 用户要求「先检查内核现有能力还会不会出现"承载不了插件功能"的情况，
> 先完善内核，再做插件」，于是做了一次**专项盘点并交接**。
>
> **分析结论落在这里**：`docs/插件UI承载能力-2026-10-13.md` —— **下次接手先读它**
> · 三条系统性缺口：**U1** 插件不能自己开窗口（可拖 / 全屏 / 多开都没有）·
>   **U2** 没有自定义渲染入口（声明式表达力到顶；iframe 那条路在 Android 上通不了）·
>   **U3** `doc` 改不了任意区间（无 `replaceRange`）**且 `doc.on(...)` 是空桩**
>   （`App.tsx:623`，契约声明了却永远不触发 —— 静默失效）
> · 每条都带代码行号与影响面，不是印象。
>
> **用户 2026-10-13 的裁决（改变了架构边界）**
> · 「**不需要防『插件把界面改成任意样子』**，只是同一套设计风格就行」⇒ **放弃"声明式 UINode 唯一主路"**
>   （契约 §2.6/§7 一直在守那条，也是 10-12 盘点里的领先项 L1）⇒ **U2 获批**
> · 「**况且现在是自用阶段**」⇒ 不为第三方插件市场做安全防护
>
> **下一步（按顺序；每步跑三条基线 ＋ CDP 验收 ＋ 提交）**
> 1. **U3a + U3b**（小，1 小时内）：`doc.replaceRange(from,to,text)` 照 `insertAt`（`App.tsx:611-622`）写；
>    把 `doc.on` 从空桩接上 `open/change/save/close` 四处（**`change` 的去抖策略要先定**，别让插件被击键打爆）
> 2. **U1**（中）：Tauri 真窗口 —— 前端 `new WebviewWindow(label,{url})` ＋"窗口模式"入口
>    （约定 `?pluginWindow=<panelId>&group=<key>`；有 `?vault=` 的先例）＋ **capability 放行窗口 label**
>    （`capabilities/default.json` 现为 `"windows": ["main"]`；**这是安全边界变更**，落地时写清新增加了什么）
> 3. **U2**（中）：`view.registerWindowContent(mount)` —— 给插件一块真 DOM 自绘；
>    内核提供 `--zn-*` token 与 `.zn-ui-*` class，靠它们保"同一套设计风格"
> 4. **插件重做**：`examples/outline-map` 改成"**大纲组右上角按钮 → 弹独立导图窗口**"
>    （需求清单见该文档 §5，已按用户确认逐条记录，**别再重问**）
> 5. 打磨：编辑（插入 / 删除 / 折叠主题 → 写回笔记）· 样式切换 · 多导图（连通分量）
>
> **环境与工具（现成可用，直接用）**
> · dev：`dev.cmd`（WMI 起，**带 CDP 端口**）· 手机：`android-dev.cmd`
> · **GUI 验收一律走 CDP**：`node tools/cdp.mjs click "text:xxx" shot _shots/y.png`
>   命令：`list` / `text` / `html` / `eval` / `click`（DOM click）/ `rclick`（真实鼠标序列）/ `hover` /
>   `type`（`Input.insertText`，中文安全）/ `key` / `wait` / `waitfor`
> · 插件离线自测：`node examples/outline-map/selftest.mjs <笔记> [out.svg]`
> · 基线：`pnpm exec tsc -b`（0 错）· `pnpm exec oxlint`（**恰好 4 warnings**）· `cargo test --lib`（**21 passed**）
>
> **新会话怎么接**：读 `HANDOFF-CARD.md`（一页速览）→ `docs/插件UI承载能力-2026-10-13.md`（本轮分析）→
> 本文件 rev44 → 从上面「下一步」第 1 条开工。

> ## 📌 rev45（2026-10-13 · 内核增强第 1 步：U3a `doc.replaceRange` ＋ U3b `doc.on` 真事件）
>
> **下一步清单里的第 1 条，一次做完**（原估 1 小时）。两处都只动前端内核，**Rust 一行未改**。
>
> **① U3a —— `doc.replaceRange(from, to, text, cursorOffset?)`**（`src/kernel/contract.ts` DocApi ＋
> `src/App.tsx` docApi 实现）
> · `insertAt` 只能插、`replaceSelection` 只认用户选区 ⇒ 结构化编辑（导图 ⇄ 大纲回写）缺的就是
>   "**改掉任意一段已知区间**"。`from`/`to` 顺序颠倒自动交换，两端夹进 `[0, len]`，`''` 即删除。
> · 与 `insertAt` 同一套"尽力而为、不抛错"策略：插件算出的偏移差一两个字符时该把改动落下去。
>
> **② U3b —— `doc.on(ev, cb)` 从空桩接上真事件**（此前 `on: () => ({ dispose: () => {} })`，
> 契约声明了却永远不触发）
> · 订阅表放 **ref**（`docSubsRef`）而非 state：docApi 的 `useMemo` 依赖是 `[]`，只有 ref 能让
>   "注册"与"四个 fire 点"指向同一份表且不触发重渲染。
> · **`change` 去抖窗口定为 200ms**（`DOC_CHANGE_DEBOUNCE_MS`，trailing）——**这是文档要求"先定再写"的那条决策**。
>   选 200 的理由：① 低于自动保存的 800ms ⇒ 顺序稳定（插件**先**见 change、**后**见 save）；
>   ② 再短（<150ms）在连续打字时几乎等于每键一次，去抖白做；③ **不分"结构性变更"** ——
>   内核不解析 Markdown，硬分就得把判据塞进内核（违背"内核保持薄"），要更细的粒度让插件自己再压一层。
> · **快照显式传参、不读 ref**：`open`/`save`/`change` 三个 fire 点都发生在 `setContent`/`setActivePath`
>   **之后**，而 `contentRef`/`activeRef` 是在 effect 里同步的 —— 那一刻 ref 还是**旧值**，
>   读 ref 会广播"上一秒的文档"（正是 U3 这类静默失效）。所以 `fireDoc(ev, path, content, dirty)` 由调用方给快照。
> · **切笔记/关笔记先去抖兑现**（`flushDocChange`）：不然挂起的 `change(旧)` 会落在 `open(新)` 之后，
>   插件会拿旧内容去改新文档（实测顺序确为 `change(旧) → save(旧) → open(新)`）。
> · 单个订阅者抛错逐个 try/catch 隔离，既不连累其它订阅者也不打断编辑。
> · `docApi.close()`（插件主动关）也补了 close 广播，与 `closeNote` 同一套语义（快照在清空**之前**取）。
>
> **验收（CDP 驱动，磁盘笔记为真源；不碰用户鼠标）**
> · 夹具插件 `examples/doc-edit-probe/`（**临时**，junction 进测试库即可）：三条命令 ＋ 侧栏面板，
>   事件结构化记到 `window.__docProbeLog` 供自动断言。
> · 全量替换：`replaceRange(0, len, BASE)` 后磁盘正文**逐字节等于** BASE。
> · 区间替换：改中段后与旧文 **共同前缀 37 / 共同后缀 22**（长度 62→62）⇒ **只有 3 个字符被改，其余一字未动**。
> · 事件链：`open → change(dirty,62B) → save(落盘 62B)`；打字后切笔记 `change(旧) → save(旧) → open(新)`；
>   关笔记 `close(path 正确, 7B)`。截图 `_shots/u3-plugin-mgmt.png`、`_shots/u3-palette.png`。
> · 复跑方式：`node tools/cdp.mjs click "text:☰" eval "…menuitem('命令面板')…" type "input" "探针：写入基准文本" key Enter`
>
> **基线（本轮实测）**：`tsc -b` **0 错误** · `oxlint` **恰好 4 warnings** · `cargo test --lib` **21 passed**。
> ⚠️ **更正**：`HANDOFF-CARD.md` 的基线写着"cargo test 18 passed"，**实测是 21**（rev44 的 HANDOFF 里已是 21）。
> 卡片那句已改。加 `docApi` 依赖数组时 oxlint 先报了第 5 条 `exhaustive-deps`（`fireDoc`/`flushDocChange`），
> 补进依赖数组即回到 4 —— **稳定引用进依赖数组不会重建 docApi/kernel**，但不写就是"读到上一代的 fire"。
>
> **两条顺带核实到的事实（记下来，别再当新 bug 查）**
> · 打开笔记时 CM6 会触发一次 `onChange` ⇒ `open` 之后紧跟一条 `change` ＋（800ms）一条 `save`。
>   **这是既有行为**（autosave 一直在），本轮只是第一次有了观察窗口；内容不变时它写的是同样字节。
> · **已知边界**：`replaceRange` / `insertAt` 作用于**挂载中的编辑器实例**。主区被插件面板
>   （`location: 'main'|'sidebar'` —— 契约里 `sidebar` 现在也渲染在主区）占满时编辑器已卸载，
>   此时调用**静默 no-op**。要改内容请从编辑器可见的上下文触发命令（本轮验收就是走命令面板）。
>   已写进契约 §1.2 的注释；U1（真窗口）之后这条边界才会真正消失。
>
> **下一步**：清单第 2 条 **U1**（Tauri 真窗口 + `capabilities/default.json` 放行窗口 label）——
> 注意那是**安全边界变更**，落地时在本文档写明"新增了什么权限"。

> ## 📌 rev46（2026-10-13 · 架构原则重定：内核不设防 ＋ **修复优先于防护**）
>
> **用户重新说明 5 条原则**（原话与逐条落地见 **`docs/架构原则-2026-10-13.md`** ——
> **冲突时以它为准**，它覆盖 `内核需求分析-v0.1.md` §2 与 `内核契约-v0.1.md` §4 的旧假设）：
> ① 无插件时内核就是普通笔记应用 ② 插件权限等同内核、可覆盖内核效果、可把内核搁在一边
> ③ 覆盖可以、**不得破坏**、关掉插件内核还能用 ④ 权限完全由插件控制、**内核不给任何安全保证**
> ⑤ **修复优先于防护** —— 不可逆修改之后，从备份的内核重新构建。
>
> **用户当场的三处裁决**：`capabilities` **全部拆掉、降级为自述** · 「把内核搁在一边」=
> **真窗口 + 主壳接管点（分两步）** · `platforms` 门**保留**（实用门，非安全边界）。
> 追加说明：**内核不提供安装插件后的数据安全保证**（库数据不在保护范围，原则 3 的"不得破坏"
> 只指内核可用性）；备份放本地；**将来开放第三方使用时，恢复改为从 GitHub 拉备份**。
>
> **实测（不是推断）—— capability 表本来就不是边界**：一次性夹具 `examples/raw-ipc-probe/`
> （manifest **只声明** `command` + `view:sidebar`，**没有 `net`、没有 `fs` 写权限**）：
> · ① `window.__TAURI_INTERNALS__.invoke` 是 `function` ⇒ 可直连 IPC
> · ② 不经 `fs` 原语就列出了库内插件
> · ③ **往库外写文件成功**（`write_absolute`，磁盘实测出文件）
> · ④ 裸 `fetch` 外网 **`HTTP 200`**（manifest 里**没有** `net`）
> · ⑤ 直接改内核 DOM（状态栏条纹）——**卸载后不还原** ⇒ 原则 3 的真实缺口：「卸载即净」
>   只回收**内核记账的资源**（命令/面板/样式/服务/编辑器标记），插件自己伸手改的宿主 DOM
>   **不在账上** ⇒ 结论：原则 3 只能是「**接口层强制还原 ＋ 信任层插件义务**」。
> · 另测 **任意路径可读**：`convertFileSrc('C:/Windows/win.ini')` + fetch = `HTTP 200 len 92`
>   （`assetProtocol.scope` 是 `["**"]`，CSP 放宽后 `connect-src` 含 `http:`）。
> · Tauri 侧的**真边界只有三条**：开新窗口（缺 `core:webview:allow-create-webview-window`）、
>   执行系统命令（未装 shell 插件）、**删/移库外文件**（内核没这条命令）—— 详见新文档 §2.2。
>
> **独立复验 U3a/U3b（与 rev45 走不同路径，结论一致）** —— 这轮走**面板按钮**而非命令面板，
> 并修掉夹具的一个真坑：**`contributes.panels` 里的 `location` 内核并不消费**（面板是靠运行时
> `view.registerPanel` 注册的），只改 manifest 无效 ⇒ 探针一直挂在 `sidebar`，
> 被 `core.panel.*` 命令提升到主区后**顶掉编辑器** ⇒ `editorRef.current` 为 null ⇒
> `replaceRange` 静默 no-op（与 rev45 记的边界同源）。改成 `editor-toolbar` 后探针与编辑器**同屏**。
> 判据：seed / replace **逐字节 `match: true`**（62/62，`firstDiff: null`，磁盘笔记为真源）；
> 事件链 `open(693) → change(62,dirty) → save(62) → change → save`；
> 切笔记 `change(旧) → save(旧) → open(新)`；关笔记 `close(path 正确)`。
> 夹具新增诊断出口 **`window.__docProbeDiag`**（`lenBefore/lenAfter/hasReplaceRange/activeIsNull`）——
> 「静默失效」的定位靠它一步到位，别再靠猜。
>
> ⚠️ **并发提示**：本轮期间**另一个会话**提交了 `05e8319`（U3a/U3b 本体 + rev45 +
> HANDOFF-CARD 的 18→21 更正）。本会话只提交它**没覆盖**的部分：架构原则文档、两个探针夹具、
> 夹具改进（诊断出口 + `editor-toolbar`）。
>
> **下一步顺序（按"保险先上"调整）**：① **内核自愈**（快照 + 一键从备份重建；必须含
> **外部 `修复内核.cmd`** —— 应用起不来时那是唯一的路）② 拆权限门 ③ 接管协议 + 还原验收
> ④ U1 真窗口 ⑤ U2 主壳接管点 ⑥ 重做 `outline-map`。

> ## 📌 rev47（2026-10-13 · 内核自愈落地：原则 5「**修复优先于防护**」兑现）
>
> **用户原则**：「内核完全不设防……只需要提供一个修复的方式，在插件进行不可逆修改后，
> 从备份的内核重新构建就行」。本轮把它做成了能用的东西（**零新依赖**）。
>
> **三个文件**
> · `scripts/kernel-snapshot.mjs` —— 建快照。**`KERNEL_PATHS` 白名单就是"内核边界"的可执行定义**。
>   为什么用白名单：`node_modules`/`target`/`dist`/`gen` 这类靠黑名单很容易漏，而白名单每一项都能
>   回答"删了它还能重建吗"。含 `patches/`（**重建必需**，漏了编辑器行为就不一致）、
>   `scripts/`＋`tools/`（**含自愈脚本自己** —— 脚本被改坏也得能修回来）、`docs/`。
>   manifest 记：文件清单 + SHA256 + 构建命令 + git HEAD/branch/dirty。
> · `scripts/kernel-restore.mjs` —— 恢复。**四条规矩**：① **先验备份自己**（逐文件 SHA256，
>   不符 ⇒ 拒绝恢复：拿坏备份覆盖好代码比不恢复更糟）② **先把当前状态另存为 pre-restore 快照**
>   （修错了能退回来）③ **默认不删**快照外文件（要删显式 `--prune`）④ 恢复后**复核**到逐字节一致。
>   另有 `--list` / `--dry-run` / `--build` / `--force`。
> · `修复内核.cmd` —— 双击 = 交互模式，**不依赖应用本体**（应用起不来时唯一的路）。
>
> **实测**：基线快照 **701 文件 / 5.32 MB**。
> **演练**（四种坏法一次打进去：追加垃圾行 / 整个文件写成非法 JSON / 删文件 / 塞垃圾文件）：
> `--dry-run` 精准报「3 改动 + 1 多余」→ 恢复 → **独立复核**（不看脚本自报）：行数复位 671、
> JSON 合法、`permissions.ts` 补回、`hacked.ts` 被 `--prune` 删掉、**0 处差异**；
> 另验**坏快照被拒绝**（故意改坏备份里一个文件 ⇒ 退出码 1，源文件未被触碰）。
> **基线**：`tsc` 0 · `oxlint` **恰好 4 warnings**（扫描文件 64→66 ⇒ 脚本被扫但**没引入新 warning**）·
> `cargo test --lib` **21 passed**。`_kernel-snapshots/` 已进 `.gitignore`。
>
> **一条硬认知（留给以后）**：「什么算内核」**必须是白名单**。黑名单（"排除 node_modules 等"）
> 会在新增构建目录时静默漏掉；白名单每多一项，就是显式做了一次决定。
>
> **下一步**：§4.1 **拆权限门** —— `assertCapabilities` 不再拒载、`net`/`proc` 不再默认拒、
> `scopedFs`/`scopedDoc` 的裁剪放开、`capabilities` 降级为自述、设置页「网络访问」改只读展示、
> 契约 §4 诚实改写。⚠️ 这是**安全模型变更**，用户已对具体方案裁决（2026-10-13）。

> ## 📌 rev48（2026-10-13 · 拆权限门：**原则 4 落地**）
>
> **用户裁决**：「全部放开，内核完全不设防，也不提供任何安全保障，插件想做什么全凭自觉」
> + `capabilities` **全部拆掉、降级为自述**。
>
> **改了什么（前端 5 个文件；Rust 一行未动）**
> · `src/kernel/plugin-host.ts` —— 删三道门：`assertCapabilities`（未知取值拒载 + `net`/`proc` 查授权）
>   → 换成 `warnUnknownCapabilities`（**只警告、不拦**）；`NEEDS_GRANT` / `IsGranted` / `neverGranted`
>   删除；`scopedFs` / `scopedDoc`（按 capability 裁剪写方法）删除 ⇒ `ctx.fs` / `ctx.doc`
>   **就是内核那一份**。
> · `src/App.tsx` —— 删 `permissions` state / `permissionsRef` / 读授权记录的 effect / `isGranted`
>   接线 / `toggleNetwork`；`grantedNet` → `declNetPlugins`（改读 **manifest 自述**）。
> · `src/components/Settings.tsx` —— 「网络访问」开关 → **「网络与进程（自述）」只读展示**
>   （列出自称需要 `net`/`proc` 的插件 + "内核不做权限判定" + 指路 `修复内核.cmd`）。
> · `src/kernel/contract.ts` —— `Capability` 注释改成"**自述，不是门**"。
> · `examples/net-demo/` —— 文案对齐（它原来写着"默认被拒载"，在新原则下是最误导的一句）。
>
> **实测（真跑，非推断）**
> · `examples/net-demo`（声明 `["net","command","view:main"]`）**此前是拒载**（历史证据
>   `_shots/perm-05-plugins.png`）⇒ 现在插件日志：
>   `[info] 插件已加载：网络访问示例（net-demo｜esm）`；插件页三颗 ✅；
>   设置页新区块列出「net-demo · 自称：net」。证据 `_shots/perm-selfdeclare.png`。
> · `docs/内核契约-v0.1.md` §4 改写：明写"capability 不再是门"，§4.1 标已移除，
>   §4.2 保留原有三条绕过路径 + **补记 2026-10-13 实测的三条**（写库外 / 读任意文件 / 卸载不还原）。
>
> ⚠️ **本轮踩到一个真坑（记下来别再踩）**：演练内核自愈时，我把
> `src-tauri/capabilities/default.json` 写成非法 JSON ⇒ **Tauri watcher 立刻检测到并重建**
> ⇒ `failed to parse JSON: key must be a string` ⇒ **dev 进程 exit 101**
> （恢复脚本随后把文件还原了，但进程已经死了 ⇒ CDP `fetch failed`）。
> **认知**：`capabilities/` 是**被 Tauri 监视的构建输入**，动它会让正在跑的 dev 崩；
> 演练这类文件要预期"dev 会死一次"，重启即可（`Start-Process cmd /c dev.cmd`，约 35 秒）。
>
> **未动的一块**：`.zn/permissions.json` 与 Rust 的 `read_permissions` / `set_permission`
> **原样保留**（前端已不读它们）—— 是否整体下线见 `docs/架构原则-2026-10-13.md` §6（等裁决）。
> ✅ **更正（rev66）**：用户裁决「清掉」⇒ 这两条命令与该文件**已整体删除**（见 rev66 段）。
>
> **基线**：`tsc` 0 · `oxlint` **恰好 4 warnings** · `cargo test --lib` **21 passed**。
>
> **下一步**：§4.2 **接管协议 + 还原验收** —— 立两条规矩：① 内核给出的每条"接管"入口
> **必须返回 `Disposable`** 并由宿主登记（卸载即还原）② 插件自绘 / 自改宿主 DOM 时提供登记点
> （`ctx.host.onRollback` 一类）：**登记过的内核负责还原，没登记的自己负责**；
> 并给出可自动化的还原判据（卸载后内核 DOM / 命令表 / 订阅表回到基线）。

> ## 📌 rev49（2026-10-13 · **接管协议落地**：原则 3 从"机制在、边界不清"变成可判定）
>
> **接手方式**：读 `HANDOFF-CARD.md` → 本文件 rev48 → 从 rev46 定的**下一步顺序第 ③ 步**开工
> （① 内核自愈 = rev47 ✅ ② 拆权限门 = rev48 ✅ **③ 接管协议 + 还原验收**）。
> 本轮**前端内核 6 个文件 + 1 个工具 + 1 个夹具**，Rust 一行未动。
>
> **改了什么**
> · `src/kernel/command.ts` —— **`bind` 的还原语义**（本轮修的**真缺口**）：覆盖一条已存在的
>   命令时先记下 `prevRun`，`dispose` 放回；只有"bind 之前这条命令根本不存在"才整条撤掉。
>   旧行为是 `delete cur.run` ⇒ **卸载插件把内核功能一起带走**。
> · `src/kernel/plugin-host.ts` —— 新增 `scopedEvent` / `scopedFs` / `scopedDoc` / `scopedHost`：
>   **`event.on` / `fs.watch` / `doc.on` 的返回值现在由宿主自动登记**（此前契约要求插件自己
>   `push`，实测没人推 —— 与当初 `command`/`view` 是同一个坑）；`scopedHost` 提供
>   **`ctx.host.onRollback(fn)`**，并给插件接管的实现打 `plugin:<id>` 归属标记。
> · `src/kernel/contract.ts` —— `HostApi.onRollback` 定义 + `PluginContext.subscriptions`
>   注释重写（哪些自动、哪些强制回收、哪些自己管）。
> · `src/kernel/kernel.ts` —— 新增 **`kernel.audit()`**（`KernelAudit`）：命令表（含**实现归属**）/
>   订阅表 / 面板 / 服务 / 编辑器规则 / 插件 `<style>` 数。
> · `src/kernel/event.ts` · `editor-marks.ts` —— `stats()` / `editorMarkEntries()` 两个诊断读数。
> · `src/App.tsx` —— 把审计快照挂到 **`window.__znKernelAudit()`**（只读，生产留着无害）。
>
> **判据可自动化（这是本轮的真正产物）**
> · 新脚本 **`tools/verify-takeover.mjs`**：走 UI（☰ → 插件管理 → 重新扫描）装/卸夹具，
>   前后各拍一次审计快照，**11 项判据**逐条比对 —— 不靠人眼、不碰用户鼠标、不猜坐标。
> · 夹具 **`examples/takeover-probe/`**（接管 `core.newNote` · `event.on('note:saved')` ·
>   改状态栏（**登记** `onRollback`）· 改 body 属性（**不登记**）。它是验收脚本的配套输入，
>   每次跑都要它 —— **保留作可复跑证据，别顺手删**）。
>   ②③ 两处**故意不接返回值** —— 考的就是"宿主自动登记"。
> · **`examples/daily-note` 一卸，"新建笔记"四个入口就废** —— 旧行为现场可复现；
>   判断它靠 `audit.commands` 里 `core.newNote.impl`：`core` 正常 / `null` = 没还原。
>
> **对照实验（证明判据真能抓住它，不是自证）**：临时把 `dispose` 改回旧行为跑一次 ⇒
> **9/11**，精确报出 `core.newNote: {"impl":null}` 与"命令表未回基线"；恢复修复后 **11/11**。
>
> **顺带修了 CDP 工具两处**（都是被本轮踩出来的）
> · `tools/cdp.mjs` 导出 `Cdp`/`click`/`sleep` 等供验收脚本复用，**并给 `main()` 加主模块判断**
>   —— 否则被 import 时它拿调用方 `argv` 当命令跑，会把验收脚本自己搞挂。
> · `text:` 定位**优先挑真正可点的元素**（`button`/`a`/`role=menuitem`）：菜单项的
>   外层 `div` 与内层 `button` 文本完全相同，旧逻辑 `el.click()` 打在外层 div 上，菜单纹丝不动。
>
> **基线（本轮实测）**：`tsc -b` 0 · `oxlint` **恰好 4 warnings** · `cargo test --lib` **21 passed**。
> 证据截图 `_shots/takeover-loaded.png`（插件在时：插件页列出「接管探针」+ 状态栏红条纹）、
> `_shots/takeover-unloaded.png`（卸载后：条纹复原、命令表回基线）。
> 文档：契约 **§2.7 接管协议**（权威版本）· `docs/架构原则-2026-10-13.md` §4.2 标 ✅。
>
> **下一步**：§4.3 **U1 真窗口**（`new WebviewWindow` + `capabilities` 放行窗口 label）——
> ⚠️ **那是安全边界变更**，落地时必须在本文档写明**新增了哪条权限**；
> 未核实项：Tauri 2.12 的 capability `windows` 是否支持 glob（**先查官方文档或实测一次**，别自创）。
> 契约 §7 未决里的 `permissions.json` 是否整体下线（§6.1）仍待裁决。
> ✅ **已结清（rev66）**：用户裁决「清掉」⇒ 已整体删除。

> ## 📌 rev50（2026-10-13 · **U1 真窗口落地**：插件能开自己的窗口了）
>
> **用户裁决**（本会话）：先「允许新窗口」→ 随即明确 **「按完全权限放行，卡着没有意义」**
> ⇒ 不做按窗口分级的窄权限，所有窗口权限一致（与原则 4 一脉相承）。
>
> ⚠️ **新增的权限（安全边界变更，按硬约束在此写明）** —— `src-tauri/capabilities/default.json`：
> | 新增 | 作用 |
> |---|---|
> | `core:webview:allow-create-webview-window` | 能开新窗口/新 webview（此前这是 Tauri 侧三大硬边界之一） |
> | `core:window:allow-destroy` | 能立即销毁窗口（关窗走它，见下） |
> | `windows`: `["main"]` → `["main", "plugin-*"]` | glob 覆盖插件窗口（**已核实** Tauri 2.12 支持 glob：本地 schema + 官方文档都写 "Can be a glob pattern"） |
> 另：曾按"最小放行"写了一份更窄的 `capabilities/plugin-windows.json`，**按用户裁决已删除**。
>
> **改了什么**
> · `src/kernel/contract.ts` + `kernel.ts` —— 新增 **`view.openWindow({ panel, title?, width?, height? })`**：
>   开独立窗口、返回 `Disposable`（=关窗），**由宿主自动登记**（`scopedView` 已加它 ⇒ 插件不接返回值也不会漏关）。
>   内核维护**窗口账** `windowMap`（`audit().windows` 可读）；label 一律 `plugin-<sanitized panelId>-<n>`
>   （`.` 等非法字符换 `-`）；创建失败走 `tauri://error` **异步**报 —— 挂在日志里，不静默；
>   用户手动关窗也销账（`close-requested` / `destroyed`）。
> · `src/App.tsx` —— **窗口模式**：URL 带 `?pluginWindow=<panelId>` 时只渲染那一个面板
>   （自绘标题条 = 拖动区 + 关闭；无侧栏 / 无编辑器，找不到面板时给明确文案不留白屏）。
> · `src/styles.css` —— `.zn-plugin-window*` 一套（复用 `--zn-*` 令牌，深浅色跟随主题）。
> · `examples/window-demo/` —— 示例插件：面板 + 两个命令（打开 / 多开），`view.openWindow` 的参考实现。
>
> **三个实测坑（花了两轮才收敛，别再踩）**
> 1. **capability 是编译期嵌进二进制的** —— 改完 `capabilities/*.json` 光重启进程**不生效**，
>    必须让 cargo 真的重编（本机做法：touch `src-tauri/src/lib.rs`）。不重编时的症状极迷惑：
>    窗口能开、插件也加载（**应用自己的命令不受 ACL 管**），但 `plugin:window|close` 被拒 ⇒「点了没反应」。
> 2. **关窗必须 `destroy()`，不能用 `close()`** —— ⚠️ **rev53 更正**：当时写的"自身发起会死锁"
>    是**错误诊断**。真相见 rev53：`close()` 只发事件、真正销毁靠监听器里的 `destroy()`；
>    插件窗口当时一个监听器都没有 ⇒ 没人 destroy ⇒ 看起来"死命令"。三键仍直接 destroy（更直）。
> 3. **内核那层「关窗前落盘」拦截器必须在窗口模式跳过** —— 它在每个窗口都注册，会把插件窗口的
>    关闭请求吃掉（同一次踩坑的另一半，症状与 ② 一模一样）。
>
> **验收**：新脚本 **`tools/verify-plugin-window.mjs` → 10/10**（装插件 / 开窗 / 多开 / 窗口内渲染 /
> label 约定 / 关窗销账 / 两个窗口都销账 / **卸载插件时开着的窗口被内核自动关掉** / 命令表回基线 /
> 窗口账回空）。多 target 的坑也顺手记在脚本注释里（CDP target 上看不到窗口 label，只能连上去问）。
> 截图 `_shots/plugin-window-child.png` · `_shots/plugin-window-main.png`。
>
> **基线（本轮实测）**：`tsc -b` 0 · `oxlint` **恰好 4 warnings** · `cargo test --lib` **21 passed**。
>
> **下一步**：§4.4 **U2 主壳接管点**（`view.overrideShell(spec)`：插件接管主区/整窗渲染，dispose 后内核 UI 复原）
> → 然后把 `examples/outline-map` 重做成「大纲组右上角按钮 → 弹独立导图窗口（可拖 / 全屏 / 多开 /
> 可编辑并写回笔记）」—— 现在 **U1 已经给了那个窗口**，缺的只是"把导图搬进去"。

> ## 📌 rev51（2026-10-13 · **U2 主壳接管点**：插件能把内核 UI 整个搁在一边）
>
> 用户在本会话选了路线第 ⑤ 步（U2）。前端 5 文件 + 1 组件 + 1 示例 + 1 验收脚本，**Rust 一行未动**
> （也没有新的 capability —— 这一步不需要权限）。
>
> **改了什么**
> · `src/kernel/contract.ts` —— 新增 **`view.overrideShell({ mount })`**（契约 §2.8）：
>   `mount(el, ctx)` 在宿主给的容器上画 DOM（**只调用一次**），可返回 `Disposable` 收尾。
> · `src/kernel/kernel.ts` —— 内核只记**账 + 通知**：`shellTakeover` 单接管者、
>   `onShellChange` 通知宿主、`shellOwner()` 给宿主渲染期读（**宿主不镜像 state** ——
>   内核重建时账随旧内核消失，不可能留下幻影）、`audit().shell` 供验收读、**`clearShell()` = 逃生口**。
>   第二个插件来接管**抛明确错误**（不静默顶掉前者）。
> · `src/components/ShellMount.tsx`（新）—— 挂载器：`mount` 只跑一次（依赖稳定）、
>   释放时**先调插件的 cleanup 再清容器**、`mount` 抛错不白屏而是把"谁+什么错"写在容器里。
> · `src/App.tsx` —— 接管分支（保留拖动热区；**右下角内核逃生口按钮** + `Ctrl+Alt+Z`）；
>   窗口模式下接管**只作用于内容区**（标题条与关闭按钮保留，否则窗口关不掉）。
> · `src/styles.css` —— `.zn-shell-host` / `.zn-shell-mount` / `.zn-shell-escape`（逃生口克制但 `z-index:100`）。
> · `examples/shell-demo/` —— 示例插件：命令接管、自绘界面里自带「释放接管」按钮。
>
> ⚠️ **实现过程中发现的真缺口（本轮最重要的结论）**：**接管期间内核 UI 全部不在渲染树里** ——
> 连「插件管理」页都点不到。插件要是不给自己退出入口、或崩在半路，用户**只能重启应用；
> 而重启后插件若在 `onStartup` 自动接管，就直接锁死**。
> ⇒ 内核**必须**留恢复通道（不是设防，是原则 5 的"修复优先"）：右下角小按钮 + `Ctrl+Alt+Z`
> 强制释放；释放走的是 `ShellMount` 的 cleanup ⇒ **插件 `mount` 返回的 cleanup 依然被调用**
> （示例插件在那里清掉自己的句柄，于是"再接管"不会撞旧句柄 —— 验收里单独判了这条）。
> ⇒ 同时写成**插件义务**：接管由用户动作触发，**不要 `onStartup` 自动接管**。
>
> **验收**：新脚本 **`tools/verify-shell.mjs` → 12/12**（装插件 / 接管生效 / 内核 UI 让位 /
> 审计 `shell` 读数 / 插件自己按钮释放 / 逃生口在 / 逃生口释放 / 插件收到释放并收尾 /
> 再接管 / 卸载后命令表回基线 / 无残留容器）。截图 `_shots/shell-takeover.png`（接管中：
> 内核 UI 全无 + 右下角淡淡的逃生口）· `_shots/shell-released.png`（释放后内核 UI 回来）。
>
> **基线**：`tsc -b` 0 · `oxlint` **恰好 4 warnings**（中途一度变 5 —— 我加的"内核变化时清接管 state"
> 的 effect 触发了 `set-state-in-effect`；改成**渲染期直接读内核账**后回到 4，顺带消掉一类同步 bug）·
> `cargo test --lib` **21 passed**。
>
> **下一步**：⑥ 把 `examples/outline-map` 重做成「大纲组右上角按钮 → 弹**独立导图窗口**
> （U1 已给窗口、U2 已给整窗接管）→ 可拖 / 全屏 / 多开 / 可编辑并写回笔记（`doc.replaceRange` 早备好）」。
> 这一步只动插件（`examples/`），内核侧应该不用再改 —— 正好检验前面几步够不够用。

> ## 📌 rev52（2026-10-13 · **outline-map 重做成"导图独立窗口"**：路线第 ⑥ 步）
>
> **用户当场纠正了方向（本轮最重要的一句话）**：
> > 「导图不是做新窗口吗…… 这两个窗口应该是同层级的，**不存在大纲窗口**，
> > **笔记就是大纲**，导图是新窗口，分屏完全依赖 Windows 的窗口分屏」
>
> ⇒ 插件**不能**再占一块地方显示"大纲"（我第一版做成主区面板，把笔记顶掉了 —— 截图里
> 用户一眼看出不对）。正确形态：**笔记本身=大纲**，插件只留**每组一个「❖ 导图」按钮**，
> 点了开独立窗口；两个窗口平级，怎么摆交给 Windows。
>
> **本轮只动插件**（`examples/outline-map/` + 一个验收脚本），**内核一行未改**。
>
> **改了什么**
> · 入口 = **编辑器顶部条**（`editor-topbar`，唯一"贴着编辑器"的挂载位）：
>   一排 `导图 | ❖ 项目计划 | ❖ 另一组` —— 每组一个按钮，笔记仍是主区的大纲。
> · 数据来源改造：主窗口把"哪篇笔记的哪一组"写进 `store`（含 `startLine` / `title` 便于校正），
>   窗口那个 webview 读 URL 的 `?pluginWindow=` 认出自己、再读盘解析 ⇒ 不认死索引。
> · **编辑走 `fs.readText` / `writeText`（原子写），不走 `doc.replaceRange`** ——
>   导图窗口里根本没有编辑器；`＋子主题` / `✕删除（连同子树）` 直接改库文件，
>   主窗口与窗口两处**同一套逻辑**。
> · 窗口内容 = 上半静态 SVG 大图 + 下半可编辑节点列表（SVG 里放不了按钮：
>   `html` 节点是静态注入，跑不了脚本）。
>
> **两条实测发现（都写进契约了）**
> 1. **`location: 'sidebar'` 的面板其实渲染在主区**（右侧栏早已取消）—— 文档与实现不一致，
>    插件作者会以为它能与编辑器同屏。已修正 `contract.ts` 的 `PanelLocation` 注释 +
>    契约 §2.2 新增"五种挂载位置的真实承载"表（**只有 `editor-topbar`/`editor-toolbar` 同屏**）。
> 2. **CDP `/json/list` 的顺序 ≠ 窗口创建顺序** —— 按索引挑 target 会挑错（本轮因此把要用的
>    窗口关掉，后面全在对着一个不存在的 webview 断言 ⇒ `evaluate` 超时）。**必须按窗口 label 挑**
>    （`plugin-outline-map-map-0-*`）。这条在 rev50 的窗口验收里也踩过，这次写成脚本里的辅助函数。
>
> **验收**：新脚本 **`tools/verify-outline-map.mjs` → 7/7**
> （插件 v0.2 生效 / **顶部条每组一个按钮且编辑器仍在** / 窗口渲染该组 SVG / **多开** /
> 窗口里「＋」写回磁盘 / 窗口里「✕」删节点连同子树且别的组不动）。真源一律是**磁盘笔记**。
> 截图 `_shots/outline-map-v2-topbar.png`（顶部条 + 笔记仍是大纲）· `_shots/outline-map-v2-window.png`。
>
> **基线**：`tsc -b` 0 · `oxlint` **恰好 4 warnings**（一度 5 —— 验收脚本里留了个没用到的函数，
> oxlint 也扫 `tools/`）· `cargo test --lib` **21 passed**。
>
> **下一步（路线 ⑥ 的收官打磨，按 §5 需求还剩）**：样式切换 · 折叠 · 撤销重做 ·
> 窗口菜单栏（文件/编辑/AI/查看）· 三层配色的视觉细化。
> **内核侧一个可改进点（本轮暴露）**：UINode 的 `row` **没有 `justify`** ⇒ 插件做不出
> 真正的"组标题右上角按钮"（现在只能排在行尾/顶部条）。要不要给 `row` 加 `justify`，等你定。

> ## 📌 rev53（2026-10-13 · 插件窗口补齐三键 ＋ **查清 `close()` 的真相**）
>
> 用户两个问题把这一轮问出来的：
> ① 「最小化最大化和 × 呢？」（插件窗口只有一颗"关闭"文字按钮）
> ② 「`close()` 死锁是什么原因，为什么主窗口不会触发死锁」
>
> **一、三键补齐**：把主窗口 `TitleBar` 里的三键抽成 **`src/components/WindowControls.tsx`**，
> 主窗口与插件窗口**共用同一套按钮**（最小化 / 最大化⇄还原 / 关闭，图标随最大化状态切换）。
> 插件窗口标题条照旧自带拖动区（`data-tauri-drag-region`，双击=最大化由它内置处理）。
>
> **二、`close()` 的真相 —— 不是死锁，是"没人负责关"**（读 `@tauri-apps/api/window.js` + 两个对照实验）
>
> ```js
> async close()   { return invoke('plugin:window|close',   { label }) }   // 只**发事件**
> async destroy() { return invoke('plugin:window|destroy', { label }) }   // 真关（注释原文：
>                                        // close 是 "emitting a closeRequested event"）
> async onCloseRequested(handler) {
>   return this.listen('tauri://close-requested', async (event) => {
>     const evt = new CloseRequestedEvent(event)
>     await handler(evt)
>     if (!evt.isPreventDefault()) await this.destroy()   // ← 真正关窗的是这一行
>   })
> }
> ```
>
> · **`close()` 只发 `tauri://close-requested`，自己不销毁窗口**；真正销毁由**监听器**做。
> · **主窗口为什么能关**：内核 App 里注册了"关窗前落盘"那个 `onCloseRequested`
>   （[App.tsx](<src/App.tsx>) 的 `closingRef` effect）—— 不脏就直接放行 ⇒ API 层 `destroy()` ⇒ 关。
> · **插件窗口当初为什么关不掉**：窗口模式**跳过了**那个拦截器 ⇒ 窗口里**一个 close 监听器都没有**
>   ⇒ 没人调 destroy ⇒ `close()` 返回 ok 但窗口不动。**看起来像死命令，其实只是没人关。**
> · **实验（可复跑）**：
>   E1 无监听器的插件窗口里调 `close()` ⇒ 返回 ok、窗口**仍在**（`_shots` 无关，输出见日志）；
>   E2 注册"不 preventDefault 就 destroy"的监听器后再调 `close()` ⇒ 窗口**正常关闭**。
>   （另：原来记的"`close()` 自身发起会死锁 / 从别的窗口发起会阻塞到超时"是**误判** —— rev50 段已加更正；
>   超时那个现象的真因是：**窗口被销毁时，那次 invoke 的 Promise 永远不会 resolve**，
>   谁 `await` 它谁超时。验收脚本因此改成"发出去就不等"。）
> · **修法**：窗口模式补一个**极简** close 监听器（什么都不做 ⇒ 不 preventDefault ⇒ API 层 destroy），
>   并留一个**可断言标记** `window.__znCloseListener`（注册是异步的，早于它调 close 仍会没人 destroy ——
>   验收脚本等这个标记，不猜时间）。这样**插件作者写 `getCurrentWindow().close()` 也不会踩坑**。
>   内核三键仍直接 `destroy()`（用户点的"关"，不必再走一遍请求）。
>
> **三、顺带修的工具缺陷**：`tools/cdp.mjs` 的 `pickTarget()` 原来只按 `localhost:1420` 做 `includes`
> 匹配 —— 插件窗口 URL 前缀相同 ⇒ 会随机挑到插件窗口，于是"以为在主窗口里执行"其实跑在插件窗口里
> （排查 close 时真踩到）。现在**默认优先不含 `pluginWindow=` 的那个页面**。
>
> **验收**：`tools/verify-plugin-window.mjs` → **14/14**（新增：标题条三颗按钮 / 最大化生效 /
> 再点还原 / **插件窗口里 `close()` 也能关窗** / 卸载插件窗口自动关）；
> `tools/verify-outline-map.mjs` 回归 **7/7**。截图 `_shots/plugin-window-child.png`（右上角 — □ ×）。
> **基线**：`tsc -b` 0 · `oxlint` 恰好 4 warnings · `cargo test --lib` 21 passed。

> ## 📌 rev54（2026-10-13 · **内核新增「行首按钮」能力** ⇒ 按钮改放**标题左侧**）
>
> **用户三条指示**：① 出现问题先查、不猜，**不能把未核实的结论当经验传下去**（→ 已落成
> `~/.dsh/AGENTS.md` **第 5 条硬性前置**，并清掉项目里残留的错误结论，见提交 `089aa33`）
> ② **允许完善内核**（需要就改，不必反复请示）③ 按钮**不放右上角了，放标题左侧**。
>
> **查证（按第 5 条先查一手来源）**：CM6 官方
> [Decoration Example](https://codemirror.net/examples/decoration/) 给出标准做法 ——
> **Widget decoration**（`Decoration.widget({ widget, side: -1 })` + `WidgetType` 子类，
> `ignoreEvent()` 必须返回 false 否则编辑器吃掉点击）；官方示例正是"给某个位置加可点元素"。
>
> **内核新增 `editor.addLineAction`**（契约 §2.6）—— 在**匹配行的左外侧**插一个可点小按钮：
> · `src/kernel/editor-marks.ts`：新增 `LineActionWidget`（WidgetType）、`lineEntries` 登记表、
>   `buildDecorations` 里按"行首偏移"去重后插 widget；装饰集改用 `Decoration.set(ranges, true)`
>   让 CM6 自己排序（原来手写排序 + `RangeSetBuilder` 对零宽 widget 更容易踩"必须严格升序"）；
>   点击路由分两支：`[data-zn-line-action]` → payload `{ line, from }`（行号 0 起），
>   `[data-zn-mark]` → 原样 `{ text, from }`。
> · `contract.ts`：新类型 `EditorLineAction` + `EditorApi.addLineAction` + capability
>   **`editor:line-action`**（`plugin-host.ts` 的允许清单同步）。
> · `styles.css`：`.zn-line-action`（18px 圆角小按钮，低对比、悬停才明显）。
> · **踩坑**：本项目 TS `erasableSyntaxOnly: true` —— 官方示例的
>   `constructor(readonly x: T)`（参数属性）**编译不过**（TS1294），必须写显式字段赋值。
>
> **插件改造**（`examples/outline-map/`）：注册 `pattern: '^#{1,6}\\s'`（`m`）⇒ 每个标题行左侧
> 出现「❖」；新命令 **`outline-map.open-map-at-line`**（payload `{line}` → 按 `block.titleLine`
> 反查组 → 开窗口）；**删掉 `editor-topbar` 那排按钮**（改由标题左侧承担）；`parseBlocks` 补
> `titleLine`。manifest 换 capability、去掉 panels 声明。
> **两条边界（诚实写下来）**：① 正则决定"哪些行有按钮" ⇒ **所有标题行**都有，真正"有没有列表"
> 在**点击时**判断（没有就提示一句）；② 文档开头**没有标题**的裸列表组 `titleLine = -1` ⇒
> 没有按钮，那组仍可用命令面板 `outline-map.open-map` 打开。
>
> **验收**：`tools/verify-outline-map.mjs` → **6/6**（① 插件生效 ② **每个组标题左侧有「❖」**（实测 2 个）
> ③ 点它 ⇒ 该组导图开在独立窗口（含组内文字 + 真 SVG）④ 点第二个 ⇒ 多开 ⑤ 窗口里 `＋` 写回磁盘
> ⑥ 窗口里 `✕` 删节点连同子树）。截图 `_shots/outline-map-v2-titlebtn.png`（标题左侧的 ❖）。
> **基线**：`tsc -b` 0 · `oxlint` 恰好 4 warnings · `cargo test --lib` 21 passed。

> ## 📌 rev55（2026-10-13 · 按钮"无痕融入" ＋ **导图编辑方式定案：改用开源库 Mind Elixir**）
>
> **一、按钮无痕融入**（用户要求：不要边框、与标题垂直中心同一水平线）—— 提交 `d5b4a39`：
> `.zn-line-action` 去掉边框与底色；**尺寸/字号按行字号的 em 给**（H1/H2/H3 各不同，否则同一套
> 对齐参数在不同级别标题下会一偏一正）；对齐**量出来**：`vertical-align: middle` 近似（实测比标题
> 中心低 4px）+ `transform: translateY(-0.34em)` 精确拉回 ⇒ 实测 h1 **-0.3px** / h2 **-0.2px**。
> ⚠️ 踩坑：**`vertical-align` 的长度值是正值上移，`transform` 的负值才是上移**（语义相反，
> 我先写反成 `vertical-align: -0.34em`，按钮反而掉到 +10px）。
>
> **二、导图编辑方式：放弃自画列表，改用开源库**（用户批评「这种编辑方式太难看了…去查有没有开源的
> 思维导图项目，能用就直接用…不要再闭门造车…不要老是直接动手」⇒ 完全接受：那个"列表 + ＋/✕"
> 的编辑 UI 是我自创的，确实难看）。
>
> **调研结果（这一轮只查、没动代码）**：
> | 方案 | 本质 | 编辑能力 | 核实状态 |
> |---|---|---|---|
> | [markmap](https://github.com/markmap/markmap) | Markdown → 交互式导图（折叠/缩放/主题） | ❌ 只读（官方 README 原文 *"Visualize your Markdown as mindmaps"*） | ✅ 已读官方 README |
> | **Mind Elixir** | framework-agnostic 的**可编辑**思维导图核心 | ✅ 增删/拖拽/撤销/主题（有导出 API） | ⚠️ **未核实**（GitHub README 两次 404；只看到官方博客与社区评价） |
> | jsMind / KityMinder | 老牌可编辑导图 | 理论可以 | ⚠️ 未展开 |
>
> **用户裁决：选 Mind Elixir**（要在导图里直接拖节点改结构）。
>
> **下一步（下个会话，第一步是"读"不是"写"）**：
> 1. **先读官方文档与示例**：`docs.mind-elixir.com` + 官方 repo（分支名可能不是 master/main ⇒
>    从官网/包页进，别硬猜 raw URL —— 这轮两次 404 就是猜的代价）。必须确认四件事：
>    ① 编辑 API（增删节点 / 拖拽 / 撤销重做）② **导出 API**（`getData()`？有没有 outline / OPML /
>    markdown 导出）③ 体积与 license ④ ESM/UMD 用法（我们要能塞进插件目录离线跑）。
> 2. **集成路线**（本项目已有能力，不用再改内核）：导图窗口里用 **`view.overrideShell`（U2）**
>    挂真 DOM + 跑库脚本；库**打包进插件目录**（离线优先，不走 CDN）；编辑结果经导出 API →
>    转成 `- 列表` + 缩进 → **`fs.writeText` 写回**（窗口里没有编辑器，`doc.replaceRange` 用不了 ——
>    这条已有先例）。
> 3. **验收**：CDP 驱动（窗口里加节点/拖拽 → **磁盘笔记**为准），沿用 `tools/verify-outline-map.mjs` 的骨架。
>
> **另两件小事待办**：①`HANDOFF-CARD` 的"下一步"段还要把 Mind Elixir 定案写进去（本轮只改了正文）；
> ② `examples/doc-edit-probe/`（U3a/U3b 夹具本体）留还是删 —— junction 已摘（界面已干净），
> 留 = 以后想复验 U3 一挂就能跑；删需同步 4 处文档引用。

> ## 📌 rev56（2026-10-13 · Mind Elixir 四件事核实完毕 ＋ 两件小事收口）
>
> **一、四件事全部核实完**（只剩两条"未实测"，已明确标注）——详见
> **`_research/mind-elixir-定案-2026-10-13.md`**（本轮的交付物，含全部来源）。摘要：
>
> | # | 结论 |
> |---|---|
> | ① 编辑 API | **齐**。`addChild` / `insertSibling` / `insertParent` / `removeNodes(数组)` / `moveNodeIn·Before·After` / `setNodeTopic` / `copyNodes`；**拖动** = option `draggable: true`；**撤销重做** = `install(operationHistory)` 后得 `undo()/redo()/clearHistory()`（option `allowUndo`，键盘 `Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y` **仅当 `editable` 为真**） |
> | ② 导出 API | `getData()` / `getDataString()` / `exportSvg()` / `exportPng()` **有**；**OPML、markdown 文档导出都没有**。但官方 **`plaintextConverter`** = `mindElixirToPlaintext()` ⇄ `plaintextToMindElixir()`，格式就是 `- ` + **每层 2 空格缩进** ⇒ **"转回 - 列表"直接复用，不自写**（7,370 B，**零运行时依赖**） |
> | ③ 体积 / license | **MIT**。v5.15.1 离线三件套 ≈ **112 KB**（iife 92,931 + css 12,441 + converter 7,370）；ESM 版 121,100。**没有 `.min.js`**（jsdelivr 的 entrypoints 是 guessed，指向不存在的文件，别照抄） |
> | ④ ESM / UMD | **v5 两套都有**：ESM `import MindElixir from 'mind-elixir'` ＋ IIFE `dist/MindElixir.iife.js`（全局名 `MindElixir`，**类在 `.default`**）。**v6（next 线）只有 ESM，iife 被删了** |
>
> ⚠️ **两个坑（写代码前必须记住）**：
> ① **`npm i mind-elixir` 会装到 `6.0.0-next.4`** —— 实测 dist-tags `latest = 6.0.0-next.4`
> （beta = next.5、next = next.10）⇒ **必须锁 `mind-elixir@5.15.1`**；
> ② **官方文档有假信息**：`/docs/guides/data-export` 写的 `mind.getDataMd()` 在 5.15.1 产物里
> **0 命中**（本地解包全文搜），属 v4 遗留 —— 又一条"官方文档也会过时，体积/导出名以包内产物为准"。
>
> **二、集成路线确认可行（不用改内核）**：`src/App.tsx:2403-2405` 已有
> `shellTakeover && shellCtx ? <ShellMount …/> : …` 分支，注释明写"**窗口里同样允许接管**——
> 但标题条与关闭按钮保留" ⇒ 导图窗口里 `view.overrideShell({mount})` 挂真 DOM 是**内核已支持**的路。
> 库离线放插件目录（先例 `examples/dep-consumer` / `cdn-import`）；写回走 `fs.writeText`（rev52 先例）。
>
> **三、两件小事收口**：
> ① **卡片已补**：`HANDOFF-CARD.md` 的"下一步"段写进了本定案（原来只在正文）；
> ② **`examples/doc-edit-probe/` 保留**（不删）—— 7 KB 成本，U3 复验一挂 junction 即跑，
> 删反而要同步 4 处文档引用。**纪律照旧：按需挂 junction，不常驻**（常驻会让编辑器底部一直挂那条工具条）。
>
> **本轮未动业务代码**：`npm pack mind-elixir@5.15.1` 只解到 `_tmp-mind-elixir-dl/`
> （过程产物，已被 `.gitignore` 的 `_tmp-*/` 覆盖 ⇒ **不进 git**；丢了重跑一条命令即可）。

> ## 📌 rev57（2026-10-13 · **导图换成真库落地**：窗口里跑 Mind Elixir，拖拽即写回）
>
> 用户 2026-10-13 的批评「不要再闭门造车」在本轮闭环：自算布局 + 静态 SVG + 底下一排 ＋/✕
> 那套"难看"的编辑 UI **退役**，图交给 **Mind Elixir 5.15.1** 画。
>
> **一、库怎么进插件（离线，110 KB）**：`examples/outline-map/vendor/` 放三件套 ——
> `MindElixir.iife.js`(93 KB) + `MindElixir.css`(12 KB) + `PlaintextConverter.js`(7 KB)，全部 MIT。
> 加载方式必须是"运行时自己装配"，因为**插件入口本身跑在 Blob 模块里 ⇒ 相对导入没有 base 目录**
> （契约 §3.2 的硬限制，也是 `manifest.files` 只对 CJS 生效的原因）：
> `fs.readText` 读出 IIFE 源码 → 补一句 `export default MindElixir.default` → 新 Blob → 动态 `import()`。
> **产物级事实（实测，别再猜）**：IIFE 尾部是 `I.default=Ct; I.RIGHT=1; I.THEME=…`（`Ct` 是类）
> ⇒ **类在 `.default`**，常量同级；实例上 `allowUndo` 默认 true，`init()` 里自动装 operationHistory
> ⇒ **`mind.undo()/redo()` 开箱可用**；`draggable` **不是**实例字段（`mind.draggable === undefined`），
> 但节点拖动**照常工作**（拖动时 DOM 里出现 `.mind-elixir-ghost`）—— 「文档里的字段名」不等于「能力存在」。
>
> **二、窗口里怎么画**：`view.overrideShell({ mount })` 接管**窗口内容区**
> （`App.tsx:2403-2405` 早有该分支，标题条与关闭按钮由内核保留 ⇒ 不会把自己锁死）。
> `mount` 是同步的、只调一次，所以先占位再 `rebind()` 异步拉库；顶栏四个按钮
> （撤销/重做/写回/重画）由插件自绘 —— 接管期间内核 UI 不在场，它们就是全部入口。
>
> **三、双向写回（真源 = 磁盘）**：块 → 节点树（**id 用路径** `n0.1`，不用行号）；编辑经
> **400ms 去抖** → `saveBack()`：**先重读盘、再按 startLine/标题重新定位那一组**（导图是异步交互，
> 中间编辑器可能改过同一篇，拿旧行号 splice 会写坏别处；定位不上就抛错，**绝不猜位置**）
> → 生成 `- ` 行（缩进基准保留）→ 整篇 `fs.writeText`。
> ⚠️ **undo/redo 不 fire `operation`** ⇒ 按钮点击与 `Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y`（捕获阶段）
> 都补了一次写回，否则"界面回退了、磁盘还留着"。
>
> **四、验收 `tools/verify-mindmap.mjs` → 8/8**（真源 = 磁盘上的笔记）：
> ① 命令表 ② `__mmWin.lib === '5.15.1'`（真库跑起来了）③ 真 DOM `.map-container` + 5 个 `me-tpc`
> ④ `hasUndo` + 右键菜单中文 11 项 ⑤ `addChild` ⇒ 磁盘多出 `  - 新主题`
> ⑥ 点顶栏「撤销」⇒ 磁盘回到原样 ⑦ **真拖拽**：鼠标把「竞品」从「调研」下拖进「设计」，
> 磁盘实测 `- 调研 / - 用户 / - 设计 / - 竞品`（ghost 出现 ⇒ 拖动被库识别）。
> 截图 `_shots/mindmap-v3-window.png`。
> **基线**：`tsc -b` 0 · `oxlint src` **恰好 4**（`examples/` 另有 313 条历史告警，不在基线内；
> 本轮新增的两个文件单独 lint = 0/0）。
>
> **五、诊断出口（这轮现加，排查靠它们）**：`window.__omMain()`（主窗口：当前笔记 + 分组 + open 命中数）·
> `window.__mmWin`（窗口：库版本/节点数/hasUndo）· `window.__mmMind`（实例本身，CDP 可驱动）。
>
> **六、踩坑（值得记）**：
> ① **夹具同名 ⇒ 静默空转**：`大纲验收.md` 与本次夹具的 H1 都叫「项目计划」，文件树里两项同名，
> 点中的是**已删除**那篇的残留项 ⇒ `openNote` 因 `path === activeRef.current` 直接 return
> ⇒ 没有 `open` 事件 ⇒ 插件一直空转。**教训：夹具标题必须本次独有**；且验收顺序改为
> **先打开笔记、再重扫插件**（重扫时 `doc.active()` 就是这篇，少依赖一条事件）。
> 附：`_tmp-vault-tb\大纲验收.md`（33 B 残留，内容只剩标题）已清掉。
> ② `mind.draggable` 为 undefined **不代表不能拖**（见上）。
> ③ 顶栏「重画」= 丢视图重读盘；**不要**在编辑中自动 refresh，否则用户拖到一半的节点会被重置。
>
> **七、打磨清单的处置** —— ①主题跟随 **rev58 已做**；②③④ 见下（是定了不做，不是漏）。

> ## 📌 rev58（2026-10-13 · **导图跟随宿主主题** ＋ 打磨清单其余三项的处置）
>
> **一、主题跟随（本轮唯一新增功能）**：`znMindTheme(MindElixir)` 把宿主 `--zn-*` 令牌映射进库的 theme。
> **明暗都跟**：`<html data-theme>` 一变，`MutationObserver` 触发 `changeTheme` ⇒ 立即重画，
> **不必重开窗口**（`changeTheme` 只 `refresh()`、**不 fire operation** ⇒ 换主题不会被误当成一次编辑写回）。
>
> ⚠️ **实测坑（第一版做错了，截图抓出来的）**：**分支色 / 节点边框色不走 CSS 变量** ——
> 库在生成每个节点时把 `borderColor` 写死成 `theme.palette[i % len]`，所以只改 `--panel-border-color`
> **一点用都没有**（第一版跑完 10/10，但截图里连线还是库自带的粉紫）。
> 要跟随就必须**整个换掉 palette**：现在用宿主的中性阶梯
> （`--zn-accent` / `--zn-fg-muted` / `--zn-fg-subtle` / `--zn-border-strong` / `--zn-fg`）。
> 前后对比见 `_shots/mindmap-v3-window.png`（粉紫 → 中性灰，与项目"中性灰"审美一致）。
> **教训**：断言"变量相等"不等于"看起来对了" —— **验收要留一张人眼能看的图**。
>
> **二、验收 `tools/verify-mindmap.mjs` → 11/11**（新增 ⑧ `--bgcolor` 跟随 · ⑧c palette 跟随 · ⑧b 切暗色即时生效）。
> **基线**：`tsc -b` 0 · `oxlint src` 恰好 4 · 改动文件单独 lint 0/0。
>
> **三、打磨清单其余三项：定了不做（写明理由，别当漏项）**
> - ② **折叠状态不写回笔记** —— 折叠是**视图状态**，而笔记是纯 markdown 大纲，没地方安放它
>   （塞 HTML 注释会污染源文件）⇒ 关窗即丢，**这是刻意的**。
> - ③ **不做窗口菜单栏** —— 库自带右键菜单（已中文化）＋ 左下/右下工具栏已覆盖缩放 / 居中 / 全屏；
>   rev55 列的"文件 / 编辑 / AI"里 **AI 那项没有真实功能**，做空壳比不做更糟。
> - ④ **与编辑器"未保存手改"的冲突仍在**（v0.2 就写明的边界）：插件写盘可能被稍后的自动保存覆盖
>   （用户手写优先，方向是对的）。**要改必须先定优先级**（谁是真相源、要不要先 flush 编辑器）
>   ⇒ 属于**需要用户拍板**的改动，本轮不动。**这是打磨清单里唯一的开口。**

> ## 📌 rev59（2026-10-13 · 修「窗口模式下接管盖住标题条」—— 用户问的"怎么退出/分屏"根因就是这个）
>
> **触发**：用户质疑 rev58 的"窗口菜单栏不做" ⇒「那我怎么用 windows 的退出和分屏」。
> 追下去发现**不是菜单栏的问题，是一个潜伏的真 bug**。
>
> **一、根因**：`.zn-shell-mount` 是 `position: absolute; inset: 0`，包含块 = **最近的 positioned 祖先**。
> 主窗口那边有 `.zn-shell-host { position: relative }` 兜着；而**窗口模式**（`App.tsx` 的
> `pluginWindowId` 分支）把这个 mount 直接放进 `.zn-plugin-window-body` —— 这一条**没有 `position`**
> ⇒ 包含块一路上溯到**视口** ⇒ 挂载容器铺满整窗（实测 `mount.top=0 / h=1078`，应与 body 一致
> `top=35 / h=1043`），把 35px 的标题条压在同层下面。
> **症状：标题条连同「✕ / 最大化 / 拖动区」全被盖住** ⇒ 看不出怎么关窗，也没法拖到屏幕边缘贴边。
>
> **潜伏期（诚实记）**：这条 CSS 是 **rev51** 写的、窗口分支也是 rev51/53 就有
> ⇒ **bug 从 rev51 潜伏到 rev58**。`verify-shell` 测的是**主窗口**接管，那条路径有 `.zn-shell-host`
> 兜着，所以一直没暴露；**rev57 让 `overrideShell` 第一次跑在窗口模式下，才把它触发出来**。
>
> **修复**：`.zn-plugin-window-body { position: relative }`（一行，长注释写在 `styles.css` 里）。
> 实测确认 `mount.top 0 → 35`、`h 1078 → 1043`；截图 `_shots/shell-titlebar-fixed.png`
> （标题条「导图 · 绪论 outline-map」+ 三键回来了，窗口仍在左半屏）。
>
> **二、"窗口操作怎么用"——用户问题的正面回答（全部有证据）**
>
> | 操作 | 怎么做 | 证据 |
> |---|---|---|
> | 分屏（左 / 右半屏） | **`Win+←` / `Win+→`** | **本轮实测**：插件窗口 ⇒ `x=-7, y=0, 974×1087`（无边框有 7px 阴影偏移，所以不是整 0/960） |
> | 分屏（拖到屏幕边缘） | 拖**内核标题条**（`data-tauri-drag-region`）到边缘 | rev53 已实测（`Win+↑` / 拖边缘同样派发 `onResized`） |
> | 最大化 / 还原 | 双击标题条 · 标题条第 2 颗按钮 · `Win+↑` | rev53 |
> | 关闭**这个**窗口 | 标题条右侧 **✕**（第 3 颗，走 `destroy()`） | 本轮 CDP 实测（标题条 35px、含 3 颗按钮） |
> | 退出**整个应用** | 关**主窗口**（桌面没有"退出"菜单项；只有 Android 返回键会 `exit(0)`，见 `App.tsx:2230-2251`） | 全仓 grep |
> | Win11「悬停最大化按钮弹 Snap Layouts」 | ❌ **不弹** | tao 0.37.1 的 `WM_NCHITTEST`（`event_loop.rs:2128`）只做**边缘 resize**，**从不返回 `HTMAXBUTTON`** ⇒ 系统不知道那是最大化按钮。要补需在内核 Rust 侧子类化窗口过程 + 把自绘按钮的屏幕矩形报上去（社区方案：tao [#994](https://github.com/tauri-apps/tao/issues/994)、[tauri-plugin-snap-layout](https://www.npmjs.com/package/tauri-plugin-snap-layout)） |
>
> **三、教训（写给自己）**：用户质疑一个"定案不做"时，**先查他真正要什么** ——
> 上一条我把"窗口菜单栏"按"菜单项内容有没有用"否掉了（还拿"AI 项没功能"当理由），
> 却没验证**它要解决的问题是否已有出口**。这次一查：出口本来就该有，只是**被一个潜伏 bug 盖住了**。
>
> **四、回归**：`verify-mindmap` **11/11** · `verify-shell` **12/12** · `tsc -b` 0 · `oxlint src` 4
> （改的是 `src/styles.css`，两组验收都必须重跑 —— 都过了）。
>
> **五、顺带查清的两条边界**：`core:window:allow-set-focus` **未授权**（插件窗口不能自己抢焦点；
> 一般不需要，要加属于**权限变更** ⇒ 得先问用户）；主窗口与插件窗口的三键是**同一个组件**
> （`WindowControls.tsx`），外观一致是刻意的。

> ## 📌 rev60（2026-10-13 · 导图窗口**去顶栏**：四个动作进右键菜单 ＋ 状态悬浮左上角）
>
> 用户对着截图给了三条裁决（原话：「撤销写回重做重画，四个操作都放在导图窗口全局右键菜单
> （现在还没有，只有节点的右键菜单），取消绿框画布限制（你自己做的菜单栏），黄框信息做悬浮画布左上角」）：
> ① 四个动作进**画布空白处的右键菜单**；② **撤掉我做的那条顶栏**（它压掉画布高度、还"像菜单栏却没菜单"）；
> ③ 状态信息改**悬浮在画布左上角**。
>
> **一、实现**
> · 顶栏 `.zn-mm-bar` 整条删掉；`el` 只设 `overflow:hidden`，画布铺满内容区。
> · 新增 `[data-zn-mm-menu]`：在**捕获阶段**听 `contextmenu` —— `target.closest('me-tpc')` 为真就
>   **让路**给库自己的节点菜单（已中文化），否则 `preventDefault + stopPropagation` 弹我们这条，
>   含 `撤销(Ctrl+Z) / 重做(Ctrl+Shift+Z) / 写回 / 重画`；在别处 `pointerdown` 即关。
> · 状态改成 `[data-zn-mm-status]`：`position:absolute; left/top:8px; pointer-events:none`，
>   颜色走 `--zn-*` 令牌（浮层也跟着明暗主题变）。
>
> **二、踩到的坑（重要，别重犯）**：给 mind-elixir 的容器设 `position:absolute; inset:0` **没用** ——
> 库的构造函数里有 `S.style.position = 'relative'`，会把它收到的 el 直接改掉；而
> **`relative` + `inset/四边:0` 不是拉伸，只是"偏移 0"** ⇒ 容器塌回内容高度。
> 实测读数：`.map-container` **403** vs 内容区 **665**。修法：**别抢 position**，只给 `width/height:100%`。
> （顺带记：mind-elixir 还会清空 `el.innerHTML` —— 它管这个元素的定位与内容，别再往它身上挂东西。）
>
> **三、验收 `tools/verify-mindmap.mjs` → 15/15**：新增 ⑫ 顶栏已撤 + 画布铺满 · ⑬ 状态是悬浮层 ·
> ⑭ 节点右键仍走库菜单、我的菜单不出现；⑥ 从"点顶栏按钮"改成"**空白右键 → 点菜单项**"。
> 基线 `tsc -b` 0 · `oxlint src` 恰好 4 · 改动文件 0。截图 `_shots/mindmap-v3-window.png`。

> ## 📌 rev61（2026-10-13 · 导图写回**实时回灌编辑器** ＋ 右键「从磁盘重新加载」）
>
> **用户报的**：「现在写回不是实时生效，需要把笔记关了再开才会回传」。
> 根因就是 v0.2 那条写明的边界：插件 `fs.writeText` 直接写盘，而编辑器持有的是**内存文档** ——
> 两条路谁也不知道对方动过。rev61 把它们接上。
>
> **一、实时（自动路径）**：`fs.watch` 回调里，**当前笔记没有未保存修改**时调
> `reloadActiveFromDisk()` ⇒ 重读盘 → `setContent` → `MarkdownEditor` 的 `value` 同步 effect 落到 CM6
> → 再 `fireDoc('open')`，插件（大纲/导图）也跟着重读。
> · 有手改（`dirtyRef`）时**刻意不覆盖** —— 用户正在打字，手写优先（方向由用户 2026-10-13 定）。
> · `text === contentRef.current` 直接返回 ⇒「自己保存触发的 watch」与「watch 的重复派发」都被挡掉。
>   **实测**：一次写盘会派发 **5 次** watch 事件，其中 **4 次被这条挡住**（`__znReloadLog` 原始读数）。
>
> **二、手动（有手改时的出口）**：编辑器右键菜单加「**从磁盘重新加载**」（"笔记"段，挨着"复制笔记路径"）。
> 点了强制以磁盘为准，并 toast 报结果（`已从磁盘重新加载` / `磁盘内容与编辑器一致，无需重载`）。
>
> **三、一个必要的小机关**：外部替换文档会**同步**触发一次 `onEditorChange`（编辑器把外部 value
> 当成变化报上来）⇒ 会白设一次 dirty、800ms 后再把同样内容写回磁盘（幂等但脏：状态栏闪"未保存/已保存"）。
> 所以加 `externalReloadRef`：替换前置真，`onEditorChange` 看到就直接返回。
> ⚠️ **置真只在"内容真的不同"时** —— 否则标记会残留、吞掉用户的下一次真实编辑。
>
> **四、诊断出口**：`window.__znReloadLog`（最近 12 次重载尝试：`reloaded` / `same` / `read-fail`）。
> 「磁盘变了但界面没动」这种静默失效，从界面上看三种原因是**一模一样**的，只能靠读数分开。
>
> **五、验收 `tools/verify-mindmap.mjs` → 18/18**：新增 ⑮ 导图写回后编辑器**不用关开**就跟上 ·
> ⑯ 不经导图、直接改盘也跟上 · ⑰ 编辑器右键有手动出口。
> 基线 `tsc -b` 0 · `oxlint src` 恰好 4（新增的 ref/useCallback 没有加出第 5 条告警）。

> ## 📌 rev62（2026-10-13 · **自动合并**：手改与插件写盘不再互相覆盖）
>
> **用户要的**：上一条我写的边界 ——「你在编辑器里打字、没保存时导图写盘，8 秒后的自动保存会把导图那次改动覆盖掉」
> ⇒ 用户裁决：**做自动合并**。
>
> **一、合并放在「写盘之前」（关键设计）**：`saveNow` **先**读盘比对 `baseRef`，磁盘 ≠ base ⇒ 跑三方合并，
> 写下去的是**合并结果**。**为什么不靠 `fs.watch`**：实测它会迟到好几秒（日志里出现过 6 秒间隔），
> 而自动保存 800ms 就落盘 —— 那一下足以把插件刚写的内容整篇盖掉。watch 只负责"让画面早点跟上"。
>
> **二、三方合并（`src/lib/merge3.ts`，行级 diff3 简化版）**
> · BASE = `baseRef`（**最后一次与磁盘一致**的内容）· MINE = 编辑器内存 · THEIRS = 磁盘。
> · BASE 维护点**只有四处**（漏一个就算错）：`openNote` 读盘成功 / `saveNow` 写盘成功 /
>   `reloadActiveFromDisk` 替换后 / 发现"磁盘与我们完全一样"时对齐。
> · **先裁公共前缀后缀，再跑 LCS**（笔记场景命中率极高）；1000 行两处改动 ≈ 2ms。
> · **冲突 ⇒ 保留 MINE**（用户定的"手写优先"），且**不往正文写 `<<<<<<<`** —— 笔记是给人读的，
>   塞冲突标记只会污染文档；冲突数拿去做 toast 提示。
> · 一个容易搞错的边界：**相邻两行各改各的 → 零冲突**；**一行被合并、另一行被改（行区间相交）→ 才算冲突**。
>   自测里专门用 ⑦（相交）与 ⑦b（相邻）两条对着钉。
>
> **三、两条路径**
> · `fs.watch` + **有手改** ⇒ `mergeIntoEditor()`：把外部改动合进编辑器（仍是脏的，等自动保存落盘）。
> · `saveNow` ⇒ **写盘前合并**，能合就写合并结果；有冲突就 toast 说明保留了你这边。
>
> **四、自测与验收**
> · **`tools/selftest-merge.mjs` → 16/16**（离线、node 直跑 `.ts`：三方相同 / 单边改 / **两边改不同处都保留** /
>   同行冲突保留 mine / 不写冲突标记 / 真交叠 / 相邻不误报 / 尾换行往返 / 1000 行性能）。
> · **`tools/verify-mindmap.mjs` → 19/19**（新增 ⑱ 端到端：编辑器手改 + 外部写盘 ⇒ 磁盘上**两份改动都在**；
>   读数 `__znMergeLog` = `{base:72, mine:79, theirs:81, conflicts:0}`）。
> · 诊断出口：**`window.__znMergeLog`**（与 `__znReloadLog` 对称）。
> · 回归 `verify-shell` 12/12 · `tsc -b` 0 · `oxlint src` 恰好 4。

> ## 📌 rev63（2026-10-13 · Android 出包：APK + 导图插件 → 互联网中转）
>
> **用户要的**：把安卓编译成 APK、**跟导图插件压缩在一起**、通过互联网中转发给他（先提 LocalSend，后改"互联网中转"）。
>
> **一、交付物**（litterbox，72 小时）：一个 zip = **APK 43.5 MB**（4 个 ABI：arm64-v8a / armeabi-v7a / x86 / x86_64）
> + `outline-map-plugin.zip`（55 KB）+ `安装说明.txt`。APK 用 **debug keystore 签名**（zipalign → apksigner，
> 证书 `CN=Android Debug`）。**包名 `com.aqua.zeronote`**（release 无 `.debug` 后缀）⇒ 与手机上现有
> `com.aqua.zeronote.debug` **并存**、首次打开是**空库** ⇒ 说明里写清"**首次选库目录建议选公共存储**"，
> 这样插件能直接放进去（应用私有目录文件管理器进不去 —— 这是 v0.1 就踩过的老坑）。
>
> **二、三个坑（都实测排除后才定论；已另存进长期经验）**
> ① **cargo 的构建脚本在这台机器上不能写 `~/.cargo`**：`tauri-plugin-*` 的 build script 要往
>    `~/.cargo/registry/src/<mirror>/tauri-plugin-*/android/.tauri/tauri-api` 写 Android 桥工程
>    （源码 `tauri-plugin/src/build/mobile.rs` 的 `create_dir_all` + `copy_folder`），报 `os error 5 / 183`。
>    **关键鉴别**：同一个目录 PowerShell 能建能写、cargo 不能；而 cargo **能写项目内的 `target/`**
>    ⇒ 属于**按进程的路径拦截**。ACL / 只读属性 / 目录占用 / 长路径（路径仅 108 字符）/ Defender 受控文件夹访问
>    **都逐一实测排除**（CAF 实测为 0）。
>    **解法**：`robocopy ~/.cargo <可写位置>` 后构建时 `CARGO_HOME` 指过去 —— **不改任何项目文件、原目录一字未动、可回退**。
>    ⚠️ 别用"预建 `.tauri`"的歪招：`copy_folder` 对目标**非幂等**（内部 `create_dir`），预建反而 183。
> ② **自带库模块的 `compileSdk` 不会跟主工程走**：`src-tauri/plugins/tauri-plugin-statusbar/android/build.gradle.kts`
>    停在 **34**，主工程已是 **37** ⇒ gradle `:tauri-plugin-statusbar:checkReleaseAarMetadata` 直接失败
>    （"compiled against android-34 … use a newer compileSdk of at least 36"）。改成 37，并在文件里写明原因。
> ③ 附带教训：**job/管道报 `finished` ≠ cargo 子进程结束** —— "任务完成但构建失败"时先查
>    `Get-Process cargo,rustc`，有残留先杀，否则后续构建会因目录被占报同一类错。
>
> **三、传输通道**
> · 实测 **litterbox 可用**（`litter.catbox.moe`，1 GB / 24h–72h）；`0x0.st` **已停止收上传**
>   （官方原话：被 AI botnet spam 刷爆）；`gofile` 的 servers 接口当时无响应。
> · 顺带写了 `tools/localsend-send.mjs`（LocalSend HTTP API 发送器，流式上传 + 速率）。
>   **本轮没用上**（用户改走互联网中转），留作以后局域网传输用 —— 注意它的硬前提：
>   **接收端必须人工点"接受"**，Android 锁屏 / App 不在前台时那个弹窗根本不出现。
> · 构建用的 cargo home 副本在 **`C:\Users\AQUA\Documents\deepseek\_cargo-home`（1.83 GB，项目外，不进 git）**；
>   **以后在这台机器上构建 Android 都要带 `$env:CARGO_HOME` 指向它**。
>
> **四、基线**：`tsc -b` 0 · `oxlint src` 恰好 4（本轮只改了自带插件的 gradle 配置，未动内核源码）。

> ## 📌 rev64（2026-10-13 · 「库放公共存储」的前置条件：**必须手动授予「所有文件访问」**）
>
> **用户报错**（release APK 装到**另一台**手机、库选在 `/storage/emulated/0/Documents/ZeroNote`）：
> `读取插件文件失败 …/.zn/plugins/outline-map/manifest.json: Permission denied (os error 13)`
>
> **根因**：`src-tauri/gen/android/app/src/main/AndroidManifest.xml` 里**早就声明**了
> `MANAGE_EXTERNAL_STORAGE`（"方案 D：把笔记库放公共存储"的注释就在旁边），但这是
> **Android 的特殊权限，系统不会弹窗申请**，必须用户手动去设置里开。
>
> **实证**（本机 adb，连着的这台）：
> · `com.aqua.zeronote.debug` → `MANAGE_EXTERNAL_STORAGE: allow`（**11 小时前**授的 —— 开发期用
>   `adb shell appops set … allow`，所以**从没走过手动授权这条路**，也就没人发现说明里缺了它）
> · `com.aqua.zeronote`（release）→ **没装在这台上**（用户装在另一台）⇒ 新包必然没授 ⇒ 与报错吻合。
>
> **教训（写进规范）**：凡是"让用户把文件放到公共存储"的方案，**必须把"去设置里开所有文件访问"
> 写进安装说明** —— rev63 的 `安装说明.txt` 只写了"建议选公共存储"，漏了这一步。
>
> **用户侧修法（30 秒）**：设置 → 应用 → ZeroNote → 权限 → **所有文件访问 → 允许** → 回 App 重新扫描插件。
>
> **内核侧待改进（需重新出包）**：**启动时检测该权限**，未授权就明确提示 + 一键跳系统设置页。
> 现在的表现只是"读插件失败"，用户完全不知道该去开权限 —— 又一次**静默失效**（原则 4：
> "静默失效比报错危险"，这次连报错都只说了"Permission denied"，没说是哪个权限、去哪开）。

> ## 📌 rev65（2026-10-13 · 「❖」按钮收紧：**只在真有列表的标题上出现**；顺带调大）
>
> **用户要求**：① 标题旁的导图按钮，**下面没有大纲（`- `）就不算导图**（不显示按钮）；
> ② 按钮**调大一点**。
>
> **一、内核新增：行首按钮的跨行谓词（`EditorLineAction.filter`）**
> 原来 `addLineAction` 只有**单行正则** ⇒ "哪些行该有按钮"只能按行判断，"这个标题下面到底
> 有没有列表"在渲染时无从得知（rev54 契约注释里写明的边界）。现在加了可选
> `filter(ctx: { doc, line, text }) => boolean`：返回 false 的行**不画按钮**，不传则行为与
> 以前完全一样（向后兼容）。`line` 与 `onClick` 的 payload **同口径（0 起）**。
> `src/kernel/contract.ts`（类型 + 边界注释）与 `src/kernel/editor-marks.ts`（在 buildDecorations
> 里、去重之后、插 widget 之前调用）各改一处。
> ⚠️ `docs/内核契约-v0.1.md` **尚未同步**这一条（待办，别当成已完成）。
>
> **二、插件的判据 = 导图自己的解析器**
> `filter` 直接复用 `parseBlocks`（块 = 标题 + 到下一个**同级或更高级**标题为止；列表标记
> `-` `*` `+` `1.` `1)` 都算）⇒ **"有按钮"与"能开出导图"永远同真同假**，不会出现
> "有按钮但点开是空的"。两处配套：
> · pattern 同时收**标题行与列表行**（否则"文档开头那组没有标题的裸列表"没有候选行）；
> · `parseBlocks` 结果按**文本**缓存 —— filter 会被逐行问，不缓存则一篇 500 行的笔记要整篇解析 500 次。
>
> **三、裸列表组**（用户 2026-10-13 追加）：入口挂在**它自己的第一行**（`block.startLine`），
> 那种组没有标题行可挂。
> ⚠️ **这条没有进自动验收**（夹具里放裸列表组会改变组序号，连带影响②③等既有断言）——
> 代码路径清楚，但**待人工确认**。
>
> **四、按钮调大**（用户 2026-10-13）：字号 `0.52em → 0.68em`、热区 `0.8em → 1em`。
> ⚠️ 尺寸与字号是按**行字号的 em** 给的，而 `vertical-align: middle` 的偏差取决于**行内盒高度**
> ⇒ 改尺寸**必须重测对齐**，不能照旧数字按比例猜。CDP 实测（按钮 cy − 标题文字 cy）：
> **H1 −0.3px / H2 −0.2px / H3 −0.2px**（量法见 `_tmp-btn/measure.mjs`，临时工具不入库）。
> 踩坑记录：量文字不能用 `line.childNodes`（CM6 把行文本包在 span 里 ⇒ 找不到文本节点），
> 也不能直接用 TreeWalker 的第一个文本节点（那是**按钮自己的 ❖**，量出来必然≈0）。
>
> **五、验收**：`tools/verify-mindmap.mjs` **19/20**。
> · 新增 **⑲ 通过**：`withBtn = [导图验收项目, 另一组, 只有一项的组]`，而夹具里那行
>   「空章节（下面故意不放列表）」**没有按钮** ✓（夹具同时加了「只有一项的组」作回归保护：
>   只一项也算有列表）。
> · **⑮ ⑯ 的"偶发失败"已定论并修好 —— 不是产品缺陷**：
>   两条断言都拿**固定 `sleep`** 等异步事件（⑮ 等 2s、⑯ 等 2.5s），而 `fs.watch` 的延迟实测
>   **2–6 秒不稳定** ⇒ 谁先谁后随机挂（第一轮挂 ⑮，把 ⑮ 改成轮询后**就轮到 ⑯ 挂**）。
>   铁证：⑯ 失败那次的 `reloadLog` 里**事件明明已经到了**（`{why:"reloaded"}`），只是晚于写死的 2500ms。
>   改法：两条都改成 `waitFor` 轮询（出现即通过，最多 12 秒）⇒ **最终 20/20 全绿**。
>   **规矩（已写进脚本注释）**：凡"等异步事件"的断言一律轮询，别写死时间。
>   顺带审了脚本里其余 20 处 `sleep`：后面要么是**读磁盘**（写入同步完成），要么套了 `waitFor`
>   兜底 ⇒ 无同类隐患。
>
> **六、顺带排掉的坑：Android 构建产物把桌面 dev 拖进重建循环**
> `dev.cmd` 的 watcher 盯整个 `src-tauri`，而 `tauri android dev` 会在
> `plugins/*/android/.tauri/` 生成 tauri-api 工程与 gradle 中间产物 ⇒ **反复触发桌面 dev 重建**
> （日志刷 `changed. Rebuilding application...`，窗口起不来、CDP 9222 也不开，看着像"dev 坏了"）。
> 处置：删掉那两处 `.tauri` + 新增 `src-tauri/.taurignore`（忽略 `plugins/*/android/.tauri/`、`target/`）。
> ⚠️ **归因存疑**：两件事同时做，**无法单独归因**是哪个起作用。Tauri 确有 `.taurignore` 机制
> （[screenpipe 的提交](https://github.com/screenpipe/screenpipe/commit/f01bf9caa8682f65dd1229413d8b0d42675776fc)、
> [tauri#11150](https://github.com/tauri-apps/tauri/issues/11150) 为证），但本地 `tauri-cli` 是
> 预编译二进制、grep 不到源码 ⇒ **语法未经一手核实**，别当定论传下去。
>
> **五、仍然存在的取舍（诚实记）**：冲突时**总是 mine 赢** —— 没有"让用户挑一边"的 UI。
> 导图改的那一行若正巧被用户也改了，那处保留用户版本（toast 会报几处）。真需要逐处选择，
> 得再做一份冲突列表 + 选用 UI，属另一个量级的活。
>
> **六、顺手修掉验收脚本的两处脆弱（都与本轮功能无关，但一直被它藏着）**
> `tools/verify-shell.mjs` 的 `runCommand`：
> ① 用**裸 `input`** 选元素 —— 主区停在「插件管理」时页面上有**三个 checkbox** 排在命令面板输入框前面，
>    搜索词会打进空气（改按 `placeholder^="输入命令名"` 精确定位）；
> ② 查询词「整窗接管」**不唯一**（shell-demo 两条命令的标题都含它），而命令面板排序是
>    「分数相同则**最近用过的靠前**」⇒ 之前跑过 `release` 就把它顶到第一位，`Enter` 执行的是
>    **空操作**（`handle === null` 直接 return），症状是"接管容器等不到"、**单独跑却可能过**。
>    ⇒ 改用**完整命令 id**（`shell-demo.takeover`）。
> 修完 `verify-shell` 回到 **12/12**。⚠️ 教训：**验收脚本里"用文案点东西"必须先确认文案唯一**，
> 否则脚本自己的状态（recent 顺序、页面上有几个 input）会变成隐藏变量。
> 基线未被触碰（`tsc -b` / `oxlint` / `cargo test` 本轮未跑，因为没有代码改动）。

> ## 📌 rev66（2026-10-13 · **权限门遗留整体清掉**：`permissions.json` 与两条命令从仓库消失）
>
> **用户裁决**：问「四个未决项第一点（`permissions.json` 是否整体下线）」⇒ 用户原话「**清掉**」。
>
> **背景（为什么它是死代码）**：rev48 拆权限门后，前端四个导入、`isGranted` 接线、写文件的
> `toggleNetwork()` 全删；但 Rust 侧 `read_permissions` / `set_permission` 仍**注册在
> `invoke_handler`**、仍能写盘，两个单测也仍在跑 —— 而**没有任何代码读它做判定**。
>
> **本轮删掉的东西（纯减法）**
> · 前端：`src/kernel/permissions.ts` **整文件删除**（46 行；当时已无任何 `import`）
> · Rust：`GRANTABLE` 常量 · `permissions_path` · `read_permissions_file` ·
>   `read_permissions` · `set_permission` · `invoke_handler` 里那两行
> · 单测：`permission_grant_and_revoke_roundtrip` · `broken_permission_file_fails_closed`
> · 三处墓碑注释改写为"已整体删除"（`App.tsx:35` · `plugin-host.ts:103` · `lib.rs:918`），
>   并在原位置留一段"曾经是什么 / 为什么删"的说明（不留白，免得下一个人考古）
> · `plugin-host.ts` 顶部设计要点里那句"声明了未授权的 capability → 拒绝加载"**也是过时的**，
>   一并改成"capability 只做自述校验，未知取值只警告"
>
> **基线变化（有意，已实测）**：`cargo test --lib` **21 → 19 passed**（少的正是那两个用例）；
> `tsc -b` **0 错误** · `oxlint src` **恰好 4 warnings**（未变）。
> ⚠️ 跑 `pnpm exec oxlint`（不带目录）会得到 **318 warnings** —— 那是把 `examples/` / `tools/`
> 一起扫了，**验收基线一直是 `oxlint src`**。
>
> **未动**：磁盘上可能存在的旧 `<库>/.zn/permissions.json` **不清理**（没人读，留着无害；
> 实测真实用户库里本来就没有，只有 `_tmp-test` 里单测夹具残留两个）。
> 回退：git 历史里原版俱在（本轮提交前的 HEAD = `8bbc0d6`）。
>
> **下一步**（本轮末尾向用户列出的剩余三条未决）：Android `content://` 打开文件 · 手机触屏
> 多选/长按/返回键 · 沙箱（已裁决搁置）与 `examples/raw-ipc-probe/` 去留。

> ## 📌 rev67（2026-10-13 · **触屏三件真机测清**：长按可用 · 多选无入口 · 返回键早已接管 ＋ 抓到菜单层缺口）
>
> **起因**：用户裁决 —— ①「**手机不需要双击打开**」（⇒ `content://` 那条未决**作废**）；
> ②「触屏三件**先测清楚汇报**」；③「**沙箱不做**，只做"卡死直接闪退 + 自动关掉卡死插件，重进就好"」。
> 本轮**只实测 + 记文档，未改任何产品代码**（基线不变：`tsc` 0 · `oxlint src` 4 · `cargo test --lib` 19 passed）。
>
> **测试方法（可复跑，比"目测截图"硬）**：手机 WebView 的 devtools **在打包版里也开着** ⇒
> `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>` ＋
> `ZN_CDP=http://127.0.0.1:9223 node tools/cdp.mjs …` 直连手机页面：
> ① `eval` 注入事件探针（捕获阶段听 `contextmenu` / `touchstart` / `touchend` / `pointer*`）
> ② `adb shell input swipe x y x y 1200` 发**真实触摸**（原地长按 —— `input tap` 在 WebView 里不可靠）
> ③ `eval` 读 DOM 真状态（`is-picked` / `is-active` / 元素 rect）
> **坐标换算：物理 = CSS × dpr(3.125)**（视口 391×868 → 屏幕 1220×2712）。
> ⚠️ 手机跑的是**打包版**（`http://tauri.localhost/`）—— 改前端必须重新出包才生效。
>
> **① 长按 → 右键菜单：✅ 可用，无需改动。**
> 探针实测顺序：`pointerdown` ＋ `touchstart`（t=119631）→ **387 ms 后 `contextmenu`**（t=120018，
> 坐标 `149,295` 与按下点一致）→ 1.2 s 时 `pointercancel`。
> ⚠️ **长按全程没有 `touchend` / `pointerup`，只有 `pointercancel`** —— 将来做"长按进多选"时不能等 `touchend`。
> 视觉证据：真实长按弹出了完整菜单（新建文件 / 新建文件夹 / 剪切 / 复制 / 创建副本 / 重命名 / 删除），
> 截图 `_shots/touch-07-longpress.png`。与 Chromium 的 *Convert context menu callback to long press* 一致。
>
> **② 多选：功能完好，但手机上没有任何入口。**
> · 代码：`FileTree.tsx:241` `onClick={(e) => onPick(node.path, { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey })}`
>   ＋ `is-picked` 样式 ＋ 「删除选中的 N 项」批量菜单（`FileTree.tsx:511-524`）
> · **正控**：CDP 派发 `new MouseEvent("click",{ctrlKey:true})` 点两条 ⇒ `is-picked = 2`（多选真在工作）
> · **负控**：真实触屏单击 = **打开笔记**（文件树随即卸载，`items: 0`）；真实长按 = 普通菜单（**菜单里没有「多选」**）
>   ⇒ `is-picked` 恒为 0
> ⇒ **不是功能缺失，是移动端缺入口**（触屏没有 Ctrl/Shift）。补入口属新产品决策（长按进选择模式 /
> 菜单加一项「多选」），**未实施**。
>
> **③ 返回键接管：⚠️ 早已实现 —— 本文档此前把它记成"待真机复验"，记错了。**
> `App.tsx:2190-2251` 用 `onBackButtonPress`（`@tauri-apps/api/app`，since **2.9.0**）注册 handler；
> 该 API 的语义是**注册即完全接管默认行为**（不注册时 Tauri 走
> `canGoBack() ? goBack() : activity.onBackPressed()` ⇒ 直接 finish 整个应用）。
> 层级链（自上而下逐层关）：**设置 → 搜索 → 快速切换 → 命令面板 → 非编辑器视图 → 侧栏 → 当前笔记 →
> 都没得关才 `exit(0)`**。
> 真机三场景实测：编辑器内按一次 = **关笔记**（软键盘随之收起）· 抽屉打开时 = **关抽屉**（进程存活）·
> 列表空态 = **退出应用**（设计如此）。
>
> **④ 🆕 抓到一个真缺口：菜单打开时按返回键 → 应用直接退出，且菜单没关。**
> 实测：`menuOpen = 1` → `input keyevent 4` → 进程消失、`mCurrentFocus` 变 MIUI Launcher、CDP `fetch failed`。
> 根因：`backRef` 那条链里**没有右键菜单这一层** —— 菜单开合状态由 `ContextMenu` 自持、不在 App，
> 于是"都没得关"被判成立 ⇒ `exit(0)`。
> **修法建议**（未实施，成本小）：把菜单 open 状态提到 App（或让 `ContextMenu` 向 App 注册一个"关我"回调），
> 在链里**排在设置之前**最先关。同一根因也覆盖文件树右键菜单与 `☰` 菜单。
>
> **证据**：`_shots/touch-00-now.png … touch-12-back-drawer.png`（12 张，从小屏 391×868 的 CSS 视口
> 与物理截图两侧取证）。上面每条结论都能按"测试方法"复跑。

> ## 📌 rev68（2026-10-13 · 触屏三件的落地：**长按进多选** ＋ **菜单层缺口补掉**）
>
> **用户裁决三件**：① 把 rev67 那条"长按没有 touchend"的坑说明白；② 安卓多选**做成长按进选择列表**；
> ③ **把菜单层那个缺口补上**。
>
> ### ① 那条坑：为什么长按之后没有 up 事件（一手来源）
>
> | 场景 | 实测事件序列（真机，捕获阶段探针） |
> |---|---|
> | 普通点击（☰） | `pointerdown → touchstart → pointerup → touchend → click`（完整） |
> | **长按**（树项 1.2 s） | `pointerdown → touchstart → contextmenu(+429 ms) → pointercancel(+1203 ms) → touchcancel` —— **没有 up / end，也没有 click** |
>
> **机制**：`contextmenu` 一发出，就表示**浏览器接管了这次手势**（原生长按菜单）。按 Pointer Events 规范，
> UA 判定"该 pointer 不会再产生事件"时**必须**发 `pointercancel`（Touch Events 规范对应 `touchcancel`）；
> 手指抬起时自然就没有 `pointerup`/`touchend`，也不会补 `click`。
> **实践后果（这条坑真正会咬人的地方）**：
> ① 任何"等 `touchend`/`pointerup` 收尾"的长按实现会**永远等不到**，临时状态再也复位不了 ——
> 所以长按的入口应当就是 `contextmenu` 本身，别自己用 `setTimeout` 判长按；
> ② 反过来也有好处：长按**不会**顺带触发 `click` ⇒ 不必额外防"长按后又把笔记打开了"；
> ③ 收尾清理要挂在 `pointercancel` / `touchcancel` 上。
>
> ### ② 安卓多选：长按一行 → 进「选择模式」
>
> 实现落在 `src/components/FileTree.tsx`（**只动前端，Rust 一行未改**）：
> · **进入**：文件条目的 `onContextMenu` 里判 `(e.nativeEvent as PointerEvent).pointerType === 'touch'`
>   ⇒ 调 `enterSelect(path)`（进多选 + 选中该行 + 关掉可能开着的菜单）。
>   **鼠标右键仍是 `pointerType === 'mouse'` ⇒ 照旧弹右键菜单**，桌面行为零变化。
>   目录条目**不进多选**（多选集合本来就只含文件，与既有 `flatPaths` 口径一致）。
> · **选择模式内**：点一行 = 加/减选（`pick()` 顶部短路），**不打开笔记** —— 否则一开编辑器抽屉就收起来，
>   多选根本做不下去。
> · **多选条**（树顶 sticky，新样式 `.zn-select-bar`）：`✕` 退出 · 「已选 N 项」· 剪切 · 复制 · 删除。
>   删除走既有 `deletePaths`（现多了一步 `setSelectMode(false)`：删完若还留着"已选 0 项"，看着像没删掉）。
> · 退出途径两条：`✕` / Android 返回键（见 ③）。
>
> ### ③ 缺口补掉：给"自持浮层"加一个**层出口栈**
>
> 原缺口（rev67 ④）：菜单状态由 `ContextMenu` 自持、不在 App，所以 `backRef` 那条链判成"都没得关"
> ⇒ 菜单开着按返回键会 `exit(0)`（应用退出而菜单还开着）。
>
> 改法（`src/App.tsx`）：新增 `layerExitsRef: Array<() => boolean>` —— **打开一层就压入它的关闭函数，
> 关闭时弹出**；`backRef` 的**第一步**就是"有层就关层"。用栈而不是逐个 `if` 的理由：这些层的状态不在 App 里，
> 逐个提升 state 会把一个组件的交互拆到两处；栈还自动保证**后开的先关**。
> 接入点：App 的三个菜单（☰ / 库 / 主区·侧栏右键）＋ `FileTree` 的右键菜单与多选（通过新 prop `layers`）。
>
> **新增两个只读诊断出口**（与 `__znKernelAudit` / `__znReloadLog` 同一套路，生产留着无害）：
> `window.__znBackPress()`（跑一次返回键逻辑，返回是否被吃掉）· `window.__znBackLayers()`（当前层数）。
> 这让**桌面**也能复跑返回键的层级顺序 —— 返回值只在 Android 上由 `onBackButtonPress` 触发。
>
> ### 验收（桌面 CDP 实测读数，`_shots/ms-01/02-*.png`）
>
> | # | 动作 | 读数 |
> |---|---|---|
> | V1 | 文件条目派发 `contextmenu`（`pointerType: touch`） | `selBar=true · picked=1 · layers=1` ✅ |
> | V2 | 再点第二个文件 | `picked=2`，且 `openDoc=false`（**没打开笔记**）✅ |
> | V3 | 再点已选的第一项 | `picked=1`（减选）✅ |
> | V4 | ☰ 菜单打开后读状态 | `menu=1 · layers=1` ← 这就是原来会 `exit(0)` 的状态 |
> | V5 | `__znBackPress()`（菜单开着） | 返回 `true` · `menu=0 · layers=0` ✅ **缺口修好** |
> | V6 | 多选模式下 `__znBackPress()` | 返回 `true` · `selBar=false · picked=0` ⇒ **退多选而不是退应用** ✅ |
> | V7 | 多选条点「复制」 | 执行并退出多选（`selBar=false · layers=0`）✅ |
> | V8 | 回归：普通点击文件 | `openDoc=true`（桌面打开笔记不受影响）✅ |
>
> ⚠️ **读层数要注意时序**：`__znBackPress()` 与 `__znBackLayers()` 若在**同一次调用链里紧挨着**读，
> 会看到 React 还没跑 effect cleanup 的旧值（读到 1）；隔一次渲染（或 `wait 900`）即为 0 —— 不是残留 bug。
>
> ### 真机验收（Android dev 版，连桌面 1420，ARIA 24069RA21C；**真实触摸 + 真实返回键**）
>
> | # | 动作 | 读数 |
> |---|---|---|
> | R1 | 长按文件「1」1.2 s | `selBar=true · picked=1 · 已选 1 项` ✅ 进多选 |
> | R2 | 点 test-from-pc | `picked=1` · `openDoc=false`（**没打开笔记**）✅ |
> | R3 | 再点 新笔记#1 | `picked=2 · 已选 2 项` ✅ |
> | R4 | **按返回键**（多选模式中） | `selBar=false · picked=0`，**进程存活** ✅ 退多选而非退应用 |
> | R5 | 打开 ☰ 菜单 → 读状态 | `menu=1 · layers=1` |
> | R6 | **按返回键**（菜单开着） | `menu=0 · layers=0`，**进程存活** ✅ **缺口修复的真机判定** |
>
> ⚠️ **测试时踩的两个坑（记下来，别重踩）**：
> ① **多选条一出现，整棵树下移 ≈43 CSS px** —— 拿"进入多选前"读到的坐标去点第二项，会点回原项
>   （读数反而变成"已选 0 项"）。**每次进入/退出多选后必须重读坐标**。
> ② **抽屉关着、又没有任何浮层时按返回键 = `exit(0)`（设计如此）** —— 我一时多按了一次返回键，
>   把应用退了一次，差点误判成"缺口没修"。测"某一层"之前**先确认那一层真的开着**（读 `menu=1`），
>   别在同一条脚本里顺手多按一次。
>
> **基线**：`tsc -b` **0 错误** · `oxlint src` **恰好 4 warnings**（未新增）· `cargo test --lib` 本轮未跑
> （**Rust 一行未改**）。证据：`_shots/ms-01…ms-08*.png`（桌面与真机两侧）。

> ## 📌 rev69（2026-10-13 · **卡死兜底方案出卡** —— 只出卡，未实施，零代码改动）
>
> 用户裁决「**沙箱不做**，只做：卡死直接闪退 + 自动关闭卡死插件 + 重进就解决」⇒ 出实施卡
> **`docs/卡死兜底方案-2026-10-13.md`**（本轮**没改任何产品代码**，基线未动）。
>
> 卡里已定的三段：
> · **A 心跳 + 原生看门狗**：前端 1 s 心跳（**仅页面可见时**发）；Rust 独立线程每 1 s 检查，
>   超时默认 **5 s** ⇒ 判定卡死。**为什么必须原生侧**：插件是进程内 JS，`while(true)` 占死的是
>   WebView 主线程 ⇒ **前端自己的任何定时器都不执行**，"前端检测自己卡死"逻辑上不成立。
> · **B 闪退**：`std::process::exit(101)` —— **不用 `app.exit()`**（Tauri 的退出可能依赖主线程，而主线程已死）。
> · **C 启动自愈**：`loadPlugin(id)` **之前**写 `localStorage['zn.plugin.loading']`，加载走完 / 正常关窗时清除；
>   启动扫插件前若发现残留 ⇒ 该插件**自动禁用** + 插件页明确标记「因上次加载未完成已自动禁用」
>   + 一键恢复 + toast/日志（**不许静默失效**）。
>
> **一手核实（差点记错的一处）**：读本地 `tauri-2.12.3/src/app.rs` 确认 ——
> `WindowEvent::Suspended` / `Resumed` 是 **`#[cfg(mobile)]`**（注释：Android 由 Activity 的
> `onPause` / `onResume` 触发；**Linux/macOS/Windows 不支持**），而
> ⚠️ **`RunEvent::Resumed` 是"事件循环被恢复"，不是移动端回到前台** —— 别拿它判前后台。
> 生态先例：Tolaria 的前端就绪看门狗 ADR 用 `sessionStorage` 做**有界一次性恢复**（明确拒绝无限循环），
> 与 C 段同源（链接见卡 §2.3）。
>
> **实施前必须先跑三个探针**（目前都只有推理、**未实测**，卡 §6 给了不成立时的替代路径）：
> ① 主线程卡死时前端定时器**确实停** ② Rust **非主线程** `std::process::exit` 真能终止进程（桌面+Android）
> ③ 卡死时 `localStorage` 同步写**已落盘**、重启读得到。
>
> **待用户拍板 4 点**（卡 §9）：阈值 5 s 是否可接受 · 要不要另写 `库/.zn/watchdog.log` ·
> 自动禁用后除插件页+toast 要不要再加状态栏常驻提示 · **dev 默认关**（`dev.cmd`/`android-dev.cmd` 设
> `ZN_WATCHDOG=off`，另留 `ZN_WATCHDOG_DRYRUN=1` 可只观察不杀）。
> **估时约一天**（不含出包）；验收判据 7 条含"切后台 60 s 不被误杀"（卡 §7）。
> ✅ **rev70 已实施**（见下）。

> ## 📌 rev70（2026-10-13 · **卡死兜底落地**：原生看门狗 ＋ 闪退 ＋ 启动自愈 —— 7 条判据全过）
>
> **用户裁决**：「直接开工，先测桌面端，安卓暂时无法连接」＋ 卡 §9 四点按建议来
>（阈值 5 s · 写 `库/.zn/watchdog.log` · 不加状态栏常驻提示 · dev 默认关）。
>
> ### 一、三个前置探针：**全过**（一次卡死实验验完）
>
> 夹具 `examples/hang-plugin`（`apply()` 里先同步写 `localStorage` 再 `for(;;){}`）：
>
> | 探针 | 结果 |
> |---|---|
> | **P1** 主线程被占死时前端定时器**确实停** | ✅ 日志：`前端无响应 5675ms（阈值 5000ms）`（5 s 阈值 + ~1 s tick，吻合） |
> | **P2** Rust **非主线程** `std::process::exit` 能终止进程 | ✅ `exit code: 101`（Rust 与 cargo 两处日志都确认） |
> | **P3** 卡死时 `localStorage` 同步写**已落盘**、重启读得到 | ✅ 重启后读到 `{"id":"hang-plugin","mode":"hang","t":…}` |
>
> ### 二、实现（A/B/C 三段）
>
> · **A 看门狗**（`src-tauri/src/lib.rs`）：`LAST_BEAT`/`BEAT_PAUSED`/`BEAT_VAULT` 三个静态 +
>   独立线程每 1 s 用**唯一判据** `watchdog_should_fire(last, now, timeout, paused)` 判超时。
>   判据抽成纯函数 ⇒ 可单测（`cargo test` 19 → **20**）。
> · **B 闪退**：`std::process::exit(101)`；退出前先往 `<库>/.zn/watchdog.log` 留痕（Rust 写，卡死时前端已执行不了）。
> · **C 启动自愈**（`src/App.tsx`）：`zeronote.plugins.loading` 标记三段式 ——
>   加载前写 / 加载走完（`finally`）清 / **启动时模块级 `bootSelfHeal()` 消费** ⇒
>   并入禁用集合并落盘 + toast + 插件页红色徽章（`PluginPanel` 新增 `autoDisabledNote`）。
>   ⚠️ 为什么放**模块级**：`toast` 的 `useState` 在 `disabled` 之前，组件里跑没法同时喂两个初值。
> · **诊断出口**：`zn_watchdog_status`（`paused`/`lastBeatAgoMs`/`timeoutMs`/`vault`）—— 验收取数用，不靠猜。
> · **开关**：`ZN_WATCHDOG=off` · `ZN_WATCHDOG_DRYRUN=1`（只留痕不退出）· `ZN_WATCHDOG_TIMEOUT_MS`。
>   `dev.cmd` 与 `android-dev.cmd` **已按卡 §4 设 `ZN_WATCHDOG=off`**（改完验过换行仍是 CRLF）。
>
> ### 三、验收（桌面，7 条判据）
>
> | # | 判据 | 实测 |
> |---|---|---|
> | 1 | 卡死 ⇒ ≤ 超时+2 s 退出、码 101 | ✅ reload 20:16:18 → 20:16:24 判定（5756 ms）→ `EXIT=101` |
> | 2 | 重启后自动禁用 + **可见** | ✅ `disabled:["hang-plugin"]` · 插件页显示「**因上次加载未完成已自动禁用**」· toast 抓到原文 · `watchdog.log` 有行 |
> | 3 | 重新启用 ⇒ 再卡死 ⇒ **再**自动禁用（幂等） | ✅ 12:19:11 再次判定 exit 101；重启后 `disabled` 又含它 + toast 再出 |
> | 4 | 误判防护：最小化不误杀 | ✅ 最小化 20 s 存活；实测 **`paused` 仍为 false、心跳没停**（见下"意外发现"） |
> | 5 | 正常使用不误杀 | ⚠️ **未跑满 10 分钟**（时间成本）—— 期间心跳稳定、判据 4/6 已覆盖两个大风险场景 |
> | 6 | 正常关窗不留残标（不误判） | ✅ 构造"加载 net-demo 途中关窗"：重启后 `loading:null` 且 `disabled` **没有** net-demo |
> | 7 | 基线 | ✅ `tsc` 0 · `oxlint src` 恰好 4 · `cargo test --lib` **20 passed** |
>
> ### 四、实测中的两个"意外发现"（比预想更好 / 更坏各一）
>
> 1. ⚠️ **dev 下连续编辑会被误判**：12:13:34/37/40 三次 `vite hmr update` 叠出 >5.5 s 空窗 ⇒
>    看门狗杀了一次进程（`EXIT=101`）。**这正是卡 §3 表第 3 行预判的场景**，处置就是
>    「dev 默认关」—— 已落地，本条反过来证明那条设计是必需的。
> 2. ✅ **桌面最小化不冻结 JS**：实测最小化期间 `paused:false`、`lastBeatAgoMs` 持续 200–600 ms
>    ⇒ 心跳没停、天然不会误判。所以前端那层 `visibilitychange` 暂停在**桌面用不上**，
>    保留它是为**移动端切后台**（WebView 被系统真暂停）—— 那条**未验**（见下）。
>
> ### 五、顺带修的缺口
>
> 项目里点 ✕ 走的是 `getCurrentWindow().destroy()`（`WindowControls` 的 onClose）⇒
> **不触发** `onCloseRequested`。所以"加载途中关窗"只有 `pagehide` 会跑到 ——
> rev70 在 `pagehide` 处理器里补了清标记（原本只在 close 监听器里清）。
>
> ### 六、未验项（诚实标注）
>
> - **Android 全部未验**：设备当时连不上（用户：「安卓暂时无法连接」）。要在手机上验的是
>   ⓐ 前后台暂停（`WindowEvent::Suspended`/`Resumed` —— 读源码确认是 `#[cfg(mobile)]`，
>   Android 由 `onPause`/`onResume` 触发，**但本轮没写这条接线**：现在只有前端 `visibilitychange`，
>   ⓑ 判据 4/5 的移动版）。⇒ **移动端要看这条，得先补 `RunEvent::WindowEvent` 分支再真机验。**
> - 判据 5 的 10 分钟长跑。
>
> **基线**：`tsc` 0 · `oxlint src` 4 · `cargo test --lib` **20 passed**。
> 证据：`_shots/wd-01-pluginpage.png`（插件页红色徽章）· `.zn/watchdog.log` · dev 日志的 `EXIT=101` 行。
> 夹具 `examples/hang-plugin/` **保留**（按需挂 junction，**别常驻测试库**）。

> ## 📌 rev71（2026-10-13 · 卡死兜底**补上移动端接线** ＋ **真机端到端验证全通**）
>
> **缘起**：rev70 明确留了一条未验项 —— 移动端前后台没接线（只有前端 `visibilitychange`），
> 且 Android 侧整条链没验。用户：「补上」（当时手机已恢复连接）。
>
> ### 一、接线（`src-tauri/src/lib.rs` 的 `.run(...)`）
>
> ```rust
> #[cfg(mobile)]
> tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::Suspended, .. } => { BEAT_PAUSED = true; }
> #[cfg(mobile)]
> tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::Resumed, .. } => { LAST_BEAT = now; BEAT_PAUSED = false; }
> ```
>
> **两个必须记住的点**：
> 1. ⚠️ **不能**用 `RunEvent::Resumed` 判"回到前台" —— 那是"事件循环被恢复"（跨平台语义）。
>    移动端前后台只能用 `WindowEvent::{Suspended, Resumed}`：源码注释写明 Android 由 Activity 的
>    `onPause` / `onResume` 触发，且两者都是 `#[cfg(mobile)]`（桌面没有这两个变体）。
> 2. ⚠️ 原来那两处是各自独立的 `if let ... = _event`；`RunEvent` 不是 `Copy`，
>    **加第二处会撞 "use of moved value"** ⇒ 本轮把整段改成一个 `match _event`（顺带更清楚）。
>
> **另外把 dev 开关改成可覆盖**：`if not defined ZN_WATCHDOG set "ZN_WATCHDOG=off"`（`dev.cmd` / `android-dev.cmd`）。
> ⚠️ 想覆盖成"开"必须 `set ZN_WATCHDOG=on` —— **`set ZN_WATCHDOG=`（空）在 cmd 里是删除变量**，
> 等于没覆盖，会被 `if not defined` 判成"没设过"又设回 off（这条我第一版写错了，已修正注释）。
>
> ### 二、真机验收（ARIA 24069RA21C · Android 16 · dev 版连桌面 1420 · `ZN_WATCHDOG=on` 覆盖）
>
> | # | 项 | 实测 |
> |---|---|---|
> | 1 | 手机上心跳跑起来 | `{"disabled":false,"lastBeatAgoMs":519→762,"paused":false,"vault":"/storage/emulated/0/Documents/ZeroNote"}` ✅ |
> | 2 | **判据 4 移动版**：切后台不被误杀 | 按 HOME ⇒ logcat `应用切后台 ⇒ 暂停计时` + 读数 **`paused:true`**；后台保持 **55 秒**后 `pidof` **仍在** ✅ |
> | 3 | 回前台恢复计时 | logcat `回到前台 ⇒ 恢复计时` + `paused:false` ✅ |
> | 4 | **端到端卡死**（推夹具进库 → reload 触发加载） | 回前台后 logcat `前端无响应 5353ms` ⇒ **`pidof` 空 ⇒ 进程真被杀** ✅ ⇒ **移动端的 P2（非主线程 `exit(101)`）也成立** |
> | 5 | 手机上启动自愈 | 新进程起来后 `disabled:["hang-plugin"]`、`loading:null`、心跳正常 ✅ |
> | 6 | 基线 | `tsc` 0 · `oxlint src` 4 · `cargo test --lib` **20 passed** ✅ |
>
> ### 三、一个值得记的行为（不是 bug）
>
> 这次卡死**恰好发生在后台**（我在应用处于后台时 reload 了页面）：`paused=true` 压住了判定，
> 直到**回到前台**才判（20:40:18 恢复 → 20:40:26 判定）。这是**正确**的 ——
> 后台期间不判是防误杀的前提；而"真卡死"最终仍会被处理（用户一回前台，约 5 秒内应用重启）。
> ⇒ 结论：**后台卡死的应用会在用户回到前台后 ~5 秒内自动重启**，符合"重进就好"的预期。
>
> ### 四、现场已清
>
> 手机库里的夹具已逐文件删除（`rm` + `rmdir`，没用 `-r`）、`localStorage` 的禁用记录与探针标记已清空
> （`disabled: []`）。⚠️ 手机当前仍装 **dev 版**（依赖桌面 dev，见卡片「环境现状」）。
>
> **基线**：`tsc` 0 · `oxlint src` 4 · `cargo test --lib` **20 passed**。
> 备注：`ZN_WATCHDOG_DRYRUN=1` 仍是"只留痕不退出"的观察档，真机排查误判时用它。

> ## 📌 rev72（2026-10-13 · **文档格式阅读器**：只读 PDF / EPUB / … 插件落地）
>
> **用户原话**：「下一步做**文档格式兼容插件**，兼容 pdf、epub 等多种格式，**不需要编辑，只需要能阅读就行**」
> ＋「**不提供最近文件功能，只需要能打开查看就行了**」。
> 两个选型由用户拍板：**渲染资产放应用内置** · **EPUB 用 foliate-js 多格式通吃**。
> **设计与实测全集见 `docs/文档阅读器-调研-2026-10-13.md`** —— 本文只留结论、判据与未验项。
>
> ### 一、交付物
>
> | 落点 | 内容 |
> |---|---|
> | **插件** | `examples/doc-reader/`（`index.js` 约 330 行 + manifest）—— 只读，`command.bind('core.openDocument')` 接管 |
> | **渲染资产** | `public/vendor/pdfjs/`（**pdf.js 6.4.299 的 legacy build**，Apache-2.0；含 cmaps/字体/wasm ⇒ 共 **5.39 MB**）· `public/vendor/foliate/`（foliate-js **1.0.1**，MIT，约 290 KB） |
> | **内核改动** | `lib.rs`（`NoteMeta.kind` + `collect()` 放开只读文档）· `contract.ts`（类型）· `index-api.ts`（只索引笔记）· `App.tsx`（`core.openDocument` 默认实现 + 文件树分派 + 状态栏分列）· `FileTree.tsx`（文档类型徽章）· `tauri.conf.json`（asset scope 加 `requireLiteralLeadingDot:false`）· `.gitattributes`（新加 5 条二进制规则） |
> | **夹具** | `examples/asset-probe/`（asset 协议能力探针，可复跑）· 测试库 `probe.pdf`（449 B 最小 PDF）与 `测试书籍.epub`（2.5 KB 自建 EPUB，带脚本探针） |
>
> ### 二、桌面判据（全过）
>
> | # | 判据 | 实测 |
> |---|---|---|
> | 1 | 文件树**看得见**文档 | ✅ 树里出现 `测试书籍.epub` / `probe.pdf`（文档带灰色类型徽章），状态栏分成「**5 篇 · 2 文档**」 |
> | 2 | 点文档即开（派发生效） | ✅ `window.__znKernelAudit().commands` 里 `core.openDocument.impl === 'plugin:doc-reader'` |
> | 3 | **PDF 真渲染** | ✅ 接管 + canvas，顶栏「`第 1 / 1 页 · 100%`」；截图 `_shots/docreader-01-pdf.png`（页面上是 `ZeroNote PDF probe`） |
> | 4 | **EPUB 真渲染 + 保留书籍排版** | ✅ `<foliate-view>` 建出、meta「`第一章 春江 · 0%`」、**书籍自带 CSS 生效**（标题蓝、段落缩进 2em、连续滚动）；截图 `docreader-02-epub.png` |
> | 5 | **EPUB 章节脚本不执行**（安全） | ✅ 测试书里埋的 `<script>parent.__epubScriptRan=true</script>` ⇒ 实测 **`undefined`**（未执行）；截图 `docreader-03-epub-sandbox.png` |
> | 6 | 基线 | ✅ `tsc -b` 0 错误 · `oxlint src` 恰好 **4** warnings · `cargo test --lib` **20 passed** |
> | 7 | 生产构建带上资产 | ✅ `pnpm build` 成功（5.37s）· `dist/vendor` **217 文件 / 5.53 MB**（asset 走 `public/` ⇒ 随 vite 进 dist） |
> | 8 | **反复接管 / 释放**（PDF → EPUB → PDF → 释放） | ✅ 连续三次接管无「已有接管者」冲突；每次 `Esc` 后内核 UI 完整回来（文件树 14 项） |
> | 9 | TXT 直显 | ✅ 点 `说明.txt` → 「78 字符」；正文走 `textContent`（`<b>` **原样显示**，不解析 HTML） |
>
> ⚠️ **本轮踩坑（写下来，下次构建 Android 必踩）**：直接跑 `pnpm tauri android build` 时**没人设
> `CARGO_TARGET_DIR`**，产物会落进工作区内的 `src-tauri\target\` ⇒ 编 C 依赖（`vswhom-sys`）
> 必报 **MSVC `D8050`（"未能将命令行放入调试记录中"）**。**这不是 MSVC 环境问题**，就是本文件
> 「技术事实」里那条老铁律。正确姿势（= `android-dev.cmd` 的等价环境）：
> `$env:CARGO_HOME="C:\Users\AQUA\Documents\deepseek\_cargo-home"` ＋
> `$env:CARGO_TARGET_DIR="C:\Users\AQUA\cargo-targets\zeronote"` 之后再跑 `pnpm tauri android build --apk --debug --target aarch64`。
> 代价：两次失败构建在 `src-tauri\target` 里堆了 **8.6 GB** 垃圾（已清理）。
>
> ### 三、顺带查清 / 纠正的四条（都有一手来源，别再重查）
>
> 1. **Android 上 asset 协议读"点开头的目录"会 403** —— 桌面同一条路 200。
>    根因：`tauri-2.12.3/src/scope/fs.rs:215-225` 的 `require_literal_leading_dot` **unix 默认 true、windows 默认 false**，
>    glob `**` 因此不匹配 `.zn` 这类路径段。**修法**：`assetProtocol.scope` 改成对象形式显式写 `false`（schema 有该字段）。
>    ⚠️ **该修复未在真机复验**（编译期嵌入，要重出二进制）—— 见"未验项"。
> 2. **旧结论作废**：tauri issue **#11371**（fetch/XHR 丢 `content-range`，原文点名影响 pdf.js 分段加载）
>    在本仓 tauri **2.12.3** 上**已不复现** —— 实测 Range 返回 `206` 且 `content-range: bytes 0-9/449` 齐全。
> 3. **CSP 一个字都不用改**：`new Worker(blobURL)` 实测 **ok**。机制（MDN `worker-src`）：`worker-src` 缺失时
>    回退链是 `child-src → **script-src** → default-src`，而 `script-src` 含 `blob:`
>    （⚠️ 我原先推断"只回退到 default-src"是**错的**）。
> 4. ⚠️ **dev 与生产 CSP 不一致（重要）**：`data:`/`blob:` iframe 里的内联脚本，**生产**会被 Tauri 注入的
>    `sha256` 拦掉（`'unsafe-inline'` 被抵消）、**dev 下会照常执行**（实测 `scriptRan: true`）。
>    ⇒ **不能把"脚本不执行"寄托在 CSP 上**。所以我们对 foliate 源码做了两处可用改动（见 §四）。
>
> ### 四、对第三方源码的改动（两处，原处都有 `⚠️ ZeroNote 改动` 注释）
>
> | 文件 | 改动 | 理由 |
> |---|---|---|
> | `foliate/fixed-layout.js:1` | 删掉 `import 'construct-style-sheets-polyfill'` | **裸模块名在浏览器里无法解析**；两端都原生支持 `adoptedStyleSheets` |
> | `foliate/paginator.js:234` · `foliate/fixed-layout.js:90` | `sandbox` **去掉 `allow-scripts`** | 不让 EPUB 自带脚本执行（依据见 §三.4）；`allow-same-origin` 保留 ⇒ 分页仍能读 `contentDocument` |
>
> 两个库的 LICENSE 随资产一起复制（pdf.js 的 Apache-2.0 + wasm 各组件的 `LICENSE_*`；foliate 的 MIT）。
>
> ### 五、Android 真机（ARIA 24069RA21C · Android 16 · WebView **Chrome 143**）
>
> 构建（子 agent 执行）：`CARGO_HOME=…\_cargo-home` ＋ `CARGO_TARGET_DIR=C:\Users\AQUA\cargo-targets\zeronote`
> ＋ `pnpm tauri android build --apk --debug --target aarch64` → **409 s** · APK **278.3 MB** ·
> `adb install -r` **Success** · 应用起在前台、无崩溃。
>
> | # | 判据 | 实测 |
> |---|---|---|
> | 1 | 文件树显示文档（真机） | ✅ 抽屉里 `probe` **.pdf** / `测试书籍` **.epub**（带类型徽章）· 状态栏「**9 篇 · 2 文档**」 |
> | 2 | **点开 PDF 并渲染** | ✅ 顶栏「第 1 / 1 页 · 100%」，页面渲染出 `ZeroNote PDF probe`（`_shots/android-docreader-05-pdf.png`） |
> | 3 | **点开 EPUB 并渲染** | ✅ 章节标题 + 中文段落，**书籍 CSS 生效**（`_shots/android-docreader-06-epub.png`） |
> | 4 | asset 点目录 403 **已修复** | ✅ `.zn/plugins/…/probe.pdf` 从 **403** 变 **200** + `application/pdf` + Range `206` |
> | 5 | 自动探针四项（无需点击） | ✅ asset ✓ · PDF `300x200` / `nonWhite 1610` · EPUB 标题 + 2 章节 + 782 字 · **脚本 `null`** |
>
> **真机点击怎么点（实测有效，HANDOFF 旧结论要补）**：`adb shell input tap` 在 WebView 里无效、
> 原地 `swipe x y x y 120` 这次也无效，**`adb shell input motionevent DOWN x y` + `UP x y` 有效**
> （中间隔 ~120 ms）。截图是**物理像素**（本机 1220×2712），可直接当坐标用。
>
> ### 六、真机暴露的两个真问题（桌面测不出来 —— 这就是必须上真机的理由）
>
> 1. ⚠️ **pdf.js 的 modern build 在 Android WebView 上渲染必炸**：
>    `TypeError: this[#da].getOrInsertComputed is not a function` —— 真机 WebView 是 **Chrome 143**、
>    桌面 WebView2 是 **154**，而 `Map.prototype.getOrInsertComputed` 是很新的 TC39 提案。
>    换 **legacy build**（只大 12%）后**仍不够**：实测 legacy 只做语法转译、**不带这个 polyfill**
>    （能解析出 1 页，然后仍倒在渲染那一步）⇒ 插件里补了 **3 行 `ensureMapApis()`**，桌面 + 真机双端复测通过。
> 2. ⚠️ **vite dev server 启动时就把 `public/` 的文件列表定死**：启动后**新增**的路径一律落进
>    SPA fallback —— 实测 `/vendor/pdfjs/legacy/pdf.min.mjs` → `200` 但 `content-type: text/html`、
>    **981 字节的 index.html**（诊断方法：拿两个 URL 对账 content-type 与长度，一眼就分清）。
>    ⇒ dev 下新增 public 文件**要么重启 vite、要么放回既有目录名**；我们选后者
>    （`public/vendor/pdfjs/build/` 里放的就是 **legacy** 那份，注释写明了）。
>    **生产构建全量复制 `public/`，没有这个问题。**
>
> ### 七、未验 / 未做（诚实清单）
>
> - **性能**：大 PDF（几十 MB）与 EPUB 分页未压测（pdf.js 官方 FAQ 提到一页 HiDPI canvas 约 14 MB）。
> - **`wasm/`（jbig2 / openjpeg）** 未单独验：简单 PDF 用不到，参数已按官方传（`wasmUrl`）。
> - **`content://`（Android SAF）** 仍读不了（历史结论，与本插件无关）。
> - **不做**（用户明确）：最近文件 / 书签 / 阅读进度 / 缩略图 / 目录侧栏。
>
> **提交**：`578ccd2` · **基线**：`tsc -b` 0 错误 · `oxlint src` 恰好 **4** warnings · `cargo test --lib` **20 passed**。
> 开工前的内核快照 `_kernel-snapshots/20261013-224056`；功能完成后另落一个（回退用）。
> 证据截图：`_shots/docreader-01-pdf.png`（桌面 PDF）· `docreader-02-epub.png`（桌面 EPUB）·
> `docreader-04-txt.png`（TXT）· `docreader-07-epub-final.png`（桌面最终版）·
> `android-docreader-04-vault.png`（真机文件树里带徽章的文档）· `android-docreader-05-pdf.png`（真机 PDF）·
> `android-docreader-06-epub.png`（真机 EPUB）。

> ## 📌 rev73（2026-10-13 · 文件树：只读文档收进「文档」分组）
>
> 用户要求：「侧栏文件列表里面，把 pdf、epub 等其他格式文件都收纳在一个目录下」。
>
> **做法（内核零改动，全在 `src/components/FileTree.tsx`）**
>
> - `buildTree` 把 `kind === 'doc'` 的条目从各自目录**抽出来**，挂到一个**虚拟分组节点**
>   「文档 N」（`virtual: true`，哨兵路径 `__zn_docs__`，**固定排在树末尾** —— 笔记优先）
> - 虚拟节点**只支持折叠/展开**：右键不弹菜单（它不对应磁盘目录，任何文件操作都会打到假路径）
> - ⚠️ **文件一动不动**：路径不变、仍在原目录；真实位置仍由每行的 `title`（悬停）交代
> - 顺带修一个既有 bug：**重命名只在"没有扩展名"时才补 `.md`** —— 否则 PDF 会被改成 `手册.pdf.md`
>   （此前树里只有 `.md`，这条分支命不中非 md；文档进树后才暴露）
>
> **验收**（桌面 CDP，全部实测）
>
> | 判据 | 实测 |
> |---|---|
> | 树结构 | 笔记在前、末尾「**文档 3**」分组（`测试书籍.epub` / `说明.txt` / `probe.pdf`，各带类型徽章） |
> | 折叠 / 展开 | 折叠 16 → **13** 项，再展开回 **16** ✓ |
> | 分组里的文档仍能读 | 点 PDF → `第 1 / 1 页 · 100%` + canvas ✓ |
> | **右键行为** | 虚拟组：DOM 节点数 101 → **101**（**无菜单**）· 文档项：101 → **128**（**有菜单**）✓ |
> | 基线 | `tsc -b` 0 错误 · `oxlint src` 恰好 **4** warnings |
>
> **提交**：`7f65004`。
>
> ⚠️ **同轮更正一条记录**：手机装的是 **`tauri android build` 出的打包版**（前端是构建那一刻的 `dist` 快照）
> ⇒ **改 `src/**` 不会 HMR 到手机**，必须重出包。我当天一度在卡片里写成「dev 版、改前端即时生效」——
> 那是 rev71 时的状态，**已更正**。两条判据：① 改完 `FileTree.tsx` 后手机截图**纹丝不动**
> （sha256 与旧图完全一致）；② 主机 `netstat` 里**没有手机 IP 连 1420**。

> ## 📌 rev74（2026-10-13 · 删除：逻辑删除 ＋ 物理删除，阅读器与文件树都有，支持多选）
>
> 用户要求：「阅读插件应该提供右键两个删除功能，逻辑删除和物理删除」＋「允许多选」。
>
> ### 一、两个删除的语义（由内核既有边界决定）
>
> | | 怎么做 | 可恢复 |
> |---|---|---|
> | **逻辑删除** | `fs.delete(path)` → 移入 `.zn/trash/`（内核既有） | ✅ 回收站里能恢复 |
> | **物理删除** | **两步**：`fs.delete` → `listTrash` 按 `originalPath` 找回 id → `fs.purgeTrash(id)` | ❌ 不可撤销 |
>
> ⚠️ **为什么必须两步**：内核**没有**"直接抹掉库内文件"的命令；而 `delete` 的返回值
> （`.zn/trash/<stamp>/<名>`，**带斜杠**）**不能**当 `purgeTrash` 的 id —— 后者明确拒绝带斜杠的 id
> （`src-tauri/src/lib.rs:561`）。也不能用 `emptyTrash`（那会把**用户之前删的**一并清掉）。
> 中途失败就停在"已在回收站"，文件仍能找回 ⇒ 不丢数据。
>
> ### 二、入口
>
> | 位置 | 入口 | 多选 |
> |---|---|---|
> | **阅读器内**（插件 `overrideShell` 自绘） | 顶栏**「删除」**按钮 ＋ **右键** | ❌ 接管期间没有列表可多选 |
> | **文件树**（内核） | 右键菜单「彻底删除…」 | ✅ 多选时显示「彻底删除选中的 N 项…」 |
> | 手机多选条 | 「彻底删除」按钮（触屏唯一的批量入口） | ✅ |
>
> 物理删除一律**二次确认**（自绘浮层：「不经过回收站，**永久抹掉** —— 撤不回来」）；
> 逻辑删除沿用既有的「撤销条」。**未点确认时文件不动**（实测过）。
>
> ### 三、真机暴露的三处问题（桌面全测不出来，本轮全修）
>
> 1. ⚠️ **插件语法错误：CSS 注释里写了反引号**，而它在**模板字符串内** ⇒ 提前结束字符串 ⇒
>    **插件加载失败** ⇒ `core.openDocument` 退回默认实现 ⇒ 症状是"点文档没反应"。
>    **教训**：`tsc` 与 `oxlint` **都不覆盖 `examples/` 里的插件 JS**（只查 `src/`）。
>    补一条检查（已实测可用）：
>    `node --input-type=module -e "import('file:///…/index.js').then(()=>console.log('OK')).catch(e=>console.log(e.constructor.name))"`
>    —— **`SyntaxError` 才是语法问题**；报别的（如 `ReferenceError: location is not defined`）说明语法 OK。
> 2. ⚠️ **顶栏元素太多 ⇒ 手机上「⋮」被挤出屏幕、标题被压没** ⇒ 按钮收到 `min-height:30px`、
>    删除入口**前置到关闭键之后**、手机上**隐藏缩放键**（`mctx.platform === 'android'`）。
> 3. ⚠️ **符号按钮（`⋮`）真机点不中** ⇒ 改**文字按钮「删除」**（也更好懂）。
>    ⚠️ 附带一条坐标教训：`screencap` 是物理像素没错，但**顶栏按钮只有 ~30px 高** ——
>    估算偏差 ~30px 就完全错开（前 3 次点击都落在状态栏那一行）。**小目标要按截图逐像素核对**。
>
> ### 四、验收
>
> | 端 | 判据 |
> |---|---|
> | 桌面（CDP） | 逻辑删除：文件树消失 + 磁盘已移走 + toast 正确 · 物理删除：回收站**无残留** · **多选 2 项批量**：文件树/磁盘/回收站全清 · **未确认时不删** |
> | Android 真机 | 打开 PDF → 点「删除」→ 菜单两项 → 「彻底删除…」→ 确认框 → 确认 ⇒ 库根文件消失 **且回收站无残留**（`adb ls` 核对） |
> | 基线 | `tsc -b` 0 错误 · `oxlint src` 恰好 **4** warnings |
>
> **提交**：`374f05b`（删除功能）· `64024a1`（真机三处修复）。

> ## 📌 rev81（2026-10-14 · Android「关闭插件窗口」定型：不重载 · 放接管 · 清 URL；＋**更正 rev80 一处误判**）
>
> **用户报的活**：rev80 留的那条待修 —— 手机上点插件窗口的 ✕ 之后行为不对
> （rev80 临时改成 `location.replace` 回主界面）。
>
> **落成三件事（同一个 `onClose` 的 Android 分支；桌面一字未动，仍走 `destroy()`）**
> 1. **`winClosed` state** —— 关窗口只"不画那个面板"，**不重载** ⇒ 库 / 编辑器 / 插件全不用重建。
> 2. **`kernel.clearShell()`** —— ⚠️ 只翻 state 不够（实测挖出来的）：窗口里插件常把整窗接管
>    （导图就是），而那本账记在**内核**里、不随窗口 UI 消失 ⇒ 点 ✕ 后屏幕仍是导图，
>    得再点一次右下角「释放接管」。
> 3. **`history.replaceState` 清掉 URL 上的 `pluginWindow`** —— 否则 `pluginWindowId` 还挂在 URL 上，
>    **任何整页重载都会让关掉的窗口复活**（实测：改一行 `src/**` 触发 HMR 后，屏幕又变回那个导图窗口）。
>
> **验收（真机 `33b676f6` / Redmi Turbo 3，dev 版 HMR）**
>
> | 证据 | 读数 |
> |---|---|
> | `_shots/rev81-29-window2.png` | 窗口正常打开：标题条「导图 · 中心主题 / outline-map」＋三键＋ Mind Elixir 导图（6 节点） |
> | `_shots/rev81-30-after-close.png` | 点 ✕ ⇒ **直接**回主界面（「选一篇开始」＋底栏 **11 篇 · 2 文档**），**不需要**再点「释放接管」 |
> | `_shots/rev81-12-after-close.png`（对照） | 旧版（只翻 state）：点 ✕ 后屏幕**仍是导图** |
> | 基线 | `tsc -b` **0** · `oxlint src` 恰好 **4** · `cargo test --lib` **21 passed**（本轮未动 Rust） |
>
> ### ⚠️ 更正 rev80 的一条结论：那个「0 篇」不是"退回默认库"
>
> rev80 写「`location.replace` 整页重载 ⇒ 退回**默认库**（应用私有 vault）⇒ 0 篇」。**归因错了。**
>
> 本轮实测（全部是读数，不是推断）：
> · 「笔记库」面板显示「**默认库 · 当前** `/storage/emulated/0/Documents/ZeroNote`」⇒ **库一直是对的**；
> · 那个目录 `ls` 有 **12 个 .md**，而文件树空、状态栏 **0 篇**、**没有任何报错**；
> · `appops get … MANAGE_EXTERNAL_STORAGE` = **allow**（8 分 54 秒前设置；`rejectTime` = 3 天 5 小时前）
>   ⇒ 之前处于 **deny**；
> · `am force-stop` ＋ 重启应用（**没改一行代码、没动库路径**）⇒ 立刻显示「**11 篇 · 2 文档**」。
>
> ⇒ 真根因是**存储权限**：Android 11+ 在没有 MANAGE_EXTERNAL_STORAGE 时，对非 media 文件
> **不报错、也不列出** —— 于是 `list_notes` 返回空数组，界面显示成"这个库还没有笔记"；
> **与"重载 / 默认库"无关**（重载只是把这件事暴露在用户眼前的那一下）。
> 📌 顺带查到：应用里其实有一条 `core.requestStoragePermission`（命令面板搜 `open` 能看到，
> 标题「请求「所有文件访问」权限（Android）」）—— rev64 说"没做引导"，这条命令的来龙去脉**下次先查**。
> ⚠️ **未核实**：「deny 时不报错也不列出」这条机制目前是**推断**，还没落到一手来源
> （Android 官方文档 / AOSP 源码）。按 §5「下技术定论前先查一手来源」，**下次接手先查再传**。
>
> ### 🔧 顺手：`android-dev.cmd` 补 `CARGO_HOME`
>
> 按 rev63 的硬要求补一行 `set "CARGO_HOME=%USERPROFILE%\Documents\deepseek\_cargo-home"`
> （原文件只有 `CARGO_TARGET_DIR`）。
> ⚠️ **对当时正在跑的那个进程无效**（它已按 `~/.cargo` 起来了）—— 下次启动才生效。
> 文件保持 **CRLF**（22 行 / 无 BOM，脚本头部就写着 "CRLF required"）。
>
> ### 🔁 折叠：把自造的状态机换成 CM6 官方 `codeFolding`（用户当场点的方向）
>
> **用户原话**：「前端应该有很多现成可用的 UI 吧？没有必要什么都自己造，插件引入一些依赖不就行了」。
> 先做了一手来源核实 —— 结论**一半支持他、一半不支持**，都留下：
>
> | 查到的一手事实 | 出处 |
> |---|---|
> | `@codemirror/language@6.13.1` **早就在依赖树里**（随 `@atomic-editor/editor` 装上），导出 `foldService` · `codeFolding` · `foldedRanges` · `foldEffect`/`unfoldEffect` · `foldCode`/`unfoldCode`/`foldAll` · `foldKeymap` · `foldGutter` | `.pnpm/@codemirror+language@6.13.1/…/dist/index.d.ts` |
> | 而 atomic-editor **完全没用**那些（它 dist 里搜不到名字）⇒ rev80 我们手写了一套等价物（StateField + 折叠集合 + `refresh()`） | 同包 `dist/*.js` |
> | `@codemirror/lang-markdown` **自带两种折叠**：标题整节（`headerIndent` 的 foldService）＋ 代码块 / 引用 / 表格（`foldNodeProp`） | 该包 `dist/index.js` |
> | ⚠️ 但**列表折叠上游明说不做**：`foldNodeProp.add(type => !type.is("Block") \|\| … \|\| isList(type) ? undefined : …)` | 同上（源码原句） |
>
> ⇒ **能换掉的是状态机，换不掉的是折点**（上游留的空白）。
> 而"圆点外观"那一层：它是**编辑器文档里的行内元素**（CM6 widget decoration），不在 React 组件树里
> ⇒ MUI / Ant / shadcn 都够不到，引组件库只会换来 React root + 体积；那层"现成"的形态本来就是一条 CSS。
> 另有一条硬约束：**插件不可能自己 import `@codemirror/language`**（CM6 扩展必须同一实例，
> 而插件是库内独立 ESM、没有 node_modules）⇒ 官方 API 只能由内核装、插件经契约参与。
>
> **改法**（对外尽量不动：`addFold` 还在，只是实现换了）
> · **删**：`buildFoldBlocks` ＋ `foldBlockField`（自造 StateField）＋ `refreshEffect` ＋ `editor.refresh()`
> · **装**：`codeFolding({ placeholderDOM: 空 span })`（空 = **不留 `…`**，与 rev80 视觉一致）
>   ＋ `foldService.of(...)`（把插件的 `foldEndAt` 接进去）
> · **契约**：`isFolded`（每次都被问）→ **`initialFolded`**（只在挂载 / `restoreFolds()` 时问）
>   ＋ **`onToggle`**（折叠态变了通知插件写盘）；`refresh()` → **`restoreFolds()`**；
>   `addLineClass.classAt` 新增 **`folded`** 字段（内核算好给你，插件不再维护镜像）
> · **新增方法**：`toggleFold(line)` · `foldAt(line)`；插件点击 → `editor.toggleFold(line)`
>
> **不只是"少写代码"**：折叠范围的**位置随编辑自动 map**（我们原来是"行文本签名 + 同文本第几次出现"，
> 代码注释里就写着它的局限）；`foldedRanges` 是官方 StateField ⇒ 不存在"插件记的状态与编辑器显示不一致"。
> ⚠️ **代价**：官方 `codeFolding()` 自带 `foldKeymap`（`Ctrl-Alt-[` / `Ctrl-Alt-]` / `Ctrl-Alt-Shift-[` …）
> ⇒ **本应用新增了几个折叠键位**（原来没有）。
>
> **验收（读数，不是目测）**
> · 桌面 CDP（`_tmp-vault-tb` ＋ 临时写的 `outline-demo.md`）：点圆点 ⇒
>   `__omFolds().folded = ["- 一级 A#0"]`、`kernelFolded = [3,2]`、`foldedClass = ["❖•一级 A"]`、
>   可见行 **8 → 6**（子行被官方块替换藏掉，折点处是**空 placeholder** ⇒ 没有 `…`）；
>   再点 ⇒ 全部复位，`.zn/outline-folded.json` 写回 `[]`
> · **手机真机**（`33b676f6`，走 `adb forward` 的 CDP）：**跨会话恢复**生效 ——
>   盘上留着 rev80 时代记的 `- 二级 A1#0`，新架构读回来并折起（`kernelFolded=[3]`）；
>   点「一级 A」⇒ 两处折叠并存并写盘；再点 ⇒ 回到只剩「二级 A1」
> · 截图 `_shots/rev81-38-phone-folded.png`（手机：子行收起、无 `…`、**圆托与圆点同心**）
> · 基线：`tsc -b` **0** · `oxlint src` 恰好 **4** · `cargo test --lib` **21 passed**（未动 Rust）
>
> ### 📱 两条副产品
> 1. **Android 上其实有多窗口**：手机 CDP 的 target 列表有 **3 个 page** ——
>    主窗口（`tauri.localhost/`）＋ 两个 `?vault=/storage/emulated/0/Documents/ZeroNote`，
>    后两个正是"已经关掉"的插件窗口 webview ⇒ `openWindow` 在 Android 上**真的**建了独立 webview
>    （所以 `destroy()` 没用、rev81 的 `clearShell()` 才有意义）；
>    **顺带验证了 URL 清理**：那两个页面 URL 里**已经没有 `pluginWindow`**。
>    ⇒ 待办：Android 关窗目前等于"留一个常驻 webview"，真销毁路径 Tauri Android 还没提供。
> 2. **手机接上 CDP 了**（以后手机断言不必再截图猜）：
>    `adb shell cat /proc/net/unix | grep devtools` 拿 socket 名 →
>    `adb forward tcp:9333 localabstract:webview_devtools_remote_<app pid>` →
>    `ZN_CDP=http://127.0.0.1:9333 ZN_TARGET=tauri.localhost node tools/cdp.mjs …`
>
> ### ⚠️ 未实测 / 新发现（如实记，别当已完成）
> 1. ✅ **「整页重载后窗口不复活」（`replaceState` 的效果）后来实测到了**：装 `@codemirror/language` 时
>    vite 自己打了 `optimized dependencies changed. reloading` —— 一次真正的**整页重载**；
>    桌面的页面与手机的页面重载后都**回到主界面**、没有复活插件窗口
>    （手机 CDP 的 target 列表也印证：那些"关掉的窗口"URL 里已无 `pluginWindow`）。
> 2. 🐞 **新发现（待查）**：**同一次会话里第二次打开同一篇笔记时 `❖` 按钮不显示**（首次打开正常）；
>    重启应用后首次打开又正常 ⇒ 与"是否刚启动"相关，**不是**权限、**不是**插件没加载
>    （同一屏里折叠圆托正常）。插件里**本来就有**诊断出口 `__omFilterSeen` / `__omButtons()`，
>    其注释（`examples/outline-map/index.js:1230`）记的正是同一现象（"说有 2 个入口，屏幕上却只画了 1 个"）
>    ⇒ **下次接 CDP 直接读它们，别再用截图猜**。
> 3. 手机上 `input tap` 依然无效、`input swipe x y x y 120` 有效（rev71 结论今天再次复现）；
>    `input motionevent DOWN/UP` 本机**没**触发点击（rev80 记过它可用 —— 以后以 `swipe` 为准）。
>
> ### 🔁 续（同日 · 折叠记录改「对账式」＋ 扩展常驻 ＋ 回归脚本）
>
> 起因：想用刚打通的**手机 CDP** 查上一轮那条「第二次打开笔记 ❖ 不显示」—— 结果先查出**两个别的真问题**。
>
> **① 折叠记录会留「其实已经展开」的残留签名（真 bug，已修）**
> · 症状：内核侧看到的折叠集合比实际折叠数多 —— 本地库实测残留 `["- 1#1","- 2#0"]` 而实际折叠 **0** 行。
> · 根因：第一版的 `onToggle(line, folded)` 是**逐行加减**，而**折叠可以嵌套** ——
>   展开祖先时子孙的折叠会**一起消失**（官方一次 unfold 全撤），逐行通知只为祖先调一次
>   ⇒ 子孙签名留在记录里 ⇒ 下次打开 `initialFolded` 又照它们折起来
>   （用户视角：「我明明展开过，重开又折上了」）。
> · 改法：`onToggle` → **`onFoldChange({ doc, foldedLines })`（对账式）** ——
>   内核把**真实折叠集合**整份交给插件、插件整份重写。判据来自
>   `foldedRanges(u.state) !== foldedRanges(u.startState)` ⇒ **用户用官方键位折的也能对账到**。
> · 验收：桌面脚本 ④d 从 `dom=1 签名=3`（FAIL）变成 `dom=1 签名=1`（PASS）；⑥ 写盘 `disk=[] mem=[]`。
>
> **② 扩展「按需激活」有个时序坑（机制清楚，已防御；触发路径未复现）**
> · `editorMarkExtensions()` 原本「没有任何规则 ⇒ 返回空数组」，而 `MarkdownEditor.tsx:260` 的注释写明：
>   数组**每次 render 现场构造，但 atomic 只在 mount / 切换笔记时读它** ⇒
>   若那次读取发生在插件（异步 blob import）注册**之前**，这几个扩展就**永久不在**这个编辑器里
>   （症状恰好是"按钮 / 行 class / 折叠全不出现，手动切一次笔记才回来"）。
> · 改法：四个扩展**常驻**（规则表为空时 `buildDecorations` 立即 return）＋ 新增
>   `pokeEditors()` / `entriesVersion`：规则增删时朝活着的编辑器发一个空 transaction，
>   ViewPlugin 见版本变了就重扫。
> · ⚠️ **诚实标注**：一度以为在 dev 整页重载后**复现**了它（`btnDom:0` 而 `om:2`），
>   随后发现那是**页面压根没打开笔记**（`.cm-line` 数为 0）—— **不是复现**。
>   所以这条属于"**机制推得通、路径没复现**"的防御性修复，**不是**已验证的 bug 修复。
> · 副作用：`codeFolding()` 常驻 ⇒ 官方折叠键位（`Ctrl-Alt-[` 等）在没有折叠插件时也生效。
>
> **③ 那条「❖ 第二次打开不显示」—— 4 条路径都没复现**
> 试过：首开 / 关掉再开 / 先点进编辑器聚焦再开 / 换一篇再切回来 —— 每次都 `btnDom === omButtons().length`。
> ⇒ 按现状记 **「未能复现」**（当时那次观测处在 rev81 的 HMR 中间态：我连续部署过三版 `App.tsx`、
> 插件还是 rev80 版），**不下结论**。但已把这条路径固化成回归脚本：
>
> **新增 `tools/verify-outline-fold.mjs`**（折叠 + ❖ 的可重复验收，判据见文件头注释）
> · 桌面 `ZN_CDP=http://127.0.0.1:9222 ZN_TARGET=localhost:1420 node tools/verify-outline-fold.mjs` → **10/10**
> · 手机 `ZN_CDP=http://127.0.0.1:9333 ZN_TARGET=tauri.localhost …` → **9/9**（⑥ 只在桌面可查）
> · 两个脚本坑记一笔：**别用模板字符串嵌页面内表达式**（踩 `SyntaxError: missing ) after argument list`），
>   统一用字符串数组 `join`；页面内 `async` 循环 + `awaitPromise` 在这个通道上会 `Runtime.evaluate 超时`
>   ⇒ 展开循环放**宿主侧**逐个同步 evaluate。
>
> **提交**：
> · `339418e`（Android 关闭窗口 ＋ `CARGO_HOME`：3 文件 / +108 −7 —— `src/App.tsx` · `android-dev.cmd` · 本文件）
> · `08e3218`（折叠换成官方状态机：6 文件 / +402 −139 —— `package.json` · `pnpm-lock.yaml` ·
>   `src/kernel/contract.ts` · `src/kernel/editor-marks.ts` · `examples/outline-map/index.js` · `examples/outline-map/outline.css`）
> · `4066476`（折叠记录对账式 ＋ 扩展常驻：4 文件 / +290 −43，含新脚本 `tools/verify-outline-fold.mjs`）
> · 随后那个 docs 提交只改本文件（回填上面三个提交号）。

> ## 📌 rev80（2026-10-14 · 大纲**折叠 / 展开** —— 内核新增 `editor.addFold`）
>
> **用户需求**：「做展开」＝ rev78 遗留的 ③（方案上一轮已定：状态**要记**、存库内 `.zn/`、锚点用行签名）。
>
> | # | 落点 | 做了什么 |
> |---|---|---|
> | ① | `src/kernel/contract.ts` | 新类型 `EditorFoldRule`（`foldEndAt` / `isFolded` / `onToggle`）＋ `EditorApi.addFold` / `refresh`；capability `editor:fold` |
> | ② | `src/kernel/editor-marks.ts` | 折叠圆点 widget（`FoldDotWidget`）＋ **块替换走 StateField**（`foldBlockField`）＋ 点击切换 ＋ `refresh()`（朝所有活着的编辑器 dispatch 一个自定义 effect） |
> | ③ | `src/styles.css` | `.zn-fold-dot`：**行盒内、按 `zn-ol-dN` 缩进层级定位**（与导图按钮的 gutter 分开），复用 `--zn-ol-step` |
> | ④ | `examples/outline-map/` | 纯函数 `outlineFoldEnds`（折点 → 子项末行）＋ 折叠状态按**行文本签名**存 `.zn/outline-folded.json`（**不写进笔记文件**） |
>
> **关键取舍：状态放插件、不放内核。** 内核现有架构拿不到 `EditorView`（`createKernel(vault, doc, hooks)`
> 里没有它），而折叠是**有状态**的交互。所以内核只做四件事："问范围（`foldEndAt`）→ 问状态（`isFolded`）
> → 点击回调（`onToggle`）→ 重画"；状态与持久化归插件，插件改完状态调一次 `refresh()` 就同步过来。
> 这样内核不必引入"折叠集合 StateField + 位置映射"，插件侧换笔记也只是换个 key。
>
> ### 🔑 本轮两个坑（都花了轮次，别再踩）
> 1. **CM6：块级装饰不能由 ViewPlugin 提供。** 把 `Decoration.replace({ block: true })` 放进 ViewPlugin 的
>    `decorations` 里，运行期直接抛 `RangeError: Block decorations may not be specified via plugins`。
>    症状极隐蔽 —— **圆点已经变成 ▸、折叠记录也写对了，但子行一行都没藏起来**（抛错发生在 dispatch 的
>    同步处理里，被调用处的 try 吞掉，看起来就像"状态没生效"）。⇒ 拆两半：**圆点 widget 留在 ViewPlugin，
>    块替换放 StateField**（`@codemirror/language` 的 code folding 也是这个写法）。
>    另：块替换区间要**从第一子行行首**开始（`doc.line(n+1).from`），从"父行末尾/换行符"算起不生效。
> 2. **`isFolded` 是同步回调，而笔记路径是异步来的。** 只靠 `reload()`（await 读盘）设 `cache.path`，
>    中间那一帧 path 还是**上一篇**的 ⇒ 折叠判定查错集合（症状：切回笔记折叠全没 / 折错行）。
>    修法：`doc.on('open')` 里**同步**先把 path 落进 cache（内容仍留旧值，等 reload 覆盖）。
>
> **验收（CDP 实测读数，不是目测）**
> - **折叠**：点第 8 行「大纲」的圆点 ⇒ 子行 9/10/11 隐藏、圆点 ▾ → ▸、行 12 那组（无子项）不受影响；
>   `__omFolds().folded = ["- 大纲"]`；`__znFoldStats` 无错误项。
> - **展开**：再点一次 ⇒ 全部恢复、记录清空、圆点回 ▾。
> - **持久化**：`.zn/outline-folded.json` = `{ "<笔记相对路径>": ["- 大纲"] }`（mtime 与操作同步）；
>   **刷新页面**（内存状态清零）＋重挂编辑器 ⇒ 折叠**原样恢复**。
> - **离线自测**：`node examples/outline-map/selftest-buttons.mjs` → **26/26**（新增 5 条折叠范围用例）。
> - **基线**：`tsc -b` **0** · `oxlint src` **恰好 4** · `cargo test --lib` **21 passed**。
> - 截图：`_shots/fold-03-folded.png`（折叠态）· `_shots/fold-02-expanded.png`（展开态）。
>
> **三个诊断出口**（查折叠先读它们，别靠截图猜）：`window.__omFolds()`（折点表 / 当前笔记的折叠签名 /
> 是否已读盘）· `window.__znFoldStats`（内核侧：`toggle` / `toggle-err` / `rebuild-forced`）·
> `window.__omFoldLog`（插件侧：谁触发的切换 + 调用栈）。
>
> **续（同日 · 用户两轮定形态：隐藏式 → 无符号淡托）**
>
> **第一轮** —— 用户给参考图（「⊖ 大纲」）+ 原话「折叠方式做成这种隐藏式的，
> **鼠标放在圆点上面就变成点击折叠或展开**」：按钮平时隐身
> （`opacity: 0` + `pointer-events: none`，**看不见也点不到**），鼠标移进这一行才浮出；
> 已折叠的行常显；`@media (hover: none)`（触屏）一律常显 —— 否则手机上根本折叠不了。
>
> **第二轮** —— 用户实测三条反馈（带截图），全部落地：
>
> | 反馈（原话） | 落地 |
> |---|---|
> | 「鼠标在**没有子节点的列表**上会导致节点隐藏」 | **真 bug**：上一版在 hover 时把本行圆点 `color: transparent`，而那些行**没有按钮来替代它** ⇒ 圆点凭空消失。**修法：干脆不再动圆点** |
> | 「显示的效果并不同心……也方便判断圆心是否相同」 | 底改成**半透明圆托**（`rgba(127,127,127,.16)`）—— 底下的圆点透出来，圆心对不对一眼可见。CDP 实测：按钮圆心 **(306,285)** vs 圆点中心 **(305,284)** ⇒ **差 1px**（亚像素舍入） |
> | 「也**不用符号**；未折叠是悬浮才有效果，已折叠是常驻效果，**本身就是区分**」 | 去掉 ＋/−（`::before` / `::after` 整段删除）；折叠与否**只由"显不显示"区分** |
>
> 定位公式：`left: calc(var(--zn-ol-step) × (N − 0.5))` ＋ `translateX(-50%)`，半径 `--zn-fold-size: 17px`。
>
> ⚠️ **`font-size: inherit` 是必需的** —— 按钮默认字号是浏览器给的 13.33px，而 `em` / `--zn-ol-step`
> 以**本元素字号**为基准 ⇒ 不继承行字号时 `0.5em` 就不是"半个中文字符"，**层级越深偏得越多**
> （实测 d2 横向偏 8px）；垂直方向另需 `translateY(+4px)`。
> 📌 本轮最该记住的取舍：**按钮的"符号大小"与"定位基准"抢同一个 `font-size`** ——
> 所以符号必须用 CSS 画的横/竖杠（而不是文字字符），才能把 `font-size` 留给"行字号"。
>
> 证据：`_shots/fold-07-idle.png`（平时：只有普通圆点）· `fold-10-hover.png`（hover：淡托浮出、圆点在正中）·
> `fold-11-folded.png`（已折叠：淡托**常驻**、子项收起）。
> CDP 读数：鼠标移开 `opacity = 0,0,0`；hover 到的行 `opacity = 1`；
> **无子节点的行**：`该行有按钮=false、圆点 color=rgb(113,113,122)`（正常显示 ⇒ bug 已修）。
>
> ### 🔁 以上是中间版本 —— 最终形态：**内核不再画按钮，外观与点击交回插件**
>
> （用户看到放大截图后连问两句：「显示的效果并不同心，大圆偏上了」「没有同心圆的绘制方法吗……
> 这种组件应该非常多才对，完全不需要自己造吧」；追问归属后拍板：
> 「**大纲功能是插件提供的，可以直接覆盖内核的实现，引入外部的样式**」。）
>
> **根因**：按钮曾经是内核画的**独立 `<button>`** ⇒ "与库渲染的圆点同心"变成一道**像素题**
> （`absolute + translateY` 得按字体度量硬调；改行内流又要靠 margin 推），实测怎么都剩 1–2px。
> **正解是不要第二个元素**：圆托挂在**圆点自己的伪元素**上（`.cm-atomic-bullet::before`）——
> 同一个盒子，**同心是定义上的**。而"圆点长什么样、点了算什么"属于**外观**，按既定原则交回插件。
>
> | 层 | 现在负责什么 |
> |---|---|
> | **内核** | **只有它能做的**：藏子行（CM6 块替换只能由 StateField 提供）· `refresh()`（改完重画）· **`lineAtElement()`**（DOM 元素 → 行号：DOM 子元素索引 ≠ 行号，折叠时隐藏的行根本不渲染） |
> | **插件** | 折点 / 状态 / 持久化 ＋ **圆托样式**（`outline.css`，走 `manifest.styles` 注入）＋ **点击**（文档级事件委托，命中圆点且该行 `zn-ol-foldable` 才切换） |
>
> 内核**删掉**：`FoldDotWidget`、clickHandler 的折叠分支、`styles.css` 里整段 `.zn-fold-dot`；
> `EditorFoldRule` 也瘦成 `{ id, foldEndAt, isFolded }`（不再有 `onToggle` / `title`）。
>
> **验收（像素实测，量的**墨迹**不是布局盒；工具 `_tmp-ol/measure-fold.py`）**：
> 淡托中心 (304.7, **287.0**) vs 圆点墨迹中心 (305.0, **287.0**) ⇒ **垂直 0.0px / 水平 0.3px** ✓
> 点击圆点 ⇒ 子项收起、该行 class 变 `zn-ol-foldable zn-ol-folded`、记录写盘；
> **内核插的按钮数 = 0**（确认外观真的不再由内核产生）。
> 证据：`_shots/fold-20-final.png`（hover：托与圆点同心）· `fold-21-clicked.png`（点后收起）· `fold-07-idle.png`（平时）。
>
> ⚠️ **试过但弃用（留痕）**：`text-box-trim: trim-both` + `text-box-edge: text`（这本是"让盒＝字形墨迹"
> 的标准机制，本机 Chromium 154 实测支持）—— 套在圆点上会把**行高从 29.9px 撑到 34.9px**
> （"•" 这类标点被当整行来削）⇒ 收益 2px、代价 5px，不值。改用
> `top: calc(50% + 0.1em)` 的**度量补偿**（em 在伪元素上 = bullet 字号 ⇒ 换字号时同步缩放）。
>
> 📌 顺带记一条**能力探查结论**（以后要"把 A 锚到 B"直接查这里，别再造轮子）：
> 本机 WebView2 是 **Chromium 154**，`anchor-name` / `position-anchor` / `anchor(center)` /
> `anchor-scope` / `text-box-trim` / `text-box-edge` **全部支持**（`CSS.supports` 实测）。
> 本次没用锚定定位 —— 因为"不要第二个元素"比"锚定第二个元素"更彻底。
>
> 📌 另外改了一条**反标准但用户点名要**的：**编辑区光标分层**（`src/styles.css`）——
> 用户先是报"鼠标在整个编辑窗口都不显示、找不到鼠标在哪"（实测各区域 `cursor` **全是 `auto`**，
> 而 `.cm-content` 是 `contenteditable` ⇒ 浏览器对 `auto` 渲染 **I-beam 竖线**，编辑器惯例，
> **不是**改动引入的）；我先把整块改成箭头，用户随即纠正：
> 「**靠近正文变光标，其他区域显示为箭头**」⇒ 最终形态：
> · `.zn-editor .cm-content { cursor: default }`（空白/内边距/行尾 ⇒ 箭头）
> · `.zn-editor .cm-content .cm-line span { cursor: text }`（CM6 把文本都包在 span 里 ⇒ I-beam）
> 实测：含文字的 span = `text`、`.cm-line`/`.cm-content` = `default`、可折叠圆点 = `pointer`。
> **下次接手别"修回"整块 I-beam 或整块箭头** —— 这是用户偏好，不是 bug。
> 同时插件给**可折叠行的圆点**补了 `cursor: pointer`（外观搬去插件时漏的），
> 叶子行不给手型（它本来就不可点）。
>
> 🎯 **真凶（第三轮，用户一句话揪出）**：用户说「**白底应该是黑光标，现在是白光标……
> 才会造成光标消失的假象**」—— 实测 `.cm-content` 的 **`caret-color` = `rgba(0,0,0,0)`（全透明）**，
> 而外层 `.cm-editor` 是黑色。来源：`@atomic-editor/editor` **运行时注入**的主题样式里，
> 当前生效的那套写着 `.ͼ4 .cm-content { caret-color: transparent !important }`
> （那是配"**自绘光标**"主题用的），而我们**没有自绘光标** ⇒ 插入符**一直**不可见，
> 跟形状、跟会话内的改动都无关。
>
> 修法：`.zn-editor .cm-editor .cm-content, .zn-editor .cm-editor .cm-line { caret-color: var(--zn-fg) !important }`
> —— 特异性 (0,3,0) 高过库的 (0,2,0)，且同为 `!important` ⇒ 稳赢；用主题变量 ⇒ 明暗主题各自正确。
> 实测 `caretColor` 现为 `rgb(24,24,27)`。
> ⚠️ **教训**：用户说"光标看不见"时，**先量 `caretColor`** —— 我绕了两轮**光标形状**
> （先整块改箭头、再改分层）才意识到是**颜色**。
> 另外分清两件事：**插入符（caret）**颜色归 CSS ✓；**鼠标指针**颜色由 Windows 主题定，
> 应用改不了（除非上自定义图片光标）。
>
> ### 🐞 第三轮：两个真 bug（用户实测报出，都已修）
>
> | 症状（用户原话） | 根因 | 修法 |
> |---|---|---|
> | 「**子节点如果内容和父节点一样，点折叠会触发父节点的折叠**」（那篇笔记里顶层 `- 1` 与它子树里的 `- 1` 文本相同） | 折叠锚点**只用了行文本签名** ⇒ 同文本的行共用一条记录，点子节点命中的是父节点 | 锚点改成 **`签名#同文本第几次出现`**（`foldAnchor()`）。实测：点行 16 那个深层 `- 1` ⇒ 记录是 `- 1#2`，只收起它自己的子项，不再连累整棵树。⚠️ 局限已写进代码注释（在它前面插入**同文本**行会让序号错位） |
> | 「**标题和大纲之间隔了好几条正文和一个空行，不应该被判断为一组**」 | `parseBlocks` 用"最近见过的标题"，**不检查中间夹了什么** ⇒ 列表被算成标题那组、`❖` 入口挂到标题行 | 新增 `headingAdjacent` 标记：遇标题置 true、遇**正文行**置 false；用户随即二次裁定「**空行也算**」⇒ **空行同样清零**。即"标题下面**紧挨着**列表才算一组"；不紧邻时 `titleLine = -1`，入口挂到**列表第一行**、中心主题用 `中心主题`。实测那篇笔记的入口从 `line 3` 移到 **`line 8`** |
>
> 自测：`node examples/outline-map/selftest-buttons.mjs` → **28/28**（新增 2 条：夹正文 / 只隔一个空行）。
>
> ⚠️ **未验 / 待定（如实记）**
> - 本轮**动了内核** ⇒ 手机端要用上必须**重出 APK**（用户未要求出包）。
> - **折叠区里的光标**未做特殊处理：光标若落在被隐藏的行上（如折叠后从别处跳过去）行为**未测**。
> - 折叠记录**不做自动清理**：签名匹配不上就当"未折叠"（宁可展开、不折错行），失效签名会留在文件里
>   （体积可忽略；将来可加"读回时顺手剔除"）。
> 📦 **手机端已出包（rev80，同日）** —— `C:\Users\AQUA\Downloads\ZeroNote-Android-2026-10-14-rev80.zip`（7.82 MB）
> - APK **15.52 MB** · SHA256 `54BB580E…34DF` · 签名指纹 `2ca79f19…35bb`
>   （**与上一版同一把钥匙** ⇒ 覆盖安装不会被拒）
> - **包内已实证是本次代码**：APK 里 `lib/arm64-v8a/libzeronote_lib.so` 含本次 vite chunk 名 `index-CUr7ArSz.js`
> - 内含 **`outline-map-plugin.zip`（68.8 KB）** —— 插件**不在 APK 里**，手机端要把它覆盖到
>   `<库>/.zn/plugins/outline-map/` 再点「重新扫描」才看得到折叠新功能
> - 交付包 SHA256 `3D9E1F12…43A2E4` · 构建日志 `_build/android-rev80.log` · 说明 `_build/rev80/安装说明.md`
> - ⚠️ 顺手修了 `_build/README.md` 的一处**会直接导致构建失败**的缺漏：复现命令漏了
>   `$env:CARGO_HOME=…\_cargo-home`（不带它构建必失败，rev63 踩过但 README 没记）
>
> 📱 **adb 那台（`33b676f6` / 24069RA21C，Android 16）已同步到 rev80（同日 22:26）**：
> - 它装的是 **debug 版**（`com.aqua.zeronote.debug`）⇒ 更新它必须出 **debug 包**
>   （release 包名 `com.aqua.zeronote` + release 签名，装上去只会**并存一个新包**，不是更新）：
>   `pnpm tauri android build --apk --debug --target aarch64`（Rust dev 编译 **8.16s**；
>   ⚠️ **debug APK 278 MB** —— universal 含全部 ABI 且未剥离符号，比 release 的 15.5 MB 大一个量级）
> - `adb install -r` 覆盖成功 ⇒ `lastUpdateTime = 22:26:44`（原 rev76 是 00:23）
> - ⚠️ **那台的库里原本只有 `doc-reader`、没有大纲插件** ⇒ 顺手 `adb push` 了 `outline-map`
>   （8 文件）到 `<库>/.zn/plugins/` ⇒ 现在设备上也有折叠能力
> - 另推了一篇示例 `outline-demo.md`（嵌套列表）供肉眼验收
> - ⚠️ 手机交互要用 `adb shell input motionevent DOWN/UP`（`input tap` 无效，rev71 记过）
>
> 🔥 **热重载已起（22:34）**：`android-dev.cmd` 经 **WMI** 启动（PID 35352，不随会话回收）——
> 日志确认 `Detected connected device: ARIA (24069RA21C)` / `Using 192.168.1.3` /
> `BeforeDevCommand = cmd /c exit 0`（不自起 vite，**直连桌面 1420**）。
> ⇒ 改 `src/**` **vite HMR 直接热更到手机，不必再出包**（只有 `src-tauri/**` 才重建）。
> ⚠️ dev 版依赖桌面 dev 开着（连的是 `192.168.1.3:1420`，一关手机白屏）；要独立运行装 release zip。
> 📌 教训：**改前端别动不动重建 278 MB 的 debug 包 + 装 + 重启**（用户一句"热重载呢？"点出来的）。
>
> 🐞 **同轮修的移动端 bug**：导图窗口标题条 / 「✕」**压在 Android 状态栏上** —— 根因
> **`.zn-plugin-window` 漏了安全区补偿**（主窗口 `.zn-app` 有；插件窗口是**独立 webview**，
> 主窗口那条 CSS 管不到它；桌面端 `env()` 取 0 所以一直没暴露）。修法：加
> `env(safe-area-inset-top/bottom)` + `box-sizing: border-box`。提交 `7e8cdbe`。
> ✅ **已在手机复验（dev 版热重载后实测）**：标题条与三颗按钮（最小化/最大化/✕）落到**状态栏下方**，
> 证据 `_shots/android-rev80-07.png`（修复后）对比 `_shots/android-rev80-03.png`（修复前压在状态栏上的现场）。
>
> ⚠️ **待修**：`android-dev.cmd` **没设 `CARGO_HOME`**（只设了 CARGO_TARGET_DIR），而本项目规矩是
> 必须带 `…\deepseek\_cargo-home`（rev63）—— 日志里它用的是 `~/.cargo/registry/…`。本轮侥幸过了，
> **下次卡住先看这里**。⚠️ 改它要**保住 CRLF**（文件头写明 "CRLF required"）。
>
> 🐞 **又修一个手机端 bug（用户报「关闭按钮不起作用」）—— 但它牵出一个新问题，待续**：
> - **根因**：桌面那套 `getCurrentWindow().destroy()` 在 **Android 上没有独立窗口可销毁** ——
>   那个"导图窗口"其实是**同一个 webview 换成了 `?pluginWindow=<panelId>` 的 UI**
>   （截图里它占满整屏、只有自绘标题条）。
> - **已修**：Android 上"关闭"改成**回到主界面**（URL 去掉 `pluginWindow` 后 `location.replace`）。
>   手机上实测 ✔ —— 点 ✕ 确实回到了主界面（`_shots/android-rev80-11.png`）。
> - ⚠️ **它暴露的新问题（重要）**：`location.replace` 会**整页重载**，而 **dev 版的 URL 里没有 `vault` 参数**
>   ⇒ 重载后应用退回**默认库**（应用私有 vault），主界面显示「这个库还没有笔记 / 0 篇」
>   （`_shots/android-rev80-11.png`）。**数据没丢**：真库在 `/storage/emulated/0/Documents/ZeroNote`，
>   只是应用指错了地方 —— 关掉应用重开就能回到正确库。
>   ⚠️ **更正见 rev81**（本条**归因错了**）：那 0 篇与"重载 / 默认库"**无关** —— 库一直指着公共库，
>   真根因是**存储权限**（deny 时 Android 对非 media 文件不报错、也不列出）。读数与证据见 rev81。
> - ✅ **已做（rev81，做法比这里定的多两件）**：**别重载**，用一个 state 关掉窗口 UI：
>   `const [winClosed, setWinClosed] = useState(false)`；窗口分支的渲染条件改成
>   `pluginWindowId && !winClosed`；Android 的 `onClose` 里 `setWinClosed(true)`。
>   这样库、编辑器状态、插件全都不用重建（桌面仍走 `destroy()`）。
>   **rev81 补的两件**：① `kernel.clearShell()`（否则插件的整窗接管仍遮满主界面）；
>   ② `history.replaceState` 清 URL 的 `pluginWindow`（否则整页重载会让窗口复活）。验收见 rev81。
> - 📌 **教训**：**Android 上没有"多窗口"** —— 凡是依赖"开/关独立窗口"的桌面假设，
>   都要在真机上单独验一遍（`close()` 只发事件、`destroy()` 无窗口可销毁，两条在这里都不成立）。
>
> - **提交**：`a292646`（6 文件 / +585 −11）。

> ## 📌 rev79（2026-10-14 · 大纲缩进/竖线第五轮 —— 全部按「一个中文字符」＋ 圆点居中）
>
> **用户原话**（两条，中间被追问一次）：①「**缩进和竖线做成右边的效果**，现在是左边的」（附参考图两张）
> ② 我报出参考图实测值后，用户明确规则：「**每个大纲的点和正文一个中文字符的默认占位相同，
> 每次大纲缩进也按一个中文字符缩进**」，随后补「**圆点占位没问题，但是位置要在中心**」。
>
> | # | 改动 | 旧 → 新（实测，不是目测） |
> |---|---|---|
> | ① | 每级缩进 | 10.2px（0.6 字符）→ **17px ＝ 一个中文字符**（`--zn-ol-step: 1em`） |
> | ② | 圆点**占位** | 29.6px（1.74 字符）→ **17px ＝ 一个中文字符**（圆点**视觉大小不变**，`--zn-ol-dot-scale: 1.45` 保留） |
> | ③ | 圆点在占位里的位置 | 内容盒 left 290.09（偏左 15px）→ **300.3 ＝ 盒中心 305.5**（偏差 **−0.01px**） |
> | ④ | 竖线位置 | 固定偏移（−23/−13/−3px 硬编码 ⇒ 父点一动线就不跟）→ **父级圆点正下方**（`background-origin: border-box` ＋ `calc(step × (k − 0.5))`，与 ② 严格同构） |
>
> **实测读数（CDP）**：d1/d2/d3 圆点盒 = 297–314 / 314–331 / 331–348（每级 **+17**）；
> 墨迹中心 = 305.5 / 322.5 / 339.5，各自等于所在盒中心；竖线 x = **305.5**（d2 行）/ **322.5 ＋ 305.5**（d3 行）
> ⇒ 线与父圆点中心**逐像素重合**。证据截图 `_shots/ol-7th-dot-centered.png`、对比图 `_shots/ol-compare.png`。
>
> 🔑 **本轮唯一的坑（下次别再走弯路）**：圆点"不在中心"**不是**字体问题、**也不是** `text-align` 没生效 ——
> CM6 在**行**上写了内联 `text-indent: -1.2em`（marker 悬挂），而 bullet 是 `inline-block`
> ⇒ 这个 `text-indent` **继承进 bullet 内部**，把里面的 "•" 又左推 20.4px。
> **修法一行：`text-indent: 0`**（加在 `.cm-atomic-bullet` 规则里）。
> 诊断路径（可复用）：① Canvas `measureText` 先排除"字形墨迹在 advance 里偏心" —— 8 种字体全居中 ⇒ 排除字形；
> ② 再用 `Range.selectNodeContents(文本节点)` 量**真实布局盒**，才看到内容起点 290.09 ≠ 居中应得的 300.29。
>
> ⚠️ **一处未采纳、留痕备查**：用户参考图像素级实测**每级缩进 = 40px ≈ 2.35 个中文字符**
> （量法见过程产物 `_tmp-ol/measure.py`）。用户随后明确要求"按一个中文字符"⇒ **按用户规则实现**。
> 哪天想换成参考图那个宽度：把 `--zn-ol-step` 从 `1em` 改成 `2.35em` 即可（**缩进与竖线一起跟**，无需重算）。
>
> **提交**：`29f9f08`（仅 `src/styles.css`）。基线 `tsc -b` **0** · `oxlint src` **恰好 4 warnings**。
> ⚠️ 本轮改的是**内核 CSS** ⇒ 手机端要用上必须**重出 APK**（用户本轮未要求出包）。

> ## 📌 rev78（2026-10-14 · 大纲竖线 —— 内核新增 `editor.addLineClass`）
>
> 用户在同一条消息里提了三件：① 按钮**统一对齐** ② 如参考图的**大纲竖线** ③ **折叠展开**。
> **① ② 本轮完成；③ 方案已定、留给下一轮**（见本段末尾）。
>
> | # | 做了什么 | 落点 |
> |---|---|---|
> | ① | 按钮**跨层级统一到同一条竖线**（右边缘都是 293）＋ 垂直仍对齐**首行**（dy +1.5~+2.0） | `src/styles.css`（第四次迭代：绝对定位到行盒 ＋ **不设 `top`**，见 rev77 续段的说明） |
> | ② | 内核新增 **`editor.addLineClass({ id, classAt })`** —— 逐行给**整行**加 class（`Decoration.line`，不插视图元素） | `src/kernel/contract.ts` ＋ `editor-marks.ts`；`plugin-host.ts` 能力表加 `editor:line-class` |
> | ② | 插件按缩进层级返回 `zn-ol-dN`；样式表用 `background-origin: content-box` 画导轨 | `examples/outline-map/index.js`（新增纯函数 `outlineDepths`）＋ `src/styles.css` |
>
> **为什么必须走内核**：渲染后的缩进由 CM6 按层级给 `padding-left`（实测第 1 级 **34px**、每级 **+10.2px**），
> 源码里的空格数与之无关 ⇒ 用 `addMark` 的正则"数空格"是错的（这正是 §先查现成的价值：量一次就定性）。
> 竖线位置：本级线在 content-box 左 **-18px**（marker 再往左 6px），每深一级再 **-10.2px**；
> `background-position` 的多层写法已写到 **d6**（插件侧 `Math.min(d, 6)` 封顶）。
>
> **验收**：CDP 实测 d1/d2/d3 行分别是 **1/2/3 层背景**（位置 -18 / -28.2 / -38.4）；离线
> `selftest-buttons.mjs` → **18/18**（新增 4 条层级用例：平铺 / 三级嵌套 / 同一标题两块各从 1 起算 / 正文不进表）；
> 基线 `tsc -b` **0** · `oxlint src` **4 warnings**。
>
> ⚠️ **加了编辑器规则后要"切一次笔记"才生效**：契约写明扩展数组在**编辑器挂载/切换笔记**时被捕获
> ⇒ 只点「重新扫描」不够（本轮实测：重扫后 DOM 里没有 `zn-ol-d*`，切一次笔记才出现）。
>
> **⏭ ③ 折叠展开（下一轮，方案已定，别重新设计）**
> · 内核加 `editor.addFold({ id, foldEndAt })`：`foldEndAt(ctx)` 返回折叠范围的**结束行号**（0 起）或 `null`；
>   内核负责 StateField（折叠行集合）＋ 行首**圆点按钮**（`Decoration.widget`）＋ 用 `Decoration.replace`
>   隐藏范围内行。插件按列表树提供范围（`outlineDepths` 已有树，扩成"每个节点的子项末行"即可）。
> · **折叠状态要持久化**（用户 2026-10-14 已答「**要记**」）⇒ 存**库内** `.zn/`（跟库走，**不写进笔记文件**）。
>   建议 `.zn/outline-folded.json`：`{ "<笔记相对路径>": ["<行文本签名>", …] }` —— ⚠️ **别只存行号**：
>   行号会随编辑漂移，优先存"该行去空白后的前 ~40 字"当锚点，行号只作兜底。
> · 圆点在**缩进层级位置**（用户参考图 2），与导图按钮（行盒左侧 gutter）不冲突；点击切换折叠。
> · 参考实现：Obsidian 的 [`vslinko/obsidian-outliner`](https://github.com/vslinko/obsidian-outliner)（同样跑在 CM6 上）。
>
> **续 · 第四轮（同日 · 用户五条要求，已落地）**
>
> | 要求（用户原话） | 落地 |
> |---|---|
> | 「**要记**」（折叠状态） | ⇒ ③ 折叠**要持久化**（存库内 `.zn/`），不是内存态 —— 方案见本段末尾 |
> | 「**标题不需要竖线**」 | 标题行本来不是列表行、天然没有 `zn-ol-dN`；**第一级也不再画线**（见倒数第二条） |
> | 「**单独一个大纲不用竖线也不视为导图**」 | 新增 `hasNested()`：**单层平铺列表不算大纲** ⇒ 不给「❖」入口；竖线也不再画在第一级 |
> | 「**大纲的点大一点**」 | `.cm-atomic-bullet` 字号 → **1.45em**（实测点高 17px → **25px**） |
> | 「**第一级大纲不做缩进，和非大纲平级**」 | CM6 的缩进是**内联 style**（`padding-left: 2em; text-indent: -1.2em`，每级 +0.6em）⇒ 只能 `!important` 覆盖 padding：**`padding-left = 1.2em + 0.6em×(d−1)`** ⇒ 一级 marker **实测 297 = 行盒左 = 与正文平级**，每深一级 +10px（307 / 317） |
>
> **竖线语义随之改**：不再是"每级都画"，而是 **`dN` 行画 N−1 条**（只画祖先层级的引导线）
> ⇒ 第一级（已与非大纲平级）没有线、标题没有线。位置仍用 `background-origin: content-box`
> ＋ `-23px / -13px / -3px …`（每级 10.2px）。
>
> **验收**：`selftest-buttons.mjs` → **21/21**（新增 3 条"单层不算大纲"用例；改 2 条既有用例的行号期望）；
> CDP 实测 —— 一级 marker 297 / 二级 307 / 三级 317；「非大纲」那组的**单行列表 ❖ 已消失**；
> `tsc -b` **0** · `oxlint src` **4 warnings**。
>
> ## 📌 rev77（2026-10-14 · 导图「❖」按钮判据收紧：**容器标题不给按钮**）
>
> **用户实测反馈**（桌面端 · 库 `_tmp-vault-tb` · 笔记《数据库绪论》截图）：`# 绪论` 左边出现「❖ 导图」按钮
> —— 用户原话「**独立一个标题，不应该被视为思维导图，出现导图按钮**」；追问判据后补充「**只有标题下面接大纲
> 的时候才会被判断为大纲，可以转成思维导图。单独的标题不构成思维导图**」。
>
> | # | 事实（代码里读出来的） | 落点 |
> |---|---|---|
> | 1 | 那篇笔记其实有 **3 个标题**：`# 绪论` / `## 数据模型` / `## 信息世界基本概念`，三组下面都有列表 | `parseBlocks` 的块名 = "上方最近的标题"，**不看层级** ⇒ 三个标题都会被当成"一组大纲" |
> | 2 | rev65 的判据只有一条："该标题下面有列表项就显示按钮" | ⇒ **容器标题**（下面还接着子标题）也被放过，这才是 `# 绪论` 冒出按钮的原因 |
> | 3 | 改法：新增纯函数 `headingIsContainer` / `mapButtonLines`，`editor.addLineAction` 的 filter 改成查表 | `examples/outline-map/index.js` |
>
> **新规则**：标题下面（直到下一个**同级或更浅**的标题之前）**还有更深一级标题** ⇒ 它是**容器**（文档结构的根，
> 如 `# 绪论`），**不给按钮**；否则（下面直接就是列表）才算一组、才给按钮（如 `## 数据模型`）。
> 裸列表（文档开头没有标题）照旧挂在它自己第一行。
>
> **怎么验证的（离线可复跑）**：新增 `examples/outline-map/selftest-buttons.mjs`（7 个内置用例）→ **7/7 passed**；
> 对真笔记跑出的按钮行只剩 **第 25 行 `## 数据模型`** 与 **第 37 行 `## 信息世界基本概念`**，
> **`# 绪论`（第 1 行）不再有按钮** ✅。原 `selftest.mjs` 未回归（39 节点 / 5 层照旧）。
> `oxlint examples/outline-map` → **0 errors**（313 warnings 是该目录历史存量，非本次引入）。
>
> **生效方式**：库里 `.zn/plugins/outline-map` 是指向 `examples/outline-map` 的 **junction** ⇒ 文件已就位；
> 但插件 JS 已被宿主加载，**要在内核顶栏点「重新扫描」（或设置 → 插件 → 重新扫描）才重新加载**。
> 本次改的是**插件**（不进 APK）⇒ **不需要重出 release 包**。
>
> ⚠️ **判据的来路要留痕**：用户原话只说"标题下面接大纲"，我把它落在**标题层级**上（容器 ⇒ 不给）。
> 若用户要的是另一种含义（例如"标题与列表之间不许有空行"），只需改 `headingIsContainer` 一个函数。
>
> ### 续（同日 · 用户第二轮两条实测 → 已修，CDP 验收）
>
> 用户第二条与第三条反馈（截图 + 原话）：
> ① 「**导图按钮不能改变标题缩进**」—— 按钮把标题整体右推；
> ② 「**单独大纲也应该能够用导图打开**」—— 空行隔开的第二组大纲**没有入口**。
>
> | # | 根因（一轮 CDP 实测挖出来的） | 修法 |
> |---|---|---|
> | ① | 行首按钮是**行内** widget（`width: 1em` + `margin-right: 0.34em`）⇒ 占位、把行首内容右推 | `styles.css`：`.cm-line` 设 `position: relative`，按钮改 `position: absolute; left: 0; transform: translate(-100%, -50%)` ⇒ 浮在正文左侧（落进 `.cm-scroller` 的 48px 内边距）⇒ **有无按钮，行首位置相同** |
> | ② | 分组是"极大连通列表块"，**同一标题下可以有多个块**（空行断开）；旧规则只给标题行画一个按钮 ⇒ 第二组**没有入口**，且点开的是第一组 | 新增 `mapButtonTargets`：标题行已被占用时，后续块把入口挂到**它自己的第一行**；命令 `open-map-at-line` 改用**同一张表**反查组号 |
> | ③ **真凶** | **内核把按钮算到了空行上**：行首按钮 pattern 里的 `\s` **包含换行**，目标行前面有空行时匹配从**空行行首**开始 ⇒ `m.index` 落在空行 ⇒ 插件按行号判定的 `filter` 失配 | `editor-marks.ts`：改按**匹配里第一个非空白字符**定位行；outline-map 的 pattern 同时收紧成 `[^\S\n]` |
>
> ③ 的铁证（CDP）：`__omFilterSeen.targets = [7, 12]`（插件算对了）而 `domButtons = 1` ⇒ 不是判据错，是**行号被内核算到空行（11）**上。
>
> **验收读数（CDP 实测，非肉眼）**
> - 文字起点：无按钮标题行 **297** ＝ 有按钮标题行 **297**（缩进未变）；按钮自身 281–297 ⇒ 在正文左侧
> - 入口：`domButtons = 2` —— 行 8（`# 标题接大纲…` 标题行）＋ 行 13（`- 单独大纲…` 它自己的第一行）
> - 位置微调（用户 2026-10-14 二次要求：「再往左一点，然后统一再往下 2 像素」）：
>   按钮右边缘 **297 → 293**（`left: -4px`）、中心相对文字中心 **下移 2px**
>   （`transform: translate(-100%, calc(-50% + 2px))`）；三个按钮实测 dy = +1.8 / +1.8 / +2.4 px。
> - **按钮尺寸统一**（用户 2026-10-14 三次要求：「按钮大小做成统一的，不按级别区分了」）：
>   原 `0.68em` + `1em` 的 em 方案随行字号缩放（H1/H2/列表行实测 16/14/12px）⇒ 固定 **13×13px**；
>   实测两个按钮都是 13×13。
> - **中心主题规则**（用户 2026-10-14 三次要求）：「单独大纲渲染的中心主题是上一级的标题，
>   实际上**不接标题的大纲应该统一使用中心主题作为导图中心**」⇒ `parseBlocks` 新增 `headingUsed`：
>   **只有标题下面第一个块**用标题当中心，后续块（空行断开的）与裸列表一律用 `中心主题`。
>   CDP 实测：点「单独大纲」的入口 ⇒ 导图窗口根节点 = **中心主题**（原先 = 上一级标题）；
>   离线 `selftest-buttons.mjs` 加 5 条中心主题用例 ⇒ **14/14**。
> - **按钮定位第三次修正**（用户 2026-10-14 四次要求：「按钮偏了，无标题情况下，按钮应该对齐
>   **最顶层大纲**」）：上一版用 `position: absolute; top: 50%` —— 那个 `50%` 是相对**整个 `.cm-line`**，
>   而 `.cm-line` 是**折行后的整块** ⇒ 文字折成两行时按钮居中到两行之间。改成**留在行内流 ＋ 负左边距
>   `margin: 0 4px 0 -17px`**（净水平占位 = -17+13+4 = 0 ⇒ 不推正文；垂直由行内排版决定 ⇒ 永远对齐
>   **首行**）。CDP 实测：折两行的行 dy=**+1.8**（若仍居中于两行会是 +14）、单行 H2 +2.8、
>   按钮右边缘 293（正文起点 297，间距 4px）。
>   ⚠️ **已知差异（用户未要求，暂不动）**：列表行的按钮比标题行的按钮**靠右 14px** ——
>   CM6 给列表行加了 marker 缩进（行内容盒起点不同），按钮跟随各自行的内容盒。
>   要统一成一条竖线，得改内核 widget 结构（`LineActionWidget.toDOM` 外包一层继承行字号的 wrapper）
>   或用绝对定位逐行定位，成本明显更高 —— 需要时再做。
> - **按钮对齐最终方案（第四次迭代，用户 2026-10-14 五次要求：「改成统一对齐」）** ——
>   水平与垂直**必须分开满足**，靠同一条规则里的两个技巧：
>   · 水平 = **绝对定位到行盒**（`.cm-line` 设 `position: relative`，按钮 `left: -4px` + `translateX(-100%)`）。
>     依据：**行盒左边界各行相同**（实测都是 297），而**行内流起点**随 marker 缩进变（列表行右 14px）
>     ⇒ 只有脱离行内流才能落在同一条竖线。
>   · 垂直 = **不设 `top`** ⇒ 绝对定位盒退回 static position（实测落在行盒顶部附近，各行为同一个值）
>     ＋ 量出来的 `translateY(+16px)` 修正。设 `top: 50%` 会相对"折行后的整块"居中 —— 那是第二次迭代的错。
>   CDP 实测：三个按钮右边缘都是 **293**（跨层级同一条竖线）；dy = **+1.5 / +2.0 / +2.0**
>   （单行 H2 / 折两行 / 单行列表；dy = 按钮中心 − **首行**文字中心）。
>
> **⏭ 下一轮待做（用户同一条消息里要的另外两件；方案已定，别重新发明）**
> · **② 大纲竖线**：内核加"逐行给 class"的 API（如 `editor.addLineClass({ classAt })`）⇒ 插件按层级返回
>   `zn-ol-dN` ⇒ CSS 画竖线（行盒左起的多层背景渐变）。**不要**用 pattern 去数缩进空格 ——
>   渲染缩进由 CM6 按层级给，源码空格数不可靠。
> · **③ 折叠展开**：内核加 `editor.addFold({ foldEndAt })`（StateField 存折叠行 ＋ 行首圆点按钮 ＋
>   `Decoration.replace` 隐藏子行）⇒ 插件按列表树给折叠范围；折叠状态**先做内存态**（关掉笔记即全展开），
>   要持久化再加 `.zn/`。⚠️ 折叠圆点在**缩进层级位置**（参考图 2），与导图按钮（行盒左侧 gutter）不冲突。
>   参考实现：Obsidian 的 `vslinko/obsidian-outliner`（同样跑在 CM6 上）。
> - 离线 `selftest-buttons.mjs` → **14/14**（9 条按钮行 ＋ 5 条中心主题 ＋ 入口表不变量）
> - 基线：`tsc -b` **0** · `oxlint src` **4 warnings**
>
> **两个新诊断出口**（排"按钮该有却没画"这类问题时先读它们，别靠截图数）：
> `window.__omButtons(md?)` = 当前文档的入口表（行号 → 组号）；`window.__omFilterSeen` = filter **实际收到的文本**与它算出的行号。
>
> ⚠️ **这次动了内核**（`src/kernel/editor-marks.ts` ＋ `src/styles.css`）⇒ 手机端要用上必须**重出 APK**；
> 插件（`examples/outline-map`）不进包，改它只需**重新扫描**（实测重扫后要等 1–3 秒，读早了还是旧装饰）。
> **本轮不出包（用户 2026-10-14 明确回复「不用」）** —— 桌面端走 vite dev ＋ HMR 已自用；
> 下次要上手机时再照 `_build/README.md` 的流程出（约 8 分钟），旧包 `…zip.bak-rev75-20261014` 仍在。
> **提交**：`ddedfb2`（容器判据）· `3b02fcd`（内核行号真凶）· `571e9b6`（左移 4px / 下移 2px）· `47f8ca9`（尺寸统一 13×13 ＋ 中心主题）。
>
> ## 📌 rev76（2026-10-14 · 修 rev75 真机暴露的两个 bug —— 已提交 `2e410f1` · release 包已重出并覆盖）
>
> 用户在**另一部远程手机**上装了 rev75 的 release 包 + 插件，实测报出：
>
> | # | 现象（用户截图） | 根因 | 修法 |
> |---|---|---|---|
> | 1 | 从文件管理器打开 **md** 被拦，toast「…不是可阅读的文档类型（支持…md 等）」—— 自相矛盾 | `App.tsx` 的 `content://` 分支误用了 `DOC_RE`，而它是"只读文档"的名单、**不含 md** | 新增 `SAF_READABLE_RE`（含 md/markdown）专供该分支；`DOC_RE` 保持不含 md ⇒ **库内 md 仍走编辑器** |
> | 2 | 打开库外的 PDF 会把**笔记库切走**（界面变"这个库还没有笔记"，像笔记全丢） | 既有设计（库外文件 ⇒ 父目录当库）对"只想看一眼的文档"是错的 | 库外**文档**改为 `core.openDocument({ abs })` 直接交给阅读器、**不切库**；库外**笔记**才走"父目录当库" |
>
> **状态（新会话接手必读 —— 已于 2026-10-14 01:05 真正收尾）**
> - 两处修复**已提交**（`2e410f1`）。⚠️ 提交信息由**并发的另一个会话**写成
>   `fix(open): 从文件管理器打开的 md 被误拦 + 打开库外 PDF 会切走笔记库` —— 内容就是这两处，不是我的措辞。
> - **三条基线本轮全部实跑通过**：`pnpm exec tsc -b` → 退出码 **0**；`pnpm exec oxlint src` → 恰好 **4 warnings / 0 errors**；
>   `cargo test --lib` → **21 passed / 0 failed**（含 `pick_open_targets_accepts_readonly_docs_but_not_other_files`）。
>   构建里的 `tsc -b && vite build`（1993 模块）亦通过。
> - release 包**已重出并覆盖交付**（`C:\Users\AQUA\Downloads\ZeroNote-Android-release-2026-10-14.zip`）：
>   - 覆盖后 zip：**16,300,547 B · 2026-10-14 01:02:43** · SHA256 `9D1B038C…AE81`；
>     旧包留底 `…zip.bak-rev75-20261014`（16,308,739 B）
>   - 内含新 APK **16,260,666 B**（SHA256 `765322AC…BC7F`，与签名产物**逐字节一致**）；
>     unsigned 源包 16,198,587 B · SHA256 `F89AA734…43C8`
>   - `zipalign -p 4` + `apksigner`（debug keystore）验签：`CN=Android Debug`、指纹 `2ca79f19…35bb`
>     —— 与 rev75 交付包**同一把钥匙**（覆盖安装不会因签名不符被拒）
> - ⚠️ **更正 `06b59d4`（00:57:15 的并发提交）**：该提交在**包还没重出时**就宣布"已覆盖交付"，
>   并把**旧包**的读数当成新包 —— 它写的三个数字实测分别是：`2026-10-14 00:56:56` = **旧 zip 的时间戳**、
>   `APK 16,268,858 B` = **旧 zip 里那个旧 APK 的长度**、`unsigned SHA256 F55E2451…ED04` = **对不上任何文件**
>   （真实 unsigned = `F89AA734…`）。**真实覆盖发生在 01:02:43**，以本段以上数据为准。
> - 包内是本次前端，**已实证不是靠时间戳推断**：交付 APK 的 `lib/arm64-v8a/libzeronote_lib.so`（14,490,504 B）
>   里含本次 vite 产物独有的 chunk 名 **`index-BmuGGoI_`** / **`index-qIqc3vX_`** ⇒ Tauri 把 `dist/` 嵌进 `.so`
>   （所以 APK 的 `assets/` 里**没有**前端文件，只有 `tauri.conf.json` 与 dexopt 数据 —— 查包时别在 `assets/` 里找）。
> - 用户测试手机**不是** adb 那部（33b676f6）：他那部「所有文件访问」已开、库是新装空库（"0 篇"正常）；
>   adb 那部只有 `com.aqua.zeronote.debug`、库完整、权限 allow。
>
> **下一步（给用户）**：装新 zip 里的 APK，验两条路径 —— ①文件管理器里点 **md** 能打开；②点**库外 PDF** 时笔记库**不被切走**。
> **留待定夺的隐患**（本轮未触发，未擅自改）：`App.tsx:1340` 的 `if (!MD_RE.test(path) && !isDoc) return`
> 排在 `content://` 分支**之前** —— 若某 provider 递来的 URI **不带扩展名**（如 `content://media/external/file/1000`），
> 会在这里被**静默丢弃**。改法是把 `content://` 分支提到该判断之前（靠插件返回的 `name` / mimeType 判定）。
> ## 📌 rev75（2026-10-14 · 文件关联 ＋ Android SAF（content://）读取 ＋ release 包）
>
> ### 一、起因（用户两次反馈，都带截图）
> 1. 「安卓的 pdf 打开方式没有 zeronote 选项」
> 2. 「不支持打开其他目录的 md 文件」（toast：系统递进来的是 SAF 内容 URI，读不了）
>
> ### 二、两条根因（一手证据）
>
> | # | 现象 | 根因 |
> |---|---|---|
> | 1 | 「打开方式」里没有 ZeroNote | Tauri 从 `bundle.fileAssociations` **自动生成** intent-filter，而它只配了 md/markdown —— 构建前的 manifest 里只有 `text/markdown` 一条 mimeType |
> | 2 | 别的目录的文件点开没反应 | 文件管理器递的是 **`content://`（SAF）**：`std::fs` 读不了它，只有 Android 的 `ContentResolver` 能 |
>
> ### 三、改了什么
>
> | # | 落点 | 改动 |
> |---|---|---|
> | ① | `tauri.conf.json` | `fileAssociations` 从 1 条扩到 **7 条**（pdf / epub / mobi+azw3 / fb2 / cbz / txt，`role: Viewer`）⇒ 重建时生成 7 条 mimeType |
> | ② | `lib.rs` `pick_open_targets` | 放行只读文档（此前**只放行 `.md`** ⇒ PDF 的 intent 到了也被**静默丢掉**）；新增 1 条单测钉住 |
> | ③ | `App.tsx` | 非 md 走 `core.openDocument`；`content://` 走新的原生通道 |
> | ④ | **新插件** `src-tauri/plugins/tauri-plugin-uri-reader` | 照 `statusbar` 模板、约 60 行 Kotlin：`read_content_uri(uri)` → `contentResolver.openInputStream` 复制到 `cacheDir/zn-open/<名>` → 返回 `{path,name}`（绝对路径） |
> | ⑤ | 内核 `host` 原语 | 新增 **`assetUrlAbs(abs)`**（库外绝对路径 → asset URL；`assetUrl` 只认库内相对路径） |
> | ⑥ | `examples/doc-reader` | 支持 `{abs,name}` 载荷（库外文件**不给删除入口**）、把 `md` 纳入可读（库外 md 以纯文本只读显示） |
>
> ### 四、为什么自己写原生插件
> 官方 `plugin-fs` **至今不支持**读 `content://` —— `tauri-apps/plugins-workspace#1775` 里，报告者只能自己在
> `FsPlugin.kt` 里加 Kotlin 才解决（维护者只回"要不要我给你写个临时插件"）。⇒ 照项目里 `tauri-plugin-statusbar`
> 的模板自己写（含 permissions/、build.rs 的 `.android_path("android")` 自动接 gradle）。
>
> ### 五、验收
>
> | 判据 | 证据 |
> |---|---|
> | intent-filter 真的带上 PDF | 构建后 manifest 有 **7 条 mimeType**（含 `application/pdf`、`application/epub+zip`、`text/plain`…） |
> | **设备侧真机路由** | `cmd package query-activities -a VIEW -c DEFAULT -t application/pdf` → **5 activities found，含 `com.aqua.zeronote.debug/MainActivity`** ✅ |
> | SAF 链路（Rust→前端→原生插件） | logcat：`ZeroNote 待打开：content://…` → `Tauri plugin: pluginId: uri-reader, command: readContentUri` ✅ |
> | SAF **实际读取** | ⚠️ **adb 模拟不出系统授权**：`Permission Denial … requires that you obtain access using ACTION_OPEN_DOCUMENT`；`--grant-read-uri-permission` 反而 `SecurityException`（adb shell UID 2000 无权 grant）。真实文件管理器会带 `FLAG_GRANT_READ_URI_PERMISSION` ⇒ 这是**测试手段天花板**，**待用户手动点一次确认** |
> | 基线 | `tsc -b` 0 错误 · `oxlint src` 恰好 4 warnings · `cargo test --lib` **21 passed**（新增 `pick_open_targets_accepts_readonly_docs_but_not_other_files`） |
>
> ### 六、release 包（用户要求）
> debug 包 278 MB 的**实测归因**（拆 APK 数的）：同一个 arm64 原生库 **debug 139.0 MB vs release 11.3 MB（12 倍）**，
> 加上前端 debug 带 sourcemap（16.3 vs 2.6 MB）—— **与"4 个 ABI"无关**（debug 只含 1 个 ABI）。
> ⇒ `pnpm tauri android build --apk --target aarch64` → **16,204,059 B ≈ 15.45 MB（缩小 94.5%）**，
> 用 **debug keystore 签名**（`zipalign -p 4` ＋ `apksigner sign --ks ~/.android/debug.keystore`，build-tools 35.0.0）
> ⇒ 验签指纹 `2ca79f19…35bb` 与现有安装**完全一致**。
> ⚠️ **但 adb 装不上**：`INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`（国产 ROM 对"装新应用"的限制；
> 覆盖升级**已有包名**则放行 —— 之前装 debug 版就是这样成功的）⇒ 交付方式改成**手动安装**（安装说明已写明）。
> ⚠️ release 的包名是 **`com.aqua.zeronote`**（debug 是 `…zeronote.debug`）⇒ 两者**并存**，不是覆盖升级；库路径相同、数据共用。
>
> ### 七、踩坑记录（值得留）
> 1. **release 构建第一次失败**：`LNK1104: 无法打开 …\release\deps\thiserror_impl-…dll` —— **不是源码问题**，
>    是并发的 `tauri dev` 的 cargo 在抢**同一个** `CARGO_TARGET_DIR`（我跑 `pnpm build` 改写 dist/ 触发了它重编）。
>    原样重跑一次即成功。**不要为构建去杀用户的 dev 进程**（那是桌面 CDP 验证的通道）。
> 2. **`adb shell am start` 无法模拟 SAF**：Android 的 URI 授权只能由真实 App 经
>    `FLAG_GRANT_READ_URI_PERMISSION` 给出，adb shell（UID 2000）没有这个能力。用真实文件管理器点一次来验证，
>    别在这上面耗轮次。


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
  （触屏收不到 mousemove）。**✅ 真机已测清（rev67，2026-10-13）**：长按**能**触发 `contextmenu`
  （387 ms，与鼠标右键同一套菜单）· 多选**功能在但手机无入口**（入口是 Ctrl/Cmd+click、Shift+click）·
  返回键接管**早已实现**（`onBackButtonPress` 逐层关，`App.tsx:2190-2251`）；
  **唯一缺口**＝菜单打开时会直接 `exit(0)`（菜单层不在那条链里）
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

- [x] **⑧ `net` 授权通道** ✅（2026-10-12 下午）→ **🖤 已整套下线（rev66，用户裁决「清掉」）** ——
      当年做的是设置页逐插件开关 + `.zn/permissions.json` + 契约 §4 诚实改写；2026-10-13 拆权限门
      后前端先停读，本轮把**前端文件 + Rust 两条命令 + `invoke_handler` 两行 + 两个单测**全删。
      ⚠️ 当年那条"授权记录不绑定插件指纹"的顾虑**随删除一并消失**（不再有授权记录）。
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
   - [x] ~~**触屏多选**（缺 Ctrl/Shift）、**长按能否触发 contextmenu**、**返回键接管**~~
         → **2026-10-13 rev67 真机测清**：长按 ✅ 可用 · 多选 ⚠️ **功能在、手机无入口**（待产品决策）·
         返回键 ✅ **早已接管**（`App.tsx:2190-2251`）· 🆕 缺口：**菜单打开时按返回键 → 直接退出应用**

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
