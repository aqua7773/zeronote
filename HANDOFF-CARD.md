# ZeroNote 交接卡

> 生成 **2026-10-12 20:45** · 本会话共 **13** 个提交 · **HEAD 以 `git log --oneline -1` 为准**
> （不钉具体 hash：这行上次就写错过，钉了反而误导；下面交付表里的历史 hash 不会变，可以留）
> 全部细节（证据截图、踩坑、逐条验收）在 **`HANDOFF.md`（rev36）**。

## 是什么 / 在哪

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用
（Tauri 2 + React 19 + Rust）。一切功能靠插件（库内 `.zn/plugins/<id>/`，装卸＝放/删一个文件夹）；
内核 10 原语 + 21 种 UINode + 若干插件挂载位（`editor-toolbar` / `editor-topbar` 等）。
**内核自带的界面**：12 条 Markdown 标记命令（`core.mark.*`）—— 桌面走编辑器右键「标记」子菜单，
移动端走软键盘正上方那条快捷栏（`src/kernel/markdown-marks.ts` 是唯一真相）。

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
| `70ef21a` | **Markdown 标记收进内核**：12 条 `core.mark.*` + 手机底栏/顶部提示条 + 右键「标记」子菜单（插件 `examples/md-toolbar` 退役） |
| `aff0056` | **收窄入口**（用户裁决）：桌面只留右键「标记」子菜单，移动端只留键盘上方快捷栏；顺带修 `.zn-titlebar-hotzone` 压顶部吃掉点击的真 bug |

## ⚠️ 未决问题（下个会话第一件事）

**① 没有阻塞项 —— 桌面与移动端都已实测通过。**（记下来是因为这块踩过一次：手机默认跑的是打包版）

- 入口**一桌一移**：桌面 = 编辑器右键 →「标记 ›」→ 12 项；移动端 = 软键盘正上方那条 12 按钮栏。
  **两端都已实测** —— 移动端证据 `_shots/android-markbar.png`、`android-keyboard-bar.png`
  （键盘弹起时它正好在键盘正上方）、`android-bar-insert.png`（点「B」磁盘 `0 → 4` 字节）
- ⚠️ **手机默认装的是打包版**（内嵌 dist）⇒ 改前端**必须重打包**才生效。
  要 HMR 就起 **`android-dev.cmd`**（用 WMI 起、**别用后台 job**，会随会话回收；前提是桌面 dev 开着；
  手机将通过 `192.168.1.3:1420` 连桌面 vite）。从起到手机跑起来约 **2–3 分钟**
- **判据**（别靠猜）：`adb logcat` 里出现 `node_modules/.vite/deps/...` = dev/HMR 模式；
  打包版不会去连 1420，主机 `netstat` 里也没有手机 IP 的连接

**② 上一轮那条"点顶部提示条 `Ctrl+B` 会关掉笔记"—— 载体已撤，疑因已定位。**

- 顶部提示条按用户要求**整个删掉了**，所以症状不复存在
- 但本轮查清了**它为什么点不动**：`.zn-titlebar-hotzone`（`position:absolute; height:20px;
  z-index:59`，唤出标题栏 + 兜底拖动区）**压在窗口顶部 20px**，而提示条正落在那 20px 里
  ⇒ 点上去实际点在热区上（还是 drag-region）。**错位点击**很可能就是"笔记被关"的真因
- 已修：`.zn-editor-topbar` 加 `position:relative; z-index:61` + `align-self:flex-start`
  （只占内容宽，热区仍可用于唤出标题栏）。**先别再按旧线索重查** —— 见 `HANDOFF.md` rev36

**另有一个已修的真实缺陷**：提示条右端与编辑区右上角那个绝对定位的「关闭这篇笔记」（`z-index:5`）
会**重叠**（点最右按钮实际点到「关闭」）。提示条虽已撤，但 `.zn-editor-topbar`（插件仍可挂）
的 `padding-right: 72px` 保留着（`5a31364`）。

## 环境现状（别踩）

- **桌面 dev 在跑**：`tauri dev`（PID 18800，vite `http://localhost:1420`），日志 `.self-logs/desktop-dev.log`
- **`android-dev` 也在跑**（WMI 起的，不自起 vite、直连桌面 1420），日志 `.self-logs/android-dev.log`
- **手机 `33b676f6`（ARIA 24069RA21C）当前装的是 dev 版**（这次为验移动端快捷栏装的）⇒ 改前端即时生效。
  **默认装法仍是打包版**（`tauri android build --apk`，内嵌 dist，改前端必须重打包）
- **测试库 `_tmp-vault-tb/`**（`probe.md` + `untitled-20261012-195714.md`）；`.zn/plugins` 现在是**空的**
  —— `md-toolbar` 已随「标记收进内核」退役（`examples/md-toolbar/` 也删了，git 历史 `70ef21a` 可查）。
  要再测插件：把 `.zn/plugins/<id>` junction 到 `examples/<id>` 即可（改完**切库一次**生效）
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

`HANDOFF.md`（**rev36**）· `docs/内核契约-v0.1.md`（**§2.1.2 = 内核自带的 Markdown 标记**）·
`docs/能力对照-规格2.1-2.8.md` · `docs/插件能力盘点-2026-10-12.md` · `examples/`（插件示例；
`md-toolbar` 已退役删除）
