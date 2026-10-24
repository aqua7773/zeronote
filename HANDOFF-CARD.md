# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-10-24（rev173.106）** ｜ 细节与证据在 **`HANDOFF.md`**（rev 索引在文首）｜ 提交数一律看 `git log`
> 本卡只放**当前状态**；历史过程一律回 HANDOFF，不再在此重复。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.106 · 0.4.0 · 2026-10-24 |
| 测试基线 | vitest 725 · cargo 38 · oxlint 3 warnings（2026-10-24） |
| 插件 | 内置 9 · 示例 33 |
| 文档 | README 现状 2026-10-24 · CHANGELOG 0.4.0 |
<!-- FACTS:END -->

## 是什么

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用（Tauri 2 + React 19 + Rust）。
一切功能靠插件：**全局目录** `<应用数据目录>/.zn/plugins/<id>/` —— **唯一位置**（跨库共用；rev173.5 起取消库内插件）；装卸＝放/删一个文件夹。
内核 11 原语 + 21 种 UINode + 6 个挂载位 + 真窗口 / 整窗接管。
内核自带：12 条 Markdown 标记命令（`core.mark.*`，桌面右键「标记」/ 手机键盘上方快捷栏）· 层级文件树（空目录 / 框选 / 拖拽 / 引导线）· 回收站 · 搜索 · 命令面板 · 快速切换 · **桌面「时间流」面板**（rev173.33：侧栏与编辑区之间常驻，卡片与手机起始页同一套）· **增量搜索索引 + 内核事件总线**（rev173.40：`note:saved` 等 9 种事件真派发）· **粘贴图片**（rev173.46：截图 Ctrl+V → 落笔记同目录 → 插入 `![]()`）· **搜索筛选**（rev173.47：标签 / 目录 / 正则，与关键词任意组合）· **全局替换**（rev173.49：`Ctrl+Shift+H`，先试运行再写盘，改前进回收站）· **多标签页**（rev173.50：编辑器顶部标签条，`Ctrl+Tab` 循环 / `Ctrl+W` 关当前；**分屏仍未做**）· **标签拆独立窗口**（rev173.51–54 · rev173.67–68 标题条收尾：标签**拖出**窗口 = 独立窗口，窗口里**只有编辑器**；整条标题栏可拖窗口、文档名居中；**关闭按钮 = 把这篇交回主窗口**（保存 → 通知 → 关窗），拖拽收回手势已按用户要求移除；右键菜单同效；**同一篇同时只在一个窗口里**，主窗口再点会聚焦那个窗口并提示）· **笔记窗口不加载插件**（rev173.60：窗口里跑 30 条内核命令、0 面板、0 插件样式）· **桌面文件监听**（rev173.59：别的程序改盘 → 桌面 1 秒内刷新、手机 3 秒轮询；自己保存不触发回响）· **主窗口记忆**（rev173.61：位置 / 大小 / 最大化在重启后恢复；独立笔记窗口不记忆）· **会话恢复**（rev173.65：崩溃 / HMR 整页重载后启动提示「恢复 / 丢弃」，只留 1 篇 / ≤ 8 KB）。
**插件预装**：新版 APK 内置 **9** 个常用插件（大纲·导图 / 文档阅读器 / 导入导出 / 米色主题 / 记账 / 标签（rev173.93）/ 反向链接（rev173.95）/ 历史版本（rev173.99）/ **打卡（rev173.103）**；2026-10-19 rev173.29–31 移出 `daily-note` / `editor-marks` / `tag-demo`，**rev173.35 移出 `inspiration-flow`（灵感流，搁置）**）。

## 验收基线（以输出为准，不写死数字）

```powershell
pwsh -File scripts\verify.ps1
# 六步：tsc 0 错误 · oxlint src 0 error · cargo test --lib 全过 · check-docs 全过 · vitest 全过 · 质量门 5 项（facts / 依赖方向 / 本地链接 / 功能目录 / 键位表）
```

## 下个会话第一件事

> **当前主线 = 同步插件**（2026-10-24 方向已定）。**内核地基已完成（rev173.106）**：
> `net` 原语（Rust 发请求，绕 CORS）· `fs.readBytes/writeBytes`（二进制）· `host.secrets`（系统钥匙串）。
> 两件已拍板：**① 凭据走系统钥匙串**（不是 `.zn/` 明文）· **② 手机接受「前台近实时 + 切回追平」**（不加前台服务）。
> 下一步：**写同步插件本体 `sync-webdav`** —— manifest 扫描 → `PROPFIND` → 差异 → `PUT`/`GET` →
> 冲突副本 `.zn/conflicts/<平台>/`。方案见 `docs/同步插件-调研与方案-2026-10-24.md` §5 方案 B。

0. ✅ **0.4.0 已发版（2026-10-24）**：版本三处（package.json / tauri.conf.json / Cargo.toml）已同步 0.4.0 ·
   CHANGELOG 收口（0.3.0 之后 40 个提交）· README 现状行已更新 · tag `v0.4.0`。
