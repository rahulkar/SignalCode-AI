package com.signalcode.mvp

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.file.Files
import java.nio.file.Paths

class SignalCodeInlineAction : AnAction("SignalCode AI", "Open SignalCode AI", SignalCodeIcons.Agent) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val backendClient = BackendClient("http://localhost:3001")
    private val requestVersionTracker = RequestVersionTracker()
    private var activeOperation: ActiveOperation? = null
    private var generateJob: Job? = null
    private val promptHistoryService: PromptHistoryService
        get() = service()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val psiFile = e.getData(CommonDataKeys.PSI_FILE) ?: return
        val context = buildContextSnapshot(project, editor, psiFile.virtualFile.path, psiFile.language.id)
        val preferredModel = promptHistoryService.selectedModel(DEFAULT_MODEL)
        val dialog = SignalCodeAgentDialog(
            projectRef = project,
            context = context,
            promptHistoryService = promptHistoryService,
            fallbackModels = FALLBACK_MODELS,
            defaultModel = preferredModel
        )

        scope.launch {
            val modelsResult = runCatching { withContext(Dispatchers.IO) { backendClient.fetchModels() } }
            ApplicationManager.getApplication().invokeLater {
                modelsResult
                    .onSuccess { dialog.updateAvailableModels(it, preferredModel) }
                    .onFailure { dialog.showFallbackCatalogStatus(formatError(it)) }
            }
        }

        if (!dialog.showAndGet()) {
            return
        }

        val submission = dialog.submission ?: return
        promptHistoryService.setSelectedModel(submission.model)
        rememberPrompt(submission.prompt)
        submitPrompt(project, editor, context, submission)
    }

    private fun submitPrompt(
        project: Project,
        editor: Editor,
        context: EditorContextSnapshot,
        submission: AgentDialogSubmission
    ) {
        val requestVersion = requestVersionTracker.next()
        val previous = activeOperation
        if (previous != null) {
            emitTelemetry(
                TelemetryRequest(
                    task_id = previous.taskId,
                    diff_id = previous.diffId,
                    event = TelemetryEventType.ITERATED,
                    meta = previous.meta + mapOf("fileAction" to fileActionFor(previous.operation.kind))
                )
            )
            previous.session?.clear()
            activeOperation = null
        }

        val previousJob = generateJob
        val loadingDialog = SignalCodeLoadingDialog(project, "Generating plan and waiting for backend response...")
        ApplicationManager.getApplication().invokeLater {
            loadingDialog.show()
        }
        generateJob = scope.launch {
            if (previousJob != null && previousJob.isActive) {
                previousJob.cancelAndJoin()
            }
            try {
                val response = withContext(Dispatchers.IO) {
                    backendClient.generate(
                        GenerateRequest(
                            prompt = submission.prompt,
                            model = submission.model,
                            mode = submission.mode.apiValue,
                            context = GenerateContext(
                                filePath = context.filePath,
                                projectRootPath = context.projectRootPath,
                                targetFilePath = submission.targetFilePath,
                                selectionOrCaretSnippet = context.contextSnippet,
                                languageId = context.languageId
                            )
                        )
                    )
                }
                if (response.model != submission.model) {
                    notify(
                        project,
                        "Selected model '${submission.model}' was unavailable. Used '${response.model}' instead.",
                        NotificationType.INFORMATION
                    )
                }

                val operation = response.operation
                val meta = buildOperationMeta(context, submission, operation, response.usage)
                val previewMetrics = buildPreviewMetrics(editor.document.text, context.filePath, operation)
                val session = renderPreviewSession(editor, context.filePath, operation)

                ApplicationManager.getApplication().invokeLater {
                    if (!requestVersionTracker.isCurrent(requestVersion)) {
                        session?.clear()
                        return@invokeLater
                    }
                    activeOperation = ActiveOperation(
                        taskId = response.task_id,
                        diffId = response.diff_id,
                        operation = operation,
                        session = session,
                        meta = meta,
                        usage = response.usage
                    )
                    emitTelemetry(
                        TelemetryRequest(
                            task_id = response.task_id,
                            diff_id = response.diff_id,
                            event = TelemetryEventType.DIFF_RENDERED,
                            meta = meta
                                .plus(mapOf("fileAction" to fileActionFor(operation.kind)))
                                .plus(previewMetrics?.toMeta().orEmpty())
                        )
                    )
                    showPreviewDialog(project, editor, context)
                }
            } catch (error: Throwable) {
                notify(project, "Generate failed: ${formatError(error)}", NotificationType.ERROR)
            } finally {
                ApplicationManager.getApplication().invokeLater {
                    loadingDialog.close()
                }
            }
        }
    }

    private fun showPreviewDialog(project: Project, editor: Editor, context: EditorContextSnapshot) {
        val active = activeOperation ?: return
        val accepted = SignalCodePlanPreviewDialog(project, active.operation, active.usage).showAndGet()
        if (activeOperation?.diffId != active.diffId) {
            active.session?.clear()
            return
        }

        if (!accepted) {
            active.session?.clear()
            emitTelemetry(
                TelemetryRequest(
                    task_id = active.taskId,
                    diff_id = active.diffId,
                    event = TelemetryEventType.REJECTED,
                    meta = active.meta + mapOf("fileAction" to fileActionFor(active.operation.kind))
                )
            )
            activeOperation = null
            return
        }

        val applyResult = applyOperation(project, editor, context, active)
        if (!applyResult.success) {
            active.session?.clear()
            emitTelemetry(
                TelemetryRequest(
                    task_id = active.taskId,
                    diff_id = active.diffId,
                    event = TelemetryEventType.REJECTED,
                    meta = active.meta + mapOf(
                        "fileAction" to fileActionFor(active.operation.kind),
                        "applyFailed" to true,
                        "applyError" to applyResult.message
                    )
                )
            )
            notify(project, applyResult.message, NotificationType.WARNING)
            activeOperation = null
            return
        }

        val acceptedText = readAcceptedText(editor, context.filePath, applyResult.targetFilePath, active.operation)
        val acceptedMetrics = acceptedText?.let { DocumentMetrics.fromText(it) }
        if (!acceptedText.isNullOrBlank()) {
            PostAcceptTracker.registerAccepted(
                taskId = active.taskId,
                acceptedDiffId = active.diffId,
                filePath = applyResult.targetFilePath,
                acceptedText = acceptedText
            )
        }
        emitTelemetry(
            TelemetryRequest(
                task_id = active.taskId,
                diff_id = active.diffId,
                event = TelemetryEventType.ACCEPTED,
                meta = active.meta
                    .plus(mapOf("fileAction" to fileActionFor(active.operation.kind)))
                    .plus(acceptedMetrics?.toMeta().orEmpty())
            )
        )
        notify(project, applyResult.message, NotificationType.INFORMATION)
        activeOperation = null
    }

    private fun applyOperation(
        project: Project,
        editor: Editor,
        context: EditorContextSnapshot,
        active: ActiveOperation
    ): ApplyResult {
        val operation = active.operation
        val targetsCurrentFile = samePath(operation.targetFilePath, context.filePath)
        if (targetsCurrentFile && active.session != null) {
            val applied = when (operation.kind) {
                "replace_range" -> active.session.accept(project, operation.search.orEmpty(), operation.replace.orEmpty())
                "insert_after" -> active.session.acceptInsert(project, operation.anchor.orEmpty(), operation.content.orEmpty())
                else -> false
            }
            if (applied) {
                return ApplyResult(true, successMessage(operation.kind, operation.targetFilePath), context.filePath)
            }
        }
        return AgentOperationApplier.apply(project, operation, context.filePath)
    }

    private fun renderPreviewSession(editor: Editor, currentFilePath: String, operation: AgentOperation): InlineDiffSession? {
        if (!samePath(currentFilePath, operation.targetFilePath)) {
            return null
        }
        val session = InlineDiffSession(editor)
        val rendered = when (operation.kind) {
            "replace_range" -> session.render(operation.search.orEmpty(), operation.replace.orEmpty())
            "insert_after" -> session.renderInsert(operation.anchor.orEmpty())
            else -> false
        }
        return if (rendered) session else null
    }

    private fun buildContextSnapshot(
        project: Project,
        editor: Editor,
        filePath: String,
        languageId: String?
    ): EditorContextSnapshot {
        val hasSelection = editor.selectionModel.hasSelection()
        val contextSnippet = if (hasSelection) {
            editor.selectionModel.selectedText.orEmpty()
        } else {
            nearbySnippet(editor)
        }
        return EditorContextSnapshot(
            contextSnippet = contextSnippet,
            contextLabel = if (hasSelection) "Selected code" else "Nearby code context",
            filePath = filePath,
            languageId = languageId,
            fileName = File(filePath).name,
            projectRootPath = project.basePath
        )
    }

    private fun nearbySnippet(editor: Editor): String {
        val document = editor.document
        val currentLine = document.getLineNumber(editor.caretModel.offset)
        val startLine = (currentLine - 4).coerceAtLeast(0)
        val endLine = (currentLine + 4).coerceAtMost(document.lineCount - 1)
        val startOffset = document.getLineStartOffset(startLine)
        val endOffset = document.getLineEndOffset(endLine)
        return document.getText(TextRange(startOffset, endOffset))
    }

    private fun buildOperationMeta(
        context: EditorContextSnapshot,
        submission: AgentDialogSubmission,
        operation: AgentOperation,
        usage: UsageMetrics?
    ): Map<String, Any> {
        val generatedText = when (operation.kind) {
            "replace_range" -> operation.replace.orEmpty()
            "insert_after", "create_file" -> operation.content.orEmpty()
            else -> ""
        }
        return mapOf(
            "workflow" to "agentic-intellij",
            "mode" to submission.mode.apiValue,
            "operationKind" to operation.kind,
            "filePath" to operation.targetFilePath,
            "languageId" to (context.languageId ?: "unknown"),
            "promptChars" to submission.prompt.length,
            "contextChars" to context.contextSnippet.length,
            "generatedChars" to generatedText.length,
            "generatedLines" to lineCount(generatedText),
            "targetFileProvided" to !submission.targetFilePath.isNullOrBlank()
        ) + usage.toMeta()
    }

    private fun buildPreviewMetrics(
        currentDocumentText: String,
        currentFilePath: String,
        operation: AgentOperation
    ): DocumentMetrics? {
        return when (operation.kind) {
            "replace_range" -> {
                if (!samePath(currentFilePath, operation.targetFilePath)) {
                    null
                } else {
                    buildRenderedDocumentMetrics(currentDocumentText, operation.search.orEmpty(), operation.replace.orEmpty())
                }
            }
            "insert_after" -> {
                if (!samePath(currentFilePath, operation.targetFilePath)) {
                    null
                } else {
                    buildInsertPreviewMetrics(currentDocumentText, operation.anchor.orEmpty(), operation.content.orEmpty())
                }
            }
            "create_file" -> DocumentMetrics.fromText(operation.content.orEmpty())
            else -> null
        }
    }

    private fun readAcceptedText(
        editor: Editor,
        currentFilePath: String,
        targetFilePath: String,
        operation: AgentOperation
    ): String? {
        if (samePath(currentFilePath, targetFilePath)) {
            return editor.document.text
        }
        if (operation.kind == "create_file") {
            return operation.content
        }
        return runCatching {
            val target = Paths.get(targetFilePath)
            if (Files.exists(target)) Files.readString(target) else null
        }.getOrNull()
    }

    private fun samePath(left: String, right: String): Boolean = runCatching {
        Paths.get(left).normalize() == Paths.get(right).normalize()
    }.getOrDefault(left == right)

    private fun emitTelemetry(request: TelemetryRequest) {
        scope.launch(Dispatchers.IO) {
            runCatching { backendClient.telemetry(request) }
        }
    }

    private fun notify(project: Project, content: String, type: NotificationType) {
        ApplicationManager.getApplication().invokeLater {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("SignalCodeNotifications")
                .createNotification(content, type)
                .notify(project)
        }
    }

    private fun rememberPrompt(prompt: String) {
        promptHistoryService.remember(prompt, MAX_HISTORY)
    }

    private fun successMessage(kind: String, targetFilePath: String): String = when (kind) {
        "insert_after" -> "Added code to ${File(targetFilePath).name}"
        "create_file" -> "Created ${File(targetFilePath).name}"
        else -> "Updated ${File(targetFilePath).name}"
    }

    private fun fileActionFor(kind: String): String = when (kind) {
        "create_file" -> "created"
        else -> "edited"
    }

    private fun formatError(error: Throwable): String {
        val root = generateSequence(error) { it.cause }.lastOrNull() ?: error
        return root.message ?: root::class.java.simpleName
    }

    companion object {
        private const val MAX_HISTORY = 5
        private const val DEFAULT_MODEL = "gemini-flash"
        private val FALLBACK_MODELS = listOf(
            "gemini-flash",
            "gemini-2.5-flash",
            "gemini-2.5-flash-lite",
            "gemini-2.5-pro",
            "gemini-3-flash-preview",
            "gemini-3.1-pro-preview"
        )
    }
}

