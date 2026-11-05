# ZeroNote 交接卡（入口）

> 一屏读完：**是什么 / 到哪了 / 下一步 / 规矩 / 细节去哪**。
> 最后更新 **2026-11-06 · rev173.386 · 0.9.30** ｜ 上限 120 行 ｜ 过程与证据在 `HANDOFF.md`，操作知识在 `docs/handoff/`。

<!-- FACTS:BEGIN（由 scripts/facts.mjs 生成，勿手改；跑 node scripts/facts.mjs --write 刷新） -->
| 事实 | 当前值 |
|---|---|
| rev / 版本 | rev173.386 · 0.9.30 · 2026-11-06 |
| 测试基线 | vitest 1918 · cargo 105 · oxlint 4 warnings（2026-11-06） |
| 插件 | 市场 16 · 示例 40 |
| 文档 | README 现状 2026-11-06 · CHANGELOG 0.9.30 |
<!-- FACTS:END -->

## 1 是什么（30 秒）

**空内核**本地 Markdown 笔记应用：Tauri 2 + React 19 + Rust。
内核 12 原语 + 21 种 UINode + 6 个挂载位，功能全靠插件；**不预装任何插件**（D-011）。
插件在全局目录 `<应用数据目录>/.zn/plugins/<id>/`，装卸 = 放 / 删一个文件夹。

技术栈 · 分层 · 主流程 · 模块地图 → [`docs/系统总览.md`](docs/系统总览.md)
为什么这样设计（冲突时以它为准） → [`docs/架构原则-2026-10-13.md`](docs/架构原则-2026-10-13.md)

## 2 到哪了

| 项 | 值 |
|---|---|
| 版本 / rev | **0.9.30** · rev173.386 |
| 测试基线 | vitest 1918 · cargo 105 · oxlint 4 warnings · 质量门 8/8（2026-11-06） |
| 插件 | 市场 16 条 · 示例 40 个 |
| 远端 | GitHub / Gitee main + tag `v0.9.30` 同步 |

## 3 下个会话第一件事

> rev173.384 用户清空三端（只留手机密码库），并定下 4 步顺序。**rev173.385 已完成第 1、2 步**：

1. ~~**取消「附件」虚拟分组**~~ ✅ rev173.385：`FileTree.tsx` 的 `buildTree` 不再聚合 `doc` / `image` / `media`，一律按真实目录显示；**「文档」分组也一并取消**（用户 2026-11-06 拍板「也取消，文档按真实目录显示」）
2. ~~**附件自动分类**~~ ✅ rev173.385：`attachment_plan()` 按扩展名落 `附件/图片|视频|音频|文档|其它/` 并 `create_dir_all`
3. dev 桌面测试 + 用户验收（G3）通过后**发新版**（Rust 改动，手机要新包）
4. **密码库同步**：手机 release → 云端 → 桌面 release（顺序不能反）
5. 备份在 `_tmp/backup-zreonote-clear-2026-11-06/`；云端 `ZeroNote/` 用户已手动删（限流解除后核实）
6. ✅ rev173.386（用户追加）：**其它普通文件也进文件树**（`kind = 'file'`）—— zip / ini / toml 这类插进 `附件/其它/` 后能在树里看到；点开只提示路径（无「用系统程序打开」原语）

## 4 规矩（做不到别动手）

1. **验收三级门**：G1 `verify.ps1` 全绿 → G2 亲手走一遍留截图 → G3 用户确认；只过 G1 不许提发版
2. **发版不发布 universal APK**（33 MB arm64；121 MB 是错的）
3. **每批交付**：verify 全过 ＋ 实测证据 ＋ 提交 ＋ `HANDOFF.md` 新 rev
4. **动手前先查现成**（`docs/开发约定.md` §0.5）；改代码 / 重构前先读它
5. **安卓测试机只跑已装的 dev 包**；不装 release 包
6. **内核保持薄**；**静默失效比报错危险**（看数字，不只看 "ok"）
7. **capability / 安全模型变更**先拿「具体方案」同意（方向同意 ≠ 方案同意）
8. **任何删除先确认**（文件、目录、记忆节点、快照）
9. **一次改 3+ 文件前先给方案**
10. **上下文 350k 起准备换会话**（甜点区 100–300k，压缩不如换）
11. **接手第一件事 = 读完 `docs/handoff/01–07` 七份分册 ＋ 本卡**（只读本卡不算接手）；`HANDOFF.md` 是历史流水账，按 rev 号按需查，**不是必读**
    > 已由 `dsh-dev-gate` **R8 接手必读门**工具级强制：ZeroNote 里第一次 write/edit 或 `git commit` 前，**七份分册缺任一份** ⇒ deny（已实测会拦）。
