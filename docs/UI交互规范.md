# ZeroNote UI / 交互规范（现行）

> 状态：**active** ｜最后核对：2026-10-20 ｜权威范围：现行布局 / 键位 / 手势 / 浮层层级 / 主题
> 规划史与「当时为什么这样定」见 [`UI规划-v0.1.md`](UI规划-v0.1.md)（2026-10-11，部分已被本文件取代）；键位明细见 [`键位表.md`](键位表.md)。

## 1 桌面布局

```
┌ 标题条（自绘）────────────────────────────────────────────┐
│ ☰ 菜单 │ 文档名（拖出=收回〕│ 时间流开关 │ 最小化 最大化 关闭 │
├ 侧栏 ─┬ 时间流 ─┬ 编辑区 ────────────────────────────────┤
│ 文件树 │ 卡片流   │ 标签条（TabBar）                        │
│ 插件   │ 300px   │ 编辑器 / 插件面板（同一块内容区，rev173.85）│
│ 回收站 │ 可关    │ 状态栏（字数 / 状态 chip；B4 瘦身）       │
└───────┴─────────┴────────────────────────────────────────┘
```

> ⚠️ 本图仍是 B1 之前的形态（时间流在中间栏、无图标栏）；目标态见
> [`UI重布局-方案-2026-10-29.md`](UI重布局-方案-2026-10-29.md)，**B1–B4 已落地**（图标栏 / 侧栏视图容器 /
> 插件中心 / 文档工具条 + 状态栏瘦身）。本文件在 B7 之后统一重写。

| 区域 | 规则 | 代码锚点 |
|---|---|---|
| 标题条 | 自绘，菜单与窗口控制同一行；无系统标题栏 | `src/components/TitleBar.tsx` |
| 侧栏 | 宽度可拖，记忆 `zeronote.sidebar.w` | `src/App.tsx` |
| 时间流 | 侧栏与编辑区之间，默认 300px（160–560），可关，状态存 localStorage | `src/components/MobileNoteCards.tsx`（`variant="panel"`） |
| 标签条 | 编辑器顶部；标题 + 未保存圆点 + ×；拖出=拆窗。**B5**：右侧固定 `＋`（新建 / 打开面板）与 `»`（全部标签），无标签时也渲染 `＋` | `src/components/TabBar.tsx` · `src/lib/tabs.ts` |
| **笔记独立窗口**（B5） | 只编辑器 + 标题条；左上「切换」打开 `QuickSwitcher`（换笔记），关闭 = 交回主窗口 | `src/App.tsx`（`noteWindowPath` 分支）· `src/components/QuickSwitcher.tsx` |
| **文档工具条**（B4） | 标签条下方 32px：左＝`location: 'editor-topbar'` 插件面板（反链 / 历史，禁用即消失），右＝「源码 / 预览」+「⋯ 更多」；只在桌面 + 打开笔记时出现 | `src/components/DocToolbar.tsx` |
| **状态栏**（B4） | 只放状态：`location: 'statusbar'` 插件 chip + 错误 + 当前字数（篇数统计已删）；高 26px，可点 chip ≥24×24 | `src/components/AppStatusBar.tsx` |
| 插件面板 | **和编辑器同一块内容区**（标签条之下）——PDF / 导图默认开成主区标签（`panel:<id>`），拖出 / 右键 = 独立窗口；面板视图**侧栏照常显示**（rev173.85）· **每份文档一条标签**（title = 文件名，`doc-reader.view.<hash>`，面板标 `hidden` 不进 ☰ 菜单；rev173.86） | `src/components/PanelMount.tsx` · `view.registerPanel({ mount })` |
| **侧栏插件分组**（B6） | `location: 'sidebar'` 的面板渲染在侧栏文件树下方（最多 45% 高、内部滚动）；手机没有常驻侧栏 ⇒ 回退主区；零插件 / 全禁用整块不渲染 | `src/components/SidebarPlugins.tsx` · `AppSidebar.pluginSlot` |
| 浮层 | 命令面板 / 搜索 / 设置 / 替换均为遮罩浮层，**不推正文** | `CommandPalette.tsx` · `SearchPanel.tsx` · `ReplacePanel.tsx` |

## 2 手机布局

- **单窗口**：整窗接管，不新开系统窗口（理由见 [`D-005`](decisions/D-005-多窗口每窗口重跑App.md) 与多窗口调研）。
- 起始页 = 卡片流（`MobileNoteCards`）；长按 **＋** 500ms 弹环形快捷入口（`QuickLaunch.tsx`）。
- 侧栏是抽屉：左→右滑打开（**输入状态下不打开**）、右→左滑关闭；阈值 `|dx| ≥ 60` 且明显大于纵向（`src/lib/swipe.ts`）。
- 抽屉打开时隐藏系统状态栏，收起时恢复（`src/lib/systemBar.ts` + `tauri-plugin-statusbar`）。
- 长按 **☰** 500ms = 桌面右键菜单的等价物（新建 / 搜索 / 命令面板 / 设置 / 插件中心…）。
- 底部四项导航（B2）：**首页 / 搜索 / 插件 / 更多**，固定 id 与顺序；编辑态 / 工具页 / 回收站隐藏（键盘上方工具栏接管）。「更多」是全屏页（设置 / 回收站 / 切换库 / 插件入口 / 关于）。
- 长按卡片 = 卡片菜单；菜单打开时按返回键先关菜单（层出口栈）。

