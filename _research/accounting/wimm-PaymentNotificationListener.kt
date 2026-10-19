package com.friday.wimm.service

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import com.friday.wimm.MyApplication
import com.friday.wimm.data.model.Transaction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class PaymentNotificationListener : NotificationListenerService() {
    private val scope = CoroutineScope(Dispatchers.IO)

    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "===== 通知监听服务已创建 =====")
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        Log.d(TAG, "===== 通知监听服务已连接 =====")
        // 列出当前所有通知（调试用）
        try {
            val activeNotifications = activeNotifications
            Log.d(TAG, "当前活跃通知数量: ${activeNotifications?.size ?: 0}")
            activeNotifications?.forEach { sbn ->
                if (sbn.packageName == WECHAT_PACKAGE || sbn.packageName == ALIPAY_PACKAGE) {
                    Log.d(TAG, "  已有通知: ${sbn.packageName} - ${sbn.notification.extras.getString(Notification.EXTRA_TITLE)}")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "获取活跃通知失败", e)
        }
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        Log.d(TAG, "===== 通知监听服务已断开 =====")
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName

        // 记录所有收到的通知（调试用）
        Log.d(TAG, "========== 收到通知 ==========")
        Log.d(TAG, "包名: $packageName")

        if (packageName != WECHAT_PACKAGE && packageName != ALIPAY_PACKAGE) return

        val notification = sbn.notification
        val extras = notification.extras

        // 尝试多种方式获取通知内容
        val title = extras.getString(Notification.EXTRA_TITLE) ?: ""
        val text = extras.getString(Notification.EXTRA_TEXT) ?: ""
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: ""
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString() ?: ""
        val summaryText = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString() ?: ""
        val infoText = extras.getCharSequence("android.infoText")?.toString() ?: ""
        val tickerText = notification.tickerText?.toString() ?: ""

        // 合并所有可能的文本内容
        val allText = listOf(title, text, bigText, subText, summaryText, infoText, tickerText)
            .filter { it.isNotBlank() }
            .joinToString(" | ")

        Log.d(TAG, "title: $title")
        Log.d(TAG, "text: $text")
        Log.d(TAG, "bigText: $bigText")
        Log.d(TAG, "subText: $subText")
        Log.d(TAG, "summaryText: $summaryText")
        Log.d(TAG, "infoText: $infoText")
        Log.d(TAG, "tickerText: $tickerText")
        Log.d(TAG, "合并文本: $allText")

        // 用合并后的文本尝试解析
        val transaction = parseNotification(packageName, title, allText)
        if (transaction != null) {
            val id = saveTransaction(transaction)
            Log.d(TAG, ">>> 解析成功: ${transaction.type} ${transaction.merchant} ${transaction.amount}, id=$id")
            if (id > 0) {
                // 通知桌宠
                com.friday.wimm.ui.mascot.MascotService.notifyTransaction(
                    this,
                    isIncome = transaction.type == "income",
                    merchant = transaction.merchant
                )
                if (transaction.amount <= 0) {
                    // 金额为0，发送带输入框的通知
                    notifyMissingAmount(title, allText, id)
                } else {
                    // 有金额，发送记录确认通知（带删除按钮）
                    notifyTransactionRecorded(transaction, id)
                }
            }
        } else {
            Log.d(TAG, ">>> 未匹配任何交易模式")
        }
        Log.d(TAG, "==============================")
    }

    private fun parseNotification(pkg: String, title: String, text: String): Transaction? {
        // 清理文本：移除 [2条] 等前缀
        val cleanText = text.replace(Regex("""\[?\d+条\]?"""), "").trim()

        // 提取金额（优先从text，其次从title）
        val amount = extractAmount(cleanText) ?: extractAmount(title)

        // 判断是否是交易相关通知 - 使用更严格的匹配
        val isTransfer = isPaymentNotification(title, cleanText)

        if (!isTransfer) {
            Log.d(TAG, "非交易通知: title=$title, text=$cleanText")
            return null
        }

        // 如果没有金额，仍然记录（金额为0），提醒用户补录
        val finalAmount = amount ?: 0.0
        if (finalAmount <= 0) {
            Log.d(TAG, "交易通知无金额，记录为0: title=$title, text=$cleanText")
        }

        // 判断收入/支出
        val type = detectType(title, cleanText)

        // 提取商户/对方名称
        val merchant = extractMerchant(title, cleanText) ?: if (type == "income") "未知收入" else "未知支出"

        // 生成去重用的交易号
        val transactionNo = "notify_${System.currentTimeMillis()}_{(title + cleanText).hashCode()}"

        Log.d(TAG, "解析结果: amount=$amount, type=$type, merchant=$merchant")

        return Transaction(
            amount = finalAmount,
            merchant = merchant,
            source = if (pkg == WECHAT_PACKAGE) "wechat" else "alipay",
            timestamp = System.currentTimeMillis(),
            type = type,
            transactionNo = transactionNo,
            dataSource = "notification"
        )
    }

    // 支付通知识别
    private fun isPaymentNotification(title: String, text: String): Boolean {
        val combined = "$title $text"

        // 1. 微信支付官方通知
        if (title == "微信支付" || title == "微信收款助手" || title == "微信") return true

        // 2. 支付宝通知
        if (title.contains("支付宝")) return true

        // 3. 明确的支付行为短语（优先匹配）
        val paymentPhrases = listOf(
            "你收到一笔转账", "你收到一个红包", "向你转账", "给你转账",
            "收款到账", "付款成功", "支付成功", "转账成功",
            "红包已存入零钱", "已收钱", "收款成功", "向你付款",
            "发出了红包", "成功收款", "收到红包", "领取了你的红包",
            "已转账", "转账收款", "红包来了", "给你发了一个红包",
            "向你付钱", "收款通知", "到账通知", "付款通知",
            "已收钱", "转账已到账", "请收款", "请收钱",
            "发起了一笔转账", "发来了红包", "转账到银行卡",
            "已被接收", "已被领取", "已被接受", "已接收", "已领取", "已接受",
            "转账已被", "红包已被", "已存入零钱", "已转入"
        )
        for (phrase in paymentPhrases) {
            if (combined.contains(phrase)) return true
        }

        // 4. 包含 "[转账]" 或 "[红包]" 标记（兼容全角/半角括号）
        if (combined.contains("[转账]") || combined.contains("[红包]") ||
            combined.contains("[付款]") || combined.contains("[收款]") ||
            combined.contains("［转账］") || combined.contains("［红包］") ||
            combined.contains("［付款］") || combined.contains("［收款］") ||
            combined.contains("微信红包") || combined.contains("恭喜发财")) return true

        // 5. 同时包含"转账"和"收款"/"收钱"
        if (combined.contains("转账") && (combined.contains("收款") || combined.contains("收钱"))) return true

        // 6. 有明确金额符号的支付相关消息
        val hasExplicitAmount = combined.contains("¥") || combined.contains("￥") ||
                Regex("""\d+\.?\d*元""").containsMatchIn(combined)

        if (hasExplicitAmount) {
            val paymentKeywords = listOf(
                "转账", "收款", "付款", "支付", "到账", "红包",
                "零钱", "已收", "已付", "成功"
            )
            for (keyword in paymentKeywords) {
                if (combined.contains(keyword)) return true
            }
        }

        // 7. 红包 + 有明确金额
        if (combined.contains("红包") && hasExplicitAmount) return true

        return false
    }

    private fun detectType(title: String, text: String): String {
        val combined = "$title$text"
        // 收入关键词
        val incomeKeywords = listOf(
            "到账", "收入", "收到", "收款", "转入", "进账",
            "红包", "退款", "已收", "已到账", "入账",
            "给你转账", "转给你", "向你付款", "给你发了一个红包",
            "收款成功", "转账收款"
        )
        // 支出关键词
        val expenseKeywords = listOf(
            "支付", "付款", "消费", "支出", "转出", "扣费",
            "已付", "扣款", "成功支付", "缴费", "充值",
            "转账成功", "发出了红包", "已转账"
        )

        // 优先检查收入
        for (keyword in incomeKeywords) {
            if (combined.contains(keyword)) return "income"
        }
        // 再检查支出
        for (keyword in expenseKeywords) {
            if (combined.contains(keyword)) return "expense"
        }
        // 默认支出
        return "expense"
    }

    private fun extractAmount(text: String): Double? {
        // 匹配各种金额格式
        val patterns = listOf(
            Regex("""[¥￥]\s*(\d+\.?\d*)"""),                           // ¥25.00 或 ￥25.00
            Regex("""(\d+\.?\d*)\s*元"""),                               // 25.00元 或 25元
            Regex("""(?:金额|收款|付款|转账|红包|到账|成功)[：:\s]*(\d+\.?\d*)"""),  // 金额：25.00
            Regex("""(\d+\.\d{1,2})"""),                                 // 带小数的数字：25.00 或 25.5
        )

        for (pattern in patterns) {
            val match = pattern.find(text)
            val value = match?.groupValues?.get(1)?.toDoubleOrNull()
            if (value != null && value > 0) {
                Log.d(TAG, "金额匹配: 模式=${pattern.pattern}, 值=$value, 文本=$text")
                return value
            }
        }

        // 最后兜底：找文本中任何看起来像金额的数字（带小数点且不超过10位整数）
        val fallback = Regex("""(\d{1,10}\.\d{1,2})""").find(text)
        val fallbackValue = fallback?.groupValues?.get(1)?.toDoubleOrNull()
        if (fallbackValue != null && fallbackValue > 0) {
            Log.d(TAG, "兜底金额匹配: $fallbackValue, 文本=$text")
            return fallbackValue
        }

        return null
    }

    private fun extractMerchant(title: String, text: String): String? {
        // 微信转账：title就是对方昵称
        if (text.contains("转账") || text.contains("收款") || text.contains("红包")) {
            if (title.isNotBlank() && title.length <= 20 && !title.contains("微信")) {
                return title
            }
        }

        // 尝试从文本中提取商户/对方名称
        val patterns = listOf(
            Regex("""商户[：:\s]*(.+?)(?:\s|$)"""),
            Regex("""收款方[：:\s]*(.+?)(?:\s|$)"""),
            Regex("""向(.+?)付款"""),
            Regex("""(.+?)向你付款"""),
            Regex("""给(.+?)转账"""),
            Regex("""(.+?)给你转账"""),
            Regex("""来自(.+?)(?:\s|$)"""),
            Regex("""付款给(.+?)(?:\s|$)"""),
            Regex("""(.+?)付款成功"""),
            // 淘宝/外卖等第三方平台支付
            Regex("""在(.+?)支付"""),
            Regex("""于(.+?)支付"""),
            Regex("""(.+?)订单支付"""),
            Regex("""向(.+?)转账"""),
        )

        for (pattern in patterns) {
            val match = pattern.find(text) ?: pattern.find(title)
            val merchant = match?.groupValues?.get(1)?.trim()
            if (!merchant.isNullOrBlank() && merchant.length <= 20) {
                return merchant
            }
        }

        // 针对"已支付:xx元"这类没有商户名的通知，根据来源返回默认名称
        if (text.contains("已支付") || text.contains("支付成功")) {
            return if (title.contains("微信")) "微信支付" else if (title.contains("支付宝")) "支付宝" else "快捷支付"
        }
        if (text.contains("已收款") || text.contains("收款成功")) {
            return if (title.contains("微信")) "微信收款" else if (title.contains("支付宝")) "支付宝收款" else "快捷收款"
        }
        return null
    }

    private fun notifyMissingAmount(title: String, text: String, transactionId: Long) {
        try {
            val type = if (text.contains("收款") || text.contains("到账") || text.contains("红包")) "income" else "expense"
            val typeLabel = if (type == "income") "收入" else "支出"
            val merchant = extractMerchant(title, text) ?: "未知"

            val notificationManager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
            val channelId = "wimm_transaction_alert"
            val notificationId = transactionId.toInt()

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                notificationManager.deleteNotificationChannel(channelId)
                val channel = android.app.NotificationChannel(
                    channelId,
                    "交易提醒",
                    android.app.NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "交易金额提醒，支持悬浮通知"
                    enableVibration(true)
                    enableLights(true)
                    setBypassDnd(true)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    setShowBadge(true)
                }
                notificationManager.createNotificationChannel(channel)
            }

            // RemoteInput - 直接在通知中输入金额
            val remoteInput = RemoteInput.Builder(AmountReplyReceiver.KEY_TEXT_REPLY)
                .setLabel("输入金额 (如 88.5)")
                .build()

            val replyIntent = android.content.Intent(this, AmountReplyReceiver::class.java).apply {
                putExtra(AmountReplyReceiver.EXTRA_TRANSACTION_ID, transactionId)
                putExtra(AmountReplyReceiver.EXTRA_NOTIFICATION_ID, notificationId)
                putExtra(AmountReplyReceiver.EXTRA_TYPE, type)
                putExtra(AmountReplyReceiver.EXTRA_MERCHANT, merchant)
            }
            val replyPendingIntent = android.app.PendingIntent.getBroadcast(
                this,
                System.currentTimeMillis().toInt(),
                replyIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE
            )

            val replyAction = NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_edit,
                "输入金额",
                replyPendingIntent
            ).addRemoteInput(remoteInput).build()

            // 删除按钮 - 误识别时删除记录
            val deleteIntent = android.content.Intent(this, DeleteTransactionReceiver::class.java).apply {
                putExtra(DeleteTransactionReceiver.EXTRA_TRANSACTION_ID, transactionId)
                putExtra(DeleteTransactionReceiver.EXTRA_NOTIFICATION_ID, notificationId)
            }
            val deletePendingIntent = android.app.PendingIntent.getBroadcast(
                this,
                System.currentTimeMillis().toInt() + 1,
                deleteIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            val deleteAction = NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_delete,
                "误识别·删除",
                deletePendingIntent
            ).build()

            // 点击通知打开app
            val intent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val pendingIntent = android.app.PendingIntent.getActivity(
                this, 0, intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(this, channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("\uD83D\uDCB0 检测到${typeLabel}交易")
                .setContentText("${merchant} - 请在下方输入金额")
                .setStyle(NotificationCompat.BigTextStyle()
                    .bigText("${merchant}\n检测到${typeLabel}交易，请直接在通知中输入金额记录"))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setFullScreenIntent(pendingIntent, true)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .addAction(replyAction)
                .addAction(deleteAction)
                .build()

            notificationManager.notify(notificationId, notification)
            Log.d(TAG, "已发送输入金额提醒: $typeLabel $merchant")
        } catch (e: Exception) {
            Log.e(TAG, "发送提醒失败", e)
        }
    }

    private fun notifyTransactionRecorded(transaction: Transaction, transactionId: Long) {
        try {
            val typeLabel = if (transaction.type == "income") "收入" else "支出"
            val notificationManager = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
            // 统一使用同一个 channel，确保 heads-up 弹出
            val channelId = "wimm_transaction_alert"
            val notificationId = transactionId.toInt()

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                notificationManager.deleteNotificationChannel(channelId)
                val channel = android.app.NotificationChannel(
                    channelId,
                    "交易提醒",
                    android.app.NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "交易金额提醒，支持悬浮通知"
                    enableVibration(true)
                    enableLights(true)
                    setBypassDnd(true)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    setShowBadge(true)
                }
                notificationManager.createNotificationChannel(channel)
            }

            // 删除按钮
            val deleteIntent = android.content.Intent(this, DeleteTransactionReceiver::class.java).apply {
                putExtra(DeleteTransactionReceiver.EXTRA_TRANSACTION_ID, transactionId)
                putExtra(DeleteTransactionReceiver.EXTRA_NOTIFICATION_ID, notificationId)
            }
            val deletePendingIntent = android.app.PendingIntent.getBroadcast(
                this,
                System.currentTimeMillis().toInt(),
                deleteIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )
            val deleteAction = NotificationCompat.Action.Builder(
                android.R.drawable.ic_menu_delete,
                "误识别·删除",
                deletePendingIntent
            ).build()

            // 点击通知打开 app
            val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
                flags = android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            val pendingIntent = android.app.PendingIntent.getActivity(
                this, 0, launchIntent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
            )

            val notification = NotificationCompat.Builder(this, channelId)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("已记录${typeLabel}: ¥${String.format("%.2f", transaction.amount)}")
                .setContentText("${transaction.merchant} - 如误识别请点删除")
                .setStyle(NotificationCompat.BigTextStyle()
                    .bigText("${transaction.merchant}\n已记录${typeLabel} ¥${String.format("%.2f", transaction.amount)}\n如误识别请点击下方删除按钮"))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .setFullScreenIntent(pendingIntent, true)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(deleteAction)
                .build()

            notificationManager.notify(notificationId, notification)
            Log.d(TAG, "已发送记录通知: $typeLabel ${transaction.merchant} ${transaction.amount}")
        } catch (e: Exception) {
            Log.e(TAG, "发送记录通知失败", e)
        }
    }

    private fun saveTransaction(transaction: Transaction): Long {
        return try {
            val application = applicationContext as MyApplication
            kotlinx.coroutines.runBlocking {
                val id = application.transactionRepository.insert(transaction)
                Log.d(TAG, "保存成功: ${transaction.type} ${transaction.merchant} ${transaction.amount}, id=$id")
                id
            }
        } catch (e: Exception) {
            Log.e(TAG, "保存失败", e)
            -1
        }
    }

    companion object {
        private const val TAG = "PaymentNotification"
        private const val WECHAT_PACKAGE = "com.tencent.mm"
        private const val ALIPAY_PACKAGE = "com.eg.android.AlipayGphone"
    }
}
