// ZeroNote 状态栏插件 —— Android 库模块。
// 由 Tauri CLI 自动接入：build.rs 的 `.android_path("android")` 会写进
// gen/android/tauri.settings.gradle，app 模块据此 include（与官方 dialog 插件同路）。
plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.tauri.statusbar"
    compileSdk = 34

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
