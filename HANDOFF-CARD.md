# ZeroNote 交接卡（当前状态）

> 最后更新 **2026-10-20（rev173.69）** ｜ 细节与证据在 **`HANDOFF.md`**（rev 索引在文首）｜ 提交数一律看 `git log`
> 本卡只放**当前状态**；历史过程一律回 HANDOFF，不再在此重复。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.69 · 0.2.0 · 2026-10-20 |
| 测试基线 | vitest 474 · cargo 36 · oxlint 3 warnings（2026-10-20） |
| 插件 | 内置 5 · 示例 29 |
| 文档 | README 现状 2026-10-20 · CHANGELOG 0.2.0 |
<!-- FACTS:END -->

## 是什么

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用（Tauri 2 + React 19 + Rust）。
一切功能靠插件：**全局目录** `<应用数据目录>/.zn/plugins/<id>/` —— **唯一位置**（跨库共用；rev173.5 起取消库内插件）；装卸＝放/删一个文件夹。
内核 10 原语 + 21 种 UINode + 6 个挂载位 + 真窗口 / 整窗接管。
内核自带：12 条 Markdown 标记命令（`core.mark.*`，桌面右键「标记」/ 手机键盘上方快捷栏）· 层级文件树（空目录 / 框选 / 拖拽 / 引导线）· 回收站 · 搜索 · 命令面板 · 快速切换 · **桌面「时间流」面板**（rev173.33：侧栏与编辑区之间常驻，卡片与手机起始页同一套）· **增量搜索索引 + 内核事件总线**（rev173.40：`note:saved` 等 9 种事件真派发）· **粘贴图片**（rev173.46：截图 Ctrl+V → 落笔记同目录 → 插入 `![]()`）· **搜索筛选**（rev173.47：标签 / 目录 / 正则，与关键词任意组合）· **全局替换**（rev173.49：`Ctrl+Shift+H`，先试运行再写盘，改前进回收站）· **多标签页**（rev173.50：编辑器顶部标签条，`Ctrl+Tab` 循环 / `Ctrl+W` 关当前；**分屏仍未做**）· **标签拆独立窗口**（rev173.51–54 · rev173.67–68 标题条收尾：标签**拖出**窗口 = 独立窗口，窗口里**只有编辑器**；整条标题栏可拖窗口、文档名居中；**关闭按钮 = 把这篇交回主窗口**（保存 → 通知 → 关窗），拖拽收回手势已按用户要求移除；右键菜单同效；**同一篇同时只在一个窗口里**，主窗口再点会聚焦那个窗口并提示）· **笔记窗口不加载插件**（rev173.60：窗口里跑 30 条内核命令、0 面板、0 插件样式）· **桌面文件监听**（rev173.59：别的程序改盘 → 桌面 1 秒内刷新、手机 3 秒轮询；自己保存不触发回响）· **主窗口记忆**（rev173.61：位置 / 大小 / 最大化在重启后恢复；独立笔记窗口不记忆）· **会话恢复**（rev173.65：崩溃 / HMR 整页重载后启动提示「恢复 / 丢弃」，只留 1 篇 / ≤ 8 KB）。
**插件预装**：新版 APK 内置 **5** 个常用插件（大纲·导图 / 文档阅读器 / 导入导出 / 米色主题 / 记账；rev173.16 加「记账」；2026-10-19 rev173.29–31 移出 `daily-note` / `editor-marks` / `tag-demo`，**rev173.35 移出 `inspiration-flow`（灵感流，搁置）**）。

## 验收基线（以输出为准，不写死数字）

```powershell
pwsh -File scripts\verify.ps1
# 六步：tsc 0 错误 · oxlint src 0 error · cargo test --lib 全过 · check-docs 全过 · vitest 全过 · 质量门 5 项（facts / 依赖方向 / 本地链接 / 功能目录 / 键位表）
```

## 下个会话第一件事

