# ZeroNote 交接卡（当前状态）

> **最新：rev173.334（2026-11-02 22:5x）—— 真人测试8（6 条：3 条已修 / 3 条待信息）**
> 来源 `ZreoNote/测试文件/真人测试8.md`（5 条）+ 用户追加 1 条（图片读不出）。
>
> **✅ 已修（提交 6d12484 / 422427b，自动化全绿，待真机）**
>
> | # | 用户原话 | 改法 |
> |---|---|---|
> | ① | 历史版本移动端不放在上面放底部；底部快捷栏只在键盘弹出时显示 | `App.tsx`：新增 `keyboardOpen`（`visualViewport` 高度差 >120px）；`editor-topbar` 面板（历史版本）从顶部挪进底部 `MarkToolbar`；该栏改为 `platform==='android' ? keyboardOpen : toolbarPanels.length>0` 才渲染 |
> | ② | 续传点「继续下载」又报「上一次下载还没结束」但进度在涨 | Rust 新增 `cancel_apk_download`（`APK_DOWNLOAD_CANCEL`），下载循环每 chunk 检查；前端点下载前先取消旧任务 + 等 300ms；抢到闸时清零标志 |
> | ③ | 长按动画编辑界面也触发、编辑界面不需要松手触发 | 编辑区**到 300ms 直接弹四键条**（不再等松手），去掉编辑区涟漪（保留振动）；文件树仍松手触发（拖拽时收菜单，rev173.320 已有）；删 `pressAt` 与 `spawnRipple` 引用 |
>
> **⏳ 待信息（3 条，都缺一手证据）**
>
> | # | 结论 | 还缺什么 |
> |---|---|---|
> | ④ 手机分享没带图片 | 分享逻辑在 `import-export` 插件（≥0.2.2 才内嵌图片 → `share_file`）—— 若手机装的是 0.2.0/0.2.1，就是旧插件 | 插件中心里 `import-export` 的版本号 |
> | ⑤ 桌面复制仍失败 | **已实测排除实现问题**：独立探针（与 `winclip::copy_files` 同逻辑）写入 CF_HDROP 后 `DragQueryFileW` 读回成功 ⇒ Rust 侧正确 | 桌面插件 `import-export` 版本；点「复制」后有没有报错 toast |
> | ⑥ md 里图片都读不出 | 子 agent 只读调查 3 个根因：① `@atomic-editor` 图片块正则只认「整行 + 路径无裸空格」，`![](我的 图.png)` / `![[x.png]]` / `<img>` **静默不渲染**（patch：`patches/@atomic-editor__editor@0.6.2.patch`）；② `MarkdownEditor.tsx:136` 候选为 0 时直接 `continue`、不挂「图片不在本机」提示；③ 附件没同步到位 | **那篇笔记里图片那一行的原文**（或库路径）—— 含空格/wiki 嵌入 ⇒ ①；普通 `![](a.png)` 点不亮 ⇒ ②；库里没图 ⇒ ③ |
>
> **23:02 用户三条回答（把 ④⑤⑥ 收窄了）**：
> · ④ **不是插件版本问题** —— 桌面与手机都是 `import-export` **0.2.2**。
> · ⑥ 原文修正：「图片渲染了，但是我复制出来、粘贴过来的 md 文件里面没有」⇒ 图片**在编辑器里显示正常**，
>   丢的是**导出/复制出来的 md 内容**。新线索：`examples/import-export/index.js:860` 的 `scanImageRefs`
>   正则 `(<[^>]*>|[^)\s]+)` —— 路径含**空格**或 `)` 就匹配不上；匹配不上时 `rewriteImageRefs` 会**原样保留**引用
>   （:885），所以「md 里完全没有」更可能是**引用本来就没被写进正文**（粘贴导入时丢了），需要那篇的原始文本才能定。
> · ⑤ 更怪：桌面点「复制」**显示成功**，但剪贴板里还是**上一次复制的图片**。探针已证明 `winclip::copy_files`
>   写入/读回正常 ⇒ 可能是插件走了 fallback（复制文本）却提示成功，或写入后又被别的剪贴板管理器覆盖。
>   **下一步必须 dev 实测**：启动桌面 dev → 调 `copy_file_to_clipboard` → 用 `Get-Clipboard`/拖拽验证。
>
> **23:07 定案（④⑥ 同一个根因，已修并发插件）**：用户给出 `.zn/share/真人测试8.md` ——
> **761 字节、4 个 `![]()`、0 个 `data:`**，与原文等长（完全没内嵌）。根因：笔记在 `测试文件/`、
> 图在**库根**；编辑器渲染有两候选（笔记目录 → 库根，rev173.325），但导出 `locateRef` 只按
> 笔记目录解析 ⇒ 读不到图 ⇒ 保留原引用。已在 `embedOneImage` 补库根兜底（<1MB 内嵌原图、
> >1MB 走压缩图）；**`import-export` 0.2.3 已签名入库**（keyId `aqua-2026` · 整包 sha256
> `63612c69…` · 市场索引 14 条）。手机与桌面插件中心更新到 0.2.3 即生效。
> **⑤ 已实测证伪「复制失败」**：`probe read` 读到剪贴板里就是
> `C:\Users\AQUA\Documents\ZreoNote\.zn\share\真人测试8.md`（CF_HDROP count=1）⇒ 复制正常；
> 用户是粘到了**不接受文件列表**的输入框/图片位（资源管理器里 Ctrl+V 才出文件）。
>
> 验证：tsc 0 · oxlint 4 warnings · vitest **1799 全绿** · cargo check 0（4 warnings 基线）· import-export 54 条。
> **已发版 0.9.20**（tag `v0.9.20` · 5 资产 · APK 33.2 MiB · sha256 `0c752129…` · 构建 7m16s）。
>
> **上一轮：rev173.333（2026-11-02 21:1x）—— 0.9.18 上真崩了：右抽屉新建合成层（nubia HWC）**
> 用户 21:14 报告：环境 **0.9.18** · `原因：原生崩溃（SIGABRT）` · abort =
> `FORTIFY: pthread_mutex_lock called on a destroyed mutex (0x77fae02af8)`；崩溃线程 `FenceMonitor`，
> 栈全在 libc / libc++ / libgui，`libzeronote_lib.so` **0 命中** —— 与 13:xx 那 6 份 tombstone 同型。
> **触发面（用户原话）**：「右侧更多准备点插件中心准备插件」⇒ 打开右抽屉 = 条件渲染新建
> **遮罩 + 抽屉两个全屏 fixed 合成层** + 入场 animation。
> **看门狗修复是有效的**：这份是 crash、不是 exit 101 —— 老问题原被 5 秒误杀掩盖，现在浮出来了。
> **改法**：右抽屉改**常驻挂载**（与左抽屉 0.9.15 的写法一致）—— `setMoreOpen` 只切开关；
> 遮罩走 `.zn-scrim.is-drawer`、抽屉走 `.zn-more-drawer.is-open`，关闭态 `visibility: hidden` 退出合成；
> 340ms 改由 CSS transition 播（删 `DRAWER_MS`）；`MobileMoreDrawer` 的 `closing` prop → `open`
> （关闭态 `aria-hidden`，测试按展开态渲染）。
> 验证：tsc 0 · oxlint 4 warnings · vitest **1799 全绿**（drawer 8 + app-smoke 6 相应改写）·
> **已发版 0.9.19**（tag `v0.9.19` · 5 资产 · APK 33.26 MiB · sha256 `65e4f6f0…` · 构建 8m41s）。
> ⚠️ **待真机**：装 0.9.19 后连开右抽屉 10 次。
>
> **上一轮：rev173.332（2026-11-02）—— 手机「进软件就弹异常退出」= 看门狗误杀，不是崩溃**
> 用户带来 5 份 0.9.16 报告（18:47:23 / 20:42:25 / 20:42:35 / 20:42:48 / 20:43:19），全部
> `原因：看门狗判定卡死（exit 101）`、**无 tombstone**。判据链：0.9.15 起看门狗走 `libc::_exit(101)`
> ⇒ 系统记 `REASON_EXIT_SELF`；0.9.16 的 crashlog 才把「看门狗 exit」纳入可报告 ⇒ 弹窗就是它。
> **决定性证据**：仓库 `_tmp-phone-backup/watchdog.log`（真机拉下来的）**42 条 gap 全部落在
> 5007–5962 ms** —— 主线程还活着，只是 Android WebView 的 `setInterval` 被系统节流成 5–6 s 一次。
> 单段 5 s 判据在这种设备上必然误杀（代价 = 应用直接退出、未保存内容丢失）。
> **改法**：① 二段确认（超时 ⇒ 只记疑似；再 10 s 无心跳才 `_exit(101)`）② 启动宽限 20 s
> ③ 心跳前每秒自检 `visibilityState`（不可见只 pause、不发心跳）④ `zn_watchdog_status` 增
> `confirmMs` / `startupGraceMs` / `startedAgoMs` 便于下次取证。
> 验证：tsc 0 · `cargo test --lib watchdog` 2 条（含 5962 ms 节流样本）· **已发版 0.9.18**
> （tag `v0.9.18` · 5 资产：setup.exe + .sig / msi + .sig / arm64 APK 33.26 MiB · sha256 `bbf52e27…`；
> 构建 8m29s = 桌面 4m01s / Android 4m28s；清单 `57ae7ad`）。⚠️ 真机复验待用户装包。
>
> **上一轮：rev173.331（2026-11-02）—— 真人测试7 五条已修完（自动化全绿，待人眼复验）**
> 来源 `ZreoNote/测试文件/真人测试7.md`（5 条；引用的 image-20261102-184911.jpg 没随文件带来）。
>
> | # | 用户原话 | 改法 | 证据 |
> |---|---|---|---|
> | ① | 涟漪不够明显、好像松手才触发、没有振动 | 触发时机**本来就对**（五入口 500ms 定时器里就 `hapticTick + spawnRipple`，松手才弹菜单）；问题在视觉与振动通道：涟漪 **14px/620ms → 26px/880ms + 描边 + 外发光 + 35% 处先扩到 1.9×**；振动改**原生命令** `plugin:statusbar\|vibrate` → Kotlin `Vibrator`（`navigator.vibrate` 在国产 ROM WebView 被忽略），失败才回退 | `long-press-feedback.ts` / `styles.css` · vitest **8** |
> | ② | 手机「更多 → 插件」里看不到同步插件 | 旧实现写死 tag-panel / import-export 两个 id；`sync` 面板在 `main` ⇒ 不出现，而手机没有常驻侧栏 ⇒ 插件无入口。改：**按已注册面板自动列**（`main` / `sidebar`，排除 statusbar/modal/editor-* 与 hidden） | `src/lib/more-plugin-entries.ts` · vitest **6** |
> | ③ | 文件树拖拽明显卡顿 | touchmove 每次 `elementFromPoint`（强制布局）+ 两次 setState（整树重渲染）⇒ **rAF 节流**（一帧一次）、**同值不 setState**、ghost 首次后直改 `style`、松手前补算最后一帧 | `FileTree.tsx` · file-tree-drag +1 |
> | ④ | 桌面「复制 md 文件」剪贴板还是旧内容 | 根因 `canonicalize` 产出 **verbatim `\\?\C:\…`**，`CF_HDROP` 不认；顺带 `OpenClipboard` 失败即放弃。改：`plain_path()` 剥前缀 + **重试 3×50ms** + 失败路径 `GlobalFree` | `lib.rs` · cargo `plain_path…` |
> | ⑤ | 桌面右键「在文件夹中打开」只开了默认位置 | 同一根因：`explorer /select,"\\?\…"` 被忽略。改：剥前缀后再 `raw_arg` 拼（官方 opener 同款写法） | 同上 |
>
> **追加修复（真机复验时发现 · 同轮）—— 文件树触摸整条失效**
> 用户：「移动端文件树栏，拖拽完全不起效果了，长按也不触发任何动作」「加号长按可以触发涟漪，就是文件树栏无效」。
> **根因不在新代码**：`FileTree` 的触摸 effect 依赖 `[]`，而手机冷启动第一帧 `.zn-tree` 还没渲染
> ⇒ `rootRef.current === null` ⇒ effect 直接 `return` 且**永不重跑** ⇒ `touchstart` 监听器一次都没绑上
> （连带长按无涟漪、拖拽不动、菜单不弹；＋ 的长按走 App.tsx 另一条路，所以正常）。
> 真机证据（`adb logcat` 的 `Tauri/Console`）：`[znt] effect run, root= false`，之后 touchstart 从未触发。
> 修法：`callback ref`（`bindRoot`）把「元素出现/消失」变成 state，effect 依赖 `[rootEl]` ⇒ 元素一挂上就绑；
> 顺带清掉遗留的 `rootRef` 早退路径。**真机复验**：长按文件行弹完整菜单（新建文件 / 剪切 / 重命名 /
> 详细… / 在文件夹中打开 / 删除 / 多选 / 导出 / 分享）。⚠️ 这类「effect 只跑一次 + ref 可能为 null」的坑
> 对任何常驻挂载组件都成立，写新组件时别再抄 `useEffect(..., [])` + `ref.current` 直接判空。
>
> **追加修复 2（同轮）—— 长按阈值 500 → 300ms**
> 用户：「长按时间做成 300ms，500 太长了」。阈值原来在四个文件各写一份 `500`（`FileTree` / `TitleBar` /
> `MobileNoteCards` / `App.tsx` 编辑区四键条），现在统一为 `lib/long-press-feedback.ts` 的 **`LONG_PRESS_MS = 300`**；
> `FileTree` 的拖拽上膛 `ARM_MS` 240 → **150**（必须明显小于长按阈值，否则「按住 150–300ms 再拖」会被判成长按）。
> **真机验证**：350ms 长按 ⇒ 弹条目菜单 ✓；200ms 短按 ⇒ 直接打开笔记、不弹菜单 ✓。
>
> **验证基线**：tsc 0 · vitest **1798** · cargo test **97** · oxlint 4 warnings（见 `scripts/.verify-baseline.json`）。
> ⚠️ **未做**：①③ 只能真机看手感；④⑤ 只能桌面实机点一次 —— 装新包后请重点复验这四条。
> 未发版（0.9.17 待定）；`sync` **插件本身没动**（②只改了宿主）——
> ⚠️ 原句「`sync` 0.1.8 未打包」是笔误（2026-11-02 21:10 核实更正）：仓库里**没有 0.1.8**，
> `examples/sync/manifest.json` / `market/entries/sync.json` / `market/packs/sync-0.1.7.znp` 三处都是 **0.1.7**。
>
> **上一轮（rev173.330）**只做调查、没改代码；根因与本次实际改法的对照见 `HANDOFF.md` 的 rev173.331 段。
>
> **rev173.329（2026-11-02 18:54）—— 闪退日志不再丢（0.9.16）**
> 用户装 0.9.15 后闪退一次、**没有崩溃日志弹窗**。根因在我们自己：0.9.15 把看门狗改成
> `libc::_exit(101)`，退出原因变成 `REASON_EXIT_SELF`，而 crashlog 的 `isCrash` 只认三种 crash
> ⇒ 证据被静默丢掉（不是插件坏了）。
> **修法**：新增 `isReportable` 收录 **ANR / 低内存回收 / 看门狗 exit(101)**（用户主动退出、
> SIGKILL 滑掉仍不打扰）；命令返回新增 `isCrash` / `kind`（crash/anr/lmk/watchdog）/ `exitStatus`；
> 弹窗按 kind 分文案（看门狗 →「上次被看门狗终止」），导出报告标题区分「崩溃报告 / 异常退出报告」
> 并附退出码。**验证**：tsc 0 · vitest **1788 全绿** · arm64 APK 构建。
> ⚠️ **未验证**：0.9.15 的遮罩 `visibility` 修复到底有没有止住 nubia 闪退 —— 0.9.15 上仍崩过一次，
> 但那次没有 tombstone（很可能就是看门狗 `_exit`）。要等 0.9.16 装上后再崩一次、拿到 kind 才能定。
>
> **rev173.328（2026-11-02）—— 手机闪退根因：左抽屉遮罩的常驻合成层（0.9.15）**
> 用户「12也会闪退」「12之前没触发过」定死了分界。6 份 tombstone（13:13:20 / 13:49:16 / 13:49:31 /
> 13:50:33 / 14:03:32 / 14:03:42）复盘：
> · 崩溃栈全在系统库（`libgui::FenceMonitor` / `libhwui` / `WebViewFunctor`），abort message 都是
>   `FORTIFY: pthread_mutex_lock called on a destroyed mutex (0x761f402af8)` —— **同一个地址**，
>   即系统库里的全局 mutex（app 从 zygote fork ⇒ 系统库加载地址在所有进程里相同），不是我们的内存。
> · **触发面 = 0.9.12 的 `81e1f62`**：左抽屉遮罩从条件渲染改成「常驻 + opacity 过渡」——
>   Chromium 会为全屏 `fixed` 元素保留常驻合成层（`pointer-events: none` 不影响合成），nubia 的 HWC
>   每次页面重绘都要重新合成它 ⇒ 撞上系统层的生命周期竞态。0.9.11 时遮罩关闭即卸载，所以不崩。
> · `13:49:31` / `14:03:42` 两份还带出**看门狗自杀**：`spawn_watchdogs` → `std::process::exit(101)`
>   → `exit()` → `__cxa_finalize()` → `WebViewFunctorManager::~WebViewFunctorManager` →
>   `destroyContext` → `eglDestroyContextImpl`，渲染线程还在 `condition_variable` 上等 ⇒ 已销毁 mutex。
>   `std::process::exit` 不跑 Rust 的 `Drop`，**但会跑 C++ 全局析构** —— 文档 §2.2 原说法是错的。
> **0.9.15 改了两处**：① 遮罩关闭态 `visibility: hidden` —— 元素不参与合成、层真正消失；淡出仍由
> opacity 播，visibility 用 transition-delay 延到淡出结束，动画节奏不变。② 看门狗 → `libc::_exit(101)`
> （跳过 atexit / 静态析构，直接 exit_group）。
> **验证**：tsc 0 · cargo check 0（4 warnings = 基线）· Cargo.lock 0.9.15 · 真机验证待用户装 0.9.15。
> 测试机（Redmi 24069RA21C / Android 16）装 0.9.14 release **复现不了** ⇒ 崩溃是 nubia 特有，
> 但触发面是我们引入的，所以可修。
> ⚠️ **证据完整性**：crashlog 插件原先把 trace 截到 **64 K 字符**，而 6 份真机 tombstone 原始长度
> **45–48 万字符** ⇒ 只看得到前 13.7%，**看门狗线程块按 tid 排序靠后时被整段截掉**，所以
> 「4 份没有 watchdog」可能是假象 —— 已把上限提到 **512 K**（`CrashLogPlugin.maxTraceChars`）。
> 下次崩溃务必用 0.9.15+ 重新导出，拿完整线程链再定论。
>
> **rev173.327（2026-11-02）—— 崩溃日志可导出（0.9.14）+ 闪退根因已抓到（系统层）** ⚠️ **rev173.328 更正：不是纯系统层，触发面是 0.9.12 的左抽屉遮罩**
> 用户原话：「每次崩溃应该把崩溃日志复制到剪贴板上面，现在的版本都没有崩溃日志」→「每次崩溃直接导出崩溃日志，我转发就可以了」。
>
> **① 闪退根因（2026-11-02 13:11 抓到完整 tombstone）** —— **不在我们的代码里**：
> nubia `NX741J` / Android 16 / WebView 140.0.7339.207。崩溃线程 `HWC release`（tid 15066），栈：
> ```
> #02 bionic  HandleUsingDestroyedMutex
> #03 bionic  pthread_mutex_lock          ← FORTIFY 检测到 mutex 已 destroy
> #04 bionic  pthread_cond_wait
> #05 libc++  condition_variable::wait
> #06 libgui  android::gui::FenceMonitor::threadLoop()
> #07 libgui  android::gui::FenceMonitor::loop()
> ```
> 全是系统库（`libc` / `libc++` / `libgui`），**没有一行 `libzeronote_lib.so`**；`am_crash` 记为
> `Native crash, Aborted`。`FenceMonitor` 是硬件合成器（HWC）的 fence 线程 —— 打开一个**新的合成层**
> 就会撞上它的生命周期竞争。实测触发面：点 ☰ 开左抽屉 / 长按 ＋ 开环形菜单 / 点卡片进编辑页 ——
> **都崩**；滑动列表、静止不动 —— 不崩。⇒ 不是"抽屉功能坏了"，是**任何页面/浮层转场**都触发，
> 属该机型系统层（HWC / SurfaceFlinger / Adreno）问题，我们改前端治不了。
> ⚠️ **对照实验没做成**：这台机的 adb 安装被中兴策略拦截（`AntiBrushingZteHook.isAllowAdbInstall`
> → `SecurityException: Caller has no access to session -1`），装不了 0.9.12 / 0.9.9 做版本对照。
> ⚠️ 用户 2026-11-02 明确要求「**不要在非测试机上面进行各种操作**」—— 这台 nubia 别再点、别再装包；
> 本轮已把动过的系统动画缩放恢复原值（`animator=null / transition=1.0 / window=1.0`）、删掉 push 上去的 APK。
>
> **② 本版做的事（0.9.14 · rev173.327）：崩溃日志能导出了**
> 原生崩溃当下进程已死、JS 跑不了 ⇒ 只能在**下次启动**读系统记录：新插件
> `src-tauri/plugins/tauri-plugin-crashlog/`（Rust + Kotlin，与 statusbar 同构）调
> `ActivityManager.getHistoricalProcessExitReasons()`，原生崩溃时拿 `getTraceInputStream()` 的
> **tombstone 全文**（不需要 root），并**直接导出**成
> `Download/ZeroNote-crash/zeronote-crash-<崩溃时刻>.txt`（同一次崩溃同名覆盖，不堆垃圾）。
> 前端 `src/lib/crash-log.ts` + 首页弹窗：显示时间 / 原因 / 环境 / 文件路径 + 预览，
> 按钮「**转发日志文件**」（走 `plugin:share|share_file`）与「复制文本」兜底；
> 用 `localStorage['zn-crash-handled-ts']` 按时间戳去重，同一个崩溃只提示一次。
> 桌面返回 `found:false`（没有这条通道，不报错）。测试：`tests/crash-log.test.ts` 10 条。
>
> **③ 下一步**：装 0.9.14（应用内更新，不经 adb）→ 再复现一次闪退 → 下次打开会弹「上次运行异常退出」，
> 那个 txt 就是可以转发的证据。拿到 txt 后再决定：换 WebView / 等系统更新 / 找中兴反馈。
>
> **rev173.326（2026-11-02）—— 手机 0.9.13 打开侧栏闪退（诊断中）**
> 用户原话：「手机现在一打开左栏或右栏，一下子就会闪退」。追问确认：**另一台手机装的 0.9.13 release 包**，
> 表现是 **App 直接消失回桌面**（不是白屏、不是 ANR），左右两个抽屉都触发（左侧文件树 + 右侧「更多」）。
> 本会话排查（**都还没证到根因**）：
> · **调试机 `33b676f6` 复现不了**：上面是 `com.aqua.zeronote.debug`（壳 0.9.11 + 连 vite 1420 的最新源码），
>   左抽屉实测正常；另一个 `com.aqua.zeronote` 是 **0.1.0 老包、只装在 user 10（安全空间）** ⇒ `adb install -r`
>   报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`（签名冲突），0.9.13 装不上。
> · **桌面复现不了**：`isDesktop = kernel.host.platform !== 'android'`，移动布局只在 Android 生效；
>   窗口缩到 600px 也不切（另外 `minWidth: 720` 挡着）。
> · **没拿到崩溃证据**：`adb logcat` 无 `FATAL EXCEPTION` / `panic`；`dumpsys dropbox` 只有 VirusScanHistory。
> · **被中止的路**：为绕签名冲突试 canary（`applicationId` 加 `.canary` + `ZN_CANARY=1`），
>   `npm run tauri android build -- --apk` 跑 **30 分钟无产物**（rustc/gradle 长时间占 CPU）⇒ `job_kill`；
>   **临时改动已还原，工作区干净**。要重走：把该行改成 `"com.aqua.zeronote" + (if (System.getenv("ZN_CANARY") == "1") ".canary" else "")`。
> ⚠️ 也踩了「硬约束 7」：安卓测试机不重编译/不装 release 包 —— 这次为复现去装 0.9.13，被签名挡住也就没成。
> **下个会话第一件事 = 抓崩溃日志**（用户已同意「手机连 USB 线」）：
> 1. 崩溃那台手机开「开发者选项 → USB 调试」，线插电脑，`adb devices` 出现新序列号；
> 2. `adb logcat -c` → 用户打开左栏/右栏复现 → `adb logcat -d` 里找 `FATAL` / `RustStdoutStderr` / panic（原生崩溃常无 Java 栈）；
> 3. 有栈再决定：JS（错误边界）/ Rust（`entry_info` 等）/ WebView GPU。
> 仍未做：`sync` 0.1.7 墓碑双端验证、rev173.325 五条真机复验。
>
> **rev173.325（2026-11-02）—— 真人测试6 五条**（用户转来 `ZreoNote/真人测试6.md` + 4 张截图）：
> ① **附件断链**：图片按「笔记所在目录」写相对路径，笔记一移动就断（用户实测「移回原位正常」）。改法：
> 插入时改写成**完整库内路径**（`视频/a.png`，不带前导 `/` —— 避免被 `isLocalAbsPath` 误判成库外原文件），
> 渲染解析给**两候选**（笔记目录 → 库根），全失败才显示「图片不在本机」。
> ② **编辑页偶发全白、输入不落地**：`--zn-viewport-h` 直接吃 `visualViewport.height`，键盘动画期间会瞬时变 0/几十 px ⇒
> `.zn-app` 塌掉。改法：**低于 200px 不写**；编辑器挂载后 300/1200ms 各量一次，容器高度为 0 就 `requestMeasure()` 自愈。
> ⚠️ 未稳定复现（真机 3 轮没撞上），这两处是防御性修复 —— 再出现时先看 `--zn-viewport-h` 的值。
> ③ **长按无反馈**：五个长按入口（文件行 / 卡片 / ＋ / ☰ / 编辑区四键条）到 500ms 时**振一下**（`navigator.vibrate`）
> + 按下点**涟漪**（新 `src/lib/long-press-feedback.ts`）；AndroidManifest 加 `VIBRATE` 权限。真机长按菜单回归正常（截图 `_shots` 待补）。
> ④ **同步删除墓碑**：桌面首次连同步把手机删掉的老文件**重新上传**（旧逻辑：本地有 + 远端无 = 新笔记）。改法：manifest 新增
> `deleted` 段（删除时写墓碑 30 天），同步时「本地 mtime ≤ 墓碑 ⇒ 跟删（进回收站）；> 墓碑 ⇒ 保留上传并清墓碑」。
> **右键菜单**加「详细…」（新原生命令 `entry_info`：大小 / 创建 / 修改 / 路径）与「在文件夹中打开」（`reveal_in_explorer`，手机端如实报不支持）。
> ⑤ **桌面分享 = 复制文件**：旧行为把整篇 Markdown（含 `data:` base64 图片）塞进剪贴板 ⇒ 粘出来一大串文件流。改法：新原生命令
> `copy_file_to_clipboard`（Windows CF_HDROP）+ `import-export` 桌面 md 分享改为**复制 `.md` 文件本身**（旧包自动退回复制文本）。
>
> 验证：tsc 0 · oxlint 4 warnings（= 基线）· **vitest 1761 → 1777** · `cargo test --lib` 96 · 质量门 8/8。
> **0.9.13 已发版**（2026-11-02 · tag `v0.9.13` · Release 5 资产：`ZeroNote_0.9.13_x64-setup.exe` **15.09 MiB** +
> `ZeroNote_0.9.13_x64_zh-CN.msi` **17.01 MiB** + `ZeroNote_0.9.13_arm64.apk` **33.18 MiB** + 两个 `.sig`；构建 **11 分 04 秒**
> （桌面 5m03s / Android 6m01s））；`sync` **0.1.7** / `import-export` **0.2.2** 已签名入库（市场 14 条 · `verify-trust` 53/54）。
> ⚠️ 市场插件**不自动升级**，要到「插件中心 → 插件市场 → 更新」手动点；`sync` 墓碑要**双端都升到 0.1.7** 才生效。
>
> **最新：rev173.324（2026-11-02）—— 应用更新面板：装完新版还提示安装 / 断点续传卡在旧版**（用户真机实测）：
> `loadLastCheck()` 存的是**检查那一刻**的结论，应用升级后没作废 ⇒ 一直显示旧版「发现新版本 / 已下载完成」，
> 且「发现新版本」态没有重新检查入口。改法（只动前端）：`currentVersion !== appVersion` ⇒ 旧结果作废、idle 自动重查；
> 缓存/断点只在 `latest > current` 时认；「发现新版本」加 **重新检查** 按钮。新增 5 条组件测试（vitest 1761）。
>
> **rev173.323（2026-11-02）—— 左抽屉动画补齐：根因是「条件渲染」**（用户「做侧栏唤出收回都比右侧栏快，右侧栏效果很好」）：
> 真机 rAF 采样证实**左抽屉原本根本没有动画**（7ms 无 DOM → 54ms 已是 `translateX(0)`，零中间帧）；根因是
> `showSidebar = sidebarAllowed && (isDesktop || sidebarOpen)` 条件渲染、挂载即带 `is-open` ⇒ `transition` 没有起点。
> 改法：`showSidebar = sidebarAllowed`（手机也**常驻挂载**，关闭只是 `translateX(-100%)` 挪到屏外，文件树状态顺带保住）；
> `box-shadow` 挪到 `.is-open`（否则屏外阴影从左缘漏 24px）；左遮罩改 `.zn-scrim.is-sidebar` **常驻 + `is-open` 过渡**。
> 真机复测：开 34ms -300 → 375ms 0 · 关 0 → 46 → 180 → 239 → 288 → 300 · 遮罩 opacity 0↔1 各 ≈340ms。证据 `_shots/rev323-01..02`。
> **0.9.12 已发版**（2026-11-02 · tag `v0.9.12` · Release 5 资产：exe 15.80 MB + msi 17.82 MB + APK 34.80 MB + 两个 `.sig` · 清单已入库）。
>
> **rev173.322（2026-11-02）—— 两侧抽屉动画补齐，统一 340ms**（用户先问「移动端左右侧栏划出时有动画效果吗」，
> 答完"右抽屉硬切、遮罩无过渡"后说「补，然后时间拉到340ms」）：新 token `--zn-dur-drawer: 340ms`；
> **右抽屉补退场**（`moreOpen` 拆成 open + closing，播完 `zn-more-out` 才卸载）· **遮罩淡入淡出** ·
> 左抽屉 220 → 340ms。真机用页面内 `requestAnimationFrame` 逐帧采样验过（transform 0→301px / opacity 1→0→卸载）。
>
> **rev173.321（2026-11-02）—— 手机长按统一改成「松手才触发」**：五个入口（文件行菜单 / 卡片菜单 /
> ＋ 环形快捷入口 / ☰ 主菜单 / 编辑区四键条）**按住期间什么都不弹，抬起才出结果**（≥500ms 且位移 <10px）。
> 真机逐条验过，拖拽回归正常。这条直接治 rev173.320 的病根 —— 长按瞬间弹的菜单会遮住还没结束的手势。
>
> **rev173.320（2026-11-02）—— 手机拖拽失败的根因**：Android 按住 ~500ms 会派发 `contextmenu`，
> 行的菜单 + **全屏遮罩**弹出来；用户「按住再拖」慢半拍就变成**在遮罩上拖** ⇒ 落点永远判不出来
> （CDP 探针实测：真实触摸的每次 `elementFromPoint` 都返回 `.zn-menu-scrim`）。改法：**拖拽一开始就
> `setMenu(null)`**，落点判定命中遮罩时再收一次、本帧不判。三条落点规则用 `adb input motionevent` 真机逐条验过。
>
> **rev173.319（2026-11-01）—— 拖拽落点规则**：拖到**文件树栏内空白** ⇒ 放到**库根**；
> 拖出**栏外** ⇒ 不做动作（松手即取消）；目录行 / 文件行 / 自己或子目录的老规则不变。
> 落到根时整栏蓝描边提示（`.is-drop-root`）。测试 **1752 → 1756**（`file-tree-drag` 4 条），桌面 dev 实测过。
>
> **rev173.318（2026-11-01）—— 多选改成「每行一个勾选框」**（用户看完 317 的真机效果后改口）：
> 多选态**不占布局**，行首 ● / ▾ 换成勾选框；**勾文件夹 = 连带里面全部条目**；
> **取消其中一项 ⇒ 文件夹自动变回未勾、其余文件保持勾选**（祖先目录一并取消）。
> 批量操作与「退出多选」都在长按 / 右键菜单（删除选中的 N 项 · 彻底删除 · 移入… · 退出多选）。
> 测试 **1747 → 1752**；桌面 dev 与真机都验过。
>
> **rev173.317（2026-11-01）—— 真人测试5 五条全修**（用户转来 `Downloads/真人测试5.md`）：
> ① **多选残废** —— 菜单的全屏遮罩吃掉后续点击 + 选到 2 项自动弹菜单盖住列表；改成「点多选 → 关菜单 → 列表可连续点」，点行只加/减选、永不自动弹菜单。⚠️ *「顶部批量栏」已被 318 换成勾选框*。
> ② **双层菜单** —— `FileTree` / `App` / 卡片各有独立 menu state；互斥收进 `ContextMenu` 原语（新菜单挂载即关上一个），调用点一行不改。
> ③ **时间流长按** —— 卡片禁选字（`user-select:none` + `-webkit-touch-callout:none`）；**手机端不再弹桌面式主菜单**。
> ④ **抽屉只在首页** —— `drawersOpenOnlyOnHome()`；抽屉开着时只认关闭，左右两个抽屉方向互斥（不再叠两层）。
> ⑤ **拖拽归类** —— 新增**触摸拖拽**（按住 240ms 后移动；240ms 内移动 = 滚动，直接放弃）；桌面多选拖不动是 ② 的遮罩导致。
> 测试 **1741 → 1747**；真机（24069RA21C · debug）逐条验过，含「移入…」与触摸拖拽把文件搬进 `归档/`（磁盘核对）。
>
> **rev173.316（2026-11-01）—— 真机 HMR 连不上已修**：`vite.config.ts` 只注入了 `hmr.host`、没注 `port` —— 手机页面 origin 是 `http://tauri.localhost/`（**无端口**），vite 客户端据此拼出 `ws://<ip>:/`，HMR 永远连不上（服务端照样打印 `[vite] (client) hmr update`，极易误判成「推了没生效」）。现在 `{ host: hmrHost, port }` 一起钉死；用 CDP 逐次读计算样式验证：改 CSS 1–3 秒后生效、删掉后恢复。**手机 dev server 用 `pnpm dev`（只起 vite）**，别用 `dev.ps1`（它会起桌面 tauri，被桌面上跑着的 0.9.9 单实例踢掉、连带把 vite 也结束）。
>
> **rev173.313（2026-11-01）—— 手机应用内更新下载的 APK 校验不过已修**（同一时刻只许一个下载任务 / 续传核对 `Content-Range` 起点 / 长度严格相等 / 校验失败换路从零重下 / 缓存里「看着下完」的包也复核 sha256）。实测排除：Release digest = 清单 = 本地产物三处一致，手机 `curl` 整包与分段拼接 sha256 均正确 ⇒ 问题在客户端并发写同一个 `.part`。**0.9.11 已发布**（Release `v0.9.11` · 5 资产 · APK sha256 `acf2ecf7…`）；用户手上的 0.9.9 / 0.9.10 更新页仍可能报同样的校验失败（旧代码），手动下一次 0.9.11 之后就好了。
>
> **同版还有：「更多」页一页两壳**（rev173.313）—— 桌面浮窗（`Settings`）/ 手机右侧栏（`MobileMoreDrawer`）共用同一份内容（`SettingsSections`）与同一张 8 项条目表（`components/more-items.ts`：搜索 / 回收站 / 切换库 / 插件中心 + 通用 / 附件 / 插件 / 关于）。手机点设置分组**在栏内钻入**（单栏 + 返回），不再弹设置浮窗；`Ctrl+,` / ☰ / 环形入口 / 缺图提示全部走 `openMore()`；名字统一改「更多」。测试：`mobile-more-drawer` 重写 8 条 · `app-rail` 改标签。
>
> **rev173.314（2026-11-01）：手机返回键按「上一层」走** —— 从抽屉钻进的整页/浮层（搜索 · 回收站 · 插件中心 · 插件面板 · 切库面板）返回先回抽屉（背景复位主页）；模态 Dialog 也纳入返回键（先派发 Escape）。真机逐条验过。
>
> **rev173.315（2026-11-01）：条目去重** —— 删「设置 → 插件」，插件只留「插件中心」一条并挪进「设置」组；「启动时检查插件更新」搬进插件中心「已安装」tab。条目表现在是 3 组 7 项（笔记 3 · 设置 4 · 插件动态）。
>
> 最后更新 **2026-11-02（rev173.325 · 真人测试6 五条 —— 附件库根路径 / 长按振动+涟漪 / 详细+在文件夹打开 / 空白天顶防御 / 桌面分享复制文件 / 同步删除墓碑）** ｜ 细节与证据在 **`HANDOFF.md`**（只保留当前周期，rev173.125 起；0.2 / 0.3 / 0.4 已归档到 `docs/archive/handoff/`）｜ 提交数一律看 `git log`
> 本卡只放**当前状态**（目标 ≤ 120 行）；历史过程一律回 HANDOFF，不再在此重复。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.334 · 0.9.20 · 2026-11-02 |
| 测试基线 | vitest 1799 · cargo 97 · oxlint 4 warnings（2026-11-02） |
| 插件 | 市场 14 · 示例 39 |
| 文档 | README 现状 2026-11-02 · CHANGELOG 0.9.20 |
<!-- FACTS:END -->