private data class DocumentMetrics(
    val acceptedChars: Int,
    val acceptedLines: Int
) {
    fun toMeta(): Map<String, Any> = mapOf(
        "acceptedChars" to acceptedChars,
        "acceptedLines" to acceptedLines
    )

    companion object {
        fun fromText(text: String): DocumentMetrics = DocumentMetrics(
            acceptedChars = text.length,
            acceptedLines = lineCount(text)
        )
    }
}

private fun buildRenderedDocumentMetrics(documentText: String, search: String, replace: String): DocumentMetrics? {
    val start = documentText.indexOf(search)
    if (start < 0) return null
    val previewText = buildString(documentText.length - search.length + replace.length) {
        append(documentText, 0, start)
        append(replace)
        append(documentText, start + search.length, documentText.length)
    }
    return DocumentMetrics.fromText(previewText)
}

private fun buildInsertPreviewMetrics(documentText: String, anchor: String, insertedContent: String): DocumentMetrics? {
    val start = documentText.indexOf(anchor)
    if (start < 0) return null
    val insertOffset = start + anchor.length
    val separator = when {
        insertedContent.isEmpty() -> ""
        anchor.endsWith("\n") || insertedContent.startsWith("\n") -> ""
        else -> "\n"
    }
    val previewText = buildString(documentText.length + separator.length + insertedContent.length) {
        append(documentText, 0, insertOffset)
        append(separator)
        append(insertedContent)
        append(documentText, insertOffset, documentText.length)
    }
    return DocumentMetrics.fromText(previewText)
}

private fun lineCount(text: String): Int {
    if (text.isEmpty()) return 0
    return text.count { it == '\n' } + 1
}

private data class ActiveOperation(
    val taskId: String,
    val diffId: String,
    val operation: AgentOperation,
    val session: InlineDiffSession?,
    val meta: Map<String, Any>,
    val usage: UsageMetrics?
)

private fun UsageMetrics?.toMeta(): Map<String, Any> {
    if (this == null) return emptyMap()
    val meta = mutableMapOf<String, Any>()
    promptTokens?.let { meta["promptTokens"] = it }
    completionTokens?.let { meta["completionTokens"] = it }
    totalTokens?.let { meta["totalTokens"] = it }
    costUsd?.let { meta["costUsd"] = it }
    return meta
}
