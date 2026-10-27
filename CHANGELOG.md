# Changelog

> 状态：**active** ｜最后核对：2026-10-26（0.6.0）｜权威范围：契约 / 协议层的变化（功能细节见 `HANDOFF.md`）

## 应用版本（app version · rev173.37 起）

> 单一来源 = `package.json`；发版用 `node scripts/release.mjs <x.y.z>` 同步
> `tauri.conf.json` / `Cargo.toml`，前端「关于」页经 vite 注入 `__APP_VERSION__`。
> 与下面的**契约版本**（插件 API）是两套号，别混。

| 版本 | 日期 | 内容 |
|---|---|---|
| 0.6.0 | 2026-10-26 | **安全 / 密码库**：新插件 `security`（双密钥环 · XChaCha20-Poly1305 + Argon2id · AAD 绑定）与 `secrets`（整库加密 · 生成器 · 60 s 清剪贴板 · 空闲自锁）· **Android 指纹 + Windows Hello 解锁** · 锁定后自动弹 · 生物识别按设备 · `input.secret` 密码框 · 同步放行 `.zn/secrets/` · **插件市场闭环**：签名 v2 / 应用内「发现」/ 公钥内置 / 仓库开源 MIT / 包走 raw · CI 修绿 |
| 0.5.0 | 2026-10-25 | **同步四个后端全部真机落地**（本地文件夹 / WebDAV / S3 / Git · 附件三模式 · 三方合并）· 条件写与冲突自愈 · **反向链接全库持久索引** · `note:saved` / `note:created` 带正文 · `net` 空 body 请求头修复 |
| 0.4.0 | 2026-10-24 | A 档 4 个插件（标签 / 反向链接 / 历史版本 / 打卡）· 面板体系（阅读器 / 导图 / 文档多标签）· 白屏兜底 · 插件真签名与能力审计 · 手机原生剪贴板与长按四键 · 记账收尾 |
| 0.3.0 | 2026-10-20 | 多标签页 + 标签拆独立窗口 · 会话恢复（hot exit）· 主窗口位置记忆 · 粘贴图片 · 搜索筛选 · 全局替换 · 桌面时间流面板 · Markdown 语法增强（脚注 / Mermaid / 定义列表 / HTML 白名单）· 记账 v0.2 |
| 0.2.0 | 2026-10-19 | 第一个正式版本：内核 10 原语 + 插件体系（5 个预装）· 桌面 / Android · 桌面时间流面板 · 全局自绘滚动条 · Markdown 语法增强（上标 / 下标 / Emoji / KaTeX 数学） |

## [Unreleased]

### Changed

- **导入落点统一到「日期导入/<日期>/[原分类/]」（rev173.227 · 需求 §12）**：`import-export` 此前把导入的笔记
  直接写进**库根**（撞名才加 `-1`），和手写笔记混在一起、也分不清哪天导入。现在固定写
  `日期导入/<YYYY-MM-DD>/[<原分类>/]<文件名>.md` —— 同一天多次导入合并同一个日期目录；
  分类默认取源文件**直接父目录**（桌面 / 下载 / 缓存不猜），命令 `io.importFile` 支持 `category` 指定。
  导入内容补 frontmatter `created`（导入时刻）+ `source`（原文件名），已有同名键不覆盖。
  ⚠️ AI 插件的任务排除名单同步加了 `日期导入`（需求 §12：导入后不立即让 AI 整理）。
  ⚠️ 市场包 `import-export@0.1.0` 仍是旧行为，下次发市同步。
- **`NoteMeta.kind` 增加 `media`（rev173.226 · 契约扩展）**：音视频附件（mp4 / webm / mov / m4v / ogv ·
  mp3 / m4a / aac / ogg / opus / wav / flac …，以及**播不了**的 mkv / avi / wmv / flv …）现在进
  `list_notes` 与文件树（前端归「附件」分组；`title` = 去掉扩展名的文件名，`frontmatter` 恒 `null`）。
  正文 `![](clip.mp4)` 由内核渲染成 `<video controls>` / `<audio controls>`（asset 协议；CSP 新增 `media-src`）。
  ⚠️ **能不能播是 WebView 的能力**：MKV / AVI 等容器 Chromium 不识别 ⇒ 插入时只写普通链接并提示
  「请先转成 MP4」。插件侧兼容：`kind` 本来就是多值字段，未处理 `media` 的插件会把它当未知类型 ——
  行为等同以前的「不入列」，不会崩。**只有 `note` 进索引、只走 `openNote`** 的规则不变。
- **预装范围成文，移出 5 个「增强」插件**（rev173.179 · 新增 `docs/decisions/D-010-预装范围.md`）：
  规则此前**只在会话里**（安全插件开发期），没落文档 ⇒ 加备份插件时被重新问一遍。现在成文：
  **核心体验预装**（标签 / 反链 / 历史 / 导入导出 / 同步 ×4 / 备份）· **「增强」逐步移市场**
  （大纲导图 / 文档阅读器 / 记账 / 米色主题 / 打卡）· **安全 / 密码库只走市场**（涉及隐私，
  要用户知情选择；预装加密插件会暗示「笔记默认不加密」）。`builtin-plugins.ts` 移出 5 条，
  **预装 14 → 9**；五个市场包都在，已装环境不受影响（`ensureBuiltinPlugins` 只是不再写内置版）。

### Fixed

- **插件安装不再清掉 `store.json`**（rev173.190）：安装是整目录交换（rev173.143），旧目录整个删掉 ——
  而 `store.json` 是插件的**用户数据**（自动备份档位 / 打卡计数 / 主题选择），不是代码。
  rev173.189 实测：`backup` 从市场装 0.3.1 之后，自动备份档位从「每周」回到默认「每天」。
  现在交换成功、删旧目录**之前**把旧 `store.json` 搬进新目录；**包内自带同名文件时以包为准**
  （上游刻意给的初始值）；拷贝失败只记日志、不中断安装（store 丢 = 设置回默认，
  中断安装 = 插件没了，后者更重）。cargo 53 → **55**。

### Added

- **`[[笔记名]]` 悬浮预览**（rev173.228 · 需求 §4.5「引用显示标题和摘要」）：桌面悬停 350 ms、
  手机长按 450 ms，在链接下方弹小卡片 —— 标题 + 正文前 ~140 字（剥掉 frontmatter / 代码块 /
  图片 / 链接标记）；找不到时显示「没有找到这篇笔记」。查找与点击跳转**共用** `findWikiNote`
  （ID → 相对路径 → 路径后缀 → 标题），两处不会漂移。摘要每次悬停现查（5 秒内缓存），
  被引用笔记改了内容不用重启就更新。手机长按后松手**不跳走**（吞掉紧随的那次 click）。

