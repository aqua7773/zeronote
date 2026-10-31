// ZeroNote APK 安装插件 —— 构建脚本。
//
// 与 `tauri-plugin-share` 同构：生成权限文件 + 告诉 Tauri CLI 本插件的 Android 模块在哪。
const COMMANDS: &[&str] = &["install_apk", "can_install_apk", "open_install_settings"];

fn main() {
  tauri_plugin::Builder::new(COMMANDS)
    .android_path("android")
    .build();
}
