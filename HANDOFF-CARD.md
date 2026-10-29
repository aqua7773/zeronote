# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-10-29（rev173.243 · 修：桌面组件不会自己刷新）** ｜ 细节与证据在 **`HANDOFF.md`**（只保留当前周期，rev173.125 起；0.2 / 0.3 / 0.4 已归档到 `docs/archive/handoff/`）｜ 提交数一律看 `git log`
> 本卡只放**当前状态**（目标 ≤ 120 行）；历史过程一律回 HANDOFF，不再在此重复。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.243 · 0.6.0 · 2026-10-29 |
| 测试基线 | vitest 1456 · cargo 87 · oxlint 3 warnings（2026-10-29） |
| 插件 | 内置 9 · 示例 42 |
| 文档 | README 现状 2026-10-29 · CHANGELOG 0.6.0 |
<!-- FACTS:END -->

## 是什么

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用（Tauri 2 + React 19 + Rust）。
一切功能靠插件：**全局目录** `<应用数据目录>/.zn/plugins/<id>/` —— 唯一位置（跨库共用；装卸＝放/删一个文件夹）。
内核 **11 原语 + 21 种 UINode + 6 个挂载位** + 真窗口 / 整窗接管 / 面板 DOM。

**内核自带**：文件树 · 回收站 · 搜索（增量索引 + 标签/目录/正则筛选）· 命令面板 · 多标签（`Ctrl+Tab`）与标签拆独立窗口 · 时间流 · 主窗口记忆 · 会话恢复 · 粘贴图片 · 全局替换 · Markdown 增强（数学 / 脚注 / Mermaid / 内嵌 HTML 白名单）· 白屏兜底。

**预装 9 个**（核心体验，判定见 `D-010`）：标签 · 反向链接 · 历史版本 · 导入导出 · 备份 · 同步 ×4（本地文件夹 / WebDAV / S3 / Git）。**走市场**的「增强」类：大纲导图 · 文档阅读器 · 记账 · 米色主题 · 打卡（rev173.179 移出，源码仍在 `examples/`）；安全 / 密码库同样只走市场。

## 验收基线（以输出为准，不写死数字）

```powershell
pwsh -File scripts\verify.ps1
# 六步：tsc 0 错误 · oxlint src 0 error · cargo test --lib · check-docs · vitest · 质量门 7 项（facts / 依赖方向 / 本地链接 / 功能目录 / 键位表 / 市场索引 / 外部条目审查）
```

## 未决 / 下一步

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

## 环境现状（活信息 · 2026-10-29）

- **桌面 dev**：双击 `dev.cmd`（vite 1420 · CDP 9222 · 日志 `.self-logs/desktop-dev.log`）。**别用后台 job 托管**（会随会话回收）；
  AI 自己要起时用 `Start-Process -FilePath cmd.exe -ArgumentList "/c","dev.cmd" -WindowStyle Minimized`（独立进程，等价双击，rev173.152 实测可用）；
  **别用管理员跑**（污染 WebView2 UDF ⇒ `0x800700AA`，已污染就用 `scripts\dev.ps1` 绕开）。
  ⚠️ 交接时 **dev 是开着的**（pid **37216** · 2026-10-29 19:10:40 启动 —— rev173.240 改 `tauri.conf.json` 后
  被 `Start-Process cmd /c dev.cmd` 重新拉起的那次；vite 1420 / CDP 9222 都在），日志在 `.self-logs/desktop-dev.log`。
  ⚠️ **改 `patches/@atomic-editor__editor@…patch` 后必须重启 dev**（vite 预构建缓存在内存里，删文件也不重建）：
  结束 dev 进程树 → 删 `node_modules/.vite` → `Start-Process cmd.exe /c dev.cmd -WindowStyle Minimized`。
- **Low IL 会让 dev 起不来**：`icacls src-tauri /setintegritylevel (OI)(CI)Medium`（`target` 同步）。判据 = `create_dir_all` 报「拒绝访问 (os error 5)」。
- **改 `tauri.conf.json` / `Cargo.toml` ⇒ tauri CLI 自动重编并重启**（重编期间与 `cargo test` 争 `CARGO_TARGET_DIR`，verify 等几分钟是排队不是卡死）。dev 窗口「关于」的版本号由 **vite 启动时**求值，改 `package.json` 不热更新。
- ⚠️ **编辑器 CSS 在一个 JS 模板字符串里**（`src/components/MarkdownEditor.tsx` 中段）—— 注释里写**反引号**会提前终止字符串 ⇒ 整页白屏（`vite:oxc` 报 "Try inserting a semicolon here"）。rev173.236 踩过一次。
- **Android dev**：`android-dev.cmd`（日志 `.self-logs/android-dev.log`）· gradle wrapper 走腾讯镜像 · `rustup` 操作必须串行。
  ⚠️ **交接时 adb 无设备**（2026-10-29 00:47 `adb devices` 空）⇒ 手机未验 230–236；234 动了
  `Cargo.toml`（`image` 依赖 + dev profile）⇒ **重装 APK 才能验**。
  ⚠️ 交接时有**一个 watch 进程在跑**（AI 当后台 job 起的：`cmd /c android-dev.cmd`，03:12 起）——
  会话结束 job 被回收时它可能一起消失（app 是独立进程，不受影响）。**要再编就双击 `android-dev.cmd`**，
  编之前先清旧进程树（见下）。
- **手机 `33b676f6` = 测试机，只跑已装的 dev 包**：`versionName` 仍写 **0.5.0**，但 **2026-10-29 20:18 又被 `android-dev` 重编重装**
  （app pid **27843**；这次含 **rev173.242 的桌面组件**（`gen/android/.../Widget*.kt` 7 个 + 3 套布局）+ rev173.238 的 `assets.rs` + rev173.240 的媒体服务）。
  **Rust 侧现在到 rev173.242**；**前端随桌面 vite HMR** ⇒ 别再按 0.5.0 的功能边界判断。
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
    ⚠️ `adb shell input tap` 吃**真实屏幕像素**（1220×2712），`read_image` 的预览是 838 宽 —— 按预览坐标点会整体偏 1.45 倍。
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
