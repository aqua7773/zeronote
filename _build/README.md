# _build —— 出包过程产物（**不入库**，`.gitignore` 已忽略）

## 这里放什么

Android release 出包的中转物：构建日志、`zipalign`/`apksigner` 的中间 APK、从交付 zip 里回取出来做校验的副本。

**都不是成果物**：APK 与 zip 随时可以从提交重建，删掉这个目录不会丢任何东西。

## 何时生成 / 是否过时

| 文件 | 何时生成 | 现状 |
|---|---|---|
| `android-rev76.log` | 2026-10-14 01:02 `pnpm tauri android build --apk --target aarch64` 的完整输出 | 对应提交 `2e410f1`，已验证交付 |
| `rev76/ZeroNote-release.apk` | 同上产物经 `zipalign -p 4` + `apksigner` 签名 | 已逐字节写进交付 zip |
| `rev76/verify-from-zip.apk` | 从交付 zip 回取，用于「包内是否真是本次代码」的校验 | 校验用，可删 |
| `rev76/libzeronote_lib.so` | 从 APK 里取出的 arm64 原生库，用于搜前端 chunk 名 | 校验用，可删 |

## 复现命令（下一次出包照抄）

```powershell
$env:CARGO_TARGET_DIR="C:\Users\AQUA\cargo-targets\zeronote"
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