## 是什么

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用（Tauri 2 + React 19 + Rust）。
一切功能靠插件：**全局目录** `<应用数据目录>/.zn/plugins/<id>/` —— 唯一位置（跨库共用；装卸＝放/删一个文件夹）。
内核 **12 原语 + 21 种 UINode + 6 个挂载位** + 真窗口 / 整窗接管 / 面板 DOM。

**内核自带**：文件树 · 回收站 · 搜索（增量索引 + 标签/目录/正则筛选）· 命令面板 · 多标签（`Ctrl+Tab`）与标签拆独立窗口 · 时间流 · 主窗口记忆 · 会话恢复 · 粘贴图片 · 全局替换 · Markdown 增强（数学 / 脚注 / Mermaid / 内嵌 HTML 白名单）· 白屏兜底。

**不预装任何插件**（`D-011`，rev173.259）：第一次启动是零插件，装插件走 插件中心 → 插件市场（或手动装 `.znp`）。
原来预装的 9 个（标签 · 反向链接 · 历史版本 · 导入导出 · 备份 · 同步 ×4）改为插件中心空态里的「**推荐优先安装**」；
大纲导图 · 文档阅读器 · 记账 · 米色主题 · 打卡 · 安全 / 密码库同样只走市场。

## 验收基线（以输出为准，不写死数字）

