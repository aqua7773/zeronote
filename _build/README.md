# _build —— 出包过程产物（**不入库**，`.gitignore` 已忽略）

## 这里放什么

Android release 出包的中转物：构建日志、`zipalign`/`apksigner` 的中间 APK、从交付 zip 里回取出来做校验的副本。

**都不是成果物**：APK 与 zip 随时可以从提交重建，删掉这个目录不会丢任何东西。

## 何时生成 / 是否过时

| 文件 | 何时生成 | 现状 |
|---|---|---|
| `android-rev80.log` | 2026-10-14 rev80 `pnpm tauri android build --apk --target aarch64` 的完整输出（Rust release 编译 50.2s） | 对应提交 `2db2ffd`，**已交付** |
| `rev80/ZeroNote-release.apk` | 同上产物经 `zipalign -p 4` + `apksigner` 签名（15.52 MB） | 已写进交付 zip |
| `rev80/libzeronote_lib.so` | 从 APK 里取出的 arm64 原生库，用于搜前端 chunk 名（`index-CUr7ArSz.js` 命中 ✓） | 校验用，可删 |
| `rev80/outline-map-plugin.zip` | 大纲插件包（手机端单独更新用，68.8 KB） | 已写进交付 zip |
| `rev80/安装说明.md` | 手机端两步安装说明 | 已写进交付 zip |
| `android-rev76.log` | 2026-10-14 01:02 同上 | 对应提交 `2e410f1` |
| `rev76/ZeroNote-release.apk` | 同上产物经 `zipalign -p 4` + `apksigner` 签名 | 已逐字节写进交付 zip |
| `rev76/verify-from-zip.apk` | 从交付 zip 回取，用于「包内是否真是本次代码」的校验 | 校验用，可删 |
| `rev76/libzeronote_lib.so` | 从 APK 里取出的 arm64 原生库，用于搜前端 chunk 名 | 校验用，可删 |

## 复现命令（下一次出包照抄）

```powershell
$env:CARGO_TARGET_DIR="C:\Users\AQUA\cargo-targets\zeronote"
# ⚠️ **必须同时给 CARGO_HOME**（README 原先漏了，2026-10-14 补）：
#    本机 cargo 构建脚本不能写 `~/.cargo`（按进程的路径拦截，ACL/占用/长路径/Defender 均已排除），
#    不带它就是构建期直接失败（见 HANDOFF rev63 段）。
$env:CARGO_HOME="C:\Users\AQUA\Documents\deepseek\_cargo-home"
pnpm tauri android build --apk --target aarch64

$bt="C:\Users\AQUA\AppData\Local\Android\Sdk\build-tools\35.0.0"
$src="src-tauri\gen\android\app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
& "$bt\zipalign.exe" -p -f 4 $src out\ZeroNote-release.apk
& "$bt\apksigner.bat" sign --ks "$env:USERPROFILE\.android\debug.keystore" `
    --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey out\ZeroNote-release.apk
& "$bt\apksigner.bat" verify --print-certs out\ZeroNote-release.apk   # 期望指纹 2ca79f19…35bb
```

**两个坑**（rev75/rev76 实测）：
1. `zipalign` 输出的 APK 会被 `apksigner` **就地改写**（约 +62 KB），所以先 align 到目标文件名再签，别签完再 align。
2. APK 的 `assets/` 里**看不到前端** —— Tauri 把 `dist/` 嵌进 `lib/<abi>/libzeronote_lib.so`。
   要验证"包内是本次构建"，就在该 `.so` 里搜本次 vite 产物的 chunk 名（如 `index-BmuGGoI_`）。
