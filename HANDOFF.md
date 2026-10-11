# 项目交接

revision: 1
更新时间: 2026-10-11
标识: DSH-SUPERVISOR-V1
项目: ZeroNote

> **主管模式尚未启用**（用户未说「负责 ZeroNote 项目」）。当前由普通会话直接执行；启用后本文件改为只有主管写。

## 当前目标

做一个**空内核**的本地 Markdown 笔记应用：内核只负责 `.md` 读写 / 编辑 / 本地存储 / 插件宿主，其余功能全部插件化、可独立装卸升级；桌面 + Android 双端。

## 验收证据

| 项 | 证据（命令 / 输出 / 文件） | 基线版本 | 时间 |
|---|---|---|---|
| 需求分析冻结 | `_笔记应用选型\内核需求分析-v0.1.md`（用户确认技术方案「全按推荐」） | — | 2026-10-11 |
| 内核契约草案 | `docs\内核契约-v0.1.md`（8 原语 + manifest + capability） | 待首次 commit | 2026-10-11 |
| 目录与仓库 | `git init` 完成（分支 `main`，本地身份 `ZeroNote <self@local>`） | 首次 commit `24d7c59` | 2026-10-11 |
| M1 前端类型检查 | `pnpm exec tsc -b` → **0 错误** | 工作区（未提交） | 2026-10-11 |
| M1 前端 lint | `pnpm exec oxlint` → **0 error / 1 warning**（`set-state-in-effect`，数据加载场景） | 工作区（未提交） | 2026-10-11 |
| M1 脚手架 | Vite 8 + React 19.3 + Tauri CLI 2.12.2 + CodeMirror 6 + `tauri-plugin-dialog` 装好；`src-tauri` 已 init | 工作区（未提交） | 2026-10-11 |

## 未完成项

- [ ] 内核契约 v0.1 **待用户过目**（用户尚未逐条看过）
- [ ] M1 桌面骨架 —— **代码已写完，验收未做**：前端 `tsc -b` 0 错误、`oxlint` 0 error / 1 warning；Rust 侧依赖下载编译中，`cargo test` 与 GUI 实跑待做
- [ ] UI 打磨（Tailwind + shadcn/ui 尚未引入，M1 先用自建 CSS token 保证风格统一）
- [ ] 第一批插件清单（用户说「先保留」）

## 唯一下一步

按 `docs\内核契约-v0.1.md` §6 做 **M1 桌面骨架**：
`pnpm create tauri-app` → React 19 + TS + Vite 脚手架 → 接入 Tailwind + shadcn → 实现 `fs` / `doc` 两原语 → 内置文件树 + CM6 编辑器。
**验收条件**：打开一个含 `.md` 的文件夹，编辑后保存，用外部编辑器看磁盘文件确实被改；关掉应用再打开，内容一致。

## 授权边界

- 已授权：在工作区新建 `ZeroNote\`、git 初始化、写文档、装 npm 依赖、构建与运行本地应用
- 需用户批准：装系统级软件、改 PATH / 注册表、发 GitHub 仓库、任何删除操作
- 明确不做：浏览器版；以 HTML 为笔记真源；把功能写进内核（一律走插件）

## 备注

- 关键决策来源：`_笔记应用选型\内核需求分析-v0.1.md` §8（用户原话）
- 复用边界：MIT / Apache 代码可直接搬（留声明）；NoteGen(GPL-3.0) / Yank Note(AGPL-3.0) **只借鉴不抄**
- 已确证的技术事实（本机）：Tauri 2 + Android 真机 dev 链路可用（见 `NoteGen-Self`）；Rust 编译产物**不能放在工作区内**（`CARGO_TARGET_DIR` 必须外移）
- 交接不保存密钥、不保存完整会话正文