```powershell
pwsh -File scripts\verify.ps1
# 六步：tsc 0 错误 · oxlint src 0 error · cargo test --lib · check-docs · vitest · 质量门 8 项（facts / 依赖方向 / 本地链接 / 功能目录 / 键位表 / 市场索引 / 外部条目审查 / 文档锚点）
```

## 未决 / 下一步

> ### 📌 下个会话第一件事（rev173.325 · 2026-11-02）
>
> **发版已完成**（0.9.13 / `sync` 0.1.7 / `import-export` 0.2.2，见文首）。剩下全是**验证**：
>
> **真机验证仍欠**（三条新命令只能在装 0.9.13 的 debug/正式包上验）：
> ① 右键「详细…」弹窗字段正确；② 「在文件夹中打开」跳到资源管理器并选中；③ 桌面「分享 md」后，粘贴到文件夹 / 微信得到的是**文件**而不是一大串 base64。
> **`sync` 墓碑**要双设备实测：手机删一篇并同步 → 桌面首次连同步 ⇒ 那篇应消失（进桌面回收站），而不是被上传。
>
> **环境现状（交接时刻）**：vite **1420** 在跑（`pnpm dev`，手机 debug 包连它）·
> 手机 `24069RA21C`（`33b676f6`）debug 版 —— ⚠️ 本轮 `npm run tauri dev` 的 CDP 曾是 404（`/json` 不通），
> 真机调试走 `adb shell input` + `adb exec-out screencap`（本轮三条修改就是这么验的）·
> 桌面 dev：`npx tauri dev --config '{"build":{"beforeDevCommand":""}}'`（复用现有 vite），
> 与已装正式版抢单实例，只能开一个。
>
> ### ✅ 真人测试5 + 后续六轮全修（rev173.317–323 · 2026-11-01/02 · 真机 + 桌面 dev 实测）
>
> | rev | 内容 |
> |---|---|
> | 317 | 真人测试5 五条：多选入口、双层菜单（`ContextMenu` 全局互斥）、时间流长按禁选字 + 手机不弹桌面菜单、抽屉仅首页且互斥、触摸拖拽（按住 240ms） |
> | 318 | 多选改成**每行一个勾选框**（删顶栏）；勾文件夹连带里面全部条目；取消子项 ⇒ 文件夹变回未勾；批量操作与「退出多选」进长按菜单 |
> | 319 | 拖拽落点：**栏内空白 = 库根**、**栏外 = 不动作**；`.is-drop-root` 描边提示 |
> | 320 | 手机拖拽失败根因：长按弹出的菜单遮罩把落点吃掉 ⇒ 拖拽开始即 `setMenu(null)` |
> | 321 | **手机所有长按改成松手才触发**（文件行 / 卡片 / ＋ / ☰ / 编辑区四键条） |
> | 322 | 两侧抽屉动画补齐 340ms（右抽屉退场 + 遮罩淡入淡出 + 左抽屉 220→340） |
> | 323 | **左抽屉动画补齐**：根因 = 条件渲染（挂载即 `is-open`、transition 无起点）⇒ 常驻挂载 + 遮罩 `is-sidebar` 常驻过渡；真机实测开/关/遮罩 ≈340ms |
>
> 测试 1741 → **1756**；tsc 0 · oxlint 4 warnings（= 基线）· 质量门 8/8。证据 `_shots/rt5-*.png`。

