package com.signalcode.mvp

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

class PostAcceptTrackerTest {
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
        assertEquals(editedPath, emission.meta["filePath"])
        assertEquals(1, emission.meta["editsAfterAccept"])
        assertEquals(2, emission.meta["charDelta"])
    }
}
