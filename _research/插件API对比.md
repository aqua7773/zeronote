# 插件 API 设计对比调研

> 状态：**historical**（调研快照，带日期）｜最后核对：2026-10-17 ｜说明：结论按当时实测；引用前先看日期

> 日期 **2026-10-11** ｜ 调研对象：NoteGen · Lumina-Note · SilverBullet · Yank Note · VS Code · Obsidian
> 目的：为 `ZeroNote\docs\内核契约-v0.2.md` 提供外部先例，并给出具体修订建议（见 §9）
> **只读调研**：本文件为新建，未修改任何已有文件。

## 0 素材与证据规范

| 对象 | 许可 | 素材来源 | 可信度 |
|---|---|---|---|
| NoteGen | GPL-3.0 | 本地源码快照 `C:\Users\AQUA\Documents\deepseek\_笔记软件选型\src\note-gen\` | 一手源码，最完整 |
| Lumina-Note | Apache-2.0 | 本地源码 `C:\src\notesel\lumina-note\` | 一手源码 |
| SilverBullet | MIT | 官方文档 `docs.silverbullet.md`（本地实例为空库，见 §8.3） | 一手文档 |
| Yank Note | AGPL-3.0 | 官方仓库 `help/PLUGIN.md` + `yank-note-extension/README.md` | 一手文档 |
| VS Code | 专有 | 官方 API 文档 | 一手文档 |
| Obsidian | 专有 | 官方开发者文档 GitHub markdown 源 + obsidian-help 源 | 一手文档 |

**证据写法**：本地文件给 `相对路径:行号`；网页给 URL。**凡未亲自读到的一律标「未核实」**（见 §10）。

---

## 1 必答问题一：插件 manifest 有哪些字段？

### 1.1 结论对比

| 项目 | manifest 形态 | 有 id | 有 version | 有入口 | 有 apiVersion | 有依赖声明 | 有 activationEvents |
|---|---|---|---|---|---|---|---|
| **NoteGen** | `manifest.json`（zod 严格校验） | ✓ 反向域名式 | ✓ | ✓ `entry`（可选） | ✓ semver range | ✗（无插件间依赖） | ✓ max 100 |
| **Lumina** | 插件目录内 manifest（含 `api_version`） | ✓ | ✓ | ✓ 约定入口 | ✓ **精确相等** | ✗ | ✗ |
| **SilverBullet** | `*.plug.yaml` | ✓ `name` | ✗ 未核实 | ✓ `functions[].path` | ✗ 未核实 | ✓ `redirect`（别名到别的插件） | ✓ hook 即声明 |
| **Yank Note** | 单文件 js **无 manifest**；分发用 package.json | ✓ `name` | ✓ npm version | ✓ `main` | ✓ `engines['yank-note']` | ✗ | ✗ |
| **VS Code** | `package.json` | ✓ `publisher.name` | ✓ 必填 | ✓ `main`/`browser` | ✓ `engines.vscode` | ✓ `extensionDependencies` / `extensionPack` | ✓ |
| **Obsidian** | `manifest.json` | ✓ | ✓ | ✓ 固定 main.js | ✓ `minAppVersion` | ✗ | ✗ |

### 1.2 NoteGen —— 本组最完整，且是 VS Code 式

`src/lib/plugins/manifest.ts:151-206` 的 `manifestSchema` 字段：

- `manifestVersion: 1`（**manifest 自身的 schema 版本**）、`id`（`manifest.ts:12` 强制反向域名式 `/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/`）、`name`、`description`
- `version`（semver）、`apiVersion`（**semver range**，`manifest.ts:157`）、`minAppVersion`（`manifest.ts:158`）
- `platforms: ('desktop'|'ios'|'android')[]`（`manifest.ts:159`，至少 1 个）
- `resources` → `embeddedViews: [{id, name, script(.js), style(.css)}]`（`manifest.ts:27-32`）——**WebView 视图的静态声明**
- `entry`（可选，**必须 `.js`**，`manifest.ts:164-166`）——纯资源型插件可以没有入口
- `activationEvents: string[]`（`manifest.ts:167`）
- `permissions`（**对象**，21 项，每项 `{scope, optional?, description?}`，`manifest.ts:168-190`）
- `contributes`：`commands` / `settings` / `statusBar` / `menus` / `views`（`manifest.ts:191-197`）
- `defaultLocale` / `locales`（i18n）、`author` / `repository` / `license`

**关键设计**：`entry` 可选 + `activationEvents` + `platforms` 三者组合，支持「纯 CSS/HTML 资源插件」「按需激活」「按平台排除」。许可字段（author/repository/license）也进 manifest。

### 1.3 其余项目要点

- **Lumina**：`PluginInfo` 含 `api_version`、`min_app_version`、`permissions: string[]`、`theme`（`runtime.ts:296-304`、`:1041-1052`）。版本校验是**精确字符串相等**（`plugin.api_version !== HOST_API_VERSION` → 拒绝，`runtime.ts:297`），没有 range。
- **SilverBullet**：`{plugname}.plug.yaml`，顶层 `name` / `requiredPermissions` / `functions` / `assets` / `build`；每个 function 有 `path`（`"file.ts:fn"`）、`redirect`、`syscall`，以及 hook 字段 `command` / `slashCommand` / `events` / `mqSubscriptions` / `codeWidget` / `editor` / `pageNamespace`。**Reference 页未列出任何版本字段** → 疑似无 apiVersion 校验（标未核实）。
- **Yank Note**：**单文件插件没有 manifest**——文件放 `<主目录>/plugins/plugin-hello.js`，内容即 `window.registerPlugin({name, register: ctx => {...}})`。只有打包分发的 Extension 才有 package.json：`displayName`（必填）、`icon`（必填）、`engines:{"yank-note":"^3.30.0"}`（必填）、`main`/`style`/`themes`（可选）。
- **VS Code**：`name`/`version`/`publisher`/`engines.vscode` 必填（`engines` **不能是 `*`**）；`main`（Node 入口）/`browser`（Web 入口）二选一；`contributes`、`activationEvents`、`extensionDependencies`、`extensionKind`、`capabilities.untrustedWorkspaces`。
- **Obsidian**：通用必需 `author`/`minAppVersion`/`name`/`version`；插件专有必需 `description`/`id`/`isDesktopOnly`。`id` 规则：仅小写字母与连字符，不能以 `plugin` 结尾、不能含 `obsidian`。**没有任何权限字段**。

**对 ZeroNote 的对照**：契约 §3 的 manifest 有 `id/name/version/apiVersion/entry/description/capabilities/contributes{commands,panels}`。缺 `manifestVersion`、`platforms`、`activationEvents`、`permissions` 的对象化，以及 `contributes.settings/statusBar/menus`。

---

## 2 必答问题二：权限如何声明与授权？

### 2.1 三档光谱

| 档次 | 项目 | 机制 |
|---|---|---|
| **强**：声明 + 运行时逐项授权 + 绑定内容哈希 | **NoteGen** | `permissions` 对象 + 用户授权记录 + `manifestFingerprint` |
| **中**：声明 + 调用点抛错 | **SilverBullet**（`requiredPermissions: [fetch, shell]`）、**Lumina**（`meta.permissions` + `requirePermission` 抛错）、**VS Code**（无细粒度权限，用 Workspace Trust） |
| **无**：官方承认做不到 | **Obsidian**（原文见下）、**Yank Note** |

### 2.2 NoteGen —— 唯一做到「授权绑定到代码版本」的

- **声明**：`permissionDeclarationSchema`（`manifest.ts:43-54`）含 6 种 `scope`：`active-editor` / `workspace-file` / `workspace-files` / `workspace-folder` / `network-origins` / `application`；`optional` 布尔。
- **授权记录**：`PluginPermissionGrant { permission, granted, paths?, grantedAt?, manifestFingerprint }`（`internal-types.ts:67-73`）。
- **指纹**：`getPluginManifestFingerprint` = `[1, id, version, contentHash, source, 来源身份]`（`internal-types.ts:54-65`）。
- **启用判定**：`isPluginEnabledInWorkspace`（`internal-types.ts:83-94`）要求 —— ① 插件已启用 ② 每个权限的 `grant.manifestFingerprint === 当前指纹` ③ 非 optional 权限必须 `granted`。**插件改一版代码，全部权限授权自动作废**。
- **运行时双检**：`assertPermission`（`broker.ts:434-453`）依次抛 `PermissionDenied`：未在 manifest 声明 → 未授予 → 路径超出授权 scope。另有异步版本 `assertCurrentPluginAuthority`（`broker.ts:527-537`）检查工作区绑定未变。
- **必需权限**：`host.ts:634-641` 在激活前逐项检查非 optional 权限，缺一个就拒绝激活。
- **权限可查询**：插件可调 `permissions.query(permission, path)` 得知自己有没有被授权（`broker.ts:1464-1470`，RPC `permissions.query`）。
- **可选权限降级**：`optional: true` 的权限未授予不影响加载。
- **静态还是运行时**：**两者都要** —— manifest 静态声明，用户运行时授权，且**权限扩张后必须重新审核**（`development-reload.ts:59` 日志原文："Expanded permissions still require review."）。

### 2.3 SilverBullet

`requiredPermissions` 只识别 **`fetch` 与 `shell`** 两个值。官方 Reference 原文："Syscalls that need a permission throw if the plug didn't declare it in `requiredPermissions`." → 授权是**安装即全给**，没有逐项询问，限制面靠「只有两个高权限能力」来收窄。

### 2.4 Lumina

`hasPermission(permissions, required)`（`runtime.ts:259-265`）支持通配：`*`（全部）、`ns:*`（如 `vault:*`）。`normalizePermissionSet`（`runtime.ts:267-277`）做别名归一（`workspace:read` → 附带 `vault:read` 等）。`requirePermission`（`runtime.ts:624-628`）在非法调用时抛 `Plugin ... missing permission`。**未发现运行时向用户询问授权的代码路径** → 静态声明 + 安装时信任。

### 2.5 Obsidian —— 官方原文承认无法限制

`obsidian-help/en/Extending Obsidian/Plugin security.md`：

> "Due to technical limitations, Obsidian cannot reliably restrict plugins to specific permissions or access levels. This means that plugins will inherit Obsidian's access levels."
> — 原文列出后果：插件可访问电脑文件、可联网、**可安装其他程序**。

替代控制手段是**全局开关 Restricted Mode**（默认开）与**目录审核 + 自动扫描 + 安全评分卡**，不是权限系统。

### 2.6 Yank Note

`help/PLUGIN.md` 与 `yank-note-extension/README.md` **全文未出现任何权限/permission 相关字段或概念**。插件直接用浏览器上下文与 `ctx`，且文档明确提供 `RunCode` 与 `Widgets` 让用户**直接写任意 JS**：

```js
// --run-- --no-worker--
ctx.ui.useToast().show("info", "HELLOWORLD!")
```

→ 结论：**无权限系统**（宁可用"能力全开"换取 hackability，这是作者的设计取向而非疏漏）。

### 2.7 VS Code

没有 capability 清单，事实上的边界由三件事构成：**Workspace Trust**（`capabilities.untrustedWorkspaces` 静态声明，见 `extension-manifest` 的 capabilities 行）、**extensionKind**（`ui` 本地跑 / `workspace` 远端跑）、**Web Extension**（`browser` 入口，宿主 API 子集，无 `node:fs`）。细节正文本轮未抓，仅 URL：<https://code.visualstudio.com/api/extension-guides/workspace-trust>。

**对 ZeroNote 的对照**：契约 §4 的 11 个 capability 已是"声明式 + 默认需声明"，方向正确；但缺 ① `scope`（`fs:read` 读全库 vs 读某目录）、② `optional`、③ **授权记录绑定内容哈希**（最大缺口，见 §9 建议 2）。

---

## 3 必答问题三：插件 UI 如何挂载？

### 3.1 三条路的实际采用情况

| 项目 | ① 插件自带框架代码 | ② iframe / WebView | ③ 声明式 schema 宿主渲染 |
|---|---|---|---|
| **NoteGen** | ✓ 宿主渲染 + 插件经 RPC 驱动 | ✓✓ `resources.embeddedViews` → srcdoc iframe | △ 只有 `contributes.views` 声明**位置/标题/图标**，内容非声明式 |
| **Lumina** | ✓✓ 主流：插件返回 HTML 字符串 | ✗（有 iframe 但用于 VS Code AI 扩展面板，非插件 API） | ✗ |
| **SilverBullet** | ✓（`editor` hook 接管文件渲染） | ✓ `codeWidget` 的 `renderMode: iframe` | △ `codeWidget` 返回 **markdown** 是轻量声明式 |
| **Yank Note** | ✓✓ 直接操作宿主 UI（`ctx.statusBar.tapMenus`、`ctx.ui`） | ✗ | ✗ |
| **VS Code** | ✓ TreeDataProvider（宿主渲染树） | ✓✓ `WebviewPanel` = **iframe**，明确定位为「复杂 UI 兜底」 | ✓ `contributes.views` / `menus` / `commands` 声明式 |
| **Obsidian** | ✓✓ 全 imperative DOM（`ItemView` + `containerEl.createEl`） | ✗ 无插件 iframe API | ✗ |

**结论：声明式 schema 由宿主渲染（ZeroNote 的 UINode 主路）在六家中没有对等先例。** 最接近的两个：
- VS Code 的 `contributes.views`：声明的是**容器与元数据**（id/name/icon/context），树内容靠 `TreeDataProvider` 回调（宿主渲染但数据由插件供给）→ 这是"宿主渲染 + 插件供数据"，不是"插件描述整棵 UI 树"。
- SilverBullet 的 `codeWidget`：返回 `{markdown}` 由宿主渲染（真·声明式），但颗粒度只到"一段 markdown"。

**因此 ZeroNote 的 UINode 是生态里更大胆的设计**，风险是表达力不足、插件一定会溢出到 `registerWebView`。这不是否决理由，但必须把兜底路做扎实（§9 建议 4）。

### 3.2 NoteGen 的两级做法（最值得抄）

**第一级：宿主渲染 + RPC 驱动**。`contributes.views` 声明 20 种 `location`（`manifest.ts:146`：`left-sidebar`/`right-sidebar`/`editor-tab`/`status-bar-panel`/`document-top`/`editor-inline` …），插件经 `ui.views.update` 等 RPC 推内容（`runtime/protocol.ts:53-57`）。

**第二级：srcdoc iframe 沙箱视图**（`src/components/plugins/plugin-sandboxed-view.tsx`），三件套齐全：

1. **CSP + nonce**（`:90`）：
   `default-src 'none'; script-src 'nonce-<token>'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'`
