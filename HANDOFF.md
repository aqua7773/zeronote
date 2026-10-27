# 项目交接

revision: 173.230
更新时间: 2026-10-28 · 最新 rev173.230
项目: ZeroNote

> **只保留当前版本周期（rev173.125 起）。更早的按版本归档：**
>
> | 版本 | rev 范围 | 归档 |
> |---|---|---|
> | 0.4.0 | rev173.124 – rev173.71 | [0.4.md](docs/archive/handoff/0.4.md) |
> | 0.3.0 | rev173.70 – rev173.28 | [0.3.md](docs/archive/handoff/0.3.md) |
> | 0.2 及更早 | rev173.27 – rev30 | [0.2.md](docs/archive/handoff/0.2.md) |
>
> 按 rev 号查：`git grep -n "rev173.100" -- docs/archive/handoff/`
> 为什么分卷：每个新会话都要读本文件，分卷前 890 KB（rev173.139）。

## rev 索引（最新在前 · 按 rev 号搜本文件即可跳转）

| rev | 内容 |
|---|---|
| rev173.230 | 2026-10-28 · **插件版本回滚（需求 §2.14 · 排期 5b）**（用户「继续」，先确认工作区与基线全绿）：① **安装时存档** —— `install_pack` 换目录**之前**把旧版本整目录复制到 `<应用数据目录>/.zn/plugin-versions/<id>/<version>-<ms>/`，只留最近 **3** 份（按目录名**尾部时间戳**排序，不按版本名）；存档失败只记日志、不阻断安装 ② **两条 Rust 命令** `list_plugin_versions` / `rollback_plugin`（`force` 两段式）+ `manifest.storeVersion`（数据格式代际，可选整数）③ **回滚**：① 备份当前 `store.json` 到 `_backup/<ms>-store.json`（保 10 份）② 当前版本**也存档**（回滚后能滚回来）③ 存档复制上位、删旧目录，失败恢复原版本 ④ **反向迁移**：当前代际 > 目标代际 ⇒ 先返回 `needConfirm`（**磁盘一个字节不动**）⇒ 带 `force` 再调时用**该版本存档里的 store** 替换（数据跟着回退），无快照则保留当前数据 + `warning`；内核**不调用插件代码**做 down-migration（插件不可信 / 回滚发生在加载前）⑤ **UI**：插件行「版本记录」按钮（History 图标）→ 对话框（版本 / 时间 / 体积 / 含数据 / 回滚）+ 插件行「回滚」；降级时红框「仍要回滚 / 取消」。**测试**：cargo 55 → **59**（4 条：保 3 份 / 回滚保数据+备份 / 降级确认+force 回退 / 非法 stamp）· vitest 1373 → **1379**（6 条：对话框列表 / 回滚成功 / 降级两段式 / formatBytes / formatVersionTime / 内置插件回滚标记）。**桌面实测**（CDP 造 `rollback-probe` v1/v2 探针，测完已删干净）：装 v1（store `{gen:1}`）→ 装 v2 ⇒ `.zn/plugin-versions/rollback-probe/1.0.0-…/` 出现（含 store）；打开版本对话框 ⇒「v1.0.0 · 04:11 · 426 B · 含数据」→ 点回滚 ⇒ 红框「第 2 代 vs 第 1 代」**磁盘未动**（仍 2.0.0 / gen 2）→「仍要回滚」⇒ 当前 **1.0.0** + `index.js` 是 v1 + `store.json` **`{gen:1}`** + 存档多一份 **2.0.0** + `_backup/` 2 份 + 日志「插件已卸载 → 插件已加载」。截图 `_shots/rev173230-{versions-dialog,need-confirm,rolled-back}.png` |
| rev173.229 | 2026-10-28 · **开发者调试面板（§2.13 的一半）**（用户「继续」· 排期 5）：① **结构化日志** —— `PluginLogEntry { ts, pluginId, level, msg, stack }`（契约新增）；`PluginHostDeps.onLog` 多带归属插件与堆栈，`scopedHost` 包 `host.log`（error 时捕 `new Error().stack`，栈里有插件帧）；`kernel.audit()` 新增 `pluginTopics` ② **诊断表** —— 插件页新「调试」tab：插件 / 命令数 / 面板数 / 服务数 / 订阅 topic / 版本（18 个插件全列出，含纯样式）③ **模拟触发** —— topic + JSON payload → `event.emit` ④ **错误归属** —— 命令执行失败与事件处理器异常改记 `error` 并反推 `plugin:xxx` 归属 + 带堆栈 ⑤ 重载全部 / 清空日志 / 写测试日志 / 开发者模式开关（localStorage）。**未做**：单插件热重载 · 沙箱控制台 · 内存/CPU 监控 · 跳过权限确认（详见 ROADMAP §3.0）· **版本回滚（§2.14）本轮没做**，已拆成 §3.5 的 5b 作为下轮第一件事。实测：调试 tab 打开 · 统计「已安装 18 · 启用 17 · 命令 210 · topic 7」· 诊断表 18 行 · `zn:probe` 发射成功 · 测试日志的 error + 堆栈可展开（`_shots/rev173229-dev-panel.png`） |
| rev173.228 | 2026-10-28 · **引用悬浮预览 + 安卓重编真机验证**（用户「继续，安卓也编译测验」）：① **需求 §4.5 引用 hover** —— 新 `src/lib/wiki-preview.ts`（`findWikiNote` / `previewSnippet` / `wikiTarget`，纯函数 +12 单测）；`openWikiLink` 与预览**共用** `findWikiNote`（ID → 路径 → 后缀 → 标题），不会「点开 A、预览 B」；桌面 `mouseover` 停 350 ms、手机 `pointerdown` 长按 450 ms（移动 >10 px 取消）弹浮层「标题 + 正文前 140 字」（剥 frontmatter / 代码块 / 图片 / 链接），找不到显示「没有找到这篇笔记」，滚动 / Esc / 点别处都收；摘要 5 秒缓存、每次现查 ② **安卓重编 + 真机验证**（`tauri android dev` · 手机 pid 25184）：视频 `<video>` `readyState 4` + `play()` 后 `paused=false`（附件计数 5 ⇒ `kind=media` 生效）· 待办已完成行 `line-through` · 从 `/sdcard/Download` 导入 ⇒ `日期导入/2026-10-28/导入样本.md` · 长按 700 ms 弹浮层且松手**不跳转** ③ 五个踩坑（旧 android-dev 进程占日志 / 长按抑制标记时机 / CSS 模板里的反引号 / Android 单数 `Download` / 多文件中文名 push 报 EOF）全部记进正文与代码注释 |
| rev173.227 | 2026-10-28 · **排期 2 + 3：待办删除线（核实：本来就有）+ 导入目录语义**（用户「继续」）：① **§4.4 零代码改动** —— ROADMAP 原写「勾选后加删除线未做」是**误判**：atomic 自带 `.cm-line.cm-atomic-task-done { color: faint; text-decoration: line-through }`（`dist/styles/inline-preview.css:414`），实测勾选后行类出现、`getComputedStyle().textDecorationLine = line-through`、颜色 `rgb(113,113,122)`、未完成行 `none`、文本与位置不变、磁盘落盘 `- [x]` ② **§12 导入落点改造**（`examples/import-export/index.js`）：`日期导入/<YYYY-MM-DD>/[原分类/]<文件名>.md`（同一天多次导入合并同一目录）；分类默认从**源文件父目录**猜（`guessCategory`，桌面 / 下载 / 缓存 / 盘符根不猜），命令支持 `category` 显式指定；导入时补 frontmatter `created`（导入时刻）+ `source`（原文件名），已有同名键不覆盖；`freeRelPath` 改收完整 base ③ **AI 排除名单加 `日期导入`**（`examples/ai/index.js` 的 `EXCLUDED_DIRS`）—— 需求 §12「导入后不立即让 AI 整理」，不加就会被自动任务吃掉 ④ 单测 **+17**（`tests/import-export.test.ts`：清洗 / 猜分类 / 日期戳 / 落点 / frontmatter 合并）+ ai-tasks 一条断言。**实测**：`工作/周报.md` → `日期导入/2026-10-28/工作/周报.md`（分类自动）· 重导 → `周报-1.md`（同目录合并）· `category:'自定义分类'` → 该目录 · 磁盘 frontmatter 正确（保留原 `tags`、追加 `created`/`source`）· 文件树三层结构正常 |
| rev173.226 | 2026-10-28 · **音视频内联播放**（用户「开工」· 排期 1）：① **内核媒体渲染** —— `MarkdownEditor.tsx` 新增 `upgradeMediaWidgets`，复用 `imageAssetPlugin` 的 MutationObserver，把 `![](clip.mp4)` 的 image 块（atomic 一律当图片）换成 `<video controls>` / `<audio controls>`，asset URL 规则与图片一致；**幂等**（`data-zn-media` + 无 img 跳过，CM6 虚拟化重挂载自动重升）、**不抢光标**（capture 阶段掐掉 atomic 挂在 wrap 上的 mousedown）、**失败说话**（`error` 事件写明确提示）② **Rust 附件白名单** `MEDIA_EXTS` + `is_media` + `kind = "media"` 进 `list_notes`（mp4/webm/mov/m4v/ogv + mp3/m4a/aac/ogg/oga/opus/wav/flac/weba + 播不了的 mkv/avi/wmv/flv/mpg/mpeg/ts/m2ts/mts/3gp/wma/ape/aiff/aif/amr）③ **插入时检测**：能播的写 `![]()` 内联、播不了的容器写 `[]()` 链接 + toast 提示转 MP4/MP3 ④ **CSP 加 `media-src`**（不加会被 `default-src 'self'` 拦掉 asset:）⑤ 文件树「附件」分组收 media + 扩展名徽章、状态栏附件计数。单测 +11（`tests/media-render.test.ts`，扩展名 / URL query / 不可播容器 / 提示文案）· **桌面实测**：video `readyState 4` / 320×240 / 点播放 `paused=false` / audio `duration 1` / mkv toast 原文 / 附件分组 9 项 / 图片渲染未受影响 |
| rev173.225 | 2026-10-28 · **交接**（用户「排完交接」）：本会话 **3 个 rev（222–224）全是文档**，产出 = ① `docs/附件与同步-需求-2026-10-28.md` 定稿（≤1 MiB 复制/引用二分 · 图片 A/B 两模式 · 台账 `.zn-assets/manifest.json` · 主动调用+每次确认式搬运 · §3.1 媒体容器查证）② ROADMAP **§3.0 补齐 8 条缺口** + **§3.5 排期 10 项** ③ CARD 更正「安卓桌面组件是唯一大块缺口」这个错。**下个会话第一件事**：排期 1 = **音视频内联播放**（1 天）。零代码改动 · verify 六步全绿（02:22:22）· 工作区干净 |
| rev173.224 | 2026-10-28 · **需求整理 + 排期定稿**：用户答完 5 问（① 音视频内联 ② 格式见下 ③ 台账改 `<库>/.zn-assets/manifest.json` ④ 核心能力接管只做 `search.query`+`storage.*`、不做 `editor.render` ⑤ 附件同步「本轮不开工，按合理顺序排」）。ROADMAP 新增 **§3.5 建议排期 8 项**；§3.0 补齐 8 条缺口（音视频 / 调试面板 / 版本回滚 / 核心能力接管 / 导入目录语义 / 引用 hover / 待办删除线 / 附件同步）。**媒体容器查证**（写进附件需求 §3.1）：WebView2 与 Android WebView 都是 Chromium ⇒ 视频只认 **MP4 / WebM / MOV**，**MKV / AVI 是容器不被识别、不是编码问题**，不转码就是播不了；音频 MP3/M4A/OGG/WAV/FLAC 全支持。建议「插入时检测扩展名提示转 MP4 + 播放失败给明确提示」，不内置 ffmpeg。零代码改动 |
| rev173.223 | 2026-10-28 · **附件需求补充（用户口径）**：① 触发方式 = **主动调用 + 每次确认**（笔记里点音频/视频、模式 B 的「同步原图」、附件面板三入口；启动 / 保存 / 定时 / 打开笔记都不自动搬）② 模式 A：≤1 MiB 复制原图，**预览=原图、点开=原图**；>1 MiB 引用原图 + 预览图 ③ 模式 B：**正文与点开默认都是压缩版**，提供「同步原图」，同步成功后点开默认原图。文档同步更新，零代码改动 · verify 六步全绿 |
| rev173.222 | 2026-10-28 · **附件存储与同步需求定稿（用户「先不做」）**：新需求 = 图片与附件统一按 **1 MiB** 分界（≤1 MiB 复制入库 / >1 MiB 引用原文件）+ 图片两模式（A 原图默认 · B 压到 ≤1 MiB 入库）+ 引用台账 `.zn/assets/manifest.json` + 跨设备**手动**搬运（local → 云端临时 → 对端落地 → 删云端，Git 不做）。三点拍板：1 MiB = 1,048,576 字节 · 点开看原图（未同步显示预览 + 角标）· 落地 `<库>/.zn/assets/external/`。文档 `docs/附件与同步-需求-2026-10-28.md`（accepted · 暂不排期）· ROADMAP §3.0 已登记。**零代码改动** · verify 六步全绿（02:22:22）· vitest 1333 |
| rev173.221 | 2026-10-27 · **交接**（用户「交接」）：本会话 **7 个 rev（214–220）**，围绕「AI 不可信」这条线走完调研 → 实现 → 真模型实测 → 发版 → 手机验证。**交接时**：HEAD `a45e7e0` · 与 origin 同步 · 工作区干净 · verify 六步全绿 · vitest **1333** · dev pid 35548（20.9 小时）· 手机 `ai` = 市场签名包 **0.9.0**。三条主线：① 完成声明由宿主核对（对话 + 自动任务 + 界面事实条 + 压缩保结构）② 真模型实测抓出「伪造系统记录」并修（XML 边界 + system 规则 + `stripHostNotes` 出站清洗）③ `ai` 从 0.7.0 走到 **0.9.0** 发市场，Android 首次安装 + 更新两条路径都验过。**下一步**见正文 |
| rev173.220 | 2026-10-27 · **手机把 `ai` 更新到 0.9.0 + 发现「CDN 索引缓存滞后」**（用户「发」后的收尾验证）：手机市场「刷新」仍显示 0.8.0 —— 实测 **`gcore.jsdelivr.net` 与 `testingcf.jsdelivr.net` 的 `index.json` 都还是旧版**（ai 0.8.0），raw 本机也超时（连 5 KB 的 index.json 都 20 s 超时，不是包的问题）；**只有 `jsdelivr.b-cdn.net` 是最新的**（ai 0.9.0）。⇒ 手机用「自定义地址」填 b-cdn 索引 → 列表出现「↑ 更新 0.9.0」→ 点更新 + 确认 ⇒ 手机 `ai` **0.9.0**（`index.js` 147,239 B · `signature.json` keyId `aqua-2026` · 页面「v0.9.0 已签名」）· AI 面板正常加载。测完镜像恢复 `jsDelivr · GCore` |
| rev173.219 | 2026-10-27 · **`ai@0.9.0` 发市场**（用户「发」）：把 217 的修复打进包 —— `stripHostNotes`（渲染与存盘前剥掉伪造的「系统记录」）+ `<系统记录>` 边界 + system 规则 8。`pack-plugin ai --key … --key-id aqua-2026` ⇒ `market/packs/ai-0.9.0.znp`（**151.1 KB** · 整包 sha256 `034f4c92…` · 入口 `459b8e69…`）· `gen-market --write`（17 条，0.8.0 → **0.9.0**）· `verify-trust` **34/35**（`theme-sepia` 纯样式）· verify 全绿 · vitest 1333（无代码改动） |
| rev173.218 | 2026-10-27 · **手机从市场装 `ai@0.8.0`（签名包 Android 首验）**（用户「验证」）：手机市场源 raw 100% RST ⇒ 切 `jsDelivr · GCore` 拉到 17 条 ⇒ 本地开发版与市场同版本显示「已安装」⇒ **先删本地目录**再点安装 ⇒ 成功：包内 `index.js` 145,553 B + `manifest.json` 3,007 B + **`signature.json` 148 B（keyId `aqua-2026`）**，页面变「v0.8.0**已签名**」，AI 面板正常加载。⚠️ 手机 `ai` 现在是市场 0.8.0（=216 内容、**不含 217**）；下次 push 开发版要**先删 `signature.json`**，否则校验对不上 |
| rev173.217 | 2026-10-27 · **真模型实测任务审计 → 抓到「伪造系统记录」**（用户「做」）：真模型第一轮就复现 209 的老毛病 —— 说「任务已建好并已启用（id `tmvq4hr4js2`）」但 `store.tasks` **0 个**、无任何 `task_create` 调用，**审计当场红字**；同时暴露新问题：模型**照抄** `historyContent` 的方括号标记，在自己回复末尾写「[较早轮次的工具] ✓task_create」（它没调过）。修法：历史元信息改 `<系统记录 …>` + system 规则 8（别复述别模仿）· 新 `stripHostNotes` 在渲染与存盘前剥掉伪造段 · 重发同样请求 ⇒ 模型**真调** `task_create`（任务真建成）且不再伪造。vitest **1329 → 1333**。任务侧端到端：真模型跑任务（4 步 `tag_add` 成功）**不误报**；mock 说「已移到 工作/」不调工具 ⇒ `claimWarning` 报警 |
| rev173.216 | 2026-10-27 · **任务侧审计 + 手机走查 + `ai@0.8.0` 发市场**（用户「依次进行」）：① `auditTaskRun` 把 215 的审计接到自动任务 —— 模型收尾说「已打上标签」而本轮没调 `tag_add` ⇒ **标失败** + 运行记录单独一行红字；`fixed` 模式无 reply 跳过；顺带修 215 正则的真 bug（「已**给这篇**打上标签」不匹配）② **手机走查 208–215**：`csv` ⇒ 2 条 · 记账展开 27 条 · 事实条红字与桌面一致（4 张截图），测完手机回「未完成配置」③ **`ai@0.8.0` 发市场**（149.4 KB · 整包 sha256 `22a7b167…` · keyId `aqua-2026` · 索引 17 条 · 验签 33/34）。vitest **1326 → 1329** |
| rev173.215 | 2026-10-27 · **AI 不可信：完成声明由宿主核对**（用户「调研一下别的项目怎么解决」→「开始做」· 零内核改动）：调研落 `docs/AI不可信-调研-2026-10-27.md`（六个一手来源：Cline 完成即工具 / arXiv ECT「终止携带证据」0-288 vs 252-288 / OpenAI output guardrails / Anthropic ground truth / OpenHands+Anthropic 压缩保结构 / aider 自动测试）⇒ 落地最小三件：① **`claimAudit` 审计**（完成词 → 本轮必须有哪个工具成功；逐句判、否定语境跳过、零工具说「搞定」有兜底）② **界面事实条**（红字「这句没依据」+「实际动作 · N 次」）③ **压缩保结构**（`brief` 只留工具名；最近 3 条完整，更早的压缩）。vitest **1311 → 1326**（15 条新单测）· **端到端**：本地 mock 回「任务已经建好了」且不调工具 ⇒ 界面当场红字（`_shots/rev173215-claim.png`），测完配置与历史全部复原 |
| rev173.214 | 2026-10-27 · **重打 `ai@0.7.0` 发市场**（用户「继续zeronote」，在交接卡两件事里选了发市场 · 零代码改动）：市场包停在 208 的 0.6.0，209–212 的 system 提示 / 分组 / 筛选 / 历史步骤都没进包 ⇒ `examples/ai/manifest.json` version → 0.7.0 + description 改「第三版」→ `pack-plugin ai --key … --key-id aqua-2026` 签出 `market/packs/ai-0.7.0.znp`（**141.4 KB** · 整包 sha256 `fc42785f…` · 入口 `a163fb1a…`）→ `gen-market --write` 重建索引（**17 条**，ai 0.6.0 → **0.7.0**）。`verify-trust`：内置公钥与私钥一致 · **32/33 包验签过**（`theme-sepia` 纯样式恒无签名）· verify 六步全绿 · vitest **1311**（无测试改动）。⚠️ 坑：`pack-plugin` 不传 `--key-id` 会写 `default`，gen-market 第 ⑤ 条校验会红 |
| rev173.213 | 2026-10-27 · **交接**（用户「交接」）：本会话 6 个 rev（207–212），AI 插件第一版收口 + 第二版 —— ① 工具名格式单测（4 条，反向验证红）② `plugin_exec` 白名单（勾选 UI + 自动任务同样受限，`ai@0.6.0` 发市场）③ 对话补 **system 提示**（防幻觉，三轮真模型对照）④ 白名单**分组折叠**（137 → 13 组）⑤ 命令**筛选框** ⑥ `list_allowed_commands` + **历史带上工具步骤**（修「模型以为刚查过就不再查」）。**交接时**：HEAD `a93fd18` · 与 origin 同步 · verify 全绿 · vitest **1311** · dev pid 35548（19 小时+ 仍可用）· 测试库无授权 / 无任务。**下个会话第一件事**：手机走查 208–212 的 UI + 重打 `ai@0.7.0` 发市场（市场包还停在 208 的 0.6.0） |
| rev173.212 | 2026-10-27 · **AI 知道「能用哪些命令」+ 历史带上工具步骤**（用户「继续」· 零内核改动）：① 新只读工具 `list_allowed_commands` —— 只返回**已授权**的 id + 标题、另带可授权总数（不把 137 条塞给模型），可选 `query` 再筛 ② **历史压缩把工具步骤全丢了** —— 模型只看到自己上一轮说「0 条」，就以为刚查过、这轮不调工具（实测强制「先调 list_allowed_commands」它仍不调，还声称「查过了，和上面一致」）⇒ `historyContent` 把步骤摘要（`✓/✗ name → 结果`，每条 120 字）附在 assistant 内容后；system 新增规则 5「涉及当前状态（授权 / 任务 / 笔记）要重新调工具」③ **真模型对照**：修复前「还是空的」且不调工具 → 修复后调工具答「能用 1 条 `accounting.stats`（记账：统计）」④ 单测 +9（汇总 4 / 工具定义 1 / 历史步骤 4）。vitest 1302 → **1311** |
| rev173.211 | 2026-10-27 · **白名单命令筛选**（用户「继续做 ai 这边的」· 零内核改动）：13 组仍要逐组展开找「导出 CSV」⇒ 加关键词筛选框（`filterCommands` 纯函数，按 id / 标题、**大小写不敏感**；空查询 = 显示分组）。输入框 `ai.cmd-filter` 回车或点「筛选」触发 `ai.filter-commands`；有筛选时**平铺结果** + 「清除筛选」回分组。新命令（21 → **22**，功能目录已重生成）· 单测 +2 · **桌面实测**：输 `csv` ⇒ 「筛选「csv」：2 条」（导出 / 导入 CSV）· 清除 ⇒ 回到「记账 · accounting · 27 条」。vitest 1300 → **1302** |
| rev173.210 | 2026-10-27 · **白名单按插件分组折叠**（用户「继续做 ai 这边的」· 零内核改动）：137 条平铺 → **13 组默认折叠**（`groupCommands` 按 id 第一段分组、**码点排序**避开 locale 差异 —— CI en-US 与本机 zh-CN 排不同）；`groupLabel` 取命令 title 的「前缀：」；**组标题带上 group id**，否则 4 个「同步」分不清。已授权条目单列在顶部（好撤销），展开状态只在内存（重开面板回默认）。新命令 `ai.toggle-group`（命令数 20 → **21**，功能目录已重生成）。单测 +3（分组 / 排序 / 标题回退）。**桌面实测**：13 组 · 展开「记账」27 条 · 允许 `accounting.stats` ⇒ 顶部「已授权 1 条」⇒ 撤销归零。vitest 1297 → **1300** |
| rev173.209 | 2026-10-27 · **AI 对话补上 system 提示（防幻觉）**（用户「继续做 ai 这边的」· 零内核改动）：rev197–208 的对话请求里**一直没有 system 消息** —— 模型不知道「写工具只出提案」，实测两次谎称任务已建好（208 还编造已删除任务的旧 id）。新增 `CHAT_SYSTEM_PROMPT` + `buildChatMessages`（system 在首位、**不进历史 / 不进 store**，每轮现拼）：pending ≠ 完成 · 说完成前必须真调过工具 · 不编任务 id · `plugin_exec` 只走授权 · 关键参数齐全就直接执行。单测 **7 条** · **真模型对照**：改规则 5 后 `task_create` 58 ms + `task_update` 55 ms 真建成并停用（回复带 id）；另一轮谎称后自己调 `task_list` 并更正「我上一条说建好了是错的」。vitest 1290 → **1297** |
| rev173.208 | 2026-10-27 · **AI 第二版：`plugin_exec` 白名单**（用户「1，2」拍板：设置页勾选 + 自动任务里也允许但仅限勾选命令）· 零内核改动：① 新工具 `plugin_exec`（`command` + 可选 `args` 数组）② 设置页「允许 AI 调用的命令」—— 候选来自 `command.list()`（去掉 `core.*` / `ai.*`），逐条「允许 / 已允许」按钮，落 `store.allowedCommands` ③ 三条硬线：内核命令与 AI 自身命令永不开放 · 未授权返回「命令未授权：…」· 任务里同样受白名单限制 ④ 单测 **9 条**（白名单判定 / 清洗 / 候选过滤 / argv 归一 / 工具定义）⑤ **真模型实测**：未授权 3 ms 拒绝 → 点「允许」后 2 ms 成功、打卡面板真打开；fixed 任务（manual）**22 ms** ok ⑥ **发市场 `ai@0.6.0`**（重新打包签名 + 索引重建）。vitest 1281 → **1290** |
| rev173.207 | 2026-10-27 · **工具名格式单测 + 真模型写工具全链路**（用户「开始」· 零内核改动）：① 新增 `tests/ai-tools.test.ts` **4 条** —— 字符集 `^[a-zA-Z0-9_-]+$` / 唯一 / **执行器分支与 TOOLS 集合一致**（从 `runTool` 抽 `name ===` 分支）/ 发给模型的描述里无点号旧名；反向验证（改回 `note.write` ⇒ 3 条立刻红）② 修 rev205 的漏网 —— **5 处给模型看的文案**仍写点号旧名（`note_create` desc、`task_create.steps` 参数说明、3 处运行时错误文本），模型会照着传错 ③ **真模型实测**：对话 `note_move` 提案→确认→真移动 · `tag_add` 直接生效 · `note_trash` 提案→确认→进回收站；fixed 任务 save 触发 **169 ms**（tag_add 36 + note_move 133）④ ⚠️ 模型会说「任务建好了」而没调 `task_create`（`steps` 空 / `tasks` 空）⇒ 看面板数字与 store 才算数。vitest 1277 → **1281** |
| rev173.206 | 2026-10-27 · **交接：AI 插件第一版**（用户「交接」）：本会话把 AI 插件从 0 做到第一版 —— **9 个 rev（196–205）· 零内核改动**：骨架与设置 → 流式对话 → 只读工具 ×5 → 写工具 ×7 + diff 预览确认 → 任务系统（保存触发 / 串行队列 / 去抖）→ 定时触发 + `fixed` 执行模式 → 三步向导 + token 统计 + 分类抽样 → 手机走查 + 发市场（索引 17 条）→ **工具名改下划线**（真模型 400 的根因）+ 真 Key 抽样。**交接时**：HEAD `5f6a07b` · 与 origin 同步 · verify 全绿 **13:25:36** · vitest **1277** · 质量门 7/7 · dev pid 35548（12 小时+）· 测试库配了真 DeepSeek Key（凭据管理器 `ai.api-key.deepseek`）· 手机 ai 插件已装。**下个会话第一件事**：给工具名加一条格式单测 + 真模型下过一遍写工具全链路 |
| rev173.205 | 2026-10-27 · **AI 工具名改下划线 + 真 Key 抽样**（用户给了测试 Key · 零内核改动）：**第一次用真模型跑工具，抓到大 bug** —— DeepSeek 的 function name 只允许 `^[a-zA-Z0-9_-]+$`，我们 17 个工具里 12 个带点号（`note.create` / `tag.add` / `task.create` …）⇒ 抽样 20 篇**全部 400**（`Invalid 'tools[5].function.name'`）。rev197–203 全走本地 mock，mock 不校验名字格式，**写工具在真模型上从来没能用过**。修法：17 个名字改下划线、24 处引用一起换。**真 Key 抽样**（deepseek-chat · 46k 输入 / 295 输出 ≈ ¥0.03）：本来有目录的 8 篇 **8/8 正确**（7 原目录 + 1 上一级），根目录 12 篇给顶层兜底或按内容归类、无一荒谬，空笔记改为跳过。**改名后真模型全链路验证**：「列文件夹」→ `list_dirs` ✓；「改写根笔记」→ `read_note` → `note_write` 出提案 → 点「采用」→ 磁盘真变 ✓ |
| rev173.204 | 2026-10-27 · **AI 插件收口：手机走查 + 发市场**（用户「补收口」· 零内核改动）：① **手机走查**（`33b676f6`）—— 把 `examples/ai/` 两文件 push 进 `/data/user/0/com.aqua.zeronote.debug/.zn/plugins/ai/`，reload 后 **19 条 `ai.*` 命令 + 2 个面板**加载；三步向导在手机上布局正常（`_shots/rev173203-phone-wizard.png`）；配「自定义 + `http://127.0.0.1:8999/v1`（`adb reverse tcp:8999` 到桌面 mock）+ 假 Key」⇒ **测试连接 200** → 完成配置 → **流式对话**回复正常 → **用量「1 次 · 输入 88 / 输出 12 tokens」**；任务面板空状态正常（`_shots/rev173203-phone-tasks.png`）。走完清干净（删 Key / 删手机 `store.json` / 撤 reverse，重载回「未配置」）② **发市场** —— `pack-plugin ai --key … --key-id aqua-2026` 签出 **ai@0.5.0**（123.2 KB · 整包 sha256 `b8b10eb4…` · 入口 `1a95c873…`）→ `gen-market --write` ⇒ 索引 **16 → 17 条**（`market/packs/ai-0.5.0.znp` + `market/entries/ai.json`）。**剩余唯一没做**：真 API Key 下的人工准确率抽样（本机无 Key） |
| rev173.203 | 2026-10-27 · **AI 插件第七刀：向导 + token 统计 + 抽样（第一版收口）**（用户「继续」· 零内核改动）：① **三步向导** —— 选服务商（自定义时同样给端点输入）→ 填模型名与 Key → 测试连接，每步 badge 标「已完成 / 第 N 步」，走完点「完成配置」收起、换成完整设置区（落 `store.wizardDone`）；**新库不预置任务**（Q34）② **token 统计** —— 流式与非流式两条路都取 `usage`（`prompt_tokens` / `input_tokens` 两套字段名都认），累计进 `store.usage`，对话面板显示「N 次 · 输入 x / 输出 y」，任务面板单独显示任务累计（`taskCalls` 一列）③ **分类抽样** `ai.sample` —— 取 20 篇 `.md` 逐篇问模型「选哪个文件夹 + 1-3 个标签」，结果用表格列出**只读不写**（评估用，不替用户整理）④ 顺手修两处：`fs.listNotes()` 实际**包含附件**（jpg/epub/txt，Rust `collect` 从 rev173.3 起就是）⇒ `list_notes` 工具与抽样都自己过滤 `.md`（契约注释那句"只上报 .md"已过时）。vitest 1262 → **1277**（+15）。**实测**：向导三步全绿 → 完成配置后向导消失、设置区出现 · 发消息后「用量：1 次 · 输入 120 / 输出 30 tokens」· 抽样 20 篇出表（全是 .md）。⚠️ **分类准确率没做**：本机没有真 API Key（mock 只会回固定 JSON），留待用户配好 Key 后点「分类抽样」人工核对 |
| rev173.202 | 2026-10-27 · **AI 插件第六刀：定时触发 + 执行模式**（用户「继续」· 零内核改动）：① **定时** `trigger = {type:'schedule', at:'HH:MM', days:[…]}`，`days` 空 = 每天、`[1..7]` = 每周几；**每分钟 tick + 启动 2 秒补做**，判据 `lastDueAt > lastRunAt` —— 关掉 app 三天再开**只补一次**（不是三次）；新建定时任务时 `lastRunAt = now`，否则中午建「每天 23:00」会立刻补跑昨天那次 ② **两种执行模式**（Q28）：`fixed` = 建任务时排好工具调用、**不调模型**（便宜稳定、断网无 Key 也能跑，参数可用 `{{path}}` 占位符 → 触发笔记路径）；`auto` = 每次让模型看内容自己决定（≤4 步）③ 面板每张卡显示「触发 · 上次 · **下次** · 执行模式」④ `task.create` 加 `at` / `days` / `mode` / `steps`。vitest 1237 → **1262**（+25）。**实测 4 项**：12:51 的定时任务 **12:51:03 自动跑**（schedule）· `lastRunAt=0` 的任务 reload 后 **2 秒补做一次** · **未配置 API Key 时 fixed 任务照样跑通**（打标签 + 移动，证明不调模型）· 5 步 fixed 任务被截到 4 步并记「超过 4 步上限」 |
| rev173.201 | 2026-10-27 · **AI 插件第五刀：任务系统**（用户「继续」· 零内核改动）：任务 = 一句话定义的规则。① **数据** `store.tasks`，触发 `save` / `manual`（`schedule` 留 rev202），每任务留 **最近 10 次**记录 ② **触发链**：内核 `note:saved` → `skipForTasks`（Q24：私密 / 回收站 / 收件箱 / 导入目录）→ **同路径 3 秒去抖**（实测一次保存连发两次）→ `matchTasks`（启用 + 类型 + 目录过滤）→ 串行队列 ③ **串行队列** `createSerialQueue`（两任务同时动一篇会互相覆盖；一步失败不断链）④ **执行**：非流式调模型 + 最多 4 步，`runTool(..., {interactive:false})` —— 自动任务里 `note.write` / `note.trash` **直接拒绝**，`note.move` / `tag.add` / 建笔记建文件夹直接做 ⑤ **任务面板** `ai.tasks`（列表 / 开关 / 立即跑 / 删除 / 展开记录，失败步骤单列）⑥ 5 个工具 `task.create/update/delete/list/run`，`task.create` **按 instruction+触发去重**（实测模型在循环里连调 4 次）。vitest 1214 → **1237**（23 条）。**实测 5 场景全过**：建任务→面板 1 个 · 保存→移到 `工作/` + `tags: [AI分类]` · 停用→不再触发 · 收件箱笔记→不触发 · 任务里 `note.write`→被拒且正文没被改。⚠️ 两个坑见正文 |
| rev173.200 | 2026-10-27 · **AI 插件第四刀：写工具 + diff 预览确认**（用户「继续 ZeroNote」· **零内核改动**）：需求 Q4/Q11 落地 —— **可逆的直接做，不可逆的先给预览**。7 个写工具：`note.create` / `folder.create` / `tag.add` / `tag.remove` **直接生效**（建笔记已存在 ⇒ 报错并指向 `note.write`，不覆盖）；`note.write` / `note.move` / `note.trash` **只生成提案**。行级 diff 用 **LCS**（先剥公共前后缀，中间段 >400×400 退化「全删+全加」，整篇 >2000 行标 `tooLong` 不硬算）+ 面板「待确认」区（diff 块 + 采用/放弃/确认移动/确认删除）。**三条安全线**：① 冲突检测（提案时记旧全文，采用前重读，不一致 ⇒ 拒绝）② 提案只在内存（reload 丢，绝不落 store 后执行）③ 同路径只许一份待确认改写。vitest 1184 → **1214**（30 条新单测：路径边界 / diff 七种形态 / 标签三种 frontmatter 写法 + 幂等 + `stillInBody`）。**CDP 实测 7 场景全过**（采用 / 放弃 / 冲突拒绝 / 移动 `to:'工作/'` 自动拼名 / 回收站 / 标签幂等）。⚠️ 新坑：**WebView2 的 PNA 拦页面 `fetch` 到 `127.0.0.1`**（CSP 有 `http:` 也不管用），本地 mock 要回 `access-control-allow-private-network: true` |
| rev173.199 | 2026-10-27 · **交接**（用户「交接」）：本会话 **AI 插件从需求到第三刀**共 4 个提交 —— ① **39 问需求定稿 + 7 刀实施计划**（`docs/AI插件-需求-2026-10-27.md` / `docs/AI插件-实施计划-2026-10-27.md`，9ce6c9b）② **rev196 骨架 + 设置页**（`examples/ai/` · 面板 · Key 进系统凭据库 · 测试连接三态，2cc4700）③ **rev197 模型调用 + 流式对话**（SSE 逐字 / 停止 / 新对话 / 历史存 store / 9 条单测，a60386a）④ **rev198 只读工具 + 工具循环 + 步骤流**（5 个工具 / 最多 4 步 / 14 条单测，9dea102）。**交接时**：HEAD `9dea102` · **ahead 4 未推送** · 工作区干净 · verify 六步全绿（vitest **1184** · cargo 55 · oxlint 3 · 质量门 7/7）· 桌面 dev pid **35548**（00:58:24 起，**已连续跑 11 小时仍可用**）· 8999 测试端口已释放。**下个会话第一件事**：rev199 写工具 + diff 预览确认。**三条新坑**见正文 |
| rev173.198 | 2026-10-27 · **AI 插件第三刀：只读工具 + 工具调用循环 + 步骤流**：5 个只读工具（`list_dirs` / `list_notes` / `read_note` / `search_notes` / `list_tags`，走 `fs.listDirs/listNotes/readText` + `index.query/tags`）+ **工具循环**（最多 4 步，`assistant.tool_calls` → 执行 → `role:'tool'` 回灌 → 再调）+ **步骤流**（✓/✗ + 工具名 + 耗时 + 结果摘要）+ SSE 的 `tool_calls` **分片累积**（`accumulateToolCalls` 按 index 拼参数，`finalizeToolCalls` 收尾）。单测 9 → **14**（工具分片 5 条）。**实测**（mock 第一轮只回 tool_calls、第二轮引用结果）：说「列一下文件夹」→ 真读测试库 18 个目录 → 回灌后模型复述 → 步骤行 `✓ list_dirs · 6 ms · {"count":18,…}`。⚠️ 坑：`job_kill` 杀不掉后台 node（旧 mock 进程还占着 8999，新 mock `EADDRINUSE`）→ 得按端口找 pid `Stop-Process` |
| rev173.197 | 2026-10-27 · **AI 插件第二刀：模型调用 + 流式对话**（用户「继续」）：`examples/ai/` 加 —— ① **SSE 流式**（浏览器 `fetch` + `ReadableStream`，DeepSeek 允许 CORS）② 两个纯函数 `parseSseBuffer` / `windowMessages` + **9 条单测**（半包 / 多事件 / `[DONE]` / 坏行 / 窗口裁剪）③ 降级 `net.fetch` 非流式（流式失败且一个字没收到才降）④ **停止**（`AbortController`）+ **新对话** ⑤ 历史存 `store`（最多 40 条，发模型只带最近 **20** 条）。**实测**（本地 SSE mock `127.0.0.1:8999` + 页面内 `setTimeout` 定时停止）：逐字渲染、10 段文本完整拼接、停在中途显示「已停止」、`reload` 后历史还在；假 Key 对真 DeepSeek ⇒ **401 原文**（流式与非流式两条路都试过）。⚠️ **踩坑**：CDP `eval` 里的 `__znExec` 是异步的，`eval send → wait 800 → eval stop` 时流往往已跑完（截图前后各一次都拿到完成态）—— 停止测试必须**在页面内** `setTimeout(() => __znExec('ai.stop'), 400)` |
| rev173.196 | 2026-10-27 · **AI 插件第一刀：骨架 + 设置页**（用户「开工」）：`examples/ai/` 新插件 —— 主区面板「AI」+ 服务商预设（DeepSeek / Kimi / 通义 / 自定义 OpenAI 兼容端点）+ 模型名 + **API Key 存系统凭据管理器**（`host.secrets` → 账号 `ai.api-key.<provider>`，不入库不同步；`cmdkey /list` 实测出现 `ai.api-key.deepseek.com.aqua.zeronote`）+ 测试连接（`net.fetch` GET `/models`）。**三态实测**：无 Key → 红字「还没有保存 API Key」· 假 Key → **HTTP 401 + DeepSeek 原文**（`Authentication Fails`）· 输入框回车即保存（`onSubmit`）。示例插件 41 → **42**（功能目录已重生成）。对照：`docs/AI插件-需求-2026-10-27.md`（39 问）· 实施计划 7 刀 |
| rev173.195 | 2026-10-27 · **交接**（用户「收尾交接」）：本会话 **rev173.188–194 共 7 个提交**，主线三条 —— ① **备份插件发市场**（189：`backup` 0.3.1 · 索引 16 条 · 实测「签名包不被内置覆盖」）② **修市场安装清掉 `store.json`**（190：整目录交换前把用户数据搬回；cargo 53 → 55）③ **手机连不上 raw 的根因与解法**（192 错误带源链 → 是 TLS 阶段 RST；193 对照 12 个域名，只有 raw 全灭；**194 市场镜像可切换 + 测速**，5 条内置源，`cdn.jsdelivr.net` 两端都断、GCore/Cloudflare 两端都通）。**交接时状态**：工作区干净 · HEAD `80b0d4a` · 与 origin 同步 · verify 六步全绿（vitest **1170** · cargo **55** · 质量门 7/7）· 桌面 dev pid **35548**（00:58:24）· 手机 pid 31861 / APK **01:00:40**（**不含 194 的镜像 UI**）· 测试端口 8931/8933/8934 全部释放。**下一步候选**：① 默认源是否改成 `jsDelivr · GCore`（现在仍 raw，手机开箱不可用）② 手机重编一次验证 194 的 UI ③ ROADMAP 里「安卓桌面组件」仍是大块未做。**本会话新增的坑**：见正文「四条」|
| rev173.194 | 2026-10-27 · **市场镜像可切换 + 测速**（用户「准备几条镜像可供切换，加个测速功能」）：① **5 条内置镜像**（GitHub raw · jsDelivr · GCore · jsDelivr · Cloudflare · jsDelivr(cdn) · ghproxy.net）+ 自定义地址；**索引地址与包前缀成对切换**（`MarketMirror = { indexUrl, packBase }`）—— 只换索引不换包 = 「能看不能装」② `mirrorPackUrl` **只改写本仓库 `raw.githubusercontent.com/aqua7773/zeronote/…` 形态的地址**，外部作者 / Release / 自建源一律原样（第一版粗暴「只取文件名再拼前缀」被 `tests/market.test.ts` 的老用例当场抓住 —— 回归测试救了真 bug）③ **测速** `probeMirror` 走 Rust `net_request`（与装插件同一条链路），**必须解析出条目才算可用**：只看 200 会被错误页骗（实测 `ghps.cc` 200 但只有 508 字节）④ **桌面实测**：raw 279 ms · GCore 722 ms · Cloudflare 648 ms · ghproxy 1413 ms，**全部 16 条**；**`cdn.jsdelivr.net` 在桌面也 `os error 10054`**（与手机结论一致）⇒ 标签改「国内常断」⑤ 切换后市场列表从新源重拉（16 条），选择存 `zn-market-mirror` ⑥ 连不上时多一句「点测速换一条」的下一步提示。vitest 1147 → **1170**（+23） |
| rev173.193 | 2026-10-27 · **域名对照测试（12 个 · 手机 rustls 实测）**（用户「还有别的域名吗，多测几个」）：**`raw.githubusercontent.com` 6/6 失败**（每次都是 `Connection reset by peer`）· **稳定可用**：`gcore.jsdelivr.net` / `testingcf.jsdelivr.net`（索引 `16764` b64 = 12571 B 正确、包 `49704` b64 = 37278 B 正确，各 2 次全过）· `ghproxy.net`（内容正确）· `api.github.com` / `github.com` 200 · `objects.githubusercontent.com` 404（连上了）· `unpkg.com` 200 · **间歇**：`cdn.jsdelivr.net` / `fastly.jsdelivr.net`（先 1 次 RST，后重测 200）· **不可用**：`gist.githubusercontent.com` 超时 · `raw.gitmirror.com` / `hub.gitmirror.com` / `kkgithub.com` RST · `cdn.statically.io` / `ghfast.top` 超时 · `ghps.cc` 200 但只 508 字节（非真内容）。⇒ **jsDelivr 是最可行的替代源**（`gcore` / `testingcf` 节点 4/4 稳定，内容与 raw 逐字节一致）。未改代码 |
| rev173.192 | 2026-10-27 · **查「手机 Rust 连不上 raw.githubusercontent.com」的根因**（用户「查」）：先给 `net_request` 的错误补上**错误源链**（沿 `std::error::Error::source` 逐层拼 `←`）—— reqwest 的 Display 只有「error sending request」，真因全在 source 里。拿到：**`← client error (Connect) ← Connection reset by peer (os error 104)`** ⇒ **TCP/TLS 被 RST**，不是证书 / DNS / 超时。**对照组（同一台手机 · 同一份代码 · `net_request` 实测）**：`api.github.com` **200** · `github.com` **200** · `objects.githubusercontent.com` **404**（连上了，只是路径不存在）· **`raw.githubusercontent.com` 100% 失败** ⇒ raw 是**域名级针对性干扰**，不是 Fastly 网段、也不是 ZeroNote 的缺陷。两条旁证：① 桌面同一份代码连 raw **200**（桌面 native-tls / 手机 rustls+webpki-roots）② `toybox nc` 到 raw 的 IPv4 与 IPv6:443 **都能建连**（rc=0）⇒ RST 发生在 **TLS 阶段**，不是 TCP 建连。⚠️ 也测了 jsDelivr（`cdn.` / `fastly.`）：**首次 200、随后同样 RST** ⇒ 换镜像也不稳。**未修**（要不要给市场加「备用源 / 可选源」，等用户定）。改动只有错误信息（`net.rs` 一处），无行为变化 |
| rev173.191 | 2026-10-27 · **手机端市场走查（备份插件）**（用户「走一遍」）：① **手机 app 已被 `android-dev` 自动重编重装** —— `versionName` 仍 0.5.0，但 `lastUpdateTime` = 00:36:41（改 `lib.rs` 触发，java 进程 00:32:07 起）⇒ 手机 Rust 是**最新代码**，顺带验了 rev173.190；② **手机 Rust 连不上 `raw.githubusercontent.com`**（「连不上服务器 … error sending request」），但**同一 URL 的 WebView `fetch` 成功**（11690 B）· ping 通（108 ms）⇒ 平台/TLS 层差异，**未查根因**；③ 绕过：本地 http 源（`adb reverse tcp:8934` + 临时索引把每条 url 改成 `http://127.0.0.1:8934`，手机端 `install_znp_from_url` 走明文回环）；④ **5 条全过**：市场 UI 16 条含备份 · `OK:backup` 落盘（`index.js` 34698 · `signature.json` keyId `aqua-2026`）· **`store.json` 的 `interval=1w` 保留**（rev173.190 在 Android 生效）· reload 后「**备份 v0.3.1 已签名**」正常加载 · 面板「自动备份：每周」→ 立即备份 ⇒ **6/30 · 36 篇 5 文件夹 · 含密码库密文 · 1316 ms**；⑤ 清理：store 恢复 `1d`、localStorage 清、reverse 移除、临时索引目录删、8934 停（另清了 `8933` / `8934` 两个 10-25 僵尸 `http.server`，它们是本期 socket hang up 的源头）。无代码改动 |
| rev173.190 | 2026-10-27 · **修「市场安装清掉插件 `store.json`」**（rev173.189 顺带发现，用户「修」）：根因在 `install_pack` 的整目录交换 —— 旧目录整个 `remove_dir_all`，而 `store.json` 是**用户数据**（备份档位 / 打卡计数 / 主题），不是代码。修法：交换成功、**删旧目录之前** `keep_plugin_store(&prev, &dir)` 把旧 `store.json` 拷进新目录；**包内自带同名文件时以包为准**（上游刻意给的初始值 / 换存储格式）；**拷贝失败只 `eprintln`、不中断安装**（store 丢 = 设置回默认，中断安装 = 插件没了，后者更重）。顺带抽出常量 `PLUGIN_STORE_FILE`，`plugin_store_read/write` 与安装共用同一个名字。**测试** `install_znp_keeps_store_json`（升级后 store 原样）+ `install_znp_pack_store_wins`（反向：包内优先）· cargo 53 → **55**，全绿。**真机**：把全局 `backup` 的 `store.json` 改成 `interval=1w` → 页面调 `install_znp` 装同一份 0.3.1 包 ⇒ `store.json` 内容与 **mtime 00:33:09 都不变**、`index.js/manifest/signature` mtime 变 00:34:16（说明整目录真换了）→ reload 后面板「**自动备份：每周 · 上次 10-27 00:26 · 下次 11-03 00:26**」。⚠️ 环境：`8931/8933` 被残留 `python -m http.server` 占着（8931 是本次自己起的、已清；**8933 是 2026-10-25 的历史残留 pid 30832，未动**）⇒ 这两端口别再当测试床 |
| rev173.189 | 2026-10-27 · **备份插件发市场（`backup` 0.3.1）**（用户问「内置跟上市场不冲突吧」→ 答「不冲突，9 个预装里 8 个本来就双份」→ 用户「发」）：**零代码改动**，只走发版链 —— `pack-plugin backup --key <私钥> --key-id aqua-2026`（36.4 KB · 整包 sha256 `eb1f142e…` · 入口 `6cb18e37…` · 签进 `signature.json`）→ `gen-market --write` ⇒ 索引 **15 → 16 条** · **实测**（本地 `http.server 8931` + CDP `install_znp_from_url`，vault 传 `appDataDir()` 不是库根 —— `plugin-roots.ts` 的「把 appDataDir 当 vault 传」约定）：① **负向** 我手抄 sha 少一位 ⇒ 报「插件包校验失败：…实际下载到 …」**不落盘** ② **正向** 用索引里的 sha（脚本读，不手抄）⇒ `OK:backup`，磁盘 `index.js` sha 与包内一致、`signature.json` keyId `aqua-2026` ③ **reload 后插件页「备份 v0.3.1 已签名」且正常加载** ⇒ 证明 `ensureBuiltinPlugins` 的**规则 2（有签名一律不覆盖）**在真机上生效 —— 这正是「内置 + 市场」不冲突的关键 ④ 清理：localStorage 的 `zn-market-index-url` 已 removeItem、服务已停。⚠️ **顺带发现**：`install_pack` 是整目录交换（旧目录 `remove_dir_all`）⇒ **`store.json` 被清掉**，插件重新加载后写回默认值（备份的自动档位回「每天」）—— 对「升级插件保留设置」是个缺口，**本次未修**（不在「发」的范围，rev173.190 已修）。文档同步：CARD 市场数 15 → 16 + 包数改口径（30 个 · 约 1.5 MB，含历史版本，不再写死）· ROADMAP §3.0 索引 16 条 · `market/README.md` 去掉「13 个包 600 KB」死数字 · README 现状行 rev173.189 + **私密文件夹从「开发中·期 1」改成三期已落地**（这句早就该改）|
| rev173.188 | 2026-10-27 · **ROADMAP 现状段纠错（0.5.0 → 0.6.0）**（用户「改roadmap」）：交接汇报时发现 `docs/ROADMAP.md` §0 还停在 rev173.139。逐条对到当前 —— ① 抬头复核日期 → 2026-10-27（rev173.188）② §0 版本 **0.5.0 → 0.6.0**（tag `v0.6.0`），补两条主线（安全 / 密码库 · 插件市场闭环 rev173.137–173）与 0.6.0 之后的私密文件夹三期 + 备份插件；**HANDOFF 大小不再写数字**（分卷时 63 KB，已涨到 263 KB）③ 契约行「最近一次改动 rev173.135」→ **rev173.180**（`doc.registerCodec`），并列出 rev173.163（`input.secret`）—— 原句在两个契约扩展之后就成了假的 ④ §3.0 两行收尾：自动备份「剩余：内置还是发市场（待拍板）」→ **内置已定**（173.178 预装 / 173.179 `D-010` 判据）；私密文件夹「剩：发市场打包 + 手机走查」→ **已完成**（0.2.1 发市 · 173.183 / 184 两平台实测 · 旧 `vault.json` 已查清）⑤ §4 质量门「5 项」→ **7 项**；§5 仍写 `D-008` pending（与 §3.3 矛盾）→ ✅ 已完成 · 另同步了 `docs/README.md` 权威矩阵同源三行（市场第二批 UX / 安全插件「未签名发市」/ 私密文件夹「剩」）· 无代码改动 |
| rev173.187 | 2026-10-27 · **「旧 vault.json 自己回来」：桌面不复现 + 写回是内存态，手机已稳定**（接 rev173.186）：桌面删掉后 60 s 来回都没出现 ⇒ 手机独有。手机上一轮禁用/启用插件 + reload 之后，**删除后 60 s 轮询 12 次全为 False**，换密码后也不再写回 ⇒ **写回需要「旧文件曾在场」的页面内状态**（reload 清掉就没了）。⚠️ **本轮二分方法有缺陷**：第 1/2 轮只等 12–15 s 就判"不写回"，而写回窗口实际 > 15 s（前几次都是 60 s 内才出现）⇒ 那两轮结论不可靠。**现在手机状态稳定**：`.zn/security/` 只有 `vault.secrets.json`，反复删 + 60 s 无写回；`.off` 残留已清。无代码改动 |
| rev173.186 | 2026-10-26 · **查「旧 vault.json 自己回来」的来源（有重大进展，仍未闭合）**：`inotifyd` 盯 `.zn/security/` 抓到事件序列 —— 删掉后约 1 s 内出现 **`vault.zn-tmp` → `rename` → `vault.json`**，**这正是内核 `atomic_write`（`write_note`）的临时文件命名** ⇒ **写回者是 ZeroNote 自己**（不是系统/第三方）。但**主窗口的 `invoke` 无法 hook**（`window.__TAURI_INTERNALS__.invoke` 是 `writable:false / configurable:false`），所以抓不到调用栈；CDP target 只有一个。已排除：库外备份（把它改名移走后仍回来）、MediaStore 条目、Syncthing、备份插件（禁用后一次未复现、也无反向复现）。写回内容是 **897 B 旧格式（`v:1`）**——当前代码生成不了（`vaultPartPayload` 输出 `v:2`）⇒ 最可能是**某个持有旧内容的旧版实例 / 自动修复路径**。无代码改动 |
| rev173.185 | 2026-10-26 · **修「迁移收尾静默失败」+ `security` 0.2.1 发市**：`saveVault` 最后一步从 `purgePrivate(旧 vault.json).catch(() => {})` 换成 `purgeLegacy()` —— **失败不再吞**（最多删两轮，每轮删成功后再等 1.5 s 复查是否被写回），仍不行就 `host.notify` 提示「请手动删除」并带真实错误；`apply()` 加**残留自愈**（新结构文件在 + 旧文件也在 ⇒ 自动清）。实测：桌面成功路径 ✅ · 桌面失败路径（独占句柄锁住文件）✅ toast 原文「删除文件失败 …另一个程序正在使用此文件 (os error 32)」· 桌面 / 手机重启自愈 ✅。**但更麻烦的形态没解决**：手机上删掉 `vault.json` 后**不做任何操作**，它也会在 90 s 内自己回来（mtime 保留、内容与迁移前逐字节相同）；已排除备份插件、主窗口 invoke hook（零记录）、Syncthing、全盘副本 —— 暂按平台行为登记。`security` 0.2.0 → **0.2.1**（签名 keyId `aqua-2026` · 74.2 KB · 索引 15 条已重建）· vitest 1146 → **1147** |
| rev173.184 | 2026-10-26 · **手机端走查（私密文件夹迁移链）**：手机 `33b676f6`（Android 16）把 `security` 换成 **0.2.0**（index.js 70475 B · md5 `52f8f4c3…`；manifest 无 sha 不用动），测试库 `/storage/emulated/0/Documents/ZeroNote` 的旧 `vault.json`（897 B · `v:1` · 只 secrets 环 · 已绑指纹 `d9c0b875…`）走一遍「解锁 → 换主密码 → 再换回」：**`vault.secrets.json`（825 B · `v:2` · 单环 · 新 salt）生成 ✅ · `biometrics[d9c0b875…]` 保留 ✅ · reload 后新旧密码都能解 ✅ · 点「用指纹解锁」能唤起系统指纹界面 ✅**；**但旧 `vault.json` 在 Android 上没被删掉** ❌ —— `saveVault` 最后一步 `purgePrivate(…).catch(() => {})` **静默失败**（同一路径手动 `invoke('purge_private')` 却能删 ⇒ 不是权限），之后它在 23:07–23:23 反复「复活」（每次 mtime=当前、内容与迁移前逐字节相同 · 源疑似 `.zn/backups/*/_secret/vault.json`，删掉后 70 秒不复现；主窗口 invoke hook 没抓到调用）· 另见启动后 60 秒内打出**两份**自动备份（`23-20-38` 缺 `dirNames`/带 `protected: false`，像旧版 meta）待查 |
| rev173.183 | 2026-10-26 · **期 3 实测：vault 按环拆的迁移链**（交接卡点名「唯一没有真机证据的改动」）：全局插件目录里的 `security` 是 **0.1.2 的拷贝**（改 `examples/` 它不生效）⇒ 备份后删目录、**junction 指向 `examples/security` 0.2.0**（那份 manifest 无 `sha256` ⇒ 不校验入口哈希），reload 后 13 条 `security.*` 命令齐全 · 测试库 `_tmp-vault-tb` 旧**单文件** `vault.json`（1539 B · `v:1` · 两环 · secrets 已绑本机 Hello）当迁移源，**换一次主密码**（`TestPass123` → `TestPass1234`）触发 `saveVault` ⇒ 磁盘出现 `vault.notes.json`（560 B）+ `vault.secrets.json`（880 B）、**旧 `vault.json` 消失**；新格式 `v:2` + 单环 `ring`，**notes 的 KDF salt 与旧文件逐字相同**（迁移只搬不重算）、secrets 出新 salt（换密码本就重包裹 DEK）、`biometrics[16c9a8a9-…]` / `idleLockMs` / recovery 段全部保留 · reload 后「账号密码」用**新密码** ✅、「私密笔记」用 `NotesTest123` ✅（2 把已解锁）· **顺带验「按环写」**：把 secrets 换回 `TestPass123` ⇒ `vault.secrets.json` mtime 更新、**`vault.notes.json` 不动**（22:59:05）⇒ 两设备各改一个环不再判冲突；再 reload 仍能解锁 · 测试库回到已知状态（`secrets=TestPass123` / `notes=NotesTest123`）；迁移前备份 `_tmp-vault-tb/.zn/security-backup-20261026-225121/`、旧插件 `_tmp-plugin-backup/security-0.1.2-20261026-225114/` |
| rev173.182 | 2026-10-26 · **私密文件夹 期 3：vault 按环拆 + 四后端同步 + 备份**（需求 §10.1）：① **`vault.json` 按环拆** —— 以前两环的 KDF 参数与包裹 DEK 在同一个文件里，而它**整文件同步**：两台设备各改一个环的密码（只重包裹 DEK）⇒ 两边都改同一个文件 ⇒ 判冲突 ⇒ 取远端 ⇒ **另一边的重包裹丢了，那台设备再也解不开**。现在每环一个 `vault.<环>.json`（各自一个同步单元）。旧单文件读到就迁移（拼回两环 → 写两个新文件 → 删旧文件）。⚠️ 旧客户端（`security` ≤ 0.1.2）只认 `vault.json`，迁移后以为"没建环" ⇒ 共用 vault 的设备都要升到 **0.2.0**。② **四后端都搬私密树**：`.zn/private/` 的 `index.zn` + `notes/*.zn` + `trash/*.zn` 逐文件走方向判定（webdav/s3/git 各加 `syncPrivateTree`；sync-folder `SECRET_DIRS` 加 `.zn/private`），判定抽成纯函数 **`decideTreeAction`**（11 种组合全覆盖），**删除两边都传播**（否则删一篇同步一轮就复活）；Git 额外要 sha（Contents API）⇒ `privateTree` 条目带 `sha`。③ **备份含私密树**：`_private/` 整棵密文随包，恢复原样写回。⚠️ 口径：memory fs 对不存在路径返回空串，当"本地有"会**白推空文件**（`空笔记也能同步` 抓到）⇒ 统一 `raw && raw.trim()`。vitest 1140 → **1146** |
| rev173.181 | 2026-10-26 · **私密文件夹 期 2：独立搜索 / 回收站 / 移入移出**（需求 §3.3 后四条）：① **搜索** —— 面板内搜索框，标题与正文一起搜、多关键词 **AND**（与 `index.query` 同语义）；数据源是**解锁期内存里解密后的正文**（懒加载：第一次搜索才逐篇解密，锁定即清空；不落盘任何明文索引），命中处前后各取一段、**标题命中优先** ② **回收站** —— `.zn/private/trash/` 与全局回收站完全分开（「进入也需验证」= 继承主面板解锁态）；删除 = `fs.move` 搬密文（**不解密也能删**）· 恢复 = 搬回 + 索引挪回（原始 createdAt/updatedAt 一起存，**恢复后排序不跳**）· 彻底删除**两步确认**（第一次上膛按钮变「真的删？」）+ 清空 ③ **移入** = 把当前公开笔记加密搬进来，密文写成功后才动原文件，且**原文件立刻真删**（`fs.delete` 进全局回收站后按 `originalPath` 找到再 `purgeTrash`）—— 否则明文留在 `.zn/trash/` 等于没加密；**移出** = 解密写 `<标题>.md`（清洗 Windows 非法字符 / **不能以 `.` 开头**（会被当隐藏文件跳过）/ 重名加 `-2`），明文落盘后立刻删密文。⚠️ **单测抓到真 bug**：`upsertNote` / `removeNote` 返回不带 `trash`，而 `upsertNote` 在 `onDocSaved` 里每保存一次就跑 ⇒ **保存任意一篇就把回收站从索引里抹掉**（磁盘上的 trash 密文变孤儿）。**实测**（`_tmp-vault-tb` · 真 Argon2）：两篇 → 搜「开会」命中正文片段 · 搜「今天 面包」0 篇（跨篇 AND）· 搜「清单」标题命中 · 删除 ⇒ notes→trash + 面板只列回收站 · 恢复 ⇒ 两文件回 notes · 两次 `purge` ⇒ 第一次按钮变「真的删？」且文件还在、第二次消失 · 移入 ⇒ 库根文件消失 / 私密 +1 / **全局回收站无残留** · 移出 ⇒ 库根出现「要移入的笔记.md」且是明文。vitest 1120 → **1140** |
| rev173.180 | 2026-10-26 · **私密文件夹（期 1）+ 内核 `doc.registerCodec`**（需求 §3.3 / §10.1）：编辑器此前只有「readText → 明文 → writeText」一条链路，**密文落盘的内容用不了编辑器**（只能自绘降级编辑器，或把明文临时写到磁盘上）。新增**内容转换器**原语：读盘后 `decode`、写盘前 `encode`，**内核不认识加密**，只认识「这个路径的内容要过一次转换」；合并 / 脏标记 / 自动保存 / `doc.on` 全部仍在**明文层**。安全语义三条（别退化）：① 打开时用过某个 codec ⇒ 保存必须还用它，它被卸载 ⇒ **读写都抛错**（绝不退回"原样写盘"，否则正在编辑的私密笔记会明文落盘）② `transient` ⇒ 不写会话恢复草稿（草稿是 localStorage 明文）③ `match` 抛错按"不匹配"处理。插件 `examples/private-notes/`：整棵树在 `.zn/private/`（内核的 `list_notes` / `list_dirs` 天然跳过 `.` 开头 ⇒ **不进文件树 / 全局搜索 / 回收站**），**每篇一密文 + 加密索引**（文件名是随机 id，磁盘上不泄漏标题），用 `security` 的 `notes` 环（3 分钟空闲锁）。**实测**（`_tmp-vault-tb` · 真 Argon2）：建 notes 环 → 解锁 → 新建 → 写入 → 保存 ⇒ 磁盘 `zn1.<nonce>.<ct>`（含中文 / `#` 均为 False）· 关文档回列表显示标题（索引解密 + `doc.on('save')` 回填）· 重开正文正确 · **锁定后** `core.openNote` 直接打开被拒（显示「已锁定 —— 先在面板里解锁」，编辑器不打开、密文不喂进去）。vitest 1099 → **1120**（doc-codec 9 + private-notes 12）。**未做**：期 2（独立搜索 / 回收站 / 移入移出）· 期 3（`vault.json` 按环拆 + 四后端同步 `.zn/private/`） |
| rev173.179 | 2026-10-26 · **预装范围成文 + 移出 5 个「增强」插件（`D-010`）**：这条规则此前**只在会话里**（安全插件开发期 rev173.160–161 用户原话），没落文档 ⇒ 加备份插件时我又把「要不要预装」重新问了一遍。本次成文：**核心体验预装 · 「增强」逐步移市场 · 安全 / 密码库只走市场**（涉及隐私、要用户知情选择、预装加密插件会暗示「默认不加密」）。逐插件归类：预装 = 标签 / 反链 / 历史 / 导入导出 / 同步 ×4 / **备份**（不碰隐私、不暗示风险，是「数据会丢」的地基）；移市场 = 大纲导图 / 文档阅读器 / 记账 / 米色主题 / **打卡**（业务功能，规则没列但同属「增强」）。`builtin-plugins.ts` 移出 5 条 + 5 组 `?raw` 导入，**预装 14 → 9**；五个市场包都在（都验过签名），已装环境不受影响（`ensureBuiltinPlugins` 只是不再写内置版）。新增 `docs/decisions/D-010-预装范围.md`（含「以后加新插件怎么判」四步）+ decisions 索引行。README / CARD / 功能目录同步 |
| rev173.178 | 2026-10-26 · **备份登记为预装第 14 个**（用户「预装」）：`src/kernel/builtin-plugins.ts` 加 `backup`（`?raw` 打进前端包，启动写全局插件根）。按既有策略「**预装与市场不互相替代** —— 预装 = 离线 / 首启可用 + 版本确定；市场 = 扩展 / 更新」（rev173.161 定），备份属**数据安全地基**（新用户还没装任何东西时就得有能救命的快照）⇒ 预装而不是走市场。预装数 **13 → 14**（README / CARD / 功能目录 / FACTS 同步）。⚠️ 已手装过开发版的环境不受影响：`ensureBuiltinPlugins` 见同内容直接跳过 |
| rev173.177 | 2026-10-26 · **备份 v3：恢复（需求 §14.2）**：`backup.restore` —— **两步确认**（第一次点只上膛，按钮变红；第二次同一份才执行）。顺序是「先保命再动刀」：① 当前库存成 `pre-restore-<时间>` 快照（**不占 30 份额度**，`pickStale` 见到前缀就跳过）② 当前内容**移进回收站**（`fs.delete`，可撤销，不物理删）③ 从备份拷回顶层文件 + 子目录 ④ 密码库密文写回原位。`_meta.json` 新增 **`dirNames`**（恢复要靠它找回子目录 —— `listDirs()` 列不出 `.zn/backups/*`）；旧备份没有它 ⇒ **拒绝恢复并说明**（不静默丢目录）。**实测抓到真 bug**：`fs.listFiles(dir)` 返回的是**库内相对路径**（`dir/文件名`）不是裸文件名，第一版拼成 `.../zn/backups/.../zn/backups/...` ⇒ 恢复后库是空的 + 报「源不存在」；改成取 basename 后重跑 ⇒ **38 个文件全回来**（库根 17 + 子目录 20 + 标记文件），密码库密文原样、目录逐项与备份一致。vitest 1094 → **1099**（+5） |
| rev173.176 | 2026-10-26 · **备份 v2：自动备份档位（需求 §14.1）**：九个档位（1h / 3h / 6h / 12h / **每天（默认）** / 2 天 / 3 天 / 每周 / 每月＝30 天），存 `store` 的 `backup:config = { interval, lastAt }`。**为什么是「60 秒轮询 + 启动补做」而不是按档位设长定时器**：页面关掉定时器就没了（没有后台服务、契约也没有定时原语）⇒ 关机一夜后重开必须立刻补一份，而不是再等一整天。判据全抽成纯函数 `isDue` / `dueAt` / `dueText` / `selectOptions`；**空库跳过**（新装应用不该每次启动塞一份空备份）；手动备份也刷新 `lastAt`（否则点完「立即备份」60 秒后自动又来一份）。面板加 `select` 档位 + 「上次 / 下次」一行。**实测**（`_tmp-vault-tb`）：装 v2 → reload ⇒ 自动补一份 `20:20:51 · trigger:auto · 389 ms`；**再 reload 一次仍是 3 份**（证明 `lastAt` 持久化生效、不会每次启动都备）；改档位 `1h` ⇒ 面板「自动备份：每小时 · 上次 10-26 20:20 · 下次 10-26 21:20」。vitest 1086 → **1094**（+8） |
| rev173.175 | 2026-10-26 · **备份插件 v1（需求 §14.1 遗留项）**：新增 `examples/backup/`（约 380 行）+ 内核命令 `purge_backup`（34 → **35**，cargo 52 → **53**）。备份 = 整库快照到 `<库>/.zn/backups/<YYYY-MM-DDTHH-mm-ss>/`（跟库走、拷库就带着）：**公开笔记与附件明文**、**密码库以原密文随包**（`_secret/secrets.zn` + `_secret/vault.json` —— 「加密复用主密码」在实现上就是原样拷密文，锁着也能备）、`_meta.json` 记规模。清单 `index.json` 是列表的唯一来源（`fs.listDirs()` 跳过 `.` 开头目录 ⇒ 列不出备份目录，必须靠清单）；保留最近 **30** 份（`pickStale` 纯函数）；面板「立即备份 / 刷新 / 单份删除」。**实测**（`_tmp-vault-tb`）：37 篇 + 6 个文件夹 ⇒ 备份 40 文件 = 源 37 + `_meta.json` + 两个密文，**逐一核对一致**；删除命令后目录消失、清单清空；面板 247 ms / 225 ms。vitest 1067 → **1086**（19 条）。⚠️ 插件入口必须叫 `apply(api)`（我第一版写成 `activate` ⇒ 宿主报「入口没有可用的 apply()」，插件页可见但命令全无）。**待做**：定时档位 / 恢复 / 是否内置 |
| rev173.174 | 2026-10-26 · **发版 0.6.0**（用户「发版」）：0.5.0 之后 **57 个提交**（rev173.137–173）一次收成版本号。两条主线 —— **安全 / 密码库**（新插件 `security` 双密钥环 + `secrets` 整库加密 + Android 指纹 / Windows Hello + 锁定后自动弹 + 生物识别按设备）与**插件市场闭环**（签名 v2 / 打包签名索引 / 应用内「发现」/ 公钥内置 / 开源 MIT / 包走 raw 分发 / 第二批 UX）。**CHANGELOG 补全**是这次的主要工作量：原 `[Unreleased]` 只记了「自动弹」与「按设备」，**两个插件本体没进 CHANGELOG** ⇒ 补上 `security` / `secrets` / Android 指纹 / Windows Hello / KDF 定档五条主线（约 130 行），`[Unreleased]` → `[0.6.0]`，应用版本表加行；README 现状行同步 rev173.174 · 0.6.0 并补安全段门面描述（之前完全没提密码库）。`package.json` / `tauri.conf.json` / `Cargo.toml` + `Cargo.lock` → **0.6.0**。**踩坑**：用 `Set-Content` 拼接 CHANGELOG 会整文件写成 CRLF（仓库是 LF）⇒ 用 `[System.IO.File]::ReadAllText` + 正则换 `\n` 再写，否则 diff 里全是行尾噪音。verify 六步全绿 · tag `v0.6.0` 已推 |
| rev173.173 | 2026-10-26 · **生物识别按设备（`biometrics` 字典）**：`vault.json` 从单段 `rings.<id>.biometric` 改成 `rings.<id>.biometrics[<deviceId>]` —— **换机只失效那一台**，别的设备绑定不受影响；本机 id 存**凭据管理器**（`host.secrets` → `secret_*` → Windows 凭据管理器 / Android Keystore，**不随库同步**），拿不到时退回 `'local'`（等同旧行为）。旧单段由 `migrateBiometrics` 在 `apply()` 一次性迁到 `biometrics[<本机>]` 并落盘（默认「旧段就是这台机器」⇒ 原机升级后照常用指纹；真换机过来的 vault 会 AEAD 失败并提示重绑，同旧引导，但**不再覆盖**原机器的绑定）。UI：badge「本机已绑定」/「别的 N 台已绑定」+ 未绑定时一句 caption；按钮改「绑定本机指纹 / 解除本机指纹」，解除只删当前设备。**实测**（`_tmp-vault-tb` · 0.1.2 市场包）：迁移后 `vault.json` 出现 `biometrics["16c9a8a9-…"]`、旧 `biometric` 消失；把 `secret_set zeronote.device.id` 改成假 id 再 reload ⇒ 面板「别的 1 台已绑定」+ **没有**指纹按钮（旧版会显示、点了才报 AEAD）；切回原 id ⇒ 「本机已绑定」+ 按钮回来，点它 Hello 正常弹出。按指纹也已实测（用户真人操作，见 171 的受保护 UI 说明）：面板「「账号密码」已用指纹解锁」、1 把已解锁 ⇒ **迁移过来的旧包裹在新结构下解出同一把 DEK**；**手机端同样通过**（`33b676f6` 装 0.1.2 → 迁移 → 「本机已绑定」→ 按指纹「已用指纹解锁」）。vitest 1064 → **1067** · 打包 **0.1.2** 发市场 |
| rev173.172 | 2026-10-26 · **安全插件 0.1.1 发市场（含锁定后自动弹）**：`examples/security/manifest.json` 0.1.0 → **0.1.1**（同版本内容不同的话，已装用户收不到更新提示）→ `pack-plugin.mjs security --key <私钥> **--key-id aqua-2026**` → `gen-market.mjs --write`（官方 15 条 · security@0.1.1 · 64.3 KB · 整包 sha256 `30829bc3…`）。⚠️ **坑**：不给 `--key-id` 会签成 `default`，而内置信任根只有 `aqua-2026` ⇒ 发出去装完加载时**验签失败被拒载**（第一次就打错了，已重打）。**实测安装**：本地 `http.server 8931` + CDP `install_znp_from_url`（expectedSha256 对上）⇒ 返回 `security`，落盘 index.js 62029 / manifest version 0.1.1+入口 sha256 / signature.json keyId `aqua-2026` → reload ⇒ 插件正常加载、面板可开（验签通过）· 旧包 0.1.0 按惯例保留 |
| rev173.171 | 2026-10-26 · **锁定后自动弹生物识别（需求 §13）**：`security` 的 `lockRing` 之后自动发起一次生物识别 —— 判据抽成 `planAutoUnlock` / `shouldWaitForFocus` 两个纯函数（+5 单测）。**桌面失焦 ⇒ 挂起**，`focus` 回来再弹；**手机只看可见性**（WebView `hasFocus()` 恒 false；切后台 CPU 冻结 ⇒ `visibilitychange` 补弹），`reason:'service'` / 已解锁 / 正在派生 / 用户已在输密码 都不弹；自动弹取消给中性提示（「用指纹解锁」+ 主密码框兜底）；锁定时清主密码输入框。**实测**（`_tmp-vault-tb`）：空闲 60 s 锁 → 失焦不弹（截图无对话框）→ 点回窗口 600 ms 后 **Windows Hello 对话框弹出**（面板显示「正在请求指纹…」）。⚠️ 新坑：**Hello 是受保护的系统 UI** —— 合成键鼠 / `Esc` / UIA `InvokePattern` / `FindWindow` 全触达不到（UIA 顶层窗口列表里没有它），取消/指纹只能真人操作 ⇒ **改请用户真人点「取消」验证**：面板显示「已取消 —— 输入主密码，或点「用指纹解锁」」，手动按钮仍在。⚠️ **手机端也已实测**（`33b676f6` · 换新 `index.js` 后）：空闲 60 s 自动锁 ⇒ **自动拉起指纹界面** ⇒ 按指纹后「已用指纹解锁」；手动锁定 1.5 s 内面板「正在请求指纹…」；指纹界面返回 ⇒ 中性提示「已取消 —— …」。vitest 1059 → **1064** · verify 六步全绿 |
| rev173.170 | 2026-10-26 · **交接**（用户「交接」）：本会话 rev173.168–169 总览 + 交接时实测状态（工作树干净 · HEAD `16904bb` · verify 六步全绿 vitest **1059** · 桌面 dev pid **28892** · 手机 0.5.0 pid **10392**）+ 下个会话入口（**锁定后自动弹生物识别** / `biometric` 段按设备 / 手机 reload 偶发退出）+ 本会话四类坑（看门狗 env 传不进 Android / `manifest.sha256` 不同步即拒载 / windows crate 0.62 缺带窗口接口 / 硬编码旧 API）|
| rev173.169 | 2026-10-26 · **期 2c：Windows Hello 解锁落地**：`hello_available` / `hello_enroll` / `hello_sign` 三个命令 —— windows crate 0.62 **没有**带窗口的接口，故手写 `IKeyCredentialManagerCreateWithWindowStatics`（30b1b9c9-…）+ `IKeyCredentialWithWindow`（050deb3b-…）的 vtable（IID 从系统 `Windows.Security.winmd` 解析）；`security` 的 `windowsHelloAdapter` = `hello_sign(challenge)` → HKDF → KEK → XChaCha 包裹，格式 `hello1.<challenge>.<zn1…>`；桌面实测「探测 → 绑定 → 锁定 → Hello 解锁」，**签名确定性由解锁本身证明**；顺手记两个坑（无窗口签名挂死 / `IAsyncOperation` 在 windows-future 且 0.3 没有 `.get()`）|
| rev173.168 | 2026-10-26 · **期 2b：Android 指纹解锁落地**：`tauri-plugin-biometric 2.5.0`（仅 android target）+ `#[cfg(target_os="android")]` 注册 + capability `android-biometric.json`；`security` 插件加 `biometric` 段（`vault.json` 的 `rings.<id>.biometric`）与面板三入口（绑定 / 指纹解锁 / 解除），主密码那份 `wrapped` 不动、换密码与恢复重设都保留该段；真机走通「主密码解锁 → 绑定 → 空闲自动锁 → 指纹解锁（1 把已解锁）」；顺手修 **debug 包被看门狗 5 秒误杀**（`exit(101)`：Android 进程 env 传不进 `ZN_WATCHDOG=off`，改 debug 默认不启动）。vitest 1046 → **1056**（+10 含反向验证）· verify 六步全过 |
| rev173.167 | 2026-10-26 · **Windows Hello 可行性验证（期 2c 前置）**：用户指出「windows 不是有 hello 吗」，纠了方案 §8 的旧说法。真机实测（PowerShell 5.1 直调 WinRT，同一台机）：`IsSupportedAsync()` = **True**（PIN 已设）· `RequestCreateAsync` = **Success**（**非打包进程 + 无 HWND 也能建凭据**）· `RequestSignAsync` = **90 秒无返回（挂死）⇒ 签名必须有窗口**。⇒ 门槛收敛成一条：Rust 侧要用 `IKeyCredentialManagerInterop` 传 HWND。**两个概念更正**：① 「不支持」只是 Tauri 插件层面，平台有完整 API ② **PIN 与生物识别是同一套 API**（弹什么由 Windows 决定）⇒「先做 PIN」不是降级，用户以后加指纹代码零改动 ③ `UserConsentVerifier` **不给密钥材料**，只能当二次确认，方案里那条路不够，得用 `KeyCredentialManager`（签名 PKCS#1 v1.5 确定性 ⇒ HKDF 出 KEK 包裹 DEK）。方案 §8 已加 ⚠️ 更正块 + 新增 §8.5 具体设计（第三条包裹路径 / 三个 Rust 命令 / 失败语义 / 安全边界 + Bitwarden CVE-2023-27706 的教训）；§9 期 2b/2c 拆开。**测试凭据已删净**（`OpenAsync` 复核 NotFound），临时探针目录已删 |
| rev173.166 | 2026-10-26 · **期 1b 手机走查（安全 / 密码库）**：手机 `33b676f6` 原来**没装** `security` / `secrets`（插件列表里没有）⇒ 手动装开发版（`adb push /data/local/tmp` + `run-as cp`）→ reload → 两个插件都加载。**10 项全过**：建环（Argon2 812 ms + 恢复码）· 解锁 · 新建平台 / 账号 · 16 位生成器 · 密码框真 `type=password` · 显示明文（`mpTeZ7FKv6VXdLg9`）· **复制到 Android 原生剪贴板（读到 16 字符）** · **60 秒后自动清空（`CLIP_LEN=0`）** · **空闲 60 秒自动锁定（「空闲 60 秒，已自动锁定」）** · reload 后解出「手机测试站 · 1 个账号」· 回收站（剩 7 天 / 恢复 / 彻底删除）。**踩坑**：① 手机插件根是 **`/data/user/0/<pkg>/.zn/plugins/`**，`files/.zn/` 不存在（`run-as ls files/` 只有 `profileInstalled`）② reload 后 app **偶发退出一次**（重启即恢复，原因未定位；怀疑频繁 reload + dev 双端 HMR）③ PowerShell 里 `$pid` 是只读变量，别拿来存 app pid。测试数据已从手机主库清空（`secrets` 环保留，主密码 `PhoneTest123`） |
| rev173.165 | 2026-10-26 · **期 2a：手机实测三档 KDF，定死默认档**：真机 `33b676f6`（Redmi peridot · 0.5.0 dev 包 · Android WebView V8）在页面里直接 `import('/vendor/noble/hashes/argon2.js')` 跑三档、各 3 次取中位数 —— **t=2/19MiB 165 ms** · **t=3/64MiB 812 ms** · **t=1/128MiB 574 ms**。**手机比桌面 Node 还快约 0.8×**（桌面分别 212 / 993 / 682 ms），**推翻了方案 §3「手机 1–4× 慢、t=3 要 2–4 s」的估算**（已在原文处标 ⚠️ 更正）。配套：vendor 六模块首载 **114 ms**、XChaCha 1 MiB 加密 **29 ms** / 解密 7 ms ⇒ 手机首次解锁 ≈ **0.93 s**、之后 ≈ **0.81 s**。方案留的降档条件是「手机 > 5 s」，实测不成立 ⇒ **默认档保持 t=3 / m=64 MiB 不降**。代码零改动，但新增一条**锁测试**（`DEFAULT_RINGS` 两个环的 kdf 必须是 `t=3, m=65536, p=1`，且两个环的 kdf 不能是同一个对象）+ 反向验证（把 m 改成 19456 ⇒ 立刻红）；方案 §3 / §9 期 2a 已标完成；顺带记下手机插件根目录是 `/data/user/0/com.aqua.zeronote.debug/.zn/plugins/`（不是 `files/.zn/`） |
| rev173.164 | 2026-10-26 · **期 1c：四个同步插件放行密码库**：`.zn/secrets/` 以前整段被排除 ⇒ 密码库**同步不出去**（"云端零明文"做到了，"换设备能解开"没做到）。三个网络后端（webdav / s3 / git）各加一个 `syncPrivate` 阶段 —— 按**固定清单**搬两个文件：`secrets.zn`（数据密文）+ `vault.json`（KDF salt 与被主密码包裹的 DEK，**少了它另一台拿到密文也解不开**），方向靠 baseline 判断、双端都变就留副本（密文没法自动合并）、任一步失败只写 hint 不抛（不拖累笔记同步）；manifest 加 `private` 段（304 短路径照走）。`sync-folder` 性质不同（自己不搬文件），改成：新增 `SECRET_DIRS` 放行规则 + **把「密码库冲突副本」与「`.zn/` 没排除」分开报**（前者是用户按提示放行后才可能的现象，含义是两端都改过密码库）。新单测 **15 条**（四套各自的私有文件用例 + 反向验证：去掉"只有远端变"这条分支 ⇒ A 永远停在旧版，测试立刻红）· vitest 1030 → **1045** · CDP 实测：面板报警「⚠ 密码库有 1 份同步冲突副本（…）」+ toast 双语区分 |
| rev173.163 | 2026-10-26 · **密码库插件（期 1b）**：新增 `examples/secrets/`（1300 行）—— 消费 `security` 的 `crypto` 服务（**软依赖**：拿不到就降级提示"先去市场装安全插件"，不崩不阻塞）· **整库单文件密文** `.zn/secrets/secrets.zn`（`zn1.<nonce>.<ct>`，AAD `secrets\|secrets`）· 平台 / 账号两级（**空平台也显示**）· 搜索只搜平台 / 账号 / 备注（**反向验证过**：给 `matchesAccount` 加上密码匹配 ⇒ 那条用例立刻红）· 密码生成器 16 位（大小写 + 数字，**排除 0/O/1/l/I**，保证三类各一，Fisher–Yates 洗牌）· 显示密码 15 秒自动收起 · 复制密码 **60 秒清剪贴板**（只在内容仍是它时才清；桌面 CDP 实测 `CLIP_LEN 16 → 0`）· 回收站 7 天软删（剩 N 天 + 恢复 / 彻底删除）· **空闲 60 秒自动锁**（时间戳判定，不依赖定时器，Android 后台冻结也补得住）· 内核小扩展：`input.secret` 渲染成 `type="password"`（UIRenderer 一行 + 契约 §2 类型 + 契约文档，**UINode 仍是 21 种**）· vitest 1002 → **1029**（27 条新单测）· **CDP 实测 12 项全过** · **实测抓到两个真 bug**：① `accountRow` 返回了 `{key,node}` 列表项包装却塞进 `stack.children` ⇒ 整段 JSON 被当文本摊在界面上 ② `visibleTree` 过滤掉无账号的平台 ⇒ "新建平台 → 保存 → 列表里什么都没有" · 另一处：AEAD 的 `invalid tag` 被原样抛给用户 ⇒ 译成「主密码不对」 |
| rev173.162 | 2026-10-25 · **交接**（用户「交接」）：本会话 rev173.160–161 总览（安全插件：调研 → 方案 → 实现 → 实测 → 发市场 14 条 → 推送，全部 CI 绿）+ 交接时实测状态（工作树干净 · 六步全绿 vitest **1002** · HEAD `981b114` · dev pid 11660 · 测试库 `_tmp-vault-tb` 里有临时两环）+ 下个会话入口（**期 1b `secrets` 密码库插件** / 期 1c 同步放行 `.zn/secrets/`）+ 四条已定结论（**预装与市场不互替**但安全类走市场 · **JS 里无法"完全封起来"** · 双环靠 AAD 硬隔离 · 两把密码无任何派生）+ 三个环境坑（僵尸 http.server / IWR 走代理 / curl 拉 raw 失败但 WebView 通） |
| rev173.161 | 2026-10-25 · **安全插件发到市场（不预装）**（用户拍板：「有插件市场后应该不用做预装插件了吧」→ 同意 security 走市场）：`pack-plugin security --key … --key-id aqua-2026` → 整包 sha256 `42ff0e…`（47.4 KB，2 文件）→ `gen-market --write` 索引 **13 → 14 条** · **端到端实测**（本地 8932 静态服务 + 真包）：① 负向 —— 把期望 sha256 改成全 0 ⇒ **「插件包校验失败…」拒绝安装、不落盘** ② 正向 —— `install_znp_from_url` 装真包 ⇒ 磁盘出现 `signature.json`、reload 后插件页显示「安全 v0.1.0 **已签名**」③ 索引恢复 GitHub raw、测试服务全停 · 未登记 `BUILTIN_PLUGINS`（用户决定：安全类插件应由用户主动从市场装） · ✅ **已推送 `f99d9b9`**（直连成功，`git ls-remote` 核对一致）· CI run `40209288687` **15 步全绿** · 应用里从 GitHub raw 实测拉到 **14 条**，security 显示「47.4 KB · 已安装」· 坑两条：① 8931 上还留着上次会话的 `python -m http.server`（cwd 不对 ⇒ 请求恒 404，害我以为是新服务坏了）⇒ 已清 ② `Invoke-WebRequest` 走系统代理，连 `127.0.0.1` 也会 404；判本地服务死活要用 `node http.get` |
| rev173.160 | 2026-10-25 · **安全插件 v0.1（期 1a）**（用户「做安全插件」→「先调查写方案」→「开工」）：新增 `examples/security/`（单文件 1172 行，纯函数全部命名导出）—— **双密钥环** `notes`/`secrets` 各一把主密码、各一个 salt、各一把 DEK，**互不派生**（用户拍板：账户密码要"绝对安全"）· XChaCha20-Poly1305 + Argon2id（noble **本地副本** `public/vendor/noble/` 13 文件 202 KB，`scripts/vendor-noble.mjs` 按 import 图精确复制）· **AAD 绑定** `环\|容器\|用途`（跨环 / 跨容器 / 跨用途的密文一律解不开，有反向测试）· **不存 password verifier**（解锁 = 解包裹，AEAD 认证通过即密码对）· 换密码与恢复**只重包裹 DEK**，数据密文一个字节不动 · vault 文件损坏 ⇒ 拒写不覆盖 · 对外 `service.provide('crypto')` **只给操作不给密钥** · 单测 **25 条全过**（错密码 / 改一字节 / 跨环 / 恢复答案错 / 只设恢复码 / 两条都不设要报错）· `tsc -b` 0 · ⚠️ **未做**：桌面 CDP 走查（面板还没在真机上点过）、`secrets` 插件、同步放行 `.zn/secrets/` · 踩坑两条：① **插件 ESM 相对 import 不可用**（契约 §3 只解析 CJS require）⇒ crypto 核心内联进 index.js ② `vendor-noble.mjs` 第一版在 Windows 下被 `path.join` 的反斜杠坑掉去重（同一模块复制两次、清单重复）⇒ `normalizeRel` 先统一 `/` |
| rev173.159 | 2026-10-25 · **交接**（用户「交接」）：本会话 rev173.154–158 总览表 + 交接时实测状态（工作树干净 · 六步全绿 vitest 977 / 质量门 7/7 · CI 最近三次 success 2m24s–2m39s · dev pid 11660 · 手机 0.5.0）+ 下个会话入口（读 CARD → 卡点表；**候选池已无「可立即做」项**）+ 本会话踩到并已修的三个真问题（localeCompare 不传 locale / 0.2.1 包漏 --key-id / 24h 检查 effect 依赖数组引用） |
| rev173.158 | 2026-10-25 · **插件审查材料生成器**（用户「做」= ROADMAP §3.3 最后一块）：`scripts/review-plugin.mjs` 只回答四件事 —— 格式对不对 / 地址通不通 / **包有没有被换过** / 谁签的（调研 §4.5「只审格式不审代码」）· 输出 markdown 材料：entry 可达 · 整包 sha256 一致 · 包内 manifest 与 entry 同 id 同版本 · **apiVersion 只比 major**（照抄 `plugin-host.ts:309`）· 签名 keyId（报不验）· 能力自述翻人话 · **两层**：离线半进 `check-gates.mjs` 第 **7** 门（脏 PR 直接红），联网半（`--online`）只在人工审时跑、不进 CI · **实测**：造 `_tmp-external/` 夹具（keyId `alice-2025`）走通正常路径；反向（entry sha256 改成 0 / id 撞官方 + 重复 + `Bad_ID` + `ftp://`）全部报错且 exit 1；空表通过 · 顺带修三个自己写出的问题（--entry 模式误要索引行 / 全局问题重复计数且单条不跟着红 / `--external` 值被当位置参数） |
| rev173.157 | 2026-10-25 · **CI 加 Rust 编译缓存**（用户「加缓存」）：先核实到 **pnpm 那边本来就有** —— `actions/setup-node@v5` 的 `package-manager-cache` 默认 true、按 `packageManager` 自动缓存（读官方 README 确认），所以只补 Rust · `Swatinem/rust-cache@v2`（`workspaces: "src-tauri -> target"`，语法照官方 README）缓存 `~/.cargo` + target，键跟 Cargo.lock / rustc 版本走 · 加 `workflow_dispatch` 便于跑第二次 · **实测**：Cargo 步骤 **2m32s → 41s（−73%）**、整 run **3m35s → 2m33s**；首次（未命中、顺带写缓存）反而是 5m17s / Cargo 3m15s，属正常 |
| rev173.156 | 2026-10-25 · **插件市场第二批 UX**（调研 §4.4 三件，零 Rust 改动）：① **详情页** —— 「发现」每条加「详情」，摊开描述 / 分类平台 / 大小 / 接口版本 / **能力自述 chips** / 已装版本 / 下载地址 / sha256 / 包内文件数；能力来自**索引新增字段 `capabilities`**（`pack-plugin.mjs` 从 manifest 带出，13 个包重打包 + `gen-market --write`），中文翻译 `src/lib/capability-label.ts`（未知取值**原样露出**，`fs`/`host`/`event` 老写法也译）② **更新角标** —— tab「已安装 14 ↑1」（只数真装着的）+ 行内「↑ 可更新 vX」，装完立刻摘缓存 ③ **启动 24h 节流检查** —— `shouldCheckUpdates`/`computeUpdates` 纯函数 + localStorage（`at`+`updates`），延迟 4s、失败静默且不写 `at`、设置页开关（默认开）；只标不装 · ⚠️ 实测抓到 effect 依赖 `rows` 数组引用 ⇒ 4s 定时器被每次重渲染重置、**检查永不发生**（改成依赖 `rows.length` + `rowsRef`）· **顺带修 rev173.154 的两个 0.2.1 包**：漏 `--key-id` ⇒ keyId 写成 `default` ⇒ 客户端内置信任根不认（装得上、加载拒载）；已重签，`gen-market` 加第 ⑤ 门「官方包 keyId 必须 = aqua-2026」（反向验证过）· vitest 951 → **977** · CDP 实测三项全过 |
| rev173.155 | 2026-10-25 · **CI 首绿实证**（rev173.154 的后续，无测试数字变化）：推送后第一次真跑 **15 步全 success**，4 分 45 秒（12:14:20 → 12:19:05 UTC）· 关键在 step 8「Unit tests (vitest)」—— 此前每个 run 都挂这里，`sortTags` 传 `'zh'` 后 951 全过；step 10「Quality gates」也是**第一次跑到**（排 vitest 之后，以前从没走到）· 证据链三条：`gh run list` 修复前 8 连 failure → 本次 success；新包公网实测 raw 下载 `http=200 · 24513 B` 且 sha256 与 `market/entries/tag-panel.json` 逐字一致；全局插件目录里 `tag-panel` / `backlinks` 均已是 0.2.1 · workflow 头注释改为与六步对齐（原写「五步」且漏质量门）· ⚠️ 一条 CI 自身小债：`pnpm/action-setup@v4` 声明 Node 20 被强制跑在 Node 24，每次 run 一条 deprecation annotation，等上游发版再升 |
| rev173.154 | 2026-10-25 · **开源配套：CI 从「一直是红的」修到能跑 + 投稿入口补齐**：CI workflow 早在 rev173.130 就有，但 `gh run list` 显示最近每个 run 都 failure —— 根因是 `localeCompare` **不传 locale**（3 处：`src/kernel/index-api.ts` 的 `tags()`、`examples/tag-panel` 的 `sortTags`、`examples/backlinks` 的 `matchRefs`）：本机 zh-CN 排出「工作 · 会议 · 项目」，GitHub runner en-US 按 code point 排成「会议 · 工作 · 项目」⇒ `tests/tag-panel.test.ts` 必然红 · 修法是三处显式传 `'zh'`（与 `FileTree` / `QuickSwitcher` 早就用的写法一致），两个插件各升 **0.2.1** 并重新打包签名、`gen-market --write` 重建索引（13 条）· CI 里逐条 gate 改成 `node scripts/check-gates.mjs`（此前 CI **漏了** facts 与 market 两项门）· `facts.mjs --check` 修一个 CI 死结：测试基线只存在本机（baseline JSON / `_verify-*.log` 都不入库）⇒ 无基线时忽略该行比较，有基线时照旧整块比 · 新增 `CONTRIBUTING.md` + `.github/ISSUE_TEMPLATE/`（bug / 功能建议 / 插件投稿 + config）+ `pull_request_template.md`，`check-links` 把 CONTRIBUTING 纳入扫描 · 本地 verify 六步全绿 |
| rev173.153 | 2026-10-25 · **交接卡「环境现状」跟上现实**（本轮收尾，无代码改动）：① 桌面 dev 补「AI 自己起用 `Start-Process cmd /c dev.cmd`（独立进程，等价双击）」+ 记「当前 dev 开着」 ② **插件包与市场整段重写**（旧文写「包在 Release、用 `--tag` 打包」已过时：现在包入库 `market/packs/`、走 raw、`pack-plugin` 默认就写那儿、gen-market 校验包存在 + sha） ③ 手机装机版本记成 **0.5.0**（0.4.0 没有 `install_znp_from_url`）+ 补「改前端 reload 即生效 / 改 Rust 必须重装」 ④ 补一行「仓库已开源 + 地址」· CARD 83 行（目标 ≤120）· check-docs / 质量门 6/6 |
| rev173.152 | 2026-10-25 · **插件页统一：设置里也能进市场**（用户「统一设置和菜单的插件页」）：两处本来就复用同一个 `PluginPanel`，设置页只是**漏传** `onMarketInstall` ⇒ 补一条透传（Settings props + `<PluginPanel onMarketInstall>` + App 传 `installZnpFromUrl`），tab / 列表 / 确认框 / 坏条目提示全是一份代码 · **顺带修布局**：设置 Dialog 里的插件区无高度约束 ⇒ 市场 13 条把窗口撑到 1080 px、列表 1037 px 且不内滚（截图实证）→ 插件区 `h-[min(62vh,520px)]` + `min-h-0 flex-1`，Dialog 回到 640×~570、列表内滚 · vitest 949 → **951**（2 条锁「不传通道不显示 tab / 传了显示『已安装 N · 发现』」）· 实测：设置 → 插件 → 发现 **13 条**、`listScrollable=true`；菜单 → 插件管理 **13 条**，两处一致 |
| rev173.151 | 2026-10-25 · **插件市场手机端真机走查**（测试机 `33b676f6`）：先重编 APK（`install_znp_from_url` 是 Rust 改动，18:01 的 0.4.0 包不含）→ **0.5.0 装机** · 手机打开「发现」= **13 条**（默认公网 raw 索引，走手机网络，不是 adb reverse）· ⚠️ **第一次拉取网络抖动失败**（`连不上服务器`，刷新一次即 13 条）—— raw 偶发不稳，桌面版也遇到过挂 6 分钟 · **安装**：内置插件 reload 就被 `ensureBuiltinPlugins` 补回、删不掉 ⇒ 改为在页面里直调 `install_znp_from_url`（同一份代码路径）：`{ok:true, id:'tag-panel'}`，磁盘出现 `index.js / manifest.json / signature.json`（keyId `aqua-2026`）· **reload 后列表显示「标签 v0.2.0 已签名」、无错误** ⇒ 手机端下载 / 整包 sha / 解包 / **内置公钥验签** / 「有签名不被内置版覆盖」五条全通 · 边界：手机端只走 https 源（`http` 仅回环），桌面那套本机静态测试床在手机上不可用 |
| rev173.150 | 2026-10-25 · **插件包入库、走 raw 分发**（开源当天实测发现的关键问题）：`raw.githubusercontent.com` 直连 **693ms 可用**，但 `github.com:443`（Release 下载域名）**直连连不上** ⇒ 索引能拉、包下不来，市场「能看不能装」· 13 个包（**573 KB**）放进 `market/packs/` 并入库，索引 url 改走 raw ⇒ 索引与包同一域名 · `gen-market.mjs` 新增校验：**包必须在 `market/packs/` 且 sha256 与条目一致**（防「改了包忘重建索引」与「忘了入库」）· `pack-plugin.mjs` 默认输出改 `market/packs/` + raw url（不再依赖 Release）· `verify-trust.mjs` 默认验**入库那份**（12/12 签名包通过）· 实测：公网匿名拉索引 + 逐包下载核 sha256 + 用内置公钥验签 |
| rev173.149 | 2026-10-25 · **开源（MIT）**：`gh repo edit --visibility public` 前置审计 —— 全量扫 801 个跟踪文件 + **全部历史**：无私钥 / 无 token / 无 `ghp_` 模式；历史里只出现过两个测试探针（`_tmp-vault-*/probe.md`，内容是「标题行 / 正文内容」，无害）；`gradle.properties` 干净；author email = `self@local` · 新增 `LICENSE`（MIT —— Cargo.toml 早声明 `license = "MIT"` 但缺文件）· README 顶部加**开源声明 + 免责**：插件与内核**同权限运行**、内核不提供沙箱，「装谁的插件」就是全部安全边界；数据自行备份 · README 现状行 rev173.137 → rev173.148（补插件市场）· 公开后确认匿名可拉 `market/index.json`（693 ms） |
| rev173.148 | 2026-10-25 · **插件市场阶段 1：应用内「发现」tab（能装、能升、装不坏）**：插件管理页第二个 tab，列表来自静态 `market/index.json` · 装一条 = 下载 → **整包 sha256** → 解包，三步在 Rust `install_znp_from_url` 里**一次完成**（校验的字节 = 落盘的字节），任一失败**不落盘** · 索引地址可改（默认本仓库 raw；private 仓库明确报「匿名拉不到」而不是空市场），存 localStorage · 坏条目**跳过并列原因** · **不静默升级**（启动不查、后台不下）· 新增 `src/kernel/market.ts` + `src/components/MarketPane.tsx` · 内核命令 33 → **34** · `sha2` 新依赖（已在依赖树里）· Rust 49 → **52**（URL 白名单含 `http://127.0.0.1.evil.com` 混淆 / 正常安装 / sha 不符不落盘）· vitest 932 → **949** · **实测**：14 条渲染 → 装 demo 0.1.0（磁盘落地）→ 索引升 0.1.1 ⇒「↑ 更新 0.1.1」→ 更新成功 → **把索引 sha256 改成 0 ⇒ 报「校验失败…不安装」，磁盘仍是 0.1.1** · 手机端未实测 |
| rev173.147 | 2026-10-25 · **`ensureBuiltinPlugins` 不再覆盖市场版本（阶段 1 前置二）**：旧逻辑「内容不同就写」有两个坑 —— ① 从市场装的官方插件新版，重启后被应用内置快照盖回去；② 覆盖后目录里残留的 `signature.json` 与新内容对不上 ⇒ 插件从「旧版能跑」变成**拒载**（不是回退，是坏掉）· 新规则（**先比内容，一致时零额外 invoke**）：有 `signature.json` ⇒ 一个字节都不写 · 已装 `manifest.version` 比内置新 ⇒ 跳过 · 其余（首装 / 内置更新 / 同版本内容不同）照旧覆盖 · 返回加 `skipped[{pluginId, reason}]` · 新增 `compareVersions`（`1.10.0 > 1.9.0`，字符串比较会判反）· vitest 926 → **932**（4 条不覆盖 + 2 条版本比较）· 反向验证：`> 0` 改 `>= 0` ⇒ 「同版本内容不同」那条立即红，恢复即绿 |
| rev173.146 | 2026-10-25 · **公钥内置进应用（别人装得上、验得过）**：`verify_plugin_signature` 信任根 = 内置 `BUILTIN_TRUSTED_KEYS`（`aqua-2026`）**∪** 用户 `trusted-keys.json` —— 旧行为在新装机器 / 换电脑上那个文件不存在 ⇒ 12 个签名插件**全部拒载** · 合并规则：文件缺失回落内置（**正常态**）· 同 keyId 用户那条**覆盖**内置（轮换 / 撤销）· 其它追加（外部作者）· 坏 JSON / 缺字段**报错不静默跳过** · Rust 测试 43 → **49**（6 条：内置常量合法性 / 验签三判据 / 缺失回落 / 追加 / 覆盖 / 坏 JSON 三形状）· 新增 `scripts/verify-trust.mjs`：**从 lib.rs 解析**常量，私钥导出公钥逐字节对账 + 用内置公钥验 `dist/` 里 **12/12** 签名包 · Android 编译通过并已装手机 · 桌面 app 内实测留给下次 dev（不在 android-dev 窗口里再抢 target）· 坑：`cargo test` 与 android-dev 共用 `CARGO_TARGET_DIR` ⇒ `--no-default-features` 差异会触发依赖重编 |
| rev173.145 | 2026-10-25 · **13 个插件包已上传 GitHub Release（索引链路打通）**：`plugins-v0.5.0` · 13 个 asset（`gh release view` 核对）· **端到端校验**：从 Release 下载 `tag-panel-0.2.0.znp` 与 `market/entries/tag-panel.json` 对比 —— sha256 `63b77ad6…` **完全一致**、大小 24391 B 一致 ⇒ 索引 → Release → 下载 → 校验 这条链路真通，不是「文件传上去了」· 剩下：客户端下载安装 UI（阶段 1）+ 公钥内置进应用 |
| rev173.144 | 2026-10-25 · **正式签名密钥 + 13 个官方插件打包入市**：生成 Ed25519 密钥 `aqua-2026`（私钥在 **仓库外** `%USERPROFILE%\.zeronote-keys\`；公钥写进本机信任根 `.zn/trusted-keys.json`）· **13 个插件全部打包**（12 签名 + 1 纯样式 `theme-sepia` —— 无 entry 的插件宿主恒为 unsigned，打包时跳过签名）· **端到端验签 12/12 通过**（按宿主算法重算 payload + 公钥验签 + 入口 sha 一致）· **打包规则改了**：从「收整个目录」改成「只收 manifest 声明的 entry / files / styles」——`outline-map` 目录里有 `selftest*.mjs` / `store.json` / 遗留 `vendor/`，以前会被打进包 · 索引 13 条已生成 · **未做**：包还没传到 GitHub Release（索引里的 url 现在是死链）、公钥还没内置进应用 |
| rev173.143 | 2026-10-25 · **插件市场阶段 0：打包 / 索引 / 原子安装**（用户拍板「做 + 外部作者开放 + 索引放本仓库」）：`scripts/lib/signing.mjs`（签名单一实现，`sign.mjs` 与打包共用）· `pack-plugin.mjs`（目录 → `.znp` + 签名 + 整包 sha256 + 市场条目）· `gen-market.mjs`（合并 `market/entries/*.json` 与 `external.json` → `index.json`，**已进质量门**：条目版本与 `examples/<id>/manifest.json` 不一致就红）· `market/`（README 投稿说明 / external.json / entries/ / index.json）· **`install_znp` 改原子**：先写 `.zn/tmp/install-<id>-<ms>` 再整目录交换，失败回滚（rev119 的「逐文件覆盖写 + 不删旧文件」已废）· Rust 测试 41 → **43**（坏包回滚 / 整目录替换） |
| rev173.142 | 2026-10-25 · **插件签名 v2：`manifest.files` 一并签进 payload**（用户拍板「扩」）：v1 只签入口 ⇒ 多文件插件里 `lib/*.js` 被换掉验签照样过 · payload → `zn-plugin-v2\|<id>\|<ver>\|<入口 sha>\|<path:sha256 按路径字典序>`（无 files 时末尾空段）· 三处改：`plugin-signing.ts`（`signingPayload` 收 `SignedFileDigest[]`）· `sign.mjs`（同步 + 校验声明文件存在）· `plugin-host.ts`（**把 `manifest.files` 的读取提到验签之前**，读到内容给 CJS 组装复用——原顺序下签名时根本看不到 lib 文件）· **Rust 没动**（只对 payload 字符串验签）· 单测 9 → **11**（排序无关 / 换内容·换路径·删文件·加文件四种篡改都让 payload 变 / 真实往返改 lib 后验不过 / v1 签名在 v2 下验不过）· **脚本 ↔ 前端一致性**：真实 `examples/cjs-multi` 跑 `sign.mjs --check` 与 vitest 输出逐字比对通过（临时测试，验完即删）· **反向验证**：`tail` 恒空 ⇒ 3 条红，恢复即绿 · 契约 §3.4 + 调研 §5 已同步 |
| rev173.141 | 2026-10-25 · **插件市场形态 + 开发者流程（补 §4.4 / §4.5）**：**市场不是新页面**，是「插件管理页」的第二个 tab（`mainView === plugins` 已有；用户心智「装插件 → 去插件管理」，复用 `PluginPanel` 分组列表）· 入口沿用右键 ☰ / 长按 ☰ 菜单 / `core.plugins`，新增「拖 `.znp` 进窗口」与可选 `core.market` 直达 · 安装 4 步（确认框列**能力自述** → 下载 → sha256 + 验签**失败不落盘** → 解包 + 自动重扫）· 更新三档：手动 / **启动静默检查 24h 节流只给角标** / 自动安装 ❌ 不做（插件能读任意文件、能 invoke 命令，换代码必须让人看见）· **发现现存隐患**：`install_znp` 是覆盖写同名文件 ⇒ 半截包会污染现有插件，要改成先解临时目录再换 · **开发者**：官方插件零手工（`examples/<id>/` → 打包签名 → `gen-market.mjs` 生成索引并进 verify 质量门 → CI 发 Release；加插件 = 加目录）· 外部作者照 Obsidian「索引不存版本号」，只存 `entry` 指向作者仓库的 `market-entry.json`，客户端列表页用 `latest` 快照、安装时再 GET `entry` ⇒ 作者发版不用改索引 · 审核**只审格式不审代码** + 每周 CI 健康检查标 `broken` |
| rev173.140 | 2026-10-25 · **插件市场可行性调研（不做实现）**：产出 docs/插件市场-调研-2026-10-25.md —— 先问「给谁用」（自用 = 净成本 / 给别人与手机 = 刚需）· **一手参照 Obsidian**（README + community-plugins.json）：索引就是一个静态 JSON（5 字段、**无版本号**），详情页拉插件自己的仓库、安装按 manifest.version 找同名 tag 的 Release ⇒ **市场不需要服务端** · 现状逐条核实：.znp 是单文件 JSON 不是 zip · 签名只覆盖入口文件 · 信任根手工放 · **内核 33 条命令里没有任何安装/重扫命令**（插件够不着 ppDataDir()/.zn/plugins/）· 三方案 A 静态索引+一键装（≈1.5 天）/ B +更新通道（+0.5 天）/ C 服务端（不做，与 D-009 冲突）· 分期 0（2 h 零风险）→1→2 · 安全叙事不包装：**市场是发现渠道 + 身份证明，不是安全门**，并点明内置公钥 = 持私钥者可推任意代码 · **代码零改动**；D-008 加 ⚠️ 更正块（重议条件已满足、决策仍 pending） |
| rev173.139 | 2026-10-25 · **HANDOFF 分卷 890 KB → 63 KB + ROADMAP 收口**：新增 `scripts/handoff-archive.mjs`（可复用 / 幂等 / `--dry-run`）—— 主文件只留 0.5.0 周期（`KEEP_FROM = rev173.125`，14 段 / 63 KB），275 段按版本切进 `docs/archive/handoff/`：`0.4.md` 54 段 · `0.3.md` 44 段 · `0.2.md` 163 段 · 同时切索引与正文 ⇒ check-docs 第 ③ 条天然通过 · 顶部加指路表 + `git grep -n "rev号" -- docs/archive/handoff/` · 原「更新时间」行是 25,989 字符的累积摘要 ⇒ 改成一行（信息没丢）· **副产物**：归档被 check-links 递归扫到（它**不扫 HANDOFF.md 本身**），暴露一处 `[App.tsx](<src/App.tsx>)` 伪链接（已修）⇒ 分卷前这些链接从没被检查过 · **ROADMAP 收口**：上一阶段留档 → 已拍板决定 → **候选池**（卡外部输入 / 等输入 / 要用户拍板 / 小债）→ 固定收口 → 暂缓不做；`D-008` 的重议条件「插件数 > 10」已满足（预装 13）⇒ 标成「要不要重开由用户定」 · **HANDOFF-CARD 也从 540 行瘦到 84 行**（删 200 行 ✅ 累积 + 50 行 0.3.0 周期 rev 表；3 条坑早就在 `docs/开发约定.md`，2 条补进 §4 测试约定 / §8 事故清单，CDP 端点补进本文备注） |
| rev173.138 | 2026-10-25 · **`rewrite_links` 两个防护 + 两次误判的教训入库**：Rust 新增 `replace_outside_code`（状态机替换，**fenced code / 行内代码原样保留** —— 此前纯字面替换会把笔记里贴的 `[[旧名]]` 语法示例改坏）· 新增 `backup_before_rewrite`（改前原文 → `<库>/.zn/link-rewrite/<毫秒>/<原路径>`，只留最近 20 次）· 单测 +1（fenced 不动 / 行内不动 / 备份内容 = 改前原文）· **同轮两次「只 grep `src/`」误判已回滚**：改名改引用其实 2026-10-17 就在 `rename_note → rewrite_links`；待办 checkbox 是 atomic 0.6.2 内置 · 教训写进 `docs/开发约定.md` §0.5（三层都查）+ §8 |
| rev173.137 | 2026-10-25 · **文档状态复核 + 发版 0.5.0**：`docs/README.md` 权威矩阵 4 行 + 4 份文档状态头按代码/提交复核（快捷入口 `QuickLaunch.tsx` = rev173.20–22 · 标签拖拽 = 已裁决，B 方案 rev173.54 落地、rev173.68 移除 · 全功能对标 §6 五项 = rev173.59/60/61/63/65 · 同步方案 = 已落地 rev173.106–136）· **`D-002`「不做云同步」仍标 accepted 而同步四后端已真机验收** ⇒ 新增 **`D-009`** 取代（自带后端 · 凭据走钥匙串 · 前台近实时 · 三方合并 · 仍不做账号/服务端/E2E），`D-002` 正文加 ⚠️ 更正块 · `D-006` → **superseded**（rev173.61 已接 window-state）· **发版 0.5.0**（`v0.4.0` 后 44 个提交；0.4.0 详细条目从未归档 ⇒ `[Unreleased]` 整体改名 0.5.0 并标注，另补 `[0.4.0]` 段） |
| rev173.136 | 2026-10-25 · **`sync-folder` 真双端合并冲突验收（Syncthing 2.1.7 两实例）**：装便携版 `Apps\Portable\Syncthing`（winget 两条路都卡：msstore 证书 `0x8a15005e` / GitHub 42 KB/s ⇒ `gh release download` + 本机代理）· 同机两实例（GUI 8384/8385 · 监听 22001/22002）REST 配对共享 folder `zn`，A = `_tmp-vault-tb`、B = `_tmp-sync\peer-b`，两端 `.stignore` 排除 `.zn` · 编辑器加 `A-SIDE-1521` 后 **1.7 s** 在对端加 `B-SIDE-1521` ⇒ **4 s 后** Syncthing 生成 `笔记1.sync-conflict-20261025-151226-SLX52RS.md` ⇒ **三方合并成功**：主文件两边改动都在、`pending` 清空、面板「合并 1」· 实例已停（不常驻）；Syncthing 已登记 `_View\网络与传输\`（55 条）+ `_软件清单.md`（7 → 8） |
| rev173.135 | 2026-10-25 · **`note:created` 也带正文（收掉 rev173.133 的 ⚠️）+ 三处终端验收**：`fs.createNote` 的 payload 带 `text`（= `content` 参数，零成本）；`fs.restoreTrash` 读一次盘后也带（读失败不带，订阅方退回读盘）· `sync-folder` 的 `note:created` 有 `text` 就**同步**种基线 / 同步点，旧内核回退读盘 · 契约 §1.4 表 `{ path }` → `{ path, text }` · 单测 921 → **923**（restoreTrash 带 `restored`+`text` / 新建零读盘且同步点用事件正文）· **反向验证**：`given = null` ⇒ 新用例红（1 failed / 44 passed）· 验收：`history` 右键 ☰ 菜单入口（modal 打开、标签条不加、Esc 关）· `outline-map` 手机主区面板 5 节点 + 返回键（**同轮修环境**：`adb reverse tcp:1420` 丢失导致启动 15 秒后无声退出）· `sync-webdav` 附件方向（本机 DAV 桩：远端改 ⇒ 拉取；本地 mtime 更新 ⇒ 不覆盖且推远端；配置已恢复坚果云 / off · `sync-folder` 0.3.1 → **0.3.2**（`note:created` 行为变了）） |
| rev173.134 | 2026-10-25 · **反向链接升级为全库持久索引**（技术债 #2；ROADMAP 原标「❌ 要改契约，另议」—— 证明**不用动契约**，全在插件层）：`backlinks` 以前只扫**最近 30 天**改过的笔记（rev173.95 的性能折中），老笔记里的引用一律看不见 · 现在放开到全库，成本靠三条压住：① `mtime` 缓存（原有）② **`at` 信任窗口** —— `note:saved` 现在带 `text`（rev173.133），保存后**零读盘**就能更新这篇的 refs；`at >= mtime` 表示手里的内容不比磁盘旧，别处再改会让 mtime 越过 `at` ⇒ 自动失效重读 ③ **事件增量** —— `note:saved`（带 text 零读盘）/ `note:changed`（读盘，`origin:'plugin'` 跳过）/ `note:deleted`（淘汰）/ `note:renamed`（迁移）· 内存缓存 `cache`（启动从 store 恢复），状态栏 `updateCount` 从「每次事件全库扫描」改成「内存算 + 一次 listNotes」· `ensureCaughtUp()` 后台补齐全库一次，`updateCount` 等它（否则冷启动先显示「被 0 篇引用」再跳数字）· 首次全扫每读 25 篇让出一次事件循环 · 面板摘要换成 `全库 N 篇 · 本轮读盘 M 篇 · 时刻`（缓存命中率直接可见）· 单测 26 → **30**：120 天前老笔记也命中 / `note:saved` 带正文零读盘 / `at` 信任窗口 / `note:deleted` 淘汰计数归零 · **反向验证**：把 `freshEnough` 的 `at` 分支改成 `return false` ⇒ 信任窗口那条红（1 failed / 29 passed）· 实测 dev `_tmp-vault-tb`：`笔记1.md` 写 `参见 [[标签验收-周报]]` → 打开 `标签验收-周报.md` ⇒ 状态栏 **「被 1 篇引用」** → 点开面板 ⇒ **`全库 30 篇 · 本轮读盘 0 篇 · 14:06:24`** · 契约 / 内核未改，`backlinks` 0.1.0 → **0.2.0**（新增 `event` 能力声明） |
| rev173.133 | 2026-10-25 · **修「本机保存可能永远同步不出去」**（`note:saved` 与 Rust watcher 回响的竞争，= rev173.116 记下的观察项）：根因不在 Rust 的 1500 ms 自写抑制（它本就只是尽力而为），而在**同步插件自己的判定窗口** —— `note:saved` 的处理体以 `await api.fs.readText` 开头，回响 `note:changed` 若在这段 `await` 中间跑完判定，pending 还没建立、磁盘已是新内容、基线还是旧内容 ⇒ `classifyChange` 判 `remote`（当成"别处更新"）把基线对齐新内容；随后 saved 醒来看到 `baseline.fp === 当前 fp` **直接早退** ⇒ 这次改动既没有 pending 也没有影子副本，永远同步不出去 · 修法三条：① 内核 `note:saved` 的 payload 带 **`text`**（刚写盘的正文，同一 JS 上下文不序列化）② sync-folder 判定段搬进**同步段**（有 text 就不 `await` 读盘），回响插不进来 ③ 旧内核不带 text 时退回读盘版本（不因版本差异静默失效）· 另加**内存影子副本** `shadowMem`（影子落盘是异步的，这段窗口里来真冲突时 `readShadow` 优先读内存，不再误标 `lost`；keepConflict / applyMerged / changed / scan / settle / rename 六处清 pending 的路径一并清）· 单测 916 → **917**：新增「保存的判定被回响抢跑（读盘慢）⇒ pending 仍留下，本机版不丢」，给 `memoryFs` 加 `slowNextRead(path)`（**只拖慢下一次**读盘）：保存那次慢、回响那次正常 ⇒ 精确重现抢跑；断言对端再改成 v3 时**判得出冲突**且副本 = 本机版 v2 · **反向验证**：把「用内核正文」分支改成 `given = null` ⇒ 1 failed / 43 passed，改回即全绿 · 契约 §1.4 payload 表 `{ path }` → `{ path, text }` · ⚠️ `note:created` 的 payload 未带 `content`（同样的窗口还在，但新建的影响只是"同步点没种下"，冲突判定仍正确）· ⚠️ 真机端到端没做（纯 JS 时序修复；sync-folder 的端到端要真实双端），证据到「红 → 绿 → 反向红」 |
| rev173.132 | 2026-10-25 · **`net.rs` 的 Content-Length 修复补 Rust 回归测试**：根因原先只有插件层兜底测试 —— 把 Rust 那行改回去也没有测试会红 · 做法与平台无关：`std::net::TcpListener` 起一个只接一次的本地服务器 + `tauri::async_runtime::block_on`，**读出服务器真正收到的请求头**再断言 · 两条：空 body 必须 `Content-Length: 0`、非空 body 长度匹配 · **反向验证**：删掉 `.header(CONTENT_LENGTH, …)` ⇒ `empty_body…` 失败、`non_empty…` 仍过 · cargo 38 → **40** |
| rev173.131 | 2026-10-25 · **S3 手机端实测 → 抓到并修「空笔记永远同步不上」（411）**：手机配 rclone（`192.168.1.5:8898`）连接 / 签名通过，同步到 **0 字节笔记**时 `PUT` 回 **411 Length Required**，自动同步每 5 秒重试同一篇、整轮中止 · **抓包证据**：reqwest 对空 `Vec` body 既不发 `Content-Length` 也不发 `Transfer-Encoding`（`cl=null te=null bytes=0`）· 修两处：**内核 `net.rs`** 对 body 显式带 CL（含 0，根因，重编生效）+ **`sync-s3` 兜底**空文本 PUT 带 `content-length: 0`（旧内核/已装 app 立即生效）· 手机热更新后同步过（桶 32 文件含 0 字节那篇）；删本地一篇 ⇒ 自动拉回（拉取方向通）· 单测 914 → **916** |
| rev173.130 | 2026-10-25 · **坚果云附件真机回归（桌面 ↔ 云端 ↔ 手机，双向）**：页面 reload 拿 rev173.127 新代码 → 附件模式 off→full · 桌面放 27,507 B png + 52 B txt → 同步上传（`attachments 392ms` 轮）· **删本地两份再同步 ⇒ pulled=2、字节数原样回来** · 手机（33b676f6 · dev 包 pid 14629）开 full ⇒ pulled=3 / pushed=3，手机 `list_notes` 出现两个「附件回归」文件 · 桌面再同步 ⇒ 出现手机推的 `image-20261020-011045.jpg`（89 KB） · 两端模式已恢复 off · 坑：手机 `pidof` 要等几秒、CDP forward 必须按当前 pid 重建 · **无代码改动** |
| rev173.129 | 2026-10-25 · **S3 条件写 `If-Match`**：`sync-s3` 的笔记 PUT 在「远端已有这篇 + manifest 记了 etag」时带 `If-Match` · 远端被绕过 manifest 改过 ⇒ **412** ⇒ 统一冲突处理（**重读远端 → 刷新 manifest 条目 → 能合就合 / 合不上留副本取远端**），不再静默覆盖 · **409** ConditionalRequestConflict ⇒ 取新 ETag 重试一次 · 服务端把该头当坏请求（**400**）⇒ 自动降级重试不带条件 + hint · `push-new` 不带条件 · 同时修：manifest 回写补 `manifestChanged`（旧写法 412 刷新条目后不回写 ⇒ 下一轮仍拿旧 etag 撞 412）· **真机（rclone 1.75.1 serve s3）**：rclone **忽略** `If-Match`（过期 etag 照写 200）⇒ 退化为旧行为、不会坏；带该头的 PUT 通过 rclone 验签 · 坑：`--auth-key` 的 accessKey 太短（`k`）⇒ 403 InvalidAccessKeyId · 单测 909 → **914** |
| rev173.128 | 2026-10-25 · **没有基线时不再「远端永远赢」**（`!base && remoteFp != null` 分支）：以前三个网络后端一律 `pull-new` —— store 丢过（换设备 / 清缓存 / 重装）而本地又改过，就会**静默用远端盖掉本地、一个副本都不留** · 现在：两边指纹相同 ⇒ `noop`（不白拉一次）、不同 ⇒ `conflict`（本机版先进 `.zn/conflicts/<平台>/`，再取远端版；history 同步点还在时仍先试三方合并）· `sync-webdav` / `sync-s3` / `sync-git` 一起改（`sync-folder` 不涉及：它的「远端」就是磁盘同一个文件）· 新增 2 条端到端用例（store 丢失 + 本地改过 ⇒ 副本 = local-mine；store 丢失但内容相同 ⇒ 不 GET 正文）· 反向验证：改回 `pull-new` 两条立即红 · 单测 907 → **909** · verify 6/6 |
| rev173.127 | 2026-10-25 · **`sync-webdav` 同款附件方向修复**（rev173.126 在 S3/Git 上修过的那套）：附件段改成**先拉后推** + `mtime(本地) > at(远端)` 方向判定 + 条目记 `mode`（按上传方模式取路径，混合 full/relay 才找得到文件）+ `preloaded` 复用「算指纹时读到的字节」（先拉后推后一轮要看两次，不复用就双倍 IO）· 顺带修既有 bug：下载循环 `localFp = await localFpOf(local)` 拿的是 `{fp,bytes}` **对象**、与字符串永不相等 ⇒「本地同版」永远判成要拉（以前靠 `If-None-Match` 304 兜住、不多传字节但每轮都发请求）· 新增双设备单测：A 传 v1 → B 拉 → B 换 v2 上传 → A 再同步 ⇒ 本地 v2 / 远端 v2 / **该轮没有 `PUT 图.png`** · 单测 906 → **907** · verify 6/6 · ⚠️ 没做真机（WebDAV 要自建 DAV 桩），证据是单测 · 坑：内核 `net.fetch` 的 `text()/bytes()` 是**同步**方法，mock 写成 `async` 会让 `normalizeManifest` 收到 Promise ⇒ 空表且不报错 |
| rev173.126 | 2026-10-25 · **S3 / Git 补附件同步**（此前只有 WebDAV 有）：两个后端各加 `syncAttachments` —— off / relay（中转，对端 ack 后删云端）/ full（永久），与 WebDAV 同协议同语义 · 内容级判定 `needsAttachmentPull` + `mtime`+`size` 指纹缓存 + 面板「附件」耗时 badge 与模式下拉 + 新命令 `*.set-attachments` · `sync-s3` 0.4.0 / `sync-git` 0.5.0（预装数不变）· **真机验收：S3（rclone serve s3）15/15 · Git（真实 GitHub 私有仓库）13/13** · 同轮抓到并修掉 **5 个静默 bug**：① S3 前缀非空时 `test()`/`list()` 把 prefix 拼进路径 ⇒ `/桶/<前缀>` 404 ② S3 `list()` 返回含前缀的 key ⇒ 清理时前缀拼两次（远端残留）③ Git `normalizeManifest` 恒丢 `attachments` ⇒ 下载循环空转、零日志 ④ GitHub Contents 的 `content` 对二进制有损（8 字节 PNG 的 `size` 仍 8，但 `content` 解码成 12 字节，`0x89` 变 U+FFFD）⇒ `readBytes` 改走 `Accept: application/vnd.github.raw` ⑤ 附件同步**先推后拉** ⇒ 双端互相覆盖（后同步者赢）⇒ 改先拉后推 + `mtime > at` 方向判定 + 条目记 `mode`（按上传方模式取路径，混合 full/relay 才找得到文件）· 单测 895 → **906** · ⚠️ `sync-webdav` 仍有第 ⑤ 条同款问题；S3 无 `If-Match`；Gitee 未实测 |
| rev173.125 | 2026-10-25 · **S3 后端真机验收（真实 `rclone serve s3`）**：MinIO 二进制 410（社区版不再直供）、Cloudflare R2 注册要绑卡 ⇒ 改用 **rclone 1.75.1** 当本机 S3 服务（`rclone serve s3 --auth-key k,s <目录>`，**自带 SigV4 验签**，桶名 = 数据目录下的子目录）· 下载踩坑：GitHub 直连只有 **61 KB/s**、`ghfast.top` 直接超时，**`downloads.rclone.org` 有 384 KB/s** ⇒ 走官方下载站 · 装到 `Apps\Portable\rclone\`，已进 `_View\网络与传输\` 与 `_软件清单.md`（114 → **115** 项）· **13 项全过**（对端是真实 S3 实现，不是桩）：test / 首推 2 篇 / 对端改 ⇒ 下载 1 / 双端改不同行 ⇒ 合并（两头一致）/ 双端改同一行 ⇒ 副本 = 本机版 / 面板 `用时 30 毫秒 · manifest 7 毫秒 · 笔记 23 毫秒` / 清理干净 · 踩坑：**桶目录必须先存在**（否则 `list` 404）、`--dir-cache-time 0s` 才能立刻看到新建目录 · **无 ZeroNote 代码改动** |

> ## 📌 rev173.230（2026-10-28 · 插件版本回滚 §2.14）
>
> 用户「继续」= ROADMAP §3.5 的 **5b**（rev173.229 交接时点名的「下个会话第一件事」）。
> 需求 §2.14 原文：混合模式 · 每插件保留最近 3 个版本 · 回滚前自动备份当前插件数据 · 尝试反向迁移 ·
> 失败则提示「仍要回滚并接受数据可能不可用 / 取消回滚」。
>
> ### ① 磁盘形状
>
> - `plugins/<id>/` —— 当前版本（唯一被加载的那份）
> - `plugin-versions/<id>/<version>-<毫秒>/` —— 存档（装新版前**整目录复制**，保留最近 3 份）
> - `plugin-versions/<id>/_backup/<毫秒>-store.json` —— 回滚前的数据备份（保留 10 份）
>
> 细节：存档在 `install_pack` 换目录**之前**做（本地 `.znp` 与市场下载共用同一条路径）·
> **只留 3 份**，按目录名**尾部毫秒**排序（不按版本名：`0.10.0` 会排到 `0.9.0` 前面）·
> 存档失败**只记日志、不阻断安装**（后悔药不该挡住正常升级）· 删除插件**不删**存档（重装同 id 还能滚回去）。
>
> ### ② 两个命令
>
> - `list_plugin_versions(vault, pluginId)` → `{ current, versions[] }`
>   （版本 / 存档时刻 / 体积 / 是否有 store / `manifest.storeVersion`）
> - `rollback_plugin(vault, pluginId, stamp, force)` → `{ status: "ok" | "needConfirm", … }`
>   - `ok`：已换回旧版；`dataBackup` 是回滚前数据的备份路径，`storeRestored` 说明数据是否也回退
>   - `needConfirm`：**磁盘一个字节没动**，带 `force: true` 重调即执行
>
> 执行顺序：备份当前 store → 当前版本**也存档**（回滚后能滚回来）→ 存档复制上位 → 删旧目录；
> 任一步失败恢复原版本（与安装同一套「先暂存再交换」）。
>
> ### ③ 「反向迁移」怎么落的
>
> - manifest 新增可选整数 **`storeVersion`**（数据格式代际）
> - 当前代际 > 目标代际 ⇒ 先返回 `needConfirm`（红框说明「第 N 代 vs 第 M 代」）
> - 用户选「仍要回滚」⇒ 用**该版本存档里的 `store.json`** 替换当前数据（数据跟着回退）；
>   存档里没有 store ⇒ 保留当前数据 + 结果里给 `warning`
>
> ⚠️ **取舍（写进契约 §3.5）**：内核**不调用插件代码**做 down-migration —— 插件代码不可信，
> 而且回滚发生在加载之前。真实迁移仍归插件自己；内核只决定「要不要拦一下 + 数据回到哪个快照」。
> 目前没有任何插件声明 `storeVersion`，这条路径由 4 条 Rust 单测 + 探针实测覆盖。
>
> ### ④ 回滚标记（否则预装插件回滚无效）
>
> 内置插件每次重扫都会被 `ensureBuiltinPlugins` 用内置内容覆盖回来（那是正常升级路径）——
> 回滚一个预装插件会在**同一次重扫**里被打回最新版（`onReloadPlugins` 就触发它）。
> 所以：
>
> - 回滚成功在插件目录写 `.zn-rolled-back.json`（`{at, from, to}`）
> - `ensureBuiltinPlugins` 见到标记 ⇒ `skipped: 'rolledback'`，不覆盖
> - **下一次安装新版**清除标记（回到正常升级轨道）
> - 单测：Rust 断言「回滚后有标记 / 装上 3.0.0 后标记消失」；
>   TS 断言「有标记 ⇒ 一个 `write_plugin_file` 都不发」
> - ⚠️ 「内置插件被跳过」这条路径**没有真机造场景**：要验它得把探针登记进
>   `BUILTIN_PLUGINS`（改内置表只为验证，不值得）；靠 TS 单测 + 代码路径覆盖
>
> ### ⑤ UI
>
> - 插件行多一个 **History 图标**（删除左侧）→「版本记录」对话框：版本 / 时间 / 体积 / 含数据 / 回滚
> - 没有历史版本时明说「从下一次安装 / 更新开始存档」
> - 代际降级：对话框内红框 + 「仍要回滚 / 取消」（取消什么都不改）
> - 回滚成功 → `onReloadPlugins()` 重扫 + 提示「已回滚：v2.0.0 → v1.0.0（数据也回退到该版本快照）」
>
> ### 实测（桌面 dev · CDP）
>
> 探针 `rollback-probe`：v1（storeVersion 1）/ v2（storeVersion 2），安装后各写一次 store。
>
> 1. 装 v1 ⇒ store `{"gen":1}`；装 v2 ⇒ `.zn/plugin-versions/rollback-probe/1.0.0-1793131874495/` 出现（含 store.json）
> 2. 插件页 → 探针行 History ⇒「v1.0.0 · 2026-10-28 04:11 · 426 B · 含数据」
> 3. 点「回滚」⇒ 红框「当前 v2.0.0 的数据格式是第 2 代，v1.0.0 只认第 1 代」；
>    此时磁盘**未动**（仍 2.0.0 / `{gen:2}`），`_backup/` 也还没落（备份在确认之后）
> 4. 点「仍要回滚」⇒ 当前 **1.0.0** · `index.js` 是 v1 · `store.json` = **`{"gen":1}`** ·
>    存档多一份 **2.0.0**（刚离开的版本）· `_backup/` 2 份（确认时一次 + 执行前一次）
> 5. 日志：`插件已卸载：rollback-probe` → `插件已加载：回滚探针（rollback-probe｜esm）`
> 6. 截图 `_shots/rev173230-versions-dialog.png` · `_shots/rev173230-need-confirm.png` · `_shots/rev173230-rolled-back.png`
>
> 测完通过 UI 删除插件 + 手动删 `plugin-versions/rollback-probe`（探针不进仓库、不留在功能里）。
>
> **测试**：cargo **59**（+4）· vitest **1379**（+6）· verify 六步全绿 · 质量门 7/7。
>
> ### 踩坑
>
> - **`needConfirm` 阶段原本也写备份** ⇒ 用户点「取消」后在磁盘留下垃圾 `_backup/*.json`。
>   改成确认之后才备份，单测加了「needConfirm 时 `dataBackup` 必须是 null」
> - **存档名尾部必须是时间戳** —— 原先把「同毫秒序号」放在最后（`<version>-<ms>-<n>`），
>   `stamp_time()` 取尾段拿到的是 **n**，列表排序会乱；改成 `<version>-<n>-<ms>`
> - `__znInstallZnp` 失败时返回 `null`，插件页**没有**报错 —— 错误显示在 App 顶部错误条、
>   不在 `.zn-plugins-error`（那是「插件加载失败」的通道）；实测踩了一次才知道
> - 探针脚本把包生成到了嵌套目录（`_tmp-test/rollback-probe/rollback-probe/`），
>   第一次安装报「读取插件包失败：系统找不到指定的文件」—— 路径要按实际产出写
>
> ### 未做
>
> - 真正的 down-migration 钩子（见 ③ 的取舍）
> - 删除插件时清理版本存档（有意保留）
> - 手机端走查（本轮是纯 Rust + 宿主 UI；手机要重装 APK 才带新 Rust，交接注明）
>
> ## 📌 rev173.229（2026-10-28 · 开发者调试面板）
>
> 用户「继续」= 排期 5（调试面板 + 版本回滚）。这一轮只做完**调试面板**；
> 版本回滚要改 Rust 的安装路径（存档 / 列表 / 回滚），单独一轮做 —— 已拆成 ROADMAP §3.5 的 **5b**
> 并标为下个会话第一件事。
>
> ### ① 结构化日志（基础）
>
> 此前 `panelLog` 是一串 `string`，`<pre>` 全量打出来 —— 分不清谁打的、error 没有堆栈。
>
> - 契约新增 `PluginLogEntry { ts, pluginId, level, msg, stack }`
> - `PluginHostDeps.onLog(msg, level, pluginId?, stack?)`：加载 / 卸载日志带归属；
>   `scopedHost` 包 `host.log`，**error 时捕 `new Error().stack`**（栈里含插件帧，能定位到文件行号）
> - `scopedEvent` 登记「插件 → 订阅的 topic」（`allPluginTopics()`），`kernel.audit()` 新增 `pluginTopics`
> - 命令执行失败 / 事件处理器异常：**warn → error**，并从实现标签 `plugin:<id>` 反推归属 + 带堆栈
>
> ### ② 调试面板（插件页新「调试」tab）
>
> - 开发者模式开关（`zeronote.devMode` 落 localStorage）
> - 统计条：已安装 / 启用 / 命令数 / 事件 topic 数 / 日志数 / 错误数
> - 诊断表：插件 · 命令 · 面板 · 服务 · 事件订阅（已启用插件全列出，纯样式插件也有一行）
> - 模拟触发：topic + JSON payload → `kernel.event.emit`（JSON 解析失败给明确提示）
> - 日志：最近 200 条，按插件 id / 内容过滤；error 红字 + 可展开堆栈
> - 操作：重载全部插件 · 写一条测试日志 · 清空日志
>
> ### 实测（桌面 dev · CDP）
>
> - 插件页三个 tab「已安装 18 / 发现 / 调试 17」；调试 tab 默认只显示开关
> - 打开开发者模式：统计「已安装 18 · 启用 17 · 命令 **210** · 事件 topic **7** · 日志 37」
> - 诊断表：记账 27 命令 / 1 面板 · AI 22 命令 / 2 面板 / 订阅 `note:saved` ·
>   反向链接 3 命令 / 2 面板 / 订阅 `note:changed、note:deleted、note:renamed +1` · 备份 6 / 1 ·
>   文档阅读器 2 / 0
> - 模拟触发 `zn:probe` ⇒ 「已发射 zn:probe」
> - 「写一条测试日志」⇒ error 行 + 堆栈 details（`Error: 测试日志（来自调试面板） at App.tsx:738`）
> - 截图 `_shots/rev173229-dev-panel.png`
>
> **测试**：vitest 1373（**本次没有新增单测** —— 改的是宿主管线与 UI，靠 CDP 实测；
> 已在 ROADMAP §4 记一笔「调试面板这类宿主 UI 的回归靠真机/桌面实测」）· cargo 55 ·
> **verify 六步全绿（03:40:29）· 质量门 7/7**。
>
> ### 踩坑
>
> - `onEmitEvent?.(...) ?? '宿主没有提供'` —— **成功时返回 null，被 `??` 当空值** ⇒ 永远显示「宿主没有提供」；
>   改成三元判断
> - 诊断表先只从 audit 资源反推 ⇒ **一个资源都没注册的插件不出现**；改成「先按已启用插件铺满，再合并计数」
> - `host.log` 原本往消息里塞 `[warn] ` 前缀，结构化后级别单独一列 ⇒ 去掉前缀避免重复
>
> ### 未做（已写进 ROADMAP §3.0）
>
> - 单插件热重载（要拆 `usePluginHost` 的整代加载；现在是「重载全部」）
> - 沙箱控制台（插件是独立 Blob 模块，宿主拿不到它的作用域）
> - 资源监控的内存 / CPU（WebView 没有对应 API）
> - 开发者模式「跳过权限确认」—— **刻意不做**（本项目立场：能力自述 + 签名可见，不留一键绕过开关）
> - **版本回滚（§2.14）整个没做** —— 见 ROADMAP §3.5 的 5b
>
> ## 📌 rev173.228（2026-10-28 · 引用悬浮预览 + 安卓重编真机验证）
>
> 用户「继续，安卓也编译测验」：排期 4（引用 hover）＋ 把 226/227 的改动真正装到手机上看。
>
> ### ① 引用悬浮预览（需求 §4.5「引用显示标题和摘要」）
>
> - 新 `src/lib/wiki-preview.ts`（纯函数）：`findWikiNote`（ID → 相对路径 → 路径后缀 → 标题，
>   **与点击跳转共用**）、`previewSnippet`（剥 frontmatter / 代码块 / 图片 / 链接 / 标题符号，
>   压一行截 140）、`wikiTarget`（`目标|别名` → 目标）
> - `useDocSession.openWikiLink` 改用 `findWikiNote` —— 匹配只有一份代码，
>   不会「点开 A、预览 B」
> - `MarkdownEditor`：新增 `onWikiPreview` 回调（宿主查笔记 + 读正文），编辑器只管时机与定位：
>   桌面 `mouseover` 停 350 ms 弹、离开 160 ms 收；手机 `pointerdown` 长按 450 ms
>   （移动 >10 px 取消 = 滚动不是长按）；浮层 `position: fixed` 贴链接下方、右侧放不下左移；
>   滚动 / Esc / 点别处 / 鼠标离开都收
> - **长按弹过预览后吞掉紧随的 click**（否则松手直接跳走 —— 真机踩到，见踩坑 ②）
> - 摘要去重：正文首行常是 `# 标题`，剥完后与浮层标题重复 ⇒ 去掉前缀
> - 单测 **+12**（`tests/wiki-preview.test.ts`：匹配顺序 / 别名 / 反斜杠 / 找不到 /
>   摘要剥标记 / 截断）
>
> ### ② 安卓重编 + 真机验证（`tauri android dev` → 手机 `33b676f6` · app pid 25184）
>
> | 验证项 | 结果 |
> |---|---|
> | 视频内联播放（rev173.226） | `<video>` `readyState 4` / 320×240 / `play()` 后 `paused=false`；**附件计数 5**（含 `clip.mp4`）⇒ `kind = media` 在手机 Rust 上生效 |
> | 待办删除线（rev173.227 的核实项） | 已完成行 `cm-atomic-task-done` + `line-through` + 灰 `rgb(161,161,170)`；未完成行 `none` |
> | 导入落点（rev173.227） | 从 `/sdcard/Download/导入样本.md` 导入 ⇒ `日期导入/2026-10-28/导入样本.md`（无分类层）；frontmatter 正常 |
> | 引用长按预览（本 rev） | 长按 700 ms 弹浮层「链接目标 + 摘要」；松手 + click **不跳转**（正文仍是「引用测试」） |
>
> 截图：`_shots/rev173228-phone-video.png` · `_shots/rev173228-phone-wiki.png`（长按浮层）·
> 桌面 `_shots/rev173228-wiki-hover2.png`
>
> **测试**：vitest 1361 → **1373**（+12）· cargo 55 · **verify 六步全绿（03:27:00）· 质量门 7/7**。
>
> ### 踩坑（都进了代码注释）
>
> 1. **旧的 `android-dev` 进程（10-26 02:33 起）一直卡着** —— 占着 `.self-logs/android-dev.log`
>    与两个 `adb logcat`，新编译直接「The process cannot access the file」
>    ⇒ `taskkill /PID <pnpm> /T /F` 清整棵树 + 单独杀那两个 10-26 的 `adb logcat` 才起得来
> 2. **长按抑制标记的兜底时机错了**：原本从「长按触发」起算 500 ms 复位，用户按住 >950 ms
>    再松手 ⇒ 标记已过期 ⇒ 松手直接跳走。改成 **pointerup 之后 300 ms** 复位
>    （click 在 pointerup 后同步派发）
> 3. **CSS 模板字符串里的反引号**：注释里写反引号包着的 `[[x]]` 会提前结束 `EDITOR_CSS` 模板
>    ⇒ 手机日志 `ReferenceError: x is not defined`
> 4. **Android 下载目录是单数 `Download`**（`GENERIC_PARENTS` 原来只有复数 `downloads`）
>    ⇒ 从下载目录导入时分类被猜成「Download」；补齐 `download / dcim / pictures / movies / music`
> 5. 手机 `adb push` **多个中文名文件一次推**会 `failed to read copy response: EOF` ⇒ 逐个 push
>
> ### 遗留
>
> - 手机长按预览时 Android 会聚焦编辑器（软键盘可能弹出）—— 不影响浮层可读；
>   没做 `blur()`（会打断正在输入的用户）
> - 摘要走 `fs.readText`（异步读盘，5 秒缓存）；只读 hover 的那一篇，库大也无影响
>
> ## 📌 rev173.227（2026-10-28 · 排期 2 + 3：删除线核实 + 导入目录语义）
>
> 用户「继续」，把 §3.5 的第 2、3 项做完 —— 一件是**核实**（本来就有），一件是**实现**。
>
> ### ① §4.4 待办删除线：本来就实现了（零代码改动）
>
> ROADMAP §3.0 写「勾选后加删除线未做」，实测是**误判**：
>
> - 行类：勾选后 `.cm-line` 多 `cm-atomic-task-done`（`dist/inline-preview.js:681-685` 发 `Decoration.line`）
> - 样式：atomic 自带 `.cm-line.cm-atomic-task-done { color: var(--atomic-editor-fg-faint);
>   text-decoration: line-through }`（`dist/styles/inline-preview.css:414`）；本项目只把
>   `--atomic-editor-fg-faint` 桥接到 `--zn-fg-subtle`，没动删除线
> - 实测（CDP）：未完成行 `textDecorationLine: none`；已完成行 `line-through` + `rgb(113,113,122)`；
>   点击 checkbox ⇒ 磁盘 `- [ ]` → `- [x]`、**文本与位置都不变**（需求 §4.4「保持原位」）
>
> ⇒ 只更正文档（ROADMAP §3.0 / §3.5），没动代码。
>
> ### ② §12 导入目录语义：落点改成「日期导入/<日期>/[原分类/]」
>
> `examples/import-export/index.js`：
>
> - **落点** `日期导入/<YYYY-MM-DD>/[<原分类>/]<文件名>.md` —— 同一天多次导入天然合并进同一个日期目录
> - **分类** `guessCategory(srcPath)`：取源文件**直接父目录**；桌面 / 下载 / 缓存 / 盘符根不猜
>   （`GENERIC_PARENTS`）。命令 `io.importFile` 也接受 `category` 显式指定
> - **元数据** `withImportFrontmatter`：补 `created`（**导入时刻**）+ `source`（原文件名）；
>   已有 frontmatter 就地追加、**同名键不覆盖**（md 导入常自带 frontmatter）
> - **清洗** `sanitizeDirName`：Windows 非法字符 / 控制字符 / 首尾点，限 40 字
> - `freeRelPath` 改收「完整 base（不含扩展名）」，撞名递增逻辑不变
>
> ⚠️ **联动**：`examples/ai/index.js` 的 `EXCLUDED_DIRS` 加 `日期导入` —— 需求 §12 要求
> 「导入后不立即让 AI 整理」，不加的话导入的笔记会被 `save` 触发的自动任务直接吃掉。
>
> ### 实测（桌面 dev · CDP · 测试库 `_tmp-vault-tb`）
>
> - 从 `_tmp-import-src/工作/周报.md` 导入 ⇒ `日期导入/2026-10-28/工作/周报.md`（分类 = 父目录「工作」）；
>   磁盘 frontmatter：原 `tags: [工作]` 保留 + 追加 `created` / `source`
> - 同一文件再导一次 ⇒ `…/工作/周报-1.md`（同目录合并、撞名递增）
> - `{category:'自定义分类'}` ⇒ `…/自定义分类/周报.md`（显式分类生效）
> - 从 `_tmp-import-src/生活记录.md` 导入 ⇒ 分类 = 父目录 `_tmp-import-src`（父目录名有意义就保留）
> - reload 后文件树三层结构正常（`日期导入 / 2026-10-28 / 工作 / 周报.md`）· `_shots/rev173227-import-tree.png`
>
> **测试**：vitest 1344 → **1361**（+17）· cargo 55 不变 · **verify 六步全绿（03:07:42）· 质量门 7/7**。
>
> ### 遗留
>
> - **源文件创建时间拿不到**：asset 协议只回 `content-length` / `content-type`（HEAD 实测），
>   没有 `Last-Modified`，内核也没有 `stat` 原语 ⇒ 先记**导入时刻**。要真保留得加契约原语。
> - **市场包 `import-export@0.1.0` 仍是旧代码**（落库根、不写 frontmatter）。内置预装版是新的；
>   市场版要发市才会同步 —— 下次发市一起打。
> - Android 未走查（本轮无 Rust 改动；导入要过系统文件选择器，手机上没测）。
>
> ## 📌 rev173.226（2026-10-28 · 音视频内联播放）
>
> 用户「开工」，按 **ROADMAP §3.5 排期 1** 做：笔记正文里直接播 mp4 / mp3。
>
> ### 为什么不能只改前端
>
> atomic 的 image-blocks 把 `![](clip.mp4)` **一律**渲染成 `<img>`（`dist/image-blocks.js` 的
> `buildImageBlocks` 只认 `Image` 节点、`toDOM` 固定 `createElement('img')`）——
> 浏览器拿 mp4 当图片只会显示破图。所以要在 widget 挂进 DOM 后**替换**它。
>
> ### 改动
>
> 1. **`src/lib/media-render.ts`（新）** —— 纯函数：`mediaExt`（去 query/hash、大小写不敏感）、
>    `mediaKindOf`（能播的 → video/audio；**mkv / avi 返回 null**）、`isMediaFileName`（含播不了的容器）、
>    `mediaHint`（「浏览器不能播放 .mkv（容器不支持），请先转成 MP4」）。三组扩展名与 Rust 同一份口径。
> 2. **`MarkdownEditor.tsx`** —— `upgradeMediaWidgets`（在 `fixImageSrc` 末尾调用，复用同一个 MutationObserver）：
>    把 `.cm-atomic-image` 里的 `<img>` 换成 `<video controls playsinline>` / `<audio controls>`。
>    三条约束：**幂等**（`data-zn-media` 标记；CM6 滚走再滚回来会重建 widget，那时自动重升）·
>    **不抢光标**（atomic 在 wrap 上挂了 mousedown 把光标挪到源码行 —— 播放器要能点，所以在 capture 阶段
>    `stopPropagation`）· **失败要说话**（`error` → 播放器下方红字「MKV、AVI 请先转成 MP4」）。
>    CSS 限高 60vh（手机 40vh）。
> 3. **`src-tauri/src/lib.rs`** —— `MEDIA_EXTS` + `is_media` + `collect()` 放行 + `kind = "media"`。
>    不改这里：音视频**根本不进 `list_notes` / 文件树**（`collect` 只收 note/doc/image），侧栏点了只会说
>    「库里没有这个附件」。
> 4. **`tauri.conf.json` CSP 加 `media-src`** —— 此前只有 `img-src`。没有它会回落到 `default-src 'self'`
>    ⇒ `asset:` 的媒体被**静默拦掉**（画面全黑、且不一定报错）。
> 5. **`FileTree.tsx` / `AppStatusBar.tsx` / `App.tsx`** —— 附件分组收 media（徽章 `.mp4`）、状态栏
>    「· N 附件」含 media、侧栏 / 时间流点 media 给中性提示（播放要在笔记上下文里，不单独开窗）。
>
> ### 插入链路
>
> `insertFileFromPath`：图片 → `![](…)`（时间戳名）；**能播的音视频 → `![](…)`（保留原名主干）**；
> **播不了的容器（mkv / avi / wma …）→ `[…](…)` 链接 + toast 提示转格式**（照样复制进库，用户可能只想存附件）。
>
> ### 测试
>
> vitest 1333 → **1344**（+11，`tests/media-render.test.ts`：扩展名 / URL query / 大小写 / 不可播容器 / 提示文案）；
> cargo 55 不变 —— Rust 侧的 media 断言加在现有 `list_covers_notes_and_readonly_docs_but_skips_others` 里
> （mp4 / mkv / 大写 `.MP3` / `.ts` 四条：进文件树、`kind = media`、`title` 去扩展名、`frontmatter` 为 null）。
> **verify 六步全绿（02:56:40）· 质量门 7/7**。
>
> ### 实测（桌面 dev · CDP · 测试库 `_tmp-vault-tb`）
>
> - 插入 `test-clip.mp4`（ffmpeg 生成 2 s 彩条）⇒ 磁盘 `test-clip-1.mp4`（撞名递增）+ 正文 `![](test-clip-1.mp4)`；
>   DOM：`video` `readyState 4`、`videoWidth 320 × 240`、`video.error null` —— **asset 协议与 CSP media-src 都通**
> - CDP 真实点击播放按钮（436,337）⇒ `paused=false`、`currentTime 0.81`、`document.activeElement` = video
>   （atomic 的「点图跳源码行」确实被掐掉了）
> - `test-tone.mp3` ⇒ `<audio>` `readyState 4`、`duration 1`
> - `test-old.mkv` ⇒ 走链接 `test-old-1.mkv`，toast 原文「已按链接插入 test-old-1.mkv —— 浏览器不能播放
>   .mkv（容器不支持），请先转成 MP4」
> - reload 后文件树 **「附件 9」**（3 图片 + 6 音视频），状态栏「31 篇 · 3 文档 · 9 附件」；
>   点附件里的 mp4 ⇒ toast「音视频附件：test-clip-1.mp4 —— 在笔记正文里用 ![](test-clip-1.mp4) 内联播放」
> - 回归：打开含图片的笔记，`img.src` 仍是 asset URL、`naturalWidth 1220`、页面无 `video/audio`（图片链路未受影响）
> - 截图：`_shots/rev173226-video.png`（首帧 + 控制条）· `_shots/rev173226-playing.png`（播放中 + audio + mkv 链接 +
>   附件 9）· `_shots/rev173226-attach-group.png`
>
> ### 已知取舍 / 未做
>
> - **手机未重装**（硬约束 7：只跑已装 dev 包；改 Rust 要重编 APK）⇒ Android 上的 media 列表与播放**未真机验证**。
>   前端改动会随 vite 生效，但 `kind` 要新 Rust —— 手机要验得重编一次。
> - **没有独立播放器 / 附件面板**：侧栏点音视频只给提示（要播请写进正文）。附件面板属附件同步期。
> - **音频用原生控件**（Chrome 绘制，深色主题下是白底条），未做自绘播放器。
> - `.ts` 同时是 MPEG-TS 与 TypeScript 源码 —— 库里放 `.ts` 源码会被归进「附件」。笔记库场景低风险，先记录。
>
> ## 📌 rev173.225（2026-10-28 · 交接：需求定稿 + 排期）
>
> 用户「排完交接」。本会话 **3 个 rev（222–224），全是文档，零代码改动**。
>
> ### 本会话交付
>
> 1. **[`docs/附件与同步-需求-2026-10-28.md`](docs/附件与同步-需求-2026-10-28.md)** 定稿（3 轮修订）：
>    - ≤1 MiB 复制入库 / >1 MiB 引用原文件；图片两模式（A 原图默认：≤1 MiB 预览即原图；>1 MiB 引用 + 预览图；B 压缩到 ≤1 MiB 作正式版本，点开默认为压缩版，可「同步原图」后改看原图）
>    - 引用台账 **`<库>/.zn-assets/manifest.json`**（库根点目录，外部同步只需放行这一条，不动 `.zn/*` 排除）
>    - 跨设备**主动调用 + 每次确认**（笔记里点音视频 / 图片「同步原图」/ 附件面板），启动保存定时都不自动搬
>    - §3.1 **媒体容器查证**：WebView2 与 Android WebView 都是 Chromium ⇒ 视频只认 MP4 / WebM / MOV；**MKV / AVI 是容器不被识别**，不转码播不了 ⇒ **定稿：插入时检测扩展名提示「请先转成 MP4」+ 播放失败明确提示，不内置 ffmpeg**
> 2. **ROADMAP §3.0** 补齐 8 条缺口（音视频 / 调试面板 / 版本回滚 / 核心能力接管 / 导入目录语义 / 引用 hover / 待办删除线 / 附件同步）
> 3. **ROADMAP §3.5 排期 10 项**：① 音视频内联播放 ② 待办删除线 ③ 导入目录语义 ④ 引用 hover 预览 ⑤ 调试面板 + 版本回滚 ⑥ 核心能力接管（只 search + storage）⑦–⑨ 附件同步三期 ⑩ 安卓桌面组件
> 4. **CARD 更正**：「安卓桌面组件是唯一大块缺口」是错的，已在原处标 ⚠️
>
> ### 下个会话第一件事
>
> **排期 1：音视频内联播放**（1 天）。入口：`src/components/MarkdownEditor.tsx` 的 `imageAssetPlugin`（MutationObserver 扫 `img`）+ `src-tauri/src/lib.rs` 的附件白名单 + `src/lib/insert-image.ts`。要点：内联 `<audio>` / `<video>`、`convertFileSrc` 走 `asset://`（scope 已是 `**`）、插入时按扩展名白名单校验。
>
> ## 📌 rev173.224（2026-10-28 · 需求整理 + 排期定稿）
>
> 用户答完 5 个待定问题，**只改文档**：
>
> - ① 音视频**内联**播放（接受「视频 >1 MiB 只引用、换机需先同步原图」）
> - ② 媒体容器查证 → 见下；③ 引用台账改 **`<库>/.zn-assets/manifest.json`**（库根点目录，外部同步只需放行这一条，不动 `.zn/*` 排除）
> - ④ 核心能力接管**只做 `search.query` + `storage.*`**，明确不做 `editor.render`（不打破「插件不接触 CM6」）
> - ⑤ 附件同步 = **本轮不开工**，按合理顺序排进路线图
>
> **媒体容器（一手查证）**：WebView2 与 Android WebView 底层都是 Chromium ⇒ 视频只认 **MP4（H.264/H.265*）、WebM、MOV**；**MKV / AVI / FLV / WMV 是容器不被识别**，换编码也没用。音频 MP3 / M4A / OGG / WAV / FLAC 都行。结论：不转码播不了，建议「插入时检测扩展名提示转 MP4 + 播放失败给明确提示」，**不内置 ffmpeg**（Android 要 +15–25 MB）。
>
> **产出**：ROADMAP **§3.5 建议排期 8 项**（音视频 → 待办删除线 → 导入目录 → 引用 hover → 调试面板+回滚 → 核心能力接管 → 桌面组件 → 附件同步）；附件需求文档补 §3.1 媒体容器表。
>
> ## 📌 rev173.223（2026-10-28 · 附件需求补充：触发方式 + A/B 显示细节）
>
> 用户补充口径，**只改文档**：
>
> - **触发方式**：从「附件面板手动」改为 **用户主动调用 + 每次确认** —— 三个入口：笔记里点音频/视频（原文件不在本机）、模式 B 图片的「同步原图」、附件面板「同步到其他设备」；每次弹「即将同步大文件（N 个 / X MiB），继续？」，确认后才搬。启动 / 保存 / 定时 / 打开笔记都不自动搬。
> - **模式 A**：≤1 MiB 复制原图，**预览就是原图、点开也是原图**；>1 MiB 引用原图 + 生成预览图（原图不在本机 → 显示预览 + 角标）。
> - **模式 B**：压到 ≤1 MiB 作正式版本，**正文与点开默认都是压缩版**；提供「同步原图」，主动同步成功后**点开默认显示原图**。
> - 收尾：check-docs 通过 · verify 六步全绿（vitest 1333）。
>
> ## 📌 rev173.222（2026-10-28 · 附件存储与同步需求定稿，用户明确「先不做」）
>
> 用户给出新需求并逐条拍板，**纯文档交付，零代码改动**。
>
> - **规则**：图片与其他附件统一按 **1 MiB** 分界 —— ≤1 MiB 复制入库，>1 MiB 引用原文件（不复制）。
> - **图片两模式**：**A 默认「引入原图」** = 遵守统一阈值（>1 MiB 时另生成 ≤1 MiB 预览图入库；点开看原图，原图未同步则显示预览 + 角标）；**B「引入压缩预览图」** = 压到 ≤1 MiB 后必定入库（正文就是压缩版，不提供原图入口）。
> - **引用台账** `<库>/.zn/assets/manifest.json`：记 sha256 + 每台设备本地路径，解决「换机路径失效」；`.zn/` 默认不同步 ⇒ 需在同步插件放行清单显式加一条。
> - **跨设备搬运**：`local → 云端临时 → 对端落地(.zn/assets/external/) → 引用改写 → 删云端`；**只在用户手动触发时跑**；本地文件夹 + WebDAV 先做，S3 次之，**Git 不做**（大文件炸历史）。
> - **三点拍板**：`1 MiB = 1,048,576` 字节（与系统文件属性一致）· 点开看原图、未同步显示预览并带标识 · 落地 `<库>/.zn/assets/external/` 且不主动同步大文件。
> - 文档：[`docs/附件与同步-需求-2026-10-28.md`](docs/附件与同步-需求-2026-10-28.md)（accepted · 暂不排期，4 期验收已写）· ROADMAP §3.0 候选池已登记。
> - 收尾：verify 六步全绿（02:22:22 · tsc 0 / oxlint 3 warnings / cargo 55 / vitest 1333 / 质量门 7/7）。
>
> ## 📌 rev173.221（2026-10-27 · 交接 · AI 不可信：调研 → 实现 → 真模型 → 发版）
>
> 用户「交接」。本会话 **7 个 rev（214–220）**，一条主线：**让 AI 的「完成」变成宿主可验证的事实**。
>
> ### 本会话交付
>
> | rev | 内容 | 验证 |
> |---|---|---|
> | 214 | `ai@0.7.0` 重打发市（209–212 内容入包） | 远程 sha256 一致（代理 / fastly） |
> | 215 | 调研 `docs/AI不可信-调研-2026-10-27.md` + 三件实现：`claimAudit` / 界面事实条 / 压缩保结构 | vitest 1311 → 1326 · mock 端到端 |
> | 216 | 任务侧 `auditTaskRun` + 手机走查 208–215 + `ai@0.8.0` | 4 张手机截图 |
> | 217 | **真模型实测**：抓到「伪造系统记录」→ `<系统记录>` 边界 + system 规则 8 + `stripHostNotes` | 复测：模型真调工具 |
> | 218 | 手机从市场装 `ai@0.8.0`（签名包 Android 首验） | 包内 `signature.json` |
> | 219 | `ai@0.9.0` 发市场（217 的修复入包） | `verify-trust` 34/35 |
> | 220 | 手机更新到 0.9.0 + 发现 CDN 索引缓存滞后 | 更新路径通过 |
>
> ### 交接时状态
>
> - HEAD `a45e7e0` · **与 origin 同步** · 工作区干净
> - verify 六步全绿 · vitest **1333** · cargo 55 · oxlint 3 warnings · 质量门 7/7 · 市场 **17 条**（ai **0.9.0**）
> - 桌面 dev pid **35548**（00:58 起，**20.9 小时**仍可用；vite 1420 / CDP 9222 都在）
> - 手机 `33b676f6`：`ai` = **市场签名包 0.9.0**（与源码 rev217 一致）· 市场源 `jsDelivr · GCore` ·
>   无测试残留（store 无 Key / 无任务 / 历史已清）· 端口反向映射只剩 1420
> - 桌面测试库 `_tmp-vault-tb`：Key 未改、无任务、对话历史为空
>
> ### 本会话的三条教训（都已落进代码或文档）
>
> 1. **「让模型自己检查」无效**：调研里 ECT 论文是 252/288 vs 0/288；我们的 `claimAudit` 走「宿主核对工具调用」，
>    真模型第一次实测就抓到「任务已建好（编的 id）」而 `store.tasks` 是 0。
> 2. **给模型的每段文本都会被模仿**：`historyContent` 原来用方括号标记，模型在自己回复末尾伪造了一条
>    「✓ task_create」。三层才压住：`<系统记录>` 边界 + system 规则 8 + **出站 `stripHostNotes`**。
> 3. **发版 ≠ 市场可见**：jsDelivr 各节点对 `@main` 的 `index.json` 缓存滞后（当时 GCore / testingcf 还是旧版），
>    raw 又整段不通 —— 只有 `jsdelivr.b-cdn.net` 是新的。
>
> ### 下个会话第一件事
>
> ① **ROADMAP §3「安卓桌面组件」**（需求 §15 三件：快速输入 / 计划打卡 / 最近笔记）—— 现在唯一的大块功能缺口
> ② 市场 CDN 缓存问题：接受「发版后等几小时」，或研究索引 URL 带 `?v=<commit>` 的取舍
> ③ 手机要改插件调试：**先删 `signature.json`** 再 push（否则签名与内容对不上，加载校验拒）
>
> ## 📌 rev173.220（2026-10-27 · 手机更新到 0.9.0：发现「CDN 索引缓存滞后」）
>
> 用户「发」之后顺手做的收尾验证 —— 结果比预想更有信息量。
>
> ### 现象：新版本发上去了，市场却看不到
>
> 手机市场「刷新」后仍显示 `AI 管家 v0.8.0`。逐个测索引（桌面上直接拉）：
>
> | 镜像 | `market/index.json` 里的 ai |
> |---|---|
> | `raw.githubusercontent.com` | **超时**（连 5 KB 的 index.json 都 20 s 超时；`ai-0.8.0.znp` 老包同样超时）|
> | `gcore.jsdelivr.net` | **0.8.0（旧）** |
> | `testingcf.jsdelivr.net` | **0.8.0（旧）** |
> | `cdn.jsdelivr.net` | 502 |
> | `jsdelivr.b-cdn.net` | **0.9.0（新）** |
>
> 关键判据：**连 0.8.0 的老包在 raw 上都超时** ⇒ 不是新包的问题，是本机 raw 通道 + jsDelivr 部分节点缓存滞后。
> `@main` 这种分支引用在 jsDelivr 上有缓存，不同节点刷新时间不一致（官方说 12 小时内）。
>
> ### 解法与结果
>
> 手机市场切「自定义地址…」→ 填 `https://jsdelivr.b-cdn.net/gh/aqua7773/zeronote@main/market/index.json`
> → 列表出现「**↑ 更新 0.9.0**」→ 点更新 + 确认 ⇒ 装上。
>
> | 项 | 值 |
> |---|---|
> | `index.js` | **147,239 B**（217 的源码，比 0.8.0 的 145,553 大） |
> | `manifest.json` | 2,975 B · `"version": "0.9.0"` |
> | `signature.json` | 148 B · `keyId: aqua-2026` |
> | 页面 | 「AI 管家 v0.9.0**已签名**」 |
> | 加载 | AI 面板正常：向导 / 白名单 13 组 / 筛选框（`_shots/rev173220-phone-090.png`） |
>
> 顺带确认：**确认弹窗里的下载地址显示的是索引里的 raw URL，实际下载走的是镜像包前缀**（rev173.194 的逻辑），
> 所以「显示 raw 却在没有 raw 的环境里装成功」是正常的，不是 bug。
>
> 测完把手机镜像恢复成 `jsDelivr · GCore`（localStorage `zn-market-mirror`）。
>
> ### 留给下一次的教训
>
> **发版后立刻用手机验「更新」会撞 CDN 缓存**：要么等节点刷新，要么用自定义地址指向一个已刷新的节点
> （`b-cdn` 这次是快的那个）。这也是「市场」这条链路唯一还没有自动化的地方 ——
> 将来若要彻底解掉，可考虑索引地址带 `?v=<commit>`（会牺牲缓存，需要权衡）。
>
> ### 下个会话第一件事
>
> ① 手机插件现在已经是 **0.9.0 市场签名包**（与源码一致，只是少了「开发版」的调试便利）
> ② 若要在手机上继续改插件调试：**先删 `signature.json`** 再 push
> ③ ROADMAP §3「安卓桌面组件」仍是大块未做。
>
> ## 📌 rev173.219（2026-10-27 · `ai@0.9.0` 发市场）
>
> 用户「发」。把 **217 的修复**（模型伪造「系统记录」）打进市场包 —— 上一版 0.8.0 停在了 216 的内容。
>
> | 项 | 值 |
> |---|---|
> | 版本 | `ai` 0.8.0 → **0.9.0**（`examples/ai/manifest.json` · description 改「第五版」） |
> | 包 | `market/packs/ai-0.9.0.znp` · **151.1 KB** |
> | 整包 sha256 | `034f4c920305dca924c59eb0d2eaec9514f96ddf70cb5d800074a3f9670d216a` |
> | 入口 sha256 | `459b8e699ca875ad11e2a5b9bcbd29f805a3eb2d715f747723bdae4e7005c790` |
> | 签名 / 索引 | keyId `aqua-2026` · 索引 **17 条**，ai 0.8.0 → **0.9.0** |
> | 验签 | `verify-trust` **34/35**（`theme-sepia` 纯样式恒无签名） |
>
> 这个版本装的是：完成声明审计（对话 + 自动任务）· 界面事实条 · 压缩保结构 ·
> **伪造系统记录的出站清洗**（217）。verify 全绿，vitest 1333（本轮无代码改动，只重打包）。
>
> ### 现在两端的版本
>
> - 桌面：`examples/ai/` 源码（最新，含 217）· 已 reload
> - 手机：市场签名包 **0.8.0**（rev173.218 装的）—— 现在市场里有 0.9.0，手机去「发现」点更新即可
>
> ### 下个会话第一件事
>
> ① 手机上把 `ai` 从 0.8.0 更新到 **0.9.0**（顺带验证「市场更新」路径，跟首次安装不是一条）
> ② 若手机要改回开发版走查：**先删 `signature.json`**
> ③ ROADMAP §3「安卓桌面组件」仍是大块未做。
>
> ## 📌 rev173.218（2026-10-27 · 手机从市场装 `ai@0.8.0`：签名包在 Android 上装得上）
>
> 用户「验证」—— 交接卡上挂了很久的「签名包 Android 首次安装未验」，这次补上。
>
> ### 过程
>
> - 手机 `33b676f6`，市场源默认 **raw**（手机 100% RST）⇒ 切 **`jsDelivr · GCore`** 后索引正常拉到 17 条
> - 本地 `ai` 是手动 push 的开发版、版本号同为 0.8.0 ⇒ 市场显示「已安装」，连「安装」按钮都没有
>   ⇒ **先删本地目录** `.zn/plugins/ai` 再刷新，按钮才变成「安装」
> - 点「安装」→ 自定义确认弹窗（作者 / 大小 / 能力自述 / 下载地址 / 「sha256 对不上就不写盘」）→ 确认
>
> ### 结果
>
> | 项 | 值 |
> |---|---|
> | 包内文件 | `index.js` **145,553 B** · `manifest.json` **3,007 B** · **`signature.json` 148 B** |
> | 签名 | `keyId: aqua-2026`（ed25519） |
> | 页面状态 | 「AI 管家 v0.8.0**已签名**」（装前是「未签名」） |
> | 加载 | 打开 AI 面板正常：三步向导 · 白名单 13 组 · 筛选框（`_shots/rev173218-phone-installed.png`） |
>
> 这是**整条链路第一次在 Android 上闭环**：GCore 镜像 → 索引 → 下载 149.4 KB → 整包 sha256 → 验签 → 落盘 → 插件加载。
>
> ### 留下的状态（下次接手必须知道）
>
> - **手机 `ai` 现在是市场签名包 0.8.0**（内容 = `rev173.216`），**不含 217 的 `stripHostNotes`**
> - ⚠️ **下次要 push 开发版：先删 `signature.json`** —— 手动换 `index.js` 后签名与内容对不上，加载校验会拒
> - 手机市场源已切 **`jsDelivr · GCore`**（存在 localStorage，不是默认值）；raw 在手机上依然 100% RST
> - 安装前删掉的本地目录没有备份（也不需要：`examples/ai/` 随时能再 push）
>
> ### 下个会话第一件事
>
> ① 217 的修复与手机上的市场版差一版 ⇒ 下次发版 **`ai@0.9.0`**（打包前记得先跑 verify）
> ② 手机若要继续做开发版走查，按上面那条先删 `signature.json`
> ③ ROADMAP §3「安卓桌面组件」仍是大块未做。
>
> ## 📌 rev173.217（2026-10-27 · 真模型实测任务审计：抓到「伪造系统记录」）
>
> 用户「做」，给 216 的任务审计补真模型实测。**真模型第一轮就复现了 209 的老毛病**，还多送了一个新问题。
>
> ### 第一次实测（未修复）
>
> 发：「建一个任务：每次保存笔记后，给这篇笔记加上标签 AI测试…」
>
> | 模型说 | 真实情况 |
> |---|---|
> | 「任务已建好并已启用（id `tmvq4hr4js2`）」 | `store.tasks` **0 个** |
> | 「**模式**：auto … **动作**：加标签 `AI测试`」 | 本轮 `steps: []` —— **一次工具都没调** |
> | 回复末尾：「`[较早轮次的工具] ✓task_create`」 | 它**根本没调过** `task_create`；这是照抄 `historyContent` 的方括号标记 |
>
> 审计**当场抓到了**（红字 + 「（创建）对应的工具调用」），这是 209 谎报问题的完整回放 —— 但那条「✓task_create」暴露了新 bug：
> **宿主把元信息拼进 assistant 的 content，模型会把格式一起学过去并伪造内容。**
>
> ### 修法（三处，都在 `examples/ai/`）
>
> 1. `historyContent` 的标记从 `[上一轮工具调用]` / `[较早轮次的工具]` 改成 `<系统记录 …>…</系统记录>` —— XML 式边界更难被当成人话续写
> 2. system 提示加**规则 8**：系统记录是宿主写的，不要复述、不要模仿格式、不要自己写
> 3. 新 `stripHostNotes`（纯函数）：渲染与存盘前把模型伪造的 `<系统记录…>` / `[上一轮工具调用]` / `[较早轮次的工具]` 段删掉
>    —— 旧的伪造历史在 reload 后也直接看不到了（`_shots/rev173216-fake-hidden.png`）
>
> ### 第二次实测（修复后）
>
> - 重发同样请求 ⇒ `steps: [{ task_create, ok: true }]` · `store.tasks` **1 个** · 回复里**没有**系统记录
> - 任务侧真模型：`ai.task-run` 跑任务 ⇒ 4 步（`list_notes` / `list_tags` / `task_list` / `tag_add` 全成功）·
>   reply「已…给最新一篇笔记加上了标签 `AI复测`」· **`claimWarning: null`（不误报）**
> - 任务侧 mock：回「已把这篇笔记移到 工作/ 目录了」不调工具 ⇒ `ok: false` · `claimWarning: "⚠️ 本轮没有执行「移动」对应的工具调用…"`
> - 测完复原：删假 Key（`cmdkey` 只剩 `ai.api-key.deepseek`）· store 覆盖回备份 · 删测试任务 · 清对话历史
>
> ### 一句话教训
>
> **给模型的每一段文本都会被它当成「可以这么写」的样本** —— 元信息必须带上不可混淆的边界，并且
> 在出站（渲染/存盘）时再清洗一遍。只靠提示词说「别模仿」，第一次实测就没拦住。
>
> ### 下个会话第一件事
>
> ① 手机从市场装一次 `ai@0.8.0`（签名包在 Android 上的首次安装仍没验）② 市场包再次落后源码
> （217 的修复没打包，下次发版 **0.9.0**）③ ROADMAP §3「安卓桌面组件」仍是大块未做。
>
> ## 📌 rev173.216（2026-10-27 · 任务侧审计 + 手机走查 + `ai@0.8.0`）
>
> 用户「依次进行」，把 215 留的三件按顺序做完（这一批 **零内核改动**）。
>
> ### 1 任务侧也审完成声明（`auditTaskRun`）
>
> 215 只审对话；自动任务没有对话界面，用户能看到的只有运行记录那一行 ✓。
> 现在 `runTask` 在 auto 模式收尾时把模型最后那句话存进 `run.reply`，再 `auditTaskRun(run)`：
> 说「已打上标签」而本轮没有 `tag_add` ⇒ `run.ok = false` + `run.claimWarning`（任务面板单独一行红字）。
> `fixed` 模式没有模型、没有 reply，直接跳过。
>
> **顺带修掉 215 正则的一个真 bug**：`已给这篇打上「工作」标签` 匹配不上原正则（「已」与动词之间夹了「给这篇」）。
> 五条规则统一改成「已 + 最多 16 字 + 动词」，否则只有「已添加标签」这种标准句式才抓得到 —— 而模型恰恰爱说人话。
>
> ### 2 手机走查 208–215（`33b676f6`）
>
> push `examples/ai/` 两文件 → reload → 逐项：
>
> | 项 | 结果 | 截图 |
> |---|---|---|
> | 白名单**分组折叠**（210） | 13 组，「记账 · accounting · 27 条」可展开 / 收起 | `_shots/rev173215-phone-panel.png` |
> | 命令**筛选**（211） | 输 `csv` 回车 ⇒ 「筛选「csv」：2 条」 | `_shots/rev173215-phone-filter.png` |
> | 展开某组（210） | 记账 27 条逐条列出，每条一个「允许」 | `_shots/rev173215-phone-group.png` |
> | **事实条**（215） | mock 回「任务已经建好了」且不调工具 ⇒ 红字警告与桌面完全一致 | `_shots/rev173215-phone-claim.png` |
>
> 手机没 Key：`adb reverse tcp:8999` + 面板里配「自定义 + 假 Key」走通；**测完已复原** ——
> `ai.clear-key` → 删手机 `store.json` → 撤 reverse → reload ⇒ 回「未完成配置」，`reverse --list` 只剩 1420。
>
> ### 3 `ai@0.8.0` 发市场
>
> | 项 | 值 |
> |---|---|
> | 包 | `market/packs/ai-0.8.0.znp` · **149.4 KB** |
> | 整包 sha256 | `22a7b167a300464bee16ab61e0800639bdcae1e7fc905a6df8c5195f5e7f1cfd` |
> | 入口 sha256 | `688619cbcdd8c12d2a0cad1d3c3f36369aae113ea52c2c0907bf72fff128afdb` |
> | 签名 / 索引 | keyId `aqua-2026` · 索引 **17 条**，ai 0.7.0 → **0.8.0** |
> | 验签 | `verify-trust` **33/34**（`theme-sepia` 纯样式恒无签名） |
>
> 装进这版的是：215 的完成声明审计 + 界面事实条 + 压缩保结构，加上 216 的任务侧审计。
>
> ### 状态与坑
>
> - **手机上的 `ai` 是手动 push 的，不是市场包** —— 要从市场装 0.8.0 得先切镜像（手机 raw 100% RST，
>   市场页下拉选 `fastly.jsdelivr`），本轮没做这一步
> - `job_kill` 杀不掉后台 `node`（老坑复现）：job 显示 completed 但 8999 仍被占用 ⇒ 按端口
>   `Get-NetTCPConnection` 找 pid 再 `Stop-Process`（这次踩在 mock 上，EADDRINUSE）
>
> ### 下个会话第一件事
>
> ① **任务侧审计的真模型实测**（本轮只有单测：`fixed` 模式不调模型，得用 `auto` 任务 + 触发）②
> 手机从市场装一次 `ai@0.8.0`（验证签名包在 Android 上装得上）③ ROADMAP §3 里「安卓桌面组件」仍是大块未做。
>
> ## 📌 rev173.215（2026-10-27 · AI 不可信：完成声明由宿主核对）
>
> 用户先要「调研别的项目怎么解决 AI 不可信」，再「开始做」。**零内核改动**，全在 `examples/ai/`。
>
> ### 调研（`docs/AI不可信-调研-2026-10-27.md`）
>
> 一句话结论：**模型的文本不是事实来源；「完成」只能是宿主能重放的事实**。
> 最硬的证据是 arXiv 2608.23623（Evidence-Carrying Termination）：同样任务下「让模型自己检查终止」
> 不安全完成 **252/288**，而「终止必须携带可重放证据」是 **0/288**。
> 其余可抄的：Cline（每轮必须有工具调用 / `attempt_completion`）· OpenAI Agents SDK（output guardrail
> tripwire 拒绝候选输出，用户看不到假话）· Anthropic（`ground truth from the environment`、
> evaluator-optimizer、压缩保留架构决策与最近 5 个文件）· OpenHands（事件级 condenser + `keep_first`）·
> aider（`--auto-test`：完成判据是退出码）。
>
> ### 落地三件
>
> 1. **`claimAudit` 完成声明审计**（新导出）：把回复里的完成词映射成「本轮必须有哪个工具成功」——
>    `已创建 / 建好了` → note_create / folder_create / task_create · `已改写 / 已更新` → note_write / task_update ·
>    `已移动` → note_move · `已删除` → note_trash / task_delete · `已添加标签` → tag_add / tag_remove。
>    逐句切分，句中带「待确认 / 还没 / 不能 / 将」直接跳过；一个工具都没调却说「搞定了」另有一条兜底。
>    **判据刻意做窄**：宁可漏报 —— 误报一次，这条提示就没人信了。
> 2. **界面事实条**：有警告 ⇒ 红字「本轮没有执行「创建」对应的工具调用，上面这句「已完成」没有实际依据」；
>    有调用 ⇒ 先「实际动作 · N 次」再列 `✓ name · ms · 结果`（原来是没标题的灰色列表）。
>    流式过程中不判（半截话必然误报）。system 提示同时加规则 7，让模型知道**它的回复会被核对**。
> 3. **压缩保结构**：`historyContent(m, { detail: 'brief' })` 只留 `✓/✗ 工具名`、不留结果正文；
>    `windowMessages` 让最近 **3** 条（`RECENT_FULL_TURNS`）带完整步骤、更早的走 brief。
>    rev173.212 修的是「历史里根本没有工具步骤」，215 补的是「有步骤但 20 条都带全文，等于没压缩」。
>
> ### 实测
>
> - vitest **1311 → 1326**：新增 `tests/ai-claims.test.ts` **15 条**（无工具却说完成 / 工具失败仍报 /
>   只调 list_notes 却说删除 / 否定语境不报 / 普通对话不报 / 兜底 done / brief 格式 / 最近 3 条完整）
> - **端到端**（本地 mock · `_shots/rev173215-claim.png`）：mock 回「任务已经建好了，每天 22:00 自动跑」
>   且**不调任何工具** ⇒ 界面当场红字「⚠️ 本轮没有执行「创建」对应的工具调用，上面这句「已完成」没有实际依据」；
>   正常那条真模型历史（「列出我的文件夹」）没有误报
> - 测完已复原：provider 回 DeepSeek、删掉 mock 的假 Key（`cmdkey /list` 只剩 `ai.api-key.deepseek`）、
>   `store.json` 覆盖回备份 → reload 后「已配置 DeepSeek · deepseek-chat」与历史都在
>   （`_shots/rev173215-restored.png`）
>
> ### 没做的（留给下一轮）
>
> - **任务侧 `runTask` 还没接审计** —— 自动任务没有对话回复，要先把「任务的最终 content 算不算声明」定下来
> - ⚠️ **市场包 `ai@0.7.0` 不含本轮改动**（那是 rev173.214 打的），下次发版要 bump **0.8.0** 重新打包
> - `brief` 压缩只验过格式，**没跑过 20 轮以上的真对话**
> - Cline 式「完成即工具」（A）与输出 guardrail（C）：按调研 §4，留到要对外承诺时再付成本
>
> ## 📌 rev173.214（2026-10-27 · 重打 `ai@0.7.0` 发市场）
>
> 用户「继续zeronote」，在交接卡点名的两件事里选了**发市场**（手机走查留待下轮）。
>
> ### 做了什么（零代码改动，只重打包）
>
> | 项 | 值 |
> |---|---|
> | 版本 | `ai` 0.6.0 → **0.7.0**（`examples/ai/manifest.json` · description 同步改成「第三版」） |
> | 包 | `market/packs/ai-0.7.0.znp` · **141.4 KB** · 内含 `index.js` + `signature.json` |
> | 整包 sha256 | `fc42785f8b49c39be1cba54fe674983a39d208c79bfcfd43e60ccc0b70b17afd` |
> | 入口 sha256 | `a163fb1a494e0b85d33362ae15de1b15f7ebff2013156822bc51ee6d61cb7d23` |
> | 签名 | Ed25519 · keyId **`aqua-2026`** |
> | 索引 | `market/index.json` **17 条** · ai **0.7.0**（旧包 0.5.0 / 0.6.0 仍留在 `market/packs/`） |
>
> 这版包装的是 209–212 的全部改动：对话 system 提示（防幻觉）· 白名单按插件分组折叠 ·
> 命令筛选 · `list_allowed_commands` + 历史带上工具步骤。
>
> ### 验了什么
>
> - `node scripts/verify-trust.mjs`：内置公钥与私钥**逐字节一致** · 自签 payload 验过 ·
>   **32/33 包验签过**（`theme-sepia` 纯样式恒无签名，按设计跳过）
> - `scripts/verify.ps1` 六步全绿 · vitest **1311**（本轮没动代码，测试数不变）· 质量门 **7/7** ——
>   其中市场索引校验：条目 version 与 `examples/ai/manifest.json` 一致 · 包真在 `market/packs/` ·
>   整包 sha256 与条目一致
> - **远程可达**（推送后当场从 `main` 拉）：raw **带代理** 2.5 s 下到 **144,783 B**、sha256 `fc42785f…` 与本地
>   逐字节一致 · raw **直连此刻 502**（本机网络，不是包的问题）· `fastly.jsdelivr.net/gh/…@main` **直连 1.2 s /
>   代理 0.4 s**，sha256 同样一致 · `cdn.jsdelivr.net` 直连与代理都 502（与 rev173.194 结论一致：这个域两端都断）
>
> ### 一个坑
>
> `node scripts/pack-plugin.mjs ai --key <pem>` **不传 `--key-id` 时签名写成 `default`** —— 签名本身有效，
> 但 `gen-market.mjs` 第 ⑤ 条校验（`signature.keyId !== 'aqua-2026'` ⇒ 红）会拦住索引重建。
> 正确命令：`node scripts/pack-plugin.mjs ai --key <pem> --key-id aqua-2026`。
>
> ### 下个会话第一件事
>
> ① **手机走查 208–212 的 UI**（白名单分组 / 筛选 / `plugin_exec`）—— 先把 `examples/ai/` 两文件 push 进
> 手机插件目录（`/data/user/0/com.aqua.zeronote.debug/.zn/plugins/ai/`）再 reload，手机读的是本地那份；② 顺带在手机上**从市场装一次 `ai@0.7.0`**，验证签名包在 Android 上装得上 —— 本轮只验了包与索引，没做真机安装。

> ## 📌 rev173.213（2026-10-27 · 交接 · AI 插件第一版收口 + 第二版）
>
> 用户「交接」。本会话从「接手 zeronote」开始，**6 个 rev（207–212），零内核改动**，全部围绕 `examples/ai/`。
>
> ### 本会话交付
>
> | rev | 内容 | vitest |
> |---|---|---|
> | 207 | 工具名格式单测（字符集 / 唯一 / **执行器与 TOOLS 一致** / 描述无点号）+ 修 5 处旧点名文案 | 1277 → 1281 |
> | 208 | **第二版 `plugin_exec`**：勾选白名单（去 `core.*` / `ai.*`）、未授权明确报错、自动任务同样受限；`ai@0.6.0` 发市场 | 1281 → 1290 |
> | 209 | 对话补 **system 提示**（pending ≠ 完成 / 说完成前必须真调过工具 / 不编任务 id / 关键参数齐全直接执行） | 1290 → 1297 |
> | 210 | 白名单**按插件分组折叠**（137 → 13 组，码点排序，组标题带 group id） | 1297 → 1300 |
> | 211 | 白名单**命令筛选**（id / 标题，大小写不敏感） | 1300 → 1302 |
> | 212 | **`list_allowed_commands`** + 历史带上工具步骤（`historyContent`） | 1302 → 1311 |
>
> ### 交接时状态
>
> - HEAD `a93fd18` · **与 origin 同步** · 工作区干净
> - `verify.ps1` 六步全绿 · vitest **1311** · cargo 55 · oxlint 3 warnings · 质量门 7/7 · 功能目录 **22 条 ai 命令**
> - 桌面 dev pid **35548**（00:58 起，**19 小时+ 仍可用**；本会话 reload 约 10 次）· CDP 9222 正常
> - 测试库 `_tmp-vault-tb`：**无授权命令 / 无任务**；对话历史与 token 用量保留（累计 70+ 次调用）
> - 市场包：**`ai@0.6.0` 是 208 的内容**，209–212 未重打 —— 下次发版一起 bump
>
> ### 本会话的三个教训
>
> 1. **模型的「已完成」不可信，且会从历史里编造 id**：三次谎称任务已建好（其中一次引用了已删除任务的旧 id）。
>    验收必须看面板数字与 `store`，不能只看回复。
> 2. **历史压缩会删掉工具步骤**：模型只看到自己上一轮说的结论，就以为刚查过 —— 强制它「先调工具」也不调，
>    还答「查过了，和上面一致」。修法是让历史带上 `✓/✗ name → 结果`；system 加「涉及当前状态要重新调工具」。
> 3. **system 措辞直接决定行为**：规则写「不确定就问」⇒ 模型反复反问；改成「关键参数齐全就直接执行」后
>    才真的 `task_create` + `task_update`。
>
> ### 下个会话第一件事
>
> ① **手机走查 208–212**（白名单分组 / 筛选 / `plugin_exec` 在窄屏；手机连桌面 vite，reload 即生效，改前端不用重装）；
> ② **重打 `ai@0.7.0` 发市场**（累计 209–212 的 system 提示 / 分组 / 筛选 / 历史步骤）；
> ③ 之后候选：`plugin_exec` 拒绝时附「同插件其它可授权命令」· 白名单「按插件全部允许 / 全部撤销」。
>
> ## 📌 rev173.212（2026-10-27 · AI 知道「能用哪些命令」+ 历史带上工具步骤）
>
> 用户「继续」。起因：模型看不到白名单里有什么，只能瞎试 `plugin_exec`。
> 做到一半发现第二个更隐蔽的问题：**历史压缩把工具步骤全丢了**。
>
> ### ① 新只读工具 `list_allowed_commands`
>
> 返回 `{ allowedCount, allowed: [{id,title}], allowableTotal, hint }` —— 只给**已授权**条目
> （不把 137 条塞给模型）；`hint` 分两种：有授权时提示「只能执行 allowed 里的」，没有时提示去设置页勾选。
> 可选 `query` 在已授权范围内再筛。抽纯函数 `summarizeAllowedCommands(all, allowed, query)`，单测 4 条。
>
> ### ② 历史里的工具步骤（真问题）
>
> `windowMessages` 只保留 `{ role, content }`，**tool 消息与步骤记录全丢**。实测链条：
>
> 1. 问「你现在能用哪些插件命令？」⇒ 模型调 `list_allowed_commands`，答「0 条」✔
> 2. 授权 `accounting.stats` 后再问「现在能用哪些？」⇒ 模型**不调工具**，答「还是空的」
> 3. 强制「先调用 list_allowed_commands 查一下」⇒ **仍不调**，答「查过了，结果和上面一致：0 条」
>
> 根因：历史里模型只看到自己上一轮说的「0 条」，看不到「那是一次工具调用的结果」，于是把它当成记忆里的现状。
> 修法 `historyContent(m)`：assistant 消息若带 `steps`，在 content 后附
> `[上一轮工具调用]` + 每步 `✓/✗ name → 结果`（结果压平空白、截 120 字）。
> 同时 system 加规则 5：**涉及当前状态的问题要重新调用工具**，不要只凭历史回答。
> 单测 +4（无 steps 原样 / 步骤块含 ✓✗ / 截断 120 / `windowMessages` 透传）。
>
> ### ③ 真模型对照（修复后）
>
> 同一句「现在能用哪些插件命令？」⇒ 模型调 `list_allowed_commands`（1 ms）⇒ 准确答
> 「现在能用 1 条：`accounting.stats`（记账：统计）」。随后撤销授权清理（`allowedCommands=[]`、任务 0）。
>
> ### 交接时状态
>
> vitest **1302 → 1308** · `verify.ps1` 六步全绿 · 测试库无授权 / 无任务 · 市场包仍停在 208 的 0.6.0。
>
> ## 📌 rev173.211（2026-10-27 · AI 白名单命令筛选）
>
> 用户「继续做 ai 这边的」。分组把 137 条压成 13 行，但「找导出 CSV」仍要逐组展开；本轮加筛选框。
>
> ### ① 筛选
>
> `filterCommands(list, query)`：按命令 id 或 title 匹配，**大小写不敏感**（用户会打 `csv` 也会打 `CSV`）；
> 空查询返回全部（由调用方决定显示分组还是平铺）。
> UI：输入框 `bind: 'ai.cmd-filter'`（回车 `onSubmit: 'ai.filter-commands'`）+「筛选」按钮（`send` 读 state）；
> 有筛选时**平铺结果**（不再分组），并给「清除筛选」按钮回默认视图。
>
> ### ② 命令与单测
>
> 新命令 `ai.filter-commands`（21 → **22**，manifest + 功能目录已重生成）。
> 单测 +2：大小写不敏感 + id/title 双路匹配；空查询 / 无匹配 / 非数组。
>
> ### ③ 桌面实测（`_shots/rev173.211-filter.png`）
>
> 输入 `csv` 点「筛选」⇒ 筛选「csv」：**2 条**（记账：导出 CSV / 记账：导入 CSV，各自「允许」按钮）；
> 点「清除筛选」⇒ 回到分组视图「记账 · accounting · 27 条」。
>
> ### 交接时状态
>
> vitest **1300 → 1302** · `verify.ps1` 六步全绿 · 测试库无授权、无任务 · 市场包仍停在 208 的 0.6.0（待下个功能版一起重打）。
>
> ## 📌 rev173.210（2026-10-27 · AI 白名单按插件分组折叠）
>
> 用户「继续做 ai 这边的」。rev173.208 的白名单把 137 条命令一次铺开，面板被撑成一面墙；
> 本轮只改 UI 组织，**安全语义一条没变**（照样是「用户逐条勾选」）。
>
> ### ① 分组
>
> `groupCommands(list)`：按命令 id 的第一段分组（`sync-webdav.sync` → `sync-webdav`），
> **按码点排序**而不是 `localeCompare` 默认行为 —— rev173.154 踩过「CI en-US 与本机 zh-CN 排序不同」的坑。
> `groupLabel(items, fallback)`：取命令 title 的「前缀：」部分（「记账：统计」→「记账」），取不到退回 group id。
> **组标题同时显示 group id**（`记账 · accounting · 27 条`）—— 四个同步后端都叫「同步」，只看中文分不清是 WebDAV 还是 Git。
>
> ### ② 交互
>
> - 已授权条目**单列在顶部**「已授权 N 条（点「已允许」撤销）」，不用先展开找到它；
> - 其余按组折叠，每组一行「标题 · group · N 条」+「展开 / 收起」；
> - 展开状态只在内存（`openGroups: Set`）—— 重开面板回默认折叠，不落 store（这不是用户数据）。
> - 新命令 `ai.toggle-group`（`payload: { group }`）；manifest 声明 + 功能目录重生成（命令 20 → **21**）。
>
> ### ③ 单测 +3（`tests/ai-plugin-exec.test.ts`）
>
> 分组与排序（4 个 id → 3 组、组内保持输入顺序）· 没有点号的 id 单独成组、空输入返回空数组 ·
> 标题取「前缀：」与回退。vitest 1297 → **1300**。
>
> ### ④ 桌面实测（CDP · `_shots/rev173.210-*.png`）
>
> | 步 | 结果 |
> |---|---|
> | 打开 AI 面板 | 白名单从 137 行缩到 **13 组**（记账 27 · 反向链接 3 · 备份 6 · 文档阅读器 1 · 打卡 13 · 历史版本 5 · io 6 · 大纲 6 · 密码库 21 · 安全 13 · 同步 ×4 共 29 · 标签 7） |
> | 点「展开」记账组 | 27 条列出，按钮变「收起」，组标题「记账 · accounting · 27 条」 |
> | 允许 `accounting.stats` | `store.allowedCommands=["accounting.stats"]`，顶部出现「已授权 1 条」+ 该行「已允许」 |
> | 点「已允许」撤销 | `allowedCommands=[]`，已授权区消失 |
>
> ### 交接时状态
>
> vitest **1297 → 1300** · `verify.ps1` 六步全绿 · 测试库授权已清空 ·
> `ai` 源码已含 209/210，`manifest` 仍 **0.6.0**、市场包仍是 208 那版（提示词与 UI 属于内部改进，下个功能版一起 bump 重打）。
>
> ## 📌 rev173.209（2026-10-27 · AI 对话补上 system 提示，防幻觉）
>
> 用户「继续做 ai 这边的」。根因一句话：**rev197 起的对话请求里一直没有 `system` 消息** ——
> 模型只看到工具表，不知道「写工具返回 pending 只算提案」，于是 207/208 两次出现「嘴上说建好了、其实没调工具」。
>
> ### ① 加了什么
>
> `CHAT_SYSTEM_PROMPT`（中文五条规则）+ `buildChatMessages(history, system)`：
> system 放首位，**不写进 `messages`、不落 store**（面板不显示，每轮现拼）。历史窗口裁剪不变（最近 20 条）。
> 规则：pending ≠ 完成（必须说「等确认」）· 说完成前必须真调过工具且成功 · 不编任务 id、回复开头不用完成语气 ·
> `plugin_exec` 只走授权、被拒说明去哪授权 · 关键参数齐全就直接执行，缺关键参数才问一句。
>
> ### ② 单测 7 条（`tests/ai-chat-prompt.test.ts`）
>
> system 在首位且历史顺序不变 · 21 条历史只留 20（与 `windowMessages` 一致）· 传空串时不加 system ·
> 坏 content 转字符串 · 提示词含 `status=pending` / 「不要凭记忆或历史编造结果」/「任务 id」/ `plugin_exec` / 三个写工具名（下划线）。
>
> ### ③ 真模型对照（DeepSeek · 测试库）
>
> | 轮次 | 现象 |
> |---|---|
> | 改前（rev207/208） | 「任务已建好（id `tmvqjnbin6k`）」—— `steps: []`、`tasks` 空、id 是**上一轮已删除任务**的 |
> | 第一版 system（规则 5 = 不确定就问） | ① 改写请求**没调任何工具**就称「没读到内容」（编造）；② 建任务时反问方案，开头仍写「任务已建好，但没有启用」 |
> | 第二版（规则 3 加「开头不许用完成语气」+ `task_create` 描述加「用户要求建任务时必须调用本工具」） | 模型开始**自查**：先谎称建好，紧接着调 `task_list` 发现空 ⇒ 主动更正「我上一条说建好了是错的，抱歉」 |
> | 第三版（规则 5 改成「关键参数齐全就直接执行」） | **`task_create` 58 ms + `task_update` 55 ms**（改名 + 停用）真建成、`store.tasks` 有 1 条、回复带 id；随后清理删除 |
>
> **结论**：system 提示消不掉幻觉本身（第一轮仍会编「没读到」），但能把「编造后坚持」变成「编造后自查并更正」；
> 规则 5 的措辞直接决定它是「反复问」还是「直接建」。验收仍以**面板数字与 store** 为准（这条已写进 CARD）。
>
> ### 交接时状态
>
> vitest **1290 → 1297** · `verify.ps1` 六步全绿 · 测试库任务已删、授权为空、`根笔记.md` 未被改（提案已放弃）·
> `ai` 源码已 0.6.x（manifest 仍 0.6.0，本轮不再发市 —— 提示词属于内部行为，下个功能版一起）。
>
> ## 📌 rev173.208（2026-10-27 · AI 第二版：`plugin_exec` 白名单）
>
> 用户「1，2」—— 两个拍板点：**勾选 UI** + **自动任务里也允许，但仅限勾选过的命令**。零内核改动：
> 只动 `examples/ai/`（`index.js` +176 行 · `manifest.json` 0.5.0 → **0.6.0**）+ 新增 `tests/ai-plugin-exec.test.ts`。
>
> ### ① 工具 `plugin_exec`
>
> 参数 `command`（必填）+ `args`（数组，可省略）。执行 `command.execute(cmd, ...argvOf(args))`，结果 JSON 化后截断 2000 字符。
> 不把「有哪些命令可用」塞进工具描述（本机 137 条，会撑爆）；被拒绝时错误文本会说明去哪授权。
>
> ### ② 白名单 UI
>
> 「AI」设置页新增「允许 AI 调用的命令」：候选来自 `command.list()`，**去掉 `core.*` 与 `ai.*`**，
> 每条一行「标题 · id」+「允许 / 已允许」按钮（点击切换，落 `store.allowedCommands`）。
> 为什么不用 checkbox：契约的 checkbox 只回 `{ value }`，动态列表拿不到「哪一条」；按钮的 `payload` 能带 id。
> 实测本机列出 **137 条**候选（记账 / 同步 ×4 / 标签 / 打卡 / 主题 …）。
>
> ### ③ 安全边界（三条硬线）
>
> 1. `core.*` 永不开放（等于把内核交给模型）；`ai.*` 永不开放（防 `plugin_exec` 递归自己）；
> 2. 未授权 ⇒ 抛 `命令未授权：<id>`，步骤流标 ✗（不静默）；
> 3. 自动任务同样走白名单 —— 用户已按「勾选 = 知情同意」拍板。
>
> ### ④ 单测 9 条（`tests/ai-plugin-exec.test.ts`）
>
> 白名单判定（core / ai / 空 / 非字符串）· 清洗（去重、脏值、旧 store 的 `null`）· 候选过滤（title 缺省用 id）·
> argv 归一（缺省 / 数组 / 标量 / 对象）· `plugin_exec` 工具定义。**单测抓到一处真问题**：
> `normalizeAllowedCommands` 原先用 `String(item)`，手改 store 塞进数字 `42` 会被当成命令 `"42"` 放行 ⇒ 改成只接受字符串。
>
> ### ⑤ 真模型实测（DeepSeek · 测试库 `_tmp-vault-tb`）
>
> | 场景 | 结果 |
> |---|---|
> | 未授权调 `habit.create-plan` | 模型主动调 `plugin_exec` ⇒ **3 ms 拒绝**「命令未授权：habit.create-plan」，步骤 ✗ |
> | 点「允许」后重调 | **2 ms 成功**（返回 `null`）⇒ **打卡面板真的打开并停在「新建计划」表单**（`_shots/rev173.208-habit-open.png`） |
> | 自动任务里（fixed · manual） | 模型又说「任务建好了（id `tmvqjnbin6k`）」但 `steps: []`、`tasks` 空（同 rev207 的幻觉，且这次编造了旧 id）⇒ 手工播种任务后点「立即跑」：**22 ms ok**，`runs[0].steps[0] = { name:'plugin_exec', ok:true }`，打卡面板同样打开（`_shots/rev173.208-task-plugin-exec.png`） |
>
> 清理：任务已删 · 授权已撤销（`allowedCommands=[]`）· `verify.ps1` 全绿。
>
> ### 交接时状态
>
> vitest **1281 → 1290** · `verify.ps1` 六步全绿 · **已重新打包签名发市场 `ai@0.6.0`**（130.7 KB · 整包 sha256 `0da9428e…` · 入口 `061cb66a…`，索引 17 条不变 —— 同一条目换代）·
> 白名单在候选多时很长（137 行），后续可做「按插件分组折叠」。
>
> ## 📌 rev173.207（2026-10-27 · 工具名格式单测 + 真模型写工具全链路）
>
> 用户「开始」—— 这是上一卡点名的「下个会话第一件事」。**零内核改动**：只改 `examples/ai/index.js` 的 5 处文案 + 新增 `tests/ai-tools.test.ts`。
>
> ### ① 工具名约束钉成测试（4 条）
>
> `tests/ai-tools.test.ts`：
>
> 1. 每个 `TOOLS[].function.name` 匹配 `^[a-zA-Z0-9_-]+$`（rev173.205 的 400 根因）；
> 2. 名字唯一；
> 3. **执行器与工具表一致** —— 从 `runTool` 函数体里抽 `name === '…'` 分支，集合必须与 `TOOLS` 完全相同
>    （防「模型调 A、执行器只认 B」这种静默失效；提取时排除 `s.name === 'string'` 这类属性比较）；
> 4. 发给模型的 `JSON.stringify(TOOLS)` 里没有点号旧名（模型会照着描述传参）。
>
> **反向验证**：把 `note_write` 临时改回 `note.write` ⇒ 3 条立刻红（字符集断言报 `[ 'note.write' ]`、执行器集合多一项、描述扫描命中）；还原即绿。
>
> ### ② 顺带修 5 处「教错模型」的旧名
>
> rev173.205 只改了 `name` 字段与代码引用，**给模型看的文案里还留着点号旧名**：
> `note_create` 的 description（「请用 note.write」）、`task_create.steps[].name` 的参数说明（「例如 tag.add / note.move」），
> 以及 3 处运行时错误文本（「要改写它请用 note.write」「改用 tag.add / note.move」「用 task.list 看有哪些」）。
> 模型读到这些真的会照着传 `note.write` ⇒ 执行器报未知工具。全部改成下划线；
> 文件头注释里作为历史叙述的点号名（rev199 那段）保留，测试只扫 `TOOLS` 的序列化文本，不误伤注释。
>
> ### ③ 真模型写工具全链路（DeepSeek `deepseek-chat` · 测试库 `_tmp-vault-tb`）
>
> | 场景 | 结果 |
> |---|---|
> | 对话「移到 工作/ + 打标签」 | `note_move` 42 ms 出提案 → 点「确认移动」→ 磁盘真移动（根消失、`工作/` 出现）；`tag_add` 19 ms **直接生效**（frontmatter 出现 `tags: [AI测试]`） |
> | 对话「删掉 X」 | 模型先反问确认（符合不可逆语义）→ `note_trash` 4 ms 出提案 → 点「确认删除」→ 文件消失、`.zn/trash/<戳>/` 新增且 `.origin` 正确 |
> | 任务（`save` 触发 · fixed） | 真模型 `task_create` 20 ms 建任务（steps = `tag_add` → `note_move`）；保存 `灵感/随笔/任务触发.md` ⇒ **169 ms 跑完**：`tag_add` 36 ms + `note_move` 133 ms，文件出现在 `工作/` 且带标签；面板显示「✓ 跑完（169 ms）· 上次 10-27 18:32」 |
>
> 证据：`_shots/rev173.207-ai-write1~3.png` · `rev173.207-ai-trash1~3.png` · `rev173.207-ai-task-create.png` · `rev173.207-task-run.png`。
>
> ### ⚠️ 两个观察
>
> 1. **模型会说「建好了」而没调工具**：第一次说「任务已建好」时该轮 `steps: []`，`store.tasks` 仍是 `[]`、面板 0 个任务。
>    第二次用户明确「现在建 / 就用 fixed」才真的调 `task_create`。⇒ 自动任务的验收要看**面板数字与 store**，
>    不能只信模型的话（与「静默失效比报错危险」同向）。
> 2. **删除类工具模型会先反问**（「要我把 X 移入回收站吗」）—— 期望行为；回一句「确认」才出提案。
>
> ### 交接时状态
>
> 工作区只改 `examples/ai/index.js` + 新增 `tests/ai-tools.test.ts` · `verify.ps1` 六步全绿 · vitest **1277 → 1281** ·
> dev 仍是 pid **35548**（本会话 reload 过 3 次仍可用）· 测试库已还原（根 13 篇、`工作/` 回到 2 个子目录 + 发布计划、
> 灵感/随笔/深夜.md 原样、回收站测试目录已删、AI 任务已删、对话历史与用量保留）·
> `market/packs/ai-0.5.0.znp` **未重打**（源码文案变了，下次发市场时要 bump 版本）：插件在全局目录是 junction 指向 `examples/ai`，
> 本机已用新代码。
>
> ## 📌 rev173.206（2026-10-27 · 交接：AI 插件第一版）
>
> 用户「交接」。本会话从「继续 ZeroNote」开始，**AI 插件从 0 做到第一版**：9 个 rev（196–205），**零内核改动**。
>
> ### 本会话交付
>
> | rev | 内容 | vitest |
> |---|---|---|
> | 196 | 骨架 + 设置页（4 家服务商 / Key 进系统凭据库 / 测试连接三态） | 1147 |
> | 197 | 模型调用 + 流式对话（SSE 逐字 / 停止 / 历史 40 条） | 1170 |
> | 198 | 只读工具 ×5 + 工具循环（≤4 步）+ 步骤流 | 1184 |
> | 200 | 写工具 ×7 + diff 预览确认（提案 / 冲突检测 / 提案只在内存） | 1214 |
> | 201 | 任务系统（`note:saved` 触发 / 串行队列 / 3 秒去抖 / Q24 排除） | 1237 |
> | 202 | 定时触发 + 执行模式（`fixed` 不调模型 / 启动补做只补一次） | 1262 |
> | 203 | 三步向导 + token 统计 + 分类抽样（`ai.sample`） | 1277 |
> | 204 | 手机走查 + 发市场（`ai@0.5.0` 签名，索引 17 条） | 1277 |
> | 205 | **工具名改下划线**（真模型 400 的根因）+ 真 Key 抽样 + 全链路验证 | 1277 |
>
> ### 交接时状态
>
> - HEAD `5f6a07b` · **与 origin 同步** · 工作区干净
> - verify 六步全绿 **13:25:36** · vitest **1277** · cargo 55 · oxlint 3 warnings · 质量门 7/7
> - ⚠️ CI：`4033a0b`（rev205 首个提交）**红过一次** —— `check-docs` 报「HANDOFF 正文有 rev173.205 但索引缺」，
>   已在 `5f6a07b` 补上索引行（后一条 run 见 `gh run list`）
> - 桌面 dev pid **35548**（00:58 起，**已 12 小时+**仍可用）· 8999 / 8931 等测试端口全释放
> - 测试库 `_tmp-vault-tb`：AI 配置 = **DeepSeek + 真 Key**（Key 在系统凭据管理器，账号 `ai.api-key.deepseek`；
>   要清点面板「删除 Key」）· `根笔记.md` 已还原 · 任务 / 历史 / 用量已清
> - 手机 `33b676f6`：`ai` 插件已装（19 条命令 / 2 面板），配置已清（`store.json` 删过，重载回向导第一步）
>
> ### 本会话踩到的两个真问题（都已修）
>
> 1. **mock 验证不了"对面收不收"**：工具名带点号（`note.create`）在真 DeepSeek 上直接 400
>    （要求 `^[a-zA-Z0-9_-]+$`）。rev197–203 全走 mock，bug 一直躲到用户给真 Key 才暴露。
> 2. **一次保存会发两次 `note:saved`**（相隔 200 ms）：第一个触发把文件移走、第二个就全失败 ⇒ 同路径 3 秒去抖。
>
> ### 下个会话第一件事
>
> ① 把「工具名必须匹配 `^[a-zA-Z0-9_-]+$`」加成一条单测（现在只能靠人记得）；
> ② 真模型下把**写工具全链路**再过一遍：任务里 `note_move` + `tag_add`、`note_trash` 提案；
> ③ 之后进第二版（`plugin.exec` 白名单调 `habit` 等，见需求 §3.3 末尾）。
>
> ## 📌 rev173.205（2026-10-27 · 工具名改下划线 + 真 Key 抽样）
>
> 用户给了测试用 DeepSeek Key（「补收口」的第三件）。**第一次用真模型跑工具，抓到一个大 bug。**
>
> ### 抓到什么：带点号的工具名在 DeepSeek 上直接 400
>
> 抽样 20 篇全部失败，每条都是 `HTTP 400`，错误被我截断成 `Invalid 't…`。用 node 复现拿到原文：
>
> ```
> Invalid 'tools[5].function.name': string does not match pattern.
> Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'.
> ```
>
> `tools[5]` = 第 6 个工具 = `note.create`。**DeepSeek 的 function name 不允许点号。**
> 也就是说：**对话与任务里的全部写工具 / 任务工具，在真模型上从来就没能用过** ——
> rev197–203 的实测全走本地 mock，而 mock 不校验名字格式，这个 bug 一路躲到最后。
>
> 修法：17 个工具名统一换下划线（`note.write` → `note_write`、`tag.add` → `tag_add`、
> `task.create` → `task_create` …），代码里 24 处引用一起换。
>
> **教训**：mock 只验证"我们的代码对不对"，**验证不了"对面服务商收不收"**；
> 每个跨服务边界的格式（字段名、名字字符集、必填项）迟早要拿真 Key 过一遍。
>
> ### 真 Key 抽样结果（20 篇 · deepseek-chat · 输入 46k / 输出 295 tokens ≈ ¥0.03）
>
> | 笔记 | AI 建议 | 判断 |
> |---|---|---|
> | 学习/Rust/所有权.md | 学习/Rust | ✅ 与原目录一致 |
> | 学习/前端/CSS/布局.md | 学习/前端/CSS | ✅ 一致 |
> | 学习/前端/React/Hooks.md | 学习/前端/React | ✅ 一致 |
> | 工作/归档/旧版/备份说明.md | 工作/归档/旧版 | ✅ 一致 |
> | 工作/项目A/会议记录/1018-周会.md | 工作/项目A/会议记录 | ✅ 一致 |
> | 工作/项目A/需求.md | 工作/项目A | ✅ 一致 |
> | 工作/2026-10-18-发布计划.md | 工作 | ✅ 上一级（合理） |
> | 双链验收 / 导图验收 / 标签验收-读书 / 根笔记 / 新笔记-13/21/22-05/22-52 | 笔记 | ✅ 顶层兜底合理 |
> | 标签验收-周报.md | 工作 | ✅ 内容是周报 |
> | 新笔记-14-07-16.md（图片 + 一句「随风遨游」） | 灵感/随笔 | ✅ |
> | diagram-test.md（导图草稿 + 大段乱码） | 灵感/随笔 | ⚠️ 可接受（草稿） |
> | 新笔记-23-06-21.md（「自动同步验证 23:07」） | 灵感/随笔 | ⚠️ 可接受（测试记录） |
>
> **口径**：本来就在明确目录里的 8 篇 **8/8 正确**（7 篇原目录、1 篇上一级）；
> 根目录的 12 篇给了顶层兜底或按内容归类，没有一篇明显荒谬。
> 标签：多数 2–3 个且贴题（`Rust / 内存管理 / 编程语言`、`CSS / 布局 / 前端`），少数泛化（`未分类`、`测试`）。
>
> ### 顺手改掉的一处
>
> 第一轮有一篇**空笔记**（`新笔记-17-49-41.md`）让模型回了非 JSON ⇒ 解析失败、白花一次调用。
> 现在抽样遇到空正文直接记「（空笔记，跳过）」，不再送模型。
>
> ### 真模型写工具全链路（改名后现场验证，2026-10-27 13:29）
>
> | 句子 | 模型做了什么 | 结果 |
> |---|---|---|
> | 「列出我的文件夹」 | `list_dirs` · 35 ms | 18 个目录，模型整理成树形回复 |
> | 「帮我改写 根笔记.md，末尾加一句…」 | `read_note` · 10 ms → `note_write` · 4 ms | 面板出 `+2 行 / −0 行` 的 diff 提案 |
> | 点「采用」 | — | 磁盘真的多了那行；模型事先说的「还没写盘」是对的 |
>
> ⇒ 改名后 **工具调用 → 提案 → 确认 → 落盘** 四段全通。测试加的那行已删回原样（`根笔记.md` 与跑之前逐字一致）。
>
> ### 交接时状态
>
> - verify 六步全绿 **13:25:36** · vitest 1277（改名后 107 条 AI 单测全过）
> - 测试库 AI 配置为 **DeepSeek + 真 Key**（Key 在系统凭据管理器，账号 `ai.api-key.deepseek`）——
>   要清就点面板「删除 Key」；`store.json` 里只有 provider/model，不含密钥
> - 抽样结果只在内存（reload 即丢）—— 留证据请先截图
>
> ### 下一步建议
>
> ① mock 里加一条「工具名必须匹配 `^[a-zA-Z0-9_-]+$`」的断言，防止同类问题再躲过测试
> ② 第二版（`plugin.exec` 调 `habit` 等）开工前，把真模型下的**写工具全链路**过一遍
>    （对话「改这篇」→ 提案 → 采用；任务里移动 + 打标签）
>
> ## 📌 rev173.204（2026-10-27 · AI 插件收口：手机走查 + 发市场）
>
> 用户「补收口」。零内核改动。第一版还剩三件，本刀做完两件，第三件卡在真 Key。
>
> ### 手机走查（`33b676f6`）
>
> 手机上原本没有 `ai` 插件 ⇒ `adb push` 两文件到 `/data/user/0/com.aqua.zeronote.debug/.zn/plugins/ai/`
> （手机插件根是**文件拷贝**，不是桌面那种 junction），reload 后 **19 条 `ai.*` 命令 + 2 个面板**都在。
>
> | 检查项 | 结果 |
> |---|---|
> | 三步向导布局 | 正常（下拉 / 输入框 / 按钮都铺满宽度，无溢出）· 截图 `_shots/rev173203-phone-wizard.png` |
> | 测试连接 | `adb reverse tcp:8999 tcp:8999` 把桌面 mock 映射进手机 ⇒ **HTTP 200** |
> | 完成配置 | 向导收起、设置区出现 |
> | 流式对话 | 正常出字 |
> | token 统计 | 用量「**1 次 · 输入 88 / 输出 12 tokens**」 |
> | 任务面板 | 空状态文案与按钮正常 · 截图 `_shots/rev173203-phone-tasks.png` |
>
> 走完清干净：删 Key（`ai.clear-key`）、删手机 `store.json`、撤 `reverse tcp:8999`，重载回「未配置」——
> 下次谁打开手机都是向导第一步。
>
> ### 发市场
>
> ```powershell
> node scripts/pack-plugin.mjs ai --key <私钥> --key-id aqua-2026
> node scripts/gen-market.mjs --write
> ```
>
> ⇒ `ai@0.5.0`（123.2 KB · 整包 sha256 `b8b10eb4…` · 入口 `1a95c873…` · keyId `aqua-2026`），
> 索引 **16 → 17 条**，包与条目都已入库（`market/packs/ai-0.5.0.znp` / `market/entries/ai.json`）。
>
> ⚠️ **没有做真机安装实测**：桌面的 `ai` 是 **junction 指向 `examples/ai`**，装市场包会把它换成真实目录、
> 之后改源码就不生效了；而手机刚清完。安装链本身在 rev173.189–191 已多轮实测（备份 / 安全插件），
> 本刀新增的只是"又一个签名包"。真要验：装到一台干净设备上，看插件页是否显示「已签名」。
>
> ### 三件收口的最终状态
>
> | 项 | 状态 |
> |---|---|
> | 手机走查 | ✅ 本刀完成 |
> | 发市场 | ✅ 本刀完成（索引 17 条） |
> | 真 Key 准确率抽样 | ❌ **仍缺** —— 本机没有可用 API Key（DeepSeek 需要用户自己的 Key） |
>
> 抽样怎么补：在任意设备配好真 Key → AI 面板点「分类抽样（20 篇）」→ 看表格里「AI 建议文件夹」是否合理，
> 把命中率写进下一版 HANDOFF。代码不需要再改。
>
> ## 📌 rev173.203（2026-10-27 · AI 插件第七刀：首向导 + token 统计 + 抽样 · 第一版收口）
>
> 用户「继续」。零内核改动。**七刀全部落地**，AI 插件第一版到此为止。
>
> ### 三步向导
>
> 第一次打开（`store.wizardDone` 为假）时，面板顶部是三张卡片：
> ① 选服务商（自定义时同时给「端点地址」输入，否则选完 custom 走不下去）
> ② 填模型名与 API Key ③ 测试连接。每步一个 badge（已完成 / 第 N 步），
> 配好后点「完成配置」⇒ 向导收起、完整设置区出现。
> **新库不预置任务**（Q34）—— 打开只有向导，没有"AI 自动接管"。
>
> ### token 统计
>
> 流式与非流式两条路都取 `usage`：SSE 的最后一块（`{"usage":{…}}`）与非流式的整包都认；
> 字段名两套都认（`prompt_tokens/completion_tokens` 与 `input_tokens/output_tokens`）。
> 累计进 `store.usage`：对话面板一行「用量：N 次 · 输入 x / 输出 y tokens」，
> 任务面板单独一行「任务用量」（`taskCalls` 一列）—— 用户得知道钱花在聊天还是花在自动任务上。
>
> ⚠️ **实测踩到的坑（已修）**：`normalizeUsage` 被调用**两次**（`parseSseBuffer` 里一次、
> `addUsage` 里一次），而第一版只认 `prompt_tokens` 那套字段名 ⇒ 第二次把
> `{prompt, completion}` 当成空对象 ⇒ **流式那条路的统计永远是 0 次**。
> 现在这个函数是幂等的，`ai-usage.test.ts` 里钉了这条。
>
> ### 分类抽样（评估用，不改库）
>
> `ai.sample` / 面板「分类抽样（20 篇）」：取 20 篇 `.md`，逐篇问模型
> 「现有文件夹里选一个 + 给 1-3 个标签」，结果用表格列出（笔记 / AI 建议文件夹 / 标签）。
> **只读不写** —— 抽样是为了评估，不是替用户整理。
>
> ⚠️ **准确率数字没有**：本机没有真 API Key（mock 只会回固定的 `{"dir":"工作","tags":[…]}`），
> 20 篇全过也只是"流程通了"，不代表模型分得对。配好真 Key 后点一下按钮、人工看 20 行即可。
>
> ### 顺带纠正一个契约注释
>
> `fs.listNotes()` **不是只返回 `.md`**：Rust 的 `collect`（`lib.rs:215`）从 rev173.3 起
> 把「笔记 + 只读文档（pdf/epub）+ 图片」都收进同一个列表。
> 实测抽样第一批结果里出现了 `image-xxx.jpg`、`测试书籍.epub` ⇒
> `list_notes` 工具与抽样都自己过滤 `.md`。契约里那句"只上报 .md 文件"是过时的（未改内核，记在这里）。
>
> ### 交接时状态
>
> - 工作区干净 · 与 origin 同步 · verify 六步全绿 **13:07:43** · vitest **1277**（+15）· cargo 55 · 质量门 7/7
> - 桌面 dev 仍开着（pid **35548**，已连续 12 小时+）· 8999 已释放、临时 mock 已删
> - 测试库 `_tmp-vault-tb` 的 AI store 已清空（任务 / 对话 / 用量归零，`wizardDone=false` ⇒ 下次打开还是向导）
> - AI 插件版本 **0.5.0**（示例插件，未打包发市场）
>
> ### 七刀收口后还剩什么
>
> | 项 | 状态 |
> |---|---|
> | 分类准确率抽样 | **等真 Key**（流程已就绪，面板一个按钮） |
> | 发市场 | 未打包（第一版是示例插件 `examples/ai/`，走市场要 `pack-plugin` + 签名） |
> | 手机端走查 | 未做（前端改动 reload 即生效，改 Rust 才要重装） |
> | 第二版（`plugin.exec` 调 habit 等） | 未开始，见需求 §3.3 末尾 |
>
> ## 📌 rev173.202（2026-10-27 · AI 插件第六刀：定时触发 + 执行模式）
>
> 用户「继续」。零内核改动。需求 §3.2 的「定时（桌面可靠，Android 打开时补做）」与 Q28 的「AI 自选执行模式」落地。
>
> ### 定时
>
> ```js
> trigger: { type: 'schedule', at: '23:00', days: [1, 3, 5] }   // days 空 = 每天
> ```
>
> 判据只有一个：**`lastDueAt(now) > lastRunAt`**（`lastDueAt` = `now` 之前最近一次应跑的时刻）。
> 这一条同时覆盖两种场景 —— 正常到点、以及**关掉 app 三天再打开只补一次**（不是补三次）。
>
> 桌面：`setInterval` 每分钟扫一次 + 启动 2 秒后先扫一次（补做）。
> Android：前台时同样跑；切后台被冻结 ⇒ 回来时那一次 tick 自动把错过的补上（同一个函数，不需要另写一套）。
>
> ⚠️ **新建定时任务时 `lastRunAt = now`**：否则中午建一个「每天 23:00」，
> `lastDueAt` 指到昨天 23:00 > 0 ⇒ 会**立刻补跑一次**，而用户要的是今晚 23:00 再跑。
>
> ### 两种执行模式（Q28）
>
> | 模式 | 谁决定动作 | 成本 | 适合 |
> |---|---|---|---|
> | `auto`（默认） | 每次让模型看内容自己调工具（≤4 步） | 每次几毛~几分 | 「按内容分到合适文件夹」这类要判断的活 |
> | `fixed` | 建任务时把工具调用排好，**执行时完全不调模型** | **0 token** | 「打标签 + 移到某目录」这类动作固定的活 |
>
> `fixed` 的参数里可以用占位符 **`{{path}}`**（触发它的那篇笔记路径）与 `{{dir}}` ——
> 固定步骤是建任务时写死的，而它要处理的正是"刚保存的那一篇"，没有占位符就只能写死某一篇。
> `fixed` 还有个副作用是好消息：**没配 API Key / 断网也能跑**（实测见下）。
>
> ### 实测（4 项全过）
>
> | 场景 | 结果 |
> |---|---|
> | 定时任务 `at=12:51` | **12:51:03 自动跑**（记录 `reason=schedule`） |
> | `lastRunAt=0` 的任务 reload | 启动 **2 秒后补做一次**（`last_dirs✓`），再 tick 不重复 |
> | **未配置 API Key** 时跑 `fixed` 任务 | 照样跑通：`tags: [固定步骤]` + 移到 `工作/`（证明不调模型） |
> | 5 步 `fixed` 任务 | 只跑前 4 步，记 `超过 4 步上限，只跑了前 4 步`（`ok=false`） |
>
> ### 交接时状态
>
> - 工作区干净 · 与 origin 同步 · verify 六步全绿 · vitest **1262**（+25）· cargo 55 · 质量门 7/7
> - 桌面 dev 仍开着（pid **35548**）· 测试库已清理（测试任务与笔记都删了）
> - AI 插件版本 **0.4.0**（仍是示例插件，未打包发市场）
>
> ### 下个会话第一件事
>
> **rev203：首次向导 + 打磨**（三步向导：选服务商 → 填 Key + 模型名 → 测试连接；token 统计；
> 空状态文案统一；分类准确率抽样 20 篇；文档收口）。这是 AI 插件第一版的最后一刀。
>
> ## 📌 rev173.201（2026-10-27 · AI 插件第五刀：任务系统）
>
> 用户「继续」。零内核改动。需求 §3.2 的任务模型、Q24 的排除清单、Q29 的独立任务面板落地。
>
> ### 任务是什么
>
> 一句话规则：`{ id, name, instruction, trigger, enabled, runs[] }`，落 `store.tasks`。
> `trigger.type` = `save`（任何公开笔记保存后）· `manual`（只在点「立即跑」）· `schedule`（rev202 才做）。
> `trigger.dir` 可选：只在保存到这个目录（含子目录）时触发。每个任务留最近 **10 次**运行记录。
>
> ### 一条链路（触发 → 执行）
>
> ```
> note:saved（内核）
>   → skipForTasks(path)              Q24：私密 / 回收站 / 收件箱 / 导入目录 全跳过
>   → 同路径 3 秒去抖                 实测：一次保存连发两次 note:saved（相隔 200 ms）
>   → matchTasks(tasks, {save, path}) 启用 + 触发类型 + 目录过滤
>   → createSerialQueue()             两个任务同时动同一篇会互相覆盖
>   → runTask：非流式调模型 + ≤4 步工具
>   → runTool(..., { interactive: false })
> ```
>
> ### 自动任务里的写操作边界（这一刀最重要的决定）
>
> 自动任务跑在后台，**没有人会点「采用」**。所以把「不可逆」那条线划在工具层：
>
> | 工具 | 任务里 |
> |---|---|
> | `note.create` / `folder.create` / `tag.add` / `tag.remove` | 直接执行 |
> | `note.move` | **直接执行**（可逆：移回去就是） |
> | `note.write` | **拒绝**：`自动任务里不能改写已有正文（需要人在对话里看 diff 再点「采用」）` |
> | `note.trash` | **拒绝**：不可逆，要人在对话里确认 |
>
> ### 实测（CDP + 本地 SSE mock · 5 场景全过）
>
> | 场景 | 结果 |
> |---|---|
> | 对话：「每次保存后帮我分类并打标签」 | `task.create` ×1 → 任务面板「1 个 · 1 启用」 |
> | 新建笔记 → `core.save` | 文件从库根移到 `工作/任务测试.md`、frontmatter 写入 `tags: [AI分类]`、记录 `2 步 · 90 ms` |
> | 停用后再保存一篇 | 文件不动、无新记录（面板「1 个 · 0 启用」） |
> | 收件箱里的笔记保存 | **不触发**（Q24），文件原地不动 |
> | 任务里调 `note.write` | 该步被拒、正文没被改；运行记录标红并把失败步骤单列 |
>
> ### 实测抓到的三个真问题（前两个已修）
>
> 1. **一次保存触发两次**：两条记录相隔 200 ms —— 第一条把文件移走，第二条 `tag.add` / `note.move` 全报「文件不存在」。
>    修法：同路径 **3 秒去抖**（`lastTriggerAt`）。
> 2. **「三步全失败」也记成 ✓**：第一版 `run.ok` 只看有没有抛异常，没看工具步骤 ⇒ 面板一片绿、文件没动。
>    修法：`run.ok = steps.every(s => s.ok)`，`error` 写清哪一步、什么原因；面板展开时每个失败步骤单列一行。
> 3. **`task.create` 被连调 4 次**：模型在工具循环里每轮都以为还没建 ⇒ 建出 4 个一模一样的任务（之后每次保存跑 4 遍）。
>    修法：同 `instruction` + 同触发方式 ⇒ 不重复建，返回 `existed: <id>`。
>
> ### 交接时状态
>
> - HEAD 见 `git log`（本刀 1 个提交）· 与 origin 同步
> - verify 六步全绿 · vitest **1237**（+23）· cargo 55 · oxlint 3 warnings · 质量门 7/7
> - 桌面 dev 仍开着（pid **35548**，已连续 11 小时+）· 8999 已释放、临时 mock 已删
> - 测试库 `_tmp-vault-tb` 已清理（任务测试用的四篇笔记已删、`收件箱/` 已删）
> - AI 插件配置回「未配置」（Key 已从凭据库删除）· 任务与对话历史已清空
>
> ### 下个会话第一件事
>
> **rev202：定时触发 + 执行模式**（每天 HH:MM / 每周几；桌面每分钟检查 + 启动补做；Android 打开时补做；
> 创建任务时 AI 自选「固定步骤 / 现场判断」；失败重试）。之后 rev203 向导与打磨。
>
> ## 📌 rev173.200（2026-10-27 · AI 插件第四刀：写工具 + diff 预览确认）
>
> 用户「继续 ZeroNote」。仍然**零内核改动** —— 全部走现有原语（`fs.writeText/createNote/mkdir/move/delete`、`doc.active/save/open/close`）。
> 需求 Q4（只对不可逆操作确认）与 Q11（改写正文先给 diff）在这一刀落地：**可逆的直接做，不可逆的先给预览**。
>
> ### 七个写工具
>
> | 工具 | 行为 |
> |---|---|
> | `note.create` | 直接建；**路径已存在 ⇒ 报错**并指向 `note.write`（绝不静默覆盖） |
> | `folder.create` | 直接建（多级、幂等） |
> | `tag.add` / `tag.remove` | 直接改 **frontmatter**（正文里的 `#tag` 不动） |
> | `note.write` | **只生成提案**：行级 diff + `+N/−M`，点「采用」才写盘 |
> | `note.move` | **只生成提案**；`to` 是已存在的文件夹时自动拼上原文件名 |
> | `note.trash` | **只生成提案**，确认后进 `.zn/trash/`（可恢复，结果里回报回收站路径） |
>
> ### 三条安全线（比功能本身重要）
>
> 1. **冲突检测**：提案生成时记下旧全文，点「采用」前重读 —— 不一致就**拒绝写入**并说明原因。
>    实测：提案后手改文件 ⇒ `✗ 文件在预览之后被改过…这次写入已取消`，磁盘保持手改内容、提案留着可放弃。
> 2. **提案只在内存**：reload 丢提案（重说一遍），**绝不**把过期提案存进 `store` 再执行 —— 那等于静默覆盖用户的修改。
> 3. **同路径只许一份待确认改写**：两版都点「采用」会互相覆盖 ⇒ 第二次直接报错并说明等前一份。
>
> ### diff 是怎么算的
>
> 先剥公共前后缀，中间段跑**行级 LCS**；中间段 `>400×400` 退化「全删 + 全加」（不做最小编辑），
> 整篇 `>2000` 行标 `tooLong` 直接不逐行算（面板只显示「N → M 行，采用后整篇替换」）。
> CRLF 与 LF 视为同一份内容 —— 否则 Windows 上每次都是"整篇改了"。
>
> ### 实测（CDP + 本地 SSE mock `127.0.0.1:8999`，mock 参数故意切片发）
>
> | 场景 | 结果 |
> |---|---|
> | 「帮我改写一下根笔记」 | 待确认区出现 `+2 行 / −3 行` + diff 块；**磁盘未变**；步骤行 `✓ note.write · 7 ms · 已生成预览，等确认` |
> | 点「放弃」 | 提案消失、磁盘未变、留一行「已放弃：改写 根笔记.md」 |
> | 点「采用」 | `✓ 已完成：改写 根笔记.md · +2 行 / −3 行`，磁盘内容确实变了 |
> | 提案后手改文件再点采用 | 拒绝写入 + 明确原因，文件保持手改内容（截图在 `_shots/rev173199-ai-pending.png`） |
> | 「把它移动到工作目录」（`to: '工作/'`） | 提案显示 `→ 工作/根笔记.md`（自动拼名），确认后文件真移动 |
> | 「这篇不要了，删除它」 | 提案 + 红色「确认删除」；确认后文件进 `.zn/trash/1793074585424/根笔记.md`，工作目录已无该文件 |
> | 「给它打个标签」 | 直接生效：`---\ntags: [AI打标]\n---` 写入；**再打一次** ⇒ `changed:false`「标签没有变化」 |
>
> ### 编号顺延
>
> 交接（rev173.199）用掉了原计划给「写工具」的号 ⇒ 本刀记 **rev173.200**，
> 实施计划里 200/201/202 三刀顺延为 **201/202/203**（`docs/AI插件-实施计划-2026-10-27.md` 已改）。
>
> ### 两个新坑
>
> 1. **WebView2 的 Private Network Access 会拦页面 `fetch` 到 `127.0.0.1`**：CSP 里明明有 `http:`
>    （`src-tauri/tauri.conf.json:28`），报错却只有一句 `TypeError: Failed to fetch`（降级到 `net.fetch`
>    后又变成「Unexpected token 'd'」—— 那是把 SSE 文本当 JSON 解）。
>    本地 mock 必须回 `access-control-allow-origin: *` **且** `access-control-allow-private-network: true`，并处理 `OPTIONS`。
> 2. **`job_kill` 仍杀不掉后台 node**（rev198 记过，这次又踩）：先 `Get-NetTCPConnection -LocalPort 8999 -State Listen`
>    找 pid 再 `Stop-Process -Force`，然后**重新起服务前先探端口**，否则新进程 `EADDRINUSE` 而你以为是旧代码。
>
> ### 交接时状态
>
> - HEAD `a57e5b1`（rev199 交接）+ 本刀 1 个提交 · 与 origin 同步（上一批 ahead 4 已推送）
> - verify 六步全绿 **12:20:47** · vitest **1214**（+30）· cargo 55 · oxlint 3 warnings · 质量门 7/7
> - 桌面 dev 仍开着：pid **35548**（00:58:24 起，**已 11 小时+**）· 8999 已释放、临时 mock 已删
> - 测试库 `_tmp-vault-tb` 已还原（`根笔记.md` 回库根、`工作/根笔记.md` 已删）· AI 插件配置回「未配置」（Key 已删）
>
> ### 下个会话第一件事
>
> **rev201：任务系统**（`task.create/update/delete/list/run` + 任务面板 + `note:saved` 触发 + 串行队列 + 记录裁到 10）。
> 之后 rev202 定时与执行模式、rev203 向导与打磨。
>
> ## 📌 rev173.199（2026-10-27 · 交接：AI 插件三刀 + 需求定稿）
>
> 用户「交接」。本会话没动内核，产出全在插件层与文档层。
>
> ### 四个提交（全部在本地，**未推送**）
>
> | 提交 | 内容 |
> |---|---|
> | `9ce6c9b` | docs：39 问需求定稿 + 7 刀实施计划 + README 权威矩阵两行 |
> | `2cc4700` | feat(rev196)：`examples/ai/` 骨架 + 设置页（4 家服务商预设 / Key 进 keyring / 测试连接三态） |
> | `a60386a` | feat(rev197)：模型调用 + 流式对话（SSE / 停止 / 新对话 / 历史 40 条存 store / 9 条单测） |
> | `9dea102` | feat(rev198)：只读工具 ×5 + 工具循环（最多 4 步）+ 步骤流（14 条单测） |
>
> ### 交接时状态
>
> - HEAD `9dea102` · **ahead 4**（`git push` 待做：先直连，被 reset 再挂 `$env:HTTPS_PROXY='http://127.0.0.1:26561'`）
> - 工作区干净 · verify 六步全绿（02:54:23 · vitest **1184** · cargo 55 · oxlint 3 warnings · 质量门 7/7）
> - 桌面 dev **仍开着**：zeronote pid **35548**（00:58:24 起，11 小时）· vite 1420 · CDP 9222 · 面板与 10 条 `ai.*` 命令都在
> - 8999 测试 mock 已停、临时文件已删、测试 Key 与历史全部清过（`cmdkey /list` 无 `ai.api-key`）
>
> ### 三条新坑
>
> 1. **CDP `eval` 里的 `__znExec` 是异步的** —— `eval send → wait → eval stop` 测停止时流早跑完，
>    两次截图拿到同一张完成态。要在页面内 `setTimeout(() => __znExec('ai.stop'), 400)`。
> 2. **`textarea` 的 `onSubmit` 只在 `Ctrl/Cmd+Enter` 触发**（`UIRenderer.tsx:249-254`，裸 Enter 换行）。
>    占位符已改；用合成 `KeyboardEvent{ctrlKey:true}` 复测过。
> 3. **`job_kill` 杀不掉后台 node** —— 旧 mock 进程仍占 8999，新 mock `EADDRINUSE`。
>    按端口找 pid：`Get-NetTCPConnection -LocalPort 8999 -State Listen` → `Stop-Process -Id`。
>
> ### 下个会话第一件事
>
> **rev199：写工具 + diff 预览确认**（`note.create` / `note.write` / `note.move` / `note.trash` /
> `tag.add` / `tag.remove` / `folder.create`；覆盖正文与删除必须先给预览，Q4/Q11）。
> 之后 rev200 任务系统、rev201 定时与执行模式、rev202 向导与打磨（见实施计划）。
>
> ### 一个待确认的产品问题
>
> 需求 §5 说「保存后立即 AI 分类」—— 现在实现的是**对话驱动**，没有后台自动任务。
> rev200 的任务系统做完后，这条才真正落地；在那之前「自动分类」需要用户手动说一句。
>
> ## 📌 rev173.198（2026-10-27 · AI 插件第三刀：只读工具 + 工具循环 + 步骤流）
>
> 用户「继续」。仍然**零内核改动** —— 工具全部走现有原语（`fs.listDirs/listNotes/readText`、`index.query/tags`）。
>
> ### 五个只读工具
>
> | 工具 | 参数 | 落到哪 |
> |---|---|---|
> | `list_dirs` | — | `fs.listDirs()`（库内相对路径，已排序） |
> | `list_notes` | `dir?` `limit?` | `fs.listNotes(dir)` → path + title（默认 100 条，上限 200） |
> | `read_note` | `path` | `fs.readText(path)`，**超 8000 字截断并注明** |
> | `search_notes` | `q` `tag?` `dir?` `limit?` | `index.query()`（多关键词 AND；上限 50） |
> | `list_tags` | — | `index.tags()`（按篇数降序） |
>
> ### 工具循环
>
> 一轮用户消息最多 **4 步**（`MAX_TOOL_STEPS`，需求 Q28）：
> 调模型（流式）→ 有 `tool_calls` 就把 `assistant.tool_calls` 回传、逐个执行、
> 结果以 `{ role:'tool', tool_call_id }` 回灌 → 再调模型 → 直到没有工具调用。
>
> 两个刻意的细节：
> - **工具失败不中断对话**：错误包成 `错误：…` 回灌，模型能自己换参数重试；只有坏 JSON 参数会直接报出（静默当 `{}` 会调错工具）。
> - **流式失败才降级**：已经出字了就按「流中断」处理，不再走非流式重试（否则同一段会重复）。
>
> ### 步骤流
>
> 每条 assistant 消息下挂 `steps`：`✓ list_dirs · 6 ms · {"count":18,"dirs":[…]}`；
> 失败行标红。存历史时一起进 `store`（下次打开还能看到当时调了什么）。
>
> ### 单测（`tests/ai.test.ts` 9 → 14）
>
> 新增 5 条钉住「工具分片」：`parseSseBuffer` 提取 `tool_calls` 增量 · 同 index 参数分片拼接后 `JSON.parse` 成功 ·
> 多 index 并行互不覆盖 · 无 name 残片丢弃 + 缺 id 自动补 · 空/非数组不炸。
>
> ### 实测（mock 两轮：第一轮只回 `tool_calls`，第二轮引用工具结果）
>
> | 场景 | 结果 |
> |---|---|
> | 「列一下文件夹」 | 模型先要 `list_dirs` → 插件真跑 `fs.listDirs()` → **18 个目录**回灌 → 第二轮复述全部路径 |
> | 步骤流 | `✓ list_dirs · 6 ms · {"count":18,"dirs":["attachments","学习","学习/Rust",…]}` |
> | 清理 | custom 端点 / mock Key / 历史全清；mock 进程已停（**`job_kill` 杀不掉后台 node**，要按端口找 pid `Stop-Process`） |
>
> ### 下一步
>
> rev199：写工具（`note.create` / `note.write` / `note.move` / `note.trash` / `tag.add` / `tag.remove` / `folder.create`）+
> **diff 预览确认**（Q4/Q11：覆盖正文与删除必须确认）。
>
> ## 📌 rev173.197（2026-10-27 · AI 插件第二刀：模型调用 + 流式对话）
>
> 用户「继续」—— 按实施计划 rev197 落地。仍然**零内核改动**。
>
> ### 做了什么
>
> `examples/ai/index.js`（488 → 约 800 行）：
>
> | 部分 | 内容 |
> |---|---|
> | 流式 | 浏览器 `fetch` + `ReadableStream`，SSE 逐行解析；**80ms 节流**重渲染（逐字刷整面板会卡） |
> | 纯函数 | `parseSseBuffer(buf) → { deltas, done, rest }`（`rest` = 半包尾巴，必须拼回下一段）· `windowMessages(list, n)` |
> | 降级 | 流式失败且**一个字都没收到** ⇒ `net.fetch` 非流式重试（Rust 侧无 CORS；已收到部分内容则不重试，避免重复） |
> | 停止 | `AbortController` + `ai.stop`；中断后保留已收到的部分文字 |
> | 历史 | `store` 键 `history`，最多 40 条；发给模型的只有最近 **20** 条（需求 Q38） |
> | UI | 消息区（用户 = `field` 标签「你」+ text；AI = `markdown` 节点）+ `textarea`（**Ctrl/Cmd+Enter** 发送）+ 发送/停止/新对话 |
>
> ### 单测（`tests/ai.test.ts` · 9 条）
>
> 覆盖 SSE 的四个真实故障形态：**半包不丢字**（`rest` 拼回）· 一次多事件 · `[DONE]` ·
> 坏 JSON 不炸（后面的好行照常解析）· 忽略注释行 / 空 delta / `finish_reason` 帧；
> 窗口裁剪（30 → 5、少于 N 原样、非数组/缺字段不炸）。
>
> ### 实测（桌面 dev · CDP）
>
> 本地 SSE mock（`_tmp-ai-mock.mjs`，测完即删）每 250ms 吐一个字：
>
> | 场景 | 结果 |
> |---|---|
> | 正常流式 | 逐字出现（80ms 节流），10 段完整拼成「你好，这是一段流式输出的测试。」 |
> | 中途停止 | 页面内 `setTimeout(400ms)` 调 `ai.stop` ⇒ 只剩 1 个字「你」+ 红字「已停止」 |
> | reload 后 | 历史还在（`HISTORY-OK`，读 `store.history`） |
> | 新对话 | `ai.clear` 清空消息与存储 |
> | 假 Key 真服务 | 401 原文透传（流式与非流式两条路都验过） |
> | 清理 | custom 端点 / mock Key / deepseek 假 Key 全删；`cmdkey /list` 无 `ai.api-key` 残留；mock 服务已停 |
>
> ### 两个坑（都写进卡了）
>
> 1. **CDP `eval` 里的 `__znExec` 是异步的** —— `eval ai.send → wait 800 → eval ai.stop` 这种写法，
>    `wait` 期间流早就跑完了（截图两次拿到同一张完成态，一度以为「停止没生效」）。
>    正确做法：**在页面内** `setTimeout(() => __znExec('ai.stop'), 400)`，一次 eval 搞定。
> 2. **`textarea` 的 `onSubmit` 只在 `Ctrl/Cmd+Enter` 触发**（裸 Enter 是换行，`src/components/UIRenderer.tsx:249-254`）。
>    第一版占位符写成「Enter 发送」—— 实测按 Enter 只换了行、消息没发出（`textarea.value` 还在）。
>    已改成「Ctrl+Enter 发送，或点发送」，并用合成 `KeyboardEvent{ctrlKey:true}` 复测通过。
>
> ### 下一步
>
> rev198：只读工具（`folder.list` / `note.list` / `note.read` / `search.run` / `tag.list`）+ 工具调用循环 + 步骤流。
>
> ## 📌 rev173.196（2026-10-27 · AI 插件第一刀：骨架 + 设置页）
>
> 用户「开工」—— 按 `docs/AI插件-实施计划-2026-10-27.md` 的 rev196 落地。**零内核改动**。
>
> ### 做了什么
>
> `examples/ai/`（新插件，示例数 41 → 42）：manifest + index.js 单文件 —— 主区面板「AI」，
> 服务商预设 4 条（DeepSeek / Kimi / 通义兼容模式 / **自定义 OpenAI 兼容端点**），
> 模型名可空（留空用预设默认），API Key 输入框 `secret: true`（显示为圆点）。
>
> ### 三个关键选择
>
> | 项 | 做法 | 为什么 |
> |---|---|---|
> | Key 存哪 | `host.secrets` → keyring（账号 `ai.api-key.<provider>`） | `store` 落库、会被同步 / 备份搬走；keyring 不入库不同步（与 `security` 存本机 id 同一套机制） |
> | 测试连接走哪 | `ctx.net.fetch`（Rust 侧 `reqwest`） | 浏览器 `fetch` 要过 CORS + CSP 两道，失败时插件只看得到 `TypeError: Failed to fetch`，**分不清是谁拦的**（`examples/net-demo` 的教训） |
> | 面板怎么刷新 | 命令里改模块级状态 + `view.refresh(PANEL_ID)` | `render` 是纯函数，状态不能塞进组件（与 backup / accounting 一致） |
>
> ### 实测（桌面 dev · CDP）
>
> | 场景 | 结果 |
> |---|---|
> | 无 Key 点「测试连接」 | 红字「请求失败」+ 代码块「还没有保存 API Key（先在上面填，再点保存）」 |
> | 保存假 Key `sk-test-not-a-real-key` | 绿字「Key 已写入系统凭据库（DeepSeek）」· badge 变「已配置」 |
> | `cmdkey /list` | 出现 `LegacyGeneric:target=ai.api-key.deepseek.com.aqua.zeronote`，User `ai.api-key.deepseek` ⇒ **真的进了 Windows 凭据管理器，不在库里** |
> | 假 Key 点「测试连接」 | 红字「API Key 被拒（HTTP 401）」+ DeepSeek 原文 `{"error":{"message":"Authentication Fails …"}}` ⇒ `net.fetch` 链路通 |
> | 输入框回车 | 保存生效（`input.onSubmit`），不必点按钮 |
> | 删除 Key | 凭据消失（`cmdkey /list` 无条目）、状态回「未保存」 |
>
> ### 环境动作（不进仓库）
>
> - 全局插件根建 **junction**：`%APPDATA%\com.aqua.zeronote\.zn\plugins\ai` → `examples/ai`
>   （全局目录里其它插件是**拷贝**，改 `examples/` 不生效 —— 交接卡早有记载）
> - `location.reload()` 后插件自动加载；`__znKernelAudit().commands` 里 7 条 `ai.*` 命令齐全
> - 测试用假 Key 已删；`_shots/ai-01…05*.png` 是本地截图（不入库）
>
> ### 下一步
>
> rev197：模型调用层 + 流式对话（SSE 解析 / 停止 / 滑动窗口 20 条 / 历史存 store）。
> 传输通道按计划双路：**真流式走浏览器 `fetch`**（DeepSeek 预检已实测回 CORS 头），
> 失败降级 `net.fetch`（非流式）。
>
> ## 📌 rev173.195（2026-10-27 · 交接）

> 用户「收尾交接」。本会话从 rev173.187 之后接手，**7 个提交 rev173.188–194**。

> ### 本会话做了什么

> | rev | 一句话 |
> |---|---|
> | 188 | ROADMAP 现状段纠错（0.5.0 → 0.6.0，六处「已完成」还标着待办） |
> | 189 | 备份插件发市场（`backup` 0.3.1 · 索引 16 条 · 实测「签名包不被内置覆盖」） |
> | 190 | 修市场安装清掉 `store.json`（整目录交换前搬回用户数据 · cargo 53 → 55） |
> | 191 | 手机端市场走查（5 项全过；顺带发现手机 APK 已被 `android-dev` 悄悄重编成最新代码） |
> | 192 | 查 raw 根因：错误带源链 → 是 **TLS 阶段 RST**，不是证书 / DNS |
> | 193 | 12 个域名对照：只有 raw 全灭，jsDelivr 的 GCore / Cloudflare 稳定 |
> | 194 | **市场镜像可切换 + 测速**（5 条内置源，索引与包前缀成对切换） |

> ### 交接时实测状态

> - 工作区干净 · HEAD **`80b0d4a`** · 与 `origin/main` 同步
> - verify 六步全绿：tsc 0 · oxlint 0 error/3 warnings · cargo **55** · check-docs · vitest **1170** · 质量门 7/7
> - 桌面 dev：pid **35548**（00:58:24 起）· vite 1420 / CDP 9222 正常
> - 手机 `33b676f6`：pid 31861 · APK **01:00:40** —— **不含 rev173.194 的镜像 UI**（前端在那之后才改）
> - 测试端口 8931 / 8933 / 8934 **全部释放**（清掉了两个 10-25 的僵尸 `http.server`）

> ### 下一步候选

> 1. **默认源是否改成 `jsDelivr · GCore`** —— 现在默认仍是 raw：桌面快（279 ms），但手机开箱拉不到。
> 2. **手机重编一次**，验证 rev173.194 的下拉 / 测速在 Android 上（改前端不会自动重装，要动一下 Rust 或手动 build）。
> 3. ROADMAP 里「安卓桌面组件」（需求 §15）仍是唯一没动过的大块。

> ### 本会话新增的四条坑

> 1. **别手抄 sha256**：手抄 64 位少一位，安装直接报「校验失败」，白折腾一轮。用 `node -e` 从 `market/entries/*.json` 读。
> 2. **WebView `fetch` 成功 ≠ 网络通**：我一度以为「WebView 能连 raw」，结果它拿到 **11690 B**（旧边缘缓存），
>    而桌面 Rust 同时拿到 **12571 B**（= 本地文件大小）。判「能不能连」要看**内容对不对**，不看「有没有返回」。
> 3. **`job_kill` 杀不掉子进程**：`python -m http.server` 会活下来继续占端口，表现是 **`socket hang up`**
>    （不是 404、也不是拒绝连接）。要 `Stop-Process -Id <pid>`，并且先用 `Get-NetTCPConnection` 找出真正占端口的 pid。
> 4. **PowerShell 的 `$?` 会抢先展开**：`adb shell 'echo rc=$?'` 必须用**单引号**包住整条命令，否则输出是 `rc=True`。
>    （同类：`$pid` 只读 —— 旧卡已记。）

> verify 六步全绿。

> ## 📌 rev173.194（2026-10-27 · 市场镜像可切换 + 测速）

> 用户「准备几条镜像可供切换，加个测速功能」。前面的调查（rev173.192–193）已经证明：国内手机上 raw 100% RST，
> 而 jsDelivr 的 `gcore` / `testingcf` 节点稳定 —— 这次把它做成产品能力。

> ### 设计：镜像必须成对

> ```ts
> type MarketMirror = { id; label; indexUrl; packBase }
> ```
> 索引里的 `url` 是**打包时写死的 raw**。只换索引地址不换包前缀，就是「列表能看、装的时候又回 raw」
> —— 正是 rev173.150 踩过的「能看不能装」。所以换源 = `indexUrl` + `packBase` 一起换。

> 安装走 `mirrorPackUrl(mirror, entry.url)`；**只改写本仓库 raw 形态**的地址
> （`^https://raw\.githubusercontent\.com/aqua7773/zeronote/`），外部作者 / Release / 自建源一律原样。

> ⚠️ **第一版没有这条限制**，写的是「取文件名再拼前缀」—— 当场被 `tests/market.test.ts` 的老用例抓住
> （期望 `https://example.com/tag-panel-0.2.0.znp` 原样，实际被搬到 raw 前缀下）。回归测试的价值。

> ### 测速：不能只看状态码

> `probeMirror` 走 Rust `net_request`（与真正装插件同一条链路，不是浏览器 fetch），判定用纯函数
> `judgeMirrorProbe(status, entryCount, ms)`：**200 且能解析出 ≥1 条**才算可用。
> 理由来自 rev173.193 的实测：`ghps.cc` 返回 200 但只有 508 字节（错误页）。

> ### 桌面实测（5 条镜像）

> | 镜像 | 结果 |
> |---|---|
> | GitHub raw | ✅ **279 ms · 16 条** |
> | jsDelivr · GCore | ✅ 722 ms · 16 条 |
> | jsDelivr · Cloudflare | ✅ 648 ms · 16 条 |
> | jsDelivr（cdn） | ❌ `远程主机强迫关闭了一个现有的连接 (os error 10054)` |
> | ghproxy.net | ✅ 1413 ms · 16 条 |

> **`cdn.jsdelivr.net` 在桌面也断** —— 与手机端的结论一致，所以标签直接写「国内常断」，排在 GCore / Cloudflare 之后。
> 切换后市场列表从新源重拉（16 条），选择存 `zn-market-mirror`；连不上时多一句「点测速换一条」的下一步提示。

> vitest 1147 → **1170**（新增 `tests/market-mirror.test.ts` 23 条：地址改写 / 自定义源兼容 / 测速判定 / 装包走当前镜像）。

> ## 📌 rev173.193（2026-10-27 · 域名对照测试：12 个里只有 raw 全灭，jsDelivr 稳定）

> 用户「还有别的域名吗，多测几个」。方法：手机页面 `net_request` 逐个打（rustls + webpki-roots，与市场 / 安装同一条链路），每个 7–8 s 超时，看**状态码 + body 长度**（长度能验内容对不对，不只是「连上了」）。

> ### 结果

> | 域名 | 结果 |
> |---|---|
> | **raw.githubusercontent.com** | ❌ **6/6 RST**（`Connection reset by peer`） |
> | gcore.jsdelivr.net | ✅ 索引 `16764` b64 · 包 `49704` b64（各 2 次全过） |
> | testingcf.jsdelivr.net | ✅ 同上（各 2 次全过） |
> | ghproxy.net | ✅ 200 · `16764`（内容正确） |
> | api.github.com | ✅ 200 |
> | github.com | ✅ 200 |
> | objects.githubusercontent.com | ✅ 404（连上了，只是路径不存在） |
> | github.githubassets.com | ✅ 200 |
> | unpkg.com | ✅ 200 |
> | cdn.jsdelivr.net / fastly.jsdelivr.net | ⚠️ 间歇（先 1 次 RST，后重测 200） |
> | gist.githubusercontent.com | ❌ 超时 |
> | raw.gitmirror.com / hub.gitmirror.com / kkgithub.com | ❌ RST |
> | cdn.statically.io / ghfast.top | ❌ 超时 |
> | ghps.cc | ⚠️ 200 但只有 508 字节（返回的不是索引） |

> ### 为什么一定要看长度

> `b64=16764` ⇒ 原始 `12571` B = 本地 `market/index.json`；`49704` ⇒ `37278` B = `backup-0.3.1.znp`。
> **只看 200 会被 `ghps.cc` 骗**（200 但 508 字节，是个错误页）。

> ### 结论

> 1. **raw 是唯一稳定全灭的域名** —— 不是 GitHub、也不是 Fastly 网段的问题。
> 2. **jsDelivr 的 `gcore` / `testingcf` 节点稳定且内容逐字节一致** ⇒ 最现实的替代源。
> 3. `ghproxy.net` 可作备用。

> **未改代码**（换源涉及产品形态，等用户定）。verify 六步全绿。

> ## 📌 rev173.192（2026-10-27 · 查「手机连不上 raw.githubusercontent.com」：是 RST，不是证书）

> 用户「查」。接 rev173.191 的第 ② 条（手机市场报「连不上服务器」，但 WebView fetch 通）。

> ### 先让错误说人话

> `net_request` 的错误文本原来只有 `{e}`（reqwest 的 Display）—— 永远只有一句「error sending request」。
> 改成沿 `std::error::Error::source` 逐层拼 `←`（`net.rs` 一处，无行为变化）。拿到：

> ```
> error sending request for url (…)
> ← client error (Connect)
> ← Connection reset by peer (os error 104)
> ```

> ⇒ **TCP 建好之后被 RST**，不是证书、不是 DNS、不是超时。

> ### 对照组（同一台手机 · 同一份代码）

> | URL | 结果 |
> |---|---|
> | `https://api.github.com/rate_limit` | **200** |
> | `https://github.com/aqua7773/zeronote` | **200** |
> | `https://objects.githubusercontent.com/` | **404**（连上了，只是路径不存在） |
> | **`https://raw.githubusercontent.com/…`** | **100% RST**（3 次全是 `os error 104`） |

> ⇒ 不是 Fastly 网段、不是 GitHub、也不是 ZeroNote —— 是 **raw 这个域名的针对性干扰**。

> ### 两条旁证

> 1. **桌面同一份代码连 raw = 200**（桌面 native-tls / 手机 rustls+webpki-roots，TLS 栈不同）。
> 2. **`toybox nc` 到 raw 的 IPv4 与 IPv6:443 都能建连**（`rc=0`）⇒ TCP 层通，RST 发生在 **TLS 握手阶段**（ClientHello / SNI）。
>    ⚠️ 顺带纠正 rev173.191 那句「WebView 能连」：WebView 拿到的是 **11690 B**，而桌面 Rust 同一时刻拿到的是 **12571 B**（= 本地 `market/index.json` 的大小）
>    ⇒ WebView 那份很可能是**旧边缘缓存**，不能当成「WebView 能通」的证据。

> ### 也试了换源

> `cdn.jsdelivr.net` / `fastly.jsdelivr.net` 的同一路径：**首次 200，随后也 RST**（同一 IP 上时通时断）⇒ 换镜像并不能稳定解决。

> ### 未修（等用户定）

> 可选的修法方向：市场「索引 / 包」加**备用源与自动回退**，或给用户一个「市场源」设置项（raw / jsDelivr / 自建）。
> 这涉及产品形态，不在「查」的范围。

> verify 六步全绿。

> ## 📌 rev173.191（2026-10-27 · 手机端市场走查：备份装上、签名、能用）

> 用户「走一遍」。接 rev173.190 之后那句「手机端走一遍市场安装」。

> ### 结论先说：手机包里其实已经是最新代码

> `versionName` 仍是 **0.5.0**，但 `lastUpdateTime` = **2026-10-27 00:36:41** —— 我 00:30 改 `lib.rs` 之后，
> 后台的 `android-dev` 自动重编并安装了 APK（java 进程 00:32:07 起，构建约 4 分钟）。
> ⇒ **手机上跑的是最新代码**，所以这次走查顺带把 rev173.190 的 store 修复也在 Android 上验了。

> ### 卡住的地方：手机 Rust 连不上 GitHub raw

> 市场页报「⚠ 连不上服务器（地址 / 端口 / 证书 / DNS 之一）：https://raw.githubusercontent.com/…」。
> 同一条 URL：`adb shell ping` 通（108 ms · 0% 丢包）· **WebView 里 `fetch` 成功**（11690 字节）。
> ⇒ 不是手机没网，是 **Rust 侧 reqwest 那条链路**在连接/TLS 阶段失败（0.5.0 起的既有行为；rev173.151 当时是通的）。
> **未查根因**（不在本次范围）。

> ### 绕过去：本地 http 源

> 1. `_tmp-market-local/gen.mjs` 把 `market/index.json` 每条 url 的 raw 域名换成 `http://127.0.0.1:8934`（16 条）。
> 2. 仓库根起 node 静态服务 8934 + `adb reverse tcp:8934 tcp:8934`。
> 3. 手机 `localStorage['zn-market-index-url'] = http://127.0.0.1:8934/_tmp-market-local/index.json` → reload。
> 4. 「发现」tab 拉到 **16 条**（含「备份 v0.3.1 · 36.4 KB」）。
> 5. 备份显示「已安装」（预装目录在），UI 不给安装按钮 ⇒ 页面直调 `install_znp_from_url`（与 rev173.151 同一做法），sha 从 `market/entries/backup.json` 脚本读取，不手抄。

> ### 结果（5 条全过）

> | 检查 | 证据 |
> |---|---|
> | 下载 + sha256 | `OK:backup`（Rust 从 `http://127.0.0.1:8934` 取包，37278 B） |
> | 落盘 | `index.js` 34698 · `manifest.json` 1312 · **`signature.json` keyId `aqua-2026`** |
> | **store 保留** | 装前把 `store.json` 改成 `interval=1w` ⇒ 装完**仍是 1w**（rev173.190 在 Android 生效） |
> | 签名包加载 | reload 后插件页「**备份 v0.3.1 已签名**」，`ensureBuiltinPlugins` 没覆盖 |
> | 功能 | 面板「自动备份：每周」→ 立即备份 ⇒ **6/30 · 36 篇 · 5 个文件夹 · 含密码库密文 · 1316 ms** |

> ⚠️ 备份目录在 `/storage/emulated/0/…/.zn/backups/`，`run-as` 读不了（scoped storage）⇒ 磁盘层只能靠 UI 清单与耗时间接证明。

> ### 清理

> store 恢复 `1d` · `zn-market-index-url` 已删 · `adb reverse --remove tcp:8934` · `_tmp-market-local/` 删除 · 8934 服务停。
> 顺手清了两个 10-25 的僵尸 `http.server`：`8933`、`8934`（后者 `--directory _tmp-external`，是 rev173.158 的审查夹具）—— 它们正是本期「socket hang up」的源头。

> 无代码改动 · verify 六步全绿。

> ## 📌 rev173.190（2026-10-27 · 修「市场安装清掉插件 store.json」）

> 用户「修」。接 rev173.189 末尾那句「顺带发现」。

> ### 根因

> `install_pack` 是**整目录交换**（rev173.143）：旧目录 `rename` 到 `prev-…` → 新目录上位 → `remove_dir_all(prev)`。
> 旧目录里除了代码还有 `store.json` —— 插件的**持久化用户数据**（备份档位 / 打卡计数 / 主题选择），
> 由 `plugin_store_write` 写进同一个目录。交换把用户数据当代码一起扔了。

> ### 修法（`src-tauri/src/lib.rs` · 前端零改动）

> - 新增 `PLUGIN_STORE_FILE = "store.json"` 常量，`plugin_store_read/write` 与安装共用同一个名字（此前是两处字面量）。
> - 新增 `keep_plugin_store(old_dir, new_dir)`，在**交换成功、删旧目录之前**调用。
> - 两条规则：① 新包自带同名文件 ⇒ **以包为准**（上游刻意给的初始值 / 换存储格式）；② 拷贝失败**只 `eprintln`、不中断安装** —— store 丢是「设置回默认」，中断安装是「插件没了」，后者更重（「静默失效比报错危险」说的是别藏错误，不是把小错升级成大错）。

> ### 证据

> - **单测**：`install_znp_keeps_store_json`（升级后 store 原样、代码已换）+ `install_znp_pack_store_wins`（反向：包内自带时以包为准）。**cargo 53 → 55**，全绿。
> - **真机**：全局 `backup` 的 `store.json` 先改成 `interval=1w` → 页面调 `install_znp` 装同一份 `backup-0.3.1.znp`（与市场安装同走 `install_pack`）⇒ `store.json` 内容与 **mtime 都不变（00:33:09）**，`index.js / manifest.json / signature.json` 的 mtime 变 **00:34:16**（整目录确实换了）→ reload 后面板「**自动备份：每周 · 上次 10-27 00:26 · 下次 11-03 00:26**」。测完已把 store 恢复成 `1d`。

> ### ⚠️ 环境坑（下次别踩）

> `8931` / `8933` 都被残留的 `python -m http.server` 占着：8931 是本次 rev173.189 自己起的（job 取消后子进程没死，已 `Stop-Process`）；
> **8933 是 2026-10-25 的历史残留（pid 30832），未动**。表现是连接直接 `socket hang up`（不是 404，也不是拒绝连接）
> ⇒ 这两个端口别再当市场测试床；换端口，或者像本次一样改走 `install_znp` 本地文件路径（同一个 `install_pack`）。

> verify 六步全绿。

> ## 📌 rev173.189（2026-10-27 · 备份插件发市场 0.3.1：内置 + 市场不冲突，实测坐实）

> 用户问「备份插件，内置跟上市场不冲突吧」→ 答「不冲突，9 个预装里 8 个本来就双份」+ 讲了三条规则 → 用户「发」。

> ### 发了什么（零代码改动，只走发版链）

> 1. `node scripts/pack-plugin.mjs backup --key <私钥> --key-id aqua-2026` —— **36.4 KB**，整包 sha256 `eb1f142e…`、入口 `6cb18e37…`，签名写进 `signature.json`（keyId `aqua-2026`）。
> 2. `node scripts/gen-market.mjs --write` ⇒ 索引 **15 → 16 条**。
> 3. 入库：`market/packs/backup-0.3.1.znp` + `market/entries/backup.json`。

> ### 实测（本地 http.server 8931 + CDP 装真包）

> `vault` 参数传的是 **`appDataDir()`**（`C:/Users/AQUA/AppData/Roaming/com.aqua.zeronote`），不是库根 —— 见 `src/kernel/plugin-roots.ts` 的约定：把 appDataDir 当 vault 传，算出来就是全局插件根。

> 1. **负向**：我手抄 sha 少了一位 ⇒ 报「插件包校验失败：索引记录 sha256=…，实际下载到 … —— 不安装」，**不落盘**。
> 2. **正向**：改成从 `market/entries/backup.json` 读 sha（脚本拼，不手抄）⇒ `OK:backup`；磁盘 `index.js` sha 与包内入口一致、`signature.json` keyId `aqua-2026`。
> 3. **reload 后**：插件页显示「**备份 v0.3.1 已签名**」且正常加载 ⇒ `ensureBuiltinPlugins` 的**规则 2（有签名一律不覆盖）**真机生效 —— 这就是「内置 + 市场」不冲突的直接证据（另两条规则有单测，见 rev173.147）。
> 4. 清理：`localStorage.removeItem('zn-market-index-url')` 已恢复 GitHub raw，`http.server` 已停。

> ### ⚠️ 顺带发现（未修，记待排期）

> `install_pack` 是**整目录交换**（旧目录 `remove_dir_all`）⇒ **`store.json` 被清掉**。备份插件的 `backup:config`（自动档位 / `lastAt`）会回到默认（每天），插件加载后自己写回默认值（实测 `store.json` 在 reload 后 78 B 重现）。
> 对「升级插件要保留用户设置」是个真实缺口 —— 本次不在「发」的范围，记在这里。

> 无代码改动 · verify 六步全绿。

> ## 📌 rev173.188（2026-10-27 · ROADMAP 现状段纠错：0.5.0 → 0.6.0）

> 用户「改roadmap」。本会话开头汇报进度时指出 `docs/ROADMAP.md` §0 还停在 0.5.0 / rev173.139（用户选了这个而不是先做安卓组件）。

> ### 改了六处

> 1. **抬头复核日期**：2026-10-25（rev173.139）→ **2026-10-27（rev173.188）**。
> 2. **§0 版本**：**0.5.0 → 0.6.0**（tag `v0.6.0`，2026-10-26）；补 0.6.0 两条主线（安全 / 密码库 · 插件市场闭环，rev173.137–173 · 57 个提交）与 0.6.0 之后的两块（私密文件夹三期 rev173.180–182 · 备份插件 rev173.175–178）。
> 3. **§0 HANDOFF 大小不再写数字** —— 分卷时 63 KB，现在 263 KB；「写了数字的地方就会过时」，改成要看就 `Get-Item HANDOFF.md`。
> 4. **§0 契约行**：「`contract.ts` 最近一次改动 rev173.135」→ **rev173.180**（`doc.registerCodec`），并列出 rev173.163（`input.secret`）—— 原句在 0.6.0 的两个契约扩展之后就成了假的（这条最容易误导下次会话）。
> 5. **§3.0 两行收尾**：自动备份「**剩余**：内置还是发市场（待拍板）」→ **内置已定**（rev173.178 登记预装 · rev173.179 `D-010` 判据成文，预装 9 个之一）；私密文件夹「**剩**：发市场打包 + 手机走查」→ **收尾已完成**（`security` 0.2.1 + 四个同步后端同批发市 · 桌面迁移链 173.183 · 手机走查 173.184 · 旧 `vault.json` 复活 173.186–187 已查清）。
> 6. **§4 质量门「5 项」→ 7 项**（补市场索引 / 外部条目审查）；**§5** 里 `D-008` 仍写 pending（与 §3.3「✅ 阶段 0+1 已落地」自相矛盾）→ **✅ 已完成**。

> ### 没动（复核后仍是事实）

> - §3.0「安卓桌面组件 ❌ 未做」（需求 §15 快速输入 / 打卡 / 最近笔记）—— 仍是候选池里唯一没做过的大块。
> - §3.1 / §3.2 的卡点（`sync-git` 手机端 / Gitee 令牌 / 记账样本 / 性能暂缓 / AI 标签方向待定）。
> - §3.4 两条小债：`docs/guides/` 仍未建（`Android安装说明.md` 还在 `docs/` 根）· 白屏兜底的实际边界。

> 无代码改动 · 无测试数字变化 · verify 六步全绿。

> ## 📌 rev173.187（2026-10-27 · 「旧 vault.json 自己回来」：桌面不复现，写回是内存态）

> 用户「继续」。接着 rev173.186 的「下一步：逐个禁用插件二分」。

> ### 三个新事实

> 1. **桌面不复现**：在桌面测试库放回旧 `vault.json` 再删掉，60 s 内没再出现 ⇒ 手机独有。
> 2. **写回需要「旧文件曾在场」的页面内状态**：手机上先把 `backup`/`secrets`/`history`/`sync-*` 一次性禁用
>    并 reload，再删除 `vault.json` —— **60 s 轮询 12 次全是 False**；换一次密码也不再写回。
>    ⇒ 写回者把旧内容**缓存在内存里**，reload（或几次删干净后）就没了。
> 3. **现在手机是稳定态**：`.zn/security/` 只有 `vault.secrets.json`，反复删 + 60 s 观察都不再复活。

> ### ⚠️ 方法教训（下一轮别重复）

> 第 1/2 轮二分时我只等 **12–15 s** 就判「不写回」—— 而写回窗口实际 **> 15 s**（23:49 / 23:55 那几次都是
> 删掉后 60 s 内才出现）。⇒ 那两轮的「已排除」**不可信**，`backup` / `history` / `sync-*` 并没有被真正排除。
> 下次二分：**每轮等 ≥ 60 s**，或者直接用 `inotifyd` 挂着（事件一到就能看见）。

> ### 判断

> `security` 0.2.1 的 `apply()` 自愈 + 一次彻底删除，在实操上已经**终止了复活循环**（reload 会清内存态）。
> 具体写回者仍未定位；要继续查的前提是让旧文件重新「在场并被缓存」，再按 ≥60 s 的窗口二分。

> ## 📌 rev173.186（2026-10-26 · 查「旧 vault.json 自己回来」的来源）

> 用户「查」。接着 rev173.185 那句「未解：删掉后不做任何操作，它也会回来」。

> ### 抓到的：写回用的是 ZeroNote 自己的原子写

> `inotifyd` 盯 `.zn/security/` 后 `rm vault.json`，事件序列是：

> ```
> d vault.json                       ← 删除
> n vault.zn-tmp / c / w / m         ← 建临时文件并写入
> y vault.json → c vault.json        ← rename（moved_to + create）
> ```

> **`vault.zn-tmp` 正是 Rust `atomic_write_bytes` 的临时文件名**（`abs.with_extension("zn-tmp")`）⇒
> 写回走的是**内核的 `write_note`**，不是系统 / 第三方工具。之前「已排除」的推理有一半是错的。

> ### 为什么还是没定位到调用者

> - **主窗口没法 hook `invoke`**：`Object.getOwnPropertyDescriptor(window.__TAURI_INTERNALS__,'invoke')`
>   返回 `{ writable: false, configurable: false }` ⇒ 替换会抛 `TypeError: Cannot redefine property: invoke`。
> - CDP 只有**一个** page target（`http://tauri.localhost/`），没有第二个 webview 可查。
> - `logcat` 里没有 app 的输出（Tauri 的 console 不进 logcat）。

> ### 这次新排除的

> | 怀疑 | 结果 |
> |---|---|
> | 库外备份 `/Documents/zeronote-phone-backups/` | 改名移走后仍回来 ⇒ 不是它 |
> | MediaStore 里有没有这条记录 | `content query` 无 `vault.json` ⇒ 不是媒体库重建 |
> | Syncthing | 手机库无 `.stfolder` / `.stignore` |
> | 备份插件 | 禁用后一次没复现，但重新启用也没复现 ⇒ 证据不足（不是它，也不是"确凿排除"） |

> ### 现在的判断

> 写回内容是 **897 B 的旧格式（`v:1` + `rings`）** —— 当前代码生成不了（`vaultPartPayload` 输出
> `v:2` + 单环 `ring`）。所以写回者**持有旧内容的原文**，且用 `write_note` 写。最可能是
> **某个还活着的旧版实例**（旧 webview / 旧插件上下文）或某条「自动修复」路径 —— 但主窗口观测不到。

> ### 下一步（留给下个会话）

> 1. **逐个禁用插件二分**（`backup` / `secrets` / `security` / `history`）：改名 `.off` → 重启 → 删文件 → 等 60 s。
>    每轮约 2 分钟，最坏 8 轮。
> 2. 或者在 Rust 的 `write_note` 里**临时加一行日志**（重编 APK ~3 分钟，要用户同意「改 Rust 必须重装」）。
> 3. 影响评估：`security` 0.2.1 的 `apply()` 自愈会在每次加载时清掉它 ⇒ 用户可感知的影响很小；
>    剩下的是「同步 / 备份会把这份旧文件收进去」—— 修好写回者才能根治。

> ## 📌 rev173.185（2026-10-26 · 修迁移收尾的静默失败 + security 0.2.1 发市）

> 用户「修」（接着 rev173.184 手机走查暴露的那个缺陷）。

> ### 改了什么

> - `saveVault` 的最后一步原来是 `purgePrivate(LEGACY_VAULT_FILE).catch(() => {})` —— 失败被吞。
>   新增 `purgeLegacy(api)`：**失败不静默**，最多删两轮；每轮删成功后再**等 1.5 s 复查一次**
>   （手机实测过「删掉后又被写回来」），两轮都不行才 `api.host.notify(...)` —— 文案由纯函数
>   `legacyPurgeWarning(error)` 生成（带真实错误 + 「请手动删除」）。
> - `apply()` 加**残留自愈**：新结构文件存在 **且** 旧 `vault.json` 也在 ⇒ 自动清一次
>   （前置判据必须有新文件，否则可能把唯一的 vault 删掉）。
> - `security` 版本 0.2.0 → **0.2.1**，重新签名打包（keyId `aqua-2026` · 74.2 KB · 整包 sha256
>   `a13a1b48…`）+ `gen-market --write`（索引 15 条）—— 不打包质量门的「市场索引 vs manifest」会红。

> ### 实测（桌面 + 手机）

> | 场景 | 结果 |
> |---|---|
> | 桌面 · 放回旧 `vault.json` → reload | ✅ apply 自愈清掉 |
> | 桌面 · 换密码（旧文件在） | ✅ 正常删掉，不弹提示 |
> | 桌面 · 换密码（旧文件被独占句柄锁住） | ✅ toast 原文：「vault 已按环拆好，但旧的 .zn/security/vault.json 删不掉：删除文件失败 …另一个程序正在使用此文件，进程无法访问。 (os error 32)。请手动删除它…」 |
> | 手机 · 推 0.2.1 → 重启 | ✅ apply 自愈清掉 23:30 残留的那份 |
> | 手机 · 换密码（旧文件在） | ⚠️ 删掉后**又回来**（3 s 延迟复查没拦住） |
> | 手机 · 删掉后**不做任何操作** | ⚠️ **90 s 内自己出现**（mtime 保留 / 内容逐字节相同） |

> ### 没解决的：Android 上「文件复活」的来源

> 删掉 `.zn/security/vault.json` 后它会在几十秒内回来、**内容与迁移前逐字节相同**、mtime 保留。
> 已排除：备份插件（禁用它时一次没复现，但也没有反向复现）、主窗口 `invoke` hook
> （`write_note` / `copy_entry` / `purge_private` **零记录**）、Syncthing（无 `.stfolder`）、
> 全盘 897 字节副本（只有库内这份 + 我放库外的备份，mtime 不同）。
> **暂时按「平台 / 第三方行为」登记**；ZeroNote 侧的防御是「加载时自愈 + 失败可见」。
> 下一步要接着查：`inotifyd` 盯目录 + `stat` 比 inode（看是不是同一份被「还原」）。

> ### 状态

> - 桌面测试库：`secrets` = `TestPass123`（已复原）· `vault.notes.json` + `vault.secrets.json` · 无旧文件
> - 手机：`secrets` = `PhoneTest123`（已复原）· 插件 0.2.1（md5 `058f39de…`）· 旧 `vault.json` 已删（可能再出现）
> - verify 六步全绿 · vitest **1147** · 市场索引 security@0.2.1

> ## 📌 rev173.184（2026-10-26 · 手机端走查：迁移链 + 一个真机才暴露的缺陷）

> 用户「走查手机」。交接卡最后一件缺真机证据的事（vault 迁移链桌面已实测，手机没验过）。

> ### 做了什么

> - 手机 `33b676f6`（24069RA21C · Android 16）：插件目录 `security` 拷入 **0.2.0** 的 `index.js`
>   （70475 B · md5 `52f8f4c3…`；manifest 无 `sha256` ⇒ 不用同步哈希），reload 后 13 条 `security.*` 命令齐全。
> - 测试库 `/storage/emulated/0/Documents/ZeroNote`（**不是** app 私有 `vault/`，那个是空的旧库）：
>   `.zn/security/vault.json` 897 B · `v:1` · 只有 secrets 一把环 · 已绑指纹 `d9c0b875-…`。
> - 面板解锁（`PhoneTest123`）→ 换主密码（→ `PhoneTest1234`）→ 观察磁盘 → 再换回 `PhoneTest123`。

> ### 结果

> | 检查 | 结果 |
> |---|---|
> | `vault.secrets.json` 生成 | ✅ 825 B · `v:2` + 单环 `ring` · 新 salt |
> | `biometrics[d9c0b875-…]` 保留 | ✅（换密码不碰生物识别段） |
> | 旧 `vault.json` 删除 | ❌ **没删掉**（同一操作桌面删掉了） |
> | reload 后解锁 | ✅ 新密码、换回旧密码都能解 |
> | 指纹 | ✅ 面板「本机已绑定」；点「用指纹解锁」唤起系统指纹界面 |

> ### 缺陷：迁移收尾在 Android 上静默失败

> `saveVault` 最后一步 `purgePrivate(LEGACY_VAULT_FILE).catch(() => {})` —— 删除失败被吞掉，
> 面板照样显示「主密码已换」。手机上换密码后旧 `vault.json` 仍在；但**同一路径手动
> `invoke('purge_private', {path:'.zn/security/vault.json'})` 返回 OK 并真的删掉了** ⇒ 不是权限问题，
> 是那一刻的调用没生效（`exists` 判空或 purge 失败），且**没有任何提示**（硬约束 4：静默失效比报错危险）。
> 影响：旧单文件残留 ⇒ 同步插件（rev173.164）仍会把它当私有文件搬；备份也会把它收进去。
> 修法（下轮）：purge 不要静默；写完后 `exists` 复核一次，仍在就重试 + 状态栏报错。

> ### 可疑现象（待查）

> - 旧 `vault.json` 在 23:07–23:23 之间反复「复活」：每次 mtime = 当前时间、**内容与迁移前逐字节相同**
>   （md5 `90cb95d7…`）。源疑似 `.zn/backups/<旧备份>/_secret/vault.json` —— 把那份删掉后 70 秒观察不再复现；
>   但主窗口的 invoke hook（`write_note` / `copy_entry` / `purge_private`）**没抓到任何调用** ⇒ 写入者
>   不是主 webview 里的插件，或发生在 hook 之前。
> - 启动后 60 秒内打出**两份**自动备份：`2026-10-26T23-20-38` 的 meta 缺 `dirNames`、带 `protected: false`；
>   `23-20-39` 正常。前者像 **旧版 backup 代码**的产物，待查（可能与「内置版覆盖全局目录」有关）。

> ### 状态

> - 手机 `.zn/security/` 里**仍有旧 `vault.json`**（897 B · 迁移前内容）。0.2.0 的 `loadVault` 优先读
>   `vault.secrets.json` ⇒ **不影响解锁**；但它就是上面那个待修缺陷的表现 —— 手动删掉后还会被「复活」
>   （23:30 又一次观察到：从指纹界面 BACK 回 app 之后出现）。
> - `vault.secrets.json`（`PhoneTest123` 包裹）已验解锁 ✅（新密码 / 换回旧密码都解过）。
> - 迁移前备份在 `/storage/emulated/0/Documents/zeronote-phone-backups/security-backup-20261026-2312/`
>   （**库外**，避免被备份 / 同步扫进去）；手机插件 `security` = 0.2.0（app 私有目录，junction 用不上）。
> - 指纹要真人按：AI 只能把系统指纹界面唤起（黑底圆环那版），按下去的是用户。

> ## 📌 rev173.183（2026-10-26 · 期 3 实测：vault 按环拆的迁移链）

> 用户「继续」。rev173.182 三件事都落地了，但交接卡点名**两件没有真机证据**：迁移链、手机端走查。这轮做前者。

> ### ① 先让桌面 dev 真的加载 0.2.0

> 全局插件目录里的 `security` 是 **0.1.2 的拷贝**（入口 sha `be8f6d24…`，manifest 版本 0.1.2）——
> 不改它、reload 一万次也测不到新代码（交接卡「全局目录是拷贝不是链接」那条正是这个坑）。
> 做法：备份旧目录 → 删掉 → **junction 指向 `examples/security`**（0.2.0 那份 manifest **没有 `sha256` 字段**
> ⇒ 加载时不校验入口哈希，与手机那份「无 sha」同理）。reload 后 `__znKernelAudit()` 里 13 条
> `security.*` 命令齐全，面板可开。

> ### ② 迁移：换一次环的密码就够了

> 迁移的触发点只在 `saveVault`：`loadVault` 读到旧单文件只是**用**它，不动盘。
> 必须做一次「会保存」的操作 —— 换主密码（`doChangePassword` → `saveVault(..., ring.id)`）。
> 测试库 `_tmp-vault-tb` 的旧 `vault.json` 是 1539 B、`v:1`、`rings=secrets,notes`、secrets 已绑本机 Hello
> （`16c9a8a9-…`），正好覆盖「带生物识别绑定」的迁移路径。

> | 检查 | 结果 |
> |---|---|
> | `vault.notes.json` | ✅ 出现 · 560 B · `v:2` + 单环 `ring` |
> | `vault.secrets.json` | ✅ 出现 · 880 B · `v:2` + 单环 `ring` |
> | 旧 `vault.json` | ✅ 消失（只剩历史的 `.bak-20261026001719`） |
> | notes 的 KDF salt | ✅ 与旧文件**逐字相同**（`sx0cbv52…`）—— 迁移只搬不改 |
> | secrets 的 KDF salt | 变了（`JANH-O78…` → `VGINrn7G…`）—— 换密码本就重包裹 DEK，符合预期 |
> | `biometrics[16c9a8a9-…]` | ✅ 保留（换密码不碰生物识别段） |
> | `idleLockMs` / recovery 段 | ✅ 原样（notes 180000 / 两环恢复码都在） |

> ### ③ reload 后两环都读得回来

> `location.reload()`（走 CDP）→ 面板「账号密码」用**新密码** `TestPass1234` 解锁 ✅
> → 切「私密笔记」用 `NotesTest123` 解锁 ✅（面板「2 把已解锁」）。这条才是「迁移没把库弄坏」的证据。

> ### ④ 顺带验了「按环写」—— 这才是拆开的目的

> 把 secrets 密码换回 `TestPass123`（避免测试库密码与交接卡记载漂移）：
> `vault.secrets.json` mtime 更新，**`vault.notes.json` 仍是 22:59:05** ⇒ 另一环文件一个字节都没动。
> 两台设备各改一个环时，同步看到的只是各自那个文件变了 —— 不再判冲突。再 reload，secrets 用恢复后的
> `TestPass123` 仍能解锁。

> ### 三个坑

> - **`Ctrl+R` / `F5` 在 ZeroNote 里不会 reload**，且页面外观不变时截图 sha256 完全相同（一开始当成
>   "没生效"，其实两次按键都没到达）。可靠做法：`node tools/cdp.mjs eval "location.reload()"`。
> - **CDP 的 HTTP 端点只认 `node fetch`**：PowerShell 的 `Invoke-WebRequest` / `HttpClient` 对
>   `/json/list` 一律 **404**（「备注」里早就记过，这次又踩了一次）⇒ 别用 PS 的 HTTP 栈探 CDP。
> - **解锁后 60 秒空闲锁会打断"慢慢来"的批量操作**：`type 主密码 → 点解锁`，再慢慢填换密码表单，
>   会在第二步前锁回去（第一次就这样失败在「找不到 `input[placeholder="当前主密码"]`」）。要么在
>   **一条** `cdp.mjs` 命令里串完（`type … click … wait 2600 type … click …`），要么接受中途重新解锁。

> ### 状态

> 测试库回到已知状态：`secrets` 环 `TestPass123`、`notes` 环 `NotesTest123`；旧 `vault.json` 已删，
> 迁移前备份 `_tmp-vault-tb/.zn/security-backup-20261026-225121/`；旧插件目录备份
> `_tmp-plugin-backup/security-0.1.2-20261026-225114/`。全局目录 `security` 现在是
> **junction → `examples/security`**（以后改 examples 自动生效，不用再手拷）。

> ## 📌 rev173.182（2026-10-26 · 私密文件夹期 3：vault 按环拆 / 四后端同步 / 备份）

> 用户「继续」。期 3 三件事：vault 按环拆（数据安全）、四个后端搬私密树、备份包含私密树。

> ### vault 按环拆：为什么这是期 3 里最要紧的一处

> 旧结构两个环的 KDF 参数与包裹的 DEK 都在同一个 `vault.json` 里，而它是**整文件同步**的。
> 两台设备各改一个环的密码（`changePassword` 只重包裹 DEK、数据密文不动）时：
> 两边都改了同一个文件 ⇒ 同步判冲突 ⇒ 取远端 ⇒ **另一边的重包裹丢了** ⇒ 那台设备解不开自己的数据。
> 拆成 `vault.notes.json` / `vault.secrets.json` 之后，两个环各是一个同步单元，改动互不可见。

> 迁移是**读到就迁**：`loadVault` 先读两个新文件（都没有才回落到旧单文件），
> `saveVault` 发现旧文件还在 ⇒ 这次把所有环都写出来、再删旧文件。`saveVault` 现在只写
> **改动的那一把环**（`onlyRing`）—— 这是拆开的意义所在，不按环写等于没拆。

> ⚠️ 兼容性：旧客户端（`security` ≤ 0.1.2）只读 `vault.json`，迁移后会以为"没建环"。
> 与 rev173.173「旧客户端读新结构会认为没绑定」同一类问题，解法也一样：**共用一份 vault
> 的设备都要升级**。

> ### 四后端：判定抽成纯函数，删除两边都传播

> webdav / s3 / git 各加一个 `syncPrivateTree`，sync-folder 在 `SECRET_DIRS` 里放行 `.zn/private`。
> 方向判定抽成纯函数 `decideTreeAction(localFp, remoteFp, baseFp)`（六个返回值），
> 与笔记同步的 `decideSync` **语义一致但不共用**：笔记那边删除不传播（保守），
> 私密树**两边都传播**（`delete-remote` / `delete-local`）—— 私密笔记在面板里删除是真删除，
> 不传播的话同步一轮就复活。Git 那套额外要 sha（GitHub Contents API），`privateTree` 条目带 `sha`。

> ### 备份：`_private/` 与 `_secret/` 同规格

> 整棵密文随包（锁着也能拷），`_meta.json` 多记一个 `private` 计数；恢复按根 / notes / trash
> 三层写回（`fs.listFiles` 不递归，备份时也是分三层列的 —— 两边保持对称）。

> ### 两个坑

> - **memory fs 对不存在的路径返回空串**：私密树读盘若把空串当"本地有"，会白推一个空文件
>   （`空笔记也能同步` 用例抓到）。统一按 `raw && raw.trim()` 判"有"。
> - **测试里的模块级 baseline**：`baseline` 是插件模块级的（真实环境一个 webview 一份），
>   同一测试里两个 device 共用它 ⇒ 换 device 同步前必须重新 `apply`（从各自 store 恢复），
>   否则 B 会拿 A 的 baseline 判成"B 删过"去删远端。双设备用例因此改成「A 推 + 纯函数判定」，
>   端到端只保留单设备那条。

> ### 未做

> 发市场打包：`security` 0.2.0 / `sync-webdav` 0.3.2 / `sync-s3` 0.4.2 / `sync-git` 0.5.2 /
> `sync-folder` 0.3.4 / `backup` 0.3.1 版本号已 bump、`gen-catalog` 已重生成，但 `market/packs/`
> 还没重打（`pack-plugin.mjs` + `gen-market.mjs --write`）。手机端也没走查（改的是纯 JS，reload 即生效）。

> ## 📌 rev173.181（2026-10-26 · 私密文件夹期 2：搜索 / 回收站 / 移入移出）

> 用户「继续」= 做期 2（上一轮结尾给的选择）。期 1 的三块地基（codec / `.zn/private/` 布局 /
> `notes` 环）都不用动，这轮纯粹是插件自己的功能。

> ### 搜索：为什么不进内核索引
>
> 需求 §3.3 要求「独立搜索入口」。内核 `index.scoped('private')` 虽然能做分区，但**重建时必须
> 再解密一遍全库**（索引在内存里、reload 就没了）。而且"明文进索引"本身与"不落盘明文"打架 ——
> 所以插件自己维护 `plainCache`：**懒加载**（第一次搜索才逐篇解密）、**锁定清空**、`doc.on('save')`
> 顺手更新（保存后的正文就是事件里那份，不用再解一次）。

> ### 回收站：删除不解密
>
> `fs.move` 把 `notes/<id>.zn` 搬到 `trash/<id>.zn` —— 密文搬家，锁定状态下也能删。
> 索引里 `trash` 段比 `notes` 多存一个 `deletedAt`，并**保留原始 createdAt/updatedAt**
> （恢复后列表排序不跳）。彻底删除两步确认，与备份恢复同一套。

> ### 移入：明文不能留在全局回收站
>
> 第一直觉是「移入 = 写密文 + `fs.delete` 原文件」（进全局回收站，可撤销）。问题是**全局回收站
> 里的条目是明文** —— 移入私密却把明文留在 `.zn/trash/` 里，等于没加密。所以 `delete` 之后
> 立刻按 `originalPath` 找到那条再 `purgeTrash`。顺序铁律：**密文写成功之后才动原文件**，
> 其中任何一步失败都不会丢内容（最坏是原文件还在 + 多一份密文）。

> ### 单测抓到的真 bug（值得记）
>
> `upsertNote` / `removeNote` 返回新索引时**没带 `trash` 段**。而 `upsertNote` 在 `onDocSaved`
> 里**每次保存都跑** ⇒ 用户删一篇进回收站、然后随便编辑另一篇保存一下，回收站条目就从索引里
> **整段消失**（磁盘上的密文还在，变成没人认领的孤儿）。期 1 时没有 trash 段所以不显形，
> 这轮加回收站才暴露。反向用例：`moveToTrash 对不存在的 id 是 no-op`。

> ### 实测（`_tmp-vault-tb` · 真 Argon2 · 18 条命令全部注册）
>
> | 场景 | 结果 |
> |---|---|
> | 搜「开会」 | 命中正文，片段「今天开会讨论了预算和排期。」· 只列 1 篇 |
> | 搜「今天 面包」 | 「没有匹配的私密笔记」（两词分属两篇，AND 不成立） |
> | 搜「清单」 | 标题命中「购物清单」 |
> | 删除 | 磁盘 `notes/` → `trash/`，面板回收站只列该篇 |
> | 恢复 | 两个文件都回 `notes/` |
> | 两次 `purge` | 第一次按钮变「真的删？」+ 文件还在；第二次文件消失 |
> | 移入（公开笔记 → 私密） | 库根文件消失 · 私密 +1（136 B 密文）· **全局回收站里没有它** |
> | 移出（私密 → 公开） | 库根出现「要移入的笔记.md」，内容逐字正确 |
>
> 测试数据已清（`.zn/private` 整个删掉、移出产生的测试文件删掉），全局 junction 已卸。

> ### 未做
>
> 期 3：`vault.json` 按环拆 + 四后端同步 `.zn/private/` + 备份包含私密树。

> ## 📌 rev173.180（2026-10-26 · 私密文件夹期 1 + 内核 `doc.registerCodec`）

> 用户「继续zeronote」。接手时 rev173.179 已收口、工作树干净、verify 全绿；交接卡的「下一步」三条
> 全卡外部输入（sync-git 手机端 / Gitee 令牌 / 记账样本），ROADMAP §3.0 里唯一不依赖外部条件的
> 大项就是**私密文件夹**（需求 §3.3 七条 + §10.1 加密同步）。
>
> ### 先写方案，把架构分叉摆出来（`docs/私密文件夹-方案-2026-10-26.md`）
>
> 关键发现：`security` 早已预留 `notes` 环（3 分钟锁）与「入口由后续插件调用」的注释，方案 §4.5
> 的表格里容器 id 写的是 `private` 而代码建的是环 id —— 这类偏差现在记在方案 §7-2。
> 三个决策：**D1 加密粒度**（每篇一密文 vs 整包，推荐前者）· **D2 编辑怎么接内核**（★ 真分叉）·
> **D3 同步怎么拆**（vault.json 按环拆，无分叉）。用户拍板 **D2 = A：内核加通用钩子**。
>
> ### 内核改了什么（4 处，全是"真读写磁盘"的必经点）
>
> `src/kernel/doc-codec.ts`（新，约 170 行）+ `contract.ts` 的 `DocApi.registerCodec`：
> 读盘后 `decodeForOpen`、写盘前 `encodeForSave`。接入点：
> `useDocSession.openNote` · `useDocIO.saveNow` · `useDocIO.reloadActiveFromDisk` · `useDocIO.mergeWithDisk`。
> 草稿三处加 `isTransientPath` 守卫（localStorage 是明文）。
>
> **两条安全线值得单独记**（`tests/doc-codec.test.ts` 有反向用例）：
> ① `openedVia` 记账 —— 打开过某 codec 的路径，codec 被卸载后**读与写都抛错**。没有它的话，
> 插件禁用后用户点保存 ⇒ 密文被明文覆盖，静默丢安全属性；
> ② `transient` 必须由 codec 自己声明 —— 内核无法判断"这个内容敏不敏感"。
>
> ### 插件（`examples/private-notes/`，约 560 行）
>
> `.zn/private/{index.zn, notes/<id>.zn}`：索引也加密（标题不落明文），文件名是 base36 随机 id。
> 用 `crypto` 服务的 `notes` 环；`doc.on('save')` 回填索引标题与时间。
> 面板三态：没服务（降级指引）/ 锁定（主密码，环没建则引导去 security）/ 列表。
>
> ### 实测（dev CDP · 真 Argon2 · 测试库 `_tmp-vault-tb`）
>
> 1. 建 notes 环：security 面板切「私密笔记」→ 两次密码 → 建立 ⇒ `vault.json` 出现 `notes`
> 2. 私密面板 `private.recheck` → 输密码 → 「已解锁 · 0 篇」
> 3. 「＋ 新建」⇒ 磁盘立刻出现 `index.zn`（207 B）+ `notes/mvpbqrsjr7tz.zn`（59 B，空正文）
> 4. 写入「# 第一篇私密笔记 / 这是加密存储的正文。」→ 保存 ⇒ 密文 59 → **132 B**，
>    **含中文 = False · 含 `#` = False**（明文检查）
> 5. 关文档回面板 ⇒ 列表出现「第一篇私密笔记」（索引解密 + save 回填都生效）
> 6. 重新打开 ⇒ 编辑器明文逐字正确
> 7. `private.lock` ⇒ 当前文档自动关闭；**锁定后** `core.openNote` 直接打开 `.zn/private/notes/…`
>    ⇒ 编辑器不打开、界面显示「已锁定 —— 先在面板里解锁」（密文没被喂进去）
>
> 测试数据与全局 junction 已清理（源码留在 `examples/`）。
>
> ### 两条坑
>
> - **库内 `.zn/plugins/` 不再被扫描**（rev173.5 起只有全局根）。第一版把 junction 建在测试库里，
>   reload 后命令表里没有 `private.*` —— 改挂 `%APPDATA%\com.aqua.zeronote\.zn\plugins\private-notes`
>   立刻加载。CARD 里「测试插件只放 examples/」的前提是**挂到全局目录**。
> - `core.panel.<id>` 对 main 面板可用，但 **CDP 点按钮**时坐标会撞到别的元素（`text:打开` 撞上了
>   标题行）；改用 `__znExec('private.open-note', {id})` 直接调命令才验证到真实链路。
>
> ### 未做
>
> 期 2（独立搜索 / 回收站 / 移入移出）· 期 3（`vault.json` 按环拆 + 四后端同步 `.zn/private/`
> + 备份包含私密树）。方案 §5 有估时。

> ## 📌 rev173.179（2026-10-26 · 预装范围成文 · 移出 5 个「增强」插件）

> 用户复盘时提出：「预装的只有那些完善系统功能的插件」——一查才发现，**这条规则从来没落过文档**。
> 它只存在于安全插件开发期（rev173.160–161）的会话里，原文是：
>
> | 类别 | 建议 |
> |---|---|
> | 核心体验（标签 / 反链 / 历史 / 同步 ×4 / 导入导出） | 预装（离线可用） |
> | 增强（大纲 / 文档阅读器 / 记账 / 主题） | 可以逐步移市场 |
> | 安全 / 密码库 | 市场 + 「官方」标识（用户主动选择） |
>
> 理由（用户原话的意思）：安全类涉及隐私，用户应当**知情选择**；它不是「没有就不能用」的功能；
> 预装一个加密插件反而**暗示「我的笔记默认不加密」**，容易误导。
>
> ### 我犯的错
>
> 因为规则没落文档，加备份插件时我把它当成「要不要走市场」重新问了一遍 —— 用户回「预装策略前面不是改过了吗」。
> 这轮把它写成 `docs/decisions/D-010-预装范围.md`，以后有据可查。
>
> ### 执行
>
> | 类别 | 插件 | 处置 |
> |---|---|---|
> | 核心体验 | 标签 · 反链 · 历史 · 导入导出 · 同步 ×4 | 预装（不动） |
> | 核心体验 | **备份** | 预装（新增；不碰隐私、不暗示风险，是「数据会丢」的地基） |
> | 增强 | 大纲导图 · 文档阅读器 · 记账 · 米色主题 · **打卡** | **移市场**（rev173.179） |
> | 安全 | security · secrets | 已在市场 |
>
> **打卡**是规则里没点名的一个：它和记账同类 —— 业务功能，不是系统能力，所以按「增强」处理。
>
> ### 代码改动
>
> `src/kernel/builtin-plugins.ts` 删 5 条注册 + 5 组 `?raw` 导入，**预装 14 → 9**。
> 五个插件的源码仍在 `examples/`，市场包都在（`outline-map@0.2.0` / `doc-reader@0.1.0` /
> `accounting@0.1.0` / `theme-sepia@0.1.0` / `habit@0.1.0`）。
>
> **已装环境不受影响**：`ensureBuiltinPlugins` 只是不再写内置版；全局插件根里已有的目录不会被动
> （撤销内置 ≠ 卸载用户插件）。
>
> ### 以后加新插件怎么判（写进 D-010）
>
> 1. 没有它应用还完整吗？不完整 ⇒ 核心体验，可预装
> 2. 它是「某个用途」⇒ 增强，走市场
> 3. 涉及隐私 / 加密 / 凭据 ⇒ 安全类，走市场 + 官方标识
> 4. 判不准 ⇒ **先走市场**（后补预装容易，反过来难：用户装过的东西不能悄悄改成内置版）

> ## 📌 rev173.178（2026-10-26 · 备份登记为预装第 14 个）

> 用户拍板「预装」，并提醒：**预装策略前面已经改过了** —— 是的，rev173.161 定的是
> 「**预装与市场不互相替代**：预装 = 离线 / 首启可用 + 版本确定；市场 = 扩展 / 更新」，
> 只有**安全类**（`security` / `secrets`）特意走市场（用户当轮拍板）。
> 我上一轮把备份也归到「要不要走市场」里问了一遍 —— 那是个多余的问题，这里记一笔免得再犯。
>
> ### 改动
>
> - `src/kernel/builtin-plugins.ts`：加 `backup` 的 `index.js` / `manifest.json` 两行 `?raw` 导入 +
>   注册表一条。App 启动时 `ensureBuiltinPlugins` 把它写进全局插件根
>   （`appDataDir()/.zn/plugins/backup/`）。
> - 预装数 **13 → 14**：README 现状行、CARD「预装 14 个」、`docs/功能目录.md`（gen-catalog 重生成）、
>   FACTS 块（facts --write）。
>
> ### 为什么预装而不是发市场
>
> 备份是**数据安全地基**：一个刚装好、还没逛过市场的新用户，也该在「误删一个文件夹」时
> 有东西能救。市场解决的是「发现与更新」，不解决「首启就有」。
>
> ⚠️ 已经手装过开发版的环境不受影响 —— `ensureBuiltinPlugins` 先比内容，一致时零写入（rev173.147）。
>
> ### 文档债
>
> `docs/功能目录.md` 由 `scripts/gen-catalog.mjs` 生成，内置表会自动多一行 `★ backup`。

> ## 📌 rev173.177（2026-10-26 · 备份 v3：恢复）

> 需求 §14.2 要「恢复时整体覆盖当前所有数据 + 恢复前自动备份当前数据 + 快照不占 30 份限额」。
>
> ### 顺序：先保命，再动刀
>
> | 步 | 动作 | 为什么这个顺序 |
> |---|---|---|
> | ① | 把当前库存成 `pre-restore-<时间>` | 恢复本身也是「破坏性操作」—— 恢复错了得能回去 |
> | ② | 当前内容 `fs.delete` 进**回收站** | **不是物理删**：用户当场能撤销，回收站可清空 |
> | ③ | 从备份拷回顶层文件 + `dirNames` 里的子目录 | 覆盖面与备份时一致 |
> | ④ | 密码库密文写回 `.zn/secrets` / `.zn/security` 原位 | 那两个是密文，原样搬 |
>
> **不占 30 份**靠名字前缀：`pre-restore-` 开头的快照在 `pickStale` 里被直接跳过，
> 轮换永远删不到它（需求原文「这个恢复前快照不占用最近 30 份自动备份的限额」）。
>
> ### 两步确认（不是弹框）
>
> UINode 没有 modal confirm 原语，而恢复是**覆盖整库** —— 一次误点就够呛。所以做成
> 「上膛 → 再点一次」：第一次点按钮变红 + 状态栏提示，第二次点同一份才真执行；
> 点别的备份 / 刷新会清掉上膛态。
>
> ### `dirNames`：为什么备份必须记目录名
>
> `fs.listDirs()` 的 `collect_dirs` 跳过 `.` 开头的目录 ⇒ **`.zn/backups/<name>/*` 的子目录列不出来**。
> 恢复时只能靠 `_meta.json` 里的 `dirNames` 知道要拷回哪几个目录。
> **旧备份（rev173.175/176 打的）没这个字段 ⇒ 检测到 `dirs > 0 && dirNames 为空` 就明确拒绝**，
> 而不是恢复完发现文件夹没了（硬约束 4）。
>
> ### 实测（`_tmp-vault-tb` · 桌面 dev）
>
> 第一轮**抓到真 bug**：`fs.listFiles(dir)` 返回的是**库内相对路径**（`.zn/backups/x/_meta.json`），
> 不是裸文件名 —— 我又拼了一次 `${DIR}/${name}/${f}` ⇒ 路径变成
> `.../zn/backups/.../zn/backups/...`，恢复后**库是空的**，面板报「源不存在」。
> 当时库里只剩 `.zn`（内容全在回收站 + pre-restore 快照里，没丢）。
>
> 修法是取 basename 后重跑（用那份 pre-restore 快照当源）：
>
> | 验证 | 结果 |
> |---|---|
> | 库根文件 | 17 个全回来 |
> | 子目录 | `笔记` 9 / `工作` 4 / `灵感` 2 / `文档` 2 / `学习` 3，与备份逐项一致 |
> | 总文件 | 38（37 + 一个恢复测试用的标记文件） |
> | 密码库 | `secrets.zn` / `vault.json` 原样 |
> | 快照 | `pre-restore-*` 出现在列表并标「恢复前」 |
>
> vitest 1094 → **1099**（+5：快照不参与轮换 / 前缀解析 / pre 标记 / 上膛文案 / 旧备份形状）。
>
> ### 这个功能真正的价值
>
> 这轮实测本身就是它的第一次实战：**一次写错的恢复把库清空了，靠它自己的 pre-restore 快照救回来**。

> ## 📌 rev173.176（2026-10-26 · 备份 v2：自动备份档位）

> 需求 §14.1 要「自动备份 + 九个固定档位（默认每天）」。这一版补上。
>
> ### 关键设计：为什么不是「按档位设一个长定时器」
>
> 插件活在页面里，**页面关掉定时器就没了** —— 契约没有定时原语，也没有后台服务
> （「到点提醒不做」就是同一条约束）。所以：
>
> - 每 **60 秒**看一次「到期没有」（`TICK_MS`）；
> - **启动时先补做一次** —— 关机一夜后重开，立刻补一份，而不是再等一整天；
> - 到期判据 `isDue(lastAt, interval)`：`lastAt = 0`（从没备过）视为到期。
>
> 空库跳过（`listNotes` 与 `listDirs` 都空）—— 新装应用不该每次启动塞一份空备份。
> 手动备份也刷新 `lastAt`，否则点完「立即备份」60 秒后自动又来一份。
>
> ### 档位
>
> | value | 说法 | ms |
> |---|---|---|
> | 1h / 3h / 6h / 12h | 每小时 / 每 3 / 6 / 12 小时 | 3.6e6 … 43.2e6 |
> | **1d（默认）** | 每天 | 86400e3 |
> | 2d / 3d | 每 2 / 3 天 | 172800e3 / 259200e3 |
> | 1w | 每周 | 604800e3 |
> | 1mo | 每月（按 30 天） | 2592000e3 |
>
> 「每月按 30 天」是刻意的：备份间隔不需要对齐日历，对齐反而让「下次什么时候」难解释。
>
> ### 一个宿主约束（先说清，免得以后误判）
>
> `select` 的值来自宿主 `ctx.state[bind]`，插件**没有**直接写它的接口 ⇒ 首次渲染 state 为空时
> 浏览器会选中**第一项**。所以 `selectOptions()` 把**当前档位排第一**，画面才和真实配置一致
> （否则设的是「每周」而控件显示「每小时」）。这一条有单测锁着。
>
> ### 实测（`_tmp-vault-tb` · 桌面 dev）
>
> | 步骤 | 结果 |
> |---|---|
> | 装 v2 → reload | 自动补一份 `20:20:51 · trigger:auto · 389 ms`（此前 2 份 → 3 份） |
> | **再 reload 一次** | **仍是 3 份** —— `lastAt` 持久化生效，不会每次启动都备 |
> | `backup.set-interval { value:'1h' }` | 面板：「自动备份：每小时 · 上次 10-26 20:20 · 下次 10-26 21:20」 |
> | 面板 | 「备份 3 / 30」+ 下拉「每小时」+ 三行（20:20:51 **自动** / 14:31:29 / 14:21:58 手动） |
>
> vitest 1086 → **1094**（+8：九档 / 未知回落 / 从没备过 / 到期边界 / dueAt / selectOptions / dueText 三态）。
> **踩坑**：第一版计时器用了 `window.setInterval` ⇒ vitest 的 node 环境没有 `window`，
> 测试虽全过但报了 3 个 unhandled rejection。改用全局 `setInterval` 后干净。
>
> ### 待做
>
> - **恢复**（整体覆盖 + 恢复前自动快照不占 30 份）
> - 内置还是发市场

> ## 📌 rev173.175（2026-10-26 · 备份插件 v1 —— 需求 §14.1 的遗留项）

> 复核需求文档时发现：§18 阶段 3 要求「备份插件」，但 `docs/ROADMAP.md` 候选池里**从来没有这一项**
> —— 它在交接里丢了。这条补丁先把「能备份」做出来（恢复与定时下一 rev）。
>
> ### 备份长什么样
>
> ```
> <库>/.zn/backups/
>   index.json                  ← 清单（列表的唯一来源）
>   2026-10-26T14-21-58/
>     <库根所有文件 + 一级目录>    ← 笔记 / 附件，明文
>     _secret/secrets.zn         ← 密码库密文（有才拷）
>     _secret/vault.json         ← KDF salt + 被主密码包裹的 DEK
>     _meta.json                 ← { at, trigger, notes, dirs, files, secret, ms }
> ```
>
> ### 三条设计决定（各自都有具体理由，别随手改）
>
> | 决定 | 理由 |
> |---|---|
> | **明文 + 密文原样搬，不自己再加一层加密** | 密码库本来就是我方 XChaCha20-Poly1305 密文，钥匙是主密码；再包一层会要求「备份时也知道主密码」——锁屏/未解锁时就没法自动备份。所以「加密复用主密码」 = **拷密文** |
> | **清单放 `index.json`，不靠列目录** | `fs.listDirs()` 的实现 `collect_dirs` 第 4 行就 `name.starts_with('.') ⇒ continue` ⇒ `.zn/backups/*` **永远列不出来**；`fs.listFiles('.zn/backups')` 能读该目录下的文件（`list_files` 不跳过 `.zn`） |
> | **新开 `purge_backup` 而不是复用 `purge_private`** | 后者只删文件与**空**目录（`fs::remove_dir`），备份是几十个文件的树；`delete_note` 会把它搬进回收站，30 份轮换会把回收站塞满 |
>
> ### 实测（`_tmp-vault-tb` · 桌面 dev · CDP）
>
> | 步骤 | 结果 |
> |---|---|
> | `backup.run` | 目录 `2026-10-26T14-20-04/` 出现；**40 个文件 = 源库 37 + `_meta.json` + `secrets.zn` + `vault.json`**（逐项核对，6 个子目录全在） |
> | `index.json` | `{ notes: 37, dirs: 6, files: 17, secret: true, ms: 247 }` |
> | 面板 | 「备份 1 / 30」+「已备份 37 篇 · 6 个文件夹 · 含密码库密文 · 247 ms」+ 行内徽标（37 篇 / 6 个文件夹 / 含密码库 / 手动 / 删除） |
> | `backup.remove` | 目录删除、清单变空；再跑一次 `backup.run` ⇒ `14:21:58` · 225 ms |
>
> ### 踩坑
>
> **插件入口必须叫 `apply(api)`**（宿主判定 esm 形态：`export default { apply }` / `export function apply` /
> `module.exports = function (api)` / `registerPlugin({ register })`）。第一版写成 `activate(api)` ⇒
> 插件页里**看得见**（「备份 v0.1.0 未签名」，还能勾选），但顶部报
> 「入口没有可用的 apply()」、命令一条都没有 —— 这种「看得见但用不了」最容易误判成扫描没生效。
>
> ### 待做（下一 rev）
>
> - **定时档位**：1h / 3h / 6h / 12h / 每天 / 2 天 / 3 天 / 每周 / 每月，默认每天（需求 §14.1）
> - **恢复**：整体覆盖 + 恢复前自动快照（不占 30 份），当前内容先进回收站
> - **内置还是发市场**：待用户拍板（现在是 examples + 手装全局目录）

> ## 📌 rev173.174（2026-10-26 · 发版 0.6.0）

> 0.5.0 之后 **57 个提交**（rev173.137–173）一次收成版本号。
>
> ### 内容
>
> | 主线 | 落点 |
> |---|---|
> | 安全 / 密码库 | `security`（双密钥环 · XChaCha20-Poly1305 + Argon2id · AAD 绑定）· `secrets`（整库加密 · 生成器 · 复制 60 s 清剪贴板 · 空闲 60 s 自锁）· Android 指纹 / Windows Hello 解锁 · 锁定后自动弹 · 绑定按设备 |
> | 插件市场闭环 | 签名 v2 · 打包签名索引 · 应用内「发现」tab · 公钥内置 · 仓库开源（MIT）· 包入库走 raw · 第二批 UX（详情页 / 更新角标 / 24h 检查） |
> | 配套 | CI 从「一直红」修到全绿（`localeCompare` 不传 locale）· HANDOFF 分卷 890 KB → 63 KB · ROADMAP 收口 |
>
> ### 这次真正做的事
>
> `[Unreleased]` → `[0.6.0]`，但**原段落只记了「锁定后自动弹」和「按设备」** —— 两个插件本体
> （rev173.160 `security` / rev173.163 `secrets`）、Android 指纹（168）、Windows Hello（169）、
> KDF 定档（165）**一条都没进 CHANGELOG**。发版前补了这五条主线（约 130 行），并把散落的两个
> `### Added` 收成一套 Added / Changed / Fixed。
> 版本三处（`package.json` / `tauri.conf.json` / `Cargo.toml`）+ `Cargo.lock` → 0.6.0；
> README 现状行 → rev173.174 · 0.6.0，顺手补了安全段门面描述（之前完全没提密码库）。
> GitHub Release `v0.6.0` 已建（无资产，正文 = CHANGELOG 的 `[0.6.0]` 段，标 Latest）。
> ⚠️ **发版固定动作里要带上 Release**：v0.4.0 有、**v0.5.0 漏了** —— 只在 `release.mjs` 打 tag 不会建它。
>
> ### 踩坑
>
> - **`Set-Content` 拼接 CHANGELOG 会把整文件写成 CRLF**（仓库是 LF）⇒ 要
>   `[System.IO.File]::ReadAllText` + `-replace "\`r\`n", "\`n"` 再写，否则 diff 全是行尾噪音（本次已修）。
> - **改 `Cargo.toml` ⇒ dev 自动重编重启**：pid `28892` → `6772`（13:50:49），属预期行为。
> - **本地 verify 绿 ≠ CI 绿**：这次 verify（13:51:24 绿）跑完之后才补上「索引行 + 正文段」，
>   所以本地 check-docs 绿、CI 的 check-docs 红（`索引有 rev173.174 但正文无对应段`）。
>   **教训**：`verify.ps1` 之后只要动过 `HANDOFF.md` 的结构（索引表 / 正文段），必须**重跑 check-docs**。

> ## 📌 rev173.173（2026-10-26 · 生物识别「按设备」）

> 卡片下一步 ①：`biometric` 段做成按设备 —— 换机只失效那一台。
>
> ### 数据结构
>
> ```json
> rings.<id>.biometrics = {
>   "<deviceId>": { "platform": "windows", "wrapped": "hello1.…", "at": 1730000000000 }
> }
> ```
>
> - **本机 id 放凭据管理器**（`api.host.secrets` → `secret_get/set` → Windows 凭据管理器 / Android Keystore）：
>   不随库同步、不进 `vault.json`。丢了（清凭据 / 重装）只让这一台的绑定失效。
> - **旧单段兼容**：`migrateBiometrics(vault, deviceId)` 在 `apply()` 里一次性把 `biometric` 迁到
>   `biometrics[<本机>]` 并落盘；迁移默认「旧段就是这台机器」⇒ 原机升级后照常用指纹。换机过来的 vault 会
>   AEAD 失败并提示重绑（与改造前同一条引导），但**不再覆盖**原机器的绑定。
> - 解除只删当前设备那一格；`otherDeviceCount` 给 UI 提供「别的 N 台已绑定」。
>
> ### 界面
>
> | 状态 | 面板 |
> |---|---|
> | 本机已绑 | badge **本机已绑定** + 「用指纹解锁」 |
> | 只有别的设备绑过 | badge **别的 N 台已绑定** + caption「这台设备还没绑定（互不影响）」+ **不显示**指纹按钮 |
> | 已解锁 | 「绑定本机指纹」/「解除本机指纹」；有别的设备时提示「解除只影响这台」 |
>
> ⚠️ **跨版本共存**：迁移会**删掉旧单段** `biometric` ⇒ `security` ≤ 0.1.1 的客户端读到新库会认为「没有绑定」
> （指纹按钮直接消失、**不报错** —— 静默失效）。同一把 vault 经同步插件在两台设备间搬时，两端都要 ≥ 0.1.2。
>
> ### 实测（`_tmp-vault-tb` · 0.1.2 市场包）
>
> | 步骤 | 结果 |
> |---|---|
> | 装 0.1.2 → reload | `secret_get` 生成 `deviceId=16c9a8a9-…`；`vault.json` 旧 `biometric` 消失、出现 `biometrics["16c9a8a9-…"]`（原 Hello 包裹原样搬过去） |
> | 面板 | 「本机已绑定」+「用指纹解锁」 |
> | 伪装另一台：`secret_set zeronote.device.id = fake-other-device` → reload | 「别的 1 台已绑定」+ caption；**没有**指纹按钮（旧版会显示、点了才报 AEAD） |
> | 切回原 id → reload | 「本机已绑定」+ 按钮回来；点击 ⇒ Hello 正常弹出（`_shots/device-binding-hello.png`） |
> | 按指纹（**用户真人**操作；Hello 受保护 UI，合成输入触达不到 —— 见 rev173.171） | 面板「「账号密码」已用指纹解锁」、1 把已解锁 —— **迁移过来的旧包裹在新结构下解出同一把 DEK**；按钮变「解除本机指纹」 |
>
> ### 手机端（`33b676f6` · 0.5.0 dev 包）
>
> `security` 换 0.1.2（`adb push` + `run-as cp`；手机上那份 manifest 无 `sha256`，不用同步）→ `adb forward 9333` → reload：
> 旧单段自动迁到 `biometrics[<手机 deviceId>]`，面板 **「本机已绑定」+「用指纹解锁」** ⇒ 迁移在 Android 上同样成立。
>
> 按指纹（**用户真人**）：面板 **「「账号密码」已用指纹解锁」、1 把已解锁** ⇒ Android Keystore 的包裹在新结构下
> 解出同一把 DEK，按钮变「解除本机指纹」。
>
> ### 交付
>
> `security` **0.1.2** 打包发市场（`market/packs/security-0.1.2.znp` · 69.3 KB · 整包 sha256 `ccd173b1…`）+ 索引重建。
> vitest 1064 → **1067**（+3：两台设备各绑各的 / 解除只删本机 / 旧单段迁移；原有 7 条按设备改造）。

> ## 📌 rev173.172（2026-10-26 · 安全插件 0.1.1 发市场）

> 用户选「重新打包签名 + 更新市场索引」。rev173.171 的代码此前只跑在开发版上，市场里的 `security-0.1.0.znp` 还是 rev173.169 的内容。
>
> ### 做了什么
>
> | 步骤 | 结果 |
> |---|---|
> | 版本 | `examples/security/manifest.json` 0.1.0 → **0.1.1**（同版本号内容不同，已装用户不会收到更新提示） |
> | 打包 | `node scripts/pack-plugin.mjs security --key <私钥> --key-id aqua-2026` ⇒ `market/packs/security-0.1.1.znp`（64.3 KB） |
> | 索引 | `node scripts/gen-market.mjs --write` ⇒ 官方 15 条，security@0.1.1，整包 sha256 `30829bc34447bb6d61f79cb9306d0fa227a54ad3feb09fb1840d61002f0ec698` |
>
> ⚠️ **踩到的坑**：`pack-plugin.mjs` 不给 `--key-id` 时**签成 `keyId=default`**，而 Rust 的 `BUILTIN_TRUSTED_KEYS` 只有
> `aqua-2026`（`src-tauri/src/lib.rs:2247`）⇒ 那样发出去，市场装完**加载时验签失败、插件被拒载**。第一次打包就是 `default`，已重打。
>
> ### 实测安装（不走 UI，直接打 Rust 命令）
>
> 1. 仓库根起 `python -m http.server 8931 --bind 127.0.0.1`（app 默认拉 GitHub raw，推送前看不到本地改动）
> 2. CDP：`install_znp_from_url({ vault: '%APPDATA%\\com.aqua.zeronote', url: 'http://127.0.0.1:8931/market/packs/security-0.1.1.znp', expectedSha256 })` ⇒ 返回 `security`
> 3. 落盘核对：`index.js` 62029 B · `manifest.json` version **0.1.1**、入口 sha256 `b7d4620e…` · `signature.json` keyId **`aqua-2026`**
> 4. 页面 `location.reload()` ⇒ 「安全」插件正常加载、安全面板可开（**签名校验通过**），测试库 31 篇不变
>
> 收尾：停 http.server。
>
> ### 交付
>
> `market/packs/security-0.1.1.znp`（入库走 raw，不挂 Release）+ `market/entries/security.json` + `market/index.json`。
> 旧的 `security-0.1.0.znp` 保留（与 sync-* 多版本并存同一惯例）。

> ## 📌 rev173.171（2026-10-26 · 锁定后自动弹生物识别）

> 用户：「继续 ZeroNote，做锁定后自动弹生物识别」（需求 §13 最后一块）。遮罩是消费者插件（私密文件夹）的画法，`security` 只负责**锁定后自己发起一次验证**。
>
> ### 做了什么
>
> - `examples/security/index.js`：`lockRing()` 之后 `scheduleAutoUnlock()`；判据抽成两个导出的纯函数
>   `shouldWaitForFocus` / `planAutoUnlock`（返回 `'go' | 'wait' | 'skip'`）—— 五条「不弹」：没绑指纹 /
>   没适配器 / 已解锁 / 正在派生密钥 / `reason:'service'`；**桌面失焦先挂起等 `focus`，手机只看可见性**。
> - 自动弹 600 ms 后再核一遍（这几百毫秒里用户可能自己解锁了 / 开始输主密码），`cancelAutoUnlock()` 挂到三处：
>   手动点「用指纹解锁」、走主密码解锁、锁定时清空 `pw1` 输入框（`clearInputs`）。
> - 自动弹被取消 ⇒ 中性提示「已取消 —— 输入主密码，或点「用指纹解锁」」（不刷红字）；手动点按钮仍按原语义报错。
> - `apply()` 里挂 `visibilitychange` + `focus`，`dispose()` 里移除；锁定时挂起的那一次在用户回来时补弹，超过 5 分钟作废。
>
> ### 实测（桌面 `_tmp-vault-tb` · Windows Hello）
>
> | 步骤 | 结果 |
> |---|---|
> | 主密码解锁 secrets 环（`TestPass123`） | 面板「1 把已解锁」 |
> | 空闲 60 s 自动锁（**窗口失焦**） | 「0 把已解锁」；**没有** Hello 对话框（`_shots/auto-bio-locked.png`）—— 挂起生效 |
> | 点回窗口 → 600 ms | **Windows Hello「确保那是你」弹出** + 面板「正在请求指纹…」（`_shots/auto-bio-hello.png`） |
> | 点「取消」（**真人操作**，合成输入触达不到） | 面板「已取消 —— 输入主密码，或点「用指纹解锁」」，手动按钮仍在；环仍 0 把已解锁 |
>
> ⚠️ **新坑**：Hello 对话框是**受保护的系统 UI** —— `SendInput` 合成点击、`Esc`、UIA `InvokePattern` 全触达不到
> （UIA 顶层窗口列表里根本没有它，`FindWindow` 也找不到）⇒ 取消 / 指纹只能真人操作 —— 这轮就是请用户点了一下「取消」，
> 提示立刻出现在面板上（中性色，不是红字）。
>
> ### 手机端实测（`33b676f6` · 主库 · 0.5.0 dev 包）
>
> 手机上装的 `security` 是 rev173.169 开发版 ⇒ `adb push` 新 `index.js` → `run-as cp` 覆盖（该包 manifest **没有
> `sha256`**，不用同步；桌面那份有）→ `adb reverse tcp:1420 tcp:1420` + `forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
> → 页面 `location.reload()`（新 `index.js` 62029 B 生效）。
>
> | 步骤 | 结果 |
> |---|---|
> | 主密码 `PhoneTest123` 解锁 | 「1 把已解锁」 |
> | **空闲 60 s 自动锁**（app 在前台） | 自动拉起系统指纹界面 → **用户按指纹** → 面板「「账号密码」已用指纹解锁」、1 把已解锁（`_shots/phone-locked.png`） |
> | 点「立即锁定」→ 1.5 s | 面板「正在请求指纹…」，系统指纹界面已拉起（`_shots/phone-autoprompt.png`；截图是黑底指纹圆环 = 系统界面，`screencap` 抓不到内容） |
> | 取消（系统指纹界面返回） | 面板「已取消 —— 输入主密码，或点「用指纹解锁」」，手动按钮仍在 |
>
> ⇒ Android 那条「只看可见性、不看 `hasFocus`」的判据成立：WebView 在手机上的键焦点确实不可靠，可见性够用。
>
> ### 验证
>
> vitest 1059 → **1064**（+5：桌面在场 / 桌面失焦挂起 / 手机前后台 / 五种不弹 / 手动锁也弹 + 前后台组合）；
> `verify.ps1` 六步全绿（tsc 0 · oxlint 3 warnings · cargo 52 · vitest 1064 · 质量门 7/7）。

> ## 📌 rev173.170（2026-10-26 · 交接）

> 用户「交接」。本会话从「接手 zeronote，测一下安卓端生物识别」开始，把两个平台都做完并提交。
>
> ### 本会话做了什么（2 个提交）
>
> | rev | 提交 | 内容 |
> |---|---|---|
> | 173.168 | `d96f9ab` | Android 指纹解锁：`tauri-plugin-biometric 2.5.0` + `security` 的 `biometric` 段 + 面板三入口；修 debug 包看门狗误杀 |
> | 173.169 | `16904bb` | Windows Hello：`hello_available/enroll/sign`（手写 winmd 带窗口 interop）+ `windowsHelloAdapter` |
>
> 起点是 rev173.167 的可行性验证（只在文档里，无提交改动）。
>
> ### 交接时实测状态（2026-10-26 12:56）
>
> - 工作树**干净**，HEAD = `16904bb`（main）
> - `verify.ps1` 六步全绿：tsc 0 · oxlint 3 warnings · cargo **52** · vitest **1059** · 质量门 7/7（12:55:25）
> - 桌面 dev 开着：pid **28892**（12:40 启动，日志 `.self-logs/desktop-dev.log`）
> - 手机 `33b676f6` 装 0.5.0（12:43 更新），app pid **10392**；`adb reverse tcp:1420` 在
> - 桌面插件目录的 `security` 已是**开发版**（无签名；manifest `sha256` 已同步成新入口哈希）
> - 手机测试库 `secrets` 环主密码 `PhoneTest123`，**已绑指纹**；桌面测试库 `_tmp-vault-tb` 已绑 Windows Hello
>
> ### 下个会话入口（按优先级）
>
> 1. **锁定后自动弹生物识别**（需求 §13，两平台都只差这一块）：`lockRing(api, ringId, 'idle')` 之后，
>    若 `ring.biometric` 存在且 `store.biometric` 可用，自动调 `doBiometricUnlock`；注意别盖住用户的主动操作。
> 2. **`biometric` 段按设备**：现在同一 vault 换机器会解不开（报 AEAD 失败并提示重新绑定，行为正确，
>    但没有"多设备并存"的元数据）。
> 3. 手机端 reload 后 app 偶发退出一次（rev173.166 就记了，未定位）。
>
> ### 本会话四类坑（都已写进代码 / 文档注释）
>
> 1. **Android 的 app 进程环境由 zygote 决定**：`android-dev.cmd` 里 `set ZN_WATCHDOG=off` 传不进 app，
>    导致 debug 包每次启动 5 秒后被看门狗 `exit(101)`。修法 = debug 构建默认不启动看门狗。
> 2. **`manifest.json` 的 `sha256` 是入口文件哈希**：手换插件 `index.js` 后必须同步它，否则插件拒载
>    （现象：列表显示已加载，但命令不存在）。
> 3. **windows crate 0.62 没有 `KeyCredentialManager` 的带窗口接口**：必须从系统
>    `Windows.Security.winmd` 解析 IID 手写 vtable（`hello.rs` 有完整注释）。
> 4. **旧资料里的 `.get()` / `windows::Foundation::IAsyncOperation` 在 0.62 上编不过**：
>    `IAsyncOperation` 在 `windows-future`（要 `std` feature），等待用 `.await`。

> ## 📌 rev173.169（2026-10-26 · 期 2c：Windows Hello 解锁落地）

> 接 rev173.168 的 Android 指纹，把 Windows 侧也做完 —— 用户「两边都验证通过，直接开始做」。
>
> ### 关键发现：windows crate 0.62 没有带窗口的接口
>
> `KeyCredentialManager::RequestCreateAsync` / `KeyCredential::RequestSignAsync` 是**无窗口**版本，
> 在非 UI 进程里签名会静默挂死（rev173.167 实测 90 秒）。带窗口的两个接口只存在于系统 winmd：
>
> - `IKeyCredentialManagerCreateWithWindowStatics` = `30b1b9c9-61ef-43e8-88ac-cc433b38d1a6`
> - `IKeyCredentialWithWindow` = `050deb3b-b19c-4635-9df6-5650d66c62b1`
>
> windows crate 0.62 只生成了 Statics / Statics2，**这两个没有**（`windows::Security::Credentials`
> 里 grep 不到）。做法：用 `define_interface!` 手写 vtable，IID 与参数形态从本机
> `C:\Windows\System32\WinMetadata\Windows.Security.winmd` 用 `System.Reflection.Metadata` 解析出来
> —— 不是猜的；字节序转换用 `IKeyCredentialManagerStatics` 的已知 IID 对照验证过。
>
> ### 实现
>
> - `src-tauri/src/hello.rs`：三个同步函数（`is_supported` / `enroll` / `sign`），内部
>   `futures::executor::block_on` 等 `IAsyncOperation`。**为什么同步**：COM 接口不是 `Send`，
>   而 Tauri 命令的 Future 必须 `Send` ⇒ 命令层用 `spawn_blocking` + `isize` 句柄隔离。
> - `lib.rs`：`hello_available` / `hello_enroll` / `hello_sign`（非 Windows 平台返回 Err）。
> - `security` 插件：`windowsHelloAdapter` —— `hello_sign(challenge)` → `HKDF-SHA256(sig, "zn-hello-kek")`
>   → KEK → 同一套 XChaCha 包裹 DEK；包裹格式 `hello1.<challenge>.<zn1.nonce.ct>`。
> - 依赖：`windows 0.62`（`Security_Credentials` / `Security_Cryptography` / `Storage_Streams`）+
>   `windows-future 0.3`（**必须 `std` feature**，否则 `IntoFuture` 不实现）+ `futures 0.3`。
>
> ### 实测（桌面 dev · 测试库 `_tmp-vault-tb`）
>
> | 步骤 | 证据 |
> |---|---|
> | 探测 | `hello_available` = **true**；面板出现「绑定指纹解锁」 |
> | 绑定 | 点「绑定指纹解锁」→ 凭据 `ZeroNote:secrets` 建好；`vault.json` 出现 `biometric: { platform:"windows", wrapped:"hello1.…", at }` |
> | 解锁 | 空闲锁后点「用指纹解锁」→ 面板「1 把已解锁」+「已用指纹解锁」 |
>
> **签名确定性 = 由解锁本身证明**：绑定用 challenge 签一次，解锁再签一次；若两次签名不同，
> HKDF 会得到不同 KEK、XChaCha 解不开 —— 实测解开了 ⇒ RSA-PKCS1 v1.5 的确定性成立。
>
> ### 测试
>
> vitest 1056 → **1059**（+3：Windows 适配器 seal→open 往返 / 换一份签名（模拟"签名不确定"）解不开 /
> 篡改与坏格式拒绝）。适配器本身接受注入的 `invoke`，所以单测不需要真机或真凭据。
>
> ### 两个坑（已写进代码注释）
>
> 1. **无窗口签名 = 挂死**：不能在主线程 `.get()`（阻塞消息循环），也不能裸调（无 HWND）。
>    必须走带窗口 interop。
> 2. **`IAsyncOperation` 不在 `windows` crate 里**（0.62 起在 `windows-future`），且 0.3 去掉了
>    `.get()`（改成 `.await` / `IntoFuture`）—— 旧资料里的 `.get()` 在 0.62 上编不过。
>
> ### 环境改动（不入库）
>
> 桌面插件目录的 `security` 已换成开发版（无签名；manifest 的 `sha256` 已同步成新入口的哈希 ——
> 不同步会被 manifest 校验拒载）。旧文件备份在 `_tmp-plugin-backup/`；从市场重装会覆盖。
>
> ### 下一步
>
> - `biometric` 段按设备：同一 vault 换机器时只失效那一台（现在解不开会报 AEAD 失败并提示重新绑定，
>   行为正确，但没有"多设备并存"的元数据）。
> - Windows 端的 `unlockWithBiometric` 目前只在面板手动触发；需求里的「锁定后自动弹」两平台都还没接。

> ## 📌 rev173.168（2026-10-26 · 期 2b：Android 指纹解锁落地）

> 用户「两边都验证通过，直接开始做」—— 把 2026-10-26 凌晨的可行性验证做成真功能。
>
> ### 做了什么
>
> - `tauri-plugin-biometric 2.5.0` 只挂 android target；`lib.rs` 里 `#[cfg(target_os="android")]` 注册；
>   新增 capability `android-biometric.json`（`platforms:["android"]`，`biometric:default` + `allow-biometric-cipher`）。
> - `security` 插件新增生物识别层：**纯函数** `bindBiometric` / `unlockWithBiometric` / `unbindBiometric`
>   （适配器注入），Android 适配器走 `plugin:biometric|biometric_cipher`。
> - `vault.json`：`rings.<id>.biometric = { platform:'android', wrapped, at }` —— 只多一个段；
>   主密码那份 `wrapped` 一个字节不动；**换主密码 / 恢复重设都会原样保留** biometric 段（DEK 没变）。
> - 面板三入口：「绑定指纹解锁」（已解锁时）/「用指纹解锁」（锁定时，排在主密码前）/「解除指纹」。
> - 错误翻译：换过指纹 ⇒ AEADBadTag ⇒「请用主密码解锁后重新绑定」；取消 / 锁定 / 没录指纹各自人话。
>
> ### 实测（真机 Redmi peridot · Android 16 · 0.5.0 dev 包）
>
> | 步骤 | 证据 |
> |---|---|
> | 插件链路 | `status` = `{isAvailable:true, biometryType:1}`（13 ms）；`BiometricActivity` + `USE_BIOMETRIC` 在 manifest |
> | 命令层 | 加密 `DEK-TEST-20261026` → `base64(ct);base64(iv)`；解密还原；改一字节 ⇒ `AEADBadTagException` |
> | 绑定 | 主密码解锁 → 点「绑定指纹解锁」→ 按指纹 → `vault.json` 出现 `biometric` 段（platform=android） |
> | 解锁 | 空闲 60 s 自动锁（9 小时后回来显示 0 把已解锁）→ 点「用指纹解锁」→ 按指纹 → 「1 把已解锁」 |
>
> ### 顺带修的真 bug
>
> **debug 包被看门狗 5 秒误杀**（`exit(101)`，`watchdog.log` 里 `前端无响应 5xxx ms`）。
> 根因：Android 的 app 进程环境由 zygote 决定，`android-dev.cmd` 里 `set ZN_WATCHDOG=off` **传不进 app**；
> 而 dev 首次加载必然超过 5 s 阈值 ⇒ 每次启动都被杀，表现为「启动几秒后无声退出」。
> 改成 **debug 构建默认不启动看门狗**（`ZN_WATCHDOG=on` 可强制开启），release 行为不变。
>
> ### 测试
>
> vitest 1046 → **1056**（+10：绑定 / 解锁 / 换密码后仍可解 / 解除 / 无适配器 / 篡改 / 长度不对 / 三条错误翻译）；
> 反向验证：注释掉 `unlockWithBiometric` 的适配器检查 ⇒「没有适配器」那条立刻红。
> verify 六步全过（12:13:06）· cargo 52 · 质量门 7/7。
>
> ### 下一步
>
> **期 2c Windows Hello**：`KeyCredentialManager` + `IKeyCredentialManagerInterop` 传 HWND（rev173.167 已验门槛），
> HKDF 出 KEK 后用同一套 `seal/open` 包裹 DEK；`security` 加 Windows 适配器即可复用面板与单测。
> ⚠️ 手机端已知边界三条：密钥别名全局唯一 · 新增/更换指纹让旧密文失效 · 明文 DEK 过 JS（见方案 §8 实测块）。

> ## 📌 rev173.167（2026-10-26 · Windows Hello 可行性验证）

> 用户一句「windows 不是有 hello 吗」纠了方案 §8 —— 我上一轮说「Windows 官方不支持」说窄了，
> 那句只对 **Tauri 插件**成立。这轮把平台能力实测清楚。
>
> ### 实测（PowerShell 5.1 直调 WinRT，同一台机 · 零编译）
>
> | 调用 | 结果 | 含义 |
> |---|---|---|
> | `KeyCredentialManager.IsSupportedAsync()` | **True** | 本机 PIN 已设，Hello 可用 |
> | `RequestCreateAsync(accountId, ReplaceExisting)` | **Success** | **非打包进程 + 无 HWND 也能建凭据** |
> | `RequestSignAsync(buf)` | **90 秒无返回（挂死）** | **签名必须有窗口** ⇒ 要 `IKeyCredentialManagerInterop` 传 HWND |
>
> 测试凭据 `ZeroNote:probe:20261026` 已删净（`OpenAsync` 复核 = `NotFound`），临时探针目录已删。
>
> ### 三个概念更正（都比"能不能做"更重要）
>
> 1. **「官方不支持」≠ 平台没有**。Tauri 的 biometric 插件不支持 Windows，但 Windows 自己有 API。
> 2. **PIN 与生物识别是同一套**：`KeyCredentialManager` 只知道「Hello 凭据」，弹 PIN 还是指纹由 Windows
>    按用户设置决定 ⇒ **「先做 PIN」不是降级，就是完整实现**；以后加指纹代码零改动。
> 3. **`UserConsentVerifier` 不给密钥材料**（只回 Verified/NotVerified）⇒ 方案 §8 原来写的这条路
>    **不够**，能派生出稳定密钥的只有 `KeyCredentialManager`（RSA-PKCS1 v1.5 签名是确定性的 ⇒ HKDF → KEK）。
>
> ### 落进方案
>
> - §8 加了整块 ⚠️ 更正（含实测表格）
> - 新增 **§8.5 Windows Hello 的具体设计**：第三条包裹路径（DEK ← Hello-KEK）、三个 Rust 命令
>   （`hello_available` / `hello_enroll` / `hello_sign`，都 `cfg(windows)`）、失败语义
>   （`NotFound` = PIN 被重置 ⇒ 该路径失效，回退主密码）、安全边界（防离线 / 防物理，**不防同用户恶意进程**）
> - §9 分期把 2b / 2c 拆开，2c = Windows Hello
>
> ### 为什么坚持 KeyCredentialManager 而不是 DPAPI
>
> Bitwarden 2023 年就栽在 DPAPI 上：DPAPI 只绑定 Windows 账户、**不绑定生物识别**，同用户任意进程
> `CredEnumerateW` 就能把解锁密钥掏走，**连 PIN 提示都没有**；域控拿 backup key 还能远程解
> （CVE-2023-27706）。他们后来改用 `KeyCredentialManager` 才修好。我们一开始就走对的那条。

> ## 📌 rev173.166（2026-10-26 · 期 1b 手机走查：安全 / 密码库）

> 用户「测手机」。期 1b / 1c 完成后唯一没验过的是**手机端**（rev173.163 明确写了"手机端未走查"）。
>
> ### 怎么装的
>
> 手机上插件根是 **`/data/user/0/com.aqua.zeronote.debug/.zn/plugins/`**（不是 `files/.zn/` ——
> `run-as ... ls files/` 只有 `profileInstalled`）。装开发版：
> ```powershell
> adb push examples/security/index.js /data/local/tmp/zn-security-index.js
> adb shell run-as com.aqua.zeronote.debug cp /data/local/tmp/zn-security-index.js .zn/plugins/security/index.js
> # manifest.json 同理；secrets 一样
> ```
> 然后 `location.reload()` 重新扫描插件目录 —— dev 包连桌面 vite，**不用重装 APK**。
>
> ### 10 项全过
>
> | # | 项 | 实测 |
> |---|---|---|
> | 1 | 建 `secrets` 环 | Argon2id 812 ms（与 2a 实测吻合），出恢复码 `VWPD-MA42-…` |
> | 2 | 打开密码库 → 重新检查 → 解锁 | 「找到「账号密码」密钥环」→ 解锁成功 |
> | 3 | 新建平台 | 「手机测试站 / phone.test」落盘 |
> | 4 | 新建账号 + 生成密码 | 密码框 16 字符 |
> | 5 | 密码框真 `type=password` | `text:16\|password:16` |
> | 6 | 显示密码 | 明文 `mpTeZ7FKv6VXdLg9`（16 位，无 `0O1lI`） |
> | 7 | **复制到 Android 原生剪贴板** | 读回 `CLIP_LEN=16 val=mpTeZ7FKv6VXdLg9` |
> | 8 | **60 秒后自动清空** | 等 66 s ⇒ `CLIP_LEN=0` |
> | 9 | **空闲 60 秒自动锁定** | 面板回到锁定态，文案「空闲 60 秒，已自动锁定」 |
> | 10 | reload 后持久化 + 回收站 | 解锁后仍是「手机测试站 · 1 个账号」；删 → 回收站「剩 7 天」→ 恢复 → 彻底删除 |
>
> **第 8、9 两条是这次最想验的**：Android 后台会冻结 `setTimeout`，方案里明确写了会退化。
> 实测**前台**下两条都正常 —— 冻结只发生在切后台，而 `visibilitychange` 的补偿逻辑（回到前台先按时间戳补判）
> 就是为那个场景准备的，本轮没构造出后台场景（要真的切走 60 秒再回来）。
>
> ### 踩到的坑
>
> 1. **`files/.zn/plugins/` 不存在** —— appDataDir 在 Android 是 `/data/user/0/<pkg>`，`files/` 只是它的子目录。
> 2. **reload 后 app 偶发退出一次**（必须重新 `am start`）：原因未定位，怀疑是频繁 reload + 桌面 vite 双端 HMR。
>    重启即恢复，不影响功能。
> 3. **PowerShell 的 `$pid` 是只读变量** —— 本轮 `$pid = adb shell pidof …` 静默失败（拿到的是 pwsh 自己的 PID），
>    于是 `adb forward` 指向了错误 socket。改用 `$appPid` 才正常。
>
> ### 数据处置
>
> 手机主库（`/storage/emulated/0/Documents/ZeroNote`，就是用户的真库）里留过测试账号，
> **已清空**（恢复 → 彻底删除）；但 `secrets` **环保留**，主密码 `PhoneTest123`（方便以后再验）。
> 落盘位置：`.zn/secrets/secrets.zn`（545 B）+ `.zn/security/vault.json`（621 B）。
> 手机上这两个插件是**开发版（无签名）**，市场里有签名版（15 条）；从市场重装会覆盖。

> ## 📌 rev173.165（2026-10-26 · 期 2a：手机实测三档 KDF）

> 用户「做2a」。目标只有一个：**手机到底多慢** —— 慢到要不要降档。
>
> ### 怎么测的
>
> 手机（`33b676f6` · Redmi peridot · 0.5.0 dev 包 · 页面 `http://tauri.localhost/`）上通过 CDP 直接：
> ```js
> const m = await import('/vendor/noble/hashes/argon2.js')   // 与插件同一份本地副本
> m.argon2id(pwBytes, salt16, { t, m: kib, p: 1, dkLen: 32, maxmem: kib * 2048 })
> ```
> 三档各跑 3 次取中位数。CDP 转发：`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
> （**pid 要先 `adb shell pidof` 取**；PowerShell 里 `$pid` 是只读变量，别用这个变量名 —— 本轮踩过）。
>
> ### 结果（与桌面对照）
>
> | 档 | 桌面 Node | **手机 WebView** | 倍率 |
> |---|---|---|---|
> | t=2 / m=19 MiB（OWASP 最小） | 212 ms | **165 ms** | 0.78× |
> | t=3 / m=64 MiB（RFC 9106 推荐） | 993 ms | **812 ms** | 0.82× |
> | t=1 / m=128 MiB | 682 ms | **574 ms** | 0.84× |
>
> 配套：vendor 六模块首载 **114 ms** · XChaCha 1 MiB 加密 **29 ms** / 解密 **7 ms**。
> ⇒ 手机首次解锁 ≈ **0.93 s**、之后 ≈ **0.81 s**。
>
> ### 结论与产出
>
> - **默认档保持 t=3 / m=64 MiB**，不退回 t=2 —— 方案留的后路条件是「手机 > 5 s」，实测 0.81 s。
> - **代码零改动**（`DEFAULT_RINGS` 本来就是这一档），但补了一条**锁测试**：
>   `DEFAULT_RINGS.notes.kdf` / `.secrets.kdf` 必须都是 `{ t: 3, m: 65536, p: 1 }`，
>   且两者不能是同一个对象（改一个串到另一个是静默的强度事故）。
>   **反向验证**：把 `m` 改成 19456（OWASP 最小档）⇒ 那条立刻红，改回即绿。
> - 方案 §3 的旧估算「手机 1–4× 慢」**已在原文处标 ⚠️ 更正**；§9 期 2a 标完成。
>
> ### 诚实边界
>
> - 测的是 **debug 包**（dev 前端经 vite 加载、未压缩）。release 只影响解析阶段，对纯数值计算影响很小；
>   真要抠，期 2b 重装 APK 时顺手复测。
> - **只测了 KDF 本身，没做手机上的端到端解锁** —— 手机上当前**没装** `security` / `secrets`
>   （插件列表里没有），而装它们 + 建环要另走一遍流程。期 1b 遗留的「手机端走查」仍未做。
> - 顺手记下：手机插件根目录是 **`/data/user/0/com.aqua.zeronote.debug/.zn/plugins/`**，
>   不是 `files/.zn/plugins/`（`run-as ... ls files/` 里只有 `profileInstalled`）。

> ## 📌 rev173.164（2026-10-26 · 期 1c：四个同步插件放行密码库）

> 用户「做1c」→ 按交接卡「下一步 ①」直接开工。
>
> ### 为什么必须两个文件一起搬
>
> | 文件 | 作用 | 少了的后果 |
> |---|---|---|
> | `.zn/secrets/secrets.zn` | 整库密文（真正的数据） | 没数据 |
> | `.zn/security/vault.json` | KDF salt + 被主密码包裹的 DEK | **拿到密文也解不开**（`salt` 与 `wrapped` 都在里面） |
>
> 两个都不含明文 ⇒ 上云不等于泄露；但没有主密码谁也解不开 —— 正是需求 §10.1 要的效果。
> ⚠️ 已知局限（写进代码注释）：`vault.json` 目前是**整文件**同步，里面同时有 `notes` 环的元数据。
> 期 1 没有私密文件夹消费方，所以没影响；将来做私密文件夹时要按环拆文件，否则两端各自设过
> notes 主密码会互相覆盖。
>
> ### 四个插件各改了什么
>
> | 插件 | 改动 | 为什么不一样 |
> |---|---|---|
> | `sync-webdav` | 新增 `syncPrivate` 阶段 + manifest `private` 段 | 自己有传输层，走 `get`/`put` 文本接口 |
> | `sync-s3` | 同上 | 同上（S3 的 `put` 带条件写，私有文件**不带** If-Match —— 密文冲突留副本更诚实） |
> | `sync-git` | 同上（`read`/`write` + `sha` 乐观锁） | 同上 |
> | `sync-folder` | **不搬文件**：加 `SECRET_DIRS` 放行规则 + 密码库冲突单独报警 | 它的"同步"是外部工具（Syncthing 等）在搬；插件只能给规则 + 看痕迹 |
>
> `sync-folder` 的 `.stignore` 写法（也写进了代码注释与命令输出）：
> ```
> .zn/*
> !.zn/secrets
> !.zn/security
> ```
>
> ### 三处语义细节
>
> 1. **方向判断复用 `decideSync` 的语义**，但**没有三方合并** —— 密文拼不起来，冲突就是「本机版进
>    `.zn/conflicts/<平台>/`，本地取远端版」，并在面板/toast 说清楚要人挑。
> 2. **失败只写 `hint` 不抛**：密码库传不上去不该让整轮笔记同步停摆（每 5 秒一轮，抛一次就全停）。
> 3. **不用 `fs.exists`**：少一次 IPC，且"文件不存在（抛）/ 存在但空（`''`）"要收敛成同一个 `null`
>    —— 测试台的 memoryFs 两种表现不同，真机也不一致。
>
> ### 验证
>
> - `verify.ps1` 六步全过（tsc 0 · oxlint 3 warnings · cargo 52 · check-docs · **vitest 1045** · 质量门 7/7）
> - 新单测 **15 条**：
>   - webdav 5 条（首推 + 新设备拉 / 反向拉不推回 / 双端改冲突留副本 / 空库不白拉 / manifest 坏数据当空）
>   - s3 3 条 / git 3 条（同样三条主路径，各自的 mock 存储）
>   - sync-folder 4 条（`SECRET_DIRS` 常量 / 密码库冲突报警 / 无冲突时给放行规则 / `.zn/` 别处冲突仍报"没排除"）
> - **反向验证**：去掉 webdav 的 `(remoteChanged && !localChanged)` 那条分支 ⇒「只有远端变」用例立刻红
>   （1 failed / 81 passed），改回即全绿
> - **CDP 实测**：测试库 `.zn/secrets/` 里造一个 `secrets.sync-conflict-…zn` → 点「检查 .zn/」⇒
>   toast 与面板**同时**显示「⚠ 密码库有 1 份同步冲突副本（…）—— 两端都改过密码库，请手动挑一份用」，
>   而 `.zn/` 那条仍是「没发现同步冲突痕迹」（两条不混）。测试文件用完即删。
>
> ### 踩到的坑
>
> `syncPrivate` 第一版只写了「本地没有 ⇒ 拉」，漏了「**只有远端变了** ⇒ 也拉」。后果很隐蔽：
> B 端改了密码库推上去，A 端同步时 `localChanged=false` ⇒ 推送分支不成立、拉取分支也不成立，
> **既不拉也不推**，A 永远停在旧版 —— 而且不报错、不提示。单测 `B 改了密码库 ⇒ A 拉回新版` 抓到的。
>
> ### 下一步
>
> - 期 1c 收口后，安全插件这条线剩：**期 2a** 手机实测三档 KDF 真实耗时（定死默认档）· **期 2b** 生物识别（要重装 APK）
> - 可选：`secrets` 已发市场（15 条），四个同步插件也已内置；`vault.json` 按环拆文件留到做私密文件夹时一起

> ## 📌 rev173.163（2026-10-26 · 密码库插件 · 期 1b）

> 用户「继续 ZeroNote」→ 按交接卡「下一步 ①」直接开工期 1b。
>
> ### 做了什么
>
> `examples/secrets/`（单文件 1299 行，纯函数全部命名导出供单测）：
>
> | 功能 | 做法 |
> |---|---|
> | 加密存储 | 整库 JSON → `crypto.encrypt({ring:'secrets', container:'secrets'})` → 写 `.zn/secrets/secrets.zn`（**单文件，不是一条一文件**） |
> | 解锁 | 输主密码 → `crypto.unlock('secrets', pw)`（Argon2id t=3/m=64MiB，桌面约 1 s，先渲染"正在派生…"再算） |
> | 平台 / 账号 | 两级列表，展开看账号；同平台多账号（小号 / 团队号） |
> | 搜索 | 平台名 / 站点 / 账号 / 备注；**密码不参与**（有反向用例锁住） |
> | 密码生成 | 16 位，两类字母 + 数字，排除 `0O1lI`，三类各至少一个，洗牌 |
> | 显示密码 | 点「显示」出明文，15 秒后自动收起 |
> | 复制 | 写原生剪贴板（`plugin:clipboard-manager\|write_text`，失败回退 `navigator.clipboard`），60 秒后**只在内容仍是它时**清空 |
> | 回收站 | `deletedAt` 软删，7 天；列表显示「剩 N 天」，到期在解锁时自动清理并回写 |
> | 自动锁定 | 60 秒无操作锁（3 秒轮询 + `visibilitychange` 补判；Android 后台冻结定时器也靠时间戳兜住） |
> | 降级 | `service.consume('crypto')` 返回 null ⇒ 显示"先去市场装安全插件"，并等 `service:available` 自己补上 |
>
> ### 内核唯一改动：`input.secret`
>
> 密码输入框原本没有：`UIRenderer` 把 `input` 硬编码成 `type="text"` ⇒ 密码会明文摊在屏幕上（违背需求 §8.6「密码默认隐藏」）。
> 加一个可选字段 `secret?: boolean`（UINode 种类不变，仍是 21 种）：
> `contract.ts` 类型 + 注释 · `UIRenderer.tsx` 一行 `type={node.secret ? 'password' : 'text'}`（+ `autoComplete="off"`）· `docs/内核契约-v0.2.md` UINode 表。
>
> ### 验证
>
> - `verify.ps1` 六步全过（tsc 0 · oxlint 3 warnings · cargo 52 · check-docs · **vitest 1029** · 质量门 7/7）
> - 单测 **27 条**：密码生成（长度 / 字符集 / 三类各一 / 洗牌 / 可复现）· 搜索（平台命中带出全部账号 / 账号命中只显示它 / 备注 / **密码不命中** / 大小写与空格 / zh 排序 / 空平台保留）· 回收站（软删 / 恢复 / 6d23h 不清、7d 清 / 不误伤兄弟账号 / 彻底删除幂等 / `daysLeft` 取整）· 容错归一化 · 增删改边界
> - **反向验证**：`matchesAccount` 里加上 `password` 匹配 ⇒「密码不参与搜索」红（1 failed / 26 passed），改回即绿
> - **桌面 CDP 实测 12 项**：降级视图 → 环未建立提示 →「重新检查」→ 错密码（`invalid tag`，已译成「主密码不对」）→ 正确解锁 → 新建平台（落盘）→ reload 后再解锁数据还在 → 新建账号 →「生成」填 16 位 → 保存 → 展开看到账号行 → 显示密码（明文 `kahL8Gs9NYocwYuP`，无 0/O/1/l/I）→ 复制（`CLIP_LEN=16`）→ **等 66 秒 `CLIP_LEN=0`** → 删除进回收站（剩 7 天）→ 恢复
> - **实测抓到两个真 bug**（都已修）：见上方索引行
>
> ### 踩到的两个坑（写下来省下次）
>
> 1. **`{key,node}` 只能进 `list.items`，不能进 `stack.children`** —— 后者只吃裸 UINode，塞包装对象会被当成"字段缺失的节点"，容错分支把整个 JSON 当文本渲染出来。测试抓不到（纯数据），只有真渲染才看得见。
> 2. **`visibleTree` 第一版过滤掉了无账号的平台** ⇒ 新建平台保存后列表里什么都没有，用户没法往里加账号。已改成"无搜索时保留空平台，有搜索词时才要求命中"。
>
> ### 下一步
>
> - **期 1c**：四个同步插件放行 `.zn/secrets/`（现在 `sync-folder:184` 把 `.zn/` 整段排除 ⇒ 密码库同步不出去），冲突保留两份
> - 可选：把 secrets 也签名发到市场（与 security 同路，`pack-plugin secrets --key …`）

> ## 📌 rev173.162（2026-10-25 · 交接：安全插件上线 + 下个会话入口）

> 用户：「交接」。本会话从「做安全插件」一句话开始，走完 **调研 → 写方案 → 用户拍板 → 实现 → 实测 → 发市场 → 推送**，
> 全部已推送、CI 全绿、工作树干净。
>
> | rev | 做了什么 | 验证 |
> |---|---|---|
> | 160 | `examples/security/` 插件：**双密钥环**（私密笔记 / 账号密码各一把主密码）+ Argon2id + XChaCha20-Poly1305 + `crypto` 服务 | 单测 **25** 条 |
> | 161 | 签名打包 → 市场 **13 → 14 条** → 端到端实测 → 推送 | 真包 + 应用内 14 条 |
>
> 每件的细节与踩坑在各自 rev 段；**架构取舍、诚实边界、分期**在 [`docs/安全插件-方案-2026-10-25.md`](docs/安全插件-方案-2026-10-25.md)（**accepted**）。
>
> ### 交接时实测状态
>
> - 工作树**干净** · `main...origin/main` 无 ahead/behind ⇒ 全部已推送，HEAD `981b114`
> - `verify.ps1` 六步：tsc 0 · oxlint **3 warnings** · cargo **52** · check-docs · vitest **1002** · 质量门 **7/7**
> - CI：**连续三次全绿** —— `40209288687`（feat，2m10s）· `40209522408` + `40209671929`（docs，各 ~2 分钟）
>   （本段文档自身的提交会再触发一次 docs run，属正常）
> - **dev 开着**（pid 11660 · vite 1420 · CDP 9222）；测试库 `_tmp-vault-tb/` 的 `.zn/security/vault.json` 里有
>   **两把临时主密码**（`notes` / `secrets`，实测时设的，随时可删；不影响库内笔记）
> - 全局插件根里的 security 是**市场版（已签名）**：`%APPDATA%\com.aqua.zeronote\.zn\plugins\security`（含 `signature.json`）
>
> ### 下个会话从哪开始
>
> 1. 读 `HANDOFF-CARD.md`（一屏）+ 本段 ② 看 `docs/ROADMAP.md` §3（候选池）
> 2. **期 1b：`secrets` 密码库插件**（估 3 天）—— 消费 `crypto` 服务；`.zn/secrets/` 整库加密（**单文件、非一条一文件**，
>    方案 §4.5 已定）；剪贴板复制后 60 s 清空；7 天回收站（`deletedAt` 软删除）；平台/账号两级列表 + 密码生成器；
>    `consume('crypto')` 拿 `null` 时提示「先去市场装安全插件」（软依赖标准做法）
> 3. **期 1c：四个同步插件放行 `.zn/secrets/`**（估 0.5 天）—— 现在 `.zn/` 整段被排除（`sync-folder:184`），
>    密码库**同步不出去**；四处都要加白名单 + 冲突两份保留
> 4. 可选：市场里给官方包加「官方 / 已签名」徽标（包内 `signature.json` 的 `keyId=aqua-2026` 就能判断）
>
> ### 本会话已定的结论（别重新讨论）
>
> 1. **预装与市场不互相替代**：预装 = 离线/首启可用 + 版本确定；市场 = 扩展/更新。但**安全类插件走市场**
>    （用户决定：涉及隐私的功能应由用户主动选择，不暗示"默认已加密"）
> 2. **"把自己完全封起来"在 JS 插件里不成立**：插件与宿主同上下文（D-001），密钥总得有人保管。
>    再往上只有两条路 —— **Rust 下沉**（密钥不进 JS）或 **OS 密钥库**（连 App 都拿不到原始字节），
>    两者都要重编重装 APK，已写进方案 §7/§8
> 3. **双密钥环的硬隔离靠 AAD**：`环|容器|用途` 分域 + 各自 salt/DEK ⇒ 跨环、跨容器、跨用途一律解不开（有反向测试）
> 4. 用户原话：「**私密文件夹只是一些非公开个人笔记，账户密码要保证绝对安全**」⇒ 两把主密码**不做任何派生关系**
>
> ### 环境坑（下次别踩）
>
> 1. **测试服务用完必须停**：上次会话留了 `python -m http.server 8931`（cwd 不是仓库根），我对着 404 绕了两轮
> 2. **`Invoke-WebRequest` 走系统代理**，连 `127.0.0.1` 也返回 404 ⇒ 判本地服务死活用 `node -e "http.get(…)"`
> 3. 本机 `curl` 走代理拉 raw：`ECONNRESET` / schannel 吊销检查失败；但 **WebView 的 fetch 能通**（应用内实测 14 条）

> ## 📌 rev173.161（2026-10-25 · 安全插件发市场 · 不预装）

> 用户：「有插件市场后应该不用做预装插件了吧」→ 结论：预装与市场**不互相替代**（预装解决离线/首启可用，
> 市场解决扩展），但**安全类插件应当走市场**（用户知情选择，不暗示"默认已加密"）。用户同意后执行。
>
> ### 做了什么
>
> 1. `node scripts/pack-plugin.mjs security --key %USERPROFILE%\.zeronote-keys\aqua-2026.key.pem --key-id aqua-2026`
>    → `market/packs/security-0.1.0.znp`（47.4 KB / 整包 sha256 `42ff0e…`）+ `market/entries/security.json`
> 2. `node scripts/gen-market.mjs --write` → `market/index.json` **13 → 14 条**
> 3. `node scripts/verify-trust.mjs` → 入库签名包 **15/16 验过**（1 个纯样式包无签名属正常）
> 4. **没登记 `BUILTIN_PLUGINS`** —— 有意为之，不是漏做
>
> ### 端到端实测（真包、真链路）
>
> 本地起 8932 静态服务指向仓库根（临时脚本 `_tmp-crypto-bench/serve.mjs`，用完停）：
>
> | 测 | 做法 | 结果 |
> |---|---|---|
> | 负向 | 期望 sha256 改成全 `0` | **「插件包校验失败：索引记录 sha256=000…，实际下载到 42ff0e…」且不落盘** |
> | 正向 | `install_znp_from_url` 装真包 | 返回 `"security"`；磁盘多出 `signature.json`（148 B） |
> | 加载 | reload → 插件管理页 | **「安全 v0.1.0 已签名」** |
> | 回滚 | 清 localStorage 索引地址 → reload | 回到 GitHub raw（线上仍是 13 条，因为**还没推送**） |
>
> ### 两个环境坑（都踩了，都记下来）
>
> 1. **8931 上留着上次会话的 `python -m http.server`** —— cwd 不是仓库根，所以 `GET /market/index.json` 恒 404。
>    我先怀疑自己的脚本，绕了两轮才发现是别人的僵尸进程。⇒ 测试服务用完必须停；开工前先 `Get-NetTCPConnection` 看一眼端口。
> 2. **`Invoke-WebRequest` 受系统代理影响**，连 `http://127.0.0.1:8932/...` 也返回 404（代理返回的，不是我的服务）。
>    判本地服务死活要用 `node -e "http.get(...)"` 或 curl `--noproxy`。
>
> ### 推送与线上实证（23:56 推送完成）
>
> - `git push` **直连成功**：`96b6a87..f99d9b9`；`git ls-remote origin refs/heads/main` = `f99d9b9ac6…` 一致
> - CI run [`40209288687`](https://github.com/aqua7773/zeronote/actions/runs/40209288687)：**15 步全绿**（tsc / oxlint / vitest 1002 / check-docs / 质量门 7 项 / cargo 52）
> - **应用内实测**：清掉 localStorage 的本地索引地址 → reload → 插件管理「发现」**14 条**，
>   「安全 v0.1.0 · aqua7773 · 47.4 KB」在列；市场版（签名）替换后面板照常打开、两环都在
> - ⚠️ 本机 `curl` 走代理**仍拉不到** raw（`ECONNRESET` / schannel `CRYPT_E_NO_REVOCATION_CHECK`），
>   但 **WebView 的 fetch 能通** ⇒ 这类失败跟 curl/代理有关，不代表索引或包有问题（真遇到"连不上服务器"先点刷新）
>
> ### 下一步
>
> 1. 期 1b：`secrets` 密码库插件（消费 `crypto` 服务，`consume` 拿 `null` 时提示「先去市场装安全插件」）
> 2. 期 1c：四个同步插件放行 `.zn/secrets/`
> 3. 之后可选：市场里给官方包加「官方 / 已签名」徽标（`keyId=aqua-2026` 已可用于判断）

> ## 📌 rev173.160（2026-10-25 · 安全插件 v0.1：双密钥环 + crypto 服务）

> 用户「做安全插件」→「先调查，写方案」→「开工」。方案：[`docs/安全插件-方案-2026-10-25.md`](docs/安全插件-方案-2026-10-25.md)（**accepted**）。
> **本期只做期 1a**（密码学核心 + 插件骨架）；UI 走查、`secrets` 插件、同步放行属后续期。
>
> ### 已拍板（用户 2026-10-25）
>
> | 项 | 结论 |
> |---|---|
> | 主密码 | **分开**：`notes`（私密笔记，3 分钟锁）/ `secrets`（账号密码，60 秒锁），互不派生 |
> | 密码库位置 | `.zn/secrets/` 整库加密 + 同步插件放行（后续） |
> | 恢复 | 安全问题 + 恢复码双路径；DEK 被主密钥与恢复密钥各包一份 |
> | 算法 | 严格按需求 §9.3：XChaCha20-Poly1305 + Argon2id |
>
> ### 关键实现（`examples/security/index.js`，1172 行单文件）
>
> - **为什么单文件**：插件是 Blob 模块，**ESM 相对 `import './crypto.js'` 解析不了**（契约 §3 只支持 CJS `require` + `manifest.files`）。第一版拆了两个文件，加载即失败 ⇒ 内联；纯函数仍全部 `export`，单测照旧 import。
> - **noble 本地副本**：`node scripts/vendor-noble.mjs` 按相对 import 图**精确复制**（13 文件 / 202 KB，含两份 LICENSE 与 README 里的版本+审计说明）。插件用 `new URL('/vendor/noble/…', location.origin)` 动态 import —— 与 import-export 同一条通道，不走 CDN。
> - **不存 password verifier**：解锁 = 拿 masterKey 解包裹的 DEK，**AEAD 认证通过即密码正确**。少一份可离线爆破的校验值。
> - **AAD 分域**：包裹 `环|dek`、数据 `环|容器|data`、恢复 `环|recovery|answer|code`。⇒ 把 A 容器的密文贴到 B 容器、把包裹块当数据密文、跨环混用，**全部解密失败**（不是靠"我们保证不混用"）。
> - **换密码 / 恢复只重包裹 DEK**：测试断言换完密码解出的 DEK 与原来逐字节相同 ⇒ 旧密文照旧可解（需求 §9.3 的"只重置主密码"）。
> - **vault 损坏 ⇒ 拒写**：`store.corrupt` 时按空库启动但 `saveVault` 直接抛错，避免把读不懂的原文件覆盖掉。
> - **对外服务**：`service.provide('crypto')` 暴露 `encrypt/decryptText/decryptBytes/sign/verify/unlock/lock/isUnlocked` —— **密钥不出插件**（需求 §9.4）。
>
> ### 门禁与实测
>
> - `npx vitest run tests/security.test.ts` → **25/25**（含反向：错密码 / 密文改一字节 / 跨容器 AAD / 跨环 / 恢复答案错 / 只设恢复码 / 两条都不设必须抛错）
> - 测试用 `t=1, m=8KiB` 的极小 Argon2 参数（生产默认 `t=3, m=64MiB`，本机实测 993 ms、手机估 2–4 s，见方案 §3）
> - `npx tsc -b` **0 错误** · `gen-catalog --write` → 38 示例 / 13 内置
> - ⚠️ **没做的**：面板没在 dev 里点过（CDP 走查）、没登记 `BUILTIN_PLUGINS`（所以不会自动装到全局插件根）、`secrets` 插件未开工
>
> ### 下一步（接手者看这里）
>
> 1. 起 dev（`dev.cmd`）→ 把 `examples/security/` 复制到 `<appDataDir>/.zn/plugins/security/` → reload → 点面板走一遍：建立环（两把密码各建一次）→ 锁定 → 解锁 → 断言已锁 → 换密码 → 恢复码解锁 → 重设密码
> 2. 走查通过后登记 `src/kernel/builtin-plugins.ts`（变成预装第 14 个）
> 3. 然后才是期 1b：`secrets` 插件（密码库 UI + 剪贴板 60 s + 回收站）与期 1c（四个同步插件放行 `.zn/secrets/`）

> ## 📌 rev173.159（2026-10-25 · 交接：本会话产出与下个会话入口）

> 用户：「交接」。本会话（rev173.154 → 158）连着做完五件事，**全部已推送、CI 全绿**，工作树干净。
> 这里只做一张总览 + 下个会话从哪开始；每件事的细节与踩坑在各自 rev 段。
>
> | rev | 做了什么 | 验证 |
> |---|---|---|
> | 154 | **CI 从「每个 run 都红」修到能跑** + 开源配套（issue/PR 模板、`CONTRIBUTING.md`、check-links 覆盖） | 本地六步全绿 |
> | 155 | CI 首绿实证（15/15 步 · 4m45s） | run `40192229548` |
> | 156 | **插件市场第二批 UX**：详情页（含能力自述）/ 更新角标 / 启动 24h 节流检查 + 设置开关 | vitest 951→977 · CDP 实测三项 · run `40195249557` |
> | 157 | **CI Rust 缓存**：Cargo 步骤 2m32s → 41s，整 run 3m35s → 2m33s | 三次相邻 run 对比 + `workflow_dispatch` |
> | 158 | **插件审查材料生成器** `scripts/review-plugin.mjs`（离线门进质量门第 7 项，联网半人工跑） | 夹具正常/反向/空表三组 · run `40197109611` 2m24s |
>
> ### 当前状态（交接时实测）
>
> - 工作树**干净** · `main...origin/main` 无 ahead/behind ⇒ 全部已推送
> - `verify.ps1` 六步全绿：tsc 0 · oxlint **3 warnings** · cargo **52** · check-docs · vitest **977** · 质量门 **7/7**
> - CI 最近三次 run 全 success（2m24s / 2m39s / 2m39s）—— **缓存命中后稳定在 2.5 分钟内**
> - **dev 开着**（pid 11660 · 19:47 启动）· 手机测试机 `33b676f6` 装的是 0.5.0
> - 仓库 public + 14 个 topics + CI 缓存 + CONTRIBUTING + issue/PR 模板 + 审查材料生成器 ⇒ **公开配套已齐**
>
> ### 下个会话从哪开始
>
> 1. 读 `HANDOFF-CARD.md`（一屏）→ 卡点表 + 「下一步」
> 2. 剩下的都不急：插件数涨到几十个时换 CDN（raw 偶发连不上 + 按 IP 限流）· 第一个外部作者投稿时按
>    `market/README.md`「审 PR」走 · 卡点表三条要外部输入（sync-git 手机端 / Gitee 令牌 / 记账样本）
> 3. 想开新功能就先看 `docs/ROADMAP.md` §3 —— **候选池里已经没有「可立即做」的项了**，要么等输入、要么新需求
>
> ### 本会话踩到并已修的三个真问题（都靠实测，不是靠读代码）
>
> 1. CI 每个 run 都红 = `localeCompare` 不传 locale（本机 zh-CN 过、runner en-US 红）
> 2. rev173.154 打的 0.2.1 包漏 `--key-id` ⇒ keyId 写成 `default` ⇒ 装得上但加载拒载（已重签 + gen-market 加门）
> 3. 24h 检查 effect 依赖 `rows` 数组引用 ⇒ 4 秒定时器被每次重渲染重置 ⇒ **检查永不发生**（单测看不出来）

> ## 📌 rev173.158（2026-10-25 · 插件审查材料生成器）

> 用户「做」= ROADMAP §3.3 最后一块：外部作者投稿时的审查材料。调研 §4.5 的口径是**只审格式，不审代码**
> （内核本来就不为插件提供安全保证，假装审过反而危险），所以脚本只回答四个问题：
> **格式对不对 / 地址通不通 / 包有没有被换过 / 谁签的**。
>
> ### 用法（`scripts/review-plugin.mjs`）
>
> ```bash
> node scripts/review-plugin.mjs                        # 离线：external.json 的格式与 id
> node scripts/review-plugin.mjs --online               # 联网：再拉 entry + 下包核 sha256
> node scripts/review-plugin.mjs --entry <url> --online # 审还没进索引的作者条目
> node scripts/review-plugin.mjs --entry <url> --online --out market/review-YYYY-MM-DD.md
> ```
>
> 输出是 markdown 材料（可直接贴进 PR 评论）：entry 可达 / **整包 sha256 一致** / 包内 manifest 与 entry
> 同 id 同版本 / `apiVersion` 的 **major** 兼容（照抄 `plugin-host.ts:309` 的规则，只比 major）/
> 有签名就报 **keyId**（报但不验）/ 能力自述翻成人话。
>
> ### 两层：离线进 CI，联网只在人工审时跑
>
> - **离线半**（格式 / id 规范 / 不撞官方 / 不重复）进了 `check-gates.mjs` 第 **7** 门 ⇒ 脏 PR 一进来 CI 就红
> - **联网半**（拉 entry / 下包）不进 CI —— 外部源会抖，别让 CI 红在别人的服务器上
>
> ### 实测（`_tmp-external/` 夹具，用完即删）
>
> 造了一个「外部作者」插件（keyId `alice-2025`）走完整链路：
>
> - ✅ **正常**：sha256 一致 · 包内 id/版本对 · apiVersion 兼容 · 能力自述「读文件 · 联网 · 注册命令 · 状态栏」·
>   警告「签名 keyId 不在内置信任根（客户端会当未知作者）」
> - ✅ **反向**：把 entry 的 sha256 改成 0 ⇒ 报「整包 sha256 不符」并列出两边前 12 位；用 `--external` 造假索引
>   （id 撞官方 `tag-panel` + 重复 id + `Bad_ID` + `ftp://`）⇒ 4 个错误全报、退出码 1
> - ✅ **空表**：当前 `external.json` 为空 ⇒ 通过（0 条，正常状态）
>
> 顺手修掉自己写出来的三个问题（都是实测才暴露的）：`--entry` 模式下硬性要求索引行有 id（应反过来从 entry 推）·
> 全局问题重复计数、单条结论没跟着变红 · `--external x.json` 的值被当成位置参数（id 过滤）。
>
> ⚠️ 已知边界：**不验签** —— 外部作者的公钥不在信任根里，验了也只能证明「这把钥匙签的」，
> 材料里会明说这层，让审的人自己决定要不要建议用户信任它。

> ## 📌 rev173.157（2026-10-25 · CI 加 Rust 编译缓存）

> 用户「加缓存」。先说结论：**pnpm 那边本来就有** —— `actions/setup-node@v5` 的
> `package-manager-cache` 默认 `true`，会按 `package.json` 的 `packageManager: pnpm@10.34.6`
> 自动缓存（读官方 README 确认，不是猜）。所以真正缺的只有 Rust。
>
> ### 改动两处
>
> 1. `Swatinem/rust-cache@v2`，`workspaces: "src-tauri -> target"`
>    （语法照官方 README：`$workspace -> $target`，target 相对 workspace）—— 缓存 `~/.cargo` 与
>    target 目录；缓存键跟 `Cargo.lock` + rustc 版本走，不会拿旧产物骗人。
> 2. `workflow_dispatch` —— 加缓存后必须**跑两次**才看得出「命中 vs 未命中」，没有手动入口就只能
>    靠推空提交去凑第二次。
>
> ### 实测（同一份代码，相邻三次 run）
>
> | run | 触发 | 缓存 | Rust cache 步骤 | Cargo test 步骤 | 总时长 |
> |---|---|---|---|---|---|
> | `40195249557`（rev173.156） | push | 无 | — | 2m32s | 3m35s |
> | `40196000313`（本 rev 首次） | push | **未命中（顺带写入）** | 2s（restore miss） | 3m15s | 5m17s |
> | `40196424395`（手动 dispatch） | dispatch | **命中** | 32s（下载解压） | **41s** | **2m33s** |
>
> **Cargo 步骤 2m32s → 41s（−73%）**，整个 run 3m35s → 2m33s。
> 第一次反而更慢是正常的：要在最后把缓存打包上传（约 +1 分钟）。
>
> ⚠️ 缓存失效条件（别当 bug 查）：改 `Cargo.lock` / 升 rustc / 改 `workspaces` 配置 ⇒ 换缓存键 ⇒
> 下一次又走「未命中」那条慢路，之后自动恢复。

> ## 📌 rev173.156（2026-10-25 · 插件市场第二批 UX：详情页 / 更新角标 / 24h 节流检查）

> 用户：「开始第二批」= 调研 §4.4 剩下的三件。**一行 Rust 都没动**：全在 JS 与索引字段。
>
> ### ① 详情页（装之前先摊开）
>
> 「发现」每条加「详情」按钮（不触发下载），显示：描述全文 / 分类 / 平台 / 大小 / 接口版本 /
> **能力自述** / 已装版本 / 下载地址 / sha256 / 包内文件数。
>
> 能力自述来自**索引新增字段** `capabilities`（`pack-plugin.mjs` 从 manifest 带出来，
> 13 个包重跑打包 + `gen-market --write`）—— 这是关键：装之前就该知道它要什么，
> 而不是下载完才在确认框里看到。中文翻译在 `src/lib/capability-label.ts`：
> `fs:read` → 「读你的文件」；**未知取值原样露出**（契约说 capability 只是自述，猜不如不猜）；
> `fs` / `host` / `event` 这些**老写法也译**（13 个官方插件里真在用，不译就是一个裸单词）。
>
> ### ② 更新角标
>
> 「已安装 / 发现」tab 上的 `已安装 14 ↑1`，以及每个可更新插件行内 `↑ 可更新 v0.3.0`。
> 计数**只数真装着的**（缓存里可能残留已删插件的 id）；装完立刻摘掉该条缓存 ——
> 否则刚更新完还挂着角标，用户会以为没装上。
>
> ### ③ 启动 24h 节流检查
>
> `shouldCheckUpdates()` / `computeUpdates()` 两个纯函数 + localStorage 存结论（`at` + `updates`）。
> 启动延迟 4 秒发请求，**失败静默且不写 `at`**（否则「失败也算查过」，24 小时内不再试）。
> 设置 → 插件 → 「启动时检查更新」开关（默认开）。只标角标，**不下载不安装** —— 这条不变。
>
> ⚠️ **实测抓到一个真 bug**：effect 一开始依赖 `rows` 数组引用，而 `rows` 是每次渲染新建的
> （`manifests.map(...)`）⇒ 每次重渲染都 cleanup，那个 4 秒 `setTimeout` 被无限重置，
> **检查永远等不到**（reload 后 localStorage 一直空，靠单测看不出来）。
> 改成依赖 `rows.length`（值从闭包取，不再用 ref —— 渲染期读 ref 会多一条 lint 警告）后一次写入成功。
>
> ### 顺带修：rev173.154 打的两个 0.2.1 包会被拒载
>
> 那次打包**漏了 `--key-id`**，`pack-plugin.mjs` 默认写成 `default` ⇒ 签名本身有效，但客户端
> `BUILTIN_TRUSTED_KEYS` 只认 `aqua-2026` ⇒ **装得上、加载时拒载**（换台机器才看得见）。
> 已重签（`--key-id aqua-2026`），`verify-trust.mjs` 用内置公钥验 **14/15**（1 个纯样式无签名）；
> `gen-market.mjs` 加第 ⑤ 条门：官方包的 `signature.json.keyId` 必须等于 `aqua-2026`。
> 反向验证：不带 `--key-id` 重打一个包 ⇒ 门报「签名 keyId 是 default，应为 aqua-2026」，恢复即绿。
>
> ### 验证
>
> · vitest **951 → 977**（+26：market 8 / market-pane 4 / plugin-panel 3 / capability-label 6 等）
> · verify 六步全绿：tsc 0 · oxlint 3 warnings · cargo 52 · check-docs · vitest 977 · 质量门 6/6
> · CDP 实测（索引指向本机静态源 `127.0.0.1:8931`，避开 GitHub 上的旧索引）：
>   详情页显示「自己的存储 · 注册命令 · 主区面板 · fs · 宿主能力」；
>   tab「已安装 14↑1」+ 行内「标签 v0.2.1 ↑ 可更新 v0.3.0」；
>   24h 检查写入 `at` 与 `updates={}`，**第二次 reload 不重复查**（at 不变）；
>   设置开关关闭写 `'0'`、打开移除。
> · 实测完已把索引地址恢复默认（`localStorage.removeItem('zn-market-index-url')`）、停掉本地服务。

> ## 📌 rev173.155（2026-10-25 · CI 首绿实证）

> rev173.154 推送后第一次真跑：**15 步全 success**，4 分 45 秒（12:14:20 → 12:19:05 UTC）。
>
> 关键在 step 8「Unit tests (vitest)」—— 此前**每个 run 都挂在这一步**，`sortTags` 显式传 `'zh'` 后
> 951 条全过。step 10「Quality gates」也是**第一次真正被跑到**：它排在 vitest 之后，
> 之前一直是 vitest 先红，这一门等于从没在 CI 上执行过。
>
> ### 三条证据（不是「看它变绿了」）
>
> | 证据 | 值 |
> |---|---|
> | 修复前八个 run | `gh run list` → 全部 `failure`（10:07 – 12:05） |
> | 本次 run `40192229548` | `success` · 15/15 步 · 4m45s |
> | 新包公网链路 | raw 下载 `http=200 · 24513 B` · sha256 `01ab6106…` 与 `market/entries/tag-panel.json` **逐字一致** |
> | 内置插件落地 | 全局目录里 `tag-panel` / `backlinks` 均已是 **0.2.1**（dev 热更新后 `ensureBuiltinPlugins` 写入） |
>
> ### 顺手修
>
> workflow 头注释原本写「五步验收」，实际六步（漏了质量门）⇒ 改成与 `verify.ps1` 逐项对齐，并留一句
> 「本地绿不代表 CI 绿，先想这个断言是否依赖环境」，免得下一个人再走一遍这条弯路。
>
> ⚠️ 一条 CI 自身的小债（**不阻塞、现在别改**）：`pnpm/action-setup@v4` 声明跑在 Node 20，GitHub 已强制
> 改用 Node 24，所以每次 run 会有一条 deprecation annotation。等 action 上游发新版再升 ——
> 为消一条黄字去动 CI 配置，风险大于收益。

> ## 📌 rev173.154（2026-10-25 · 开源配套：CI 修绿 + 投稿入口）

> 用户选「公开仓库配套：CI + issue 模板 + CONTRIBUTING」。**开工第一件事就把假设推翻了**：
> CI 不是「还没建」，而是 **rev173.130 就建好了、但此后每个 run 都是红的** ——
> `gh run list` 最近 8 个 push 全部 `failure`。仓库已开源，首页顶着一个红叉，比没有 CI 更劝退。
>
> ### 根因：`localeCompare` 不传 locale（3 处）
>
> 每个 run 都挂在同一条：
>
> ```
> FAIL tests/tag-panel.test.ts > sortTags：同篇数按本地化名字序
> AssertionError: expected [ '会议', '工作', '项目' ] to deeply equal [ '工作', '会议', '项目' ]
> ```
>
> `Array.prototype.localeCompare(other)` 不传 locale 时用**运行环境默认 locale**：
> 本机 zh-CN 按拼音（工作 g < 会议 h < 项目 x），GitHub runner en-US 退化成 Unicode code point
> （会 U+4F1A < 工 U+5DE5 < 项 U+9879）⇒ 断言翻转。这不是「CI 环境不好」，是**排序结果不确定**。
>
> 三处同款（`FileTree` / `QuickSwitcher` / `SearchPanel` 早就写了 `'zh'`，这三处漏了）：
>
> | 位置 | 改法 |
> |---|---|
> | `src/kernel/index-api.ts` `tags()` | `localeCompare(b.tag, 'zh')` |
> | `examples/tag-panel/index.js` `sortTags` | 同上 + 注释说明「CI 的 en-US 下中文序不同」 |
> | `examples/backlinks/index.js` `matchRefs` | 标题与路径都比 `'zh'` |
>
> 两个插件各升 **0.2.1** → `pack-plugin.mjs --key` 重签 → `gen-market.mjs --write`（13 条，索引 sha 对得上）。
> 不升版本就重打包的话，已装 0.2.0 的用户永远收不到这个修复。
>
> ### CI 覆盖缺口（顺手补，不然修绿也没意义）
>
> 旧 workflow 逐条列了 5 个门，**漏了 `facts` 与 `market`** —— 前者是「交接卡事实块是否最新」，
> 后者是「索引与 examples 的 manifest 是否漂移」。两个都是本地 verify 第 6 步在查的东西。
> 改成一行 `node scripts/check-gates.mjs`（6 门唯一入口），本机加门即 CI 加门。
>
> `facts.mjs --check` 另有一个 CI 死结：它比较整块文本，而「测试基线」那一行只有本机有
> （`scripts/.verify-baseline.json` 与 `_verify-*.log` 都不入库）⇒ CI 上必然不一致、门永远红。
> 修法：**无基线时忽略该行**（本机有基线仍整块比，本地门不退化）。
>
> ### 投稿入口
>
> `CONTRIBUTING.md`（环境 / 门禁 / 代码约定摘要 / 插件贡献 / PR 流程 / 不接受的操作）·
> `.github/ISSUE_TEMPLATE/`：bug 报告（含「数据异常」优先说明）、功能建议、插件投稿（外部作者，
> 指向 `market/README.md` 的两步投稿）、`config.yml` 引导 · `.github/pull_request_template.md`（四行）。
> `check-links` 把 `CONTRIBUTING.md` 纳入扫描 —— 贡献指南里的死链最尴尬。
>
> ### 验证
>
> `pwsh -File scripts\verify.ps1` 六步全绿（tsc 0 · oxlint 3 warnings · cargo 52 · check-docs · vitest 951 · 质量门 6/6）。
> **CI 首跑结果见下一个 rev**（推送后才有 run；本机 zh-CN 环境验证不了 en-US 下的排序，只能靠 CI 实证）。

> ## 📌 rev173.153（2026-10-25 · 交接：把「环境现状」改回真话）

> 用户：「交接」。代码零改动，只修交接卡里**已经和现实不符的四条** —— 这类过时比缺信息更危险
> （下个会话照着做会直接撞墙）。
>
> | 旧文 | 现实 |
> |---|---|
> | 「13 个包已上传 Release `plugins-v0.5.0`；打包用 `--tag plugins-v0.5.0`」 | rev173.150 起包**入库** `market/packs/`、走 raw；`pack-plugin` 默认就写那儿，**不再需要 `--tag`**；Release 只是镜像 |
> | 手机「只跑已装的 dev 包」 | 已装 **0.5.0**（19:34）；0.4.0 里没有 `install_znp_from_url`，照着跑会得到「命令不存在」 |
> | 「别用后台 job 托管 dev」 | 补上**该怎么做**：`Start-Process cmd /c dev.cmd`（独立进程）—— rev173.152 验收时就是这么起的，可用 |
> | （缺）仓库可见性 | 补一行：仓库已开源、public 地址、LICENSE 与免责已就位 |
>
> 另外写清「dev 当前开着」（`Get-Process zeronote` 可查）—— 下个会话不必重新起。
>
> ### 本会话产出（rev173.146 → 153，7 个提交，全部已推送）
>
> | rev | 内容 |
> |---|---|
> | 146 | 公钥内置（新装机器不再拒载签名插件） |
> | 147 | `ensureBuiltinPlugins` 不覆盖市场版 |
> | 148 | 市场阶段 1：「发现」tab（列 / 装 / 升 / 失败不落盘） |
> | 149 | 开源（审计 → MIT → 可见性翻转） |
> | 150 | 包入库走 raw（`github.com:443` 不通、`raw` 通） |
> | 151 | 手机真机走查（安装 + 验签全通） |
> | 152 | 设置与菜单两处插件页统一（同一份代码）+ 布局高度修复 |
> | 153 | 本段：交接卡纠偏 |
>
> ### 下一步（按成本）
>
> ① 第二批 UX：详情页 / 更新角标 / 启动 24h 节流检查（~1 天）·
> ② 公开仓库配套：CI + issue 模板 + CONTRIBUTING（~1 h）·
> ③ 插件数涨到几十个时换 CDN / 自建源（raw 偶发连不上 + 按 IP 限流）。

> ## 📌 rev173.152（2026-10-25 · 插件页统一：设置里也能进市场）

> 用户：「统一设置和菜单的插件页」。
>
> ### 结论先说：不需要第二套 UI
>
> 设置 → 插件 那段**本来就是** `<PluginPanel>`（`Settings.tsx:223`，2026-10-18 起复用），
> 所以「设置里没有市场」的唯一原因是**漏传通道**：`onMarketInstall` 没往下传，
> 而 `PluginPanel` 的 tab 条件是 `{onMarketInstall && <tabs>}`。
>
> 改动因此只有三行级别的透传：
>
> | 文件 | 改动 |
> |---|---|
> | `Settings.tsx` | props 加 `onMarketInstall?` → 解构 → 传给 `<PluginPanel>` |
> | `App.tsx` | `<Settings>` 上补 `onMarketInstall={installZnpFromUrl}` |
>
> 好处是**同一份代码**：tab、状态判定、坏条目跳过提示、安装确认框、失败不落盘 —— 改一处两处同时生效，
> 不会出现「设置里点安装走的是旧逻辑」这种漂移。
>
> ### 顺带修掉一个加 tab 后才暴露的布局问题
>
> 实测（桌面 dev，1920×1080）：
>
> | 量 | 修前 | 修后 |
> |---|---|---|
> | 设置 Dialog 面板高 | **1080**（撑满屏，底部被切） | ~570（居中，正常） |
> | 插件区高 | 1037（内容撑开） | 520（`h-[min(62vh,520px)]`） |
> | 市场列表 | 不内滚（`scrollable=false`） | **内滚**（`scrollable=true`） |
>
> 根因：设置里那一格是 `overflow-y-auto`，而 `PluginPanel` 是 `height:100%` 的 flex 列
> （列表靠 `flex:1` 内滚）—— **父级没有高度约束时，flex 只会被内容撑开**，不会自己限制。
> 加 `h-[min(62vh,520px)]` 外层 + `min-h-0 flex-1` 内层即可。这类「加上一屏内容才炸」的布局问题，
> 单测测不出来，只能靠真截图看。
>
> ### 证据
>
> 1. 设置 → 插件 → **已安装 14 / 发现**，发现里 **13 条**，无错误，列表内滚
> 2. 菜单 → 插件管理 → **同一组 tab、同样 13 条**（`inDialog: false`，主区 945 px）
> 3. vitest 949 → **951**：不传 `onMarketInstall` ⇒ 无 tab；传了 ⇒ tab 文案为 `已安装 N` / `发现`
> 4. 三张截图（`_shots/settings-market{,2,3}.png`）—— 目录不入库

> ## 📌 rev173.151（2026-10-25 · 插件市场手机端走查）

> 用户：「手机」。在测试机 `33b676f6` 上把市场走了一遍。
>
> ### 前置：必须重编 APK
>
> `install_znp_from_url` 是 **Rust** 改动 —— 手机上跑的包（`versionName=0.4.0`，18:01 装的）里没有它。
> 按既有约定「改 Rust 才需要重装 APK」，跑了一次 `android-dev.cmd`（约 4 分钟，增量）：
> 装成 **0.5.0**，`lastUpdateTime=19:34`。前端部分不用重装 —— 手机连的是桌面 dev 的 vite，
> 页面 `location.reload()` 就拿到最新代码。
>
> ### 结果
>
> | 步骤 | 结果 |
> |---|---|
> | 打开「发现」（默认公网 raw 索引） | **13 条**；第一次拉取**失败**（`连不上服务器`），**刷新一次就成了** |
> | 定位一个「可安装」的条目 | 手机上 14 个插件覆盖了索引全部 13 条 ⇒ 都是「已安装」 |
> | 删 `tag-panel` 造「安装」态 | ❌ **删不掉**：reload 时 `ensureBuiltinPlugins` 立刻按内置版补回（这是它该干的事） |
> | 改为直调内核命令 | `install_znp_from_url` → `{ok:true, id:"tag-panel"}` |
> | 磁盘 | `index.js / manifest.json / **signature.json**`，`keyId = aqua-2026` |
> | reload 后 | 插件列表 `标签 v0.2.0 **已签名**`，无错误；插件数回到 14 |
>
> 最后一行同时证明了四件事：下载通、**整包 sha256** 对得上、解包原子落盘、
> **内置公钥在手机上验签通过**，以及 rev173.147 的「有签名不被内置版覆盖」在真机上也成立。
>
> ### 两条经验（下次别重踩）
>
> 1. **内置插件删不掉**：想造「可安装」状态不能用删内置插件的办法（reload 必被补回）。
>    手机端又没法用本机静态测试床（`http` 只允许回环地址），所以要测「UI 点安装」得：
>    ① 先在索引里加一条**非内置**的测试包（要推公网才能 https），或
>    ② 像这次一样直调 `install_znp_from_url`（走的是同一份代码路径，差的只是按钮接线 ——
>    而按钮接线在桌面端已经端到端验过）。
> 2. **raw 会偶发连不上**：手机第一次拉索引就失败、刷新即好；桌面 `verify-public.mjs` 第一次跑
>    也因为某个请求挂住跑了 6 分钟（加 20 s 超时后 13/13 只用了 6.3 s）。市场页的「刷新」
>    按钮就是给这种情况留的 —— 不要因为它偶尔失败就以为坏了。

> ## 📌 rev173.150（2026-10-25 · 插件包入库 —— 开源当天就发现「能看不能装」）

> 用户：「开源」。翻转可见性 + 审计之后立刻做了一件事：**用普通用户的视角从公网拉一遍市场**。
> 结果抓到一个会让市场白做的坑。
>
> ### 实测：索引通，包不通
>
> | 地址 | 直连结果 |
> |---|---|
> | `raw.githubusercontent.com/…/market/index.json` | ✅ **200 · 693 ms** |
> | `api.github.com/repos/…/contents/…` | ✅ 200 · 535 ms |
> | `cdn.jsdelivr.net/gh/…` | ❌ TLS 连不上 |
> | `github.com/…/releases/download/…/tag-panel-0.2.0.znp` | ❌ **`github.com:443` 连不上**（21 s 后失败） |
>
> 也就是说：**列表能拉出来，点安装全部失败**。在国内直连（不走代理）就是这个状态。
>
> ### 处置：包入库，索引与包同一个域名
>
> - 13 个包（**573 KB**）复制进 `market/packs/` 并**入库**（原来只在 `dist/`，而 `dist/` 不入库、只挂 Release）
> - 索引里每条 `url` 改成 `https://raw.githubusercontent.com/aqua7773/zeronote/main/market/packs/<file>.znp`
> - `pack-plugin.mjs`：默认输出 `market/packs/`、默认 url 走 raw（`--out` / `--url-base` 还能改回去）
> - `gen-market.mjs` 新增校验 ④：**包必须在 `market/packs/`，且文件 sha256 与条目一致** ——
>   挡两种「本地看着没事、用户装不上」的漂移：改了包忘重建索引 / 忘了入库
> - `verify-trust.mjs` 默认验**入库的那份**（市场真正分发的字节），`--packs` 可指别处
>
> ### 证据
>
> 1. `node scripts/gen-market.mjs --write` ✅ 13 条，且新校验通过（包在、sha 对）
> 2. `node scripts/verify-trust.mjs` ✅ **12/12 签名包**用内置公钥验过（1 个纯样式无签名）
> 3. 公网匿名验证（`fetch` 不走系统代理 = 普通用户视角）：拉索引 + 逐包下载 + 核 sha256 + 重算 payload 验签
>
> ### 边界
>
> 1. **raw 有速率限制**（未登录按 IP 限流）。13 个包一次装一遍没问题；真放大到几十个插件时，
>    该考虑 CDN 或自建源（`install_znp_from_url` 已经允许填自己的索引地址）。
> 2. Release 上那 13 个包还在（`plugins-v0.5.0`），只是索引不再指向它 —— 留着当镜像，不删。

> ## 📌 rev173.149（2026-10-25 · 开源：审计 → MIT → 可见性翻转）

> 用户：「开源」。公开是不可逆的，所以顺序是 **审计 → 补必要的文件 → 提交推送 → 再翻转可见性**
> （这样公开的那一瞬间，仓库里已经是「带 LICENSE 和免责」的版本）。
>
> ### 审计（公开前必须做的）
>
> | 查什么 | 结果 |
> |---|---|
> | 密钥类文件（`.pem` / `.jks` / `.env` / keystore / credential） | 只有 `gradle.properties`（干净）与 `tests/kernel-secrets.test.ts`（测试夹具） |
> | 当前树内容（`ghp_` / `github_pat_` / `sk-` / `AKIA` / `BEGIN … PRIVATE KEY`） | **零命中**（`git grep` 全树） |
> | **全部历史**（`git log -S` 私钥 / `ghp_`） | **零命中** |
> | 历史上出现过的敏感文件名 | 只有 `_tmp-vault-*/probe.md` 两个测试探针，内容就是「标题行 / 正文内容」 |
> | 提交者身份 | `self@local`（不暴露邮箱） |
> | 内网地址 / 测试账号 | `192.168.1.x` × 若干、`aqua7773/zeronote-sync-test`（私有）、`minioadmin`（rclone 本地测试假账号）—— 都无凭据价值 |
>
> 私钥本来就在仓库外（`%USERPROFILE%\.zeronote-keys\`），公钥是公开的，没问题。
>
> ### 补了什么
>
> 1. **`LICENSE`**：MIT（`Cargo.toml` 早就写 `license = "MIT"`，但一直缺文件 —— 开源时才发现）
> 2. **README 顶部免责**：插件与内核**同权限运行**、内核**不提供沙箱**，「装谁的插件」就是全部安全边界；
>    优先用带签名且你信任作者的；数据自行备份。这不是免责套话 —— 架构原则 §2 就是这么定的（拆掉 capability 裁剪）
> 3. README 现状行 rev173.137 → rev173.148，补插件市场
>
> ### 结果
>
> `gh repo edit aqua7773/zeronote --visibility public` → `{"isPrivate":false,"visibility":"PUBLIC"}`。
> 公开后立刻验证：匿名（不带 token）拉 `market/index.json` = **200 · 693 ms · 8219 B**。
>
> ### 边界 / 提醒
>
> 1. **历史不可改写**：公开后 `_logs` 之外的开发记录、内网地址、测试仓库名都在历史里。要彻底清得 rewrite 历史，
>    那会破坏全部 rev 记录 —— 不值得，也没做。
> 2. 仓库公开 ≠ 市场能给别人用：Release 下载域名在国内连不上，才有了 rev173.150 的「包入库」。
> 3. 没有 CI，也没有 issue 模板 / CONTRIBUTING —— 真要收外部 PR 时再补。

> ## 📌 rev173.148（2026-10-25 · 插件市场阶段 1：应用内「发现」tab）

> 用户：「开工」。两个前置（rev173.146 公钥内置、rev173.147 不覆盖市场版）已清零，这一段把市场入口做出来。
>
> ### 形态（照 `docs/插件市场-调研-2026-10-25.md` §4.4）
>
> **不是新页面，是插件管理页的第二个 tab**：`[已安装 13] [发现]`。理由：用户心智是「装插件 → 去插件管理」，
> 另开一页会让同一个插件在两个地方各显示一次；手机上也能少一层导航。
>
> | 环节 | 落点 |
> |---|---|
> | 索引 | `market/index.json`（静态 JSON，`gen-market.mjs` 生成，进质量门）· 地址可改，存 localStorage |
> | 列表 / 状态 | `src/kernel/market.ts`：`parseMarketIndex`（坏条目跳过并记原因）· `marketAction`（`compareVersions`，不是字符串比） |
> | 下载 + 校验 + 安装 | Rust `install_znp_from_url`：**一次完成**，任一失败不落盘 |
> | UI | `src/components/MarketPane.tsx`：索引地址一行 + 条目列表 + 安装确认框（作者/大小/URL/校验与权限说明） |
> | 权限说明 | 确认框里写明「整包 sha256 对不上 / 验签不过就不写入」+「与内核同权限运行」 |
>
> ### 两处刻意的设计
>
> 1. **校验与落盘在同一侧**：不在前端 `net_request` 拿 base64 再交给安装 —— 中间多两次转换，
>    真出「前端校验过、落盘的不是同一份」时几乎没法查。Rust 里下载 → `Sha256::digest` 比对 → `install_pack`（原子）。
> 2. **私有仓库不装成「空市场」**：默认索引地址是本仓库 raw，现在 private ⇒ 匿名 404。
>    UI 直接说「HTTP 404（私有仓库的 raw 地址匿名拉不到：把仓库设为公开，或在这里填一个可匿名访问的索引地址）」。
>    换源的入口就摆在页面上（输入框），不藏在设置里。
>
> ### 证据（桌面 dev + 本机静态服务，全部真机点击）
>
> | 步骤 | 结果 |
> |---|---|
> | 打开「发现」（默认索引） | `HTTP 404` + 私有仓库提示，不是空列表 |
> | 改成 `http://127.0.0.1:8765/_tmp-market/index.json` | **14 条**渲染；已装 13 个显示「已安装」，demo 显示「安装」 |
> | 点安装 demo 0.1.0 → 确认 | 磁盘出现 `.zn/plugins/market-demo/{manifest.json,index.js}`；tab 回「已安装 15」 |
> | 索引升 demo 到 0.1.1 → 刷新 | 行显示「市场演示 v0.1.1 · 483 B · 已装 v0.1.0」+「↑ 更新 0.1.1」 |
> | 点更新 → 确认 | 成功；磁盘 manifest 版本 = **0.1.1**；加载无错 |
> | **把索引里 demo 的 sha256 改成全 0** → 点更新 | 报「插件包校验失败：索引记录 sha256=0000…，实际下载到 ab605b… —— 不安装」；**磁盘版本仍是 0.1.1** |
>
> 最后一条是这一段最重要的证据：**失败不落盘**不是靠代码读出来的，是端到端跑出来的。
>
> 数字：内核命令 33 → **34** · Rust 49 → **52**（URL 白名单含 `http://127.0.0.1.evil.com` 前缀混淆 / 正常安装 / sha 不符不落盘）·
> vitest 932 → **949**（`market.test.ts` 11 条 + `market-pane.test.tsx` 6 条）。
>
> ### 边界（别误会成「已经能给所有人用」）
>
> 1. **仓库还是 private** ⇒ 默认索引匿名拉不到、Release 包也匿名下不了。真正的对外分发要先开源（或自建可匿名访问的源）。
>    现在能做的就是「换索引地址」那一格。
> 2. **手机端没实测**：市场页在 `mainView === 'plugins'` 里，手机上同一个组件；但 CDP 要 `adb forward`，
>    本轮桌面 dev 在场、没有真机走查。下次手机验收时顺手点一遍即可（逻辑零平台分支）。
> 3. **设置页那段插件区没接市场**（只有主区插件页接了）。设置页的 `PluginPanel` 是另一个组件（`SettingsPanel` 里的插件段），
>    它的 `onInstall` 仍只走「选本地 .znp」。
> 4. 没有「详情页」、没有更新角标、没有启动时的更新检查 —— 那是第二批（调研 §4.4 的第二档）。

> ## 📌 rev173.147（2026-10-25 · 内置插件不再覆盖市场版本 —— 阶段 1 的第二个前置）

> 用户：「继续 ZeroNote 插件市场」。rev173.146 补了「别人装得上」，这一段补「装了之后不被偷偷退回去」。
>
> ### 旧逻辑的两个坑（都会在阶段 1 上线后变成真事故）
>
> 1. **覆盖 = 静默回退**：`ensureBuiltinPlugins` 每次启动「内容不同就写」⇒ 从市场装了官方插件的
>    新版（比如 `outline-map` 0.3.0），重启后被应用内置快照（0.2.0）盖回去。用户看到「更新了但没变」。
> 2. **覆盖 = 插件坏掉（不只是回退）**：市场装的目录里有 `signature.json`。内置版覆盖 `index.js` 后，
>    签名与新内容对不上 ⇒ 宿主判「签名无效」⇒ **拒载**。比回退更糟：插件直接消失。
>
> ### 新规则
>
> | 已装目录状态 | 动作 |
> |---|---|
> | 内容与内置完全一致 | 不动（**零额外 invoke** —— 这是绝大多数启动的情况，成本不变） |
> | 有 `signature.json` | **一个字节都不写**（签名渠道装的归签名渠道；内置版没有签名，也无法签） |
> | `manifest.version` 比内置新 | 跳过（`compareVersions`，`1.10.0 > 1.9.0` —— 字符串比较会判反） |
> | 首装 / 内置更新 / 同版本内容不同 | 覆盖（升级应用时内置插件要跟着走） |
>
> 返回对象加 `skipped: [{ pluginId, reason: 'signed' | 'newer' }]` —— 只影响排障，调用方目前仍只看 `failed`。
>
> ### 证据
>
> 1. **vitest 926 → 932**：4 条覆盖规则（更新版不动 / 签名不动 / 同版本照盖 / 旧版照盖）+ 2 条
>    `compareVersions`（`1.10.0 > 1.9.0` / 相等 / `v` 前缀 / 段数不同）。
> 2. **反向验证**：把判据 `compareVersions(installed, builtin) > 0` 改成 `>= 0` ⇒
>    「同版本内容不同：照旧覆盖」那条立即红（1 failed / 8 passed），恢复后绿。
> 3. 原 3 条（失败清单可见性）未改、仍绿 —— 新逻辑没有牺牲 rev173.41 的可观测性。
>
> ### 边界
>
> 1. **「签名目录不动」是刻意的取舍**：应用升级带了更新的内置版，签名目录也不会被更新。
>    想让那种插件升级，得走市场（或用户自己删目录）。理由：内置版无法签名，覆盖必然把它从「能跑」变成「拒载」。
> 2. **`manifest.json` 坏掉时按「未知版本」走覆盖** —— 那是恢复路径，不是覆盖市场版的场景（坏目录本来也加载不了）。
> 3. 桌面端 app 内实测仍未做（同 rev173.146 的边界：android-dev 在场，不在这个窗口再起第二个 dev）。

> ## 📌 rev173.146（2026-10-25 · 公钥内置进应用 —— 别人装得上、验得过）

> 用户：「继续 ZeroNote 插件市场」⇒ 按 CARD 写的「下一步唯一动作」（阶段 1 的前置）先补公钥内置。
>
> ### 改了什么
>
> `verify_plugin_signature`（Rust）的信任根从「**只读** `<应用数据目录>/.zn/trusted-keys.json`」
> 变成 **内置 `BUILTIN_TRUSTED_KEYS`（`aqua-2026`）∪ 用户那份文件**。
>
> 旧行为的后果（rev173.145 段「边界」第 2 条写的那件事）：新装机器 / 换电脑上那个文件不存在
> ⇒ `verify_plugin_signature` 直接 Err ⇒ **12 个签名插件全部拒载**。
>
> 合并规则（`load_trusted_keys`）：
>
> | 情况 | 结果 |
> |---|---|
> | 用户文件不存在 | 只有内置 —— **新装机器的正常状态**（旧版在这里报错） |
> | 同 `keyId` | 用户那条**覆盖**内置（轮换 / 撤销走这条；只剩一条，不按顺序碰运气） |
> | 其它 `keyId` | 追加（外部作者公钥） |
> | 文件存在但坏 JSON / 缺字段 | **报错不静默跳过**（硬约束 4：用户以为加上了却没生效最危险） |
>
> ### 证据
>
> 1. **Rust 测试 43 → 49**（新增 6 条）：内置常量能解成合法 32 字节 Ed25519 公钥 ·
>    验签三条判据（好签名过 / 改载荷不过 / keyId 不在信任根时文案点名「没有公钥」而不是含糊的「签名无效」）·
>    文件缺失回落内置 · 追加第三方不挤掉内置 · 同 keyId 覆盖后只剩一条 · 坏 JSON / 缺字段 / 缺 keys 三种形状都报错。
> 2. **`scripts/verify-trust.mjs`**（新增，发版前手工跑，**刻意不进质量门**：私钥与 `dist/` 都只在本机）：
>    从 `lib.rs` **解析**常量（不另抄一份 —— 抄一份就多一个会漂移的副本；常量改名时它会直接报错，不会静默跳过）：
>    - 私钥导出的公钥与内置值**逐字节相同**
>    - 自签 payload 用内置公钥验过
>    - `dist/` 里 13 个 `.znp`：**12 个签名包全部用内置公钥验过**；1 个纯样式无签名（无 entry ⇒ 宿主恒 unsigned，打包时也拒签）
>    ⇒ 「新装机器的宿主能不能加载这 13 个包」不用装 app 也答了。
> 3. **Android 侧编译通过并已装到手机**（android-dev 在场，改动被自动重编：`Finished dev profile`，4 个既有 warning）。
>
> ### 同步的文档
>
> 契约 §3（信任根 = 内置 ∪ 用户文件）· `contract.ts` 的 `manifest.sha256` 注释 ·
> `plugin-signing.ts` 的 `TRUSTED_KEYS_REL` 注释 · ROADMAP §3.3 · `docs/README.md` 权威矩阵（插件市场 draft → active）·
> `market/README.md`（公钥那节改成「内置为主，本机文件用于覆盖 / 追加」）· CHANGELOG `[Unreleased]` · CARD。
>
> ### 边界
>
> 1. **桌面端没做 app 内实测**：本轮 android-dev 一直在编（用户在手机上干活），`cargo test` 与它共用
>    `CARGO_TARGET_DIR`，`--no-default-features` 差异还触发了一轮依赖重编 —— 不在这个窗口再起桌面 dev 添乱。
>    直接证据是：同一段 Rust 在 android target 编过 + node 侧用**同一算法**（Ed25519 + 内置公钥）验过 12/12 包
>    + 6 条单测覆盖合并规则。下次桌面 dev 起来时 reload 一次即可（预期：删掉 `trusted-keys.json` 也照常加载）。
> 2. **`ensureBuiltinPlugins` 覆盖冲突还没修**（阶段 1 必须一起）。本轮把判据看清楚了：现在「内容不同就覆盖」
>    ⇒ 从市场装的官方插件新版重启后被内置版盖回去；更糟的是**覆盖后目录里残留的 `signature.json` 与新内容对不上
>    ⇒ 插件变「拒载」**，不是简单回退。改法方向：读现有 `manifest.version` 与内置版本比较，内置更新才覆盖；
>    「签名目录动不动」要动手前定（覆盖就得先删签名 = 绕过签名渠道，不是小事）。
> 3. 公钥内置 = **持私钥者可向所有用户推任意代码**。已写进 `market/README.md` 与调研 §6，不藏着。

> ## 📌 rev173.145（2026-10-25 · 13 个插件包已上传 GitHub Release）

> 用户：「上传」。
>
> ### 结果
>
> Release：`https://github.com/aqua7773/zeronote/releases/tag/plugins-v0.5.0`
>
> `gh release view` 核对 **assets = 13**（accounting 66 KB … theme-sepia 0.7 KB，与本地 dist 逐个对得上）。
>
> ### 端到端校验（这步不能省）
>
> 从 Release 下载 `tag-panel-0.2.0.znp`，与 `market/entries/tag-panel.json` 对比：
>
> | 项 | 下载所得 | 索引记录 |
> |---|---|---|
> | sha256 | `63b77ad6146e…d748dc` | `63b77ad6146e…d748dc` ✅ |
> | 大小 | 24391 B | 24391 B ✅ |
>
> ⇒ **索引 → Release → 下载 → 校验**这条链路是通的。只测「上传成功」不够 —— 传上去的字节和索引里记的必须是同一个。
>
> ### 现在的链路状态
>
> | 环节 | 状态 |
> |---|---|
> | 插件源码 → `.znp`（打包 + 签名 + 算整包 sha） | ✅ rev173.143/144 |
> | `.znp` → GitHub Release | ✅ **本段** |
> | Release → 索引（url + sha256） | ✅ 本段校验过 |
> | 索引 → 客户端（下载 → 校验 → 安装 → 重扫） | ⏳ **阶段 1**（还没有 UI 与那条内核命令） |
> | 公钥内置进应用 | ❌ 未做 |
>
> ### 边界（别误会成「已经能用了」）
>
> 1. **应用里还没有市场入口** —— 现在只能手动下载 `.znp`，再走「插件管理 → 安装插件包」。
> 2. **别人装了也会验签失败** —— 他们的 `trusted-keys.json` 里没有 `aqua-2026`。
>    公钥内置是阶段 1 之前必须补的一步（约 1 h，改 Rust 端信任根：内置一份 + 用户那份叠加）。
> 3. Release 是 **private 仓库**的，别人看不到 —— 真要公开分发，仓库得先开源（那是另一件事）。

> ## 📌 rev173.144（2026-10-25 · 正式签名密钥 + 13 个官方插件打包入市）

> 用户：「先把正式签名密钥生成好，再把 13 个官方插件打包装进市场」。
>
> ### 1. 正式密钥
>
> | 项 | 值 |
> |---|---|
> | keyId | **aqua-2026** |
> | 私钥 | `%USERPROFILE%\.zeronote-keys\aqua-2026.key.pem` —— **故意放在仓库外**，不进 git、不进 `dist/` |
> | 公钥 | `iOIIUrkdKmP0w+pwpgqGiqSsLJYfl9Pa5VeUCBCjh6E=` |
>
> 公钥已写进本机信任根 `%APPDATA%\com.aqua.zeronote\.zn\trusted-keys.json` ——
> 不写这一步，本机装任何签名插件都会被**拒载**。
>
> ### 2. 打包 13 个插件
>
> 全部用 `pack-plugin.mjs` 打包并签名，统一 Release tag `plugins-v0.5.0`（跟 app 版本对齐，避免每个插件各一个 tag）：
>
> | 插件 | 大小 | | 插件 | 大小 |
> |---|---|---|---|---|
> | accounting | 66.0 KB | | outline-map | 79.3 KB |
> | backlinks | 23.7 KB | | sync-folder | 42.5 KB |
> | doc-reader | 40.9 KB | | sync-git | 56.8 KB |
> | habit | 33.5 KB | | sync-s3 | 65.0 KB |
> | history | 28.5 KB | | sync-webdav | 77.1 KB |
> | import-export | 35.3 KB | | tag-panel | 23.8 KB |
> | theme-sepia | 0.7 KB（纯样式，未签名） | | **合计** | **≈ 573 KB** |
>
> ### 3. 打包规则改了一条（重要）
>
> 原来的 `collectPluginFiles` 是**收整个目录**。实测 `examples/outline-map/` 里有
> `selftest.mjs` / `selftest-buttons.mjs` / `store.json` / 遗留的 `vendor/`（mind-elixir 现在从
> `public/vendor/` 加载，插件目录里那份已经不用了）—— 全都会被塞进包。
>
> 改成**只收 manifest 声明的 `entry` / `files` / `styles`**。依据很硬：
> 宿主真正会用到的只有这三类，插件**读不到**自己目录下的其它文件（`ctx.fs` 全是库内相对路径）。
> 包从「79.3 KB + 一堆垃圾」变成干净的 79.3 KB，签名覆盖范围也清楚了。
>
> ### 4. 验证
>
> **端到端验签 12/12 通过**：写了一个一次性脚本，对 `dist/` 里每个包按**宿主加载时的算法**重算 payload
> （入口 sha + `manifest.files` 摘要、按路径排序），再用公钥验 `signature.json`，同时断言
> `manifest.sha256` 与入口 sha 一致 —— 全部 ✅。跑完即删（脚本不该留在仓库里，逻辑已在单测覆盖）。
>
> 第 13 个 `theme-sepia` 是纯 CSS 插件（没有 `entry`）：宿主对它**恒为 unsigned**（`plugin-host.ts` 那条无入口分支），
> 所以打包时跳过签名、`manifest.sha256` 也不填 —— 不是漏签，是签不了。
>
> ### 5. 没做完的两件（说明确）
>
> 1. **包还没上传**：`market/index.json` 里 13 条 url 指向
>    `github.com/aqua7773/zeronote/releases/download/plugins-v0.5.0/*.znp`，但那个 Release **还不存在**
>    ⇒ 现在去装会 404。上传是外向写操作（`gh release create`），留给你点头。
> 2. **公钥还没内置进应用**：别人装市场包会验签失败。这一步要改 Rust 端信任根的加载顺序
>    （内置一份 + 用户那份叠加），约 1 h。
>
> ### 6. 边界
>
> - **改 CSS 不会让签名失效**：`v2` 只签 `entry` + `manifest.files`，`styles` 不在里面。
>   改 `outline.css` / `theme.css` 后签名仍然通过（和 `platforms` / `capabilities` 同一个取舍，见调研 §5）。
> - **预装插件的覆盖问题仍在**：`ensureBuiltinPlugins` 启动时用内置版本覆盖全局目录 ⇒
>   从市场装的**官方插件新版**重启后会被回退到 app 内置的版本。这条要等阶段 1 一起解决。

> ## 📌 rev173.143（2026-10-25 · 插件市场阶段 0：打包 / 索引 / 原子安装）

> 用户拍板四项（做 · 外部作者开放 · 索引放本仓库 · 签名扩），④ 已在 rev173.142 交付，本段做 ①②③ 的地基。
>
> ### 交付
>
> | 文件 | 作用 |
> |---|---|
> | `scripts/lib/signing.mjs` | 签名的 **Node 侧单一实现**（payload / 收集文件 / 签名）；`sign.mjs` 与 `pack-plugin.mjs` 共用，避免两份漂移 |
> | `scripts/pack-plugin.mjs` | 插件目录 → `.znp`（含 `manifest.sha256` + `signature.json`）+ **市场条目**（展示字段 + 下载地址 + **整包 sha256**） |
> | `scripts/gen-market.mjs` | 合并 `market/entries/*.json`（官方）与 `market/external.json`（外部）→ `market/index.json`；**已进质量门** |
> | `market/` | `README.md`（官方发版 + 外部投稿流程）· `external.json`（PR 加一行）· `entries/`（pack 生成）· `index.json`（生成物） |
> | `src-tauri/src/lib.rs` | **`install_znp` 改原子安装**（见下） |
>
> ### 为什么 `install_znp` 必须改
>
> rev119 的实现是**逐文件覆盖写、不删旧文件**：装上半个包（下载中断 / 校验失败之前就开写）会留下
> 「新 index.js + 旧 lib/x.js」这种混合目录，而且这个目录**正在被应用加载**。
> 现在：整包先写进 `<私有根>/.zn/tmp/install-<id>-<ms>/` → 旧目录挪成 `prev-*` → 新目录 rename 上位 → 删旧。
> 任一步失败 ⇒ 清理暂存 + 把旧目录放回原位，**要么全旧要么全新**。
>
> ⚠️ **语义变化**：整目录替换 ⇒ 旧目录里没被新包覆盖的文件会消失（rev119 的「不删旧文件」已废）。
> 另：开发时插件目录常是 junction 指向 `examples/`，安装会替换掉那个链接（要重新 link）。
>
> ### 质量门新增一项
>
> `check-gates` 加了 `market`：**条目里的 version 必须与 `examples/<id>/manifest.json` 一致**
> —— 改了插件却忘了重新打包，门直接红。这取代不了「人记得发版」，但至少不会静默漂移。
>
> ### 验证
>
> - `pack-plugin` 实跑两个真实插件：`tag-panel`（单文件，23.8 KB）· `cjs-multi`（4 文件含 2 个 lib，2.4 KB），
>   包内 `signature.json` 与 `manifest.sha256` 都写进去了
> - `sign.mjs` 重构后 `--check` 输出与重构前**逐字相同**（同一 sha、同一 payload）
> - Rust 测试 41 → **43**：`install_znp_rolls_back_on_bad_pack`（非字符串文件 ⇒ 失败且旧 manifest/index 原封不动、`.zn/tmp` 不留垃圾）·
>   `install_znp_replaces_dir_wholesale`（旧目录多余的 `lib/gone.js` 安装后消失）
> - `gen-market` 空索引起步可跑（官方 0 / 外部 0），质量门 6/6
>
> ### 没做的
>
> **阶段 0 只到「能打包、能生成索引、安装不污染」**。应用里还没有任何市场 UI（阶段 1），
> 也没有正式的发布密钥 —— 官方条目要等你生成私钥后跑 `pack-plugin --key` 才会有内容。
> 索引目前是空的（`plugins: []`），这不影响门禁与其它功能。

> ## 📌 rev173.142（2026-10-25 · 插件签名 v2：manifest.files 一并签进 payload）

> 用户拍板「扩」（原话：1.做，2.开放，3.同意，4.扩）。本条交付 ④ 签名，市场主体在后续 rev。
>
> ### 为什么（数字说话）
>
> - v1 的 payload 只含**入口** sha256 ⇒ 多文件插件里换掉 `lib/*.js`，验签照样通过。
> - 37 个插件里只有 1 个用 `manifest.files`（`cjs-multi`，还是示例）；**带 `signature.json` 的插件 0 个**
>   ⇒ 现在改**零兼容成本**，以后改则所有已签名分发的包全部失效、用户侧表现是「插件突然加载失败」。
> - 市场安装路径有索引 sha256 兜底，但**手动分发的包**只有签名这一道防线（详见调研 §5 三条路径）。
>
> ### 改了什么（三处 + Rust 没动）
>
> | 文件 | 改动 |
> |---|---|
> | `src/lib/plugin-signing.ts` | 前缀 v1 → **v2**；`signingPayload(id, version, entrySha, files?)` 新增第 4 参（`SignedFileDigest[]`），内部按路径**字典序**排序后拼接 |
> | `scripts/sign.mjs` | 同步实现；额外校验 `manifest.files` 声明的文件**都存在**（缺文件直接报错退出，不再签出一个装不上的包） |
> | `src/kernel/plugin-host.ts` | **把 `manifest.files` 的读取提前到验签之前**——原来验签在组装 CJS 之前，签名时根本拿不到 lib 文件；现在读一次，验签与组装两处复用。`verifyPluginSignature` 多收 `files` |
> | `src-tauri/src/lib.rs` | **未改**：`verify_plugin_signature` 只对 payload 字符串验签，不关心内容 |
>
> payload 形状：
>
> ```
> zn-plugin-v2|<id>|<version>|<入口 sha256>|<path:sha256 按路径排序，| 分隔>
> ```
>
> 无 `files` 的插件末尾留空段（`zn-plugin-v2|tag-panel|0.2.0|<sha>|`）⇒ 单文件与多文件不会撞成同一个字符串。
>
> ### 验证
>
> - 单测 9 → **11**：排序无关 / 换内容·换路径·删文件·加文件四种篡改都让 payload 变 / 真实 Ed25519 往返（改 `lib/a.js` 后验不过）/ v1 签名在 v2 下验不过
> - **脚本 ↔ 前端一致性**：拿真实 `examples/cjs-multi` 跑 `sign.mjs --check`，输出
>   `zn-plugin-v2|cjs-multi|0.1.0|<entry>|lib/counter.js:<sha>|lib/greet.js:<sha>`（manifest 声明顺序是 greet→counter，payload 按路径排序）
>   与 vitest 里 `signingPayload` 的结果**逐字相同**（临时测试，验完即删）
> - **反向验证**：把 `tail` 改成恒空 ⇒ **3 条红**；恢复即 11 条全绿
> - 契约 §3.4 payload 段重写（含 v1 废弃说明）；`docs/插件市场-调研` §5「建议扩」→「已扩 + 落地形态 + 没签哪些字段及理由」
>
> ### 边界
>
> `platforms` / `capabilities` / `name` **没纳入签名**：`capabilities` 只是自述（架构原则 §4.1），签了也不能当权限用、反而给人「签过 = 安全」的错觉；
> `platforms` 被改最多让插件在另一平台显示不可用，不构成代码注入。将来若要做「清单式审核」再升 v3。

> ## 📌 rev173.141（2026-10-25 · 插件市场形态 + 开发者流程（补 §4.4 / §4.5））

> 用户追问两点：「插件市场的形态（入口在哪、用户通过什么方式安装和更新）」+「开发者怎么上传插件和维护」。
> 补进 `docs/插件市场-调研-2026-10-25.md`（§4.4 / §4.5），**代码仍未改动**。
>
> ### 形态（§4.4）
>
> - **市场不是新页面**，是「插件管理页」里的第二个 tab（`mainView === 'plugins'` 已经存在）。
>   理由：用户心智是「我要装插件 → 去插件管理」；另开一页会让同一个插件在两处各显示一次；
>   `PluginPanel`（323 行）的分组列表 / 开关 / 删除 / 日志全都能复用，只多一列「安装 / 更新」。
> - 入口沿用现有三个（右键 ☰ 菜单 · 手机长按 ☰ 的「⋯」/ 长按 600ms · 命令面板 `core.plugins`），
>   新增两个：桌面把 `.znp` 拖进窗口、可选的命令 `core.market` 直达「发现」tab。
> - 安装 4 步：确认框（列出**能力自述** + 来源 URL）→ 下载（进度条）→ 校验（sha256 + 验签，**失败一律不落盘**）→
>   解包进全局根 + 自动重扫 + 跳到「已安装」并启用 + toast。
> - 更新三档：手动按钮 / **启动静默检查（24 h 节流，只在新版时给角标，不下载不安装）** / 自动安装 **❌ 不做** ——
>   插件能读任意文件、能 invoke 命令（契约 §4.2），替换代码必须让人看见。
> - **顺手发现一个现存隐患**：`install_znp` 是「覆盖写同名文件」，半截包会污染正在用的插件 ⇒
>   要改成「先解到临时目录 → 全部成功再换目录」（+0.5 h，已记进 §4.1 改动清单）。
>
> ### 开发者（§4.5）
>
> - **官方插件 = 零手工**：源码在 `examples/<id>/` → `pack-plugin.mjs` 打包 + 签名 → `gen-market.mjs` 从 manifest
>   自动生成索引（**跑进 verify 质量门**，索引与 examples 不一致就红）→ CI 发 Release。**加一个插件 = 加一个目录。**
> - **外部作者（将来）**：索引**不存版本号**（照 Obsidian），只存 `entry` 指向作者仓库根的 `market-entry.json`
>   （打包脚本自动生成，作者不用手写）。客户端列表页用索引里的 `latest` 快照（CI 刷新）免得 N 次请求；
>   点安装时先 GET `entry` 拿真实最新 ⇒ **作者发版不用改索引，也不会出现「索引说 0.3、实际 0.4」的漂移**。
> - **审核只审格式、不审代码**：内核本来就不为插件提供安全保证（架构原则 §4.1），假装审过反而更危险。
>   每周 CI 健康检查：404 / sha256 不符 / 仓库归档 ⇒ 索引标 `broken`，客户端显示「此插件已失效」。
>
> ### 边界（写进文档，不假装）
>
> 这套设计只在「自己发 + 少量外部作者」的规模成立。几百个插件、恶意提交出现时必须有**人工审核队列** ——
> 那已经超出 `D-009`「不做服务端」能覆盖的范围，本文没假装能扛住。
>
> ### 分期（更新后）
>
> 阶段 0（纯脚本 2 h，零内核改动）→ 阶段 1（插件管理页 +1.5 天，动内核 1 条命令）→
> 阶段 2 更新通道（+0.5 天）→ 阶段 3 外部作者开放（+1 天）。拍板点从 3 个变成 4 个（新增「外部作者现在开放吗」）。

> ## 📌 rev173.140（2026-10-25 · 插件市场可行性调研（不做实现））

> 用户原话：「先调研一下市场要怎么做」—— 只要调研，不实现。
>
> ### 产出
>
> docs/插件市场-调研-2026-10-25.md：
>
> - **先问「给谁用」**：自用 = 净成本（目录就在本机）；给别人 / 手机 = 刚需（MIUI 的 SAF 对 .znp 扩展名挑食，rev119 踩过）。
> - **一手参照 Obsidian**（抓 README + community-plugins.json）：索引就是一个静态 JSON（5 字段、**没有版本号**），
>   详情页拉插件自己的 GitHub 仓库，安装按 manifest.version 找同名 tag 的 Release ⇒ **市场不需要服务端**。
> - **现状逐条核实**：.znp 是**单文件 JSON**（不是 zip）· Ed25519 真签名已有 · 但签名只覆盖**入口文件**（manifest.files 未签）·
>   信任根手工放、无分发渠道 · **内核 33 条命令里没有任何安装 / 重扫命令** —— 插件够不着 ppDataDir()/.zn/plugins/，
>   所以市场**要么动内核加 1 条命令，要么做不成插件**。
> - **三个方案**：A 静态索引 + 一键装（≈1.5 天）/ B A + 更新通道（+0.5 天）/ C 服务端（不做，与 D-009 冲突）。
> - **分期**：阶段 0（打包 + 生成索引 + README 挂下载链接，**2 h，零风险**）→ 阶段 1（应用内面板）→ 阶段 2（更新提示）。
> - **安全叙事不包装**：架构原则 §4.1 说内核不为插件提供任何安全保证 ⇒ 市场 = **发现渠道 + 身份证明**，不是安全门；
>   并点明最大的一处权力集中：**一旦把市场公钥内置进应用，持私钥者就能向所有用户推任意代码**。
>
> ### 没做的
>
> **一行代码都没改。** 该文档 §7 的三个拍板点等用户：① 做不做 / 做到哪层 ② 索引托管在哪 ③ 签名要不要扩到多文件。
> D-008 加了 ⚠️ 更正块（重议条件已满足，**决策仍 pending**）；docs/README.md 权威矩阵与 ROADMAP §3.3 已指向新文档。
> ## 📌 rev173.139（2026-10-25 · HANDOFF 分卷 890 KB → 63 KB + ROADMAP 收口）

> 用户原话：「做A」—— 指上一轮汇报里「A. 不用等你就能做」的两项：HANDOFF 瘦身 + ROADMAP 收口。
>
> ### 为什么做
>
> HANDOFF.md 是「逐 rev 追加」的单一文件，14 天 538 个提交就长到 **890 KB / 10672 行 / 275 段**。
> 每个新会话开头都要读它 —— 这不是代码债，是**每个会话都要付的上下文税**
> （本会话开头读它就被截断：`line truncated to 2000 chars`）。
>
> ### 分卷（`scripts/handoff-archive.mjs` · 可复用 / 幂等 / `--dry-run`）
>
> - 主文件只保留**当前版本周期**：`KEEP_FROM = rev173.125`（0.5.0 全周期）⇒ **14 段 / 63 KB**
> - 更早的按版本切进 `docs/archive/handoff/`：`0.4.md` 54 段（194 KB）· `0.3.md` 44 段（110 KB）· `0.2.md` 163 段（480 KB）
> - 主文件顶部加**指路表**（版本 / rev 范围 / 归档链接）+ 查法 `git grep -n "rev173.100" -- docs/archive/handoff/`
> - 原「更新时间」行是 **25,989 字符**的累积摘要（把 275 个 rev 标题串成一条）⇒ 改成一行；信息没丢（索引表 + 归档都在）
> - **同时切索引表与正文段** ⇒ `check-docs` 第 ③ 条（索引 rev 集合 == 正文段 rev 集合）天然保持通过
>
> ### 副产物：分卷才暴露的死链
>
> `check-links` 递归扫 `docs/**` 但**不扫 `HANDOFF.md` 本身** —— 归档进 `docs/` 之后，
> 原文一处 `[App.tsx](<src/App.tsx>)`（角度括号伪链接）第一次被检查到并报死链，已改成 `../../../src/App.tsx`。
> **结论**：以前 HANDOFF 里的链接完全在门禁之外，现在归档部分受保护。
>
> ### ROADMAP 收口
>
> 原来 6 项全 ✅ 但文件仍标 `active`、表里全是已完成项 ⇒ 新会话读完不知道下一步能做什么。重写为：
> 上一阶段（留档）→ 已拍板决定 → **候选池**（卡外部输入 / 等输入 / 要用户拍板 / 小债）→ 固定收口 → 暂缓不做。
> 候选池**只收文档里已有记录的项，没有新发明工作**。
> 其中 `D-008` 重议条件「插件数 > 10」已满足（预装 13）⇒ 标成「要不要重开由用户定」。
>
> ### 顺手：HANDOFF-CARD 也瘦了（540 → 84 行）
>
> 卡本身超了规范 4 倍（`docs/文档编写规范.md` §5.5：**≤ 120 行**）：200 行是「下个会话第一件事」的 ✅ 累积、
> 50 行是 0.3.0 周期的 rev 表 —— 全是 HANDOFF 里已有的重复。
> 删重复、留真未决（7 条卡点）、环境现状只留当前一代、硬约束 / 授权边界原样。
> 「踩过的坑」里 3 条早就在 `docs/开发约定.md`（`useState` 顺序 / 行号删段 / HANDOFF 标题行），
> 剩下 2 条补进 §4 测试约定（**组件测试必须 `afterEach(cleanup)`**）与 §8（**CSS HMR 偶发不生效**），
> 「WebView2 的 CDP 端点只认 `node fetch`」补进本文备注。
> **信息没丢，只是不再写两遍。**
>
> ### 验证
>
> `check-docs` ✅ · `check-links` ✅ 39 条 · `verify.ps1` 六步（数字进 CARD 事实块）·
> 体积 **890 KB → 63 KB（-93%）**，段数 **275 → 14**（+本段 15）

> ## 📌 rev173.138（2026-10-25 · `rewrite_links` 两个防护 + 两次误判的教训）

> 用户原话：「修」「1，写进去」—— 意思是：把改名改引用的两个缺陷补掉，同时把这一天的两次误判写进约定。
>
> ### 先说误判（这轮真正花时间的部分）
>
> 我判断「改名后引用会断」，理由是 `useDocSession.openWikiLink` 按名字四级匹配、改名后就找不到。
> **错了**：`src-tauri/src/lib.rs` 的 `rename_note` 早在 2026-10-17 就会调 `rewrite_links`
> 扫全库改引用（`[[旧名]]` / `[[旧名|别名]]` / `[[旧标题]]` / `](旧路径)` 全支持），
> 引用方在改名那一刻就被改好了，根本不会断。
>
> 我为此写了 120 行前端实现 + 13 条单测 + App 接线，**全部回滚**（`git status` 干净、tsc 0、oxlint 3 = 基线）。
>
> 同一天更早还有一次同类误判：「普通待办不能点勾」—— 实际是 **atomic 0.6.2 依赖内置**的
> `TaskCheckboxWidget`（点了改文本、完成项删除线），项目 2026-10-17 还给它补过深色勾色。
>
> **两次的根因是同一个**：判断「有没有这个功能」时只 grep 了 `src/`（前端）。
> 而这个项目的功能横跨三层：**前端 `src/` · Rust `src-tauri/src/*.rs` · 依赖包 `node_modules/`**。
> 只查一层等于没查。
>
> ### 补上的两个防护
>
> | 缺陷 | 后果 | 修法 |
> |---|---|---|
> | 纯 `String::replace`，不看上下文 | 笔记里**贴的语法示例**（代码块 / 行内代码里的 `[[旧名]]`）会被一起改掉 —— 那是改坏别人的文档，而目标明明只是正文 | 新增 `replace_outside_code`：**状态机**（不是正则）逐行切 fenced / 行内 / 正文，只对正文段做替换 |
> | 改完直接覆盖，没有副本 | 批量改正文，改错了不可恢复（`history` 只在**关闭笔记**时存快照，救不了当场） | 新增 `backup_before_rewrite`：原文写到 `<库>/.zn/link-rewrite/<毫秒>/<原相对路径>`；`prune_rewrite_backups` 只留最近 20 次；备份失败只记日志、不阻断改名 |
>
> 为什么用状态机不用正则：反引号有单/双/三连、fenced 有未闭合、行内代码不跨行 —— 正则每一条都要单独处理边界，
> 越写越容易误伤；状态机只有三个动作（切 fenced / 切行内 / 其余照常）。
>
> ### 测试
>
> `rewrite_skips_code_and_keeps_backup`（Rust，cargo 40 → **41**）：
> ① 纯函数：fenced 与行内代码原样、正文替换、别名保留；
> ② 端到端：真建库 → 真 `rewrite_links` → 断言引用方正文改了、行内示例没改、`.zn/link-rewrite/<ms>/` 里备份的是**改前原文**。
>
> ### 写进约定的两条
>
> - `docs/开发约定.md` §0.5「写实现」那一行：先例要查**三层**（`src/` · `src-tauri/src/*.rs` · `node_modules/`）
> - §8 已知事故清单：两条误判各一行 + 一行「共同代价」（重复实现比不实现更难发现 —— 两套改引用的逻辑同时生效时，排查看不出是谁改的）
>
 
> ## 📌 rev173.137（2026-10-25 · 文档状态复核 + 发版 0.5.0）

> 这轮的活不是功能，是**把文档里的状态与代码对齐**，然后把 0.4.0 之后积压的 44 个提交发出去。
>
> ### 触发：状态头在骗人
>
> `docs/README.md` 的权威矩阵有四行状态与代码不符，其中一条**危险**：
>
> | 文档 | 旧状态 | 事实 |
> |---|---|---|
> | `快捷入口-调研-2026-10-19` | **active（待实现）** | rev173.20–22 已落地（`src/components/QuickLaunch.tsx` 5.7 KB；提交 `8339319` / `b35d646` / `86128aa`） |
> | `标签窗口拖拽-调研-2026-10-20` | **active（待用户选方案）** | 已裁决：B 方案 rev173.54 落地 → **rev173.68 按用户要求移除**（`88ea89b`），改「关闭 = 交回主窗口」 |
> | `全功能对标调研-方案-2026-10-20` | **active（v2 待评审，未开工）** | §6 五项**全部完成**：rev173.59 / 60 / 61 / 63 / 65 |
> | `同步插件-调研与方案-2026-10-24` | **active（插件本体待写）** | 四后端全部落地并真机验收：rev173.106–136 |
>
> ### ⚠️ 最危险的一条：`D-002` 还在说「不做云同步」
>
> `docs/decisions/D-002-不做云同步.md` 状态是 **accepted**，而同步插件已经做完 30 个 rev、四个后端
> 都有真机证据。**下个会话的 AI 读到 D-002 会照它说「本项目的定位是不做同步」** —— 这正是
> `HANDOFF-CARD` 硬约束第 4 条「静默失效比报错危险」的反面实例：错的不是代码，是**权威记录**。
>
> 处置：
> 1. 新增 **`D-009-做同步但自带后端.md`**（`accepted`）—— 把用户 2026-10-24 拍板的五件事写成决策：
>    四后端（本地文件夹 / WebDAV / S3 / Git）· 凭据走系统钥匙串 · 前台近实时（不加前台服务）·
>    三方合并「0 处真冲突才自动合」· 远端 `_zn/manifest.json` 为权威索引。**仍然不做账号 / 服务端 / E2E 加密**。
> 2. `D-002` 标 **superseded**，并在正文「决定」上方加 ⚠️ 更正块（原文保留作设计史）。
>    **只推翻「不做同步」这一半；「不做账号 / 不做服务端」仍然成立。**
>
> 同批：`D-006`（暂不接 `window-state`，原标 pending）→ **superseded** —— rev173.61 已接，
> 代码锚点 `src-tauri/Cargo.toml:61`、`src-tauri/src/lib.rs:2451`（`with_filter` 只跟踪 `main`）。
>
> ### 发版 0.5.0
>
> - `v0.4.0`（10-24 18:34）之后 **44 个提交**，主线是同步四后端真机落地 + 反链全库索引 + `note:*` 带正文。
> - **发现 0.4.0 的详细条目从来没归档过** —— 它只在上方「应用版本」表写了一行摘要，逐条内容散在
>   `[Unreleased]` 里。这次不伪造时间线：`[Unreleased]` 整体改名为 **`## [0.5.0] - 2026-10-25`**，
>   段首如实标注「本段还含 0.4.0 未单列的 rev173.106–124 条目」，并把属于 0.4.0 的那半（面板体系 /
>   A 档 4 插件 / 白屏兜底…）补成 `## [0.4.0] - 2026-10-24`。
> - `node scripts/release.mjs 0.5.0` 同步三处（`package.json` / `tauri.conf.json` / `Cargo.toml`）·
>   `node scripts/facts.mjs --write` 刷新 CARD 的事实块 · tag `v0.5.0`。
>
> ### 教训（写给下一次）
>
> **「状态头」也是一种代码注释** —— 它不会因为功能上线而自动更新，而且比代码注释更危险：
> 代码注释错了会被人读到上下文推翻，状态头错了会被当成**结论**引用（尤其 `decisions/`）。
> 每次 rev 收口时，顺手看一眼这次动到的东西有没有对应的「待实现 / 待评审 / pending」标记。
>
> ## 📌 rev173.136（2026-10-25 · `sync-folder` 真双端合并冲突验收 —— Syncthing 两实例）
>
> rev173.120 留的 ⚠️「真同步目录的合并冲突只到单测」这次补上了：用**真实 Syncthing**，
> 而不是手动改磁盘。
>
> ### 环境
>
> - **Syncthing 2.1.7** 便携版 → `Apps\Portable\Syncthing`（winget 的 msstore 源证书错误
>   `0x8a15005e`；GitHub 直连只有 42 KB/s、14 MB 包两分钟没下完 ⇒ 改 `gh release download`
>   走本机代理 `127.0.0.1:26561` 一次下完）
> - 同机两个实例：`_tmp-sync\st-a` / `st-b`，GUI **8384 / 8385**，监听 **22001 / 22002**
>   （`syncthing serve -C <dir> -D <dir> --gui-address=…`）
> - REST 配对（`_tmp-sync/pair.mjs`）：互加 device，同一个 folder id **`zn`**；
>   A = 测试库 `_tmp-vault-tb`，B = `_tmp-sync\peer-b`；两端 `.stignore` 都排除 `.zn`
>
> ### 时序与结果
>
> 1. 编辑器里给 `笔记1.md` 开头加 `A-SIDE-1521` ⇒ `note:saved` ⇒ `pending` + 影子副本
> 2. **1.7 秒后**在对端文件末尾加 `B-SIDE-1521`（mtime 更晚 ⇒ Syncthing 判 B 赢）
> 3. **4 秒后** A 目录出现 `笔记1.sync-conflict-20261025-151226-SLX52RS.md`（= A 版），
>    主文件 = B 版
> 4. `sync-folder` 判「本机 pending + 外部改」⇒ `tryAutoMerge`（base = history 同步点，
>    mine = 影子副本，theirs = 磁盘）⇒ **合上**：主文件 = `A-SIDE-1521…` + `B-SIDE-1521`
>    （两边改动都在）、`pending` 清空、面板 **「合并 1」**、不产生冲突记录
>    （合并成功不入 conflicts，符合 rev173.116 的设计）
>
> ### 清理
>
> 两个测试实例已停（**不常驻**；脚本与配置留在 `_tmp-sync\`，下次复跑 = 起两条 serve
> + `node _tmp-sync/pair.mjs`）。Syncthing 按机器规约登记：`_View\网络与传输\`
> （junction 第 55 条）+ `_软件清单.md`（网络与传输 7 → **8** 项）。
>
> ## 📌 rev173.135（2026-10-25 · `note:created` 也带正文 + 三处终端验收）
>
> 收掉 rev173.133 留下的 ⚠️（`note:created` 的 payload 不带内容），顺手把三件一直标「待验 / 待测」
> 的终端项做实。
>
> ### ① 代码：`note:created` 带 `text`
>
> `fs.createNote` 的 payload 从 `{ path }` 变成 **`{ path, text }`**（`text` = `content` 参数，
> 手上就有，零成本）；`fs.restoreTrash` 恢复成功时也带 `text`（读一次盘，读失败则**不带**该字段
> ⇒ 订阅方退回自己的读盘路径，不因版本差异静默失效）。
>
> 与 `note:saved` 同一个来由：订阅方（同步插件）要在**同步段**里种基线 / 同步点，
> Rust watcher 的 `note:changed` 回响才不会插进 `await` 窗口。
> `sync-folder` 的 `note:created` 处理改成「有 `text` 就同步 `adopt`，没有就退回读盘」。
> 契约 §1.4 表 `{ path }` → `{ path, text }`；`sync-folder` 0.3.1 → **0.3.2**。
>
> 单测 921 → **923**（restoreTrash 发 `{ path, restored: true, text }`；新建的判定段**零读盘**，
> 同步点直接用事件正文种下）。**反向验证**：把 `note:created` 的 `given` 掐成 `null` ⇒ 新用例红
> （1 failed / 44 passed），改回即绿。
>
> ### ② 终端验收（无代码）
>
> - **`history` 的 ☰ 菜单入口**（此前一直标「CDP 未验证，待手动」）：右键 ☰ →「历史版本」⇒
>   modal 打开（「笔记1」的历史 / 1 版 / 现在存一版），**标签条没有多一个标签**，Esc 可关
>   （`_shots/history-menu-20261025.png`）。
> - **`outline-map` 手机**：真机 `33b676f6` 点标题行 ❖ ⇒ 主区面板 `mind-elixir 5.15.1 · 5 个节点`，
>   返回键回编辑器（`_shots/phone-outline-map-20261025.png`）。**同轮修环境坑**：手机
>   `adb reverse tcp:1420` 丢失 ⇒ WebView 连不上 1420 ⇒ 看门狗杀进程（表现为启动 15 秒后无声退出，
>   logcat 只有 `pthread_mutex_lock called on a destroyed mutex`）—— 重连 adb 后先
>   `adb reverse tcp:1420 tcp:1420` 再启动。
> - **`sync-webdav` 附件方向**（rev173.127 此前只有单测）：指向本机 DAV 桩
>   （`127.0.0.1:8899`，pid 20860 —— 旧记录「已删除」不准，它一直活着）· 附件 full 上传 4 个
>   （png 27507 / jpg 89438 / txt 52 / epub 1332）· **远端改（文件 + manifest 一起改）⇒ 本地拉取更新** ·
>   **本地 mtime 更新 ⇒ 本地不被覆盖，且推上远端** · 配置已恢复坚果云 / 附件 off。
>
> ### 未做
>
> `sync-folder` 真同步目录（真实 Syncthing / 坚果云客户端双端）的端到端合并冲突 —— 需要双端环境，
> 本轮只到「本机改 + 磁盘外部改」的手动模拟（rev173.116 / rev173.120 的口径）。
>
> ## 📌 rev173.134（2026-10-25 · 反向链接升级为全库持久索引 —— 不用改契约）
>
> 技术债 #2。此前 `backlinks` 只扫**最近 30 天**改过的笔记（rev173.95 的性能折中），
> ROADMAP 里登记的是「❌ 要改契约，另议」。这轮证明**不需要动契约**：
> 成本能靠三条判据压住，全在插件层。
>
> ### 为什么可以从「30 天」放开到「全库」
>
> 1. **`mtime` 缓存**（原有）：磁盘 mtime 没变就不重读；
> 2. **`at` 信任窗口**（新）：`note:saved` 现在带 `text`（rev173.133），保存后**零读盘**
>    就能更新这一篇的 refs；`at >= mtime` 表示手里的内容不比磁盘那次修改旧 ⇒ 不必重读。
>    别处再改，mtime 会越过 `at` ⇒ 判定自动失效、下次重读。
> 3. **事件增量**（新）：保存 / 外部改 / 删除 / 改名都只动这一篇，不再全库重扫。
>
> ### 五处改动（契约一字未动）
>
> 1. `scan()`：去掉 30 天过滤，改成「全库 + 三条判据」；每读 25 篇 `await` 一次宏任务，
>    首次全扫不会把界面顶死。
> 2. 内存缓存 `cache`（启动时从 store 恢复）：它现在是状态栏计数的唯一数据源。
> 3. 事件增量：`note:saved`（带 text 零读盘）/ `note:changed`（读盘；`origin:'plugin'`
>    直接跳过 —— 插件自己写盘不算内容变化）/ `note:deleted`（淘汰）/ `note:renamed`（迁移）。
> 4. `updateCount`：从「每收到一个事件就 `listNotes` + 全库扫描」改成「内存算 + 一次 `listNotes`」
>    —— 大库上以前每保存一次就是一次全库 IO。
> 5. `ensureCaughtUp()`：启动后台补齐全库一次，`updateCount` 会 `await` 它。不加这个等待，
>    冷启动那一下状态栏先显示「被 0 篇引用」再跳成真实数字（单测先把这个时序暴露了出来）。
>
> 面板摘要同步换成 **`全库 N 篇 · 本轮读盘 M 篇 · 时刻`** —— 缓存命中率直接看得见。
>
> ### 单测（26 → 30）
>
> - 120 天前的老笔记里的引用也命中（旧实现必漏）；
> - `note:saved` 带正文 ⇒ 缓存更新且 `readText` 调用数**不增**（零读盘）；
> - `at` 信任窗口：事件更新过之后即使 mtime 变新也不重读；
> - `note:deleted` ⇒ 缓存淘汰、计数归零；
> - **反向验证**：把 `freshEnough` 的 `at` 分支临时改成 `return false` ⇒ 信任窗口那条红
>   （1 failed / 29 passed）⇒ 改回全绿。
>
> ### 实测（dev · `_tmp-vault-tb`）
>
> - reload 后全局插件目录里 `backlinks` 是 **0.2.0**；
> - `笔记1.md` 写入 `参见 [[标签验收-周报]]` → 自动保存；
> - 打开 `标签验收-周报.md` ⇒ 状态栏 **「被 1 篇引用」**；
> - 点开面板 ⇒ **`全库 30 篇 · 本轮读盘 0 篇 · 14:06:24`**（30 天窗口已放开；缓存全命中）。
>
> 内核 / 契约未改；`backlinks` 0.1.0 → **0.2.0**（manifest 新增 `event` 能力声明 —— 订阅内核
> 事件本来就要这一项，其它订阅事件的插件同样声明，不是安全模型变更）。
>
> ## 📌 rev173.133（2026-10-25 · 修「本机保存可能永远同步不出去」——`note:saved` 与 watcher 回响的竞争）
>
> 修 rev173.116 记下的观察项。当时记的是「冷启动第一次编辑没形成 pending，第二次正常」，
> 归因写成"竞争"，**没定位到根因**；这轮把它定位到同步插件自己的判定窗口上。
>
> ### 根因（时序，四步）
>
> 1. 用户保存 → 内核 `fs.writeText` 成功 → **同步** emit `note:saved`（payload 当时只有 `{ path }`）
> 2. sync-folder 的处理体开始跑，第一步 `await api.fs.readText(path)`（跨 Rust IPC）→ 挂起
> 3. Rust watcher 的回响（`note:changed`）若在这段 `await` 中间**跑完判定**：磁盘已是新内容、
>    基线还是旧内容、pending 还没建立 ⇒ `classifyChange` 判 `remote`（"别处更新"）⇒
>    基线对齐新内容、`delete pending`（本来就是空的）
> 4. saved 醒来 → 读到的就是那份新内容 → `baseline[path]?.fp === fp` ⇒ **直接早退**
>
> 结果：这次改动**既没有 pending，也没有影子副本** ⇒ 不会被推出去，也不会被判成冲突。
> 比"丢了一次 pending"更糟的是它**静默**：面板上看不出任何异常。
>
> **为什么 Rust 的 `SELF_WRITE_SILENCE_MS = 1500` 没兜住**：它本来就是尽力而为的窗口
> （`atomic_write_bytes` 里 `mark_self_write`，watcher flush 时 `is_self_write` 过滤掉）。
> 而这次竞争发生在 **JS 侧两条 async 处理体的交错**上 —— 只要回响漏过来一次
> （冷启动 / IPC 抖动 / 桌面 watcher 起没成功时退回的 3 秒轮询，轮询路径**完全没有自写抑制**），
> 第 3 步就成立。所以修补方向不是"把窗口调长"，而是**让判定段不再有 await**。
>
> ### 四处改动
>
> 1. **内核 `note:saved` 的 payload 带 `text`**（`src/kernel/fs-events.ts`）：正文是手上就有的
>    字符串引用，事件总线在同一 JS 上下文、不做序列化 ⇒ 零拷贝。契约 §1.4 的 payload 表同步为
>    `{ path, text }`。
> 2. **sync-folder 判定段搬进同步段**：有 `text` 就 `fingerprint(text)` → 判基线没变 → 记 pending，
>    全程无 `await`；影子副本落盘仍然异步。回响插不进来（`note:saved` 总先于它的回响派发）。
> 3. **旧内核兼容**：事件不带 `text` 就退回原来的 `await readText` 版本 —— 行为与之前一致，
>    不因版本差异静默失效（已装的 app / 热更新只换前端时都可能只有旧内核）。
> 4. **内存影子副本 `shadowMem`**：影子副本落盘是异步的，这段窗口里若真来冲突，
>    `readShadow` 优先读内存 ⇒ `keepConflict` 不再误标「本机版未留存」（假 `lost`）。
>    `writeShadow` 成功后清；六处会丢 pending / 对齐基线的路径
>    （`keepConflict` / `applyMerged` / `note:changed` / `scan` / `settle` / `note:renamed`）一并清。
>    `sync-folder` 0.3.0 → **0.3.1**。
>
> ### 单测（916 → 917）
>
> - 新增「保存的判定被回响抢跑（读盘慢）⇒ pending 仍留下，本机版不丢」：`memoryFs` 加
>   `slowNextRead(path)` —— **只拖慢下一次**读盘（保存那次慢、回响那次正常），精确重现抢跑。
>   断言链：保存 v2 + 立刻来回响 ⇒ 对端再改成 v3 ⇒ **判得出冲突**、冲突副本内容 = 本机版 v2。
> - **反向验证**：把「用内核正文」分支临时改成 `const given = null` ⇒ 这条用例转红
>   （1 failed / 43 passed）⇒ 改回全绿。
> - 内核侧三条断言跟着改成 `{ path, text }`：`writeText` 那条、`.zn/` 排除那条的
>   「普通笔记不受影响」、以及「不传 origin 仍是用户语义」那条。
>
> ### 边界 / 未做
>
> - **桌面冒烟（dev + `_tmp-vault-tb`，13:47）**：reload 后全局插件目录变成 `sync-folder` **0.3.1**
>   （`index.js` 含 rev173.133）；打开 `笔记/2026/10/18/笔记1.md` 追加一行 ⇒ 自动保存写盘 34 字节，
>   **`.zn/sync/last/16a96rn.md` 同时落盘、内容与磁盘一致** ⇒ `note:saved` 的处理体真的走到底
>   （建 pending + 写影子副本），不再被 `baseline.fp === fp` 早退吞掉；20 秒后 `settle()` 把 pending
>   升成基线（`baseline.v1` 30 篇），属预期。
> - `note:created` 的 payload **没带** `content`：同样的 await 窗口还在，但新建事件被抢跑的后果
>   只是"同步点没种下"（三方合并退化成留副本），冲突判定本身仍然正确。要补的话是同一条改法。
> - 三个网络后端（`sync-webdav` / `sync-s3` / `sync-git`）**不订阅**这两个事件（它们按 manifest
>   轮询判定），不受影响。
> - **真机（Android）端到端没做**：这次是纯 JS 时序修复，`sync-folder` 的端到端验证要真实
>   Syncthing / 坚果云双端摆冲突现场。证据到「单测红 → 绿 → 反向红」+ 上面的桌面冒烟。
>
> ## 📌 rev173.132（2026-10-25 · 给 `net.rs` 的 Content-Length 修复补 Rust 回归测试）
>
> 起点：rev173.131 修了根因（reqwest 对空 body 不发 CL ⇒ rclone 411），但**只有插件层兜底有测试**
> —— `sync-s3` 自己会补 `content-length: 0`，所以即使把 Rust 那行改回旧写法，前端测试照样全绿。
> 根因修复等于裸奔。
>
> ### 做法（不依赖 Tauri 环境、不联网）
>
> `std::net::TcpListener` 起一个只接一次连接的本地服务器，`tauri::async_runtime::block_on`
> 跑 `net_request`，服务器读出**真正到达的请求头**再断言。两条：
>
> 1. `body_b64 = ""` ⇒ 请求必须含 `Content-Length: 0`
> 2. `body_b64 = base64("x")` ⇒ 请求必须含 `Content-Length: 1`
>
> ### 验收
>
> - `cargo test --lib net::tests` ⇒ **2 passed**。
> - **反向验证**：把 `.header(CONTENT_LENGTH, len)` 删掉 ⇒ 第一条 **失败**、第二条仍过
>   （正好证明断言看的是空 body 那条路径，不是碰巧过）。
>
> cargo 38 → **40**。
>
> ### 顺带
>
> 桌面 dev 当前跑的是 10:22 起的 debug 二进制（早于 rev173.131 的改动）⇒ **要重启一次 dev
> 才会带上 net.rs 的修复**；手机 APK 的 Rust 层同理，靠插件兜底。
>
> ## 📌 rev173.131（2026-10-25 · S3 手机端实测：空笔记永远同步不上（411）—— 根因在 Rust 请求层）
>
> 起点：CARD 候选「S3/Git 手机端实测」。手机已经加进电池优化白名单（用户操作），
> 这一轮把手机连到本机 rclone（`--addr 0.0.0.0:8898`，电脑 `192.168.1.5`），
> 在手机面板里填 endpoint / bucket / accessKey / secret 并保存。
>
> ### 现场
>
> - 连接测试**通过**（SigV4 签名在 Android 上没问题）。
> - 第一次同步：「上传 10」—— 大部分笔记推上去了。
> - 但面板随后报 **`同步失败：上传失败（411）：新笔记-13-50-37.md`**，之后自动同步
>   每 5 秒重试**同一篇**、整轮都中止。这篇就是库里的**空笔记（0 字节）**。
>
> ### 根因（抓包，不是猜）
>
> 起了个临时 node 抓包服务器（`PUT` 回 200 并打印 headers），用桌面 `net_request` 发两个请求：
>
> | body | content-length | transfer-encoding | 收到的字节 |
> |---|---|---|---|
> | 空 | **null** | **null** | 0 |
> | `x` | `1` | null | 1 |
>
> ⇒ **reqwest 对空 `Vec` body 既不设 `Content-Length` 也不设 `Transfer-Encoding`**。
> rclone `serve s3` 对没有长度的 `PUT` 回 **411 Length Required**（AWS 也要求长度）。
> 非空笔记都正常，只有 0 字节笔记必挂 —— 而且失败会**卡住整轮同步**。
>
> ### 修两处
>
> 1. **内核 `src-tauri/src/net.rs`（根因）**：`body_b64` 有值时显式
>    `.header(CONTENT_LENGTH, len.to_string())`（含 0）。→ 所有走 `net.fetch` 的插件受益。
> 2. **`examples/sync-s3/index.js`（兜底）**：空文本 `PUT` 额外带 `content-length: 0`
>    （头参与签名，值与实际一致）—— 让**已经装在别处的旧内核 / 已装 APK** 也能同步空笔记。
>
> ### 验收
>
> - 单测 +2（`tests/sync-s3.test.ts`）：客户端断言「空文本带 CL:0、非空不带」；
>   端到端 mock 服务端对「无 CL 的空 body」回 411，空笔记同步必须成功。
> - 反向验证：把兜底改成 `false && …` ⇒ 两条立即红。
> - **手机真机**：页面 reload 拿新插件代码后同步 ⇒ 「手动同步完成」；桶里 32 个文件，
>   含那篇 **0 字节**的 `新笔记-13-50-37.md`。
> - **拉取方向**：手机删掉 `新笔记-23-06-21.md` ⇒ 自动同步把它拉了回来（24 B，时间戳更新）。
>
> ### 值得记住的坑
>
> - **手机 CDP 在 app 退到后台时完全不响应**（不是被杀，是 WebView 暂停）：
>   每次 `node tools/cdp.mjs` 前先 `adb shell am start`，否则一路 `fetch failed`。
> - `pidof` 在刚启动的几秒内查不到；`adb forward` 必须按**当前 pid** 重建。
> - 手机 dev 包页面靠电脑 1420 的 vite —— vite 不在时 `location.reload()` 会白屏。
>
> ### 收尾
>
> - 手机端 S3 配置已 `sync-s3.disconnect`（清凭据 + 停自动同步），不会在服务停掉后每 5 秒报错。
> - 本机 rclone 已停、临时桶 `_tmp-s3-root` 与抓包脚本已删。
> - 桌面 `net.rs` 的修复要**下次重启 dev** 才生效（当前桌面进程仍是旧二进制）；插件兜底已生效。
>
> ### 未做
>
> `sync-git` 手机端：手机端没有 GitHub token，桌面也从未配过 `sync-git`，**没凭据可用**。
>
> ## 📌 rev173.130（2026-10-25 · 坚果云附件真机回归：桌面 ↔ 云端 ↔ 手机，双向）
>
> 起因：rev173.127 修完 WebDAV 附件方向（先拉后推 + mtime/at 判定）后只留了单测证据，
> CARD 记着「没做真机（要自建 DAV 桩）」。这轮用**真实坚果云 + 真机**补上。
>
> ### 现场
>
> - 桌面 dev 是 2026-10-24 23:24 起的（pid 23640，vite 24648 / 1420）—— 代码比 rev173.127 旧，
>   先 `location.reload()` 让 `?raw` 拉到新插件代码、`ensureBuiltinPlugins` 重写全局目录。
>   reload 后核对：全局 `sync-webdav/index.js` 与仓库 **SHA256 一致**。
> - 手机 `33b676f6` 在连；app 启动后 `pidof` 头几秒查不到（要等 3–6 秒），
>   且 `adb forward tcp:9333` 必须按**当前 pid** 重建 —— 旧 socket 上直接 `fetch failed`。
>
> ### 桌面侧（单向先证）
>
> 1. 附件模式 off → full（`sync-webdav.set-attachments`）。
> 2. 往 `_tmp-vault-tb` 放 `附件回归-20261025.png`（27,507 B）+ `.txt`（52 B），手动同步。
>    `timing` 里出现一条 `attachments: 392ms` —— 这是真正在传。
> 3. **删掉本地两份再同步** ⇒ `pulled: 2`，文件原样回来（27,507 B / 52 B）。
>    ⇒ 上传确实成功、云端有、方向判定（先拉后推）不误判。
>
> ### 手机侧（双向）
>
> 4. 手机开 full 同步 ⇒ `pulled: 3 / pushed: 3`（`attachments 3566ms`），
>    手机 `list_notes` 里出现 `附件回归-20261025.png` / `.txt`。
> 5. 桌面再同步 ⇒ 桌面出现手机推上来的 `image-20261020-011045.jpg`（89,438 B）
>    —— 这一条是**手机 → 桌面**方向。
>
> ### 结论
>
> 坚果云 + WebDAV 附件同步**双向都通**（桌面 → 云端 → 手机、手机 → 云端 → 桌面），
> rev173.127 的方向判定在真实服务上没被证伪。
>
> ### 收尾
>
> - 两端 `attachments` 都已恢复 **off**（原状态）。
> - 测试残留（都可手动删，不影响功能）：
>   - 测试库 `_tmp-vault-tb` 多了 2 个「附件回归」文件 + `image-20261020-011045.jpg`；
>   - 坚果云 `ZeroNote/` 里留着 `附件回归-20261025.png` / `.txt`（插件没有「远端删除附件」的路径）。
> - **无 ZeroNote 代码改动**。
>
> ### 未做
>
> 同轮的另外两项（避开）：S3/Git 手机端实测（要手机侧配 S3 凭据 / GitHub token）——
> 见下一条候选。
>
> ## 📌 rev173.129（2026-10-25 · S3 条件写 `If-Match`：远端被绕过 manifest 改过时不再静默覆盖）
>
> 起点：CARD 的候选「S3 的 If-Match 条件写」。rev173.121 写 S3 后端时明确留了这个口子 ——
> 当时只有 WebDAV 有 `PUT` + `If-Match` 乐观锁，S3 版只靠 manifest 指纹判冲突。
> 一旦有人从控制台网页手改对象（或另一台设备崩在"写完对象、没写 manifest"之间），
> manifest 里的 etag 就过期了，下一次 `PUT` 会**直接盖掉**那个手改版本。
>
> ### 改了什么（`examples/sync-s3/index.js`）
>
> 1. `client.put(key, text, { ifMatch })` —— 带 `If-Match` 头；返回值补 `precondition`（412）/
>    `conflict409`（409 ConditionalRequestConflict）。头**参与 SigV4 签名**（`request()` 把所有传入头都签）。
> 2. 笔记 push 分支：只有「远端已有这篇 + manifest 记了 etag」才带条件（`push-new` 不带 ——
>    `If-None-Match: *` 在 S3 兼容实现上支持面更窄）。
> 3. **412 ⇒ `resolveConflict()`**（从原 conflict 分支抽出来的共用函数）：先**重读远端**把
>    manifest 条目刷成最新，再试三方合并 / 留副本取远端。
>    不刷新的话下一轮还会拿同一个过期 etag 去撞 412 —— Git 后端 rev173.123 踩过同款死循环。
> 4. **409** ⇒ 取对象新 ETag 重试一次（AWS 文档要求），只重试一次。
> 5. **400 兜底**：个别 S3 兼容实现把不认识的 `If-Match` 当坏请求而不是忽略 ⇒ 自动重试一次
>    不带条件 + 面板 hint，不让升级后同步全挂。
> 6. 顺手修一个真缺陷：manifest 回写条件原本是 `pushed / removed / att.changed`，
>    412 路径刷新了 `nextFiles` 却没 push ⇒ **不回写**，下一轮重复撞。补 `manifestChanged` 标志。
>
> ### 验收
>
> 单测（`tests/sync-s3.test.ts`，+5 条）：
> - 客户端：带 `ifMatch` ⇒ 请求头有 `if-match` 且出现在 SignedHeaders；不带 ⇒ 一个都没有；
>   412 / 409 的返回形状。
> - **端到端 1（strict）**：A 推 v1 → 绕过 manifest 手改远端为 remote-v2（etag 换 `"manual"`）
>   → A 本地改后同步 ⇒ PUT 带 `"v1"` ⇒ 412 ⇒ 本地取 remote-v2、冲突副本 = local-mine、
>   **manifest 被刷新成 remote-v2 的 fp / `"manual"` etag**、下一轮不再 PUT。
> - **端到端 2（reject 400）**：带条件 PUT 被拒 ⇒ 自动重试不带 ⇒ 成功落盘 + hint 含「不支持 If-Match」。
> - **端到端 3（ignore）**：服务端不校验 ⇒ 行为与以前一致（本机版覆盖远端、无冲突副本）。
>
> 反向验证：把 `ifMatch` 临时改成 `null`，端到端 1 / 2 立即红 ⇒ 测试抓得住回归。
>
> ### 真机（rclone 1.75.1 `serve s3`）
>
> 结论：**rclone 忽略 `If-Match`** —— 用过期 etag 写同一个键返回 **200** 并落盘，
> 不是 412。所以它验证到的是「兼容但无保护」这一档（等于端到端 3），不是 412 路径。
>
> 两个附带事实（都有实测）：
> - 带 `if-match` 的 PUT **能通过 rclone 的 SigV4 验签**（签名头列表一致），说明加头不会破坏认证。
> - rclone 的 `--auth-key` 里 accessKey 太短会 403：`--auth-key=k,s` ⇒ `InvalidAccessKeyId`；
>   换成 `testaccess,testsecretkey123` 正常。以后真机验收别用单个字母。
>
> 412 路径的证据只有单测（AWS 真实凭据没有）。AWS 官方文档明确支持
> `PutObject` 的 `If-Match`（不匹配 412、并发撞车 409）——
> 见 [S3 PutObject API](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)。
>
> 单测 909 → **914** · verify 6/6。
>
> ### 未做
>
> - 附件上传（`putBytes`）仍不带条件（附件冲突概率低，且路由不同）。
> - `push-new` 的 `If-None-Match: *` 未接。
>
> ## 📌 rev173.128（2026-10-25 · 没有基线时不再「远端永远赢」：store 丢失不再静默覆盖本地）
>
> 起点：rev173.121 在 `sync-s3` 的 `decideSync` 上记了一条已知隐患 ——
> `!base && remoteFp != null` 一律 `pull-new`。触发条件很具体：本机基线（store `baseline.v1`）
> 丢了（换设备 / 清缓存 / 重装），而本地这篇又改过。后果是远端版**静默盖掉本地改动**，
> 而且 `keepConflict` 根本没被调用 ⇒ **一个副本都不留**。
>
> ### 改了什么
>
> 三个网络后端（`sync-webdav` / `sync-s3` / `sync-git`）的 `decideSync`，同一个分支：
>
> 1. 两边指纹相同 ⇒ `noop`（以前也是 `pull-new`，等于白下一次同一份内容）
> 2. 两边不同 ⇒ `conflict`（以前是 `pull-new`）⇒ 走既有冲突流程：本机版先进
>    `.zn/conflicts/<平台>/`，再取远端版；history 同步点还在时会先试三方合并
>
> `sync-folder` 不用改：它的「远端」就是磁盘上同一个文件，没有「用远端覆盖本地」这条路径。
> 三个实现里的「已知隐患」注释同步改成「已修」。
>
> ### 验收
>
> 单测：三份测试的 `decideSync` 期望改掉（`pull-new` → `noop` / `conflict`）。
>
> 新增两条端到端用例（`tests/sync-webdav.test.ts`「没有基线：不静默覆盖本地」）：
>
> ① A 推 v1 → B 改成 v2 推上去 → A 的 store 清掉、本地改成 local-mine → 同步 ⇒
>    本地 = `remote-v2`、冲突目录里**恰好 1 个**文件且内容 = `local-mine`、有「同步冲突」通知、
>    这一轮真的 `GET n.md`（证明走的是冲突分支而不是静默拉取）；
> ② store 丢了但两边内容相同 ⇒ 没有冲突副本、**这一轮不 GET 正文**（noop）。
>
> 反向验证：把 webdav 的 `conflict` 临时改回 `pull-new`，上面两条立即红 ⇒ 测试抓得住回归。
>
> 单测 907 → **909** · verify 6/6。
>
> ### 已知取舍
>
> - 首次把「已有本地笔记」的库接到「已有同名但内容不同」的远端时，会产生冲突副本。
>   这是安全 > 便利的选择：宁可让用户看一眼，也不静默丢字。
> - `sync-git` 的 `resolveConflict` 在无 base 时同样先 `autoMerge`（拿不到 base 返回 null）⇒
>   留副本 + 取远端，和另两个后端行为一致。
>
> ## 📌 rev173.127（2026-10-25 · `sync-webdav` 同款附件方向修复 + 双设备单测）
>
> rev173.126 修 S3 / Git 时记了一笔：`sync-webdav` 还是旧顺序。这轮补上。
>
> ### 改了什么
>
> 1. **先拉后推**：附件段拆成「① 远端 → 本地」→ `await pushLocal()` →「③ relay 清理」。
>    以前先推后拉 ⇒ 本机旧版先盖掉远端新版（谁后同步谁赢）。
> 2. **方向判定**：`mtime(本地) > at(远端条目)` 才算「本机改过」；否则等下载。
> 3. **条目记 `mode`**（`full` / `relay`）：取文件按**上传方**的模式决定路径 ——
>    一台 full、一台 relay 时不会再跑去 `_zn/relay/` 找一个不存在的副本。
> 4. **顺带修一个既有 bug**：下载循环里 `localFp = await localFpOf(local)` 拿的是 `{ fp, bytes }`
>    **对象**，与字符串永远不等 ⇒ 「本地同版」永远判成「要拉」。以前靠 `If-None-Match` 304
>    兜住了（不多传字节），但每轮都发一次请求。改成取 `.fp`。
> 5. **`preloaded` 复用字节**：先拉后推后同一份附件一轮要看两次（判方向 + 取内容），
>    把「算指纹时读到的字节」留给上传用；下载覆盖本地后清掉，不会拿旧字节推回去。
>
> ### 验收
>
> 新增双设备用例（`tests/sync-webdav.test.ts`「双设备：附件方向」）：A 传 v1 → B 拉 →
> B 换 v2 上传 → A 再同步。断言三件事：A 的本地文件变成 v2、远端仍是 v2、
> **这一轮没有 `PUT 图.png`**（旧版推回去就会命中这条）。
>
> 单测 906 → **907** · verify 6/6。
>
> ### 踩到的坑（测试基建）
>
> 内核 `net.fetch` 的响应体 `text()` / `bytes()` 是**同步**方法（体已预读好）。
> 新写的 mock 一开始用了 `async () => …`，于是 `normalizeManifest(res.text())` 收到 Promise ⇒
> 解析成空表、**不报错**，表现为「附件永远不同步」。判断依据：mock 的请求流水里 B 只发了
> `GET _zn/manifest.json`，没有 `GET 图.png`。
>
> ⚠️ 本轮没做真机（WebDAV 要自建 DAV 桩才能脱离坚果云），证据是双设备单测；
> 坚果云真机回归建议下次开 dev 时顺手跑一轮（桌面改图 → 手机看得到即可）。
>
> ## 📌 rev173.126（2026-10-25 · S3 / Git 补附件同步：真机验收跑出五个 bug）
>
> 起点：`sync-webdav` 早就有完整附件同步（off / relay / full 三模式，72 处引用），
> `sync-s3` 只在 manifest 里**保留** `attachments` 字段、`sync-git` 干脆恒写 `{}`
> ⇒ 这两个后端下，桌面粘的图 / 推的 PDF **手机永远看不到**（且不报错）。
>
> ### 补了什么
>
> 两个插件各加一段 `syncAttachments`（与 WebDAV 同协议、同三种模式）：
> 附件进 manifest、三模式、内容级判定（`needsAttachmentPull`）、指纹缓存（`mtime`+`size` 未变不重读）、
> 面板加「附件」耗时 badge 与模式下拉、多一条 `*.set-attachments` 命令。
> 预装数不变（13）；`sync-s3` 0.3.0 → **0.4.0**，`sync-git` 0.4.0 → **0.5.0**。
>
> ### 真机验收（两个都跑通了；用的是新写的临时 harness，用完即删）
>
> | 后端 | 环境 | 结果 |
> |---|---|---|
> | S3 | 本机 `rclone serve s3`（rev173.125 那套，带 SigV4 验签） | **15/15 通过** |
> | Git | 真实 GitHub 私有仓库 `aqua7773/zeronote-sync-test`（Contents API） | **13/13 通过** |
>
> 两侧场景一致：full 首推（笔记 + 300 字节随机图）→ 第二台设备拉下来字节一致 →
> 对端换图 ⇒ 本机跟着更新 → relay 端上传走 `_zn/relay/` → 另一台 relay 端拉到、写 ack ⇒
> 云端副本清理 + 条目 `cleaned` → 首发端再跑一轮不重复 → 远端清理干净。
>
> ### 跑出来的五个真 bug（都不是"测试写错"，是代码错）
>
> 1. **S3 有前缀时连接测试 / 列对象必 404**：`request('GET','')` 经 `fullKey('')` 把**对象前缀**拼进路径
>    ⇒ 实际请求 `/桶/<前缀>`。rev173.125 验收时前缀是空的，所以没暴露。
>    修：`request` 加 `bareBucket`（桶根请求只把 prefix 放进 `?prefix=`）。
> 2. **S3 `list()` 返回的 key 含前缀**，喂回 `remove()`/`get()` 会再拼一次前缀（清理跑完远端还剩对象）。
>    修：`list()` 返回**相对 key**。
> 3. **Git `normalizeManifest` 恒丢弃 `attachments`** ⇒ 读回来永远是"远端没附件"，下载循环空转、零日志。
>    修：按 S3 同一格式解析（含 `sha` / `cleaned` / `mode`）。
> 4. **GitHub Contents API 的 `content` 对二进制有损**：实测上传 8 字节 PNG（首字节 `0x89`），
>    `size` 仍是 8，但返回的 `content` 解码后是 **12 字节**（`0x89` → `EF BF BD`，U+FFFD）。
>    即"字节写对了、读回来被改写"，且不报错。
>    修：`readBytes` 改走 **raw 媒体类型**（`Accept: application/vnd.github.raw`）拿原始字节；
>    不认 raw 的实现在首字节是 `{` 时回退解析 JSON，大文件再走 `download_url`。
> 5. **附件同步先推后拉 ⇒ 双端互相覆盖**：B 上传新图后，A 同步时先把自己的旧图推上去、再拉回来，
>    永远拿不到新版（谁后同步谁赢）。修：顺序改成**先拉后推** + 方向判定
>    `mtime(本地) > at(远端条目)` 才算"本地确实改过"，否则等下载。
>    同时条目里记 `mode`（这台设备上传时用的模式），取文件按**条目的 mode** 而不是本机设置 ——
>    否则一台 full、一台 relay 时 relay 那台会去 `_zn/relay/` 找一个根本不存在的副本。
>
> ### 测试与文档
>
> 单测 895 → **906**（+11：字节 base64 往返 / 逐字节指纹三边互认 / `isAttachment` /
> `needsAttachmentPull` 与 webdav 逐字一致 / `relayName`）。命令清单断言各 +1。
>
> ⚠️ 未做：`sync-webdav` 仍有第 5 条同款毛病（顺序 + 无 mode，本轮只修 S3/Git）；
> S3 依然没有 `If-Match`；Gitee 未实测（无令牌）。
>
> ## 📌 rev173.125（2026-10-25 · S3 后端真机验收：真实 `rclone serve s3`）
>
> 用户先说「装」（MinIO），发现 MinIO 装不上后又告知 **Cloudflare R2 要绑信用卡**。于是换路线：
> 用 **rclone** 在本机起一个真实的 S3 服务。
>
> ### 三步走
>
> 1. **MinIO 彻底不可用**（rev173.124 已记）：winget 包 → `archive/…` 410；官方 `minio.exe` 直链也 410。
> 2. **下载 rclone**（1.75.1）踩了个速度坑：
>    | 源 | 4MB 测速 |
>    |---|---|
>    | `https://downloads.rclone.org/v1.75.1/rclone-v1.75.1-windows-amd64.zip` | **384 KB/s** ✅ |
>    | `https://github.com/rclone/rclone/releases/...` | 61 KB/s（30 秒只走了 1.8MB） |
>    | `https://ghfast.top/https://github.com/...` | 连接超时 |
>    ⇒ 走官方下载站。装到 `Apps\Portable\rclone\rclone-v1.75.1-windows-amd64\`（绿色版），
>    已建 `_View\网络与传输\rclone · S3 服务与云同步` 链接并登记 `_软件清单.md`（114 → **115** 项）。
> 3. **起服务**：
>    ```powershell
>    rclone serve s3 --auth-key minioadmin,minioadmin --addr 127.0.0.1:9010 `
>      "$env:USERPROFILE\Apps\_data\rclone-s3" --dir-cache-time 0s
>    ```
>    **桶名 = 数据目录下的子目录**（`zeronote` ⇒ `_data\rclone-s3\zeronote`）。
>    它自带 **SigV4 验签**（`--auth-key`），验不过就 403。
>
> ### 两个真跑才暴露的坑
>
> - **桶目录必须先存在**：rclone 不会替你建，`GET /zeronote?list-type=2` 直接 **404**
>   （客户端的 `test()` 会报「桶不存在」——提示是对的）。
> - **`--dir-cache-time 0s`**：默认 5 分钟目录缓存，服务启动后才建的桶它看不见。
>
> ### 实测（真实 S3 实现 · 真 fs + 真 HTTP + 真 `mergeLines`）
>
> | 项 | 结果 |
> |---|---|
> | `test()` | ✅ 200（签名通过 rclone 的验签） |
> | 首同步推 2 篇 | ✅ |
> | 对端改一篇 ⇒ 下载 1 | ✅ |
> | 双端改不同行 | ✅ 自动合并 1，两头一致 |
> | 双端改同一行 | ✅ 冲突 1，副本 = 本机版 |
> | 面板耗时 | ✅ `用时 30 毫秒 · manifest 7 毫秒 · 笔记 23 毫秒` |
> | 清理 | ✅ 桶为空 |
>
> **无 ZeroNote 代码改动** —— 这一轮只证明「S3 后端接真服务能用」。
>
> ### 用法（用户视角）
>
> 服务要手动起（或做成开机自启，未做）。插件面板填：
> Endpoint `http://127.0.0.1:9010` · 区域 `us-east-1` · 桶 `zeronote` · Access `minioadmin` · Secret `minioadmin`。
> 注意这只是**单机**方案：手机要同步得填电脑的局域网 IP，且电脑要开着。
>

## 备注

### 自动化验收方法论（本轮实测，别再踩）

- **窗口截图**：`PrintWindow(hwnd, hdc, 2)`（`PW_RENDERFULLCONTENT`）能抓到 WebView2 内容；配合 `GetWindowRect` 得到窗口坐标。**最小化窗口返回 (-32000,-32000)** → 必须先 `ShowWindow(h, 9)`（SW_RESTORE）再取坐标。
- **合成键盘**：字母键（`keybd_event`）能进 WebView2 ✅；**Enter（VK 0x0D）进不去** ❌（已用命令面板对照实验确认）⇒ **不要用合成 Enter 做验收**。
- **合成鼠标**：可行，但**悬停要 ≥300ms、按压 ≥90ms**，否则 React 的 click 可能不触发（悬停 200ms + 按压 60ms 时实测失败）。
- **中文输入法会转换合成输入**：输入 `zntest` 落盘变成「只能testx」——测试文本请用不含拼音歧义的字符串。
- **WebView2 的 CDP 端点只认 `node fetch`**：`Invoke-WebRequest` / PowerShell 的 HTTP 栈一律 **404**（不是权限、不是端口问题）。
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