1. ~~P2 会话恢复（hot exit）~~ ✅ **rev173.65 已完成**（做法 / 三个坑 / 实测见 `HANDOFF.md` 该段；下一步接第 2 条）。
2. **记账文案校准**：等真实漏识别样本（「诊断」视图已就绪）。
3. **主线（更远）：iframe ↔ 宿主能力通道（v0.2）** —— 契约 §7.9 要 `postMessage` 请求/应答协议 + 宿主侧鉴权。
4. **环境清理（顺手）**：✅ 本会话已清掉 1420 上的旧 vite（杀掉旧 android dev 链的 vite 进程，再重启 `dev.cmd`）；现在唯一的 vite 是 dev.cmd 自起的 1420（1421 未监听）。

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

## 本会话（rev173.28 – 173.69 · 2026-10-19 ~ 20）

| rev | 内容 |
|---|---|
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
| 插件签名 / 分发 | ⚠️ rev119 已做 A+B：完整性 sha256 + `.znp` 安装 + 未签名提示；**真签名（公私钥）/ 市场 / 更新通道未做** |
| capability 安装确认 | ✅ rev119 安装 `.znp` 时弹出自述能力清单（内核仍不拦截） |
| iframe ↔ 宿主能力通道 | ❌ 未做（v0.2） |
| 记账插件 | ✅ **v0.2 完成**（rev173.16 原生捕获 / rev173.17 分类学习 / rev173.18 点分类即改+自定义分类 / rev173.28 统计图表 + CSV 导入导出 / **rev173.28.1 原始通知诊断**）。待办：**真实文案校准**（诊断视图已就绪：遇到漏记看原文+原因，发来补规则）· 预算 · 分类删除/排序 · AI 分类（可选） |
| 暗色模式滚动条 | ✅ **rev173.32**：`EDITOR_CSS` 加 `:root[data-theme='dark'] .zn-editor .cm-scroller { color-scheme: dark }`（UA 级开关）· 亮色默认值 · 源码模式一并覆盖 · CDP 实测 + 截图对比 |
| 桌面时间流面板 | ✅ **rev173.33**：侧栏与编辑区之间常驻（默认 300px，可拖 160–560）· 卡片复用手机起始页 `MobileNoteCards variant="panel"`（无 ＋ / 无长按）· 点卡片按 kind 派发（doc / image / note）· 插件页 / 回收站不显示 · **rev173.48 可关闭**（时间流右键 / 卡片右键「关闭时间流」；文件树·编辑器·起始页右键「打开时间流」；状态记 localStorage） |
| 滚动条 | ✅ **rev173.34**：全局自绘（`GlobalScrollbars`）—— 所有滚动容器统一 · 无轨道 · 6px 半透明滑块（封顶 120px）· 滚动出现静止淡出 · 可拖 · 原生滚动条全部藏掉 |
| 搜索 / 事件总线 | ✅ **rev173.40**：索引真增量（写路径 + 外部改动）· `note:*` / `index:rebuilt` / `app:ready` / `vault:open` 派发 · 契约 §1.4 补 payload 表 |
| Ctrl+F 原生查找栏 | ✅ **rev173.42**：WebView2 浏览器加速键关闭（编辑器面板在顶部）· ⚠️ 插件独立窗口未处理（P2） |
| 插件 / 外链失败静默 | ✅ **rev173.41**：插件目录读取失败 → `pluginError` · 内置插件写入失败 → toast · 外链失败 → toast（手机提示复制到浏览器）；迁移库内插件仍静默（P2） |
| 灵感流插件 | ⏸ **rev173.35 搁置**：移出预装 + 桌面/手机全局目录删除 · 源码留 `examples/inspiration-flow/`（要用：复制进全局目录 + 重扫） |
| Markdown 语法增强 | ✅ **rev173.36 + 173.38 + 173.39 三批完成**：上标 / 下标 / Emoji / 数学（行内 + 块级）· 脚注（编号 + 跳转）· Mermaid 图表 · 定义列表 · **内嵌 HTML 白名单渲染**（设置可关）· 内核 `src/kernel/editor-syntax.ts` |
| 版本管理 | ✅ **rev173.37**：单一来源 `package.json` · 关于页 vite 注入 · `scripts/release.mjs <x.y.z> [--tag]` · 首版 **0.2.0**（tag `v0.2.0`）· 发版流程见 HANDOFF |
| 起始页快捷入口（长按 ＋） | ✅ **rev173.20–22**：长按 500ms → **以 ＋ 为圆心**的半圆环（记账 + 4 空位，`0°/±48°/±96°`），短按仍新建；入口按面板 title 找 id；返回键先关遮罩；点空白 click 关闭不穿透。真机 dev 版验收 · 桌面端 v0.2 |
| 手机版用户使用手册 | ✅ **rev173.23**：`docs/使用手册-移动端.md` + 12 张真机截图（`docs/images/manual-mobile/`）· 面向普通用户、带入口速查表 · **rev173.24 导出 PDF**（29 页，`docs/ZeroNote-手机版使用手册.pdf`） |
| 桌面 release exe | ✅ **rev173.26（隔离版）**：`identifier=com.aqua.zeronote.release` / 标题「ZeroNote Release」· 数据目录 `%LOCALAPPDATA%\com.aqua.zeronote.release` 独立 · 已放 `_View\办公与文档\zeronote.exe` · 与 dev **可同时运行** |
| 同步 / AI 标签 / 密级 | ❌ 未开工（需求2 暂不采用，方向待定） |
| M3 收尾④：真机「编辑→保存」人工确认 | ⏳ 旧悬置项（实机早已能保存，可忽略） |
| 手机端搜索入口 | ✅ **rev173.48**：长按 ☰（500ms）= 桌面右键菜单（新建 / 搜索 / 命令面板 / 设置 / 插件管理…），手机各功能入口补齐 |
| 时间流开关 | ✅ **rev173.48**：时间流空白或卡片右键「关闭时间流」· 文件树 / 编辑器 / 起始页右键「打开时间流」· localStorage 记忆（默认开） |
| 多标签页 | ✅ **rev173.50**：编辑器顶部标签条（标题 + 未保存圆点 + ×）· `Ctrl+Tab` / `Ctrl+Shift+Tab` 循环 · `Ctrl+W` 关当前（还有别的标签就切过去）· 关闭 / 改名 / 删除 / 切库四处生命周期都同步 · **分屏未做** |
| 标签拆独立窗口 | ✅ **rev173.51–54**：标签**拖出**窗口 = 拆成独立窗口（`note-*`，900×700，自绘标题条三键）· 窗口里**只有编辑器**（无标签条）· 收回两条路：标题条 `⤺` 按钮 / **拖标题条出界**（越界 6px 热区松手，与主窗口「拖标签出界=拆出」对称）· 右键菜单同效 · **同一篇同时只在一个窗口里** · 关窗走 `close()` 先落盘 · 手机提示不支持 · ⚠️ 主窗口 reload 会丢占用表（调研建议搬到 localStorage，未做） |
| 沙箱 | ⏸ 搁置（用户裁决） |

