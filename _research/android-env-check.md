# ZeroNote · Tauri 2 Android 开发环境就绪度检查（M3 前置清单）

> 状态：**historical**（调研快照，带日期）｜最后核对：2026-10-17 ｜说明：结论按当时实测；引用前先看日期

> 检查方式：**只读查询**。未安装、未升级、未改 PATH、未改任何配置、未启动任何服务。
> 检查时间：本次会话（同日基线：ZeroNote 桌面 Rust 产物时间 2026-10-11 16:10）。
> 参照物：`NoteGen-Self`（本机已跑通 Android 真机 dev 模式）——其 `SELF-README.md` §4.1 / §5.3 记为经验起点。

---

## 0. 结论摘要

| 判定 | 数量 | 项 |
|---|---|---|
| ✅ 就绪 | 13 | JDK、ANDROID_HOME、SDK 五个子目录、NDK、adb、真机、Node/pnpm、Tauri CLI、Rust 工具链本体、gradle 缓存、项目 mobile 入口代码 |
| ❌ **阻塞缺失** | **2** | ① 默认 Rust 工具链缺 4 个 Android target；② `src-tauri/gen/android` 未生成 |
| ⚠️ 建议补 / 待验证 | 3 | ③ NDK_HOME 未设置（CLI 可自探测，非阻塞）；④ 项目 `.cargo/config.toml` 缺 android linker 段；⑤ `dist/` 未构建（仅 `build` 需要，dev 不需要） |

**一句话**：Android 侧的系统件（JDK / SDK / NDK / adb / 真机 / gradle 缓存）**全都齐了**；缺的是**两件项目内的事**——给当前默认工具链补 Android 交叉编译 std，以及跑一次 `tauri android init`。填完这 2 条即可进 M3。

---

## 1. 就绪 / 缺失清单

