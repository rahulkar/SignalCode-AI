const SYSTEM_PROMPT = `You are an expert coding assistant for an IntelliJ plugin.
Return exactly one JSON object and nothing else.

Schema:
{
  "kind": "replace_range" | "insert_after" | "create_file",
  "summary": "Short one-line summary",
  "targetFilePath": "path/to/file.ext",
  "search": "exact existing code to replace",
  "replace": "full replacement code",
  "anchor": "exact existing code after which new code should be inserted",
  "content": "full new content"
}

Rules:
1) Use only one operation.
2) For "replace_range", include "search" and "replace".
3) For "insert_after", include "anchor" and "content".
4) For "create_file", include "targetFilePath" and "content".
5) Match the requested mode unless the instruction clearly requires a safer operation.
6) SEARCH or anchor text must match existing code exactly when you reference current code.
7) No markdown, no code fences, and no commentary outside the JSON object.`;

interface LiteLlmResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    response_cost?: number;
  };
  response_cost?: number;
  _hidden_params?: {
    response_cost?: number;
  };
}

interface LiteLlmModelsResponse {
  data?: Array<{
    id?: string;
  }>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(baseMs: number): number {
  const delta = Math.floor(baseMs * 0.2);
  return baseMs + Math.floor(Math.random() * (delta * 2 + 1)) - delta;
}

export async function generateAgentPlanText(params: {
  prompt: string;
  filePath: string;
  selectionOrCaretSnippet: string;
  projectRootPath?: string;
  targetFilePath?: string;
  languageId?: string;
  mode?: string;
  model?: string;
}): Promise<{
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };
}> {
  const baseUrl = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
  const model = params.model ?? process.env.LITELLM_MODEL ?? "gemini-flash";
  const apiKey = process.env.LITELLM_API_KEY;

  const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  const payload = JSON.stringify({
    model,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Project root: ${params.projectRootPath ?? "unknown"}
Current file: ${params.filePath}
Requested mode: ${params.mode ?? "update_selection"}
Requested target path: ${params.targetFilePath ?? "current file"}
Language: ${params.languageId ?? "unknown"}
Selected snippet:
${params.selectionOrCaretSnippet}

Instruction:
${params.prompt}`
      }
    ]
  });

  let response: Response | null = null;
  let lastErrorBody = "";
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: payload,
        signal: AbortSignal.timeout(120_000)
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : String(error);
      const hint = name === "AbortError" || message.includes("timeout") ? " (timed out after 120s)" : "";
      throw new Error(
        `Cannot reach LiteLLM at ${baseUrl}${hint}: ${message}. ` +
          `If the proxy runs in Docker, ensure it is up (for example: docker compose up litellm) and ` +
          `when the backend runs on the host set LITELLM_BASE_URL=http://localhost:4000.`
      );
    }

    if (response.ok) {
      break;
    }

    lastErrorBody = await response.text();
    const isRateLimited = response.status === 429 || lastErrorBody.includes("\"code\":\"429\"");
    if (!isRateLimited || attempt === maxAttempts) {
      break;
    }
    await sleep(jitter(500 * attempt));
  }

  if (!response || !response.ok) {
    const status = response?.status ?? 0;
    const body = lastErrorBody || (response ? await response.text() : "");
    throw new Error(`LiteLLM request failed: ${status} ${body}`);
  }

  const data = (await response.json()) as LiteLlmResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LiteLLM returned empty content");
  }
  const usage = normalizeUsage(data);
  return {
    content,
    usage
  };
}

function normalizeUsage(data: LiteLlmResponse): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
} | undefined {
  const promptTokens = finiteNumber(data.usage?.prompt_tokens);
  const completionTokens = finiteNumber(data.usage?.completion_tokens);
  const totalTokens = finiteNumber(data.usage?.total_tokens);
  const costUsd =
    finiteNumber(data.usage?.response_cost) ??
    finiteNumber(data.usage?.cost) ??
    finiteNumber(data.response_cost) ??
    finiteNumber(data._hidden_params?.response_cost);

  if (promptTokens == null && completionTokens == null && totalTokens == null && costUsd == null) {
    return undefined;
  }

  return {
    promptTokens: promptTokens ?? undefined,
    completionTokens: completionTokens ?? undefined,
    totalTokens: totalTokens ?? undefined,
    costUsd: costUsd ?? undefined
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function fetchAvailableModelIds(): Promise<string[]> {
  const baseUrl = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
  const apiKey = process.env.LITELLM_API_KEY;
  const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      signal: AbortSignal.timeout(10_000)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to fetch model list from LiteLLM: ${message}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LiteLLM /v1/models failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as LiteLlmModelsResponse;
  return (data.data ?? [])
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}
