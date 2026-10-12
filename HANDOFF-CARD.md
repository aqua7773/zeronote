# ZeroNote 交接卡

> 生成 **2026-10-12 20:45**（2026-10-13 00:20 补记 rev37 – rev44；同日再补记 rev45、rev46 – rev49）· **提交数与 HEAD 一律看 `git log`**
> （这张卡在"写死数字"上错过七次 —— 最后那次甚至在"不写死数字"这句话里又写了一个，已彻底删掉）
> （不钉具体 hash：这行上次就写错过，钉了反而误导；下面交付表里的历史 hash 不会变，可以留）
> 全部细节（证据截图、踩坑、逐条验收）在 **`HANDOFF.md`（rev49）**。

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
cd src-tauri; cargo test --lib    # 必须 21 passed（2026-10-13 实测；旧卡片写的 18 是过时数字）
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
| `9aec96a` | **验收方式换代**：`dev.cmd` 给 WebView2 开 CDP 端口（只在 dev 脚本里，生产不含）＋ `tools/cdp.mjs`（零依赖）—— 按**选择器/文本**找元素、`Input.dispatchMouseEvent` 点击、`Page.captureScreenshot` 截图，**不再算坐标、不抢鼠标**。见 rev42 |
| `rev44` | **内核 UI 承载能力盘点 ＋ 交接**（没改代码）：查出三条系统性缺口 **U1** 插件不能自开窗口 / **U2** 无自定义渲染入口 / **U3** `doc` 改不了任意区间且 `doc.on` 是**空桩**；用户裁决放弃"声明式唯一主路"⇒ U2 获批。**路线：先完善内核，再做插件** |
| `rev45` | **内核增强第 1 步：U3 修完** —— `doc.replaceRange(from,to,text)`（区间替换，导图回写笔记的基础）＋ `doc.on` 从**空桩**接上真事件（`open/change/save/close`，`change` **去抖 200ms**，切笔记时先兑现挂起的 change 再播 open ⇒ 不乱序）。验收夹具 `examples/doc-edit-probe/`，CDP ＋ **磁盘为真源**：区间替换后与旧文共同前缀 37/后缀 22 ⇒ 只改了 3 个字符 |
| `rev47` | **内核自愈**（原则 5）：`scripts/kernel-snapshot.mjs` / `kernel-restore.mjs` / **双击 `修复内核.cmd`**（应用起不来时唯一的路）。快照白名单 701 文件 / 5.32 MB，四条规矩（先验备份 / 先存 pre-restore / 默认不删 / 恢复后复核） |
| `rev48` | **拆权限门**（原则 4）：`capabilities` 全部降级为**自述**、`assertCapabilities` 只警告不拦、`scopedFs`/`scopedDoc` 裁剪删除、设置页改只读展示、契约 §4 诚实改写 |
| `rev49` | **接管协议**（原则 3 的地基）：① 自动登记补齐（`event.on`/`fs.watch`/`doc.on` 不再靠插件记得 `push`）② 新增 `ctx.host.onRollback(fn)`（登记过的内核代还原）③ **修真缺口**：`command.bind` 覆盖内核命令后 dispose 只 `delete run` ⇒ 卸载插件把 `core.newNote` 变成"没实现"；现在先记原实现、dispose 放回 ④ 审计出口 `window.__znKernelAudit()` ＋ 验收脚本 **`tools/verify-takeover.mjs`（11/11，对照实验 9/11）** |
| `rev50` | **U1 真窗口**（用户裁决「完全放行」）：`view.openWindow({panel,title,width,height})` 把面板放进独立窗口（可拖 / 多开 / 卸载自动关）；`?pluginWindow=<panelId>` 窗口模式只渲染那个面板。**新增权限**：`core:webview:allow-create-webview-window` ＋ `core:window:allow-destroy` ＋ `windows: ["main","plugin-*"]`（glob 已核实支持）。验收 **`tools/verify-plugin-window.mjs` 10/10**；示例 `examples/window-demo/` |
| `rev51` | **U2 主壳接管点**：`view.overrideShell({mount})` —— 插件自绘界面**接管整窗**（内核 UI 让位），释放或卸载即复原；**单接管者**（第二个抛明确错误）＋ **内核逃生口**（右下角按钮 / `Ctrl+Alt+Z`，因为接管期间连插件管理页都点不到）。验收 **`tools/verify-shell.mjs` 12/12**；示例 `examples/shell-demo/` |
| `rev52` | **outline-map 重做成"导图独立窗口"**（用户当场纠向：**笔记就是大纲**，不存在大纲窗口，导图开新窗口，分屏交给 Windows）：入口改为**编辑器顶部条**每组一个「❖ 导图」按钮；窗口里可 `＋子主题` / `✕删子树`，**直接读写库文件**（不依赖编辑器挂载）。验收 **`tools/verify-outline-map.mjs` 7/7**。顺带修正文档：**`sidebar` 面板其实渲染在主区**（只有 `editor-topbar`/`editor-toolbar` 与编辑器同屏） |
| `rev53` | **插件窗口补齐三键 ＋ 查清 `close()` 真相**：三键抽成 `WindowControls`（主窗口/插件窗口共用：最小化 / 最大化⇄还原 / 关闭）。**`close()` 只发 `tauri://close-requested`、真正销毁靠监听器里的 `destroy()`** ⇒ 插件窗口当初关不掉是"**没人负责关**"（窗口模式跳过了内核那个 close 监听器），**不是死锁**（rev50 的误判已更正）；窗口模式补极简监听器 + 标记 `__znCloseListener`。验收 **`verify-plugin-window.mjs` 14/14** |
| `rev54` | **内核新增 `editor.addLineAction`**（CM6 widget 按钮：在某行**左外侧**插可点小按钮）⇒ 导图入口从顶部条挪到**每个大纲组标题的左侧**（用户定：「不放右上角，放标题左侧」；「**笔记本身就是大纲**」）。新 capability `editor:line-action`；命令 `outline-map.open-map-at-line`（payload `{line}`）。验收 **`verify-outline-map.mjs` 6/6**。另：按用户要求把「先查一手来源、不猜、不把未核实结论当经验」写成 `~/.dsh/AGENTS.md` **第 5 条硬性前置** |