| # | 项 | 期望值 | 实测值 | 结论 |
|---|---|---|---|---|
| 1 | JDK | ≥ 17，`JAVA_HOME` 指向它 | Temurin **17.0.20.1**；`JAVA_HOME=C:\src\jdk-17.0.20.1+1`（目录存在，`java.exe` 在）；`java` 也在 PATH | ✅ |
| 2 | `ANDROID_HOME` | 指向 SDK 根 | `C:\Users\AQUA\AppData\Local\Android\Sdk` | ✅ |
| 3 | `ANDROID_SDK_ROOT` | 同上 | 同上（一致，无冲突） | ✅ |
| 4 | SDK · `build-tools` | 有 35.x/36.x | `35.0.0`、`36.0.0` | ✅ |
| 5 | SDK · `platforms` | 覆盖 compileSdk | `android-34`、`android-35`、`android-36` | ✅ |
| 6 | SDK · `ndk` | ≥ 26（项目实际用 28.x） | `28.2.13676358`（单个版本） | ✅ |
| 7 | SDK · `cmdline-tools` | `latest` 可用 | `23.0-bootstrap`、`latest`（`sdkmanager.bat` / `apkanalyzer.bat` 在位） | ✅ |
| 8 | SDK · `platform-tools` | 存在 | 存在（另有一份 winget 独立安装：`Google.PlatformTools_...`，两份都在 PATH 上） | ✅ |
| 9 | `adb` | 可执行 | `1.0.41` / `37.0.1-15733141` | ✅ |
| 10 | 真机连接 | `device` 状态 | `33b676f6  device`；型号 `24069RA21C`、Android **16**（SDK 36）、ABI `arm64-v8a` | ✅ |
| 11 | Rust 工具链本体 | 有 stable | `stable-x86_64-pc-windows-msvc`（active, default, rustc **1.99.0**）+ `1.88.0-x86_64-pc-windows-msvc` | ✅ |
| 12 | **Rust Android target** | 默认工具链含 `aarch64-linux-android` 等 | `rustup target list --installed` → **仅 `x86_64-pc-windows-msvc`**。4 个 android target **只存在于 `1.88.0` toolchain**，stable(1.99.0) 里一个都没有 | ❌ **阻塞** |
| 13 | NDK 交叉编译器 | `*-linux-android24-clang.cmd` 在位 | 4 个都在：`aarch64-` / `i686-` / `x86_64-`，**`armv7a-linux-androideabi24-clang.cmd` 不在 `*android24-clang.cmd` 名单里**（命名不同，NoteGen 配置里用的正是 `armv7a-...` 这个全名，路径有效） | ✅ |
| 14 | `NDK_HOME` / `ANDROID_NDK_HOME` | 通常由 CLI 自探测 | **两者均为空** | ⚠️ 非阻塞（见 §3） |
| 15 | Tauri CLI · android 子命令 | 可用 | `pnpm tauri android --help` → `init / dev / build / run`，`tauri-cli 2.12.2` | ✅ |
| 16 | `pnpm tauri info` 的 Android 段 | — | **未输出任何 Android/Java 段**（只报桌面环境）⇒ 不能拿 `info` 当 Android 就绪判据 | ⚠️ 观察项 |
| 17 | Node / pnpm | — | `node v24.21.0` / `pnpm 10.34.6` | ✅ |
| 18 | **`src-tauri/gen/android`** | `tauri android init` 已跑过 | **不存在**（`src-tauri` 只有 `capabilities/ icons/ src/ build.rs Cargo.toml Cargo.lock tauri.conf.json`）；对照 NoteGen-Self 有完整 `gen/android`（含 `buildSrc`、`gradlew`、`app/`） | ❌ **阻塞** |
| 19 | gradle 缓存 | wrapper + AGP 依赖已落地 | `~\.gradle\caches` 有 `8.14.3` / `9.3.1` / `modules-2`；`wrapper\dists` 有 `gradle-8.14.3-bin`、`gradle-9.3.1-all`；`modules-2` 里 **AGP（`com.android.tools.build`）与 Kotlin 编译器依赖已缓存** | ✅（首次构建大概率不必再下 AGP） |
| 20 | NoteGen-Self 的 Android 产物（起点参照） | 存在 | `gen/android/{app,build,buildSrc,gradle,.gradle,...}`；`cargo-targets\note-gen\{aarch64-linux-android, armv7-linux-androideabi, debug}`；真机上已装 `com.codexu.NoteGen` | ✅ 证据（本机链路确实跑通过） |
| 21 | ZeroNote 项目级 cargo 配置 | 走镜像 | `.cargo\config.toml`：`replace-with = "rsproxy-sparse"` + `[net] git-fetch-with-cli = true`。**缺 NoteGen 那 4 段 `[target.*-linux-android] linker`** | ⚠️ 见 §4 |
| 22 | ZeroNote 的 mobile 入口 | `#[cfg_attr(mobile, tauri::mobile_entry_point)]` | 已有（`src-tauri/src/lib.rs:301`），`setup` 内只有 `cfg!(debug_assertions)` 的 log 插件，无 desktop-only API | ✅ |
| 23 | ZeroNote 其它前置文件 | capabilities / 图标 | `capabilities\default.json`（`windows:["main"]`、`core:default`+`dialog:default`）✅；`icons\` 含 `icon.png`（android init 要用）✅ | ✅ |
| 24 | 桌面侧基线 | 能编过 | `cargo-targets\zeronote\debug\` 已有 `zeronote_lib-*.exe`（2026-10-11 16:10） | ✅ |
| 25 | `dist/` | dev 模式不需要 | 不存在（`frontendDist: ../dist` 仅 `build` 需要；dev 走 `devUrl: http://localhost:1420`） | ⚠️ 提示 |

**对照 NoteGen-Self 成功配方**（`SELF-README` §4.1）：`rust-toolchain.toml` 固定 `1.88.0`（**它的 android target 就装在这个 toolchain 上**）+ `CARGO_TARGET_DIR` 外移 + `pnpm tauri dev`（一个 server 同时喂桌面与手机，CLI 自动 `adb reverse`）。

---

## 2. ❌ 阻塞缺失项 —— 具体命令（**写出，未执行**）

### 缺失 ①：当前默认工具链没有 Android 交叉编译 std

