# D-006 暂不接 window-state

> 状态：**superseded**（2026-10-25 复核：rev173.61 已接入 `tauri-plugin-window-state 2.5.x`，只挂桌面段、只跟踪 `main`；见 `src-tauri/Cargo.toml:61`、`src-tauri/src/lib.rs:2451`）｜日期：2026-10-20 ｜原重议条件：桌面窗口体验成为抱怨点，且定下 `note-*` 的恢复策略

## 背景

主窗口每次按 `tauri.conf.json` 默认尺寸打开，独立窗口固定 900×700；用户调过的大小和位置不保留。官方有 `tauri-plugin-window-state`。

## 决定

> ⚠️ **2026-10-25 更正：已接入（rev173.61），本条作废。** 做法：`with_filter` 只跟踪 `main`，
> StateFlags = POSITION / SIZE / MAXIMIZED（**不碰** VISIBLE / DECORATIONS / FULLSCREEN）；依赖只挂桌面段
> （官方 README 标注 Android / iOS 不支持）。下面原文保留作设计史。

暂不接入。保留为 P1 候选（见 `docs/全功能对标调研-方案-2026-10-20.md` §2.2）。

## 理由（一手来源）

- 官方支持表：Linux / Windows / macOS ✓，**Android / iOS ✗**（[docs.rs](https://docs.rs/crate/tauri-plugin-window-state/2.0.1)）。本项目含安卓，接入必须按 `cfg` 分流，并确认安卓构建不受影响。
- `note-*` 独立窗口的恢复语义未定：恢复同一位置 / 一律居中 / 不恢复，三选一需要产品决定。

## 代价与边界

每次启动要重新调窗口；多显示器切换后位置丢失。属于体验问题，不是功能缺陷。

## 相关

`src-tauri/tauri.conf.json`（窗口默认尺寸）· `docs/全功能对标调研-方案-2026-10-20.md` §2.2
