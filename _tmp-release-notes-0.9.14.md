## 0.9.14 — 崩溃日志可导出

### 崩溃日志终于能拿出来了

原生崩溃（SIGABRT / SIGSEGV）是**进程被系统直接杀死**，崩溃当下 JS 一行代码都跑不了 —— 所以任何"崩溃时自动复制"都做不到。

改成**下次启动读系统记录**：Android 11+ 的 `ActivityManager.getHistoricalProcessExitReasons()` 保留每次退出的
`ApplicationExitInfo`，原生崩溃还附带 **tombstone 全文**（`getTraceInputStream()`，**不需要 root**）。

- 新插件 `crashlog`（Rust + Kotlin）读取最近一次崩溃，并**直接导出**：
  `Download/ZeroNote-crash/zeronote-crash-<崩溃时刻>.txt`
- 打开 App 弹出「上次运行异常退出」：时间 / 原因 / 环境 / 文件路径 + 堆栈预览
- 「**转发日志文件**」→ 系统分享面板（微信 / QQ / 邮件都能直接选到）
- 「复制文本」兜底（没写出文件时用）
- 同一个崩溃按时间戳去重，**只提示一次**
- 桌面端没有这条通道，命令返回 `found: false`（不报错、不打扰）

### 顺带：0.9.13 手机闪退的根因（nubia NX741J / Android 16）

已抓到完整 tombstone，**不在应用代码里**：

```
#02 bionic  HandleUsingDestroyedMutex
#03 bionic  pthread_mutex_lock            ← FORTIFY: mutex 已 destroy
#04 bionic  pthread_cond_wait
#05 libc++  condition_variable::wait
#06 libgui  android::gui::FenceMonitor::threadLoop()
#07 libgui  android::gui::FenceMonitor::loop()
```

`FenceMonitor` 是硬件合成器（HWC）的 fence 线程。实测：开左抽屉 / 长按 ＋ 环形菜单 / 进编辑页都会崩
（**只要发生一次"新建合成层"的转场**），滑动列表不崩。属该机型系统层（HWC / SurfaceFlinger / Adreno）问题，
本版不做前端规避 —— 先把日志变成可转发的东西。

装上新版后如果再崩一次，下次打开会导出一个 txt，把它发出来即可定位。

### 验证

- `tests/crash-log.test.ts` 10 条（去重 / 坏值 / 截断 / 无堆栈 / 缺字段不出 `undefined`）
- tsc 0 · oxlint 4 warnings（基线）· cargo test --lib 96 · vitest **1787**（+10）· 质量门 8/8
