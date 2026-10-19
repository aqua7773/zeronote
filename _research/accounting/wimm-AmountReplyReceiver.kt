package com.friday.wimm.service

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import com.friday.wimm.MyApplication
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class AmountReplyReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "AmountReplyReceiver"
        const val KEY_TEXT_REPLY = "key_amount_reply"
        const val EXTRA_TRANSACTION_ID = "extra_transaction_id"
        const val EXTRA_NOTIFICATION_ID = "extra_notification_id"
        const val EXTRA_TYPE = "extra_type"
        const val EXTRA_MERCHANT = "extra_merchant"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val remoteInput = RemoteInput.getResultsFromIntent(intent)
        val amountText = remoteInput?.getCharSequence(KEY_TEXT_REPLY)?.toString()
        val transactionId = intent.getLongExtra(EXTRA_TRANSACTION_ID, -1)
        val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0)
        val type = intent.getStringExtra(EXTRA_TYPE) ?: "expense"
        val merchant = intent.getStringExtra(EXTRA_MERCHANT) ?: "未知"

        Log.d(TAG, "onReceive: notificationId=$notificationId, transactionId=$transactionId, amountText=$amountText")

        val pendingResult = goAsync()

        // 第一步：用空通知替换原通知，清除 RemoteInput 的进度状态
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        try {
            val emptyNotification = NotificationCompat.Builder(context, "wimm_transaction_alert")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("")
                .setContentText("")
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .build()
            notificationManager.notify(notificationId, emptyNotification)
            Log.d(TAG, "已用空通知替换")
        } catch (e: Exception) {
            Log.e(TAG, "替换通知失败", e)
        }

        // 第二步：延迟100ms后取消通知
        CoroutineScope(Dispatchers.Main).launch {
            try {
                delay(100)
                notificationManager.cancel(notificationId)
                Log.d(TAG, "已取消通知: $notificationId")
            } catch (e: Exception) {
                Log.e(TAG, "取消通知失败", e)
            }
            pendingResult.finish()
        }

        if (amountText.isNullOrBlank()) {
            Log.d(TAG, "用户未输入金额")
            return
        }

        val amount = amountText.replace("[¥￥,，]".toRegex(), "").trim().toDoubleOrNull()
        if (amount == null || amount <= 0) {
            Log.d(TAG, "金额解析失败: $amountText")
            return
        }

        Log.d(TAG, "收到回复金额: $amount, 交易ID: $transactionId, 类型: $type, 收款方: $merchant")

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val application = context.applicationContext as MyApplication
                if (transactionId > 0) {
                    application.transactionRepository.updateAmount(transactionId, amount)
                    Log.d(TAG, "更新成功: id=$transactionId, amount=$amount")
                } else {
                    val transaction = com.friday.wimm.data.model.Transaction(
                        amount = amount,
                        type = type,
                        merchant = merchant,
                        source = "notification",
                        note = "通知自动记录",
                        timestamp = System.currentTimeMillis(),
                        dataSource = "notification"
                    )
                    application.transactionRepository.insert(transaction)
                    Log.d(TAG, "新建成功: $type $merchant $amount")
                }
                CoroutineScope(Dispatchers.Main).launch {
                    Toast.makeText(context, "¥${String.format("%.2f", amount)} 已录入", Toast.LENGTH_SHORT).show()
                }
            } catch (e: Exception) {
                Log.e(TAG, "保存失败", e)
            }
        }
    }
}
