package com.signalcode.mvp

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.WindowManager
import java.awt.BorderLayout
import java.awt.Dialog
import java.awt.Dimension
import javax.swing.JDialog
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.JProgressBar
import javax.swing.SwingConstants
import javax.swing.border.EmptyBorder

class SignalCodeLoadingDialog(project: Project, message: String) {
    private val dialog: JDialog = JDialog(WindowManager.getInstance().getFrame(project), "SignalCode AI", Dialog.ModalityType.MODELESS)
    private val statusLabel = JLabel(message, SwingConstants.CENTER)

    init {
        val progress = JProgressBar().apply {
            isIndeterminate = true
        }
        dialog.contentPane = JPanel(BorderLayout(0, 10)).apply {
            border = EmptyBorder(16, 18, 16, 18)
            add(JLabel("Working with SignalCode agent…", SwingConstants.CENTER), BorderLayout.NORTH)
            add(progress, BorderLayout.CENTER)
            add(statusLabel, BorderLayout.SOUTH)
            preferredSize = Dimension(360, 110)
        }
        dialog.isResizable = false
        dialog.defaultCloseOperation = JDialog.DO_NOTHING_ON_CLOSE
        dialog.pack()
        dialog.setLocationRelativeTo(dialog.owner)
    }

    fun show() {
        dialog.isVisible = true
    }

    fun updateMessage(message: String) {
        statusLabel.text = message
    }

    fun close() {
        dialog.isVisible = false
        dialog.dispose()
    }
}
