# ZeroNote 交接卡

> 生成 **2026-10-12（下午）** · 本批已提交：`3e79c94`（父提交 `fbd3a4a`）
> 这是**一屏版**；全部细节（证据截图、踩坑、逐条验收）在 **`HANDOFF.md`（rev33）**。
>
> 🔄 **2026-10-12 更晚（rev33）**：这张卡已落后于 `HANDOFF.md` —— **CSP 落地、文件关联、
> 桌面侧栏切库、最近库过期记录自动清理、平台门**都不在卡里。**以 `HANDOFF.md` 和
> `git log --oneline -5` 为准**；下面两处被 ⚠️ 标出的数字已按 rev33 校正。
>
> ⚠️ **`manifest.platforms` 现在真的生效了**：只接受 `"desktop"` / `"android"`
> （双端就两个都写；不写 = 全平台）。**写 `"web"` 或拼错会被拒载并报错**；
> 与当前平台不符的插件会被跳过，在插件管理页显示「不适用 · 仅桌面端 / 仅移动端」。
>
> ⚠️ **本卡里的 commit / 行数 / 计数会随提交过时** —— 以 `git log --oneline -5` 和实际命令输出为准。

---

## 这是什么

空内核的**本地 Markdown 笔记应用**。Tauri 2.12.2（桌面 + Android）+ React 19 + Rust。
**一切功能靠插件**（库内 `.zn/plugins/<id>/`，装/卸就是放/删一个文件夹）；
内核只提供 **10 个原语**（fs / doc / index / event / command / view / store / host / service / editor）
和 **21 种 UINode**，插件用**语义化档位**（`gap` / `tone` / `variant`）声明界面，宿主映射到设计令牌。

---

## 现在的状态（一句话）

**①–⑩ 十项全部完成**（⑧⑩ 于 2026-10-12 下午经用户授权后落地）；验收基线有一处**有意变更**：`oxlint` 5 → 4。

---

## 30 秒上手

```powershell
cd C:\Users\AQUA\Documents\deepseek\ZeroNote

pnpm exec tsc -b            # 必须 0 错误
pnpm exec oxlint            # 必须**恰好 4 warnings**（基线，2026-10-12 从 5 变为 4，原因见下）
cd src-tauri; cargo test --lib   # ⚠️ 必须 17 passed（rev32 新增 vault_exists_is_read_only；看 `running N tests` 的数字，别只看 ok）
```

> 📌 `oxlint` 为什么从 5 变 4：`setPluginError(null)` 从 effect 体里挪进了异步回调，
> `react(set-state-in-effect)` 不再命中。**警告减少不是新问题**，新基线就是 **4**。

真机（Android · 设备 `33b676f6`，`adb devices` 确认在线）：

```powershell
# 改前端/Rust 后的完整回路（约 3 分钟）
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:APPDATA\npm;$env:PATH"
$env:CARGO_TARGET_DIR = "$env:USERPROFILE\cargo-targets\zeronote"
pnpm tauri android build --apk --target aarch64 --debug
adb install -r src-tauri\gen\android\app\build\outputs\apk\universal\debug\app-universal-debug.apk
adb shell am force-stop com.aqua.zeronote.debug
adb shell am start -n com.aqua.zeronote.debug/com.aqua.zeronote.MainActivity

# 只改插件（不用重新打包）：**推单个文件到明确路径**，别推整个目录
#   ⚠️ `adb push <目录> <已存在的目标>` 会多套一层子目录，插件就找不到文件了
adb push examples\net-demo\index.js /storage/emulated/0/Documents/ZeroNote/.zn/plugins/net-demo/index.js

# 真机点击：**tap 不生效，swipe 生效**（同坐标同刻实测）
adb shell input swipe 93 185 93 185 120     # 点 ☰
```

---

## 硬约束（不许破）

1. **capability / 安全模型的改动**（信任根、授权路径、工具白名单、提权入口）
   → **必须先拿到用户对「具体方案」的同意**才可动手。方向同意 ≠ 方案同意。
2. 每批交付纪律：`tsc -b` 0 错误 + `oxlint` 基线（现 **4**）+ **真机截图/命令证据** + 自主提交 + HANDOFF 更新。
3. **手机截图直接 `adb shell screencap`** —— 用户自己开着窗口，**不要**用 `gentle_*`。
4. **内核保持薄**：能当插件做的事不要塞进内核；新能力优先做成**前置插件**（`service` 原语）。
5. **静默失效比报错危险** —— 看 `cargo test --lib` 的 `running N tests` **数字**；
   `oxlint` 的 warnings **计数**；插件的"注册了但没登记"这类记账错误在首次安装时看不出来。

---

## 已完成（十项，**别重做**）

