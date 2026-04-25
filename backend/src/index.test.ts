import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { db, resetTelemetryDb } from "./db.js";
import { createApp } from "./index.js";

function clearDb(): void {
  resetTelemetryDb();
}

const ownershipFixturePath = fileURLToPath(new URL("./fixtures/team.minimal.json", import.meta.url));

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

  it("returns structured create-file operations", async () => {
    const app = createApp({
      generateFn: async () =>
        JSON.stringify({
          kind: "create_file",
          summary: "Create a helper file",
          targetFilePath: "src/utils/new-helper.ts",
          content: "export const newHelper = () => 42;\n"
        })
    });

    const response = await request(app).post("/api/generate").send({
      prompt: "create a helper file",
      mode: "create_file",
      context: {
        filePath: "/tmp/file.ts",
        targetFilePath: "src/utils/new-helper.ts",
        selectionOrCaretSnippet: "",
        languageId: "typescript"
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.operation.kind, "create_file");
    assert.equal(response.body.operation.targetFilePath, "src/utils/new-helper.ts");
    assert.match(response.body.operation.content, /newHelper/);
  });

  it("unwraps nested create-file JSON accidentally embedded in content", async () => {
    const app = createApp({
      generateFn: async () =>
        JSON.stringify({
          kind: "create_file",
          summary: "Create calculator engine",
          targetFilePath: "src/main/java/com/signalcode/demo/calculator/CalculatorEngine.java",
          content: JSON.stringify({
            kind: "create_file",
            summary: "Create CalculatorEngine class",
            targetFilePath: "src/main/java/com/signalcode/demo/calculator/CalculatorEngine.java",
            content: "package com.signalcode.demo.calculator;\n\npublic class CalculatorEngine {}\n"
          })
        })
    });

    const response = await request(app).post("/api/generate").send({
      prompt: "create calculator engine",
      mode: "create_file",
      context: {
        filePath: "/tmp/seed.txt",
        targetFilePath: "src/main/java/com/signalcode/demo/calculator/CalculatorEngine.java",
        selectionOrCaretSnippet: "",
        languageId: "java"
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.operation.kind, "create_file");
    assert.equal(response.body.operation.targetFilePath, "src/main/java/com/signalcode/demo/calculator/CalculatorEngine.java");
    assert.match(response.body.operation.content, /public class CalculatorEngine/);
    assert.doesNotMatch(response.body.operation.content, /"kind"\s*:\s*"create_file"/);
  });

  it("returns usage and cost metadata when available", async () => {
    const app = createApp({
      generateFn: async () => ({
        content: JSON.stringify({
          kind: "replace_range",
          summary: "Update code",
          targetFilePath: "/tmp/file.ts",
          search: "const a = 1;",
          replace: "const a = 2;"
        }),
        usage: {
          promptTokens: 120,
          completionTokens: 45,
          totalTokens: 165,
          costUsd: 0.00123
        }
      })
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
    assert.equal(response.body.usage.promptTokens, 120);
    assert.equal(response.body.usage.completionTokens, 45);
    assert.equal(response.body.usage.totalTokens, 165);
    assert.equal(response.body.usage.costUsd, 0.00123);
  });

  it("normalizes legacy search-replace output for insert mode", async () => {
    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 1;\nconst b = 2;\n>>>>REPLACE"
    });

    const response = await request(app).post("/api/generate").send({
      prompt: "add b right after a",
      mode: "insert_into_file",
      context: {
        filePath: "/tmp/file.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.operation.kind, "replace_range");
    assert.equal(response.body.operation.search, "const a = 1;");
    assert.match(response.body.operation.replace, /const b = 2;/);
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

  it("counts delete plus insert churn for post-accept metrics even when net length is unchanged", async () => {
    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    const generateResponse = await request(app).post("/api/generate").send({
      prompt: "rewrite a block",
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
      event: "ACCEPTED",
      timestamp: "2026-04-24T10:00:00.000Z"
    });

    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: "post-accept-edit-churn",
      event: "DIFF_RENDERED",
      timestamp: "2026-04-24T10:00:10.000Z",
      meta: {
        source: "post-accept",
        activityType: "post_accept_edit",
        charDelta: 0,
        deletedChars: 28,
        insertedChars: 28
      }
    });

    const statsResponse = await request(app).get("/api/stats");
    assert.equal(statsResponse.status, 200);
    assert.equal(statsResponse.body.postAccept.avgCharDelta, 56);

    const postAcceptTasks = await request(app).get("/api/stats/post-accept-tasks");
    assert.equal(postAcceptTasks.status, 200);
    assert.equal(postAcceptTasks.body.rows.length, 1);
    assert.equal(postAcceptTasks.body.rows[0].maxCharDelta, 56);
    assert.equal(postAcceptTasks.body.rows[0].maxDeletedChars, 28);
    assert.equal(postAcceptTasks.body.rows[0].maxInsertedChars, 28);
  });

  it("ignores post-accept telemetry that occurred before first acceptance in KPI and task views", async () => {
    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    const generateResponse = await request(app).post("/api/generate").send({
      prompt: "order check",
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
      diff_id: "post-before-accept",
      event: "DIFF_RENDERED",
      timestamp: "2026-04-24T10:00:00.000Z",
      meta: { source: "post-accept", activityType: "post_accept_edit", charDelta: 9 }
    });
    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: diffId,
      event: "ACCEPTED",
      timestamp: "2026-04-24T10:00:05.000Z"
    });

    const statsResponse = await request(app).get("/api/stats");
    assert.equal(statsResponse.status, 200);
    assert.equal(statsResponse.body.postAccept.editedTaskRate, 0);
    assert.equal(statsResponse.body.postAccept.avgCharDelta, 0);
    assert.equal(statsResponse.body.postAccept.medianSecondsToFirstEdit, 0);

    const postAcceptTasks = await request(app).get("/api/stats/post-accept-tasks");
    assert.equal(postAcceptTasks.status, 200);
    assert.equal(postAcceptTasks.body.rows.length, 0);
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

  it("exports PR-style change snapshot rows", async () => {
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
      timestamp: "2026-04-24T10:00:00.000Z",
      meta: { filePath: "/tmp/file.ts", acceptedLines: 24 }
    });
    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: `${diffId}-iterated`,
      event: "ITERATED",
      timestamp: "2026-04-24T10:00:03.000Z",
      meta: { filePath: "/tmp/file.ts" }
    });
    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: `${diffId}-accepted`,
      event: "ACCEPTED",
      timestamp: "2026-04-24T10:00:05.000Z",
      meta: { filePath: "/tmp/file.ts" }
    });
    await request(app).post("/api/telemetry").send({
      task_id: taskId,
      diff_id: "post-accept-edit-1",
      event: "DIFF_RENDERED",
      timestamp: "2026-04-24T10:00:10.000Z",
      meta: {
        source: "post-accept",
        filePath: "/tmp/file.ts",
        acceptedLines: 24,
        currentLines: 21,
        lineDelta: 3
      }
    });

    const exportResponse = await request(app).get("/api/export/pr-snapshots");
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.body.totalRecords, 1);
    assert.ok(Array.isArray(exportResponse.body.records));
    assert.equal(exportResponse.body.records[0].pr_id, taskId);
    assert.equal(exportResponse.body.records[0].service, "tmp");
    assert.equal(exportResponse.body.records[0].submitted_at, "2026-04-24T10:00:00.000Z");
    assert.equal(exportResponse.body.records[0].merged_at, "2026-04-24T10:00:05.000Z");
    assert.equal(exportResponse.body.records[0].total_lines_added_at_submission, 24);
    assert.equal(exportResponse.body.records[0].total_lines_added_at_merge, 21);
    assert.equal(exportResponse.body.records[0].ai_flagged_lines_at_merge, 21);
    assert.equal(exportResponse.body.records[0].ai_submission_pct, 100);
    assert.equal(exportResponse.body.records[0].ai_acceptance_pct, 87.5);
    assert.equal(exportResponse.body.records[0].review_cycle_count, 1);
    assert.deepEqual(exportResponse.body.records[0].files_changed, ["/tmp/file.ts"]);
    assert.equal(exportResponse.body.records[0].terminal_outcome, "ACCEPTED");
    assert.equal(exportResponse.body.records[0].data_quality, "observed");
  });

  it("excludes succeeded tasks that never emitted change telemetry from export", async () => {
    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    const generateOnly = await request(app).post("/api/generate").send({
      prompt: "draft something",
      context: {
        filePath: "/tmp/only-generated.ts",
        selectionOrCaretSnippet: "const a = 1;",
        languageId: "typescript"
      }
    });

    const generateWithTelemetry = await request(app).post("/api/generate").send({
      prompt: "render something",
      context: {
        filePath: "/tmp/with-event.ts",
        selectionOrCaretSnippet: "const b = 1;",
        languageId: "typescript"
      }
    });

    assert.equal(generateOnly.status, 200);
    assert.equal(generateWithTelemetry.status, 200);

    await request(app).post("/api/telemetry").send({
      task_id: generateWithTelemetry.body.task_id,
      diff_id: generateWithTelemetry.body.diff_id,
      event: "DIFF_RENDERED",
      timestamp: "2026-04-24T10:05:00.000Z",
      meta: { filePath: "/tmp/with-event.ts", acceptedLines: 12 }
    });

    const exportResponse = await request(app).get("/api/export/pr-snapshots");
    assert.equal(exportResponse.status, 200);
    assert.equal(exportResponse.body.totalRecords, 1);
    assert.equal(exportResponse.body.records[0].pr_id, generateWithTelemetry.body.task_id);
  });

  it("applies team ownership mapping and supports team filtering", async () => {
    const priorTeamConfigPath = process.env.TEAM_CONFIG_PATH;
    const priorTeamsConfigPath = process.env.TEAMS_CONFIG_PATH;
    process.env.TEAM_CONFIG_PATH = ownershipFixturePath;
    delete process.env.TEAMS_CONFIG_PATH;

    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    try {
      const generateResponse = await request(app).post("/api/generate").send({
        prompt: "team ownership test",
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
        timestamp: "2026-04-24T10:00:00.000Z",
        meta: { filePath: "/tmp/file.ts", acceptedLines: 24 }
      });
      await request(app).post("/api/telemetry").send({
        task_id: taskId,
        diff_id: `${diffId}-accepted`,
        event: "ACCEPTED",
        timestamp: "2026-04-24T10:00:05.000Z",
        meta: { filePath: "/tmp/file.ts" }
      });

      const exportResponse = await request(app).get("/api/export/pr-snapshots");
      assert.equal(exportResponse.status, 200);
      assert.equal(exportResponse.body.records[0].team, "sandbox");
      assert.equal(exportResponse.body.records[0].author_id, "eng-demo-01");

      const teamsResponse = await request(app).get("/api/teams");
      assert.equal(teamsResponse.status, 200);
      assert.ok(Array.isArray(teamsResponse.body.teams));
      assert.ok(teamsResponse.body.teams.includes("sandbox"));

      const sandboxStats = await request(app).get("/api/stats").query({ team: "sandbox" });
      assert.equal(sandboxStats.status, 200);
      assert.equal(sandboxStats.body.totalTasks, 1);

      const otherStats = await request(app).get("/api/stats").query({ team: "platform-commerce" });
      assert.equal(otherStats.status, 200);
      assert.equal(otherStats.body.totalTasks, 0);
    } finally {
      if (priorTeamConfigPath === undefined) {
        delete process.env.TEAM_CONFIG_PATH;
      } else {
        process.env.TEAM_CONFIG_PATH = priorTeamConfigPath;
      }
      if (priorTeamsConfigPath === undefined) {
        delete process.env.TEAMS_CONFIG_PATH;
      } else {
        process.env.TEAMS_CONFIG_PATH = priorTeamsConfigPath;
      }
    }
  });

  it("applies configured team at generate time before telemetry events arrive", async () => {
    const priorTeamConfigPath = process.env.TEAM_CONFIG_PATH;
    const priorTeamsConfigPath = process.env.TEAMS_CONFIG_PATH;
    process.env.TEAM_CONFIG_PATH = ownershipFixturePath;
    delete process.env.TEAMS_CONFIG_PATH;

    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    try {
      const generateResponse = await request(app).post("/api/generate").send({
        prompt: "team assignment on generate",
        context: {
          filePath: "/tmp/file.ts",
          selectionOrCaretSnippet: "const a = 1;",
          languageId: "typescript"
        }
      });

      assert.equal(generateResponse.status, 200);

      const sandboxStats = await request(app).get("/api/stats").query({ team: "sandbox" });
      assert.equal(sandboxStats.status, 200);
      assert.equal(sandboxStats.body.totalTasks, 1);
    } finally {
      if (priorTeamConfigPath === undefined) {
        delete process.env.TEAM_CONFIG_PATH;
      } else {
        process.env.TEAM_CONFIG_PATH = priorTeamConfigPath;
      }
      if (priorTeamsConfigPath === undefined) {
        delete process.env.TEAMS_CONFIG_PATH;
      } else {
        process.env.TEAMS_CONFIG_PATH = priorTeamsConfigPath;
      }
    }
  });

  it("resolves team.json from projectRootPath when telemetry file paths are relative", async () => {
    const priorTeamConfigPath = process.env.TEAM_CONFIG_PATH;
    const priorTeamsConfigPath = process.env.TEAMS_CONFIG_PATH;
    delete process.env.TEAM_CONFIG_PATH;
    delete process.env.TEAMS_CONFIG_PATH;

    const projectRoot = mkdtempSync(path.join(tmpdir(), "signalcode-team-"));
    writeFileSync(
      path.join(projectRoot, "team.json"),
      JSON.stringify(
        {
          team: "sandbox-local",
          author_id: "eng-local-01"
        },
        null,
        2
      )
    );

    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    try {
      const generateResponse = await request(app).post("/api/generate").send({
        prompt: "relative ownership test",
        context: {
          filePath: "src/main/java/com/acme/App.java",
          projectRootPath: projectRoot,
          selectionOrCaretSnippet: "class App {}",
          languageId: "java"
        }
      });

      assert.equal(generateResponse.status, 200);
      const taskId = generateResponse.body.task_id as string;
      const diffId = generateResponse.body.diff_id as string;

      await request(app).post("/api/telemetry").send({
        task_id: taskId,
        diff_id: diffId,
        event: "DIFF_RENDERED",
        timestamp: "2026-04-25T09:40:00.000Z",
        meta: { filePath: "src/main/java/com/acme/App.java", acceptedLines: 10 }
      });

      const exportResponse = await request(app).get("/api/export/pr-snapshots");
      assert.equal(exportResponse.status, 200);
      assert.equal(exportResponse.body.records[0].team, "sandbox-local");
      assert.equal(exportResponse.body.records[0].author_id, "eng-local-01");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      if (priorTeamConfigPath === undefined) {
        delete process.env.TEAM_CONFIG_PATH;
      } else {
        process.env.TEAM_CONFIG_PATH = priorTeamConfigPath;
      }
      if (priorTeamsConfigPath === undefined) {
        delete process.env.TEAMS_CONFIG_PATH;
      } else {
        process.env.TEAMS_CONFIG_PATH = priorTeamsConfigPath;
      }
    }
  });

  it("prefers telemetry-provided team and author_id when present", async () => {
    const priorTeamConfigPath = process.env.TEAM_CONFIG_PATH;
    const priorTeamsConfigPath = process.env.TEAMS_CONFIG_PATH;
    delete process.env.TEAM_CONFIG_PATH;
    delete process.env.TEAMS_CONFIG_PATH;

    const app = createApp({
      generateFn: async () => "<<<<SEARCH\nconst a = 1;\n====\nconst a = 2;\n>>>>REPLACE"
    });

    try {
      const generateResponse = await request(app).post("/api/generate").send({
        prompt: "metadata ownership test",
        context: {
          filePath: "src/main/java/com/acme/App.java",
          projectRootPath: "C:\\Users\\someone\\IdeaProjects\\acme",
          selectionOrCaretSnippet: "class App {}",
          languageId: "java"
        }
      });
      assert.equal(generateResponse.status, 200);

      const taskId = generateResponse.body.task_id as string;
      const diffId = generateResponse.body.diff_id as string;
      await request(app).post("/api/telemetry").send({
        task_id: taskId,
        diff_id: diffId,
        event: "DIFF_RENDERED",
        timestamp: "2026-04-25T10:10:00.000Z",
        meta: {
          filePath: "src/main/java/com/acme/App.java",
          team: "sandbox-meta",
          author_id: "eng-meta-01",
          acceptedLines: 10
        }
      });

      const exportResponse = await request(app).get("/api/export/pr-snapshots");
      assert.equal(exportResponse.status, 200);
      assert.equal(exportResponse.body.records[0].team, "sandbox-meta");
      assert.equal(exportResponse.body.records[0].author_id, "eng-meta-01");
    } finally {
      if (priorTeamConfigPath === undefined) {
        delete process.env.TEAM_CONFIG_PATH;
      } else {
        process.env.TEAM_CONFIG_PATH = priorTeamConfigPath;
      }
      if (priorTeamsConfigPath === undefined) {
        delete process.env.TEAMS_CONFIG_PATH;
      } else {
        process.env.TEAMS_CONFIG_PATH = priorTeamsConfigPath;
      }
    }
  });
});