1. ~~P2 会话恢复（hot exit）~~ ✅ **rev173.65 已完成**（做法 / 三个坑 / 实测见 `HANDOFF.md` 该段；下一步接第 2 条）。
2. **记账文案校准**：等真实漏识别样本（「诊断」视图已就绪）。
3. ✅ **iframe ↔ 宿主能力通道（rev173.76）** · ✅ **插件真签名（rev173.77）** · ✅ **能力使用审计（rev173.78）** —— 旧主线的最后三件，已收口。**旧主线关闭（rev173.79）**：Worker / 子进程插件宿主 **✅ 明确放弃**（`D-001`，2026-10-21 用户裁决，不再排期、不再讨论）· 插件市场 / 更新通道 ⏸ `D-008` pending（重议条件：要给别人发插件 / 插件数 > 10）。开源公开前还要做：免责声明 + 插件审查材料生成器（用户已定「等公开时再做」）。
4. **环境清理（顺手）**：✅ 本会话已清掉 1420 上的旧 vite（杀掉旧 android dev 链的 vite 进程，再重启 `dev.cmd`）；现在唯一的 vite 是 dev.cmd 自起的 1420（1421 未监听）。
5. **两个已知问题（rev173.73 实测发现）已全修**：① ✅ **rev173.74** —— `note-*` 窗口 Ctrl+Shift+F 给 toast「全库搜索请在主窗口使用」（该窗口补上了 toast 渲染处），主窗口照常开面板；② ✅ **rev173.75** —— 完成态短语（支付成功 / 已支付…）无金额也入账进「金额待补」，列表每行「删除」+ 确认页（显示原文、不可恢复）。两条都桌面 + 手机实测过。
6. **A 档 4 个插件（✅ 全部完成：标签 / 双链 / 历史 / 打卡）**：✅ 调研（rev173.80）→ ✅ **内核地基**：rev173.81 面板可画 DOM（`registerPanel({ mount })`）· rev173.82 手机上 `openWindow` 自动降级为主区面板。**用户定的最终形态（2026-10-21）**：**主区标签页与独立窗口，自由选择** —— 阅读器 / 导图默认作为**主区标签**打开，也能（右键 / 拖出）开成**独立窗口**；手机只有主区（没有真多窗口）。**顺序（全绿）**：
   ① ✅ **标签页支持「面板标签」（rev173.83 已完成）**：`panel:<id>` 前缀 · 默认主区标签 · **拖出 = 独立窗口**（复用 rev173.52 手势）· `Ctrl+Tab` 穿过 · 关标签不存盘 · 换库清空 · 内核 `openPanelWindow`
   ② ✅ **doc-reader 迁到 `registerPanel({ mount })`（rev173.84 已完成）**：面板 `doc-reader.view` · 打开文档 = 主区标签（执行 `core.panel.<id>`，命令不存在重试 5 次兜冷启动）· 拖出 / 右键「在新窗口打开」= 独立窗口（窗口里从 `store.last` 读路径）· 换文档走模块级 `currentDoc` + 实例回调（mount 只跑一次）· 不再画「关闭」（退出归内核）· **桌面 CDP 实测通过**（主区标签 / 独立窗口同一份 / 拖出后主区复位），**手机未测** · 顺手修两个内核缺口：面板页没有标签条（拖不出去）· `core.openDocument` 被内核大 effect 重注册覆盖（插件接管失效，点 PDF 永远弹「没装插件」）
   ②-b ✅ **面板就画在编辑区（rev173.85 已完成）**：用户「pdf 等文档直接打开在编辑区同样的位置」—— 面板与编辑器共用 `zn-editor-wrap` 外壳（标签条 + 一整块内容区），不再套面板标题 bar · **侧栏常驻**（读 PDF 时直接点别的笔记）· 从面板视图点笔记一律 `setMainView('editor')`（含 `openNote` 早退路径，手机也走）· 桌面 CDP 实测双标签来回切 · **手机真机 33b676f6 实测**：无标签条 ✓ · 点「说明.txt」→ 阅读器「15 字符」+ 抽屉自动收起 ✓ · 返回键回起始页 ✓
   ②-c ✅ **文档也能多标签（rev173.86 已完成）**：用户「跟编辑器的 md 一样，非 md 只需要能阅读」—— **每份文档一个面板**（`doc-reader.view.<hash32(文档键)>`，title = 文件名）· `hidden: true` 不进 ☰ 菜单（内核 `registerPanel` 新增）· 面板即文档（`doc` 闭包常量，删 `currentDoc`/`liveInstances`）· `store.docs` 供独立窗口反查 · `readerState` 记住页码/缩放（切回回原页）· 桌面实测三标签混排、点切、关标签 ✓ · **手机不做多标签**（用户明确）
   ②-d ✅ **阅读器去顶栏 + 连续滚动 + 深色（rev173.87 已完成）**：用户「绿框不需要」「深色模式还用深色字体」「翻页做成滚轮无限下滑」「pdf 放大缩小 ctrl+滚轮」—— 删 `.dn-bar`（删除只剩右键菜单）· PDF **连续滚动 + 按需渲染**（占位 canvas 全建，IntersectionObserver ±1.5 屏，离开释放位图——A4 一页 dpr2 ≈ 8MB）· **Ctrl+滚轮缩放**（non-passive + preventDefault 拦 WebView2 整页缩放；带锚点不跳）· EPUB 深色：`renderer.setStyles()` 注入 `--zn-fg/-bg` 计算值 + `!important`，MutationObserver 跟主题 · 实测 4 页 PDF 滚动/释放/缩放 + 深色 EPUB ✓
   ②-e ✅ **修「关一个标签全没了」（rev173.88）**：根因是**标签条在三个渲染分支各渲染一份**（编辑器分支只在 `activePath` 时画、起始页没有）⇒ 关掉当前文档回起始页时标签条整个消失。修法：标签条提到 `<main>` 顶部只渲染一次（`isDesktop && tabItems.length > 0`）· `.zn-main` 补 `--zn-tabbar-h` · 实测两文档关当前还剩一条、点它切回面板 ✓
   ③ ✅ **outline-map 迁到 `registerPanel({ mount })`（rev173.89 已完成）**：主区标签 / 独立窗口共用同一个 mind-elixir 画布 · 面板 id = `outline-map.map-<hash32(笔记|起始行|标题)>` · 删 `host.platform === 'android'` + `overrideShell` 两个分支 · 打开 = `core.panel.<id>`（重试 5 次）· 拖出 = `?pluginWindow=` 窗口（从 `store.open:<id>` 还原）· 写回按面板自己的 note 定位 · 顺手修「从面板视图点笔记标签没反应」（`selectTab` 早退补 `setMainView('editor')`）· `cdp.mjs` 加 `dblclickat` · **桌面 CDP 实测**（主区标签 / 多标签 / 拖出窗口 / 写回磁盘 / 关标签），**手机未测**
   ④ ✅ **标签面板 `tag-panel`（rev173.93 已完成）**：主区面板（`registerPanel({ location:'main' })`，与阅读器 / 导图同形）· 全库标签按篇数降序 · 点标签 → 该标签下笔记列表（标题可点 + 摘要）· 筛选框（`ctx.state` bind）· 空索引首次自动 `rebuild()` · 事件置脏延迟 120 ms · **新增内核命令 `core.openNote`**（插件此前拿到路径也打不开那篇）· 预装 5 → **6** · 单测 24 条 · **桌面 CDP + 手机真机实测**。
   ⑤ ✅ **A0 探针（rev173.94）→ 结果 B**：`[[ ]]` **链接文字**的点击归**内核**（`MarkdownEditor` document 捕获 → `openWikiLink`，2026-10-18 已有），插件 `open-ref` 没被调用；`[` 方括号能到插件但 `payload.text` 只有**单方括号**；`#标签` 归插件；**删插件后链接仍可点** ⇒ 双链的正向不重复实现（需求 §2.2 未偏离）。
   ⑥ ✅ **反向链接 `backlinks`（rev173.95 已完成）**：`fs` 扫 `[[…]]`（索引会切词，不能用）· 只扫最近 30 天 · `store` 按 path+mtime 缓存（第二次打开零读盘）· **`modal` 浮层**（不顶编辑器）· 点来源 → `core.openNote` · 每篇最多 5 条 + 整行上下文 · **内核补：modal 面板不再进标签条** · 预装 6 → **7** · 单测 23 条 · **桌面 CDP + 手机真机实测**（命中 / 空态 / 重新扫描 / 点来源）。✅ **rev173.101 上状态栏**：底部显示「被 N 篇引用」（按篇去重，path+mtime 缓存），点它弹同一个浮层；切笔记 / 保存 / 删除后自动重算。
   ⑦ ✅ **标签浮层（rev173.96 已完成）** —— 用户口径：**笔记里点 `#标签` → 悬浮面板 → 列出该标签下笔记 → 点一篇直接在独立窗口打开**。`tag-panel` 0.2.0：`editor.addMark`（正则与内核 `tagsOf` 逐字一致）+ `modal` 面板 `tag-panel.peek`；**内核** `core.openInNewWindow` 接受 `{ path }` + 新增 `core.closePanel`（插件能自己收浮层）；手机降级主区并提示；单测 24 → **33 条**；桌面（独立窗口真开出 `?note=`）+ 手机实测。
   ⑧ ✅ **「wikilink 就是 wikilink」（rev173.97 外观 + rev173.102 修点击）** —— 用户截图 `tags: 工作, 周报`：该行被 markdown 解析成未定义引用的 Link、atomic 渲染成绿色链接。新增 `src/lib/atomic-link.ts` 判据 + `MarkdownEditor` MutationObserver 打 `zn-plain-link` + CSS 去色/去图标；只改外观不动 atomic 解析；单测 7 条。⚠️ **rev173.102 更正**：rev173.97 的「点击拦截只认 `[[…]]`」是拿**可见文本**判的，而 atomic 的可见文本永远不含双方括号 ⇒ **点击全被丢弃**（用户 2026-10-24 报「链接无法跳转」）；现已改成取**源码行**判（`wikiLinkTarget`，与外观判据同一套「绿色 = 可点」）+ 支持 `[[目标\|别名]]`，单测 12 条，桌面 CDP 实测跳转通过。
   ⑨ ✅ **frontmatter 隐藏（rev173.98 已完成）** —— 用户「frontmatter 隐藏」：预览态不显示开头的 `--- … ---`（`src/kernel/editor-frontmatter.ts` 加 line decoration `zn-fm-hidden` + CSS `display:none`）。**没用 `Decoration.replace`**（atomic 已有装饰，同范围重叠会抛错 = 编辑器崩）· 编辑走**源码模式** · 未闭合的 frontmatter 不藏 · 只改外观、文档一字未动 · 单测 6 条 · 桌面实测（预览隐藏 / 源码可见 / 切笔记稳定）。
   ⑩ ✅ **历史版本 `history`（rev173.99 已完成 + rev173.100 补入口）** —— 需求 §11：**关闭且有改动才生成**（切换笔记用 `change` 缓存的正文补存 —— `openNote` 不发 close）· 存 `<库>/.zn/history/<hash32(path)>/` · **四档精简**（7 天全留 / 8–30 天每天 / 31–365 天每周 / >1 年每月）· `modal` 面板「历史 vs 当前」LCS diff（HTML 转义）+ 回滚（先存当前版再写回）· **内核补 `fs.listFiles` / `fs.purgePrivate`**（后者只允许 `.zn/` 下真删）· 预装 7 → **8** · 单测 28 条 · 桌面实测（快照 / 面板 / diff / 回滚）。**入口（rev173.100）**：状态栏「历史版本」按钮 · ☰ 菜单不再过滤 modal 面板 · 面板被直接打开时自动绑定当前笔记（无笔记给引导态）· 新增「现在存一版」。
   ⑪ ✅ **提醒打卡 `habit`（rev173.103 已完成 · 手机全流程 rev173.105）** —— 需求 §7.1–§7.3 **除提醒**（到点提醒不做 —— 用户 2026-10-23 裁决：无定时器原语 / 无前台服务）：主区面板 `habit.board`（计划列表 + 今日次数 + 打卡 + 月历 + 连续/累计）· 四种频率（每天 / 每周几 / 每月几号 / 每隔 N 天）· 一天多次、**上限用户自定 1–99** · **连续按应打卡日**（非打卡日跳过 · 今天没打不算断）· 累计按有记录的天数 · 补打卡 / 清除**只允许最近 7 天** · 数据落 `store`（`plans` + `checks`）· 预装 8 → **9** · 单测 **36** 条 · 桌面 CDP 全流程实测 · **手机真机 33b676f6 全流程实测（rev173.105）**：长按 ☰ → 菜单 → 面板 · 新建 / 打卡 / 超上限 / 补打 / 清除 / 切月 / 改「每周一三五」/ 删除 / 返回键 / 重开持久全通过，1222×2713 无溢出 · **同轮修三处**：补打卡早于 `startDate` ⇒ 连续不涨（`extendStartDate()` 前移开始日）· 切月不清选中日（`shiftMonth` 清 `selectedDay`）· `.zn-btn:disabled` 无禁用态（styles.css）· 截图 `_shots/phone-habit-*.png`。
    接下来：ROADMAP 的 6 项**全部完成**；白屏兜底也已在 **rev173.104** 收口；剩余只有记账文案校准（等真实漏识别样本）。总排期见 `docs/ROADMAP.md`。

