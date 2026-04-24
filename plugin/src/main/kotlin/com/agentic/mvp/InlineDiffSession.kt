package com.signalcode.mvp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.markup.EffectType
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea
import com.intellij.openapi.editor.markup.RangeHighlighter
import com.intellij.openapi.editor.markup.TextAttributes
import java.awt.Color

class InlineDiffSession(private val editor: Editor) {
    private val highlighters = mutableListOf<RangeHighlighter>()

    fun render(search: String, replace: String): Boolean {
        clear()
        val document = editor.document
        val content = document.text
        val start = content.indexOf(search)
        if (start < 0) {
            return false
        }
        val end = start + search.length
        val removedAttrs = TextAttributes().apply {
            backgroundColor = Color(255, 230, 230)
            effectType = EffectType.STRIKEOUT
            effectColor = Color(210, 50, 50)
        }
        highlighters += editor.markupModel.addRangeHighlighter(
            start,
            end,
            HighlighterLayer.SELECTION - 1,
            removedAttrs,
            HighlighterTargetArea.EXACT_RANGE
        )
        val insertedAttrs = TextAttributes().apply {
            backgroundColor = Color(230, 255, 235)
        }
        highlighters += editor.markupModel.addRangeHighlighter(
            start,
            start + replace.length.coerceAtMost(search.length),
            HighlighterLayer.SELECTION - 2,
            insertedAttrs,
            HighlighterTargetArea.EXACT_RANGE
        )
        return true
    }

    fun renderInsert(anchor: String): Boolean {
        clear()
        val document = editor.document
        val content = document.text
        val start = content.indexOf(anchor)
        if (start < 0) {
            return false
        }
        val end = start + anchor.length
        val anchorAttrs = TextAttributes().apply {
            backgroundColor = Color(232, 240, 255)
        }
        highlighters += editor.markupModel.addRangeHighlighter(
            start,
            end,
            HighlighterLayer.SELECTION - 1,
            anchorAttrs,
            HighlighterTargetArea.EXACT_RANGE
        )
        return true
    }

    fun accept(project: com.intellij.openapi.project.Project, search: String, replace: String): Boolean {
        val document = editor.document
        val content = document.text
        val start = content.indexOf(search)
        if (start < 0) {
            return false
        }
        val end = start + search.length
        WriteCommandAction.runWriteCommandAction(project) {
            document.replaceString(start, end, replace)
        }
        clear()
        return true
    }

    fun acceptInsert(project: com.intellij.openapi.project.Project, anchor: String, contentToInsert: String): Boolean {
        val document = editor.document
        val content = document.text
        val start = content.indexOf(anchor)
        if (start < 0) {
            return false
        }
        val insertOffset = start + anchor.length
        val separator = when {
            contentToInsert.isEmpty() -> ""
            anchor.endsWith("\n") || contentToInsert.startsWith("\n") -> ""
            else -> "\n"
        }
        WriteCommandAction.runWriteCommandAction(project) {
            document.insertString(insertOffset, separator + contentToInsert)
        }
        clear()
        return true
    }

    fun clear() {
        ApplicationManager.getApplication().invokeLater {
            highlighters.forEach { it.dispose() }
            highlighters.clear()
        }
    }
}