## 3 浮层与出口层级（一次只吃一层）

优先级从高到低（`App.tsx` 的 `backRef` 与 Escape effect）：

1. 自持浮层：☰ 菜单 / 库菜单 / 右键菜单 / 文件树多选 / 卡片菜单（rev173.66）
2. 设置
3. 搜索
4. 快速切换
5. 侧栏抽屉
6. 当前笔记（`Ctrl+W` 语义：关当前标签）
7. 都没有 ⇒ Android 返回键允许退出

规则：

- **Escape 从内到外**，一次只关一层；各浮层自己先处理，App 只兜底。
- 点遮罩关闭；命令面板 560px 宽、距顶 12vh（`.zn-palette`）。
- 查找面板是悬挂窗（fixed），不改变正文布局（rev173.43）。

## 4 键位

- 命令键位见 [`键位表.md`](键位表.md)（自动生成，勿手改）。
- **不进命令表**的按键（宿主/编辑器语义，写在这里）：

| 按键 | 行为 | 为什么不在命令表 |
|---|---|---|
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 下一个 / 上一个标签页 | `Tab` 有浏览器语义，需捕获阶段 `preventDefault` |
| `Esc` | 关最上层浮层 | 依赖实时状态，一次一层 |
| `Ctrl+V` | 粘贴剪贴板图片 → 落库 + 插 `![]()` | CM6 paste handler，只在带图片时接管 |
| `Ctrl+F` | 编辑器查找（WebView2 原生查找栏已关） | 编辑器内部行为 |
| `Ctrl+S` | 保存（命令 `core.save`） | 已在命令表 |
| Android 返回键 | 见 §3 层级 | 原生通道，不是键盘事件 |

## 5 手势

| 手势 | 结果 | 代码锚点 |
|---|---|---|
| 标签拖出窗口 | 拆成独立窗口（8px 阈值 / 越界热区） | `src/lib/tab-drag.ts` · `TabBar.tsx` |
| 独立窗口关闭 | 交回主窗口（保存 → 通知 → 关窗）；「拖标题条出界 = 收回」手势已移除（rev173.68） | `App.tsx` |
| 同一篇 | 同时只在一个窗口；主窗口再点 ⇒ 聚焦并提示 | `noteWindowsRef` + `useDocSession.canOpen` |
| 手机左/右滑 | 抽屉开关（输入状态禁用打开方向） | `swipe.ts` |
| 长按 ＋ / ☰ | 环形快捷入口 / 菜单 | `QuickLaunch.tsx` · `TitleBar.tsx` |

## 6 窗口

- 主窗口尺寸取 `src-tauri/tauri.conf.json` 默认值；**位置/尺寸不持久化**（见 [`D-006`](decisions/D-006-暂不接window-state.md)）。
- 独立笔记窗口：900×700、**只有编辑器**（无标签条）· 标题条三键照旧 · **整条标题栏可拖窗口**（`data-tauri-drag-region="deep"`，按钮自动排除）· 文档名**居中** · 点关闭 = **交回主窗口**（保存 → 通知 → 关窗，rev173.68；拖拽收回手势已按用户要求移除）。
- 插件窗口用 `plugin-*` label，能力与主窗口同级（`src-tauri/capabilities/default.json`）。

## 7 主题与视觉

- 主题三态：`light` / `dark` / `system`，偏好存 `zeronote.theme`；**只写解析后的 `data-theme`**，CSS 只有一条 `:root[data-theme='dark']` 分支（`src/lib/theme.ts`）。
- 首屏防闪：`index.html` 内联脚本在 React 挂载前设好 `data-theme`。
- 暗色滚动条：`color-scheme: dark` 只挂编辑器子树；全局滚动条自绘（6px、无轨道、静止淡出）。
- 安全区：三处各吃 `env(safe-area-inset-*)` —— `.zn-app` / `.zn-plugin-window` / `.zn-shell-host > .zn-shell-mount`。

## 8 反馈与空态

- Toast：`2.5s + 60ms/字`，上限 8s；失败/成功同一通道，不弹模态。
- 起始页空态：Markdown 标记速查表（14 条两列）+ 新建按钮。
- 插件页：读取/写入失败显示 `pluginError` 原因，不静默。
- 删除：先进回收站 + 撤销入口；物理删除二次确认。

## 9 明确不做 / 待做

| 项 | 状态 | 原因 |
|---|---|---|
| 分屏（两个编辑器共用一份 docApi） | 未做 | 同一篇并发改的语义未定 |
| 窗口位置持久化 | 未做 | `window-state` 不支持 Android；`note-*` 恢复策略未定（D-006） |
| 标签拖拽投放区高亮 | 未做 | 当前是「拖出边界」手势 |
| 自定义键位 UI | 未做 | 命令表已支持 `keybinding`，缺设置界面 |
