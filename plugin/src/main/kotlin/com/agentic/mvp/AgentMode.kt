package com.signalcode.mvp

enum class AgentMode(
    val apiValue: String,
    val label: String,
    val description: String,
    val buttonLabel: String
) {
    UPDATE_SELECTION(
        apiValue = "update_selection",
        label = "Update current code",
        description = "Replace or refactor the selected code in the active file.",
        buttonLabel = "Generate patch"
    ),
    INSERT_INTO_FILE(
        apiValue = "insert_into_file",
        label = "Add code to current file",
        description = "Insert new code after the selected or nearby context.",
        buttonLabel = "Generate insertion"
    ),
    CREATE_FILE(
        apiValue = "create_file",
        label = "Create new file",
        description = "Draft a brand-new file under the project root.",
        buttonLabel = "Generate file"
    );

    override fun toString(): String = label
}

data class AgentDialogSubmission(
    val prompt: String,
    val model: String,
    val mode: AgentMode,
    val targetFilePath: String?
)

data class EditorContextSnapshot(
    val contextSnippet: String,
    val contextLabel: String,
    val filePath: String,
    val languageId: String?,
    val fileName: String,
    val projectRootPath: String?,
    val team: String?,
    val authorId: String?
)