可选小项：✅ **rev173.66 已补** —— 卡片长按菜单进了返回键层栈（菜单开着按返回先关菜单，不再直接退 App；手机实测 + 单测 3 条）。

> 本会话（rev173.55–58）产出：`docs/系统总览.md` · `docs/数据与存储.md` · `docs/UI交互规范.md` · `docs/键位表.md`（生成）· `docs/功能目录.md`（生成）· `docs/decisions/`（6 条）· `docs/templates/`（任务卡 + ADR）· 质量门脚本 6 个。
> 没做：性能基线（用户暂缓）· 用户运维手册（只有一个使用者，决定不写）。

### 本会话踩过的坑（务必避开）

- **组件测试缺 cleanup**：`app-smoke.test.tsx` 之前没写 `afterEach(cleanup)`，DOM 会累积（实测同时挂 **4 个 `.zn-app`**），
  后一个测试的点按命中别的实例、断言看错元素（rev173.68 排查多绕一轮）。
- **CSS 改了页面不一定变**：dev 下 CSS HMR 偶发不生效（尤其长时间没 reload 的窗口）—— 先 `location.reload()` 再判断样式改动是否生效（rev173.69）。

- **按行号脚本删段**：先把最终行号定死再动手；中途再 edit 会让行号整体偏移（rev122 因此误删过 `DOC_CHANGE_DEBOUNCE_MS`，tsc `TS1128`）。
- **hook 内 `useState` 顺序**：state 必须声明在所有引用它的 `useCallback` **之前**（rev123 的 `undoDelete` 踩过，产生 `react(immutability)` warning）。
- **改 HANDOFF**：不要把 `> ## 📌 revN（…）` 标题行整行替换掉，否则 `check-docs` 报「索引有 revN 但正文无对应段」；新段插在旧标题**之前**，旧标题保留。

## 本会话（rev173.28 – 173.71 · 2026-10-19 ~ 20）

