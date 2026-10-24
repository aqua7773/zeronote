# Changelog

> 状态：**active** ｜最后核对：2026-10-20 ｜权威范围：契约 / 协议层的变化（功能细节见 `HANDOFF.md`）

## 应用版本（app version · rev173.37 起）

> 单一来源 = `package.json`；发版用 `node scripts/release.mjs <x.y.z>` 同步
> `tauri.conf.json` / `Cargo.toml`，前端「关于」页经 vite 注入 `__APP_VERSION__`。
> 与下面的**契约版本**（插件 API）是两套号，别混。

| 版本 | 日期 | 内容 |
|---|---|---|
| 0.4.0 | 2026-10-24 | A 档 4 个插件（标签 / 反向链接 / 历史版本 / 打卡）· 面板体系（阅读器 / 导图 / 文档多标签）· 白屏兜底 · 插件真签名与能力审计 · 手机原生剪贴板与长按四键 · 记账收尾 |
| 0.3.0 | 2026-10-20 | 多标签页 + 标签拆独立窗口 · 会话恢复（hot exit）· 主窗口位置记忆 · 粘贴图片 · 搜索筛选 · 全局替换 · 桌面时间流面板 · Markdown 语法增强（脚注 / Mermaid / 定义列表 / HTML 白名单）· 记账 v0.2 |
| 0.2.0 | 2026-10-19 | 第一个正式版本：内核 10 原语 + 插件体系（5 个预装）· 桌面 / Android · 桌面时间流面板 · 全局自绘滚动条 · Markdown 语法增强（上标 / 下标 / Emoji / KaTeX 数学） |

## [Unreleased]

### Added

- **`net` 原语**（rev173.106）：`ctx.net.fetch({ url, method, headers, body, timeoutMs })` —— 请求由
  **Rust 侧**（`reqwest`）发出，**不受 CORS 约束**。WebDAV 的 `PROPFIND` / `MKCOL` / `MOVE` 这类
  自定义方法在 WebView 里必然触发 preflight，服务器不回 CORS 头就只能看到 `TypeError: Failed to fetch`，
  分不清「CORS / 断网 / 401」；现在状态码与响应头原样带回（**4xx / 5xx 不抛错**）。
  TLS 后端分平台：桌面走系统栈（Windows schannel），Android 走 `rustls` + `ring`（不碰 OpenSSL）。
  依据 `docs/同步插件-调研与方案-2026-10-24.md` §3 缺口 1。
- **`fs.readBytes` / `fs.writeBytes`**（rev173.106）：二进制读写（图片 / PDF / 附件），base64 过桥，
  写走与 `writeText` 同一套原子语义。同步插件上传 / 下载附件靠它。
- **`host.secrets`**（rev173.106）：系统凭据库 —— Windows Credential Manager / Android Keystore +
  SharedPreferences / macOS 登录钥匙串（`get` / `set` / `delete`，只存字符串，未配置返回 `null`）。
  **不落** `.zn/` 明文 JSON，作用域是系统、不随库切换。依赖 `tauri-plugin-keyring-store 0.2`
  （关掉 `crypto` feature —— 只要存字符串）。
- 契约文档补 §2.6.1 `net`；`check-docs` 的接口清单加 `NetApi`（门禁从 10 组变 11 组）。



> 0.3.0 之后的 40 个提交（`git log v0.3.0..v0.4.0`）。主线是 **A 档 4 个插件**（ROADMAP 6 项）：
> 先补面板地基（rev173.81–89），再做标签 / 双链 / 历史 / 打卡，最后白屏兜底收口。

### Added

- **面板体系**（rev173.81–89）：`view.registerPanel({ mount })` 支持 DOM 直挂（canvas / 画布类界面）·
  面板标签（`panel:<id>` 前缀，主区标签 + 拖出成独立窗口，`Ctrl+Tab` 穿过）· Android `openWindow`
  自动降级为主区面板（移动端没有多 webview）· 面板与编辑器共用 `zn-editor-wrap` 外壳（标签条 + 内容区，侧栏常驻）
- **文档阅读器迁到面板**（rev173.84–87）：PDF / EPUB / TXT 画在主区标签，**每份文档一个标签**；
  连续滚动 + 按需渲染（离开释放位图）、`Ctrl+滚轮` 缩放、EPUB 深色适配；拖出 / 右键 = 独立窗口
- **大纲导图迁到面板**（rev173.89）：主区标签 / 独立窗口共用同一份 mind-elixir 画布，写回按面板自己的笔记定位
- **标签面板 `tag-panel`**（rev173.93）：全库标签按篇数降序 · 点标签看该标签下的笔记 · 筛选框 · 空索引自动 rebuild
- **标签浮层**（rev173.96）：笔记里点正文 `#标签` → 浮层列出该标签的笔记 → 点标题在**独立窗口**打开 ·
  手机降级主区。内核补 `core.openInNewWindow({ path })` / `core.closePanel`