- **市场镜像可切换 + 测速**（rev173.194）：市场页顶部多一个镜像下拉（GitHub raw / jsDelivr · GCore /
  jsDelivr · Cloudflare / jsDelivr(cdn) / ghproxy.net / 自定义地址），**索引地址与包地址前缀成对切换** ——
  只换索引不换包前缀会「能看不能装」。新增「测速」：依次拉各镜像的索引，**必须解析出条目才算可用**
  （只看 200 会被错误页骗：实测 `ghps.cc` 返回 200 但只有 508 字节）；结果逐条显示 `ms + 条数`。
  `installFromMarket` 改走当前镜像的包前缀；**外部作者 / 自建源 / Release 地址一律不改写**
  （只有 `raw.githubusercontent.com/aqua7773/zeronote/…` 形态才换）。实测（桌面）：raw 279 ms ·
  GCore 722 ms · Cloudflare 648 ms · ghproxy 1413 ms 全部 16 条；`cdn.jsdelivr.net` 在桌面也
  `os error 10054`（与手机一致）。vitest 1147 → **1170**（+23）。

- **备份插件 v1**（rev173.175 · 需求 §14.1 / 阶段 3 的遗留项 —— ROADMAP 里此前**没有这一项**）：
  新增 `examples/backup/` 与内核命令 `fs.purgeBackup`（契约 §1 第 **35** 条）。把整个库快照到
  `<库>/.zn/backups/<YYYY-MM-DDTHH-mm-ss>/`（跟库走，拷库就带着）：公开笔记与附件**明文**、
  密码库**原密文随包**（`_secret/secrets.zn` + `_secret/vault.json`）——「加密复用主密码」在实现上
  就是**原样拷密文**，所以锁着 / 未解锁也能备份；`_meta.json` 记规模。
  清单 `index.json` 是列表的唯一来源，因为 `fs.listDirs()` 会跳过 `.` 开头的目录（列不出 `.zn/backups/*`）。
  保留最近 **30** 份（`pickStale` 纯函数，边界用 `>` 不用 `>=`）。面板：立即备份 / 刷新 / 单份删除。
  **实测**（`_tmp-vault-tb`）：37 篇 + 6 个文件夹 ⇒ 备份 40 个文件 = 源 37 + `_meta.json` + 两份密文，
  逐项核对一致；删除后目录消失、清单清空。vitest 1067 → **1086**；cargo 52 → **53**。
  **待做**：恢复（整体覆盖 + 恢复前自动快照，快照不占 30 份）· 是否内置预装。

- **备份 v2：自动备份档位**（rev173.176 · 需求 §14.1）：九个档位，默认**每天**；配置存
  `store` 的 `backup:config = { interval, lastAt }`。**60 秒轮询 + 启动补做**而不是按档位设长定时器 ——
  页面关掉定时器就没了（无后台服务、契约无定时原语），关机一夜后重开要立刻补一份而不是再等一天。
  空库跳过；手动备份也刷新 `lastAt`（否则点完「立即备份」60 秒后自动又来一份）。
  面板加档位 `select` 与「上次 / 下次」一行。实测：reload 自动补一份 `20:20:51 auto 389 ms`，
  **再 reload 仍是 3 份**（证明持久化生效）；改 `1h` 后「下次 21:20」。vitest 1086 → **1094**。

- **备份 v3：恢复**（rev173.177 · 需求 §14.2）：`backup.restore`，两步确认（第一次点上膛、按钮变红，
  第二次同一份才执行）。顺序「先保命再动刀」：① 当前库存 `pre-restore-<时间>` 快照
  （**不占 30 份限额**，`pickStale` 见前缀就跳过）② 当前内容**移进回收站**（可撤销，不物理删）
  ③ 从备份拷回顶层 + 子目录 ④ 密码库密文写回原位。`_meta.json` 新增 **`dirNames`**
  （`listDirs()` 列不出 `.zn/backups/*` 的子目录，恢复只能靠它）；旧备份没有该字段 ⇒ **拒绝恢复并说明**。
  **实测抓到真 bug**：`fs.listFiles(dir)` 返回库内相对路径而非裸文件名，第一版把路径拼了两遍
  ⇒ 恢复后库是空的 + 报「源不存在」；改取 basename 后重跑 ⇒ 38 个文件全回来、目录逐项一致、
  密码库原样。vitest 1094 → **1099**。

- **私密文件夹（期 1）+ 内核 `doc.registerCodec`**（rev173.180 · 需求 §3.3 私密内容 / §10.1 加密同步）：
  此前编辑器只有「readText → 明文 → writeText」一条链路，密文落盘的内容用不了编辑器（只能自绘
  降级编辑器，或把明文临时写到磁盘上）。新增**内容转换器**原语 —— `doc.registerCodec({ id, match,
  decode, encode, transient })`：读盘后解密、写盘前加密；**内核不认识加密**，只认识「这个路径的内容
  要过一次转换」；合并 / 脏标记 / 自动保存 / `doc.on` 全部仍在**明文层**跑。安全语义三条：
  ① 打开时用过某个 codec ⇒ 保存必须还用它，它被卸载 ⇒ 读写都**抛错**（绝不退回"原样写盘"，否则
  正在编辑的私密笔记会明文落盘）；② `transient` ⇒ 不写会话恢复草稿（草稿是 localStorage 明文）；
  ③ `match` 抛错按"不匹配"处理。插件 `examples/private-notes/`：整棵树在 `.zn/private/`
  （内核的 `list_notes` / `list_dirs` 天然跳过 `.` 开头 ⇒ 不进文件树 / 全局搜索 / 回收站），
  **每篇一密文 + 加密索引**（文件名是随机 id，磁盘上不泄漏标题）；用 `security` 的 `notes` 环
  （3 分钟空闲锁）；面板 = 独立入口与独立验证。**实测**（`_tmp-vault-tb` · 真 Argon2）：建 notes 环
  → 解锁 → 新建 → 写入 → 保存 ⇒ 磁盘 `zn1.<nonce>.<ct>`（含中文 / `#` 均为 False）· 关文档回列表
  显示标题（索引解密 + `doc.on('save')` 回填）· 重新打开正文正确 · **锁定后** `core.openNote` 直接
  打开被拒（显示「已锁定 —— 先在面板里解锁」，编辑器不打开、密文不喂进去）。vitest 1099 → **1120**
  （doc-codec 9 条 + private-notes 12 条）。**未做**：期 2（独立搜索 / 回收站 / 移入移出）·
  期 3（`vault.json` 按环拆 + 四后端同步 `.zn/private/`）—— 见方案 §5。