| rev | 内容 |
|---|---|
| 173.71 | **查找面板补「替换」入口**：Ctrl+F 的 atomic 面板里加「替换」按钮（`find-replace-entry.ts` + MutationObserver 注入）· 点击 = 关面板 + 关键词带进替换栏 · 不碰 atomic 源码 · vitest 485 |
| 173.70 | **0.3.0 发版 + 两个 P2 收口**（用户「逐项完成 A」）：推送 34 个提交（`8e67a8f..c873c95`）· 版本 0.2.0 → **0.3.0**（tag `v0.3.0`）· 独立窗口 Ctrl+F 归编辑器（新命令 `disable_accelerator_keys_for` + `src/lib/accelerator.ts`，等 `tauri://created`、800ms 兜底）· 库内插件迁移失败不再静默（`setPluginError` + toast） |
| 173.69 | **标签条细节**（用户截图）：第一条标签贴编辑区左缘（`.zn-tabs` 左 padding 0）· 取消活动标签顶部 inset 阴影线（当前标签只靠底色区分）· 桌面实测：`padding=0px 6px 0px 0px` / active `box-shadow=none` / 首标签 gap 0 |
| 173.68 | **独立窗口关闭 = 交回主窗口**：移除「拖出窗口 = 收回」手势（state / pointer 监听 / 样式 / 提示全删）· 关闭按钮改 `returnToMain`（保存 → emit → 关窗；主窗口标签回来并打开）· 标题条恢复 `deep` 拖动区（标题居中保持）· vitest **474** · 桌面实测：点关闭 ⇒ 窗口消失 + 主窗口收回并打开该篇 |
| 173.67 | **笔记独立窗口标题条**（用户截图）：去掉 `⤺` 收回按钮 · 整条标题栏可拖窗口（`data-tauri-drag-region="deep"`）· 文档名居中、保留「拖出窗口 = 收回」手势（标 `false` 阻止系统接管）· vitest **473** · 桌面实测：标题中心 = 条中心 + 手势回归 |
| 173.66 | **手机卡片菜单进返回键层栈**：`MobileNoteCards` 加 `layers`（App 的 `layerExitsRef`，与 `FileTree` 同一约定）· 菜单打开压栈 / 关闭移除 · App 两处（手机起始页 + 桌面时间流）都传 · vitest **472** · 手机 33b676f6 实测：返回键先关菜单、不退 App |
| 173.65 | **会话恢复（hot exit）**：新增 `src/lib/draft-snapshot.ts`（`{path,content,at}` · 8 KB 上限 · 7 天过期 · 只留 1 篇）· `useDocIO` 500ms 节流写草稿 + `saveNow` 成功清键 + 关窗 / 卸载 flush · 主窗口启动提示「恢复 / 丢弃」（复用 `.zn-undo`）· 恢复以磁盘内容为 `baseRef` · vitest **469** · 实测：页面 reload / `taskkill` 强杀重启 / 正常退出不提示 / note 窗口不弹 |
| 173.64 | **交接**：173.59–173.63 收口（文件监听 / 笔记窗口不加载插件 / 主窗口记忆 / 三键对齐 / 占用账本）· 唯一下一步 = P2 会话恢复（hot exit，执行路径见上）· 测试 453 |
| 173.63 | **独立窗口占用账本持久化（P1-c）**：新增 `src/lib/note-window-ledger.ts`（路径 → `note-N` 存 localStorage，坏数据退回空账本）· 拆窗 / 恢复 / 兜底统一走 `trackNoteWindow`（内存 + 账本 + destroyed 销账）· 启动用 `getAllWebviewWindows()` 存活过滤（reload 保留 / 重启清空）· vitest 453 · 实测：reload 后点该篇不开第二份 + toast、关窗清空、残留自动 prune |
| 173.62 | **独立窗口三键与主窗口对齐**：`.zn-plugin-window-bar` 在桌面去上下 padding、锁 32px，三键负右边距贴边 ⇒ hover 背景与主窗口一样占满整条 · 触屏保留原样 · 实测笔记窗口 / 导图窗口都是 bar 32 / btn 31 / 46px |
| 173.61 | **主窗口位置/大小记忆（P1-b）**：官方 `tauri-plugin-window-state 2.5.0`（桌面 target 专属）· `with_filter` 只跟踪 `main`（note-* / plugin-* 不恢复不保存）· StateFlags = POSITION/SIZE/MAXIMIZED · 实测两次重启都回到 (120,160) 960×640，状态文件只含 main |
| 173.60 | **笔记独立窗口跳过插件加载（P1-a）**：`usePluginHost` 加 `enabled`（默认 true），`?note=` 窗口传 false ⇒ 内置预装 / 扫描 / 加载整段不跑 · 实测主窗口 61 命令 + 2 面板 + 2 样式 vs note 窗口 30 条纯内核命令 + 0 面板 + 0 样式 · note 窗口编辑照常落盘 · vitest 448 |
| 173.59 | **文件监听补齐（P0）**：Rust `notify 8.2` + `watch_vault`/`unwatch_vault`（桌面 target 专属，每库一个 watcher + 窗口引用计数）· 只报库内 `.md`（`.zn`/`.vaults` 不进事件流）· 120ms 合并 + 1500ms 自写抑制 · 前端「watch_vault 成功才停轮询」，失败保留 3 秒兜底 · 移动端主动退轮询 · cargo 36 / vitest 447 · 桌面四场景实测 |
| 173.58 | **交接**：质量基建（facts / 5 门 / decisions / templates）+ 6 份文档 + 对标 v2 · 两次提交 `b6a1cdc` / `cc3bce7` · 唯一下一步 = 修 `zn://fs-change` emitter · 测试 445 |
| 173.57 | **系统总览**：`docs/系统总览.md`（拓扑 / 启动序列 / 保存链 / 插件生命周期 / 窗口收回 / 事件表 / 模块地图 / 排障）· 权威矩阵与阅读路径同步 · 质量门 5/5 |
| 173.56 | **文档补强**：`docs/UI交互规范.md`（现行布局/浮层/手势/主题）· `docs/数据与存储.md`（库布局 / localStorage 键表 / 写入语义 / 迁移）· `scripts/gen-keys.mjs` 生成 `docs/键位表.md`（9+9）· 质量门 5/5 |
| 173.55 | **质量基建**：`scripts/facts.mjs`（事实块自动生成 + 新鲜度门）· `check-arch` / `check-links` / `gen-catalog` 进 verify 第 6 步 · `docs/decisions/` 6 条否决记录 · `docs/templates/` 任务卡 + ADR · README / CHANGELOG / 需求权威 / VS Code PR 误读一并修正 · 测试 **445** |
| 173.54 | **标题条拖出 = 收回 + 多窗口调研补课**：标题条文档名变成拖拽把手（越界松手 ⇒ 保存→通知→关窗，复用 `lib/tab-drag.ts`）· 补 `docs/标签窗口拖拽-调研-2026-10-20.md`（Obsidian/Chrome/VS Code 做法 + 多窗口架构对比）· `docs/开发约定.md` §0.6「系统能力类改动先查同类产品」· 测试 **445** |
| 173.53 | **独立窗口收成纯编辑窗口**（用户「拖出来的窗口只要编辑窗口就行了」）：去掉独立窗口里的标签条 · 收回改成标题条左侧 `⤺` 按钮（同一条 `returnToMain`：保存→通知→关窗）· 主窗口拖出手势不变 · 测试 **445** |
| 173.52 | **拖出独立 / 拖入放回 + 同一篇互斥**：`src/lib/tab-drag.ts`（8px 阈值 / 越界热区）· `TabBar` 指针拖拽手势（拖完吃掉补发的 click）· 主窗口拖出 = 拆窗口 · 独立窗口拖出 = `saveNow → emit → close` 交回主窗口（标签自动回来）· `noteWindowsRef` + `useDocSession.canOpen` 守卫（点被拆出的那篇 ⇒ 聚焦 + 提示）· 测试 **445** |
| 173.51 | **标签页拆独立窗口**（用户「做成窗口级的，可以拿出来单独放」）：`src/lib/note-window.ts` · `?note=` 窗口模式（只画编辑器）· 标签右键「在新窗口打开」（开出来主窗口移除该标签）· capabilities 加 `note-*` · 关窗走 `close()` 保证落盘 · 测试 **433** |
| 173.50 | **多标签页**（待办 #2 · 分屏未做）：`src/lib/tabs.ts`（打开 / 关掉后选谁 / 循环 / 改名重映射）+ `TabBar` · `useDocSession.onOpened` 登记 · `Ctrl+Tab` / `Ctrl+Shift+Tab` · 四个「关闭」入口统一为关当前标签 · 删当前笔记走 `discardNote`（不落盘）· 测试 **426** |
| 173.49 | **全局替换（跨笔记）**（待办 #3）：`src/lib/global-replace.ts`（字面量/正则、行号上下文、`$` 字面量 vs `$1`）· `ReplacePanel`（先试运行 → 确认后写盘）· 每篇改前 `fs.delete` 移入回收站 · `core.replaceAll` = `Ctrl+Shift+H` · 测试 **400** |
| 173.48 | **时间流开关 + 手机长按 ☰ 出菜单**：`TitleBar` 长按 500ms 弹菜单（吞掉松手 click）· `timelineOpen`（localStorage）· 时间流空白/卡片右键「关闭时间流」· 文件树/编辑器/起始页右键「打开时间流」· 测试 **383** |
| 173.47 | **搜索筛选**（待办 #4）：`index.query` 补 `regex`（`imu` / 语法错误返空 / 正则摘要与打分）+ 空关键词支持 `dir` · SearchPanel 筛选行（标签下拉 · 目录下拉 · 正则开关 · 清除筛选）· 契约 §1.3 同步 · 测试 **378** |
| 173.46 | **编辑器粘贴图片**（待办 #1）：Rust `import_attachment_b64`（字节直接落笔记同目录）· `src/lib/paste-image.ts` · CM6 paste handler（只接管带图片的粘贴）· 桌面真实 Ctrl+V 实测 + 文字粘贴回归 · **手机真机长按粘贴实测可用** · 测试 **367** |
| 173.45 | 交接：173.40–173.44 收口 + 下个会话开工 #1 的执行路径 |
| 173.44 | 待办登记（用户指定 4 项：粘贴图片 / 搜索筛选 / 全局替换 / 标签页分屏） |
| 173.43 | **查找面板悬挂窗**：fixed 遮罩 + 居中卡片（对齐命令面板）· 点遮罩关闭 · 打开时不再推正文 |
| 173.42 | **Ctrl+F 修回编辑器查找**：关掉 WebView2 原生查找栏（`ICoreWebView2Settings3`）· 真实按键实测 · 副作用：Ctrl+R/F5 等一并失效 |
| 173.41 | **缺陷修复 ②**：插件目录读取失败 → `pluginError` · 内置插件写入失败 → toast + 插件页 · 外链失败 → toast（手机提示复制到浏览器） |
| 173.40 | **缺陷修复 ①**：搜索索引真增量（`fs-events.ts` 包装写路径 + 外部 `watch`）· 内核事件真派发（`note:*` / `index:rebuilt` / `app:ready` / `vault:open`） |
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
| 链接无法跳转 | ✅ **rev173.102**：根因 = rev173.97 的点击判据拿 `.cm-atomic-link` 的**可见文本**判 `^\[\[…\]\]$`，而 atomic 的可见文本永远不含双方括号（活跃行是 widget、普通行是隐藏 span）⇒ 正则永不匹配、点击全被丢弃 · 改看**源码行**（`posAtDOM` + `wikiLinkTarget`，与外观判据同一套「绿色 = 可点」）· `[[目标\|别名]]` 支持 · 单测 12 条 · 桌面 CDP 实测（wikilink / 别名跳转、普通方括号不跳）· ⚠️ 验这条必须 `location.reload()`（HMR 保留旧 effect 闭包） |
| 提醒打卡 `habit` | ✅ **rev173.103 + rev173.105**：主区面板（计划列表 + 今日次数 + 打卡 + 月历 + 连续/累计）· 四种频率 · 一天多次 / 上限 1–99 · 连续按应打卡日 · 补打卡 / 清除限最近 7 天 · 数据 `store` · 预装 9 · 单测 **36** 条 · 桌面 CDP 全流程实测 · **手机真机 33b676f6 全流程实测（rev173.105）**，同轮修：补打早于 startDate 连续不涨 / 切月不清选中日 / 按钮禁用态 · **到点提醒不做**（用户裁决） |
| 会话恢复（hot exit） | ✅ **rev173.65**：崩溃 / HMR 整页重载后主窗口启动提示「恢复 / 丢弃」· 草稿只留 1 篇 / ≤ 8 KB / 7 天过期 · 恢复以磁盘内容为 `baseRef` · `taskkill` 进程级强杀实测通过 |
| 手机卡片菜单返回键 | ✅ **rev173.66**：`MobileNoteCards.layers` 接 App 的 `layerExitsRef`（与 `FileTree` 同一约定）· 菜单开着按返回先关菜单；只有全都没得关才退 App · 手机 33b676f6 实测 |
| 笔记独立窗口标题条 | ✅ **rev173.67–68**：整条标题栏可拖窗口（`data-tauri-drag-region="deep"`）· 文档名居中 · 去掉 `⤺` 按钮 · **关闭按钮 = 交回主窗口**（保存 → emit → 关窗，主窗口标签回来并打开）；拖拽收回手势已移除 · 实测点关闭后主窗口标签回来且 active |
| 窗口位置 / 大小记忆 | ✅ **rev173.61**：官方 `tauri-plugin-window-state 2.5.0`（桌面 target 段）· `with_filter` 只跟踪 `main` · StateFlags = POSITION/SIZE/MAXIMIZED（不碰 VISIBLE/DECORATIONS/FULLSCREEN）· 实测两次重启都回到 (120,160) 960×640；开过 note 窗口后状态文件仍只含 main |
| 文件监听（外部改动） | ✅ **rev173.59**：桌面 Rust `notify 8.2` watcher → `zn://fs-change`（只报库内 `.md` · 120ms 合并 · 1500ms 自写抑制）· 前端 `watch_vault` 成功才停轮询 · 移动端（FUSE 漏报）主动退 3 秒轮询 · 桌面 CDP 四场景实测（新建 / 改当前笔记 / 删除 / 自写无回响） |
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
| 文档阅读器（面板化） | ✅ **rev173.84**：`view.overrideShell` → `view.registerPanel({ mount })`（面板 `doc-reader.view`）—— PDF / EPUB / TXT 画在**主区标签**里，拖出 / 右键 = 独立窗口；换文档走模块级 `currentDoc` + 实例回调（mount 只跑一次），窗口（新 webview）从 `store.last` 读路径；阅读器不再画「关闭」；换库比对 `store.last.vault`（不用 `vault:open` —— 每代都发，会误清冷启动刚打开的文档）。**桌面 CDP 实测**：打开 probe.pdf → 主区标签「文档阅读器」+ 第 1/1 页 · 右键 → 独立窗口同一份（从 store 读路径）· 拖出后主区复位。**手机真机 33b676f6 实测**（rev173.85 补）：点「说明.txt」→ 阅读器出内容、抽屉自动收起、返回键回起始页 · 另修两个内核缺口：面板页没标签条（拖不出去）· `core.openDocument` 被大 effect 重注册覆盖（接管失效）。✅ **rev173.85 换到"编辑区同一位置"**：面板与编辑器共用外壳（标签条 + 内容区），侧栏常驻，面板视图点笔记切回编辑器 · 桌面 + 手机实测。✅ **rev173.86 多标签**：每份文档一个面板（`doc-reader.view.<hash32(路径)>`，title = 文件名）· `hidden: true` 不进 ☰ 菜单 · `doc` 闭包常量（删 `currentDoc`/`liveInstances`）· `store.docs` 供窗口反查 · `readerState` 记住页码/缩放 · 桌面实测三标签混排 / 点切 / 关标签 · **手机不做多标签**（用户明确） |
| 插件窗口整页白屏 ⇒ 关不掉 | ✅ **rev173.104 已兜底**：窗口每 3 s `emitTo('main')` 报活（带根节点自检），主窗口每 5 s 扫 `getAllWebviewWindows()`，**从没心跳**（>20 s 宽限）/ **心跳断 12 s** / **自报白屏 3 次** ⇒ `destroy()` + toast「已关闭无响应的窗口」。清理链路**不依赖目标窗口里的 JS**。实测：正常窗口 45 s 不误杀 / 无心跳窗口 20 s 关 / 隐藏根节点 10–15 s 关。**规矩不变：关窗口用 `destroy()`，别用 `window.close()`**。⚠️ 当前版本实测 `Page.crash` 与 `window.close()` 都会让窗口壳一起消失（与 rev173.84 当时不同），兜底主要覆盖「页面没起来 / JS 停了」 |
| A 档 4 个插件（标签 / 双链 / 历史 / 打卡） | ✅ **全部完成**：✅ 调研（rev173.80）· ✅ 面板地基（rev173.81–88）· ✅ outline-map 迁移（rev173.89）· ✅ **标签面板 `tag-panel`（rev173.93）**（主区面板 / 标签降序 / 点笔记打开 = 新增 `core.openNote` / 预装 6 / 桌面+手机实测）· ✅ **A0 探针（rev173.94）→ 结果 B**（`[[ ]]` 链接文字归内核，正向不重复做）· ✅ **反向链接 `backlinks`（rev173.95）**（`fs` 扫 + mtime 缓存 / modal 浮层 / 点来源打开 / 单测 26 / 桌面 + 手机实测；**rev173.101 状态栏「被 N 篇引用」**）· ✅ **标签浮层（rev173.96）**（点 `#标签` → 浮层 → 点一篇**独立窗口**；内核补 `core.openInNewWindow {path}` + `core.closePanel`；单测 33）· ✅ **历史版本 `history`（rev173.99 + 入口 rev173.100）**（`.zn/history` + 四档精简 + diff + 回滚；状态栏按钮入口）· ✅ **打卡 `habit`（rev173.103）** · 决定已拍板（主区标签 / 库内历史 / store 打卡 / 到点提醒不做）· 排期见 `docs/ROADMAP.md` |
| Worker / 子进程插件宿主 | ✅ **明确放弃（2026-10-21 用户裁决）**：按 `D-001` 不做，不再排期、不再讨论 · 依据：自用不装第三方插件 · 兜底已落地（看门狗 5 s 心跳超时 ⇒ `exit(101)` ⇒ 下次启动禁用该插件 ⇒ 一键恢复；渲染崩溃另有 `PanelBoundary`）· 真要重开必须先推翻 `D-001` |
| 插件签名 / 分发 | ✅ **签名已做（rev173.77）**：Ed25519 `signature.json` + 信任根 `.zn/trusted-keys.json` · 有签名必须验过否则拒载 · `scripts/keygen.mjs` / `sign.mjs` · 插件页三态（已签名 / 已校验 / 未签名）。**插件市场 / 更新通道 ⏸ `D-008` 降级不排期（2026-10-21）**（签名只解决"是谁发布的"）· 多文件 `manifest.files` 未纳入签名 |
| 插件能力使用审计 | ✅ **rev173.78**：只记 API 名 + 次数（不含参数 / 路径 / 内容）· `Proxy` 包 10 原语 · 落盘 `.zn/plugin-usage.json` · 节流 5 秒 + 启动 restore · 诊断出口 `__znPluginUsage()` · 单测 14 条 · 实测 4 个预装插件（accounting `command.register` 81 次；outline-map 用到 doc / editor / fs）。**用途**：将来收紧 capability 白名单的数据依据。没做：插件页展示 / 声明-vs-实际对比（留到公开时） |
| capability 安装确认 | ✅ rev119 安装 `.znp` 时弹出自述能力清单（内核仍不拦截） |
| iframe ↔ 宿主能力通道 | ✅ **rev173.76**：`zn:hello / zn:call / zn:reply` · 白名单 7 条（store.get/set/delete/all · host.info · host.notify · 本插件命令）· 令牌 + `event.source` 双重校验 · 限流 20/s · 应答 256 KB · 单测 13 条 + 桌面端到端（webview-demo：host.info / store 读写落盘）+ 负面（坏令牌被拒 / 白名单外忽略）· `fs` / `doc` 仍不开放 |
| 记账插件 | ✅ **v0.2 完成**（rev173.16 原生捕获 / rev173.17 分类学习 / rev173.18 点分类即改+自定义分类 / rev173.28 统计图表 + CSV 导入导出 / **rev173.28.1 原始通知诊断**）。**rev173.73 收尾**：每月分类预算（统计页显示「已用 / 预算 · 超支」）· 分类管理（排序 / 删除，删除前显示影响笔数并归入「其他」）· 无金额补录（列表「补金额」）· **启动自动静默同步**（手机实测：后台收到 ¥77.77 → force-stop → 启动即入库）。**rev173.75 补齐 ②**：完成态短语（支付成功 / 已支付…）无金额也入账进「金额待补」· 列表每行「删除」+ 确认页（不可恢复）· vitest **493**。剩余待办：**真实文案校准**（诊断视图已就绪：遇到漏记看原文+原因，发来补规则）· AI 分类（可选，暂不做）。⚠️ 边界：`force-stop` 期间的通知收不到（系统解绑 listener 且不自动重建）· 无金额通知的商户提取可能落到 App 名（原文没有「在…支付 / 商户：」锚点时） |
| 暗色模式滚动条 | ✅ **rev173.32**：`EDITOR_CSS` 加 `:root[data-theme='dark'] .zn-editor .cm-scroller { color-scheme: dark }`（UA 级开关）· 亮色默认值 · 源码模式一并覆盖 · CDP 实测 + 截图对比 |
| 桌面时间流面板 | ✅ **rev173.33**：侧栏与编辑区之间常驻（默认 300px，可拖 160–560）· 卡片复用手机起始页 `MobileNoteCards variant="panel"`（无 ＋ / 无长按）· 点卡片按 kind 派发（doc / image / note）· 插件页 / 回收站不显示 · **rev173.48 可关闭**（时间流右键 / 卡片右键「关闭时间流」；文件树·编辑器·起始页右键「打开时间流」；状态记 localStorage） |
| 滚动条 | ✅ **rev173.34**：全局自绘（`GlobalScrollbars`）—— 所有滚动容器统一 · 无轨道 · 6px 半透明滑块（封顶 120px）· 滚动出现静止淡出 · 可拖 · 原生滚动条全部藏掉 |
| 搜索 / 事件总线 | ✅ **rev173.40**：索引真增量（写路径 + 外部改动）· `note:*` / `index:rebuilt` / `app:ready` / `vault:open` 派发 · 契约 §1.4 补 payload 表 |
| Ctrl+F 原生查找栏 | ✅ **rev173.42 + rev173.70**：主窗口在 `setup` 里关掉 WebView2 浏览器加速键；`note-*` / `plugin-*` 窗口由 `watchAcceleratorKeys` 在 `tauri://created` 后调 `disable_accelerator_keys_for` 补上（每个 webview 各自一份开关）· 读回值可断言 |
| 插件 / 外链失败静默 | ✅ **rev173.41 + rev173.70**：插件目录读取失败 → `pluginError` · 内置插件写入失败 → toast · 外链失败 → toast（手机提示复制到浏览器）· **库内插件迁移失败也不再静默**（逐个记 `{id, reason}`，插件页 + toast） |
| 灵感流插件 | ⏸ **rev173.35 搁置**：移出预装 + 桌面/手机全局目录删除 · 源码留 `examples/inspiration-flow/`（要用：复制进全局目录 + 重扫） |
| Markdown 语法增强 | ✅ **rev173.36 + 173.38 + 173.39 三批完成**：上标 / 下标 / Emoji / 数学（行内 + 块级）· 脚注（编号 + 跳转）· Mermaid 图表 · 定义列表 · **内嵌 HTML 白名单渲染**（设置可关）· 内核 `src/kernel/editor-syntax.ts` |
| 版本管理 | ✅ **rev173.37**：单一来源 `package.json` · 关于页 vite 注入 · `scripts/release.mjs <x.y.z> [--tag]` · 首版 **0.2.0**（tag `v0.2.0`）· 发版流程见 HANDOFF |
| 起始页快捷入口（长按 ＋） | ✅ **rev173.20–22**：长按 500ms → **以 ＋ 为圆心**的半圆环（记账 + 4 空位，`0°/±48°/±96°`），短按仍新建；入口按面板 title 找 id；返回键先关遮罩；点空白 click 关闭不穿透。真机 dev 版验收 · 桌面端 v0.2 |
| 手机版用户使用手册 | ✅ **rev173.23**：`docs/使用手册-移动端.md` + 12 张真机截图（`docs/images/manual-mobile/`）· 面向普通用户、带入口速查表 · **rev173.24 导出 PDF**（29 页，`docs/ZeroNote-手机版使用手册.pdf`） |
| 桌面 release exe | ✅ **rev173.26（隔离版）**：`identifier=com.aqua.zeronote.release` / 标题「ZeroNote Release」· 数据目录 `%LOCALAPPDATA%\com.aqua.zeronote.release` 独立 · 已放 `_View\办公与文档\zeronote.exe` · 与 dev **可同时运行** |
| 同步插件 | 🚧 **内核地基已完成（rev173.106），插件本体待写**：`docs/同步插件-调研与方案-2026-10-24.md` · 目标 = **无感同步**（前台 2–7 秒）· 走 **方案 B**（App 内直连，库放本地普通目录）· **多后端**仿 NoteGen（一期 WebDAV + 本地文件夹 / 二期 S3 / 三期 Git 类，GitHub 走 REST API 且 SHA 自带乐观锁）· 冲突副本 `.zn/conflicts/` · **history 与 sync 合并**（history 存 base，sync 打 `.sync` 标记，二期三方合并）· ✅ **内核三件已就位**：`net`（Rust 发请求，绕 CORS）· `fs.readBytes/writeBytes` · `host.secrets`（系统钥匙串）· ✅ 两件已拍板：**凭据走钥匙串** / **手机接受「前台近实时 + 切回追平」**（不加前台服务）· **下一步 = 写 `sync-webdav` 本体** |
| AI 标签 / 密级 | ❌ 未开工（需求2 暂不采用，方向待定） |
| M3 收尾④：真机「编辑→保存」人工确认 | ⏳ 旧悬置项（实机早已能保存，可忽略） |
| 手机端搜索入口 | ✅ **rev173.48**：长按 ☰（500ms）= 桌面右键菜单（新建 / 搜索 / 命令面板 / 设置 / 插件管理…），手机各功能入口补齐 |
| 时间流开关 | ✅ **rev173.48**：时间流空白或卡片右键「关闭时间流」· 文件树 / 编辑器 / 起始页右键「打开时间流」· localStorage 记忆（默认开） |
| 手机编辑区长按菜单 | ✅ **rev173.90–92**：横向四键「复制 / 剪切 / 粘贴 / 全选」（`MobileEditBar`，长按点上方 56px）· 不再弹桌面竖排菜单 · **粘贴走原生剪贴板**（rev173.92：`tauri-plugin-clipboard-manager`，用户同意重装 APK）——跨 App 复制也能粘 · 真机实测插件 write→read 往返 + 页面粘贴插入 `ZN-NATIVE-CLIP` · 内部缓存保留兜底 |
| 多标签页 | ✅ **rev173.50**：编辑器顶部标签条（标题 + 未保存圆点 + ×）· `Ctrl+Tab` / `Ctrl+Shift+Tab` 循环 · `Ctrl+W` 关当前（还有别的标签就切过去）· 关闭 / 改名 / 删除 / 切库四处生命周期都同步 · **分屏不做**（D-007：标签拖出成独立窗口 + Windows 原生窗口并排够用） |
| 标签拆独立窗口 | ✅ **rev173.51–54**：标签**拖出**窗口 = 拆成独立窗口（`note-*`，900×700，自绘标题条三键）· 窗口里**只有编辑器**（无标签条）· 收回两条路：标题条 `⤺` 按钮 / **拖标题条出界**（越界 6px 热区松手，与主窗口「拖标签出界=拆出」对称）· 右键菜单同效 · **同一篇同时只在一个窗口里** · 关窗走 `close()` 先落盘 · 手机提示不支持 · ✅ 主窗口 reload 不再丢占用表（rev173.63：localStorage 账本 + `getAllWebviewWindows` 存活过滤） |
| 沙箱 | ⏸ 搁置（用户裁决） |
| 笔记窗口 Ctrl+Shift+F | ✅ **rev173.74**：`core.search` 在 `?note=` 窗口里给 toast「全库搜索请在主窗口使用」，主窗口照常开面板 · `?note=` 分支补上 toast 渲染处（以前任何 `setToast` 都落空）· 桌面 CDP 真实按键 + 主窗口回归实测 |