12. **用户要求「记住」的事 → 写进 `docs/handoff/` 对应分册**，不靠会话记忆、不靠 AI 的 graph memory
13. **用户数据禁止测试**：`C:\Users\AQUA\Documents\ZreoNote` 是用户的**真实笔记库** —— 不写入、不新建/删除笔记、不建私密环、不切库进去点 UI，连「请你切过去点一下」这种建议也不提；所有验收用 AI 自建的 `<仓库>\_tmp-vault-*`（2026-11-05 用户要求，见 01 分册 §1 / 04 分册 §3）

完整版 → [`docs/handoff/04-授权与红线.md`](docs/handoff/04-授权与红线.md)

## 5 分册与权威文档

| 要看什么 | 去哪 |
|---|---|
| 环境 · 两台手机 · 端口 · 常用命令 | [`docs/handoff/01-环境与设备.md`](docs/handoff/01-环境与设备.md) |
| **发版与更新（发版前逐条对照）** | [`docs/handoff/02-发版与更新.md`](docs/handoff/02-发版与更新.md) |
| 当前状态 · 待办 · 已知未修 | [`docs/handoff/03-当前状态.md`](docs/handoff/03-当前状态.md) |
| 授权 · 八条硬约束 · 破坏性操作 | [`docs/handoff/04-授权与红线.md`](docs/handoff/04-授权与红线.md) |
| **项目结构 · 目录职责 · 改哪个文件** | [`docs/handoff/05-项目结构.md`](docs/handoff/05-项目结构.md) |
| **用户拍板与禁忌（红线合集）** | [`docs/handoff/06-用户拍板与禁忌.md`](docs/handoff/06-用户拍板与禁忌.md) |
| 术语 · rev/D 编号 · 日志标记 | [`docs/handoff/07-术语与编号.md`](docs/handoff/07-术语与编号.md) |
| 项目结构 · 主流程 · 模块地图 | [`docs/系统总览.md`](docs/系统总览.md) |
| 插件接口 / 数据模型 | [`docs/内核契约-v0.2.md`](docs/内核契约-v0.2.md) |
| 开发流程 / 测试 / 提交 / 事故清单 | [`docs/开发约定.md`](docs/开发约定.md) |
| 接下来做什么（顺序 / 成本） | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| 文档权威矩阵 | [`docs/README.md`](docs/README.md) |
| 逐版本历史 / 证据 / 踩坑（**流水账，按需查**） | [`HANDOFF.md`](HANDOFF.md) |
| 环境坑位（症状 → 处置） | [`docs/开发环境坑位.md`](docs/开发环境坑位.md) |
| 共享逻辑（一份实现 / 禁止写法） | [`docs/共享逻辑.md`](docs/共享逻辑.md) |

## 6 读哪本（按场景）

| 场景 | 顺序 |
|---|---|
| 第一次来 | 本卡 §1–§4 → `docs/系统总览.md` → 架构原则 §1 → 契约 §0–§2 |
| 接手 / 继续（**先读 4 份分册**） | 本卡 → `01-环境与设备` → `03-当前状态` → `04-授权与红线` → 涉及发版加 `02-发版与更新`；历史细节按 rev 号查 `HANDOFF.md` |
| 改代码 | `docs/开发约定.md` → 架构原则 → 契约对应章节 |
| 发版 | 02 分册**逐条** → `update/README.md` |
| 排障 | `docs/开发环境坑位.md` → 按症状搜 `HANDOFF.md` rev 段 |

## 7 验收基线

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts\verify.ps1
# tsc 0 · oxlint src 0 error · cargo test --lib · check-docs · vitest · 质量门 8 项
```
