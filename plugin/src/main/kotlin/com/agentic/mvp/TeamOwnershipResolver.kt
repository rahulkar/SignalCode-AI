package com.signalcode.mvp

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

data class TeamOwnership(
    val team: String?,
    val authorId: String?
) {
    fun toMeta(): Map<String, Any> = buildMap {
        if (!team.isNullOrBlank()) {
            put("team", team)
        }
        if (!authorId.isNullOrBlank()) {
            put("author_id", authorId)
        }
    }
}

object TeamOwnershipResolver {
    private val ownershipFileNames = listOf("team.json", "teams.json")

    fun resolve(filePath: String?, projectRootPath: String?): TeamOwnership {
        val startDirs = mutableListOf<Path>()
        parsePath(projectRootPath)?.let { root ->
            startDirs.add(if (Files.isDirectory(root)) root else root.parent ?: root)
        }
        parsePath(filePath)?.let { file ->
            startDirs.add(if (Files.isDirectory(file)) file else file.parent ?: file)
        }

        for (startDir in startDirs.distinct()) {
            val configPath = findNearestConfig(startDir) ?: continue
            val parsed = parseConfig(configPath)
            if (!parsed.team.isNullOrBlank() || !parsed.authorId.isNullOrBlank()) {
                return parsed
            }
        }

        return TeamOwnership(team = null, authorId = null)
    }

    private fun parsePath(raw: String?): Path? {
        if (raw.isNullOrBlank()) {
            return null
        }
        return runCatching { Paths.get(raw.trim()).toAbsolutePath().normalize() }.getOrNull()
    }

    private fun findNearestConfig(start: Path): Path? {
        var current = start.toAbsolutePath().normalize()
        while (true) {
            for (fileName in ownershipFileNames) {
                val candidate = current.resolve(fileName)
                if (Files.exists(candidate) && Files.isRegularFile(candidate)) {
                    return candidate
                }
            }
            val parent = current.parent ?: return null
            if (parent == current) {
                return null
            }
            current = parent
        }
    }

    private fun parseConfig(configPath: Path): TeamOwnership = runCatching {
        val json = Files.newBufferedReader(configPath).use { reader ->
            JsonParser.parseReader(reader).asJsonObject
        }
        TeamOwnership(
            team = pickString(json, "team", "default_team"),
            authorId = pickString(json, "author_id", "default_author_id")
        )
    }.getOrDefault(TeamOwnership(team = null, authorId = null))

    private fun pickString(json: JsonObject, vararg keys: String): String? {
        for (key in keys) {
            val candidate = json.get(key)
            if (candidate != null && candidate.isJsonPrimitive) {
                val value = candidate.asString?.trim()
                if (!value.isNullOrBlank()) {
                    return value
                }
            }
        }
        return null
    }
}