## 待办：与同类应用对比补齐（2026-10-20 · 用户指定）

> 来源：2026-10-20 与 Obsidian / 思源 / Joplin / Typora 对比后的缺口清单。**用户要求列入待办**。
> 顺序 **1 → 4 → 3 → 2**（成本 / 收益比）：**#1 ✅（rev173.46）· #4 ✅（rev173.47）· #3 ✅（rev173.49）· #2 ✅（rev173.50）—— 4 项全清**。

| # | 项 | 优先级 | 现状（已核实） | 验收口径 |
|---|---|---|---|---|
| 1 | 编辑器**粘贴图片**（截图后 Ctrl+V） | ✅ **P1** | **rev173.46 已完成**：Rust `import_attachment_b64`（字节落笔记同目录）+ CM6 paste handler（只接管带图片的粘贴）· 桌面真实 Ctrl+V 实测：落盘 → `![](相对路径)` → toast · 文字粘贴回归通过 | 桌面 ✅（`_tmp-vault-tb` + `_shots/paste-02-inserted.png`）；**手机 ✅** 用户 2026-10-20 真机长按粘贴实测可用（dev 包连电脑 1420） |
| 4 | 搜索**筛选**：正则 / 标签 / 目录 | ✅ **P2** | **rev173.47 已完成**：`index.query` 补 `regex`（flags `imu`，语法错误返空不抛错）+ 空关键词支持 `dir`；SearchPanel 筛选行（标签下拉带篇数 / 目录下拉 / 正则开关 / 清除筛选），语法错误给出具体原因 | 桌面实测：标签「验收」→ 1 条 · 目录「搜索验收」→ 2 条 · 正则 `^# 验收` → 2 条 · 非法正则 → 提示（`_shots/search-filter-02-tag.png` / `-03-regex.png`） |
| 3 | **全局替换**（跨笔记） | ✅ **P2** | **rev173.49 已完成**：`Ctrl+Shift+H` / ☰ 菜单「全局替换…」→ 面板（查找 / 替换为 / 范围目录 / 正则 / 区分大小写）→ **试运行出清单**（文件 + 行号 + 上下文）→ 确认后「全部替换」；每篇改前 `fs.delete` 移入回收站备份 | 桌面实测：夹具 2 篇 3 处 → 试运行清单正确 → 替换后磁盘为「会议纪要」、回收站有 2 份原文备份、索引更新（新词 2 条 / 旧词 0 条）（`_shots/replace-01-dryrun.png`） |
| 2 | **多标签页 / 分屏** | ✅ **P2** | **rev173.50 已完成（标签页）**：`src/lib/tabs.ts` + `TabBar`（编辑器顶部）· 打开/切换/关闭/`Ctrl+Tab` 循环 · 各标签保留 undo 历史与滚动（编辑器按 path 缓存）· 删当前笔记切邻居、改名重映射 · **分屏不做**（D-007：Windows 原生窗口并排够用） | 桌面 CDP：3 篇同开切换、输入后 150ms 切走仍落盘、Ctrl+Tab 循环、关当前切邻居、删当前切邻居（`_shots/tabs-01-three.png`）；手机（CDP 9333）切换 / × 关闭 / 返回键关当前（`_shots/phone-tabs-04.png`） |