2. **iframe 属性**（`:170`）：`sandbox="allow-scripts"` —— **刻意不给 `allow-same-origin`**（真正跨源隔离），另加 `referrerPolicy="no-referrer"`；就绪握手带随机 token，15 秒超时（`:105`）
3. **主题注入**（`:14-40` + `:117-146`）：`hostTheme()` 用探针元素算出 `background/foreground/primary/muted/border/destructive/fontFamily/rootFontSize/colorScheme`，经 `MessageChannel` 首帧 push，并用 `MutationObserver` 监听 `documentElement` class 变化 → 主题切换时主动推 `host.theme`

另有一条**非插件**的 iframe 用于文档样式测量（`src/lib/plugins/documents.ts:215-231`），那个才给 `allow-same-origin`，并配 `default-src 'none'`。**两条路的沙箱强度不同，值得注意这个区分。**

### 3.3 Obsidian 的第三条路：CSS 变量

Obsidian 不做声明式，也不给插件 iframe，而是**用一套官方 CSS 变量让插件 DOM 自动跟随主题**（`developer-docs/en/Reference/CSS variables/Foundations/Colors.md`）：

- 基础色板 `--color-base-00` … `--color-base-100`（亮/暗两套值）
- 强调色 `--accent-h/s/l` → `--color-accent` / `--color-accent-1` / `--color-accent-2`；语义色 `--color-red` … `--color-pink`（+ `-rgb` 变体）
- 语义变量：`--background-primary` / `--background-primary-alt` / `--background-secondary` / `--background-modifier-hover|border|error` / `--interactive-normal|hover|accent` / `--text-normal|muted|faint|accent` / `--text-selection` / `--caret-color`
- 官方建议用 `color-mix(in oklch, var(--color-red) 20%, transparent)` 代替拼 `rgba()`