> ### ✅ 真人测试4 两条已改（rev173.310 · 2026-10-31 · 双端实测通过）
>
> 用户报：① 手机导入导出面板「导出当前笔记」**永远显示"没有打开的笔记"** —— 根因是 `main` 面板占满主区时
> 编辑器**已经卸载**（契约 §2.2）；② 分享是纯文本，要的是**带图片的 markdown 文件**。
> **改法**：面板改三态 **首页（导出 / 分享两个入口）→ 选笔记（标题+目录+关键词筛选）→ 选格式**，
> 全程按 `path` 现读文件；分享默认 **Markdown 文件（图片内嵌 `data:`，落 `<库>/.zn/share/`）**，
> 经**新原生命令 `share_file`**（FileProvider `content://` + `EXTRA_STREAM`）交给系统分享面板；
> 另可分享**长图 PNG**（同样先内嵌图片）与纯文本。`import-export` **0.2.1** · 新增 11 条单测。
>
> **真机（24069RA21C · debug 包 22:29:50 重装）**：面板三态正常 · 选笔记只列 `note` ·
> 分享 md 弹系统面板 `test-photo.md` **85.3 KB**（1 张 `data:image` 内嵌）· 分享长图 PNG **76 KB** 带图。
> 证据 `_shots/rev310-01..04`（桌面）· `rev310-phone-01..07`（真机）。
>
> ⚠️ **还没发版** ⇒ 用户手上的**正式包 0.9.7 用不了文件分享**：`share_file` 是新原生命令，
> 要 0.9.8 才带。桌面 dev 插件是**开发版（无签名）**，已拷进
> `%APPDATA%\com.aqua.zeronote\.zn\plugins\import-export\`；手机 debug 包同插件在 `run-as` 的 `.zn/plugins/`。
> 发版顺序照旧：`release.mjs 0.9.8` → `pack-plugin import-export --key … --key-id aqua-2026`（0.2.1）→
> `gen-market --write` → `build-release.mjs` → `gen-update-manifest.mjs` → `gh release create` → commit `update/`。

> ### 📌 下个会话第一件事（rev173.309 · 2026-10-31）· 装上 0.9.7 走一遍手机端
>
> **0.9.7 已发版**（Release `v0.9.7` · 5 个资产）—— 内容 = rev173.308 的手机端改动（去底栏 + 右侧「更多」抽屉）。
> 用户手上还是 0.9.6，应用内更新能直接拉到。装完走一遍（约 3 分钟）：
>
> 1. 启动停在笔记流，**没有底栏**
> 2. **离最右边半个指头宽的地方往左滑** ⇒ 「更多」抽屉（⚠️ 别贴边 —— 贴边是 Android 系统返回手势，会把 App 退掉）
> 3. ☰ 左抽屉右滑仍正常，头部是 **⋯** 不是齿轮
> 4. 抽屉里六个条目各点一次，返回键依次回
>
> 另外仍欠一条端到端：**把系统代理指向死端口 → 关于页点一次「测速」** —— 验 rev173.306 的失败回退直连
> （0.9.6 起就带着这段代码，一直没验）。
>
> **环境现状（交接时刻）**：桌面 dev 在跑（`dev.cmd`，vite 1420 + CDP 9222，pid 17996，22:06 起）·
> 手机 `24069RA21C`（`33b676f6`）上装的是 **debug 包** `com.aqua.zeronote.debug`（连局域网 dev server）——
> 它和正式包 `com.aqua.zeronote` **包名不同，会共存**；试用 0.9.7 时别把两个搞混（debug 包的图标/入口和正式版一样）。
> 本轮验 UI 就是靠它：`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>` + `ZN_CDP=http://127.0.0.1:9333`。
>
> 可选（30–60 分钟，价值在回答「多渠道能不能替代 ghproxy」）：
> - 在**关掉系统代理**的环境里，分别选 `ghproxy` / `jsdelivr-gcore` 各跑一次「下载并安装」，
>   记下载速度与是否断流。
>
> 备选：
> - 删除传播的端到端：删一篇 → 看云端 `_zn/trash/` → 清空回收站 → 看那份消失。
>
> ### ✅ 0.9.7 已发版（rev173.309 · 2026-10-31 · 5 个资产全部 uploaded）
>
> `ZeroNote_0.9.7_x64_zh-CN.msi` **16.96 MiB** · `…-setup.exe` **15.06 MiB**（各带 `.sig` 436 B）·
> `ZeroNote_0.9.7_arm64.apk` **32.93 MiB**（sha256 `71a88454…`）⇒ https://github.com/aqua7773/zeronote/releases/tag/v0.9.7
> 构建 **10 分 13 秒**（桌面 5m16s / Android 4m57s）· 清单已推送 · verify 全绿。
> ⚠️ 流程：**commit → tag → gh release create**（rev173.307 那次颠倒顺序，tag 被打在旧 HEAD 上）。
>
> ### ✅ 手机端去底栏 + 右侧「更多」抽屉（rev173.308 · 2026-10-31）
>
> 用户「移动端不做底部导航栏，首页就是默认的时间流，搜索放进更多里面，插件本来就在更多有入口，
> 更多改成右滑出现的右侧栏」＋「把左侧栏现在放的那个设置入口改成更多」。
> **删** `MobileTabBar` / `MobileMorePage`；**新增** `MobileMoreDrawer`（搜索 / 回收站 / 切库 / 插件中心 / 插件组 / 设置 / 关于）；
> 左抽屉头部设置齿轮 → **⋯ 更多**；`swipe.ts` 新增 `moreSwipeIntent`（右边缘左滑开、右划关）。
> 返回键：抽屉 → 搜索页 → 笔记流 → 退出。
>
> ⚠️ **边缘门槛 32 → 64px**：真机从最右边起手会被 **Android 系统返回手势**抢走（App 直接退出），
> 实测距边 54px 可用 ⇒ 定 64。左抽屉仍是「任意位置右划」，不受影响。
>
> 真机（24069RA21C · debug）五条全过；vitest **1715**；证据 `_shots/rev308-*.png`
> （`11-home` / `13-more-drawer` / `20-edge-swipe` / `21-left-drawer` / `22-search`）。
>
> ### ✅ 0.9.6 已发版（rev173.307 · 2026-10-31 · 5 个资产全部 uploaded）
>
> 提交 `8f8ea43` · tag `v0.9.6`（`gh release create` 先建了个指向旧 HEAD 的 tag，已 force 更新到该提交）·
> 清单 `update/latest.json` + `android.json` 已推送，**raw 已读到 0.9.6** ·
> verify 全绿（cargo 92 / vitest 1708 / 质量门 8/8，20:47:02）。
>
> ### ✅ 代理策略修复（rev173.306 · 2026-10-31）
>
> 用户「关掉代理后所有渠道都显示安装包不可达」→ 量出：**直连时 GitHub 直链 200、ghproxy 超时**；
> 应用却全失败 ⇒ 根因是 `tauri-plugin-updater` 打开了 reqwest 的 `system-proxy`，**Cargo 特性合并**
> 让整个二进制的请求都走系统代理（`cargo tree -e features -i reqwest` 可复现）。
> 改法：本机 / 内网走直连 client；公网请求失败后直连重试一次（`net_request` / `fetch_json` / 测速 HEAD / 插件包下载四处）。
> **顺带治好了 `cargo test --lib` 挂死**：现在 **92 passed / 0 failed / 0 filtered**（以前必须 skip 6 条）。
> ⚠️ 未做端到端（把系统代理指向死端口 → 点测速看回退）—— dev 与已安装 0.9.5 共用 WebView 数据目录，
> 0.9.5 在跑时 dev 起不来；留给装 0.9.6 后验。
>
> ### ✅ 更新通道首次跑通（2026-10-31 · 0.9.4 → 0.9.5）
>
> 用户「更新成功」：注册表 `DisplayVersion=0.9.5` · `zeronote.exe` ProductVersion **0.9.5** · 进程正常。
> 渠道 = **`jsdelivr`**（localStorage `zn-app-update-mirror`）—— 按 rev173.300 的 `AssetRoute`，
> jsDelivr 只镜像**清单**，**安装包退回 GitHub 直链**，本机开着 Steam++ 代理 ⇒ 直链拉通。
> 对照 0.9.2 → 0.9.3 那次（无渠道逻辑、写死 ghproxy）断在 40% —— **多渠道的价值实证**。
> ⚠️ 没记录下载耗时 / 无代理环境的表现。
>
> ### ✅ 0.9.5 已发版（2026-10-31 · 5 个资产全部 uploaded）
>
> `ZeroNote_0.9.5_x64_zh-CN.msi` **16.93 MiB** · `…-setup.exe` **15.03 MiB**（各带 `.sig` 436 B）·
> `ZeroNote_0.9.5_arm64.apk` **32.92 MiB**（sha256 `32537e08…`）⇒ https://github.com/aqua7773/zeronote/releases/tag/v0.9.5
> 构建 **9 分 9 秒**（桌面 4m10s / Android 4m59s）· 清单已提交 · 内容 = rev173.303 四条 + 替换按钮竖排。
>
> ### ✅ rev173.303 已改（2026-10-31 · 第三次真人测试四条）
>
> | # | 改法 |
> |---|---|
> | 1 | `quick-slots.ts` 删掉 `builtin:timeline` 候选（连带 `onlyDesktop`）；`resolveQuickEntry` 不再认它 |
> | 2/3 | `swipe.ts` 新增 `overlay` 判据 + `hasBlockingOverlay()`；四类遮罩（图片预览 / 环形菜单 / 命令面板 / 对话框）上两个方向都不开关侧栏 |
> | 4 | 替换栏窄屏两行（输入各半 + 按钮 `nowrap`）· `backRef` 与手机顶栏 `‹` 补 `replaceOpen` 层 · 从查找面板进来的替换栏关掉后**还回查找面板** · 打开查找面板前先收替换栏 |
>
> 测试：vitest **1708**(+4) · tsc 0 · oxlint 4 warnings。
>
> **dev 实测（2026-10-31 19:0x · CDP）**：① 5 个「换入口」下拉里**没有时间流** ✅
> ② 390px 视口下替换栏**两行、按钮横排不溢出** ✅ ③ 点替换 → Esc ⇒ **回到查找面板** ✅
> ④ 实测发现替换栏开着按 **Ctrl+F 仍会叠两层**（只拦住了按钮路径）⇒ 补捕获阶段守卫后复测通过（`b25f30e`）。
>
> **真机实测（19:1x–19:2x · 24069RA21C · dev 包，5/5 过）**：环上无「时间流」· 照片预览 / 环形菜单开着
> 右滑都不开侧栏（**修复前同机旧包实测会开**）· 无浮层时手势正常 · 替换栏两行 · 返回 → 回查找面板 → 再 → 回编辑 ·
> 顶栏 `‹` 同 · 点 🔍 不叠加 · 追加的「替换按钮竖排」也在真机确认并修好（`c5254db`）。
>
> ### ✅ 0.9.4 已发版（2026-10-31 · 5 个资产全部 uploaded）
>
> `ZeroNote_0.9.4_x64_zh-CN.msi` **16.93 MiB** · `…-setup.exe` **15.02 MiB**（各带 `.sig` 436 B）·
> `ZeroNote_0.9.4_arm64.apk` **32.90 MiB**（sha256 `7aa7aaf8…`）⇒ https://github.com/aqua7773/zeronote/releases/tag/v0.9.4
> 构建 **8 分 5 秒**（桌面 4m14s / Android 3m51s）· 清单已提交（`99ed594`）· raw / ghproxy 都已读到 0.9.4
> （**jsDelivr 还是 0.9.2** —— `@main` 小时级缓存，已知）。
> **内容**：更新渠道 = 与插件市场同一套 5 条 + 逐条测速 + 安装包按渠道路由（rev173.300）。
>
> ### ✅ 0.9.3 已发版（2026-10-31 · 5 个资产全部 uploaded）
>
> `ZeroNote_0.9.3_x64_zh-CN.msi` **16.93 MiB** · `…-setup.exe` **15.02 MiB**（各带 `.sig` 436 B）·
> `ZeroNote_0.9.3_arm64.apk` **32.87 MiB** ⇒ https://github.com/aqua7773/zeronote/releases/tag/v0.9.3
> 构建 8m14s（桌面 4m03s / Android 4m11s）· 清单 `update/latest.json` + `update/android.json` 已提交（`9b72173`）
> **内容**：删除会传播（云端回收站 `_zn/trash/`）· 拉下来的笔记 mtime = 推送时间（`set_mtime` 内核命令 + `sync` 0.1.6）
>
> **两个发版坑**：① Gradle 产出的 APK 不含版本号（`app-universal-release.apk`）⇒ 要先 `Copy-Item` 成
> `ZeroNote_0.9.3_arm64.apk` 再生成清单；② `gh release create` 要带 `HTTPS_PROXY=http://127.0.0.1:26561`。
>
> ### ✅ rev173.297 已全链路验完（2026-10-31 11:57 · 桌面 dev + 手机真机）
>
> 内核 `set_mtime` + 契约 `fs.setMtime` + `sync` 六处 pull 写回 `at`（`sync.test.ts` 97 条绿）；
> `sync` **0.1.6** 已发市（256.9 KB · keyId `aqua-2026` · 索引 14 条 · 验签 50/51）。
> 双端实测（云端 `at` 设成 11:17:00.350）：桌面 `LastWriteTime` 与手机 `stat` **都是 11:17:00.350**。
>
> **三个坑**（详见 HANDOFF.md rev173.297 正文段）：① 系统代理吞 **loopback**（桩零请求，插件误判「远端已删」，
> 绕法：baseUrl 用 LAN IP）② `adb shell` stdin **128 KB 截断**（走 `/data/local/tmp` + `run-as cat`）
> ③ `typeof api.fs.setMtime` **判不出内核命令是否存在**（旧 APK 上看不出异常）。
>

> ### 本轮（rev173.292–300）做完的
>
> | rev | 内容 |
> |---|---|
> | 173.292 | **0.9.2 发版**：应用本体更新（桌面官方 updater / 安卓下载 APK 装）；Release 5 个资产已上传 |
> | 173.293 | 删除传播（`sync` 0.1.3）：本机删了不再被拉回 |
> | 173.294 | 删除 = 搬进**云端回收站** `_zn/trash/`；彻底删除 / 30 天过期才真删；去掉本地留底 |
> | 173.295 | **删除优先**（`sync` 0.1.5）：有基线就删远端，消除「没有按钮的存在状态冲突死记录」 |
> | 173.297 | **拉下来的笔记 mtime = 远端推送时间**：内核 `set_mtime`（std `File::set_modified`，无需新依赖）+ 契约 `fs.setMtime` + `sync` 六处 pull 写回 `at` |
> | 173.299 | **0.9.3 发版**：桌面 msi/exe + arm64 APK 共 5 个资产；清单已提交 |
> | 173.300 | **更新渠道对齐插件市场**：5 渠道可选 + 逐条测速 + 安装包按渠道路由（`rewrite_asset_url`）；真装实测抓到 ghproxy 40% 断流 |
> | 173.301 | **0.9.4 发版**：桌面 msi/exe（带签名）+ arm64 APK 共 5 资产；清单已提交，raw / ghproxy 已读到 0.9.4 |
> | 173.303 | **第三次真人测试四条**：环形菜单下架「时间流（仅桌面）」· 浮层上屏蔽侧栏左右滑（四类遮罩）· 替换栏窄屏两行 + 返回层级「替换 → 搜索 → 编辑」、不再叠加搜索 |
>

> **rev173.293（2026-10-31）· 删除会传播了（`sync` 0.1.3）**：用户「我本地删掉的大小，一同步又回来了，
> 正确做法是把最新的状态同步云端」。旧语义：本机删除只进 `.zn/trash/`（不参与同步）⇒ 插件只看到
> 「本地没有这篇」⇒ 一律当"拉下来"，删了的东西 5 秒后又回来。现在：**远端没改过 ⇒ 连云端一起删**；
> 远端改过 ⇒ 恢复远端版 + 记冲突；**云端删了 ⇒ 本地删进回收站**（可恢复）。
> **不设单轮删除上限**（用户明确「不用设置安全上限」）—— 本机删多少就同步删多少。
> **删除 = 搬家 / 彻底删除 = 真删**（用户「回收站和彻底删除各按各的逻辑，云端也一样」）：
> 删除时先写进**云端回收站** `_zn/trash/<stamp>/<原路径>` 再删原文件，本地**不再另存留底**；
> 本机彻底删（或恢复出来）⇒ 下一轮删远端那份；远端条目超 30 天自动清。`sync` **0.1.4**
> （`market/packs/sync-0.1.4.znp` · keyId `aqua-2026`，验签通过）。⚠️ 本机插件目录已直接拷入（备份
> `_tmp-plugin-backup/sync-before-delete-prop-20261031/`）—— **重启应用**后才生效；
> 之前在云端留下的、又被拉回来的笔记，要**再删一次**才会传播。

