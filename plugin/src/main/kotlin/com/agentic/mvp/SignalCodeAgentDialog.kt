package com.signalcode.mvp

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import javax.swing.BorderFactory
import javax.swing.DefaultComboBoxModel
import javax.swing.JButton
import javax.swing.JComboBox
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTextArea
import javax.swing.JTextField
import javax.swing.SwingConstants

class SignalCodeAgentDialog(
    project: Project,
    private val context: EditorContextSnapshot,
    promptHistoryService: PromptHistoryService,
    fallbackModels: List<String>,
    defaultModel: String
) : DialogWrapper(project) {
    private val promptField = JTextArea(8, 68).apply {
        lineWrap = true
        wrapStyleWord = true
        border = JBUI.Borders.empty(10)
    }
    private val modelCombo = JComboBox(fallbackModels.toTypedArray()).apply {
        preferredSize = Dimension(240, 30)
        selectedItem = defaultModel
    }
    private val modeCombo = JComboBox(AgentMode.entries.toTypedArray()).apply {
        preferredSize = Dimension(240, 30)
        selectedItem = AgentMode.UPDATE_SELECTION
    }
    private val targetPathField = JTextField().apply {
        columns = 32
        toolTipText = "Path relative to the project root"
    }
    private val historyModel = DefaultComboBoxModel<String>().apply {
        promptHistoryService.recent(MAX_HISTORY).forEach { addElement(it) }
    }
    private val historyCombo = JComboBox(historyModel).apply {
        preferredSize = Dimension(360, 30)
        isEnabled = historyModel.size > 0
    }
    private val helperLabel = JLabel("", SwingConstants.LEFT)
    private val targetHintLabel = JLabel("Path is relative to the project root.")
    private val statusLabel = JLabel("Fetching live models…")
    private val targetRow = JPanel(BorderLayout(8, 0))
    private val submissionButtonLabel = JLabel()
    private val useHistoryButton = JButton("Use")
    private val clearHistoryButton = JButton("Clear history").apply {
        isEnabled = historyModel.size > 0
    }
    private val presetRefactorButton = JButton("Refactor")
    private val presetPlanButton = JButton("Add tests")
    private val presetScaffoldButton = JButton("Scaffold file")

    var submission: AgentDialogSubmission? = null
        private set

    init {
        title = "SignalCode Agent"
        setOKButtonText((modeCombo.selectedItem as AgentMode).buttonLabel)
        init()
        helperLabel.border = JBUI.Borders.emptyTop(2)
        helperLabel.text = (modeCombo.selectedItem as AgentMode).description
        statusLabel.border = JBUI.Borders.emptyTop(2)
        bindActions(promptHistoryService)
        updateModeUi()
        initValidation()
    }

    override fun createCenterPanel(): JComponent {
        val shell = JPanel(BorderLayout(0, 12)).apply {
            preferredSize = Dimension(760, 560)
            border = JBUI.Borders.empty(10, 4)
        }

        val header = JPanel(BorderLayout(12, 0)).apply {
            add(
                JPanel(BorderLayout(0, 4)).apply {
                    add(JLabel("SignalCode Agent").apply {
                        font = font.deriveFont(font.size2D + 2f)
                    }, BorderLayout.NORTH)
                    add(JLabel("Plan code changes before applying them."), BorderLayout.SOUTH)
                },
                BorderLayout.WEST
            )
            add(
                JPanel(BorderLayout()).apply {
                    add(statusLabel, BorderLayout.NORTH)
                    add(submissionButtonLabel, BorderLayout.SOUTH)
                },
                BorderLayout.EAST
            )
        }

        val controls = JPanel().apply {
            layout = javax.swing.BoxLayout(this, javax.swing.BoxLayout.Y_AXIS)
            add(cardPanel("Mode & model", buildModeAndModelPanel()))
            add(JPanel().apply { preferredSize = Dimension(0, 8); maximumSize = preferredSize })
            add(cardPanel("Context", buildContextPanel()))
            add(JPanel().apply { preferredSize = Dimension(0, 8); maximumSize = preferredSize })
            add(cardPanel("Target", buildTargetPanel()))
            add(JPanel().apply { preferredSize = Dimension(0, 8); maximumSize = preferredSize })
            add(cardPanel("Prompt", buildPromptPanel()))
            add(JPanel().apply { preferredSize = Dimension(0, 8); maximumSize = preferredSize })
            add(cardPanel("History", buildHistoryPanel()))
        }

        shell.add(header, BorderLayout.NORTH)
        shell.add(JScrollPane(controls).apply {
            border = BorderFactory.createEmptyBorder()
            horizontalScrollBarPolicy = JScrollPane.HORIZONTAL_SCROLLBAR_NEVER
        }, BorderLayout.CENTER)
        return shell
    }

    override fun doValidate(): ValidationInfo? {
        if (promptField.text.trim().isEmpty()) {
            return ValidationInfo("Describe what the agent should do.", promptField)
        }
        if (modelCombo.itemCount == 0 || !modelCombo.isEnabled) {
            return ValidationInfo("No live model is currently available.", modelCombo)
        }
        if ((modeCombo.selectedItem as AgentMode) == AgentMode.CREATE_FILE && targetPathField.text.trim().isEmpty()) {
            return ValidationInfo("Enter a target file path.", targetPathField)
        }
        return null
    }

    override fun doOKAction() {
        val validation = doValidate()
        if (validation != null) {
            super.doValidate()
            return
        }
        submission = AgentDialogSubmission(
            prompt = promptField.text.trim(),
            model = (modelCombo.selectedItem as? String)?.trim().orEmpty(),
            mode = modeCombo.selectedItem as AgentMode,
            targetFilePath = targetPathField.text.trim().ifEmpty { null }
        )
        super.doOKAction()
    }

    fun updateAvailableModels(models: ModelsResponse, preferredModel: String) {
        val liveModels = models.availableModels
            ?.filter { models.supportedModels.contains(it) }
            ?.distinct()
            .orEmpty()
        val visibleModels = when {
            liveModels.isNotEmpty() -> liveModels
            models.supportedModels.isNotEmpty() -> models.supportedModels
            else -> emptyList()
        }

        modelCombo.removeAllItems()
        visibleModels.forEach { modelCombo.addItem(it) }
        val hasLiveAvailability = models.availableModels != null
        val noLiveModels = hasLiveAvailability && liveModels.isEmpty()
        modelCombo.isEnabled = visibleModels.isNotEmpty() && !noLiveModels
        isOKActionEnabled = !noLiveModels

        statusLabel.text = when {
            noLiveModels -> "No live models available"
            hasLiveAvailability -> "Using live model availability"
            else -> "Using configured model catalog"
        }

        val selection = when {
            visibleModels.contains(preferredModel) -> preferredModel
            visibleModels.contains(models.defaultModel) -> models.defaultModel
            visibleModels.isNotEmpty() -> visibleModels.first()
            else -> null
        }
        if (selection != null) {
            modelCombo.selectedItem = selection
        }
    }

    private fun bindActions(promptHistoryService: PromptHistoryService) {
        modeCombo.addActionListener {
            updateModeUi()
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
        }
        presetRefactorButton.addActionListener {
            promptField.text = "Refactor this code for clarity, naming, and maintainability while preserving behavior."
        }
        presetPlanButton.addActionListener {
            promptField.text = when (modeCombo.selectedItem as AgentMode) {
                AgentMode.UPDATE_SELECTION ->
                    "Update this code and add the missing edge-case handling plus small focused tests if needed."
                AgentMode.INSERT_INTO_FILE ->
                    "Add the missing helper code right after this context and keep the style consistent with the file."
                AgentMode.CREATE_FILE ->
                    "Create a production-ready new file with the required code, imports, and concise comments where useful."
            }
        }
        presetScaffoldButton.addActionListener {
            modeCombo.selectedItem = AgentMode.CREATE_FILE
            if (targetPathField.text.isBlank()) {
                targetPathField.text = suggestTargetPath()
            }
            promptField.text = "Create a new file that scaffolds the feature described by the surrounding code and project conventions."
        }
    }

    private fun updateModeUi() {
        val mode = modeCombo.selectedItem as AgentMode
        helperLabel.text = mode.description
        setOKButtonText(mode.buttonLabel)
        targetRow.isVisible = mode == AgentMode.CREATE_FILE
        targetHintLabel.isVisible = mode == AgentMode.CREATE_FILE
        submissionButtonLabel.text = "Active file: ${context.fileName}"
        if (mode == AgentMode.CREATE_FILE && targetPathField.text.isBlank()) {
            targetPathField.text = suggestTargetPath()
        }
    }

    private fun buildModeAndModelPanel(): JPanel {
        return JPanel(BorderLayout(12, 8)).apply {
            add(
                JPanel(BorderLayout(6, 4)).apply {
                    add(JLabel("Operation"), BorderLayout.NORTH)
                    add(modeCombo, BorderLayout.CENTER)
                },
                BorderLayout.WEST
            )
            add(
                JPanel(BorderLayout(6, 4)).apply {
                    add(JLabel("Model"), BorderLayout.NORTH)
                    add(modelCombo, BorderLayout.CENTER)
                },
                BorderLayout.EAST
            )
            add(helperLabel, BorderLayout.SOUTH)
        }
    }

    private fun buildContextPanel(): JPanel {
        val snippetArea = JTextArea(context.contextSnippet).apply {
            lineWrap = true
            wrapStyleWord = true
            isEditable = false
            rows = 8
            border = JBUI.Borders.empty(10)
        }
        return JPanel(BorderLayout(0, 8)).apply {
            add(JLabel("${context.contextLabel} in ${context.fileName}"), BorderLayout.NORTH)
            add(JScrollPane(snippetArea).apply {
                border = BorderFactory.createLineBorder(UIUtil.getBoundsColor())
            }, BorderLayout.CENTER)
        }
    }

    private fun buildTargetPanel(): JPanel {
        targetRow.add(JLabel("File path"), BorderLayout.WEST)
        targetRow.add(targetPathField, BorderLayout.CENTER)
        return JPanel(BorderLayout(0, 8)).apply {
            add(targetRow, BorderLayout.NORTH)
            add(targetHintLabel, BorderLayout.SOUTH)
        }
    }

    private fun buildPromptPanel(): JPanel {
        val presetRow = JPanel(FlowLayout(FlowLayout.LEFT, 6, 0)).apply {
            add(JLabel("Quick starts"))
            add(presetRefactorButton)
            add(presetPlanButton)
            add(presetScaffoldButton)
        }
        return JPanel(BorderLayout(0, 8)).apply {
            add(presetRow, BorderLayout.NORTH)
            add(JScrollPane(promptField).apply {
                preferredSize = Dimension(680, 170)
                border = BorderFactory.createLineBorder(UIUtil.getBoundsColor())
            }, BorderLayout.CENTER)
        }
    }

    private fun buildHistoryPanel(): JPanel {
        return JPanel(BorderLayout(8, 0)).apply {
            add(historyCombo, BorderLayout.CENTER)
            add(
                JPanel(FlowLayout(FlowLayout.RIGHT, 6, 0)).apply {
                    add(useHistoryButton)
                    add(clearHistoryButton)
                },
                BorderLayout.EAST
            )
        }
    }

    private fun cardPanel(title: String, content: JComponent): JPanel {
        return JPanel(BorderLayout(0, 8)).apply {
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(UIUtil.getBoundsColor()),
                JBUI.Borders.empty(12)
            )
            add(JLabel(title).apply { font = font.deriveFont(font.size2D + 0.5f) }, BorderLayout.NORTH)
            add(content, BorderLayout.CENTER)
        }
    }

    private fun suggestTargetPath(): String = when (context.languageId?.lowercase()) {
        "kotlin" -> "src/main/kotlin/NewAgentFile.kt"
        "java" -> "src/main/java/NewAgentFile.java"
        "typescript" -> "src/new-agent-file.ts"
        "javascript" -> "src/new-agent-file.js"
        "python" -> "new_agent_file.py"
        else -> "src/new-agent-file.txt"
    }

    companion object {
        private const val MAX_HISTORY = 5
    }
}
