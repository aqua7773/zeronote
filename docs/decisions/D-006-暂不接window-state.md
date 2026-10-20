# D-006 暂不接 window-state

> 状态：**pending** ｜日期：2026-10-20 ｜重议条件：桌面窗口体验成为抱怨点，且定下 `note-*` 的恢复策略

## 背景

主窗口每次按 `tauri.conf.json` 默认尺寸打开，独立窗口固定 900×700；用户调过的大小和位置不保留。官方有 `tauri-plugin-window-state`。

## 决定

暂不接入。保留为 P1 候选（见 `docs/全功能对标调研-方案-2026-10-20.md` §2.2）。

## 理由（一手来源）

- 官方支持表：Linux / Windows / macOS ✓，**Android / iOS ✗**（[docs.rs](https://docs.rs/crate/tauri-plugin-window-state/2.0.1)）。本项目含安卓，接入必须按 `cfg` 分流，并确认安卓构建不受影响。
- `note-*` 独立窗口的恢复语义未定：恢复同一位置 / 一律居中 / 不恢复，三选一需要产品决定。

## 代价与边界

每次启动要重新调窗口；多显示器切换后位置丢失。属于体验问题，不是功能缺陷。

## 相关

`src-tauri/tauri.conf.json`（窗口默认尺寸）· `docs/全功能对标调研-方案-2026-10-20.md` §2.2