## ⚠️ 未决问题（下个会话第一件事）

> **2026-10-13 更新** —— 内核增强路线（rev46 定，按"保险先上"排）：
> ① 内核自愈 ✅ **rev47** ② 拆权限门 ✅ **rev48** ③ 接管协议 + 还原验收 ✅ **rev49**
> ④ U1 真窗口 ✅ **rev50**（`view.openWindow` ＋ capability **完全放行**：新增
> `core:webview:allow-create-webview-window`、`core:window:allow-destroy`、`windows:["main","plugin-*"]`）
> ⑤ U2 主壳接管点 ✅ **rev51**（`view.overrideShell` ＋ 内核逃生口）
> ⑥ outline-map 重做成"导图独立窗口" ✅ **rev52**（入口=编辑器顶部条每组一个「❖ 导图」；
> 窗口里编辑直接写库文件；**笔记就是大纲**，分屏交给 Windows）
> ⇒ **下一步 = ⑥ 的收官打磨**：样式切换 · 折叠 · 撤销重做 · 窗口菜单栏（文件/编辑/AI/查看）· 视觉细化。
> 另有**一个内核侧待你定的改进点**：UINode 的 `row` 没有 `justify` ⇒ 插件做不出"组标题右上角按钮"。
> 背景盘点见 `docs/插件UI承载能力-2026-10-13.md`；**用户已裁决**：不需要防"插件把界面改成
> 任意样子"（同一套设计风格即可）· 自用阶段 ⇒ **放弃"声明式唯一主路"**。
> 待裁决（契约 §6.1）：`.zn/permissions.json` 与 Rust 的 `read_permissions`/`set_permission`
> 前端已不读 ⇒ 是否整体下线（删除是破坏性动作，问过再动）。

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
- **测试库 `_tmp-vault-tb/`**（5 篇笔记，含 `数据库绪论.md`）；`.zn/plugins` 里有 **3 个 junction**：
  `outline-map` · `docprobe`（U3a/U3b 夹具，rev45）· `net-demo`（**拆门后它不再被拒载**，rev48 实测）。
  要再测插件：把 `.zn/plugins/<id>` junction 到 `examples/<id>` 即可。
  ⚠️ **改完不一定要切库** —— 2026-10-13 实测：`☰ → 插件管理 → 重新扫描` 就能加载新插件（无需切库、无需重启；vite 不监视库目录，所以只能靠这条或切库）
