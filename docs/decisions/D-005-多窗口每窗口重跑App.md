# D-005 多窗口每窗口重跑 App，暂不搬进程

> 状态：**accepted（临时）** ｜日期：2026-10-20 ｜重议条件：窗口数 > 3、启动 > 2 s、或出现跨窗口 store 冲突

## 背景

rev173.51–54 做了「标签拆独立窗口」：每个 `note-*` 窗口重新跑完整 App，`usePluginHost` 会 `ensureBuiltinPlugins`（写盘检查）+ 扫插件目录；内置 5 个插件里 4 个没有 `activationEvents`、`accounting` 是 `onStartup`，所以它们**每个窗口都会执行代码**；声明了懒激活的用户插件只登记命令元数据。

## 决定

暂不把插件宿主搬到 Rust / 独立进程。先做「笔记窗口跳过插件加载」（见 `docs/全功能对标调研-方案-2026-10-20.md` §2.1 方案 A）。

## 理由

- VS Code 也是**每个窗口一个 extension host**（由 shared process **派生**，[PR #133445](https://github.com/microsoft/vscode/pull/133445)），共享的是扩展安装目录与 globalState —— 不是「多窗口共享一个扩展宿主」。
- 搬进程是架构级成本（命令表、面板、事件总线都要跨进程），当前收益不匹配。
- 懒激活机制已有（`src/hooks/usePluginHost.ts` 的 `activationEvents` 分支），缺的只是「哪些窗口要插件」。

## 代价与边界

内置插件的副作用随窗口数增长（store 写入、通知监听回调）；每个窗口启动都要扫一遍插件目录。占用账本 `noteWindowsRef` 在主窗口内存，reload 会丢。

## 相关

`src/App.tsx`（多窗口）· `src/hooks/usePluginHost.ts` · `docs/标签窗口拖拽-调研-2026-10-20.md`
