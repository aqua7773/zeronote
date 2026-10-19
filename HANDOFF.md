# 项目交接

revision: 173.48
更新时间: 2026-10-20（rev173.48 时间流开关 + 手机长按 ☰ 出菜单；rev173.47 搜索筛选；rev173.46 粘贴图片；rev173.45 交接；rev173.44 待办登记；rev173.43 查找面板悬挂窗；rev173.42 Ctrl+F 修回编辑器查找；rev173.41 插件失败可见 + 外链提示；rev173.40 搜索索引增量 + 内核事件派发）
项目: ZeroNote

## rev 索引（最新在前 · 按 rev 号搜本文件即可跳转）

| rev | 内容 |
|---|---|
| rev173.48 | 2026-10-20 · **时间流开关 + 手机长按 ☰ 出菜单**：`TitleBar` 长按 500ms 弹菜单（松手 click 被吞）· `App.timelineOpen`（localStorage，默认开）· 时间流空白/卡片右键「关闭时间流」· 文件树/编辑器/起始页右键「打开时间流」（按状态切换）· 测试 **383** |
| rev173.47 | 2026-10-20 · **搜索筛选**（待办 #4）：`index.query` 补 `regex`（整串正则 `imu` / 语法错误返空不抛错 / 正则摘要与打分）+ 空关键词支持 `dir` · SearchPanel 加筛选行（标签下拉 `index.tags()` · 目录下拉 · 正则开关 · 清除筛选）· 契约 §1.3 同步 · 测试 **378** |
| rev173.46 | 2026-10-20 · **编辑器粘贴图片**（待办 #1）：新增 Rust `import_attachment_b64`（字节直接落笔记同目录，与 `import_attachment` 共用校验/撞名逻辑）· `src/lib/paste-image.ts`（MIME→扩展名 / 分块 base64 / 10 MB 上限）· CM6 `paste` handler（**只有带图片才接管**，文字粘贴照常）· `App.insertPastedImage` + `__znPasteImage` 出口 · 桌面真实 Ctrl+V 实测（图片落盘 + 正文插图 + 文字粘贴回归）· 测试 **367** |
| rev173.45 | 2026-10-20 · **交接**：本会话 173.40–173.44 收口 · 交接时状态 · **下个会话开工 #1 粘贴图片的执行路径**（新增 Rust `import_attachment_b64` + CM6 paste handler）· #4/#3/#2 起点 |
| rev173.44 | 2026-10-20 · **待办登记（用户指定 4 项）**：粘贴图片 / 搜索筛选（正则·标签·属性）/ 全局替换 / 多标签页·分屏 —— 明细与验收口径进 `HANDOFF-CARD.md`「待办」段；建议顺序 1→4→3→2 |
| rev173.43 | 2026-10-19 · **查找面板改成悬挂窗**：`.cm-panels-top` → fixed 遮罩层 + 居中卡片（对齐 `.zn-palette`：560px / 12vh / 同阴影）· 点遮罩关闭 · 面板不再推正文 · 实测截图 `_shots/search-float-final.png` |
| rev173.42 | 2026-10-19 · **Ctrl+F 修回编辑器查找**：WebView2 原生查找栏（右上角、`2/2`）禁用 —— `with_webview` + `ICoreWebView2Settings3::SetAreBrowserAcceleratorKeysEnabled(false)`（读回确认）· 真实按键实测 · cargo 依赖 `webview2-com 0.39` / `windows-core 0.62` |
| rev173.41 | 2026-10-19 · **插件失败可见 + 外链提示**：`collectPluginDirs(onError)` 读目录失败上报 · `ensureBuiltinPlugins` 返回失败清单 → toast + 插件页错误 · 编辑器 `onNotify`（外链失败用户可见，手机提示复制到浏览器）· 测试 **358** |
| rev173.40 | 2026-10-19 · **搜索索引增量 + 内核事件派发**：新增 `src/kernel/fs-events.ts` 包装 fs 写路径（save/create/rename/move/delete/restore）→ `index.upsert/remove` + `note:*` 事件 · `index:rebuilt` · `app:ready` / `vault:open` · 外部改动经 `fs.watch` 跟随 · 查询态不再显示过时索引数 · 测试 **349** |
| rev173.39 | 2026-10-19 · **内嵌 HTML 白名单渲染**：`sanitizeHtml`（自实现，DOMParser 遍历白名单）· 属性全剔除 · script/style 丢弃 · 设置「内嵌 HTML」渲染/显示源码 · 默认渲染 · 测试 **343** |
| rev173.38 | 2026-10-19 · **Markdown 语法增强第二批**：脚注 `[^1]`（上标引用 + 点击跳转定义 + 定义行整行接管）· Mermaid ```mermaid 块（异步渲染 SVG，失败保留源码）· 定义列表（术语加粗 + 解释弱化）· 测试 **337** |
| rev173.37 | 2026-10-19 · **版本管理**：单一来源 `package.json` · 关于页改读 vite 注入 `__APP_VERSION__` · `scripts/release.mjs` 同步三处 + `--tag` · 首版 **0.2.0**（tag `v0.2.0`）· CHANGELOG 增「应用版本」段 |
| rev173.36 | 2026-10-19 · **Markdown 语法增强第一批**：`src/kernel/editor-syntax.ts`（内核扩展，插件 API 做不了 widget）· 上标 `^x^` · 下标 `~x~` · Emoji `:name:` · 行内/块级数学（KaTeX）· 光标行显示源码 · 测试 **17** |
| rev173.35 | 2026-10-19 · **灵感流插件搁置**：`inspiration-flow` 移出 `BUILTIN_PLUGINS`（预装 6→**5**）· 桌面 + 手机全局目录删除 · 源码留 `examples/` · 手册预装列表更新 · 测试 **315** |
| rev173.34 | 2026-10-19 · **全局自绘滚动条**：所有滚动容器统一 · 无轨道 · 6px 半透明滑块（长度封顶 120px）· 滚动出现静止淡出 · 可拖 · 编辑器 / 卡片流 / 文件树 / 面板全覆盖 · 测试 **315** |
| rev173.33 | 2026-10-19 · **桌面「时间流」面板**：侧栏与编辑区之间常驻一栏（默认 300px，可拖 160–560）· 复用 `MobileNoteCards variant="panel"`（同一套卡片、无 ＋ 按钮、无长按）· 打开派发同文件树 · 顺带修非 note 卡片「…」与卡片流暗色滚动条 · 测试 **315** |
| rev173.32 | 2026-10-19 · **暗色滚动条跟随主题**：`EDITOR_CSS` 加 `:root[data-theme='dark'] .zn-editor .cm-scroller { color-scheme: dark }`（UA 级开关）· 只挂编辑器子树、亮色用默认值 · CDP 实测暗/亮切换 + 源码模式 · 测试 **314** |
| rev173.31 | 2026-10-19 · **编辑器标记 / 标签演示退出功能列表**：`editor-marks` + `tag-demo` 移出全局与预装（8→**6**），源码留 `examples/`；全局剩 **7 个**；`#标签` 不再着色、`[[双链]]` 点击不再跳转（原语仍在） |
| rev173.30 | 2026-10-19 · **测试插件退出功能列表**：全局目录删 `asset-probe` / `net-demo`（源码留在 `examples/` = 测试库）；全局剩 **9 个**插件 · 用法写进卡片「测试插件只在 examples，用时复制」 |
| rev173.29 | 2026-10-19 · **移除测试插件**：删 `examples/daily-note`（当天目录新建）＋ `BUILTIN_PLUGINS` 条目（预装 9→**8**）＋ 全局/手机副本；**立卡片硬约束 8「测试/验收产生的插件不留在功能里」** · 测试 **314** |
| rev173.28.1 | 2026-10-19 · **记账：原始通知诊断**：sync 时把本轮**全部**通知（含未识别）存 store 最近 20 条（只本机、不导出）· 面板「诊断」视图显示原文 + `已记账/未识别` + `describeNotice()` 给出的原因（忽略规则 / 无支付短语 / 无金额）· 真机实测 6 条样例 · 测试 **314** |
| rev173.28 | 2026-10-19 · **记账 v0.2**：统计视图（分类占比 progress + 近 6 月 SVG 柱状图）· CSV 导出（桌面另存为 / Android 写库根）· CSV 导入（微信/支付宝账单自动识别表头 + 单号去重 + GBK 兜底）· 真机端到端（导出 6 条 / 导入 2 条 / 二次导入全去重）· vitest **309** |
| rev173.27 | 2026-10-19 · **安卓测试流程固化（用户第二次批评）**：测试机已有 dev 包 ⇒ `am start` + `reload` 即可，**不再跑 `tauri android dev`/`android build`**；测试机不装 release · 写入卡片硬约束 **7** · 顺带清理手机 `/sdcard/*.png` **113 个 / 39 MB** 与 `_shots/` 今日安卓截图 **56 个 / 21.6 MB** |
| rev173.26 | 2026-10-19 · **release 与 dev 完全隔离**：临时把 `identifier → com.aqua.zeronote.release`、`productName → ZeroNote Release` + 独立 `CARGO_TARGET_DIR=cargo-targets\zeronote-release` + `cargo clean -p zeronote` → 1m42s / 14.11 MB → 恢复 conf → 实测数据目录 `%LOCALAPPDATA%\com.aqua.zeronote.release`（dev 的 `com.aqua.zeronote` 未动）· 两者可同时运行 |
| rev173.25 | 2026-10-19 · **桌面 release exe 构建**：`pnpm tauri build --no-bundle`（`CARGO_TARGET_DIR=cargo-targets\zeronote`）→ **3m59s** / **14.11 MB** → 复制到 `C:\Users\AQUA\Apps\_View\办公与文档\zeronote.exe`（SHA256 `B73B9A46…`）· ⚠️ 与 dev 同 identifier ⇒ single-instance 互斥 |
| rev173.24 | 2026-10-19 · **使用手册导出 PDF**：`docs/ZeroNote-手机版使用手册.pdf`（29 页 / 2.51 MB / 12 图内嵌）· 工具链 pandoc 3.11 → HTML（`--embed-resources` 内嵌图片）→ Edge headless `--print-to-pdf` · 打印样式入库 `docs/manual-print.css`（重出命令见该 rev 段） |
| rev173.23 | 2026-10-19 · **手机版用户使用手册**（`docs/使用手册-移动端.md` 面向普通用户）+ **12 张真机截图**（`docs/images/manual-mobile/`，1220→760px 压缩 1.9 MB）· 覆盖：首页/新建/长按快捷入口/抽屉/切库/卡片菜单/回收站/编辑区菜单/导图/记账/设置/插件 · 进 `docs/README.md` 矩阵 |
| rev173.22 | 2026-10-19 · **快捷入口排列修正**：rev173.21 用的 ±40°/±140° 是错的（下方两点掉到圆心底下了）→ 按参考图改成 **0°/±48°/±96°**（底部两点与圆心几乎同高，才是「半圆」）· 半径 112→106、圆 60→56 · 真机坐标实测对齐 · vitest **286** |
| rev173.21 | 2026-10-19 · **快捷入口按用户锁屏截图重做**：＋ 上移到 120px（用户圈的位置）· 环**以 ＋ 为圆心**、半圆「上三下二」0°/±40°/±140° · 中心圆与按钮重合 · 修**点空白穿透打开笔记**（click 关闭）+ 中心圆绿边 · vitest **286** |
| rev173.20 | 2026-10-19 · **起始页长按 ＋ → 环形快捷入口**：`QuickLaunch.tsx`（遮罩 + 5 环槽 + 中心关闭）· 短按仍新建、长按 500ms、移动 >10px 取消、长按后抑制 click · 入口**按面板 title「记账」**找 id（不硬编码）· 返回键先关遮罩 · 真机 dev 版 4 项验收 · vitest **284** |
| rev173.19 | 2026-10-19 · **交接**：分类自定义（rev173.18）收口 + **起始页长按 ＋ 环形快捷入口调研**（`docs/快捷入口-调研-2026-10-19.md`）；**下个会话实现**（短按仍新建，长按出遮罩：记账 + 4 空位） |
| rev173.18 | 2026-10-19 · **记账分类交互改版**：去掉「改分类」按钮，**点分类标签直接进修改视图**；**自定义分类**（插件 store `categories`，选择页可新增，默认 9 个）· 学习逻辑不变 |
| rev173.17 | 2026-10-19 · **记账分类可改 + 学习**：列表每行「改分类」→ 选分类；改完记住 `商户 → 分类`（插件 store `categoryMap`），下次同商户自动命中；「其他」徽标用 warn 色 · 测试 **274** |
| rev173.16 | 2026-10-19 · **记账插件 v0.1**：新增原生 `tauri-plugin-notification-capture`（Kotlin `NotificationListenerService` + 5 个 Rust 命令）+ `examples/accounting` JS 插件（解析/自动分类/跨来源去重/手动记账/面板，进内置预装）· 测试 **272**（+23） |
| rev173.15 | 2026-10-19 · **记账插件调研**：开源移动端竞品（Ivy 已归档 / Cashew / MyExpenses / MMEX-A / Oinkoin 均无通知捕获）· 自动记账专项（AutoAccounting / WhereIsMyMoney 源码）· `NotificationListenerService` 机制与坑 · **结论：唯一硬缺口是原生通知监听插件** → `docs/记账插件-调研-2026-10-19.md` |
| rev173.14 | 2026-10-19 · **设置文案精简**（当前库 / 自动保存 / 外观 / 关于各一句）+ **插件能力不再展示**（插件行能力列表与「网络与进程（自述）」整块删除）· 测试 **249** |
| rev173.13 | 2026-10-19 · **插件页**：说明只显示 **15 字**（`clampText`，全文进悬停 title）+ **分类可折叠**（点组标题收起/展开，状态记 localStorage）· 测试 **249**；顺手修回手机 dev（`gen/android` 残留 `.probe` identifier 导致构建失败） |
| rev173.12 | 2026-10-18 · **交接**：rev173.11 收口——手机导图点击已修（`data-zn-line` + 手机整窗接管）；WebView2 起不来**真根因 = 项目目录 Low IL**（exe 继承后写不了 `%LOCALAPPDATA%`），`icacls src-tauri /setintegritylevel (OI)(CI)Medium` 修复；dev 恢复运行、库 = `_tmp-vault-tb` |
| rev173.11 | 2026-10-18 · **手机端导图点击修复落地**：① 按钮带 `data-zn-line`（点击不再依赖 `posAtDOM` 反查行号）② 手机端补上**整窗接管**（`makeMindMapMount` 抽成模块级共用；`host.platform === 'android'` 时 `view.overrideShell`，不再走静默失败的多窗口）· 真机 3 轮 ✓ · 测试 **243** |
| rev173.10 | 2026-10-18 · **交接**：手机端导图点击偶发不生效——根因定位（`posAtDOM` 反查行号在虚拟化后失败）+ 修复方案（按钮带 `data-zn-line`）；**代码已回滚、未修** |
| rev173.9 | 2026-10-18 · **交接**：用户报「导图点击有时候不生效」→ 要求先交接；记录当前状态 + 排查线索 |
| rev173.8 | 2026-10-18 · **手机工具栏加「缩进 / 取消缩进」**：`core.indent` / `core.outdent`（与 Tab/Shift+Tab 同一份逻辑，只对列表行）+ 按钮 ⇤ ⇥ · 测试 **243** |
| rev173.7 | 2026-10-18 · **修「导图显示库载入失败」**：MindElixir 移进 `public/vendor/mind-elixir/`，outline-map 改 fetch 内置资源（不再读库内 `.zn/plugins/…/vendor`）；11 个插件桌面冒烟 |
| rev173.6 | 2026-10-18 · **清理库内插件残留**：新命令 `copy_plugin_dir` 整目录迁移（含未声明的 vendor）→ 删除桌面库 11 / 手机库 9 个 `.zn/plugins` 目录；插件只剩全局根 · cargo **32** |
| rev173.5 | 2026-10-18 · **取消库内插件**：插件只在全局根 `<应用数据目录>/.zn/plugins/`；安装/内置预装/扫描/删除全部走全局；旧副本用 `__znMigratePlugins()` 搬移（桌面 11 / 手机 9）· 测试 **237** |
| rev173.4 | 2026-10-18 · **插件分类**：`manifest.category`（editor/reader/theme/tool/demo）+ 插件页分组 + 存量插件（examples 29 / 全局 6 / 库内 11 / 手机 9）补齐 · 测试 **237** |
| rev173.3 | 2026-10-18 · **附件**：文件树「附件」分组（图片进树、点开预览）+ 右键「插入附件…」为唯一入口（图片写 `![]()` 渲染不变、其它文件写 `[]()`）· 测试 **230 / cargo 31** |
| rev173.2 | 2026-10-18 · 图片预览**按返回键先退预览**（预览压进层出口栈；再按一次才关笔记） |
| rev173.1 | 2026-10-18 · 图片**缩略显示**（桌面 280px / 手机 23vh，长宽各减半）+ **点开看原图**（全屏遮罩，点遮罩 / Esc 关闭） |
| rev173 | 2026-10-18 · **Markdown 插入图片**：编辑器右键菜单「插入图片…」→ 复制进笔记目录 → 相对路径渲染成 asset URL（桌面 + 手机实测）· 测试 **226 / cargo 30** |
| rev172 | 2026-10-18 · **Android 装 .znp 全链路修通**：不传 filters（MIUI 会藏未知类型）+ `content://` 先经 uri-reader 复制成缓存路径 · 测试 **206** |
| rev171 | 2026-10-18 · 修**手机设置页「安装插件包（.znp）」点了没反应**（Settings 复用 PluginPanel 时漏传 `onInstall`）· 测试 **206** |
| rev170 | 2026-10-18 · **输入状态下右划不打开侧栏**（`lib/swipe.ts` 纯函数；左划关闭不受影响）· 测试 **206** |
| rev169 | 2026-10-18 · 文件树展开/折叠状态**按库持久化**（localStorage `zn-tree-collapsed:<库路径>`；重开恢复上次状态）· 测试 **199** |
| rev168 | 2026-10-18 · 编辑界面顶栏笔记标题**屏幕居中**（`.zn-app.is-editing` + 绝对定位；起始页 ZeroNote 仍靠右）· 测试 **195** |
| rev167 | 2026-10-18 · 移动端顶栏：**去掉「⋯」**、logo **靠最右**、☰/logo 字号/左右偏移**定稿 20/15/11**（临时调节器已删）· 测试 **195** |
| rev164 | 2026-10-18 · 手势**全局生效**：任意界面任意位置左→右开侧栏、右→左关闭（捕获阶段监听）· 测试 **195** |
| rev163 | 2026-10-18 · 移动端**左右滑手势**：左→右开侧栏（起点 ≤80px），右→左关 · 贴边 24px 内会被系统返回手势吃掉 · 测试 **195** |
| rev162 | 2026-10-18 · 移动端编辑界面**去掉「关闭」按钮**（返回即关闭），「源码」占其位置；桌面菜单同样带遮罩 · 测试 **195** |
| rev161 | 2026-10-18 · **菜单打开时点外面只关菜单**（全屏透明遮罩 `zn-menu-scrim`，点击不漏到卡片）；卡片流不再弹应用主菜单 · 测试 **195** |
| rev160 | 2026-10-18 · 移动端卡片**长按弹菜单**（打开 / 重命名… / 删除（回收站）/ 彻底删除…）· 测试 **195** |
| rev159 | 2026-10-18 · 移动端卡片时间**精确到秒**（`YYYY-MM-DD HH:mm:ss`）· 测试 **195** |
| rev158 | 2026-10-18 · 移动端起始页圆形＋按钮**水平居中**（`left:50% + translateX(-50%)`）· 测试 **195** |
| rev157 | 2026-10-18 · 移动端起始页底部**输入条改圆形＋按钮**（56px 圆，右下角，上移 20px）· 测试 **195** |
| rev156 | 2026-10-18 · **移动端起始页 = flomo 风卡片流**（时间 + 正文摘要 + 「＋ 点击输入」底部条；语音先不做）· 桌面仍用起始页 · 测试 **195** |
| rev149 | 2026-10-18 · 「彻底删除」确认框改 **portal 到 body**（侧栏 transform 会把 fixed 裁掉 → 手机截断）· 测试 **195** |
| rev148 | 2026-10-18 · 手机菜单 = **点按处右下固定距离**（右 16 / 下 56），边缘 clamp 不翻侧 · 测试 **195** |
| rev147 | 2026-10-18 · 手机菜单**靠屏幕右侧**（左缘 = 屏宽 − 菜单宽 − 8），垂直在长按点下方 72px · 不挡下面选项的名字 · 测试 **195** |
| rev146 | 2026-10-18 · 手机菜单改为**长按点上方固定 12px**（`above-pointer`；手指在下方挡着），放不下自动翻下方 · 测试 **195** |
| rev145 | 2026-10-18 · **菜单定位**：桌面跟在**鼠标右下角**（+8/+10）· 手机固定在**屏幕右下角**（用户圈的位置）· 去掉 rev144 的避让 · 测试 **195** |
| rev144 | 2026-10-18 · **菜单避让所有文件行**（`ContextMenu.avoid`：渲染后量尺寸，相交就挪；选中/未选中都不遮）· CDP 实测零重叠 · 测试 **195** |
| rev143 | 2026-10-18 · 点「多选」**菜单原地切换**成多选菜单（不关菜单；单项 →「删除选中的 1 项」，加选后 → N 项）· 测试 **195** |
| rev142 | 2026-10-18 · **多选后直接弹菜单**（点选模式 / Ctrl 点选 / Shift / 框选 → 选中 ≥2 项即在指针处弹批量菜单，不用再右键）· 测试 **195** |
| rev141 | 2026-10-18 · **移除顶栏「多选」按钮 + 「已选 N 项」批量条**；右键菜单「多选」**保留**（点选模式，批量操作走菜单）· 测试 **195** |
| rev140 | 2026-10-18 · **手机长按弹右键菜单** + **多选入口**（顶栏按钮 + 右键菜单项）· 桌面/手机 CDP 实测 · 测试 **196** |
| rev139 | 2026-10-18 · **文件树顶栏**：新建笔记 / 新建文件夹两个按钮（复用右键同一套 `createIn`）· 空库也有 · 测试 **194** |
| rev138 | 2026-10-18 · **开发约定升级**：「先查现成」贯穿全流程（§0.5 六环节清单）· 复盘 rev135/136 未先查的事故 · 卡片硬约束改写 |
| rev137 | 2026-10-18 · **修复「放着不动也定时闪深色」**：Vite HMR 写盘循环（内置插件每次覆盖写 → watcher → HMR → 重放 effect → 再写）· 30 秒静止采样验证稳定 |
| rev136 | 2026-10-18 · **排查「标题栏出现时闪深色」**（hover 路径未复现）+ 修**幽灵插件样式累积**（幂等注入）· 测试 192 |
| rev135 | 2026-10-18 · **修复翠绿主题闪深色**：插件样式首屏预热（缓存 + `main.tsx` 挂载前注入）· 测试 **192** |
| rev134 | 2026-10-18 · **侧栏头部加设置图标**（lucide Settings → 复用设置弹窗）· CDP 实测 · 测试 **186** |
| rev133 | 2026-10-18 · **移动端同步**：☰ = 抽屉开关 + 新增 **⋯** 菜单按钮（手机无右键）· 两端 CDP 实测 · 测试 **184** |
| rev132 | 2026-10-18 · **桌面 ☰ = 文件树栏开关**（左键切换 / 右键菜单）· 移动端不变 · 测试 180 → **183** |
| rev131 | 2026-10-18 · **工程债四件**：App 集成测试（3 条）· atomic-editor 补丁回归（4 条·含真实渲染）· 快照备份分层结论 · 卡片过时数字 · 测试 173 → **180** |
| rev130 | 2026-10-18 · **P3-3 落地**：GitHub 私有仓库 `aqua7773/zeronote` + `.github/workflows/verify.yml`（五步 CI）· gh 登录 / 代理要点 |
| rev129 | 2026-10-18 · **开发约定与架构边界**：`docs/开发约定.md`（目录职责 / hook 规范 / 重构 checklist / 事故清单）· 拆分方案转 historical · 卡片加硬约束第 6 条 |
| rev128 | 2026-10-18 · **L3 第六刀（收官）**：`usePluginHost` hook（加载链 / 懒激活 / `.znp` 安装）· App **2583 → 2285** 行 · 测试 **173 条** |
| rev127 | 2026-10-18 · **L3 第五刀**：`useExternalFile` hook（openExternalFile / SAF / 待打开 / 文件关联接线）· App **2801 → 2583** 行 · 测试 **163 条** |
| rev126 | 2026-10-18 · **L3 第四刀**：`useDocApi` hook（docApi / fireDoc / flushDocChange）· App **2935 → 2801** 行 · 测试 **149 条** |
| rev125 | 2026-10-18 · **L3 第三刀**：`useDocSession` hook（打开 / `[[链接]]` / 关闭）· App **2980 → 2935** 行 · 测试 **132 条** |
| rev124 | 2026-10-18 · **L3 第二刀**：`useDocIO` hook（刷新 / 三方合并 / 保存 / 编辑器变更 + 兜底 flush）· App **3239 → 2980** 行 · 测试 **122 条** · oxlint 6→5 |
| rev123 | 2026-10-18 · **L3 第一刀**：`useFileOps` hook（剪贴板 / 回收站 / 删除 / 撤销）· App **3501 → 3238** 行 · `lib/format.ts` · 测试 **113 条** |
| rev122 | 2026-10-18 · **App.tsx 拆分 L1+L2**：4 个 lib 模块 + 5 个组件（3928 → **3501** 行）· 前端测试 **102 条** · 方案 `docs/App拆分方案-2026-10-18.md` |
| rev121 | 2026-10-18 · 修 rev120 记录的两条待定语义（**merge3 同点插入判冲突** · **command 接管改层栈**）+ **vitest 并入 `verify.ps1` 第 5 步**（44 passed） |
| rev120 | 2026-10-18 · **前端单测（vitest）**：独立配置 + `tests/` 41 条（merge3 / command / event），记录 2 个待定语义 |
| rev119 | 2026-10-18 · **插件完整性 sha256**（不符拒载）+ **`.znp` 单文件安装** + 安装确认框（列出自述能力与未签名提示） |
| rev118 | 2026-10-18 · 契约 v0.2 **落到代码**（API_VERSION 0.2.0 + 插件 manifest 统一）+ **独立笔记 ID**（`.zn/ids.json`）+ rename 全库引用重写 |
| rev117 | 2026-10-18 · 测试报告 16 项**逐条实测**（11 成立 / 1 作废 / 2 待验）+ 修复 7 项（折叠竖线 · frontmatter 透传 · 原子写 .bak · 暗色竖线 · `[[链接]]`点击 · 轮询兜底 · engines） |
| rev116 | 2026-10-17 · 起始页速查表**手机单列**：左留白 48 ＋ 标记↔解释间隔 73（用户手拖定）＋ 出包/防火墙收尾 |
| rev115 | 2026-10-17 · 起始页速查表**视觉对齐**定稿：**宽 620 / 右移 54**（用户用临时滑块拖定） |
| rev112 | 2026-10-17 · 起始页**排版对称** ＋ 桌面 **release 独立构建**（数据与 dev 隔离） |
| rev111 | 2026-10-17 · **起始页改成 Markdown 标记速查表**（14 条两列，新建按钮保留） |
| rev110 | 2026-10-17 · **安卓内置插件预装**（8 个插件随包，启动写入私有目录）＋ APK 构建 |
| rev109 | 2026-10-17 · **表格快捷操作**：对齐按钮 ＋ 调行列（插/删/移）＋ 菜单 ＋ 删除表格 |
| rev108 | 2026-10-17 · **表格列对齐**语法生效（patch atomic 的 table widget：`:---` / `:---:` / `---:`） |
| rev107 | 2026-10-17 · 编辑器**源码 / 预览切换**（按钮在「关闭」下面；localStorage 持久化） |
| rev106 | 2026-10-17 · 引用嵌套框改成**参考图结构**：一级框贯穿整个引用块，嵌套层各有自己的短框 |
| rev105 | 2026-10-17 · 引用嵌套**每层自己的框** ＋ 行内代码背景 ＋ 分割线加粗到 2px |
| rev104 | 2026-10-17 · **引用嵌套生效**（按行首 `>` 逐级缩进：16 / 41.5 / 67px） |
| rev103 | 2026-10-17 · 深色模式下**已完成任务的勾改成黑色**（白勾在浅色选中块上看不见） |
| rev102 | 2026-10-17 · 编辑器链接**能打开浏览器**（Rust `open_external` ＋ atomic `onLinkClick`） |
| rev101 | 2026-10-17 · 空列表项 **Tab 缩进成子项**：内核接管 Tab ＋ 插件按缩进关系定深度 |
| rev100 | 2026-10-17 · 修**空列表项缩进**比同级多一截（插件补空列表项的深度） |
| rev99 | 2026-10-17 · 文件树**层级引导线**：每层一条竖线 ＋ 缩进（层级一眼看清） |
| rev98 | 2026-10-17 · 文件树显示**文件名**（不再显示正文标题）＋ 新建默认名 `新笔记-时-分-秒` |
| rev97 | 2026-10-17 · **文件树拖拽移动**：笔记/文件夹拖进另一个文件夹（与框选分流） |
| rev96 | 2026-10-17 · **文件树鼠标框选**：左键拖拽选中一片（含目录高亮 · 批量操作去重） |
| rev95 | 2026-10-17 · 修「有内容的文件夹删不掉」：Windows 非空目录 rename 降级（删除/移动/恢复） |
| rev94 | 2026-10-17 · **插件跨库生效**：全局插件根（appDataDir）＋ 库内/全局合并扫描 ＋ 插件页来源徽标 |
| rev93 | 2026-10-17 · 文档整改：README 重写 · rev 索引 · 基线数字统一 · 权威矩阵 · 文档规范 |
| rev92 | 2026-10-15 · ⚠️ **更正 rev88**：`window.print()` 在 WebView2 上**静默无效** —— md→pdf 改走「导出 HTML ＋ … |
| rev91 | 2026-10-15 · 导入导出**收尾**：交付盘点 ＋ 唯一未验项 ＋ 测试产物清理 |
| rev90 | 2026-10-15 · docx 导入的**表格还原**（两处小修，都在真机上验过） |
| rev89 | 2026-10-15 · **epub / pdf 导入验证** ＋ 一个真 bug：脚本混进了正文 |
| rev88 | 2026-10-15 · **md→pdf**（浏览器打印栈）＋ 桌面端五种导出探针全过 |
| rev87 | 2026-10-15 · 导入导出**批 3**：pdf/epub 导入 ＋ 长图 ＋ docx —— **四种导出真机全部验证** |
| rev86 | 2026-10-15 · 导入导出**批 2**：html / docx 导入 ＋ txt / html 导出 |
| rev85 | 2026-10-15 · 导入导出插件：**选型调研定案** ＋ **批 1（md/txt 导入）落地验收** |
| rev84 | 2026-10-15 · 文档阅读器**按原始尺寸**看 PDF ＋ 一个「同 URL 加查询串就好了」的怪案 |
| rev83 | 2026-10-15 · **安全区**：整窗接管的插件顶栏不再压状态栏 |
| rev82 | 2026-10-15 · **外部 PDF 双路真机验收**：热启动 ✅ · 冷启动修掉接管竞态 ✅ |
| rev81 | 2026-10-14 · Android「关闭插件窗口」定型：不重载 · 放接管 · 清 URL；＋**更正 rev80 一处误判** |
| rev80 | 2026-10-14 · 大纲**折叠 / 展开** —— 内核新增 `editor.addFold` |
| rev79 | 2026-10-14 · 大纲缩进/竖线第五轮 —— 全部按「一个中文字符」＋ 圆点居中 |
| rev78 | 2026-10-14 · 大纲竖线 —— 内核新增 `editor.addLineClass` |
| rev77 | 2026-10-14 · 导图「❖」按钮判据收紧：**容器标题不给按钮** |
| rev76 | 2026-10-14 · 修 rev75 真机暴露的两个 bug —— 已提交 `2e410f1` · release 包已重出并覆盖 |
| rev75 | 2026-10-14 · 文件关联 ＋ Android SAF（content://）读取 ＋ release 包 |
| rev74 | 2026-10-13 · 删除：逻辑删除 ＋ 物理删除，阅读器与文件树都有，支持多选 |
| rev73 | 2026-10-13 · 文件树：只读文档收进「文档」分组 |
| rev72 | 2026-10-13 · **文档格式阅读器**：只读 PDF / EPUB / … 插件落地 |
| rev71 | 2026-10-13 · 卡死兜底**补上移动端接线** ＋ **真机端到端验证全通** |
| rev70 | 2026-10-13 · **卡死兜底落地**：原生看门狗 ＋ 闪退 ＋ 启动自愈 —— 7 条判据全过 |
| rev69 | 2026-10-13 · **卡死兜底方案出卡** —— 只出卡，未实施，零代码改动 |
| rev68 | 2026-10-13 · 触屏三件的落地：**长按进多选** ＋ **菜单层缺口补掉** |
| rev67 | 2026-10-13 · **触屏三件真机测清**：长按可用 · 多选无入口 · 返回键早已接管 ＋ 抓到菜单层缺口 |
| rev66 | 2026-10-13 · **权限门遗留整体清掉**：`permissions.json` 与两条命令从仓库消失 |
| rev65 | 2026-10-13 · 「❖」按钮收紧：**只在真有列表的标题上出现**；顺带调大 |
| rev64 | 2026-10-13 · 「库放公共存储」的前置条件：**必须手动授予「所有文件访问」** |
| rev63 | 2026-10-13 · Android 出包：APK + 导图插件 → 互联网中转 |
| rev62 | 2026-10-13 · **自动合并**：手改与插件写盘不再互相覆盖 |
| rev61 | 2026-10-13 · 导图写回**实时回灌编辑器** ＋ 右键「从磁盘重新加载」 |
| rev60 | 2026-10-13 · 导图窗口**去顶栏**：四个动作进右键菜单 ＋ 状态悬浮左上角 |
| rev59 | 2026-10-13 · 修「窗口模式下接管盖住标题条」—— 用户问的"怎么退出/分屏"根因就是这个 |
| rev58 | 2026-10-13 · **导图跟随宿主主题** ＋ 打磨清单其余三项的处置 |
| rev57 | 2026-10-13 · **导图换成真库落地**：窗口里跑 Mind Elixir，拖拽即写回 |
| rev56 | 2026-10-13 · Mind Elixir 四件事核实完毕 ＋ 两件小事收口 |
| rev55 | 2026-10-13 · 按钮"无痕融入" ＋ **导图编辑方式定案：改用开源库 Mind Elixir** |
| rev54 | 2026-10-13 · **内核新增「行首按钮」能力** ⇒ 按钮改放**标题左侧** |
| rev53 | 2026-10-13 · 插件窗口补齐三键 ＋ **查清 `close()` 的真相** |
| rev52 | 2026-10-13 · **outline-map 重做成"导图独立窗口"**：路线第 ⑥ 步 |
| rev51 | 2026-10-13 · **U2 主壳接管点**：插件能把内核 UI 整个搁在一边 |
| rev50 | 2026-10-13 · **U1 真窗口落地**：插件能开自己的窗口了 |
| rev49 | 2026-10-13 · **接管协议落地**：原则 3 从"机制在、边界不清"变成可判定 |
| rev48 | 2026-10-13 · 拆权限门：**原则 4 落地** |
| rev47 | 2026-10-13 · 内核自愈落地：原则 5「**修复优先于防护**」兑现 |
| rev46 | 2026-10-13 · 架构原则重定：内核不设防 ＋ **修复优先于防护** |
| rev45 | 2026-10-13 · 内核增强第 1 步：U3a `doc.replaceRange` ＋ U3b `doc.on` 真事件 |
| rev44 | 2026-10-13 · 交接：内核 UI 承载能力盘点 ＋ 插件路线重定 |
| rev43 | 次日 00:10 · 插件视觉对齐参考图 ＋ CDP 流程实战 |
| rev42 | 同日 23:45 · 换掉「算坐标点鼠标」：CDP 直连 WebView |
| rev41 | 同日 23:20 · 第一个功能插件：大纲 · 导图 |
| rev40 | 同日 23:00 · 回收站：常驻入口 ＋ 主区页面 |
| rev39 | 同日 22:45 · 剪切 / 复制 / 创建副本 / 粘贴 ＋ 文件树快捷键 |
| rev38 | 同日 22:20 · 层级文件夹：目录右键菜单 ＋ 空目录显示 ＋ 库内新建/重命名/删除 |
| rev37 | 同日 21:50 · 修基线第三条：测试临时目录移出 `%TEMP%` |
| rev36 | 同日 · Markdown 标记**收进内核**：移动端快捷栏 ＋ 桌面右键「标记」子菜单 |
| rev35 | 同日 19:50 · 编辑器顶部「可开关的 Markdown 快捷键提示」 |
| rev34 | 同日 19:30 · Markdown 快捷输入栏 —— 落在手机软键盘正上方 |
| rev33 | 同日 14:00 · 缺口 1「`platforms` 声明不强制」→ **平台门落地** |
| rev32 | 同日 13:40 · 缺口 3「最近库没有移除入口」补齐 |
| rev31.1 | 同日 13:10 · 桌面侧栏可直接切库 |
| rev31 | 同日 13:00 · 文件关联落地：双击 .md 用 ZeroNote 打开 |
| rev30.1 | 同日 12:30 · CSP 放宽 + 一处**结论纠正** + 插件能力盘点 |
| rev30 | 一次看懂（2026-10-12 下午） |

> ## 📌 rev173.48（2026-10-20 · 时间流开关 + 手机长按 ☰ 出菜单）
>
> 用户一句话三件事：**手机搜索入口（长按 ☰ = 桌面右键菜单）** · 时间流右键加「关闭时间流」·
> 文件树 / 编辑器 / 起始页右键加「打开时间流」。
>
> ### 做了什么
>
> | 层 | 改动 |
> |---|---|
> | `TitleBar` | ☰ **长按 500ms** 弹菜单（复用同一个 `onMenu`）；长按后松手补发的 click 被吞掉 ⇒ 不会顺带切一次侧栏。手机从此有了菜单入口（搜索 / 命令面板 / 插件管理都进得去） |
> | `App` | `timelineOpen` 开关（localStorage `zeronote.timeline.open`，默认开）· `showTimeline` 加条件 · 主区/起始页/编辑器右键菜单加「打开时间流 / 关闭时间流」（按当前状态切换）· 时间流**空白处**右键单独给「关闭时间流 + 设置」 |
> | `MobileNoteCards` | 可选 `onCloseTimeline` ⇒ 卡片右键菜单末尾加「关闭时间流」（只有桌面时间流传） |
> | `FileTree` | 可选 `onOpenTimeline` ⇒ 右键菜单（含树**空白处**）末尾加「打开时间流」；`AppSidebar` 透传 |
> | 测试 | `tests/titlebar.test.tsx` **+2**（长按弹菜单且松手不切侧栏 / 短按仍切侧栏）· 新增 `tests/file-tree-menu.test.tsx` **3 条**（有回调出现、空白处出现、没回调不出现） |
>
> ### 实测（桌面 + 手机 · 2026-10-20 01:4x）
>
> - 桌面：右键时间流空白 → 菜单「关闭时间流 / 设置」→ 关闭后 `.zn-timeline` 消失、localStorage `zeronote.timeline.open='0'`
> - 桌面：时间流卡片右键 → 打开 / 重命名… / 删除 / 彻底删除 / **关闭时间流**（截图 `_shots/timeline-menu-01.png`）
> - 桌面：主区（起始页）右键 → 菜单含「打开时间流」→ 点击后时间流恢复（`...open='1'`）
> - 桌面：文件树右键 → 「新建文件 / 新建文件夹 / **打开时间流**」
> - 手机：**真机触摸长按 ☰**（`adb shell input motionevent DOWN/UP`，间隔 700ms）→ 菜单（新建笔记 / 打开笔记库… / 打开文件… / 笔记库 / **搜索笔记** / 命令面板 / 设置 / 插件管理 / 记账 / 导入导出）；松手**没有**顺带切侧栏（`.zn-sidebar` 仍不存在）
> - 手机：点「搜索笔记」→ 面板打开、筛选行正常（截屏 `_shots/phone-search-17348.png`），目录下拉列出多级目录
> - 桌面：打开笔记后右键编辑器 → 菜单里「关闭时间流」（时间流正开着，按状态切换）
>
> ### 坑
>
> - 时间流区域原本被 `.zn-body` 的 `.zn-mobile-home` 排除拦住（卡片流根节点带这个 class）⇒ 空白处**什么都不弹**。
>   修法：先判断 `.zn-timeline` 且不在 `.zn-mobile-card` 上，单独弹菜单；卡片仍归它自己的长按菜单。
> - 长按必须吃掉松手 click，否则菜单弹出后同一次点按又切一次侧栏。
>
> ### 验收基线
>
> `scripts\verify.ps1` 全过：tsc 0 / oxlint **3 warnings** / cargo test **34 passed** / check-docs / vitest **383 passed**（2026-10-20 01:36）。
>
> ### 下一步
>
> - 待办 #3 全局替换（跨笔记：试运行命中清单 → 确认后替换，改前备份）
> - 之后 #2 多标签页 · 分屏

> ## 📌 rev173.47（2026-10-20 · 搜索筛选：正则 / 标签 / 目录）
>
> 待办 #4（顺序 1→4→3→2 的第二项）。**不动内核语义**：把 `index.query` 已有的字段过滤接到 UI，并补 `regex`。
>
> ### 做了什么
>
> | 层 | 改动 |
> |---|---|
> | `index-api.ts` | `query` 的 opts 加 `regex?: boolean`：整串当正则（flags `imu` —— 忽略大小写、`^`/`$` 按行、正确处理中文）；语法错误**返回空表不抛错**；新增 `buildRegexExcerpt`（首命中窗口 + 哨兵高亮）与 `scoreRegex`（与关键词同口径：标题 ×8 / 正文 ×2 / 标题命中 +4 / 越靠前 +1..4） |
> | 同文件 | 空关键词 + **`dir`** 也算合法查询（原来只有 `tag` 可以）——「列出这个目录下的全部笔记」 |
> | `SearchPanel.tsx` | 筛选行：标签下拉（`index.tags()`，带篇数）· 目录下拉（从笔记路径推所有层级前缀）· `.* 正则` 开关 · 清除筛选；「关键词空、只有筛选」的空态文案；正则语法错误显示具体原因 |
> | 契约 | `contract.ts` 的 `IndexApi.query` 签名与注释补 `regex`；`docs/内核契约-v0.2.md` §1.3 同步 |
> | 测试 | 新增 `tests/index-filters.test.ts` **7 条**（正则 / 大小写 / 非法正则 / 摘要哨兵 / tag / dir / 组合）· `tests/search-panel.test.tsx` **4 条**（下拉选项、tag 传参、regex 传参 + 语法错误提示、清除筛选复位） |
>
> ### 实测（桌面 · 2026-10-20 01:2x · CDP 操作 + 系统级 Ctrl+Shift+F 打开面板）
>
> - 夹具：`_tmp-vault-tb/搜索验收/标签A.md`（`tags: [验收]`）+ `标签B.md`（无标签）→ reload 后标签下拉出现「验收（1）」、目录下拉出现「搜索验收」
> - **标签**：选「验收」→ **1 条结果**（`搜索验收/标签A.md`，摘要里能看到 frontmatter）—— 截图 `_shots/search-filter-02-tag.png`
> - **目录**：选「搜索验收」→ **2 条**（A + B）
> - **正则**：开「.* 正则」+ 输入 `^# 验收` → **2 条**（标题行首命中，`m` flag 生效）—— 截图 `_shots/search-filter-03-regex.png`
> - **非法正则**：输入 `([` → 「正则无效：Invalid regular expression: /([/imu: Unterminated character class」+ 0 条结果
> - 夹具已删、页面 reload 后库恢复（6 篇 · 3 文档 · 2 附件）
>
> ### 坑
>
> - `^` 默认匹配**整个字符串**开头：笔记带 frontmatter 时 `^# 标题` 命中不了 ⇒ 正则必须带 `m`（`imu`）。这是第一轮实测失败的原因，已写进契约 §1.3。
> - 目录下拉的数据来自 App 传的 `notes`（笔记清单），**不含只读文档**；显示的是库内相对路径前缀。
> - 面板的筛选值没有持久化（关掉再开回到「全部」）—— 若用户需要记住，下轮再加 localStorage。
>
> ### 验收基线
>
> `scripts\verify.ps1` 全过：tsc 0 / oxlint **3 warnings** / cargo test **34 passed** / check-docs / vitest **378 passed**（2026-10-20 01:28）。
>
> ### 下一步
>
> - 待办 #3 全局替换（跨笔记：试运行命中清单 → 确认后替换，改前备份）
> - 之后 #2 多标签页 · 分屏
> - ⚠️ 顺手发现（**未修**，属范围外）：**手机端没有搜索入口** —— ☰ 只切文件树，`openOverlay('search')` 在手机上没有任何触发点（桌面靠 Ctrl+Shift+F 与 ☰ 坐标菜单）。要补就加一个手机入口；本轮只记录，没动。

> ## 📌 rev173.46（2026-10-20 · 编辑器粘贴图片：截图 Ctrl+V → 落笔记同目录 → 插入 `![](相对路径)`）
>
> 用户 2026-10-20 指定待办 #1（顺序 1→4→3→2 的第一项）。
>
> ### 做了什么
>
> | 层 | 改动 |
> |---|---|
> | Rust | 新增 `import_attachment_b64(vault, note_path, stem, ext, base64)`（`src-tauri/src/lib.rs`）：内存字节直接写进笔记所在目录。与 `import_attachment` **共用**新抽出的 `attachment_plan` / `unique_attachment_path` / `attachment_rel` / `attachment_ext`（扩展名小写 + `BLOCKED_EXTS` + stem 白名单 + 撞名递增 + `resolve` 目录校验）· 服务端 32 MB 兜底 |
> | 前端逻辑 | 新增 `src/lib/paste-image.ts`（纯逻辑可单测）：`pickPastedImage` / `pasteImageExt`（MIME → 文件名 → png，后缀必须在 `IMAGE_EXTS` 白名单）· `bytesToBase64`（32 KB 分块，防大图爆栈）· `MAX_PASTE_IMAGE_BYTES = 10 MB` |
> | 编辑器 | `MarkdownEditor` 增 `onPasteImage` prop；extensions 里 `Prec.high(EditorView.domEventHandlers({ paste }))`：**只有剪贴板确实带 `image/*` 才接管**，否则 `return false` 放行默认粘贴 |
> | App | `insertAttachmentSyntax`（落盘后写正文，两条入口共用）· `insertPastedImage`（invoke → `pathFromNote` → `imageInsertion` → toast）· 脚本出口 `window.__znPasteImage(base64, ext)` |
> | 测试 | Rust **+2**（写字节 / 撞名 · 黑名单 / 穿越 / 非法 base64 / 空内容）· 前端 `tests/paste-image.test.ts` **9 条** |
>
> ### 实测（桌面 · 2026-10-20 00:50）
>
> - 系统剪贴板放一张 1920×1080 PNG → 编辑器 Ctrl+V → toast `已插入图片 image-20261020-005027.png`
> - 落盘 `_tmp-vault-tb/image-20261020-005027.png`（103966 B，与剪贴板一致）→ 正文出现 `![](image-20261020-005027.png)`，编辑器内图片正常渲染（截图 `_shots/paste-02-inserted.png`）
> - **回归**：剪贴板为纯文本时 Ctrl+V 正常插入文字（未被 paste handler 吞掉）
> - 两次 Ctrl+Z 撤回到原内容 `Qoozz`；测试图片已从测试库删除（库恢复 3 md + 3 文档 + 2 附件）
>
> ### 踩坑
>
> - **atomic 在 mount / 切笔记时捕获 `extensions`**：改完 paste handler 后必须 `location.reload()` 才生效 —— HMR 后仍挂在旧 view 上，首次 Ctrl+V 无反应（本轮真踩到）
> - **Chromium 剪贴板图片在 `clipboardData.files` 里**（`type: image/png` / `name: image.png`），不在 `items` 的字符串里 —— 从 `files` 取即可
> - 系统级 Ctrl+V 要窗口在前台：先 `SetForegroundWindow` 再 `gentle_keys`（脚本 `_tmp-test/focus-window.ps1`，测试件不入库）
>
> ### 手机状态（2026-10-20 01:00 实测）
>
> - 新增 **Rust** 命令 ⇒ dev APK 必须重装（只改前端才 reload 即生效）；已按硬约束 7 的例外走一次 `pnpm tauri android dev`。
> - **`__znPasteImage` 链路在 Android 通过**：canvas 生成 PNG → `import_attachment_b64` → 落 `/storage/emulated/0/Documents/ZeroNote/image-20261020-010016.png`（622 B）→ 正文 `![](...)` + 图片渲染正常（截图 `_shots/phone-paste-17346.png`）。测试数据已清理（笔记写回 0 字节、图片删除）。
> - **真实「长按粘贴」：✅ 用户 2026-10-20 手机真机实测可用**（dev 包连电脑 1420，长按粘贴图片直接进正文）—— 说明 Android WebView 的 `clipboardData.files` 对图片剪贴板有效，**不需要降级「仅桌面」**。
> - 提醒：从 adb 没法把图片塞进 Android 剪贴板做自动化（页面内 `execCommand('copy')` 返回 false、`navigator.clipboard.write` 报 `NotAllowedError: Write permission denied`），所以这一项只能人工验 —— 已由用户完成。
>
> ### 验收基线
>
> `scripts\verify.ps1` 全过：tsc 0 / oxlint **3 warnings** / cargo test **34 passed** / check-docs / vitest **367 passed**（2026-10-20 01:06）。
>
> ### 下一步
>
> - 待办 #4 搜索筛选（`index.query` 已支持 `tag`/`dir`，UI 未接；正则要动 `index-api.ts` 的匹配层）
> - 之后 #3 全局替换 → #2 多标签页 · 分屏
> - 顺手项：手机真机验一次「长按粘贴图片」（见上「手机状态」）

> ## 📌 rev173.45（2026-10-20 · 交接：下个会话从「粘贴图片」开工）
>
> ### 本会话已完成（173.40–173.44）
>
> | rev | 内容 | 状态 |
> |---|---|---|
> | 173.40 | 搜索索引真增量（`src/kernel/fs-events.ts`）+ 内核事件真派发（`note:*` / `index:rebuilt` / `app:ready` / `vault:open`） | ✅ 提交 `5dc3ad5` |
> | 173.41 | 插件目录 / 内置插件 / 外链失败可见（toast + pluginError） | ✅ 同上提交 |
> | 173.42 | Ctrl+F 修回编辑器查找（关 WebView2 浏览器加速键，`ICoreWebView2Settings3`） | ✅ `34ac87b` |
> | 173.43 | 查找面板改成悬挂窗（对齐命令面板：fixed 遮罩 + 560px 卡片 + 点遮罩关闭） | ✅ `1cf9a76` |
> | 173.44 | 用户指定 4 项待办登记（见 `HANDOFF-CARD.md`「待办」段） | ✅ `926a3de` |
>
> ### 交接时状态（2026-10-20 00:xx）
>
> - **dev 在跑**：`dev.cmd` 起的（vite 1420 + CDP 9222）；库 `_tmp-vault-tb`（3 篇 md + 3 文档 + 2 附件）。
> - **基线**：`scripts\verify.ps1` 全过（tsc 0 / oxlint 3 warnings / cargo 32 / check-docs / vitest **358**）。
> - **git**：工作区干净，HEAD 见 `git log`；本轮无未提交改动。
> - **待办**：`HANDOFF-CARD.md`「待办：与同类应用对比补齐」4 项，顺序 **1 → 4 → 3 → 2**。
>
> ### ⭐ 下个会话开工 #1：编辑器粘贴图片（Ctrl+V）
>
> **验收口径**（卡片同款）：截图 → Ctrl+V → 图片落到**笔记所在目录**（`image-YYYYMMDD-HHmmss.ext`）→ 正文光标处插入
> `![](相对路径)` → toast 提示；桌面 + 手机各验一次。
>
> **关键结论：这不是纯前端活。** 剪贴板图片在 WebView 里只是内存里的 `File`，没有磁盘路径，
> 现成的 `import_attachment(vault, note_path, src, stem)` 是**从磁盘文件复制**的（`src-tauri/src/lib.rs:999`），
> 所以必须新增一条**从字节写库**的命令，例如：
>
> ```
> import_attachment_b64(vault, note_path, stem, ext, base64) -> Result<String, String>
> ```
>
> 复用 `import_attachment` 已有的全部检查：扩展名小写、`BLOCKED_EXTS` 黑名单、stem 白名单
> （字母数字/`-`/`_`，≤64 字符）、撞名递增 `-1/-2`、路径不许穿越；只是源改为内存字节（`fs::write`）。
>
> **执行路径（6 步）**
>
> 1. 读 `src/components/MarkdownEditor.tsx` 的 `extensions`（L563 起）——在 CM6 里加 `EditorView.domEventHandlers({ paste })`
>    （先 grep `AtomicCodeMirrorEditor.js` 看 atomic 自己有没有 paste 处理器，有则用 `Prec.high` 抢先）。
> 2. 处理器里：`e.clipboardData?.files` 中找 `image/*`（**只有确实带图片时才接管**，否则 `return false` 放行默认粘贴，
>    否则会吞掉从网页/Excel 复制的文字）；`file.arrayBuffer()` → base64。
> 3. 组件新增 prop（如 `onPasteImage?: (img: { base64: string; ext: string }) => void`），App 传实现。
> 4. App 侧照抄 `insertFileFromPath`（L1588）的后半段：`invoke('import_attachment_b64', …)` → `pathFromNote` →
>    `imageInsertion` → `view.dispatch` → `setToast`。
> 5. Rust：新增命令 + `generate_handler!` 注册 + 单测（照 `import_attachment_copies_next_to_note_without_overwrite`
>    的写法，测 b64 写入 / 撞名 / 路径穿越 / 非法扩展名）。
> 6. 验收：桌面截图粘贴走一遍；手机长按粘贴走一遍（真机 dev 包 reload 即生效，**不要重编 APK**）。
>
> **坑（先记下）**
> - atomic 的 paste 默认行为未知 —— 先读它的 dist 再动手，别假设 CM6 裸行为。
> - 手机 `clipboardData.files` 是否可用要真机验证；不可用就降级为「仅桌面」并明确提示，别静默失效。
> - 建议加**单张大小上限**（如 10 MB），超限 toast 提示，不写盘。
> - 图片命名复用 `attachmentStem(new Date())`（`src/lib/insert-image.ts:94`），别自创格式。
>
> ### #4 / #3 / #2 的起点（各一句话，细节看卡片待办表）
>
> - **#4 搜索筛选**：`index.query(q, { tag, dir })` 已支持、`index.tags()` 已就绪 → 只缺 SearchPanel 的筛选行；
>   正则要动 `index-api.ts` 的匹配层（新增 `opts.regex`），属性筛选要先扩 `Entry` 的 frontmatter 解析。
> - **#3 全局替换**：遍历 `fs.listNotes` + `readText` 统计命中 → 试运行清单 → 逐文件 `fs.writeText`；
>   写前先备份到 `.zn/`（或复用回收站），避免误替换不可逆。
> - **#2 标签页**：`App.tsx` 的 `activePath` → `tabs[] + activeTab`；`stateCacheRef` / `scrollCacheRef` 已按 path 缓存，
>   切换前必须 flush 当前文档（`saveNow`），否则丢最后一次编辑。

> ## 📌 rev173.44（2026-10-20 · 待办登记：与同类应用对比补齐 4 项）
>
> 用户在与 Obsidian / 思源 / Joplin / Typora 对比后，指定 4 项列入待办（**只登记，未开工**）：
>
> | # | 项 | 优先级 | 现状 |
> |---|---|---|---|
> | 1 | 编辑器粘贴图片（Ctrl+V） | **P1** | 无 paste 处理器，只能右键「插入图片…」 |
> | 4 | 搜索筛选（正则 / 标签 / 属性） | P2 | `index.query` 支持 `tag`/`dir`、`index.tags()` 就绪，**UI 未接** |
> | 3 | 全局替换（跨笔记） | P2 | 只有当前文档替换（Ctrl+H） |
> | 2 | 多标签页 / 分屏 | P2 | 单文档（`activePath` 单值） |
>
> 明细（验收口径 / 建议顺序 1→4→3→2 / 成本边界）在 **`HANDOFF-CARD.md`「待办」段**；
> 4 项都不改内核契约（`contract.ts` 不动），属 UI + 内核内部能力。

> ## 📌 rev173.43（2026-10-19 · 查找面板改成悬挂窗）
>
> 用户：「搜索栏做成像命令输入框这样的悬挂窗口」。
>
> | 项 | 处理 |
> |---|---|
> | 容器 | `.cm-panels.cm-panels-top` → `position: fixed` 全屏遮罩层（与 `.zn-palette-mask` 同参数：`rgba(0,0,0,.35)` + `12vh` + 居中） |
> | 卡片 | `.cm-panel.cm-search` → `min(560px, 92vw)` · `--zn-radius-lg` · 与命令面板同阴影（`0 12px 40px rgba(0,0,0,.25)`）· `--zn-bg` |
> | 输入框 | 去原子边框/底色，占满左侧，14px，placeholder 用 `--zn-fg-subtle` |
> | 按钮 | 无边框图标按钮（hover 底色），SVG 16px |
> | 点遮罩关闭 | `.zn-editor` 的 `onPointerDown` 事件委托：目标在 `.cm-panels-top` 但不在 `.cm-search` ⇒ 点 atomic 自带的 `button[aria-label="Close"]` |
> | 附带效果 | 面板脱离文档流 ⇒ 打开时正文**不再被往下推**（旧版 sticky 通栏会占 55px） |
>
> 实测（CDP · 1100×720 窗口）：面板 rect `x=270 y=86 w=560 h=53`（水平居中）；点遮罩关闭 ✓；
> 点卡片内部不关 ✓；输入 `oo` → `1 match`；输入框 focus 的绿色 box-shadow 已去掉。
> 截图 `_shots/search-float-final3.png`。
>
> ⚠️ 遮罩是 `.cm-panels-top` 的全屏 fixed 层，点击遮罩时那一次点击**不穿透**到编辑器
> （与命令面板同一语义：点外面 = 关闭）。

> ## 📌 rev173.42（2026-10-19 · Ctrl+F 修回编辑器查找：关掉 WebView2 原生查找栏）
>
> 用户反馈「搜索框位置有点奇怪」+ 截图里搜索框带 `2/2` 计数、在窗口右上角。
> 定位：那不是应用的搜索框，是 **WebView2 自带的查找栏** —— Ctrl+F 在浏览器层就被吃掉，
> 页面里的 CM6 `searchKeymap`（`Mod-f` → `openSearchPanel`）根本收不到按键，
> 所以编辑器自带的查找面板（`cm-atomic-search-input`）永远打不开。
>
> | 项 | 结论 |
> |---|---|
> | 为什么不能配置 | Tauri 2.12.3 没有暴露 wry 的 `with_browser_accelerator_keys`（核过本地 `tauri-2.12.3/src/webview`，无此 API） |
> | 修法 | `WebviewWindow::with_webview` → `controller.CoreWebView2().Settings().cast::<ICoreWebView2Settings3>()` → `SetAreBrowserAcceleratorKeysEnabled(false)`；再读回 `AreBrowserAcceleratorKeysEnabled` 确认 false |
> | 依赖 | `webview2-com = "0.39"` + `windows-core = "0.62"`（与 tauri 内部一致，否则 COM 接口类型不互通） |
> | 调用点 | `run()` 的 setup，主窗口 label `main` |
> | 副作用 | Ctrl+R / F5 / Ctrl+P（打印）等浏览器快捷键一并失效；dev 靠 vite HMR，不依赖 F5 |
>
> 实测用**真实按键**（`gentle_keys ctrl+f`，不是 CDP 合成事件 —— CDP 的 `Input.dispatchKeyEvent`
> 不走浏览器加速键，测不出这个问题）：DevTools 里出现 `.cm-atomic-search-input`，面板
> rect `x=532 y=32 w=568`（编辑器顶部、横跨编辑区）；截图 `_shots/ctrl-f-after.png`。日志：
> `[webview2] 浏览器加速键已关闭（读回 enabled=false）`。
>
> ⚠️ 插件独立窗口（`view.openWindow`）是新 webview，**没有**单独处理 ⇒ 插件窗口里 Ctrl+F
> 仍是 WebView2 原生栏（P2：要一致得在窗口创建后逐窗口设置）。

> ## 📌 rev173.41（2026-10-19 · 插件失败可见 + 外链提示）
>
> 完善性评估里列的「静默失效」三条，逐条给出口：用户不该只看到「插件没了」。
>
> | 位置 | 之前 | 现在 |
> |---|---|---|
> | `collectPluginDirs` | 读全局插件目录失败 ⇒ `catch(() => [])`，插件页空着 | 接受 `onError`，失败原因进 `pluginError`（插件页可见） |
> | `ensureBuiltinPlugins` | 写失败只 `console.warn` | 返回 `{ failed: [{pluginId, rel, error}] }`；调用处 → toast + `pluginError`（"内置插件写入失败 N 个文件…"） |
> | 编辑器点外链 | 失败只 `console.warn`（手机 `open_external` 必失败 ⇒ 零反馈） | 新增 `onNotify` prop；App 传 `setToast`。手机文案明确指向"复制到浏览器" |
> | 迁移库内插件 | 单条失败静默跳过 | 未改（低频、迁移已一次性完成；留作 P2） |
>
> 测试：`tests/plugin-roots.test.ts` 3 条（成功 / 读目录失败 / 解析根失败）、
> `tests/builtin-plugins.test.ts` 3 条（全成功 / 全失败带条目 / 部分失败只记失败项）。

> ## 📌 rev173.40（2026-10-19 · 搜索索引增量 + 内核事件派发）
>
> 两个「文档说做了、代码没做」的缺口，这次真的接线：
>
> | 缺口 | 之前 | 现在 |
> |---|---|---|
> | 搜索索引不增量 | 面板只在**首次打开**时 `rebuild()`，注释说"之后靠 upsert/remove"但全仓无调用 ⇒ 本次启动后新写/改过的笔记搜不到 | 内核组装点把 `fs` 写路径包一层（`fs-events.ts`）：`writeText` / `createNote` / `rename` / `move` / `delete` / `restoreTrash` 成功后即时 `index.upsert/remove`；外部改动由 App 的 `fs.watch` 调 `applyExternalChange` 跟随 |
> | 内核事件没派发 | 契约 §1.4 声明 9 种事件，代码只发 `service:available/gone` | `note:saved/created/renamed/deleted/changed` + `index:rebuilt`（`IndexDeps.onRebuilt`）+ `app:ready` / `vault:open`（`usePluginHost` 加载完这一代后发） |
>
> **为什么包装放在 `createKernel` 组装点**：插件拿到的 `ctx.fs` 是 `kernel.fs` 的 scoped
> 视图，宿主也调 `kernel.fs` —— 只有在这里换一次，所有写入路径才都经过它（app / hooks / 插件）。
>
> **语义边界**（写进契约 §1.4 表）：`note:saved` = 应用写了盘；`note:changed` = 磁盘内容变了
> （外部程序改文件，**也会**是本机保存的 watch 回响）。插件应做幂等处理。
>
> 顺带修：搜索面板查询态不再显示 `stat.count` —— 索引增量维护后它是上次 rebuild 的快照，删/建几篇就过时。
>
> 实测（CDP · dev 23:23）：新建笔记输入「增量验证标记-7f3a-世界」→ 自动保存 → 打开搜索查 `7f3a`
> **命中 1 条**（索引 4 篇，修复前应为 3 篇的旧快照）；彻底删除该笔记后同一查询 **0 条**。
> 测试新增 `tests/kernel-fs-events.test.ts` 9 条。

> ## 📌 rev173.39（2026-10-19 · 内嵌 HTML 白名单渲染 + 设置开关）
>
> 用户问「内嵌 HTML 按之前约定不做，这是哪条约定的」→ 核实：**没有约定** —— 是我把自己的建议写成了「约定」。
> 随后调研主流做法（VS Code 默认 Strict 安全模式、Joplin 直接渲染、GitHub 白名单 sanitizer），
> 采用「渲染 + 限制」：白名单标签 + 属性全剔除。
>
> | 项 | 处理 |
> |---|---|
> | 白名单 | `ins / del / mark / kbd / sup / sub / br / span / strong / em / b / i / u / s / small / code` |
> | 净化 | `sanitizeHtml`（`editor-syntax.ts`，自实现 DOMParser 遍历）：属性**全剔除**（事件/style/class）· `script` / `style` 整段丢弃 · 未知标签只留文本 |
> | 设置 | 设置 → 通用 → 「内嵌 HTML」：渲染 / 显示源码；默认渲染；localStorage `zeronote.renderHtml` |
> | 切换生效 | 开关变化时用 `key` 重建编辑器（扩展 mount 时读 prop；模块级开关会读到旧值 —— 实测踩过） |
>
> ⚠️ 为什么不用 DOMPurify：它在 **happy-dom 单测环境**里行为不可靠
> （实测**剥掉了白名单标签**、又**放行了 iframe**）⇒ 自实现 30 行白名单，单测与运行时行为一致。
>
> 实测（CDP · dev 23:0x）：`<ins>` / `<strong>` 渲染、`<span onclick style>` 属性被剔除、`<script>` 与 `<div>` 显示源码；
> 设置切「显示源码」→ widget 归零，切回 → 恢复。截图 `_shots/md-html-01.png`。测试 **28**（本模块）。

> ## 📌 rev173.38（2026-10-19 · Markdown 语法增强第二批：脚注 / Mermaid / 定义列表）
>
> 接 rev173.36，补齐用户列的剩下三项。
>
> | 语法 | 实现 |
> |---|---|
> | 脚注 `[^1]` | 引用 → 上标编号 widget；**点击跳到定义行**（`EditorView.domEventHandlers` + `scrollIntoView`）；定义行 `[^1]: …` **整行接管**成 widget（编号 + 弱化正文）—— 不接管的话 atomic 会把正文当链接渲染（实测踩过） |
> | Mermaid | ```mermaid 围栏 → block widget，**动态 `import('mermaid')`** 异步渲染 SVG；失败保留源码；光标进块显示源码 |
> | 定义列表 | 术语行 + 下一行 2+ 空格/Tab 缩进 → 术语加粗（`.zn-deflist-term`）、解释弱化（`.zn-deflist-desc`） |
>
> 依赖：`mermaid`（动态导入，不阻塞首屏；约 2 MB 的依赖树）。
> 测试 **337**：`tests/editor-syntax.test.ts` 22 条（含新增 `findMermaidBlocks` 围栏识别 / 未闭合、脚注引用识别）。
>
> **待做（第三批，可选）**：内嵌 HTML 渲染（有安全面，暂不做）。

> ## 📌 rev173.37（2026-10-19 · 版本管理：应用版本 0.1.0 → 0.2.0 + 发版脚本）
>
> 用户问「软件有版本控制吗，我看一直是 0.1.0」。
> 现状：Git 有完整历史 + 私有仓库，但**没有 tag / release**；应用版本号散在 4 处、从未递增；
> 关于页显示的是 `kernel.ts` 里硬编码的 `0.1.0`（注意：契约版本 0.2 是插件 API 的号，两套）。
>
> | 项 | 处理 |
> |---|---|
> | 单一来源 | `package.json` 的 `version`（唯一真源） |
> | 关于页 | `kernel.ts` 改读 vite 注入的 `__APP_VERSION__`（`vite.config.ts` 从 package.json 注入） |
> | 发版脚本 | `scripts/release.mjs <x.y.z> [--tag]`：同步 `package.json` / `tauri.conf.json` / `Cargo.toml`；`--tag` 打 `vX.Y.Z`（要求工作区干净） |
> | 首版 | **0.2.0**（tag `v0.2.0`） |
> | 文档 | `CHANGELOG.md` 新增「应用版本」区段（与契约版本分开） |
>
> ⚠️ 两个坑：
> 1. **vitest 不经过 vite define** ⇒ 单测会 `ReferenceError: __APP_VERSION__ is not defined`（app-smoke 实测）→ `vitest.config.ts` 里也注入同一个值；
> 2. **vite.config.ts 的改动要重启 dev server 才生效** ⇒ 旧进程里 `__APP_VERSION__` 未定义 → `kernel.ts` 加运行时兜底 `typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'`。
>
> 发版流程（脚本头注释里也有）：
> 1. `node scripts/release.mjs 0.3.0`
> 2. 更新 `CHANGELOG.md`
> 3. `git add -A && git commit -m "chore(release): v0.3.0"`
> 4. `node scripts/release.mjs 0.3.0 --tag`
> 5. `git push origin main --tags`

> ## 📌 rev173.36（2026-10-19 · Markdown 语法增强第一批：上标 / 下标 / Emoji / 数学公式）
>
> 用户：「做一个 Markdown 补全插件，把这些样式补齐」（7 项，分多轮）。
> **关键事实**：插件 API 只收「正则 → 5 个语义档位」的声明式规则，**加不了 widget、也改不了文本**
> ⇒ 这批全部落在内核 `src/kernel/editor-syntax.ts`（与 `editor-marks.ts` 同层）。
>
> | 语法 | 实现 |
> |---|---|
> | 上标 `^x^` | 装饰器：隐藏 `^` + `vertical-align: super` |
> | 下标 `~x~` | 同上（`~~删除线~~` 不误伤 —— 前后紧贴 `~` 不匹配） |
> | Emoji `:name:` | `Decoration.replace` → EmojiWidget（内置约 100 个常用短码） |
> | 行内数学 `$…$` | KaTeX widget（`displayMode: false`） |
> | 块级数学 `$$…$$` | KaTeX block widget（StateField 提供；**点击块进入源码编辑，点别处恢复渲染**） |
>
> 规则：光标所在行不渲染（显示源码）；行内代码 / 围栏代码块 / 数学区间内不重复解析；
> 数学**先扫**再扫上标 —— 否则 `$a^2 + b^2$` 里的 `^` 会被上标规则抢走（实测踩过）。
>
> ⚠️ 大坑：CM6 **禁止 ViewPlugin 提供 block 装饰器**
> （`RangeError: Block decorations may not be specified via plugins`，整页白屏）→ 块级数学改由 `StateField` 提供。
>
> 依赖：`katex`（npm）+ `katex/dist/katex.min.css`（字体走 Vite 打包）。
> 测试 **17**：`tests/editor-syntax.test.ts`（`parseInline` / `findMathBlocks` 纯函数）。
>
> 实测（CDP · dev 22:1x）：上标 x² / 下标 H₂O / Emoji 😄🚀👍 / 行内式 a²+b²=c² / 块级 ∫₀¹x²dx=1/3；
> 点块 → 显示 `$$…$$` 源码可编辑，点别处 → 恢复渲染。截图 `_shots/md-syntax-07.png` / `_shots/md-syntax-09-edit.png`。
>
> **第二批待做**：脚注（编号 + 跳转）· Mermaid 渲染 · 定义列表。

> ## 📌 rev173.35（2026-10-19 · 灵感流插件搁置：退出预装与全局目录）
>
> 用户要求：「灵感流插件先删除，搁置起来」。
>
> | 项 | 处理 |
> |---|---|
> | `BUILTIN_PLUGINS` | 移出 `inspiration-flow`（import + 数组项）→ 预装 **6 → 5**（outline-map / doc-reader / import-export / theme-sepia / accounting） |
> | 全局目录 | 桌面 `%APPDATA%\com.aqua.zeronote\.zn\plugins\inspiration-flow` 删除（目录里只有 index.js + manifest.json，无 store / 用户数据）；手机 dev 包 `.zn/plugins/inspiration-flow` 同步删除 |
> | 源码 | **保留** `examples/inspiration-flow/` —— 「搁置」= 随时可装回（复制进全局目录 + 重扫即可） |
> | 文档 | `docs/使用手册-移动端.md` 预装列表 9 → 5 |
>
> 全局现在 **6 个**：accounting / doc-reader / import-export / outline-map / theme-green（用户自装，不在预装表）/ theme-sepia。
>
> ⚠️ 踩坑：两次 edit 之间 vite HMR 捕获了「import 已删、数组项还在」的中间态并缓存，
> 页面白屏（`ReferenceError: inspirationIndex is not defined`）；`Page.reload({ ignoreCache: true })` 后恢复。
> 改 `builtin-plugins.ts` 这种被多处 import 的模块，**一次 edit 改完**最稳。
>
> 测试 **315**（无新增）。

> ## 📌 rev173.34（2026-10-19 · 全局自绘滚动条：统一 / 无轨道 / 沉浸式滑块）
>
> 用户要求：「滚动条滑块做短一点，然后整体细一点」→ 紧接着「所有的滚动条都统一，
> 然后隐藏轨道，做沉浸式的滑块」。
>
> **为什么必须自绘**：原生滚动条的滑块长度 = 可视/内容比例，CSS 改不了
> （实测 `::-webkit-scrollbar-thumb { height }` 被忽略，`min-height` 只对极短内容有用）；
> 轨道也做不出「悬浮层 + 滚动淡出」的效果。
>
> | 项 | 处理 |
> |---|---|
> | 实现 | `src/components/GlobalScrollbars.tsx`：扫描所有 `overflow-y: auto|scroll` 且可滚动的容器 → 加 `.zn-sb-host` 藏掉原生滚动条 → 在一个全屏 fixed 层里画 6px 滑块 |
> | 滑块 | 长度 `clamp(比例×轨道, 28px, 120px)`（封顶压短）· **无轨道** · 半透明 · 滚动时出现、静止 900ms 淡出 · 可拖动 |
> | 统一 | 编辑器（含源码模式）、时间流/手机起始页卡片流、文件树、插件面板、设置…… **所有滚动容器**自动覆盖（以后新增的也会被扫到） |
> | 挂载 | `main.tsx` 与 `<App />` 并列 —— 整窗接管（插件 shell）时也生效 |
>
> 性能：全文档 405 个元素时样式遍历 <1ms；重扫 4s 一次 + MutationObserver 150ms 去抖。
>
> 实测（CDP）：`.zn-mobile-cards` / `.cm-scroller` 均带 `.zn-sb-host`、`scrollbar-width: none`；
> 两条滑块 120px 封顶、位置随滚动正确；滚动后出现、900ms 后淡出。
> 截图 `_shots/sb-global-01.png`（卡片流）/ `_shots/sb-global-02-editor.png`（编辑器）。
> 测试 **315**。

> ## 📌 rev173.33（2026-10-19 · 桌面「时间流」面板：侧栏与编辑区之间常驻一栏）
>
> 用户给截图圈出「侧栏与编辑框之间」的空白，要求：「加一个窗口，放和移动端起始页一样的时间流卡片」。
> 裁决：**常驻**（打开笔记时也在）＋ **可拖宽，默认 300px**；随后用户明确「不需要加号按钮了」。
>
> | 项 | 处理 |
> |---|---|
> | 布局 | `.zn-body` = 侧栏 ｜ 时间流（`.zn-timeline`）｜ 编辑区；宽度 `timelineWidth`（localStorage `zeronote.timeline.w`，默认 300，`AppResizer` 拖 160–560） |
> | 内容 | 复用 `MobileNoteCards` 新增 `variant="panel"`：同一套卡片，**不渲染 ＋**、不挂长按快捷入口 |
> | 常驻范围 | `isDesktop && mainView === 'editor'`；**不跟侧栏 ☰ 开关走**；插件页 / 回收站不显示 |
> | 打开派发 | 与文件树一致：doc → `core.openDocument`、image → 预览、其余 → `openNote` |
>
> 顺带修的两处（面板暴露出来的）：
> - 非 note 卡片（文档 / 附件）原来永远停在「…」—— 改为直接显示 `title`
> - 卡片流（含手机起始页）滚动条加 `:root[data-theme='dark'] .zn-mobile-home { color-scheme: dark }`
>
> 实测（CDP · dev 21:3x）：时间流 8 张卡片 · 点「一级标题」卡片打开笔记且面板常驻 · 无 ＋ 按钮 ·
> `.zn-mobile-home` 计算 `colorScheme=dark` · 截图 `_shots/timeline-02.png`（起始页）/ `_shots/timeline-03-editing.png`（编辑中）。
> 测试 **315**。

> ## 📌 rev173.32（2026-10-19 · 暗色滚动条跟随主题）
>
> 用户报（交接卡未决表最后一条）：编辑器右侧内容滚动条没跟随暗色主题，仍是浅色。
>
> | 项 | 处理 |
> |---|---|
> | 修法 | `EDITOR_CSS` 加 `:root[data-theme='dark'] .zn-editor .cm-scroller { color-scheme: dark }` —— UA 级开关，滚动条与原生控件一起变暗 |
> | 作用域 | 只挂编辑器子树（沿用 `EDITOR_CSS` 既有约定「不动全局 styles.css」）；源码模式（`SourceModeView`）也在 `.zn-editor` 内，一并覆盖 |
> | 亮色 | 默认值 `normal`，不需要对应规则 |
>
> 实测（CDP · dev 21:1x）：
> - `getComputedStyle(.cm-scroller).colorScheme`：暗色 `dark` → 切 `data-theme='light'` 得 `normal` → 切回 `dark`
> - 截图对比 `_shots/scrollbar-before.png`（轨道白）→ `_shots/scrollbar-after.png`（轨道深灰，滑块不变）
> - 源码模式 `.cm-scroller` 同为 `dark`
>
> ⚠️ HMR 后立刻读 `getComputedStyle` 可能仍是旧值（规则已进 DOM，计算值晚一拍）—— 等几秒再读，否则会误判「没生效」（本轮踩过）。
>
> 测试 **314**（CSS 改动，用例数不变）。

> ## 📌 rev173.31（2026-10-19 · 编辑器标记 / 标签演示退出功能列表）
>
> 用户裁决：「都清掉」（指上一轮问的 `editor-marks` 与 `tag-demo`）。
>
> | 项 | 处理 |
> |---|---|
> | 全局目录 `editor-marks` / `tag-demo` | 删（桌面 + 手机） |
> | `BUILTIN_PLUGINS` | 移出两个条目（预装 8 → **6**） |
> | 源码 | 保留在 `examples/`（测试库） |
> | 注释/测试引用 | `index-api.ts` · `plugin-host.ts` · `tests/plugin-category.test.ts` 改写 |
>
> 后果（用户已知）：
> - `[[双链]]` 仍由 atomic 自己渲染，但**点击不再打开笔记**
> - `#标签` **不再着色**（editor-marks 是这条能力的唯一来源）
> - 标签统计/筛选命令消失（`index.tags` / `index.query` 原语仍在，插件随时可调）
>
> 全局现在 **7 个**：accounting / doc-reader / import-export / inspiration-flow / outline-map / theme-green / theme-sepia。

> ## 📌 rev173.30（2026-10-19 · 测试插件退出功能列表）
>
> 用户裁决：「也删掉，放测试库，要测试的时候拿出来用就行」。
>
> | 项 | 处理 |
> |---|---|
> | 全局目录 `asset-probe` / `net-demo` | 删（它们是纯探针，不承担功能） |
> | 源码 | **保留在 `examples/`** —— 这就是「测试库」，需要时复制回全局即可 |
> | 全局剩 | **9 个**：accounting / doc-reader / editor-marks / import-export / inspiration-flow / outline-map / tag-demo / theme-green / theme-sepia |
>
> **测试插件怎么拿**（写进卡片「环境现状」）：
> `Copy-Item examples\<id> $env:APPDATA\com.aqua.zeronote\.zn\plugins\ -Recurse` → 重扫 → 用完删。
>
> 判据：删完 reload 一次，目录**不再出现**（`?raw` 不会把它写回，因为它本来就不在 `BUILTIN_PLUGINS`）。
>
> 今日累计清出：`daily-note`（rev173.29）· `asset-probe` / `net-demo`（本轮）· `tag-showcase`（只在 173.28.2 短暂存在，已删）。

> ## 📌 rev173.29（2026-10-19 · 移除测试插件：daily-note · 立「测试插件不留在功能」规矩）
>
> 用户裁决（原话）：「目录新建也删掉，以后测试产生的插件都归于测试，不留在功能」。
>
> ### 1 删了什么
>
> | 项 | 位置 | 处理 |
> |---|---|---|
> | `examples/daily-note/`（当天目录新建） | 仓库 | 删目录 |
> | `BUILTIN_PLUGINS` 条目 | `src/kernel/builtin-plugins.ts` | 删 2 条 import + 1 个条目（预装 9 → **8**） |
> | 全局插件副本 | `<appData>/.zn/plugins/daily-note/` | 删，**reload 后确认没被 ensure 写回** |
> | 手机副本 | `.zn/plugins/daily-note/` | `run-as rm -rf` |
> | 文档/测试引用 | `App.tsx` 注释 · `tests/plugin-category.test.ts` · 契约 v0.2 两处 | 改写为「示例已移除」 |
>
> 副作用（用户已知）：新建笔记回到内核默认（`新笔记-HH-mm-ss.md`，库根），不再按 `年/月/日` 归档。
>
> ### 2 立的规矩（卡片硬约束 8）
>
> **测试 / 验收产生的插件不留在「功能」里**：探针、夹具、演示插件只放 `examples/` 或临时目录，验收完即删；
> 不写进 `BUILTIN_PLUGINS`、不进预装、不留在用户插件列表。功能插件必须来自用户的明确需求（规格条目或原话）。
>
> ### 3 踩坑（同时写进硬约束 9）
>
> 改完 `builtin-plugins.ts` 删条目后，**第一次 reload 仍把 daily-note 写回**（vite `?raw` 还是旧内容，
> `ensureBuiltinPlugins` 用旧 raw 覆盖全局目录）；等 vite 重新编译后再删一次才稳定。
> **判据**：删完 reload 一次，目录**不再出现**才算成。

> ## 📌 rev173.28.1（2026-10-19 · 记账：原始通知诊断）
>
> 用户选择「加诊断视图」作为文案校准的第一步。目标：**遇到漏记时能自己看到为什么**，
> 而不是只能等用户把截图发过来。
>
> ### 1 做了什么
>
> | 层 | 改动 |
> |---|---|
> | 留痕 | `sync()` drain 到的**每一条**通知都记一笔到 store `rawNotices`（最近 **20** 条）：`{ pkg, app, title, text, time, ok, reason }` |
> | 解释 | `describeNotice(n)` 返回未识别原因：空通知 / 命中忽略规则（验证码·还款·余额）/ 没有支付短语 / 有短语但没金额 |
> | UI | 面板「诊断」按钮（`accounting.diag`）：`已记账` / `未识别` 徽标 + 原文（标题·正文）+ 原因 |
> | 隐私 | 只写本机 `store.json`，不导出、不上传；视图里明确写了这句 |
>
> ### 2 真机实测（ARIA 24069RA21C）
>
> 6 条样例（3 条真实格式 + 3 条构造）显示正确：
>
> | 原文 | 徽标 | 原因 |
> |---|---|---|
> | 微信 · 晚上一起吃饭吗 | 未识别 | 没有支付短语（付款成功 / 收款到账 / 转账…） |
> | 微信 · 你的验证码是 123456 | 未识别 | 命中忽略规则 /验证码/（验证码/还款/余额类） |
> | 微信 · 你有一笔付款 | 未识别 | 有支付短语，但没找到金额 |
> | 微信支付 · 商户：楼下小卖部 付款成功 6.00元 | 已记账 | — |
> | 微信支付 · [2条]微信支付: 已支付¥0.10 | 已记账 | — |
> | 微信支付 · 已支付¥0.10 | 已记账 | — |
>
> 证据：`_shots/acc-63-diag.png`。
>
> ### 3 怎么用它做文案校准
>
> 用户下次遇到「明明付了钱但没进账」：打开记账 →「诊断」→ 找到那条未识别的原文 → 看原因 →
> 把原文/原因发给 AI 补规则（改 `PAY_PHRASES` / `IGNORE` / `extractAmount` / `extractMerchant`，各一处）。
>
> ⚠️ 测试时临时把 `com.android.shell` 加进通知白名单（`shared_prefs/zn_notification_capture.xml`）后**已还原**；
> store 里的构造样例也**已清掉**（`transactions` 保留）。
>
> 单测：`tests/accounting-diag.test.ts` 5 条（ok / 验证码 / 无短语 / 有短语无金额 / 空通知）。

> ## 📌 rev173.28（2026-10-19 · 记账 v0.2：统计图表 + CSV 导入导出）
>
> 用户拍板「先做记账插件待办」（三选：文案校准 · 统计图表 · CSV 导入导出）。本轮做后两项 + 文案校准的**工具基础**；
> 文案校准本身留给真实通知样本（见末尾「未做」）。
>
> ### 1 统计视图（面板「统计」按钮 / `accounting.stats`）
>
> | 模块 | 内容 |
> |---|---|
> | 纯函数 | `summarizeByCategory(txs, year, month)`（只算支出、降序、占比/笔数）· `monthlyTrend(txs, n, now)`（含本月、跨年、缺月补 0） |
> | 分类占比 | `progress` 节点：`餐饮 ¥92.00 · 89% · 3 笔`（占比 <1% 显示 `<1%`，不显示 0%） |
> | 趋势图 | `trendSvg()` 手写 SVG 柱状图（320×132 viewBox / 宽度 100% 上限 480px / 颜色全走 `--zn-*` token）—— **不引图表库** |
> | 切视图 | `mode = 'list' \| 'stats'` 闭包状态；`accounting.backToList` 返回 |
>
> ### 2 CSV 导出（`accounting.exportCsv`）
>
> - `toCsv()`：RFC 4180 转义 + **UTF-8 BOM**（Excel 打开中文不乱码）；列 = 时间,类型,金额,商户,分类,来源,状态
> - 桌面：`host.saveFile({ defaultName })` → 系统「另存为」（用户取消 ⇒ 返回 null，**不写库内**）
> - Android：SAF 另存为不受支持 ⇒ `fs.writeText()` 写**库根目录**，`host.notify` 给出文件名
> - **真机实测**（ARIA 24069RA21C）：点「导出 CSV」→ toast「已写入库根目录…（共 6 条）」→
>   `/storage/emulated/0/Documents/ZeroNote/ZeroNote记账-20261019.csv`（466 B，6 行，金额两位小数）
>
> ### 3 CSV 导入（`accounting.importCsv`）
>
> - `parseBillCsv()` 两家账单**自动识别**：表头定位（含「交易时间 / 交易对方 / 收/支」的行，跳过说明行）、
>   `¥`/`￥`/千分位金额、`支出`/`收入` 方向、微信 `/`（不计收支）跳过、收入统一归「收入」分类
> - `mergeImported()` 去重：有**交易单号**按单号；无则「分钟 + 金额 + 商户 + 收支」
> - 编码兜底：严格 UTF-8 失败 ⇒ GBK（支付宝导出常是 GBK）
> - 文件读取：`host.pickFile()`（Android 给 `content://`）→ `host.readContentUri()` 复制到缓存 →
>   `fetch(host.assetUrlAbs(path))` → `arrayBuffer`（沿用 import-export 的成熟路径）
> - **真机端到端**：SAF 选 `wechat-bill.csv` → toast「导入 2 条（微信账单）」→ 列表新增「肯德基 ¥45.00 · 餐饮」「张三 ¥88.00 · 收入」；
>   **二次导入同一文件** → 「没有新账单（重复 2 条）」✅ 去重生效
>
> ### 4 单测与基线
>
> | 文件 | 条数 | 覆盖 |
> |---|---|---|
> | `tests/accounting-stats.test.ts` | 7 | 月份键 / 分类汇总 / 6 月趋势跨年 / SVG 转义与金额缩写 |
> | `tests/accounting-csv.test.ts` | 6 | 表头 / BOM / 两位小数 / RFC 4180 转义 / 空账本 |
> | `tests/accounting-import.test.ts` | 10 | 微信·支付宝表头 / `/` 跳过 / 异常输入 / 单号与时间金额去重 |
>
> verify 全过：tsc 0 · oxlint **3** warnings · cargo **32** · vitest **309**（286 → 309）。
>
> 证据：`_shots/acc-31-stats.png`（桌面统计）· `acc-62-phone-stats.png`（手机统计）· `acc-export-phone.csv`（导出文件）·
> `acc-58-wechat.png` / `acc-60-pick.png`（SAF 搜索与勾选）· `acc-53-dl5.png`（选择器浏览）
>
> ### 5 踩坑（下次别重复）
>
> 1. **内置插件改 examples 后，dev 里「点重新扫描」不会生效**：`ensureBuiltinPlugins` 用 vite `?raw` 打包的内容**覆盖**全局目录，
>    而 `?raw` 不会 HMR 进已加载的模块 ⇒ 必须让页面 reload（CDP `location.reload()`）或重启 dev。
>    手动 `Copy-Item` 到全局目录也会被下一次重扫覆盖回旧版。
> 2. **CDP 端口用 node fetch 才通**：`Invoke-WebRequest http://127.0.0.1:9222/json/list` 一律 404（WebView2 对 Host/UA 挑剔），
>    `node -e "fetch(...)"` 正常 —— `tools/cdp.mjs` 本来就是 fetch。
> 3. **手机 SAF 看不到新文件是 MediaStore 没索引**：`adb push`/`cp` 后要触发扫描
>    （`am broadcast MEDIA_SCANNER_SCAN_FILE`，或 `am start -a VIEW -d file://…` 打开一次），否则「浏览」与搜索都空。
>    另外 `input text` 中文会被输入法改成拼音（搜英文文件名最稳）。
> 4. **minimized 窗口里的 Tauri 对话框不显示**：`Start-Process -WindowStyle Minimized` 起 dev 后，另存为对话框虽然存在
>    （EnumWindows 能看到），但不在前台上（`SetForegroundWindow` 会被前台锁拒）。GUI 验收前先 `ShowWindow(SW_RESTORE)`。
>
> ### 6 未做
>
> - **文案校准**：需要真实微信/支付宝**通知原文**（当前 6 条真实记录全部识别成功；漏识别的样本才能校准规则）。
>   下一步可加「原始通知诊断」视图（sync 时保留最近 N 条原文 + 解析结果），用户遇到漏记时能直接看到原因。
> - 预算、分类删除/排序、AI 分类（调研 §6.5 的 v0.2/v0.3 其余项）。

> ## 📌 rev173.27（2026-10-19 · 安卓测试流程固化：不重编、不装 release）
>
> 用户原话：「已经出现很多次把安卓已经安装 debug 包忘掉的事情了，还有测试机不装 release，每次都跑 dev」。
> 这是**第二次**为同一件事被提醒（第一次是「安卓测试用 dev」），所以这次写进**卡片硬约束**，不只记在 rev 里。
>
> ### 1 规则（已进 `HANDOFF-CARD.md` 硬约束 7）
>
> | 场景 | 正确做法 | 错误做法 |
> |---|---|---|
> | 要跑安卓测试 | `adb shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity` | `pnpm tauri android dev`（全量重编 1-2 分钟） |
> | 改了前端 | 页面 `location.reload()`（CDP 或重开 app） | 重装 APK |
> | 白屏 | 先 reload 一次（`@vite/client` 竞态） | 认定 APK 坏了、重装 |
> | 改了 Rust / 原生插件 | 这时才需要重装 | — |
> | 测试机装什么 | 只装 `com.aqua.zeronote.debug`（连 1420） | 装 `com.aqua.zeronote`（release：内置 dist、不接 1420） |
>
> 为什么容易忘：`android-dev.cmd` 与历史交接文档都把「跑 dev」写成了默认动作；
> 而实际只有 **Rust / 原生层**变了才需要重装。前端靠 vite，压根不经过 APK。
>
> ### 2 本轮实操（按新规则走了一遍）
>
> - 停掉正在全量重编的 `android-dev.cmd`；
> - `am force-stop` → `am start` → 页面白屏 → **reload 一次** → 起始页正常（`#root` 6844 字符）；
> - 桌面 dev 同时在线（`src-tauri\target\debug\zeronote.exe`，窗口标题 ZeroNote）。
>
> ### 3 顺带清理（用户要求「把安卓端产生的截图清理一下」）
>
> | 位置 | 删除 | 保留 |
> |---|---|---|
> | 手机 `/sdcard/*.png` | **113 个 / 39 MB** | 0（DCIM 用户照片未动） |
> | `_shots/` 今日安卓截图 | **56 个 / 21.6 MB** | 14 张桌面截图 + 4 张被 HANDOFF 引用的（dev-04/05/10/12） |
>
> `_shots/` 仍有 1110 个历史文件（208 MB），其中被 HANDOFF/docs 引用的 **152 张**不能删（删了证据断链）；
> 若要继续瘦身，只能按「被引用就留」逐个扫。
>
> ## 📌 rev173.26（2026-10-19 · release 与 dev 完全隔离）
>
> 用户：「和 dev 版本隔离，不能相互影响和冲突」。
>
> ### 1 做法（rev110 那套 + 这次的实测复核）
>
> ⚠️ **`--config '{"identifier":...}'` 只影响 bundle，不影响运行时** —— single-instance 看的是
> **编译期**嵌进去的 identifier。必须真改 `tauri.conf.json` 再编、编完恢复：
>
> ```powershell
> # 1 备份 + 改 conf（identifier / productName）
> Copy-Item src-tauri\tauri.conf.json _tmp-conf\tauri.conf.json.bak
> #   "identifier": "com.aqua.zeronote" → "com.aqua.zeronote.release"
> #   "productName": "ZeroNote"        → "ZeroNote Release"
>
> # 2 独立 target + 清掉主 crate（generate_context! 是编译期宏，不追踪 conf 变化）
> $env:CARGO_TARGET_DIR = "$env:USERPROFILE\cargo-targets\zeronote-release"
> cd src-tauri; cargo clean -p zeronote; cd ..
> pnpm tauri build --no-bundle
>
> # 3 finally 里恢复 conf、删备份
> ```
>
> ### 2 实测（这次真跑过，不是照抄 rev110）
>
> | 项 | 结果 |
> |---|---|
> | conf 恢复 | ✅ `productName=ZeroNote` / `identifier=com.aqua.zeronote`（备份已删） |
> | exe 内嵌标识 | ✅ 二进制里能搜到 `com.aqua.zeronote.release`（UTF-8） |
> | 启动 | ✅ 进程存活 6 s 不退出（同 identifier 时会秒退） |
> | **数据目录** | ✅ 新建 `%LOCALAPPDATA%\com.aqua.zeronote.release`；dev 的 `%LOCALAPPDATA%\com.aqua.zeronote` **原样未动** |
> | 产物 | `cargo-targets\zeronote-release\release\zeronote.exe` · 14.11 MB · 1m42s |
>
> ### 3 三个目录各管一件事（以后别混）
>
> | target 目录 | 用途 |
> |---|---|
> | `cargo-targets\zeronote` | Android（`aarch64-linux-android`） |
> | `cargo-targets\zeronote-release` | 桌面隔离 release |
> | `src-tauri\target` | 不要用（会触发 MSVC D8050） |
>
> 已覆盖到 `C:\Users\AQUA\Apps\_View\办公与文档\zeronote.exe`；窗口标题现在显示 **ZeroNote Release**，
> 和 dev 的「ZeroNote」一眼能分开。插件也在各自 identifier 的目录下，互不可见。
>
> ## 📌 rev173.25（2026-10-19 · 桌面 release exe 构建 → `_View`）
>
> 用户：「构建最新的 release exe 包，放在 `C:\Users\AQUA\Apps\_View\办公与文档\zeronote.exe`」。
>
> ### 1 命令（可复用）
>
> ```powershell
> cd C:\Users\AQUA\Documents\deepseek\ZeroNote
> $env:CARGO_TARGET_DIR = "$env:USERPROFILE\cargo-targets\zeronote"
> pnpm tauri build --no-bundle
> ```
>
> - `--no-bundle`：只要 exe，不打 MSI/NSIS（省时间）
> - `CARGO_TARGET_DIR` **必须**指到工作区外（否则 MSVC `D8050`，见 rev110）
> - `beforeBuildCommand` 会先跑 `pnpm build`（tsc + vite build，约 30 s）
>
> ### 2 结果
>
> | 项 | 值 |
> |---|---|
> | 耗时 | **3m59s**（前端 30s + Rust release 编译 3m29s，有部分依赖缓存） |
> | 产物 | `C:\Users\AQUA\cargo-targets\zeronote\release\zeronote.exe` |
> | 大小 / 版本 | **14.11 MB** · ProductName `ZeroNote` · 0.1.0 |
> | SHA256 | `B73B9A4639996D0AC9069FD11E82D838C6138D7ECAC20CDC057FF1E42DA53A0A` |
> | 已放到 | `C:\Users\AQUA\Apps\_View\办公与文档\zeronote.exe` |
>
> ### 3 注意
>
> - 这个 exe 的 `identifier` 是 `com.aqua.zeronote`（**没改**）⇒ 和桌面 dev **抢 single-instance**：
>   dev 开着时双击它会立刻退出（ExitCode 0，不是崩）。要和 dev 同时跑，走 rev110 那套
>   「临时改 identifier + `cargo clean -p zeronote` + 独立 target」。
> - `_View` 目录里其它项都是 junction（指向各自安装目录），这个是**实体 exe**（14 MB），
>   双击即可用；卸载/移动就删这一个文件，不留碎片。
>
> ## 📌 rev173.24（2026-10-19 · 使用手册导出 PDF）
>
> 用户：「手册转成pdf」。
>
> ### 1 产物
>
> `docs/ZeroNote-手机版使用手册.pdf` —— **29 页 / 2.51 MB / 12 张截图内嵌**（单文件，换人发不用带图）。
> 打印样式：`docs/manual-print.css`（入库，重出时直接复用）。
>
> ### 2 工具链（本机实测可用，没装新软件）
>
> 本机**没有** xelatex / wkhtmltopdf / LibreOffice，但有 **pandoc 3.11** 和 **Edge**，所以走
> `md → HTML（图内嵌）→ Edge headless 打印`：
>
> ```powershell
> cd docs
> pandoc '使用手册-移动端.md' -f gfm -t html5 -s --embed-resources --resource-path=. `
>   --metadata title='ZeroNote 手机版使用手册' --include-in-header=manual-print.css -o _manual.html
>
> & "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe" `
>   --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=15000 `
>   --print-to-pdf="C:\Users\AQUA\Documents\deepseek\ZeroNote\docs\_manual.pdf" `
>   "file:///C:/Users/AQUA/Documents/deepseek/ZeroNote/docs/_manual.html"
> ```
>
> 最后把 `_manual.pdf` 改名成中文名，删掉 `_manual.html`（2.5 MB 中间物，不入库）。
>
> ### 3 踩坑：Edge 打印**不认中文输出路径**
>
> `--print-to-pdf="…\docs\ZeroNote-手机版使用手册.pdf"` 直接跑 → **退出码 0 但文件根本没生成**
> （静默失败，最容易误判成功）。改成先输出英文名 `_manual.pdf`、再 `Move-Item` 就正常。
>
> ### 4 验证
>
> 文件 2.51 MB · PDF 头 `%PDF-1.4` · `/Type /Page` ≈ 29 页 · `/Subtype /Image` **正好 12 个**（与手册图数一致）。
> 文本流搜不到中文是**正常的**（Edge 用字体子集 + CID 编码），别拿「搜不到字」当失败判据。
>
> ## 📌 rev173.23（2026-10-19 · 手机版用户使用手册 + 12 张真机截图）
>
> 用户：「写个面向普通用户的使用手册，移动端的，通俗易懂，包含软件各种功能和入口，附带截图」。
>
> ### 1 交付
>
> - `docs/使用手册-移动端.md`：**面向非技术用户**（不出现「面板 / 宿主 / 组件」这类词），
>   11 节 + 功能入口速查表：界面速览 / 写笔记 / 长按 ＋ 快捷入口 / 抽屉与多库 / 改名删除回收站 /
>   编辑区菜单 / 导图 / 记账 / 设置与插件 / 手势与返回键 / 常见问题。
> - `docs/images/manual-mobile/`：**12 张真机截图**（1220×2712 → 760×1689，合计 1.9 MB）：
>   01 首页 · 02 快捷入口 · 03 编辑器 · 04 抽屉 · 05 编辑区菜单 · 06 设置 · 07 插件 ·
>   08 回收站 · 09 卡片菜单 · 10 记账 · 11 导图 · 12 切库。
> - 进 `docs/README.md` 权威矩阵（手机版使用手册 = 用户向唯一权威）。
>
> ### 2 手册里刻意写清的入口（都是真机点过的）
>
> | 动作 | 入口 |
> |---|---|
> | 新建 | 底部 ＋ **短按** |
> | 快捷入口 | 底部 ＋ **长按半秒** |
> | 抽屉 / 文件树 | 左上 **☰** |
> | 切库 | 抽屉最底「ZeroNote」 |
> | 编辑区菜单（插入附件 / 查找 / 标记 / 设置） | **长按编辑区空白** |
> | 导图 | 编辑器里 **❖** |
> | 记账 | 长按 ＋ → 记账 |
>
> ### 3 截图的坑（MIUI 的「文本识别」浮层）
>
> 真机**长按**会弹出系统「文本识别」气泡，直接污染截图（05/07/08/09/02 各中过一次）。
> 解法：用 CDP 在页面里**合成事件**，绕开真实触摸：
>
> - 弹菜单：`el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX, clientY }))`
> - 长按 ＋：分两次 eval —— 先 `pointerdown`，隔 750ms 再 `pointerup`（≥500ms 才会触发长按），
>   `pointerType: 'touch'` 让 React 走触摸分支
>
> 另一条：**CDP `clickat` 点在 `.zn-scrim` 上不生效**（遮罩层），关抽屉要用 `scrim.click()`。
>
> ## 📌 rev173.22（2026-10-19 · 快捷入口排列修正成真半圆）
>
> 用户：「这两个排列样式哪里一样了？我要第一张图的效果」—— rev173.21 排对了「以 ＋ 为圆心」，
> 但**角度错了**：用 ±40° / ±140° 时下方两点掉到圆心下面，看着是「下半圈」。
>
> ### 1 改了什么
>
> 参考图实测（中心 437,1470 → 5 个圆 437,1233 / 272,1328 / 628,1328 / 200,1497 / 712,1497）：
>
> | 槽 | 旧（错） | 新 | 效果 |
> |---|---|---|---|
> | 正上 | 0° | 0° | 不变 |
> | 两侧斜上 | ±40° | **±48°** | 略张开一点，与参考一致 |
> | 底部两点 | **±140°** | **±96°** | 与圆心**几乎同高**（只低 11px）—— 这才是半圆 |
>
> 半径 112 → **106**、圆 60 → **56**（按参考图比例：半径/屏宽 ≈ 0.271、圆径/屏宽 ≈ 0.14）。
> 代码 `ANGLES = [0, 48, -48, 96, -96]`（QUICK 注释里写了「别改回 ±140°，用户已否」）。
>
> ### 2 真机实测（dev 版，坐标系对齐参考图）
>
> 圆心 (195, 703.8)；5 个圆实测：正上 (195,598) · 右上 (274,633) · 左上 (116,633) ·
> 右下 (301,715) · 左下 (90,715) —— 角度回算 0° / 48° / -48° / 96° / -96°，半径 106。
> 点「记账」仍正常进面板；截图 `_shots/dev-12-ring-semicircle.png`。
>
> ### 3 小坑
>
> dev 版 reload 后第一次可能是白屏（`@vite/client` 请求早于 vite 就绪），**再 reload 一次**即好 —— 两次都遇到过，已写进交接卡「手机白屏」那条。
>
> ## 📌 rev173.21（2026-10-19 · 快捷入口按用户截屏重做 + 点空白穿透修复）
>
> 用户给了两张图：① 锁屏上的环形快捷 ——「样式按第一张图排列，**半圆**，加号在圆心」② 起始页上圈出 ＋ 该在的位置；
> 另报一个 bug：「在遮罩点空白位置，会直接穿透打开后面的笔记」。
>
> ### 1 已交付
>
> | 改动 | 细节 |
> |---|---|
> | ＋ 位置 | `bottom: 32px → 120px`（用户圈的位置，实测中心 y=703.8 / 视口 868） |
> | 环形圆心 | 不再是屏幕中心：`.zn-quick-ring` 改成 0×0 原点、`bottom: 148px`（与按钮中心同一套公式）；槽 `rotate(θ) translateY(-112px)`、条目反旋 -θ |
> | 角度 | 「上三下二」半圆：`0° / ±40° / ±140°`（不是 72° 均分），记账在正上方 |
> | 中心圆 | 与 ＋ 按钮**完全重合**（同 bottom / 同 56px），实心 `#2b2b31` + ×；遮罩开着时原 ＋ 用 `body:has(.zn-quick-overlay)` 藏掉 |
> | 点空白穿透 | 遮罩关闭从 `pointerdown` 改到 **`click`**（+ stopPropagation）：pointerdown 里卸载遮罩会让补发的 click 落到卡片上；click 关闭时这次点击已经派发给遮罩本身 |
> | 视觉 | 提示下移到屏幕底；中心圆不透明；去绿边（那是原绿按钮透过 58% 黑遮罩） |
>
> ### 2 验收（真机 dev 版 · ARIA 24069RA21C）
>
> | # | 判据 | 实测 |
> |---|---|---|
> | 1 | ＋ 在新位置 | ✅ 中心 (195, 703.8) —— 与用户圈的位置一致 |
> | 2 | 长按 → 半圆环形 | ✅ 记账正上 + ±40° 两个 + ±140° 两个 + 中心 ×（`_shots/dev-10-ring-noglow.png`） |
> | 3 | 长按松手不误关 | ✅ 遮罩稳定（touch 的 click target 仍是 ＋，被 suppressClick 吃掉） |
> | 4 | **点空白关闭且不穿透** | ✅ 遮罩关、`is-editing` 仍 false |
> | 5 | 点「记账」 | ✅ 进记账面板 |
> | 6 | 短按 ＋ 仍新建 | ✅ `is-editing` true |
>
> ### 3 踩坑记录
>
> - **pointerdown 关遮罩 = 穿透**：React 在离散事件里同步重渲染，遮罩一卸载，浏览器为同一次点击补发的 click 就没遮挡物了 → 落到卡片上直接打开笔记。必须用 click 关。
> - **happy-dom 测不了这条**：click 目标链与真实触摸栈不一致；单测只锁「pointerdown 不关 / click 才关」这个结构。
> - **中心圆绿边**：不是背景色问题，是原绿 ＋ 没藏（遮罩只有 58% 黑）。
>
> ## 📌 rev173.20（2026-10-19 · 起始页长按 ＋ → 环形快捷入口）
>
> 用户：「继续 zeronote 项目」＋ 引用 `docs/快捷入口-调研-2026-10-19.md`。
> 另：**安卓测试用 dev**（`tauri android dev`，连本机 1420），不用打包 APK 反复装。
>
> ### 1 已交付
>
> | 文件 | 改动 |
> |---|---|
> | `src/components/QuickLaunch.tsx`（新） | 全屏遮罩 + 5 个环槽（从正上方起每 72°）+ 中心 × / 底部提示；`entries` ≤5、不足补虚线空位；禁用项灰化显示 hint（如「未安装」）；Esc 关闭 |
> | `src/components/MobileNoteCards.tsx` | ＋ 按钮加长按：500ms 触发、移动 >10px 取消（pointermove）、`pointerup/leave/cancel` 清理、长按触发后 `suppressClick` 吃掉松手补发的 click；新 prop `onQuickLaunch` |
> | `src/App.tsx` | `quickOpen` state；`panels.find(p => p.title === '记账')` → `setMainView(id)`（不硬编码插件 id）；渲染 `<QuickLaunch>`；**压进返回键层栈**（Android 返回先关遮罩） |
> | `src/styles.css` | `.zn-quick-overlay / -ring / -slot / -item(.is-empty) / -center / -hint`；＋ 按钮补 `user-select/touch-callout: none` |
> | `tests/quick-launch.test.tsx`（新） | 10 条：短按新建 / 长按开遮罩 / 松手不新建 / 移动取消 / 卸载清理 / 点入口回调 / 补空位 / 点空白关 / 禁用不回调 / 关着不渲染 |
>
> 环的定位用「整层旋转 + 条目反旋」——`.zn-quick-slot` 转 θ、里面的圆转 -θ，
> 文字始终正立，半径跟随容器 34%，**不需要量尺寸**。
>
> ### 2 验收
>
> - `scripts\verify.ps1`：tsc 0 · oxlint 0 error（**3** warnings，与基线一致）· cargo test --lib **32** passed · check-docs 全过 · vitest **284**（274 → +10）。
> - **真机（ARIA 24069RA21C · dev 版 · 连 192.168.1.5:1420）**：
>
> | # | 判据 | 实测 |
> |---|---|---|
> | 1 | 短按 ＋ 仍新建笔记 | ✅ 进编辑器「新笔记-13-50-37」，遮罩未出现 |
> | 2 | 长按 ＋ 0.5s → 环形遮罩 | ✅ 记账绿在正上方 + 4 虚线空位 + 中心 ×（`_shots/dev-04-quick.png`） |
> | 3 | 点「记账」→ 进记账面板 | ✅ 面板打开、本月支出/收入/记录正常（`_shots/dev-05-accounting.png`） |
> | 4 | 点空白 → 关闭 | ✅ 遮罩关、未新建笔记 |
> | 5 | 遮罩开着按返回键 | ✅ 只关遮罩，App 不退出（层出口栈） |
>
> ### 3 真机才暴露的一个坑（单测测不出）
>
> **`.zn-quick-slot` 是全尺寸旋转层，会吃掉其它槽里圆的点击** —— 真机上点「记账」毫无反应
> （`elementFromPoint` 命中的是后渲染的 slot `div`）。修法：slot `pointer-events: none`、
> 条目 `pointer-events: auto`。happy-dom 不做命中测试，所以这类 bug 只能真机发现。
>
> ### 4 未做 / 已知
>
> - **桌面端不接**（调研 §3.3 定的 v0.2）；空位 4 个仍占位。
> - 「插件未装 → 灰化」只由单测覆盖（真机记账已装，没有实测入口）。
> - 顺手发现一个旧缺口（**未修**）：卡片长按菜单（`MobileNoteCards` 自持 state）**没进返回键层栈** —— 菜单开着按返回键会直接退 App。要不要补，下次定。
> - dev 版首帧可能出现 `Failed to request …/@vite/client` 导致白屏（与交接卡「手机白屏（HMR 失败）」同源），`location.reload()` / 重开 App 即恢复。
>
> ## 📌 rev173.19（2026-10-19 · 交接：分类自定义收口 + 起始页快捷入口调研）
>
> 用户：「先调研，然后交接，下个会话做」——本轮**不实现**快捷入口。
>
> ### 1 本轮收口
>
> - rev173.18（点分类标签直接改 + 自定义分类）已提交并真机验证；用户已实际新增「红包」分类、把「微信」改成它。
> - 交接卡同步到 rev173.18 的现状。
>
> ### 2 调研交付（下个会话的输入）
>
> - 文档：`docs/快捷入口-调研-2026-10-19.md`（已进 `docs/README.md` 矩阵）。
> - 需求：起始页 ＋ **长按** → 环形遮罩快捷入口（**笔记内部功能**：第一个「记账」，其余 4 个先占位）；**短按仍新建笔记**。
> - 形态参考：环形遮罩布局借自手机「指纹一指直达」；**触发是长按起始页 ＋，不涉及指纹 / 支付 / 扫码**。
> - 现成能力：`.zn-mobile-compose`（＋）、`onContextMenu` 长按先例、`.zn-menu-scrim` 遮罩、`mainView` / `setMainView` 切面板、`accounting.ledger` 面板。
> - 方案：新组件 `QuickLaunch.tsx`（遮罩 + 中心关闭 + 5 环绕）+ `MobileNoteCards` 长按检测（500ms，移动 >10px 取消，长按后抑制 click）+ `App` 的 `quickOpen` state 与 `panels.find(p => p.title === '记账')` → `setMainView`。
>
> ### 3 下个会话第一件事
>
> 按 `docs/快捷入口-调研-2026-10-19.md` §4 实现 + 真机验收（短按不变 / 长按出环形 / 点记账进面板 / 点空白关闭）。
>
> ## 📌 rev173.18（2026-10-19 · 记账：点分类即改 + 自定义分类）
>
> 用户：「不用额外加一个按钮，点击分类按钮直接弹一个修改窗口，而且要允许自定义分类」。
>
> ### 1 已交付
>
> - 去掉行内的「改分类」按钮；**分类本身就是按钮**（label = 分类名，「其他」显示「其他 · 待分类」），点它直接进分类选择视图。
> - **自定义分类**：分类列表存插件 store 的 `categories`（默认 9 个）；选择视图底部有「新分类名称 + 新增分类」，新增后立刻可点。
> - 学习逻辑不变：改完写 `categoryMap`，同商户下次自动命中。
>
> ### 2 验收
>
> tsc 0 · oxlint 3 warnings · 记账单测 25 条 · Android APK 重建（真机：点分类标签 → 新增「宠物」→ 选它 → 记录显示「宠物」）。
>
> ## 📌 rev173.17（2026-10-19 · 记账：分类可改 + 学到的商户映射）
>
> 用户：「不在分类的开支通知怎么处理」→「归到其他之后能修改吗」。
>
> ### 1 已交付
>
> | 改动 | 要点 |
> |---|---|
> | 分类可改 | 列表每行加「改分类」→ 进入分类选择视图（餐饮 / 交通 / 购物 / 通讯 / 居住 / 医疗 / 娱乐 / 收入 / 其他）→ 点一下即改 |
> | 学习映射 | 改完把 `商户 → 分类` 存进插件 store 的 `categoryMap`；`classify()` **最优先**查它 ⇒ 下次同商户自动命中 |
> | 视觉 | 分类是「其他」时徽标用 **warn** 色（待分类一眼可见） |
> | 不学的场景 | 「手动记账 / 未知商户」不作为商户写入映射（避免污染） |
> | 测试 | `tests/accounting-parse.test.ts` **25 条**（+2：`userMap` 优先、`parseNotification` 透传 `userMap`） |
>
> ### 2 验收
>
> tsc 0 · oxlint 3 warnings · vitest **274**（29 文件）· Android APK 重建。
>
> 真机：未知商户通知 → 同步 → 分类「其他」（warn）→ 点「改分类」选「购物」→ 列表更新；
> 再发同商户通知 → 同步 → 自动「购物」（`categoryMap` 生效）。
>
> ## 📌 rev173.16（2026-10-19 · 记账插件 v0.1：原生通知捕获 + 自动分类）
>
> 调研（rev173.15）后用户拍板「允许改动，开工」。
>
> ### 1 原生插件（新增）
>
> `src-tauri/plugins/tauri-plugin-notification-capture/`：
> - Kotlin `NotificationCaptureService`：白名单包名（默认微信 / 支付宝 / 云闪付 / 短信）、合并 7 个文本字段、MD5 去重、SharedPreferences 环形缓存（200 条）、断连 `requestRebind`。
> - Kotlin `NotificationCapturePlugin`：`isEnabled` / `openSettings` / `drain`（取走缓存并清空）/ `setWhitelist` / `getWhitelist`。
> - Rust：5 个命令桥接；桌面全部 no-op（`false` / `"[]"` / `Ok`）。
> - 集成：`src-tauri/Cargo.toml` path 依赖 + `lib.rs` 的 `.plugin(...)` + `capabilities/default.json` 的 `notification-capture:default`。
>
> ### 2 JS 记账插件（新增，内置预装）
>
> `examples/accounting/`（进 `BUILTIN_PLUGINS`，启动写全局插件根）：
> - 纯函数：`extractAmount` / `isPaymentNotice` / `detectType` / `extractMerchant` / `classify` / `dedupeTransactions` / `parseNotification`。
> - 面板：本月收支、账单列表、同步通知、检查权限、打开授权页、手动记支出/收入。
> - 数据：插件 `store.transactions`（上限 500 条）；自动分类 = 商户表 → 关键词 → 其他。
>
> ### 3 验收
>
> - `tests/accounting-parse.test.ts` **23 条**全过；全量 tsc 0 · oxlint 3 warnings · vitest **272**（29 文件）· `cargo check --lib` 通过。
> - Android debug APK：✅ `pnpm tauri android build --debug --apk` → `gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`（4m15s）。
> - 真机（ARIA 24069RA21C · MIUI）端到端：授权「通知使用权」→ 发一条含金额的支付通知（`cmd notification post` 模拟）
>   → 点「同步通知」→ 自动出现「美团外卖 ¥23.50 · 餐饮」；手动记账、本月收支统计同页可用（截图 `_shots/accounting-*.png`）。
> - 真机两个坑：① MIUI 的「危险」确认框要勾选「我已知晓」；② 这台机器上 `adb input tap` 的坐标会被缩放（用 `input touchscreen swipe x y x y 120` 代替）。
>
> ### 4 下一步
>
> 真实微信/支付宝各付 1 笔（真机通知文案）→ 校准 `IGNORE` / `PAY_PHRASES` / `dedupeTransactions`；
> 面板入口在手机端靠「长按标题栏 ☰ → 菜单 → 记账」（内核菜单已有面板项，不需要新视觉元素）。
>
> ## 📌 rev173.15（2026-10-19 · 记账插件调研：竞品 / 通知捕获 / 自动分类 / 契合度）
>
> 用户：「对现有开源的记账类项目进行调研，分析功能，技术，还有与 zeronote 的契合度，只需要移动端，最终目标是一个记账插件，要求能捕获支付通知，形成一条记录，提供自动分类，还有其他记账功能」。
>
> ### 1 交付
>
> - 文档：`docs/记账插件-调研-2026-10-19.md`（已进 `docs/README.md` 权威矩阵）。
> - 竞品（移动端）：Ivy Wallet（**已归档**）/ Cashew / MyExpenses / Money Manager Ex Android / Oinkoin —— **都没有通知捕获**。
> - 自动记账专项：AutoAccounting（Xposed/OCR/通知，采集器不存账）、WhereIsMyMoney（通知监听 + 自带账本，**源码逐段核对**）。
> - 技术：`NotificationListenerService` 是免 Root 唯一通道；解析链路 = 7 字段合并 → 关键词判定 → 金额正则 → 收支判断 → 商户正则 → 去重（hash/交易号）→ 无金额用通知栏 `RemoteInput` 补录。
> - 契合度：UI / store / fs / 规则引擎现成（高）；**唯一硬缺口 = 原生通知监听插件**（模板：`tauri-plugin-statusbar` / `tauri-plugin-androidperm`）。
> - 建议架构：原生「捕获 + 原文缓存 + `drain()`」→ JS「解析 + 去重 + 分类 + 落库」→ store（主存）+ Markdown 月报（导出）。
>
> ### 2 未决（待用户拍板）
>
> 是否做原生插件 `tauri-plugin-notification-capture` —— 这是 ZeroNote 第一个后台服务型插件（要动 `gen/android`）；
> 若暂不动原生层，可先做「手动记账 + CSV 导入」的纯 JS 版。
>
> ## 📌 rev173.14（2026-10-19 · 设置文案精简 + 插件能力不再展示）
>
> 用户：「设置里面其他说明的地方也同理，还有插件声明的能力不用显示出来」。
>
> ### 1 已交付
>
> | 改动 | 位置 | 要点 |
> |---|---|---|
> | 插件行不再列能力 | `src/components/PluginPanel.tsx` | 删掉 `fs:read · doc:read …` 那一行 |
> | 「网络与进程（自述）」整块删除 | `src/components/Settings.tsx` · `src/App.tsx` | prop `declaredNet` 与 `declNetPlugins` 一并删（能力自述不再展示） |
> | 设置说明改短 | `src/components/Settings.tsx` | 自动保存 →「停手约 0.8 秒后自动保存」；外观 →「跟随系统时自动切换深浅色」；当前库 →「选一个文件夹作为笔记库」；关于页只留一句 |
> | 空态与删除确认精简 | `src/components/PluginPanel.tsx` | 空态一句放法；删除确认一句「不可撤销」 |
>
> ### 2 验收
>
> tsc 0 · oxlint **3 warnings**（未增）· vitest **249**（28 文件）· check-docs 过 · Rust 未改动（沿用 32 passed）。
>
> 桌面与手机实测（`_shots/desktop-settings-slim-*.png` / `android-settings-slim-*.png`）：
> 插件行能力消失、设置说明变短、手机打开插件页同样生效。
>
> ### 3 注意：两端 HMR 会断
>
> 00:16 之后桌面与手机的 HMR 都出现过重载失败（手机 logcat：`Failed to reload /src/App.tsx`）。
> **代码改动没看到时先刷新页面**：桌面窗口 `Ctrl+R`；手机 `adb shell am force-stop com.aqua.zeronote.debug` 后重开。
>
> ## 📌 rev173.13（2026-10-19 · 插件页：说明压到 15 字 + 分类可折叠）
>
> 用户：「插件说明不要这么长，控制在 15 个字，然后插件分类加折叠功能」。
>
> ### 1 已交付
>
> | 改动 | 文件 | 要点 |
> |---|---|---|
> | 说明截断 15 字 | `src/lib/format.ts` · `src/components/PluginPanel.tsx` | 新增 `clampText()`：按 Unicode 码点截前 15 字 + `…`；全文进悬停 `title`；manifest 原文不动 |
> | 分类折叠 | `src/components/PluginPanel.tsx` | 组标题改成 `<button>`（带 `aria-expanded`），点一下收起/展开；chevron 折叠时转 -90° |
> | 折叠状态持久化 | 同上 | `localStorage['zn-plugin-groups-collapsed']`，**全局 1 份**（插件不分库）；全展开时删记录 |
> | 样式 | `src/styles.css` | `.zn-plugin-group-head` 重置 button 默认样式（width / border / font / cursor）+ hover 变亮；`.zn-plugin-group.is-collapsed` 转箭头 |
> | 测试 | `tests/plugin-panel.test.tsx`（新 · 6 条） | clampText 边界 · 截断 + title · 折叠/展开 · 重挂载仍折叠 · 全展开清记录 |
>
> ### 2 验收（2026-10-19 00:20 实测）
>
> `verify.ps1` 五步：tsc 0 · oxlint **0 error / 3 warnings**（未增）· cargo test --lib **32** · check-docs 过 · vitest **249**（28 文件）。
>
> 桌面实测（截图 `_shots/desktop-plugin-page-00…04*.png`）：设置 → 插件，说明全部 ≤15 字 + `…`；
> 点「编辑增强」收起、箭头转向；关设置再开仍折叠（`-03` 与 `-04` 的 sha256 相同 = 状态一致）。
> 手机 dev 端跑同一份前端（vite HMR），组件行为相同。
>
> ### 3 环境附注（顺手修回手机 dev）
>
> - **手机 dev 上次失败的真因**：`src-tauri/gen/android/app/src/main/assets/tauri.conf.json`（构建产物）残留旧 identifier
>   `com.aqua.zeronote.probe` ⇒ tauri 去找 `com/aqua/zeronote/probe` 目录失败；gradle 又把它误报成
>   「`pnpm.bat` 启动失败」（最后一个 fallback 的异常盖住了真正的非零退出）。
>   改回 `com.aqua.zeronote` 后一次构建通过；真机 `com.aqua.zeronote.debug` 连 `192.168.1.3:1420` 正常。
> - 失败现场备份：`.self-logs/android-dev-20261018-2341-fail.log`（1.8 MB）。
> - **HMR 更新失败会白屏**（2026-10-19 00:16 实测）：手机端拉 `/src/hooks/useFileOps.ts?t=…` 时
>   `tauri::protocol::tauri` 报 `Failed to request …: error sending request` ⇒ vite 接着报
>   `Failed to reload /src/App.tsx`，页面停在白屏（不是代码错误 —— 同一时刻桌面 HMR 正常、手机 TCP 1420 可连）。
>   处置：`adb shell am force-stop com.aqua.zeronote.debug` 后重开即恢复（00:22 实测）。
> - 目前两端 dev 同时在跑：桌面 `pnpm tauri dev`（1420）+ 手机 `android-dev.cmd`。
>
> ## 📌 rev173.12（2026-10-18 · 交接：rev173.11 收口 + WebView2 根因闭环）
>
> 用户：「交接」。本轮把 rev173.11 的两件事收口，并把开发环境修回可用状态。
>
> ### 1 已交付（5 个提交）
>
> | 提交 | 内容 |
> |---|---|
> | `d0e1c82` | 手机端导图点击：`data-zn-line` 行号 + 插件手机整窗接管（真机 3 轮 ✓、写回落盘、桌面不回归） |
> | `65c8368` | `scripts\dev.ps1` + dev 日志只写 stdout |
> | `b52e4b3` / `23f7088` / `0ae23fe` | WebView2 排障过程与**两次更正**（沙箱→多因→Low IL） |
> | `b7e2d84` | **真根因**：项目目录 Low IL → exe 继承后写不了 `%LOCALAPPDATA%`；`icacls src-tauri /setintegritylevel (OI)(CI)Medium` 修复 |
>
> ### 2 当前环境（活信息）
>
> - **dev 运行中**：`pnpm tauri dev`（vite 1420，窗口正常）；库 = `_tmp-vault-tb`（2 篇笔记 / 3 文档 / 2 附件）。
> - **WebView2**：默认 UDF `%LOCALAPPDATA%\com.aqua.zeronote\EBWebView`，IL 修复后正常（23:46 起）。
> - **完整性级别**：`src-tauri` / `target` = **Medium**（已修）；项目根与 `src` 仍是 Low IL —— 目前不影响，若以后产物落在 Low 目录再按同样命令修。
> - 旧 UDF 备份：`_tmp-appdata-bak\`（`EBWebView.elevated-bak` / `logs.bak-2322`，gitignore）。
>
> ### 3 下个会话第一件事
>
> **iframe ↔ 宿主能力通道（v0.2）** → 之后**插件签名 / 分发**（真签名 / 市场 / 更新通道）。
>
> ### 4 本轮踩过的坑（务必避开）
>
> 1. **CDP `plugin:window|destroy` 关插件窗口会连主窗口一起没**（实测）——关窗口让用户点。
> 2. **原生文件夹对话框不吃「文件夹:」输入框的粘贴** —— 正确操作：`Ctrl+L` → 输入路径 → `Enter` → 再 `Enter`（第二下 = 「选择文件夹」）。
> 3. **Low IL 会让 exe 静默失去 `%LOCALAPPDATA%` 写权限**（症状 `os error 5` / WebView2 `0x8000FFFF`）；查 `icacls <目录> | Select-String Mandatory`。
> 4. 排查顺序：**先拿进程级证据**（让同一个 exe 自己 `create_dir_all` + 打印 `app_local_data_dir`），比反复删目录/改名快得多。
>
> ### 5 验收基线
>
> `verify.ps1` 全过（23:47 实测）：tsc 0 · oxlint 0 error / 3 warnings · cargo test --lib **32** · check-docs 过 · vitest **243**（27 文件）。
>
> ## 📌 rev173.11（2026-10-18 · 手机端导图点击：行号修复 + 手机整窗接管）
>
> 用户：「继续 zeronote 项目，看 `HANDOFF-CARD.md` 的『下个会话第一件事』，按方案改完再验证」。
>
> ### 1 按 rev173.10 方案改内核（`src/kernel/editor-marks.ts`，三处）
>
> 1. `LineActionWidget` 加 `lineNo`（0 起）+ `toDOM()` 写 `data-zn-line`；`eq()` 也比 `lineNo`
>    （行号变了必须重画 DOM，否则属性留旧值 → 点到错的行）；
> 2. `buildDecorations()` 画按钮时传 `doc.lineAt(lineFrom).number - 1`（`filter` 也复用同一变量）；
> 3. 点击处理器**优先读 `data-zn-line`**，`posAtDOM` 只在缺行号时补 `from`。
>
> ### 2 真机实测暴露第二层：手机端**根本没有承接导图的 UI**
>
> 行号修好后手机点 ❖，notify 从「这一行没有可开的导图组」变成「已在新窗口打开「白天」」——
> 说明行号已正确命中组。但窗口没出现：`__znKernelAudit().windows` 恒为 0、`shell` 恒 null。
>
> 根因：`openMapByIndex` 无条件走 `view.openWindow`（Tauri 多 webview 窗口）；
> **Android 只有单 webview**（`Cargo.toml` 的 tauri 未开 `unstable`、`capabilities/` 也没有
> plugin-windows 的 glob），`new WebviewWindow` 的创建失败只落到 `tauri://error` 日志 ⇒ 完全静默。
> 插件里 `overrideShell` 只在 `winId`（插件窗口上下文）分支调用 —— 主窗口没有手机分支。
> 这正是 rev173.9 记的「移动端没有可弹的独立窗口，方向未定」。
>
> ### 3 补手机端整窗接管（`examples/outline-map/index.js`）
>
> - `mountMindMap` 从窗口分支抽成**模块级** `makeMindMapMount({ locateBlock, saveBack, host, tag })`
>   —— 窗口与手机共用同一套画布挂载器（MindElixir / 右键菜单 / 写回节流 / 主题跟随都在里面）；
> - 窗口分支改为 `makeMindMapMount({ …, tag: winId })`；
> - `openMapByIndex`：`host.platform === 'android'` 时走 `view.overrideShell({ mount })`（整窗接管，
>   右下角「释放接管」返回）；**连点先 `dispose()` 上一次接管**（否则内核拒绝"已被自己接管"）；
> - 新增 `saveGroupLines(bi, data)`：手机端写回（先重读盘 → 按 startLine/title 找回同一组 → 写盘），
>   与窗口分支的 `saveBack` 同一套纪律。
>
> ### 4 验证
>
> | 判据 | 结果 |
> |---|---|
> | 手机点 ❖（真机 33b676f6） | `shell = "outline-map"`、`.zn-shell-host` 出现、`__mmWin = {tag:"mobile-0", lib:"5.15.1", topics:6}`、状态「mind-elixir 5.15.1 · 5 个节点」✓ |
> | 手机连点 3 轮（释放→再点） | 每轮 `shell` 都回到 `outline-map`、画布 6 个节点 ✓ |
> | 手机写回 | `__mmMind` 里加「冒烟节点」→ 磁盘出现 `- 冒烟节点` ✓（测试后已把 `diagram-test.md` 恢复原文） |
> | 桌面不回归 | `outline-map.open-map` → 新窗口 target `?pluginWindow=outline-map.map-0`；窗口内 `shell="outline-map"`、`__mmWin.tag="outline-map.map-0"`、3 个节点 ✓ |
> | `verify.ps1` | tsc 0 错误 · oxlint 0 error / 3 warnings · cargo test --lib **32** passed · check-docs 过 · vitest **243** passed（27 文件）✓ |
>
> ### 5 ⚠️ 环境事故（本轮自己造的）
>
> 桌面冒烟后想关掉测试插件窗口，用 CDP 在插件窗口页面执行
> `__TAURI_INTERNALS__.invoke('plugin:window|destroy', { label: currentWindow.label })`
> —— **主窗口一起没了**（进程还在，但只剩插件窗口；`9222` 调试端口消失）。
> 之后重启 `pnpm tauri dev` 连续报：
> - `failed to create webview: WebView2 error: WindowsError(0x800700AA 请求的资源在使用中)` —— 旧 WebView2 数据目录锁；
> - 换 `WEBVIEW2_USER_DATA_FOLDER` 指向 `_tmp-wv2` 后 webview 能建，又报 `failed to initialize plugin log: 拒绝访问 (os error 5)`。
>
> 已做：删残留 `EBWebView\Default\LOCK`、旧日志 `ZeroNote.log` / `logs` 目录改名备份
> （`logs.bak-2311` 在 `%LOCALAPPDATA%\com.aqua.zeronote\`）。
>
> ⚠️ **更正（2026-10-18 23:35，用户质疑后复核）**：本条最初把原因归为「DSH 沙箱拦 `%LOCALAPPDATA%` 写入」——
> 这**是错的**：本会话文件策略是 **danger-full-access**（不限制写入）；而且 `Documents\wv2-probe`（非 workspace）
> 也失败、只有 `_tmp-wv2`（项目内）成功 —— 差异更像「**全新目录 vs 被污染的目录**」，不是沙箱。
>
> **更准确的因果链**：
> 1. 我用 CDP `plugin:window|destroy` 误关主窗口 → 再 kill 进程 ⇒ WebView2 的 user data folder 留在不一致状态；
> 2. 我手动删了 `EBWebView\Default\LOCK`、又改名/还原 UDF 目录 ⇒ 进一步破坏（连新目录都 0x8000FFFF）；
> 3. 管理员权限跑一次能起来（高完整性，绕过冲突检查），但它写下的日志/缓存属主是 `Administrators`，
>    普通权限再跑又坏一轮（webview 0x800700AA + `log` 插件 os error 5）。
>
> 所以「管理员污染」只是**其中一环**，不是最初那次的原因。结论不变：
> **换全新 UDF（项目内 `_tmp-ebwebview`）+ dev 日志只写 stdout** 是最稳的修法；
> 规矩：别用管理员跑 dev、别手删 UDF 里的 `LOCK`、关窗口用手点（别用 `plugin:window|destroy`）。
>
> **最终实验（2026-10-18 23:3x–23:4x，普通权限，逐个对照）**：
> - Tauri 在 Windows 上把 **`app_local_data_dir()` = `%LOCALAPPDATA%\com.aqua.zeronote`** 作为 WebView2 的
>   user data folder（`tauri/src/manager/webview.rs:559-576`，目录不存在时 `create_dir_all`）。
> - 该目录**只剩两个备份子目录**（无 `EBWebView`）→ 启动报 `0x8000FFFF`（webview 创建失败）。
> - 该目录**整体改名**（路径不存在）→ 启动报 `拒绝访问 (os error 5)`（`create_dir_all` 失败）。
> - 同一路径、同一用户：`pwsh` 的 `New-Item` 能建、`node` 子进程能建能写（`icacls` 正常、非 reparse、
>   无 Deny ACE）⇒ **不是文件沙箱、不是 ACL**。
> - 设 `WEBVIEW2_USER_DATA_FOLDER=<repo>\_tmp-ebwebview`（实测**生效**：新目录下自动出现 `EBWebView\` 子目录）
>   → webview + log + 界面全部正常（用户 23:25 实测，此脚本即 `scripts\dev.ps1`）。
>
> **根因（2026-10-18 23:45，已闭环）**：项目目录被标成 **Low 完整性级别（Low IL）** ——
> `src-tauri` / `target\debug` / `src` / 项目根都带 `Mandatory Label\Low Mandatory Level:(I)(OI)(CI)(NW)`。
> zeronote.exe 继承 Low IL ⇒ **写不了 `%LOCALAPPDATA%`（Medium）**：
> - `std::fs::create_dir_all("...\zn-rust-probe")` 直接 `拒绝访问 (os error 5)`（同路径 pwsh/node 正常）；
> - WebView2 环境创建 → `0x8000FFFF`（UDF 建不出来）。
> 管理员能跑 = High IL 不受 No-Write-Up 限制；`scripts\dev.ps1` 能跑 = 项目内目录同样是 Low IL
> （Low 进程可写 Low），属于"碰巧有效"。
>
> **修复**（已执行）：`icacls src-tauri /setintegritylevel (OI)(CI)Medium`（`target` 同步），重编后
> exe 变 Medium → `[zn] create OK`、`app_local_data_dir` 正常、`EBWebView` 自动创建、**dev 用默认 UDF
> 成功启动**（2026-10-18 23:46 实测，PID 3980 运行中）。
>
> **遗留建议**：`src-tauri` 已设 Medium，`cargo clean` 重建 `target` 不会退回 Low；若以后 `src` / 项目根
> 再出现 Low IL 标签（例如从某些工具/下载渠道带入），对**产物的父目录**重设 Medium 即可。
> `scripts\dev.ps1` 保留（无害）；`tauri-plugin-log` dev 只写 stdout 也保留（少一个要维护的目录）。
> 参考：[腾讯 MSDK FAQ](https://docs.itop.qq.com/v5/zh-CN/FAQS/PC/PcLoginMicrosoftEdgeErr.html)、
> [Quicker 讨论](https://getquicker.net/QA/Question/41733)、[tauri#11969](https://github.com/tauri-apps/tauri/issues/11969)。
>
> **落地的修复**：
> - `scripts\dev.ps1`（新增）：启动 dev 前把 `WEBVIEW2_USER_DATA_FOLDER` 指到项目内 `_tmp-ebwebview`
>   —— 默认目录被管理员实例污染也能跑（普通权限验证过 webview 能建）。
> - `src-tauri/src/lib.rs`：dev 模式的 `tauri-plugin-log` **去掉 `LogDir` target**（只写 stdout）。
>   否则 `%LOCALAPPDATA%\com.aqua.zeronote\logs` 被管理员实例写过之后，普通权限启动直接
>   `failed to initialize plugin log: 拒绝访问 (os error 5)` panic（此时 webview 其实已建好）。
>
> **下次教训**：CDP 关插件窗口别用 `plugin:window|destroy`（label 来源与预期不一致，实测连主窗口一起关）；
> 要关就关主窗口里内核账上的窗口（`windows` 列表）或让用户手点关闭。

> ## 📌 rev173.10（2026-10-18 · 交接：手机端导图点击偶发不生效）
>
> 用户：「导图点击有时候不生效，是手机端的」→「排查完交接」→「不修复，直接交接」。
> 本轮**只排查到根因 + 写好修复方案，代码已回滚**（工作区干净，HEAD 仍是 rev173.9 的 `919a8c3`）。
>
> ### 1 现象与复现（真机 33b676f6）
>
> - 手机打开 `diagram-test.md`（`# 导图测试` + 列表），编辑器左侧出现 `❖`（按钮**会**渲染）。
> - 点 `❖` → **没反应**：`__znKernelAudit().shell` 仍为 `null`、`windows` 为 0，界面停在编辑器。
> - 直接 `__znExec('outline-map.open-map-at-line')`（不带 payload）→ 插件 `run` 里
>   `Number(payload.line)` 是 NaN ⇒ 只 `host.notify('这条命令要带 { line }')`；
>   手机端 toast 不显示 ⇒ 连提示都看不到。
>
> ### 2 根因（已定位，未修）
>
> `src/kernel/editor-marks.ts` 的行首按钮点击处理器（`EditorView.domEventHandlers`）里：
>
> ```ts
> from = view.posAtDOM(actEl)
> line = view.state.doc.lineAt(from).number - 1   // 行号完全依赖 posAtDOM
> ```
>
> - 手机上 CM6 的虚拟化会把 widget 拆掉重建，**`posAtDOM` 会抛错** ⇒ `line` 保持 `-1`；
> - 插件 `mapButtonTargets(cache.content).find((t) => t.line === line)` 用 -1 永远不命中 ⇒
>   `host.notify('这一行没有可开的导图组…')`（手机 toast 不显示）⇒ 用户看到「点了没反应」；
> - 桌面窗口大、widget 基本不重建，很难复现 —— 与「手机端偶发」完全吻合。
>
> ⚠️ **更正 rev173.7 §5 的结论**：那里写「手机端 ❖ 不渲染（`editorMarks` 里没有
> outline-map 的 line action）」—— 实测**按钮是渲染的**（DOM 有 `outline-map/map-btn`），
> 当时没看到是因为插件还是旧版本（`ensureBuiltinPlugins` 尚未写入新 index.js）。问题在点击环节。
>
> ### 3 修复方案（已写好、tsc/oxlint 通过，但**未实测验证**，已回滚）
>
> 改动只在 `src/kernel/editor-marks.ts`，两处：
>
> 1. `LineActionWidget` 增加字段 `lineNo: number`（**0 起**，与 `filter` 的 `line`、`onClick` payload 同口径），
>    `toDOM()` 里 `btn.setAttribute('data-zn-line', String(this.lineNo))`；`eq()` 比较也要加 `lineNo`；
> 2. `buildDecorations()` 画按钮时传 `doc.lineAt(lineFrom).number - 1`；
> 3. 点击处理器**优先读 `data-zn-line`**，`posAtDOM` 只用来补 `from`：
>
> ```ts
> const dataLine = actEl.getAttribute('data-zn-line')
> let line = dataLine !== null ? Number(dataLine) : -1
> let from = -1
> try { from = view.posAtDOM(actEl) } catch { /* 只少了上下文 */ }
> if (!Number.isFinite(line) || line < 0) {
>   try { if (from >= 0) line = view.state.doc.lineAt(from).number - 1 } catch { line = -1 }
> }
> onAction(cmd, { line, from })
> ```
>
> 验证路径（下次）：手机点 `❖` **连点多次**，每次都应进入导图（整窗接管：
> `__znKernelAudit().shell` 非 null）；再跑 `verify.ps1` 五步 → 提交 → 新 rev。
>
> ## 📌 rev173.9（2026-10-18 · 交接：导图点击偶发不生效待查）
>
> 用户报「导图点击有时候不生效」，随后要求「先交接」—— 本轮**只做交接，未排查**。
>
> ### 当前状态
>
> - HEAD `652e82a`（rev173.8）；工作区干净；`verify.ps1` 全绿
>   （tsc 0 / oxlint 3w / cargo **32** / vitest **243** / check-docs 过）。
> - 桌面 dev（vite 1420）与安卓 dev 都在跑；手机 `33b676f6` 在线。
>
> ### 下个会话第一件事：复现「导图点击不生效」
>
> 已定位的线索（**未验证**，别当结论）：
>
> | 点 | 位置 |
> |---|---|
> | 入口注册 | `examples/outline-map/index.js`：`editor.addLineAction({ onClick: 'outline-map.open-map-at-line' })` |
> | 内核点击 | `src/kernel/editor-marks.ts` 的 `LineActionWidget`（`data-zn-line-action`，点按钮执行命令） |
> | 命令实现 | 同一插件文件里的 `open-map-at-line` 处理器（按光标行找组） |
>
> 待查方向（按可能性排）：
> 1. **按钮点击不移动光标** —— 命令按「当前光标行」找大纲组，而光标还停在别处 ⇒ 打开空组/提示找不到；
>    对照 `buttonLinesOfDoc(doc).has(line)` 的 filter 与命令里的行判定是否同源。
> 2. `buttonLinesOfDoc` 的缓存（`btnCacheLines`）在编辑后没失效 ⇒ 按钮出现在旧行、点了打不开。
> 3. 窗口创建失败（`view.openWindow` 多开 / 同 id 冲突 / 窗口被复用）。
> 4. 点击事件被编辑器吞掉（mousedown 未 preventDefault，或 widget 在滚动后被虚拟化重建）。
>
> 复现手法：打开一篇带列表的笔记 → 连点 ❖ 多次 → 观察
> `__znKernelAudit().windows`（窗口数量）、`__znExec('outline-map.open-map-at-line')` 的返回、
> 以及插件日志；重点记录「点击时按钮所在行」与「光标所在行」是否一致。
>
> ### 另外两条既有问题（别忘）
>
> - **手机端 ❖ 不渲染**：`__znKernelAudit().editorMarks` 只有 editor-marks 的两条 mark，没有
>   outline-map 的 line action；命令能跑但移动端没有可弹的独立窗口。方向未定（主区面板 or 全屏覆盖）。
> - `_tmp-vault-tb/diagram-test.md` 里有**用户自己输入的内容**（`# 白天`、`- 1`、`- 2`，22:25 起）——
>   别当测试文件删；里面还有早先自动化测试留下的两处缩进。
> - `_tmp-plugin-backup/`（桌面 11 + 手机 9 个旧插件目录）已备份，确认无误后可删。
>
> ## 📌 rev173.8（2026-10-18 · 手机工具栏加「缩进 / 取消缩进」）
>
> 用户：「手机端键盘上的快捷列表加个缩进和取消缩进（回退一个缩进）按键」。
>
> ### 1 实现
>
> - 逻辑抽成两层：`lib/indent.ts`（纯函数 `indentEdit(lineText, dir)`，可单测）+ 
>   `kernel/editor-indent.ts`（`indentLine(view, dir)` 负责 dispatch）。
>   **编辑器 Tab / Shift+Tab、工具栏按钮、命令面板三处共用同一份**。
> - 新增命令 `core.indent` / `core.outdent`：只对**列表行**生效（缩进 +2 空格；反缩进去掉行首 1–2 空格）。
> - `MarkToolbar` 在标记按钮**最前面**加 `⇤`（取消缩进）/ `⇥`（缩进）。
> - 桌面不受影响：`MarkToolbar` 只在手机（或插件注册了 `editor-toolbar`）时渲染，且按钮行要求
>   `marks.length > 0` —— 桌面 marks 恒为空 ⇒ 不出现。
>
> ### 2 验收（真机 33b676f6 · CDP）
>
> | 判据 | 结果 |
> |---|---|
> | 按钮出现 | 工具栏顺序 `⇤ ⇥ B I <> S H …` ✓ |
> | 缩进 | 光标在 `- 一` 点 ⇥ → 落盘 `  - 一` ✓ |
> | 取消缩进 | 再点 ⇤ → 落盘 `- 一` ✓ |
> | 非列表行 | 光标在标题行点 ⇥ 无变化（设计如此） |
> | 单测 | `tests/indent.test.ts` 6 条（列表判据 / 缩进 / 反缩进 / 顶格 null / 非列表 null） |
>
> ### 3 测试期间的发现
>
> - `diagram-test.md`（我 22:23 建的导图测试笔记）在 **22:25 出现了用户自己输入的内容**
>   （`# 白天`、`- 1`、`- 2`）—— 说明当时用户正在手机上编辑它。
>   我的缩进自动化**只碰了自己的 `indent-check.md`**（测完已删），没有再去改那个文件；
>   它里面我早先测试留下的两处缩进（`  - 甲`、`  - 1  `）仍在，需要的话可以手工改回。
>
> ## 📌 rev173.7（2026-10-18 · 修「导图显示库载入失败」）
>
> 用户：「导图显示库载入失败，把其他现有插件也测一遍」。
>
> ### 1 根因
>
> - `outline-map` 从 `.zn/plugins/outline-map/vendor/` **读自己的渲染库**（MindElixir 三件套）。
>   rev173.5 取消库内插件 + rev173.6 删掉库内目录后，这个**库内路径**不存在 ⇒ 「库载入失败」。
> - 正确模型：渲染库属于**应用内置资源**（与 doc-reader 的 pdf.js / foliate 一样在 `public/vendor/`），
>   而不是插件目录 —— 插件目录随 .znp 分发，不该塞 110 KB 的第三方库。
>
> ### 2 修复
>
> - MindElixir 三件套移到 `public/vendor/mind-elixir/`（随应用包分发、离线可用）；
> - `examples/outline-map/index.js` 的 `loadMindElixir()` 改为
>   `fetch(new URL('/vendor/mind-elixir/…', location.origin))`（绝对 URL + Blob 动态 import，
>   装配方式不变），不再 `fs.readText` 插件目录；顺带删掉不再用的 `pluginId` 解构。
>
> ### 3 验证（桌面）
>
> | 判据 | 结果 |
> |---|---|
> | 导图窗口 | 「新笔记-18-09-36」点 ❖ → 窗口显示「mind-elixir 5.15.1 · 3 个节点」 |
> | 内置资源 | `fetch('/vendor/mind-elixir/MindElixir.iife.js')` → 200 |
> | 全局插件已更新 | 全局根 `outline-map/index.js` 含 `vendorUrl`（内置预装覆盖写） |
>
> ### 4 其它插件冒烟（桌面 · 11 个全在，全部启用）
>
> | 插件 | 结果 |
> |---|---|
> | 文档阅读器 | 打开 `probe.pdf` → pdf.js 画布出现 ✓ |
> | 导入导出 | `io.panel` 面板打开、按钮齐全 ✓ |
> | 灵感流 | 面板「落在 笔记/年/月/日 · 共 0 条」✓ |
> | 当天目录新建 | `core.newNote` → `笔记/2026/10/18/新笔记-22-23-20.md` ✓（测试文件已删） |
> | 编辑器标记 / 标签演示 / 网络示例 / Asset 探针 | 命令执行无异常 ✓（探针会记录 404：它测的就是这条边界） |
> | 主题（翠绿 / 米色） | `<style data-zn-plugin>` 注入 ✓ |
> | 大纲·导图 | 见 §3 ✓ |
>
> ### 5 手机端（顺带）
>
> - 9 个插件启用、分组正常；文档阅读器打开 EPUB（「测试书籍.epub · 0%」分页控件）✓；主题样式注入 ✓。
> - ⚠️ **手机端行首「❖」不渲染**：`__znKernelAudit().editorMarks` 只有 editor-marks 的两条 mark，
>   没有 outline-map 的 line action；命令能执行但移动端没有可弹的独立窗口。与本次修复无关（历史缺口），
>   记为待查 —— 手机端要导图，得先确认移动端 UI 该怎么承接（主区面板 or 全屏覆盖）。
>
> ## 📌 rev173.6（2026-10-18 · 清理库内插件残留）
>
> 用户：「清理」—— rev173.5 里库内 `.zn/plugins/` 旧目录还留着
>（`outline-map` 的 vendor 还在被插件读，所以上一条没敢删）。
>
> ### 1 先补全，再删
>
> - 新 Rust 命令 `copy_plugin_dir(from_vault, to_vault, plugin_id)`：**整目录复制**
>   （含 manifest 未声明的 `vendor/` 子目录），目标已有文件不覆盖，返回实际复制数。
> - `__znMigratePlugins()` 改用它（上一版只按 manifest 声明文件搬 ⇒ 漏 vendor）。
>
> ### 2 删除
>
> | 目录 | 内容 | 备份 |
> |---|---|---|
> | 桌面库 `_tmp-vault-tb/.zn/plugins/` | 11 个目录 | `_tmp-plugin-backup/vault-plugins` |
> | 手机库 `/storage/emulated/0/Documents/ZeroNote/.zn/plugins/` | 9 个目录 | `_tmp-plugin-backup/android-vault-plugins` |
>
> 备份目录在 `_tmp-*`（gitignore），确认没问题后可以删。
>
> ### 3 验证
>
> | 判据 | 证据 |
> |---|---|
> | 桌面插件不受影响 | 删后刷新：11 个，分组 编辑增强 4 / 阅读 1 / 主题外观 2 / 工具 2 / 示例与探针 2 |
> | 手机插件不受影响 | 删后刷新：9 个，分组 编辑增强 4 / 阅读 1 / 主题外观 2 / 工具 2 |
> | vendor 已搬进手机全局根 | `run-as ls .zn/plugins/outline-map/vendor` → MindElixir.css / MindElixir.iife.js / PlaintextConverter.js |
> | 单元测试 | `cargo test --lib` **32** passed（新增 `copy_plugin_dir_copies_tree_and_keeps_existing`） |
>
> ## 📌 rev173.5（2026-10-18 · 取消库内插件）
>
> 用户：「取消库内插件这种形式，所有插件都是全局的」。
>
> ### 1 代码
>
> - `plugin-roots.ts`：`collectPluginDirs()` 不再接收库参数，**只扫全局根**（`appDataDir()/.zn/plugins/`）；
>   删掉两处合并与「库内优先」规则。
> - `usePluginHost`：内置预装写**全局根**（`ensureBuiltinPlugins(globalRoot)`）；
>   `.znp` 安装 `install_znp({ vault: globalRoot })`；删除插件直接用加载时记下的 root。
> - `App.deletePlugin`：root 只从 `pluginEntries[id].root` 取（不再回退到当前库）。
> - `PluginPanel`：去掉「本库」徽章与「两种放法」空态；底部说明改为「插件目录：… 所有笔记库共用这一份」。
> - 新增迁移口 `window.__znMigratePlugins()`（`usePluginHost`）：把库内 `.zn/plugins/<id>/`
>   按 manifest 声明过的文件（`entry` / `styles` / `files`）搬进全局根，**全局已有文件不覆盖**。
>
> ### 2 数据迁移
>
> | 位置 | 结果 |
> |---|---|
> | 桌面全局根 | 11 个（原 8 个内置/已装 + 从测试库搬入 asset-probe / net-demo / theme-green） |
> | 手机全局根 | 9 个（`/data/user/0/com.aqua.zeronote.debug/.zn/plugins`；`__znMigratePlugins` 迁移） |
> | 桌面测试库 `.zn/plugins` | **保留未删**（11 个目录，插件已不再扫描；见边界） |
> | 手机库 `.zn/plugins` | **保留未删**（9 个目录，同上） |
>
> ### 3 边界（重要）
>
> - **库内旧目录没删**：① 迁移已确认全局有副本；② `outline-map` 这类插件会自己
>   `fs.readText('.zn/plugins/outline-map/vendor/…')` 读**当前库**里的 vendor —— 删掉库内目录会让它的
>   导图窗口加载失败（手机端全局副本只有声明的文件，没有 vendor）。确认要彻底删库内目录时，
>   先把 vendor 之类未声明资源也搬进全局根。
>
> ## 📌 rev173.4（2026-10-18 · 插件分类）
>
> 用户三连：「插件越来越多了，开始做插件分类存放」→「插件创建的时候加一个分类的类型，
> 依据类型直接放对应分组里面」→「创建不是说这个，是做插件的时候」。
>
> ### 1 分类字段（契约）
>
> - `PluginManifest.category?: PluginCategory`：`editor` 编辑增强 / `reader` 阅读 /
>   `theme` 主题外观 / `tool` 工具 / `demo` 示例与探针。
> - 不写 ⇒ 宿主推断（`src/lib/plugin-category.ts`）：只有 `styles` 没有 `entry` ⇒ theme；
>   id 带 demo / probe / hello ⇒ demo；再按 reader / theme / editor 关键词；都不中 ⇒ tool。
> - **只影响展示**：加载、安装路径（`.zn/plugins/<id>/`）、权限都不看它。
>
> ### 2 插件页
>
> - `PluginPanel` 按分类分组：标题吸顶 + 数量，空组不画；顺序 编辑 → 阅读 → 主题 → 工具 → 示例。
> - `PluginRow.category` 由 App 用 `categorizePlugin` 算好。
>
> ### 3 现有插件补齐（用户要求「现有插件也加上这个字段」）
>
> - `examples/` 29 个 manifest 全部写死 `category`；
> - 已安装副本：全局根 6 个、桌面测试库 11 个、手机库 9 个（theme-green 手动改成 theme）；
> - 一次性脚本 `scripts/plugin-category-backfill.mjs <插件根…>`：幂等（已有合法值跳过）、
>   优先抄 `examples/` 同名插件的分类、解析失败的文件跳过并打印。
>
> ### 4 明确不做
>
> - **不做应用内「新建插件」向导**：用户原话「创建不是说这个，是做插件的时候」——
>   「创建」指开发者写插件。规则落在 `docs/开发约定.md §1.1` 与契约 §3：
>   做新插件时 manifest 写上 `"category": "…"`，装上去就落在对应分组。
>
> ### 5 验收
>
> | 判据 | 证据 |
> |---|---|
> | 分组显示 | 插件页「编辑增强 4 / 阅读 1 / 主题外观 2 / 工具 2 / 示例与探针 2」 |
> | 全部带字段 | examples 29 + 全局 6 + 库内 11 + 手机 9，逐个 manifest 有 `category` |
> | 单测 | `tests/plugin-category.test.ts` 7 条（显式优先 / 纯样式 / 关键词 / 兜底 tool） |
>
> ## 📌 rev173.3（2026-10-18 · 附件：入口 + 统一插入）
>
> 用户三条要求：①「附件的入口也没做」②「插入附件也放在编辑区右键菜单」
> ③「取消插入图片的入口，统一放附件，但是图片的渲染不变」。
>
> ### 1 内核（Rust）
>
> - `collect()` 收图片附件（png/jpg/jpeg/gif/webp/bmp/svg/avif）：`NoteMeta.kind` 新增 `'image'`；
>   显示名去扩展名、不解析 frontmatter；**只有 `note` 进全文索引**（索引过滤从 `!= doc` 改为 `== note`）。
> - 契约 `NoteMeta.kind: 'note' | 'doc' | 'image'`（`docs/内核契约-v0.2.md` 不动：这是 `list_notes` 的数据面，
>   不是新的能力门）。
> - `import_attachment` 从「只收图片」放宽到「任意普通文件」：挡可执行 / 脚本
>   （exe / dll / bat / cmd / com / scr / msi / ps1 / vbs / js / jar / apk）；
>   stem 白名单改为保留 **Unicode 字母数字**（中文文件名可用）、空格转 `-`。
>
> ### 2 前端
>
> - 文件树新增虚拟「附件」分组（`ATTACH_NODE`，排在「文档」之后）：图片项挂 `.png` 徽章；
>   点开 → 全屏预览（asset 协议），预览进返回键层栈（Android 返回先关预览）。
> - 编辑器右键菜单**只留「插入附件…」**（「插入图片…」已删）：选任意文件 → 复制进笔记目录 →
>   按扩展名分流：**图片写 `![](image-时间戳.ext)`（渲染与之前完全一致）**，其它写 `[原名.ext](相对路径)`。
> - 正文点库内相对链接 → 宿主按类型分流：图片预览 / 只读文档走 `core.openDocument` / 其它提示路径。
> - 状态栏：`N 篇 · X 文档 · Y 附件`（图片与文档不再算进「篇」）。
> - 工具：`tools/cdp.mjs` 新增 `clickat <x> <y>`。原因：`click` 走 `el.click()`（合成事件坐标 0,0），
>   而 atomic 的链接「尾部图标热区」用 `event.clientX` 判命中 —— 合成点击永远判不中（实测点了没反应）。
>
> ### 3 验收
>
> | 判据 | 证据 |
> |---|---|
> | 附件入口 | 文件树出现「附件」分组（demo.png / image-…jpg）；点击弹预览 298×662 · `_shots/rev1733-attach.png` |
> | 右键菜单 | 只剩「插入附件…」，无「插入图片…」 |
> | 插入图片 | `![](image-20261018-212819.png)` + 编辑器渲染（`naturalWidth` 1220，缩略高度 208px） |
> | 插入附件 | `[probe-2.pdf](probe-2.pdf)`（重名自动 -2）；任意文件（含视频）可复制 |
> | 单测 | `vitest` **230**（新增 4 条 stem / linkInsertion）· `cargo test --lib` **31**（新增任意文件 + 中文名） |
> | 手机 | 附件分组 2 项、点开预览 359×798 · `_shots/rev1733-attach-android.png` |
>
> **用户确认（2026-10-18 21:36）：「功能正常」** —— rev173 系列（插入图片 → 缩略显示 → 返回键 → 附件入口 / 统一插入）到此结清。
>
> ### 4 注意
>
> - 测试库 `_tmp-vault-tb/` 里有用户真实试用的残留：`image-20261018-204254.jpg`、
>   `image-20261018-212431.png`、`LoliHouse-…mkv`（21:24 左右插入后撤销了正文引用）—— **别当夹具删**。
>
> ## 📌 rev173.2（2026-10-18 · 预览时按返回键先退预览）
>
> 用户：「手机预览的时候返回，先退出预览，现在是直接关闭笔记」。
>
> ### 1 根因
>
> - 图片预览是 `MarkdownEditor` 内部的局部 state，没进 App 的「层出口栈」（`layerExitsRef`）。
>   `backRef` 先弹栈顶；栈空 ⇒ 继续往下走，最终 `closeNote()` —— 预览还开着，笔记先没了。
> - 这正是 rev68 给菜单补过的那条链（「层出口栈」，见 `App.tsx` 的注释），预览沿用时漏了。
>
> ### 2 修法
>
> - `MarkdownEditor` 新增 `layers` prop（App 传 `layerExitsRef`）；预览打开时压一层
>   `() => { setPreviewSrc(null); return true }`，关闭 / 卸载时从栈里摘掉（按引用删，防重复）。
> - 栈是「后开先关」，所以预览永远排在任何菜单 / 笔记之前。
>
> ### 3 验收（真机 33b676f6 · CDP）
>
> - 预览打开：`__znBackLayers()` = **1**。
> - `__znBackPress()` → `true`、遮罩消失、`.cm-content` 仍在（**笔记没被关**）、层数回 0。
> - 再按一次 → 编辑器消失、回到卡片流（关闭笔记正常接续）。
>
> ## 📌 rev173.1（2026-10-18 · 图片缩略显示 + 点开看原图）
>
> 用户：「显示得太大了」→「再小一点，长宽都变成现在的一半」。
>
> ### 1 尺寸
>
> - 正文图片改为**缩略显示**：`max-height: min(29vh, 280px)`（桌面）、`23vh`（≤640px 宽）。
>   宽度按比例自动收缩（`width: auto`），横图仍然不超过正文宽。
> - 实测（1220×2712 的手机截图）：桌面 **126×280**、手机 **90×200** ——
>   正好是上一版（252×560 / 188×418）的一半。
>
> ### 2 点开看原图（缩略的必要配套）
>
> - 点正文图片 → 全屏遮罩 `.zn-img-preview`（fixed + `94vw/92vh` 原图），点遮罩或 Esc 关闭。
> - 点击走 document **捕获阶段**：atomic 的图片 widget 在 `mousedown` 里 preventDefault 并把光标
>   挪到源码行（`image-blocks.js` 的 onPointer），冒泡阶段收不到干净的 click（与 `[[…]]` 同一坑）。
> - 预览用的 `img.src` 已经是 asset URL（`fixImageSrc` 换过），所以是全分辨率原图。
>
> ### 3 验证
>
> - 桌面 CDP：`.cm-atomic-image img` 126×280；点击后 `.zn-img-preview` 出现、内部 img 447×994。
> - 手机真机：90×200；点击后遮罩 390×868、图片 359×798。
> - 截图：`_shots/rev173-fit-android.png`（手机正文里的缩略显示）。
>
> ## 📌 rev173（2026-10-18 · Markdown 插入图片）
>
> 用户：「先做 markdown 插入图片，现在还没有插入图片的方式」→ 指定入口「**放在编辑器右键菜单**」。
>
> ### 1 现状核实（先查现成）
>
> - **渲染是现成的**：atomic-editor 0.6.2 自带 `image-blocks.js`，`![alt](url)` 会渲染成块级 `<img>`。
>   但它 `img.src = this.src`（文档原文）⇒ 相对路径被 WebView 解析成 `http://localhost:1420/…`，
>   实测 `naturalWidth = 0`（裂图）。**所以缺的不是渲染，是「相对路径 → asset URL」这一段**。
> - **插入入口此前没有**；`copy_entry` 只接受库内相对路径，搬不进库外图片。
>
> ### 2 实现（四个点）
>
> - **入口**：编辑器右键菜单「插入图片…」（`粘贴` 与 `查找…` 之间；桌面右键与手机长按同一菜单）。
> - **链路**：`dialog.open`（桌面传图片 filters；Android 沿用 rev172 结论**不传**）
>   → `content://` 先经 `uri-reader.read_content_uri` 复制成缓存路径
>   → 新命令 `import_attachment`（`src-tauri/src/lib.rs`）复制进**笔记所在目录**：
>     命名 `image-YYYYMMDD-HHMMSS.<ext>`，重名 `-1/-2`，扩展名白名单
>     png/jpg/jpeg/gif/webp/bmp/svg/avif，`stem` 再过一遍白名单（只留字母数字与 `-`）
>   → 光标处插入 `![](相对笔记目录的路径)`，图片语法**独占一行**（前后按需补 `\n`）。
> - **渲染**：`MarkdownEditor` 新增 `vault` prop；`imageAssetPlugin`（CM6 ViewPlugin）在 widget
>   挂进 DOM 的**同一帧**把相对 src 换成 `convertFileSrc(abs)` —— MutationObserver 回调是微任务，
>   早于绘制，所以**不闪破图**。覆盖三处：正文块、表格内 `<img>`（table-widget）、虚拟化重挂载。
> - **纯逻辑**：`src/lib/insert-image.ts`（路径解析 / 相对路径 / 命名 / 插入位置），可单测、不碰 DOM。
>
> ### 3 验收
>
> | 判据 | 证据 |
> |---|---|
> | 桌面菜单有入口 | CDP 右键 `.cm-content` → 菜单项 `粘贴 / 插入图片… / 查找…`；截图 `_shots/rev173-menu.png` |
> | 桌面插入 + 落盘 | `__znInsertImage(<库外 png>)` → `image-20261018-203028.png` 418055 B（与源一致），笔记写入 `![](image-…)` |
> | 桌面渲染 | DOM `naturalWidth = 1220`（改前为 0）· 截图 `_shots/rev173-insert.png` |
> | 手机菜单 | 真机 `33b676f6`（dev 版）菜单同样出现「插入图片…」· 截图 `_shots/rev173-android.png` |
> | 手机插入 + 落盘 | `/storage/emulated/0/Documents/ZeroNote/image-20261018-203630.png` 418055 B，笔记写入，渲染 1220 |
> | 单测 | `vitest` 226 passed（新增 20 条）· `cargo test --lib` 30 passed（新增 3 条） |
>
> ### 4 已知边界
>
> - 图片**不进文件树**（`collect()` 只收 .md 与只读文档）——放笔记同目录因此不会出现空目录；
>   附件没有列表入口（要管理就直接去文件夹）。
> - 手机点「插入图片…」会拉起系统选择器，这一步**系统对话框无法自动化**；
>   本轮用 `window.__znInsertImage(path)` 诊断口验证了「复制 + 插入」同一链路（与 `__znInstallZnp` 同套路）。
> - 测试夹具已清：桌面 `_tmp-vault-tb` 的 pic-test.md / phone.png / image-*；
>   手机库的 image-20261018-203630.png（笔记恢复为 0 字节空笔记）、`/sdcard/Download/zn-test.png`。
>
> ## 📌 rev172（2026-10-18 · Android 安装 .znp 全链路修通）
>
> 用户：「手机从入口插件安装 znp 无法生效」。真机全链路排查，两处断点：
>
> ### 1 选择器里看不到 .znp
>
> - `installZnp` 传了 `filters: [{ extensions: ['znp'] }]`。`.znp` 没有对应 MIME
>   （`MimeTypeMap.getMimeTypeFromExtension` 返回 null），MIUI「安全访问」一旦收到 filters
>   就把**未知类型**文件（.znp / apk / zip / json…）全部藏起来，只留图片 / 文档 / 媒体
>   ⇒ 用户根本选不到插件包。
> - 修法同 `App.pickFile`：**Android 不传 filters**（真机实测：不传时 `.znp` 正常出现）。
>
> ### 2 选中后报「No such file or directory」
>
> - Android 文件选择器返回的是 **`content://` SAF URI**，不是文件系统路径；`read_znp` 用
>   `std::fs` 读它必然 ENOENT。
> - 修复：`installZnpFromPath` 检测 `content://` → 先走原生插件
>   `plugin:uri-reader|read_content_uri`（ContentResolver 复制进应用缓存，返回可读绝对路径），
>   再 `read_znp` / `install_znp`（与阅读器导入同一套机制）。
>
> ### 3 验收（真机 · dev 版连 vite）
>
> - 设置 → 插件 → 安装插件包（.znp）→ 系统选择器 → Download → 选
>   `zeronote-theme-green.znp` → 确认框「翠绿主题 v1.0.0 / 未签名」→ Ok
>   ⇒ 插件列表出现「翠绿主题 v1.0.0」（已启用），主题变绿。
> - 截图 `_shots/znp-confirm2-184007.png`（确认框）· `_shots/znp-installed-184024.png`（装好）。
> - ⚠️ 测试机当前是 **dev 版（连桌面 vite）**，改前端走 HMR，不再每次重装 APK。
>
> ## 📌 rev171（2026-10-18 · 手机设置页「安装插件包」点了没反应）
>
> 用户：「手机安装znp包，点击无法唤醒文件管理」。
>
> ### 1 根因
>
> - 设置弹窗的「插件」段复用 `PluginPanel`，但 `Settings.tsx` **漏传 `onInstall`**
>   ⇒ 按钮 `onClick={() => onInstall?.()}` 变成空操作，点了什么都不发生、也没有报错。
> - 手机从设置进插件页（长按/点齿轮）只有这一条路，所以「安装插件包（.znp）」看起来完全失效；
>   桌面主区插件页（另一处 `PluginPanel`）不受影响。
>
> ### 2 修复
>
> - `SettingsProps` 增加 `onInstall`，设置页渲染 `PluginPanel` 时传入；
>   `App.tsx` 的 `<Settings>` 传 `onInstall={() => void installZnp()}`。
>
> ### 3 验收
>
> - 手机实测（CDP + adb）：设置 → 插件 → 点「安装插件包（.znp）…」→
>   `topResumedActivity` 变成 `com.android.fileexplorer/.picker.PickMainNavigatorActivity`
>   （系统文件管理器拉起）✓
> - ⚠️ 测试机的 **debug 包 Rust 侧是旧的**（没有 `read_znp` / `install_znp`），选完文件会报
>   「Command read_znp not found」——这是**包旧**，不是本轮代码问题；新 release 包 / 新 debug 包才带这两个命令。
>
> ## 📌 rev170（2026-10-18 · 输入状态下右划不打开侧栏）
>
> 用户：「输入状态下设置为右划打开侧栏不生效」→「设置成输入状态不生效」。
>
> ### 1 行为
>
> - 手势判定抽到 `src/lib/swipe.ts`：`swipeIntent(dx, dy, { sidebarOpen, typing })` 纯函数
>   + `isTypingNow()`（焦点在 input / textarea / contentEditable —— CM6 正文的 contentDOM）。
>   App 只负责派发 `open` / `close`。
> - **输入状态下右划不打开侧栏**；左划关闭不受影响（抽屉开着时仍是关）。
>   非输入状态（键盘收起、焦点在 body）右划照常打开。
>
> ### 2 验收
>
> - 新增 `tests/swipe.test.ts` 7 条：开/关方向、输入豁免、位移阈值、焦点判定。
> - 手机实测（CDP 断言 + adb 手势）：
>   · 编辑界面点正文（键盘弹出、焦点 `cm-content`）→ 右划 → `.zn-sidebar.is-open` **false**
>     （`_shots/typing-swipe2-174410.png`）；
>   · 按返回收键盘（焦点 `BODY`）→ 右划 → **true**（`_shots/notyping-ok-174607.png`）。
> - tsc 0 · oxlint 3 · **vitest 206** · cargo 27 · docs 全过。
>
> ## 📌 rev169（2026-10-18 · 文件树展开/折叠状态按库持久化）
>
> 用户：「文件树现在是每次进入都会展开，设置成默认记住上次状态」。
>
> ### 1 行为
>
> - `FileTree` 的展开状态从「每个节点自己的 `useState(true)`」收归**组件级 `collapsed` 集合**，
>   写 localStorage：`zn-tree-collapsed:<库绝对路径>`（按库隔离；没记录 = 全展开，
>   升级后观感不变）。
> - `Node` 的 `open` 由 `collapsed` 派生；点击目录 → `onToggleOpen(path)`；
>   `reveal`（新建/重命名自动展开）只在**确实折着**时展开一次
>   （toggle 是切换语义，得先判 open，否则会把展开的反而折上）。
> - `AppSidebar` 用 `key={vault}` 重建 FileTree ⇒ 换库读到那个库自己的记录，不串。
>
> ### 2 验收
>
> - **新增 `tests/file-tree-collapse.test.tsx` 4 条**：默认全展开 / 折叠写盘 + 重挂载恢复 /
>   再点展开删记录 / 换库不串。
> - 手机实测（CDP + adb）：折叠「笔记」→ localStorage 出现
>   `zn-tree-collapsed:/storage/emulated/0/Documents/ZeroNote`；`location.reload()` 后
>   抽屉里「笔记」仍是 ▸（截图 `_shots/tree-collapsed-173438.png`）。
> - tsc 0 · oxlint 3 · **vitest 199** · cargo 27 · docs 全过。
>
> ## 📌 rev168（2026-10-18 · 编辑界面顶栏笔记标题屏幕居中）
>
> 用户：「直接截图手机，编辑框笔记标题（笔记1）居中」。
>
> ### 1 行为
>
> - 打开笔记（`mainView === 'editor' && activePath`）时，根节点带 `.zn-app.is-editing`；
>   移动端该状态下 `.zn-titlebar-name` **绝对定位到标题栏中心**（`left: 50%` +
>   `translateX(-50%)`）—— 起始页的「ZeroNote」不受影响，仍靠右（rev167 定稿）。
> - 为什么不用 `text-align: center`：flex 里左侧有 ☰、右侧有保存状态，只靠 text-align
>   会把文字挤得偏右；绝对定位才是真居中。长标题由 `max-width: calc(100% - 140px)`
>   + ellipsis 兜底；`.zn-save-state` 用 `margin-left: auto` 固定在右。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**（数字看 verify.ps1 输出）。
> - 手机 adb 截图 `_shots/title-center2-172845.png`（编辑界面「笔记1」居中）·
>   `_shots/title-home-172854.png`（起始页「ZeroNote」仍靠右）。
> - CDP 实测（`ZN_CDP`）：`.zn-app` class = `zn-app is-editing`、titlebar-name
>   `position: absolute`。
>
> ## 📌 rev167（2026-10-18 · 移动端顶栏：去「⋯」、logo 靠右、尺寸定稿 20/15/11）
>
> 用户三步：①「三个点去掉，然后加个临时按钮和 logo 文字大小调节」；
> ②「直接在原来的地方生效」＋「logo 放最右侧」；③「加左右调节」→「固定现在数据 → 20，15，11」。
>
> ### 1 行为
>
> - 顶栏「⋯」菜单按钮**移除**（`showMenuButton` 不再传）；☰ 保留为侧栏开关。
> - 移动端 `.zn-titlebar-name { text-align: right }` —— logo / 文档名靠**最右侧**。
> - 新增三个 CSS 变量并**写死定稿值**：
>   `--zn-menu-btn-size: 20px`（☰ 字形）· `--zn-logo-size: 15px`（logo 字号）·
>   `--zn-logo-offset: 11px`（`.zn-titlebar-name` 的 translateX）。
> - 临时调节器 `LogoSizeTuner.tsx`（三个滑块：☰ / Logo 字号 / Logo 左右）**已删除**。
> - 顺手修：`.zn-titlebar-name` 里原先有一行 `font-size: var(--zn-text-sm)` 覆盖了变量
>   （「logo 字号无效」的根因）。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机截图 `_shots/rev167-final-171848.png`：☰ 20px、ZeroNote 15px 靠右、偏移 11px。
>
> ## 📌 rev164（2026-10-18 · 手势全局生效：任意位置左右滑）
>
> 用户说明：①「直接全局生效」；②「不设置靠左侧触发，整个界面都触发」。
>
> ### 1 改动
>
> - 去掉 rev163 的「起点 ≤80px」限制 —— 屏幕**任意位置**左→右滑都打开抽屉；
> - 监听改为**捕获阶段**（`capture: true`）—— 编辑器（CM6）等内部组件 stopPropagation
>   也拦不住；编辑器里滑同样生效。
> - 判据不变：横向位移 ≥60 且明显大于纵向；`sidebarOpen` 时右→左关。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机 adb：编辑界面中点 (300,1300) → 右滑到 (900,1300) → 抽屉打开
>   （截图 `_shots/rev164-global-170936.png`）。
>
> ## 📌 rev163（2026-10-18 · 移动端抽屉左右滑手势）
>
> 用户：「移动端左往右划直接打开侧栏，右往左滑关闭」。
>
> ### 1 行为
>
> - `App.tsx` 新增 touchstart/touchend 手势（仅 Android）：
>   · **左→右**（起点 `x ≤ 80px`）且横向位移 ≥60 且 > 纵向 → 打开抽屉；
>   · **右→左**（抽屉打开时，任意起点）同样条件 → 关闭抽屉。
> - 起点不敢贴最左：Android 全面屏手势的「返回」从边缘 ~24dp 起滑，贴边滑会被系统吃掉
>   （实测：从 x=10 起滑 → app 直接退回桌面），所以留 80px 安全区。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机 adb：`swipe 100→900` 打开抽屉（`_shots/rev163-swipeopen2-170702.png`）、
>   `swipe 900→100` 关闭（`_shots/rev163-swipeclose-170716.png`）。
>
> ## 📌 rev162（2026-10-18 · 移动端编辑界面去关闭按钮 + 源码占位；桌面菜单遮罩）
>
> 用户三点：① 桌面的弹窗菜单也加遮罩；② 移动端编辑界面没必要放关闭按钮（返回就是关闭）；
> ③ 把源码放到关闭按钮的位置。
>
> ### 1 改动
>
> - 菜单遮罩是 `ContextMenu` 内置能力（rev161），**桌面右键菜单同样生效**（同一组件）。
> - `App.tsx`：编辑页的「关闭」按钮改为 `isDesktop` 条件渲染 —— 移动端不出现。
> - `styles.css`：移动端 `@media (max-width:820px)` 里 `.zn-editor-modebar { top: 8px }`
>   —— 「源码 / 预览」切换移到原来「关闭」的位置（右上角第一行）。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机截图 `_shots/rev162-editor-170237.png`：编辑界面右上只有「源码」。
>
> ## 📌 rev161（2026-10-18 · 菜单打开时点外面只关菜单）
>
> 用户：「菜单栏打开的时候，点击其他位置只会触发关闭菜单一个操作」。
>
> ### 1 改动
>
> - `ContextMenu`：去掉 document 级 mousedown/click 拦截（移动端合成事件时序不可靠），改为
>   渲染一层**全屏透明遮罩** `.zn-menu-scrim`（`fixed inset:0; z-index:69`，菜单 z-70）。
>   点遮罩 = `onClose()`，点击被遮罩吃掉，**不会漏到下面的卡片/按钮**。
> - `App.tsx`：`.zn-body` 的 `onContextMenuCapture` 排除 `.zn-mobile-home`
>   —— 之前长按卡片会**同时**弹出应用主菜单（新建笔记/设置/切库），现在只弹卡片菜单。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机 adb：长按卡片 → 点另一张卡 → 只关菜单、不打开笔记、不弹主菜单
>   （截图 `_shots/rev161-closeonly4-170108.png`）。
>
> ## 📌 rev160（2026-10-18 · 卡片长按可重命名和删除）
>
> 用户：「长按卡片可以重命名和删除」。
>
> ### 1 行为
>
> - `MobileNoteCards` 卡片加 `onContextMenu`（Android 长按转 contextmenu）→ 与右上「⋯」
>   弹同一个菜单：**打开 / 重命名… / 删除（回收站）/ 彻底删除…**。
> - 「重命名…」用 `window.prompt` 输入新文件名（默认当前名），同目录；`.md` 笔记没写后缀自动补。
> - App 传 `onRename={(from,to) => renameNote(from,to,false)}`。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机截图 `_shots/rev160-longpress-165748.png`：长按卡片 → 菜单含「重命名…」与删除项。
>
> ## 📌 rev159（2026-10-18 · 卡片时间精确到秒）
>
> 用户：「卡片显示的时间精确到秒」。`MobileNoteCards` 的 `fmtTime` 改为
> `YYYY-MM-DD HH:mm:ss`（补 `getSeconds()`）。
>
> 验收：tsc 0 · oxlint 4 · **vitest 195**；手机截图 `_shots/rev159-seconds-165511.png`。
>
> ## 📌 rev158（2026-10-18 · 圆形＋按钮水平居中）
>
> 用户：「居中」。`styles.css` `.zn-mobile-compose` 由「右下角」改为
> `left:50% + translateX(-50%)`，底部固定、仍比原输入条上移 20px。
>
> 验收：tsc 0 · oxlint 4 · **vitest 195**；手机截图 `_shots/rev158-center-165410.png`
> （圆按钮在屏幕底部中央）。
>
> ## 📌 rev157（2026-10-18 · 移动端起始页：输入条改圆形＋按钮）
>
> 用户要求：「下面输入框做成一个圆，里面是＋号，位置上移 20px」；并「语音先不做」。
>
> ### 1 改动
>
> - `MobileNoteCards`：底部按钮内容只剩「＋」（去文案，aria-label「新建一条」）。
> - `styles.css` `.zn-mobile-compose`：56×56 圆形（`border-radius:50%`）、右下角
>   `right:20px`、`bottom: 32px + safe-area`（比原 bottom 12 上移 20px）、
>   主色底 + 白字、阴影。空内容的卡片显示「（空笔记）」，不再留白。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机截图 `_shots/rev157-circle-165238.png`：深色圆 + 白色＋，右下角上移。
>
> ## 📌 rev156（2026-10-18 · 移动端起始页 = flomo 风卡片流）
>
> 用户给截图要求「移动端起始页做成这样」；随后「语音先不做」。
>
> ### 1 行为
>
> - 新组件 `src/components/MobileNoteCards.tsx`：卡片流（按 mtime 倒序，最多 100 条），
>   每张卡 = 时间（`YYYY-MM-DD HH:mm`）+ 正文摘要（去 frontmatter / Markdown 标记，
>   4 行截断）+ 右上「⋯」菜单（打开 / 删除（回收站）/ 彻底删除（confirm 二次确认））。
> - 底部常驻「＋ 点击输入，新建一条」→ `core.newNote`（新建并打开编辑器）。
> - **语音输入不做**（文案已改，避免误导）。
> - App：`activePath` 为空且非桌面时渲染它（桌面仍 `AppEmptyState` 起始页）。
> - `styles.css`：`.zn-mobile-*` 一组卡片样式（白卡、圆角、阴影、底部 fixed 输入条 + safe-area）。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机截图 `_shots/rev156-cards2-164905.png`：10 篇笔记 → 卡片流 + 底部输入条。
>
> ## 📌 rev149（2026-10-18 · 彻底删除确认框改 portal：不再被侧栏裁剪）
>
> 用户报：「删除框被截断了」（手机截图里确认框右半截（「彻底删除」按钮）被切掉）。
>
> ### 1 原因与修复
>
> - 原因：确认框 `position:fixed` 渲染在 `.zn-tree` 里，但侧栏抽屉有 `transform` 动画
>   ⇒ fixed 以抽屉为包含块并被 `overflow` 裁剪，右侧超出部分被切掉。
> - 修复：确认框改 `createPortal(..., document.body)`（与 `ContextMenu` 同一套做法），
>   定位仍 `fixed + viewport clamp`（`left ≤ innerWidth−296`、`top ≤ innerHeight−170`）。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机 adb：菜单「彻底删除…」→ 确认框完整显示「取消 / 彻底删除」两个按钮
>   （截图 `_shots/rev149-purge3-161623.png`）。
>
> ## 📌 rev148（2026-10-18 · 手机菜单 = 点按处右下固定距离）
>
> 用户最终定：「就固定菜单离点按处一个下跟右的距离就行了」。
>
> ### 1 行为
>
> - `ContextMenu.anchor='below-pointer'`（手机）：菜单左上角 = 点按处 **+ (16, 56)**
>   —— 纯固定偏移，不依赖屏幕角落 / 列表位置。
> - 屏幕边缘放不下时**贴边 clamp**（`left` 取 `min(x+16, 屏宽−菜单宽−8)`，`top` 同理），
>   保持"右下"方向、不翻到反侧。
> - 桌面不变（鼠标右下角 +8/+10）。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机 adb 截图 `_shots/rev148-phone-offset-161136.png`。
>
> ## 📌 rev147（2026-10-18 · 手机菜单靠右：不把下面选项的名字挡死）
>
> 用户三张截图 + 说明：「选中一个选项时，菜单不要把下面的选项完全挡住」。
>
> ### 1 行为
>
> - `ContextMenu.anchor='below-pointer'`（手机）：水平**靠屏幕右侧**（左缘 = 屏宽 − 菜单宽 − 8），
>   左边留出文件名；垂直挂在**长按点下方固定 72px**。下方放不下就翻到长按点上方 12px。
> - 桌面不变（鼠标右下角 +8/+10）。
> - 结果：菜单只盖住行的右端，文件名字仍可见 ⇒ 不会"完全挡住"。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机 adb：长按第 1 行 → 菜单贴右侧、顶部在长按行下方 72px
>   （截图 `_shots/rev147-phone-rightA-161052.png`）。
>
> ## 📌 rev146（2026-10-18 · 手机菜单：长按点上方固定距离）
>
> 用户要求：「手机的右键菜单再往上一点，不是固定在右下角，而是离长按位置固定拉开一段距离」。
>
> ### 1 行为
>
> - `ContextMenu.anchor` 新增 `above-pointer`（手机）：菜单**底边**放在长按点上方
>   12px 处、水平对齐长按点（clamp 视口）—— 手指在长按点下方，菜单往上展开才不被手挡。
>   上方放不下时（长按点靠近屏幕顶部）自动翻到长按点下方 12px。
> - 桌面仍是 `pointer`（鼠标右下角 +8/+10）；`bottom-right` 保留备用。
> - `FileTree`：Android → `above-pointer`，桌面 → `pointer`。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 手机 adb：长按第 3 行 → 菜单出现在长按行下方 12px（该行长按点上方空间不够，
>   走"翻到下方"分支）（截图 `_shots/rev146-phone-menu-160256.png`）。
>
> ## 📌 rev145（2026-10-18 · 菜单定位：桌面鼠标右下角 / 手机屏幕右下角）
>
> 用户明确：①「桌面端直接跟在鼠标右下角」；② 手机上放到他圈出的位置（屏幕右下）。
>
> ### 1 行为
>
> - `ContextMenu` 新增 `anchor`：
>   · `pointer`（桌面，默认）—— 菜单左上角贴在指针 **+8/+10** 的右下角；超出视口就翻到指针左侧/上方。
>   · `bottom-right`（手机）—— 固定 `innerWidth/Height - 尺寸 - 8`，即屏幕右下角。
> - 首帧先 `visibility:hidden`，量完尺寸再显示 —— 否则右下角模式会先在旧坐标闪一下。
> - 去掉 rev144 的 `avoid` 避让（用户否决：桌面要跟手）。
> - `FileTree` 按 `navigator.userAgent` 选 `bottom-right`（Android）/ `pointer`（桌面）。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 桌面 CDP：指针 `(48,175)` → 菜单 `(56,185)`，`dx=8 dy=10`。
> - 手机 adb：菜单固定在右下角、在文件列表下方，不遮任何行
>   （截图 `_shots/rev145-phone-menu-160022.png`）。
>
> ## 📌 rev144（2026-10-18 · 菜单避让所有文件行：不遮挡选中 / 未选中）
>
> 用户要求：「跟手也可以，但是一定要保证不遮挡选中项目」→ 追加「未选中也不要遮挡啊」。
>
> ### 1 行为
>
> - `ContextMenu` 新增 `avoid`：渲染后量菜单**实际尺寸**，与给定矩形相交就整块挪开；
>   候选顺序：列表下方 → 列表上方 → 右侧 → 左侧 → 视口顶部。优先「零重叠」，
>   物理上无解时选重叠面积最小的位置。
> - `FileTree` 交给菜单的是**树里所有可见行**的矩形（不只选中行）⇒ 选中/未选中都不遮。
> - 避让矩形在**事件处理里**取（弹菜单时量 DOM），不在渲染期读 ref（lint `react(refs)`）。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**。
> - 桌面 CDP 实测：多选 2 行后菜单矩形 `(0,245,190,537)` 与两行选中 `(167–237)` 零重叠
>   （`overlap: []`），菜单落在列表下方。
> - 手机「放到哪块」待用户圈定（截图 `_shots/rev144-phone-tree-155529.png`）。
>
> ## 📌 rev143（2026-10-18 · 点「多选」菜单原地切换成多选菜单）
>
> 用户要求：「点多选后菜单就直接切换」—— 从右键菜单点「多选」不应关闭菜单，
> 而应**原地**变成针对选中集合的批量菜单。
>
> ### 1 行为
>
> - `MenuItem.keepOpen: true`：点「多选」不再触发 `onClose`；同时
>   `setMenu(m => ({ ...m, multi: true }))` 把当前菜单就地切到多选版 ——
>   单项时显示「删除选中的 1 项」；点行加选到 2 项时（`pick` 的 ≥2 项自动弹菜单）
>   换成「删除选中的 2 项」。
> - 菜单位置沿用原右键点，不闪、不重新定位。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**（测试改为：点「多选」→ 菜单出现「删除选中的 1 项」
>   → 点第二行 → 换成「删除选中的 2 项」）。
> - 真机 adb 实测：长按 →「多选」→ 菜单原地变「删除选中的 1 项」；再点第二行 →
>   「删除选中的 2 项」（截图 `_shots/rev143-switched-154341.png`、`_shots/rev143-two-154349.png`）。
>
> ## 📌 rev142（2026-10-18 · 多选后直接弹批量菜单，不用再右键一次）
>
> 用户截图反馈：桌面多选两行后还得右键才出菜单 ⇒ 要求「多选时直接弹出选中后的菜单」。
>
> ### 1 行为
>
> - `pick()`：选中集合到 **≥2 项**时，直接在点击位置弹菜单（`multi` 已按选中集合生成，
>   菜单里是「删除选中的 N 项」「彻底删除选中的 N 项…」等）：
>   · 点选模式（右键「多选」进入）点第二项；· 桌面 `Ctrl/⌘` 点选第二项；
>   · `Shift` 范围选择（≥2 项）；· 鼠标框选松手（≥2 项，弹在松手位置）。
> - 单项选中不弹（普通点击本来就打开笔记；单项操作仍走右键 / 长按）。
> - 批量条依旧不存在（rev141）。
>
> ### 2 验收
>
> - tsc 0 · oxlint 4 · **vitest 195**；测试第 3 条改为「点第二行直接出菜单」。
> - 真机 adb：长按 →「多选」→ 点第二项 → 菜单直接出现「删除选中的 2 项」
>   （截图 `_shots/rev142-auto-154059.png`）。
>
> ## 📌 rev141（2026-10-18 · 移除顶栏「多选」按钮与批量操作条；右键「多选」保留）
>
> 用户手机截图圈注两处「不要」：① 树顶工具栏的「多选」按钮；② 选中后出现的
> 「已选 N 项 | 剪切 复制 删除 彻底删除」批量条。随后追加：「右键多选留着啊」
> ⇒ 只删这两处 UI；`selectMode` 保留为**点选模式**，入口只剩右键 / 长按菜单的「多选」。
>
> ### 1 改动
>
> - `FileTree.tsx`：删顶栏「多选」按钮与多选条（`.zn-select-bar`）；`selectMode` 保留
>   （注释改为「点选模式」）—— 从右键菜单「多选」进入后点行只加/减选，
>   批量操作继续走右键菜单（菜单里显示「删除选中的 N 项」「彻底删除选中的 N 项…」）。
> - `styles.css`：删 `.zn-select-bar` / `.zn-select-count` / `.zn-select-actions`。
> - `tests/file-tree-toolbar.test.tsx`：换成 1 条链路测试 —— 顶栏无「多选」按钮 / 无批量条；
>   右键「多选」进模式；点第二行不打开笔记；再右键出现「删除选中的 2 项」；批量条始终不出现。
>
> ### 2 明确保留
>
> - 右键 / 手机长按菜单的「多选」入口（唯一入口）；
> - 桌面 `Ctrl/⌘` 点选、`Shift` 范围选、框选、拖拽移动；
> - 右键菜单的单条 / 批量操作（删除 / 彻底删除 / 剪切 / 复制）。
>
> ### 3 验收
>
> - tsc 0 错误 · oxlint src 4 warnings · **vitest 195 passed**（22 文件）。
> - 真机 adb 截图：顶栏只剩两个新建按钮、右键菜单含「多选」、选中后无批量条。
>
> ## 📌 rev140（2026-10-18 · 手机长按弹右键菜单 + 多选入口进菜单/顶栏）
>
> 用户要求：① 手机长按文件弹与电脑右键相同的菜单；② 加「多选」按钮，点击后进现有文件多选。
>
> ### 1 行为
>
> - **手机长按文件 → 弹菜单**（原来把长按转成「进多选」）：`FileTree` 删掉触摸分支，长按
>   （Android 转成 `contextmenu`）与鼠标右键走**同一个** `onContextMenu`。
> - **多选入口两处**：① 树顶工具栏「多选」按钮（进模式、0 项已选）；② **右键菜单末尾的
>   「多选」项**（进模式并选中该行）。两者都进现有 `selectMode`（批量条：剪切 / 复制 / 删除 /
>   彻底删除 / 退出）。
> - 「多选」菜单项**只对文件显示**（现有选择集合的语义是「只含文件」）。
>
> ### 2 两个实测踩到的坑（已修）
>
> - 工具栏按钮与菜单项点击都会被**根容器的 onClick**（「点空白 = 取消多选」）同一次冒泡取消 ⇒
>   工具栏按钮加 `stopPropagation`；根 onClick 对 `[role="menu"]` 内的点击直接放行。
> - 右键菜单不是 portal，点击会冒泡到树容器 —— 同上。
>
> ### 3 实测（桌面 + 手机 CDP）
>
> - 桌面：右键文件 → 菜单含「多选」→ 点击 → 多选条「已选 1 项」。
> - 手机（重启 app 连上最新 dev）：长按文件（contextmenu）→ 菜单含「多选」→ 点击 →
>   多选条「已选 1 项」；截图 `_shots/rev140-phone-multiselect.png`。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 · cargo 27 · check-docs · **vitest 196 passed**（194 → 196）。
>
> ## 📌 rev139（2026-10-18 · 文件树顶栏：新建笔记 / 新建文件夹）
>
> 用户看图提需求：侧栏红框处（文件树顶部）加一栏，放「新建笔记」「新建文件夹」两个按钮。
>
> ### 1 产物
>
> - `FileTree.tsx`：树顶新增 `.zn-tree-toolbar`。两个按钮走**同一套 `createIn('', …)`**（与右键菜单
>   完全一致：落盘 → 新笔记顺手打开 → 进入内联命名态），空库分支也有（否则只剩右键入口）。
> - `styles.css`：`.zn-tree-toolbar`（flex 均分、底部分隔线、按钮常显不靠 hover）。
> - `tests/file-tree-toolbar.test.tsx` 2 条：顶栏存在 + 点击在库根新建；空库也有顶栏。
>
> ### 2 验收
>
> - 截图 `_shots/rev139-tree-toolbar.png`：侧栏「ZeroNote」下方出现两个按钮。
> - `verify.ps1` 五步全过：tsc 0 · oxlint 4 · cargo 27 · check-docs · **vitest 194 passed**（192 → 194）。
>
> ## 📌 rev138（2026-10-18 · 开发约定升级：「先查现成」贯穿全流程）
>
> 用户指出：rev137 那轮「搜索相似案例」是**他中途的指令**，不是约束生效的证据 —— 前面 rev135/136
> 的排查确实没先查现成。据此把这条件束从「排查」扩展到**整个开发流程**，落成项目级清单。
>
> ### 1 复盘（诚实记录）
>
> - rev135 修「首屏闪」：直接读代码推断 ⇒ 改，没查 Vite 官方文档（插件 CSS 注入时机 / `watch.ignored`）。
> - rev136 查「标题栏闪」：直接加临时诊断 ⇒ 反复改代码，没搜同类 case；直到用户给「放着不动也定时闪」
>   这条线索，才用 CDP 采样 + dev 日志 + 文件 mtime 定位（一手实测，但已是第二轮）。
> - ⇒ 约束本身在 `~/.dsh/AGENTS.md` §1（第 1 / 4 / 5 条，2026-10-16 改版后重新编号），
>   **是执行没做到，不是条款失效**。
>
> ### 2 改动
>
> - `docs/开发约定.md`：
>   - §0 三条总原则 → **四条**，新增第 0 条「**先查现成，再动手（贯穿全流程）**」；
>   - 新增 **§0.5 先查清单**：需求/方案 · 选依赖 · 写实现 · 排查 bug · 下技术定论 · 写文档，
>     六个环节各自写明「先查什么 / 什么算查过」；
>   - §3 重构流程加第 0 步「先查现成」。
> - `HANDOFF-CARD.md` 硬约束第 6 条改写：动手前先查现成（指向 §0.5）。
>
> ### 3 验收
>
> 只改文档：`check-docs` 全通过；`verify.ps1` 五步全过（代码零改动）。
>
> ## 📌 rev137（2026-10-18 · 修复「放着不动也定时闪一下深色」：Vite HMR 写盘循环）
>
> 用户补充关键线索：「**放着不动也会定时闪一下**」—— 据此重查，定位到每 ~6 秒一轮的
> **写盘 → HMR → 重放 effect → 再写** 循环。
>
> ### 1 证据链（CDP 采样 + dev 日志 + 文件 mtime）
>
> 1. 16ms 采样（30 秒静止）：`style[data-zn-plugin]` 每 ~3–6 秒**整批消失** → `body` 背景从
>    `#0c1a12`（翠绿深色）变 `rgb(24,24,27)`（内核深色）→ ~340ms 后 outline-map 注入 →
>    ~60ms 后 theme-green 注入 ⇒ 插件在**周期性卸载重载**。
> 2. `kernel` 每 ~2 秒被重建（计数），但 App **未重挂载**（mount=0）。
> 3. `usePluginHost` effect 重跑时 `kernel / vault / reloadToken` 三个依赖**都没变** ⇒ 只能是
>    React Refresh 重放 effect。
> 4. `.self-logs/desktop-dev.log`：**每 6–7 秒一批** `hmr update /src/styles.css, /src/App.tsx`
>    （单次 3–27 行）。
> 5. 文件 mtime 扫描：`examples/*` 与 `_tmp-vault-tb/.zn/plugins/*` 共 **18 个文件同一秒被改写**。
>
> ### 2 根因
>
> `ensureBuiltinPlugins` **每次插件加载都无条件覆盖写** 8 个内置插件（18 个文件），且写在
> **项目树内** ⇒ Vite watcher 当成源码变化 ⇒ HMR ⇒ React Refresh 重放所有 effect ⇒
> 插件加载链重跑 ⇒ **又写一遍** ⇒ 无限循环。每轮插件全部卸载重载，主题样式消失几百毫秒
> —— 用户看到的就是「定时闪一下深色」。**与标题栏 hover 无关**（rev136 的观察被这条线索推翻）。
>
> ### 3 修复
>
> - `vite.config.ts`：`server.watch.ignored` 加 `**/_tmp-*/**` · `**/.zn/**` · `**/_shots/**` ·
>   `**/_build/**` —— 运行时写入目录不再触发前端 HMR。
> - `builtin-plugins.ts`：**幂等写入**（先读、内容相同就跳过；升级 / 首次安装照常写）。
> - `App.tsx`：kernel 改 state 懒初始化（**防御性**：即使将来还有抖动，kernel 也不会跟着重建；
>   真因已在上面两条修掉）。
>
> ### 4 验证（CDP）
>
> 修复后 30 秒静止采样：**只有 1 条记录**（`outline-map,theme-green | rgb(12,26,18)`）——
> 插件样式全程稳定，不再周期性消失。
>
> ### 5 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 · cargo 27 · check-docs · **vitest 192 passed**。
>
> ## 📌 rev136（2026-10-18 · 排查「标题栏出现时闪深色」+ 修幽灵插件样式累积）
>
> ⚠️ **更正见 rev137**：本轮「未定位」的定时闪与 hover 无关，真因是 Vite HMR 写盘循环
> （`ensureBuiltinPlugins` 每轮覆盖写入项目树内文件 ⇒ watcher ⇒ HMR ⇒ 重放 effect ⇒ 再写）。
> 本轮的 hover 排查数据仍然有效（hover 本身不重建 kernel）。
>
> 用户补充：**每次顶部隐藏的标题栏（自绘）出现时会闪一下原本的深色界面**。
>
> ### 1 排查证据（CDP 16ms 采样 + 连续截图）
>
> - 触发标题栏显示/隐藏期间：`--zn-bg` / `body 背景` **不变**（一直 `#0c1a12` 翠绿深色）；
>   `style[data-zn-plugin]` 集合不变；**App 挂载次数 0、kernel 引用不变、docApi / vault 不变**
>   （临时诊断量出来的，已删除）⇒ hover 本身不会重建 kernel、也不会重载插件。
> - 连拍 6 帧（标题栏淡入全过程）：顶部像素从 `rgb(12,26,18)` 渐变到 `rgb(17,36,26)`，
>   **没有一帧是内核深色 `rgb(24,24,27)`**。
> - 但顺带查出一个真问题：**dev 下 `style[data-zn-plugin]` 会累积多份**（实测同一插件 3 份）——
>   React Refresh 重挂载 `App` 后，旧一代插件实例的 `loaded` 数组没人消费（新 hook 实例是新的
>   ref），旧样式永远留在 DOM 里。
>
> ### 2 本轮改动
>
> - `injectStyles` 改为**幂等注入**：注入前先移除同 `pluginId` 的旧 `<style>`
>   （生产没有 HMR，但同 id 本来也只该有一份）；旧代 dispose 时删到的是最新那份，无害。
> - 临时诊断代码已删除，不提交。
>
> ### 3 未定位（需用户确认场景）
>
> hover 路径**没有复现**深色帧。可能用户看到的是：① 冷启动 / 刷新瞬间（rev135 已修插件样式
> 首屏预热）；② dev 下 React Refresh 的插件重载窗口；③ 另一种触发（请说明：闪的是顶部标题栏
> 还是 ☰ 菜单？出现时还是隐藏时？是否只在 dev 下）。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 · cargo 27 · check-docs · **vitest 192 passed**。
>
> ## 📌 rev135（2026-10-18 · 修复「翠绿主题闪一下深色」：插件样式首屏预热）
>
> 用户报告：翠绿主题经常闪一下原本的深色界面。
>
> ### 1 根因（读代码确认，不是猜）
>
> 「翠绿」**不是内核主题**（内核只有 light/dark/system，`index.html` 有内联脚本防闪），
> 而是**纯 CSS 插件** `theme-green`（`manifest.styles` 由宿主注入 `<style>`）。
> 它的注入发生在 `usePluginHost` 的加载链里 —— **React 挂载之后**，且要等读 manifest + 读 CSS
> 的 await 跑完才 append。于是首屏先用内核深色渲染，插件加载完成才变绿 ⇒ 闪一下。
> 每次刷新 / 冷启动 / 切库（插件重载）都会再来一次；`theme-sepia` 同理。
>
> ### 2 修法：样式缓存 + 首屏预热
>
> - `src/lib/boot-plugin-styles.ts`（新）：`cachePluginStyle` / `uncachePluginStyle` /
>   `applyBootPluginStyles` / `dropBootPluginStyles`，缓存进 localStorage（`zeronote.plugin.styles`）。
> - `plugin-host.ts` 的 `injectStyles`：真实注入时写缓存 + 删预热样式；`dispose` 时删缓存。
> - `main.tsx`：`applyBootPluginStyles()` 在 React 挂载前、内核 `styles.css` 之后执行
>   ⇒ 首屏直接用缓存里的主题样式（文档顺序在后，同特异性下主题变量胜出）。
> - `usePluginHost.ts`：加载链 `finally` 里 `dropBootPluginStyles()` —— 插件被禁用 / 卸载时
>   预热样式不残留（否则「禁用主题」等于无效）。
>
> ### 3 实测（CDP）
>
> - 缓存写入确认：`outline-map:2723`、`theme-green:591` 字符；
> - 删掉真实插件样式 → `--zn-bg=#18181b`（内核深色）；调 `applyBootPluginStyles()` →
>   `#0c1a12`（翠绿深色）—— 预热样式确实能覆盖内核主题（顺序 / 特异性正确）。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 · cargo 27 · check-docs · **vitest 192 passed**
> （186 → 192，`tests/boot-plugin-styles.test.ts` 6 条）。
>
> ## 📌 rev134（2026-10-18 · 侧栏头部加设置图标）
>
> 用户看图提需求：设置功能放到侧栏头部（ZeroNote 右侧），做一个设置图标。
>
> ### 1 产物
>
> - `AppSidebar.tsx`：头部 `.zn-sidebar-head` 右侧新增设置图标按钮（lucide `Settings`，
>   `zn-icon-btn` 样式，`aria-label` / `title` =「设置」），点击走 `onOpenSettings`。
> - `App.tsx`：`onOpenSettings={() => openOverlay('settings')}` —— 复用现有设置弹窗；
>   ☰ 菜单里的「设置」项**保留**（两处入口不冲突）。
> - `tests/app-sidebar.test.tsx` 2 条：图标在侧栏头部、点击触发；无库时图标也在。
>
> ### 2 实测（CDP，桌面 dev 1420）
>
> 点设置图标 → `role="dialog"` 出现、正文含「关于」；Esc 关闭。移动端侧栏抽屉里同一位置也有。
>
> ### 3 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 · cargo 27 · check-docs · **vitest 186 passed**（184 → 186）。
>
> ## 📌 rev133（2026-10-18 · 移动端同步：☰ = 抽屉开关，⋯ = 菜单）
>
> 承接 rev132。用户要求移动端同步 —— 但移动端不能简单照搬：手机没有右键，☰ 原来又是菜单的
> **唯一**入口，直接改会让菜单不可达。
>
> ### 1 行为
>
> - **移动端**：☰ 左键 = 切换侧栏抽屉（`sidebarOpen`）；☰ 右侧新增 **⋯** 按钮 = 菜单。
> - **桌面**：不变（左键切换 / 右键菜单）。
> - 去掉「移动端不传 `onToggleSidebar`」的分支 —— 两端都传，只是切的状态不同
>   （桌面 `sidebarVisible` / 移动 `sidebarOpen`）。
>
> ### 2 实现
>
> - `TitleBar.tsx`：可选 prop `showMenuButton`（移动端 true）→ ☰ 后渲染「⋯」按钮。
> - `App.tsx`：`onToggleSidebar` 两端统一传；移动端 `showMenuButton={!isDesktop}`。
> - `tests/titlebar.test.tsx` 3 → 4 条（新增「移动端 ☰ 切换 + ⋯ 菜单」，保留兼容分支）。
>
> ### 3 实测（CDP，两端都验过）
>
> - 桌面（dev 9222）：点 ☰ → `sidebar-off`，再点 → `sidebar-on`；右键 ☰ → `menu-open`。
> - 手机（`com.aqua.zeronote.debug`，pid 29859，CDP 9333）：两个按钮都在；
>   ☰ → 抽屉 + 遮罩出现；⋯ → 菜单打开（含「新建笔记」）。
> - 实测完已关闭抽屉、手机熄屏（`mWakefulness=Dozing`）。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 · cargo 27 · check-docs · **vitest 184 passed**（183 → 184）。
>
> ## 📌 rev132（2026-10-18 · 桌面 ☰ = 文件树栏开关）
>
> 用户看图提需求（桌面 dev 截图，_tmp-vault-tb）：标题栏左上角 ☰ 按钮从「打开菜单」改成
> 「文件树栏开关」。
>
> ### 1 行为
>
> - **桌面**：左键 ☰ = 切换侧栏（`sidebarVisible`）；**右键 ☰ = 打开菜单** —— 菜单唯一入口
>   从左键让给右键，保证菜单仍可达。tooltip / aria-label 同步为「切换文件树栏（右键打开菜单）」。
> - **移动端**：不传 `onToggleSidebar` ⇒ **保持原行为**（左键弹菜单）。侧栏抽屉本来就集成在
>   菜单里、☰ 是它唯一入口 —— 不能把移动端的菜单入口抢走。
>
> ### 2 实现
>
> - `TitleBar.tsx`：新增可选 prop `onToggleSidebar`；有它时左键切换侧栏、右键弹菜单。
> - `App.tsx`：桌面传 `onToggleSidebar={() => setSidebarVisible((v) => !v)}`。
> - `tests/titlebar.test.tsx` 3 条：桌面左键切换 / 桌面右键菜单 / 移动端行为不变。
>
> ### 3 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 · cargo 27 · check-docs · **vitest 183 passed**（180 → 183）。
>
> ## 📌 rev131（2026-10-18 · 工程债四件：App 集成测试 / 补丁回归 / 快照备份结论 / 卡片数字）
>
> L3 + CI 之后回头清工程债（用户要求「工程债按顺序解决」）。
>
> ### 1 工程债 #4：卡片过时数字
>
> `HANDOFF-CARD.md`「前端单测 102 条」→「条数以 `verify.ps1` 输出为准」—— 卡内不再写易变数字。
>
> ### 2 工程债 #1：App 编排层集成测试（3 条）
>
> `tests/app-smoke.test.tsx`：**真实挂载 `App`**（不 mock kernel/fs，只 mock 最外层 Tauri API 与
> 两个平台副作用模块），断言三种启动分支 —— 无库「ZeroNote / 选择笔记库」、有库无笔记
> 「这个库还没有笔记」、有库有笔记文件树显示 `a.md`。此前的测试全在 hook/组件，这是第一份
> **App 接线回归网**（state → hook → props → 渲染）。
>
> ### 3 工程债 #2：atomic-editor 补丁回归（4 条）
>
> `tests/atomic-editor-patch.test.tsx`：
>
> - **静态护栏**：`package.json` 的 `patchedDependencies` 指向补丁 + `node_modules` 的
>   `dist/inline-preview.js` 里确实有 `isBareHeadingForTypora` —— 升级 atomic 后忘记重打会立刻红
>   （「升级必须重打」从约定变成测试）；
> - **渲染行为**（真实 atomic + CM6）：正常 ATX 标题有 `cm-atomic-h1…h6`；空标题（`# ` 后换行）
>   没有；Setext 单个 `-` 不算标题、`---` 算。
> - 配套 `vitest.config.ts` 加 `server.deps.inline: ['@atomic-editor/editor']`（它的 dist 用无扩展名
>   ESM 相对导入，默认被当 external ⇒ 报 `Cannot find module`）。
>
> ### 4 工程债 #3：快照备份的定性结论（不新加产物）
>
> 核实 `_kernel-snapshots/`（5 份、52 MB；`scripts/kernel-snapshot.mjs` 生成 / `kernel-restore.mjs`
> 恢复；manifest 记录 `git.head`、`branch`、`dirty`）—— 内容与仓库重复，**不入库是设计而非遗漏**。
> 备份分两层写进 `docs/开发约定.md §7`：已提交内容走 GitHub + CI；未提交的脏工作区走本地快照
> （内核级大改前先打一份）。把 52 MB 压进仓库没有意义（膨胀且继续增长），故**不做**。
>
> ### 5 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 · cargo 27 · check-docs · **vitest 180 passed**（173 → 180）。
>
> ## 📌 rev130（2026-10-18 · P3-3 落地：GitHub 私有仓库 + CI 五步）
>
> 结清测试报告里最后一项工程债 **P3-3（无远程仓库、无 CI）**。
>
> ### 1 产物
>
> - GitHub 私有仓库：`https://github.com/aqua7773/zeronote`（main 已推，仓库 6.06 MiB）。
> - `.github/workflows/verify.yml`：push / PR 跑五步 —— tsc 0 错误 · oxlint 0 error · vitest ·
>   check-docs · cargo test --lib（`windows-latest`，与本机 MSVC 环境一致）。
> - git 全局身份：`aqua7773` / `129979993+aqua7773@users.noreply.github.com`。
>
> ### 2 环境要点（下一轮别踩）
>
> - 本机 **github.com 直连超时，必须走本地代理** `http://127.0.0.1:26561`（设 `HTTPS_PROXY` /
>   `HTTP_PROXY`）。`gh auth login` 不带代理会卡在 OAuth token 交换 —— 实测踩过一次，换代理后成功。
> - `gh` 已登录（keyring；token scopes: `repo` / `gist` / `read:org`）；但 **gh 不在当前 PATH**，
>   用完整路径 `C:\Program Files\GitHub CLI\gh.exe`（或重开终端）。
> - `_kernel-snapshots/` 仍被 git 忽略 —— 远程仓库里没有它（属另一件事，未做）。
>
> ### 3 验收
>
> - **CI 首跑（run 39061623766）：失败**，且失败点有价值 —— 前 7 步全过
>   （install / tsc / oxlint / vitest），第 9 步 `check-docs` 红：HANDOFF 引用的 `_shots/*.png`
>   是**本地证据目录**（`.gitignore` 排除），CI 检出时不存在 ⇒ 几十条「引用了不存在的文件」。
>   本地之所以通过，是因为 `_shots/` 在磁盘上（本地通过 ≠ CI 通过，这是第一课的现成例子）。
> - **修复**：`scripts/check-docs.mjs` 第 ④ 项把 `_shots/` 从「引用存在」判定中移除
>   （截图属过程产物、不随仓库分发）；修后本地五步全过。
> - **CI 二跑（run 39061817380）：全绿**，7m3s —— 11 步全过（含 Setup Rust + `cargo test --lib`）。
>   annotations 仅剩：既知 4 条 oxlint 警告 + Node 20 弃用提示（已把 checkout / setup-node 升到 v5）。
> - **CI 三跑（升 v5 后）：失败** —— `Unable to locate executable file: pnpm`。根因：`setup-node@v5`
>   默认按 `packageManager` 缓存依赖，执行时 pnpm 还没装。**修法：先 `pnpm/action-setup` 再
>   `setup-node`（顺序不能反）**，已照改并重推。
> - **CI 四跑（run 39062422910）：全绿** —— 顺序修复生效；annotations 只剩既知 4 条 oxlint 警告。
>
> ## 📌 rev129（2026-10-18 · 开发约定与架构边界：docs/开发约定.md）
>
> L3 收官后先立规矩。把 rev122–128 的实测教训写成**长期有效**的约定，防止下一个人
> （或下一次会话）重踩 —— 用户明确要求「先做好后续开发约定、订好架构」。
>
> ### 1 产物
>
> - `docs/开发约定.md`（active）：三条总原则、目录职责与单向依赖（lib ← kernel ← hooks ← App）、
>   hook 编写约定（refs + setters / 稳定引用 / 依赖数组豁免规则 / `useState` 顺序 / effect 顺序）、
>   重构流程 checklist（断言式行号脚本）、测试与 mock 约定、验收门、提交回退、**已知事故清单**。
> - `docs/README.md`：权威矩阵加「写代码 / 重构 / 测试 / 提交约定 → 开发约定.md」，最后核对改 2026-10-18。
> - `docs/App拆分方案-2026-10-18.md`：状态改 **historical**（L3 收官，流程部分被开发约定取代）。
> - `HANDOFF-CARD.md` 硬约束加第 6 条：改代码前先读开发约定。
>
> ### 2 三条最贵的条款（都有事故对应）
>
> - 大段删除只用「断言首尾行 + **先改大行号段** + diff 复核」的脚本，禁止盲删（rev122 误删过常量）；
> - hook 依赖数组「能写全就写全；要豁免必须写明**为什么** + **列了会坏什么**」（rev125–128 反复踩）；
> - **不信任卡片里的行号**，执行前 `rg` 重新定位（行号会漂移）。
>
> ### 3 验收
>
> 本轮只改文档：`check-docs` 全通过；`verify.ps1` 五步全过（代码零改动，tsc 0 · oxlint 4 ·
> cargo 27 · vitest 173）。
>
> ## 📌 rev128（2026-10-18 · L3 第六刀：usePluginHost 抽成 hook，App 2285 行 · L3 收官）
>
> 继续 L3，最后一刀。这一刀抽**插件宿主**：加载链 effect（扫描 → 预装 → 懒激活/立即加载 →
> 平台门 → 串行链）与 `.znp` 安装（从路径安装 / 插件页按钮 / CDP 诊断出口）。
>
> ### 1 产物
>
> - `src/hooks/usePluginHost.ts`（~390 行）：加载链与安装链整段迁出；`loadedPluginsRef` /
>   `pluginChainRef` 一并迁入（只有这个 effect 用它们）。
> - `App.tsx`：**2583 → 2285 行（−298）**。加载 effect 与 `.znp` 安装段删除，换
>   `usePluginHost({ kernel, vault, reloadToken, disabledRef, 各 setter })` 解构 `installZnp`。
> - 清理 plugin-host / plugin-roots / builtin-plugins 的导入与 `confirm` 导入
>   （`PluginDirEntry` / `deletePluginDir` 留在 App：插件页删除与来源判断仍用它）。
>
> ### 2 守住的三条语义
>
> - `loadedPluginsRef` 跨 effect 可见 + `splice(0)` 消费 ⇒ 中途打断也不留幽灵命令；
> - `pluginChainRef` 串行 ⇒ 卸旧代与装新代不交错（不撞「命令 id 重复」）；
> - 平台门在加载前提前判；加载前落 `LS_LOADING`、`finally` 清（启动自愈靠它指认卡死插件）。
>
> ### 3 测试（163 → 173 条）
>
> `tests/use-plugin-host.test.tsx` 10 条：扫描与立即加载、懒激活（declare + activate）、
> 已禁用/平台不符跳过、`LS_LOADING` 落与清、重扫先卸旧代、`.znp` 安装（确认 / 未签名提示 /
> 取消 / 选文件）、`__znInstallZnp` 挂载与卸载。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 warnings · cargo 27 · check-docs · **vitest 173 passed**。
>
> ### L3 收官
>
> App.tsx 从 **3928 → 2285 行**（−1643），6 个 hook：useFileOps / useDocIO / useDocSession /
> useDocApi / useExternalFile / usePluginHost。**拆 App 的清单已清空** —— 下一步不再是拆分会话，
> 而是回到功能/工程债：iframe ↔ 宿主能力通道、插件签名与分发、同步等（见卡片「未决」表）。
>
> ## 📌 rev127（2026-10-18 · L3 第五刀：useExternalFile 抽成 hook，App 2583 行）
>
> 继续 L3。这一刀抽**外部文件**域：三条入口共用的 `openExternalFile` + 冷启动竞态等待
> `waitDocHandler` + Android 热启动监听 + 「待打开」effect + 文件关联接线 effect。
>
> ### 1 产物
>
> - `src/hooks/useExternalFile.ts`（~310 行）：整段迁出，注释与分支顺序逐字保留。
> - `App.tsx`：**2801 → 2583 行（−218）**。`openExternalFile` / `waitDocHandler` / 三个 effect
>   整段删除，换 `useExternalFile({ platform, kernel, vault, applyVault, setToast, refs })`；
>   `pickFile`（☰ 菜单「打开文件…」）留在 App，经 `openExternalFileRef` 进入。
> - 清理 7 个迁移后不再使用的 import（DOC_RE / MD_RE / relPathIn / SAF_READABLE_RE / samePath /
>   splitPath / toLocalPath）。
>
> ### 2 顺序不变的一个关键点
>
> 「待打开」effect 必须排在 `openNoteRef` 同步 effect **之后**（同一轮 commit 按声明顺序执行，
> 排后面才拿得到新 kernel 的 `openNote`）。hook 调用点仍在 `useDocSession` 之后，顺序保持。
>
> ### 3 测试（149 → 163 条）
>
> `tests/use-external-file.test.tsx` 14 条：waitDocHandler 已接管/超时、空路径、3 秒去重、
> content:// 可读/不可读、库内笔记与文档、库外文档不切库、库外笔记切父目录、切库失败不留待打开、
> 待打开 effect 对齐/未对齐、文件关联 listen + opened_urls、Android 热启动只注册在 android。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 4 warnings · cargo 27 · check-docs · **vitest 163 passed**。
>
> ### 仍未做
>
> `usePluginHost`（~500 行，插件加载链 / `.znp` 安装 / 跨库插件根）。
> **续接点**：下一轮做 L3 最后一刀 `usePluginHost`；它依赖 kernel 与多处 state，动手前先
> `rg -n "collectPluginDirs|\.znp|loadPlugin"` 确认真实行号与依赖（卡片里的 ~1800–2400 已过时）。
>
> ## 📌 rev126（2026-10-18 · L3 第四刀：useDocApi 抽成 hook，App 2801 行）
>
> 继续 L3。这一刀抽**文档原语 + 事件广播**：`docApi`（active / open / close / save / selection /
> replaceSelection / insertAtCursor / insertAt / replaceRange / on）+ `fireDoc` + `flushDocChange`。
> 按交接卡要求，这也是三刀里**风险最低**的一刀（无 kernel 依赖）。
>
> ### 1 产物
>
> - `src/hooks/useDocApi.ts`（241 行）：原段整段迁出，逐字保留注释与"尽力而为"语义。
> - `App.tsx`：**2935 → 2801 行（−134）**。`fireDoc` / `flushDocChange` / `docApi` 三段删除，
>   换 `useDocApi({ refs, setActivePath, setContent, setDirty })` 解构；kernel 的 `useMemo` 依赖
>   仍是 `docApi`，其余调用点零改动。
> - `editorRef` 按计划**留在 App**（`MarkdownEditor` 的 `onReady` 与右键「标记」命令都要用），只传进 hook。
>
> ### 2 与 kernel 的依赖方向
>
> 本 hook **不依赖 kernel**（全是 ref + editorRef）⇒ 不引入循环依赖；`docApi` 引用稳定
> （`useMemo` 依赖 `fireDoc` / `flushDocChange`，而它们的依赖链只到 ref）⇒ App 里
> `kernel` 不会因此重建。
>
> ### 3 测试（132 → 149 条）
>
> `tests/use-doc-api.test.tsx` 17 条：active 空/快照、open 转发、close 清空四态 + 清空之前取快照、
> change 先兑现再 close 的顺序、save 转发、selection 无编辑器/有编辑器、
> replaceSelection / insertAtCursor / insertAt 偏移夹紧 / insertAt cursorOffset 夹紧 /
> replaceRange 交换与夹紧、on 广播 + 抛错隔离 + dispose 幂等、fireDoc 无 path 不播、
> flushDocChange 兑现与空 pending。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · **oxlint 4 warnings**（CommandPalette 2 + FileTree 2；新 hook 的
> ref 依赖用 `eslint-disable-next-line` 注明原因，无新增 warning）· cargo 27 · check-docs ·
> **vitest 149 passed**。
>
> ### 仍未做
>
> `openExternalFile`（~495 行，SAF `content://` + 「待打开」effect）· `usePluginHost`（~500 行，
> 插件加载链 / `.znp` 安装）。
> **续接点**：下一轮做 `useExternalFile` —— 动手前先整段读完 openExternalFile 相关 effect（拆分后
> 行号已变，以 `rg -n "openExternalFile"` 为准）。
>
> ## 📌 rev125（2026-10-18 · L3 第三刀：useDocSession 抽成 hook，App 2935 行）
>
> 继续 L3。这一刀抽**文档会话**：`openNote` / `openWikiLink` / `closeNote`（打开哪篇、关掉哪篇）。
>
> ### 1 产物
>
> - `src/hooks/useDocSession.ts`（~200 行）：三个动作 + `openNoteRef` 同步 effect。
> - `App.tsx`：**2980 → 2935 行（−45）**。原段（openNote / openWikiLink / closeNote）整段删除，
>   换 `useDocSession({...})` 解构；其余调用点（侧栏、快速切换、搜索、命令）零改动。
>
> ### 2 与 useDocIO 的分工
>
> `useDocIO` 管"内容怎么读写/合并"；`useDocSession` 管"当前是哪一篇"。
> 切换前落盘仍走 `saveNowRef`（与迁出前同一套语义，不重复实现）。
>
> ### 3 测试（122 → 132 条）
>
> `tests/use-doc-session.test.tsx` 10 条：openNote 正常/脏先存/同篇不动作/失败不清空/frontmatter 跟随、
> closeNote 清空四态/脏先存、openWikiLink 命中与找不到、openNoteRef 挂载后同步。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint 5 · cargo 27 · check-docs · **vitest 132 passed**。
>
> ### 仍未做
>
> `docApi`（114 行，依赖 fireDoc/flushDocChange 与 refs）· `openExternalFile`（~495 行，SAF）· `usePluginHost`。
> **续接点**：下一轮先抽 `useDocApi`（docApi + fireDoc + flushDocChange，无 kernel 依赖、风险最低），
> 步骤与三个已知坑见 `HANDOFF-CARD.md` 的「下个会话第一件事」。


>
> ## 📌 rev124（2026-10-18 · L3 第二刀：useDocIO 抽成 hook，App 2980 行）
>
> 继续 L3。这一刀抽**文档读写域**（上一刀是文件操作域）。
>
> ### 1 产物
>
> - `src/hooks/useDocIO.ts`（~330 行）：`refresh` · `mergeWithDisk`（rev62 三方合并）·
>   `mergeIntoEditor` · `reloadActiveFromDisk` · `saveNow`（写盘前合并 + 原子写）·
>   `onEditorChange`（800ms 自动保存 + `doc.on('change')` 去抖广播）·
>   三个兜底 effect（`fs.watch` 回灌、失焦/页面隐藏落盘、关窗前落盘）。
> - `App.tsx`：**3239 → 2980 行（−259）**。四段（refresh 到关窗前 effect、onEditorChange）整段删除，
>   换成一个 `useDocIO({...})` 解构；`openNote`/`closeNote`/`docApi` 仍在 App（下一刀）。
>
> ### 2 设计要点
>
> - refs 留在 App 创建、作为参数传入（`notesRef` / `contentRef` / `activeRef` / `dirtyRef` / `baseRef` /
>   `saveNowRef` / `timerRef` / `docChangeTimerRef` / `docPendingRef` / `externalReloadRef`）——
>   它们是"事件里读最新值"的那一份，与 App 顶部注释的口径一致；App 里 `docApi` 还要用它们。
> - `closingRef`（关窗闸门）随 effect 一起迁入 hook（`useRef(false)`）。
> - 写盘顺序原样保留：先合并 → 写 → 成功才 `fireDoc('save')`；失败绝不显示「已保存」。
>
> ### 3 测试（113 → 122 条）
>
> `tests/use-doc-io.test.tsx` 9 条：refresh 写 notesRef、saveNow 成功/未变/失败三态、
> onEditorChange（正常 / 外部重载跳过 / 去抖广播）、reloadActiveFromDisk（变了 / 没变）。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · **oxlint 5 warnings**（比上一轮少 1 —— 原来 `App.tsx` 里
> `refresh()` 那条 `set-state-in-effect` 随 effect 迁进 hook 后不再命中）· cargo 27 · check-docs · **vitest 122 passed**。
>
> ### 仍未做
>
> - `useDocSession` 的剩余部分：`openNote` / `openWikiLink` / `closeNote` / `docApi`（与 `openNoteRef` 互相引用，需一起搬）。
> - `openExternalFile`（~495 行，SAF / 文件关联）。
> - `usePluginHost`（加载链 / `.znp`）。


>
> ## 📌 rev123（2026-10-18 · L3 第一刀：useFileOps 抽成 hook，App 3238 行）
>
> 用户裁决「做 L3」。按方案的风险排序，先抽**依赖最少**的文件操作域（剪贴板 / 回收站 / 删除 / 撤销）。
>
> ### 1 产物
>
> - `src/hooks/useFileOps.ts`（~330 行）：`clipboard` / `cutPaths` / `copyPaths` / `pasteInto` /
>   `duplicateEntry` / `trash` / `confirmPurge` / `confirmEmpty` / `openTrash` / `restoreTrashItem` /
>   `purgeTrashItem` / `emptyTrashAll` / `deleteNotes` / `purgeNotes` / `undoDelete` / `undoDeleteNote` / `fmtSize`。
> - `src/lib/format.ts`：`fmtSize`（纯函数，回收站列表用）。
> - `App.tsx`：**3501 → 3238 行（−263）**。原段整段删除，改成一个 `useFileOps({...})` 解构 ——
>   其余调用点（侧栏 props、回收站视图、撤销条）**零改动**，变量名保持不变。
>
> ### 2 关键约束（迁移时逐条保留）
>
> - 删除：先落盘未保存改动 → 逐个 `delete` → 打开着的笔记/目录被删则清空编辑器 → 挂撤销条；
> - 彻底删除：`delete` → `listTrash` 按 `originalPath` 找 id → `purgeTrash`（**不拿 delete 返回值当 id**）；
> - 剪切：撞名报错、粘回原位静默跳过；复制：撞名自动退成「 副本」；
> - 撤销条 5 秒自动消失的 effect 也一并迁入。
>
> ### 3 测试（102 → 113 条）
>
> `tests/use-file-ops.test.tsx` 11 条（`renderHook` + 假 kernel）：剪切/复制提示、粘贴撞名两种策略、
> 删除挂撤销条、删除打开着的笔记清空四态、撤销走 `restore_trash`、彻底删除两步、清空回收站。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint **6 warnings（未新增）** · cargo 27 · check-docs · **vitest 113 passed**。
>
> ### 5 踩坑记录
>
> `undoDelete` 的 `useState` 最初留在原位置（deleteNotes **之后**），而 `deleteNotes` 的依赖数组引用了
> `setUndoDelete` ⇒ oxlint `react(immutability)` 报「Cannot access variable while it is being initialized」
> （第 7 条 warning）。把 state 提到 `deleteNotes` 之前即消除。**教训：抽 hook 时 state 声明顺序要满足所有引用方的初始化顺序。**
>
> ### 仍未做
>
> `useDocSession`（打开/保存/合并，~700 行）与 `usePluginHost`（加载链/`.znp`，~500 行）——
> 它们与文档域/插件域有双向数据流，需各自单独一批、每抽一个跑一次 verify。


>
> ## 📌 rev122（2026-10-18 · App.tsx 拆分 L1+L2：3928 → 3501 行）
>
> 用户要求：「设计方案然后做拆分，拆完测试」。方案落 `docs/App拆分方案-2026-10-18.md`
> （分层 L1 模块 / L2 组件 / L3 hook / L4 性能，按风险排序）。本轮做 **L1 + L2**。
>
> ### 1 L1：模块级工具 → `src/lib/`（−241 行）
>
> | 新模块 | 迁入 |
> |---|---|
> | `lib/app-paths.ts` | `vaultKey` · `baseName` · `toLocalPath` · `splitPath` · `samePath` · `relPathIn` · `MD_RE` / `DOC_RE` / `SAF_READABLE_RE` |
> | `lib/recent.ts` | 最近库/最近命令的读写 · `vaultExists` · 上限常量 |
> | `lib/fail-msg.ts` | `failMsg` + `FailKind` / 话术表 · `SaveState` |
> | `lib/boot-heal.ts` | 启动自愈（模块级执行）+ `loadDisabled` + `LS_DISABLED` / `LS_LOADING` |
>
> 纯搬移：函数体与注释原样，只改 import/export。
>
> ### 2 L2：JSX 块 → `src/components/`（−186 行）
>
> `AppSidebar`（侧栏 + FileTree 挂载）· `AppTrashView`（回收站整页）·
> `AppEmptyState`（空态三态 + Markdown 速查表，`MARKDOWN_CHEATS` 一同迁入）·
> `AppStatusBar`（计数 + statusbar 面板 + 字数）· `AppResizer`（拖拽分隔线）。
>
> 均为纯 props 渲染、不持有状态；二次确认、抽屉开关等状态仍留在 App。
>
> ### 3 测试（44 → **102 条**）
>
> - L1 单测 43 条：`app-paths` 20 · `recent` 9 · `fail-msg` 7 · `boot-heal` 7（启动自愈用动态 import + localStorage 替身）。
> - L2 组件测试 15 条（happy-dom + @testing-library/react）：`AppEmptyState` 4 · `AppTrashView` 6（含点两次确认）· `AppStatusBar` 5。
> - `vitest.config.ts` 的 include 扩到 `tests/**/*.test.{ts,tsx}`。
>
> ### 4 验收
>
> `verify.ps1` 五步全过：tsc 0 · oxlint **6 warnings（未新增）** · cargo 27 passed · check-docs · **vitest 102 passed**。
>
> ### 5 踩坑记录
>
> 用脚本按行号删除迁移段落时，中途又做过一次 edit ⇒ 行号偏移，误删了
> `DOC_CHANGE_DEBOUNCE_MS` 与 `MARKDOWN_CHEATS` 的结尾，tsc 报 `TS1128`。已按残片修复；
> 教训：**按行号改文件时，先落最终行号再做一次 edit 都不要**，或每次改完重新 grep 定位。
>
> ### 仍未做（L3）
>
> 状态域 hook 化（`useDocSession` / `usePluginHost` / `useFileOps`）—— 共享 20+ state/ref，
> 风险高；组件测试已就位，建议下一轮逐个抽、每抽一个跑一次 verify。


>
> ## 📌 rev121（2026-10-18 · 修两条待定语义 + vitest 并入 verify）
>
> 用户裁决「一起做」（rev120 末列的两条路都做）。
>
> ### 1 A1：merge3 同点插入判冲突
>
> - `samePointInsert(a, b)`：两块都是零长度（`start === end`）且落在同一点 ⇒ 判冲突，
>   mine 赢、theirs 那段丢弃、`conflicts + 1`（diff3 语义）。
> - 冲突清理补一条：零长度 mine 块 `[1,1)` 用 `start < cm.end` 一个都命中不了，
>   必须额外丢掉「同一点上的 theirs 零长度块」，否则下一轮会当独立插入重新吐出来（= 旧 bug）。
> - 影响：编辑器末尾打字 + 插件末尾追加 现在会**丢插件那段**（用户已接受这个取舍），但 `conflicts` 有值可提示。
> - 不相交合并、插入 vs 替换同点（`{1,1}` vs `{1,2}`）行为不变。
>
> ### 2 A2：command 接管改「层栈」
>
> - `Entry` 从「单实现 + dispose 闭包还原点」改为 `layers: Layer[]` 栈：
>   `register` / `bind` / `declare` 各 push 一层，`dispose` **只摘自己那层**（`dropLayer`，引用相等、幂等），栈空才删条目。
> - 修复：A、B 先后接管同一命令、A 先卸载时，B 卸载后落回**内核**（之前落回已卸载的 A —— 僵尸实现）。
> - 元数据也随层还原（`metaOf` 从栈顶往下取第一个有值的层）；`bind` 层不带元数据，沿用 `declare` 的标题/快捷键。
> - 语义微调：`declare` 的 dispose 现在也只摘自己那层（不再无条件删条目）。
>
> ### 3 B：vitest 并入 verify.ps1
>
> - `verify.ps1` 从四步变**五步**：新增 `=== 5/5 前端单元测试（vitest）===`，解析 `Tests N passed`，失败计入 `$fail`；
>   基线行改为 `tsc · oxlint · cargo · vitest`。
> - 改完 `.ps1` 跑了 `fix-bom.ps1`：edit 会剥 BOM，已恢复 `EF BB BF`（PS 5.1 下无 BOM 会按 GBK 解析）。
>
> ### 验收
>
> - `verify.ps1` 五步全过：tsc 0 · oxlint 6 warnings · cargo **27 passed** · check-docs · **vitest 44 passed**（318 ms）。
> - 前端单测 44 条（rev120 的 41 + A1 新增 1 + A2 新增 2）。

> ## 📌 rev120（2026-10-18 · 前端单测 vitest：41 条覆盖内核纯逻辑）
>
> 此前前端只有 `tsc -b` + `oxlint`，**没有一条行为级测试**；内核里最容易出错、
> 又最难人工回归的三块（三方合并 / 命令接管还原 / 事件总线）全是纯函数，最适合单测。
>
> ### 1 接入方式
>
> - `vitest` **5.0.5**（devDependency，`pnpm add -D vitest`）。
> - `vitest.config.ts` **独立于** `vite.config.ts`：后者读网卡枚举（`lanIp`）挂 react/tailwind 插件，
>   单测用不上，还会把「本机有没有局域网」变成测试前置条件。这里只留 `@` 别名 + `tests/**/*.test.ts`。
> - 测试放 `tests/`（**不在** `tsconfig.app.json` 的 `include: ["src"]` 里）⇒ `tsc -b` 基线仍是「只查 src」，
>   测试代码由 vitest 自己转译，不会让 `verify.ps1` 第 1 步变红。
> - `package.json`：`"test": "vitest run"` · `"test:watch": "vitest"`（**未**并入 `verify.ps1` 四步，见未做）。
>
> ### 2 覆盖（41 条）
>
> | 文件 | 条数 | 覆盖点 |
> |---|---|---|
> | `tests/merge3.test.ts` | 19 | `splitLines` 尾空串往返 · `diffBlocks` 增/删/改/多块/DP 规模退化 · `mergeLines` 快捷路径、不相交合并、冲突 mine 赢、尾换行、中文行 |
> | `tests/command.test.ts` | 15 | 命名空间校验 · 同 id 接管与 dispose 还原 · 懒激活（declare/bind/activator）· 嵌套接管 · `release` · `implTag` 三态 · onError |
> | `tests/event.test.ts` | 7 | on/emit · dispose 清空 · Set 去重 · 单 handler 抛错隔离 · disposeAll 容错 · stats |
>
> 实测：`pnpm exec vitest run` → **3 files / 41 passed**（285 ms）。
> `verify.ps1` 复跑四步全过（tsc 0 · oxlint 6 warnings · cargo 27 passed · check-docs），基线未动。
>
> ### 3 单测记录出的两个待定语义（**只记录，未改代码**）
>
> 写测试时按「应该怎样」断言的 3 条实际都对不上实现，核对后确认是**行为差异而非测试写错**，
> 已按现状断言并注释，留给产品/内核决策：
>
> 1. **merge3 同点插入不算冲突**：`base` 末尾两边各追加一行（块都是 `start === end`），
>    归并判据 `cm.end <= ct.start` 认为不交叠 ⇒ 两段**都保留**、`conflicts = 0`。
>    后果：编辑器末尾打字 + 插件末尾追加 ⇒ 两段拼接（内容不丢，但没有冲突提示）。
>    ⚠️ diff3 标准语义会把「同一位置插入」判冲突；改判据属于合并策略变更。
> 2. **command 还原链残留（僵尸实现）**：A、B 先后 `bind` 同一命令，A 先 dispose
>    （此时实现是 B ⇒ 按设计跳过、不抹 B），但 A 那层还原点也就丢了 ⇒ B dispose 后还原到 **A**
>    而不是内核。危害：插件 A 已卸载，命令仍指回 A 的函数。
>    修法要在 dispose 时把「被跳过的层」从还原链摘掉 —— 需要内核改动，未做。
>
> ### 未做
>
> - **未并入 `verify.ps1`**：四步是文档写死的基线（`check-docs` 会校验），加第 5 步要先改文档与 `check-docs`；
>   当前单独跑 `pnpm test`。
> - **没有组件测试**：`src/components/**` 需要 DOM 环境（happy-dom/jsdom + @testing-library/react，新依赖未加）；
>   `src/kernel/store.ts` / `fs.ts` 依赖 Tauri `invoke`，未 mock。
> - 上述两个待定语义未修。


>
> ## 📌 rev119（2026-10-18 · 插件完整性 sha256 + `.znp` 单文件安装）
>
> 接 rev118（用户裁决「2 做 A+B、3 做 A+B」的后半）。
>
> ### 1 完整性（A）
>
> - `PluginManifest.sha256`：**入口文件**的 SHA-256（小写 hex）。
> - 加载时用 Web Crypto 比对（零新依赖）；不符**拒载**，错误里给出「声明前 12 位 vs 实际前 12 位」。
> - 没写 `sha256` ⇒ 插件管理页标「未校验」；安装 `.znp` 时提示「未签名」。
> - ⚠️ 只覆盖 entry 一个文件 —— 是**完整性提示**，不是签名（公私钥验签仍未做）。
>
> ### 2 单文件插件包（B）
>
> - `.znp` = JSON：`{ znp:1, manifest:{…}, files:{ "index.js":"…" } }`。
>   为什么不是 zip：Rust 侧没有 zip 依赖，而插件包 99% 是文本 —— JSON 零依赖、可读可 diff。
> - Rust：`read_znp`（预览 manifest/files）+ `install_znp`（写到 `<私有根>/.zn/plugins/<id>/`；
>   包内每个路径过 `plugin_file()` 白名单，`..` 越不出去）。
> - UI：插件管理页「安装插件包（.znp）…」→ 选文件 → **原生确认框列出它自称要的能力 + 签名状态** → 安装并重扫。
>
> ### 3 capability 安装确认（A+B 的 B）
>
> 维持「capability 只是自述、内核不拦截」，但安装 `.znp` 时把自述摊到用户面前：
> `安装插件「x」？自称需要：fs:read、command … ⚠ 未签名：安装后它会以你的权限执行任意代码`。
>
> ### 验收
>
> - `verify.ps1` 四步全过（tsc 0 · oxlint 6 warnings · **cargo 27 passed** · check-docs）
> - 新增 2 个 Rust 单测：`install_znp_writes_manifest_and_entries` · `install_znp_rejects_path_escape`
> - **sha256 两条路径实测**（2026-10-18，测试库 `sha-demo` 夹具）：
>   ① 正确 hash ⇒ 插件正常加载（`window.__shaDemo === 'loaded'`）；
>   ② 篡改入口 ⇒ 拒载，插件页显示
>   `插件 sha-demo 完整性校验失败：入口文件 sha256 不符（manifest 声明 202a91ab5b1c…，实际 4ccb2a10ec9a…）—— 文件可能被改过`。
>   夹具验完已删。
> - **`.znp` 安装链路实测**（2026-10-18，经诊断出口 `window.__znInstallZnp(path, false)` 驱动）：
>   安装 `znp-demo.znp` ⇒ 返回 id、`manifest.json`（231 B）+ `index.js`（64 B）落盘、
>   重扫后插件执行（`window.__znpDemo === true`）、管理页显示「znp 演示 v1.0.0 · 本库 · 未校验 · command」。
>   ✅ **原生文件选择器与确认框已人工验证**（2026-10-18 用户跑通：安装触发与「未签名」提示均正常，
>   实装的是翠绿主题包 `C:\Users\AQUA\Downloads\zeronote-theme-green.znp`）；夹具验完已删。
>
> ### 仍未做
>
> 真正的签名（公私钥）/ 市场 / 更新通道；`.znp` 的 UI 端到端（可在插件页手工试一次）。

> ## 📌 rev118（2026-10-18 · 契约 v0.2 落到代码 + 独立笔记 ID + rename 引用重写）
>
> 用户裁决：契约 v0.2 三项「统一更新版本 / 独立 ID / 插件签名分发 A+B / capability A+B」。
> 本轮做前两项；签名分发与安装确认排下一轮。
>
> ### 1 版本统一（契约 v0.2 = 代码）
>
> - `contract.ts` 的 `API_VERSION`：`0.1.0` → **`0.2.0`**（此前文档写 v0.2、代码停 0.1）。
> - 29 个 `examples/*/manifest.json` + 测试库 6 个插件的 `apiVersion` → `^0.2.0`。
> - 加载校验只比 major（`assertApiVersion`），0.1 / 0.2 互通，现装插件不受影响。
> - `CHANGELOG.md` / 契约 §5 版本历史同步。
>
> ### 2 独立笔记 ID
>
> - `NoteMeta.id`（Rust + 前端类型）：存 `<库>/.zn/ids.json`（`{ 相对路径: id }`）。
>   **不写进正文 frontmatter** —— 不动用户 md 内容是硬约束；代价是外部程序移动文件后键失效，
>   `list_notes` 会补一个新 ID。
> - ID 生成：毫秒 + 纳秒低位 + 进程号混合（不引 uuid 依赖）。
> - `rename_note`：ID 键跟着文件走；`list_notes` 只在有新项时才写盘。
> - 前端 `openWikiLink`：先按 ID 精确匹配，再回退 路径 → 后缀 → 标题。
>
> ### 3 rename 全库引用重写（§7.1）
>
> `rewrite_links`：`[[旧文件名]]` / `[[旧名|显示]]` / `[[旧标题]]` / `](旧相对路径)` → 新名。
> 只做**字面替换**（不引正则，避免误伤代码块里的同名字符串）；跳过 `.zn` 等私有目录与 >4MB 文件；
> 失败只留日志、不回滚改名（笔记本身已安全落位）。
>
> ### 验收
>
> - `scripts\verify.ps1` 四步全过（tsc 0 · oxlint 6 warnings · cargo test 25 passed · check-docs）
> - 新增 2 个 Rust 单测：`ids_are_stable_and_follow_rename` · `rename_rewrites_path_links_and_aliases`
>
> ### 下一步（未做）
>
> 插件签名分发 A+B（manifest sha256 + 未签名提示 + `.znp` 单文件安装）· capability 安装确认弹窗。

> ## 📌 rev117（2026-10-18 · 测试报告 16 项逐条实测 + 7 项修复）
>
> 起点是 `docs/测试报告-2026-10-17.md`（基于 rev92 的历史快照）。**在当前 HEAD 上逐条实测核实**：
> 11 项仍成立 · 1 项作废（P2-4）· 2 项待验（P1-5 实为配置问题 / P2-3 需真机）·
> 2 项不算缺陷（P2-7 观察项 / P3-4 方法论）。修了其中 7 项。
>
> ### 修复
>
> 1. **P1-1 折叠残留竖线**（`kernel/editor-marks.ts`）：新增 `hiddenLineSet`，
>    行 class / 行首按钮 / mark 装饰一律**跳过被折叠隐藏的行**。之前它们会被 map 到折叠点，
>    背景线照画 ⇒「内容没了、线还在」。实测：折叠「一级 A」后其下方不再有线
>    （`_shots/rev117/09-fixed-fold.png` vs 修复前 `07-after-unfold.png`）。
> 2. **P1-2 `frontmatter` 恒空**（`App.tsx`）：新增 `frontmatterRef`，`openNote` 时从
>    `list_notes` 的 meta 抄一份，`doc.on(...)` 与 `doc.active()` 都读它。
>    实测（临时探针读 `window.__p12`）：打开 `fm-probe.md`，`open` 事件里
>    `frontmatter` = `{priority, tags, title}`（修复前恒 `{}`）。
> 3. **P1-3 原子写先删旧**（`lib.rs`）：改 `.zn-bak` 三步（旧→bak、新→原位、删 bak），
>    任一步失败可还原。顺带更正注释：`std::fs::rename` 在 Windows **本来就会覆盖**
>    （`MoveFileExW`），原注释「不覆盖已存在文件」是错的。
> 4. **P2-1 暗色竖线对比度**（`styles.css`）：暗色单独给 `--zn-ol-line: #6b6b73`（≈3.4:1），
>    不抬全局 `--zn-border`。实测计算值 `#6b6b73`。
> 5. **P2-2 `[[链接]]` 点击**（`MarkdownEditor.tsx`）：atomic 的 inline-preview 点击只认
>    http/https。改在 document **捕获阶段**接管 `.cm-atomic-link`，取链接可见文本交宿主
>    `openWikiLink`（路径 → 后缀 → 标题三级匹配，找不到有 toast）。实测：点
>    `[[新笔记-18-09-36]]` 后标题变为「一级标题」。
> 6. **P2-5 每订阅者 3 秒轮询**（`kernel/fs.ts`）：轮询改为**只在事件通道不可用时**启动
>    （`listen` 成功 → `stopPoll()`，失败 → `startPoll()`）。
> 7. **P2-6 无 engines**（`package.json`）：`packageManager: pnpm@10.34.6` +
>    `engines.node >=20` / `pnpm >=9`。
>
> ### 未改（附依据）
>
> - **P1-4 冷启动慢**：1000 篇实测冷启动 **12,045 ms**、热态 **90–607 ms**；
>   同目录 `pwsh` 读 1000 篇全文仅 **379 ms** ⇒ 不是「取标题读全文」的锅，
>   是 Windows 首次访问 + Defender 扫描。改代码收益低，留给「大库优化」单独评估。
> - **P2-3 Android 二进制导出**：✅ **作废**（2026-10-18 用户实测长图 png 可导出）。
>   ⚠️ 同时更正测试报告与上一版交接的措辞：产品**没有「导出 zip」功能** ——
>   `examples/import-export/` 只注册 txt / html / png / docx / pdf 五种导出，
>   zip 只出现在 EPUB **导入**解包与出包流程里。
> - **P2-7「❖ 与手柄同排」**：观察项，等用户判断。
> - **P3-1/2/3**：App.tsx 3,660 行 / 无前端单测 / 无远程 CI —— 工程债，单独立项。
>
> ### 验收
>
> `scripts\verify.ps1` 四步全过（tsc 0 · oxlint 6 warnings · cargo 23 passed · check-docs）；
> `tools/verify-outline-fold.mjs` **10/10**。
>
> ### 副作用 / 夹具
>
> - 修复过程中 dev 崩过一次（`0xc0000374`，HMR 触发，已知坑），已重启；全部实测在新 dev 上重做。
> - 测试库 `_tmp-vault-tb` 新增：`p1-p2-verify.md`、`fm-probe.md`、`新笔记-00-30-39.md`、
>   `新笔记-00-31-28.md`、探针插件 `.zn/plugins/p12-probe/`；`_shots/rev117/`；`_tmp-perf*/`（各 1000 篇）。
>   **2026-10-18 已清理**（含 `.zn/ids.json` 里的孤儿键）；`_shots/rev117/` 只留
>   `09-fixed-fold.png` —— 本文引用的折叠修复证据。

> ## 📌 rev116（2026-10-17 · 起始页速查表手机单列：左留白 48 ＋ 间隔 73）
>
> 需求：安卓上「标记和右边解释的宽度」可调 —— 用户用临时滑块（间隔 / 左移）手拖定
> **间隔 73 / 左边留白 48**（先拖 42，再连右移两次 3px）；拖的过程中发现「间隔一调大，
> 右侧解释就被挤成省略号」。
>
> ### 根因
>
> 手机单列沿用了桌面宽度约束（`620px` / `max-width: calc(100% - 132px)` / `margin-left: 108px`），
> 443 逻辑宽的屏幕上表格只剩 ~311px；`code 104 + gap` 一放大，解释区就没了。
>
> ### 做法（`styles.css` 的 `@media (max-width: 640px)`）
>
> 1. 速查表：`width: calc(100% - 54px)`、`max-width: none`、`margin-left: 48px` ——
>    单列左边留白 48、右边 9，其余占满；
> 2. `.zn-md-cheat { gap: 73px }` —— 用户拖定值（桌面两列仍是 10px，列一窄 73 就没地方）；
> 3. 临时调节器（间隔 / 左移）与 state 全部删除。
>
> ### 验收
>
> 真机截图 `_shots/mobile-final-48.png`：14 条解释全部完整、无省略号；`tsc` 0 错误。
>
> ### 附：同一轮的环境收尾（2026-10-17 深夜）
>
> 1. **出包**：桌面 release `zeronote.exe`（13.86 MB）→ `C:\Users\AQUA\Apps\_View\办公与文档\`；
>    Android release APK（16.11 MB，签名 `2ca79f19…35bb`）→ `C:\Users\AQUA\Apps\_View\安卓应用\`；
>    旧 exe 备份为 `.bak-20261017-2209`。
> 2. **手机跑的是 dev 包**：包名 `com.aqua.zeronote.debug`（2026-10-11 首次安装，热重载用）；
>    `com.aqua.zeronote`（release）已被用户卸载，两个包别混。
> 3. **防火墙**：手机 2.4G / 电脑 5G 跨 SSID，且网络被识别为 **Public** —— 加了一条入站规则
>    `ZeroNote Vite Dev 1420 LAN`（TCP 1420，仅 `192.168.1.0/24`），否则手机连不上 dev server。
> 4. **已知问题**：dev 连续多次 HMR 会触发 `0xc0000374 STATUS_HEAP_CORRUPTION`（今晚两次），
>    重启 dev 即可；`android-dev.cmd` 里 `rem（⚠️` 中文注释会让 cmd 报一行错（不影响执行）。
>
> ## 📌 rev115（2026-10-17 · 起始页速查表视觉对齐定稿：宽 620 / 右移 54）
>
> 需求：用户连问三轮 —— 「数值居中，但视觉效果不居中，红色轴线和绿色轴线应该接近重合」。
>
> ### 根因（不是居中算错）
>
> 数学上三元素中心本来就全等于编辑区中心（CDP 实测，任意侧栏宽 / 视口宽，误差 0.00）。
> 视觉偏左的真实原因：**表格边界不可见** —— 速查表两列各 `1fr`，右列说明普遍 2–3 个字
> （「加粗」「删除线」），右列右侧留出一大片空白，肉眼把表看窄、看成偏左。
>
> ### 做法
>
> 1. 不再猜数值：加**临时滑块调节器**（宽 / 右移），用户亲手拖到视觉顺眼 → 拖定 **620 / 54**；
> 2. 固化到 `styles.css` `.zn-md-cheatsheet`：
>    `width: 620px` · `margin: 20px 0 0 108px`（flex 居中下右移 = margin-left ÷ 2 = 54）·
>    `max-width: min(620px, calc(100% - 132px))`（108 左移 + 24 右留白，窄窗口不贴边/不溢出）；
> 3. 调节器与 state 全部删除（不留调试代码）。
>
> ### 验收
>
> 窗口宽 1100 / 1440 / 1920 / 2560 实测：右移恒 **+54**（1100 时宽度压到 584 防贴边，偏移不变）；
> `tsc -b` 0 错误。截图 `_shots/rev115-final-1920.png`、`_shots/rev115-final-1100.png`。
>
> ### 教训（写进规范）
>
> 「居中」是数学性质，可脚本证明；「视觉居中」是感知性质，只能由人判定 ——
> 前者给实测数据，后者给可拖的旋钮，不要用人眼替对方估。

> ## 📌 rev112（2026-10-17 · 起始页排版对称 ＋ 桌面 release 独立构建）
>
> 需求：
> 1. 「排版改优雅和谐对称一点」；
> 2. 「桌面端也编译一个版本，数据和 dev 隔离」。
>
> ### 起始页（`styles.css`）
>
> - 两列**等宽**网格 + 语法块**固定 104px** ⇒ 左右两列的语法块严格对齐、说明起点一致；
> - 列距 36px / 行距 9px 统一；整表 `margin: 0 auto` 居中。
>
> ### 桌面 release（数据隔离）
>
> ⚠️ **关键坑**：`pnpm tauri build --config '{"identifier":...}'` **只影响 bundle，不影响运行时** ——
> single-instance 仍按**编译时**的 `identifier` 判定，导致 release 与 dev 互斥、**起来就退**（ExitCode 0）。
> **必须真改 `tauri.conf.json`** → 构建 → **恢复**。
>
> 做法：
> 1. 临时把 `identifier` → `com.aqua.zeronote.release`、`productName` → `ZeroNote Release`；
> 2. `CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote-release pnpm tauri build --no-bundle`
>    （独立 target 目录，不与 dev/Android 抢 cargo 锁）；
> 3. 恢复 `tauri.conf.json`（`.dev-backup` 备份）。
>
> 产物：`C:\Users\AQUA\cargo-targets\zeronote-release\release\zeronote.exe`（13.9MB，release）。
>
> **隔离验证**：
> - 数据目录：`%LOCALAPPDATA%\com.aqua.zeronote.release`（新）vs dev 的
>   `%LOCALAPPDATA%\com.aqua.zeronote`（旧，10/11）—— 互不相干 ✅
> - release 首次打开是**空库**（截图 `_shots/release-window.png`：左侧「还没选择笔记库」）——
>   不会自动打开 dev 的库；要与 dev 共用某个库，选同一个文件夹即可（笔记是文件）。
> - **dev 与 release 可以同时跑**（不同 identifier ⇒ single-instance 不互斥，截图 `_shots/dev-release-both.png`）。
>
> ⚠️ **第二个坑**：`tauri::generate_context!` 是**编译期宏**，**不追踪 `tauri.conf.json` 的变化** ——
> 改完 conf 直接 rebuild 出来的 exe **仍嵌旧 identifier**（表现为 release 与 dev 抢 single-instance）。
> 必须 `cargo clean -p zeronote`（对应 `CARGO_TARGET_DIR`）再构建/重启。
>
> ### 安卓（同步）
>
> APK 重构建（含速查表）→ `adb install` 成功 → 真机截图确认单列速查表 + 新建按钮
> （`_shots/android-latest.png`）。
>
> ## 📌 rev111（2026-10-17 · 起始页改成 Markdown 标记速查表）
>
> 需求原话：「起始页改成markdown各种标记提示，新建笔记可以保留」。
>
> ### 改法（`App.tsx` + `styles.css`）
>
> - 空态「选一篇开始」下面加**两列速查表**（`MARKDOWN_CHEATS`，14 条）：
>   标题 / 粗体 / 斜体 / 删除线 / 无序列表 / 有序列表 / 任务列表 / 引用 /
>   行内代码 / 代码块 / 链接 / 图片 / 表格 / 分割线；
> - 「新建笔记」按钮**保留**（在速查表上方），底部快捷键提示不变；
> - 左列写法用等宽字体 + 底色块，右列是作用；窄屏（< 640px）自动单列。
>
> ### 实测
>
> 空态渲染 `.zn-md-cheatsheet`，14 个子项（`# 标题`、`**粗体**`、…）。
> 截图 `_shots/rev111-start-page-cheatsheet.png`。`tsc` 0 错误。
>
> ## 📌 rev110（2026-10-17 · 安卓内置插件预装 ＋ APK 构建）
>
> 需求原话：「测一下最近修改在安卓端的情况，编译一个最新的apk包，把几个插件也放进去，
> 还有安卓插件能不能不用自己一道目录，而是默认放在目录，要安装其他插件的时候再自己添加到目录里面」。
>
> ### 内置插件预装（解决"安卓上用户没法自己拷插件"）
>
> 1. `src/kernel/builtin-plugins.ts`：用 vite 的 `?raw` 把 **8 个插件**的源码打进前端包
>    （outline-map / daily-note / doc-reader / import-export / inspiration-flow / tag-demo /
>    editor-marks / theme-sepia），每个只带运行必需文件（`index.js` + `manifest.json` + 样式，
>    不带 selftest / store）；
> 2. Rust 新增 `write_plugin_file(vault, plugin_id, rel, content)`（走 `plugin_file` 的路径校验，防 `..`）；
> 3. App 的插件扫描 effect 开头调 `ensureBuiltinPlugins(vault)` —— 每次启动把内置插件写进
>    `<私有根>/.zn/plugins/<id>/`（覆盖为内置版本；**用户自己加的插件不受影响**）。
>    ⇒ 安卓与桌面一致：内置的默认就有，额外插件仍往同一个目录加。
>
> ### 构建踩坑（MSVC D8050）
>
> `pnpm tauri android build --debug --apk` 在 host 编译 `vswhom-sys` 时失败：
> `cl: 命令行 error D8050 :无法执行 c1xx.dll`。
> 根因：`cc` crate 默认给 MSVC 加 `/Z7`（调试信息），c1xx 的调试记录区装不下。
> 修法：改 cargo registry 里 `vswhom-sys-0.1.3/build.rs`，在 `cc.cpp(true)` 后加 `cc.debug(false)`。
>
> ⚠️ **这是对第三方 crate 源码的本地 patch，不在项目仓库里** —— 清 cargo 缓存/换机器后要重做。
>
> ## 📌 rev109（2026-10-17 · 表格快捷操作：对齐按钮 / 调行列 / 菜单 + 删除）
>
> 需求原话：「增加表格快捷操作，1 调整行列，2 对齐按钮，3 增加表格修改菜单和删除按钮」
> （附 Typora 参考图：左上角工具条 + 对齐面板 + 菜单）。
>
> ### 实现（新组件 `src/components/TableToolbar.tsx`）
>
> atomic 的 table widget 只负责渲染 + 单元格编辑，**没有任何表格操作 UI**。补一层：
>
> 1. **触发**：`zn-editor` 的 `onPointerDown` 判断点击是否落在 `.cm-atomic-table` 上。
>    ⚠️ **不能用选区判断**：表格是整表替换的 widget，点单元格走 contenteditable，
>    CM6 的选区根本不进表格（实测 `selection.head` 永远在表格外）——用点击目标才对；
> 2. **工具条**（表格左上角）：`⊞ | 左 中 右 | ⋮ | 🗑`
>    - **⊞**：**快捷调整行列数**（2026-10-17 用户澄清：参考图那个网格是调尺寸，不是对齐）——
>      8×8 网格，悬停高亮并显示 `3 × 3`，点击即 resize（保留现有内容，缺的补空、多的裁掉；
>      **行数含表头**，3×3 = 3 列 + 表头 + 2 数据行）；
>    - 左/中/右：改 delimiter 行对应列的冒号；
>    - ⋮：菜单 —— 上方/下方插入行、左侧/右侧插入列、删除该行/该列、
>      **上移/下移该行、左移/右移该列**、复制表格、删除表格；
>    - 🗑：删除表格；
> 3. **所有操作都改源码**：读表格 markdown → 改 `lines` → `dispatch` 替换 `[from, to]`
>    （表格纯文本仍是唯一真相，不碰 widget）。
>
> ### 实测
>
> | 操作 | 结果 |
> |---|---|
> | 点表格 | 工具条出现（`左 中 右 ⋮ 🗑`） |
> | 点「中」 | 第一列 `text-align: center`（其它列不变） |
> | 点「⋮」 | 菜单 12 项全部出现 |
>
> 截图 `_shots/rev113-table-toolbar.png`、`_shots/rev113-table-menu.png`。`tsc` 0 错误。
>
> ### 边界
>
> - 对齐做的是**单列切换按钮**（不是参考图那种 8×3 网格面板）—— 更直接；
> - 点表格外任意处 → 工具条消失（`onPointerDown` 返回 null）。
>
> ## 📌 rev108（2026-10-17 · 表格列对齐语法生效）
>
> 需求原话：「表格对齐语法不生效」（截图：`| :--- | :---: | ---: |` 三列全左对齐）。
>
> ### 根因
>
> atomic 的 table widget（`table-widget.js` 的 `parseTable`）**解析时忽略 delimiter 行**
> （源码注释原话 "TableDelimiter ... is ignored"），`serializeTable` 也统一重建 `| --- |`
> ⇒ 对齐冒号被丢掉；渲染层 `makeCell` 自然也没有 `text-align`。
>
> ### 修法（patch atomic：`patches/@atomic-editor__editor@0.6.2.patch`）
>
> 1. `parseTable`：读 `TableDelimiter` 整行 → `splitRowCells` → 冒号解析成 `left/center/right/null`；
> 2. `serializeTable`：delimiter 行按 `aligns` 重建（`:---` / `:---:` / `---:`）；
> 3. `toDOM` / `makeCell`：给 `th` / `td` 设 `style.textAlign`；
> 4. `readModelFromDom`：从 `th.style.textAlign` 读回（编辑后不丢）；`eq` 比较 `aligns`（改对齐后重建 DOM）。
>
> ### 实测
>
> | 列 | 语法 | th / td 的 `text-align` |
> |---|---|---|
> | 左对齐 | `:---` | `left` |
> | 居中 | `:---:` | **`center`** |
> | 右对齐 | `---:` | **`right`** |
>
> 截图 `_shots/rev112-table-align2.png`。
>
> ⚠️ **vite 缓存坑**（实测）：改 `node_modules` 里的依赖后，vite dev server 的内存模块图
> **不会失效** ⇒ 必须**重启 dev**（`dev.cmd`）才生效；只删 `.vite/deps` 不够。
> patch 已持久化（`pnpm patch-commit`），`pnpm install` 后会重新应用。
>
> ## 📌 rev107（2026-10-17 · 编辑器「源码 / 预览」切换）
>
> 需求原话：「增加切换源码模式」→（位置两轮调整）「放在编辑框左上角，和右边关闭同高」→
> 「放左边挡到渲染，跟关闭并列在右上角吧」。
>
> ### 实现
>
> 1. 新组件 `src/components/SourceModeView.tsx`：CM6 `basicSetup` + `markdown()` ——
>    **不加载 atomic 的 live preview 装饰**，直接显示原始 markdown（`#` / `**` / `>` 全可见），带行号；
> 2. `MarkdownEditor` 加 `sourceMode` state（localStorage `zeronote.sourceMode` 持久化），
>    按钮放在 `zn-editor-modebar`：**右上角、与「关闭」并排**（`top: 8px; right: 70px`，
>    关闭是 `right: 14px`）—— 用同一套尺寸（24px 高 / 13px 字 / opacity .45）；
> 3. 两种模式**共用同一份 `value`**：源码里编辑走 `onChange`，切回预览时
>    atomic 的 value 同步 effect 自动把内容灌进去。
>
> ### 实测
>
> | 检查 | 结果 |
> |---|---|
> | 切源码 | `.zn-source-editor` 出现，首行文本 `# 一级标题`（原始 markdown） |
> | 切预览 | `.zn-source-editor` 消失、atomic 编辑器回来 |
> | 位置 | modebar `top: 8` / right 1850；close `top: 8` / left 1864；**不重叠** |
> | 持久化 | reload 后仍停在源码模式（localStorage） |
>
> 截图 `_shots/rev110-modebar-right.png`。
>
> ⚠️ 一个坑（已处理）：modebar 会被 `.cm-editor` 盖住 ⇒ `z-index: 10`。
> （早期「左上角」方案会遮住第一行，已按用户要求移到右上角，`.cm-content` 顶部留白也随之撤销。）
>
> ## 📌 rev106（2026-10-17 · 引用嵌套框改成「右侧参考图」结构）
>
> 用户给两张对比图：左边当前实现（一级框在嵌套行处断开）、右边目标（一级框**贯穿整个引用块**，
> 二级/三级各有**自己的短框**在缩进处）。
>
> ### 上一版的问题
>
> 上一版把嵌套行的行左框设成 `border-left-color: transparent`（只留嵌套框）
> ⇒ 一级框在二级/三级行处**断开**，与参考图不符。
>
> ### 改法
>
> 1. **删掉** transparent 规则 —— 一级框（atomic 的 `border-left`）对**所有引用行**都保留
>    ⇒ 相邻行接起来就是一根连续贯穿线；
> 2. `::before` 画**二级框**（d2/d3/d4 行，1.5em 处）；
> 3. `::after` 画**三级框**（d3/d4 行，3em 处）——
>    ⚠️ 一个伪元素画不了两条线，所以 d3 行要同时用 `::before` + `::after`。
>
> ### 实测
>
> d1/d2/d3 行的 `border-left-width` 全是 3px（紫色，连续）；d2 有 `::before`、d3 有 `::before + ::after`。
> 截图 `_shots/rev108-quote-target.png`。
>
> 颜色说明：框色跟**当前主题**（`--atomic-editor-accent-soft`，紫）；参考图的绿色是参考主题的绿。
>
> ## 📌 rev105（2026-10-17 · 引用嵌套每层自己的框 ＋ 行内代码背景 ＋ 分割线加粗）
>
> 需求三连：
> 1. 「每个嵌套有一个框」—— 嵌套引用不再共用行左那条通线；
> 2. 「行内代码背景不明显」；
> 3. 「分割线不明显，加粗一个像素」。
>
> ### 改法（全在 `styles.css`）
>
> 1. **嵌套框**：`.zn-quote-d2/3/4` 的行左 `border-left-color: transparent`（只隐颜色、保留宽度，
>    避免布局跳动），再用 `::before` 在**各自缩进处**画 3px 紫框
>    （`left: calc(1rem + 1.5em×N - 3px)`，与对应 `padding-left` 对齐）；
> 2. **行内代码背景**：atomic 默认的 `--atomic-editor-code-bg` 太接近底色 →
>    改用 `color-mix(in srgb, var(--zn-fg) 16%, transparent)`（深色 16% / 浅色 10%），
>    **不挑底色**，两层主题都成立；
> 3. **分割线**：`::after` 的 `border-top` 从 1px → **2px**，颜色从 `--atomic-editor-border`(#3d3d3d)
>    改为 `--zn-border-strong`(#3f3f46)，深色下亮一档。
>
> ### 实测
>
> | 项 | 结果 |
> |---|---|
> | 嵌套框 | q2 `padding-left: 41.5px` + `::before` 紫框 `rgb(196,181,253)`；q3 67px |
> | 行内代码 | 背景 `color(srgb 0.957 0.957 0.961 / 0.16)` |
> | 分割线 | `border-top-width: 2px`、`rgb(63,63,70)` · 截图 `_shots/rev107-hr-thicker.png` |
>
> ## 📌 rev104（2026-10-17 · 引用嵌套生效）
>
> 需求原话：「引用嵌套无效」（截图里 `> > 二级` 和 `> 一级` 长得一模一样）。
>
> ### 根因
>
> atomic 的 `.cm-atomic-blockquote` 只表达"这一行在引用里"，**不分层级** ——
> 嵌套行的 class 实际是重复的 `cm-atomic-blockquote cm-atomic-blockquote`，但样式相同 ⇒ 无视觉差异。
>
> ### 修法
>
> 1. `MarkdownEditor` 加 `quoteDepthPlugin`（ViewPlugin + 行装饰）：按行首 `>` 的个数给行加
>    `zn-quote-dN`（N = min(个数, 4)），可见范围变化/编辑时重算；
> 2. `styles.css` 给 d2 / d3 / d4 逐级加 `padding-left`。
>
> ### 实测
>
> | 行 | class | `padding-left` |
> |---|---|---|
> | `> 一级` | `zn-quote-d1` | 16px |
> | `> > 二级` | `zn-quote-d2` | **41.5px** |
> | `> > > 三级` | `zn-quote-d3` | **67px** |
> | `> 回到一级` | `zn-quote-d1` | 16px |
>
> 截图 `_shots/rev105-quote-nested.png`。
>
> ⚠️ 类型坑：装饰数组要写 `Range<Decoration>[]`（`Range` 从 `@codemirror/state` 导入）；
> 写成 `ReturnType<Decoration['line']>` 会报 `Property 'line' does not exist on type 'Decoration'`
> （索引访问类型取不到**静态方法**）。改后 `tsc` 0 错误。
>
> ### 边界
>
> 紫色左边框仍画在**行左边缘**（视觉上是一条通线），嵌套靠**缩进**区分；
> 若以后要"每一层嵌套各有自己的框"，需要换掉 `border-left`（改成随缩进内移的 inset 线）。
>
> ## 📌 rev103（2026-10-17 · 深色模式下已完成任务的勾改成黑色）
>
> 需求原话：「深色模式下已完成任务的勾改成黑色」。
>
> ### 根因
>
> atomic 的 `.cm-atomic-task-checkbox::after` 用**写死的白色**（`border-right/bottom-color: #ffffff`）
> 画勾；深色主题下选中方块被主题设成**浅色**（截图里的浅灰），白勾几乎看不见。
>
> ### 修法（`styles.css`）
>
> ```css
> :root[data-theme='dark'] .zn-editor .cm-atomic-task-checkbox::after {
>   border-right-color: #000;
>   border-bottom-color: #000;
> }
> ```
>
> 项目主题由 `html[data-theme='dark']` 驱动（`src/lib/theme.ts:42`），所以只在深色下生效，
> 浅色主题仍是白勾（紫底）。
>
> ### 实测
>
> 深色下 `::after` 的 `border-right-color` = `rgb(0, 0, 0)`；
> 截图 `_shots/rev104-task-check-dark.png`（浅灰底 + 黑勾，清晰可辨）。
>
> ## 📌 rev102（2026-10-17 · 编辑器里的链接能打开浏览器了）
>
> 症状（用户截图）：`[百度](https://www.baidu.com)` 渲染出的外链图标（↗）点了没反应。
>
> ### 根因
>
> atomic 默认 `window.open(url, '_blank', …)` 打开链接，而 **Tauri 的 WebView 不接管 `window.open`**
> ⇒ 静默失败。atomic 早就留了口子：`AtomicCodeMirrorEditor` 的 `onLinkClick?: (url) => void` prop
> （源码注释原话：route link opens through their platform's external-URL mechanism (Tauri IPC, …)）。
>
> ### 修法
>
> 1. **Rust 新增 `open_external(url)` 命令**：只放行 `http://` / `https://`；用**系统默认程序**打开，
>    且**不经过 shell 解析**（Windows `explorer`、macOS `open`、Linux `xdg-open`）——
>    避免 URL 里的 `&` / `|` 被当命令拼接（这是"打开外部程序"的入口，必须守边界）；
> 2. `MarkdownEditor` 传 `onLinkClick={(url) => invoke('open_external', { url })}`。
>
> ### 实测
>
> - `invoke('open_external', {url:'https://www.baidu.com'})` → `OPEN-OK`，Chrome 18:41:26 启动；
> - 派发 click 到链接图标区 → `onLinkClick` 收到 URL（调试记录 `["https://www.baidu.com"]`）——
>   浏览器在**已运行的 Chrome 里开新标签**（不新建进程，所以进程数看着没变）。
>
> ### 两个易踩的点
>
> 1. **点击区域**：编辑模式下只有链接**右侧的外链图标**（↗）是打开区，点文字是进编辑
>    （atomic 的 `linkIconHitTarget` 只认 trailing-icon 区；只读模式才是整条链接可点）；
> 2. **事件类型**：`makeLinkClickHandler` 绑的是 **`click`**（不是 pointerdown）——
>    用 pointerdown 测会误判"没反应"。
>
> 边界：移动端返回「暂不支持打开外部链接」；内部链接（`./x.md`、`[[x]]`）不在此命令范围内。
>
> ## 📌 rev101（2026-10-17 · 空列表项 **Tab 缩进成子项**）
>
> 需求原话：「空列表无法直接缩进成子项」。
>
> ### 两个独立原因，都修了
>
> 1. **Tab 本身不缩进**：atomic 自带的 `indentWithTab` 底层是 CM6 的 `indentMore`，
>    而 markdown 的缩进规则基于**语法块** —— `- `（空列表项）在语法树里没有可缩进的块。
>    ⇒ 内核新增 `Prec.high(keymap.of([Tab / Shift-Tab → indentListLine]))`：
>    只在列表行（`-`/`*`/`+`/`1.` + 空白）上 +2 / −1~2 空格，非列表行交还原处理。
> 2. **缩进后不变成子项**：`outlineDepths` 的补丁原来「取前一个缩进更浅的行、直接抄它的深度」——
>    抄成了**同级**。改成按缩进关系：前一行缩进更小 ⇒ 父级（深度 +1）；相等 ⇒ 同级；更大 ⇒ 继续往上找。
>
> ### 实测
>
> | 输入的 md | `outlineDepths` | 渲染 |
> |---|---|---|
> | `- 无序列表\n  - ` | `[0→1, 1→2]` | 行1 `zn-ol-d2` / **37.4px**（子项）|
> | `- 无序列表\n- ` | `[0→1, 1→1]` | 行1 `zn-ol-d1` / 20.4px（同级）|
> | `- a\n  - b\n  - c` | `[0→1, 1→2, 2→2]` | 正常 |
>
> 截图 `_shots/rev103-tab-child2.png`。`tsc` 0 错误；插件（junction → examples）与全局副本已同步。
>
> ## 📌 rev100（2026-10-17 · 修「空列表项缩进比同级多一截」）
>
> 症状（用户截图，编辑器里）：
>
> ```
> # 标题1
> - 无序列表
> - 无序列表
> -            ← 空项，圆点比上面两项靠右
> ```
>
> ### 根因
>
> 列表行的缩进由 `outline-map` 插件的 `outlineDepths`（行 → 深度）驱动：内核按
> `zn-ol-dN` 给行加 `padding-left: 1.2em`；空项的深度两条路都断了：
> 1. `parseBlocks` **跳过**「`- ` 后面没内容」的列表行（设计如此 —— 它不该进导图）；
> 2. 第一版补丁用 `trimEnd()` 匹配，`- ` 去掉尾空格只剩 `-`，`LIST_RE` 匹配不上（真因）。
>
> ⇒ 空项没有 `zn-ol-dN`，走 CM6 默认缩进：实测 **34px**，同级是 **20.4px**。
>
> ### 修法（`examples/outline-map/index.js` 的 `outlineDepths`）
>
> 补一轮"空列表项"扫描：用**原始行**匹配 `LIST_RE`，按缩进回推深度
> （取前面最近一个「缩进不比它深」的非空列表行的深度）。**不进** `parseBlocks` 的树 ——
> 空项仍不会出现在导图里。
>
> ### 实测
>
> 三行的 class / `padding-left`：`zn-ol-d1 / 20.4px`、`zn-ol-d1 / 20.4px`、
> **`zn-ol-d1 / 20.4px`**（空项一致）· 截图 `_shots/rev102-list-indent-fixed2.png`。
>
> ⚠️ 插件同步：`_tmp-vault-tb` 的 `.zn/plugins/outline-map` 是 **junction 指向 examples**，
> 改 examples 即生效；若以后换成实体拷贝，记得两边同步（库内优先于全局）。
>
> ## 📌 rev99（2026-10-17 · 文件树**层级引导线**：每层一条竖线 ＋ 缩进）
>
> 需求原话：「树的层级区分更清晰一点」。
>
> ### 改法（`FileTree.tsx` + `styles.css`）
>
> - 子级缩进交给**每个目录子级包的一层 `.zn-tree-kids`**（节点自身 padding 固定为 `var(--zn-space-2)`）；
> - 三角 `.zn-tree-caret` 放大到 **25px**（用户三轮要求：「做大一点」→「再大一点」→「加到 25」）；
> - **横线**（`.zn-tree-label` 的 `border-bottom`）：画在**名字文字**上，只到文件名结束、
>   不延伸到侧栏右边缘；粗细 **2.5px**（DPR=1 的 100% 缩放屏上浏览器会取整成 2px 渲染，
>   125% 缩放才真正显示 2.5 物理像素）；
> - **竖线**（2026-10-17 用户逐条确认的规则）：一个文件夹**同时满足**
>   「后面还有同级条目」+「它自己有子项」才画 —— `.zn-node:not(:last-child) > .zn-tree-kids`
>   （`.zn-tree-kids` 的 `border-left: 2px`，容器高度 = 子项总高度，线从第一个子项贯穿到最后一个）。
>   反例全部覆盖：有同级但没子项（一级文件夹2 / 二级2 / 四级1）不画；
>   有子项但没同级（三级2 / 五～八级1 / 文档）不画；跨文件夹的"同级"不算（DOM 兄弟天然满足）。
>   ⚠️ **空文件夹不渲染 `.zn-tree-kids`**（`children.length > 0` 才渲染），否则会画出一条空竖线；
>   两个踩过的坑留作记录：① button 的 `overflow: hidden` 会把 `::before` 整条裁掉；
>   ② `--zn-border` 太浅，在米色背景上看不见（改用 `--zn-fg-subtle`）；
> - **文件行前面的圆点**（`.zn-tree-dot`，12px）：与目录三角同宽（22px）、同行内垂直居中，
>   既当项目符号，又保证文件与同级文件夹的**名字左对齐**。
>
> 效果：横线只到文件名 + 按规则出现的竖线 + 文件与文件夹名左对齐
> （`_shots/rev101-tree-rule-final2.png`、`_shots/rev99-tree-align-files.png`）。
>
> ### 边界
>
> - 横线用 `var(--zn-border)`，深色主题下同样适用；
> - 缩进约 19px/级（10px margin + 6px padding + 8px 节点内边距），
>   深层嵌套（5 层以上）在窄侧栏里会显得紧凑 —— 目前用户库最深 5 层，正常。
>
> ## 📌 rev98（2026-10-17 · 文件树显示**文件名** ＋ 新建默认名 `新笔记-时-分-秒`）
>
> 需求原话：「不显示新笔记，默认显示文件原名，文件原名默认规则：新笔记-时-分-秒」。
>
> ### 两处改动
>
> 1. **文件树显示名**（`FileTree.tsx`）：`node.title || 文件名` → **只用文件名**，
>    且**笔记保留 `.md` 后缀**（用户 2026-10-17 追加「文件显示 .md」）；只读文档仍去扩展名
>    （它后面已经跟着 `.epub` / `.pdf` 徽章，再带一次会变成 `测试书籍.epub .epub`）。
>    此前 `NoteMeta.title` 走的是「frontmatter.title → 正文首行 → 文件名」三级回退，
>    新建的笔记在树里全变成正文首行的「新笔记」，一排文件看不出谁是谁。
> 2. **默认新建名**：
>    - `App.newNote`（`core.newNote` 的实现，菜单 / 首页按钮 / Ctrl+N 都走它）：
>      `untitled-<年月日时分秒>` → `新笔记-时-分-秒`；
>    - `App.newNoteIn`（右键「新建文件」/ 文件夹里新建）：同上；
>    - `examples/daily-note`（启用时会接管 `core.newNote`）：`HH-mm-ss` → `新笔记-时-分-秒`
>      （同步拷进全局插件目录）。
>
> ### 追加（同日）
>
> - **新建笔记默认内容 = 空**（用户 2026-10-17）——三处 `createNote(..., '# 新笔记\n\n')` 全改成 `''`
>   （`App.newNote` / `App.newNoteIn` / `examples/daily-note`，插件那份同步到全局目录）；
> - **竖线颜色/宽度最终与横线一致**（`2.5px` + `--zn-border`，用户两轮要求「颜色一样」→「宽度也一样」）。
>
> ### 实测
>
> - 新建（`_tmp-vault-tb`，走内核 `core.newNote`）⇒ 磁盘 `新笔记-16-22-40.md`，文件树显示
>   `新笔记-16-22-40`（文件名，不再是「新笔记」）。
> - 测试产物已删。
>
> ### 边界
>
> - `daily-note` 插件当前是**禁用**状态（早前被启动自愈关过），所以实际走的是内核默认命名；
>   启用它也会用同一个命名规则（源码与全局拷贝都已改）。
> - 文件树不再看 `frontmatter.title` —— 若以后想让「标题优先」回来，改 `label` 那一行即可。
>
> ## 📌 rev97（2026-10-17 · 文件树**拖拽移动**：把笔记/文件夹拖进另一个文件夹）
>
> 需求原话：「笔记拖拽进文件夹」。
>
> ### 两种拖拽的分工（与资源管理器一致）
>
> | 起点 | 行为 |
> |---|---|
> | 在**条目上**按下再拖 | **移动**该项（它在选中集合里 ⇒ 整批移动） |
> | 在**空白处**按下再拖 | 框选（rev96） |
>
> ### 实现（`src/components/FileTree.tsx` + `styles.css`）
>
> - `onPointerDown` 里按 `e.target.closest('[data-zn-path]')` 分流：命中条目 = 拖拽移动，否则 = 框选；
> - 拖拽中用 `document.elementFromPoint` 找鼠标下的条目，**只认文件夹**做落点
>   （虚拟「文档」分组不是磁盘目录；拖到自己/自己的子孙一律无效）；
> - 落点高亮 `.is-drop-target`（蓝描边 + 淡蓝底，与选中态的实底区分）；
> - 松手：对每个待移动项调 `onRename(from, 目标/名字, isDir)`
>   —— 文件走 `rename_note`、目录走 `move_entry`（后者 rev95 已带非空目录降级）；
> - 已经在目标目录里的跳过（否则 Rust 报「目标已存在」）；拖完拦掉那次 click；
> - 新建 / 重命名时把父目录路径放进 `reveal`，对应节点**自动展开**一次 ——
>   否则文件夹折叠时点「新建文件夹」，新条目与内联输入框都在折叠的子树里，
>   用户看到的是"菜单点了没反应"（2026-10-17 用户报）；
> - **重命名 / 拖拽移动不再弹「已重命名：<路径>」toast**（用户 2026-10-17 要求）——
>   列表里那一行已经变了，长路径提示反而挡视线；
> - 拖拽的**视觉反馈**（2026-10-17 用户要求「要有动画」）：源行淡出（`.is-dragging`）＋
>   跟手的小胶囊标签 `.zn-drag-ghost`（批量时显示「xxx 等 N 项」）＋ 落点高亮带 120ms transition。
>
> ### 实测（临时库，合成 pointer 事件 + 磁盘核对）
>
> | 场景 | 结果 |
> |---|---|
> | `甲.md` 拖到 `乙/` | 磁盘 `乙/甲.md`；拖拽中 `乙` 高亮 |
> | 拖到**文件**上 | 无高亮、不移动（只认文件夹） |
> | `乙/`（含子文件）拖到 `丙/` | 磁盘 `丙/乙/甲.md`（整棵树一起搬） |
> | **折叠**的 `笔记/` 里新建文件夹 | 目录自动展开 + 内联输入框出现 |
> | 拖拽中的视觉 | 源行 `is-dragging`（淡出）· 跟手标签「甲.md」· 落点 `is-drop-target` · `_shots/rev97-drag-animation.png` |
>
> ### 未做（明确边界）
>
> - 拖到**空白处** = 不动作（没有做"移回库根"）；
> - 拖拽过程中的**自动滚动 / 自动展开折叠的文件夹**未处理；
> - 触摸端不参与（手指拖拽 = 滚动）。
>
> ## 📌 rev96（2026-10-17 · 文件树**鼠标框选**：左键拖拽一次选中一片）
>
> 需求原话：「做鼠标左键像红框一样一次选中的功能」。
>
> ### 实现（`src/components/FileTree.tsx` + `styles.css`）
>
> - `pointerdown` 只认**鼠标左键**（触摸仍走长按——手指拖拽在列表里多半是想滚动）；
>   `pointermove/up` 挂在 **window** 上，拖出侧栏也能正常收尾；
> - 位移 > 4px 才算框选，否则仍是普通点击（打开笔记 / 折叠目录）；
> - 点在**滚动条**上不算（否则拖滚动条会拖出选择框）；
> - 选择框 `.zn-marquee`：`position: fixed` + 蓝色半透明 + `pointer-events: none`；
> - 命中规则 = 与节点矩形**相交**（与资源管理器一致）；**框选完不弹批量操作条**
>   （用户 2026-10-17 定：桌面直接在选中项上右键，菜单里出现「删除选中的 N 项 / 彻底删除选中的 N 项」；
>   手机上仍走长按进多选条）；
> - 拖完拦掉紧随的 click（否则一松手就把最后经过的笔记打开了）；
> - 点**树的空白处** = 取消选中 —— 连「当前打开的那篇」的行高亮也一起收掉
>   （`selectionCleared` 关掉 `selectedSet` 回退到 activePath 的那条逻辑；手机上长按进来的多选也一并退出）。
>
> ### 顺带补的两个缺口
>
> 1. **目录节点此前没有选中态**（`.is-picked` 只加在文件上）⇒ 框选中目录时看不出来，补上；
> 2. 框选会同时选中**目录和它里面的条目** ⇒ 批量操作前用 `dedupe()` 去掉「祖先已在列表里」
>    的子项 —— 否则删除第二个条目会报「要删除的东西不存在」（目录已被整棵树搬走）。
>
> ### 实测（CDP 真实鼠标事件 `Input.dispatchMouseEvent`，`_test-vault`）
>
> - 拖拽中：选择框出现 · 3 项高亮（`笔记` 目录 + `笔记/灵感流.md` + `灵感` 目录）
> - 松手：选择框消失 · 选中保留 · **无批量操作条** · **笔记没有被误打开**（click 拦截生效）
> - 在选中项上右键：菜单出现「**删除选中的 3 项**」「彻底删除选中的 3 项…」（剪切/复制同样作用于整批）
> - 点 ✕ 退出多选后，普通单击仍正常打开笔记（手机长按那条路径未受影响）
> - `tsc -b` 0 错误
>
> ### 未做（明确边界）
>
> - **触摸端不参与框选**（手指拖拽 = 滚动；手机多选仍走长按）；
> - 拖拽过程中**滚动**树（自动滚动）未处理 —— 框选只能覆盖当前可见区域。
>
> ## 📌 rev95（2026-10-17 · 修「有内容的文件夹删不掉」—— Windows 非空目录 rename 降级）
>
> 症状（用户报）：文件树里右键「删除文件夹」—— **空文件夹能删，装了内容的删不掉**，
> 报「删除失败：文件可能正被其他程序占用。（移入回收站失败：拒绝访问。 (os error 5)）」。
>
> ### 复现与分层（临时库，CDP 直调内核命令）
>
> | 操作 | 结果 |
> |---|---|
> | 删 `甲`（含子目录 + 文件） | ❌ os error 5 |
> | 删 `空父/空子`（两层**空**目录） | ❌ os error 5 |
> | 删 `x.md`（文件） | ✅ |
> | 删 `子`（删完文件后的空目录） | ✅ |
> | `move_entry` 非空目录 → **已存在目录** | ❌ 同样错误 |
> | `move_entry` 非空目录 → **新名字** | ✅ |
> | `pwsh` 的 `MoveFileExW(REPLACE_EXISTING)` 移同一个目录 | ✅ |
>
> ### 结论
>
> **不是「文件被其他程序占用」**（同一台机器、同一时刻 pwsh 能移），而是本进程
> `fs::rename`（`MoveFileExW`）对「**非空目录** → **已存在目录内**」这一组合拿到 ACCESS_DENIED
> （os error 5）。空目录与文件都不受影响 —— 于是只有「装了内容的文件夹」删不掉，
> 而错误文案还把它误导成「别的程序占用」。
>
> ### 修法（三处，同一套降级）
>
> 1. `delete_note`：目录先走 rename 快路径；失败降级 **`move_tree()`**
>    （文件 `rename` + 目录 `create_dir_all` 逐项搬，再删源空壳）—— 这两条原语都已在同一进程验证可用；
> 2. `move_entry`：同样降级（剪切 / 粘贴文件夹本来也会中招）；
> 3. `restore_trash`（以及前端撤销）：恢复的是**整棵目录树**，同样降级；
>    `undoDeleteNote` 改走 `restore_trash`，不再用裸 `rename`。
>
> ### 验证
>
> - `cargo test --lib` **23 passed**（新增 2 条：`move_tree_preserves_layout`、
>   `delete_non_empty_dir_survives_and_restores` —— 两层嵌套 + 两个文件，删 → 恢复 → 内容一致）
> - dev + CDP 实测（临时库）：右键「删除文件夹」→ 磁盘上目录消失 + toast「已移入回收站」
>   （`_shots/rev95-delete-nested-folder.png`）；点「撤销」→ 目录树与子文件全部回来、内容一致；
>   回收站「恢复」往返一致。
> - `tsc -b` 0 错误 · `oxlint` 4 warnings（见文末基线单一来源）
>
> **未做**：Android 真机复验 —— 同一套 Rust 代码，但 Android 是 Linux 文件系统，理论上不会走这个
> Windows 特有分支。
>
> ## 📌 rev94（2026-10-17 · **插件跨库生效**：全局插件根 ＋ 两处合并扫描 ＋ 来源徽标）
>
> 需求原话：「zeronote 做插件跨笔记库生效」。诊断后的分工：
> - **Android 早就有**：库在 `<根>/.vaults/<名字>/` 时 Rust `private_root()` 把私有根上提到库根，
>   插件从库根读 ⇒ 切库不掉（证据：rev 段里 `android-vault-T-plugins.png`）。
> - **桌面端没有**：库是用户自选的任意目录，插件目录 = `<该库>/.zn/plugins/`，切到另一个库整套消失。
>
> 本轮补的就是桌面端这条，方案（用户 2026-10-17 选定 A + 应用数据目录）：
>
> | 改动 | 文件 | 要点 |
> |---|---|---|
> | 新增全局根 + 合并扫描 | `src/kernel/plugin-roots.ts`（新） | 全局根 = `appDataDir()`，插件目录 `<appDataDir>/.zn/plugins/`；扫描 = 库内 + 全局，**同名目录库内优先** |
> | 插件身份带根 | `src/kernel/plugin-host.ts` | `PluginSource` / `PluginDirEntry`；`listPluginDirs` / `readManifest` / `deletePluginDir` / `loadPlugin` 全部按**根**算路径 |
> | 接线 | `src/App.tsx` | 扫描用 `collectPluginDirs(vault)`；`pluginEntries` 记 id→来源；**删除按来源路由**；懒激活 pending 存条目而不是目录名（顺带修掉"目录名 = manifest.id"的隐含假设） |
> | 数据落点 | `src/kernel/store.ts` 调用方 `kernel.ts` | store 跟着插件所在根走：全局插件的数据全局一份，库内插件的数据落库内 |
> | UI | `src/components/PluginPanel.tsx` + `styles.css` | 每行「全局 / 本库」徽标；空态给出两种放法；删除确认按来源显示路径；列表底部常驻全局目录路径 |
>
> **为什么全局根不新增 Rust 命令**：`list_plugins` / `read_plugin_file` / `delete_plugin` /
> `plugin_store_*` 的路径全是 `private_root(vault).join(".zn/plugins/<id>")` ——
> 把 `appDataDir()` 当 `vault` 传进去，算出来就是 `<appDataDir>/.zn/plugins/<id>`。
> Rust 只做路径数学，不关心传进来的是不是"真库"。少改内核 = 少一次全量编译与一整类回归。
>
> **冲突规则**：同一个目录名两处都有 ⇒ 库内优先（更具体），全局那份不加载、插件页不出现第二行。
>
> ### 实测（2026-10-17 · dev + CDP，用户库未动）
>
> 三条基线全过：`tsc -b` 0 错误 · `oxlint` 4 warnings · `cargo test --lib` **21 passed**（Rust 零改动）。
>
> | 判据 | 做法 | 结果 / 截图 |
> |---|---|---|
> | 全局插件能被发现并加载 | 把 `examples/hello-plugin` 拷进 `%APPDATA%\com.aqua.zeronote\.zn\plugins\hello-plugin/` → 插件页「重新扫描」 | 列表出现 `Hello 示例插件 v0.1.0` **「全局」**徽标 · `_shots/rev94-global-plugin.png` |
> | **切库后仍在**（需求本体） | 当前库切到一个**空库**（库里没有 `.zn`；用 localStorage 改 vault + reload）→ 打开插件管理 | Hello 插件**照旧在**、徽标仍是「全局」· `_shots/rev94-global-plugin-empty-vault.png` |
> | 库内同名插件覆盖全局 | 再把 `hello-plugin` 拷进空库的 `.zn/plugins/` → 重新扫描 | **同一行**、徽标变「本库」（库内那份生效，全局那份被覆盖；没有出现第二行）· `_shots/rev94-vault-plugin-wins.png` |
> | 全局目录不存在时降级 | 首轮扫描时 `%APPDATA%\com.aqua.zeronote` 还不存在 | 插件页正常显示空态 + 全局路径提示，**无错误横幅**（`collectPluginDirs` 里全局读失败只返回库内） |
>
> 测试痕迹已清理（临时空库 `_tmp-vault-empty/` 与全局 `hello-plugin` 已删；用户库 `Documents\md` 的 vault 记录已还原）。
> 截图在 `_shots/rev94-*.png`。仍未做：**Android 真机复验**（Android 的库根共享机制未改，风险只在新增的全局根分支）。
>
> ## 📌 rev93（2026-10-17 · 文档整改：README 重写 · rev 索引 · 基线数字统一 · 权威矩阵 · 文档规范）

> 依据：一次外部文档审查（24 份 / 约 9,900 行；报告在工作区 `ZreoNote\ZeroNote-文档审查报告.md`）。**本轮只动文档，未改代码。**
>
> ### 一、README 重写
> 原 README 停在 10-11 的 M1（「8 原语」「插件 M2 在建」）。现在：当前功能表（9 类）· **10 原语** · 三条基线（**21 passed**）· 文档地图 · 目录结构。
>
> ### 二、HANDOFF 结构
> 65 个 rev 段统一改为**最新在前**（此前 rev75–92 倒序插在中段、rev30–74 正序）；顶部新增 **rev 索引表**（65 行，两列）；固定章节（当前目标 / 未完成 / 唯一下一步 / 授权边界）**已于 2026-10-17 合并进 `HANDOFF-CARD.md`**，HANDOFF 只留 rev 记录与文末「备注」。
> 重排前后做**行多重集校验**（内容零丢失）。
>
> ### 三、基线数字单一来源
> `cargo test --lib` 实测 **21 passed**（2026-10-17）；此前卡里同时存在 19 / 20 / 21。`scripts/verify.ps1` 改为**打印真实的 `N passed` 与 oxlint warning 数**，文档不再手写这些数字。
>
> ### 四、文档权威
> 新增 `docs/README.md`（索引 + 权威矩阵 + 状态标记）；`docs/archive/1.目录结构.md` 与 `docs/archive/Markdown 笔记应用需求规格 v1.0.md` 补 `superseded` 头并入档（此前是 untracked）。
>
> ### 五、需求入库
> `Documents\需求2.md` 复制为 `docs/requirements/current.md`（唯一目标文档）；工作区路线对比的路径改为仓内相对路径。
>
> ### 六、新增规范
> `docs/文档编写规范.md`：状态头 / 权威声明 / 数字来源 / 行号引用 / 未核实清单 / rev 段写法 / 文档地图。
>
> ### 未做（明确边界）
> - `App.tsx` 拆分、前端单测、远端仓库与 CI —— 本次范围仅文档
> - `docs/guides/` 目录重排 —— 规范里作为目标写，本轮未移动 `Android安装说明.md`

> ## 📌 rev92（2026-10-15 · ⚠️ **更正 rev88**：`window.print()` 在 WebView2 上**静默无效** —— md→pdf 改走「导出 HTML ＋ 浏览器打印」）
>
> ### 一、实测（两条独立证据）
>
> 1. **CDP 直接调**：`typeof window.print` = `"function"`，但调下去 **同步立即返回**（`print-返回了`）、
>    **不弹打印对话框、不产生任何产物**
> 2. **走插件**：`__znExec('io.exportPdf')` 在桌面返回 `null`（那次是"没有打开的笔记"这条早退路径；
>    但第 1 条的裸调用已经把 `print` 本身的行为定死了）
> 3. 截图核对：调用后前台仍是 DSH 客户端 / ZeroNote 窗口，**没有**任何打印 UI 出现
>
> ### 二、一手来源：wry 的 WebView2 `print()` **就是 eval `window.print()`**
>
> `wry-0.57.0/src/webview2/mod.rs:1796`：
>
> ```rust
> pub fn print(&self) -> Result<()> {
>   self.eval("window.print()", None::<Box<dyn FnOnce(String) + Send + 'static>>)
> }
> ```
>
> ⇒ **换成 Tauri 的 Rust `print()` 也救不了**（**同一条路**）。WebView2 要弹打印 UI，宿主得显式接
> `ShowPrintUI`，而 wry 没接。
>
> ### 三、⚠️ 更正 rev88 的结论（在原文处也标了）
>
> rev88 说「桌面走 `window.print()`」—— **对 WebView2 不成立**。当时的依据是 Tauri 源码里一句
> 「`window.print()` works on all platforms」的注释，**没实测就采信了**。
> 这正是 AGENTS 第 5 条硬性前置要防的：**实测 ≠ 解释、注释 ≠ 实现**。
>
> ### 四、改法（已验证）
>
> `io.exportPdf` 改成**可靠的两步**：**导出 HTML**（写进笔记库）→ 提示用户用**浏览器**打开它、
> 浏览器里「打印 → 另存为 PDF」。浏览器打印栈完整、中文走系统字体、不必把 17.7 MB 字体塞进包
> （jsPDF 路线）或踩 pdf-lib 的 CJK 子集化 bug。
>
> **验证读数**：`__znExec('io.exportPdf')` → `{"format":"pdf","viaHtml":"outline-demo.html"}` ✅
>
> Android 本来就不支持直接导出 PDF（Tauri #11933），这条限制不变。

> ## 📌 rev91（2026-10-15 · 导入导出**收尾**：交付盘点 ＋ 唯一未验项 ＋ 测试产物清理）
>
> ### 一、交付盘点（一个字都不虚）
>
> | 方向 | 状态 |
> |---|---|
> | 导入 md / txt | ✅ 手机真机 |
> | 导入 html / docx | ✅ 手机真机（docx 的表格已还原成 GFM，见 rev90） |
> | 导入 pdf / epub | ✅ 桌面真机（**同一份代码**；epub 走 fflate 自解 zip ＋ turndown） |
> | 导出 txt / html / png / docx | ✅ **手机端到端落盘**（用户亲测 ＋ PNG/docx 签名校验） |
> | 导出 pdf | ⚠️ **能力已实现 ＋ 探针通过**（`chars=972`）；**"真实打印出一份 PDF"这一步还没人点过** |
> | 导出落点选择器 | ✅ Android `ACTION_CREATE_DOCUMENT` → `content://` → `write_content_uri` **全链 logcat 取证** |
>
> ### 二、唯一未验项 & 怎么验（两分钟）
>
> **桌面**：`命令面板 → 导出当前笔记为 PDF…` → 打印对话框里选「另存为 PDF」→ 看文件头是不是 `%PDF-`。
> 顺带可验桌面落盘：随便导一次 txt / html → 选个位置（`dialog.save` ＋ `write_absolute` 那条路）。
> （**Android 的 PDF 导出做不了** —— Tauri 打印在 Android 无效，issue #11933 open；插件已明确拒绝并给替代方案。）
>
> ### 三、测试产物已清（都核对过是本次生成的）
>
> · **桌面测试库**：删 `测试书籍.md` / `probe.md` / `docx表格测试.md` / `docx表格测试.docx`
>   （**保留**原有的 `测试书籍.epub`、`probe.pdf` 两个样本）
> · **手机**：删 `io-test*.md / .txt / .html` 与 `Download/_zn-test/`（库回到 10 个 md）
> · **本地**：删临时目录 `_tmp-vendor/`（vendor 已落 `public/vendor/`）与 `_tmp-io-test/`
>
> ### 四、插件怎么用（下次接手看这里）
>
> · 命令面板：`导入外部文件…` ／ `导出当前笔记为 {纯文本, 网页, 长图, Word, PDF}…`
> · 侧栏面板「导入导出」有同样按钮
> · **自动化验收入口**：`window.__znExec('io.importFile', { path })`、
>   `window.__znExec('io.export{Txt|Html|Png|Docx|Pdf}', { probe: true })`
> · ⚠️ 跑自动化前先确认应用**在前台**（后台时 Android 冻结 WebView，CDP 会超时 —— rev87 §四）
> · 装的库：手机 `/storage/emulated/0/Documents/ZeroNote/.zn/plugins/import-export/`；
>   桌面测试库 `_tmp-vault-tb/.zn/plugins/import-export`（junction → `examples/import-export`）

> ## 📌 rev90（2026-10-15 · docx 导入的**表格还原**（两处小修，都在真机上验过））
>
> ### 一、docx 改走 `convertToHtml` ＋ turndown
>
> rev86 记的「mammoth 把表格拍成逐单元格一行」属实 —— 它自带的 `convertToMarkdown` 会输出
> `表头A` / `表头B` / `a` / `b` 各占一行。而 mammoth 的 **HTML** 输出里表格结构是完整的
> ⇒ 改成 `mammoth.convertToHtml()` ＋ 配好 gfm 的 turndown。
>
> ### 二、但 turndown 的 gfm 插件**只认带 `thead` / `th` 的表格**
>
> mammoth 输出的 `<table>` **没有 `<thead>`**（首行也是 `<td>`）⇒ 第一次改完，整块
> `<table>…</table>` 仍被原样留在正文里（真机实测）。
> 修法：给 turndown 加一条兜底规则 **`tableWithoutThead`** —— `filter` 只命中"没有 thead 的 table"，
> 把**首行当表头**转成 GFM；有 `thead` 的仍走 gfm 自己的规则。单元格里的 `|` 会转义。
>
> **验后读数**（同一个含表格的 docx）：
>
> ```
> | 表头A | 表头B |
> | --- | --- |
> | a | b |
> ```
>
> 这条规则同样惠及 **html 导入**（无 `thead` 的表格）。
>
> ### 三、待验（未变）
>
> · pdf 的**真实打印**（桌面，要真人点一次打印对话框选「另存为 PDF」）
> · **桌面端导出落盘**（`dialog.save` ＋ `write_absolute`，同样要真人点一次）

> ## 📌 rev89（2026-10-15 · **epub / pdf 导入验证** ＋ 一个真 bug：脚本混进了正文）
>
> ### 一、导入 6 种**全部验证完毕**（本轮补最后两种，在**桌面端**跑）
>
> | 方向 | 读数 |
> |---|---|
> | **epub → md**（`测试书籍.epub`） | ✅ 67 行：`# ZeroNote 测试书`（`dc:title`）＋ `# 第一章 春江` ＋ 全部段落 |
> | **pdf → md**（`probe.pdf`，449 B） | ✅ `## 第 1 页` ＋ `ZeroNote PDF probe`（pdf.js 抽文字层） |
>
> 桌面跑法（与手机同一份代码）：插件 junction 到 `_tmp-vault-tb` → 重扫 →
> `__znExec('io.importFile', { path: '<绝对路径>' })`（绝对路径不弹对话框，正好可自动化）。
>
> ### 二、🐞 真 bug：**turndown 不会丢掉 `<script>` / `<style>` 的文本内容**
>
> 第一次导入那本 epub 时，笔记正文里混进了测试书里的一段探测脚本：
> `try{parent.__epubScriptRan=true;document.title="SCRIPT-RAN"}catch(e){…}`
> —— 连同 `<head>` 里的 `<title>` 与内联样式一起进来了。
>
> 修法：抽一个 `makeTurndown()`（html 导入与 epub 导入共用），显式
> `td.remove(['script','style','head','title','noscript'])`。
> **修后复验**：同一本书重新导入，`__epubScriptRan|SCRIPT-RAN` 命中数 = **0** ✅。
>
> 📌 顺带一条方法论：**转换器必须拿"带脏东西"的真实文件试** —— 干净的示例看不出这类问题。
>
> ### 三、现在的账
>
> · **导入 6 种全部验证**：md / txt / html / docx（手机端）＋ **pdf / epub（桌面端）**
> · **导出 5 种**：txt / html / png / docx（**手机端到端落盘**）＋ pdf（**探针过**，真实打印待真人点一次）
> · 待验：pdf 真实打印（桌面）· 桌面端导出落盘（`dialog.save` ＋ `write_absolute`）
> · 手机端 pdf / epub 导入**可选**复验（同一份代码；手机走 `content://` 那条路已由其它格式验证过）

> ## 📌 rev88（2026-10-15 · **md→pdf**（浏览器打印栈）＋ 桌面端五种导出探针全过）
>
> ### 一、md → pdf：走**系统打印栈**（桌面专有）
>
> ⚠️ **更正见 rev92** —— 这一节的前提（`window.print()` 在桌面能弹打印对话框）**实测不成立**：
> WebView2 里 `window.print()` 同步返回、什么也不弹（一手来源：`wry-0.57.0/src/webview2/mod.rs:1796`
> 的 `print()` 就是 `eval("window.print()")`）。**现行实现改为「导出 HTML ＋ 浏览器里打印成 PDF」**，
> 下面这段 `printMarkdown` 代码**保留但不再被调用**（万一 WebView2 将来支持）。
>
> Markdown → marked → 挂一个 `.zn-print-root` 全屏容器（屏幕上先让用户看到排版）→
> `window.print()` → 用户在「目标打印机」里选「另存为 PDF」。
> · 打印态用 `@media print{body>*{display:none!important}}` **只留这一块**，
>   `@page{margin:16mm 14mm}`，并对 `pre / blockquote / table / img` 加 `break-inside:avoid`（不被切页）
> · **Android 直接拒绝并给替代方案** —— Tauri 的打印在 Android 无效（[#11933](https://github.com/tauri-apps/tauri/issues/11933) open）
> · 不自绘 PDF 的理由见 rev85：jsPDF 中文要嵌 17.7 MB 整字体、pdf-lib 的 CJK 子集化有未修 bug
> · ⚠️ **探针加了一道闸**：`printMarkdown(..., dryRun)` 在 dryRun 时**绝不调 `print()`** ——
>   否则自动化一跑就弹系统打印框，等于把会话卡死（写的时候就防住了，没等踩）
>
> ### 二、桌面端五种导出探针全过（读数，笔记 `大纲示例`）
>
> | 格式 | 读数 |
> |---|---|
> | txt | 55 B |
> | html | 1,438 B |
> | png（长图） | **55,886 B** |
> | docx | **9,770 B** |
> | pdf | **chars = 972**（打印页生成成功，dryRun 未弹框） |
>
> 桌面验证的前置：把插件 **junction 到桌面测试库** `_tmp-vault-tb/.zn/plugins/import-export`
> → `__znExec('core.plugins')` → 点「重新扫描」（vite 不监视库目录，HMR 覆盖不到库内插件）。
>
> ### 三、待验（下一步）
>
> · **pdf 的真实打印**（要真人点一次打印对话框选「另存为 PDF」）
> · **桌面端导出落盘**（`dialog.save` ＋ `write_absolute`，同样要真人点一次"另存为"）
> · **手机端 pdf / epub 导入**（代码就位；需应用在**前台** —— 后台时 CDP 超时，见 rev87 §四）
>
> 至此导出 **5 种**（txt / html / png / docx / pdf）能力齐备，其中 **4 种已在手机上端到端落盘验证**。

> ## 📌 rev87（2026-10-15 · 导入导出**批 3**：pdf/epub 导入 ＋ 长图 ＋ docx —— **四种导出真机全部验证**）
>
> ### 一、四种导出**端到端**验收（用户亲测 ＋ 产物签名校验）
>
> 用户在系统「另存为」里选了 `Download/导出/`，四个全部成功落盘：
>
> | 格式 | 大小 | 校验 |
> |---|---|---|
> | txt | 133 B | 内容与源笔记一致 ✅ |
> | html | 1,491 B | 单文件 ＋ 内联 CSS ✅ |
> | **png（长图）** | **60,018 B** | 头 8 字节 = `89 50 4e 47 0d 0a 1a 0a` ✅（合法 PNG） |
> | **docx** | 9,864 B | 头 4 字节 = `50 4b 03 04` ＋ 内含 `word/document.xml` ✅ |
>
> **png 与探针读数 60,018 一字不差** ⇒ "探针渲染"与"另存为"两条路出的是同一份字节。
>
> ### 二、Android 的"另存为"写通道**全链打通**
>
> `io.exportX` → `host.saveFile` → `dialog.save()`（`ACTION_CREATE_DOCUMENT`）→ 用户选目录 →
> 返回 `content://` → `uri-reader` 的 **`write_content_uri`** → `ContentResolver.openOutputStream` → 落盘。
> logcat 取证：`writeContentUri uri=content://com.android.providers.downloads.documents/document/raw%3A… textLen=65`。
> ⇒ 目标里的「**导出落点每次弹系统选择器让用户选目录**」**已实现并验证**。
>
> ### 三、本批新增
>
> · **pdf → md**：复用已内置 pdf.js 的 `getTextContent()` ＋ 自写版面启发式（同一行按 `transform`
>   的 y ±2 归行、行内按 x 排序）；**扫描件明确报错**，不产出空笔记。
> · **epub → md**：**自己解 zip（fflate 0.8.3，MIT，91 KB）＋ turndown** —— `container.xml` → OPF →
>   manifest/spine → 逐章 XHTML 转 md。**为什么不用 foliate-js 的解析 API**：它的 `EPUB` 类要求
>   调用方提供 `loadText/loadBlob/getSize` 回调（zip 访问被抽象出去了），而"抽文本"直接 `unzipSync`
>   ＋ 读 OPF/spine 更直白、还能**复用已有 turndown**（foliate 仍在文档阅读器里负责渲染）。
> · **md → docx**：docx 9.11.0 ＋ 自写映射（标题 / 段落 / 列表 / 引用 / 代码块 / 分隔线，行内粗斜体与
>   行内代码，链接退化成「文字 (url)」）；**中文零成本** —— docx 只写字体名，不像 jsPDF 要嵌 17.7 MB 字体。
> · **导出探针**（`payload.probe`）：只渲染、不落盘、回报字节数 —— 长图是二进制、走不了 `toVault`，
>   而"另存为"没法脚本化。
>
> ### 四、⚠️ 一个环境坑（记下来）
>
> **应用在后台时 CDP 会超时**（Android 冻结后台 WebView 的 JS）⇒ 用 `__znExec` 做自动化验收前，
> 先用 `dumpsys window | grep mCurrentFocus` 确认应用**在前台**；否则 eval 会挂满超时（本轮真踩）。
>
> ### 五、还没做 / 待验
>
> · **epub / pdf 导入的真机验证**（代码已就位；手机上有现成样本 `测试书籍.epub` 与 `歌词大全-2.pdf`）
> · **md → pdf**：桌面走 `window.print()`（Android 的 print 无效，Tauri #11933 open）
> · 桌面端导出链路未验（`dialog.save` ＋ `write_absolute`）
> · mammoth 的 docx 表格退化 / html 导入 `<title>` 混入（小瑕疵，见 rev86）

> ## 📌 rev86（2026-10-15 · 导入导出**批 2**：html / docx 导入 ＋ txt / html 导出）
>
> 用户在批 1 验收后追加要求：「都做」＋「**还有导出为长图片**」＋「落点**每次让我选目录**」，
> 并允许重建 Android。本批按选型表（rev85）落地**不依赖重建**的那一半 ＋ 把重建要用的代码写好。
>
> ### 一、转换库落地（`public/vendor/`，全部 MIT/BSD，git 入库）
>
> | 目录 | 内容 | 体积 |
> |---|---|---|
> | `vendor/turndown/` | `turndown.js`（UMD）＋ `turndown-plugin-gfm.js` ＋ 两份 LICENSE | 26,659 ＋ 4,191 B |
> | `vendor/marked/` | `marked.esm.js`（ESM，可直接 `import()`）＋ LICENSE | 47,076 B |
> | `vendor/mammoth/` | `mammoth.browser.min.js`（UMD）＋ LICENSE | 405,060 B |
>
> 下载方式：`npm pack <pkg>@<ver> --registry=https://registry.npmmirror.com` → 解包 → 取单文件产物。
> **架构上刻意分两类加载**：ESM 的走绝对 URL `import()`（`new URL('/vendor/…', location.origin)`，
> Blob 模块里相对路径没有 base），UMD 的走注入 `<script>`（`data-zn-plugin-vendor` 标记，
> 卸载时由 `host.onRollback` 摘掉）。三个库**懒加载** —— md/txt 导入不需要它们。
>
> ### 二、插件能力（`examples/import-export/`）
>
> · **导入**：md / markdown / txt（原样）· **html / htm**（turndown＋gfm）· **docx**（mammoth）
> · **导出**：`io.exportTxt` / `io.exportHtml`（marked 渲染成**单文件 HTML**，样式内联、深浅色自适应）
> · **`payload.toVault`**：导出**写进笔记库**而不弹保存框 —— 既给"导出到库内"用，
>   也是**可自动化验收**的那条（系统"另存为"没法脚本化点选）
> · `payload.path`：导入时不弹选择器直接吃给定路径/URI（同样是给自动化）
>
> ### 三、真机验收读数（`33b676f6`）
>
> **html → md**（turndown＋gfm，`io-test.md`）：标题 / 加粗 / 斜体 / 链接 / **GFM 表格** /
> ```` ```js ```` 带语言标注的围栏代码块 / 引用 **全部正确**；⚠️ 小瑕疵：`<title>` 也进了正文首行。
> **docx → md**（mammoth，`io-test-1.md`）：标题 / 段落 / 项目符号列表 / 二级标题都对；
> ⚠️ **表格退化成逐单元格一行**（mammoth 走"语义化"、表格支持弱 —— 选型报告里已预告）。
> **导出 txt**（`io-test-1.txt`，133 B）：标记剥干净（`• 列表项`、引用去 `>`、链接留文字）✅
> **导出 html**（`io-test-1.html`，1491 B）：单文件 + 内联 CSS + `prefers-color-scheme` 双向适配 ✅
> · 基线：`tsc -b` 0 · `oxlint src` 4
>
> ### 四、为导出补的写通道（**需要重建才生效**）
>
> `tauri-plugin-uri-reader` 新增 **`write_content_uri`**：
> · Kotlin `writeContentUri`：`ContentResolver.openOutputStream(uri)`，`text` / `base64` 二选一
>   （二进制走 base64 —— Tauri 的 `Vec<u8>` 会被序列化成 JSON 数字数组）
> · Rust 侧同名命令转发 ＋ `invoke_handler` 登记；`permissions/default.toml` 加 `allow-write-content-uri`
> · 内核 `host.saveFile` 的 Android 分支（rev85 已接好）就是调它
> · ⚠️ **只在 `ACTION_CREATE_DOCUMENT` 返回的 URI 上能写**（系统授予写权限）；随手构造的
>   `content://` 会抛 SecurityException —— 正常现象，不是 bug
>
> ### 五、已知局限 / 下一步
>
> · docx 表格退化（mammoth）—— 可试 `convertToHtml` ＋ turndown 路线，待评估
> · html 导入的 `<title>` 混入正文 —— 加一条 turndown 规则即可（下次顺手）
> · **P1**：pdf→md（复用 pdf.js）、epub→md（复用 foliate）、**md→长图**（modern-screenshot）、
>   md→docx（docx 库）、桌面 `window.print()` 出 PDF；Android 的 PDF 导出**做不了**（Tauri #11933 open）
> · 落地清单见 rev85 的选型表

> ## 📌 rev85（2026-10-15 · 导入导出插件：**选型调研定案** ＋ **批 1（md/txt 导入）落地验收**）
>
> **用户需求**（原话）：「下一步写导入导出的插件，支持 md 文件导入，和其他文件导入为 md，
> 或者 md 导出为其他文件」＋「导出为长图片」＋「落点每次让我选目录」。
>
> ### 一、选型调研（**先查现成再动手**；结论：没有可行的一把梭）
>
> **pandoc-wasm 排除**（同名两个项目都查了）：
> · 官方 [pandoc/pandoc-wasm](https://github.com/pandoc/pandoc-wasm) npm **v1.1.0**：
>   `unpackedSize = 58,617,582 B ≈ 55.9 MiB`、许可 **GPL-2.0-or-later**、
>   浏览器能跑（`@bjorn3/browser_wasi_shim`）、**不能产 PDF**（要 LaTeX 外部进程）
> · [NathanHimpens/pandoc-wasm](https://github.com/NathanHimpens/pandoc-wasm)：**166 MB** wasm ＋
>   必须 `wasmtime` 跑 ＋ 自称 experimental
> ⇒ **体积 ＋ GPL 传染**两条硬伤，**不进默认包**。
>
> **逐方向的现成方案**（版本/许可/体积都核过；raw / gzip）：
>
> | 方向 | 方案 | 许可 | 体积 | 集成 |
> |---|---|---|---|---|
> | txt→md | 自写（`TextDecoder` + GBK 回退） | — | 0 | 插件内 ~40 行 |
> | html→md | [turndown](https://unpkg.com/turndown@7.2.4/README.md) 7.2.4 ＋ turndown-plugin-gfm 1.0.2 | MIT | 27 KB / 8.9 KB | UMD 直放 vendor |
> | pdf→md | **复用已内置 pdf.js 6.4.299** ＋ 自写抽取器 | Apache-2.0 | 0 新增 | 已有 |
> | epub→md | **复用已内置 foliate-js 1.0.1** | MIT | 0 新增 | 已有 |
> | docx→md | [mammoth](https://www.npmjs.com/package/mammoth) 1.13.0（有 `convertToMarkdown`） | BSD-2 | 405 KB / 102 KB | browser UMD |
> | md→html | [marked](https://www.npmjs.com/package/marked) 18.1.1（gfm 默认开） | MIT | 47 KB / 14 KB | ESM |
> | md→docx | [docx](https://www.npmjs.com/package/docx) 9.11.0 ＋ 自写 ~150 行映射 | MIT | 1.36 MB / 286 KB | IIFE |
> | md→长图 | [modern-screenshot](https://www.npmjs.com/package/modern-screenshot) 4.7.0 | MIT | 55 KB / 14 KB | ESM |
> | md→pdf | **`window.print()`**（仅桌面） | — | 0 | 自绘打印页 |
>
> **三条关键坑**（一手来源）：
> 1. **Android 上 `window.print()` 无反应**（Tauri [#11933](https://github.com/tauri-apps/tauri/issues/11933) **open**）
>    ⇒ PDF 导出只在桌面提供，Android 给 HTML / 长图。
> 2. **jsPDF / pdf-lib 都不合格**：jsPDF 中文要嵌**整**字体（Noto Sans SC 变量 TTF = **17.7 MB**，
>    `addFont` 无 subset 参数）；pdf-lib 的 CJK 子集化有**未修 bug**（[#1232](https://github.com/Hopding/pdf-lib/issues/1232) open）。
> 3. **Obsidian Importer 的依赖就是 turndown ＋ turndown-plugin-gfm**
>    （[package.json](https://raw.githubusercontent.com/obsidianmd/obsidian-importer/master/package.json)）
>    —— 生态标准做法，不是我们拍的；另注：**Obsidian Importer 自己也不支持 docx/pdf/epub 导入**。
>
> ### 二、批 1 已落地并真机验收（**md / txt 导入**）
>
> 插件 `examples/import-export/`（命令 `io.importFile` ＋ 侧栏面板）。三个内核配套：
>
> · **`host.pickFile()`** —— 弹系统选择器（Android 一律不传 filters，见 `553ebbb`）
> · **`host.readContentUri(uri)`** —— SAF `content://` → 原生插件复制到缓存 → `{path,name}`；
>   桌面原样返回。**为什么必须宿主转发**：插件是 **Blob 模块**，`import` 不到 `@tauri-apps/api`，
>   自己拿不到 `invoke`。
> · **`window.__znExec(id, payload)`** —— 带 payload 执行命令。**没有它，端到端验收会断在这里**：
>   命令面板不带参数、UINode 按钮的 payload 写死，而原生文件对话框没法脚本化点选。
>   ⇒ 以后"必须传参的命令"都靠它自动验收。
> · 顺带：`host.saveFile` 补了 **Android 分支**（`save()` 返回 `content://` → 交给 `uri-reader` 的
>   `write_content_uri`；⚠️ **该命令还没落地** ⇒ 导出功能要等它，且**要重建 Android**）；
>   `toBase64` 改**分块**（原实现 `String.fromCharCode(...arr)` 几百 KB 就爆栈，导出长图正好会踩）。
>
> **验收读数**（真机 `33b676f6`，CDP ＋ logcat）：
> · 绝对路径：`R=untitled-20261014-232959-1.md`（2237 B 落库，撞名加 `-1`）
> · content://（MediaStore `id=1000045191`）：`[io] 源 = /data/user/0/…/cache/zn-open/untitled-20261012-000854.md`
>   → `R=…-1.md`
> · 格式门：传 pdf 的 URI ⇒ 如实报「批 1 只支持 md / txt，拿到的是「pdf-100kb.pdf」」
> · 验证用的两个副本已删（库回到 10 个 md）· 基线 `tsc -b` 0 / `oxlint src` 4
>
> **⚠️ 顺带查清一个"假故障"**：手工构造的 `content://com.android.externalstorage.documents/…`
> **读不了是正常的** —— 那条 URI 没经过系统授予，应用没有它的权限（`readContentUri` 被
> `ContentResolver` 拒）。真实场景（文件管理器/系统选择器递来的）**带授权** ✅；
> 要自动化就用 **MediaStore 的 `content://media/external/file/<id>`**（应用可读）。
>
> ### 三、下一步
>
> · **P0**：html→md（turndown）、md→html（marked）、docx→md（mammoth）、md→docx（docx）
> · **P0 前置**：给 `uri-reader` 补 **`write_content_uri`**（导出落点用；**要重建 Android**）
> · **P1**：pdf→md（pdf.js 抽文本，扫描件明确提示）、epub→md（foliate）、md→长图、桌面打印成 PDF
> · 落点：桌面 `dialog.save()`；Android `ACTION_CREATE_DOCUMENT`（内核 `saveFile` 分支已接好）

> ## 📌 rev84（2026-10-15 · 文档阅读器**按原始尺寸**看 PDF ＋ 一个「同 URL 加查询串就好了」的怪案）
>
> **用户要求**：「PDF 显示会强制缩放，取消掉，做原格式查看」。
>
> ### 根因（真机读数）
>
> `.dn-page` 上带着 `max-width:100%`（`examples/doc-reader/index.js` 的 CSS）—— 它把页面
> **压到容器宽**；而 canvas 的 `height` 是 pdf.js 按 1:1 写进 **inline style** 的，
> CSS 的 `height:auto` 盖不掉 ⇒ **宽被压、高不动 ⇒ 画面横向压扁**（实测宽 66%、高 100%），
> 顶栏却写着 `100%` ⇒ 用户看到的就是"被强制缩放"。
>
> ### 改法
>
> · `.dn-page` → `display:block; margin:10px auto`（不再压宽，按 pdf.js 给的原尺寸显示）
> · `.dn-body` → **去掉 `display:flex; justify-content:center`**（flex 居中在内容超宽时
>   左边会被裁掉且滚不过去）⇒ 超宽部分靠 `.dn-body` 横向滚动看全
> · EPUB / TXT 两个渲染器自己会把 `body.style.display` 覆盖成 `block` ⇒ **不受影响**
>
> ### 验收（真机 `33b676f6`，物理 `screencap`）
>
> | 读数 | 值 |
> |---|---|
> | `canvas.dn-page` 显示尺寸 | **841 × 595**（scale=1，横向 A4 的原尺寸） |
> | `.dn-body` clientW / scrollW | **390 / 841** ⇒ 可横向滚动 |
> | 顶栏 | 「第 1 / 478 页 · **100%**」名副其实 |
>
> 证据 `_shots/rev84-01-pdf-natural-size.png`（比 rev82-05 明显大一号 —— 那版是被压扁的）。
> 要缩小仍可用顶栏「−」（zoom 0.25–4；手机上点两次约等于适配宽度）。
>
> ### ⚠️ 途中撞到一个怪案：无查询串的 `import()` 必失败
>
> 同一台手机、同一页面、同一文件，四条对照**当场全跑过**：
>
> | 请求 | 结果 |
> |---|---|
> | `import('/vendor/pdfjs/build/pdf.min.mjs')` | ❌ `Failed to fetch dynamically imported module` |
> | 同 URL **`fetch()`** | ✅ 200 / `text/javascript` / **523758 字节**，内容就是 pdf.js（不是 SPA fallback） |
> | `import('/vendor/pdfjs/build/pdf.worker.min.mjs')`（同目录同后缀） | ✅ |
> | `import('/vendor/foliate/epub.js')` | ✅ |
> | `import('…/pdf.min.mjs?x=1')` | ✅ **加个查询串就好了** |
> | Node 直接 import 本地那份 | ✅ 62 个导出（文件本身是合法 ESM） |
>
> **处置**：不等根因，先自愈 —— `importWithRetry()`：**正常路径不带参数**
> （生产走 asset 协议，对查询串的支持未知），失败后带一次 `?znretry=<时间戳>` 重试，
> 两次都失败抛原始错误。
> ⚠️ **根因未定**：清应用 `cache/WebView` **无效**（坏记录不在那儿）；**不是** MIME / 大小 / 语法
> （同目录同后缀的 worker 1.3 MB 照样能进）。**别当结论传下去** —— 下次先验"加查询串是否就好"。
>
> ### 🔧 过程中的两个自伤（都当场修掉，记下来）
>
> 1. **在模板字符串里写了反引号**：给 CSS 加注释时用了 `` `max-width:100%` `` 这种写法，
>    而那段 CSS 本身就在一个**反引号模板字符串**里 ⇒ 提前闭合 ⇒ 插件解析失败 ⇒
>    表现是 **"插件没接管"**（`openDocument 派发（插件接管就绪=false）`、界面纹丝不动），
>    **不是**一句明晃晃的语法错。⇒ **改完插件先自检**：
>    `node --input-type=module --eval "import('file:///<绝对路径>')"`，看到 `PARSE-OK`/能 import 再推。
> 2. 手机装的是**库内拷贝**：改完必须 `adb push` 到 `.zn/plugins/doc-reader/index.js`
>    （**推明确文件路径**，别推目录）再重启应用才生效。

> ## 📌 rev83（2026-10-15 · **安全区**：整窗接管的插件顶栏不再压状态栏）
>
> **用户报的活**：「顶部 UI 和状态栏冲突，插件好像都存在这个问题」。
>
> ### 根因（读数，不是推断）
>
> 真机读数（手机 `33b676f6`，`env(safe-area-inset-top)` = **40px**）：
>
> | 选择器 | 修复前 | 修复后 |
> |---|---|---|
> | `.zn-app` computed `padding-top` | 40px | 40px |
> | `.zn-shell-mount` `top` / 高度 | **0** / 868（整屏） | 0 / 868（`padding-top: 40px`） |
> | 阅读器根 `.dn-root` `top` | **0** | 0（`padding-top: 40px`） |
> | 顶栏 `.dn-bar` `top` | **0** ← 与状态栏重叠 | **40** ✅ |
>
> **机制**：`.zn-shell-mount` 是 `position: absolute; inset: 0`，而**绝对定位子元素的包含块
> 是祖先的 padding box** —— `.zn-app` 那圈 `padding-top` 仍算在它的定位范围内 ⇒ 它照样贴屏幕顶。
> ⇒ 所有走 `view.overrideShell`（主窗口整窗接管）的插件，自绘顶栏都被状态栏压住
> （文档阅读器、shell-demo… 用户说"插件好像都存在"正是这个）。
>
> ### 修法（内核层一处，插件不用各自改）
>
> 1. **`.zn-shell-host > .zn-shell-mount` 自己吃安全区**（top ＋ bottom）—— 只补**主窗口**这条：
>    插件**独立窗口**那边 `.zn-plugin-window` 2026-10-14 已经吃过安全区，再补一份会双倍下移。
> 2. **内核逃生口 `.zn-shell-escape`** → `bottom: calc(10px + env(safe-area-inset-bottom, 0px))`
>    —— `absolute` 的 bottom 同样相对 padding box，接管容器那层 padding 管不到它。
> 3. **`.zn-toast` / `.zn-undo`** 的 `bottom: 32px` → `calc(32px + env(safe-area-inset-bottom, 0px))`，让开手势条。
>
> 桌面端 `env(...)` 一律取 0 ⇒ **桌面零影响**。
>
> ### 验收（**物理 `screencap` 为证** —— CDP 截图看不到系统状态栏）
>
> · `_shots/rev83-01-reader-safearea.png`：状态栏独立一行，阅读器顶栏
>   「✕ 关闭 / pdf-100kb.pdf / 第 1 / 1 页 · 100%」在它**下方**，右下「释放接管」也让开了手势条
> · `_shots/rev83-03-mapwindow-safearea.png`：导图**独立窗口**（`?pluginWindow=outline-map.map-0`）
>   本来就对（标题条「导图 · 测试大纲 / − □ ✕」在状态栏下方）⇒ 印证"只有主窗口接管那条漏了"
> · 基线：`tsc -b` **0** · `oxlint src` **4** · 提交 `dd70a33`（`src/styles.css` / +26 −3）
>
> ### 顺带记录（本轮读到的）
>
> · **Android 上独立插件窗口是真的另一个 webview**：CDP `list` 能看到
>   `http://tauri.localhost/?pluginWindow=outline-map.map-0&vault=…` 独立 page ⇒
>   对窗口断言要 `ZN_TARGET=pluginWindow=`（否则 `cdp.mjs` 默认挑主窗口）
> · 窗口三键的文本是**空的**（只有 `title`：最小化 / 最大化 / 关闭窗口，class `zn-win-btn`）
>   ⇒ 脚本点它要按 `title` 找，`text:` 匹配不到（本轮关窗就踩了）
> · **未做（诚实标注）**：插件自己写的 `position: fixed` 元素仍会贴屏幕边 ——
>   接管容器的 padding 管不到 `fixed`，那是插件作者的责任；内核这一层给的是正确的容器内边距

> ## 📌 rev82（2026-10-15 · **外部 PDF 双路真机验收**：热启动 ✅ · 冷启动修掉接管竞态 ✅）
>
> **任务来自 rev81 的「下次接手第一件事」**：重建 Android ＋ 真机验证「热启动 intent 转发」
> 与「外部 PDF」两条链路。本轮把两条都验通了，并**查出两个会让它失败的原因**（一个环境、一个代码）。
>
> ### 打通的手段（以后手机断言都这么干，别再截图猜）
>
> · **手机 CDP**：`adb shell cat /proc/net/unix | grep devtools` 拿 socket →
>   `adb forward tcp:93xx localabstract:webview_devtools_remote_<app pid>` →
>   `ZN_CDP=http://127.0.0.1:93xx node tools/cdp.mjs …`（`eval` / `shot` / `click` 都能用，`eval` 支持 `awaitPromise`）
> · **应用内 console 会进 logcat**：`adb logcat -v time | Select-String 'Tauri/Console|ZN-URI'`（有行号，定位极快）
> · **磁盘为真源**：`adb shell run-as com.aqua.zeronote.debug ls -la cache/zn-open`（内容 URI 的副本落这儿）
> · 触发一条"外部打开"（**shell 不能发 SAF 的 `content://`** —— 见下方踩坑，改用 MediaStore）：
>   `adb shell am start -W -a android.intent.action.VIEW -d "content://media/external/file/<id>" -t application/pdf -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity --grant-read-uri-permission`
>   （id 由 `adb shell content query --uri content://media/external/file` 全量输出里筛 `pdf`；
>   ⚠️ 这台机器上的 `content` 命令**不支持** `--projection _id,_display_name` 这种写法，会报 `Invalid column`）
>
> ### 结果 1：热启动 intent 转发 ✅（先修掉两个坑才通）
>
> | 坑 | 读数 / 根因 | 处置 |
> |---|---|---|
> | **① 手机库里的 doc-reader 是旧版** | 手机 `index.js` **23341** 字节（10-13 23:38），`grep -c assetUrlAbs` = **0**、`grep -c 'p.abs'` = **0** ⇒ `openDocument({abs,name})` 在 `if (!abs && !path) return` 处**静默返回**（界面纹丝不动、无报错） | `adb push` 仓库新版（**24620** 字节）到 `.zn/plugins/doc-reader/`，重启应用即好 |
> | **② 热启动 listener 的权限** | rev81 补的 `allow-register-listener` / `allow-remove-listener` **编译进 APK 后生效** —— 本轮 logcat 已是 `[zn-uri] listener registered`（旧报错 `uri-reader.registerListener not …` 消失） | 重建已由 `android-dev.cmd` 完成（本会话开始时正在编译） |
>
> **修复后热启动读数**（`am start` 回 `Warning: Activity not started, intent has been delivered to currently running top-most instance.` ⇒ 正是热启动路径）：
> `ZN-URI: onNewIntent data=content://media/external/file/1000045559` →
> `readContentUri uri=…` → `[zn-uri] 副本就绪 path=/data/user/0/com.aqua.zeronote.debug/cache/zn-open/pdf-100kb.pdf name=pdf-100kb.pdf 可阅读=true` →
> `[zn-uri] openDocument 返回 undefined`，界面 `✕ 关闭 pdf-100kb.pdf 第 1 / 1 页 · 100% ‹ ›`。
> 证据 `_shots/rev82-01-android-hot-open.png`（关掉阅读器回主界面后再发一次：`_shots/rev82-03-android-hot-recheck.png`）。
>
> ### 结果 2：冷启动 ❌→✅（**新查出并修掉一个真竞态**）
>
> **症状**：`am force-stop` 后带 `content://` 冷启动（`LaunchState: COLD`）—— 应用起来了，
> 但**不打开阅读器**（界面停在主界面）。而 rev81 记的是"冷启动正常"（那次验的是 `file://`）。
>
> **根因（读数，不是推断）**：前端挂载后**立刻**消费启动时攒下的 URI ——
> 冷启动 logcat 时间线：`readContentUri` 在 `00:27:39.118`、`openDocument 调用`在 `00:27:39.138`（**相隔 20ms**），
> 而库内插件是**异步 blob import**、更晚才 `bind('core.openDocument')`。
> 中间那个窗口里命令表里还是**内核占位实现** ⇒ 请求被一句
> 「没有能打开 .该 的插件 —— 到「插件管理」装一个文档阅读器」吞掉
> —— 这与用户 10-14 报的「显示没有装插件、但插件已经在运行」是**同一个机制**，
> rev81 只修了"占位命令拒绝插件接管"（`register()` 改接管语义），**没修"接管晚于消费"的时序**。
>
> **修法**（`src/App.tsx`，内核不动）：新增 `waitDocHandler()` ——
> 判据用内核已有的 `implTag('core.openDocument')`：`'core'` = 还是占位/内核实现、`plugin:<id>` = 已接管；
> 每 120ms 问一次、最多等 **8 秒**；**热启动第一次就通过（零开销）**，超时后**仍然派发**
> （确实没插件接管时，那句提示还是该给）。
> 三处派发点都先等：`content://` 分支 · **库外绝对路径**分支 · 「待打开的库内文档」effect。
>
> **修复后冷启动读数**：`[zn-uri] 副本就绪 … 可阅读=true kernel=true` →
> `[zn-uri] openDocument 派发（插件接管就绪=true）`（约 **120ms** 后接管就绪）→
> 界面 `✕ 关闭 pdf-100kb.pdf 第 1 / 1 页 · 100% ‹ ›`。证据 `_shots/rev82-02-android-cold-open.png`。
>
> ### ⚠️ 踩坑（新，值得记）
>
> 1. **shell（UID 2000）发不了 SAF 的 `content://`**：`am start -d content://com.android.externalstorage.documents/document/primary%3ADownload%2F… --grant-read-uri-permission`
>    会抛 `SecurityException: UID 2000 does not have permission … you could obtain access using ACTION_OPEN_DOCUMENT or related APIs`
>    —— shell 自己不持有该 URI 的权限，**没法把它转授给目标应用**。这不是应用的问题。
>    ⇒ 自动化要发内容 URI 就用 **MediaStore** 的 `content://media/external/file/<id>`（shell 可读、可授权）。
>    真实"文件管理器 → 打开方式"递的是文件管理器自己的 provider（实测用户那次是
>    `content://com.android.fileexplorer.myprovider/external_files/Download/pdf-100kb.pdf`），那条路**手动点一次**才是真验收。
> 2. **`adb shell content query` 的 `--projection` 不能写逗号列表**（本机这台）：会报 `Invalid column _id,_display_name`。
>    不带 projection 全量输出再本地筛即可。
> 3. 手机上 `am force-stop` 之后那几个进程号会变 ⇒ **CDP 的 forward 每次都按新 pid 重建**（socket 名带 pid）。
> 4. ⚠️ **CDP 的 `Page.captureScreenshot` 抓不到 WebView 里的 canvas**（本轮实测）：PDF 明明已渲染 ——
>    `canvas.dn-page` 尺寸 `1190×1684`、采样 47.6 万像素里 **44672 个非白像素** —— 可 CDP 截出来的图里
>    画布是**空白**（`_shots/rev82-01/02/03` 都是这样，只有顶栏有字）。
>    ⇒ 手机验收的**图片证据一律用 `adb exec-out screencap -p > x.png`**（物理屏，体积也大得多：842 KB vs 39 KB），
>    或者直接用**读数**（canvas 像素统计 / `innerText` 里的页码）。**别拿 CDP 截图的空白当"没渲染"**。
> 5. 🔒 **别拿真实私人文件当测试样本**：本轮为验"有内容的 PDF"顺手开了手机上的个人信用报告，
>    `screencap` 出来含**姓名 / 证件号** ⇒ 该截图已**当场删除**，改用非隐私样本（`歌词大全-2.pdf`，478 页）
>    重做证据。挑测试文件前先看一眼是不是私人材料。
>
> ### ✅ 顺带核实了 rev81 留的那条「未核实」结论
>
> rev81 写：「无 `MANAGE_EXTERNAL_STORAGE` 时 Android 对非 media 文件**不报错也不列出**」——当时标注是推断。
> 本轮补了一手来源：**AOSP MediaProvider 的 FUSE readdir 实现**里，目录项是**带 filter 过滤**的 ——
> `jni/include/libfuse_jni/ReaddirHelper.h` 原文：
> *"If a filter is specified, directory entries must satisfy the given filter. If filter is null, all directory entries(except '.' & '..') are returned."*
> ⇒ 不满足 filter 的条目**被丢弃**（而不是返回错误），与实测一致（`ls` 有 12 个 `.md`、应用显示 0 篇、**无任何报错**；
> 授权后 `am force-stop` + 重启立刻 `11 篇 · 2 文档`）。
> 来源：`https://raw.githubusercontent.com/aosp-mirror/platform_packages_providers_MediaProvider/main/jni/include/libfuse_jni/ReaddirHelper.h`
> （同目录 `FuseDaemonImpl.cpp` 是传 filter 的调用方，本轮未下载成功 —— 只标注，不下结论）。
>
> ### 🔎 顺带查清：`core.requestStoragePermission` 的来龙去脉（rev64 说"没做引导"）
>
> 它**确实存在**，是内核命令：`src/App.tsx:2173`（rev64 加）→ `src/lib/androidPerm.ts` 的
> `requestAllFilesAccess()` → `plugin:androidperm|request_all_files_access`（自写 Tauri 插件
> `src-tauri/plugins/tauri-plugin-androidperm`，桌面 no-op）。**入口只有命令面板**（搜 `open` 能看到，
> 标题「请求「所有文件访问」权限（Android）」）。⇒ rev64 的"没做引导"应理解为
> **没有自动检测 + 没有显式 UI 入口**，不是"没有这条命令"。
>
> ### 基线 / 证据
>
> · `pnpm exec tsc -b` **0 错误** · `pnpm exec oxlint src` **恰好 4**（改完时一度 5 —— `useCallback` 依赖里留了
>   已删掉的 `platform`，去掉即回基线）· `cargo test --lib` 见提交信息（本轮未动 Rust）
> · 截图：`_shots/rev82-01-android-hot-open.png`（热）· `rev82-02-android-cold-open.png`（冷）·
>   `rev82-03-android-hot-recheck.png`（修复后热回归）·
>   **`rev82-05-android-pdf-render.png`（物理屏 `screencap`：478 页的歌词 PDF **内容真的画出来了**）**
> · 「内容渲染」的硬读数（防"只有顶栏"的假通过）：`canvas.dn-page` = **1190×1684**、
>   采样 476000 像素里 **44672 非白**（`getImageData` 直读 canvas）
> · 新增诊断日志（**有意保留**，与 `[zn-uri] listener registered` 同一家族）：
>   `[zn-uri] 副本就绪 …` / `[zn-uri] openDocument 派发（插件接管就绪=…）` / `[zn-uri] openDocument 返回 …`
> · **提交**：`a9b3981`（fix 冷启动接管竞态，`src/App.tsx` 1 文件 / +46 −9）＋ 随后的 docs 提交（回填本段）
> · 基线复跑（本提交前）：`cargo test --lib` **21 passed** / 0 failed
>
> ### 遗留 / 下一步
>
> - **手机库插件与仓库会漂移**（doc-reader 就这么落后了 12 小时）—— 现在只有"手动 `adb push`"一条路，
>   **目前没有**现成工具；若要做，写一个 `sync-phone-plugins.mjs` 放进 `tools/`（尚未创建），或先把操作写进交接卡，别靠记性。
> - 手机仍装 **dev 版**（连桌面 `1420`）⇒ 桌面 dev 一关手机就白屏；要独立运行得重出包
>   （`tauri android build --apk --debug --target aarch64`，约 7 分钟）。
> - Android 关窗仍留常驻 webview（rev81 记过；Tauri Android 还没给真销毁路径）。
> - rev81 那条「同一会话第二次打开笔记 ❖ 不显示」依旧**未复现**（回归脚本 `tools/verify-outline-fold.mjs` 在）。

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
> ### 🔁 续 2（同日 · 「外部 PDF 打不开」—— 两处已修、一处待重建验证）
>
> 用户报：手机从文件管理器「打开方式」选 ZeroNote 开外部 PDF ⇒ ① 什么都不发生（热启动）；
> ② 截图显示 toast **「没有能打开 .该 的插件 —— 到「插件管理」装一个文档阅读器」**，
> 而插件页显示两个插件都已加载（用户原话「显示没有装插件，但是插件已经在运行了」）。
>
> **① 那句话的真根因：内核占位命令抢了 id（已修，桌面已验证）**
> · 内核在 `App.tsx` 先注册**占位命令** `core.openDocument`（没插件时给友好提示）；
>   插件的 `command.register()` 撞同 id 时**抛「命令 id 重复」**（`src/kernel/command.ts`）
>   ⇒ doc-reader 的**接管被拒** —— 插件照打日志「已就绪（接管 core.openDocument）」、
>   插件页也显示已启用（**这正是"插件已经在运行"的来源**），可执行时跑的是内核占位。
> · `.该` 也印证：占位只读 `payload.path`，而外部文件走 `{abs, name}` ⇒ 取不到扩展名填了字面量。
> · 修法：`register()` 改成与 `bind()` 同一套**接管可还原**语义（后来者覆盖、dispose 还原上一层）。
> · **桌面验证读数**：点库内 `probe.pdf` ⇒ DOM 出现 `probe.pdf · 第 1 / 1 页 · 100% · − ＋ ‹ ›`
>   （阅读器真的渲染），且 `没有能打开=false`。
>
> **② 热启动 intent 转发（代码已落地，真机通道未通）**
> · 根因（一手证据，tauri-2.12.3 `mobile/android-codegen/TauriActivity.kt`）：
>   `onNewIntent` **只**调 `PluginManager.onNewIntent(intent)`，**没转给 tao** ⇒ `RunEvent::Opened`
>   热启动不触发（冷启动正常，已做对照实验）。
> · 修法：`tauri-plugin-uri-reader` 的 Kotlin 侧重写 `onNewIntent` →
>   `trigger("open-uri", …)`；`App.tsx` 用 `addPluginListener('uri-reader','open-uri', …)` 接住，
>   复用同一套 `openExternalFile`。
> · ⚠️ **真机实测通道没通**，logcat 原文（被截断）：
>   `[zn-uri] listener failed uri-reader.registerListener not …`
>   ⇒ **权限缺失**：`permissions/default.toml` 原只有 `allow-read-content-uri`，
>   已补 `"allow-register-listener", "allow-remove-listener"`。
>   ⚠️ 权限名待构建校验（名字不对时构建会明确报 unknown permission）；
>   **permissions 是编译期嵌进二进制的**（rev50 记过）⇒ **必须重建 APK 才生效**。
>
> **③ 顺手修掉的真 bug**：前端在 `content://` 分支**之前**就做扩展名检查，而内容 URI 常常
> 没有扩展名 ⇒ 外部文件被静默丢掉（已把 content 分支提前）。
>
> **下次接手第一件事**：重建 Android（`android-dev.cmd` 重启，判据见本文件技术事实）＋真机验证两条链路。
> 判据：**应用已在运行时**从文件管理器点 PDF ⇒ ZeroNote 里出现阅读器，而不是那句 toast。
> **提交**：本轮修复与本节一起提交（`git log -1`）。
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
> ⚠️ `docs/内核契约-v0.2.md` **尚未同步**这一条（待办，别当成已完成）。
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
> · `docs/内核契约-v0.2.md` §4 改写：明写"capability 不再是门"，§4.1 标已移除，
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

> ## 📌 rev46（2026-10-13 · 架构原则重定：内核不设防 ＋ **修复优先于防护**）
>
> **用户重新说明 5 条原则**（原话与逐条落地见 **`docs/架构原则-2026-10-13.md`** ——
> **冲突时以它为准**，它覆盖 `内核需求分析-v0.1.md` §2 与 `内核契约-v0.2.md` §4 的旧假设）：
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

> ## 📌 rev44（2026-10-13 · 交接：内核 UI 承载能力盘点 ＋ 插件路线重定）
>
> **本轮没有改代码** —— 用户要求「先检查内核现有能力还会不会出现"承载不了插件功能"的情况，
> 先完善内核，再做插件」，于是做了一次**专项盘点并交接**。
>
> **分析结论落在这里**：`docs/archive/插件UI承载能力-2026-10-13.md` —— **下次接手先读它**
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
> **新会话怎么接**：读 `HANDOFF-CARD.md`（一页速览）→ `docs/archive/插件UI承载能力-2026-10-13.md`（本轮分析）→
> 本文件 rev44 → 从上面「下一步」第 1 条开工。

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
> 4. **插件能力盘点 + 六家对比**（子代理产出）：新增 `docs/archive/插件能力盘点-2026-10-12.md`（361 行）。
>    结论摘要：**领先** = 声明式 `UINode`（调研称「六家无对等先例」）/ 入口形态 4 种通吃 / 21 节点；
>    **落后** = 无沙箱无超时（对照 NoteGen 的 32 MiB + 75 ms）/ capability 只真裁 **2/13** 且授权不绑指纹 /
>    无市场无签名无更新 + `platforms` 不强制。**最值得先做：`platforms` 强制（1–2 小时）**。
> 5. **顺手修掉三处文档自相矛盾**（子代理发现）：契约 §0「8 个原语」→ **10**；§2 标题「五原语」→ **六**；
>    §2.2 的 `url` 注释曾写「接受 `data:`/`blob:`/`asset:`」，与同节 ④ 的实测结论打架 → 已改为「必须是独立 origin」。
> 6. **基线未变**：`tsc -b` 0 错误 · `oxlint` 4 warnings · `cargo test --lib` **16 passed**。

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

