package com.signalcode.mvp

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.BorderFactory
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JScrollPane
import javax.swing.JTextArea

class SignalCodePlanPreviewDialog(
    project: Project,
    private val operation: AgentOperation,
    private val usage: UsageMetrics? = null
) : DialogWrapper(project) {
    init {
        title = "Review agent plan"
        setOKButtonText("Apply")
        init()
    }

    override fun createCenterPanel(): JComponent {
        val previewText = when (operation.kind) {
            "replace_range" -> buildString {
                append("Search\n")
                append(operation.search.orEmpty())
                append("\n\nReplace with\n")
                append(operation.replace.orEmpty())
            }
            "insert_after" -> buildString {
                append("Insert after\n")
                append(operation.anchor.orEmpty())
                append("\n\nNew code\n")
                append(operation.content.orEmpty())
            }
            else -> operation.content.orEmpty()
        }

        val previewArea = JTextArea(previewText).apply {
            isEditable = false
            lineWrap = false
            rows = 22
            border = JBUI.Borders.empty(10)
        }

        return JPanel(BorderLayout(0, 10)).apply {
            preferredSize = Dimension(760, 560)
            add(
                JPanel(BorderLayout(0, 4)).apply {
                    add(JLabel(operation.summary), BorderLayout.NORTH)
                    add(
                        JPanel(BorderLayout(0, 4)).apply {
                            add(JLabel("Target: ${operation.targetFilePath}"), BorderLayout.NORTH)
                            add(JLabel(buildUsageSummary(usage)), BorderLayout.SOUTH)
                        },
                        BorderLayout.SOUTH
                    )
                },
                BorderLayout.NORTH
            )
            add(JScrollPane(previewArea).apply {
                border = BorderFactory.createLineBorder(com.intellij.util.ui.UIUtil.getBoundsColor())
            }, BorderLayout.CENTER)
        }
    }
}

private fun buildUsageSummary(usage: UsageMetrics?): String {
    if (usage == null) {
        return "Usage: unavailable from model provider"
    }
    val parts = mutableListOf<String>()
    usage.promptTokens?.let { parts += "prompt $it" }
    usage.completionTokens?.let { parts += "completion $it" }
    usage.totalTokens?.let { parts += "total $it" }
    usage.costUsd?.let { parts += "cost $${"%.5f".format(it)}" }
    return if (parts.isEmpty()) "Usage: unavailable from model provider" else "Usage: ${parts.joinToString(" • ")}"
}
