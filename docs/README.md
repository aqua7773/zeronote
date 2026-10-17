# ZeroNote 文档索引

> 状态：**active** ｜最后核对：2026-10-17 ｜权威范围：文档地图 + 权威矩阵（"谁说了算"）

**规则：同一主题只有一个 `active` 权威文档；其余文档必须写明被谁取代。**

---

## 权威矩阵

| 主题 | 唯一权威 | 状态 | 其他文档 |
|---|---|---|---|
| 为什么这样设计（原则 / 取舍） | `docs/架构原则-2026-10-13.md` | **active** | `插件UI承载能力-2026-10-13.md`（方案已落地，作设计史） |
| 插件接口 / 数据模型 | `docs/内核契约-v0.2.md`（代码真相是 `src/kernel/contract.ts`） | **active** | 契约 §4 已被架构原则覆盖，读时以架构原则为准 |
| 插件能力现状 / 对标六家 | `HANDOFF-CARD.md` + 契约 §4 | **active** | `插件能力盘点-2026-10-12.md`（**historical**：rev30 快照） |
| 需求（目标） | `docs/requirements/current.md`（＝《需求2》，19 章） | **active** | `Markdown 笔记应用需求规格 v1.0.md`（**superseded**：Flutter+SQLite）、`1.目录结构.md`（**historical** 原始素材） |
| 当前状态 / 下一步 | `HANDOFF-CARD.md` | **active** | — |
| 逐版本记录 / 证据 / 踩坑 | `HANDOFF.md`（rev 索引在文首） | **active** | — |
| 文档阅读器选型 | `docs/文档阅读器-调研-2026-10-13.md` | **active** | — |
| 卡死兜底（看门狗 + 启动自愈） | `docs/卡死兜底方案-2026-10-13.md` | **active** | — |
| UI / 交互规范 | `docs/UI规划-v0.1.md` | **active**（P0-6 已按 HANDOFF 校正为 `ef3bf13`） | `_research/成熟产品布局规范.md` / `交互规范.md`（historical 调研） |
| Android 安装（用户向） | `docs/Android安装说明.md` | **active** | `_build/revNN/安装说明.md`（某个随包版本的说明） |
| 功能测试快照（rev92） | `docs/测试报告-2026-10-17.md` | **historical** | 部分结论已被 rev48/110/116 修复或推翻，见段内注记 |
| 外部技术调研 | `_research/*` | **historical**（均带日期） | — |
| 出包过程产物 | `_build/*` | **disposable**（可重建） | — |

## 阅读路径

| 场景 | 顺序 |
|---|---|
| 第一次来 | `README.md` → 本文 → 架构原则 §1 → 契约 §0–§2 |
| 接手项目 | `HANDOFF-CARD.md`（一屏）→ `HANDOFF.md` 文首 rev 索引 → 最新 rev 段 |
| 改代码前 | 架构原则 + 契约对应章节 + 该领域的"未核实"清单 |
| 写新插件 | 契约 §2（十个原语）+ §3（manifest）+ `examples/` 里最接近的那个 |

## 欠账（明确记着，不假装没有）

- `_research/*` 尚未逐份加状态头（都是 10-11 ~ 10-13 的历史调研，引用前先看日期）
- `UI规划-v0.1.md` 的 P0 状态表与 HANDOFF 有出入（P0-6 实际已完成）
- `docs/guides/` 方向未落地：`Android安装说明.md` 仍在 `docs/` 根
- 没有 CHANGELOG：契约改了多轮仍是 v0.1（规范要求下次改契约时补）