**VS Code 同思路**（`webview.md`）：webview 里可用 `var(--vscode-editor-foreground)` 形式的变量（主题色 `editor.foreground` → `--vscode-editor-foreground`），body 上有 `vscode-light`/`vscode-dark`/`vscode-high-contrast` 类与 `data-vscode-theme-id` 属性。

→ **这是"风格统一"成本最低的方案**：不强制插件用什么框架，只保证它用宿主的 token。

---

## 4 必答问题四：插件间如何通信？命令如何注册与调用？

### 4.1 命令注册：静态声明 vs 运行时注册

| 项目 | 命令声明位置 | 实现绑定 | 命令面板可见性 |
|---|---|---|---|
| **NoteGen** | manifest `contributes.commands`（`manifest.ts:56-63`：id/title/description/icon/keywords/suggestedShortcut） | 运行时经 RPC 注册 handler | 静态可列 → **支持懒激活** |
| **Lumina** | manifest + 运行时 `commands.registerCommand` / `registerSlashCommand`（`runtime.ts:156-159`） | 同一调用 | 需已加载 |
| **SilverBullet** | manifest hook `command: {name, key, mac, priority, contexts, requireMode, requireEditor, requireServiceWorker, hide, disableInVim}` | 同一函数即实现 | 静态可列 |
| **Yank Note** | 运行时（`ctx.action` / `ctx.statusBar.tapMenus`） | 同一调用 | 需已加载 |
| **VS Code** | `contributes.commands`（command/title/category/icon/enablement） | `registerCommand` | 静态可列 → `onCommand:` 激活 |
| **Obsidian** | 运行时 `this.addCommand({id, name, callback})`（**id 自动加插件前缀**） | 同一调用 | 需已加载 |

**NoteGen 的懒激活实现**（这是 ZeroNote 最该抄的一点）：
- `setPluginActivationResolver`（`command-registry.ts:46-48`）
- `runPluginCommand`（`command-registry.ts:151-161`）：执行命令时若尚无 handler → `await activationResolver(pluginId, commandId)` → 插件此时才 `apply()`
- 注册前先做**整批冲突预检**（`command-registry.ts:61-72`）："A collision in a later command must not leak commands registered earlier in the loop."
- 多个插件在 `activate*Plugins` 里按 `activationEvents` 过滤后 `Promise.allSettled` 批量激活（`host.ts:620-632`）

### 4.2 插件间通信