- **私密文件夹 期 2：独立搜索 / 回收站 / 移入移出**（rev173.181 · 需求 §3.3 后四条）：
  ① **搜索** —— 面板内搜索框，标题与正文一起搜，多关键词 **AND**（与内核 `index.query`
  同一套语义）。数据源是**解锁期内存里解密后的正文**（懒加载：第一次搜索才逐篇解密，
  锁定即清空；不落盘任何明文索引）。命中处前后各取一段做片段，**标题命中优先**。
  ② **回收站** —— `.zn/private/trash/`，与全局回收站完全分开（需求「独立回收站，进入也需验证」，
  验证继承主面板解锁态）。删除 = `fs.move` 把密文搬过去（**不解密也能删**）；恢复 = 搬回 +
  索引挪回（原始 createdAt/updatedAt 一起存，恢复后排序不跳）；彻底删除**两步确认**
  （第一次点上膛、按钮变「真的删？」，与备份恢复同一套）+ 清空回收站。
  ③ **移入 / 移出** —— 「把当前笔记移入私密」：密文写成功后才动原文件，且**原文件立刻真删**
  （`fs.delete` 进全局回收站后按 `originalPath` 找到再 `purgeTrash`）—— 否则明文会留在
  `.zn/trash/` 里，等于没加密。「把一篇移出为公开笔记」：解密写 `<标题>.md`（清洗 Windows
  非法字符、**不能以 `.` 开头**（会被当隐藏文件跳过）、重名加 `-2`），明文落盘后立刻删密文。
  ⚠️ **单测抓到一个真 bug**：`upsertNote` / `removeNote` 返回时不带 `trash` 段 —— 而
  `upsertNote` 在 `onDocSaved` 里每保存一次就跑一次 ⇒ **保存任意一篇就会把回收站从索引里抹掉**
  （磁盘上的 `trash/*.zn` 变成没人认领的孤儿）。已修 + 加反向用例。
  **实测**（`_tmp-vault-tb` · 真 Argon2）：两篇笔记 → 搜「开会」命中正文（片段正确）·
  搜「今天 面包」0 篇（跨篇 AND 不成立）· 搜「清单」标题命中 · 删除 ⇒ 磁盘 notes→trash、
  面板只列回收站条目 · 恢复 ⇒ 两文件回 notes · 再删 + 两次 `purge` ⇒ 第一次按钮变
  「真的删？」且文件还在、第二次文件消失 · **移入** ⇒ 库根文件消失、私密多一篇、**全局回收站
  无残留** · **移出** ⇒ 库根出现「要移入的笔记.md」且内容是明文。vitest 1120 → **1140**。

- **私密文件夹 期 3：vault 按环拆 + 四后端同步 + 备份**（rev173.182 · 需求 §10.1）：
  ① **`vault.json` 按环拆**（本期最要紧的一处）：以前两个密钥环的 KDF 参数与包裹的 DEK 都在
  同一个文件里，而它是**整文件同步**的 —— 两台设备各改一个环的密码（只重包裹 DEK）时，两边都
  改了同一个文件 ⇒ 同步判冲突 ⇒ 取远端 ⇒ **另一边的重包裹丢了，那台设备再也解不开自己的数据**。
  现在每个环一个 `vault.<环>.json`（各自一个同步单元，改动互不可见）。旧单文件读到就迁移
  （内存里拼回两个环 → 写两个新文件 → 删旧文件），旧库一次性无痛迁移。⚠️ **旧客户端
  （`security` ≤ 0.1.2）只认 `vault.json`**，迁移后会以为"没建环" ⇒ 共用同一份 vault 的设备
  要把 `security` 升到 **0.2.0**。
  ② **四个同步后端都搬私密树**：`.zn/private/` 的 `index.zn` + `notes/*.zn` + `trash/*.zn`
  逐个文件走同一套方向判定（webdav / s3 / git 各加 `syncPrivateTree`，sync-folder 放行
  `.zn/private`）。方向判定抽成纯函数 **`decideTreeAction`**（11 种组合，单测覆盖），
  **删除两边都传播** —— 私密笔记在面板里删除是真删除，不传播的话同步一轮就复活。
  Git 那套额外要 sha（GitHub Contents API），所以 `privateTree` 条目带 `sha`。
  ③ **备份包含私密树**：`_private/` 整棵密文随包（与 `_secret/` 同规格），恢复时原样写回。
  ⚠️ 单测抓到一个口径问题：memory fs 对不存在的路径返回空串，若把空串当"本地有"会**白推一次
  空文件**（`空笔记也能同步` 用例抓到）⇒ 私密树读盘统一按 `raw && raw.trim()` 判"有"。
  vitest 1140 → **1146**（security vault 4 + webdav 私密树 2）。

## [0.6.0] - 2026-10-26（rev173.137 – rev173.174）

> 0.5.0（2026-10-25）之后的 **57 个提交**。两条主线：
> **① 安全 / 密码库**（rev173.159–173）—— 新插件 `security`（双密钥环 · XChaCha20-Poly1305 · Argon2id）
> 与 `secrets`（整库加密的密码库），外加两平台生物识别解锁（Android 指纹 / Windows Hello）与「锁定后自动弹」；
> **② 插件市场闭环**（rev173.140–158）—— 签名 v2 · 打包 / 索引 / 原子安装 · 应用内「发现」tab · 公钥内置 ·
> 仓库开源（MIT）· 包入库走 raw 分发 · 第二批 UX（详情页 / 更新角标 / 启动 24h 检查）。
> 另有 CI 从「一直是红的」修到全绿、HANDOFF 分卷（890 KB → 63 KB）与发版收口。
>
> ⚠️ 两个新插件**不预装**，从插件市场装（索引 15 条）：`security` 当前 **0.1.2**、`secrets` **0.1.0**。
> `secrets` 对 `security` 是**软依赖** —— 拿不到 `crypto` 服务时降级提示「先去市场装安全插件」，不崩不阻塞。
> ⚠️ 共用同一把密钥库的设备都要把 `security` 升到 **≥ 0.1.2**（0.1.2 迁移删掉了旧单段 `biometric`，
> ≤ 0.1.1 读新结构会静默认为「没绑定」）。

### Added

