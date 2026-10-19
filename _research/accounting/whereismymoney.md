# WhereIsMyMoney (我钱呢？！) - 智能自动记账

> 一款基于 Android 的智能记账应用，通过监听微信、支付宝通知自动识别交易并记录，让记账不再繁琐。

**[English](#english-summary)** | **[中文](#功能特性)**

---

<a name="english-summary"></a>
## English Summary

**WhereIsMyMoney** is an Android app that automatically tracks your expenses by listening to WeChat Pay and Alipay notifications. No manual entry needed.

### Key Features
- **Auto Expense Tracking** - Automatically detects transactions from WeChat/Alipay notifications
- **Smart Recognition** - Extracts amount, merchant, and transaction type
- **Card Management** - Create multiple cards to categorize expenses
- **Statistics** - Daily/monthly/yearly expense analysis
- **File Import** - Import WeChat/Alipay bill files (CSV, XLSX)
- **Local Storage** - All data stored locally, no cloud upload
- **Privacy First** - Only reads notification content, no network access

### Tech Stack
- Kotlin + Jetpack Compose
- Material Design 3
- SQLite local database
- NotificationListenerService

### Download
Download the latest APK from [Releases](https://github.com/FridayKoi/WhereIsMyMoney/releases).

---

<a name="功能特性"></a>
## 功能特性

### 核心功能

<!-- 截图展示 -->
<p align="center">
  <img src="screenshots/home.jpg" width="200" alt="首页"/>
  <img src="screenshots/notification.jpg" width="200" alt="通知"/>
  <img src="screenshots/card.jpg" width="200" alt="卡片"/>
  <img src="screenshots/analyze.jpg" width="200" alt="分析"/>
</p>
<p align="center">
  <img src="screenshots/mascot.jpg" width="200" alt="桌宠"/>
  <img src="screenshots/mascot1.jpg" width="200" alt="桌宠消息"/>
  <img src="screenshots/redact.jpg" width="200" alt="编辑"/>
</p>

- **自动记账** - 监听微信/支付宝通知，自动识别交易金额、收款方、收入/支出类型
- **通知回复录入** - 未识别金额的交易通过通知栏直接回复输入
- **文件导入** - 支持导入微信/支付宝账单文件（CSV、XLSX），自动解析分析
- **卡片管理** - 创建多个记账卡片，分类管理不同场景的收支

### 统计分析
- **收支概览** - 实时查看总收入、总支出、净收入
- **支出均值** - 日均、月均、年均支出统计
- **收款方排行** - 按金额/时间排序，查看各收款方消费汇总
- **文件分析** - 导入账单的详细分析和图表展示

### 记录管理
- **单笔编辑** - 长按记录可编辑金额、重命名收款方、删除单笔
- **批量操作** - 收款方级别批量编辑和删除
- **待录入管理** - 未识别金额的交易统一管理，支持手动录入

### 其他特性
- **桌宠互动** - 识别到交易时桌宠弹出消息提醒，可爱又实用
- **Material Design 3** - 现代化 UI 设计，支持动态主题
- **灵动动画** - 页面切换和元素展示的流畅动画效果
- **本地存储** - 所有数据存储在本地 SQLite 数据库，不上传任何数据
- **隐私安全** - 仅读取微信/支付宝通知内容，不访问网络

## 技术栈

| 技术 | 用途 |
|------|------|
| Kotlin | 开发语言 |
| Jetpack Compose | 声明式 UI 框架 |
| Material Design 3 | 设计规范 |
| SQLite | 本地数据库 |
| NotificationListenerService | 通知监听 |
| ViewModel + StateFlow | 状态管理 |
| Coroutines | 异步处理 |

## 项目结构

```
app/src/main/java/com/friday/wimm/
├── data/
│   ├── database/          # 数据库操作
│   ├── model/             # 数据模型
│   └── repository/        # 数据仓库
├── service/
│   ├── PaymentNotificationListener.kt  # 通知监听核心
│   ├── AmountReplyReceiver.kt          # 通知回复处理
│   └── DeleteTransactionReceiver.kt    # 通知删除处理
├── ui/
│   ├── home/              # 首页
│   ├── cards/             # 卡片管理
│   ├── import_screen/     # 文件导入
│   ├── file_analysis/     # 文件分析
│   ├── stats/             # 统计页面
│   ├── settings/          # 设置页面
│   ├── permissions/       # 权限引导
│   ├── transaction/       # 交易详情
│   ├── mascot/            # 桌宠动画
│   ├── navigation/        # 导航框架
│   └── theme/             # 主题配置
└── util/                  # 工具类（CSV/XLSX解析）
```

## 权限说明

| 权限 | 用途 |
|------|------|
| 通知监听 | 读取微信/支付宝通知，自动识别交易 |
| 通知权限 | 发送交易提醒和金额录入通知 |
| 开机启动 | 重启后自动恢复监听服务 |

## 安装使用

### 方式一：下载 APK
1. 前往 [Releases](../../releases) 下载最新 APK
2. 安装后按照引导开启通知监听权限
3. 确保微信和支付宝的通知权限已开启

### 方式二：源码编译
```bash
git clone https://github.com/FridayKoi/WhereIsMyMoney.git
cd WhereIsMyMoney
./gradlew assembleDebug
```
编译产物位于 `app/build/outputs/apk/debug/app-debug.apk`

## 使用提示

1. **首次使用**：请按照权限引导开启通知监听权限
2. **微信设置**：确保微信「设置 → 新消息通知」已开启
3. **支付宝设置**：确保支付宝「设置 → 通用 → 新消息通知」已开启
4. **误识别处理**：通知栏提供「误识别·删除」按钮，可直接删除错误记录
5. **手动记账**：点击右上角 + 可手动添加交易记录

## 隐私声明

本应用高度重视用户隐私：
- 所有数据仅存储在本地设备，不上传至任何服务器
- 仅读取微信/支付宝的通知内容用于交易识别
- 不收集任何个人信息
- 不包含任何第三方追踪或广告 SDK

详见 [隐私政策](PRIVACY_POLICY.md)

## 开源协议

本项目采用 [Apache License 2.0](LICENSE) 开源协议。

## 贡献

欢迎提交 [Issue](https://github.com/FridayKoi/WhereIsMyMoney/issues) 和 [Pull Request](https://github.com/FridayKoi/WhereIsMyMoney/pulls)！

## 支持

如果这个项目对你有帮助，欢迎请作者吃巧克力蛋糕：

🔗 **[支持「我钱呢？！」](https://wqn.netlify.app/)**

- 微信/支付宝扫码赞赏

<!-- 在这里放你的赞赏码图片（可选） -->
<!-- ![微信赞赏码](screenshots/wechat_donate.png) -->

## 致谢

- [Jetpack Compose](https://developer.android.com/jetpack/compose)
- [Material Design 3](https://m3.material.io/)
- 所有贡献者和用户
