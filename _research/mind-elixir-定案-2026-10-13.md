# Mind Elixir 调研定案（rev56 · 2026-10-13）

> **一行结论**：导图编辑改用 **`mind-elixir@5.15.1`**（MIT）。
> 离线把 `dist/` 里的 IIFE + CSS + PlaintextConverter 放进插件目录；
> 数据 ⇄ `- 列表` **复用官方 `plaintextConverter`，不自写**；
> 导图窗口用 `view.overrideShell` 挂真 DOM（内核已支持，无需改内核）。
>
> 上一轮（rev55 的正文）把四件事列成待办，**本轮全部核实完**。这一轮只查、没动业务代码。

## 0. 为什么上一轮两次 404

rev55 记的是"GitHub README 两次 404"。根因两条，都已解：

1. **默认分支是 `master`，不是 `main`** —— 用 `api.github.com/repos/SSShooter/mind-elixir-core`
   读到 `default_branch: "master"`（不再猜）。
2. **仓库名要先从包页拿**：npm 包 `mind-elixir` 的 `repository` 指向 `SSShooter/mind-elixir-core`
   （`mind-elixir` 本身在 npm 上不是仓库名）。正确入口顺序：
   **npm 包页/registry JSON → 仓库 API → 默认分支 → raw 文件**。

## 1. 四件事核实结果

### ① 编辑 API（增删 / 拖动 / 撤销重做）—— 齐

来源：`unpkg.com/mind-elixir@5.15.1/dist/types/methods.d.ts`（包内类型，一手）＋ 官方
`/docs/guides/node-operation`。

