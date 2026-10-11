# 项目交接

revision: 2
更新时间: 2026-10-11
标识: DSH-SUPERVISOR-V1
项目: ZeroNote

> **主管模式尚未启用**（用户未说「负责 ZeroNote 项目」）。当前由普通会话直接执行；用户已授权**并发调用子 agent**。

## 当前目标

做一个**空内核**的本地 Markdown 笔记应用：内核只负责 `.md` 读写 / 编辑 / 本地存储 / 插件宿主，其余功能全部插件化、可独立装卸升级；桌面 + Android 双端。

## 验收证据

| 项 | 证据（命令 / 输出 / 文件） | 基线版本 | 时间 |
|---|---|---|---|
| 需求分析冻结 | `_笔记应用选型\内核需求分析-v0.1.md`（用户确认技术方案「全按推荐」） | — | 2026-10-11 |
| 内核契约 v0.1 | `docs\内核契约-v0.1.md`（8 原语 + manifest + capability + 无沙箱声明） | `375f44e` 起 | 2026-10-11 |
| **M1 内核单测** | `cargo test` → **9 passed / 0 failed**（原子写 / 路径穿越拒绝 / 私有目录跳过 / 删除进回收站 / 不覆盖 / frontmatter / 插件沙箱 / 插件存储 / 插件枚举）｜ 编译 3m06s | `C:\Users\AQUA\cargo-targets\zeronote` | 2026-10-11 |
| **M1 前端检查** | `pnpm exec tsc -b` → **0 错误**；`pnpm exec oxlint` → **0 error / 1 warning**（`set-state-in-effect`，数据加载场景，既有） | 工作区 | 2026-10-11 |
| **M1 窗口实跑** | `zeronote.exe` 启动成功，UI 完整渲染（侧栏 + ＋ / 中间空态「选择笔记库」/ 底部状态栏）；截图 `_shots\m1-01.png`（PrintWindow 抓取） | 运行中，PID 24128 | 2026-10-11 |
| **M2 内核侧模块** | `src\kernel\{event,command,store,plugin-host}.ts`（事件总线 / 命令注册表 / 插件存储 / 加载卸载与 capability 校验） | 工作区 | 2026-10-11 |
| **声明式 UI 渲染器** | `src\components\UIRenderer.tsx`（9 种 UINode 全覆盖 + 穷尽性检查）；子 agent 交付，**主管独立复跑**：tsc 0 错误、oxlint 0 error、`styles.css` 94 行新增 0 删除 | 工作区 | 2026-10-11 |
| 插件 API 横向调研 | `_research\插件API对比.md`（535 行，NoteGen / Lumina / SilverBullet / Yank Note / VS Code / Obsidian 六家带证据对比 + 7 条修订建议） | 工作区 | 2026-10-11 |

## 未完成项

- [ ] **M1 待用户点一眼**（窗口已开着）：选 `_test-vault` → 看到「日记 / 笔记」+ README → 编辑 `日记\2026-10-11.md` → 用外部编辑器确认磁盘变了；并且 `.zn\secret.md` **不应**出现在树里
- [ ] **M2 插件系统接进 App**：面板挂载（`UIRenderer`）、命令面板、插件开关 UI、`host.notify` 实现 —— 用 `examples\hello-plugin\` 验收「装上出现 / 卸下消失」
- [ ] 内核契约 v0.1 **待用户过目**（§1 八原语、§4 capability）
- [ ] UI 打磨（Tailwind + shadcn/ui 未引入，M1/M2 用自建 `--zn-*` token）
- [ ] M3 Android（子 agent 环境检查进行中，产出 `_research\android-env-check.md`）
- [ ] 第一批真插件清单（用户说「先保留」；契约 §7 已定：**灵感流必须用 UINode 写完**，作为主路压力测试）

## 唯一下一步

**M2：把 `plugin-host` 接进 `App.tsx`** —— 启动时 `listPluginDirs` → 逐个 `loadPlugin` → 面板用 `UIRenderer` 渲染 → 命令进命令面板（`Mod+K`）→ 设置里给每个插件一个开关。
**验收条件**：把 `examples\hello-plugin\` 复制到 `_test-vault\.zn\plugins\hello\` 后，命令面板出现「Hello：打个招呼」、侧栏出现「Hello 插件」面板；删掉该目录重启后全部消失且不报错。

## 授权边界

- 已授权：工作区内建目录/写文档/装 npm 依赖/构建运行本地应用/**并发调用子 agent**/git 提交/项目级配置（`.cargo\config.toml` 镜像）
- 需用户批准：装系统级软件、改 PATH / 注册表、发 GitHub 仓库、任何删除操作
- 明确不做：浏览器版；以 HTML 为笔记真源；把功能写进内核（一律走插件）

## 备注

- 关键决策来源：`_笔记应用选型\内核需求分析-v0.1.md` §8（用户原话）
- 复用边界：MIT / Apache 代码可直接搬（留声明）；NoteGen(GPL-3.0) / Yank Note(AGPL-3.0) **只借鉴不抄**
- 已确证的技术事实（本机）：Tauri 2 + Android 真机 dev 链路可用（见 `NoteGen-Self`）；Rust 编译产物**不能放在工作区内**（`CARGO_TARGET_DIR` 外移）
- **crates.io 直连实测仅 ~34 KB/s** ⇒ 项目级 `.cargo/config.toml` 走 `rsproxy.cn`（不动全局配置；回退 = 删该文件）
- **启动方式**：双击 `dev.cmd`（已设 PATH 与 `CARGO_TARGET_DIR`，`*.cmd` 强制 CRLF 由 `.gitattributes` 保证）；**不要用 DSH 后台 job 起**（会随会话回收）
- git 分支 `main`；本地身份用 `git config --local`
- 交接不保存密钥、不保存完整会话正文
