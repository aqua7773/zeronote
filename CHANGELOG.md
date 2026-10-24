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

- **附件同步：内容级判定 + 指纹缓存；同步计入耗时**（rev173.117，同步二期的小项收尾）：
  - **本地已有同一路径的附件、但远端换过内容 ⇒ 现在会同步**：以前只判「本地有没有这个文件名」
    （`localPaths.has(path)`），远端把同一路径的图换掉时两端会长期不一致。改为比 manifest 的 `fp`
    （新纯函数 `needsAttachmentPull`，四条判据：本地没有 / 一致 / 换过 / 中转已清理）。
  - **附件下载带 `If-None-Match`**：`client.getBytes(rel, ifNoneMatch)` 现在返回
    `{ data, notModified, etag }`，远端没变就 304、不再传字节。命中场景是「本地被改坏 / 换过、
    远端没动」—— 此时不覆盖用户本地文件；只有拿不到可用字节时才补一次完整下载。
  - **本地附件指纹缓存**：`listNotes` 的 `mtime` + `size` 未变就复用上次的指纹，不再每 5 秒
    把所有图片重读一遍 + 重算散列；同一轮里「算指纹」与「上传」也只读一次盘。
  - **耗时统计**：每次同步记 `{ manifest, notes, attachments, total }`，面板「上次同步」下方多一行
    `用时 1.2 秒 · manifest 0.1 秒 · 笔记 0.9 秒 · 附件 0.2 秒`（失败也记，能看出卡在哪个阶段）。
    `sync-folder` 的「上次检查」同样带上「（用时 …）」。
  - 单测 833 → **841**（sync-webdav +6：`getBytes` 的 304 / 404 / 200、`needsAttachmentPull` 四判据、
    `fmtMs` 边界、以及「两轮同步第二轮一次都不再读盘」的集成断言；sync-folder +2：
    扫描后面板带用时、没扫过时的引导态）。
  - 实测（真实 HTTP 打本地 DAV 服务器）：首传 ✅ · 没变化不重传（PUT 次数不变）✅ ·
    **本地换掉同名附件 ⇒ 远端跟着更新** ✅ · 本地删掉 ⇒ 从远端下载回来 ✅ ·
    `getBytes` 带 ETag 回 304 ✅ · 面板耗时 `用时 11 毫秒 · manifest 4 毫秒 · 笔记 0 毫秒 · 附件 7 毫秒`。
    真实坚果云自动同步的面板读数：`用时 466 毫秒 · manifest 334 毫秒 · 笔记 123 毫秒`。
  - 插件版本 `sync-webdav` 0.2.0 → **0.2.1**。

- **`sync-folder` 也接三方合并 + 两个后端各存一份 base**（rev173.116）：
  - `sync-folder` 0.2.0 冲突时（本机 pending + 磁盘被外部改了）先试合并：
    `base` = history 同步点 · `mine` = **影子副本**（`.zn/sync/last/`）· `theirs` = 磁盘外部版。
    合上 ⇒ 写盘 + 基线对齐合并结果 + 清 pending/影子副本；合不上仍留副本。
  - **自己写盘的抑制表**（`selfWrites`）：合并结果落盘会触发内核 `note:saved`，不挡住会被当成
    「本机又改了一次」⇒ 留下永远清不掉的 pending（之后任何外部改动都会被误判成冲突）。
  - **同步点按后端分开**（`base.<后端>.sync.md`）：`sync:webdav` / `sync:folder` 各写各的 ——
    两个同步插件同时启用时不会互相覆盖（它们对「两端一致」的时刻判断不同）。
  - 单测 825 → **833**（sync-folder +6：合上 / 真冲突 / 无 base 降级 / 判据 3 条；history +2：
    后端路径隔离、tag 落到各自文件）。
  - 实测（dev 真环境，`_tmp-vault-tb`）：本机 pending + 外部改第一行 ⇒ 磁盘自动变成
    「外部改的第一行 + 第二行 + 本机补的」，冲突记录不增、影子副本被清；两边改同一行 ⇒
    退回留副本（`.zn/conflicts/windows/…` = 本机版）。`base.webdav.sync.md` /
    `base.folder.sync.md` 各 30 篇并存。

- **双端改同一篇 ⇒ 三方合并**（rev173.115，同步插件二期第一件）：以前「双端修改」只能留两份
  （副本 + 取远端版），现在能用 `base`（共同祖先）把两边**不重叠的改动自动合掉**。
  - `history` 0.2.0：新增**同步点** `<库>/.zn/history/<hash32>/base.sync.md`（固定名、覆盖写、
    不进历史列表）；经 `service` 暴露 `{ snapshot(path, content, {tag:'sync'}), findBase(path) }`。
  - 内核新增**内置服务** `kernel.merge`（`services.scoped('kernel')`）⇒ 插件借到
    `mergeLines`（`src/lib/merge3.ts` 的唯一实现）。插件不能 import `src/lib`，这样语义不会漂。
  - `sync-webdav` 0.2.0：每次成功推 / 拉 / noop 后打同步点；判定 `conflict` 时先试
    `tryAutoMerge` —— **只有完全合上（0 处真冲突）才自动合**，写盘 + 推回远端；有真冲突仍走
    「本机版留副本 + 取远端版」。新纯函数 `tryAutoMerge` 单测 6 条（合上 / 真冲突 / 缺 base /
    缺合并实现 / 单边改 / 合并抛错）。
  - 实测（本地 WebDAV 测试服务器，三段内容）：本机改标题 + 远端改第三行 ⇒ **自动合上，两端都是
    合并结果，冲突记录不增加、同步点被刷新**；两边改同一行 ⇒ 退回留副本（副本 = 本机版）。
  - ⚠️ 边界：**两边都在文件末尾追加**会被行级 diff 判成同一处冲突（第二个改动落进同一段空行区间）
    ⇒ 走留副本。这是 `merge3` 的行级语义，不是回归。
  - `sync-folder` 的三方合并在 rev173.116 补齐；`history` 的触发仍按需求 §11
    「关闭 / 切换时存」，没有改成方案里的「保存后 5 秒防抖」—— 合并只需要同步点，不需要更细的历史粒度。

