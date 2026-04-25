import type { AgentOperation, GenerateMode, GenerateRequest } from "./types.js";

type ParsedJsonPlan = Partial<AgentOperation> & {
  kind?: string;
  operation?: string;
  target_path?: string;
  targetFile?: string;
  filePath?: string;
};

const searchReplaceRegex =
  /<<<<\s*SEARCH\s*\n([\s\S]*?)\n====\s*\n([\s\S]*?)\n>>>>\s*REPLACE/im;

export function normalizeAgentOperation(raw: string, request: GenerateRequest): AgentOperation | null {
  const mode = request.mode ?? "update_selection";
  const parsedJson = parseJsonPlan(raw);
  if (parsedJson) {
    const normalized = normalizeJsonPlan(parsedJson, request, mode);
    if (normalized) {
      return normalized;
    }
  }

  const searchReplace = trySearchReplacePlan(raw, request, mode);
  if (searchReplace) {
    return searchReplace;
  }

  const codeOnly = fallbackCodeBlock(raw);
  if (!codeOnly) {
    return null;
  }

  if (mode === "create_file") {
    const targetFilePath = request.context.targetFilePath?.trim();
    if (!targetFilePath) {
      return null;
    }
    return {
      kind: "create_file",
      summary: `Create ${targetFilePath}`,
      targetFilePath,
      content: codeOnly
    };
  }

  if (mode === "insert_into_file") {
    const anchor = request.context.selectionOrCaretSnippet.trim();
    if (!anchor) {
      return null;
    }
    return {
      kind: "insert_after",
      summary: "Insert new code after the selected context",
      targetFilePath: request.context.filePath,
      anchor,
      content: codeOnly
    };
  }

  const search = request.context.selectionOrCaretSnippet.trim();
  if (!search) {
    return null;
  }
  return {
    kind: "replace_range",
    summary: "Update the selected code",
    targetFilePath: request.context.filePath,
    search,
    replace: codeOnly
  };
}

function normalizeJsonPlan(
  plan: ParsedJsonPlan,
  request: GenerateRequest,
  mode: GenerateMode
): AgentOperation | null {
  const requestedTarget = request.context.targetFilePath?.trim();
  const currentFilePath = request.context.filePath;
  const kind = normalizeKind(plan.kind ?? plan.operation, mode);
  const summary = cleanText(plan.summary) || defaultSummary(kind, requestedTarget ?? currentFilePath);
  const targetFilePath = cleanText(
    plan.targetFilePath ?? plan.target_path ?? plan.targetFile ?? plan.filePath
  ) || requestedTarget || currentFilePath;

  if (kind === "replace_range") {
    const search = cleanText(plan.search) || request.context.selectionOrCaretSnippet.trim();
    const replace = cleanText(plan.replace) ?? cleanText(plan.content);
    if (!search || !replace) {
      return null;
    }
    return {
      kind,
      summary,
      targetFilePath,
      search,
      replace
    };
  }

  if (kind === "insert_after") {
    const anchor = cleanText(plan.anchor) || request.context.selectionOrCaretSnippet.trim();
    const content = cleanText(plan.content) ?? cleanText(plan.replace);
    if (!anchor || !content) {
      return null;
    }
    return {
      kind,
      summary,
      targetFilePath,
      anchor,
      content
    };
  }

  const content = cleanText(plan.content) ?? cleanText(plan.replace);
  const unwrapped = unwrapNestedCreateFileContent(content, targetFilePath);
  const safeContent = unwrapped?.content ?? content;
  const safeSummary = unwrapped?.summary ?? summary;

  if (!safeContent || !targetFilePath) {
    return null;
  }
  return {
    kind: "create_file",
    summary: safeSummary,
    targetFilePath,
    content: safeContent
  };
}

function normalizeKind(kind: string | undefined, mode: GenerateMode): AgentOperation["kind"] {
  const value = kind?.trim().toLowerCase();
  switch (value) {
    case "replace_range":
    case "replace":
    case "update":
    case "search_replace":
      return "replace_range";
    case "insert_after":
    case "insert":
    case "append":
    case "append_to_file":
      return "insert_after";
    case "create_file":
    case "create":
    case "new_file":
      return "create_file";
    default:
      if (mode === "create_file") {
        return "create_file";
      }
      if (mode === "insert_into_file") {
        return "insert_after";
      }
      return "replace_range";
  }
}

function trySearchReplacePlan(raw: string, request: GenerateRequest, mode: GenerateMode): AgentOperation | null {
  const normalized = stripOuterMarkdownFences(raw);
  const match = normalized.match(searchReplaceRegex);
  if (!match) {
    return null;
  }

  const search = match[1].trimEnd();
  const replace = match[2].trimEnd();
  if (!search || !replace) {
    return null;
  }

  if (mode === "insert_into_file") {
    return {
      kind: "replace_range",
      summary: "Update the current file with the generated patch",
      targetFilePath: request.context.filePath,
      search,
      replace
    };
  }

  if (mode === "create_file") {
    const targetFilePath = request.context.targetFilePath?.trim();
    if (!targetFilePath) {
      return null;
    }
    return {
      kind: "create_file",
      summary: `Create ${targetFilePath}`,
      targetFilePath,
      content: replace
    };
  }

  return {
    kind: "replace_range",
    summary: "Update the selected code",
    targetFilePath: request.context.filePath,
    search,
    replace
  };
}

function parseJsonPlan(raw: string): ParsedJsonPlan | null {
  const stripped = stripOuterMarkdownFences(raw);
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  const candidate = stripped.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as ParsedJsonPlan;
  } catch {
    return null;
  }
}

function fallbackCodeBlock(raw: string): string | null {
  const cleaned = stripOuterMarkdownFences(raw).trim();
  return cleaned.length >= 3 ? cleaned : null;
}

function stripOuterMarkdownFences(raw: string): string {
  let text = raw.replace(/\r\n/g, "\n").trim();
  for (let i = 0; i < 3; i += 1) {
    const wrapped = text.match(/^```[^\n]*\n?([\s\S]*?)\n?```\s*$/);
    if (!wrapped) {
      break;
    }
    text = wrapped[1].trim();
  }
  return text;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function unwrapNestedCreateFileContent(
  content: string | undefined,
  expectedTargetFilePath: string
): { content: string; summary?: string } | null {
  if (!content) {
    return null;
  }
  const nested = parseJsonPlan(content);
  if (!nested) {
    return null;
  }

  const nestedKind = normalizeKind(nested.kind ?? nested.operation, "create_file");
  if (nestedKind !== "create_file") {
    return null;
  }

  const nestedTargetPath = cleanText(
    nested.targetFilePath ?? nested.target_path ?? nested.targetFile ?? nested.filePath
  );
  if (!nestedTargetPath || normalizePathLike(nestedTargetPath) !== normalizePathLike(expectedTargetFilePath)) {
    return null;
  }

  const nestedContent = cleanText(nested.content) ?? cleanText(nested.replace);
  if (!nestedContent) {
    return null;
  }

  return {
    content: nestedContent,
    summary: cleanText(nested.summary)
  };
}

function normalizePathLike(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .trim()
    .toLowerCase();
}

function defaultSummary(kind: AgentOperation["kind"], targetFilePath: string): string {
  if (kind === "create_file") {
    return `Create ${targetFilePath}`;
  }
  if (kind === "insert_after") {
    return `Add code in ${targetFilePath}`;
  }
  return `Update ${targetFilePath}`;
}