| 需求 | API（v5.15.1） | 备注 |
|---|---|---|
| 加子节点 | `mind.addChild(el?, node?)` → `Promise<void>` | `el` 省略 = 当前选中 |
| 加兄弟 | `mind.insertSibling('before'\|'after', el?, node?)` | |
| 加父（降一层级） | `mind.insertParent(el?, node?)` | |
| 删 | `mind.removeNodes(tpcs[])` | ⚠️ 类型里**只有复数形式**，官方 docs 写的 `removeNode`（单数）已过时 |
| 改层级/换父 | `moveNodeIn(from[], to)` · `moveNodeBefore` · `moveNodeAfter` | 拖拽的 API 侧等价物 |
| 上下移 | `moveUpNode(el?)` · `moveDownNode(el?)` | |
| 改文字 | `setNodeTopic(el, text)` · `reshapeNode(el, patch)` · `beginEdit(el)` | |
| 复制 | `copyNode(node, to)` · `copyNodes(tpcs[], to)` | |
| 按 id 取 DOM | `mind.findEle(id)` · 静态 `MindElixir.E(id)` · `getObjById(id)` | 多数 API 收 `Topic`（DOM 元素） |
| **拖动** | option `draggable: true`（内置 `nodeDraggable` 插件） | |
| **撤销 / 重做** | `mind.install(operationHistoryPlugin)` 后得到 `mind.undo()` / `mind.redo()` / `mind.clearHistory()`；option `allowUndo`；插件**自己**挂 `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | 源码 `src/plugin/operationHistory.ts`：**只在 `mei.editable` 为真时才响应键盘**；每次操作还 `console.log('operation', …)`（噪声，需注意） |
| 事件 | `mind.bus.addListener('operation'\|'selectNode'\|'expandNode', cb)` | `operation` 覆盖所有节点操作 |
| 拦截 | option `before: { addChild(el,obj){ return false } }`（可 async） | 守卫能直接否决 |
| 视图 | `scale` / `scaleFit` / `toCenter` / `changeTheme` / `expandNode` / `expandNodeAll` | |

### ② 导出 API —— `getData()` 有；**OPML/markdown 都没有；但 plaintext 转换器可复用**

| 能力 | 结论 | 证据 |
|---|---|---|
| `getData()` → `MindElixirData` 对象 | ✅ | `methods.d.ts`；官方 `/docs/guides/data-export` |
| `getDataString()` / `stringifyData(obj)` | ✅ | 同上 |
| **`getDataMd()`** | ❌ **不存在** | 本地 `dist/*.js` 全文搜 `getDataMd` = **0 命中**。官方 data-export 页却写着它（"markdown (deprecated, not recommended)"）⇒ **该页是 v4 遗留，别照抄** |
| `exportSvg()` → `Blob` | ✅ | |
| `exportPng()` → `Promise<Blob\|null>` | ✅ | 另有内置 `plugin/exportImage` |
| OPML | ❌ 无此 API | 全量类型清单里没有 |
| markdown 文档导出 | ❌ 无 | 只有下面的 plaintext 列表格式 |
| **plaintext ⇄ 数据** | ✅ **官方正式出口** `mind-elixir/plaintextConverter` | 实测 `dist/PlaintextConverter.js`（7,370 B）只 `export { mindElixirToPlaintext, plaintextExample, plaintextToMindElixir }`，**零运行时依赖**（纯函数，不需要同时载入 MindElixir） |
| xmind | 官方另一个包 `@mind-elixir/export-mindmap@0.1.11`（MIT，"Download mindmap file"，keywords `xmind`/`import`） | 本项目用不上，记一笔 |

**plaintext 格式**（源码 `src/utils/mindElixirToPlaintext.ts` + `plaintextToMindElixir.ts`，master 分支）：

```
- Root Node
  - Child Node 1
    - Child 1-1 {"color": "#e87a90", "fontSize": "18px"}
    - Child 1-2 [^id2]
    - }:2 前两个节点的摘要
    - > [^id1] >-单向连线-> [^id2]
```

- 节点行 = `- ` + 文本，缩进 = `'  '.repeat(depth)` ⇒ **每层 2 个空格**
- 行尾可选 `[^refId]`（箭头引用锚）、可选 JSON `{...}` style
- 扩展行：`- >`（箭头）、`- }`（摘要）—— 这是 mind-elixir 自己的语法，不是标准 markdown
- `plaintextToMindElixir(text, rootName = 'Root')`：**多个顶层节点会自动包一个合成根**
- 解析细节：缩进按**字符数**比较（tab 不展开）；空行先被过滤；无顶层节点抛错

⇒ **"怎么转回 `- 列表`"有答案了：直接用 `mindElixirToPlaintext(mind.getData())`。**

### ③ 体积与 license

| 文件（v5.15.1 实测字节） | 大小 |
|---|---|
| `dist/MindElixir.js`（ESM） | 121,100 |
| `dist/MindElixir.iife.js`（全局 IIFE） | 92,931 |
| `dist/MindElixir.css` | 12,441 |
| `dist/MindElixirLite.js` / `.iife.js` | 79,225 / 63,262 |
| `dist/PlaintextConverter.js` | 7,370 |
| `dist/LayoutSsr.js` / `i18n.js` | 4,168 / 7,002 |

- **离线三件套 ≈ 112 KB**（iife 92,931 + css 12,441 + converter 7,370）；用 ESM 版则 ≈ 141 KB
- **没有 `.min.js`** —— jsdelivr 的 entrypoints 接口给的是 `"guessed": true` 的
  `dist/MindElixir.iife.min.js`，**该文件不存在**（实测文件树里没有）。别照着猜的路径写代码
- npm tarball 142 KB（tgz）/ 解包后含 `.d.ts` 共 327 KB 量级
- **license = MIT**（包内 `LICENSE` 1,063 B；GitHub API `license.spdx_id: "MIT"`）
- 版本线：`5.15.1` = **最后一个正式版**；`6.0.0-next.1 … next.10` = next 线

### ④ ESM / UMD 用法（离线塞插件目录）

- **v5.15.1 = 两套构建都有**：
  - `package.json` 是 `"type": "module"`，`exports` 里**只声明了 `import` 条件**（没有 `require`）
  - 但 `dist/` 里**另有 IIFE 产物** `MindElixir.iife.js`（未在 `exports` 里声明，走文件路径直接用）
  - ESM：`import MindElixir from 'mind-elixir'` —— 尾部实测 `export { … os as default }`，
    另有 `THEME / DARK_THEME / LEFT / RIGHT / SIDE / DOWN` 命名导出
  - IIFE：头部 `var MindElixir=(function(I){…`，尾部 `I.default=Ct; Object.defineProperties(I,{__esModule:{value:!0}})`
    ⇒ **全局 `MindElixir` 是 module 对象，类在 `MindElixir.default`**
    （⚠️ 网上大量示例写 `new MindElixir({...})`，那是 v4 时代的全局直接是类；**待 WebView 实测确认**）
- **v6.0.0-next.x = 只有 ESM**：dist 里**没有**任何 iife 文件（jsdelivr 文件树实测）
  ⇒ 若要 `<script>` 注入路线，只能用 v5。

## 2. 版本选型：锁 `mind-elixir@5.15.1`

1. npm `dist-tags` 实测：`latest = 6.0.0-next.4`、`beta = 6.0.0-next.5`、`next = 6.0.0-next.10`
   ⇒ **裸 `npm i mind-elixir` 会装到一条预发布线上**，必须写死版本。
2. 6.x 是 next 线且**去掉了 IIFE**、`undo/redo` 挪进 `plugin/`，变动面大。
3. 5.15.1 是最后正式版，双构建齐全，社区示例/文档（大多按 5.x 写）对得上。

## 3. 与本项目的接缝（集成落点）

| 接缝 | 结论 | 证据 |
|---|---|---|
| 导图窗口挂真 DOM | `view.overrideShell({ mount })` **在独立窗口里已支持** | `src/App.tsx:2403-2405`：`shellTakeover && shellCtx ? <ShellMount …/> : …`，注释写明"窗口里同样允许接管 —— 但标题条与关闭按钮保留" |
| 库放哪 | 插件目录内（离线优先，不走 CDN） | 先例：`examples/dep-consumer`（插件间软依赖）、`examples/cdn-import`（外部脚本） |
| 写回 | 窗口里没有编辑器 ⇒ 整篇 `fs.writeText` 写回（窗口里 `doc.replaceRange` 用不了） | 先例见 `HANDOFF.md` rev52 段 |
| 笔记 → 导图 | 复用 `examples/outline-map/index.js` 已有的 `parseBlocks`（标题 + 列表 → 块/树） | 该文件已实现，别重写 |
| 验收 | CDP 驱动（窗口里加节点/拖动 → **以磁盘笔记为准**），沿用 `tools/verify-outline-map.mjs` 骨架 | |

## 4. 未验证项（诚实标注，别当结论）

1. **IIFE 全局形状**：`MindElixir.default` 是类 —— 只读了产物源码，**没在 WebView 里真跑过**。
   落地时第一件事就是用 CDP 验一句 `typeof window.MindElixir?.default`。
2. **markdown 保真度**：ZeroNote 的笔记有 `#` 标题层级，plaintext 只有 `- ` 单树
   ⇒ 标题 ⇄ 节点的映射要自己定（现有 `parseBlocks` 是现成起点）。**2 空格缩进**与项目现有列表用几格要对齐。
3. tarball 与解包产物放在 **`_tmp-mind-elixir-dl/`**（本轮为核实而下载；在 `.gitignore` 的 `_tmp-*/` 内，
   不进 git）。丢了也不心疼 —— `npm pack mind-elixir@5.15.1` 一条命令 142 KB 就回来。
   正式集成时把**只用到的文件**复制进插件目录，别整包搬。

## 5. 证据来源（全部可复现）

| 类别 | 具体 |
|---|---|
| npm registry | `registry.npmjs.org/mind-elixir/latest` · `registry.npmjs.org/-/package/mind-elixir/dist-tags` |
| jsdelivr data API | `data.jsdelivr.com/v1/packages/npm/mind-elixir@5.15.1`（文件树 + 精确字节）· `…/6.0.0-next.4` |
| unpkg | `unpkg.com/mind-elixir@5.15.1/package.json` · `?meta` · `dist/types/methods.d.ts` · `dist/types/plugin/operationHistory.d.ts` |
| 官方文档 | `docs.mind-elixir.com/sitemap.xml`（一次拿全站页面，避免猜路径）· `/docs/guides/data-export` · `/docs/guides/node-operation` · `/docs/api/mind-elixir.methods` |
| GitHub API | `api.github.com/repos/SSShooter/mind-elixir-core` ⇒ `default_branch: master`、MIT、3,178 stars |
| 源码（raw，master 已证实） | `src/utils/plaintextConverter.ts` · `mindElixirToPlaintext.ts` · `plaintextToMindElixir.ts` · `src/plugin/operationHistory.ts` |
| **本地实测** | `npm pack mind-elixir@5.15.1` → 解包 → 文件字节、`export` 段、`getDataMd` 0 命中、iife 头尾、`allowUndo` 命中 |

> 教训（与 `~/.dsh/AGENTS.md` 第 5 条一致）：**官方文档也会过时** ——
> data-export 页写的 `getDataMd()` 在 5.15.1 的产物里根本不存在。
> 体积、导出名、全局形状这类事实，一律以**包内产物/类型**为准，文档只用来定位。
