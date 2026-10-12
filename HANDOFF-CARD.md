# ZeroNote 交接卡

> 生成 **2026-10-12 20:05** · HEAD **`5a31364`** · 本会话共 10 个提交
> ⚠️ 卡里的 commit/计数会过时 —— 以 `git log --oneline -5` 与实测为准。
> 全部细节（证据截图、踩坑、逐条验收）在 **`HANDOFF.md`（rev35）**。

## 是什么 / 在哪

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用
（Tauri 2 + React 19 + Rust）。一切功能靠插件（库内 `.zn/plugins/<id>/`，装卸＝放/删一个文件夹）；
内核 10 原语 + 21 种 UINode + 若干插件挂载位（含本轮新增的 `editor-topbar`）。

## 验收基线（三条都要过）

```powershell
cd C:\Users\AQUA\Documents\deepseek\ZeroNote
pnpm exec tsc -b                  # 必须 0 错误
pnpm exec oxlint                  # 必须恰好 4 warnings
cd src-tauri; cargo test --lib    # 必须 18 passed（看 `running N tests` 数字）
```

## 本会话交付（10 个提交，逐条可回溯）

| 提交 | 内容 |
|---|---|
| `d65787c` | 最近库过期记录自动清理 + 提示（缺口 3） |
| `4d0279f` | 插件**平台门**：桌面／移动端／双端三档声明 + 取值校验 |
| `be5faac` | **沙箱「搁置」**（用户裁决）+ 修正「CSP 拦裸 fetch」这条失效结论 |
| `ec822ad` | **release 打包版加载插件**首次验证（此前只验过 dev 与 Android APK） |
| `0ccecb2` | 纠正误判：右栏「被挤窄」是**截图越界**截到了后面的 DSH 窗口 |
| `6fc1310` | 侧栏显示名＝`frontmatter.title → 正文首行 → 文件名` |
| `669604a` | **Markdown 快捷输入栏**（手机键盘正上方）＋内核新原语 `doc.insertAt` |
| `f1e38dd` | 手机键盘遮挡修复（`visualViewport`；`adjustResize` 在 targetSdk 35 无效） |
| `812f80f` | **编辑器顶部「可开关的快捷键提示」** ＋ 修 Rust 漏掉 junction 插件目录 |
| `5a31364` | 提示条右侧留白，避免与「关闭这篇笔记」按钮重叠 |

## ⚠️ 未决问题（下个会话第一件事）

**用户报告：点编辑器顶部提示条最左侧的「`Ctrl+B` 粗体」会关闭当前笔记。**

- 我**复现不了**：自己点同一按钮 ⇒ `probe.md` **+4 字节**（`****` 插入成功），笔记没被关
- 用户复现那轮的后台日志**同样**是：`probe.md` 35B → 39B、PID 未变、无新文件
- ⇒ **两侧观测不一致，原因未查清**（不是"没查"，是"查到的现象和你看到的相反"）
- **证据已留存，可直接查**：
  - `_shots/watch-frames.log` —— 20:00:04 → 20:00:38 的完整状态时间线（35B→39B）
  - `_shots/frames/f-2000*.png` —— **32 帧截图**，每 1.5s 一张（20:00:35 ~ 20:00:52）
  - `_shots/watch-repro.log` —— 更早一轮（19:58:10 / 19:58:33），同样 +4 字节
- **建议排查顺序**：① 先看 `_shots/frames/` 里 20:00:35~38 那几帧，确认"被关"那一刻的画面
  ② 在 `closeNote()`（`App.tsx:757`）与 `core.closeNote` 命令上加临时日志，看是谁调的
  ③ 怀疑点：`hotkeys-js` 的 `Mod+W`（关闭笔记）被误触发

**另有一个已修的真实缺陷（与上面的现象无关）**：提示条右端与编辑区右上角那个绝对定位的
「关闭这篇笔记」（`z-index:5`）**重叠** ⇒ 点提示条最右侧的按钮实际点到「关闭」，
我实测复现过。已给 `.zn-editor-topbar` 加 `padding-right: 72px` 让位（`5a31364`）。

## 环境现状（别踩）

- **桌面 dev 在跑**：`tauri dev`（PID 18800，vite `http://localhost:1420`），日志 `.self-logs/desktop-dev.log`
- **测试库 `_tmp-vault-tb/`**（`probe.md` + `untitled-20261012-195714.md`）；它的
  `.zn/plugins/md-toolbar` 是 **junction → `examples/md-toolbar`** ⇒ 改插件后**切库一次**即生效（不用拷）
- **手机 `33b676f6`**：装的是 `tauri android build --apk` 的**打包版**（内嵌 dist，
  **改前端必须重打包**；想要 HMR 得改用 `android-dev.cmd`）
- `_shots/`、`_tmp-*/`、`examples/*/store.json` 都在 `.gitignore` 内

## 硬约束（不许破）

1. **capability／安全模型变更 → 先拿用户对「具体方案」的同意**（方向同意 ≠ 方案同意）
2. 每批交付：`tsc` 0 + `oxlint` 4 + **实测/截图证据** + 自主提交 + HANDOFF 更新
3. 手机截图走 `adb shell screencap`；**`adb shell input` 吃物理像素，而截图看的是预览图**（要乘 `物理宽/预览宽`）
4. **内核保持薄**（能当插件做的别塞内核）；**静默失效比报错危险**（看数字，不只看 "ok"）
5. 桌面 GUI 操作用 `gentle_*`（用户活跃时加 `force: true`）；
   截图区域按窗口 `rect` **向内缩 ~10px**（DWM 边框会截进窗口外的内容）

## 细节读哪

`HANDOFF.md`（**rev35**）· `docs/内核契约-v0.1.md` · `docs/能力对照-规格2.1-2.8.md` ·
`docs/插件能力盘点-2026-10-12.md` · `examples/`（本轮新增 `md-toolbar`）