| 项目 | 机制 | 有返回值 |
|---|---|---|
| **NoteGen** | 事件（`record-event`/`note-event`/`workspace-event`，`protocol.ts:114-116`）+ `commands.executeHost`（`protocol.ts:23`）+ `capabilities` 分层 | 部分 |
| **SilverBullet** | **syscall 命名空间**：插件 A 声明 `syscall: myplug.add`，插件 B `await system.invokeFunction("myplug.add", 1, 2)`；Space Lua 直接 `myplug.add(1,2)`；另有 `redirect` 把函数别名到别的插件 | ✓ 有返回值 |
| **Lumina** | 事件总线，但**只有 3 个 host 事件**：`app:ready` / `workspace:changed` / `active-file:changed`（`runtime.ts:21`） | ✗ |
| **Yank Note** | **Hook**（`ctx.registerHook` / `ctx.triggerHook`，部分 hook 带 `{breakable:true}`，返回 `true` 即中断后续 hook）+ **Action 中心** `ctx.action` | ✓（breakable hook 有） |
| **VS Code** | `commands.executeCommand(id, ...args)` + `getCommands()` + 任意插件可注册/调用同 id | ✓ |
| **Obsidian** | `app.commands.executeCommandById` | ✗ |

**关键差异**：只有 **SilverBullet**（syscall + invokeFunction）和 **VS Code / NoteGen**（可返回值、可被任意插件调用的命令）提供了**带返回值的同步式插件互调**。Lumina 与 ZeroNote 只有 fire-and-forget 事件总线。

### 4.3 NoteGen 的两层"能力"概念（易混，务必区分）

- `manifest.permissions`（21 项，**安全**层，用户授权）
- `plugin.capabilities`（**surface 能力**，宿主运行时分面赋予，无需用户授权）：`broker.ts:1456` 与 `plugin-runtime.worker.ts:775` 给出完整列表 `['embedded-views','workspace-views','contextual-views','editor-actions','records','chat-draft','ai-generation','ui-prompts','document-rendering','document-preview','clipboard-write','file-export','editor-styles','terminal','related-notes-search']`

**同一个插件在 editor-window 分面下能力被削减**（`plugin-runtime.worker.ts:775`）：
```
editor-window: ['document-rendering','clipboard-write','file-export','editor-styles']
```
→ 这是"按承载面收敛能力"的做法：插件代码不变，跑在不同 surface 拿到的能力表不同。

---

## 5 必答问题五：版本兼容与生命周期

### 5.1 版本校验

| 项目 | 字段 | 语义 | 失败行为 |
|---|---|---|---|
| **NoteGen** | `apiVersion`（range）+ `minAppVersion` + `platforms` | `satisfiesSemverRange` | `PluginError('Incompatible', 'Plugin requires NoteGen X or newer')`（`manifest.ts:494-504`）；平台不符 → `PluginError('Incompatible', 'Plugin does not support <platform>')` |
| **Lumina** | `api_version`（**精确相等**）+ `min_app_version` | `api_version !== HOST_API_VERSION` → 报错 | `getCompatibilityIssue` 返回字符串（`runtime.ts:296-304`） |
| **SilverBullet** | 未核实（Reference 未列出） | — | — |
| **Yank Note** | `engines['yank-note']`（range，仅 Extension 分发时） | semver range | 未核实 |
| **VS Code** | `engines.vscode`（必填，不能 `*`） | semver range | 商店/加载时拒绝 |
| **Obsidian** | `minAppVersion`（必填） | 仅下限 | 拒绝加载 |

NoteGen 的版本解析是**手写且防溢出的**：`parseSemver`（`manifest.ts:215-230`）＋ `compareIdentifiers` 用**字符串长度比较**大整数（`manifest.ts:232-242`，注释："Compare numeric identifiers without rounding large values through Number."）。

### 5.2 插件崩了宿主怎么办

- **NoteGen**：① 运行时状态机 `inactive | activating | active | stopping | failed | quarantined`（`internal-types.ts:12-18`）② `handleRuntimeFailure`（`host.ts:655-669`）→ 置 `failed`、清 statusBar、清 UI、**只影响该插件** ③ `Cancelled/WorkspaceChanged/PermissionDenied/UnavailableOnPlatform` 四类错误被识别为"非插件质量问题" ④ 插件超时 → `runtimeFailure('Plugin exceeded its execution time limit','Timeout')` 并 `disposeRuntime()`（`plugin-runtime.worker.ts:730-736`）⑤ 连续失败计数 `PluginFailureRecord {count,lastAt,code,message}`（`internal-types.ts:96-101`）
- **VS Code**：Extension Host **独立进程**，插件崩溃/卡死不带走主窗口（正文未抓，URL：<https://code.visualstudio.com/api/advanced-topics/extension-host>）
- **Obsidian / Yank Note / Lumina**：同进程同上下文，插件抛错即污染界面；Obsidian 靠 `registerEvent`/`addChild` 在 `onunload` 自动清理（`Anatomy of a plugin`）
- **SilverBullet**：Web Worker 隔离，`Plugs: Reload` 重载

### 5.3 热重载

| 项目 | 做法 |
|---|---|
| **NoteGen** | 开发模式 2 秒轮询 `plugin_development_revision`，source ≠ installed 才重载；**一次构建只 import 一次**，失败等下次构建（`development-reload.ts:51-59,71`） |
| **SilverBullet** | `Plugs: Reload` 命令（"without a full page refresh"）；放文件到 space 后几秒自动同步 |
| **Yank Note** | 托盘 `Develop > Reload` |
| **VS Code** | Extension Development Host |
| **Obsidian** | 无官方热重载；Community plugins 页有 refresh 图标（重载全部） |
| **Lumina** | 未核实 |

### 5.4 卸载即净（生命周期资源管理）

- **NoteGen**：`registerPluginContributions` 返回 `disposable`，dispose 时按 `commands.get(id) !== command` 逐项比对再删（避免删掉别人重注册的同名命令，`command-registry.ts:99-113`）
- **Obsidian**：`onunload()` + `registerEvent`/`addChild` 自动登记
- **ZeroNote 契约**：已有 `ctx.subscriptions`（"所有资源必须登记，卸载即净"）→ 方向一致 ✓

---

## 6 必答问题六：沙箱与安全边界

### 6.1 隔离强度排序（强 → 弱）

