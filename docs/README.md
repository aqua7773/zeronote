# ZeroNote 文档索引

> 状态：**active** ｜最后核对：2026-10-25（状态列逐条对代码/提交复核） ｜权威范围：文档地图 + 权威矩阵（"谁说了算"）

**规则：同一主题只有一个 `active` 权威文档；其余文档必须写明被谁取代。**

---

## 权威矩阵

| 主题 | 唯一权威 | 状态 | 其他文档 |
|---|---|---|---|
| 系统怎么运转（拓扑 / 主流程 / 模块地图） | `docs/系统总览.md` | **active** | — |
| 为什么这样设计（原则 / 取舍） | `docs/架构原则-2026-10-13.md` | **active** | `archive/插件UI承载能力-2026-10-13.md`（方案已落地，作设计史） |
| 写代码 / 重构 / 测试 / 提交约定 | `docs/开发约定.md` | **active** | `docs/App拆分方案-2026-10-18.md`（historical：拆分已收官，流程部分被本文取代） |
| 外部贡献入口（环境 / 提交前门禁 / 插件投稿 / PR 流程） | `CONTRIBUTING.md`（仓库根） | **active（rev173.154）** | `docs/开发约定.md`（细则）、`market/README.md`（插件打包与外部投稿）、`.github/ISSUE_TEMPLATE/`（bug / 功能建议 / 插件投稿） |
| 插件接口 / 数据模型 | `docs/内核契约-v0.2.md`（代码真相是 `src/kernel/contract.ts`） | **active** | 契约 §4 已被架构原则覆盖，读时以架构原则为准 |
| 插件能力现状 / 对标六家 | `HANDOFF-CARD.md` + 契约 §4 | **active** | `archive/插件能力盘点-2026-10-12.md`（**historical**：rev30 快照） |
| 需求（目标） | `docs/requirements/current.md` | **draft（仅参考）** | 2026-10-17 用户裁定需求 2 暂不采用；`archive/` 旧需求（superseded） |
| 功能目录（有哪些插件 / 声明了什么） | `docs/功能目录.md` | **generated**（`node scripts/gen-catalog.mjs --write`） | — |
| 决策记录 / 否决清单（为什么不做） | `docs/decisions/README.md` | **active** | 论证过程在 `docs/*-调研-*.md` |
| 任务卡 / 决策记录模板 | `docs/templates/TASK.md` · `docs/templates/ADR.md` | **active** | — |
| 当前状态 / 下一步 | `HANDOFF-CARD.md` | **active** | — |
| 接下来做什么（顺序 / 成本 / 验收） | `docs/ROADMAP.md` | **active** | `docs/待做插件-调研与方案-2026-10-21.md`（各插件做法论证） |
| 逐版本记录 / 证据 / 踩坑 | `HANDOFF.md`（当前版本周期，索引在文首） | **active** | `docs/archive/handoff/0.2.md` · `0.3.md` · `0.4.md`（更早的 rev 正文；rev173.139 分卷 890 KB → 63 KB） |
| 文档阅读器选型 | `docs/文档阅读器-调研-2026-10-13.md` | **active** | — |
| 记账插件（竞品 / 通知捕获 / 契合度 / v0.1 落地） | `docs/记账插件-调研-2026-10-19.md` | **active** | `_research/accounting/*`（竞品 README 与源码原文，historical） |
| 起始页快捷入口（长按 ＋ 环形菜单） | `docs/快捷入口-调研-2026-10-19.md` | **implemented（rev173.20–22）** | — |
| 标签 / 窗口拖回吸附（怎么做、选哪条） | `docs/标签窗口拖拽-调研-2026-10-20.md` | **已裁决 · 不做回拖**（rev173.54 落地 B 方案 → rev173.68 按用户要求移除；现「关闭 = 交回主窗口」） | — |
| 全功能对标（还有没有「该用没用」） | `docs/全功能对标调研-方案-2026-10-20.md` | **historical（§6 五项全部完成：rev173.59 / 60 / 61 / 63 / 65）** | v1 的 9 处错误见文末更正清单 |
| A 档插件（标签 / 双链 / 历史 / 打卡）当时怎么做 | `docs/待做插件-调研与方案-2026-10-21.md` | **archived（4 个已全部落地：rev173.93 / 95 / 99 / 103）** | — |
| 卡死兜底（看门狗 + 启动自愈） | `docs/卡死兜底方案-2026-10-13.md` | **active** | — |
| 同步插件（怎么同步、冲突怎么算） | `docs/同步插件-调研与方案-2026-10-24.md` | **active（已落地 · rev173.106–136，四后端 + 附件 + 三方合并 + 真机验收）** | 推翻 `D-002` 的「不做同步」已记为新决策 `D-009`（用户自带后端，不做账号/服务端） |
| 附件存储 / 引用 / 跨设备搬运 | `docs/附件与同步-需求-2026-10-28.md` | **active · 期 1 ✅173.232 · 期 2 ✅173.234 · 期 3 渲染 ✅173.235（2026-10-28 定稿 · 排进 `docs/ROADMAP.md` §3.5 第 7–9 位）**：≤1 MiB 复制 / >1 MiB 引用 + `sha256` 台账 `<库>/.zn-assets/manifest.json`；**图片两模式**（A 原图 + 大图预览 · B 压到 ≤1 MiB 入库；透明图无损 WebP · GIF 不压 · EXIF 转正）；**库外路径可渲染**（patch atomic 支持尖括号目标 / 剥尖括号 / 解 `%xx` / 破图明确提示）。**剩期 4**（跨设备手动搬运）与库外非媒体附件的「文件卡片」。同步侧见 `docs/同步插件-调研与方案-2026-10-24.md` |
| UI / 交互规范（现行） | `docs/UI交互规范.md` | **active** | `docs/UI规划-v0.1.md`（2026-10-11 规划史，部分被本文取代） |
| 键位表（自动生成） | `docs/键位表.md` | **generated**（`node scripts/gen-keys.mjs --write`） | — |
| 数据与存储（库布局 / localStorage / 写入语义） | `docs/数据与存储.md` | **active** | — |
| Android 安装（用户向） | `docs/guides/Android安装说明.md` | **active** | `_build/revNN/安装说明.md`（某个随包版本的说明） |
| 手机版使用手册（用户向） | `docs/guides/使用手册-移动端.md` | **active** | 截图在 `docs/images/manual-mobile/`（真机 2026-10-19；rev173.251 搬进 guides） |
| 功能测试快照（rev92） | `docs/测试报告-2026-10-17.md` | **historical** | 部分结论已被 rev48/110/116 修复或推翻，见段内注记 |
| 外部技术调研 | `_research/*` | **historical**（均带日期） | — |
| 插件市场 / 更新通道 | `docs/插件市场-调研-2026-10-25.md` | **active（阶段 1 已落地 · 仓库已开源 · rev173.152）**：应用内「发现」tab 能列 / 装 / 升，整包 sha256 不符不落盘（端到端验过）；**包入库 `market/packs/` 走 raw 分发**（`github.com:443` 国内直连不通，走 Release 会「能看不能装」）；手机真机走查通过；**设置与菜单两处插件页统一**（同一个 `PluginPanel`，市场 tab 一份代码）；**第二批 UX 也已落地（rev173.156：详情页含能力自述 / 更新角标 / 启动 24h 节流检查）**；待办只剩「插件数涨到几十个时换 CDN」。收口见 `docs/ROADMAP.md` §3.3 | [D-008](decisions/D-008-暂不做插件市场与更新通道.md)（状态已过时，重议条件「插件数 > 10」早满足：预装 13；进度以 `docs/ROADMAP.md` §3.3 为准） |
| 安全插件 / 绝密账号库（加密 / 主密码 / 自动锁定） | `docs/安全插件-方案-2026-10-25.md` | **accepted · 期 1a 已落地并签名发市场（rev173.160–161）**：`security` 插件（**双密钥环** · XChaCha20-Poly1305 + Argon2id · `crypto` 服务只给操作不给密钥 · 25 条单测 + CDP 实测九项）· 包在 `market/packs/security-0.1.0.znp`（keyId `aqua-2026`）· **不预装**（用户决定：安全类插件从市场主动装）· **`secrets` 密码库（期 1b）已落地（rev173.163）**：`examples/secrets/` 消费 `crypto` 服务，整库密文 `.zn/secrets/secrets.zn`、平台/账号两级、搜索不含密码、16 位生成器、显示 15 秒收起、复制 60 秒清剪贴板、回收站 7 天、空闲 60 秒自动锁；27 条单测 + CDP 实测 12 项；**已签名发市**（`secrets` 0.1.0）；**期 1c 同步放行已做（rev173.164）**；生物识别两平台全部落地（Android 指纹 168 · Windows Hello 169 · 锁定后自动弹 171 · 按设备 173）；当前 **`security` 0.2.1** 已发市场 | 需求 §8 / §9 / §8.6 / §9.4；先例 `examples/dep-crypto`（PBKDF2 + AES-GCM） |
| 私密文件夹（私密笔记存哪 / 怎么编辑 / 怎么同步） | `docs/私密文件夹-方案-2026-10-26.md` | **accepted · 期 1/2/3 全部落地（rev173.180 / 181 / 182）**：内核新增 `doc.registerCodec`（读盘后 decode / 写盘前 encode，内核不认识加密）；`examples/private-notes/` —— `.zn/private/` 整棵树（`.zn` 天然不进文件树/搜索/回收站）· 每篇一密文 + 加密索引（文件名是 id，不泄漏标题）· `notes` 环 3 分钟锁 · **独立搜索（内存明文、懒加载）· 回收站 · 移入移出**。期 3：`vault.json` **按环拆**（改一环保一环）· 四后端搬 `.zn/private/`（删除两边都传播）· 备份含私密树。**收尾已完成**：包已签名发市（`security` 0.2.1）· 桌面迁移链（rev173.183）与手机走查（rev173.184）都实测过 · Android 上旧 `vault.json` 复活已查清（rev173.186–187，内核 `write_note` 的内存态；防御在 0.2.1） | 需求 §3.3（7 条）+ §10.1；前置 `security` 的 `notes` 环（3 分钟锁）早已预留 |
| AI 插件（功能范围 / 39 问决策） | `docs/AI插件-需求-2026-10-27.md` | **current**（rev173.203 七刀全部落地） | 需求 §5 的落地形态；**分类 / 计划改为任务制**，与 §5 原文的差异见文档 §4 |
| AI 插件（分期 / 验收） | `docs/AI插件-实施计划-2026-10-27.md` | **current**（7 刀全部 ✅，2026-10-27） | CORS 与流式降级已实测；开工后每刀单独 rev |
| 出包过程产物 | `_build/*` | **disposable**（可重建） | — |