> 4 项都不改内核契约（`src/kernel/contract.ts` 不动），属 UI/内核内部能力；
> 2 会碰 `App.tsx` 的文档会话（需要 `activePath` → tabs 数组），成本最高，放最后。

> 已结清：文档阅读器（rev72–74）· 卡死兜底（rev70/71）· 触屏三件（rev67/68）· 插件跨库（rev94）· 内置预装（rev110）· 文档对齐（rev93 + 2026-10-17 契约 v0.2）· 前端单测（rev120）。

## 环境现状（活信息）

- **桌面 dev**：直接 `pnpm tauri dev`（vite 1420）即可——IL 已修，默认 UDF 正常；`scripts\dev.ps1` 是备用启动（UDF 放项目内 `_tmp-ebwebview`），两种都行。日志 `.self-logs/desktop-dev.log`；**android-dev** 另起（WMI，日志 `.self-logs/android-dev.log`）。
- **2026-10-23 环境**：桌面 `dev.cmd` 在跑（vite 1420 · CDP 9222 · `zeronote.exe` 2026-10-23 20:26 起）；
  **旧残留已清**（10-21 的 `android-dev.cmd` 树 cmd 31684 / node 23140 / 2920、8791 的 webview-demo server pid 25768 —— 全部 taskkill /T 干净，桌面 dev 未受影响）。
