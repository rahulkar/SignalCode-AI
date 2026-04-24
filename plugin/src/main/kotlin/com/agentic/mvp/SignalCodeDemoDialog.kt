package com.signalcode.mvp

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import javax.swing.BorderFactory
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTextArea
import javax.swing.SwingConstants

class SignalCodeDemoDialog(
    private val projectRef: Project,
    private val selectedModel: String
) : DialogWrapper(projectRef) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val logArea = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        rows = 16
        border = JBUI.Borders.empty(10)
    }
    private val startDemoButton = JButton("Run live demo").apply {
        icon = SignalCodeIcons.Demo
    }
    private val statusLabel = JLabel(
        "Ready to generate a real Java calculator demo in an empty IntelliJ folder with $selectedModel.",
        SignalCodeIcons.ModeModel,
        SwingConstants.LEFT
    )
    private var isRunning = false

    init {
        title = "Executive demo mode"
        setOKButtonText("Close")
        init()
        bindActions()
        appendLog("This mode uses the live backend, real model calls, and real telemetry.")
        appendLog("Open an empty IntelliJ folder first, then make sure the backend, LiteLLM, and Telemetry Command Center are already running.")
    }

    override fun createCenterPanel(): JComponent {
        val shell = JPanel(BorderLayout(0, 12)).apply {
            preferredSize = Dimension(860, 760)
            border = JBUI.Borders.empty(10, 4)
        }

        val header = JPanel(BorderLayout(12, 0)).apply {
            add(
                JPanel(BorderLayout(0, 4)).apply {
                    add(
                        JLabel("Executive demo mode", SignalCodeIcons.Demo, SwingConstants.LEFT).apply {
                            font = font.deriveFont(font.size2D + 2f)
                            iconTextGap = JBUI.scale(8)
                        },
                        BorderLayout.NORTH
                    )
                    add(
                        JLabel("Autonomously builds a Java calculator MVP in the current empty IntelliJ project and streams real telemetry to the dashboard."),
                        BorderLayout.SOUTH
                    )
                },
                BorderLayout.WEST
            )
            add(
                JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0)).apply {
                    add(chip("Model: $selectedModel", SignalCodeIcons.ModeModel))
                    add(chip("Real backend", SignalCodeIcons.Agent))
                    add(chip("Telemetry on", SignalCodeIcons.Dashboard))
                },
                BorderLayout.EAST
            )
        }

        val content = JPanel().apply {
            layout = javax.swing.BoxLayout(this, javax.swing.BoxLayout.Y_AXIS)
            add(sectionCard("What this run does", SignalCodeIcons.Inspect, buildPlanPanel()))
            add(spacer())
            add(sectionCard("Execution log", SignalCodeIcons.History, buildLogPanel()))
        }

        shell.add(header, BorderLayout.NORTH)
        shell.add(
            JScrollPane(content).apply {
                border = BorderFactory.createEmptyBorder()
                horizontalScrollBarPolicy = JScrollPane.HORIZONTAL_SCROLLBAR_NEVER
            },
            BorderLayout.CENTER
        )
        return shell
    }

    private fun bindActions() {
        startDemoButton.addActionListener {
            if (isRunning) {
                return@addActionListener
            }
            isRunning = true
            startDemoButton.isEnabled = false
            statusLabel.text = "Running live demo with $selectedModel..."
            appendLog("Starting live demo run in ${projectRef.basePath ?: "unknown project root"}")

            scope.launch {
                val orchestrator = SignalCodeDemoOrchestrator(
                    project = projectRef,
                    model = selectedModel
                ) { message ->
                    appendLog(message)
                }

                runCatching { orchestrator.run() }
                    .onSuccess { summary ->
                        ApplicationManager.getApplication().invokeLater {
                            isRunning = false
                            startDemoButton.isEnabled = true
                            statusLabel.text = "Live demo completed: ${summary.completedSteps} steps across ${summary.touchedFiles.size} files."
                            notify(
                                "Live demo completed across ${summary.touchedFiles.size} files. Refresh the Telemetry Command Center to view the results.",
                                NotificationType.INFORMATION
                            )
                        }
                    }
                    .onFailure { error ->
                        ApplicationManager.getApplication().invokeLater {
                            isRunning = false
                            startDemoButton.isEnabled = true
                            statusLabel.text = "Demo failed: ${error.message ?: error::class.java.simpleName}"
                            notify("Live demo failed: ${error.message ?: error::class.java.simpleName}", NotificationType.ERROR)
                        }
                    }
            }
        }
    }

    private fun buildPlanPanel(): JPanel {
        val body = JTextArea(
            """
            1. Confirm the current IntelliJ folder is effectively empty so the executive walkthrough starts from zero.
            2. Create a small Java calculator project structure in that folder.
            3. Use the actual generate API and selected model to create multiple production-style files.
            4. Apply one real patch to an existing file so the run includes both new-file generation and update-style work.
            5. Make follow-up local edits after acceptance to mimic human tweaks and trigger post-accept telemetry.
            6. Feed the full story into Telemetry Command Center: generated tasks, accepts, created files, edited files, and post-accept rework.
            """.trimIndent()
        ).apply {
            isEditable = false
            isOpaque = false
            lineWrap = true
            wrapStyleWord = true
            border = BorderFactory.createEmptyBorder()
        }

        return JPanel(BorderLayout(0, 10)).apply {
            add(body, BorderLayout.NORTH)
            add(
                JPanel(BorderLayout(0, 8)).apply {
                    add(statusLabel, BorderLayout.NORTH)
                    add(
                        JPanel(FlowLayout(FlowLayout.LEFT, 0, 0)).apply {
                            add(startDemoButton)
                        },
                        BorderLayout.SOUTH
                    )
                },
                BorderLayout.CENTER
            )
        }
    }

    private fun buildLogPanel(): JPanel {
        return JPanel(BorderLayout(0, 8)).apply {
            add(
                JLabel("The log below updates as each LLM step and local follow-up edit completes."),
                BorderLayout.NORTH
            )
            add(
                JScrollPane(logArea).apply {
                    preferredSize = Dimension(760, 360)
                    border = BorderFactory.createLineBorder(UIUtil.getBoundsColor())
                },
                BorderLayout.CENTER
            )
        }
    }

    private fun sectionCard(title: String, icon: javax.swing.Icon, content: JComponent): JPanel {
        return JPanel(BorderLayout(0, 8)).apply {
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(UIUtil.getBoundsColor()),
                JBUI.Borders.empty(12)
            )
            add(
                JLabel(title, icon, SwingConstants.LEFT).apply {
                    font = font.deriveFont(font.size2D + 0.5f)
                    iconTextGap = JBUI.scale(8)
                },
                BorderLayout.NORTH
            )
            add(content, BorderLayout.CENTER)
        }
    }

    private fun chip(text: String, icon: javax.swing.Icon): JPanel {
        return JPanel(BorderLayout()).apply {
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(UIUtil.getBoundsColor()),
                JBUI.Borders.empty(6, 8)
            )
            add(
                JLabel(text, icon, SwingConstants.LEFT).apply {
                    iconTextGap = JBUI.scale(6)
                },
                BorderLayout.CENTER
            )
        }
    }

    private fun spacer(): JPanel {
        return JPanel().apply {
            preferredSize = Dimension(0, 8)
            maximumSize = preferredSize
        }
    }

    private fun appendLog(message: String) {
        ApplicationManager.getApplication().invokeLater {
            if (logArea.text.isNotBlank()) {
                logArea.append("\n")
            }
            logArea.append(message)
            logArea.caretPosition = logArea.document.length
        }
    }

    private fun notify(content: String, type: NotificationType) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup("SignalCodeNotifications")
            .createNotification(content, type)
            .notify(projectRef)
    }

    override fun dispose() {
        scope.cancel()
        super.dispose()
    }
}
