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
    val context: GenerateContext
)

data class GenerateContext(
    val filePath: String,
    val selectionOrCaretSnippet: String,
    val languageId: String?
)

data class GenerateResponse(
    val task_id: String,
    val diff_id: String,
    val raw: String,
    val model: String
)

data class TelemetryRequest(
    val task_id: String,
    val diff_id: String,
    val event: TelemetryEventType
)

data class SearchReplaceDiff(
    val search: String,
    val replace: String
)

data class ModelsResponse(
    val defaultModel: String,
    val supportedModels: List<String>
)
