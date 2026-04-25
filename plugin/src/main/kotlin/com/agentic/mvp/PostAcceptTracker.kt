package com.signalcode.mvp

import java.nio.file.Paths
import java.util.Locale
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
        var lastEmitAtMs: Long = 0,
        var lastObservedFingerprint: Int
    )

    private val statesByFilePath = ConcurrentHashMap<String, State>()
    private const val EMIT_THROTTLE_MS = 8_000L
    private const val ACTIVE_WINDOW_MS = 30 * 60 * 1000L
    private const val MAX_LCS_MATRIX_CELLS = 2_000_000L
    private val WINDOWS_CASE_INSENSITIVE_PATHS =
        System.getProperty("os.name").contains("win", ignoreCase = true)

    fun registerAccepted(taskId: String, acceptedDiffId: String, filePath: String, acceptedText: String) {
        val normalizedFilePath = normalizeFilePath(filePath)
        statesByFilePath[normalizedFilePath] = State(
            taskId = taskId,
            acceptedDiffId = acceptedDiffId,
            acceptedAtMs = System.currentTimeMillis(),
            filePath = normalizedFilePath,
            acceptedText = acceptedText,
            lastObservedFingerprint = fingerprint(acceptedText)
        )
    }

    fun onDocumentEdited(filePath: String, currentText: String): PostAcceptEmission? {
        val normalizedFilePath = normalizeFilePath(filePath)
        val state = statesByFilePath[normalizedFilePath] ?: return null
        val now = System.currentTimeMillis()
        if (now - state.acceptedAtMs > ACTIVE_WINDOW_MS) {
            statesByFilePath.remove(normalizedFilePath, state)
            return null
        }
        return buildEmission(state, currentText, now, incrementEditCount = true)
    }

    fun collectPendingEmissions(readCurrentText: (normalizedFilePath: String) -> String?): List<PostAcceptEmission> {
        val now = System.currentTimeMillis()
        val emissions = mutableListOf<PostAcceptEmission>()
        statesByFilePath.entries.toList().forEach { (path, state) ->
            if (now - state.acceptedAtMs > ACTIVE_WINDOW_MS) {
                statesByFilePath.remove(path, state)
                return@forEach
            }
            val currentText = readCurrentText(path) ?: return@forEach
            val emission = buildEmission(state, currentText, now, incrementEditCount = false)
            if (emission != null) {
                emissions += emission
            }
        }
        return emissions
    }

    private fun buildEmission(
        state: State,
        currentText: String,
        now: Long,
        incrementEditCount: Boolean
    ): PostAcceptEmission? = synchronized(state) {
        val changeMetrics = diffMetrics(state.acceptedText, currentText)
        if (changeMetrics.charDelta == 0 && changeMetrics.lineDelta == 0) {
            state.lastObservedFingerprint = fingerprint(currentText)
            return null
        }

        val currentFingerprint = fingerprint(currentText)
        if (incrementEditCount) {
            state.editCount += 1
        } else if (currentFingerprint != state.lastObservedFingerprint) {
            state.editCount += 1
        }
        state.lastObservedFingerprint = currentFingerprint

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
            "filePath" to state.filePath,
            "acceptedDiffId" to state.acceptedDiffId,
            "editsAfterAccept" to state.editCount,
            "secondsSinceAccept" to ((now - state.acceptedAtMs) / 1000.0),
            "acceptedChars" to acceptedChars,
            "currentChars" to currentChars,
            "charDelta" to changeMetrics.charDelta,
            "netCharDelta" to (currentChars - acceptedChars),
            "deletedChars" to changeMetrics.deletedChars,
            "insertedChars" to changeMetrics.insertedChars,
            "acceptedLines" to acceptedLines,
            "currentLines" to currentLines,
            "lineDelta" to changeMetrics.lineDelta,
            "netLineDelta" to (currentLines - acceptedLines),
            "deletedLines" to changeMetrics.deletedLines,
            "insertedLines" to changeMetrics.insertedLines
        )
        PostAcceptEmission(
            taskId = state.taskId,
            acceptedDiffId = state.acceptedDiffId,
            meta = meta
        )
    }

    private data class DiffMetrics(
        val deletedChars: Int,
        val insertedChars: Int,
        val charDelta: Int,
        val deletedLines: Int,
        val insertedLines: Int,
        val lineDelta: Int
    )

    private fun diffMetrics(acceptedText: String, currentText: String): DiffMetrics {
        val commonPrefix = commonPrefixLength(acceptedText, currentText)
        val commonSuffix = commonSuffixLength(acceptedText, currentText, commonPrefix)

        val acceptedChangedEnd = acceptedText.length - commonSuffix
        val currentChangedEnd = currentText.length - commonSuffix

        val acceptedChanged = acceptedText.substring(commonPrefix, acceptedChangedEnd)
        val currentChanged = currentText.substring(commonPrefix, currentChangedEnd)
        val churn = estimateMinimalChurn(acceptedChanged, currentChanged)

        return DiffMetrics(
            deletedChars = churn.deletedChars,
            insertedChars = churn.insertedChars,
            charDelta = churn.deletedChars + churn.insertedChars,
            deletedLines = lineCount(acceptedChanged),
            insertedLines = lineCount(currentChanged),
            lineDelta = kotlin.math.abs(lineCount(currentText) - lineCount(acceptedText))
        )
    }

    private data class CharChurn(
        val deletedChars: Int,
        val insertedChars: Int
    )

    private fun estimateMinimalChurn(acceptedChanged: String, currentChanged: String): CharChurn {
        if (acceptedChanged.isEmpty() && currentChanged.isEmpty()) {
            return CharChurn(0, 0)
        }
        if (acceptedChanged.isEmpty()) {
            return CharChurn(0, currentChanged.length)
        }
        if (currentChanged.isEmpty()) {
            return CharChurn(acceptedChanged.length, 0)
        }

        val leftLength = acceptedChanged.length
        val rightLength = currentChanged.length
        val matrixCells = leftLength.toLong() * rightLength.toLong()
        if (matrixCells > MAX_LCS_MATRIX_CELLS) {
            return CharChurn(leftLength, rightLength)
        }

        var previous = IntArray(rightLength + 1)
        var current = IntArray(rightLength + 1)
        for (leftIndex in 1..leftLength) {
            val leftChar = acceptedChanged[leftIndex - 1]
            for (rightIndex in 1..rightLength) {
                current[rightIndex] = if (leftChar == currentChanged[rightIndex - 1]) {
                    previous[rightIndex - 1] + 1
                } else {
                    kotlin.math.max(previous[rightIndex], current[rightIndex - 1])
                }
            }
            val swap = previous
            previous = current
            current = swap
            java.util.Arrays.fill(current, 0)
        }

        val lcsLength = previous[rightLength]
        return CharChurn(
            deletedChars = leftLength - lcsLength,
            insertedChars = rightLength - lcsLength
        )
    }

    private fun commonPrefixLength(left: String, right: String): Int {
        val max = minOf(left.length, right.length)
        var index = 0
        while (index < max && left[index] == right[index]) {
            index += 1
        }
        return index
    }

    private fun commonSuffixLength(left: String, right: String, prefixLength: Int): Int {
        val leftRemaining = left.length - prefixLength
        val rightRemaining = right.length - prefixLength
        val max = minOf(leftRemaining, rightRemaining)
        var count = 0
        while (count < max && left[left.length - 1 - count] == right[right.length - 1 - count]) {
            count += 1
        }
        return count
    }

    private fun lineCount(text: String): Int {
        if (text.isEmpty()) return 0
        return text.count { it == '\n' } + 1
    }

    private fun fingerprint(text: String): Int = 31 * text.length + text.hashCode()

    private fun normalizeFilePath(filePath: String): String {
        val trimmed = filePath.trim()
        val normalized = runCatching { Paths.get(trimmed).normalize().toString() }.getOrDefault(trimmed)
        val slashNormalized = normalized.replace('\\', '/')
        return if (WINDOWS_CASE_INSENSITIVE_PATHS) {
            slashNormalized.lowercase(Locale.ROOT)
        } else {
            slashNormalized
        }
    }
}
