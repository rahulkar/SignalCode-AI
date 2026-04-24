import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { db } from "./db.js";
import { createApp } from "./index.js";

function clearDb(): void {
  db.exec("DELETE FROM events; DELETE FROM tasks;");
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
});
