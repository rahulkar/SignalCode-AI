# SignalCode AI

SignalCode AI is an IntelliJ plugin plus backend/dashboard stack for AI-assisted code generation, review actions, and telemetry analytics.

## Documentation

- Architecture: [`architecture.md`](./architecture.md)
- UI styling system: [`DESIGN.md`](./DESIGN.md)

## Current Product Scope

The current implementation is a live telemetry command center for:

- generation lifecycle telemetry (`DIFF_RENDERED`, `ACCEPTED`, `REJECTED`, `ITERATED`)
- IDE activity telemetry (opened, created, edited, heartbeat)
- post-accept rework tracking (polling + diff metrics after accepted output)
- PR-style snapshot export derived from task telemetry
- executive demo orchestration with real backend/model calls

This is not yet a full SCM-native PR ingestion and line-classification platform.

## Repository Layout

```text
/
  backend/     Express + TypeScript + SQLite APIs
  dashboard/   React + Vite telemetry UI
  plugin/      IntelliJ plugin (Kotlin)
  litellm/     LiteLLM proxy config
  scripts/     model catalog sync utilities
```

## Quick Start

### 1) Configure environment

From repo root:

```bash
copy .env.example .env
copy litellm/.env.example litellm/.env
```

Set `GEMINI_API_KEY` in both files.

### 2) Start LiteLLM

```bash
docker compose up --build
```

LiteLLM URL: `http://localhost:4000`

### 3) Start backend

```bash
cd backend
npm install
copy .env.example .env
npm run dev
```

Backend URL: `http://localhost:3001`

### 4) Start dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard URL: `http://localhost:5173`

### 5) Run IntelliJ plugin

```bash
cd plugin
gradle build --console=plain
gradle runIde
```

In the sandbox IDE:

