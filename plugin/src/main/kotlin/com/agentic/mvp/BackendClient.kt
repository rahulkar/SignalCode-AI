package com.signalcode.mvp

import com.google.gson.Gson
import com.google.gson.JsonObject
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

class BackendClient(
    private val baseUrl: String,
    private val gson: Gson = Gson()
) {
    private val client: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build()

    fun generate(request: GenerateRequest): GenerateResponse {
        try {
            val httpRequest = HttpRequest.newBuilder()
                .uri(URI.create("$baseUrl/api/generate"))
                .timeout(Duration.ofSeconds(60))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(gson.toJson(request)))
                .build()
            val response = client.send(httpRequest, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) {
                val detail = extractError(response.body())
                throw IllegalStateException("HTTP ${response.statusCode()} from backend: $detail")
            }
            val parsed = gson.fromJson(response.body(), GenerateResponse::class.java)
            return normalizeGenerateResponse(parsed)
        } catch (error: Exception) {
            throw IllegalStateException("Failed to call $baseUrl/api/generate: ${rootCauseMessage(error)}", error)
        }
    }

    fun telemetry(request: TelemetryRequest) {
        try {
            sendTelemetry(request)
        } catch (_: Exception) {
            // Telemetry must not block user flow.
        }
    }

    fun telemetryOrThrow(request: TelemetryRequest) {
        try {
            sendTelemetry(request)
        } catch (error: Exception) {
            throw IllegalStateException("Failed to call $baseUrl/api/telemetry: ${rootCauseMessage(error)}", error)
        }
    }

    fun fetchModels(): ModelsResponse {
        try {
            val httpRequest = HttpRequest.newBuilder()
                .uri(URI.create("$baseUrl/api/models"))
                .timeout(Duration.ofSeconds(10))
                .GET()
                .build()
            val response = client.send(httpRequest, HttpResponse.BodyHandlers.ofString())
            if (response.statusCode() !in 200..299) {
                val detail = extractError(response.body())
                throw IllegalStateException("HTTP ${response.statusCode()} from backend: $detail")
            }
            return gson.fromJson(response.body(), ModelsResponse::class.java)
        } catch (error: Exception) {
            throw IllegalStateException("Failed to call $baseUrl/api/models: ${rootCauseMessage(error)}", error)
        }
    }

    fun extractError(body: String): String = runCatching {
        val obj = gson.fromJson(body, JsonObject::class.java)
        val message = obj.get("message")?.takeIf { !it.isJsonNull }?.asString
        val error = obj.get("error")?.takeIf { !it.isJsonNull }?.asString
        when {
            !message.isNullOrBlank() && !error.isNullOrBlank() && error != message -> "$error — $message"
            !message.isNullOrBlank() -> message
            !error.isNullOrBlank() -> error
            else -> body.trim().ifBlank { "Request failed" }
        }
    }.getOrElse { body.trim().ifBlank { "Request failed" } }

    private fun rootCauseMessage(error: Throwable): String {
        val root = generateSequence(error) { it.cause }.lastOrNull() ?: error
        return root.message ?: root::class.java.simpleName
    }

    private fun normalizeGenerateResponse(response: GenerateResponse): GenerateResponse {
        val normalizedOperation = normalizeCreateFileContent(response.operation)
        return if (normalizedOperation == response.operation) response else response.copy(operation = normalizedOperation)
    }

    private fun normalizeCreateFileContent(operation: AgentOperation): AgentOperation {
        if (operation.kind != "create_file") {
            return operation
        }
        val rawContent = operation.content ?: return operation
        val nested = parseNestedJsonObject(rawContent) ?: return operation
        val nestedKind = readString(nested, "kind")?.trim()?.lowercase()
        if (nestedKind !in setOf("create_file", "create", "new_file")) {
            return operation
        }
        val nestedTargetPath = readString(nested, "targetFilePath", "target_path", "targetFile", "filePath")
            ?: return operation
        if (!samePathLike(nestedTargetPath, operation.targetFilePath)) {
            return operation
        }
        val nestedContent = readString(nested, "content", "replace") ?: return operation
        return operation.copy(content = nestedContent)
    }

    private fun parseNestedJsonObject(raw: String): JsonObject? {
        val stripped = stripOuterMarkdownFences(raw)
        if (!stripped.trimStart().startsWith("{")) {
            return null
        }
        return runCatching { gson.fromJson(stripped, JsonObject::class.java) }.getOrNull()
    }

    private fun stripOuterMarkdownFences(raw: String): String {
        var text = raw.replace("\r\n", "\n").trim()
        repeat(3) {
            val wrapped = Regex("^```[^\\n]*\\n?([\\s\\S]*?)\\n?```\\s*$").matchEntire(text) ?: return@repeat
            text = wrapped.groupValues[1].trim()
        }
        return text
    }

    private fun readString(json: JsonObject, vararg keys: String): String? {
        keys.forEach { key ->
            val value = json.get(key)
            if (value != null && !value.isJsonNull && value.isJsonPrimitive && value.asJsonPrimitive.isString) {
                val candidate = value.asString.trim()
                if (candidate.isNotEmpty()) {
                    return candidate
                }
            }
        }
        return null
    }

    private fun samePathLike(left: String, right: String): Boolean {
        return normalizePathLike(left) == normalizePathLike(right)
    }

    private fun normalizePathLike(value: String): String {
        return value
            .replace("\\", "/")
            .removePrefix("./")
            .trim()
            .lowercase()
    }

    private fun sendTelemetry(request: TelemetryRequest) {
        val httpRequest = HttpRequest.newBuilder()
            .uri(URI.create("$baseUrl/api/telemetry"))
            .timeout(Duration.ofSeconds(10))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(gson.toJson(request)))
            .build()
        val response = client.send(httpRequest, HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) {
            val detail = extractError(response.body())
            throw IllegalStateException("HTTP ${response.statusCode()} from backend: $detail")
        }
    }
}