- **安全插件 `security` v0.1 · 双密钥环**（rev173.160 · 需求 §13）：新增 `examples/security/`（单文件，
  纯函数全部命名导出）。`notes` / `secrets` 两个环**各一把主密码、各一个 salt、各一把 DEK，互不派生**
  （用户拍板：账户密码要「绝对安全」）。加密 = **XChaCha20-Poly1305**、KDF = **Argon2id**
  （noble 库**本地副本** `public/vendor/noble/`，13 文件 202 KB，`scripts/vendor-noble.mjs` 按 import 图精确复制
  —— 插件宿主的 ESM 相对 import 不可用，核心内联进 `index.js`）。**AAD 绑定** `环|容器|用途`：
  跨环 / 跨容器 / 跨用途的密文一律解不开（有反向测试）。**不存 password verifier** —— 解锁 = 解包裹，
  AEAD 认证通过即密码对；换密码与恢复**只重包裹 DEK**，数据密文一个字节不动。`vault.json` 损坏 ⇒
  拒写不覆盖。对外 `service.provide('crypto')` **只给操作、不给密钥**。单测 25 条。
- **密码库插件 `secrets` · 整库加密**（rev173.163）：新增 `examples/secrets/`（约 1300 行），消费 `security`
  的 `crypto` 服务。**整库单文件密文** `.zn/secrets/secrets.zn`（`zn1.<nonce>.<ct>`，AAD `secrets|secrets`）。
  平台 / 账号两级（空平台也显示）· 搜索只搜平台 / 账号 / 备注（**不搜密码**，反向验证过）· 生成的密码
  **16 位**（大小写 + 数字，排除 `0/O/1/l/I`，三类各保证一个，Fisher–Yates 洗牌）· 显示密码
  **15 秒自动收起** · 复制密码 **60 秒清剪贴板**（只在内容仍是它时才清）· 回收站软删 **7 天**
  （剩 N 天 + 恢复 / 彻底删除）· **空闲 60 秒自动锁**（时间戳判定，不依赖定时器 —— Android 后台冻结
  也补得住）。vitest 1002 → **1029**；CDP 实测 12 项全过；实测抓到两个真 bug（列表项包装塞进
  `stack.children` ⇒ 整段 JSON 摊在界面上 / 过滤掉无账号平台 ⇒ 新建平台后列表空）。
- **Android 指纹解锁**（rev173.168）：`tauri-plugin-biometric 2.5.0`（**仅 android target**）+
  `#[cfg(target_os = "android")]` 注册 + capability `android-biometric.json`；`security` 面板加「绑定 /
  指纹解锁 / 解除」三入口。主密码那份 `wrapped` 不动，换密码与恢复重设都保留生物识别段。真机走通
  「主密码解锁 → 绑定 → 空闲自动锁 → 指纹解锁」。同轮修掉 **debug 包被看门狗 5 秒误杀**（Android 进程
  拿不到 `ZN_WATCHDOG=off` ⇒ 改 debug 默认不启动）。vitest 1046 → **1056**。
- **Windows Hello 解锁**（rev173.169）：新增 `hello_available` / `hello_enroll` / `hello_sign` 三个内核命令。
  `windows` crate 0.62 **没有带窗口的接口**，而 `RequestSignAsync` 无 HWND 会**挂死**（rev173.167 实测
  90 秒无返回）⇒ 手写 `IKeyCredentialManagerCreateWithWindowStatics` / `IKeyCredentialWithWindow` 的
  vtable（IID 从系统 `Windows.Security.winmd` 解析）。包裹格式 `hello1.<challenge>.<zn1…>`：签名
  （PKCS#1 v1.5，确定性）→ HKDF → KEK → XChaCha 包 DEK。桌面实测「探测 → 绑定 → 锁定 → Hello 解锁」。
- **锁定后自动弹生物识别**（rev173.171）：`security` 在 `lockRing` 之后自动发起一次 Hello / 指纹请求 ——
  以前两平台都只能手动点「用指纹解锁」。判据抽成纯函数 `planAutoUnlock` / `shouldWaitForFocus`：
  **桌面窗口失焦时挂起**（Hello 弹在受保护的系统 UI 上，实测合成键鼠 / `Esc` / UIA 都触达不到，弹出来
  等于挡住用户正在做的事），等用户点回窗口的 `focus` 再弹；手机只看可见性（WebView 没有真实键焦点、
  切后台时 CPU 冻结，回到前台补弹）。`reason: 'service'` / 已解锁 / 正在派生密钥 / 用户已在输主密码
  都不弹；自动弹被取消只给中性提示（面板本来就有「用指纹解锁」+ 主密码框兜底）。锁定时清主密码输入框。
  市场同步发 `security` **0.1.1**（rev173.172）。vitest 1059 → **1064**。
- **生物识别绑定改成「按设备」**（rev173.173）：`vault.json` 的 `rings.<id>.biometrics[<deviceId>]`
  —— 同一把密钥环在多台设备各绑各的，**换机只失效那一台**。本机 id 存在**凭据管理器**
  （`host.secrets` → Windows 凭据管理器 / Android Keystore；不随库同步、不进 `vault.json`）。
  旧的单段 `biometric` 在加载时一次性迁到 `biometrics[<本机>]`（原机升级后照常用指纹；真换机过来的
  vault 会 AEAD 失败并提示重绑，且**不再覆盖**原机器的绑定）。面板：本机已绑 → 「本机已绑定」；
  只有别的设备绑过 → 「别的 N 台已绑定」且**不显示**指纹按钮（旧版会显示、点了才报 AEAD）。
  vitest 1064 → **1067**；`security` **0.1.2** 发市场。
- **`input` 节点支持密码框**（rev173.163）：声明 `{ type: 'input', secret: true }` 时宿主渲染成
  `type="password"`（+ `autoComplete="off"`），回显为圆点。在此之前 `input` 硬编码 `type="text"`，
  密码只能明文摊在屏幕上（违背需求 §8.6「密码默认隐藏」）。**UINode 仍是 21 种**：只加可选字段，
  老插件一个都不用改；`state[bind]` 里仍是明文（遮的是显示，不是内存）。
- **同步放行密码库（`.zn/secrets/`）**（rev173.164）：三个网络后端（`sync-webdav` / `sync-s3` / `sync-git`）
  各加一个**私有文件**同步阶段，按固定清单搬 `.zn/secrets/secrets.zn`（整库密文）与
  `.zn/security/vault.json`（KDF salt + 被主密码包裹的 DEK）—— **后者少了另一台拿到密文也解不开**。
  远端 manifest 新增 `private` 段（`304` 短路径照走）。方向靠 baseline 判断；**双端都变 ⇒ 留副本不合并**
  （密文拼不起来），本机版进 `.zn/conflicts/<平台>/`、本地取远端版；任何一步失败只写 hint，不拖累笔记同步。
  `sync-folder` 不搬文件，改成**放行规则 + 密码库冲突单独报警**（`.stignore`：`.zn/*` 后加
  `!.zn/secrets` `!.zn/security`）。新增 15 条单测。⚠️ 已知局限：`vault.json` 目前整文件同步，
  做私密文件夹时要按环拆。
