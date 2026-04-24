package com.signalcode.mvp

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.util.TextRange
import com.intellij.ui.components.JBTextField
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JPanel

class SignalCodeInlineAction : AnAction() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val backendClient = BackendClient("http://localhost:3001")
    private val requestVersionTracker = RequestVersionTracker()
    private var activeDiff: ActiveDiff? = null
    private var generateJob: Job? = null

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val psiFile = e.getData(CommonDataKeys.PSI_FILE) ?: return

        val contextSnippet = selectedOrCurrentLine(editor)
        val promptField = JBTextField()
        promptField.emptyText.text = "Describe your change..."
        promptField.preferredSize = Dimension(420, 32)

        val submitButton = JButton("Generate")
        val panel = JPanel(BorderLayout(8, 0)).apply {
            add(JLabel("SignalCode AI Prompt"), BorderLayout.WEST)
            add(promptField, BorderLayout.CENTER)
            add(submitButton, BorderLayout.EAST)
        }

        val popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(panel, promptField)
            .setRequestFocus(true)
            .setFocusable(true)
            .setCancelOnClickOutside(true)
            .setTitle("Inline Edit")
            .createPopup()
        popup.showInBestPositionFor(editor)

        submitButton.addActionListener {
            val prompt = promptField.text.trim()
            if (prompt.isEmpty()) {
                return@addActionListener
            }
            popup.cancel()
            submitPrompt(project, editor, prompt, psiFile.virtualFile.path, psiFile.language.id, contextSnippet)
        }
    }

    private fun submitPrompt(
        project: com.intellij.openapi.project.Project,
        editor: Editor,
        prompt: String,
        filePath: String,
        languageId: String?,
        snippet: String
    ) {
        val requestVersion = requestVersionTracker.next()

        val previous = activeDiff
        if (previous != null) {
            scope.launch(Dispatchers.IO) {
                runCatching {
                    backendClient.telemetry(
                        TelemetryRequest(
                            task_id = previous.taskId,
                            diff_id = previous.diffId,
                            event = TelemetryEventType.ITERATED
                        )
                    )
                }
            }
            previous.session.clear()
            activeDiff = null
        }

        val previousJob = generateJob
        generateJob = scope.launch {
            if (previousJob != null && previousJob.isActive) {
                previousJob.cancelAndJoin()
            }
            try {
                val response = withContext(Dispatchers.IO) {
                    backendClient.generate(
                        GenerateRequest(
                            prompt = prompt,
                            context = GenerateContext(
                                filePath = filePath,
                                selectionOrCaretSnippet = snippet,
                                languageId = languageId
                            )
                        )
                    )
                }
                val parsed = DiffParser.parse(response.raw)
                if (parsed == null) {
                    notify(project, "Model response was not valid SEARCH/REPLACE.", NotificationType.WARNING)
                    return@launch
                }
                ApplicationManager.getApplication().invokeLater {
                    if (!requestVersionTracker.isCurrent(requestVersion)) {
                        return@invokeLater
                    }
                    val session = InlineDiffSession(editor)
                    val rendered = session.render(parsed.search, parsed.replace)
                    if (!rendered) {
                        notify(project, "Could not locate SEARCH block in document.", NotificationType.WARNING)
                        return@invokeLater
                    }
                    activeDiff = ActiveDiff(response.task_id, response.diff_id, parsed.search, parsed.replace, session)
                    showAcceptRejectPopup(project, editor, activeDiff!!)
                    scope.launch(Dispatchers.IO) {
                        runCatching {
                            backendClient.telemetry(
                                TelemetryRequest(
                                    task_id = response.task_id,
                                    diff_id = response.diff_id,
                                    event = TelemetryEventType.DIFF_RENDERED
                                )
                            )
                        }
                    }
                }
            } catch (error: Throwable) {
                notify(project, "Generate failed: ${formatError(error)}", NotificationType.ERROR)
            }
        }
    }

    private fun showAcceptRejectPopup(
        project: com.intellij.openapi.project.Project,
        editor: Editor,
        diff: ActiveDiff
    ) {
        val acceptButton = JButton("Accept")
        val rejectButton = JButton("Reject")
        val panel = JPanel().apply {
            add(acceptButton)
            add(rejectButton)
        }
        val popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(panel, acceptButton)
            .setRequestFocus(false)
            .setFocusable(false)
            .setCancelOnClickOutside(false)
            .setTitle("Apply AI Diff")
            .createPopup()
        popup.showInBestPositionFor(editor)

        acceptButton.addActionListener {
            if (activeDiff?.diffId != diff.diffId) {
                popup.cancel()
                return@addActionListener
            }
            val applied = diff.session.accept(project, diff.search, diff.replace)
            if (applied) {
                scope.launch(Dispatchers.IO) {
                    runCatching {
                        backendClient.telemetry(
                            TelemetryRequest(diff.taskId, diff.diffId, TelemetryEventType.ACCEPTED)
                        )
                    }
                }
            }
            popup.cancel()
            activeDiff = null
        }

        rejectButton.addActionListener {
            if (activeDiff?.diffId != diff.diffId) {
                popup.cancel()
                return@addActionListener
            }
            diff.session.clear()
            scope.launch(Dispatchers.IO) {
                runCatching {
                    backendClient.telemetry(
                        TelemetryRequest(diff.taskId, diff.diffId, TelemetryEventType.REJECTED)
                    )
                }
            }
            popup.cancel()
            activeDiff = null
        }
    }

    private fun selectedOrCurrentLine(editor: Editor): String {
        val selectionModel = editor.selectionModel
        if (selectionModel.hasSelection()) {
            return selectionModel.selectedText ?: ""
        }
        val line = editor.document.getLineNumber(editor.caretModel.offset)
        val startOffset = editor.document.getLineStartOffset(line)
        val endOffset = editor.document.getLineEndOffset(line)
        return editor.document.getText(TextRange(startOffset, endOffset))
    }

    private fun notify(project: com.intellij.openapi.project.Project, content: String, type: NotificationType) {
        ApplicationManager.getApplication().invokeLater {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("SignalCodeNotifications")
                .createNotification(content, type)
                .notify(project)
        }
    }

    private fun formatError(error: Throwable): String {
        val root = generateSequence(error) { it.cause }.lastOrNull() ?: error
        return root.message ?: root::class.java.simpleName
    }
}

private data class ActiveDiff(
    val taskId: String,
    val diffId: String,
    val search: String,
    val replace: String,
    val session: InlineDiffSession
)