- **反向链接 `backlinks`**（rev173.95 + rev173.101）：扫全库 `[[…]]`（path+mtime 缓存）· `modal` 浮层 ·
  点来源打开原笔记 · **状态栏「被 N 篇引用」**入口
- **历史版本 `history`**（rev173.99 + rev173.100）：关闭且有过改动才存快照到 `<库>/.zn/history/` ·
  四档精简（7 天全留 / 8–30 天每天 / 31–365 天每周 / >1 年每月）· 「历史 vs 当前」LCS diff · 回滚（先存当前版）·
  状态栏「历史版本」按钮 + 「现在存一版」。内核补 `fs.listFiles` / `fs.purgePrivate`（后者只允许 `.zn/` 下真删）
- **提醒打卡 `habit`**（rev173.103 + rev173.105）：四种频率（每天 / 每周几 / 每月几号 / 每隔 N 天）·
  一天多次（上限用户自定 1–99）· 连续按「应打卡日」· 月历 · 补打卡 / 清除限最近 7 天 · 数据落 `store`。
  **到点提醒不做**（无定时器原语 / 无前台服务，用户 2026-10-23 裁决）
- **白屏兜底**（rev173.104）：插件 / 笔记窗口每 3 s 报活，主窗口每 5 s 清扫 —— 从没心跳 / 心跳断 / 自报白屏
  ⇒ `destroy()` + toast（清理链路不依赖目标窗口里的 JS）
- **插件真签名**（rev173.77）：Ed25519 `signature.json` + 信任根 `.zn/trusted-keys.json`，有签名必须验过否则拒载 ·
  `scripts/keygen.mjs` / `sign.mjs` · 插件页三态
- **插件能力使用审计**（rev173.78）：只记 API 名与次数（不含参数 / 路径 / 内容）· 落盘 `.zn/plugin-usage.json`
- **iframe ↔ 宿主能力通道**（rev173.76）：`zn:hello / zn:call / zn:reply` + 令牌 + `event.source` 双重校验，
  白名单 7 条（store / host.info / host.notify / 本插件命令），限流 20/s
- 手机编辑区长按 = **横向四键**（复制 / 剪切 / 粘贴 / 全选，rev173.90）+ **原生剪贴板**（rev173.92：
  `tauri-plugin-clipboard-manager`，跨 App 粘贴可用）
- 记账收尾（rev173.73 + rev173.75）：每月分类预算 · 分类管理（排序 / 删除）· 无金额补录 · 启动自动静默同步 ·
  完成态短语无金额也入账（进「金额待补」）· 列表单笔删除
- 查找面板补「替换」入口（rev173.71）：`Ctrl+F` 面板里「替换」按钮，关键词带进替换栏
- frontmatter 隐藏（rev173.98）：预览态不显示开头 `--- … ---` 元数据（编辑走源码模式）

### Changed

- **内置预装 5 → 9**：新增 标签面板 / 反向链接 / 历史版本 / 提醒打卡
- wikilink 点击判据改看**源码行**（rev173.102，与「绿色 = 可点」的外观判据同一套）；`[[目标|别名]]` 支持别名
- frontmatter 里的 `tags: [工作, 周报]` 不再被渲染成绿色链接（rev173.97：只给外观去色，不动解析）
- 插件市场 / 更新通道**降级不排期**（`D-008`，重议条件：要给别人发插件 / 插件数 > 10）；
  插件宿主隔离（Worker / 子进程）**明确放弃**（`D-001`，用户 2026-10-21 裁决）

### Fixed

- **链接无法跳转**（rev173.102）：rev173.97 的点击判据拿可见文本判 `[[…]]`，而 atomic 的可见文本永不含双方括号 ⇒ 点击全被丢弃
- 关一个标签 → 所有文档一起消失（rev173.88）：标签条在三个渲染分支各画一份，起始页分支没有
- 独立笔记窗口 `Ctrl+Shift+F` 静默（rev173.74）：该窗口补上 toast 渲染处
- 面板标签拖出后主区不复位（rev173.84）；`core.openDocument` 被大 effect 重注册覆盖（rev173.84）
- 从面板视图点笔记标签没反应（rev173.89）
- 打卡手机实测三修（rev173.105）：补打卡早于计划开始日 ⇒ 连续天数不涨（开始日前移）· 切月不清选中日 ·
  `.zn-btn:disabled` 没有禁用态

## [0.3.0] - 2026-10-20（rev173.28 – rev173.70）

> 0.2.0 之后的功能已在 2026-10-20 收口为 0.3.0（`node scripts/release.mjs 0.3.0`）。

