package com.signalcode.mvp

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertNotNull

class PostAcceptTrackerTest {
    private val runningOnWindows = System.getProperty("os.name").contains("win", ignoreCase = true)

    @Test
    fun edit_is_detected_when_accept_and_edit_paths_use_different_windows_separators() {
        val acceptedPath = "C:\\workspace\\signalcode\\${System.nanoTime()}\\src\\DemoFile.kt"
        val editedPath = acceptedPath.replace('\\', '/')

        PostAcceptTracker.registerAccepted(
            taskId = "task-123",
            acceptedDiffId = "diff-123",
            filePath = acceptedPath,
            acceptedText = "fun demo() = 1\n"
        )

        val emission = PostAcceptTracker.onDocumentEdited(
            filePath = editedPath,
            currentText = "fun demo() = 100\n"
        )

        assertNotNull(emission)
        assertEquals("task-123", emission.taskId)
        assertEquals("diff-123", emission.acceptedDiffId)
        assertEquals("post-accept", emission.meta["source"])
        assertEquals("post_accept_edit", emission.meta["activityType"])
        assertEquals(expectedNormalizedPath(editedPath), emission.meta["filePath"])
        assertEquals(1, emission.meta["editsAfterAccept"])
        assertEquals(2, emission.meta["charDelta"])
    }

    @Test
    fun replacement_with_same_length_is_counted_as_rework() {
        val filePath = "C:\\workspace\\signalcode\\${System.nanoTime()}\\src\\SameLengthEdit.kt"
        PostAcceptTracker.registerAccepted(
            taskId = "task-same-length",
            acceptedDiffId = "diff-same-length",
            filePath = filePath,
            acceptedText = "return 10;\n"
        )

        val emission = PostAcceptTracker.onDocumentEdited(
            filePath = filePath,
            currentText = "return 99;\n"
        )

        assertNotNull(emission)
        assertEquals(4, emission.meta["charDelta"])
        assertEquals(2, emission.meta["deletedChars"])
        assertEquals(2, emission.meta["insertedChars"])
        assertEquals(0, emission.meta["netCharDelta"])
    }

    @Test
    fun poll_cycle_detects_deleted_content_without_active_editor_document() {
        val filePath = "C:\\workspace\\signalcode\\${System.nanoTime()}\\src\\DeletedDuringPoll.kt"
        val acceptedText = "line1\nline2\n"
        PostAcceptTracker.registerAccepted(
            taskId = "task-poll-delete",
            acceptedDiffId = "diff-poll-delete",
            filePath = filePath,
            acceptedText = acceptedText
        )

        val emissions = PostAcceptTracker.collectPendingEmissions { _ -> "" }
        assertTrue(emissions.isNotEmpty())

        val emission = emissions.first { it.taskId == "task-poll-delete" }
        assertEquals(acceptedText.length, emission.meta["deletedChars"])
        assertEquals(0, emission.meta["insertedChars"])
        assertEquals(acceptedText.length, emission.meta["charDelta"])
    }

    @Test
    fun disjoint_inline_edits_do_not_count_unchanged_middle_as_churn() {
        val filePath = "C:\\workspace\\signalcode\\${System.nanoTime()}\\src\\DisjointEdit.kt"
        PostAcceptTracker.registerAccepted(
            taskId = "task-disjoint",
            acceptedDiffId = "diff-disjoint",
            filePath = filePath,
            acceptedText = "abcXdefYghi"
        )

        val emission = PostAcceptTracker.onDocumentEdited(
            filePath = filePath,
            currentText = "abcAdefBghi"
        )

        assertNotNull(emission)
        assertEquals(4, emission.meta["charDelta"])
        assertEquals(2, emission.meta["deletedChars"])
        assertEquals(2, emission.meta["insertedChars"])
    }

    @Test
    fun windows_path_matching_is_case_insensitive() {
        if (!runningOnWindows) return

        val unique = System.nanoTime()
        val acceptedPath = "C:\\Workspace\\SignalCode\\$unique\\Src\\CasePath.kt"
        val sameFileEditedPath = "c:/workspace/signalcode/$unique/src/casepath.kt"

        PostAcceptTracker.registerAccepted(
            taskId = "task-case",
            acceptedDiffId = "diff-case",
            filePath = acceptedPath,
            acceptedText = "val x = 1\n"
        )

        val emission = PostAcceptTracker.onDocumentEdited(
            filePath = sameFileEditedPath,
            currentText = "val x = 2\n"
        )

        assertNotNull(emission)
        assertEquals(expectedNormalizedPath(sameFileEditedPath), emission.meta["filePath"])
    }

    private fun expectedNormalizedPath(path: String): String {
        val slashNormalized = path.replace('\\', '/')
        return if (runningOnWindows) slashNormalized.lowercase() else slashNormalized
    }
}
