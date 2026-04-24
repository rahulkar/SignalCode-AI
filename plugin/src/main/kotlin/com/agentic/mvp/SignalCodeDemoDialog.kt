package com.signalcode.mvp

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.event.ActionEvent
import javax.swing.Action
import javax.swing.BorderFactory
import javax.swing.Icon
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTextArea
import javax.swing.SwingConstants

class SignalCodeDemoDialog(
    private val projectRef: Project
) : DialogWrapper(projectRef) {
    init {
        title = "Executive demo mode"
        setOKButtonText("Close")
        init()
    }

    override fun createActions(): Array<Action> = arrayOf(OpenPreviewAction(), okAction)

    override fun createCenterPanel(): JComponent {
        val shell = JPanel(BorderLayout(0, 12)).apply {
            preferredSize = Dimension(820, 700)
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
                        JLabel("Walk through a realistic Java calculator scenario without sending generate requests or changing files."),
                        BorderLayout.SOUTH
                    )
                },
                BorderLayout.WEST
            )
            add(
                JPanel(FlowLayout(FlowLayout.RIGHT, 8, 0)).apply {
                    add(chip("Java calculator", SignalCodeIcons.Context))
                    add(chip("No file changes", SignalCodeIcons.Target))
                    add(chip("No backend call", SignalCodeIcons.ModeModel))
                },
                BorderLayout.EAST
            )
        }

        val content = JPanel().apply {
            layout = javax.swing.BoxLayout(this, javax.swing.BoxLayout.Y_AXIS)
            add(sectionCard("Scenario prompt", SignalCodeIcons.Prompt, buildPromptPanel()))
            add(spacer())
            add(sectionCard("What SignalCode will do", SignalCodeIcons.Inspect, buildStepsPanel()))
            add(spacer())
            add(sectionCard("Expected dashboard footprint", SignalCodeIcons.Dashboard, buildDashboardPanel()))
            add(spacer())
            add(sectionCard("Mock generated change", SignalCodeIcons.Patch, buildMockChangePanel()))
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

    private fun buildPromptPanel(): JPanel {
        val promptArea = readOnlyArea(DEMO_PROMPT).apply {
            rows = 7
            lineWrap = true
            wrapStyleWord = true
        }
        return JPanel(BorderLayout(0, 8)).apply {
            add(bodyText("Use this canned prompt to show how the agent frames a realistic desktop Java enhancement."), BorderLayout.NORTH)
            add(
                JScrollPane(promptArea).apply {
                    border = BorderFactory.createLineBorder(UIUtil.getBoundsColor())
                },
                BorderLayout.CENTER
            )
        }
    }

    private fun buildStepsPanel(): JPanel {
        val steps = listOf(
            DemoStep(
                title = "Inspect the calculator flow",
                description = "Read the Swing frame, controller, and engine to understand button wiring, operator handling, and display formatting.",
                files = listOf(
                    "src/main/java/com/signalcode/demo/CalculatorFrame.java",
                    "src/main/java/com/signalcode/demo/CalculatorController.java"
                ),
                icon = SignalCodeIcons.Inspect
            ),
            DemoStep(
                title = "Generate a focused patch",
                description = "Add CE and % handling, tighten divide-by-zero behavior, and keep the existing layout and button map stable.",
                files = listOf("src/main/java/com/signalcode/demo/CalculatorEngine.java"),
                icon = SignalCodeIcons.Patch
            ),
            DemoStep(
                title = "Add regression tests",
                description = "Cover decimal chaining, CE reset behavior, percent math, and divide-by-zero so the walkthrough feels production-ready.",
                files = listOf("src/test/java/com/signalcode/demo/CalculatorEngineTest.java"),
                icon = SignalCodeIcons.Test
            ),
            DemoStep(
                title = "Populate the telemetry story",
                description = "Show the exact journey executives care about: diff rendered, accepted, and optional post-accept edits that would appear on the dashboard.",
                files = listOf("Dashboard projection only"),
                icon = SignalCodeIcons.Dashboard
            )
        )

        return JPanel().apply {
            layout = javax.swing.BoxLayout(this, javax.swing.BoxLayout.Y_AXIS)
            steps.forEachIndexed { index, step ->
                add(stepCard(index + 1, step))
                if (index < steps.lastIndex) {
                    add(spacer())
                }
            }
        }
    }

    private fun buildDashboardPanel(): JPanel {
        val area = readOnlyArea(DEMO_DASHBOARD_FOOTPRINT).apply {
            rows = 8
            lineWrap = true
            wrapStyleWord = true
        }
        return JPanel(BorderLayout(0, 8)).apply {
            add(bodyText("This gives the audience a clear picture of what the MVP would surface in the dashboard after the mock review flow."), BorderLayout.NORTH)
            add(
                JScrollPane(area).apply {
                    border = BorderFactory.createLineBorder(UIUtil.getBoundsColor())
                },
                BorderLayout.CENTER
            )
        }
    }

    private fun buildMockChangePanel(): JPanel {
        val area = readOnlyArea(DEMO_CHANGE_SNIPPET).apply {
            rows = 14
            lineWrap = false
        }
        return JPanel(BorderLayout(0, 8)).apply {
            add(bodyText("Use the secondary button below to open the existing review modal with this mock patch."), BorderLayout.NORTH)
            add(
                JScrollPane(area).apply {
                    border = BorderFactory.createLineBorder(UIUtil.getBoundsColor())
                },
                BorderLayout.CENTER
            )
        }
    }

    private fun stepCard(number: Int, step: DemoStep): JPanel {
        val fileList = readOnlyArea(step.files.joinToString("\n")).apply {
            rows = step.files.size.coerceAtLeast(1)
            lineWrap = false
            border = JBUI.Borders.emptyTop(4)
        }

        return JPanel(BorderLayout(12, 0)).apply {
            border = BorderFactory.createCompoundBorder(
                BorderFactory.createLineBorder(UIUtil.getBoundsColor()),
                JBUI.Borders.empty(12)
            )
            add(
                JLabel(number.toString(), step.icon, SwingConstants.LEFT).apply {
                    font = font.deriveFont(font.size2D + 1.5f)
                    iconTextGap = JBUI.scale(8)
                    verticalAlignment = SwingConstants.TOP
                },
                BorderLayout.WEST
            )
            add(
                JPanel(BorderLayout(0, 6)).apply {
                    add(JLabel(step.title).apply { font = font.deriveFont(font.size2D + 0.5f) }, BorderLayout.NORTH)
                    add(bodyText(step.description), BorderLayout.CENTER)
                    add(fileList, BorderLayout.SOUTH)
                },
                BorderLayout.CENTER
            )
        }
    }

    private fun sectionCard(title: String, icon: Icon, content: JComponent): JPanel {
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

    private fun chip(text: String, icon: Icon): JPanel {
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

    private fun bodyText(text: String): JTextArea {
        return JTextArea(text).apply {
            isEditable = false
            isOpaque = false
            lineWrap = true
            wrapStyleWord = true
            border = BorderFactory.createEmptyBorder()
        }
    }

    private fun readOnlyArea(text: String): JTextArea {
        return JTextArea(text).apply {
            isEditable = false
            wrapStyleWord = true
            border = JBUI.Borders.empty(10)
        }
    }

    private fun spacer(): JPanel {
        return JPanel().apply {
            preferredSize = Dimension(0, 8)
            maximumSize = preferredSize
        }
    }

    private inner class OpenPreviewAction : DialogWrapperAction("Open mock patch review") {
        override fun doAction(event: ActionEvent?) {
            SignalCodePlanPreviewDialog(projectRef, DEMO_OPERATION, DEMO_USAGE).show()
        }
    }

    private data class DemoStep(
        val title: String,
        val description: String,
        val files: List<String>,
        val icon: Icon
    )

    companion object {
        private val DEMO_OPERATION = AgentOperation(
            kind = "replace_range",
            summary = "Extend the Java calculator engine with CE, %, safer divide handling, and cleaner display normalization.",
            targetFilePath = "src/main/java/com/signalcode/demo/CalculatorEngine.java",
            search = """
                private double applyBinaryOperation(double left, double right, String operator) {
                    switch (operator) {
                        case "+":
                            return left + right;
                        case "-":
                            return left - right;
                        case "*":
                            return left * right;
                        case "/":
                            return right == 0 ? 0 : left / right;
                        default:
                            throw new IllegalArgumentException("Unsupported operator: " + operator);
                    }
                }
            """.trimIndent(),
            replace = """
                private double applyBinaryOperation(double left, double right, String operator) {
                    switch (operator) {
                        case "+":
                            return left + right;
                        case "-":
                            return left - right;
                        case "*":
                            return left * right;
                        case "/":
                            if (right == 0) {
                                throw new ArithmeticException("Cannot divide by zero");
                            }
                            return left / right;
                        case "%":
                            return left % right;
                        default:
                            throw new IllegalArgumentException("Unsupported operator: " + operator);
                    }
                }

                private String normalizeDisplay(double value) {
                    if (value == (long) value) {
                        return Long.toString((long) value);
                    }
                    return String.format(Locale.US, "%.4f", value).replaceAll("0+$", "").replaceAll("\\\\.$", "");
                }
            """.trimIndent()
        )

        private val DEMO_USAGE = UsageMetrics(
            promptTokens = 642,
            completionTokens = 318,
            totalTokens = 960,
            costUsd = 0.00192
        )

        private val DEMO_PROMPT = """
            Upgrade the Java calculator app so it is demo-ready for executives:
            1. add CE and % support,
            2. prevent divide-by-zero from silently returning 0,
            3. normalize decimal output for clean display text,
            4. add focused regression tests,
            5. keep the existing Swing layout and button flow intact.
        """.trimIndent()

        private val DEMO_DASHBOARD_FOOTPRINT = """
            - DIFF_RENDERED would appear for CalculatorEngine.java after the mock patch is reviewed.
            - ACCEPTED would appear when the presenter approves the plan in the preview modal.
            - A second prompt can be used to demonstrate ITERATED for follow-up keyboard shortcuts or memory actions.
            - Post-accept edit tracking can be explained as the presenter tweaking button labels, spacing, or rounding rules after accept.
            - The end result is a believable dashboard story without creating noise in the real project workspace.
        """.trimIndent()

        private val DEMO_CHANGE_SNIPPET = """
            Files touched in the walkthrough
            - src/main/java/com/signalcode/demo/CalculatorFrame.java
            - src/main/java/com/signalcode/demo/CalculatorController.java
            - src/main/java/com/signalcode/demo/CalculatorEngine.java
            - src/test/java/com/signalcode/demo/CalculatorEngineTest.java

            Demo highlights
            - Adds CE and % button handling
            - Replaces silent divide-by-zero fallback with a clear error path
            - Normalizes trailing decimal zeroes before updating the display
            - Adds regression tests for chained decimals, CE reset, and percent math
        """.trimIndent()
    }
}
