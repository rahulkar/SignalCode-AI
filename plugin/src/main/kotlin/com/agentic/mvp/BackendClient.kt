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
            return gson.fromJson(response.body(), GenerateResponse::class.java)
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
