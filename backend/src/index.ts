import "dotenv/config";
import crypto from "node:crypto";
import cors from "cors";
import express from "express";
import { db, initializeDb } from "./db.js";
import { generateSearchReplace } from "./litellm.js";
import { defaultModel as generatedDefaultModel, supportedModels } from "./modelCatalog.generated.js";
import { generateRequestSchema, telemetryRequestSchema } from "./schemas.js";
import type { GenerateResponse, RecentActivityRow, StatsResponse, TelemetryRequest } from "./types.js";

const port = Number(process.env.PORT ?? 3001);
const configuredModel = process.env.LITELLM_MODEL;
const defaultModel =
  configuredModel &&
  supportedModels.includes(configuredModel as (typeof supportedModels)[number])
    ? configuredModel
    : generatedDefaultModel;
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

initializeDb();

type GenerateFn = typeof generateSearchReplace;

export function createApp(deps?: { generateFn?: GenerateFn }) {
  const app = express();
  const generateFn = deps?.generateFn ?? generateSearchReplace;

  app.use(cors({ origin: corsOrigin }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/models", (_req, res) => {
    res.json({
      defaultModel,
      supportedModels: [...supportedModels]
    });
  });

  app.post("/api/generate", async (req, res) => {
  const parsed = generateRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { prompt, context } = parsed.data;
  const requestedModel = parsed.data.model?.trim() || defaultModel;
  if (!supportedModels.includes(requestedModel as (typeof supportedModels)[number])) {
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
    const raw = await generateFn({
      prompt,
      model: requestedModel,
      filePath: context.filePath,
      selectionOrCaretSnippet: context.selectionOrCaretSnippet,
      languageId: context.languageId
    });
    db.prepare(
      `INSERT INTO tasks (task_id, prompt_snippet, model, status, created_at)
       VALUES (?, ?, ?, 'SUCCEEDED', ?)`
    ).run(taskId, promptSnippet, requestedModel, now);

    const response: GenerateResponse = {
      task_id: taskId,
      diff_id: diffId,
      raw,
      model: requestedModel
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
  const totals = db
    .prepare(
      `SELECT
         SUM(CASE WHEN type = 'DIFF_RENDERED' THEN 1 ELSE 0 END) AS diffRendered,
         SUM(CASE WHEN type = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN type = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
         SUM(CASE WHEN type = 'ITERATED' THEN 1 ELSE 0 END) AS iterated
       FROM events`
    )
    .get() as { diffRendered: number | null; accepted: number | null; rejected: number | null; iterated: number | null };

  const totalTasksRow = db
    .prepare(`SELECT COUNT(DISTINCT task_id) AS totalTasks FROM tasks WHERE status = 'SUCCEEDED'`)
    .get() as { totalTasks: number };

  const avgIterationsRow = db
    .prepare(
      `WITH accepted_per_task AS (
         SELECT task_id, MIN(created_at) AS first_accept_at
         FROM events
         WHERE type = 'ACCEPTED'
         GROUP BY task_id
       ),
       iterations_before_accept AS (
         SELECT a.task_id, COUNT(e.id) AS iteration_count
         FROM accepted_per_task a
         LEFT JOIN events e
           ON e.task_id = a.task_id
          AND e.type = 'ITERATED'
          AND e.created_at <= a.first_accept_at
         GROUP BY a.task_id
       )
       SELECT COALESCE(AVG(iteration_count), 0) AS avgIterations
       FROM iterations_before_accept`
    )
    .get() as { avgIterations: number };

  const timeSeries = db
    .prepare(
      `SELECT
         strftime('%Y-%m-%d', created_at) AS bucket,
         SUM(CASE WHEN type = 'ACCEPTED' THEN 1 ELSE 0 END) AS accepted,
         SUM(CASE WHEN type = 'REJECTED' THEN 1 ELSE 0 END) AS rejected
       FROM events
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
       ORDER BY e.created_at DESC
       LIMIT 20`
    )
    .all() as RecentActivityRow[];

  const diffRendered = totals.diffRendered ?? 0;
  const accepted = totals.accepted ?? 0;
  const rejected = totals.rejected ?? 0;
  const iterated = totals.iterated ?? 0;

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
    recentActivity
  };

    res.json(response);
  });

  return app;
}

if (process.env.NODE_ENV !== "test") {
  createApp().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Backend listening on http://localhost:${port}`);
  });
}