> **本轮（rev173.292 · 2026-10-31）· 应用本体更新已发布 v0.9.2（两端产物 + Release 已上传；端到端待真装一次验证）**：
> 用户「给 zeronote 添加内置更新功能」→ 拍板「两端都做 + 密钥我生成」。
> **桌面** = 官方 `tauri-plugin-updater`（minisign 签名**不可关** · NSIS 安装器 · 装完自动重启）；
> **Android** = 自下载 APK → sha256 核对 → 系统安装器（新原生插件 `tauri-plugin-apk-install`）——
> 官方 updater 的支持表**没有 Android**（README 2.14.1：Linux / Windows / macOS only）。
> 清单 = 仓库里的静态 JSON：`update/latest.json`（桌面，Tauri static 格式）/
> `update/android.json`（`apk.{url,sha256,size}`），由 `scripts/gen-update-manifest.mjs` 生成。
> **镜像顺序由 Rust 自己探测**（raw → ghproxy → jsDelivr ×2）：`plugins.updater.endpoints` 只在
> **非 2xx** 时试下一个，而手机直连 raw 是 TLS 阶段被 RST（网络错误）⇒ 不会回退
> （2026-10-27 真机 6/6 失败；见 `src-tauri/src/updates.rs` 头部）。
> 入口：**设置 → 关于 → 更新**（手动检查 / 版本说明 / 进度 / 安装）+ 启动 24h 节流静默提示
> （只提示，不下载不安装）。开关 `zn-app-update-auto`，时间戳 `zn-app-update-last-check`。
> ⚠️ **0.9.1 及更早的安装收不到这条通道** —— 旧包没有 `.sig`、也没有 updater 插件；
> 内置更新从**下一个版本**起生效，老用户需手动装一次。
> ⚠️ **私钥 `~/.tauri/zeronote.key` 丢了 = 所有老用户永远收不到自动更新**（签名校验关不掉）
> —— 必须离线备份；`build-release.mjs` 会自动带上它，CI 不出签名包。
> 发版顺序（别搞反）：`release.mjs <ver>` → `build-release.mjs` → `gen-update-manifest.mjs` →
> `gh release create`（上传产物 + `.sig`）→ **commit `update/` 并 push**（客户端从仓库读清单，
> 不是从 Release 读）。步骤见 `update/README.md`，原因见 `docs/应用本体更新-方案-2026-10-31.md`。
> ⚠️ **本机 3 条既有网络测试会挂**（`net::tests` ×2 + `install_znp_from_url_rejects_*`）：
> 系统代理开着时（Steam++ `127.0.0.1:26561`）reqwest 的 loopback 请求被代理吞掉、
> 本地桩永远 accept 不到 ⇒ 挂在 `--test-threads=1` 也一样，`stash` 基线可复现（**不是本轮引入**）。
> 验收办法：`cargo test --lib -- --skip net::tests --skip install_znp_from_url`（85 条全绿），
> 或先关掉系统代理；根治要把 `http_client` 的代理策略改成「loopback / 私网不走代理」。

> **下个会话第一件事（rev173.290 交接 · 冲突合并已进编辑页 + 已发市）**：冲突时**正文里直接出现两段** ——
> 远端段红（`#ff6b6b`）/ 本机段绿（`#51cf66`），带淡背景与左侧色条，字号行高与正文一致，段首各一个 ✔。
> **点哪段就留哪段**：另一段删除、留下的那段恢复普通正文，并立刻推上远端。合并稿存在插件 store，
> 重启 / 切笔记回来颜色与按钮都还在；未选期间这篇不参与同步（不会把两段一起推出去）。
> `sync` **0.1.1** 已打包签名（`market/packs/sync-0.1.1.znp` · 243.0 KB · keyId `aqua-2026`），
> 用户要到「插件中心 → 插件市场 → 更新」才拿到（**不自动升级**）。
>
> 余下边界（**明确没做，别当成做过**）：
> - **本地文件夹后端仍是旧行为**：`lib/backends/folder.cjs` 的冲突分支没接合并稿
>   （它磁盘已被外部工具覆盖、本机版在影子副本里）—— 要接得给它加 `writeBody` / `buildMergeDraft` 钩子。
> - ⚠️ **dev 插件目录是副本不是 junction**：改源码后必须拷进 `<appdata>/.zn/plugins/sync/` 再 reload。
> - ⚠️ **CDP 截图在移动 WebView 上会裁字**：真机验收用 `adb exec-out screencap -p`，别当渲染坏了。
>
> 手机端已实测（真机 24069RA21C · debug 版 · `_shots/phone-merge-290-real.png` / `-resolved.png`）：
> 两段两色 + ✔、点本机段 ⇒ 另一段消失且**推上远端**。手机**自动同步仍关着**（测试期间关的）。

> **下个会话第一件事（rev173.288 交接 · 同步合并已收口 + 桌面已测）**：`sync` 一个插件、四个后端
> （`webdav` / `s3` / `git` / `folder`），旧 4 个插件源码已删，市场 **14 条**，
> `market/packs/sync-0.1.0.znp`（229.9 KB · keyId `aqua-2026`）已打包并 push（raw URL 已可下载）。
> **桌面 dev 端到端实测已通过**（2026-10-30 23:35：12 条命令加载 · 四套面板 · folder 冲突全流程
> 「基线 38 → 外部覆盖 → 冲突副本 = 本机版 → 用本机版 → 冲突归零」，截图 `_shots/sync-288-*.png`）。
>
> ### ✅ 手机端已换 `sync` + 跨设备冲突实测通过（rev173.289 · 2026-10-31 00:02）
>
> 手机（`33b676f6`）：4 个旧同步插件已卸载（备份 `_tmp-phone-backup/old-sync-plugins.tar`）·
> `sync` 8 文件已 push 到 `.zn/plugins/sync` ⇒ 重启后 **12 条命令全在**。
> 双端都连本地 DAV 桩（桌面 8899 + `adb reverse tcp:8899`），桌面推 40 篇 → 手机拉下。
> **冲突实测**：桌面推「桌面版 00-02」→ 手机本地是「手机版 00-02」且基线还是上一版 ⇒ 手机同步
> **判冲突** ⇒ 写 `.zn/conflicts/android/2026-10-30 2358-需求.md`（内容 = 手机版）、本地取远端版、
> 面板「冲突记录 · 10 条」⇒ 点「用本机版」⇒ 本机版写回 + 推上远端 + 记录降到 9 条
> （截图 `_shots/phone-conflict-3.png` / `phone-conflict-resolved.png`）。
>
> ⚠️ 两个路径坑（下次别再踩）：
> - **手机 vault = `/storage/emulated/0/Documents/ZeroNote`**，不是 app 私有目录 `files/vault`
>   （后者是 stale 数据；`localStorage['zeronote.vault']` 才是真路径）
> - 手机**插件目录仍在 app data**：`/data/user/0/com.aqua.zeronote.debug/.zn/plugins`
>
> ### 其余待办
>
> - 手机自动同步目前**是关着的**（测试时关的，避免刷屏）；要用就面板点「开启自动同步」。
> - 手机冲突列表还剩 9 条旧记录（23:54 首轮同步时密码库 / 同篇差异产生，属测试噪声）。
> - ~~应用 0.9.1 等用户自己安排~~ ⇒ **已发（rev173.291）**：msi / exe / arm64 APK 都在 Release `v0.9.1`。
> - 候选：S3 / Git 的 ack 清理轮转（S3 按请求计费）；`sync` 的 3 个后端都还没接真实远端做端到端。
> - 用户桌面 vault（`C:\Users\AQUA\Documents\ZreoNote`）**没碰过** —— 本轮全部在 `_tmp-vault-tb`。
>
> **上一轮（rev173.285）交接**：`sync` 初版（引擎 + WebDAV，90 条测试）；余下三步已在 rev173.286–288 完成。
>
> **上一轮（rev173.284）交接**：`sync-webdav` **0.3.5 已发市**（修「中转附件每轮重传」）。
> s3 / git 的同款修复已随 `sync` 合并，但 ack 清理**没有**按 webdav 的 `ackCursor` 轮转改
> （S3 按请求计费，条目多时仍是全扫）—— 下一批候选。
>
> **上一轮（rev173.283）交接**：真人测试二两条已修完、dev 实测过 —— `sync-webdav` 0.3.4 已发市（冲突处理入口）。
> 应用侧的「文件树自动刷新」要等下一次 app 发版才到 release 用户手上（用户 2026-10-30 明确「先不发版，我自己安排」）。
>
> **上一轮（rev173.282）交接**：**0.9.0 已发版**（真人使用测试 A–J 20 条全修 + J 批三件）。
> 本轮四件：① 插件重打包签名 4 个（`import-export` **0.2.0** · `sync-webdav` **0.3.3** · `sync-s3` **0.4.3** ·
> `sync-git` **0.5.3**）② 应用 **0.9.0**（`release.mjs` + CHANGELOG/README/ROADMAP）③ 双端 release 编译
> ④ commit + tag `v0.9.0` + push + GitHub Release。
> **下个周期没有必做项** —— 候选池见 `docs/ROADMAP.md` §3：卡外部输入四项（`sync-git` 手机端 token ·
> Gitee 令牌 · WebDAV DAV 桩 · 记账样本）+ 性能基线（用户暂缓）+ 退场动画（条件渲染直接卸载，要做需保留 DOM）。
> ⚠️ **插件市场现在有 4 个新版本**：装过旧版的用户要到「插件中心 → 插件市场 → 更新」（**不自动升级**）；
> 我手换进**桌面 / 手机全局目录**的 `import-export` 是开发版（无签名），装市场 0.2.0 会覆盖它。
> ⚠️ **I#12 退避的端到端真机验仍未做**（只做了静态测试 18 条；要改已配好的 WebDAV 设置），不阻塞发版。
> ⚠️ **`tauri-plugin-share` 是原生改动**：已随 0.9.0 进 APK；桌面返回 `desktop-no-share` → 复制剪贴板。
> ⚠️ **#2「装完插件怎么指路」** 已由 #9 / #18 的入口解决；F#16 未复现（用户已验收）；E#10 已修（rev173.277）。
> 计划全文 `docs/真人使用测试-修复计划-2026-10-30.md`（A–J 十批，状态「全部完成」）。