- **附件同步（三种模式）**（rev173.109，用户 2026-10-24 要求「加一个选项」）：
  `不同步（默认）` / **`同步中转`** / `与文档一样永久同步`。
  · **中转**：附件按指纹传到 `_zn/relay/<fp>.<ext>`，对端下载后写 `_zn/relay-ack/<fp>`，
    任何一端看到 ack 就删云端副本、manifest 标 `cleaned: true`（条目保留，别的设备看到就知道
    "曾经有、别等了"）—— **云端只有传输期那一份**，省空间；代价是第三台设备事后取不到。
  · **永久**：和 `.md` 一样 PUT 到原路径。切模式时会重新上传（`cleaned` 的不跳过）。
  实测（本地 WebDAV 服务器）：中转上传 11431 字节 → 模拟对端 ack → 云端副本消失、manifest
  标 cleaned → 切永久模式 → 附件回到原路径。
- **`sync-webdav` 进内置预装**（10 → 11，用户拍板）。
- **同步插件 `sync-webdav`**（rev173.108）：直连用户自己的 WebDAV（坚果云 / Nextcloud / 群晖），
  **不依赖第三方同步工具**。远端 `<根>/_zn/manifest.json` 是权威索引（每篇 fp + etag）；
  一次同步 = 拉 manifest → 逐篇判 push / pull / conflict → 回写 manifest。
  `PUT` 带 `If-Match`（**412 = 乐观锁失败**，按冲突处理）。冲突副本落
  `.zn/conflicts/<平台>/`，本地版先留档、再取远端版。
  **前台每 5 秒自动同步**（`visibilitychange` 切回前台立刻补一次；后台挂起是已知边界）。
  凭据走 `host.secrets`（系统钥匙串），地址与账号落 `store`；面板可保存 / 测试 / 双向同步 / 断开。
  单测 40 条；实测（本地 WebDAV 测试服务器）：连接测试自动建目录 · 首同步上传 4 篇 ·
  远端改 ⇒ 9 秒内自动下载 · 本地改 ⇒ 9 秒内自动上传 · 双端改 ⇒ 冲突副本 = 本机版、本地 = 对端版。
- **同步插件 `sync-folder`**（rev173.107）：库放在用户自己的同步目录（Syncthing / OneDrive /
  坚果云客户端）里时，**不搬文件**，只做同步工具不做的那三件事 —— 发现外部改动、判定
  「双端都改」、冲突留副本到 `.zn/conflicts/<平台>/`。判定模型用 `baseline` + `pending`
  两份状态 + 20 秒静默期（本机保存后一段时间内没有外部改动才认为已同步）；本机版本另存影子
  副本在 `.zn/sync/last/`，冲突时把它复制出去，**两边都不丢**。主区面板显示基线 / 待同步 /
  冲突数与最近冲突列表。单测 28 条；实测：本机存 v2 → 外部覆盖 v3 ⇒
  `.zn/conflicts/windows/2026-10-24 2037-sync-e2e.md` 内容 = v2、磁盘 = v3、toast 提示。
  **已加入内置预装**（9 → 10，用户 2026-10-24 拍板）。

### Fixed

- **`test()` 的「404 自动建目录」会多建一层**（rev173.118）：`mkdirPath(root)` 传的是「相对同步根」
  的路径，而 `request()` 又经 `urlFor()` 再拼一次 `root` ⇒ 实际 MKCOL `<根>/<root>/<root>`。
  连接测试在「同步目录第一次不存在」时会顺手在远端建出一个空的 `ZeroNote/ZeroNote` 子目录
  （rev173.117 实测发现）。新增 `mkdirRoot()`（用不含 root 的 URL 逐级 MKCOL），
  单测 +3（单层 / 多级 `a/b` / 405 已存在）。实测（本地 DAV 桩）请求序列：
  `PROPFIND /dav/ZeroNote` → **`MKCOL /dav/ZeroNote`** → `PROPFIND /dav/ZeroNote`。
  `sync-webdav` 0.2.1 → **0.2.2**。

- **写 `.zn/` 下的 `.md` 不再发 `note:saved`、也不进搜索索引**（rev173.107）：历史快照与同步
  影子副本都是 `.md`，此前会被当成"用户保存了笔记"—— 同步插件立刻踩到：每写一份影子副本又
  触发一次保存，几秒内 1900 多次 `writeText`（自我递归），索引里还会多出幽灵版本。
  `fs-events.ts` 的 `isNotePath` 现在排掉 `.zn/` 与越界路径，单测 1 条覆盖。
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
