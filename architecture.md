# SignalCode AI Architecture

## 1. System Overview

SignalCode AI is a local-first multi-component system that connects:

- an IntelliJ plugin (interaction + telemetry emitter)
- a TypeScript backend (generation + analytics APIs)
- a SQLite datastore (tasks/events)
- a LiteLLM proxy (model gateway)
- a React dashboard (telemetry command center)

Primary goal of the current architecture:

- capture generation review outcomes and post-accept rework signals
- surface these signals as operational analytics in near real time

## 2. High-Level Component Diagram

```text
IntelliJ Plugin (Kotlin)
  |  POST /api/generate
  |  POST /api/telemetry
  v
Backend API (Express + TS)
  |  SQL read/write
  v
SQLite (tasks, events)
  ^
  |  GET /api/stats, /api/ide/*, /api/export/*
Dashboard (React + Vite)

Backend API -> LiteLLM -> Model Provider(s)
```

## 3. Backend Architecture

Location: `backend/src`

Core responsibilities:

- validate generation requests
- invoke LiteLLM-backed model generation
- normalize generated operations
- persist telemetry events
- compute aggregate and per-task analytics
- provide export snapshots for downstream analysis

Key files:

- `index.ts`: API routes and analytics aggregation logic
- `db.ts`: SQLite initialization and reset utilities
- `schemas.ts`: request validation schemas
- `types.ts`: API contracts
- `litellm.ts`: LiteLLM integration

## 4. Data Model

SQLite tables:

- `tasks`
  - one row per generation task (or monitor task)
  - includes status, model, prompt snippet, timestamps
- `events`
  - append-only event stream keyed by `task_id`
  - event types: `DIFF_RENDERED`, `ACCEPTED`, `REJECTED`, `ITERATED`
  - `metadata` JSON stores activity and post-accept details

Telemetry sources encoded in metadata:

- `source: "ide-monitor"` for IDE activity events
- `source: "post-accept"` for post-accept rework events

## 5. Plugin Architecture

Location: `plugin/src/main/kotlin/com/agentic/mvp`

Core parts:

- generation dialog and review flow
- telemetry startup activity and listeners
- demo orchestrator for scripted live runs
- post-accept tracker for baseline vs current file comparison

Event capture paths:

- document listeners emit throttled edit activity
- VFS/editor listeners emit file open/create activity
- scheduled poll emits heartbeat and post-accept deltas
- review actions emit accept/reject/iterate lifecycle events

## 6. Dashboard Architecture

Location: `dashboard/src`

Core responsibilities:

- poll backend APIs
- render acceptance and iteration KPIs
- render trend and distribution panels
- show recent activity and IDE monitor activity
- highlight top post-accept rework tasks

Primary API dependencies:

- `/api/stats`
- `/api/stats/post-accept-tasks`
- `/api/ide/activity`
- `/api/ide/events`
- `/api/export/pr-snapshots`

## 7. Request and Event Flows

### 7.1 Generation + Review Flow

1. User requests generation in IntelliJ.
2. Plugin calls `POST /api/generate`.
3. Backend calls LiteLLM and returns normalized operation plan.
4. Plugin renders review UI.
5. User accepts/rejects/iterates.
6. Plugin emits telemetry events with task/diff IDs.
7. Dashboard reads aggregated metrics from backend.

### 7.2 Post-Accept Rework Flow

1. On accept, plugin registers accepted baseline text in tracker state.
2. Tracker observes later edits through:
   - document change callbacks
   - periodic polling of current text
3. Tracker computes delta metrics and emits `source: "post-accept"` telemetry.
4. Backend aggregates first edit time and max delta metrics per task.
5. Dashboard surfaces post-accept edit rate and largest rework tasks.

## 8. Deployment Topology (Local Dev)

- LiteLLM: `http://localhost:4000`
- Backend: `http://localhost:3001`
- Dashboard: `http://localhost:5173`
- IntelliJ plugin: sandbox IDE process

The plugin is configured to emit to local backend by default in this setup.

## 9. Current Scope Boundaries

Implemented today:

- task/event telemetry analytics around plugin-driven generation lifecycle
- post-accept edit tracking and ranking
- PR-style export derived from telemetry metadata

Not implemented as first-class architecture yet:

- native SCM PR ingestion and merge-state diff parsing
- line-level AI classification storage with confidence and survival labels
- team/service registry ingestion and weekly rollup pipeline
- dedicated org/team heatmap and PR drilldown views with narrative digest

## 10. Extension Path

Recommended next architecture increments:

1. Add PR ingestion tables (`prs`, `pr_files`, `pr_lines`, `classifications`).
2. Add classifier stage for line-level AI signal attribution.
3. Add merge-comparison stage to compute survival/rewrite outcomes.
4. Add ownership joins (`team`, `service`, `author`) and weekly rollups.
5. Keep current plugin telemetry as a complementary, high-frequency signal layer.
