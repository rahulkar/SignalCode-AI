const SYSTEM_PROMPT = `You are an expert coding assistant.
Return exactly one edit block in this format and nothing else (no markdown, no \`\`\` fences):
<<<<SEARCH
[exact original code]
====
[exact new code]
>>>>REPLACE

Rules:
1) SEARCH must match the original snippet exactly.
2) REPLACE must be complete replacement code.
3) No commentary, no diff headers, no other text outside the block.`;

interface LiteLlmResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function stripOuterMarkdownFences(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").trim();
  for (let i = 0; i < 3; i++) {
    const wrapped = t.match(/^```[^\n]*\n?([\s\S]*?)\n?```\s*$/);
    if (!wrapped) {
      break;
    }
    t = wrapped[1].trim();
  }
  t = t.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "").trim();
  return t;
}

/** Remove common diff / model junk before the real source starts. */
function stripDiffNoise(block: string): string {
  let b = block.replace(/\r\n/g, "\n").trim();
  const lines = b.split("\n");
  if (lines[0] && /^diff\b/i.test(lines[0])) {
    b = lines.slice(1).join("\n").trim();
  }
  b = b.replace(/^---[^\n]*\n\+\+\+[^\n]*\n(@@[^\n]*\n)?/, "");
  // Same-line: `diff path"; import` → drop through first import/export/const
  b = b.replace(/^diff\s+[^\n]+?(?=\bimport\b|\bexport\b|\bconst\b|\blet\b|\bvar\b|\bfunction\b|\bclass\b|\/\*)/i, "");
  return b.trim();
}

/**
 * If the model prefixed garbage, align to the user's snippet when it appears in `search`.
 */
function alignSearchWithHint(search: string, hint: string): string {
  const h = hint.replace(/\r\n/g, "\n").trim();
  if (!h) {
    return search;
  }
  const s = search.replace(/\r\n/g, "\n");
  let idx = s.indexOf(h);
  if (idx >= 0) {
    return s.slice(idx).trimEnd();
  }
  const hLine = h.split("\n").find((l) => l.trim().length > 0);
  if (hLine) {
    const t = hLine.trim();
    idx = s.indexOf(t);
    if (idx >= 0) {
      return s.slice(idx).trimEnd();
    }
  }
  return search;
}

function tryCanonicalMarkers(text: string): string | null {
  const m = text.match(/<<<<\s*SEARCH\s*\n([\s\S]*?)\n====\s*\n([\s\S]*?)\n>>>>\s*REPLACE/im);
  if (!m) {
    return null;
  }
  return `<<<<SEARCH\n${m[1]}\n====\n${m[2]}\n>>>>REPLACE`;
}

/** Models often emit old/new separated only by a line of ==== (inside ```diff). */
function tryEqualsDelimiterBlock(text: string, hintSnippet: string): string | null {
  const norm = text.replace(/\r\n/g, "\n");
  const delim = norm.match(/\r?\n====\r?\n/);
  if (!delim || delim.index === undefined) {
    return null;
  }
  const d = delim[0];
  let search = norm.slice(0, delim.index).trim();
  let replace = norm.slice(delim.index + d.length).trim();
  search = stripDiffNoise(search);
  replace = stripDiffNoise(replace);
  search = alignSearchWithHint(search, hintSnippet);
  if (search.length < 2 || replace.length < 2) {
    return null;
  }
  return `<<<<SEARCH\n${search}\n====\n${replace}\n>>>>REPLACE`;
}

function normalizeSearchReplace(raw: string, hintSnippet: string): string | null {
  let text = stripOuterMarkdownFences(raw);

  const canonical = tryCanonicalMarkers(text);
  if (canonical) {
    return canonical;
  }

  const relaxed = text.match(
    /<<<<\s*SEARCH\s*\n([\s\S]*?)\n====\s*\n([\s\S]*?)(?:\n>>>>\s*REPLACE)?$/im
  );
  if (relaxed) {
    return `<<<<SEARCH\n${relaxed[1]}\n====\n${relaxed[2]}\n>>>>REPLACE`;
  }

  const fallback = tryEqualsDelimiterBlock(text, hintSnippet);
  if (fallback) {
    return fallback;
  }

  return null;
}

export async function generateSearchReplace(params: {
  prompt: string;
  filePath: string;
  selectionOrCaretSnippet: string;
  languageId?: string;
}): Promise<string> {
  const baseUrl = process.env.LITELLM_BASE_URL ?? "http://localhost:4000";
  const model = process.env.LITELLM_MODEL ?? "gemini-flash";
  const apiKey = process.env.LITELLM_API_KEY;

  const url = `${baseUrl.replace(/\/$/, "")}/v1/chat/completions`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `File: ${params.filePath}
Language: ${params.languageId ?? "unknown"}
Selected snippet:
${params.selectionOrCaretSnippet}

Instruction:
${params.prompt}`
          }
        ]
      }),
      signal: AbortSignal.timeout(120_000)
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    const msg = e instanceof Error ? e.message : String(e);
    const hint =
      name === "AbortError" || msg.includes("timeout")
        ? " (timed out after 120s)"
        : "";
    throw new Error(
      `Cannot reach LiteLLM at ${baseUrl}${hint}: ${msg}. ` +
        `If the proxy runs in Docker, ensure it is up (e.g. docker compose up litellm) and ` +
        `when the backend runs on the host set LITELLM_BASE_URL=http://localhost:4000.`
    );
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LiteLLM request failed: ${response.status} ${body}`);
  }

  const data = (await response.json()) as LiteLlmResponse;
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error("LiteLLM returned empty content");
  }
  const normalized = normalizeSearchReplace(content, params.selectionOrCaretSnippet);
  if (!normalized) {
    throw new Error(`Model did not return valid SEARCH/REPLACE block. Raw response: ${content}`);
  }
  return normalized;
}