为什么必须补：ZeroNote **没有** `rust-toolchain.toml`，`tauri android dev` 会用默认 `stable 1.99.0`；而 4 个 android target 只装在 `1.88.0`。
为什么**不能**照抄 NoteGen 降级到 1.88.0：ZeroNote `src-tauri/Cargo.toml` 写了 `edition = "2024"` + **`rust-version = "1.90"`**，1.88.0 会被 cargo 直接拒绝。

```powershell
# 给默认 stable(1.99.0) 装 4 个 Android ABI 的 std
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android

# 若只想跑这台真机（arm64-v8a，实测 ABI 就是它），最少只需：
rustup target add aarch64-linux-android
```

> 注意：必须在**默认 toolchain** 上加。若要显式指定：`rustup target add --toolchain stable aarch64-linux-android`。
> 校验：`rustup target list --installed` 应出现 `aarch64-linux-android` 等。
> 此命令**只下载 std 组件**，不改任何配置文件，不装系统软件。

### 缺失 ②：Android 工程目录未生成

```powershell
# 前置：补 PATH（DSH 派生 shell 默认没有 .cargo\bin）
$env:Path += ";$env:USERPROFILE\.cargo\bin;$env:APPDATA\npm"

cd C:\Users\AQUA\Documents\deepseek\ZeroNote
pnpm tauri android init
```

> 产出应为 `src-tauri\gen\android\`（`app/`、`buildSrc/`、`gradlew`、`gradle/wrapper/`）。
> 生成时若提示「Do you want to install the Android NDK using the command line tools?」——**本机已有 NDK 28.2.13676358，应走 “Using installed NDK”，不要答 yes**（避免联网装第二份 NDK）。

### 缺失 ③（非阻塞，保险）：NDK_HOME 为空

证据：Tauri CLI 二进制里同时存在两条路径 ——
`ANDROID_HOME ?, trying to locate Android SDK...` / `Using installed NDK: ?`（**自探测**）
`Have you installed the NDK? The \`NDK_HOME\` environment variable isn't set, and is required` + 错误枚举 `NdkHomeNotSet / NdkHomeNotADir / VersionLookupFailed / VersionTooLow`（**探测失败才要求**）。

本机 NDK 就在规范位置`%ANDROID_HOME%\ndk\28.2.13676358`，且 NoteGen-Self 记载的跑通命令里**没有设** `NDK_HOME` ⇒ 判定**非阻塞**。若首次 `android init/dev` 真报 NDK_HOME 相关错误，再设：

```powershell
# 仅当前 shell 生效，不写系统环境变量
$env:NDK_HOME = "C:\Users\AQUA\AppData\Local\Android\Sdk\ndk\28.2.13676358"
```

> 同一二进制里还有一句硬检查：`At least NDK ?% is required (you currently have NDK ?.)` —— **最低 NDK 版本号是运行时格式化的，未能从二进制中读出**；28.2（NDK r28，2025）高于 Tauri 2 一贯的最低要求，判定"应通过"，但标注为**未实测**。

### 缺失 ④（可选）：项目 `.cargo/config.toml` 缺 android linker 段

现状：只有镜像配置。NoteGen-Self 之所以写了 4 段，是**为了绕开 Tauri CLI 直接用 `gradlew` 构建**时（无 CLI 注入）报 `linker \`cc\` not found`。
走标准 `pnpm tauri android dev` 时 CLI 会注入这些路径 ⇒ **非必需**。要补就照抄 NoteGen-Self 的 `C:\Users\AQUA\Documents\deepseek\NoteGen-Self\.cargo\config.toml` 中 `[target.aarch64-linux-android]` 等 4 段（NDK 路径同为 `28.2.13676358`，API 级别 24，与 Tauri 生成的一致）。

### 缺失 ⑤（仅 `build` 需要）：`dist/` 不存在

`pnpm build` 后生成；`tauri android dev` 走 `devUrl: http://localhost:1420`，**不需要** `dist/`。

### M3 首次上机的完整命令序（含前置，**未执行**）

