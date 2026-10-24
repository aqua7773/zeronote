# ZeroNote 文档索引

> 状态：**active** ｜最后核对：2026-10-20 ｜权威范围：文档地图 + 权威矩阵（"谁说了算"）

**规则：同一主题只有一个 `active` 权威文档；其余文档必须写明被谁取代。**

---

## 权威矩阵

| 主题 | 唯一权威 | 状态 | 其他文档 |
|---|---|---|---|
| 系统怎么运转（拓扑 / 主流程 / 模块地图） | `docs/系统总览.md` | **active** | — |
| 为什么这样设计（原则 / 取舍） | `docs/架构原则-2026-10-13.md` | **active** | `archive/插件UI承载能力-2026-10-13.md`（方案已落地，作设计史） |
| 写代码 / 重构 / 测试 / 提交约定 | `docs/开发约定.md` | **active** | `docs/App拆分方案-2026-10-18.md`（historical：拆分已收官，流程部分被本文取代） |
| 插件接口 / 数据模型 | `docs/内核契约-v0.2.md`（代码真相是 `src/kernel/contract.ts`） | **active** | 契约 §4 已被架构原则覆盖，读时以架构原则为准 |
| 插件能力现状 / 对标六家 | `HANDOFF-CARD.md` + 契约 §4 | **active** | `archive/插件能力盘点-2026-10-12.md`（**historical**：rev30 快照） |
| 需求（目标） | `docs/requirements/current.md` | **draft（仅参考）** | 2026-10-17 用户裁定需求 2 暂不采用；`archive/` 旧需求（superseded） |
| 功能目录（有哪些插件 / 声明了什么） | `docs/功能目录.md` | **generated**（`node scripts/gen-catalog.mjs --write`） | — |
| 决策记录 / 否决清单（为什么不做） | `docs/decisions/README.md` | **active** | 论证过程在 `docs/*-调研-*.md` |
| 任务卡 / 决策记录模板 | `docs/templates/TASK.md` · `docs/templates/ADR.md` | **active** | — |
| 当前状态 / 下一步 | `HANDOFF-CARD.md` | **active** | — |
| 接下来做什么（顺序 / 成本 / 验收） | `docs/ROADMAP.md` | **active** | `docs/待做插件-调研与方案-2026-10-21.md`（各插件做法论证） |
| 逐版本记录 / 证据 / 踩坑 | `HANDOFF.md`（rev 索引在文首） | **active** | — |
| 文档阅读器选型 | `docs/文档阅读器-调研-2026-10-13.md` | **active** | — |
| 记账插件（竞品 / 通知捕获 / 契合度 / v0.1 落地） | `docs/记账插件-调研-2026-10-19.md` | **active** | `_research/accounting/*`（竞品 README 与源码原文，historical） |
| 起始页快捷入口（长按 ＋ 环形菜单） | `docs/快捷入口-调研-2026-10-19.md` | **active（待实现）** | — |
| 标签 / 窗口拖回吸附（怎么做、选哪条） | `docs/标签窗口拖拽-调研-2026-10-20.md` | **active（待用户选方案）** | — |
| 全功能对标（还有没有「该用没用」） | `docs/全功能对标调研-方案-2026-10-20.md` | **active（v2 待评审，未开工）** | v1 的 9 处错误见文末更正清单 |
| A 档插件（标签 / 双链 / 历史 / 打卡）当时怎么做 | `docs/待做插件-调研与方案-2026-10-21.md` | **archived（4 个已全部落地：rev173.93 / 95 / 99 / 103）** | — |
| 卡死兜底（看门狗 + 启动自愈） | `docs/卡死兜底方案-2026-10-13.md` | **active** | — |
| 同步插件（怎么同步、冲突怎么算） | `docs/同步插件-调研与方案-2026-10-24.md` | **active（draft，等用户拍板）** | 推翻 `D-002` 的「不做同步」需要新决策记录 |
| UI / 交互规范（现行） | `docs/UI交互规范.md` | **active** | `docs/UI规划-v0.1.md`（2026-10-11 规划史，部分被本文取代） |
| 键位表（自动生成） | `docs/键位表.md` | **generated**（`node scripts/gen-keys.mjs --write`） | — |
| 数据与存储（库布局 / localStorage / 写入语义） | `docs/数据与存储.md` | **active** | — |
| Android 安装（用户向） | `docs/Android安装说明.md` | **active** | `_build/revNN/安装说明.md`（某个随包版本的说明） |
| 手机版使用手册（用户向） | `docs/使用手册-移动端.md` | **active** | 截图在 `docs/images/manual-mobile/`（真机 2026-10-19） |
| 功能测试快照（rev92） | `docs/测试报告-2026-10-17.md` | **historical** | 部分结论已被 rev48/110/116 修复或推翻，见段内注记 |
| 外部技术调研 | `_research/*` | **historical**（均带日期） | — |
| 出包过程产物 | `_build/*` | **disposable**（可重建） | — |

## 阅读路径

| 场景 | 顺序 |
|---|---|
| 第一次来 | `README.md` → `docs/系统总览.md` → 架构原则 §1 → 契约 §0–§2 |
| 接手项目 | `HANDOFF-CARD.md`（一屏）→ `HANDOFF.md` 文首 rev 索引 → 最新 rev 段 |
| 改代码前 | 架构原则 + 契约对应章节 + 该领域的"未核实"清单 |
| 写新插件 | 契约 §2（十个原语）+ §3（manifest）+ `examples/` 里最接近的那个 |

## 欠账（明确记着，不假装没有）

- `docs/guides/` 方向未落地：`Android安装说明.md` 仍在 `docs/` 根
- 历史文档已统一归档到 `docs/archive/`（2026-10-17）
- CHANGELOG 已建（2026-10-17，契约 v0.2）
