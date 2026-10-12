# ZeroNote 交接卡

> 生成 **2026-10-12 20:45**（23:45 补记 rev37 – rev42）· 本会话共 **20** 个提交 · **HEAD 以 `git log --oneline -1` 为准**
> （不钉具体 hash：这行上次就写错过，钉了反而误导；下面交付表里的历史 hash 不会变，可以留）
> 全部细节（证据截图、踩坑、逐条验收）在 **`HANDOFF.md`（rev36）**。

## 是什么 / 在哪

`C:\Users\AQUA\Documents\deepseek\ZeroNote` —— **空内核**本地 Markdown 笔记应用
（Tauri 2 + React 19 + Rust）。一切功能靠插件（库内 `.zn/plugins/<id>/`，装卸＝放/删一个文件夹）；
内核 10 原语 + 21 种 UINode + 若干插件挂载位（`editor-toolbar` / `editor-topbar` 等）。
**内核自带的界面**：12 条 Markdown 标记命令（`core.mark.*`）—— 桌面走编辑器右键「标记」子菜单，
移动端走软键盘正上方那条快捷栏（`src/kernel/markdown-marks.ts` 是唯一真相）。
**文件树（层级文件夹）**：目录节点右键 = 新建文件 / 新建文件夹 / 重命名 / 删除文件夹；
列表空白处右键 = 在**库根**新建；新建后立刻内联命名。**空目录能显示**靠内核 `list_dirs`
（`list_notes` 只报 `.md`，反推不出空目录）。

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
| `1a297b6` | **修基线第三条**：测试临时目录移出 `%TEMP%`（受限上下文写不了 ⇒ 12/18 用例假失败），改放仓库 `_tmp-test/` |
| `d40da1c` | **层级文件夹**（用户裁决「参考 NoteGen 结构」）：目录右键菜单（新建文件 / 新建文件夹 / 重命名 / 删除文件夹）＋**空目录显示**（新内核命令 `list_dirs`）＋新建后内联命名、新建笔记自动打开 |
| `a7504ef` | **剪切 / 复制 / 创建副本 / 粘贴 ＋ 文件树快捷键**：内核新增递归复制 `copy_entry`；剪贴板放应用级（复制撞名自动退「 副本」）；`Ctrl+X/C/V`、`F2`、`Del` **只在文件树内**生效 |
| `cf29e76` | **回收站**（用户报「没有入口」）：侧栏常驻入口 ＋ 主区页面（列表 / 恢复 / 彻底删除 / 清空）；内核 4 条新命令 ＋ `delete_note` 改存**原路径**（能恢复回原处）；顺带修 `.zn-main-panel` 顶部 20px 被热区吃掉、顶栏按钮点不动的真 bug |
| `17d59ac` | **第一个功能插件 `examples/outline-map`**（大纲 ⇄ 思维导图）：解析标题+列表 → 自算布局 → 静态 SVG（跟随主题）＋ 三视图 ＋ 导出 Mermaid mindmap；内核补 `core.panel.<id>` 命令（面板从 ☰ 菜单之外多一个键盘入口）；自带离线自测 `selftest.mjs` |
| `…+2` | **验收方式换代**：`dev.cmd` 给 WebView2 开 CDP 端口（只在 dev 脚本里，生产不含）＋ `tools/cdp.mjs`（零依赖）—— 按**选择器/文本**找元素、`Input.dispatchMouseEvent` 点击、`Page.captureScreenshot` 截图，**不再算坐标、不抢鼠标**。见 rev42 |

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
- ⚠️ **Rust 测试的临时目录在 `<repo>/_tmp-test/`，不是 `%TEMP%`** —— 跑测试的那个受限上下文
  写不了 `%TEMP%`（`Os code 5 PermissionDenied`，rev37）。`cargo test --lib` 现 **18 passed**。
  **别把它改回 `std::env::temp_dir()`**，否则 12/18 用例立刻假失败
- **手机 `33b676f6`**：装的是 `tauri android build --apk` 的**打包版**（内嵌 dist，
  **改前端必须重打包**；想要 HMR 得改用 `android-dev.cmd`）
- **仓库里有 1 个第三方补丁**：`patches/@atomic-editor__editor@0.6.2.patch` ——
  **空标题不隐藏 `#`**（`#` 后直接换行时，那行原本会变成空白，看着像内容丢了）。
  **升级这个库必须重打补丁**；另外**改了 node_modules 之后 vite 要重启**才会重新预打包
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
