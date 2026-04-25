package com.signalcode.mvp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

data class ApplyResult(
    val success: Boolean,
    val message: String,
    val targetFilePath: String
)

object AgentOperationApplier {
    fun apply(
        project: Project,
        operation: AgentOperation,
        currentFilePath: String,
        openInEditor: Boolean = true
    ): ApplyResult {
        val resolvedTarget = resolveTargetPath(project, operation.targetFilePath, currentFilePath)
            ?: return ApplyResult(false, "Target path is outside the project.", operation.targetFilePath)

        return when (operation.kind) {
            "replace_range" -> replaceRange(project, resolvedTarget, operation, openInEditor)
            "insert_after" -> insertAfter(project, resolvedTarget, operation, openInEditor)
            "create_file" -> createFile(project, resolvedTarget, operation, openInEditor)
            else -> ApplyResult(false, "Unsupported operation '${operation.kind}'.", operation.targetFilePath)
        }
    }

    private fun replaceRange(project: Project, target: Path, operation: AgentOperation, openInEditor: Boolean): ApplyResult {
        val search = operation.search ?: return ApplyResult(false, "Missing search block.", target.toString())
        val replace = operation.replace ?: return ApplyResult(false, "Missing replacement block.", target.toString())
        if (!Files.exists(target)) {
            return ApplyResult(false, "Target file does not exist.", target.toString())
        }

        val original = Files.readString(target)
        val start = original.indexOf(search)
        if (start < 0) {
            return ApplyResult(false, "Could not find the code block to update.", target.toString())
        }
        val updated = buildString(original.length - search.length + replace.length) {
            append(original, 0, start)
            append(replace)
            append(original, start + search.length, original.length)
        }
        saveText(project, target, updated, openInEditor)
        return ApplyResult(true, "Updated ${target.fileName}", target.toString())
    }

    private fun insertAfter(project: Project, target: Path, operation: AgentOperation, openInEditor: Boolean): ApplyResult {
        val anchor = operation.anchor ?: return ApplyResult(false, "Missing insertion anchor.", target.toString())
        val content = operation.content ?: return ApplyResult(false, "Missing inserted content.", target.toString())
        if (!Files.exists(target)) {
            return ApplyResult(false, "Target file does not exist.", target.toString())
        }

        val original = Files.readString(target)
        val start = original.indexOf(anchor)
        if (start < 0) {
            return ApplyResult(false, "Could not find the insertion anchor.", target.toString())
        }
        val insertOffset = start + anchor.length
        val separator = when {
            content.isEmpty() -> ""
            anchor.endsWith("\n") || content.startsWith("\n") -> ""
            else -> "\n"
        }
        val updated = buildString(original.length + separator.length + content.length) {
            append(original, 0, insertOffset)
            append(separator)
            append(content)
            append(original, insertOffset, original.length)
        }
        saveText(project, target, updated, openInEditor)
        return ApplyResult(true, "Added code to ${target.fileName}", target.toString())
    }

    private fun createFile(project: Project, target: Path, operation: AgentOperation, openInEditor: Boolean): ApplyResult {
        val content = operation.content ?: return ApplyResult(false, "Missing file contents.", target.toString())
        if (Files.exists(target)) {
            return ApplyResult(false, "Target file already exists.", target.toString())
        }

        Files.createDirectories(target.parent ?: target.toAbsolutePath().parent)
        Files.writeString(target, content)
        if (openInEditor) {
            refreshAndOpen(project, target)
        }
        return ApplyResult(true, "Created ${target.fileName}", target.toString())
    }

    private fun saveText(project: Project, target: Path, updated: String, openInEditor: Boolean) {
        if (!openInEditor) {
            Files.writeString(target, updated)
            return
        }

        val virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(target)
        val document = virtualFile?.let { FileDocumentManager.getInstance().getDocument(it) }
        if (document != null) {
            WriteCommandAction.runWriteCommandAction(project) {
                document.setText(updated)
            }
            FileDocumentManager.getInstance().saveDocument(document)
            refreshAndOpen(project, target)
            return
        }

        Files.writeString(target, updated)
        refreshAndOpen(project, target)
    }

    private fun refreshAndOpen(project: Project, target: Path) {
        val virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(target)
            ?: LocalFileSystem.getInstance().refreshAndFindFileByIoFile(target.toFile())
            ?: return
        ApplicationManager.getApplication().invokeLater {
            FileEditorManager.getInstance(project).openTextEditor(OpenFileDescriptor(project, virtualFile), true)
        }
    }

    private fun resolveTargetPath(project: Project, rawTargetPath: String, currentFilePath: String): Path? {
        val currentPath = Paths.get(currentFilePath).normalize()
        val rawPath = runCatching { Paths.get(rawTargetPath) }.getOrNull() ?: return null
        val projectRoot = project.basePath?.let { Paths.get(it).normalize() }

        val resolved = when {
            rawPath.isAbsolute -> rawPath.normalize()
            projectRoot != null -> projectRoot.resolve(rawPath).normalize()
            else -> currentPath.parent.resolve(rawPath).normalize()
        }

        if (resolved == currentPath) {
            return resolved
        }
        if (projectRoot != null && resolved.startsWith(projectRoot)) {
            return resolved
        }
        return if (rawPath.isAbsolute && resolved == currentPath) resolved else null
    }
}