> **rev173.242–243 · 安卓桌面组件三件已落地（需求 §15 收口）**：**快速记录**（点组件 → 对话框 → 写 `<库>/收件箱/<时间戳>.md`，
> 不打开主应用）· **今日打卡**（点一行 = 打一次卡，写回 `habit` 插件 store + `widget-habit-dirty` 让前端回前台重载插件）·
> **最近笔记**（只出公开笔记，按组件高度 1/3/5/7 档）。数据通道 = 前端算快照（`src/kernel/widget-data.ts`）→
> Rust 原子写 `<app_data_dir>/.zn/widget-data.json`（`src-tauri/src/widgets.rs`）→ Kotlin 只读渲染。
> **刷新（rev173.243）** = `WidgetRefresher`（FileObserver 盯快照文件，`MOVED_TO` ⇒ 刷两个组件）+ 打卡组件兜底 30 分钟周期 ——
> 之前 `onUpdate` 只在「添加组件」时跑，先加组件后建计划的用户永远看到空状态（用户实测发现的）。
> ⚠️ **真机入口**：MIUI 的「全部应用 → 支持小部件应用」列表**不收录**本应用，要从「安卓小部件 → 添加小部件」进去，
> 按应用分组里才有三个组件。
> **已验（全部）**：快速记录全链路（渲染 → 点击 → 对话框 → 保存 → 文件）· 最近笔记渲染与**自动刷新**（新建笔记 10 秒内出现在组件上）·
> **打卡组件用户删除重加后实测成功**（20:5x，显示「跑步 / 早起」两行）· **打卡点击有效**（20:56：store 里跑步 3 条 /
> 早起 1 条 `20:56`，快照 `done` 同步 3/1 —— 点击 → 写插件 store → 快照 → 重绘全链路闭合）。
>
> **附件需求已全部收口（rev173.245）**：库外非媒体附件的**文件卡片**落地 —— 正文里
> `[名](D:/大文件.pdf)` 整行渲染成「图标 + 文件名 + 扩展名 · 大小 + 源文件不在本机 + 打开」；
> 大小与「在不在本机」来自引用台账（库外大附件必然是 > 1 MiB 引用型），**台账没这条就不猜**。
> 光标在该行时显示源码（与数学块一致）；「打开」交给宿主 → 如实说「库外文件，请用文件管理器打开」
> （内核**没有**「用系统程序打开本地文件」的原语，`open_external` 只放行 http/https）。
> 纯前端 ⇒ **手机 reload 即生效，未走查**。
>
> **§3.4 小债清零（rev173.246 + 251）**：`docs/guides/` 落地（`Android安装说明.md` 先移入；**`使用手册-移动端.md`
> 已于 rev173.251 搬入**，12 张 `../images/manual-mobile/*` 相对图片同改）· **白屏兜底边界查清**：`Page.crash`
> **窗口壳还在**、兜底生效（CDP 对照实验：`crash-test` 留 40 s+ vs `note-99` 被清掉），只有 `window.close()` 会直接销毁窗口
> （wry `DestroyWindow`，不需要兜底）。详见 `docs/卡死兜底方案-2026-10-13.md` **§11**。
>
> **主窗口自救已补（rev173.247）**：`.zn-app` 每 5 s 自检，**连续 3 次（15 s）** 判没了 ⇒ `location.reload()`；
> **一次启动只救一次**（`sessionStorage`），**独立窗口不参与**（那里根本没有 `.zn-app`，误启用会永远判白屏）。
> 实测四条：白屏 15 s 真 reload · 第二次不再刷 · 正常页面 20 s 不误刷 · 独立窗口不参与。
> ⚠️ 仍会丢的一小块：私密笔记明文不进草稿 ⇒「白屏那刻正在改私密笔记且没到 800 ms 保存」会丢那一下。
>
> **0.7.0 已发（rev173.249 · 2026-10-29）**：0.6.0 之后 **89 个提交 / 75 个 rev（174–248）**一次收口 ——
> CHANGELOG 补上 196–221（AI 管家）与 230–247（版本回滚 / 能力接管 / 附件四期 / 桌面组件 / 主窗口自救），
> README 现状行与 ROADMAP §0 同步 0.7.0，版本三处 + tag `v0.7.0`。应用版本与插件版本是两套号（`ai@0.9.0` 是插件版本）。
>
> **手机走查 245–247 已完成（rev173.250）**：文件卡片三态（无台账 / 有台账 / 源文件不在）与主窗口自救
> （15 s reload + 不循环）全过；走查发现真缺口并修掉 —— 三处「库外绝对路径」判据都只认 Windows，
> 手机上 `/storage/emulated/0/…` 全部静默失效 ⇒ 抽 `isLocalAbsPath`（`src/kernel/attachment.ts`）一份口径。
>
> **手机使用手册已校对到 0.7.0（rev173.252）**：设置 4 个 tab · 预装 9 个（rev173.259 起改为「推荐优先安装」，手册已同步）· 长按正文与长按 ☰ 两个菜单分开写 · 换 3 张图。位置 `docs/guides/使用手册-移动端.md`。
>
> **手机端「插入附件 / 查找」入口已补（rev173.253）**：键盘上方工具栏 `⇤ ⇥ 📎 🔍 B …`（首屏可见）+ 长按 ☰ 菜单同样两项；
> 顺手修了「查找面板开着按返回键会关笔记」的 bug。真机验过；手册第 2/6 节同步。
>
> **UI 重布局 B1 + B2 已落地（rev173.256 / 173.257）**：
> · **桌面（B1）**：48px 图标栏（笔记 / 搜索 / 时间流 / 插件 / 设置）· 侧栏变视图容器（文件树 / 搜索 / 时间流）·
>   标题栏常驻 · ☰ 改主菜单（含「最近打开」）· 分隔线键盘可调。
> · **手机（B2）**：底部四项（首页 / 搜索 / 插件 / 更多）+ 搜索全屏页 + 「更多」全屏页（设置 / 回收站 / 切换库 /
>   插件管理 / 关于 + 插件入口按启用出现）· 编辑态底栏隐藏、顶栏 `‹ 返回 | 笔记名 | ⋯` · 返回键按 tab 回首页 ·
>   手机状态栏隐藏 · ＋ 与长按环形入口上移。
> 截图 `_shots/ui-redesign-B1-*.png` 与 `_shots/b2-*.png`；桌面全禁用与手机「标签/导入导出」禁用都实测过。
> **手机长按 ＋ 的环形快捷入口由用户 2026-10-30 实测有效**（B2 只把它整体上移 56px，无回归）。
> **B4 已落地（rev173.260）**：文档工具条 `DocToolbar`（`editor-topbar` 面板 + 源码 / 更多）·
> 状态栏瘦身（删篇数统计，只剩 statusbar chip + 错误 + 字数；高 26、可点 chip ≥24×24 / 2.5.8）·
> 空态「最近 3 篇」（最近打开优先 · mtime 补齐 · 过滤已删除；「从文件导入」仅 import-export 启用时出现）。
> 反链 / 历史从状态栏迁到工具条（`backlinks` 0.2.2 / `history` 0.2.1，挂载位 `editor-topbar`，禁用即消失）；
> 零插件时工具条只剩「源码 ⋯」。证据 `_shots/b4-*.png`（01 工具条 / 02 源码 / 03 菜单 / 05 空态最近 /
> 07-08 零插件 / 09-10 历史与反链从工具条打开）。
> **B5 已落地（rev173.261）**：标签条常在（无标签也画，`＋` = 无标签也能新建）· `＋` 菜单
> （新建笔记 / 逐条打开面板，走 `openPanelInTab` 让面板进标签条）· `»` **常显**列出全部标签并切换
> （切换后 `scrollLeft` 手算滚进视野）· 笔记独立窗口左上「切换」→ `QuickSwitcher`。
> 时间流入口 B1 已落地（图标栏 / `Ctrl+3` / 菜单 / 文件树右键），本批不重复。
> 证据 `_shots/b5-*.png`（01 ＋菜单 / 02 新建 / 03 »列表 / 04-05 笔记窗切换 / 07 溢出 / 08 空态 / 09 面板进标签条）。
> **B6 已落地（rev173.262）**：`location: 'sidebar'` 有**真载体** —— 桌面渲染在侧栏（文件树下方，
> 最多 45% 高、内部滚动），手机回退主区；零插件 / 全禁用 ⇒ 整块不渲染。`statusbar` 明确约束为
> 一行状态 chip。`import-export` 改 `main` 0.1.1 发市（完整工具页）；`hello` / `raw-ipc-probe` 演示 sidebar。
> 契约同步（`内核契约-v0.2.md` 六类位置表 + `contract.ts` 注释）。证据 `_shots/b6-*.png`
> （01 侧栏双面板 / 02 只剩 Hello / 03 导入导出进主区 / 04 零插件 / 05 禁用启用往返）。
> **B7 已落地（rev173.263）**：动效 token（六档时长 + 四条缓动，27 transition + 2 animation 全换）·
> **全局 reduce-motion**（`*` 压 1ms，CDP 实测 0.001s）· 标题栏 450→**200ms** · 图标两档 **16/20** ·
> 间距回 **4/8/12** · 焦点圈同色（`--zn-fg`）· `fg-subtle` 暗色 **4.91:1**（原 3.67）。
> 测试 `tests/design-tokens.test.ts` 8 条；证据 `_shots/b7-*.png`（01 浅色全插件 / 02 暗色 /
> 03 零插件 / 04 恢复 / 05 手机更多页）。
> ⚠️ 未做：退场动画（浮层关闭 / 返回列表无淡出）。
> **三项目标态已落地（rev173.264）**：① **侧栏智能分区**（今天 / 最近 7 天 / 未打标签 —— chip 在文件树上方，
> 点中换成扁平列表；内核新增 `index.query('', { untagged })`）② **图标栏插件 pin**（插件中心每行 📌，最多 3 个；
> 只存 id ⇒ 禁用消失、启用回来；满额置灰）③ **专注模式**（设置 → 通用开关，默认关；开启后标题栏自动隐藏，
> 鼠标进顶部 / Tab 到标题栏滑回）。测试 `smart-sections` 17 + `rail-pins` 10 + `index-filters` +3；
> 证据 `_shots/b7-06..10.png`。⚠️ 手机未走查（智能分区只桌面渲染）。
> **UI 重布局已收口（rev173.265）**：`docs/UI交互规范.md` **重写**（桌面 / 手机 / 浮层 / 手势四节 +
> 无障碍 + 视觉 token，约 190 行）；方案 `git mv` 进 `docs/archive/` 转 **historical**（文件内相对链接上移一层、
> 全仓 21 处引用改新路径）；手机手册补「底部四个图标」。**B1–B7（256–263）+ 三项目标态（264）+ 收口（265）
> = UI 重布局全部完成。**
> **页面转场已落地（rev173.266）**：同级切换 160ms 淡入 + 2px（插件中心 / 回收站 / 面板）·
> 钻入 / 返回 260ms 水平推入（手机列表 ↔ 编辑器，`≤640px`）· 浮层遮罩 120ms + 面板 140ms
> `scale(.98)→1`（新增 `--zn-dur-overlay`）· 标签切换保持 0不做。实现 = `key` 重挂载 + keyframes；
> reduce-motion 实测 `0.001s`；证据 `_shots/b7-11` / `b7-12`。⚠️ 退场动画未做（条件渲染直接卸载）。
> **侧栏收起/展开过渡已落地（rev173.267）**：点图标栏 / `Ctrl+\` 宽度滑 220ms（`--zn-dur-panel`）·
> 拖动分隔线时 0（`body.is-resizing`）· 收起改成「宽度到 0 + `inert`」不卸载（文件树滚动位置保留）·
> 分隔线只在展开时渲染。证据 `_shots/b7-13-sidebar-collapsed.png`。
> **下一步**：调研 MO1–MO7 与三项目标态**全部清零**；剩下的都是积压项 ——
> 卡外部输入四项（`sync-git` 手机端 token · Gitee 令牌 · WebDAV DAV 桩 · 记账样本）+
> 性能基线（用户暂缓）+ **退场动画**（条件渲染直接卸载，要做需保留 DOM 到动画结束）。
> **B3 已落地（rev173.258）**：插件中心独立页（已安装 / 插件市场 / 调试）+ 设置瘦身（只剩摘要 +「打开插件中心」+
> 启动检查更新）；禁用可撤销（12 秒）；命名统一。证据 `_shots/b3-*` 与 `_shots/b3-phone-*`。
> **取消内置预装（rev173.259）**：应用**不再预装任何插件**，**首次启动 = 零插件**；原来预装的 9 个改为插件中心空态里的
> 「**推荐优先安装**」（基础体验 5 / 多设备同步 4），市场带「推荐」标。零插件空态已真机实测（`_shots/b3-24-zero-empty.png`）。
> ⚠️ 代价：离线 / 首启没有插件，市场拉不到索引时只能装 `.znp`（决策 `D-011`）。
> **兜底已排除**：9 个 `.znp` 内置进安装包 + 空态「从本地包安装」—— 用户 2026-10-30 明确「不用」（重议入口见 `D-011` 末节）。
> **卡外部输入**（排在其后）：`sync-git` 手机端（没 token）· Gitee 分支实测（没令牌）· WebDAV 后端真机验证（要自建 DAV 桩）·
> 记账文案校准（等真实漏识别样本）· 性能基线（用户暂缓）。插件数涨到几十个时再换 CDN（现在 17 条，**不需要**）

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
> 市场 **17 条**（`ai` 0.5.0 已签名发市 · rev173.204；`security` / `secrets` 已签名发市、不预装；**`backup` 预装且已发市**，rev173.189 —— 预装与市场不互替，签名包不被内置覆盖）。
> **源可切**（rev173.194）：市场页下拉 5 条镜像 + 自定义地址（索引与包前缀**成对**切换）；「测速」按「200 **且**能解析出条目」判可用 ——
> 2026-10-27 实测 raw 在手机上 100% RST，jsDelivr 的 GCore / Cloudflare 两端都通，`cdn.jsdelivr.net` **两端都断**（标「国内常断」）。
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
> ④ 卡点表前三行要外部输入（sync-git 手机端 / Gitee 令牌 / 记账样本）·
> ⑤ **AI 插件第一版完成（七刀 + 两轮收口全部落地）**（196 骨架 + 设置页 ✅ · 197 流式对话 ✅ · 198 只读工具 ×5 + 工具循环 ✅ ·
>    **200 写工具 ×7 + diff 预览确认 ✅**（提案 + 冲突检测）· **201 任务系统 ✅** —— 一句话定义规则，
>    保存笔记后自动跑（串行队列 / 同路径 3 秒去抖 / Q24 排除收件箱与私密）；自动任务里
>    `note_write` / `note_trash` **直接拒绝**，移动与打标签直接做；独立任务面板 `ai.tasks` ·
>    **202 定时触发 + 执行模式 ✅** —— `at: HH:MM` / 每周几，每分钟 tick + 启动补做（只补一次）；
>    `fixed` 模式按预排步骤执行、**不调模型**（没配 Key 也能跑）·
>    **203 首向导 + token 统计 + 抽样 ✅** —— 三步向导（走完收起）、用量按对话/任务分列、`ai.sample` 20 篇只读对照表 ·
>    **204 手机走查 + 发市场 ✅**（手机上向导/对话/统计/任务面板全过；`ai@0.5.0` 已签名，索引 **17 条**）·
>    **205 工具名改下划线 + 真 Key 抽样 ✅**（DeepSeek 拒绝点号工具名，17 个工具全改；20 篇抽样：14 篇文件夹与本目录一致、2 篇内容相符、3 篇草稿类归「随笔」可接受、1 篇空笔记跳过）。vitest **1277**。**与 origin 同步**。
>    **206 交接** ✅ —— 本会话共 9 个 rev（196–205），AI 插件第一版完成；状态见 HANDOFF rev173.206。
>    **207 工具名单测 + 真模型写工具全链路** ✅ —— `tests/ai-tools.test.ts` 4 条（字符集 / 唯一 / **执行器与 TOOLS 一致** / 描述无点号旧名）；
>    修 5 处「教错模型」的旧点号文案；真模型实测 `note_move` 提案→确认→真移动 · `tag_add` 直接生效 · `note_trash` 提案→确认→进回收站 ·
>    fixed 任务（save 触发）**169 ms** 跑完 tag_add + note_move。vitest 1277 → **1281**。
>    ⚠️ **模型会说「任务建好了」而没调 `task_create`**（面板 0 个 / store.tasks 空）—— 验收要看面板数字与 store，别信回复原话。
>    **208 第二版：`plugin_exec` 白名单** ✅ —— 设置页「允许 AI 调用的命令」（候选 137 条，去掉 `core.*` / `ai.*`，逐条允许/已允许）；
>    新工具 `plugin_exec`（command + args）；三条硬线：内核与 AI 自身命令永不开放 · 未授权明确报错 · **自动任务同样受白名单限制**（用户拍板）。
>    真模型实测：未授权 3 ms 拒绝 → 允许后 2 ms 成功（打卡面板真打开）；fixed 任务 22 ms ok。vitest 1281 → **1290**。
>    ⚠️ 白名单 UI 在候选多时很长（137 行），后续可按插件分组折叠；**`ai@0.6.0` 已重新打包签名发市场**（`market/packs/ai-0.6.0.znp` · 130.7 KB · 索引 17 条）。
>    **209 对话补 system 提示（防幻觉）** ✅ —— rev197–208 的对话请求**一直没有 system**，模型不知道「pending 只是提案」，
>    两次谎称任务已建好（208 还编造已删任务的旧 id）。新增 `CHAT_SYSTEM_PROMPT` + `buildChatMessages`（system 不进历史 / 不落 store），
>    五条规则：pending ≠ 完成 · 说完成前必须真调过工具 · 不编任务 id · `plugin_exec` 只走授权 · 关键参数齐全就直接执行。
>    真模型对照：改规则 5 后 `task_create` 58 ms + `task_update` 55 ms 真建成并停用；另一轮谎称后自己调 `task_list` 更正「我上一条说建好了是错的」。vitest 1290 → **1297**。
>    **210 白名单按插件分组折叠** ✅ —— 137 条 → **13 组默认折叠**（`groupCommands` 按 id 第一段、**码点排序**避开 locale 差异；
>    组标题带 group id，否则 4 个「同步」分不清）；已授权单列顶部、「展开 / 收起」、新命令 `ai.toggle-group`（命令 20 → **21**）。
>    桌面实测：展开记账 27 条 → 允许 `accounting.stats` → 顶部「已授权 1 条」→ 撤销归零。vitest 1297 → **1300**。
>    **211 白名单命令筛选** ✅ —— 关键词框（`filterCommands` 按 id / 标题、大小写不敏感），有筛选时平铺结果 + 「清除筛选」回分组；
>    新命令 `ai.filter-commands`（21 → **22**）。实测：`csv` ⇒ 2 条；清除 ⇒ 回到「记账 · accounting · 27 条」。vitest 1300 → **1302**。
>    **212 知道能用哪些命令 + 历史带工具步骤** ✅ —— 新只读工具 `list_allowed_commands`（只返回已授权 id+title、带可授权总数）；
>    **历史压缩把工具步骤丢了** ⇒ 模型只看到自己上轮说「0 条」就不再查（强制它调也答「查过了」）⇒ `historyContent` 把 `✓/✗ name → 结果` 附进历史；
>    system 加规则 5「涉及当前状态要重新调工具」。真模型对照：修复前「还是空的」不调工具 → 修复后调工具答「能用 1 条 accounting.stats」。vitest 1302 → **1311**。
>    **213 交接** ✅ —— 本会话 6 个 rev（207–212）· HEAD `a93fd18` · 与 origin 同步 · verify 全绿 · vitest **1311** · dev pid 35548（19 小时+）。
>    **214 发市场** ✅ —— `ai@0.7.0` 已签名发市（`market/packs/ai-0.7.0.znp` · **141.4 KB** · 整包 sha256 `fc42785f…` ·
>    入口 `a163fb1a…` · keyId `aqua-2026` · 索引 **17 条**，ai 0.6.0 → **0.7.0**）；`verify-trust` **32/33** 验签过
>    （`theme-sepia` 纯样式恒无签名）· 六步全绿 · vitest 1311 不变。包内是 209–212 的 system 提示 / 分组 / 筛选 / 历史步骤。
>    ⚠️ `pack-plugin` 不带 `--key-id aqua-2026` 会写 `default`，`gen-market` 第 ⑤ 条校验直接红。
>    **215 AI 不可信** ✅ —— 先调研（`docs/AI不可信-调研-2026-10-27.md` · 六个一手来源：Cline 完成即工具 /
>    arXiv ECT「终止携带证据」0-288 vs 252-288 / OpenAI guardrails / Anthropic ground truth / 压缩保结构 / aider 自动测试）
>    再落地三件（**零内核改动**）：① `claimAudit` 完成声明审计（完成词 → 本轮必须有哪个工具成功；逐句判、否定语境跳过；
>    15 条单测）② 界面事实条（红字「这句没有实际依据」+「实际动作 · N 次」）③ 压缩保结构（`brief` 只留工具名，
>    最近 3 条完整）。vitest **1311 → 1326**。**端到端**：本地 mock 回「任务已经建好了」且不调工具 ⇒ 界面当场红字
>    （`_shots/rev173215-claim.png`）；测完 provider / 假 Key / store / 历史**全部复原**（`_shots/rev173215-restored.png`）。
>    ⚠️ `claimAudit` 刻意做窄：宁可漏报，不要误报（误报一次这条提示就没人信）。
>    **216 收口** ✅ —— 三件按顺序做完：① **任务侧审计** `auditTaskRun`（自动任务收尾那句话也核对，
>    没对应工具 ⇒ 运行记录标失败 + 单独红字；`fixed` 模式跳过）② **手机走查 208–215**（`csv` ⇒ 2 条 ·
>    记账展开 27 条 · 事实条红字与桌面一致 · 4 张截图）③ **`ai@0.8.0` 发市场**（149.4 KB · 整包 sha256
>    `22a7b167…` · keyId `aqua-2026` · 索引 17 条 · 验签 33/34）。vitest **1326 → 1329**。
>    顺带修 215 正则 bug：「已**给这篇**打上标签」原来匹配不上。
>    ⚠️ 手机上的 `ai` 是手动 push 的，**不是市场包**（要从市场装得先切 `fastly.jsdelivr` 镜像）。
>    **217 真模型实测** ✅ —— 一上来就复现 209：模型说「任务已建好并已启用（id `tmvq4hr4js2`）」，
>    但 `store.tasks` **0 个**、一次工具没调（审计当场红字）。还多送一个新 bug：**模型照抄宿主标记**，
>    在回复末尾伪造「[较早轮次的工具] ✓task_create」。修法：历史元信息改 `<系统记录 …>` 边界 + system 规则 8 +
>    新 `stripHostNotes`（渲染与存盘前剥掉伪造段）。**复测**：模型真调 `task_create`（任务真建成）且不再伪造 ·
>    任务侧真模型跑任务 4 步 `tag_add` 成功 **不误报** · mock 任务说「已移到 工作/」不调工具 ⇒ `claimWarning` 报警。
>    vitest **1329 → 1333**。测完已复原（假 Key / store / 测试任务 / 对话历史）。
>    **218 手机装市场包** ✅ —— 手机市场源切 `jsDelivr · GCore`（raw 仍 100% RST）→ 删本地同名开发版 →
>    点安装 → **成功**：包内 `index.js` 145,553 B + `manifest.json` 3,007 B + **`signature.json`（keyId
>    `aqua-2026`）**，页面变「v0.8.0 已签名」，AI 面板正常加载。**整条链路首次在 Android 闭环**
>    （镜像 → 索引 → 下载 → sha256 → 验签 → 落盘）。
>    ⚠️ **手机 `ai` 现在是市场 0.8.0（=216 内容，不含 217）**；下次 push 开发版要**先删 `signature.json`**。
>    **219 发 0.9.0** ✅ —— 把 217 的修复（伪造系统记录清洗）打进包：`ai@0.9.0` · **151.1 KB** ·
>    整包 sha256 `034f4c92…` · 入口 `459b8e69…` · keyId `aqua-2026` · 索引 17 条（0.8.0 → 0.9.0）·
>    `verify-trust` **34/35**（`theme-sepia` 纯样式）· verify 全绿 · vitest 1333（无代码改动）。
>    **下个会话第一件事**：① 手机去「发现」把 `ai` 从 0.8.0 **更新**到 0.9.0（验证「更新」路径，跟首次安装不是一条）
>    ② 手机改回开发版走查要**先删 `signature.json`** ③ 安卓桌面组件（ROADMAP §3 大块）。
>    **220 手机更新到 0.9.0** ✅ —— 撞上 **CDN 索引缓存滞后**：GCore / testingcf 的 index.json 仍是 0.8.0，
>    raw 本机全超时（连 5 KB 索引都超时、老包 0.8.0 也超时 ⇒ 不是包的问题），只有 **`jsdelivr.b-cdn.net` 最新**。
>    ⇒ 手机用「自定义地址」填 b-cdn 索引 → 出现「↑ 更新 0.9.0」→ 更新成功：`index.js` **147,239 B** ·
>    manifest `"version": "0.9.0"` · `signature.json` keyId `aqua-2026` · 页面「v0.9.0 已签名」· 面板正常加载。
>    测完镜像恢复 `jsDelivr · GCore`。
>    ⚠️ 教训：**发版后立刻用手机验「更新」会撞缓存**（jsDelivr `@main` 缓存 12h 内逐节点刷新），
>    要么等，要么自定义地址指向已刷新的节点。
>    **221 交接** ✅ —— 本会话 7 个 rev（214–220）· HEAD `a45e7e0` · 与 origin 同步 · 工作区干净 ·
>    verify 全绿 · vitest **1333** · 市场 17 条（ai **0.9.0**）· dev pid 35548（20.9 小时）·
>    手机 `ai` = 市场签名包 0.9.0（与源码 rev217 一致）。主线：**让 AI 的「完成」变成宿主可验证的事实**。
>    **下个会话第一件事**：按 **ROADMAP §3.5 排期**（2026-10-28 定稿）开工 ——
>    ① ✅ **音视频内联播放**（**rev173.226**：`video`/`audio` 内联 + Rust `kind=media` + 插入提示；
>       **2026-10-28 安卓重编真机验过**：`readyState 4`、`play()` 后 `paused=false`、附件计数含 mp4）
>    · ② ✅ **待办删除线**（**本来就有** —— atomic 自带 `.cm-atomic-task-done`，桌面 + 手机都实测）
>    · ③ ✅ **导入目录语义**（**rev173.227**：落 `日期导入/<日期>/[原分类/]` + frontmatter；手机实测
>      从 `/sdcard/Download` 导入落点正确）· ④ ✅ **引用 hover 预览**（**rev173.228**：桌面 hover 350 ms /
>      手机长按 450 ms 弹「标题 + 摘要」，与跳转共用 `findWikiNote`）
>    ⑤ ⚠️ **调试面板**（**rev173.229 部分完成**：结构化日志 + 错误堆栈 + 诊断表 + 模拟触发 + 重载全部；
>      **未做**单插件热重载 · 沙箱控制台 · 内存/CPU 监控 · 跳过权限）· ✅ **版本回滚（§2.14）已完成**
>      （**rev173.230**：装新版前整目录存档 3 份 + `list_plugin_versions` / `rollback_plugin` +
>      回滚前备份 `store.json` 到 `_backup/` + `manifest.storeVersion` 降级两段式；桌面 CDP 实测）
>    · ⑥ ✅ **核心能力接管（§2.15 前半）已完成**（**rev173.231**：`search.query` +
>      `storage.read/write/exists/list` 可被插件接管 —— 启用即接管 / 禁用即回退 / 优先级冲突可选并记住 /
>      防重入；设置页「核心能力」块；**`editor.render` 不做**，用户已拍板）
>    · ⑦ ✅ **附件同步 · 期 1 ✅173.232 / 期 2 ✅173.234 / 期 3 渲染 ✅173.235**（期 1：≤1 MiB 复制 / >1 MiB
>      引用不复制 + `sha256` 引用台账 `<库>/.zn-assets/manifest.json`；期 2：**图片两模式** —— A 引入原图
>      （>1 MiB 只引用 + 预览图入库）/ B 压到 ≤1 MiB 入库；Rust `image` 双阶梯压缩 · 透明图无损 WebP ·
>      GIF 不压 · EXIF 转正；设置页「图片插入模式」；期 3：**库外绝对路径可渲染** —— patch atomic 三处正则
>      支持尖括号目标（含空格路径）、前端剥尖括号 + 解 `%xx`、破图显示「图片不在本机：<路径>」。
>      cargo 67 · vitest 1404）
>    · **下个会话第一件事**：~~期 4 的两个正文入口~~ ✅ **已做（rev173.239）** ——
>      媒体「原文件不在本机 · 同步」（播放失败时按钮 → 确认 → 落地 → **改写引用**）· 模式 B「同步原图」
>      （预览浮层按钮；原图已在本机则直接显示原图）。顺带修 `upload_one` 的**模式 B 上传 bug**
>      （原来优先传压缩版 ⇒ sha 必然不符，原图根本传不上去）。剩 ① **WebDAV 后端真机验证**（自建 DAV 桩）
>      ② 手机未验（改了 `assets.rs` ⇒ 要重装 APK）③ 库外**非媒体**附件的「文件卡片」
>    · ⚠️ **期 3 的边界**：媒体内联（173.226）与引用 hover（173.228）早于本期；本期补的是「库外绝对路径
>      + 含空格路径 + 破图提示」。**文件卡片**（非媒体附件的库外引用）仍是普通链接，点开由宿主分流
>    · ⑧ ✅ **附件同步 · 期 4（跨设备手动搬运）** 已完成（**rev173.238**）—— 新模块 `src-tauri/src/assets.rs`
>      （后端 `local-folder` / `webdav` · 云端临时区 `.zn-asset-staging/<sha16>/<文件名>` + `.zn-ack` ·
>      状态按「云端目录 + ack」实时算）+ **7 条命令**（config / pending / upload / remote / land / cleanup / relink，
>      上传与落地都校验 sha256）+ 设置页**「附件」tab**（上传 / 接收 / 清理，每次动作前 `window.confirm` 点名 + 写体积）。
>      桌面两库 + 共享目录实测全链路（上传 → 落地 + 引用改写 → 删云端）；cargo **76** · vitest **1419**。
>      **手机端也已验**（33b676f6，APK 重编装 01:31）：配置 → 刷新云端 → 接收 6.9 MB → 落地逐字节一致 +
>      引用改写 + 台账 devices + ack → 清理，全过
>    · ✅ **期 4 的两个正文入口**（**rev173.239**）—— ① 媒体播放失败 ⇒「原文件不在本机 · 同步」按钮
>      （`upgradeMediaWidgets` 的 error 分支，只在源是库外绝对路径时挂）② 图片预览浮层「同步原图」
>      （打开预览查台账：`devices[本机]` 有值直接显示原图，没有才给按钮）。纯函数进 `kernel/asset-relay.ts`
>      （`normalizeRelayPath` / `findEntryForMedia` / `findEntryForStoredImage` / `localOriginalAbsPath` /
>      `syncConfirmText`）。cargo **77** · vitest **1432** · 桌面两库实测（媒体 readyState 4 + 引用改写；
>      10.6 MB 原图落地逐字节一致 + 预览切原图）
>    · ✅ **Android 大视频已修（rev173.240）**：asset 协议在 Android 上走 `shouldInterceptRequest`
>      （无 206），桌面走 Rust 的 asset 响应器（有 206）—— 一手依据见 HANDOFF。对策 = 新模块
>      `media_server.rs`（只绑 127.0.0.1 · 随机 token · 只服务媒体扩展名 · Range 三形态）+ 前端
>      `media-url.ts` + `mediaEpoch` 换 src；桌面**不启用**。手机实测 2.3 MB / 6 s 视频 `readyState 4`
>      + `play()` 后 `paused=false` + **seek 4.5 s 成功**（`currentTime 4.74` / `buffered 6.00`）。
>      ⚠️ **release 包验不了（2026-10-29 核实，别再排这一项）**：`gen/android/app/build.gradle.kts` 的
>      release 块**没有 signingConfig / keystore**，仓库里也没有 `.jks` ⇒ 构建出的 release APK 未签名、
>      装不上；再加上 `usesCleartextTraffic` 只在 debug 为 true。要验得先有 **Android 签名密钥**（用户资产），
>      不是纯技术活。真被明文策略拦时正解是 `network_security_config.xml` 放行 `localhost`
>    · ⑨ 安卓桌面组件
>    ⚠️ **2026-10-28 更正**：安卓桌面组件**不是**「唯一大块缺口」—— §2.13 / §2.14 / §2.15 / 引用 hover / 导入目录 / 待办删除线 都没做（当日逐章核对，已全部进 §3.0 + §3.5）。
>    ⚠️ **实现细节**：工具名用**下划线**（`note_write` 等）—— DeepSeek 要求 function name 匹配
>    `^[a-zA-Z0-9_-]+$`，点号会被 400 拒掉（本机 mock 不校验，这个 bug 直到 rev173.205 用真 Key 才暴露）。
>    39 问需求 `docs/AI插件-需求-2026-10-27.md` · 7 刀排期 `docs/AI插件-实施计划-2026-10-27.md`（写工具记 rev200，其后三刀顺延）。
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

## 环境现状（活信息 · 2026-10-30）

- **桌面 dev**：双击 `dev.cmd`（vite 1420 · CDP 9222 · 日志 `.self-logs/desktop-dev.log`）。**别用后台 job 托管**（会随会话回收）；
  AI 自己要起时用 `Start-Process -FilePath cmd.exe -ArgumentList "/c","dev.cmd" -WindowStyle Minimized`（独立进程，等价双击，rev173.152 实测可用）；
  **别用管理员跑**（污染 WebView2 UDF ⇒ `0x800700AA`，已污染就用 `scripts\dev.ps1` 绕开）。
  ⚠️ **交接时 dev 是关着的**（rev173.288 测完主动关的：`zeronote.exe` 与 dev.cmd 的 cmd 都已停）。
  要起就按上一行命令；起完 12 秒左右 CDP 9222 就绪（增量编译）。
  ⚠️ **桌面全局插件目录现在是 `import-export` + `sync`（市场签名包：8 个文件 = `manifest.json` + 7 个 `files`）** ——
  旧的 `sync-webdav` / `sync-folder` 被移到 `_tmp-plugin-backup/consolidation-20261030-2335/`
  （要退回就从那里移回，别删这个目录）。
  ⚠️ **手动解 `.znp` 装插件时别漏 `manifest.json`**：`.znp` 是 JSON 包
  `{ znp:1, manifest, files:{路径:内容} }` —— `manifest` 是**顶层字段、不在 `files` 里**。
  第一次装 sync 时只写了 `files` ⇒ 内核报「读取插件文件失败」、插件中心显示 0 插件（rev173.288 踩过）。
  ⚠️ **手机端（adb `33b676f6`）还是 4 个旧同步插件**，dev 包 pid 11789 在跑 —— 见「下个会话第一件事」。
  ⚠️ **零插件验证做过四次**（B3 rev173.258 / B4 rev173.260 / B6 rev173.262）：临时把 `<appdata>\.zn\plugins` 改名
  → reload → 截图 → 改回 → reload；每次都已恢复（**18 个**、无 `plugins-*-bak` 残留）。
  **B6 那次还额外验证了「禁用 → 启用 hello 不 reload 就回来」** —— ⚠️ 教训：当时在插件中心页面看侧栏，
  一直看不到是**正常的**（系统页不渲染侧栏），别误判成「热启用失效」。
  ⚠️ **改 `patches/@atomic-editor__editor@…patch` 后必须重启 dev**（vite 预构建缓存在内存里，删文件也不重建）：
  结束 dev 进程树 → 删 `node_modules/.vite` → `Start-Process cmd.exe /c dev.cmd -WindowStyle Minimized`。
- **Low IL 会让 dev 起不来**：`icacls src-tauri /setintegritylevel (OI)(CI)Medium`（`target` 同步）。判据 = `create_dir_all` 报「拒绝访问 (os error 5)」。
- **改 `tauri.conf.json` / `Cargo.toml` ⇒ tauri CLI 自动重编并重启**（重编期间与 `cargo test` 争 `CARGO_TARGET_DIR`，verify 等几分钟是排队不是卡死）。dev 窗口「关于」的版本号由 **vite 启动时**求值，改 `package.json` 不热更新。
- ⚠️ **编辑器 CSS 在一个 JS 模板字符串里**（`src/components/MarkdownEditor.tsx` 中段）—— 注释里写**反引号**会提前终止字符串 ⇒ 整页白屏（`vite:oxc` 报 "Try inserting a semicolon here"）。rev173.236 踩过一次。
- **Android dev**：`android-dev.cmd`（日志 `.self-logs/android-dev.log`）· gradle wrapper 走腾讯镜像 · `rustup` 操作必须串行。
  ⚠️ **交接时有一个 watch 进程在跑**（AI 用 `Start-Process cmd /c android-dev.cmd` 起的独立进程，20:38:40 起）——
  会话结束不会消失（不是后台 job），**下次要编之前先清它的进程树**（它占着 `.self-logs/android-dev.log`）。
  ⚠️ **单拼 `gradlew :app:testArmDebugUnitTest` 可以**（rev173.242 起的 JVM 单测入口），但别与 watch 同时跑 ——
  两者都碰同一条 rust/gradle 链。
- **手机 `33b676f6` = 测试机，只跑已装的 dev 包**：`versionName` 仍写 **0.5.0**，但 **2026-10-30 20:47 又被重编重装**
  （`pnpm tauri android build --debug --target aarch64` → `gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
  → `adb install -r`；**这次含 rev173.281 的 `tauri-plugin-share`**，app pid **11789**）。
  重启前**必须**先补 `adb reverse tcp:1420 tcp:1420`，否则 15 秒静默退出。
  该 APK 含 **rev173.242 的桌面组件**（`gen/android/.../Widget*.kt` 8 个 + 3 套布局）+ **rev173.243 的 `WidgetRefresher`**
  + rev173.238 的 `assets.rs` + rev173.240 的媒体服务 + rev173.281 的分享插件。
  **Rust 侧现在到 rev173.281**；**前端随桌面 vite HMR** ⇒ 别再按 0.5.0 的功能边界判断（B1/B2 的 UI 已真机可见）。
  ⚠️ 手机库 = `/storage/emulated/0/Documents/ZeroNote`（**不是**私有 `files/`；`run-as ... ls` 根下的 `vault` 是旧的另一份）。
  ⚠️ 重编前先清**旧的 android-dev 进程树**：它占着 `.self-logs/android-dev.log` 与两个 `adb logcat`，
  新编译会报「The process cannot access the file」（rev173.228 踩过，见 HANDOFF 正文「踩坑」）。
  启动：`adb -s 33b676f6 shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity`。
  adb 里有两个离线残留 ⇒ 所有命令带 `-s 33b676f6`。改前端不用重装（连桌面 dev 的 vite，reload 即生效）；**改 Rust 必须重装**。
  - 手机 CDP：`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`（换进程先 `forward --remove`），
    然后 `ZN_CDP=http://127.0.0.1:9333 ZN_TARGET=tauri.localhost`。**普通 DOM 截图走 CDP `shot` 可以**，
    只有 canvas / video 画面抓不到（rev173.228 实测：video 截图是全黑但控制条有，`readyState/play()` 才是判据）。
  - 手机 `adb push` **多个中文名文件一次推**会 `failed to read copy response: EOF` ⇒ 逐个 push（rev173.228 实测）。
  - **手机插件根 = `/data/user/0/com.aqua.zeronote.debug/.zn/plugins/`**（**不是** `files/.zn/`；`run-as ls files/` 只有 `profileInstalled`）。
  - **桌面组件（rev173.242）**：三个 provider 已在系统注册（`dumpsys appwidget` 的 380/381/382）。⚠️ MIUI 的「全部应用 → 支持小部件应用」
    列表**不收录**本应用（加不加 `previewImage`/`previewLayout` 都一样），要从「**安卓小部件 → 添加小部件**」进，按应用分组里才有。
    数据快照 = `<dataDir>/.zn/widget-data.json`（`run-as cat .zn/widget-data.json` 可看内容；写入由前端 effect 节流 10 秒）。
    ⚠️ `adb shell input tap` 吃**真实屏幕像素**（1220×2712），而 WebView 的 CSS 视口是 **390×868 / dpr 3.125**
    ⇒ 坐标 = **DOM rect × dpr**（`read_image` 预览是 838 宽，按预览目测会偏；rev173.281 因此白点两次，
    y 偏了 122px —— 先 `cdp.mjs eval` 量 rect 再点）。
    装开发版：`adb push <文件> /data/local/tmp/x` → `adb shell run-as com.aqua.zeronote.debug cp /data/local/tmp/x .zn/plugins/<id>/<名>` → reload。
  - 现有插件 **17 个**（9 预装 + 记账 / 阅读器 / 打卡 / 导图 / 两个主题 + **`security` / `secrets` 开发版**，rev173.166 手装；`backup` 已是**市场签名包 0.3.1**（rev173.191 装、带 `signature.json`，此后内置不再覆盖它）；**`ai` 是市场签名包 0.9.0**（rev173.220 从 0.8.0 更新上来，带 `signature.json`，与源码 rev217 一致））。手机主库 `secrets` 环主密码 = `PhoneTest123`，**已绑指纹**（rev173.168）。手机市场源已切 **`jsDelivr · GCore`**（localStorage）。
  - ⚠️ **PowerShell 的 `$pid` 是只读变量** —— 存 app pid 要用 `$appPid`，否则 `adb forward` 会指向错误 socket（rev173.166 踩过）。
  - ⚠️ **`adb reverse tcp:1420 tcp:1420` 会丢** —— 丢了表现为「启动 15 秒后无声退出」（看门狗杀进程）。重连 adb / 重启后先补这条再 `am start`。
  - ⚠️ **☰ 短按 = 抽屉 · 长按 600ms = 菜单**；CDP `click` 点不动长按，得 `adb shell input motionevent DOWN/UP`。