- **手机状态（2026-10-23 21:42）**：真机 `33b676f6` 连着，`com.aqua.zeronote.debug` **已重装**（21:42:17，含原生剪贴板插件；pid **8839**，前端实时取 1420）；
  手机 CDP 转发：`adb forward tcp:9333 localabstract:webview_devtools_remote_8839`（换进程后先 `forward --remove` 再按新 pid 重建）。
- **交接时 dev 状态（2026-10-21 13:45）**：桌面 `dev.cmd` 在跑（vite 1420 · CDP 9222 · cargo/zeronote 起于 02:15）；**Android dev 本轮已起**（真机 `33b676f6`/ARIA，`android-dev.cmd` → `.self-logs/android-dev.log`）。
  ⚠️ **起 android dev 前先清残留**：昨天（10-20 00:54）的 `pnpm tauri android dev`（pid 624/23272）一直持有 Android 构建锁，
  新实例只打一行「Blocking waiting for file lock on Android」然后干等 —— 本轮清掉后才开始编译。库 `_tmp-vault-tb`。
  **别用后台 job 托管 GUI 进程**（job 结束会连带杀进程树）；`dev.cmd` 自带 `ZN_WATCHDOG=off`。
- **手机状态（2026-10-21 13:50 更新）**：Android dev 本轮重新构建并**装到真机**（`com.aqua.zeronote.debug`，App 进程 pid **32688**，前台）；
  手机 CDP 转发已按新 pid 重建：`tcp:9333 → webview_devtools_remote_32688`
  （`ZN_CDP=http://127.0.0.1:9333 ZN_TARGET=tauri.localhost node tools/cdp.mjs …` —— 手机的页面 URL 是 `http://tauri.localhost/`，
  不设 `ZN_TARGET` 会挑不到）；换进程后先 `forward --remove tcp:9333` 再按新 pid 重建。
  手机库里有 2 个文档（`测试书籍.epub` / `说明.txt`），没有 PDF —— 要验 PDF 需先推一份。
