# ZeroNote —— 空内核的本地 Markdown 笔记应用

> 一句话：**内核只做四件事**（`.md` 读写 / 编辑 / 本地存储 / 插件宿主），其余功能全是插件，可独立装卸升级。
> **数据就是你文件夹里的 `.md`** —— 没有数据库、没有服务器、没有账号。

**现状（2026-10-17）**：桌面（Windows）＋ Android 双端跑通；插件系统 v0.1（10 原语 / 21 种 UINode / 真窗口 / 整窗接管）；
29 个示例插件；文档阅读器、导入导出、回收站、层级文件夹已落地。详细证据见 `HANDOFF.md`，当前状态见 `HANDOFF-CARD.md`。

---

## 现在能做什么（2026-10）

| 模块 | 能做什么 |
|---|---|
| **库与文件** | 选一个文件夹当库（桌面可记住最近库、安卓支持多库）；层级文件夹、空目录可见、多选、剪切 / 复制 / 粘贴 / 重命名；桌面双击 `.md` 用 ZeroNote 打开（文件关联 + 单实例） |
| **编辑** | CodeMirror 6 即时渲染；12 条 Markdown 标记命令（`core.mark.*`，桌面右键「标记」/ 手机键盘上方快捷栏）；查找 `Ctrl+F` / 替换 `Ctrl+H`；每笔记独立撤销栈；光标与滚动位置记忆 |
| **保存** | 停笔 800ms 自动保存 ｜ `Ctrl+S` ｜ 关窗前保底；写盘前与磁盘做**行级三方合并**（插件写了同一文件也不互相覆盖）；原子写（临时文件 + rename） |
| **回收站** | 逻辑删除进 `.zn/trash/`（可恢复回原处）；物理删除两步走 + 二次确认 |
| **搜索** | 全文内存索引（多关键词 AND + 中文子串）；命令面板 `Ctrl+P`；快速切换 `Ctrl+O` |
| **插件** | 库内 `.zn/plugins/<id>/` 即插件；`☰ → 插件管理 → 重新扫描` 即生效；10 原语、21 种 UINode、5 个挂载位、独立窗口（`view.openWindow`）、整窗接管（`view.overrideShell`）、懒激活、四种入口形态、多文件 CJS |
| **文档阅读器** | PDF / EPUB / MOBI / AZW3 / FB2 / CBZ / TXT 只读打开；文件树里统一收进虚拟「文档 N」分组，文件位置不动 |
| **导入导出** | 导入 md / txt / html / docx / epub / pdf；导出 txt / html / docx / png / md→pdf（导出 HTML 后用浏览器打印，WebView2 不支持直接打印） |
| **稳定性** | 原生看门狗：插件卡死 → 应用闪退（退出码 101）→ 下次启动自动禁用该插件并提示；内核自愈：快照 + `修复内核.cmd` 从备份重建 |
| **主题** | 亮 / 暗 / 跟随系统三态 |

---

## 怎么跑（桌面，约 10 分钟；首次编译 Rust 多等 10–20 分钟）

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
# 本机铁律：Rust 编译产物必须在工作区之外，否则 cl.exe 报 D8050
$env:CARGO_TARGET_DIR = 'C:\Users\AQUA\cargo-targets\zeronote'
cd C:\Users\AQUA\Documents\deepseek\ZeroNote
pnpm install
pnpm tauri dev        # 或双击 dev.cmd（带 CDP 调试端口 + 看门狗关闭）
```

只跑前端（不启动桌面壳，`invoke` 会失败，仅用于看样式）：

```powershell
pnpm dev          # http://localhost:1420
```

## Android（真机）

```powershell
# 一次性前置（换机才需要）
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
pnpm tauri android init --ci

# 日常启动（WMI 起进程 + 日志落 .self-logs\android-dev.log）
android-dev.cmd
```

三条已经固化在配置里的硬前置（踩过的坑）：

1. **`vite.config.ts` 的 `server.host: true`** —— 真机经局域网 IP 访问 dev server
2. **`gradle-wrapper.properties` 指向腾讯镜像** —— 官方源在本机实测 5 分钟 0 字节
3. **Android 默认库 = 应用数据目录**（`<appDataDir>/vault`）；要放公共存储就必须手动开「所有文件访问」（系统不弹窗）

安装与权限步骤见 `docs/Android安装说明.md`。

## 自检（提交前必过三条基线）

```powershell
pnpm exec tsc -b                 # 0 错误
pnpm exec oxlint                 # 恰好 4 warnings
cd src-tauri; cargo test --lib   # 21 passed
# 或一键：pwsh -File scripts\verify.ps1（会打印真实数字）
```

---

## 目录结构

```
ZeroNote\
  src\                 前端全部代码：主壳 + 内核原语实现 + 组件
  src-tauri\           Rust 原生内核：文件命令 / 原子写 / 回收站 / 看门狗
  examples\            29 个示例插件（功能主力；部分只是验收夹具）
  tools\               CDP 自动验收脚本（不碰用户鼠标）
  scripts\             内核快照 / 恢复 / 一键自检
  public\vendor\       内置离线渲染库（pdf.js / foliate / mammoth / marked / …）
  docs\                架构原则 / 内核契约 / 需求 / 安装说明 / 调研
  HANDOFF.md           交接件：逐版本「做了什么 + 证据 + 踩坑」
  HANDOFF-CARD.md      交接卡：当前状态一屏版
```

## 技术栈

| 层 | 选型 |
|---|---|
| 壳 | Tauri 2（Windows 用系统 WebView2，不含 Chromium） |
| 前端 | React 19 + TypeScript + Vite 8 |
| 编辑器 | CodeMirror 6 + `@atomic-editor/editor`（即时渲染） |
| 数据 | `.md` + YAML frontmatter；库内相对路径即 ID；无数据库 |
| 插件 | 库内目录 + Blob 动态 import（与宿主同上下文） |
| 原生 | Rust（文件命令 / 原子写 / 看门狗） |
| 许可证 | MIT |

## 文档地图

| 想知道 | 读 |
|---|---|
| 文档全家桶谁说了算 | `docs/README.md`（索引 + 权威矩阵） |
| 为什么这样设计（最高权威） | `docs/架构原则-2026-10-13.md` |
| 插件能调什么接口 | `docs/内核契约-v0.1.md`（与 `src/kernel/contract.ts` 一一对应） |
| 项目现在到哪了 | `HANDOFF-CARD.md` |
| 某个功能怎么做的、踩过什么坑 | `HANDOFF.md`（按 rev 查） |
| 目标需求（19 章） | `docs/requirements/current.md` |
| 文档怎么写 | `docs/文档编写规范.md` |

## 铁律

1. 内核里**不出现**「标签 / 同步 / AI / 画布 / 灵感流」这些词
2. 只有 `.md` + frontmatter，**没有私有笔记格式**
3. 所有写入原子；删除进 `.zn/trash/`；只接受库内相对路径
4. 改契约 → 必须同步改 `docs/内核契约-v0.1.md` 并升版本
