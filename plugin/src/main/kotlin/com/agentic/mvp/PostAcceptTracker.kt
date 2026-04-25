package com.signalcode.mvp

import java.nio.file.Paths
import java.util.concurrent.ConcurrentHashMap

data class PostAcceptEmission(
    val taskId: String,
    val acceptedDiffId: String,
    val meta: Map<String, Any>
)

object PostAcceptTracker {
    private data class State(
        val taskId: String,
        val acceptedDiffId: String,
        val acceptedAtMs: Long,
        val filePath: String,
        val acceptedText: String,
        var editCount: Int = 0,
        var lastEmitAtMs: Long = 0
    )

    private val statesByFilePath = ConcurrentHashMap<String, State>()
    private const val EMIT_THROTTLE_MS = 8_000L
    private const val ACTIVE_WINDOW_MS = 30 * 60 * 1000L

    fun registerAccepted(taskId: String, acceptedDiffId: String, filePath: String, acceptedText: String) {
        val normalizedFilePath = normalizeFilePath(filePath)
        statesByFilePath[normalizedFilePath] = State(
            taskId = taskId,
            acceptedDiffId = acceptedDiffId,
            acceptedAtMs = System.currentTimeMillis(),
            filePath = normalizedFilePath,
            acceptedText = acceptedText
        )
    }

    fun onDocumentEdited(filePath: String, currentText: String): PostAcceptEmission? {
        val normalizedFilePath = normalizeFilePath(filePath)
        val state = statesByFilePath[normalizedFilePath] ?: return null
        val now = System.currentTimeMillis()
        if (now - state.acceptedAtMs > ACTIVE_WINDOW_MS) {
            statesByFilePath.remove(normalizedFilePath)
            return null
        }

        state.editCount += 1
        if (now - state.lastEmitAtMs < EMIT_THROTTLE_MS) {
            return null
        }
        state.lastEmitAtMs = now

        val acceptedChars = state.acceptedText.length
        val currentChars = currentText.length
        val acceptedLines = lineCount(state.acceptedText)
        val currentLines = lineCount(currentText)

        val meta = mapOf(
            "source" to "post-accept",
            "activityType" to "post_accept_edit",
            "filePath" to normalizedFilePath,
            "acceptedDiffId" to state.acceptedDiffId,
            "editsAfterAccept" to state.editCount,
            "secondsSinceAccept" to ((now - state.acceptedAtMs) / 1000.0),
            "acceptedChars" to acceptedChars,
            "currentChars" to currentChars,
            "charDelta" to kotlin.math.abs(currentChars - acceptedChars),
            "acceptedLines" to acceptedLines,
            "currentLines" to currentLines,
            "lineDelta" to kotlin.math.abs(currentLines - acceptedLines)
        )
        return PostAcceptEmission(
            taskId = state.taskId,
            acceptedDiffId = state.acceptedDiffId,
            meta = meta
        )
    }

    private fun lineCount(text: String): Int {
        if (text.isEmpty()) return 0
        return text.count { it == '\n' } + 1
    }

    private fun normalizeFilePath(filePath: String): String {
        val trimmed = filePath.trim()
        val normalized = runCatching { Paths.get(trimmed).normalize().toString() }.getOrDefault(trimmed)
        return normalized.replace('\\', '/')
    }
}