- **别用管理员跑 dev**：管理员实例会污染默认的 WebView2 用户数据目录（普通权限再跑 = `0x800700AA`；
  注意这只是**多因之一**，不是最初那次报错的原因）—— 已污染就用 `scripts\dev.ps1` 绕开（项目内目录，普通权限稳定）。
- **dev 日志只进 stdout**（rev173.11 起）：`tauri-plugin-log` 去掉了 `LogDir` target，不再写 `%LOCALAPPDATA%\com.aqua.zeronote\logs`（那里被管理员实例写过后，普通权限会 `os error 5` 直接 panic）。
- **GitHub**：账号 `aqua7773`（gh 已登录，keyring）；**github.com 直连超时，必须走本地代理 `http://127.0.0.1:26561`**（`HTTPS_PROXY`）。gh 不在当前 PATH，用 `C:\Program Files\GitHub CLI\gh.exe`。
- **dev 崩溃**：连续多次 HMR 会 `0xc0000374 STATUS_HEAP_CORRUPTION`，重启即恢复（rev117 / rev118 各踩一次）。
- **手机 `33b676f6`（ARIA 24069RA21C）= 测试机，只跑已装的 dev 包**（`com.aqua.zeronote.debug`，连电脑 1420）：
  启动 `adb -s 33b676f6 shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity`；前端改动 reload 即生效。
  ⚠️ adb 里还有两个**离线残留**（`emulator-5554` / `localhost:5555`）⇒ 所有 adb 命令都带 `-s 33b676f6`，否则报 "more than one device"。
  **别为测试重编 APK**（硬约束 7）；判据：logcat 出现 `node_modules/.vite/deps/…`。**不装 release**。
- **防火墙**：1420 已放行（TCP，仅 `192.168.1.0/24`；网络被识别为 Public、手机 2.4G / 电脑 5G 跨 SSID）。
- **手机 CDP**（默认手机断言手段）：`adb forward tcp:93xx localabstract:webview_devtools_remote_<pid>` → `ZN_CDP=http://127.0.0.1:93xx node tools/cdp.mjs …`。
- **手机模拟点击**：`input tap` 无效；用 `input motionevent DOWN x y` ＋ `UP x y`（间隔 ~120 ms）。`screencap` 是物理像素。
- **手机白屏（HMR 失败）**：vite 报 `Failed to reload /src/App.tsx` 后页面不回滚 ⇒ 白屏
  （先看 logcat 是不是 `tauri::protocol::tauri: Failed to request …: error sending request`）；
  `adb shell am force-stop com.aqua.zeronote.debug` 重开即恢复（2026-10-19 实测）。
  桌面的 note-* 窗口同样会白屏（HMR 全量重载后）—— `location.reload()` 即恢复（2026-10-20 实测）。
- **测试库 `_tmp-vault-tb/`**：4 篇笔记（`新笔记-15-16-04` / `-19-46-58` / `-23-37-07` / `Markdown标签测试`）+ 3 个只读文档 + 2 个附件；
  **插件都在全局根**（7 个目录；rev173.5 起库内不放插件）。验收夹具**按需挂、用完即删**（rev117 的夹具已清）。
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
