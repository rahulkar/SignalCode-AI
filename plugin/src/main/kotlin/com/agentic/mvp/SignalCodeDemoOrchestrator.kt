package com.signalcode.mvp

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

data class SignalCodeDemoSummary(
    val completedSteps: Int,
    val touchedFiles: List<String>
)

class SignalCodeDemoOrchestrator(
    private val project: Project,
    private val model: String,
    private val backendClient: BackendClient = BackendClient("http://localhost:3001"),
    private val log: (String) -> Unit
) {
    suspend fun run(): SignalCodeDemoSummary {
        val projectRoot = project.basePath?.let { Paths.get(it).normalize() }
            ?: throw IllegalStateException("Open a local IntelliJ project folder before running demo mode.")

        val steps = buildDemoSteps()
        ensureDemoWorkspaceReady(projectRoot, steps)

        val touchedFiles = linkedSetOf<String>()
        val seedPath = projectRoot.resolve(".signalcode-demo-seed.txt")

        log("Using live model '$model'.")
        log("Generating files inside $projectRoot.")
        log("This run expects an otherwise empty folder so the dashboard tells a clean from-zero story.")

        steps.forEachIndexed { index, step ->
            when (step) {
                is DemoLlmStep -> {
                    log("[${index + 1}/${steps.size}] ${step.title}")
                    val result = executeLlmStep(projectRoot, seedPath, step)
                    touchedFiles += relativizeForLog(projectRoot, result.targetFilePath)
                    log("Accepted LLM output for ${relativizeForLog(projectRoot, result.targetFilePath)}.")
                }

                is DemoManualEditStep -> {
                    log("[${index + 1}/${steps.size}] ${step.title}")
                    executeManualEditStep(projectRoot, step)
                    touchedFiles += step.relativePath
                    log("Applied local follow-up edit in ${step.relativePath}.")
                }
            }

            if (index < steps.lastIndex) {
                delay(step.pauseAfterMs)
            }
        }

        log("Demo run finished. Open the Telemetry Command Center to review the accepted tasks, IDE activity, and post-accept edits.")
        return SignalCodeDemoSummary(
            completedSteps = steps.size,
            touchedFiles = touchedFiles.toList()
        )
    }

    private suspend fun executeLlmStep(
        projectRoot: Path,
        seedPath: Path,
        step: DemoLlmStep
    ): ApplyResult {
        val contextFilePath = resolveContextFile(projectRoot, seedPath, step)
        val selectionSnippet = buildSelectionSnippet(projectRoot, step)
        val request = GenerateRequest(
            prompt = step.prompt,
            model = model,
            mode = step.mode.apiValue,
            context = GenerateContext(
                filePath = contextFilePath.toString(),
                projectRootPath = projectRoot.toString(),
                targetFilePath = step.targetFilePath,
                selectionOrCaretSnippet = selectionSnippet,
                languageId = step.languageId
            )
        )

        log("Prompting the live model for ${step.primaryFileForLog()}...")
        val response = withContext(Dispatchers.IO) { backendClient.generate(request) }
        if (response.model != model) {
            log("Model fallback applied by backend: requested '$model', used '${response.model}'.")
        }

        val operation = response.operation
        val previewMetrics = buildPreviewMetrics(projectRoot, contextFilePath, operation)
        val baseMeta = buildDemoMeta(step, contextFilePath, selectionSnippet.length, operation, response.usage)
        emitTelemetry(
            TelemetryRequest(
                task_id = response.task_id,
                diff_id = response.diff_id,
                event = TelemetryEventType.DIFF_RENDERED,
                meta = baseMeta
                    .plus(mapOf("fileAction" to fileActionFor(operation.kind)))
                    .plus(previewMetrics?.toMeta().orEmpty())
            )
        )

        val applyResult = withContext(Dispatchers.IO) {
            AgentOperationApplier.apply(project, operation, contextFilePath.toString())
        }
        if (!applyResult.success) {
            emitTelemetry(
                TelemetryRequest(
                    task_id = response.task_id,
                    diff_id = response.diff_id,
                    event = TelemetryEventType.REJECTED,
                    meta = baseMeta + mapOf(
                        "fileAction" to fileActionFor(operation.kind),
                        "applyFailed" to true,
                        "applyError" to applyResult.message
                    )
                )
            )
            throw IllegalStateException("Failed to apply generated change for ${step.primaryFileForLog()}: ${applyResult.message}")
        }

        val acceptedText = readAcceptedText(projectRoot, contextFilePath, applyResult.targetFilePath, operation)
            ?: throw IllegalStateException("Generated change for ${step.primaryFileForLog()} applied, but the resulting file could not be read.")
        PostAcceptTracker.registerAccepted(
            taskId = response.task_id,
            acceptedDiffId = response.diff_id,
            filePath = applyResult.targetFilePath,
            acceptedText = acceptedText
        )

        val acceptedMetrics = DemoDocumentMetrics.fromText(acceptedText)
        emitTelemetry(
            TelemetryRequest(
                task_id = response.task_id,
                diff_id = response.diff_id,
                event = TelemetryEventType.ACCEPTED,
                meta = baseMeta
                    .plus(mapOf("fileAction" to fileActionFor(operation.kind)))
                    .plus(acceptedMetrics.toMeta())
            )
        )

        return applyResult
    }

    private suspend fun executeManualEditStep(projectRoot: Path, step: DemoManualEditStep) {
        val target = projectRoot.resolve(step.relativePath).normalize()
        if (!Files.exists(target)) {
            throw IllegalStateException("Expected ${step.relativePath} to exist before applying the local follow-up edit.")
        }

        val original = withContext(Dispatchers.IO) { Files.readString(target) }
        val updated = step.transform(original)
        if (updated == original) {
            throw IllegalStateException("The local follow-up edit for ${step.relativePath} did not change the file.")
        }

        writeTextThroughDocument(target, updated)
    }

    private fun resolveContextFile(projectRoot: Path, seedPath: Path, step: DemoLlmStep): Path {
        val candidate = when {
            step.contextFilePath != null -> projectRoot.resolve(step.contextFilePath)
            step.mode == AgentMode.CREATE_FILE -> seedPath
            step.targetFilePath != null -> projectRoot.resolve(step.targetFilePath)
            else -> seedPath
        }
        return candidate.normalize()
    }

    private fun buildSelectionSnippet(projectRoot: Path, step: DemoLlmStep): String {
        if (step.useFullTargetFileAsSnippet) {
            val target = step.targetFilePath?.let { projectRoot.resolve(it).normalize() }
                ?: error("Target file path is required when useFullTargetFileAsSnippet=true")
            if (!Files.exists(target)) {
                throw IllegalStateException("Expected ${step.targetFilePath} to exist before running the patch step.")
            }
            return Files.readString(target)
        }

        val segments = mutableListOf(step.contextLead.trim())
        step.snapshotFiles.distinct().forEach { relativePath ->
            val file = projectRoot.resolve(relativePath).normalize()
            val contents = if (Files.exists(file)) Files.readString(file) else "<missing>"
            segments += "FILE: $relativePath\n$contents"
        }
        return segments.joinToString("\n\n").take(MAX_SELECTION_SNIPPET_CHARS)
    }

    private fun buildDemoMeta(
        step: DemoLlmStep,
        contextFilePath: Path,
        contextChars: Int,
        operation: AgentOperation,
        usage: UsageMetrics?
    ): Map<String, Any> {
        val generatedText = when (operation.kind) {
            "replace_range" -> operation.replace.orEmpty()
            "insert_after", "create_file" -> operation.content.orEmpty()
            else -> ""
        }

        return mapOf(
            "workflow" to "agentic-intellij-demo",
            "demoMode" to true,
            "demoStep" to step.title,
            "mode" to step.mode.apiValue,
            "operationKind" to operation.kind,
            "filePath" to operation.targetFilePath,
            "contextFilePath" to contextFilePath.toString(),
            "languageId" to (step.languageId ?: "unknown"),
            "promptChars" to step.prompt.length,
            "contextChars" to contextChars,
            "generatedChars" to generatedText.length,
            "generatedLines" to demoLineCount(generatedText),
            "targetFileProvided" to !step.targetFilePath.isNullOrBlank()
        ) + usage.toUsageMeta()
    }

    private fun buildPreviewMetrics(
        projectRoot: Path,
        currentFilePath: Path,
        operation: AgentOperation
    ): DemoDocumentMetrics? {
        val targetPath = resolveTargetForMetrics(projectRoot, operation.targetFilePath, currentFilePath)
        return when (operation.kind) {
            "replace_range" -> {
                if (!Files.exists(targetPath)) {
                    null
                } else {
                    buildRenderedDocumentMetrics(
                        Files.readString(targetPath),
                        operation.search.orEmpty(),
                        operation.replace.orEmpty()
                    )
                }
            }

            "insert_after" -> {
                if (!Files.exists(targetPath)) {
                    null
                } else {
                    buildInsertPreviewMetrics(
                        Files.readString(targetPath),
                        operation.anchor.orEmpty(),
                        operation.content.orEmpty()
                    )
                }
            }

            "create_file" -> DemoDocumentMetrics.fromText(operation.content.orEmpty())
            else -> null
        }
    }

    private fun resolveTargetForMetrics(projectRoot: Path, targetFilePath: String, currentFilePath: Path): Path {
        val raw = runCatching { Paths.get(targetFilePath) }.getOrNull() ?: return currentFilePath
        return if (raw.isAbsolute) raw.normalize() else projectRoot.resolve(raw).normalize()
    }

    private fun readAcceptedText(
        projectRoot: Path,
        currentFilePath: Path,
        targetFilePath: String,
        operation: AgentOperation
    ): String? {
        val target = resolveTargetForMetrics(projectRoot, targetFilePath, currentFilePath)
        if (operation.kind == "create_file") {
            return if (Files.exists(target)) Files.readString(target) else operation.content
        }
        return if (Files.exists(target)) Files.readString(target) else null
    }

    private suspend fun emitTelemetry(request: TelemetryRequest) {
        withContext(Dispatchers.IO) {
            backendClient.telemetryOrThrow(request)
        }
    }

    private fun writeTextThroughDocument(target: Path, updatedText: String) {
        var wroteWithDocument = false
        ApplicationManager.getApplication().invokeAndWait {
            val virtualFile = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(target)
            if (virtualFile != null) {
                FileEditorManager.getInstance(project).openTextEditor(OpenFileDescriptor(project, virtualFile), true)
                val document = FileDocumentManager.getInstance().getDocument(virtualFile)
                if (document != null) {
                    WriteCommandAction.runWriteCommandAction(project) {
                        document.setText(updatedText)
                    }
                    FileDocumentManager.getInstance().saveDocument(document)
                    wroteWithDocument = true
                }
            }
        }

        if (wroteWithDocument) {
            return
        }

        Files.writeString(target, updatedText)
        LocalFileSystem.getInstance().refreshAndFindFileByNioFile(target)
    }

    private fun ensureDemoWorkspaceReady(projectRoot: Path, steps: List<DemoStep>) {
        ensureProjectLooksEmpty(projectRoot)

        val collisions = steps
            .mapNotNull {
                when (it) {
                    is DemoLlmStep -> it.targetFilePath
                    is DemoManualEditStep -> it.relativePath
                }
            }
            .distinct()
            .map { projectRoot.resolve(it).normalize() }
            .filter { Files.exists(it) }

        if (collisions.isNotEmpty()) {
            val names = collisions.joinToString(", ") { projectRoot.relativize(it).toString() }
            throw IllegalStateException("Demo mode expects a clean project. Remove these files first: $names")
        }
    }

    private fun ensureProjectLooksEmpty(projectRoot: Path) {
        val unexpectedEntries = mutableListOf<String>()
        Files.newDirectoryStream(projectRoot).use { entries ->
            entries.forEach { entry ->
                val name = entry.fileName?.toString().orEmpty()
                if (name.isNotBlank() && !name.startsWith(".")) {
                    unexpectedEntries += name
                }
            }
        }

        if (unexpectedEntries.isNotEmpty()) {
            throw IllegalStateException(
                "Demo mode expects an empty folder. Open a clean IntelliJ directory first. Found: ${unexpectedEntries.joinToString(", ")}"
            )
        }
    }

    private fun relativizeForLog(projectRoot: Path, rawPath: String): String {
        val path = runCatching { Paths.get(rawPath).normalize() }.getOrNull() ?: return rawPath
        return if (path.isAbsolute && path.startsWith(projectRoot)) {
            projectRoot.relativize(path).toString()
        } else {
            rawPath
        }
    }

    private fun buildDemoSteps(): List<DemoStep> {
        return listOf(
            DemoLlmStep(
                title = "Create Maven project file",
                prompt = "Create a Maven pom.xml for a Java 17 desktop calculator demo. Include JUnit 5 for tests and configure execution for com.signalcode.demo.calculator.CalculatorApp.",
                mode = AgentMode.CREATE_FILE,
                targetFilePath = "pom.xml",
                languageId = "xml",
                contextLead = "The current IntelliJ project starts empty. Bootstrap a realistic Java calculator MVP.",
                snapshotFiles = emptyList()
            ),
            DemoLlmStep(
                title = "Create calculator engine",
                prompt = "Create the core calculator engine for a Swing calculator MVP. Support digits, decimals, clear, clear entry, sign toggle, percent, binary operations, equals, and a divide-by-zero error state. Keep the API easy for button-driven UI handlers.",
                mode = AgentMode.CREATE_FILE,
                targetFilePath = "src/main/java/com/signalcode/demo/calculator/CalculatorEngine.java",
                languageId = "java",
                contextLead = "Build the domain layer first. Use package com.signalcode.demo.calculator.",
                snapshotFiles = listOf("pom.xml")
            ),
            DemoLlmStep(
                title = "Create display formatter",
                prompt = "Create a small Java utility that formats calculator output for display. It should normalize trailing zeros, preserve integer-looking values cleanly, and handle error text pass-through for the Swing UI.",
                mode = AgentMode.CREATE_FILE,
                targetFilePath = "src/main/java/com/signalcode/demo/calculator/DisplayFormatter.java",
                languageId = "java",
                contextLead = "Add a formatter helper that the Swing frame can reuse.",
                snapshotFiles = listOf(
                    "pom.xml",
                    "src/main/java/com/signalcode/demo/calculator/CalculatorEngine.java"
                )
            ),
            DemoLlmStep(
                title = "Create Swing calculator frame",
                prompt = "Create a realistic Swing JFrame for the calculator. Use package com.signalcode.demo.calculator, setTitle(\"SignalCode Calculator\"), build a calculator keypad, include a status label, and wire button presses into CalculatorEngine and DisplayFormatter.",
                mode = AgentMode.CREATE_FILE,
                targetFilePath = "src/main/java/com/signalcode/demo/calculator/CalculatorFrame.java",
                languageId = "java",
                contextLead = "Create the primary desktop UI for the calculator MVP.",
                snapshotFiles = listOf(
                    "pom.xml",
                    "src/main/java/com/signalcode/demo/calculator/CalculatorEngine.java",
                    "src/main/java/com/signalcode/demo/calculator/DisplayFormatter.java"
                )
            ),
            DemoLlmStep(
                title = "Create application launcher",
                prompt = "Create the Java launcher class that starts CalculatorFrame on the Swing event dispatch thread. Keep it minimal and production-clean.",
                mode = AgentMode.CREATE_FILE,
                targetFilePath = "src/main/java/com/signalcode/demo/calculator/CalculatorApp.java",
                languageId = "java",
                contextLead = "Add the runnable entry point for the demo app.",
                snapshotFiles = listOf(
                    "pom.xml",
                    "src/main/java/com/signalcode/demo/calculator/CalculatorFrame.java"
                )
            ),
            DemoLlmStep(
                title = "Create engine tests",
                prompt = "Create focused JUnit 5 tests for CalculatorEngine. Cover addition, decimal entry, clear entry, percent, sign toggle, and divide-by-zero handling.",
                mode = AgentMode.CREATE_FILE,
                targetFilePath = "src/test/java/com/signalcode/demo/calculator/CalculatorEngineTest.java",
                languageId = "java",
                contextLead = "Add a believable automated test suite for the calculator engine.",
                snapshotFiles = listOf(
                    "pom.xml",
                    "src/main/java/com/signalcode/demo/calculator/CalculatorEngine.java"
                )
            ),
            DemoLlmStep(
                title = "Patch frame for demo polish",
                prompt = "Update this existing CalculatorFrame so the executive demo feels more realistic: add keyboard shortcuts for digits and operators, keep the setTitle call, and change the bottom status label text to exactly \"Live demo instrumentation active\" while preserving the rest of the layout.",
                mode = AgentMode.UPDATE_SELECTION,
                targetFilePath = "src/main/java/com/signalcode/demo/calculator/CalculatorFrame.java",
                languageId = "java",
                contextLead = "",
                snapshotFiles = emptyList(),
                useFullTargetFileAsSnippet = true
            ),
            DemoManualEditStep(
                title = "Simulate a presenter tweak in the frame",
                relativePath = "src/main/java/com/signalcode/demo/calculator/CalculatorFrame.java",
                pauseAfterMs = 2_200L
            ) { original ->
                var updated = original.replaceFirst(
                    Regex("""setTitle\(".*?"\);"""),
                    """setTitle("SignalCode Calculator Live Demo");"""
                )
                if (updated == original) {
                    updated = "// Presenter tweak: emphasize the live walkthrough.\n$original"
                }
                updated.replace(
                    "Live demo instrumentation active",
                    "Executive walkthrough running"
                )
            },
            DemoManualEditStep(
                title = "Simulate a follow-up test edit",
                relativePath = "src/test/java/com/signalcode/demo/calculator/CalculatorEngineTest.java",
                pauseAfterMs = 2_200L
            ) { original ->
                val addition = """

                    @Test
                    void presenter_can_verify_repeated_equals_after_clear_entry() {
                        CalculatorEngine engine = new CalculatorEngine();
                        engine.pressDigit("9");
                        engine.pressOperator("+");
                        engine.pressDigit("1");
                        engine.clearEntry();
                        engine.pressDigit("3");
                        assertEquals("12", engine.pressEquals());
                    }
                """.trimIndent()
                if (original.contains("presenter_can_verify_repeated_equals_after_clear_entry")) {
                    original
                } else {
                    replaceLastOccurrence(original, "}", "$addition\n}")
                }
            }
        )
    }

    private fun DemoLlmStep.primaryFileForLog(): String = targetFilePath ?: contextFilePath ?: "current file"

    private fun fileActionFor(kind: String): String = when (kind) {
        "create_file" -> "created"
        else -> "edited"
    }

    private sealed interface DemoStep {
        val title: String
        val pauseAfterMs: Long
    }

    private data class DemoLlmStep(
        override val title: String,
        val prompt: String,
        val mode: AgentMode,
        val targetFilePath: String? = null,
        val contextFilePath: String? = null,
        val languageId: String? = null,
        val contextLead: String,
        val snapshotFiles: List<String>,
        val useFullTargetFileAsSnippet: Boolean = false,
        override val pauseAfterMs: Long = 1_400L
    ) : DemoStep

    private data class DemoManualEditStep(
        override val title: String,
        val relativePath: String,
        override val pauseAfterMs: Long = 1_600L,
        val transform: (String) -> String
    ) : DemoStep

    companion object {
        private const val MAX_SELECTION_SNIPPET_CHARS = 24_000
    }
}