## 待办：与同类应用对比补齐（2026-10-20 · 用户指定）

> 来源：2026-10-20 与 Obsidian / 思源 / Joplin / Typora 对比后的缺口清单。**用户要求列入待办**。
> 顺序 **1 → 4 → 3 → 2**（成本 / 收益比）：**#1 ✅（rev173.46）· #4 ✅（rev173.47）· #3 ✅（rev173.49）· #2 ✅（rev173.50）—— 4 项全清**。

| # | 项 | 优先级 | 现状（已核实） | 验收口径 |
|---|---|---|---|---|
| 1 | 编辑器**粘贴图片**（截图后 Ctrl+V） | ✅ **P1** | **rev173.46 已完成**：Rust `import_attachment_b64`（字节落笔记同目录）+ CM6 paste handler（只接管带图片的粘贴）· 桌面真实 Ctrl+V 实测：落盘 → `![](相对路径)` → toast · 文字粘贴回归通过 | 桌面 ✅（`_tmp-vault-tb` + `_shots/paste-02-inserted.png`）；**手机 ✅** 用户 2026-10-20 真机长按粘贴实测可用（dev 包连电脑 1420） |
| 4 | 搜索**筛选**：正则 / 标签 / 目录 | ✅ **P2** | **rev173.47 已完成**：`index.query` 补 `regex`（flags `imu`，语法错误返空不抛错）+ 空关键词支持 `dir`；SearchPanel 筛选行（标签下拉带篇数 / 目录下拉 / 正则开关 / 清除筛选），语法错误给出具体原因 | 桌面实测：标签「验收」→ 1 条 · 目录「搜索验收」→ 2 条 · 正则 `^# 验收` → 2 条 · 非法正则 → 提示（`_shots/search-filter-02-tag.png` / `-03-regex.png`） |
| 3 | **全局替换**（跨笔记） | ✅ **P2** | **rev173.49 已完成**：`Ctrl+Shift+H` / ☰ 菜单「全局替换…」→ 面板（查找 / 替换为 / 范围目录 / 正则 / 区分大小写）→ **试运行出清单**（文件 + 行号 + 上下文）→ 确认后「全部替换」；每篇改前 `fs.delete` 移入回收站备份 | 桌面实测：夹具 2 篇 3 处 → 试运行清单正确 → 替换后磁盘为「会议纪要」、回收站有 2 份原文备份、索引更新（新词 2 条 / 旧词 0 条）（`_shots/replace-01-dryrun.png`） |
| 2 | **多标签页 / 分屏** | ✅ **P2** | **rev173.50 已完成（标签页）**：`src/lib/tabs.ts` + `TabBar`（编辑器顶部）· 打开/切换/关闭/`Ctrl+Tab` 循环 · 各标签保留 undo 历史与滚动（编辑器按 path 缓存）· 删当前笔记切邻居、改名重映射 · **分屏未做**（可后置） | 桌面 CDP：3 篇同开切换、输入后 150ms 切走仍落盘、Ctrl+Tab 循环、关当前切邻居、删当前切邻居（`_shots/tabs-01-three.png`）；手机（CDP 9333）切换 / × 关闭 / 返回键关当前（`_shots/phone-tabs-04.png`） |

