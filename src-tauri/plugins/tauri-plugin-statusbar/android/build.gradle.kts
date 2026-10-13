// ZeroNote 状态栏插件 —— Android 库模块。
// 由 Tauri CLI 自动接入：build.rs 的 `.android_path("android")` 会写进
// gen/android/tauri.settings.gradle，app 模块据此 include（与官方 dialog 插件同路）。
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.tauri.statusbar"
    /**
     * ⚠️ 必须**跟主工程一致**（`gen/android/app/build.gradle.kts` 现在是 37）。
     *
     * 2026-10-13 踩到：这里一直是 34，而新版 Tauri/依赖要求 `compileSdk ≥ 36` ⇒
     * gradle 的 `:tauri-plugin-statusbar:checkReleaseAarMetadata` 直接失败：
     * 「is currently compiled against android-34 … Update this project to use a newer compileSdk
     *  of at least 36」。以前能编过只是因为主工程当时也是 34/35 —— 依赖一升级就露出来了。
     * 以后升级 Tauri 时**顺手核对这一行**（库模块的 compileSdk 不会自动跟着主工程走）。
     */
    compileSdk = 37

    defaultConfig {
        minSdk = 24
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    // invoke.parseArgs(@InvokeArg 数据类) 走 Jackson 反序列化 —— 与官方插件声明一致
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
    implementation(project(":tauri-android"))
}
