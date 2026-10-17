# Changelog

> 状态：**active** ｜最后核对：2026-10-17 ｜权威范围：契约 / 协议层的变化（功能细节见 `HANDOFF.md`）

## [0.2] - 2026-10-17（文档）/ 2026-10-18（rev118 落到代码）

> **2026-10-18（rev118）**：`API_VERSION` 由 `0.1.0` 升为 `0.2.0`；所有
> `examples/*/manifest.json` 的 `apiVersion` 同步改 `^0.2.0`。加载校验只看 major
> （`assertApiVersion`），0.1 / 0.2 互通，现装插件不受影响。
> 同轮落地：`NoteMeta.id`（独立笔记 ID，存 `<库>/.zn/ids.json`）+ `rename` 时 ID 跟随
> 与全库 `[[链接]]` / `](相对路径)` 重写。

### Added
- capability：`editor:line-action`（rev54）· `editor:line-class`（rev78）· `editor:fold`（rev80）
- `host.assetUrlAbs`（rev75）· `host.pickFile` / `host.readContentUri`（rev85）
- `editor.addLineClass` / `addFold` / `toggleFold` / `foldAt` / `restoreFolds` / `lineAtElement`（rev78/80/81）
- 插件来源：`global` / `vault` / `builtin`（rev94 / rev110）

### Changed
- `saveFile` 接受 `Uint8Array`（二进制导出）
- capability 语义改为**自述**（非门）—— rev48 拆门、rev66 清遗留
- 「插件只住库内」的旧描述被三种来源取代

### Removed
- `.zn/permissions.json` 与 Rust 的 `read_permissions` / `set_permission`（rev66）
- `scopedFs` / `scopedDoc` 的 capability 裁剪（rev48）

### Fixed
- 契约与 `contract.ts` 的 10 处不一致（capability / host / editor / 六种挂载位 / 阶段表 / 未决项状态 / 插件来源）

## [0.1] - 2026-10-11
- 首版：10 原语 · 21 种 UINode · manifest / 懒激活 / 四种入口形态 · 接管协议 · 无沙箱声明
