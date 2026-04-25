package com.signalcode.mvp

import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import kotlinx.coroutines.CancellationException
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
import javax.swing.JProgressBar
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
    private val liveProgressLabel = JLabel(
        "Step-by-step status appears here during the run.",
        SignalCodeIcons.Inspect,
        SwingConstants.LEFT
    )
    private val liveProgressBar = JProgressBar(0, 100).apply {
        isStringPainted = true
        value = 0
        string = "Idle"
    }
    private val liveProgressArea = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        rows = 9
        border = JBUI.Borders.empty(10)
    }
    private val startDemoButton = JButton("Run live demo").apply {
        icon = SignalCodeIcons.Demo
    }
    private val statusLabel = JLabel(
        "Ready to generate a real Java calculator demo in the current IntelliJ folder with $selectedModel.",
        SignalCodeIcons.ModeModel,
        SwingConstants.LEFT
    )
    private var isRunning = false
    @Volatile
    private var dialogModalityState: ModalityState = ModalityState.defaultModalityState()

    init {
        title = "Executive demo mode"
        setOKButtonText("Close")
        init()
        bindActions()
        appendLog("This mode uses the live backend, real model calls, and real telemetry.")
        appendLog("Open a local IntelliJ folder, then make sure the backend, LiteLLM, and Telemetry Command Center are already running.")
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
                        JLabel("Autonomously builds a Java calculator MVP in the current IntelliJ project and streams real telemetry to the dashboard."),
                        BorderLayout.SOUTH
                    )
                },
                BorderLayout.WEST
            )
            add(
                JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0)).apply {
                    add(chip("Model: $selectedModel", SignalCodeIcons.ModeModel))
                    add(chip("Real backend", SignalCodeIcons.Backend))
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
            dialogModalityState = ModalityState.current()
            startDemoButton.isEnabled = false
            statusLabel.text = "Running live demo with $selectedModel..."
            resetLiveProgress()
            appendLog("Starting live demo run in ${projectRef.basePath ?: "unknown project root"}")

            scope.launch {
                val orchestrator = SignalCodeDemoOrchestrator(
                    project = projectRef,
                    model = selectedModel,
                    log = { message -> appendLog(message) },
                    progress = { event -> onProgressEvent(event) },
                    uiModalityState = dialogModalityState
                )

                try {
                    val summary = orchestrator.run()
                    runOnDialogUi {
                        isRunning = false
                        startDemoButton.isEnabled = true
                        statusLabel.text = "Live demo completed: ${summary.completedSteps} steps across ${summary.touchedFiles.size} files."
                        notify(
                            "Live demo completed across ${summary.touchedFiles.size} files. Refresh the Telemetry Command Center to view the results.",
                            NotificationType.INFORMATION
                        )
                    }
                } catch (_: CancellationException) {
                    appendLog("Live demo run cancelled.")
                    runOnDialogUi {
                        isRunning = false
                        startDemoButton.isEnabled = true
                        statusLabel.text = "Live demo cancelled."
                    }
                } catch (error: Throwable) {
                    val message = error.message ?: error::class.java.simpleName
                    appendLog("Live demo failed: $message")
                    runOnDialogUi {
                        isRunning = false
                        startDemoButton.isEnabled = true
                        statusLabel.text = "Demo failed: $message"
                        notify("Live demo failed: $message", NotificationType.ERROR)
                        Messages.showErrorDialog(
                            projectRef,
                            "Live demo failed.\n$message\n\nSee the Execution log panel for step details.",
                            "SignalCode Demo Mode"
                        )
                    }
                }
            }
        }
    }

    private fun buildPlanPanel(): JPanel {
        val body = JTextArea(
            """
            1. Validate the current IntelliJ folder and ensure demo target files do not already exist.
            2. Create a small Java calculator project structure in that folder.
            3. Use the actual generate API and selected model to create multiple production-style files.
            4. Apply one real patch to an existing file so the run includes both new-file generation and update-style work.
            5. Intentionally reject one or more generated updates to simulate realistic review decisions.
            6. Make follow-up local edits after acceptance to mimic human tweaks and trigger post-accept telemetry.
            7. Feed the full story into Telemetry Command Center: generated tasks, accepts, rejects, created files, edited files, and post-accept rework.
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
                    add(
                        JPanel(BorderLayout(0, 6)).apply {
                            add(statusLabel, BorderLayout.NORTH)
                            add(liveProgressLabel, BorderLayout.CENTER)
                            add(liveProgressBar, BorderLayout.SOUTH)
                        },
                        BorderLayout.NORTH
                    )
                    add(
                        JScrollPane(liveProgressArea).apply {
                            preferredSize = Dimension(760, 170)
                            border = BorderFactory.createLineBorder(UIUtil.getBoundsColor())
                        },
                        BorderLayout.CENTER
                    )
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
                JLabel("The log below updates as each LLM phase (generate, apply, telemetry) and local follow-up edit completes."),
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
        runOnDialogUi {
            if (logArea.text.isNotBlank()) {
                logArea.append("\n")
            }
            logArea.append(message)
            logArea.caretPosition = logArea.document.length
        }
    }

    private fun resetLiveProgress() {
        runOnDialogUi {
            liveProgressLabel.text = "Initializing run..."
            liveProgressBar.value = 0
            liveProgressBar.string = "Starting"
            liveProgressArea.text = ""
        }
    }

    private fun onProgressEvent(event: DemoProgressEvent) {
        runOnDialogUi {
            when (event) {
                is DemoProgressEvent.RunPhase -> {
                    liveProgressLabel.text = event.message
                    appendLiveProgressLine("Run: ${event.message}")
                }

                is DemoProgressEvent.RunInitialized -> {
                    liveProgressBar.value = 0
                    liveProgressBar.string = "0/${event.totalSteps} steps"
                    liveProgressLabel.text = "Run initialized with ${event.totalSteps} steps."
                    appendLiveProgressLine("Run initialized with ${event.totalSteps} steps.")
                    event.stepTitles.forEachIndexed { idx, title ->
                        appendLiveProgressLine("  ${idx + 1}. $title")
                    }
                }

                is DemoProgressEvent.StepStarted -> {
                    setProgressPercent(event.index - 1, event.total)
                    liveProgressBar.string = "${event.index - 1}/${event.total} steps complete"
                    liveProgressLabel.text = "[${event.index}/${event.total}] ${event.title}"
                    appendLiveProgressLine("[${event.index}/${event.total}] Started ${event.title}")
                }

                is DemoProgressEvent.StepPhase -> {
                    liveProgressLabel.text = "[${event.index}/${event.total}] ${event.title}: ${event.phase}"
                    appendLiveProgressLine("  - ${event.phase}: ${event.detail}")
                }

                is DemoProgressEvent.StepCompleted -> {
                    setProgressPercent(event.index, event.total)
                    liveProgressBar.string = "${event.index}/${event.total} steps complete"
                    liveProgressLabel.text = "[${event.index}/${event.total}] Completed ${event.title}"
                    appendLiveProgressLine("[${event.index}/${event.total}] Completed ${event.title}")
                }

                is DemoProgressEvent.StepFailed -> {
                    liveProgressLabel.text = "[${event.index}/${event.total}] Failed ${event.title}"
                    appendLiveProgressLine("[${event.index}/${event.total}] Failed ${event.title}: ${event.reason}")
                }

                is DemoProgressEvent.RunCompleted -> {
                    liveProgressBar.value = 100
                    liveProgressBar.string = "${event.totalSteps}/${event.totalSteps} steps complete"
                    liveProgressLabel.text = "Run completed."
                    appendLiveProgressLine("Run completed successfully.")
                }
            }
        }
    }

    private fun appendLiveProgressLine(message: String) {
        if (liveProgressArea.text.isNotBlank()) {
            liveProgressArea.append("\n")
        }
        liveProgressArea.append(message)
        liveProgressArea.caretPosition = liveProgressArea.document.length
    }

    private fun setProgressPercent(completedSteps: Int, totalSteps: Int) {
        val total = totalSteps.coerceAtLeast(1)
        val safeCompleted = completedSteps.coerceIn(0, total)
        liveProgressBar.value = (safeCompleted * 100) / total
    }

    private fun runOnDialogUi(action: () -> Unit) {
        val application = ApplicationManager.getApplication()
        if (application.isDispatchThread) {
            action()
            return
        }

        // Run callbacks in this dialog's modality scope so updates keep flowing while open,
        // without bypassing transaction safety.
        application.invokeLater({ action() }, dialogModalityState)
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
