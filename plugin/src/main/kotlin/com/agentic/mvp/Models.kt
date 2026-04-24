package com.signalcode.mvp

enum class TelemetryEventType {
    DIFF_RENDERED,
    ACCEPTED,
    REJECTED,
    ITERATED
}

data class GenerateRequest(
    val prompt: String,
    val model: String?,
    val mode: String,
    val context: GenerateContext
)

data class GenerateContext(
    val filePath: String,
    val projectRootPath: String?,
    val targetFilePath: String?,
    val selectionOrCaretSnippet: String,
    val languageId: String?
)

data class GenerateResponse(
    val task_id: String,
    val diff_id: String,
    val raw: String,
    val model: String,
    val operation: AgentOperation,
    val usage: UsageMetrics? = null
)

data class AgentOperation(
    val kind: String,
    val summary: String,
    val targetFilePath: String,
    val search: String? = null,
    val replace: String? = null,
    val anchor: String? = null,
    val content: String? = null
)

data class UsageMetrics(
    val promptTokens: Int? = null,
    val completionTokens: Int? = null,
    val totalTokens: Int? = null,
    val costUsd: Double? = null
)

data class TelemetryRequest(
    val task_id: String,
    val diff_id: String,
    val event: TelemetryEventType,
    val meta: Map<String, Any>? = null
)

data class SearchReplaceDiff(
    val search: String,
    val replace: String
)

data class ModelsResponse(
    val defaultModel: String,
    val supportedModels: List<String>,
    val availableModels: List<String>? = null
)
