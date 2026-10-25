# 贡献指南

> 最短路径：`pnpm install` → 改 → `pwsh -File scripts\verify.ps1` 全绿 → 提 PR。

## 这是什么项目

**空内核 + 插件**的本地 Markdown 笔记应用（Tauri 2 / React 19 / Rust）。内核只做四件事：
`.md` 读写、编辑、本地存储、插件宿主；其余功能全是插件，放/删一个文件夹就装/卸。

三条硬规矩，改代码前先知道：

1. **内核保持薄** —— 能写进插件的，不进内核。
2. **依赖方向单向** —— `kernel` 不引 `components`，详见 `docs/开发约定.md` §1、`scripts/check-arch.mjs`。
3. **静默失效比报错危险** —— 宁可红，不要"看起来 ok 其实没干活"。

安全边界先读清：插件与内核**同权限运行**，内核**不提供沙箱**（`docs/架构原则-2026-10-13.md` §4.1）。
所以本仓库对插件代码的信任边界就是「装谁的插件」——这也是 `market/README.md` 反复强调的。

## 环境

| 需要 | 版本 / 说明 |
|---|---|
| Node | ≥ 20（`package.json` engines） |
| pnpm | ≥ 9（仓库用 `pnpm@10.34.6`，`corepack enable` 或直接装都行） |
| Rust | stable（`cargo test --lib` 要它） |
| Tauri 2 系统依赖 | Windows：WebView2 + MSVC Build Tools；其它平台见 Tauri 官方 setup 指引 |

跑起来（桌面）：见 `README.md`「怎么跑」。前端热更新只用 `pnpm dev`，改 Rust 才需要重编。

## 提交前门禁（必跑）

```powershell
pwsh -File scripts\verify.ps1
```

六步：`tsc -b` 0 错误 · `oxlint src` 0 error · `cargo test --lib` · `check-docs` · `vitest` · 质量门
（facts / 依赖方向 / 本地链接 / 功能目录 / 键位表 / 市场索引）。

非 Windows 环境按步等价执行：

```bash
pnpm exec tsc -b
pnpm exec oxlint src
pnpm exec vitest run
node scripts/check-docs.mjs
node scripts/check-gates.mjs
(cd src-tauri && cargo test --lib)
```

CI 跑的是同一套门（`.github/workflows/verify.yml`，`windows-latest`）。
**本地绿、CI 红通常意味着测试依赖了本机环境**（locale / 路径 / 时区），要改代码让结果确定，
不要改 CI 去迁就——本仓库真踩过：中文标签排序没传 locale，本机 zh-CN 过、CI 的 en-US 红。

## 代码约定（摘要）

完整版：`docs/开发约定.md`。最常被卡住的四条：

1. **先查现成**（§0.5）：项目内有没有同款、官方文档怎么说、同类产品怎么做。
2. **先写测试**（§4）：`tests/<域>.test.ts(x)`；组件测试首行
   `// @vitest-environment happy-dom`，并且 **`afterEach(cleanup)`**（不写会累积 DOM，断言看错元素）。
3. **断言行为，不断言实现**：看外部可观察的调用与状态。
4. **一个 PR / 一个提交只做一件事**：搬移和顺手修分开（review 才看得出行为变化）。

改了 `HANDOFF.md` / `docs/` 必须额外过 `check-docs`；数字（测试数 / warning 数）从命令输出抄，不要估算。

## 文档约定

- 新文档带状态头（`> 状态：active ｜ …`），并登记进 `docs/README.md` 的权威矩阵。
- `HANDOFF.md` 是维护者的逐 rev 日志；外部贡献者**不需要**维护它，合并时维护者补。

## 提交信息

```
fix: 一句话说清改了什么
feat: …
docs: …
```

维护者自己的提交会带 `(revNNN)` 编号，外部 PR 不需要。

## 插件贡献

- **官方插件**（进 `examples/`）：`manifest.json` + 源码 + `tests/` 单测；
  `category` 必填，能力声明按实际用到的写。打包/发版见 `market/README.md`。
- **外部作者**：不要把插件源码塞进本仓库。按 `market/README.md`「外部作者怎么投稿」——
  自己的仓库放插件 + `market-entry.json`，来这里 PR 只加 `market/external.json` 一行。
  版本信息留在你自己的 `market-entry.json`，发新版不用再改这个仓库。
- **签名**：对外分发的包必须签名。私钥**永远不要**提交（本仓库的私钥在仓库外，见 `market/README.md`）。

## PR 流程

1. 开 issue 说清动机（bug 请附复现步骤），大改先对齐方向再写代码。
2. 小步提交，说明「为什么」而不只是「改了什么」。
3. CI 绿 + 自测证据（截图 / 命令输出 / 复现步骤）。
4. 合并前维护者会亲自过一遍关键语义 —— 涉及插件宿主、同步合并、写盘路径的改动尤其如此。

## 我们不接受的操作

- 任何让「插件默认拥有更多权限」的改动，除非有明确的安全论证。
- 把 `CARGO_TARGET_DIR` 指进仓库（会产生几十万文件）；把测试库 / 日志 / 截图提交进来。
- 只改 CI 让红变绿，而没解决测试不稳定的根因。