1. Open a file, select code or place the caret, then press `Alt+\` (or `Ctrl+Alt+K`).
2. Use the SignalCode Agent dialog to choose operation, model, prompt, and target path.
3. For executive demo mode, open a clean IntelliJ folder and click `Run live demo`.

Plugin target: IntelliJ Platform build `241+` (IntelliJ IDEA 2024.1+).

## Key Features

- SignalCode Agent dialog for update, insert, and create-file workflows
- live model discovery via `GET /api/models` with generated catalog fallback
- telemetry capture for review lifecycle and IDE activity
- post-accept telemetry from both document-change callbacks and polling
- dashboard KPIs for acceptance, iteration behavior, and post-accept edits
- export endpoint for PR-style telemetry snapshots
- team and author enrichment on tasks and exports
- team-scoped filtering via `/api/teams`, `/api/stats?team=...`, and team-aware export endpoints
- ownership visibility in plugin header (`Team`, `Author`) before generation

## Feature Coverage (Current)

- Generation and review:
  - update selection
  - insert into file
  - create file
- Telemetry lifecycle:
  - `DIFF_RENDERED`
  - `ACCEPTED`
  - `REJECTED`
  - `ITERATED`
- IDE activity:
  - opened
  - created
  - edited (throttled)
  - heartbeat
- Post-accept rework:
  - baseline capture on accept
  - diff/churn tracking after accept
  - KPI rollups and top-task ranking
- Team and author ownership:
  - config-based resolution (`team.json`/`teams.json`)
  - plugin-provided ownership metadata
  - persisted fields in tasks and export snapshots
- Dashboard analytics:
  - acceptance funnels
  - momentum trends
  - recent activity
  - team filter
  - post-accept rework panel

## Use-Case Examples

- `cass` service flow:
  - developer in a `cass` codebase generates and reviews a patch in IntelliJ
  - plugin sends lifecycle telemetry with context, team, and author
  - dashboard shows `cass` activity and export rows with populated ownership
- Team performance slicing:
  - analytics lead filters `/api/stats?team=sandbox`
  - compares acceptance and rework trends by team over `24h` or `7d`
- Executive walkthrough:
  - run live demo mode
  - generate realistic telemetry and exportable snapshots for stakeholder review

## Runtime Flow

1. Plugin sends `POST /api/generate` with model, mode, and editor context.
2. Backend calls LiteLLM and normalizes output into an operation plan.
3. Plugin renders review; user accepts/rejects/iterates.
4. Plugin emits `POST /api/telemetry` events for lifecycle and IDE monitor signals.
5. Backend stores events in SQLite and computes analytics endpoints.
6. Dashboard polls APIs to render KPIs, trends, activity, and post-accept rework.

## API Surface

- `GET /api/health`
- `GET /api/models`
- `POST /api/generate`
- `POST /api/telemetry`
- `GET /api/stats?range=15m|1h|24h|7d`
- `GET /api/stats/post-accept-tasks`
- `GET /api/teams`
- `GET /api/ide/activity`
- `GET /api/ide/events`
- `GET /api/export/pr-snapshots`
- `POST /api/admin/reset-telemetry`

`/api/stats`, `/api/stats/post-accept-tasks`, and `/api/export/pr-snapshots` also accept optional `team=<team-name>` for team-scoped analytics.

## Ownership Mapping (`team.json`)

SignalCode can enrich telemetry tasks with `team` and `author_id` by reading a lightweight ownership file.

Lookup order:

- `TEAM_CONFIG_PATH` (or legacy `TEAMS_CONFIG_PATH`)
- nearest `team.json` / `teams.json` walking up from task file paths and `projectRootPath`
- `team.json` / `teams.json` in the current working directory
- `team.json` / `teams.json` one directory above the current working directory

Notes:

- In Docker, backend cannot read host IDE paths directly (`C:\...` / `/Users/...`) unless mounted; `docker-compose.yml` mounts repo-root `teams.json` to `/app/teams.json` and sets `TEAM_CONFIG_PATH`.
- Plugin telemetry can also carry `team` and `author_id`; backend will prefer those explicit values when present.

Recommended format:

```json
{
  "team": "platform-commerce",
  "author_id": "eng-demo-01"
}
```

Legacy fallback keys (`default_team`, `default_author_id`) are also supported.

### Team/Author Examples

`cass` project ownership example:

```json
{
  "team": "cass-platform",
  "author_id": "eng-cass-01"
}
```

Example export shape (ownership populated):

```json
{
  "pr_id": "4a9d9225-d10d-412e-902b-cd0b1abb7b1e",
  "service": "cass",
  "team": "cass-platform",
  "author_id": "eng-cass-01",
  "terminal_outcome": "ACCEPTED"
}
```

Behavior summary:

- Backend prefers explicit telemetry ownership fields when provided.
- If explicit ownership is missing, backend resolves from config lookup.
- In Docker, mount a config file and set `TEAM_CONFIG_PATH` for deterministic enrichment.

## Model Catalog Workflow

Model aliases are generated from `model-catalog.json`.

```bash
npm run models:sync
npm run models:check
```

Generated outputs:

- `litellm/config.yaml`
- `backend/src/modelCatalog.generated.ts`

## Build Commands

```bash
cd backend && npm run build
cd dashboard && npm run build
cd plugin && gradle build --console=plain
```

## Troubleshooting

- model picker falls back to catalog:
  - verify backend is running on `http://localhost:3001`
  - verify `GET /api/models` returns 200
- dashboard looks empty:
  - verify `GET /api/stats` returns 200
  - verify plugin is sending telemetry to backend
- generation fails:
  - verify `GEMINI_API_KEY`
  - verify LiteLLM is reachable on `http://localhost:4000`
- demo mode behavior:
  - run from a clean folder for predictable output
  - keep backend + LiteLLM + dashboard running

## Security Notes

- do not commit `.env` files or real API keys
- protect `POST /api/admin/reset-telemetry` in non-local deployments
- apply network/auth controls appropriate for your environment
