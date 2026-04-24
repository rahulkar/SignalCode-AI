package com.signalcode.mvp

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.util.SystemInfo
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.util.TextRange
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.awt.Color
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.io.File
import javax.swing.AbstractAction
import javax.swing.DefaultComboBoxModel
import javax.swing.JButton
import javax.swing.JComboBox
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTextArea
import javax.swing.KeyStroke
import javax.swing.SwingConstants
import javax.swing.border.EmptyBorder

class SignalCodeInlineAction : AnAction() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val backendClient = BackendClient("http://localhost:3001")
    private val requestVersionTracker = RequestVersionTracker()
    private var activeDiff: ActiveDiff? = null
    private var generateJob: Job? = null
    private val modelName = "gemini-flash"
    private val promptHistoryService: PromptHistoryService
        get() = service()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val psiFile = e.getData(CommonDataKeys.PSI_FILE) ?: return

        val contextSnippet = selectedOrCurrentLine(editor)
        val promptField = JTextArea(4, 56).apply {
            lineWrap = true
            wrapStyleWord = true
            border = EmptyBorder(8, 10, 8, 10)
        }
        val promptScroller = JScrollPane(promptField).apply {
            preferredSize = Dimension(560, 100)
        }

        val submitButton = JButton("Generate")
        val clearButton = JButton("Clear")
        val historyModel = DefaultComboBoxModel<String>()
        promptHistoryService.recent(MAX_HISTORY).forEach { historyModel.addElement(it) }
        val historyCombo = JComboBox(historyModel).apply {
            preferredSize = Dimension(320, 28)
            isEnabled = historyModel.size > 0
            toolTipText = "Recent prompts"
        }
        val useHistoryButton = JButton("Use")
        val clearHistoryButton = JButton("Clear History").apply {
            isEnabled = historyModel.size > 0
        }
        val presetRefactorButton = JButton("Refactor")
        val presetExplainButton = JButton("Explain")
        val presetOptimizeButton = JButton("Optimize")
        val titleLabel = JLabel("SignalCode AI", SwingConstants.LEFT).apply {
            font = font.deriveFont(15f)
        }
        val helperLabel = JLabel("Ctrl/Cmd+Enter to generate, Esc to close").apply {
            foreground = Color(130, 130, 130)
        }
        val contextLabel = JLabel(
            if (editor.selectionModel.hasSelection()) "Using selection context" else "Using current line context"
        ).apply {
            foreground = Color(110, 110, 110)
        }

        val topRow = JPanel(BorderLayout()).apply {
            add(titleLabel, BorderLayout.WEST)
            add(contextLabel, BorderLayout.EAST)
        }
        val presetRow = JPanel(FlowLayout(FlowLayout.LEFT, 6, 0)).apply {
            add(JLabel("Presets:"))
            add(presetRefactorButton)
            add(presetExplainButton)
            add(presetOptimizeButton)
        }
        val historyRow = JPanel(FlowLayout(FlowLayout.LEFT, 6, 0)).apply {
            add(JLabel("History:"))
            add(historyCombo)
            add(useHistoryButton)
            add(clearHistoryButton)
        }
        val promptArea = JPanel(BorderLayout(0, 6)).apply {
            add(presetRow, BorderLayout.NORTH)
            add(promptScroller, BorderLayout.CENTER)
            add(historyRow, BorderLayout.SOUTH)
        }
        val actionRow = JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0)).apply {
            add(clearButton)
            add(submitButton)
        }
        val targetLabel = JLabel(
            "Target: ${File(psiFile.virtualFile.path).name}  |  Model: $modelName"
        ).apply {
            foreground = Color(115, 115, 115)
        }
        val panel = JPanel(BorderLayout(0, 8)).apply {
            border = EmptyBorder(10, 12, 10, 12)
            add(topRow, BorderLayout.NORTH)
            add(promptArea, BorderLayout.CENTER)
            add(
                JPanel(BorderLayout()).apply {
                    add(
                        JPanel(BorderLayout()).apply {
                            add(helperLabel, BorderLayout.NORTH)
                            add(targetLabel, BorderLayout.SOUTH)
                        },
                        BorderLayout.WEST
                    )
                    add(actionRow, BorderLayout.EAST)
                },
                BorderLayout.SOUTH
            )
        }

        val popup = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(panel, promptField)
            .setRequestFocus(true)
            .setFocusable(true)
            .setCancelOnClickOutside(true)
            .setTitle("Inline Edit")
            .createPopup()
        popup.showInBestPositionFor(editor)
        promptField.requestFocusInWindow()

        val submitAction = submit@{
            val prompt = promptField.text.trim()
            if (prompt.isEmpty()) {
                return@submit
            }
            submitButton.isEnabled = false
            submitButton.text = "Generating..."
            popup.cancel()
            rememberPrompt(prompt)
            submitPrompt(project, editor, prompt, psiFile.virtualFile.path, psiFile.language.id, contextSnippet)
        }

        submitButton.addActionListener {
            submitAction()
        }

        clearButton.addActionListener {
            promptField.text = ""
            promptField.requestFocusInWindow()
        }
        useHistoryButton.addActionListener {
            val selected = historyCombo.selectedItem as? String ?: return@addActionListener
            promptField.text = selected
            promptField.requestFocusInWindow()
        }
        clearHistoryButton.addActionListener {
            promptHistoryService.clear()
            historyModel.removeAllElements()
            historyCombo.isEnabled = false
            useHistoryButton.isEnabled = false
            clearHistoryButton.isEnabled = false
            promptField.requestFocusInWindow()
        }
        presetRefactorButton.addActionListener {
            applyPreset(promptField, "Refactor this code for readability and maintainability while preserving behavior.")
        }
        presetExplainButton.addActionListener {
            applyPreset(promptField, "Explain this code with concise comments and rename unclear identifiers for clarity.")
        }
        presetOptimizeButton.addActionListener {
            applyPreset(promptField, "Optimize this code for performance and simplify unnecessary work without changing behavior.")
        }

        val commandMask = if (SystemInfo.isMac) "meta ENTER" else "control ENTER"
        val submitKey = KeyStroke.getKeyStroke(commandMask)
        promptField.inputMap.put(submitKey, "signalcode.submit")
        promptField.actionMap.put(
            "signalcode.submit",
            object : AbstractAction() {
                override fun actionPerformed(_e: java.awt.event.ActionEvent?) {
                    submitAction()
                }
            }
        )
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

    private fun applyPreset(promptField: JTextArea, text: String) {
        promptField.text = text
        promptField.requestFocusInWindow()
    }

    private fun rememberPrompt(prompt: String) {
        promptHistoryService.remember(prompt, MAX_HISTORY)
    }

    companion object {
        private const val MAX_HISTORY = 5
    }
}

private data class ActiveDiff(
    val taskId: String,
    val diffId: String,
    val search: String,
    val replace: String,
    val session: InlineDiffSession
)