| 项目 | 隔离机制 | 具体限制 |
|---|---|---|
| **NoteGen** | **QuickJS WASM 沙箱**（`plugin-runtime.worker.ts:3-10`，`@jitl/quickjs-singlefile-browser-release-sync` + `quickjs-emscripten-core`） | 见下表常量 |
| **VS Code** | Extension Host 独立进程 + Webview iframe | `enableScripts` 默认 **false**；`localResourceRoots` 白名单；CSP；`asWebviewUri` 转换本地 URI |
| **SilverBullet** | **Web Worker** + syscall 白名单 | `requiredPermissions: [fetch, shell]`；未声明则 syscall 抛错 |
| **Lumina** | 无沙箱（同窗口） | 仅 `requirePermission` 与 `resolveWorkspacePath` 路径越界检查（`runtime.ts:630-645`） |
| **Obsidian** | **无** | 官方承认继承 Obsidian 全部权限 |
| **Yank Note** | **无** | 浏览器上下文任意 JS，且主动提供 RunCode/Widgets 让用户跑代码 |

### 6.2 NoteGen 的硬上限（`plugin-runtime.worker.ts:26-35`）

| 常量 | 值 | 含义 |
|---|---|---|
| `MEMORY_LIMIT_BYTES` | 32 MiB | `runtime.setMemoryLimit` |
| `STACK_LIMIT_BYTES` | 512 KiB | `runtime.setMaxStackSize` |
| `ENTRY_LIMIT_BYTES` | 5 MiB | 入口源码上限 |
| `EXECUTION_SLICE_MS` | 75 ms | 单次求值时间片 |
| `ACTIVATION_SLICE_MS` | 1000 ms | 激活留出更长时间 |
| `JOBS_PER_PUMP` / `MAX_CONSECUTIVE_JOB_PUMPS` | 64 / 16 | 微任务泵配额 |
| `MAX_PENDING_RPC` | 64 | 未完成 RPC 上限 |
| `MAX_BRIDGE_PAYLOAD_BYTES` | 2 MiB + 128 KiB | 单条消息上限 |

**装配**（`plugin-runtime.worker.ts:753-768`）：
```ts
runtime.setMemoryLimit(MEMORY_LIMIT_BYTES)
runtime.setMaxStackSize(STACK_LIMIT_BYTES)
runtime.setInterruptHandler(() => { ... deadline ... return executionInterrupted })
runtime.setModuleLoader((moduleName) => {
  if (moduleName === 'plugin:entry') return message.entrySource
  return { error: new Error(`Module imports are not available: ${moduleName}`) }
})
```
→ **完全禁止 import 任何模块**（连 `import` 别的插件都不行），插件必须是单文件 bundle。

**中断语义**（`plugin-runtime.worker.ts:722-744`）：注释明确处理了一个坑 —— "QuickJS can turn an interrupt inside an async function into a rejected promise without returning an eval error"，因此 `executionInterrupted` 被当作终态，避免命令永远挂起等宿主看门狗。

**iframe 能力通道**（`src/lib/plugins/frame-capabilities.ts`）：视图 iframe 想用高权限能力（目前只有 terminal）必须走 `MessagePort`，且每次请求校验 `method.startsWith('terminal.')`，否则 `throw new Error('Capability unavailable')`（`:62`）；terminal 输入长度硬上限 65536（`:85`）；尺寸校验 `cols 2..500 / rows 1..200`（`:8-14`）；close 时逐个销毁会话（`:98-107`）。

### 6.3 未做沙箱者如何自保

- **Obsidian**：Restricted Mode（默认开）+ 目录审核 + 自动扫描 + 评分卡 + **插件不自动更新**（`Community plugins.md`："For security purposes, community plugins don't update automatically."）
- **Lumina**：`normalizePermissionSet` 通配 + 路径越界抛错 + `enabled_by_default` 也必须用户手动启用（`src/stores/usePluginStore.ts:91` 注释："They must be explicitly enabled by user action, even if manifest sets enabled_by_default=true."）
- **VS Code**：Workspace Trust + CSP 最佳实践章节（"Use the minimum set of capabilities"，`webview.md` 的 Security 节）

---

## 7 六问速查总表

| 维度 | NoteGen | Lumina | SilverBullet | Yank Note | VS Code | Obsidian |
|---|---|---|---|---|---|---|
| manifest | json + zod 严格 | manifest | `*.plug.yaml` | 无（单文件） | package.json | manifest.json |
| 版本校验 | apiVersion range + minAppVersion + platforms | api_version 精确 + min | 未核实 | engines range | engines.vscode | minAppVersion |
| 权限 | 声明+授权+**指纹绑定** | 字符串+通配 | 2 项声明 | 无 | 无（Trust） | **无（官方承认）** |
| UI 主路 | 宿主渲染 + RPC | 插件返回 HTML | markdown / iframe | 直接操作宿主 | contributes + TreeView | imperative DOM |
| UI 兜底 | srcdoc iframe + CSP + nonce | ✗ | codeWidget iframe | ✗ | WebviewPanel iframe | ✗ |
| 主题一致 | host.theme 注入（MessageChannel + MutationObserver） | theme preset/token | CSS | 直接继承宿主 DOM | `--vscode-*` 变量 | **`--background-primary` 等变量** |
| 命令 | manifest 静态 + 懒激活 | 运行时 register | yaml hook | 运行时 ctx | contributes + onCommand | 运行时 addCommand |
| 插件互调 | 事件 + executeHost | 3 个事件 | **syscall + invokeFunction** | Hook/Action | executeCommand | executeCommandById |
| 沙箱 | **QuickJS WASM** | 无 | Web Worker | 无 | Extension Host 进程 + iframe | **无** |
| 热重载 | 2s 轮询 revision | 未核实 | Plugs: Reload | Develop > Reload | Dev Host | 手动 refresh |

---

## 8 各项目档案速记

### 8.1 NoteGen（`C:\Users\AQUA\Documents\deepseek\_笔记软件选型\src\note-gen\`）
成熟度最高，本质是「VS Code 的声明式清单 + 浏览器沙箱」的组合。插件源码在 `src/lib/plugins/`（27 个文件，`broker.ts` 92 KB 为 RPC 中转核心）。RPC 面共 60 个方法（`runtime/protocol.ts:19-61`）。
**未核实**：`@notegen/plugin-api` 包体不在快照内（只有 `src` 侧的 import），故 `PLUGIN_API_VERSION` 的具体值与 `PluginContext` 完整类型未读到。