- **插件市场阶段 1：应用内「发现」tab**（rev173.148 · 能装、能升、装不坏）：插件管理页的第二个 tab，
  列表来自 `market/index.json`（静态 JSON，不需要服务端）。装一条 = 下载 → **整包 sha256** → 解包，
  三个动作在 Rust 的 `install_znp_from_url` 里**一次完成** ——「校验的字节」就是「落盘的字节」，
  任一步失败**不落盘**。索引地址可改（默认本仓库 raw；private 仓库会明确报「匿名拉不到」而不是
  给一个空市场），记在 localStorage。索引里的坏条目**跳过并列出原因**。**没有静默升级**：启动不检查、
  后台不下载，只有用户点了才动（插件能读任意文件，换代码必须让人看见）。
  新增 `src/kernel/market.ts`（解析 / 状态判定 / 拉取）+ `src/components/MarketPane.tsx`；
  内核命令 33 → **34**。Rust 49 → **52**；vitest 932 → **949**。
- **内置官方签名公钥**（rev173.146 · 契约 §7.4）：`verify_plugin_signature` 的信任根从「只读
  `<应用数据目录>/.zn/trusted-keys.json`」改成 **内置 `BUILTIN_TRUSTED_KEYS`（`aqua-2026`）∪ 用户那份文件**。
  旧行为在新装机器 / 换电脑上必然失败 —— 那个文件不存在 ⇒ 官方插件全部拒载，而预装 13 个里 12 个是
  签名包。合并规则：文件不存在 = 只有内置（**正常状态**）· 同 `keyId` 用户那条**覆盖**内置（轮换 / 撤销）·
  其它追加（外部作者公钥）· 文件存在但读不懂 = **报错不静默跳过**。Rust 测试 43 → **49**。
  新增 `scripts/verify-trust.mjs`：**从 `lib.rs` 解析**内置常量（不另抄一份），与私钥逐字节对账
  + 用内置公钥验「新装机器的宿主能不能加载这些包」。
- **插件市场第二批 UX**（rev173.156 · 详情页 / 更新角标 / 启动 24h 节流检查）：
  ① **详情页** —— 「发现」每条加「详情」（不触发下载）：描述 / 分类平台 / 大小 / 接口版本 /
  **能力自述** / 已装版本 / 下载地址 / sha256 / 包内文件数。能力来自**索引新增字段 `capabilities`**
  （`pack-plugin.mjs` 从 manifest 带出）—— 装之前就知道它要什么；中文说法在
  `src/lib/capability-label.ts`（**未知取值原样露出**，`fs` / `host` / `event` 老写法也译）。
  ② **可更新角标** —— 「已安装」tab 计数旁 `↑ N`（只数真装着的）+ 行内 `↑ 可更新 vX`；装完立刻摘缓存。
  ③ **启动 24 小时节流检查** —— `shouldCheckUpdates` / `computeUpdates` 纯函数 + localStorage
  （`at` + `updates`），延迟 4 秒发、**失败静默且不写 `at`**；设置 → 插件 → 「启动时检查更新」开关（默认开）。
  **只标角标，不下载不安装**（这条不变）。⚠️ 实测抓到：effect 依赖 `rows` 数组引用 ⇒ 4 秒定时器被每次
  重渲染重置、**检查永不发生**（单测看不出来），改成依赖 `rows.length` + `rowsRef` 取值。
  vitest 951 → **977**。

### Changed

- **Argon2id 参数定档 t=3 / m=64 MiB**（rev173.165）：方案原估算「手机 1–4× 慢、t=3 要 2–4 s」——
  真机（Redmi peridot · 0.5.0 dev 包 · Android WebView V8）页面内直跑三档各 3 次取中位数：
  **t=2/19 MiB 165 ms · t=3/64 MiB 812 ms · t=1/128 MiB 574 ms**，手机比桌面 Node 还快约 0.8×
  （桌面 212 / 993 / 682 ms）⇒ **估算推翻，默认档不降**（留的降档条件是「手机 > 5 s」）。
  首次解锁 ≈ **0.93 s**、之后 ≈ **0.81 s**。新增**锁测试**（两个环的 kdf 必须是 `t=3, m=65536, p=1`
  且不能是同一个对象）+ 反向验证（把 m 改成 19456 ⇒ 立刻红）。
- **开源（MIT）+ 插件包入库走 raw 分发**（rev173.149 / rev173.150）：仓库已 public（`gh repo edit
  --visibility public`），补 `LICENSE`（MIT —— `Cargo.toml` 早就声明、缺文件）与 README 顶部免责
  （插件与内核**同权限运行**、内核无沙箱，「装谁的插件」就是全部安全边界；数据自行备份）。
  公开前做了泄漏审计：全量扫 801 个跟踪文件 + **全部历史**，无私钥 / token / `ghp_` 模式。
  **开源当天实测发现的市场致命问题**：`raw.githubusercontent.com` 直连可用（693 ms），但
  `github.com:443`（Release 下载域名）直连**连不上** ⇒ 索引能拉、包下不来 =「能看不能装」。
  处置：15 个包放进 `market/packs/` **入库**，索引 url 改走 raw（索引与包同一域名）。
  `gen-market.mjs` 新增校验：**包必须在 `market/packs/` 且 sha256 与条目一致**；
  `pack-plugin.mjs` 默认输出改 `market/packs/` + raw url。
- **插件页统一：设置里也能进市场**（rev173.152）：设置 → 插件 与 菜单 → 插件管理 **复用同一个
  `PluginPanel`** —— 之前设置页那段只是漏传了市场通道，所以看不到「发现」tab。**修了一个加 tab 后
  暴露的布局问题**：设置 Dialog 里的插件区没有高度约束 ⇒ 市场列表把窗口撑到屏幕外（实测 dialog
  1080 px、列表 1037 px 且不内滚）。给插件区 `h-[min(62vh,520px)]` + 内部 `min-h-0 flex-1` 后
  Dialog 回到正常尺寸、列表在自己区域里滚。vitest 949 → **951**。
- **HANDOFF 分卷 + ROADMAP 收口**（rev173.139）：主文件只留 0.5.0 周期（14 段 / 63 KB），
  275 段按版本切进 `docs/archive/handoff/`（`scripts/handoff-archive.mjs`，可复用 / 幂等 / `--dry-run`）；
  HANDOFF-CARD 从 540 行瘦到 84 行。**副产物**：归档被 check-links 递归扫到，暴露一处伪链接（已修）。
