import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { db, resetTelemetryDb } from "./db.js";
import { createApp } from "./index.js";

function clearDb(): void {
  resetTelemetryDb();
}

describe("backend integrity behaviors", () => {
  beforeEach(() => {
    clearDb();
  });

  it("failed generate does not increase succeeded task count", async () => {
    const app = createApp({
      generateFn: async () => {
        throw new Error("mock upstream failure");
      }
    });

    const generateResponse = await request(app).post("/api/generate").send({
      prompt: "refactor this",
      context: {
        filePath: "/tmp/file.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });

    assert.equal(generateResponse.status, 502);

    const statsResponse = await request(app).get("/api/stats");
    assert.equal(statsResponse.status, 200);
    assert.equal(statsResponse.body.totalTasks, 0);
  });

  it("returns supported model list", async () => {
    const app = createApp();
    const response = await request(app).get("/api/models");
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.supportedModels));
    assert.ok(response.body.supportedModels.includes("gemini-flash"));
    assert.equal(typeof response.body.defaultModel, "string");
  });

  it("returns full configured model list and live availability subset", async () => {
    const app = createApp({
      listModelsFn: async () => ["gemini-flash", "gemini-2.5-pro", "other-model"]
    });
    const response = await request(app).get("/api/models");
    assert.equal(response.status, 200);
    assert.ok(response.body.supportedModels.includes("gemini-2.5-flash"));
    assert.ok(response.body.supportedModels.includes("gemini-2.5-flash-lite"));
    assert.ok(response.body.supportedModels.includes("gemini-2.5-pro"));
    assert.deepEqual(response.body.availableModels, ["gemini-flash", "gemini-2.5-pro"]);
    assert.equal(response.body.defaultModel, "gemini-flash");
  });

  it("rejects unsupported model names", async () => {
    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });
    const response = await request(app).post("/api/generate").send({
      prompt: "bump a",
      model: "gemini-unknown-xyz",
      context: {
        filePath: "/tmp/file.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Unsupported model");
    assert.ok(Array.isArray(response.body.supportedModels));
  });

  it("falls back to another live configured model when a selected alias becomes unavailable", async () => {
    const app = createApp({
      generateFn: async ({ model }) => {
        if (model === "gemini-2.5-pro") {
          throw new Error("Invalid model name passed in model=gemini-2.5-pro");
        }
        return "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE";
      },
      listModelsFn: async () => ["gemini-flash"]
    });

    const response = await request(app).post("/api/generate").send({
      prompt: "bump a",
      model: "gemini-2.5-pro",
      context: {
        filePath: "/tmp/file.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.model, "gemini-flash");
  });

  it("falls back from a stale default model to the first live configured model", async () => {
    const app = createApp({
      generateFn: async ({ model }) => {
        if (model === "gemini-flash") {
          throw new Error("Invalid model name passed in model=gemini-flash");
        }
        return "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE";
      },
      listModelsFn: async () => ["gemini-2.5-pro"]
    });

    const response = await request(app).post("/api/generate").send({
      prompt: "bump a",
      context: {
        filePath: "/tmp/file.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.model, "gemini-2.5-pro");
  });

  it("duplicate telemetry events are idempotent", async () => {
    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    const generateResponse = await request(app).post("/api/generate").send({
      prompt: "bump a",
      context: {
        filePath: "/tmp/file.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });

    assert.equal(generateResponse.status, 200);
    const taskId = generateResponse.body.task_id as string;
    const diffId = generateResponse.body.diff_id as string;

    const firstEvent = await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: diffId,
      event: "ACCEPTED"
    });
    const secondEvent = await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: diffId,
      event: "ACCEPTED"
    });

    assert.equal(firstEvent.status, 202);
    assert.equal(firstEvent.body.inserted, true);
    assert.equal(secondEvent.status, 202);
    assert.equal(secondEvent.body.inserted, false);

    const statsResponse = await request(app).get("/api/stats");
    assert.equal(statsResponse.status, 200);
    assert.equal(statsResponse.body.totals.accepted, 1);
  });

  it("returns ide activity summary and clears telemetry from admin endpoint", async () => {
    const app = createApp();
    const taskId = "ide-monitor-test";

    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: "diff-opened",
      event: "DIFF_RENDERED",
      meta: { source: "ide-monitor", activityType: "opened", filePath: "/tmp/file.ts" }
    });

    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: "diff-edited",
      event: "DIFF_RENDERED",
      meta: { source: "ide-monitor", activityType: "edited", filePath: "/tmp/file.ts" }
    });

    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: "diff-created",
      event: "DIFF_RENDERED",
      meta: { source: "ide-monitor", activityType: "created", filePath: "/tmp/new-file.ts" }
    });

    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: "diff-heartbeat",
      event: "DIFF_RENDERED",
      meta: { source: "ide-monitor", activityType: "heartbeat" }
    });

    const ideActivity = await request(app).get("/api/ide/activity");
    assert.equal(ideActivity.status, 200);
    assert.equal(ideActivity.body.ideConnected, true);
    assert.equal(ideActivity.body.currentFile, "/tmp/file.ts");
    assert.equal(ideActivity.body.lastEditedFile, "/tmp/file.ts");
    assert.equal(ideActivity.body.lastAddedFile, "/tmp/new-file.ts");

    const ideEvents = await request(app).get("/api/ide/events");
    assert.equal(ideEvents.status, 200);
    assert.ok(Array.isArray(ideEvents.body.events));
    assert.ok(ideEvents.body.events.length > 0);
    assert.equal(ideEvents.body.events[0].activityType, "heartbeat");

    const reset = await request(app).post("/api/admin/reset-telemetry").send({});
    assert.equal(reset.status, 200);
    assert.equal(reset.body.ok, true);

    const countRow = db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
    assert.equal(countRow.count, 0);
  });

  it("computes post-accept edit metrics", async () => {
    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    const generateResponse = await request(app).post("/api/generate").send({
      prompt: "bump a",
      context: {
        filePath: "/tmp/file.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });
    assert.equal(generateResponse.status, 200);
    const taskId = generateResponse.body.task_id as string;
    const diffId = generateResponse.body.diff_id as string;

    const acceptedAt = "2026-04-24T10:00:00.000Z";
    const editedAt = "2026-04-24T10:00:10.000Z";

    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: diffId,
      event: "ACCEPTED",
      timestamp: acceptedAt
    });

    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: "post-accept-edit-1",
      event: "DIFF_RENDERED",
      timestamp: editedAt,
      meta: { source: "post-accept", activityType: "post_accept_edit", charDelta: 12 }
    });

    const statsResponse = await request(app).get("/api/stats");
    assert.equal(statsResponse.status, 200);
    assert.equal(statsResponse.body.postAccept.editedTaskRate, 100);
    assert.equal(statsResponse.body.postAccept.avgCharDelta, 12);
    assert.equal(statsResponse.body.postAccept.medianSecondsToFirstEdit, 10);

    const postAcceptTasks = await request(app).get("/api/stats/post-accept-tasks");
    assert.equal(postAcceptTasks.status, 200);
    assert.ok(Array.isArray(postAcceptTasks.body.rows));
    assert.equal(postAcceptTasks.body.rows.length, 1);
    assert.equal(postAcceptTasks.body.rows[0].taskId, taskId);
    assert.equal(postAcceptTasks.body.rows[0].maxCharDelta, 12);
    assert.equal(postAcceptTasks.body.rows[0].secondsToFirstEdit, 10);
  });

  it("excludes post-accept edits from acceptance funnel metrics", async () => {
    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    const generateResponse = await request(app).post("/api/generate").send({
      prompt: "bump a",
      context: {
        filePath: "/tmp/file.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });
    assert.equal(generateResponse.status, 200);
    const taskId = generateResponse.body.task_id as string;
    const diffId = generateResponse.body.diff_id as string;

    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: diffId,
      event: "DIFF_RENDERED",
      timestamp: "2026-04-24T10:00:00.000Z"
    });
    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: "accept-1",
      event: "ACCEPTED",
      timestamp: "2026-04-24T10:00:05.000Z"
    });
    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: "post-accept-edit-2",
      event: "DIFF_RENDERED",
      timestamp: "2026-04-24T10:00:10.000Z",
      meta: { source: "post-accept", activityType: "post_accept_edit", charDelta: 5 }
    });

    const statsResponse = await request(app).get("/api/stats");
    assert.equal(statsResponse.status, 200);
    assert.equal(statsResponse.body.totals.diffRendered, 1);
    assert.equal(statsResponse.body.totals.accepted, 1);
    assert.equal(statsResponse.body.acceptanceRate, 100);
  });

  it("returns range-aware time series with iterated counts and acceptance momentum", async () => {
    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    const generateResponse = await request(app).post("/api/generate").send({
      prompt: "iterate on a patch",
      context: {
        filePath: "/tmp/file.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });

    assert.equal(generateResponse.status, 200);
    const taskId = generateResponse.body.task_id as string;
    const diffId = generateResponse.body.diff_id as string;

    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: `${diffId}-render`,
      event: "DIFF_RENDERED",
      timestamp: new Date().toISOString()
    });
    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: `${diffId}-iterated`,
      event: "ITERATED",
      timestamp: new Date().toISOString()
    });
    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: `${diffId}-accepted`,
      event: "ACCEPTED",
      timestamp: new Date().toISOString()
    });

    const statsResponse = await request(app).get("/api/stats").query({ range: "1h" });
    assert.equal(statsResponse.status, 200);
    assert.ok(Array.isArray(statsResponse.body.timeSeries));
    const populatedBucket = statsResponse.body.timeSeries.find(
      (point: { diffRendered: number; iterated: number; accepted: number; acceptanceMomentum: number }) =>
        point.diffRendered === 1 && point.iterated === 1 && point.accepted === 1
    );
    assert.ok(populatedBucket);
    assert.equal(populatedBucket.acceptanceMomentum, 100);
  });
});
