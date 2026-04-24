package com.signalcode.mvp

import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManagerEvent
import com.intellij.openapi.fileEditor.FileEditorManagerListener
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.StartupActivity
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileCreateEvent
import com.intellij.util.concurrency.AppExecutorUtil
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

class IdeTelemetryStartupActivity : StartupActivity.DumbAware {
    override fun runActivity(project: Project) {
        val backendClient = BackendClient("http://localhost:3001")
        val emitter = IdeTelemetryEmitter(project, backendClient)

        val connection = project.messageBus.connect(project)
        connection.subscribe(
            FileEditorManagerListener.FILE_EDITOR_MANAGER,
            object : FileEditorManagerListener {
                override fun selectionChanged(event: FileEditorManagerEvent) {
                    val file = event.newFile ?: return
                    emitter.emit("opened", file.path, file.extension ?: "unknown")
                }
            }
        )

        connection.subscribe(
            VirtualFileManager.VFS_CHANGES,
            object : BulkFileListener {
                override fun after(events: List<com.intellij.openapi.vfs.newvfs.events.VFileEvent>) {
                    events.filterIsInstance<VFileCreateEvent>().forEach { created ->
                        val file = created.file ?: return@forEach
                        emitter.emit("created", file.path, file.extension ?: "unknown")
                    }
                }
            }
        )

        com.intellij.openapi.editor.EditorFactory
            .getInstance()
            .eventMulticaster
            .addDocumentListener(
                object : DocumentListener {
                    override fun documentChanged(event: DocumentEvent) {
                        val file = FileDocumentManager.getInstance().getFile(event.document) ?: return
                        emitter.emitThrottledEdit(file.path, file.extension ?: "unknown")
                        val postAccept = PostAcceptTracker.onDocumentEdited(file.path, event.document.text)
                        if (postAccept != null) {
                            emitter.emitPostAccept(postAccept)
                        }
                    }
                },
                project
            )

        AppExecutorUtil.getAppScheduledExecutorService().scheduleWithFixedDelay(
            { emitter.emitHeartbeat() },
            15,
            15,
            TimeUnit.SECONDS
        )
    }
}

private class IdeTelemetryEmitter(
    private val project: Project,
    private val backendClient: BackendClient
) {
    private val editLastSentAt = ConcurrentHashMap<String, Long>()
    private val monitorTaskId = "ide-monitor-${project.locationHash}"

    fun emitHeartbeat() {
        emitWithMeta(
            activityType = "heartbeat",
            filePath = null,
            languageId = null
        )
    }

    fun emit(activityType: String, filePath: String, languageId: String) {
        emitWithMeta(activityType, filePath, languageId)
    }

    fun emitThrottledEdit(filePath: String, languageId: String) {
        val now = System.currentTimeMillis()
        val previous = editLastSentAt[filePath] ?: 0L
        if (now - previous < 10_000) {
            return
        }
        editLastSentAt[filePath] = now
        emitWithMeta("edited", filePath, languageId)
    }

    fun emitPostAccept(emission: PostAcceptEmission) {
        runCatching {
            backendClient.telemetry(
                TelemetryRequest(
                    task_id = emission.taskId,
                    diff_id = UUID.randomUUID().toString(),
                    event = TelemetryEventType.DIFF_RENDERED,
                    meta = emission.meta
                )
            )
        }
    }

    private fun emitWithMeta(activityType: String, filePath: String?, languageId: String?) {
        runCatching {
            val meta = mutableMapOf<String, Any>(
                "source" to "ide-monitor",
                "activityType" to activityType
            )
            if (!filePath.isNullOrBlank()) {
                meta["filePath"] = filePath
            }
            if (!languageId.isNullOrBlank()) {
                meta["languageId"] = languageId
            }
            backendClient.telemetry(
                TelemetryRequest(
                    task_id = monitorTaskId,
                    diff_id = UUID.randomUUID().toString(),
                    event = TelemetryEventType.DIFF_RENDERED,
                    meta = meta
                )
            )
        }
    }
}