## 阅读路径

| 场景 | 顺序 |
|---|---|
| 第一次来 | `README.md` → `docs/系统总览.md` → 架构原则 §1 → 契约 §0–§2 |
| 接手项目 | `HANDOFF-CARD.md`（一屏）→ `HANDOFF.md` 文首 rev 索引（当前版本周期）→ 最新 rev 段；更早的 rev 用 `git grep -n "rev号" -- docs/archive/handoff/` |
| 改代码前 | 架构原则 + 契约对应章节 + 该领域的"未核实"清单 |
| 写新插件 | 契约 §2（十一个原语）+ §3（manifest）+ `examples/` 里最接近的那个 |

## 欠账（明确记着，不假装没有）

- ~~`docs/guides/` 方向未落地~~ ✅ **rev173.246 已建**：`docs/guides/Android安装说明.md`（用户向文档归这里，
  见 `docs/文档编写规范.md` 的文档分类表）。**`使用手册-移动端.md` 已于 rev173.251 搬入同一目录**（12 张
  `../images/manual-mobile/*` 相对图片同改；`docs/manual-print.css` 留在 `docs/` 根，重出 PDF 时在 `docs/` 下跑）。
- 历史文档已统一归档到 `docs/archive/`（2026-10-17）
- CHANGELOG 已建（2026-10-17，契约 v0.2）