- **文档状态复核 + 发版 0.5.0**（rev173.137）：`docs/README.md` 权威矩阵 4 行 + 4 份文档状态头按代码 /
  提交复核；**`D-002`「不做云同步」仍标 accepted 而同步四后端已真机验收** ⇒ 新增 **`D-009`** 取代
  （自带后端 · 凭据走钥匙串 · 前台近实时 · 三方合并 · 仍不做账号 / 服务端 / E2E），`D-002` 正文加
  ⚠️ 更正块；`D-006` → superseded。

### Fixed

- **CI 一直是红的（2026-10-25 之前每个 run 都 failure）**（rev173.154）：根因是 `localeCompare`
  **不传 locale**（3 处：`src/kernel/index-api.ts` 的 `tags()`、`examples/tag-panel` 的 `sortTags`、
  `examples/backlinks` 的 `matchRefs`）—— 本机 zh-CN 排出「工作 · 会议 · 项目」，GitHub runner 的
  en-US 按 code point 排成「会议 · 工作 · 项目」⇒ `tests/tag-panel.test.ts` 必然红。三处显式传 `'zh'`。
  同轮把 CI 里逐条 gate 改成 `node scripts/check-gates.mjs`（此前 CI **漏了** facts 与 market 两项门）；
  `facts.mjs --check` 修一个 CI 死结（测试基线只存在本机 ⇒ 无基线时忽略该行比较）。
  **rev173.155 首次确认全绿**（15 步 · 4m45s）；**rev173.157 起有 Rust 缓存**（`Swatinem/rust-cache@v2`）：
  命中时整 run **2m33s**、Cargo 步骤 **41s**（未命中 5m17s）。
- **rev173.154 打的两个 0.2.1 包会被拒载**（rev173.156 修）：那次打包漏了 `--key-id`，`pack-plugin.mjs`
  默认把 `signature.json` 的 keyId 写成 **`default`** —— 签名本身完全有效、sha256 也对，但客户端
  `BUILTIN_TRUSTED_KEYS` 只认 `aqua-2026` ⇒ **装得上、加载时拒载**（换台机器才看得见）。
  已用 `--key-id aqua-2026` 重签 `tag-panel` / `backlinks` 0.2.1。`gen-market.mjs` 加第 ⑤ 条门：
  **官方包的 `signature.json.keyId` 必须等于 `aqua-2026`** —— 反向验证：不带 `--key-id` 重打一个包
  ⇒ 门报「keyId 是 default，应为 aqua-2026」，恢复即绿。
  ⚠️ 同一个坑在 **rev173.172** 又踩了一次（`security` 0.1.1 第一次也签成 `default`），已重打。
- **内置插件启动时不再覆盖市场装的版本**（rev173.147 · 插件市场的前置修复）：`ensureBuiltinPlugins`
  以前「内容不同就写」⇒ ① 从市场装的官方插件新版，重启后被内置版（应用编译时的快照）盖回去；
  ② 更糟的是覆盖后目录里残留的 `signature.json` 与新内容对不上 ⇒ 插件从「旧版能跑」变成**拒载**。
  新规则（**先比内容，一致时零额外 invoke**）：目录里有 `signature.json` ⇒ 一个字节都不写（签名渠道
  装的东西归签名渠道管）· 已装 `manifest.version` 比内置新 ⇒ 跳过 · 其余（首装 / 内置更新 /
  同版本内容不同）照旧覆盖。返回对象加 `skipped: [{ pluginId, reason: 'signed' | 'newer' }]`。
  新增 `compareVersions`（数字段按数值比 —— 字符串比较会把 `1.10.0` 判成小于 `1.9.0`）。
  vitest 926 → **932**。反向验证：判据 `> 0` 改 `>= 0` ⇒ 「同版本内容不同」那条立即红。
- **改名改引用会改坏代码块里的语法示例**（rev173.138）：`rename_note` 的 `rewrite_links` 是纯字面替换
  —— 笔记里贴的 `[[旧名]]` 示例（写在 fenced code / 行内代码里）会被一起改掉。改用**状态机**
  （`replace_outside_code`，不是正则）逐行切 fenced / 行内 / 正文，只对正文段替换。同时补**改前备份**：
  原文写到 `<库>/.zn/link-rewrite/<毫秒>/<原相对路径>`，`prune_rewrite_backups` 只留最近 20 次。
  Rust 单测 40 → **41**。

## [0.5.0] - 2026-10-25（rev173.125 – rev173.136）

> 0.4.0（2026-10-24 18:34）之后的 **44 个提交**。主线是**同步四个后端全部真机落地**
> （S3 / Git 补附件与验收、S3 条件写、空笔记 411、基线丢失不再被远端覆盖、`sync-folder` 接真实 Syncthing），
> 外加**反向链接全库持久索引**与 `note:saved` / `note:created` 带正文的时序修复。
>
> ⚠️ 本段还包含 0.4.0 发布时**未单列**的条目（rev173.106–124：`net` 原语 / `fs` 二进制 / `host.secrets` /
> `sync-folder` / `sync-webdav` / `sync-s3` / `sync-git`）。当时只在上方「应用版本」表写了摘要，
> 详细条目没有另起 `[0.4.0]` 段；本段不伪造时间线，一次收在这里，0.4.0 的逐 rev 细节以 `HANDOFF.md` 为准。

### Added

- **`note:created` 也带正文**（rev173.135 · 收掉 rev173.133 的 ⚠️）：`fs.createNote` 的 payload
  从 `{ path }` 变成 `{ path, text }`；`fs.restoreTrash` 恢复成功时也带 `text`（读失败则**不带**
  该字段，订阅方应退回自己的读盘路径）。与 `note:saved` 同一个来由：订阅方（同步插件）要在
  **同步段**里种基线 / 同步点，watcher 的 `note:changed` 回响才插不进 `await` 窗口。
  `sync-folder` 的 `note:created` 处理已改成「有 `text` 就同步种基线，没有就退回读盘」
  （旧内核不静默失效）。契约 §1.4 表同步；单测 921 → **923**；`sync-folder` 0.3.1 → **0.3.2**。
