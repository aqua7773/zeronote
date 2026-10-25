# 项目交接

revision: 173.141
更新时间: 2026-10-25 · 最新 rev173.141
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