### 8.2 Lumina-Note（`C:\src\notesel\lumina-note\`）
Obsidian 风格 + 一点声明式影子。`runtime.ts` 1484 行为插件宿主。API 面 17 个模块（`runtime.ts:80-257`）：`meta/logger/ui/theme/commands/vault/metadata/workspace/editor/storage/events/network/runtime/interop/render`。
插件入口形状是 CommonJS 函数（`runtime.ts:600-604`）：
```js
module.exports = function(api, plugin) { ... }   // 必须导出 setup 函数
```
UI 全是 HTML 字符串：`ui.registerSettingSection({html})`、`workspace.registerPanel({html})`、`workspace.registerTabType({render: () => string})`、`workspace.registerShellSlot({html})`。编辑器走 CM6 扩展（`editor.registerEditorExtension`，`runtime.ts:211-220`，`runtime.ts:1311` 有 `import("@codemirror/state").Extension` 类型断言）。

### 8.3 SilverBullet
**本地实例没法用于 API 调研**：`C:\Users\AQUA\Apps\Portable\SilverBullet\` 下 `silverbullet.exe`（68 MB）、`space\index.md`（1485 字节）、`data\spaces\<uuid>\` 只有 `index.md` + 空 `Inbox` + 一个 git 仓库。**全库无任何 `.plug.js`**，因此本机只能佐证"plug 放在 Space 里"这一点。API 细节全部来自官方文档。
另有 `Library`（分发）与 **Space Lua**（原生脚本，可调 plug 的 syscall，`spacelua.describe()` / `listFunctions()` 暴露结构化文档）两条并行扩展路。

### 8.4 Yank Note
作者的原文（`help/PLUGIN.md` Preface，**已核实**）：
> "almost all functions inside Yank Note are implemented through a thin plug-in system (dozens of built-in plug-ins). The capabilities used by the built-in plug-ins are exactly the same as the plug-ins written by users, and you can even use some third-party libraries used by Yank Note in the plug-ins."

即「内置插件与用户插件能力完全相同」**属实**，而且这正是其 API 设计原则：没有特权接口。核心抽象只有两个 —— **Hook**（可中断）与 **Action**。
另一条支线：`RunCode` / `Widgets` 让用户不写插件也能跑 JS，`--no-worker--` 标记表明有 worker 执行模式。

### 8.5 VS Code
`contributes` 40 余个贡献点，`views`/`menus`/`commands`/`configuration`/`keybindings` 等是声明式主力；Webview 被官方明确定位为**兜底**：
> "Webviews are pretty amazing, but they should also be used sparingly and only when VS Code's native API is inadequate. ... Just because you can do something with webviews, doesn't mean you should."
Webview 基础 API 与安全要点（`webview.md`）：`createWebviewPanel` / `webview.html`（整体替换，类似重载 iframe）/ `enableScripts`（**默认 false**）/ `localResourceRoots`（`[]` = 禁全部本地资源）/ `acquireVsCodeApi()`（**每会话只能调一次，且不得泄漏到全局**）/ `postMessage` + `onDidReceiveMessage` / `getState`/`setState`（推荐）/ `retainContextWhenHidden`（内存开销大，仅作最后手段）/ `WebviewPanelSerializer` + `onWebviewPanel:` 激活事件恢复面板。
命令激活链条：contributes.commands → 用户触发 → VS Code 发 `onCommand:${command}` 激活事件（1.74 起多数场景可省略显式 activationEvents）。

### 8.6 Obsidian
manifest 极简（无权限、无 contributes、无 activationEvents），一切 UI 靠 imperative API：
- 视图：`class X extends ItemView`（或 `FileView`）+ `getViewType()` / `getDisplayText()` / `onOpen()` / `onClose()`；用 `this.containerEl.children[1]` 或 `contentEl` 作为容器，`container.createEl('h4', {text})` 建元素；经 `WorkspaceLeaf` 注册
- 命令：`this.addCommand({id, name, callback})`，**命令 id 自动加插件前缀**（社区生态的命名空间靠宿主动手，而非约定）；另有 `checkCallback` / `editorCallback` / 默认 hotkeys / 可重复命令
- 设置：自定义 `PluginSettingTab` + `registerSettingTab`
- 主题：官方 CSS 变量（§3.3 已列）
- 安全：Restricted Mode（默认开）+ 审核；**插件不自动更新**；官方承认无权限系统

---

## 9 对 ZeroNote 契约 v0.1 的具体修订建议

> 每条格式：**改什么（具体字段/接口） → 依据（哪家的哪个机制） → 理由**

### 建议 1：manifest 补 3 个字段 `manifestVersion` / `platforms` / `activationEvents`

```jsonc
{
  "manifestVersion": 1,                      // 新增：manifest schema 自身版本
  "platforms": ["desktop", "android"],       // 新增：插件支持的平台
  "activationEvents": ["onCommand:inspiration-flow.capture", "onVault:open"],  // 新增
  "entry": "index.js"
}
```

**依据**：NoteGen `manifest.ts:152`（`manifestVersion: z.literal(1)`）、`:159`（platforms）、`:167`（activationEvents）；VS Code `engines` 必填且不能 `*`、`activationEvents` 独立成字段。

**理由**：`manifestVersion` 是"将来改字段时不至于分不清新旧"的唯一保险，零成本；`platforms` 必需，因为 ZeroNote 有 M3 Android 阶段而桌面插件（子进程/文件系统语义）在真机上会直接失败，必须能静态排除；`activationEvents` 是懒激活的前提（见建议 3），没有它，M2 的"装上 N 个插件"就等于"启动即 N 次 `apply()`"，移动端冷启动会很难看。

### 建议 2：`capabilities` 平铺字符串 → `permissions` 对象（带 `scope` + `optional`），且**授权记录绑定内容哈希**

```jsonc
// 契约 §3 现状
"capabilities": ["fs:read", "fs:write", "doc:read", "command", "view:sidebar", "store"]