- **反向链接：全库持久索引**（rev173.134 · 技术债 #2，`backlinks` 0.1.0 → **0.2.0**）：
  以前只扫**最近 30 天**改过的笔记（rev173.95 的性能折中）⇒ 老笔记里的 `[[引用]]` 在面板里
  一律看不见，ROADMAP 当时标的是「要改契约，另议」。现在放开到全库，成本靠三条压住：
  ① `mtime` 缓存；② **`at` 信任窗口** —— `note:saved` 现在带 `text`（rev173.133），保存后
  **零读盘**就能更新这一篇，`at >= mtime` 表示手里的内容不比磁盘旧；③ **事件增量** ——
  保存 / 外部改 / 删除 / 改名都只动这一篇。状态栏「被 N 篇引用」从「每次事件全库扫描」改成
  内存算 + 一次 `listNotes`；首次全扫每 25 篇让出事件循环。面板摘要换成
  `全库 N 篇 · 本轮读盘 M 篇`。单测 26 → **30**（老笔记也命中 / 保存零读盘 / `at` 窗口 / 删除淘汰；
  反向验证：把 `at` 分支改成 `return false` ⇒ 信任窗口那条红）。实测 `全库 30 篇 · 本轮读盘 0 篇`。
  **契约与内核一字未动**。
- **同步 · S3 / Git 补附件同步**（rev173.126）：这两个后端此前**只同步 `.md`** —— 桌面粘的图、
  推的 PDF 在 S3 / Git 后端下手机看不到，而且不报错。现在与 `sync-webdav` 同一套协议：
  `off` / `relay`（中转：对端 ack 后删云端副本）/ `full`（永久），附件条目写进
  `_zn/manifest.json`，内容级判定（指纹不同才传），`mtime` + `size` 未变不重读盘。
  面板加「附件」耗时 badge 与模式下拉，新命令 `sync-s3.set-attachments` / `sync-git.set-attachments`；
  `sync-s3` 0.3.0 → **0.4.0**、`sync-git` 0.4.0 → **0.5.0**。
  真机验收：**S3（`rclone serve s3`）15/15 · Git（真实 GitHub 私有仓库）13/13**。
- **同步 · Git 类后端 `sync-git`**（rev173.122 · 同步二期第四个、也是最后一个后端）：
  GitHub / Gitea / Gitee 的 **REST Contents API**（不是 git 协议，不是 push），
  一个文件一次 GET/PUT，**`sha` 就是乐观锁**（远端变过 ⇒ 平台拒绝 ⇒ 按冲突走三方合并）。
  - 三个平台的差异收在 `PROVIDERS` 表里：GitHub / Gitea 走 `PUT` + `Bearer`；
    Gitee 走 `POST` + `token` 头（**Gitee 未实测**，面板上如实标注）。
  - **base64 两个坑都踩过并测了**：① `btoa(text)` 直编中文会抛 `InvalidCharacterError`
    ⇒ 走 `TextEncoder` → 手工 base64；② 平台返回的大文件 base64 **每 60 字符插换行**
    ⇒ 解码前剥掉所有空白（`b64decode` 单测覆盖）。
  - `parseContents` 的形状**照真实 GitHub 响应写**（2026-10-25 实测
    `GET /repos/octocat/Hello-World/contents/README` ⇒ `sha: '980a0d5f…'`、`content: 'SGVsbG8gV29ybGQhCg=='`）。
  - 判定与另外三个同步插件**逐字一致**，同步点 tag = `sync:git`（四个后端各写各的 base）。
  - 进内置预装（12 → **13**）；示例插件 37 个。单测 +19。
  - ⚠️ **没实测写路径**：手头没有仓库写权限的令牌，`PUT` / `POST` / `DELETE` 只到 mock 层。

- **同步 · S3 兼容后端 `sync-s3`**（rev173.121 · 同步二期第三个后端）：AWS S3 / MinIO /
  Cloudflare R2 / B2 直连，**自实现 AWS SigV4**（不引 SDK —— 插件的 `net` 原语只发请求）。
  - **签名正确性用 AWS 官方 SDK 的测试向量验证**（`aws-sdk-js/test/signers/v4.spec.js` 的
    DynamoDB ListTables 用例），不是自签自验：改错一个字节测试就红。
  - 编码遵守 S3 的特殊规则：路径**逐段编码、不二次编码、不折叠 `//`、不解析 `..`**，
    且 `encodeURIComponent` 漏掉的 `!'()*` 也补上（这四兄弟只在 key 含它们时才暴露，最难查）。
  - **对象存储没有目录**：`_zn/manifest.json` 就是权威索引（与 WebDAV 版同一格式），
    不 list 桶。`listObjectsV2` 只在「连接测试」里用（`max-keys=1`）。
  - 判定与 `sync-webdav` **逐字一致**（七种组合），`tryAutoMerge` 与 `sync-folder` 一致，
    同步点 tag = `sync:s3`（三个后端各写各的 base，互不覆盖）。
  - 进内置预装（11 → **12**）；功能目录 36 个示例插件。
  - 单测 +21：SigV4 向量 / 编码规则 / 七种判定 / manifest / 客户端接线 / 插件命令清单。
  - ⚠️ 本轮**没有真实 S3 服务的端到端实测**（没有凭据）—— 签名与请求形态靠测试向量与 mock 保证；
    附件同步暂未接入（面板明说「只同步 .md」）。

- **同步耗时历史与趋势**（rev173.119）：面板不再只显示"上一次多久"，而是给出最近若干次的
  平均 / 最慢 + 一条字符 sparkline（`▁▂▃▄▅▆▇█`，只用最后 24 条）。
  - 落 `store`（`timing.v1`，最多 50 条），**重启后趋势还在**；趋势行刻意画在
    `lastResult` 之外 —— 否则每次开 App 都要先同步一次才能看到。
  - **只记「有变化」的轮次与手动同步**：静默空转轮 5 秒一条，50 条只够 4 分钟，
    而且全是"没活干"的噪声，趋势图会变成一条没有信息的平线。
  - 新纯函数 `pushTiming` / `timingSummary` / `sparkline`，单测 +5（追加与上限截断 /
    坏数据容错 / 平均值与最慢 / sparkline 档位与全相等 / 只取最后 N 个）。
  - 实测（dev 桌面 · 真实坚果云）：连点两次「立即同步」⇒ 面板出现
    `最近 2 次：平均 432 毫秒 · 最慢 440 毫秒` + `█▁`；**reload 后仍在**（从 store 恢复）。
  - `sync-webdav` 0.2.2 → **0.3.0**。

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