```
① fs 文件夹(mkdir/move) ✅   ② 编辑器工具栏挂载点 ✅   ③ index 标签 ✅
④ index 分区 ✅             ⑤ host.saveFile(含二进制) ✅ ⑥ 编辑器标记 ✅
⑦ 懒激活机制 ✅             ⑧ net 授权通道 ✅         ⑨ 安全存储(前置插件) ✅
⑩ WebView 逃生口 ✅
```

**额外成果**：`service` 前置插件原语 · `editor` 原语 · **命令接管**（插件可覆盖 `core.newNote` 等）·
**⑧ 的授权通道**（设置页逐插件开关 + `.zn/permissions.json` + 契约 §4 诚实改写）·
**⑩ 的 `registerWebView`**（sandbox iframe + postMessage 主题令牌）· **CSP 落地**（从 `null` 变白名单）·
**插件资源自动登记** + **插件生命期串行链**（修掉"重载必报命令 id 重复"的两个根因）·
能力对照文档 · 修复插件重载竞态幽灵。

---

## 本次学到的四条硬事实（细则见 HANDOFF「rev30 新踩的五个坑」）

1. **CSP 一开，`data:`/`blob:`/`srcdoc` 的 iframe 里内联脚本必被拦** —— Tauri 注入的 `sha256`
   会让 `'unsafe-inline'` 失效。**要给插件页面跑脚本，页面必须来自独立 origin（`http(s):`）。**
2. **Tauri asset 协议在 Android 上不服务 `.html`**（`ERR_INVALID_RESPONSE`），图片可以。
3. **加 CSP 之后「裸 fetch」真的被 `connect-src` 拦住了**：白名单内 `fetch esm.sh` → HTTP 200；
   白名单外 `fetch example.com` → `TypeError: Failed to fetch`。~~**这条边界比 `permissions.json` 硬得多。**~~
   ⚠️ **2026-10-12 12:30 已失效**：`connect-src` 被用户裁决**放宽**成 `https: http: ws: wss:` ⇒
   CSP 不再逐域名管出口。现在插件联网的第一道墙是 **CORS**（由目标服务决定），
   第二道是 ⑧ 的**加载期**授权（未授权则拒载）—— **运行期拦截为零**（没声明 `net` 的插件照样能 fetch）。
4. **真机点击用 `input swipe x y x y 120`**（`input tap` 在 WebView 里不生效）。

---

## 下一批候选（**阻塞已解除，等用户指定**）

| # | 议题 | 为什么值得做 | 状态 |
|---|---|---|---|
| ~~A~~ | ~~**`platforms` 声明强制**~~ | ✅ **已完成（rev33）** —— 三档语义（`["desktop"]` / `["android"]` / 双端）+ 两道门（`loadPlugin` + 加载循环提前判，覆盖懒激活）+ 不匹配只在插件页标「不适用」不报错 + 拼错取值直接拒载报错。示例 `examples/platform-locked/` | 已完成 |
| B | **沙箱（Worker + 内存/时长上限）** | 唯一能防 `while(true)`、也是唯一能把 capability 变成真隔离的 | ⛔ **2026-10-12 用户裁决：搁置**（插件目前都是自己写的；将来要做插件分发再评估） |
| C | **iframe ↔ 宿主能力通道** | 现在 WebView 只能收令牌，不能调 `ctx.*`；需先定 postMessage 协议 + 宿主鉴权 | v0.2 |
| D | **`host.saveFile` 接 Android SAF** | 手机「另存为」会留 **0 字节文件**（SAF 返回 `content://`，`std::fs` 处理不了） | ⛔ **用户已声明不走手机方向**（2026-10-12） |
| E | **`[[x]]` 接管协商** | atomic 的 wikilink 装饰优先级高于 `editor.addMark`，想接管得跟它协商（HANDOFF 坑⑦） | 未动 |
| F | ~~最近库「移除」入口~~ | ✅ **本轮已完成（rev32）** —— 打开菜单即只读探测、自动剔除过期记录 + 提示；`applyVault` 另加一道门（菜单弹出后目录才被删 ⇒ 拒绝切换并剔除）。未碰安全模型 | 已完成 |

> 另：**授权记录不绑定插件指纹** —— 插件升一版后旧授权仍有效（契约 §7.6 的未决项），要做指纹得先问用户。

---

## 读哪份文档

| 想知道 | 读 |
|---|---|
| **全部细节 / 证据截图 / 踩坑** | `HANDOFF.md`（**以头部 revision 为准**，当前 rev33） |
| **内核 10 个原语的准确签名 + 契约边界** | `docs/内核契约-v0.1.md`（§4 是 capability 与「诚实边界」） |
| **规格 §2.1–2.8 逐条「能做 / 不能做 / 缺什么」** | `docs/能力对照-规格2.1-2.8.md` |
| **18 个示例插件怎么用** | `examples/`（每个文件头都有注释表格；真机装了 13 个） |
