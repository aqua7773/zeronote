// ZeroNote 通知捕获插件 —— Android 库模块。
// 由 Tauri CLI 自动接入：build.rs 的 `.android_path("android")` 会写进
// gen/android/tauri.settings.gradle，app 模块据此 include（与 statusbar 插件同路）。
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.tauri.notificationcapture"
    // ⚠️ 必须跟主工程一致（详见 tauri-plugin-statusbar/android/build.gradle.kts 的事故注释）
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
    implementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
    implementation(project(":tauri-android"))
}