// 建议改为
"permissions": {
  "fs:read":      { "scope": "vault" },                 // vault | folder
  "fs:write":     { "scope": "folder", "path": "notes" },
  "doc:write":    { "scope": "active-editor" },
  "net":          { "scope": "origins", "origins": ["https://api.openai.com"], "optional": true },
  "command":      {},
  "store":        {}
}
```
并在 §4 授权记录里加：
```ts
interface PermissionGrant {
  permission: string
  granted: boolean
  paths?: string[]
  grantedAt?: string
  manifestFingerprint: string        // 新增：SHA256(id + version + contentHash + source)
}
```

**依据**：NoteGen `permissionDeclarationSchema` 的 6 种 scope（`manifest.ts:43-54`）、`PluginPermissionGrant.manifestFingerprint`（`internal-types.ts:67-73`）、`isPluginEnabledInWorkspace` 的指纹比对（`internal-types.ts:83-94`）、`assertPermission` 的三段式拒绝（`broker.ts:434-453`）；SilverBullet 只有 `fetch`/`shell` 两项，说明"能力面越窄越好"；Lumina 的通配与路径越界检查（`runtime.ts:259-277, 630-645`）。

**理由**：这是 v0.1 **最大的缺口**。契约现在写「声明了未授权 capability → 拒绝」，但没定义"授权"这个动作存在哪里、什么时候失效。NoteGen 的答案是：**用户批准的是"这个版本的这份代码"**，`contentHash` 一变授权自动作废。缺这一层，"`net` 默认拒（用户逐个授权）"就变成一次性开关——插件升级后可以悄悄开始联网。另外 `fs:read: vault` 与 `fs:read: folder` 必须区分：笔记应用里"读全库"是重授权，不该和"读我一个目录"同档。

### 建议 3：命令改为「manifest 静态声明 + 运行时绑定实现」，并让 `onClick` 支持参数

```jsonc
// manifest：静态可枚举（命令面板/快捷键/其他插件都能看到）
"contributes": {
  "commands": [{ "id": "inspiration-flow.capture", "title": "捕捉灵感", "keybinding": "Mod+Shift+I" }]
}
```
```ts
// 运行时：只绑定实现，不再重复声明元数据
interface CommandApi {
  bind(id: string, run: (...args: unknown[]) => unknown): Disposable;   // 改自 register({id,title,run})
  execute(id: string, ...args: unknown[]): Promise<unknown>;
  list(): { id: string; title: string }[];
}
```
UINode 的 `button` 同步升级：
```ts
| { type: 'button'; label: string; onClick: { command: string; args?: unknown }; variant?: 'default'|'ghost'|'danger' }
```

**依据**：NoteGen `contributes.commands` 静态声明（`manifest.ts:56-63`）+ `setPluginActivationResolver`（`command-registry.ts:46-48`）+ `runPluginCommand` 内先激活再找 handler（`command-registry.ts:151-161`）；VS Code 的 `onCommand:` 激活事件；Obsidian 反例（`addCommand` 运行时注册 → 命令面板必须等插件已加载）。

**理由**：契约现在只写 `command.register({id,title,run})`，元数据与实现绑在一起 → **命令面板要列出命令，插件就必须已经 `apply()` 过**，等于全量启动激活，`activationEvents` 也无从生效。分离之后才能做到"启动只读 manifest，命令被点才 `apply()`"。第二条改动解决的是表达力：`onClick: string` 传不了"点第 3 行的删除按钮"，而 NoteGen 的 `PluginCommandArgument`（`protocol.ts:106`）与 VS Code 的 `executeCommand(id, ...args)` 都支持带参。

### 建议 4：`registerWebView` 契约补三样——主题注入 / 能力通道 / CSP 模板

```ts
registerWebView(spec: {
  id: string; title: string; location: 'sidebar'|'main'|'modal';
  url: string;
}): Disposable;

// 建议宿主额外向 iframe 注入（而不是只在契约里写 url）：
// 1) 主题 token 首帧推送 + 变化时推送
type HostTheme = {
  background: string; foreground: string; primary: string;
  muted: string; mutedForeground: string; border: string; destructive: string;
  fontFamily: string; rootFontSize: string; colorScheme: 'light'|'dark';
};
// 2) MessageChannel + 随机 token 握手，声明可用能力
//    → { type: 'host.theme', theme } / { type: 'notegen:embedded-view-init', capabilities: [...] }
// 3) CSP 模板由宿主生成：
//    default-src 'none'; script-src 'nonce-<token>'; style-src 'unsafe-inline';
//    img-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'
//    且 iframe 用 sandbox="allow-scripts"（不给 allow-same-origin）
```

**依据**：NoteGen `plugin-sandboxed-view.tsx:14-40`（`hostTheme()` 探针取色）、`:117-146`（MessageChannel + `host.theme` + MutationObserver）、`:90`（CSP + nonce）、`:170`（`sandbox="allow-scripts"`）；Obsidian 的 CSS 变量方案（`--background-primary`/`--interactive-accent`/`--text-normal`）；VS Code 的 `--vscode-*` 变量与 webview Security 节（"A webview should have the minimum set of capabilities that it needs"）。

**理由**：契约里 `registerWebView` 只有 `{id,title,location,url}` 四个字段——**没有主题通道、没有能力通道、没有 CSP**，这三样缺任何一个，走兜底路的插件都会立刻破坏「风格 100% 统一」这条设计目标：拿不到 token 就自己写死颜色，主题切换时界面不变；没有能力通道就没法给 iframe 授权（terminal/网络），只能全给或全不给；没有 CSP 就是任意 iframe。NoteGen 这三件套是现成可抄的实现，建议直接把 `HostTheme` 类型写进契约 §2.2。

### 建议 5：显式声明「M2 无沙箱」，并把 quota 常量写进契约

在 §5 或 §6 加一节硬声明：

```md
### 隔离等级（按阶段）
| 阶段 | 隔离 | 插件能拿到什么 |
|---|---|---|
| M2 | **无沙箱**（与内核同进程同权限） | 与内核相同的全部能力；capability 只是"接口可见性"，不是安全边界 |
| v0.2 | Worker / WebView / 子进程宿主 | 按宿主面收敛 |