> 4 项都不改内核契约（`src/kernel/contract.ts` 不动），属 UI/内核内部能力；
> 2 会碰 `App.tsx` 的文档会话（需要 `activePath` → tabs 数组），成本最高，放最后。

> 已结清：文档阅读器（rev72–74）· 卡死兜底（rev70/71）· 触屏三件（rev67/68）· 插件跨库（rev94）· 内置预装（rev110）· 文档对齐（rev93 + 2026-10-17 契约 v0.2）· 前端单测（rev120）。

## 环境现状（活信息）

- **桌面 dev**：直接 `pnpm tauri dev`（vite 1420）即可——IL 已修，默认 UDF 正常；`scripts\dev.ps1` 是备用启动（UDF 放项目内 `_tmp-ebwebview`），两种都行。日志 `.self-logs/desktop-dev.log`；**android-dev** 另起（WMI，日志 `.self-logs/android-dev.log`）。
- **交接时 dev 状态（2026-10-20 23:30）**：`dev.cmd` 起的桌面窗口 pid **9988**（22:36 起，**CDP 9222 在**，`node tools/cdp.mjs` 直接可用）；库 `_tmp-vault-tb`。
  **只有一个 vite = 1420**（dev.cmd 自起；1421 未监听，旧的 android dev 链 vite 已清）。
  **别用后台 job 托管 GUI 进程**（job 结束会连带杀进程树）；`dev.cmd` 自带 `ZN_WATCHDOG=off`。
- **交接时手机状态（2026-10-20 23:30）**：dev 包 pid **13190**（force-stop 重开过），在前台、起始页（26 张卡片）；
  手机 CDP 转发已指向它：`tcp:9333 → webview_devtools_remote_13190`
  （`ZN_CDP=http://127.0.0.1:9333 node tools/cdp.mjs …`）；换进程后先 `forward --remove tcp:9333` 再按新 pid 重建。
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
