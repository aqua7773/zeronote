package com.friday.wimm.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import com.friday.wimm.MyApplication
import com.friday.wimm.data.model.Transaction
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class PaymentAccessibilityService : AccessibilityService() {
    private val scope = CoroutineScope(Dispatchers.IO)

    companion object {
        private const val TAG = "PaymentAccessibility"

        private const val WECHAT_PACKAGE = "com.tencent.mm"
        private const val ALIPAY_PACKAGE = "com.eg.android.AlipayGphone"

        // 去重：最近处理过的交易（金额+时间窗口内不重复记录）
        private var lastProcessedAmount: Double = 0.0
        private var lastProcessedTime: Long = 0
        private const val DEDUP_WINDOW_MS = 10000L // 10秒内相同金额不重复记录
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        Log.d(TAG, "===== 无障碍服务已连接 =====")

        val info = serviceInfo
        info.eventTypes = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or
                AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        info.packageNames = arrayOf(WECHAT_PACKAGE, ALIPAY_PACKAGE)
        info.feedbackType = AccessibilityServiceInfo.FEEDBACK_GENERIC
        info.notificationTimeout = 200
        serviceInfo = info
    }

    // 当前是否在交易页面
    private var isOnTransactionPage = false
    private var currentTransactionPackage = ""
    private var lastClassName = ""

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return

        val packageName = event.packageName?.toString() ?: return
        val className = event.className?.toString() ?: ""
        val eventType = event.eventType

        when (eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                Log.d(TAG, "窗口变化: pkg=$packageName, class=$className")

                if (packageName == WECHAT_PACKAGE) {
                    handleWechatWindowChanged(event, className)
                } else if (packageName == ALIPAY_PACKAGE) {
                    handleAlipayWindowChanged(event, className)
                } else {
                    // 其他app的窗口，重置状态
                    isOnTransactionPage = false
                }
            }

            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> {
                // 当我们在交易页面时，监听内容变化
                if (isOnTransactionPage && packageName == currentTransactionPackage) {
                    Log.d(TAG, "交易页面内容变化: pkg=$packageName")
                    processContentChanged(event, packageName)
                }
            }
        }
    }

    private fun handleWechatWindowChanged(event: AccessibilityEvent, className: String) {
        val isPayPage = className.contains("PayResultUI", ignoreCase = true) ||
                className.contains("PaySuccessUI", ignoreCase = true) ||
                className.contains("OrderPayResultUI", ignoreCase = true) ||
                className.contains("TransferResultUI", ignoreCase = true) ||
                className.contains("RemittanceUI", ignoreCase = true) ||
                className.contains("RemittanceDetailUI", ignoreCase = true) ||
                className.contains("LuckyMoneyDetailUI", ignoreCase = true) ||
                className.contains("TransferConfirmUI", ignoreCase = true)

        if (isPayPage) {
            Log.d(TAG, "检测到微信交易页面: $className")
            isOnTransactionPage = true
            currentTransactionPackage = WECHAT_PACKAGE
            lastClassName = className
            // 立即尝试读取
            processPageFromEvent(event, WECHAT_PACKAGE)
        } else {
            // 离开交易页面
            if (isOnTransactionPage && currentTransactionPackage == WECHAT_PACKAGE) {
                Log.d(TAG, "离开微信交易页面")
                isOnTransactionPage = false
            }
        }
    }

    private fun handleAlipayWindowChanged(event: AccessibilityEvent, className: String) {
        val isPayPage = className.contains("PayResultActivity", ignoreCase = true) ||
                className.contains("PaySuccessActivity", ignoreCase = true) ||
                className.contains("TransferResultActivity", ignoreCase = true) ||
                className.contains("H5PayResultActivity", ignoreCase = true)

        if (isPayPage) {
            Log.d(TAG, "检测到支付宝交易页面: $className")
            isOnTransactionPage = true
            currentTransactionPackage = ALIPAY_PACKAGE
            lastClassName = className
            processPageFromEvent(event, ALIPAY_PACKAGE)
        } else {
            if (isOnTransactionPage && currentTransactionPackage == ALIPAY_PACKAGE) {
                isOnTransactionPage = false
            }
        }
    }

    private fun processContentChanged(event: AccessibilityEvent, packageName: String) {
        val source = event.source
        Log.d(TAG, "processContentChanged: source=${source != null}, sourcePkg=${source?.packageName}")
        if (source != null) {
            val allTexts = mutableListOf<String>()
            collectTexts(source, allTexts)
            source.recycle()
            val fullText = allTexts.joinToString(" | ")
            Log.d(TAG, "内容变化文本: $fullText")
            if (allTexts.isNotEmpty()) {
                processText(fullText, packageName)
            }
        } else {
            tryFindWindow(packageName)
        }
    }

    private fun processPageFromEvent(event: AccessibilityEvent, packageName: String) {
        val source = event.source
        if (source != null) {
            val allTexts = mutableListOf<String>()
            collectTexts(source, allTexts)
            source.recycle()
            val fullText = allTexts.joinToString(" | ")
            Log.d(TAG, "event.source文本: $fullText")
            if (allTexts.isNotEmpty()) {
                processText(fullText, packageName)
                return
            }
        }

        // 尝试 windows 列表
        tryFindWindow(packageName)
    }

    private fun tryFindWindow(packageName: String) {
        try {
            val allWindows = windows
            Log.d(TAG, "windows数量: ${allWindows?.size ?: 0}")
            allWindows?.forEachIndexed { index, window ->
                val root = window.root
                val pkg = root?.packageName?.toString()
                val cls = root?.className?.toString()
                Log.d(TAG, "  window[$index]: pkg=$pkg, class=$cls, type=${window.type}, title=${window.title}")
                root?.recycle()
            }
            // 找目标窗口
            allWindows?.forEach { window ->
                val root = window.root
                if (root != null) {
                    val pkg = root.packageName?.toString()
                    if (pkg == packageName) {
                        val allTexts = mutableListOf<String>()
                        collectTexts(root, allTexts)
                        root.recycle()
                        val fullText = allTexts.joinToString(" | ")
                        Log.d(TAG, "找到${pkg}窗口: $fullText")
                        if (allTexts.isNotEmpty()) {
                            processText(fullText, packageName)
                            return
                        }
                    } else {
                        root.recycle()
                    }
                }
            }
            Log.d(TAG, "未找到${packageName}窗口")
        } catch (e: Exception) {
            Log.e(TAG, "获取windows失败", e)
        }
    }

    private fun processPage(packageName: String) {
        val rootNode = rootInActiveWindow
        if (rootNode == null) {
            Log.w(TAG, "无法获取根节点")
            return
        }

        val allTexts = mutableListOf<String>()
        collectTexts(rootNode, allTexts)
        rootNode.recycle()

        val fullText = allTexts.joinToString(" | ")
        Log.d(TAG, "rootInActiveWindow文本: $fullText")
        Log.d(TAG, "节点数量: ${allTexts.size}")

        processText(fullText, packageName)
    }

    private fun processText(fullText: String, packageName: String) {
        val isTransactionPage = fullText.contains("支付成功") ||
                fullText.contains("付款成功") ||
                fullText.contains("转账成功") ||
                fullText.contains("已转账") ||
                fullText.contains("已收钱") ||
                fullText.contains("已收款") ||
                fullText.contains("收款成功") ||
                fullText.contains("红包已领取") ||
                fullText.contains("红包已存入") ||
                fullText.contains("微信红包") ||
                fullText.contains("领取红包") ||
                fullText.contains("拆开红包") ||
                fullText.contains("红包详情") ||
                fullText.contains("恭喜发财") ||
                fullText.contains("已存入零钱") ||
                fullText.contains("转账说明") ||
                fullText.contains("转账金额") ||
                fullText.contains("金额") ||
                fullText.contains("¥") ||
                fullText.contains("￥")

        if (!isTransactionPage) {
            Log.d(TAG, "非交易页面，跳过")
            return
        }

        // 提取金额
        val amount = extractAmount(fullText)
        if (amount == null || amount <= 0) {
            Log.w(TAG, "无法提取金额: $fullText")
            return
        }

        // 去重检查
        val now = System.currentTimeMillis()
        if (amount == lastProcessedAmount && (now - lastProcessedTime) < DEDUP_WINDOW_MS) {
            Log.d(TAG, "重复交易，跳过: $amount")
            return
        }
        lastProcessedAmount = amount
        lastProcessedTime = now

        // 判断收入/支出
        val type = detectType(fullText)

        // 提取商户名
        val merchant = extractMerchant(fullText, packageName)

        val transaction = Transaction(
            amount = amount,
            merchant = merchant ?: if (type == "income") "未知收入" else "未知支出",
            source = if (packageName == WECHAT_PACKAGE) "wechat" else "alipay",
            timestamp = now,
            type = type,
            transactionNo = "accessibility_${now}_${amount.hashCode()}",
            dataSource = "accessibility"
        )

        saveTransaction(transaction)
        Log.d(TAG, ">>> 无障碍记录成功: ${transaction.type} ${transaction.merchant} ${transaction.amount}")
    }

    private fun collectTexts(node: AccessibilityNodeInfo, texts: MutableList<String>) {
        val text = node.text?.toString()
        if (!text.isNullOrBlank()) texts.add(text)

        val desc = node.contentDescription?.toString()
        if (!desc.isNullOrBlank()) texts.add(desc)

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectTexts(child, texts)
            child.recycle()
        }
    }

    private fun extractAmount(text: String): Double? {
        val patterns = listOf(
            Regex("""[¥￥]\s*(\d+\.?\d*)"""),
            Regex("""(\d+\.?\d*)\s*元"""),
            Regex("""金额[：:\s]*(\d+\.?\d*)"""),
            Regex("""(\d+\.\d{1,2})"""), // 带小数的数字
        )

        for (pattern in patterns) {
            val match = pattern.find(text)
            val value = match?.groupValues?.get(1)?.toDoubleOrNull()
            if (value != null && value > 0) {
                Log.d(TAG, "金额匹配: $value (模式: ${pattern.pattern})")
                return value
            }
        }
        return null
    }

    private fun detectType(text: String): String {
        val incomeKeywords = listOf(
            "到账", "收入", "收到", "收款", "转入", "红包已领取",
            "已收钱", "已收款", "收款成功", "退款", "已到账"
        )
        val expenseKeywords = listOf(
            "支付", "付款", "消费", "支出", "转出", "已付",
            "扣款", "已转账", "缴费", "充值"
        )

        for (kw in incomeKeywords) {
            if (text.contains(kw)) return "income"
        }
        for (kw in expenseKeywords) {
            if (text.contains(kw)) return "expense"
        }
        return "expense"
    }

    private fun extractMerchant(text: String, packageName: String): String? {
        val patterns = listOf(
            Regex("""商户[：:\s]*(.+?)(?:\s|$)"""),
            Regex("""收款方[：:\s]*(.+?)(?:\s|$)"""),
            Regex("""商家[：:\s]*(.+?)(?:\s|$)"""),
            Regex("""向(.+?)付款"""),
            Regex("""(.+?)向你付款"""),
            Regex("""给(.+?)转账"""),
            Regex("""(.+?)给你转账"""),
            Regex("""付款给(.+?)(?:\s|$)"""),
            Regex("""来自(.+?)(?:\s|$)"""),
        )

        for (pattern in patterns) {
            val match = pattern.find(text)
            val merchant = match?.groupValues?.get(1)?.trim()
            if (!merchant.isNullOrBlank() && merchant.length <= 20) {
                return merchant
            }
        }
        return null
    }

    private fun saveTransaction(transaction: Transaction) {
        scope.launch {
            try {
                val application = applicationContext as MyApplication
                application.transactionRepository.insert(transaction)
                Log.d(TAG, "保存成功: ${transaction.type} ${transaction.merchant} ${transaction.amount}")
            } catch (e: Exception) {
                Log.e(TAG, "保存失败", e)
            }
        }
    }

    override fun onInterrupt() {
        Log.d(TAG, "无障碍服务被中断")
    }

    override fun onDestroy() {
        super.onDestroy()
        Log.d(TAG, "无障碍服务已销毁")
    }
}