- **桌面 CDP**：9222 · 坐标有 **32px 垂直偏移**（`.zn-titlebar`）· 菜单入口 = **右键 ☰**（左键开文件树栏）。
- ⚠️ **全局插件目录里的插件是「拷贝」，不是链接**（`<APPDATA>\com.aqua.zeronote\.zn\plugins\<id>\`）—— 改了
  `examples/` 里的源码**不会**自动生效，要么删掉那份再建 junction，要么在插件页重装。本会话实测：
  测试库的 `security` 里仍是 0.1.x（不含 vault 按环拆），所以**换设备验证 vault 迁移前先把 `security`
  同步进全局目录**。
- **本会话手动更新过全局目录（2026-10-30）**：`backlinks` → **0.2.2**、`history` → **0.2.1**（B4 迁挂载位）、
  `import-export` → **0.1.1**（B6 改 `main`）；旧文件备份都在 `_tmp-plugin-backup/b4-20261030-0245/` 与
  `_tmp-plugin-backup/b6-20261030-1227/`。`hello` 用 junction 装过、验完已删（18 个插件无变化）。
  ⚠️ **rev173.281 把 `import-export` 换成了开发版（无 `signature.json`）** —— 它带新条目菜单
  （「导出为…」6 子项 + 「分享…」）与 `io.share`；桌面旧签名包备份在
  `_tmp-plugin-backup/j18-20261030-2020/`，手机旧版备份在 `_tmp-plugin-backup/phone-import-export-j18/`。
  **0.9.0 收口时必须重打包签名发市（0.1.1 → 0.2.0）**，否则用户拿不到这两个入口。
  ⚠️ 手机上的 `backlinks` / `history` 仍是旧版（market 签名包 0.1.0/0.2.x），
  要从市场更新才会拿到新挂载位 —— 手机上它们目前走旧路径（状态栏 / sidebar 回退主区），不算坏。
- **测试库** `_tmp-vault-tb/`（不入库）· **插件只有全局目录一处**，测试插件只放 `examples/`、用完即删 · **开发中要试的插件 = 在 `<APPDATA>\com.aqua.zeronote\.zn\plugins\` 下建 junction 指向 `examples/<id>`**（库内 `.zn/plugins/` **不再被扫描**，rev173.5 起只有全局根 —— rev173.180 踩过：挂测试库后 reload 命令表里什么都没有）· 全局目录里的 `secrets` 是**开发版（无签名）**（rev173.163 实测拷入；市场版已签名，重装即覆盖）· 测试库 `secrets` 环测试主密码 **`TestPass123`**，库内有 1 个 `GitHub / aqua@example.com` 测试账号，**已绑 Windows Hello**（rev173.169）· 测试库 **`notes` 环主密码 `NotesTest123`**（rev173.180 建，私密笔记测试数据已清，环保留）· **AI 插件（rev173.196）已建 junction**：`ai` → `examples/ai`，改源码后 `location.reload()` 即生效。
- ⚠️ **桌面全局目录的 `security` 也是开发版**（rev173.169 换成带 Hello 适配器的版本；旧文件备份在 `_tmp-plugin-backup/`）。手换插件 `index.js` 后**必须同步 `manifest.json` 的 `sha256`**（入口哈希），否则插件加载但命令全部不存在 —— 本会话踩过。
- **Git**：GitHub `aqua7773`（gh 已登录、keyring）· `git push` **先直连，被 reset 再挂本机代理 `$env:HTTPS_PROXY='http://127.0.0.1:26561'`**。
- **Rust**：`CARGO_TARGET_DIR` 必须在工作区外（本机铁律）；Rust 测试临时目录 `<repo>/_tmp-test/`。
- **补丁**：`patches/@atomic-editor__editor@0.6.2.patch`（空标题不隐藏 `#`），升级必须重打 · `.gitignore` 排除 `_shots/` `_tmp-*/` `examples/*/store.json`。
- **插件签名密钥（2026-10-25 生成）**：keyId **`aqua-2026`** · 私钥 `%USERPROFILE%\.zeronote-keys\aqua-2026.key.pem`（**仓库外，绝不入库**）· **公钥已内置进应用**（rev173.146，`src-tauri/src/lib.rs` 的 `BUILTIN_TRUSTED_KEYS`；改它要跑 `node scripts/verify-trust.mjs`）· 本机那份 `<APPDATA>\com.aqua.zeronote\.zn\trusted-keys.json` **不再是必需**（同 keyId 只会覆盖内置值），留着无害 · 公钥值 `iOIIUrkdKmP0w+pwpgqGiqSsLJYfl9Pa5VeUCBCjh6E=`
- **插件包与市场（rev173.150 起）**：包**入库**在 `market/packs/*.znp`（30 个 · 约 1.5 MB —— **含各历史版本，别在这里写死个数**），索引 `market/index.json` **17 条**，
  下载 URL = `raw.githubusercontent.com/aqua7773/zeronote/main/market/packs/…`（**不是 Release**：`github.com:443` 国内直连不通，
  走 Release 会「能看不能送」）。打包 `node scripts/pack-plugin.mjs <id> --key <私钥>`（默认就写 `market/packs/` + raw url）→
  `node scripts/gen-market.mjs --write`（会校验「包在不在 + sha256 对不对」）→ 提交 `market/`。
  `dist/*.znp` 仍是不入库的构建产物；Release `plugins-v0.5.0` 那 13 个包**留着当镜像**，索引不再指向它。
- **0.9.0 已发版（rev173.282 · 2026-10-30）**：GitHub Release
  https://github.com/aqua7773/zeronote/releases/tag/v0.9.0 —— 6 个附件（Windows `setup.exe` 14.23 MB / `msi` 15.88 MB +
  Android `arm64-v8a` 32.57 / `armeabi-v7a` 26.40 / `x86` 32.57 / `x86_64` 32.28 MB，签名 `CN=ZeroNote`）；
  本机留底 `_build/v0.9.0/`（**不入库**；重出步骤见 HANDOFF rev173.282）。插件市场同轮迭代 4 个（见上「插件包与市场」）。
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