- **接管 / 还原怎么验（rev49）**：`node tools/verify-takeover.mjs` —— 自动建 junction → 走 UI 重扫 →
  比对审计快照 → 删 junction → 再比对，**11 项判据全自动**（自己建/删 junction，**绝不用递归删除**）。
  手动看读数：`node tools/cdp.mjs eval "window.__znKernelAudit()"`
- **插件独立窗口怎么验（rev50/rev53）**：`node tools/verify-plugin-window.mjs`（**14 项**：开窗 / 多开 /
  窗口内渲染 / label 约定 / **标题条三颗按钮** / 最大化生效与还原 / 关窗销账 / **`close()` 也能关窗** /
  **卸载插件时窗口被自动关掉** / 命令表回基线）。
  ⚠️ 三条硬认知：**改过 `capabilities/*.json` 必须让 cargo 真的重编**（touch `src-tauri/src/lib.rs`）
  —— capability 是**编译期**嵌进二进制的，光重启进程不生效，症状是"窗口能开但核心命令被拒、点了没反应"；
  **`close()` 只发事件、真正销毁靠监听器的 `destroy()`**（见下一条）；**别在将要销毁的窗口里 await close/destroy**。
- **整窗接管怎么验（rev51）**：`node tools/verify-shell.mjs`（12 项：接管 / 内核 UI 让位 / 审计读数 /
  插件按钮释放 / **内核逃生口释放** / 插件收尾被调 / 卸载后回基线）。⚠️ 接管期间内核 UI 全部不可达
  （含插件管理页）⇒ **逃生口是必需品**（右下角按钮 / `Ctrl+Alt+Z`）；插件**不要 `onStartup` 自动接管**。
- **`close()` 与 `destroy()` 的区别（rev53 查清，别记错）**：`close()` **只发 `tauri://close-requested`、
  自己不销毁窗口**；真正销毁靠监听器里的 `destroy()`（`@tauri-apps/api` 的 `onCloseRequested`
  在未 preventDefault 时就这么做）⇒ **窗口里没有 close 监听器时 `close()` 返回 ok 但窗口不关**。
  主窗口能关是因为它有"关窗前落盘"监听器。⚠️ 别在**将要被销毁的窗口里 `await` close/destroy**
  （那次 invoke 的 Promise 永不 resolve，谁 await 谁超时）。
- ⚠️ **Rust 测试的临时目录在 `<repo>/_tmp-test/`，不是 `%TEMP%`** —— 跑测试的那个受限上下文
  写不了 `%TEMP%`（`Os code 5 PermissionDenied`，rev37）。`cargo test --lib` 现 **21 passed**。
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

`HANDOFF.md`（**rev49**）· `docs/内核契约-v0.1.md`（**§2.7 接管协议 = 还原规矩的权威版本**）·
**`docs/插件UI承载能力-2026-10-13.md`（UI 承载盘点 ＋ 路线）** · `docs/架构原则-2026-10-13.md`（**冲突时以它为准**）·
`docs/能力对照-规格2.1-2.8.md` · `docs/插件能力盘点-2026-10-12.md`（权限/分发/沙箱维度）·
`tools/verify-takeover.mjs`（**接管/还原的自动验收**）·
`tools/verify-plugin-window.mjs`（**独立窗口的自动验收**）·
`tools/verify-shell.mjs`（**整窗接管的自动验收**）·
`tools/verify-outline-map.mjs`（**大纲 → 导图窗口的自动验收**）· `examples/`（插件示例；`window-demo` = 窗口示例，
`shell-demo` = 整窗接管示例，`outline-map` = 导图窗口（v0.2），`md-toolbar` 已退役删除）
