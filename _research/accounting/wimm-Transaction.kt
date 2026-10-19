package com.friday.wimm.data.model

data class Transaction(
    val id: Long = 0,
    val amount: Double,
    val merchant: String,
    val categoryId: Long? = null,
    val source: String,
    val timestamp: Long,
    val note: String = "",
    val type: String = "expense", // "expense" 或 "income"
    val transactionNo: String? = null, // 交易单号，用于文件导入去重
    val dataSource: String = "file", // "file" 文件导入 或 "notification" 通知监听
    val fileId: Long = 0 // 关联的导入文件ID，0表示非文件导入
)