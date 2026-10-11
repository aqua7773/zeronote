# Tauri 2 在 Android 上的文件访问能力调研

> 目的：判断 ZeroNote（Tauri 2.12 + React 19 本地 Markdown 笔记）能否把笔记库从应用私有目录改到**用户可见的公共目录**（如 `/storage/emulated/0/Documents/ZeroNote`），以及目录选择器在 Android 上是否可用。
>
> 调研日期：2026-10-11 ｜ 性质：**只读调研**（未改动 ZeroNote 任何既有文件；本报告为新建文件）
> 方法：① 官方文档源码（tauri-docs 仓库 mdx 原文）② 官方插件/内核源码（plugins-workspace、tauri 仓库 raw 文件）③ GitHub API 元数据（star / 最后 push / issue 状态）④ 本地项目只读核对
> 证据分级：**【官方】** = Tauri/Android 官方仓库或官网；**【社区】** = 第三方插件、issue 里的个人发言、论坛

---

## 0. 结论速览（先看这张表）

| # | 问题 | 结论 | 关键证据 |
|---|---|---|---|
| 1 | `tauri-plugin-fs` 在 Android 能访问哪些路径？公共存储行不行？ | **默认只允许应用目录**（官方原文：*Access is restricted to Application folder by default*）。`/storage/emulated/0` 可以在 Tauri 的 scope 里写白名单，但 **Android 10+ 的 scoped storage 在系统层挡住直接路径访问**，除非申请 `MANAGE_EXTERNAL_STORAGE`（受 Google Play 政策限制）。要 "用户可见的公共目录"，标准 fs 路径方案 **不可行** | [官方 fs 文档](https://v2.tauri.app/plugin/file-system/) · [issue #1914](https://github.com/tauri-apps/plugins-workspace/issues/1914) · [所有文件访问权限政策](https://support.google.com/googleplay/android-developer/answer/10467955) |
| 2 | `dialog.open({ directory: true })` 在 Android 可用吗？ | **不可用，直接报错**。官方源码在 mobile 分支上：`#[cfg(mobile)] return Err(crate::Error::FolderPickerNotImplemented);`。Android 侧 Kotlin 只实现了「选文件」(ACTION_GET_CONTENT)、「保存文件」(ACTION_CREATE_DOCUMENT)、消息框 —— **没有** ACTION_OPEN_DOCUMENT_TREE | [commands.rs](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/dialog/src/commands.rs) · [DialogPlugin.kt](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/dialog/android/src/main/java/DialogPlugin.kt) · [issue #933](https://github.com/tauri-apps/plugins-workspace/issues/933) |
| 2b | 选中的文件返回路径还是 URI？fs 能读吗？ | **返回 `content://` URI**（官方文档原文）。**fs 插件能直接读**（官方文档称 *works with any path format out of the box*；Android 侧用 `contentResolver.openAssetFileDescriptor` 拿 fd）。**但这是「单文件」能力，目录是特例**（目录需要 tree URI + document URI + child-document URI 三件套） | [官方 dialog 文档](https://v2.tauri.app/plugin/dialog/) · [FsPlugin.kt](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/android/src/main/java/FsPlugin.kt) · [#933 评论](https://github.com/tauri-apps/plugins-workspace/issues/933) |
| 3 | 有没有可用的 SAF 插件？ | **有，且只有一个是活的**：社区插件 [`tauri-plugin-android-fs`](https://github.com/aiueo13/tauri-plugin-android-fs)（39★、最后 push 2026-10-09、`tauri = "^2.12.0"` 与 ZeroNote 版本匹配、Android-only、默认不申请需 Google Play 额外审核的权限）。另一个 [`tauri-plugin-scoped-storage`](https://github.com/Daniele-rolli/tauri-plugin-scoped-storage) 仅 0★/2 fork，主语言 Swift。**官方没有 SAF 插件** | 见 §3 |
| 4 | 官方建议？`appDataDir`/`documentDir`/`downloadDir`/`publicDir` 在 Android 返回什么？ | **Android 上没有任何 API 返回公共 `Documents/`**。`documentDir()` = `/storage/emulated/0/Android/data/<pkg>/files/Documents`（**应用专属**外部目录，不是公共的）；`appDataDir()` = `/data/user/0/<pkg>`（官方 Kotlin 源码 `activity.dataDir`，无 identifier 后缀）；`homeDir()` 才是 `/storage/emulated/0`。官方对移动端的实际建议是**走 SAF/系统选择器**，而不是直接路径 | [tauri PathPlugin.kt](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/mobile/android/src/main/java/app/tauri/PathPlugin.kt) · [tauri path/android.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/path/android.rs) · 见 §4 对照表 |
| 5 | 若必须走 SAF，要写多少 Kotlin？ | **自研 = 数千行、且要重造一个插件**。参考量级：`tauri-plugin-android-fs` 的 Android 侧 Kotlin 约 **180 KB**（`AndroidFsPlugin.kt` 单文件 69 KB + DocumentFileController 24 KB + 其余），Rust 侧约 250 KB，TS 侧 140 KB。官方「移动插件开发」只教你怎么注册 `@TauriPlugin`/`@Command`，SAF 的 Activity Result 链路要自己写。**用现成插件 ≈ 0 行 Kotlin** | [移动插件开发指南](https://v2.tauri.app/develop/plugins/develop-mobile/) · [插件文件树](https://github.com/aiueo13/tauri-plugin-android-fs) |

---

## 1. `tauri-plugin-fs` 在 Android 上的 scope 限制

### 1.1 官方明说：默认只有应用目录 【官方】

Tauri 官方 fs 插件文档的 Supported Platforms 表格里，Android 一行写着：

> android — **Access is restricted to Application folder by default**

- 页面：<https://v2.tauri.app/plugin/file-system/>
- 文档源码（可逐字核对）：<https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/file-system.mdx>

### 1.2 官方对 Android 外部目录的配置要求 【官方】

同一页 `Configuration → Android` 小节原文：

> When using the audio, cache, documents, downloads, picture, public or video directories your app must have access to the external storage.
> Include the following permissions to the `manifest` tag in the `gen/android/app/src/main/AndroidManifest.xml` file:
>
> ```xml
> <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE"/>
> <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />
> ```

注意：**官方文档没有教你怎么访问公共 `/storage/emulated/0/Documents`**，只写了上述这些 base directory。而这些 base directory 在 Android 上其实都落在**应用专属外部目录**（见 §4）。

### 1.3 两层限制，别混淆 【官方】

访问失败有两个完全不同的原因，排查时必须区分：

| 层 | 谁在挡 | 典型报错 |
|---|---|---|
| Tauri 层 | `capabilities` 里的 `fs:scope` 白名单 | `forbidden path: /storage/emulated/0/...`（fs 插件自己抛的） |
| Android 层 | scoped storage / SELinux / FUSE | `EACCES` / `EPERM` / 文件不存在 |

- Tauri 层证据：官方文档明确「Permissions alone do not grant a scope」，没有 allow scope 就报 `forbidden path`；真实案例见 issue [#1914](https://github.com/tauri-apps/plugins-workspace/issues/1914)（用户配了 `MANAGE_EXTERNAL_STORAGE` + `fs:scope` 仍报 `forbidden path`，那是 scope 没写对）。
- **即使把 scope 写到 `$HOME`（= `/storage/emulated/0`），Android 系统层仍会挡住**非本应用创建的普通文件（`.md` 不是媒体文件，不吃 `READ_MEDIA_*` 豁免）。

### 1.4 公共存储 `/storage/emulated/0` 到底行不行

| 路线 | 能否写 `/storage/emulated/0/Documents/ZeroNote` | 代价 |
|---|---|---|
| 标准 `tauri-plugin-fs` + `fs:scope` 白名单 | **不行**（系统层拒绝，`READ/WRITE_EXTERNAL_STORAGE` 在 Android 11+ 对非媒体文件已失效） | — |
| `READ_MEDIA_*`（Android 13+） | **不行**，只覆盖图片/音频/视频，`.md` 不在内 | — |
| `MANAGE_EXTERNAL_STORAGE`（"所有文件访问权限"）+ 直接路径 | **能**（不申请则被 scoped storage 挡；申请后需用户到系统设置手动开） | 上架 Google Play 需专门审核，**只对文件管理器/备份/杀毒等少数用途开放**，笔记类应用大概率被拒 → [官方政策页](https://support.google.com/googleplay/android-developer/answer/10467955) |
| SAF（Storage Access Framework，系统目录选择器） | **能**，且不需要危险权限 | 必须拿 `content://` tree URI，读写都走 `ContentResolver`，现有「绝对路径 + std::fs」代码要改造（见 §6） |

> ⚠️ **证据等级说明**：上表中"Android 层会拒绝"的部分，依据是 Android 官方文档
> [管理存储设备上的所有文件](https://developer.android.com/training/data-storage/manage-all-files)、
> [访问共享存储中的文档和文件](https://developer.android.com/training/data-storage/shared/documents-files)、
> [AOSP 范围存储](https://source.android.com/devices/storage/scoped)。
> **本次调研未能抓取这些页面的正文**（developer.android.com 通过本机网络抓取时被截断/失败，只拿到页面标题与导航）。框内结论属于平台通行认知，**未逐字核实**，落地前请以链接原文为准，或在真机上实测。

---

## 2. `tauri-plugin-dialog` 的 `open({ directory: true })` 在 Android 上

### 2.1 铁证：源码直接返回「未实现」 【官方】

`plugins/dialog/src/commands.rs` 的 `open` 命令（v2 分支当前代码）：

```rust
let res = if options.directory {
    #[cfg(desktop)]
    { /* ... blocking_pick_folder ... */ }
    #[cfg(mobile)]
    return Err(crate::Error::FolderPickerNotImplemented);
}
```

- 源码：<https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/dialog/src/commands.rs>

也就是说：**在 Android 上调用 `open({ directory: true })` 会直接抛错，不会弹任何东西**（`FolderPickerNotImplemented`）。

### 2.2 Android 侧 Kotlin 只实现了三种对话框 【官方】

`plugins/dialog/android/src/main/java/DialogPlugin.kt`（全文 7 KB，已逐行读）里只有：

- `showFilePicker` → `Intent.ACTION_GET_CONTENT`（选**文件**，不是目录）
- `saveFileDialog` → `Intent.ACTION_CREATE_DOCUMENT`（保存到某个文件）
- `showMessageDialog` → MaterialAlertDialog

**没有** `ACTION_OPEN_DOCUMENT_TREE`，这就是目录选择器缺失的根因。
- 源码：<https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/dialog/android/src/main/java/DialogPlugin.kt>

> 代码里还能看到一条 `// TODO: ACTION_OPEN_DOCUMENT ??` —— 官方自己标注了这块待办。

### 2.3 官方 issue 状态：仍然 open 【社区/官方仓库】

- Issue [#933 "Dialog Plugin pick_folder not implemented"](https://github.com/tauri-apps/plugins-workspace/issues/933)
  - 状态：**open**，labels: `platform: android`、`type: feature request`、`plugin: dialog`、`platform: ios`
  - 创建 2024-02-07，最后更新 **2026-04-13**，12 条评论，11 个 👍
  - 2026-04-13 最后一条评论：有人发现 PR #2322 最终被关闭且无解释
- 社区 fork 原型（**不是官方，未合并**）：
  - <https://github.com/AmadeusWM/plugins-workspace/tree/android-dialog-directory-picker>（给 dialog 加目录选择）
  - <https://github.com/AmadeusWM/plugins-workspace/tree/android-saf-fs>（给 fs 加 SAF 支持的原型，作者自述 file watching 只能轮询）

### 2.4 返回值是路径还是 `content://` URI 【官方】

官方 dialog 文档原文：

> The file dialog APIs returns file system paths on Linux, Windows and macOS.
> On iOS, a `file://<path>` URIs are returned.
> **On Android, content URIs are returned.**
> The filesystem plugin works with any path format out of the box.

- 页面：<https://v2.tauri.app/plugin/dialog/>

配套源码证据（fs 插件 Android 侧确实按 `content://` 处理）：

```kotlin
val fd = activity.contentResolver.openAssetFileDescriptor(Uri.parse(args.uri), args.mode)
      ?.parcelFileDescriptor?.detachFd()
```

- 源码：<https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/android/src/main/java/FsPlugin.kt>

插件维护者 FabianLars 在 #933 里回复确认：「The fs plugin supports content:// urls. We get those from the file picker as well.」但接着补了一句关键限制：「**i'd assume it needs changes to support content:// urls for directories as well**」。

### 2.5 为什么「目录」比「文件」难 —— 一句话原理 【社区·插件作者分析】

#933 里 `tauri-plugin-android-fs` 作者 aiueo13 的分析（2025-12-04 评论）：Android 上一个目录对应**三种** URI：

1. **Tree URI** —— 目录选择器返回的那个
2. **Document URI** —— 提供条目元数据（名字/大小/fd）
3. **Child Document URI** —— 只有它是目录时才有效，用来枚举子项

三者**不能互相还原**，而 Tauri 的 `FilePath` 只能存**单个** URI，所以「用一个字符串表示 Android 目录」在现有设计下不成立。这就是官方迟迟没实现目录选择的技术原因，也是后文推荐第三方插件的原因（它自己定义了 `FsUri` 抽象来解决问题）。

---

## 3. 可用的 SAF 方案 / 插件盘点

### 3.1 `tauri-plugin-android-fs` —— 目前唯一成熟的社区方案 【社区】

| 项目 | 值 | 来源 |
|---|---|---|
| 仓库 | <https://github.com/aiueo13/tauri-plugin-android-fs> | GitHub API |
| Star / Fork | **39 ★ / 4 fork** | GitHub API `stargazers_count` |
| 创建 / 最后 push | 2025-02-13 创建，**2026-10-09 最后 push**（活跃） | GitHub API `pushed_at` |
| License | Apache-2.0 / MIT 双许可 | GitHub API + 仓库 README |
| 平台支持 | `android = full`，windows/linux/macos/ios = **none**（纯 Android 插件） | 仓库 `Cargo.toml` |
| Tauri 版本要求 | `tauri = "^2.12.0"` ✅ **与 ZeroNote（tauri 2.12.3）匹配** | 仓库 `Cargo.toml` |
| npm 绑定 | [`tauri-plugin-android-fs-api`](https://www.npmjs.com/package/tauri-plugin-android-fs-api) **30.1.0**（Rust 与 JS 版本号必须严格一致，用 `-E` 安装） | npm registry |
| 默认权限 | `permissions/default.toml` → `all-without-delete`（默认**不含删除**） | 仓库 `permissions/default.toml` |
| 权限声明 | 官方 README：「By default (with default features enabled), this plugin **does not add permissions to the application or enable any options that require additional review by Google Play**」 | 仓库 README |

**它能干的事（API 清单，摘自 `api/README.md`）**：

- **目录/文件选择**：`showOpenDirPicker`、`showOpenFilePicker`、`showSaveFilePicker`
- **目录操作**：`readDir`、`createNewDir`、`createDir`、`renameDir`、`removeEmptyDir`、`removeDirAll`
- **文件读写**：`readTextFile`、`writeTextFile`、`readFile`、`writeFile`、`openReadFileStream`、`openWriteFileStream`、`openReadTextFileLinesStream`
- **公共目录**：`createNewPublicFile`、`createNewPublicImageFile/VideoFile/AudioFile`、`listVolumes`、`scanPublicFile`、`setPublicFilePending`
- **权限持久化**（重启后仍能访问用户选过的目录）：`persistPickerUriPermission`、`checkPersistedPickerUriPermission`、`releasePersistedPickerUriPermission`
- **路径互转**：`getFsPath`、`getUriForFilePath`、`isFsUri`、`getAndroidApiLevel`
- **额外能力**：`PublicStorage` / `PrivateStorage` / `AppStorage` / `Opener` / 缩略图 / 自定义 ContentProvider

**证据 URL**：

- Rust 侧读我说明：<https://github.com/aiueo13/tauri-plugin-android-fs#readme>
- JS 侧 API 清单与示例（含"保存到 `~/Download/MyApp/xxx`"完整示例）：<https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/api/README.md>
- 使用说明（权限两种模式）：<https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/api/README.md>

关键设计（决定了 ZeroNote 的改造量）：

> This plugin operates on files and directories **via URIs rather than paths**.
> When passing URIs to this plugin's functions, **no scope configuration is required**（因为这些 URI 的权限由系统管理：用户明确选择过的、或 App 在公共目录里自己创建的文件）。
> Some functions accept not only URIs but also **absolute paths**. In this case, you need to set the scope configuration（同 plugin-fs）。

**成本量级（用于判断"自研 vs 复用"）**：该插件的实现规模（GitHub tree API 实测文件大小）

- Android/Kotlin 侧：`AndroidFsPlugin.kt` **69.5 KB**、`DocumentFileController.kt` 24 KB、`AFMediaStore.kt` 18 KB、`AFCustomFileProvider.kt` 15 KB、`AFNotification.kt` 12 KB、`AFStorageVolume.kt` 10.3 KB、`AFFileDescriptor.kt` 9.8 KB、`AFThumbnails.kt` 9.5 KB、`RawFileController.kt` 9.9 KB、`MediaFileController.kt` 6.5 KB、`AFUtils.kt` 5.8 KB …（合计 ≈ 180 KB Kotlin）
- Rust 侧：`src/api/impls/cmds.rs` 68.9 KB、`src/cmds/mod.rs` 60 KB、`src/api/public_storage.rs` 38.8 KB、`src/cmds/utils.rs` 41.6 KB …
- JS 侧：`api/guest-js/index.ts` 140.5 KB

### 3.2 `tauri-plugin-scoped-storage` —— 不推荐 【社区】

| 项目 | 值 |
|---|---|
| 仓库 | <https://github.com/Daniele-rolli/tauri-plugin-scoped-storage> |
| Star / Fork | **0 ★ / 2 fork** |
| 创建 / 最后 push | 2026-03-09 / 2026-09-13 |
| 主语言 | **Swift**（iOS 优先） |
| npm | [`tauri-plugin-scoped-storage-api`](https://www.npmjs.com/package/tauri-plugin-scoped-storage-api) 1.5.1 |

结论：成熟度不足（0 star、作者单人、iOS 优先），**不建议作为 ZeroNote 的主路线**。

### 3.3 搜索结论

- GitHub 仓库搜索 `tauri android storage access framework` → **total_count = 0**（用该关键词组合搜不到其它方案）
- npm 搜索 `tauri android saf` → 只返回官方 `@tauri-apps/*` 包，无第三方 SAF 包
- **官方 SAF 插件不存在**；Tauri 官方仓库里唯一与 Android 存储相关的机制是「文件选择器返回的 `content://` 单文件可被 fs 插件使用」

---

## 4. 官方各目录 API 在 Android 上到底返回什么

**证据来源（最硬的一手）**：Tauri 内核的 Android 端 Kotlin 实现
<https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/mobile/android/src/main/java/app/tauri/PathPlugin.kt>
以及 Rust 侧映射 <https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/path/android.rs>

| Tauri API | Android 端 Kotlin 调用 | 实际返回 | 是"用户可见公共目录"吗 |
|---|---|---|---|
| `appDataDir()` / `appLocalDataDir()` | `activity.dataDir`（无 identifier 后缀） | `/data/user/0/<pkg>` | ❌ 应用私有，文件管理器完全看不到 |
| `appConfigDir()` | `activity.dataDir` | `/data/user/0/<pkg>` | ❌ |
| `appCacheDir()` / `cacheDir()` | `activity.cacheDir` / `externalCacheDir` | `/data/user/0/<pkg>/cache` 等 | ❌ |
| **`documentDir()`** | `getExternalFilesDir(DIRECTORY_DOCUMENTS)` | **`/storage/emulated/0/Android/data/<pkg>/files/Documents`** | ⚠️ **应用专属外部目录，不是公共 `Documents/`** —— 名字极易误导 |
| `downloadDir()` | `getExternalFilesDir(DIRECTORY_DOWNLOADS)` | `/storage/emulated/0/Android/data/<pkg>/files/Download` | ⚠️ 同上 |
| `publicDir()` | `getExternalFilesDir(DIRECTORY_DCIM)` | `/storage/emulated/0/Android/data/<pkg>/files/DCIM` | ⚠️ 同上 |
| `pictureDir()` / `audioDir()` / `videoDir()` | `getExternalFilesDir(DIRECTORY_PICTURES / MUSIC / MOVIES)` | `/storage/emulated/0/Android/data/<pkg>/files/<对应名>` | ⚠️ 同上 |
| **`homeDir()`** | `Environment.getExternalStorageDirectory()` | **`/storage/emulated/0`** | 路径本身是公共存储根，但**直接按路径读写仍被 scoped storage 限制** |
| `resourceDir()` | 常量 `asset://localhost/` | `asset://localhost/` | APK 内资源（只读） |

补充事实（源码级）：

- `android.rs` 里 `app_data_dir()` 走 `app_dir(AppData, || self.call_resolve("getDataDir"))`，而 `getDataDir` → `activity.dataDir`。**没有**拼接 bundle identifier，所以 ZeroNote 实测到 `/data/user/0/<pkg>` 是符合官方实现的。
  - <https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/path/android.rs>
  - <https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/path/mod.rs>
- `BaseDirectory::Desktop/Executable/Font/Runtime/Template` 在 Android 上**被 cfg 掉**（不存在），别在能力声明里写这些变量。

### 4.1 官方对移动端「用户文档目录」的建议 【官方】

- **官方文档层面**：没有"怎么访问用户文档目录"的指引。fs 文档只给了 base directory 列表 + Android 权限清单；dialog 文档只说 Android 返回 `content://`。
- **官方代码层面的实际取向**：Android 上唯一"能碰用户可见位置"的现成机制是 **系统安全框架（SAF）**——即通过系统选择器拿 URI。Tauri 只在**选文件**上做了这件事（fs 直接支持那个 URI），目录选择留给了 issue #933。
- **平台官方建议**（Android）：访问共享存储中由用户或其它应用创建的文档，走 SAF（[官方文档](https://developer.android.com/training/data-storage/shared/documents-files)）；需要整盘访问才用 `MANAGE_EXTERNAL_STORAGE`（[官方文档](https://developer.android.com/training/data-storage/manage-all-files)）。
  ⚠️ 这两页正文本次**未抓到**（见 §7）。

### 4.2 成熟同类产品的做法（社区实践，供交叉验证）

- Obsidian on Android：用 SAF 让用户选 vault 目录（社区讨论：[Obsidian 论坛 #19360](https://forum.obsidian.md/t/fr-make-obsidian-work-on-android-without-asking-for-storage-permissions/19360)）。
- 这正是 ZeroNote 想要的效果：**库放在用户可见位置 + 应用内管理插件**，而不是把库塞进私有目录。

---

## 5. 若必须走 SAF，需要自己写多少 Kotlin？

### 5.1 官方教的（可参考的骨架）【官方】

[移动插件开发指南](https://v2.tauri.app/develop/plugins/develop-mobile/)（源码 mdx：<https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/develop/Plugins/develop-mobile.mdx>）：

- Kotlin 类继承 `app.tauri.plugin.Plugin` + `@TauriPlugin` 注解
- 每个方法加 `@Command`，参数用 `@InvokeArg` 数据类 + `invoke.parseArgs(...)`
- Rust 侧用 `api.register_android_plugin(...)` / `PluginHandle::run_mobile_plugin(...)` 调用
- 需要系统权限时在注解里声明 `permissions = [Permission(strings=[...], alias="...")]`，Tauri 自动生成 `checkPermissions` / `requestPermissions`

**指南里没有教的**（正是 SAF 必需的部分）：

- `startActivityForResult(intent, "callbackName")` + `@ActivityCallback` 回调（官方 dialog 插件就是这么写的）
- `DocumentsContract.buildChildDocumentsUriUsingTree` 等 tree URI 遍历
- `takePersistableUriPermission` 权限持久化
- `ContentResolver` 的读写 / fd 管理 / MediaStore 扫描

### 5.2 参考量级

| 参照物 | Kotlin 规模 | 说明 |
|---|---|---|
| 官方 dialog 插件 Android 侧 | `DialogPlugin.kt` 7.2 KB + `FilePickerUtils.kt` 8.0 KB | **只做选文件/保存，不含目录选择** |
| 社区 android-fs 插件 Android 侧 | **≈ 180 KB**（11 个 Kotlin 文件，最大单文件 69.5 KB） | 完整 SAF 目录/文件/媒体/权限/缩略图 |
| AmadeusWM 的 dialog 目录选择 fork | 单 PR 量级（未合并） | 作者自述：返回 `content://`，且**fs 插件当时不支持目录 URI** |

**结论**：自己从零写一套 "SAF 目录当库" 的 Kotlin，等价于重做一个 `tauri-plugin-android-fs`（数千行 Kotlin + 数万行 Rust/TS）。**除非有强烈理由不复用，否则应直接接入现成插件**（这也符合"先查现成经验，再动手自创"）。

### 5.3 官方示例仓库 / 社区模板

- 官方插件模板：`cargo tauri plugin new`（含 Android Kotlin 库 + iOS Swift 包骨架），见移动插件开发指南。
- **官方没有 SAF 示例仓库**（未找到；GitHub 搜索 `tauri android storage access framework` 命中 0 个仓库）。
- 社区可参考实现（非官方，谨慎评估）：
  - `tauri-plugin-android-fs`（推荐，见 §3.1）
  - `AmadeusWM/plugins-workspace` 分支 `android-dialog-directory-picker`、`android-saf-fs`（原型级）

---

## 6. ZeroNote 现状基线（本地只读核对）

| 项 | 现状 | 影响 |
|---|---|---|
| `src-tauri/Cargo.toml` | `tauri = 2.12.3`、`tauri-plugin-log`、`tauri-plugin-dialog`；**没有 `tauri-plugin-fs`** | §1 的 fs scope 问题目前**尚未存在于代码里**；真正卡住 Android 写公共目录的是 Rust `std::fs` + Android 平台权限 |
| `src-tauri/capabilities/default.json` | 仅 `core:default` + `dialog:default`（无 fs 权限、无 scope） | 引入任何 fs/android-fs 能力都要改这里 |
| `src-tauri/src/lib.rs` | 全部笔记 I/O 走自定义 `#[tauri::command]` + `std::fs`；`vault` 是**绝对路径字符串**；原子写用 `tmp + rename` | 若走 SAF，`rename`/`create_dir_all`/`read_dir` 这类 std::fs 调用在 `content://` 上**不可用**，需要抽象层（URI 后端 vs 路径后端） |
| 插件机制 | 插件住在 `<库>/.zn/plugins/<pluginId>/` | 与"库放哪"强绑定：库能用户可见，插件才能手放 |
| `gen/android/.../AndroidManifest.xml` | 只有 `INTERNET`；有 `FileProvider`；**无任何存储权限** | 若要加存储权限，改这个文件（注意 `gen/android` 是生成目录） |

> 结论：ZeroNote 现在**不是**"被 fs 插件 scope 挡住"，而是"整个读写链路基于 `std::fs` 绝对路径"。这是选型时最需要正视的改造成本 —— 见下一节方案 B/C 的成本差异。

---

## 7. 可执行方案对比与推荐

| 方案 | 做法 | 成本 | 风险 | 证据 |
|---|---|---|---|---|
| **A. 接入 `tauri-plugin-android-fs`（推荐）** | 加 Rust 插件 + npm `tauri-plugin-android-fs-api@30.1.0`；Android 分支：启动时 `showOpenDirPicker()` 让用户选 `Documents/ZeroNote` → `persistPickerUriPermission` 持久化 → 用 `readDir/writeTextFile/readTextFile` 操作；`getFsPath()` 可把 URI 转成真路径供桌面端复用 | 中（主要成本在把 ZeroNote 的 Rust fs 命令层改成"路径/URI 双后端"，`cfg(target_os)` 分流；**Kotlin 0 行**） | ① 单人维护的社区插件（39★）② API 面很大，需挑选最小集 ③ Rust/JS 版本必须严格锁 `30.1.0` ④ 性能：SAF 读写比直接路径慢（未实测） | [仓库](https://github.com/aiueo13/tauri-plugin-android-fs) · [API](https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/api/README.md) · [npm](https://www.npmjs.com/package/tauri-plugin-android-fs-api) |
| **B. 自研/维护 SAF 插件（或 fork 官方 dialog）** | 参考 AmadeusWM 原型给 dialog 加目录选择 + 给 fs 加目录 URI 支持 | 高（数千行 Kotlin + Rust/TS；后续要跟 Tauri 内核升级维护） | 与官方上游冲突、长期维护负担、#933 里 PR #2322 已被关闭说明上游路径不明朗 | [#933](https://github.com/tauri-apps/plugins-workspace/issues/933) · [AmadeusWM fork](https://github.com/AmadeusWM/plugins-workspace/tree/android-saf-fs) |
| **C. 保持私有库（或退到 `documentDir()`），只做导入/导出** | 库仍在 `appDataDir()`；用 dialog 的单文件选择器（Android 返回 `content://`，**fs 插件可直接读写**）做"导入笔记 / 导出笔记" | 低（改动最小，复用现有 std::fs 链路 + 单个 content:// 文件读写） | **不解决用户的核心诉求**：文件管理器仍看不到库、插件仍不能手放；`documentDir()` 只是"应用专属外部目录"，不是公共目录 | [官方 dialog 文档](https://v2.tauri.app/plugin/dialog/) · §4 对照表 |
| **D. `MANAGE_EXTERNAL_STORAGE` + 直接路径（自用最快）** | manifest 加权限 + 引导用户到系统设置开启"所有文件访问" → 库直接放 `/storage/emulated/0/Documents/ZeroNote`，代码改动接近最小 | 低（代码层几乎不动） | ① **Google Play 上架基本会被拒**（政策限制用途）② 用户要手动去系统设置授权 ③ 权限过宽，安全观感差 | [政策页](https://support.google.com/googleplay/android-developer/answer/10467955) · [manage-all-files](https://developer.android.com/training/data-storage/manage-all-files) |

### 推荐

**推荐 A（`tauri-plugin-android-fs`）作为"用户可见公共目录"的正式路线**，理由：

1. 目标（公共目录 + 用户可手放插件）在 Android 11+ 下**只有 SAF 路线能达成**，而官方 SAF 目录支持缺失（issue #933 自 2024 开到 2026 仍是 open，相关 PR 被关）。
2. 该插件是**唯一活着且版本对得上的方案**：39★、两天前还在 push、`tauri = "^2.12.0"` 与 ZeroNote 精确匹配、Android-only 不污染桌面端、默认权限集不含删除、默认不申请需 Google Play 审核的权限。
3. 复用而非自研，符合"先查现成经验，再动手自创"的原则：自研等价于重造 180 KB Kotlin + 250 KB Rust。

**如果第一优先级只是"自己手机能用、不上架"**，则 **D 最省事**；但**永远不要**为了 D 去牺牲后续上架能力 —— 建议把库路径抽象成"后端可切换"（路径后端 / URI 后端），这样 C→D→A 都能平滑迁移。

---

## 8. 未核实清单（不要当成已确认结论）

| 事项 | 状态 | 说明 |
|---|---|---|
| Android 官方三页正文（manage-all-files / documents-files / scoped storage） | **未抓到正文** | `developer.android.com` 直连 fetch failed；`developer.android.google.cn` 只返回页面标题+导航即被截断。结论基于平台通行认知 + 官方链接，**未逐字核实** |
| Google Play「所有文件访问权限」政策正文 | **未抓到正文** | `support.google.com/googleplay/android-developer/answer/10467955` fetch failed；仅确认该页面存在（搜索结果标题即为该政策） |
| `/storage/emulated/0/Android/data/<pkg>/` 在 Android 11+ 是否可被第三方文件管理器 / USB(MTP) 看到 | **未核实** | 未实测设备；不要据此宣称 `documentDir()` 就"用户可见" |
| `tauri-plugin-android-fs` 的 `readDir` 对 SAF tree URI 是否支持递归、以及大库性能 | **未核实** | API 清单里有 `readDir`；具体递归语义与性能未逐字核实/未实测 |
| 在真机上 `open({directory:true})` 的报错文本 | **未在真机复现** | 结论来自 v2 分支源码（`FolderPickerNotImplemented`）；ZeroNote 未在任何 Android 设备上跑过本次调研的验证 |
| Tauri 版本与插件兼容性实测 | **未实测** | 只做了 `Cargo.toml` 版本范围比对（`^2.12.0` vs 2.12.3） |

---

## 9. 证据索引（全部 URL）

### 官方（Tauri）

- fs 插件文档：<https://v2.tauri.app/plugin/file-system/> ｜ 源文件：<https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/file-system.mdx>
- dialog 插件文档：<https://v2.tauri.app/plugin/dialog/> ｜ 源文件：<https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/plugin/dialog.mdx>
- 移动插件开发指南：<https://v2.tauri.app/develop/plugins/develop-mobile/> ｜ 源文件：<https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/develop/Plugins/develop-mobile.mdx>
- dialog 命令实现（`FolderPickerNotImplemented`）：<https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/dialog/src/commands.rs>
- dialog Android 实现：<https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/dialog/android/src/main/java/DialogPlugin.kt>
- fs Android 实现（contentResolver fd）：<https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/fs/android/src/main/java/FsPlugin.kt>
- issue #933（目录选择未实现，open）：<https://github.com/tauri-apps/plugins-workspace/issues/933>
- issue #1914（forbidden path）：<https://github.com/tauri-apps/plugins-workspace/issues/1914>
- Tauri 路径解析 Android 实现：<https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/path/android.rs>
- Tauri 路径解析通用逻辑：<https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/path/mod.rs>
- Tauri Android PathPlugin（各目录实际返回值）：<https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/mobile/android/src/main/java/app/tauri/PathPlugin.kt>

### 官方（Android / Google）

- 管理存储设备上的所有文件（MANAGE_EXTERNAL_STORAGE）：<https://developer.android.com/training/data-storage/manage-all-files>（正文未抓取）
- 访问共享存储中的文档和文件（SAF）：<https://developer.android.com/training/data-storage/shared/documents-files>（正文未抓取）
- AOSP 范围存储：<https://source.android.com/devices/storage/scoped>（正文未抓取）
- Google Play「所有文件访问权限」政策：<https://support.google.com/googleplay/android-developer/answer/10467955>（正文未抓取）
- Content URI 基础：<https://developer.android.com/guide/topics/providers/content-provider-basics>

### 社区

- tauri-plugin-android-fs（39★，2026-10-09 push）：<https://github.com/aiueo13/tauri-plugin-android-fs>
  - JS API 与示例：<https://github.com/aiueo13/tauri-plugin-android-fs/blob/main/api/README.md>
  - npm：<https://www.npmjs.com/package/tauri-plugin-android-fs-api>
- tauri-plugin-scoped-storage（0★）：<https://github.com/Daniele-rolli/tauri-plugin-scoped-storage> ｜ npm：<https://www.npmjs.com/package/tauri-plugin-scoped-storage-api>
- AmadeusWM 的 dialog 目录选择 fork：<https://github.com/AmadeusWM/plugins-workspace/tree/android-dialog-directory-picker>
- AmadeusWM 的 SAF-fs 原型：<https://github.com/AmadeusWM/plugins-workspace/tree/android-saf-fs>
- Obsidian Android 存储权限讨论：<https://forum.obsidian.md/t/fr-make-obsidian-work-on-android-without-asking-for-storage-permissions/19360>