```powershell
$env:Path += ";$env:USERPROFILE\.cargo\bin;$env:APPDATA\npm"
$env:CARGO_TARGET_DIR = "$env:USERPROFILE\cargo-targets\zeronote"   # 必须外移，见坑 2
cd C:\Users\AQUA\Documents\deepseek\ZeroNote

rustup target add aarch64-linux-android        # ① 一次性
pnpm tauri android init                        # ② 一次性，生成 gen\android
pnpm tauri android dev                         # ③ M3：编译 + adb install + adb reverse 1420
```

---

## 3. M3 最容易踩的 5 条坑（NoteGen-Self 实测 + 本次核查）

1. **别用 `tauri android build` 的静态包验证** —— Android/Windows 走 `https://tauri.localhost`，`tauri-2.11.6` 只 `strip_prefix("tauri://localhost")`，剥不掉就路径变空串 → 回退路由走不到 → WebView 里必然是纯文本 `Internal Server Error`（§5.3-9）。**M3 只走 dev + devUrl**。
2. **Rust 编译产物必须放在工作区之外** —— 在 `Documents\deepseek\` 下编含 C 代码的依赖，MSVC 报 `D8050: 无法执行 c1.dll`（NoteGen 用四组对照实验确证）。ZeroNote 已内置 `dev.cmd` 设 `CARGO_TARGET_DIR=%USERPROFILE%\cargo-targets\zeronote`；**用 `pnpm tauri android dev` 时也要手动带上这个变量**（否则桌面能编、Android 编不过或产物散落在工作区）。
3. **Android target 要装在"项目实际用的那个 toolchain"上** —— 本机 4 个 android target 只挂在 `1.88.0`；ZeroNote 无 `rust-toolchain.toml` 且要求 `rust-version = "1.90"`，所以照抄 NoteGen「用 1.88.0」会**同时踩两个坑**（cargo 拒绝 1.90 要求；默认 stable 没有 android std）。正确做法是在 stable 上 `rustup target add`（本报告 §2 缺失①）。
4. **DSH 派生的 shell 里没有 `.cargo\bin`（也没有 rustup/cargo）** —— 实测 PATH 里有 `git`/`node`/`pnpm`/`java`/`adb`，但 `cargo`/`rustc`/`rustup` **都不在**。任何 Rust 构建命令前必须 `$env:Path += ";$env:USERPROFILE\.cargo\bin;$env:APPDATA%\npm"`（与 §5.3-19 记录一致）。
5. **装到手机上要装进 User 0** —— `adb install -r --user 0 <apk>`；小米「安全空间」是 User 10，`pm list packages` 里能看见但 `am start` 报 `Activity does not exist`。验收画面用 `adb exec-out screencap` 截图，比读日志可靠。（实测本机设备上存在 `com.miui.notes` ⇒ 小米 MIUI 系机型，该坑对本机**适用**。）

> 附带一条不值得单列的：改 `src-tauri/**` 会触发重编译 + 重启（增量 10–40 秒），改 `src/**`（Vite）只热更新；`tauri android dev` 的 `adb reverse` 是自动的，**不要再手动 reverse 1420**。

---

## 4. 原始证据（可复跑）

| 命令 | 关键输出 |
|---|---|
| `java -version` | `openjdk version "17.0.20.1"` Temurin |
| `$env:JAVA_HOME` | `C:\src\jdk-17.0.20.1+1` |
| `$env:ANDROID_HOME` / `ANDROID_SDK_ROOT` | `C:\Users\AQUA\AppData\Local\Android\Sdk`（两者相同） |
| SDK 子目录探测 | `build-tools{35.0.0,36.0.0}` `platforms{android-34,35,36}` `ndk{28.2.13676358}` `cmdline-tools{23.0-bootstrap,latest}` `platform-tools` `emulator`；`tools` 缺失（已废弃，无影响） |
| `adb version` / `adb devices` | `1.0.41` / `33b676f6 device`；`ro.product.model=24069RA21C`、`ro.build.version.release=16`、`ro.product.cpu.abi=arm64-v8a`、`sdk=36` |
| `adb reverse --list` | 空（无残留转发） |
| `adb shell pm list packages \| grep note` | `com.codexu.NoteGen`（NoteGen-Self 已装机）、`com.miui.notes` 等系统笔记 |
| `rustup show` / `rustup target list --installed` | active/default = `stable`（1.99.0）；installed targets = **仅 `x86_64-pc-windows-msvc`** |
| `~\.rustup\toolchains\*\lib\rustlib` | `1.88.0-…`：`aarch64-linux-android, armv7-linux-androideabi, i686-linux-android, x86_64-linux-android, x86_64-pc-windows-msvc`；`stable-…`：仅 windows |
| `$env:NDK_HOME` / `ANDROID_NDK_HOME` | 空 / 空 |
| NDK toolchain bin | `aarch64-linux-android24-clang.cmd`、`i686-linux-android24-clang.cmd`、`x86_64-linux-android24-clang.cmd` 均在（`armv7` 走 `armv7a-linux-androideabi24-clang.cmd`） |
| `pnpm tauri --version` / `android --help` | `tauri-cli 2.12.2`；子命令 `init/dev/build/run` |
| `pnpm tauri info` | 只报桌面段（WebView2 154 / MSVC / rustc 1.99.0 / node 24.21.0 / tauri 2.12.3）；**无 Android 段** |
| `~\.gradle` 结构 | `caches{8.14.3,9.3.1,jars-9,journal-1,modules-2}`、`wrapper\dists{gradle-8.14.3-bin,gradle-9.3.1-all}`、`modules-2\files-2.1\com.android.tools.build\*`（AGP 已缓存） |
| NoteGen `gradle-wrapper.properties` | `gradle-8.14.3-bin.zip`（本机 dists 已有该版本） |
| NoteGen `app/build.gradle.kts` | `compileSdk=34`、`minSdk=24`、`targetSdk=34` |
| NoteGen `.cargo/config.toml` | 4 段 `[target.*-linux-android] linker` → NDK `28.2.13676358`，API 24 |
| ZeroNote `.cargo/config.toml` | 仅 `rsproxy-sparse` 镜像 + `git-fetch-with-cli`，**无 linker 段** |
| ZeroNote `src-tauri/Cargo.toml` | `edition="2024"`、`rust-version="1.90"`、tauri 2.12.3、plugins log+dialog |
| ZeroNote `src-tauri/src/lib.rs:301` | `#[cfg_attr(mobile, tauri::mobile_entry_point)]` 已在 |
| CLI 二进制字符串（`cli.win32-x64-msvc.node`，16 MB） | `NDK_HOME`×7、`ANDROID_HOME`×6、`ANDROID_SDK_ROOT`×2、`JAVA_HOME`×21；内嵌 `cargo-mobile2-0.22.5`；含 `NdkHomeNotSet/NdkHomeNotADir/VersionLookupFailed/VersionTooLow`、`Using installed NDK`、`Using installed Android SDK`、`At least NDK ?% is required` |

---

## 5. 未验证 / 待实测（不猜）

| 项 | 说明 |
|---|---|
| Tauri 2.12.2 要求的**最低 NDK 版本号** | 二进制里是格式化字符串，读不出具体数字；NDK 28.2 判定"应通过"，但未实测 |
| `tauri android init` 是否会**联网装第二份 NDK** | CLI 有交互分支「Do you want to install the Android NDK...」；本机已有 28.2，预期走「Using installed NDK」。**首次运行时留意提问，别盲按 yes** |
| `android init` 生成的 gradle wrapper 版本 | NoteGen 生成的是 8.14.3（已缓存）；ZeroNote 用 CLI 2.12.2，**生成版本待确认**，若不同则首次构建需联网下载（本机 gradle 下载链路未测） |
| `tauri android dev` 在本机能否一次编译通过 | 未跑（本任务只做只读检查）。最大未验证点是坑 3 的 target 与 linker 组合 |
| Android 16（SDK 36）上跑 `targetSdk=34` 的 Tauri 包 | 同机 NoteGen（`targetSdk=34`）已跑通，间接支持；ZeroNote 自身未跑 |
| `pnpm tauri info` 为何不报 Android 段 | 仅观察到该 CLI 版本如此，未查源码 |

---

## 6. 唯一下一步

```powershell
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```
（约 1–2 分钟；只下 std 组件，不改配置。**本报告未执行。**）

随后 `pnpm tauri android init` → `pnpm tauri android dev`。