### Added
- 会话恢复（hot exit，rev173.65）：崩溃 / HMR 整页重载后启动提示「恢复 / 丢弃」；草稿只留 1 篇 / ≤ 8 KB，正常保存即清
- 主窗口记住位置 / 大小 / 最大化（rev173.61）：重启后恢复；独立笔记窗口不记忆（`with_filter` 只跟踪 `main`）
- 多标签页（`Ctrl+Tab` 循环 / `Ctrl+W` 关当前）+ 标签拆独立窗口（拖出 / 标题条收回 / 同一篇互斥）
- 搜索筛选（标签 / 目录 / 正则）、全局替换（先试运行再写盘，改前进回收站）
- 编辑器粘贴图片（截图 `Ctrl+V` → 落笔记同目录 → 插入 `![]()`）
- 桌面「时间流」面板（可关）、全局自绘滚动条
- Markdown 语法增强：上标 / 下标 / Emoji / KaTeX / 脚注 / Mermaid / 定义列表 / 内嵌 HTML 白名单
- 记账 v0.2：统计视图、CSV 导入导出、原始通知诊断
- 手机长按 ☰ 出菜单（新建 / 搜索 / 命令面板 / 设置 / 插件管理）

### Changed
- 标签条：第一条标签贴编辑区左缘、取消活动标签顶部阴影线（rev173.69）
- 笔记独立窗口标题条：去掉「收回主窗口」按钮、整条标题栏可拖窗口、文档名居中；关闭按钮改为**交回主窗口**，拖拽收回手势移除（rev173.67–173.68）
- 插件只住全局目录（rev173.5）；内置预装 9 → 5（移出 daily-note / editor-marks / tag-demo / inspiration-flow）
- 搜索索引改为写路径增量更新 + 内核事件真派发
- `Ctrl+F` 改为编辑器查找（关闭 WebView2 原生查找栏）
- 笔记独立窗口**不再加载插件**（rev173.60）：窗口里只有编辑器，省掉内置预装 / 扫描 / 4 个插件的加载

### Fixed
- 独立窗口（笔记 / 插件）里 Ctrl+F 仍弹 WebView2 原生查找栏：主窗口的加速键开关是**每个 webview 各自**的，新窗口创建后补一次（rev173.70）
- 库内插件迁移失败不再静默：单个插件失败 / 读目录失败都会报到插件页 + toast（rev173.70）
- 手机起始页卡片菜单没进返回键层栈：菜单开着按返回会直接退 App（rev173.66）
- 插件目录读取 / 内置插件写盘 / 外链 失败不再静默
- 暗色主题滚动条、查找面板改悬挂窗
- 独立窗口（笔记 / 插件 / 导图）标题条三键的 hover 背景与主窗口对齐（rev173.62）
- 主窗口 reload 后丢失「哪篇在独立窗口」的账本，会重复打开同一篇（rev173.63：localStorage 持久化 + 存活窗口过滤）
- **文件监听（rev173.59）**：外部程序改库里的 `.md` 现在会刷新（Rust `notify` watcher → `zn://fs-change`）；
  监听不可用时（移动端 / 系统 watcher 起不来）保留 3 秒轮询兜底，不再「订阅成功就把兜底关掉」

## [0.2] - 2026-10-17（文档）/ 2026-10-18（rev118 落到代码）

> **2026-10-18（rev118）**：`API_VERSION` 由 `0.1.0` 升为 `0.2.0`；所有
> `examples/*/manifest.json` 的 `apiVersion` 同步改 `^0.2.0`。加载校验只看 major
> （`assertApiVersion`），0.1 / 0.2 互通，现装插件不受影响。
> 同轮落地：`NoteMeta.id`（独立笔记 ID，存 `<库>/.zn/ids.json`）+ `rename` 时 ID 跟随
> 与全库 `[[链接]]` / `](相对路径)` 重写。

### Added
- capability：`editor:line-action`（rev54）· `editor:line-class`（rev78）· `editor:fold`（rev80）
- `host.assetUrlAbs`（rev75）· `host.pickFile` / `host.readContentUri`（rev85）
- `editor.addLineClass` / `addFold` / `toggleFold` / `foldAt` / `restoreFolds` / `lineAtElement`（rev78/80/81）
- 插件来源：`global` / `vault` / `builtin`（rev94 / rev110）

### Changed
- 内核事件总线**真正派发**（rev173.40）：`note:saved` / `note:created` / `note:renamed` /
  `note:deleted` / `note:changed` / `index:rebuilt` / `app:ready` / `vault:open`；payload 表见契约 §1.4
- `saveFile` 接受 `Uint8Array`（二进制导出）
- capability 语义改为**自述**（非门）—— rev48 拆门、rev66 清遗留
- 「插件只住库内」的旧描述被三种来源取代

### Removed
- `.zn/permissions.json` 与 Rust 的 `read_permissions` / `set_permission`（rev66）
- `scopedFs` / `scopedDoc` 的 capability 裁剪（rev48）

### Fixed
- 契约与 `contract.ts` 的 10 处不一致（capability / host / editor / 六种挂载位 / 阶段表 / 未决项状态 / 插件来源）

## [0.1] - 2026-10-11
- 首版：10 原语 · 21 种 UINode · manifest / 懒激活 / 四种入口形态 · 接管协议 · 无沙箱声明