### 硬上限（所有阶段生效）
entry ≤ 5 MiB ｜ 单插件内存 ≤ 32 MiB ｜ 栈 ≤ 512 KiB
单次同步执行 ≤ 75 ms ｜ 激活 ≤ 1000 ms ｜ 待处理 RPC ≤ 64 ｜ 单条消息 ≤ 2 MiB
```

**依据**：契约 §6 把 M2 定义为"**进程内 TS 插件**"，而 §4 的 capability 表读起来像已有隔离——两者矛盾。生态先例：Obsidian 官方原文承认无权限系统且插件继承应用权限；Yank Note 无沙箱；NoteGen 用 QuickJS WASM 才做到真沙箱（`plugin-runtime.worker.ts:26-35` 的常量表）。NoteGen 的数值可直接借用（`:26-35`），中断语义的坑也值得记一条（`:727-736`：异步函数内的中断会变成 rejected promise 而非 eval error，必须把中断本身当终态）。

**理由**：`apply()` 里写一个 `while(true)` 在 M2 会**直接卡死应用**（同进程），这是"内核只做四件事"承诺最容易破的地方。文档不写明，插件作者会以为 capability 是沙箱。沙箱可以推到 v0.2 再实现，但**契约必须现在就说清"这不是安全边界"**，同时给出可检测的数值上限（哪怕是软限制/看门狗），否则"插件崩了只卸载该插件"（§3 加载规则③）在死循环场景下根本不成立。

### 建议 6（补强）：`event` 之外补"服务/API 注册"原语，UINode 补 3 个类型

**(a) 插件互调**：契约只有 `event.on/emit`（fire-and-forget，无返回值）。建议加：
```ts
interface ServiceApi {
  provide<T>(name: string, api: T): Disposable;   // "git.commit"
  consume<T>(name: string): T | null;             // 类型由 d.ts 声明表约束
}
```
**依据**：SilverBullet 的 syscall 命名空间（`syscall: myplug.add` + `await system.invokeFunction("myplug.add", 1, 2)`，还有 `redirect` 做别名）；VS Code 的 `commands.executeCommand(id, ...args)` 返回 Promise；对比 Lumina 只有 3 个 host 事件（`runtime.ts:21`）——**事件总线不足以支撑"AI 插件调用 Git 插件的提交能力"**，否则只能靠全局变量 hack。

**(b) UINode 类型扩充**：
```ts
| { type: 'list'; items: { key: string; node: UINode }[]; empty?: string }   // items 加稳定 key
| { type: 'table'; columns: {key:string; label:string}[]; rows: Record<string, UINode>[] }
| { type: 'progress'; value: number; max?: number; label?: string }
| { type: 'badge'; text: string; tone?: 'default'|'success'|'warn'|'danger' }
| { type: 'field'; label: string; bind: string; hint?: string }
```
**理由**：按契约 §3 规划的插件逐个套现有 UINode —— **灵感流**（列表项要能点、要稳定 key）、**标签**（表格）、**Git 同步**（进度条）、**AI**（多篇候选选择 + 状态徽标）全都缺类型。现在这 9 种 node 撑不起规划里的任何一个真实插件，插件作者只能全部转投 WebView 兜底路，声明式主路会被架空。

### 建议 7（v0.1 未决项落地线索）
契约 §7 列了两个未决项，本次调研有直接可用的答案：
- **「插件间依赖与加载顺序」**：VS Code 用 `extensionDependencies` + `extensionPack`（仅声明，不做版本求解）；SilverBullet 用 `redirect`（软依赖，无则函数不可用）。建议 v0.1 就采用"**软依赖 + 运行时 `service.consume` 返回 null**"，不做拓扑排序。
- **「插件签名与分发」**：NoteGen 已给出完整答案 —— `publisherKeyId` + `packageSha256` + `signatureUrl` + 吊销字段（`revoked`）（`internal-types.ts:28,125-140,176-180`）。第一版不支持分发时，**建议先把这两个字段留在 manifest 类型里占位**，避免 v0.2 破坏性改类型。

---

## 10 未核实清单（不编）

1. **NoteGen `PLUGIN_API_VERSION` 的具体值**与 `@notegen/plugin-api` 包体 —— 快照里只有 `src` 侧 import，未找到包源。
2. **SilverBullet 是否有 `apiVersion` 或等价版本字段** —— `Plugs/Development/Reference` 的 manifest 清单未列出；是否存在旧的 `*.plug.json` 格式未核实。
3. **SilverBullet 的加载/失效细节**（`Plugs/Development/Architecture` 页未抓，仅知其运行在 sandboxed Web Worker）。
4. **Yank Note 是否有官方"能力清单"页** —— 结论「无权限系统」基于 `help/PLUGIN.md` 与 `yank-note-extension/README.md` 全文未出现权限字段；`yn-api-doc.vercel.app` 的 `renderer_context` 模块清单未逐一抓取。
5. **VS Code 的 Workspace Trust、Extension Host 进程模型正文** —— 仅引用官方文档 URL，未抓正文（`webview.md` 与 `extension-manifest.md` 的正文已抓）。
6. **Lumina 的热重载机制** —— 未在 `runtime.ts` 中找到开发期重载路径。
7. **Obsidian 的 `docs.obsidian.md` 页面正文抓取失败**（前端 JS 渲染，仅返回标题）；本文的 Obsidian 结论改由**官方文档的 GitHub markdown 源**（`obsidian-developer-docs`、`obsidian-help`）与 mintlify 镜像支撑。

---

## 11 参考来源

**本地源码**
- NoteGen：`C:\Users\AQUA\Documents\deepseek\_笔记软件选型\src\note-gen\src\lib\plugins\`（manifest.ts / broker.ts / internal-types.ts / command-registry.ts / host.ts / development-reload.ts / runtime/protocol.ts / runtime/plugin-runtime.worker.ts / frame-capabilities.ts / documents.ts）＋ `src\components\plugins\plugin-sandboxed-view.tsx`
- Lumina-Note：`C:\src\notesel\lumina-note\src\services\plugins\runtime.ts`＋`src\stores\usePluginStore.ts`
- SilverBullet（实例，仅佐证 plug 存放位置）：`C:\Users\AQUA\Apps\Portable\SilverBullet\`

**网页**
- SilverBullet 插件开发：<https://docs.silverbullet.md/Plugs/Development> ｜ Reference（manifest/hook/syscall）：<https://docs.silverbullet.md/Plugs/Development/Reference>
- Yank Note 插件指南：<https://github.com/purocean/yn/blob/master/help/PLUGIN.md> ｜ Extension 打包：<https://github.com/purocean/yank-note-extension>
- VS Code 扩展清单：<https://code.visualstudio.com/api/references/extension-manifest> ｜ 贡献点：<https://code.visualstudio.com/api/references/contribution-points> ｜ Webview：<https://code.visualstudio.com/api/extension-guides/webview> ｜ Workspace Trust：<https://code.visualstudio.com/api/extension-guides/workspace-trust> ｜ Extension Host：<https://code.visualstudio.com/api/advanced-topics/extension-host>
- Obsidian manifest：<https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/Manifest.md> ｜ CSS 变量：<https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Reference/CSS%20variables/Foundations/Colors.md> ｜ 插件生命周期：<https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Getting%20started/Anatomy%20of%20a%20plugin.md> ｜ 插件安全（含"无法限制权限"原文）：<https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Plugin%20security.md> ｜ 社区插件：<https://github.com/obsidianmd/obsidian-help/blob/master/en/Extending%20Obsidian/Community%20plugins.md>
