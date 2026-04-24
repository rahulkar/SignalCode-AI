import "dotenv/config";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import { db, initializeDb, resetTelemetryDb } from "./db.js";
import { fetchAvailableModelIds, generateSearchReplace } from "./litellm.js";
import { defaultModel as generatedDefaultModel, supportedModels } from "./modelCatalog.generated.js";
import { generateRequestSchema, telemetryRequestSchema } from "./schemas.js";
import type {
  GenerateResponse,
  IdeActivityResponse,
  IdeMonitorEvent,
  PostAcceptTaskReworkRow,
  RecentActivityRow,
  StatsResponse,
  TelemetryRequest
} from "./types.js";

const port = Number(process.env.PORT ?? 3001);
const configuredModel = process.env.LITELLM_MODEL;
const defaultModel: SupportedModel = configuredModel && isSupportedModel(configuredModel) ? configuredModel : generatedDefaultModel;
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

initializeDb();

type GenerateFn = typeof generateSearchReplace;
type ListModelsFn = typeof fetchAvailableModelIds;
type SupportedModel = (typeof supportedModels)[number];

function isSupportedModel(model: string): model is SupportedModel {
  return supportedModels.includes(model as SupportedModel);
}

export function createApp(deps?: { generateFn?: GenerateFn; listModelsFn?: ListModelsFn }) {
  const app = express();
  const generateFn = deps?.generateFn ?? generateSearchReplace;
  const listModelsFn = deps?.listModelsFn ?? fetchAvailableModelIds;

  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/models", async (_req, res) => {
    try {
      const liveModelIds = await listModelsFn();
      const responseModels: string[] = [...supportedModels];
      const availableModels = supportedModels.filter((model) => liveModelIds.includes(model));
      const responseDefault = responseModels.includes(defaultModel) ? defaultModel : responseModels[0];
      res.json({
        defaultModel: responseDefault,
        supportedModels: responseModels,
        availableModels
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line no-console
      console.warn("[/api/models] using catalog fallback:", message);
      res.json({
        defaultModel,
        supportedModels: [...supportedModels]
      });
    }
  });

  app.post("/api/generate", async (req, res) => {
  const parsed = generateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { prompt, context } = parsed.data;
  const requestedModel = parsed.data.model?.trim() || defaultModel;
  if (!isSupportedModel(requestedModel)) {
    return res.status(400).json({
      error: "Unsupported model",
      message: `Model '${requestedModel}' is not supported`,
      supportedModels
    });
  }
  const taskId = crypto.randomUUID();
  const diffId = crypto.randomUUID();
  const now = new Date().toISOString();
  const promptSnippet = prompt.slice(0, 120);

  try {
    let effectiveModel: SupportedModel = requestedModel;
    let raw: string;
    try {
      raw = await generateFn({
        prompt,
        model: effectiveModel,
        filePath: context.filePath,
        selectionOrCaretSnippet: context.selectionOrCaretSnippet,
        languageId: context.languageId
      });
    } catch (primaryError) {
      const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
      const shouldFallback =
        primaryMessage.includes("Invalid model name passed") || primaryMessage.includes("invalid model name");
      if (!shouldFallback) {
        throw primaryError;
      }

      const fallbackModel = await resolveFallbackModel(listModelsFn, effectiveModel);
      if (!fallbackModel || fallbackModel === effectiveModel) {
        throw primaryError;
      }

      // Retry once with another configured model that is currently live on the proxy.
      effectiveModel = fallbackModel;
      raw = await generateFn({
        prompt,
        model: effectiveModel,
        filePath: context.filePath,
        selectionOrCaretSnippet: context.selectionOrCaretSnippet,
        languageId: context.languageId
      });
    }

    db.prepare(
      `INSERT INTO tasks (task_id, prompt_snippet, model, status, created_at)
       VALUES (?, ?, ?, 'SUCCEEDED', ?)`
    ).run(taskId, promptSnippet, effectiveModel, now);

    const response: GenerateResponse = {
      task_id: taskId,
      diff_id: diffId,
      raw,
      model: effectiveModel
    };
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    db.prepare(
      `INSERT OR IGNORE INTO tasks (task_id, prompt_snippet, model, status, created_at)
       VALUES (?, ?, ?, 'FAILED', ?)`
    ).run(taskId, promptSnippet, requestedModel, now);
    // eslint-disable-next-line no-console
    console.error("[/api/generate]", message);
    return res.status(502).json({
      error: "Generation failed",
      message
    });
  }
  });

  app.post("/api/telemetry", (req, res) => {
  const parsed = telemetryRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }
  const body: TelemetryRequest = parsed.data;
  const timestamp = body.timestamp ?? new Date().toISOString();
  try {
    const source = typeof body.meta?.source === "string" ? body.meta.source : null;
    if (source === "ide-monitor") {
      db.prepare(
        `INSERT OR IGNORE INTO tasks (task_id, prompt_snippet, model, status, created_at)
         VALUES (?, ?, ?, 'SUCCEEDED', ?)`
      ).run(body.task_id, "IDE monitor event", "ide-monitor", timestamp);
    }

    const result = db.prepare(
      `INSERT OR IGNORE INTO events (task_id, diff_id, type, metadata, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(body.task_id, body.diff_id, body.event, JSON.stringify(body.meta ?? {}), timestamp);
    return res.status(202).json({ ok: true, inserted: result.changes > 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown DB error";
    if (message.includes("FOREIGN KEY constraint failed")) {
      return res.status(400).json({ error: "Unknown task_id for telemetry", message });
    }
    // eslint-disable-next-line no-console
    console.error("[/api/telemetry]", message);
    return res.status(500).json({ error: "Failed to store telemetry", message });
  }
  });

  app.get("/api/stats", (_req, res) => {
  const postAcceptExclusion = `COALESCE(e.metadata, '') NOT LIKE '%"source":"post-accept"%'`;

  const totals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN type = 'DIFF_RENDERED' THEN 1 ELSE 0 END) AS diffRendered,
         SUM(CASE WHEN type = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN type = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN type = 'ITERATED' THEN 1 ELSE 0 END) AS iterated
       FROM events e
       INNER JOIN tasks t ON t.task_id = e.task_id
       WHERE t.model != 'ide-monitor'
         AND ${postAcceptExclusion}`
    )
    .get() as { diffRendered: number | null; accepted: number | null; rejected: number | null; iterated: number | null };

  const totalTasksRow = db
    .prepare(`SELECT COUNT(DISTINCT task_id) AS totalTasks FROM tasks WHERE status = 'SUCCEEDED' AND model != 'ide-monitor'`)
    .get() as { totalTasks: number };

  const avgIterationsRow = db
    .prepare(
      `WITH accepted_per_task AS (
         SELECT e.task_id, MIN(e.created_at) AS first_accept_at
         FROM events e
         INNER JOIN tasks t ON t.task_id = e.task_id
         WHERE type = 'ACCEPTED'
           AND t.model != 'ide-monitor'
           AND ${postAcceptExclusion}
         GROUP BY e.task_id
       ),
       iterations_before_accept AS (
         SELECT a.task_id, COUNT(e.id) AS iteration_count
         FROM accepted_per_task a
         LEFT JOIN events e
           ON e.task_id = a.task_id
          AND e.type = 'ITERATED'
          AND e.created_at <= a.first_accept_at
         LEFT JOIN tasks t ON t.task_id = e.task_id
         WHERE (t.model != 'ide-monitor' OR t.model IS NULL)
           AND ${postAcceptExclusion}
         GROUP BY a.task_id
       )
       SELECT COALESCE(AVG(iteration_count), 0) AS avgIterations
       FROM iterations_before_accept`
    )
    .get() as { avgIterations: number };

  const timeSeries = db
    .prepare(
      `SELECT
         strftime('%Y-%m-%d', e.created_at) AS bucket,
         SUM(CASE WHEN type = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN type = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
       FROM events e
       INNER JOIN tasks t ON t.task_id = e.task_id
       WHERE t.model != 'ide-monitor'
         AND ${postAcceptExclusion}
       GROUP BY bucket
       ORDER BY bucket DESC
       LIMIT 30`
    )
    .all() as Array<{ bucket: string; accepted: number; rejected: number }>;

  const recentActivity = db
    .prepare(
      `SELECT
         e.created_at AS timestamp,
         t.prompt_snippet AS promptSnippet,
         t.model AS model,
         e.type AS outcome,
         e.task_id AS task_id,
         e.diff_id AS diff_id
       FROM events e
       INNER JOIN tasks t ON t.task_id = e.task_id
       WHERE t.model != 'ide-monitor'
         AND ${postAcceptExclusion}
       ORDER BY e.created_at DESC
       LIMIT 20`
    )
    .all() as RecentActivityRow[];

  const diffRendered = totals.diffRendered ?? 0;
  const accepted = totals.accepted ?? 0;
  const rejected = totals.rejected ?? 0;
  const iterated = totals.iterated ?? 0;

  const acceptedRows = db
    .prepare(
      `SELECT e.task_id AS task_id, e.created_at AS created_at
       FROM events e
       INNER JOIN tasks t ON t.task_id = e.task_id
       WHERE e.type = 'ACCEPTED'
         AND t.model != 'ide-monitor'
       ORDER BY e.created_at ASC`
    )
    .all() as Array<{ task_id: string; created_at: string }>;

  const postAcceptRows = db
    .prepare(
      `SELECT task_id, created_at, metadata
       FROM events
       WHERE COALESCE(metadata, '') LIKE '%"source":"post-accept"%'
       ORDER BY created_at ASC`
    )
    .all() as Array<{ task_id: string; created_at: string; metadata: string | null }>;

  const acceptedByTask = new Map<string, string>();
  for (const row of acceptedRows) {
    if (!acceptedByTask.has(row.task_id)) {
      acceptedByTask.set(row.task_id, row.created_at);
    }
  }

  const firstPostAcceptByTask = new Map<string, string>();
  const maxCharDeltaByTask = new Map<string, number>();
  for (const row of postAcceptRows) {
    if (!acceptedByTask.has(row.task_id)) {
      continue;
    }
    if (!firstPostAcceptByTask.has(row.task_id)) {
      firstPostAcceptByTask.set(row.task_id, row.created_at);
    }
    const meta = parseMeta(row.metadata);
    const charDelta = typeof meta.charDelta === "number" ? meta.charDelta : null;
    if (charDelta !== null) {
      const previous = maxCharDeltaByTask.get(row.task_id) ?? 0;
      maxCharDeltaByTask.set(row.task_id, Math.max(previous, charDelta));
    }
  }

  const acceptedTaskCount = acceptedByTask.size;
  const editedTaskCount = firstPostAcceptByTask.size;
  const editedTaskRate = acceptedTaskCount === 0 ? 0 : (editedTaskCount / acceptedTaskCount) * 100;
  const avgCharDelta =
    maxCharDeltaByTask.size === 0
      ? 0
      : [...maxCharDeltaByTask.values()].reduce((sum, value) => sum + value, 0) / maxCharDeltaByTask.size;

  const secondsToFirstEdit = [...firstPostAcceptByTask.entries()]
    .map(([taskId, firstEditAt]) => {
      const acceptedAt = acceptedByTask.get(taskId);
      if (!acceptedAt) {
        return null;
      }
      const deltaMs = new Date(firstEditAt).getTime() - new Date(acceptedAt).getTime();
      return Number.isFinite(deltaMs) ? Math.max(0, deltaMs / 1000) : null;
    })
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);

  const medianSecondsToFirstEdit =
    secondsToFirstEdit.length === 0
      ? 0
      : secondsToFirstEdit.length % 2 === 1
        ? secondsToFirstEdit[Math.floor(secondsToFirstEdit.length / 2)]
        : (secondsToFirstEdit[secondsToFirstEdit.length / 2 - 1] + secondsToFirstEdit[secondsToFirstEdit.length / 2]) / 2;

  const response: StatsResponse = {
    acceptanceRate: diffRendered === 0 ? 0 : (accepted / diffRendered) * 100,
    totalTasks: totalTasksRow.totalTasks,
    averageIterationsBeforeAccept: Number(avgIterationsRow.avgIterations.toFixed(2)),
    totals: {
      diffRendered,
      accepted,
      rejected,
      iterated
    },
    timeSeries: [...timeSeries].reverse(),
    recentActivity,
    postAccept: {
      editedTaskRate: Number(editedTaskRate.toFixed(1)),
      avgCharDelta: Number(avgCharDelta.toFixed(1)),
      medianSecondsToFirstEdit: Number(medianSecondsToFirstEdit.toFixed(1))
    }
  };

    res.json(response);
  });

  app.get("/api/ide/activity", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT metadata, created_at
         FROM events
         ORDER BY created_at DESC
         LIMIT 100`
      )
      .all() as Array<{ metadata: string | null; created_at: string }>;

    const monitorSignals = rows
      .map((row) => ({
        created_at: row.created_at,
        meta: parseMeta(row.metadata)
      }))
      .filter((row) => row.meta.source === "ide-monitor");

    const fileSignals = monitorSignals.map((row) => ({
      created_at: row.created_at,
      meta: row.meta
    }));

    const currentFile = getMetaString(
      fileSignals.find((row) => row.meta.activityType === "opened" && typeof row.meta.filePath === "string")?.meta,
      "filePath"
    );
    const lastEditedFile = getMetaString(
      fileSignals.find((row) => row.meta.activityType === "edited" && typeof row.meta.filePath === "string")?.meta,
      "filePath"
    );
    const lastAddedFile = getMetaString(
      fileSignals.find((row) => row.meta.activityType === "created" && typeof row.meta.filePath === "string")?.meta,
      "filePath"
    );

    const lastHeartbeat =
      fileSignals.find((row) => row.meta.activityType === "heartbeat")?.created_at ?? fileSignals[0]?.created_at ?? null;
    const ideConnected = isTimestampFresh(lastHeartbeat, 45_000);

    const response: IdeActivityResponse = {
      ideConnected,
      lastEventAt: fileSignals[0]?.created_at ?? null,
      currentFile,
      lastEditedFile,
      lastAddedFile
    };

    res.json(response);
  });

  app.post("/api/admin/reset-telemetry", (_req, res) => {
    try {
      resetTelemetryDb();
      res.status(200).json({ ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown DB error";
      // eslint-disable-next-line no-console
      console.error("[/api/admin/reset-telemetry]", message);
      res.status(500).json({ ok: false, error: "Failed to reset telemetry", message });
    }
  });

  app.get("/api/ide/events", (_req, res) => {
    const rows = db
      .prepare(
        `SELECT metadata, created_at
         FROM events
         ORDER BY created_at DESC
         LIMIT 250`
      )
      .all() as Array<{ metadata: string | null; created_at: string }>;

    const events: IdeMonitorEvent[] = rows
      .map((row) => ({
        timestamp: row.created_at,
        meta: parseMeta(row.metadata)
      }))
      .filter((row) => row.meta.source === "ide-monitor")
      .slice(0, 10)
      .map((row) => ({
        timestamp: row.timestamp,
        activityType: getMetaString(row.meta, "activityType") ?? "unknown",
        filePath: getMetaString(row.meta, "filePath"),
        languageId: getMetaString(row.meta, "languageId")
      }));

    res.json({ events });
  });

  app.get("/api/stats/post-accept-tasks", (_req, res) => {
    const acceptedRows = db
      .prepare(
        `SELECT
           e.task_id AS task_id,
           MIN(e.created_at) AS firstAcceptedAt,
           t.prompt_snippet AS promptSnippet,
           t.model AS model
         FROM events e
         INNER JOIN tasks t ON t.task_id = e.task_id
         WHERE e.type = 'ACCEPTED'
           AND t.model != 'ide-monitor'
         GROUP BY e.task_id`
      )
      .all() as Array<{ task_id: string; firstAcceptedAt: string; promptSnippet: string; model: string }>;

    const postAcceptRows = db
      .prepare(
        `SELECT task_id, created_at, metadata
         FROM events
         WHERE COALESCE(metadata, '') LIKE '%"source":"post-accept"%'
         ORDER BY created_at ASC`
      )
      .all() as Array<{ task_id: string; created_at: string; metadata: string | null }>;

    const acceptedByTask = new Map(
      acceptedRows.map((row) => [
        row.task_id,
        { acceptedAt: row.firstAcceptedAt, promptSnippet: row.promptSnippet, model: row.model }
      ])
    );

    const aggregates = new Map<
      string,
      { firstEditedAt: string; maxCharDelta: number; maxLineDelta: number; editsAfterAccept: number }
    >();

    for (const row of postAcceptRows) {
      const accepted = acceptedByTask.get(row.task_id);
      if (!accepted) continue;
      if (new Date(row.created_at).getTime() < new Date(accepted.acceptedAt).getTime()) continue;

      const meta = parseMeta(row.metadata);
      const charDelta = typeof meta.charDelta === "number" ? meta.charDelta : 0;
      const lineDelta = typeof meta.lineDelta === "number" ? meta.lineDelta : 0;
      const editsAfterAccept = typeof meta.editsAfterAccept === "number" ? meta.editsAfterAccept : 0;

      const current = aggregates.get(row.task_id);
      if (!current) {
        aggregates.set(row.task_id, {
          firstEditedAt: row.created_at,
          maxCharDelta: charDelta,
          maxLineDelta: lineDelta,
          editsAfterAccept
        });
      } else {
        current.maxCharDelta = Math.max(current.maxCharDelta, charDelta);
        current.maxLineDelta = Math.max(current.maxLineDelta, lineDelta);
        current.editsAfterAccept = Math.max(current.editsAfterAccept, editsAfterAccept);
      }
    }

    const rows: PostAcceptTaskReworkRow[] = [...aggregates.entries()]
      .map(([taskId, aggregate]) => {
        const accepted = acceptedByTask.get(taskId);
        if (!accepted) return null;
        const secondsToFirstEdit =
          (new Date(aggregate.firstEditedAt).getTime() - new Date(accepted.acceptedAt).getTime()) / 1000;
        return {
          taskId,
          promptSnippet: accepted.promptSnippet,
          model: accepted.model,
          firstAcceptedAt: accepted.acceptedAt,
          firstEditedAt: aggregate.firstEditedAt,
          secondsToFirstEdit: Number(Math.max(secondsToFirstEdit, 0).toFixed(1)),
          maxCharDelta: aggregate.maxCharDelta,
          maxLineDelta: aggregate.maxLineDelta,
          editsAfterAccept: aggregate.editsAfterAccept
        };
      })
      .filter((row): row is PostAcceptTaskReworkRow => row !== null)
      .sort((a, b) => b.maxCharDelta - a.maxCharDelta)
      .slice(0, 20);

    res.json({ rows });
  });

  return app;
}

function parseMeta(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getMetaString(meta: Record<string, unknown> | undefined, key: string): string | null {
  if (!meta) return null;
  const value = meta[key];
  return typeof value === "string" ? value : null;
}

function isTimestampFresh(timestamp: string | null, ttlMs: number): boolean {
  if (!timestamp) return false;
  const millis = new Date(timestamp).getTime();
  if (Number.isNaN(millis)) return false;
  return Date.now() - millis <= ttlMs;
}

async function resolveFallbackModel(
  listModelsFn: ListModelsFn,
  requestedModel: SupportedModel
): Promise<SupportedModel | null> {
  try {
    const liveModelIds = await listModelsFn();
    const availableConfiguredModels = supportedModels.filter((model) => liveModelIds.includes(model));
    if (availableConfiguredModels.length === 0) {
      return requestedModel === defaultModel ? null : defaultModel;
    }
    if (availableConfiguredModels.includes(defaultModel)) {
      return defaultModel;
    }
    return availableConfiguredModels[0] ?? null;
  } catch {
    return requestedModel === defaultModel ? null : defaultModel;
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

if (process.env.NODE_ENV !== "test" && isDirectRun) {
  createApp().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://localhost:${port}`);
  });
}
