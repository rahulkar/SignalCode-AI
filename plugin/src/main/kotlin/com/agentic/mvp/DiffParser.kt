package com.signalcode.mvp

object DiffParser {
    private val regex = Regex(
        pattern = "<<<<SEARCH\\s*\\r?\\n([\\s\\S]*?)\\r?\\n====\\s*\\r?\\n([\\s\\S]*?)\\r?\\n>>>>REPLACE",
        options = setOf(RegexOption.MULTILINE)
    )

    fun parse(raw: String): SearchReplaceDiff? {
        val match = regex.find(raw.trim()) ?: return null
        return SearchReplaceDiff(
            search = match.groupValues[1],
            replace = match.groupValues[2]
        )
    }
}
