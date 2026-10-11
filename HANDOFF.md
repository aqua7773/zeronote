# 项目交接

revision: 3
更新时间: 2026-10-11
标识: DSH-SUPERVISOR-V1
项目: ZeroNote

> **主管模式尚未启用**（用户未说「负责 ZeroNote 项目」）。当前由普通会话直接执行；用户已授权**并发调用子 agent**。

## 当前目标

做一个**空内核**的本地 Markdown 笔记应用：内核只负责 `.md` 读写 / 编辑 / 本地存储 / 插件宿主，其余功能全部插件化、可独立装卸升级；桌面 + Android 双端。

## 验收证据

| 项 | 证据（命令 / 输出 / 文件） | 基线版本 | 时间 |
|---|---|---|---|
| 需求分析冻结 | `_笔记应用选型\内核需求分析-v0.1.md`（用户确认「全按推荐」） | — | 2026-10-11 |
| 内核契约 v0.1 | `docs\内核契约-v0.1.md`（8 原语 + manifest + capability + 无沙箱声明 + §7 未决 6–9） | — | 2026-10-11 |
| **M1 内核单测** | `cargo test` → **9 passed / 0 failed**（原子写 / 路径穿越拒绝 / 私有目录跳过 / 删除进回收站 / 不覆盖 / frontmatter / 插件沙箱 / 插件存储 / 插件枚举） | `C:\Users\AQUA\cargo-targets\zeronote` | 2026-10-11 |
| **M1 前端检查** | `pnpm exec tsc -b` → 0 错误；`oxlint` → 0 error（warning 均为 `set-state-in-effect`，数据加载场景） | — | 2026-10-11 |
| **M1 窗口实跑** | `_shots\m1-01.png`：侧栏 + 空态 + 状态栏完整渲染 | 运行中 | 2026-10-11 |
| **M2 全链路（自动验证）** | `_shots\m2-02.png` 一张图证明 4 件事：① 文件树递归含中文目录 ② **`.zn` 私有目录被跳过** ③ 插件被加载并列出（`Hello 示例插件 v0.1.0` + capability 徽章 `command · view:sidebar`）④ 插件注册的 tab「Hello 插件」出现，状态栏「插件 1/1」+「插件日志（2）」 | 运行中，`devUrl` 临时带 `?vault=` | 2026-10-11 |
| 子 agent 调研 | `_research\插件API对比.md`（535 行，六家对比 + 7 条建议）、`_research\android-env-check.md`（185 行 / 25 项） | — | 2026-10-11 |
| 声明式 UI 渲染器 | `src\components\UIRenderer.tsx`；主管独立复跑 tsc 0 / lint 0 error / styles.css 追加 94 行 0 删除 | — | 2026-10-11 |

## 未完成项

- [ ] **M2 最后一步（需人眼 1 次点击）**：右栏点「**Hello 插件**」tab → 应看到「我是 hello 插件 / 这段界面由声明式 UI 渲染 / 打个招呼」；点「打个招呼」→ 应弹 toast。再按 `Ctrl+K` → 命令面板应列出 5 条 `core.*` + 1 条 `hello.say`
- [ ] **验收后把 `devUrl` 改回**（现在是 `http://localhost:1420/?vault=C:/.../\_test-vault`，方便本轮验证；改回 `http://localhost:1420`）
- [ ] M3 Android —— 环境检查已完成（`_research\android-env-check.md`），**2 项阻塞待用户批准**：① `rustup target add aarch64-linux-android …` ② `pnpm tauri android init`
- [ ] 内核契约 v0.1 **待用户过目**（§1 八原语、§4 capability、§7 未决）
- [ ] UI 打磨（Tailwind + shadcn/ui 未引入，当前用自建 `--zn-*` token，风格已统一）
- [ ] 第一批真插件（用户说「先保留」）；契约 §7 已定规矩：**灵感流必须用 `UINode` 写完**，作为主路压力测试
- [ ] `index` 原语（v0.2，现在调用会抛「未实现」）；`doc.on` 文档事件订阅（v0.2）

## 唯一下一步

**让用户点一次「Hello 插件」tab 验收 M2** → 通过后二选一：
- **A（推荐）**：批 M3 的 2 条命令，先打通 Android 双端（系统件已全齐，只缺 target 与 android init）
- **B**：先写第一个真插件（灵感流，用 `UINode`），把主路压到真实需求上

## 授权边界

- 已授权：工作区内建目录/写文档/装 npm 依赖/构建运行本地应用/**并发调用子 agent**/git 提交/项目级配置（`.cargo\config.toml` 镜像）/URL 参数启动
- 需用户批准：装系统级软件、改 PATH / 注册表、**`rustup target add`**、**`tauri android init`**、发 GitHub 仓库、任何删除操作
- 明确不做：浏览器版；以 HTML 为笔记真源；把功能写进内核（一律走插件）

## 备注

- 关键决策来源：`_笔记应用选型\内核需求分析-v0.1.md` §8（用户原话）
- 复用边界：MIT / Apache 代码可直接搬（留声明）；NoteGen(GPL-3.0) / Yank Note(AGPL-3.0) **只借鉴不抄**
- 本机铁律：Rust 产物必须 `CARGO_TARGET_DIR` 外移（工作区内编 C 依赖报 MSVC D8050）；crates.io 直连仅 ~34 KB/s ⇒ 项目级 `.cargo\config.toml` 走 rsproxy
- **启动方式**：双击 `dev.cmd`；**不要用 DSH 后台 job 起**（会随会话回收）。改 `src-tauri\tauri.conf.json` 会被 tauri CLI 自动检测并重启应用；改 `src/**` 只热更新
- **已移除 StrictMode**（`src\main.tsx`）：插件加载是异步 + 副作用密集，双调用会与异步清理竞争导致面板重复注册
- git 分支 `main`；本地身份 `git config --local`
- 交接不保存密钥、不保存完整会话正文
