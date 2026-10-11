# ZeroNote —— 空内核的本地 Markdown 笔记应用

> 一句话：**内核只做四件事**（`.md` 读写 / 编辑 / 本地存储 / 插件宿主），其余功能全是插件，可独立装卸升级。
> 设计文档：`docs\内核契约-v0.1.md` ｜ 交接件：`HANDOFF.md`

---

## 现在能做什么（M1）

- **选一个文件夹当笔记库** → 左侧文件树（递归、支持中文目录、跳过 `.zn/` 等私有目录）
- 点开 `.md` → **CodeMirror 6** 编辑（Markdown 语法高亮 / 行号 / 历史撤销）
- **保存**：停笔 800ms 自动保存 ｜ `Ctrl+S` 手动 ｜ 关窗前保底一次
- **保存状态可见**：未保存 / 保存中 / 已保存 / **保存失败**（失败绝不显示"已保存"）
- **原子写**：先写临时文件再 rename，失败不动原文件
- 外部编辑器改了文件 → 树自动刷新（3 秒轮询兜底）
- 新建笔记 `＋`（`untitled-<时间戳>.md`，已存在绝不覆盖）
- 删除 = 移入 `.zn/trash/`，不是物理删除

## 怎么跑

```powershell
$env:Path = "$env:USERPROFILE\.cargo\bin;" + $env:Path
# 本机铁律：Rust 编译产物必须在工作区之外，否则 cl.exe 报 D8050
$env:CARGO_TARGET_DIR = 'C:\Users\AQUA\cargo-targets\zeronote'
cd C:\Users\AQUA\Documents\deepseek\ZeroNote
pnpm tauri dev
```

只跑前端（不启动桌面壳，`invoke` 会失败，仅用于看样式）：

```powershell
pnpm dev          # http://localhost:1420
```

### Android（真机）

```powershell
# 一次性前置（换机才需要）
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
pnpm tauri android init --ci

# 日常启动（WMI 起进程 + 日志落 .self-logs\android-dev.log）
android-dev.cmd
```

三条已经固化在配置里的硬前置（踩过的坑）：

1. **`vite.config.ts` 的 `server.host: true`** —— 真机经局域网 IP 访问 dev server，否则卡在 "Waiting for your frontend dev server"
2. **`gradle-wrapper.properties` 指向腾讯镜像** —— 官方 `services.gradle.org` 在本机实测 5 分钟 0 字节
3. **Android 的默认库 = 应用数据目录**（`<appDataDir>/vault`）—— 手机访问不了 PC 路径，也拿不到任意文件夹（SAF 限制）

> 真机截图验证：`adb shell screencap -p /sdcard/zn.png` + `adb pull /sdcard/zn.png`

检查与测试：

```powershell
pnpm exec tsc -b                      # 前端类型检查
cd src-tauri; cargo test              # 内核单元测试（原子写 / 路径穿越 / 私有目录）
```

## 目录结构

```
ZeroNote\
  docs\内核契约-v0.1.md      ← 插件与内核之间唯一的接口（8 原语）
  HANDOFF.md                ← 交接件：目标 / 证据 / 未完成 / 唯一下一步
  src\
    kernel\contract.ts      ← 契约类型（内核与插件的唯一接口）
    kernel\fs.ts            ← fs 原语的前端实现（全部落到 Rust 命令）
    components\FileTree.tsx
    components\MarkdownEditor.tsx
    App.tsx main.tsx styles.css
  src-tauri\
    src\lib.rs              ← 内核 Rust 侧：文件命令 + 原子写 + 单元测试
    capabilities\default.json
    tauri.conf.json
  _test-vault\              ← M1 验收夹具（不入 git）
```

## 技术栈

| 层 | 选型 |
|---|---|
| 壳 | Tauri 2（Rust 1.99） |
| 前端 | React 19 + TypeScript + Vite 8 |
| 编辑器 | CodeMirror 6 |
| 数据 | `.md` + YAML frontmatter；库内相对路径即 ID；原子保存 |
| 插件 | 声明式 UI（宿主渲染）+ 进程内 TS 宿主（M2） |
| 许可证 | MIT |

## 铁律

1. 内核里**不出现**「标签 / 同步 / AI / 画布 / 灵感流」这些词
2. 只有 `.md` + frontmatter，**没有私有笔记格式**
3. 所有写入原子；删除进 `.zn/trash/`；只接受库内相对路径
4. 改契约 → 必须同步改 `docs\内核契约-v0.1.md` 并升版本
