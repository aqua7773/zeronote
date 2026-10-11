# ZeroNote 交接卡

> 生成 **2026-10-12** · 写卡时 HEAD `03d0e7b` · 工作区干净
> 这是**一屏版**；全部细节（证据截图、9 条踩坑、逐条验收）在 **`HANDOFF.md`（rev29）**。
>
> ⚠️ **本卡里的 commit / 行数 / 计数会随提交过时** —— 以 `git log --oneline -5`
> 和实际命令输出为准，别把卡里的数字当现状。

---

## 这是什么

空内核的**本地 Markdown 笔记应用**。Tauri 2.12.2（桌面 + Android）+ React 19 + Rust。
**一切功能靠插件**（库内 `.zn/plugins/<id>/`，装/卸就是放/删一个文件夹）；
内核只提供 **10 个原语**（fs / doc / index / event / command / view / store / host / service / editor）
和 **21 种 UINode**，插件用**语义化档位**（`gap` / `tone` / `variant`）声明界面，宿主映射到设计令牌。

---

## 现在的状态（一句话）

**插件能力已覆盖需求规格 §2.1–2.8 的大部分；剩下两项都卡在「需要用户授权的安全模型变更」上。**

---

## 30 秒上手

```powershell
cd C:\Users\AQUA\Documents\deepseek\ZeroNote

pnpm exec tsc -b            # 必须 0 错误
pnpm exec oxlint            # 必须**恰好 5 warnings**（基线，别加也别减）
cd src-tauri; cargo test    # 必须 14 passed
```

真机（Android · 设备 `33b676f6`，`adb devices` 确认在线）：

```powershell
# 改前端后的完整回路（约 3 分钟）
$env:CARGO_TARGET_DIR = "$env:USERPROFILE\cargo-targets\zeronote"
pnpm tauri android build --apk --target aarch64 --debug
adb install -r src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk
adb shell am force-stop com.aqua.zeronote.debug
adb shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity

# 只改插件（不用重新打包，直接推 + 重启）
adb push examples\<插件> /storage/emulated/0/Documents/ZeroNote/.zn/plugins/<插件>
```

---

## 硬约束（不许破）

1. **capability / 安全模型的改动**（信任根、授权路径、工具白名单、提权入口）
   → **必须先拿到用户对「具体方案」的同意**才可动手。方向同意 ≠ 方案同意。
2. 每批交付纪律：`tsc -b` 0 错误 + `oxlint` 5 warnings 基线 + **真机截图/命令证据** + 自主提交 + HANDOFF 更新。
3. **手机截图直接 `adb shell screencap`** —— 用户自己开着窗口，**不要**用 `gentle_*`。
4. **内核保持薄**：能当插件做的事不要塞进内核；新能力优先做成**前置插件**（`service` 原语）。
5. **静默失效比报错危险** —— 测试/订阅"看起来成功但永不触发"最坑。动过测试后看
   `cargo test --lib` 的 `running N tests` **数字**，别只看 `test result: ok`（HANDOFF 坑 ⑧）。

---

## 唯一待裁决（**阻塞项，别自行开工**）

| 项 | 我提的具体方案 | 解锁 |
|---|---|---|
| **⑧ `net` 授权通道** | 设置页逐插件开关 + 权限存 `.zn/permissions.json`；契约 **§4 诚实改写**：明确写"这是**可绕过的边界**（插件跑同一上下文），作用是**知情与承诺**，**不是隔离**" | 规格 2.4 同步 · 2.5 WebDAV · 2.6 局域网传输 · 2.7 AI 标签 |
| **⑩ WebView 逃生口** | `<iframe sandbox="allow-scripts">` + 主题 token 注入；**先测 CSP** 会不会打断 `dep-katex` 的 CDN 加载，断了就只做主题注入 | 规格 2.4 视频首帧 · 画布类插件 |

> 这两项已连续问 5 轮、未获回复 ⇒ **按纪律不推进**。
> （现状是"声明即拒、不声明却能跑"—— 比 Obsidian 的坦诚声明更糟，所以 ⑧ 值得做。）

---

## 已完成（9 轮，**别重做**）

```
① fs 文件夹(mkdir/move) ✅  ② 编辑器工具栏挂载点 ✅  ③ index 标签(抽取/聚合/筛选) ✅
④ index 分区 ✅            ⑤ host.saveFile(含二进制) ✅  ⑥ 编辑器标记 ✅
⑦ 懒激活机制 ✅            ⑧ net 授权通道 ⬜ 待授权   ⑨ 安全存储(前置插件) ✅
⑩ WebView 逃生口 ⬜ 待授权
```

**额外成果**：`service` 前置插件原语 · `editor` 原语 · **命令接管**（插件可覆盖 `core.newNote` 等内核命令）
· 能力对照文档 · 修复"插件重载竞态幽灵"（一次打断会污染之后所有重载）。

---

## 读哪份文档

| 想知道 | 读 |
|---|---|
| **全部细节 / 证据截图 / 9 条踩坑** | `HANDOFF.md`（rev29，432 行） |
| **内核 10 个原语的准确签名 + 契约边界** | `docs/内核契约-v0.1.md` |
| **规格 §2.1–2.8 逐条「能做 / 不能做 / 缺什么」** | `docs/能力对照-规格2.1-2.8.md` |
| **16 个示例插件怎么用** | `examples/`（每个文件头都有注释表格；真机装了其中 11 个） |

---

## 下一步的三种选择

1. **用户授权 ⑧**（收益最大）→ 解锁四个规格模块
2. **用户授权 ⑩** → 解锁视频首帧 / 画布类
3. **都不授权** → 不涉安全的收尾已基本做完；可考虑：给 `host.saveFile` 接
   `@tauri-apps/plugin-fs` 以支持 Android 的 SAF、或与 atomic 协商 `[[x]]` 的接管点。