private data class DemoDocumentMetrics(
    val acceptedChars: Int,
    val acceptedLines: Int
) {
    fun toMeta(): Map<String, Any> = mapOf(
        "acceptedChars" to acceptedChars,
        "acceptedLines" to acceptedLines
    )

    companion object {
        fun fromText(text: String): DemoDocumentMetrics = DemoDocumentMetrics(
            acceptedChars = text.length,
            acceptedLines = demoLineCount(text)
        )
    }
}

private fun buildRenderedDocumentMetrics(documentText: String, search: String, replace: String): DemoDocumentMetrics? {
    val start = documentText.indexOf(search)
    if (start < 0) return null
    val previewText = buildString(documentText.length - search.length + replace.length) {
        append(documentText, 0, start)
        append(replace)
        append(documentText, start + search.length, documentText.length)
    }
    return DemoDocumentMetrics.fromText(previewText)
}

private fun buildInsertPreviewMetrics(documentText: String, anchor: String, insertedContent: String): DemoDocumentMetrics? {
    val start = documentText.indexOf(anchor)
    if (start < 0) return null
    val insertOffset = start + anchor.length
    val separator = when {
        insertedContent.isEmpty() -> ""
        anchor.endsWith("\n") || insertedContent.startsWith("\n") -> ""
        else -> "\n"
    }
    val previewText = buildString(documentText.length + separator.length + insertedContent.length) {
        append(documentText, 0, insertOffset)
        append(separator)
        append(insertedContent)
        append(documentText, insertOffset, documentText.length)
    }
    return DemoDocumentMetrics.fromText(previewText)
}

private fun demoLineCount(text: String): Int {
    if (text.isEmpty()) return 0
    return text.count { it == '\n' } + 1
}

private fun replaceLastOccurrence(text: String, search: String, replacement: String): String {
    val index = text.lastIndexOf(search)
    if (index < 0) return text
    return buildString(text.length - search.length + replacement.length) {
        append(text, 0, index)
        append(replacement)
        append(text, index + search.length, text.length)
    }
}

private fun UsageMetrics?.toUsageMeta(): Map<String, Any> {
    if (this == null) return emptyMap()
    val meta = mutableMapOf<String, Any>()
    promptTokens?.let { meta["promptTokens"] = it }
    completionTokens?.let { meta["completionTokens"] = it }
    totalTokens?.let { meta["totalTokens"] = it }
    costUsd?.let { meta["costUsd"] = it }
    return meta
}