- **同步 · 本机保存的改动可能永远同步不出去**（rev173.133 · 修 rev173.116 记下的观察项）：
  `note:saved` 的处理体以 `await readText` 开头 —— Rust watcher 的回响（`note:changed`）
  若在这段 `await` 中间跑完判定，pending 还没建立 ⇒ 磁盘是新内容、基线还是旧内容 ⇒
  判 `remote`（当成"别处更新"）、基线对齐新内容；随后 saved 醒来看到
  `baseline.fp === 当前 fp` 直接早退 ⇒ 这次改动**既没有 pending 也没有影子副本**，
  永远同步不出去（rev173.116 实测：冷启动后第一次编辑没形成 pending，第二次正常）。
  修法：内核 `note:saved` 的 payload 带 **`text`**（刚写盘的正文），订阅方据此在**同步段**
  里算指纹、记 pending —— watcher 回响不可能插队（`note:saved` 总是先于它的回响派发）。
  同步插件另加**内存影子副本**兜底：影子落盘是异步的，这段窗口里来真冲突也不会误标
  「本机版未留存」。单测 916 → **917**（时序用例：读盘慢 ⇒ 回响抢跑；反向验证：掐掉正文分支即转红）。
- **附件同步五个静默 bug**（rev173.126 · 真机验收同一轮跑出）：
  ① S3 前缀非空时 `test()` / `list()` 把**对象前缀**拼进路径 ⇒ 请求打到 `/桶/<前缀>`，404
  （rev173.125 验收时前缀为空，没暴露）；
  ② S3 `list()` 返回的 key 含前缀，喂回 `remove()` 会再拼一次 ⇒ 清理跑完远端还剩对象；
  ③ Git `normalizeManifest` 恒丢弃 `attachments` ⇒ 下载循环空转、**零日志**（图永远不过去）；
  ④ **GitHub Contents API 的 `content` 对二进制有损**：8 字节 PNG 的 `size` 仍是 8，但返回的
  `content` 解码后是 **12 字节**（`0x89` → `EF BF BD`）⇒ `readBytes` 改走
  `Accept: application/vnd.github.raw` 拿原始字节，不认 raw 的平台才回退解析 JSON；
  ⑤ 附件同步**先推后拉** ⇒ 双端互相覆盖（后同步的那台赢：A 上传旧图、B 上传新图后 A 再同步，
  A 会先把自己的旧图推回去）⇒ 改**先拉后推** + `mtime(本地) > at(远端)` 方向判定；
  条目再记 `mode`（上传方当时的模式），一台 full、一台 relay 时才找得到文件。
  单测 895 → **906**。⚠️ `sync-webdav` 仍是旧顺序（第 ⑤ 条同款），本轮未改。
- **`sync-webdav`：附件双端互相覆盖 + 每轮都发下载请求**（rev173.127）：附件段改成**先拉后推**，
  方向由 `mtime(本地) > at(远端)` 决定（本地确实改过才推，否则等下载）；条目记 `mode`，
  取文件按上传方当时的模式决定去原路径还是 `_zn/relay/`。顺带修既有 bug：
  `localFp = await localFpOf(local)` 拿到的是 `{ fp, bytes }` **对象**，与字符串永不相等
  ⇒ 本地同版也每轮发一次下载请求（以前靠 `If-None-Match` 304 兜住，没暴露成"多传字节"）。
  新增双设备单测（A 传 v1 → B 换 v2 → A 再同步 ⇒ 本地 v2 / 远端 v2 / 该轮无 `PUT 附件`）。
  单测 906 → **907**。⚠️ 本轮无真机证据（WebDAV 要自建 DAV 桩）。
- **Git 后端：乐观锁失效会卡死（永远 409）**（rev173.123 · 真机实测发现）：
  `PUT` 带 manifest 里记的 sha，如果远端被"绕过 manifest"改过（网页里直接编辑 / 另一台设备
  崩在半路），这个 sha 就过期了 ⇒ 平台返回 409。修之前只留一句 hint 就 `continue`，
  **下一轮还拿同一个过期 sha 重试 ⇒ 永远推不上去**。
  现在 409 走统一的冲突处理：**重读远端 → 刷新 manifest 条目 → 能合就合、合不上就留副本取远端版**，
  本轮收口。单测 +1（模拟"网页手改"绕过 manifest：第一次 PUT 409、第二次推合并结果成功、
  再跑一轮不重复冲突）。
  - 同轮实测（真实 GitHub 私有仓库 `aqua7773/zeronote-sync-test`）：`test()` / 空仓库首写 /
    带 sha 更新 / **过期 sha 被拒 409** / manifest 写读 / 列目录 / 清理 —— 8 项全过；
    完整同步引擎 16 项全过：首推 2 篇 · 对端改 ⇒ 下载 1 · 双端改不同行 ⇒ 自动合并（两端都是
    合并结果）· **绕过 manifest 手改 ⇒ 本轮自愈、再跑不重复冲突** · 双端改同一行 ⇒ 冲突副本
    = 本机版 · 面板耗时 `用时 1.1 秒 · manifest 726 毫秒 · 笔记 395 毫秒` · 远端清理干净。

- **插件写盘不再伪装成「用户保存」**（rev173.120 · 用户 2026-10-25 要的「内核口子」）：
  `fs.writeText` 新增 `opts.origin`：`'user'`（默认）发 `note:saved`；`'plugin'` **不发**
  `note:saved`，改发 `note:changed`（带 `origin: 'plugin'`），索引照常更新。
  - 插件口 `ctx.fs.writeText` 由宿主**强制**标 `'plugin'`（插件传 `'user'` 也无效 ——
    来源由调用栈决定）。插件作者不用记得传，忘记传的后果很隐蔽。
  - **替代 `sync-folder` 的 `selfWrites` 抑制表**（rev173.116 的补丁）：那张表靠
    「写盘前登记、事后清理」的时序，冷启动时会被 Rust watcher 抢跑；现在内核层面就不发错事件，
    表已删除。`sync-folder` 另外对 `origin: 'plugin'` 的 `note:changed` 直接忽略。
  - 单测 +5：内核三条（插件口径不发 saved / 默认仍是 user / `.zn/` 下插件写盘不发任何事件）·
    sync-folder 两条（origin:plugin 的 changed 被忽略 / 插件写盘不留僵尸 pending）。
  - 实测（dev 桌面 · 真实坚果云）：编辑器输入保存后同步「上传 1」—— **用户保存链路完好**，
    没有被这次改动波及；面板同时读到「用时 2.6 秒 / 最近 3 次：平均 1.2 秒 · 最慢 2.6 秒」。
  - 契约 §2.1 `FsApi.writeText` 与 §1.4 事件表同步；`sync-folder` 0.2.0 → **0.3.0**。

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



## [0.4.0] - 2026-10-24（rev173.71 – rev173.124）

> 0.3.0 之后的 41 个提交（`git log v0.3.0..v0.4.0`）。主线是 **A 档 4 个插件**（ROADMAP 6 项）：
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
