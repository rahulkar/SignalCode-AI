# SignalCode AI

Cursor-style inline AI editing inside IntelliJ, backed by LiteLLM, an Express API, and a React telemetry dashboard.

## Latest IntelliJ Plugin Updates

- Cleaner model loading UX: the SignalCode Agent dialog now avoids stale "Fetching live models..." copy and only shows model status when there is something actionable, such as falling back to the bundled catalog or having no live models available.
- Icon-backed IntelliJ experience: the plugin action, main agent dialog, loading dialog, and review modal now use a dedicated SignalCode icon pack for a more polished IDE presentation.
- Executive demo mode now runs live against the backend and selected model, starting from an empty IntelliJ folder and building a realistic Java calculator project across multiple files.
- Demo telemetry is first-class: file creation, accepted generations, IDE activity, and follow-up local edits all flow into the Telemetry Command Center UI so the executive walkthrough reflects a real session.

## Repo Layout

```text
/
  backend/     Express + TypeScript + SQLite APIs
  dashboard/   React + Vite telemetry UI
  plugin/      IntelliJ plugin (Kotlin)
  litellm/     LiteLLM proxy config
  scripts/     model catalog sync utilities
```

## Quick Start

### 1) Configure env

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

LiteLLM: `http://localhost:4000`

### 3) Start backend

```bash
cd backend
npm install
copy .env.example .env
npm run dev
```

Backend: `http://localhost:3001`

### 4) Start dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard: `http://localhost:5173`

### 5) Run IntelliJ plugin

```bash
cd plugin
gradle build --console=plain
gradle runIde
```

In sandbox IDE:

- Open a file, select code or place the caret, then press `Alt+\` (or `Ctrl+Alt+K`).
- Use the SignalCode Agent dialog to choose operation, model, prompt, and target path when needed.
- For executive demos, open an empty folder in IntelliJ and click `Run live demo`.
- Keep the backend, LiteLLM, and dashboard running before launching demo mode so the plugin can call the real LLM and stream telemetry.

The plugin targets IntelliJ Platform build `241+` (IntelliJ IDEA 2024.1 and newer).

## IntelliJ Plugin Highlights

- SignalCode Agent dialog for update, insert, and create-file workflows.
- Live model discovery from `GET /api/models` with graceful fallback to the bundled model catalog when live availability cannot be fetched.
- Prompt quick starts, recent prompt history, and active-file context preview.
- Executive demo mode that generates a Java calculator MVP from zero, patches one of the generated files, and then simulates post-accept human edits.
- Inline review flow plus telemetry events for `DIFF_RENDERED`, `ACCEPTED`, `REJECTED`, and `ITERATED`.
- IDE monitor telemetry for opened, created, edited, heartbeat, and post-accept activity signals.

## How It Works

1. Plugin opens the SignalCode Agent dialog with code context, prompt history, and quick-start actions.
2. Plugin tries to fetch live model availability from `GET /api/models` and falls back to the bundled catalog if live availability is unreachable.
3. For real runs, the plugin sends `POST /api/generate` with the selected mode, model, and editor context.
4. Backend calls LiteLLM and expects strict `SEARCH/REPLACE` style output for patch generation.
5. Plugin renders the review plan, applies the change on Accept, and records telemetry (`DIFF_RENDERED`, `ACCEPTED`, `REJECTED`, `ITERATED`).
6. Dashboard visualizes task stats, IDE activity, and post-accept rework.
7. For executive demos, demo mode starts in an empty IntelliJ folder, creates a multi-file Java calculator project with the live model, applies a real patch, and then performs a few local follow-up edits so Command Center shows realistic post-accept rework.

## Core APIs

- `GET /api/health`
- `GET /api/models`
- `POST /api/generate`
- `POST /api/telemetry`
- `GET /api/stats?range=15m|1h|24h|7d`
- `GET /api/stats/post-accept-tasks`
- `GET /api/ide/activity`
- `GET /api/ide/events`
- `GET /api/export/pr-snapshots`
- `POST /api/admin/reset-telemetry`

## Model Catalog Workflow

Model aliases are generated from `model-catalog.json`.

```bash
npm run models:sync
npm run models:check
```

This updates:

- `litellm/config.yaml`
- `backend/src/modelCatalog.generated.ts`

## Build Commands

```bash
cd backend && npm run build
cd dashboard && npm run build
cd plugin && gradle build --console=plain
```

## Troubleshooting

- Plugin build lock on Windows:
  - `cd plugin`
  - `gradle --stop`
  - rebuild
- Model picker falls back to bundled catalog:
  - verify backend on `http://localhost:3001`
  - verify `GET /api/models` returns 200
  - verify LiteLLM and backend are both running before opening the IntelliJ dialog
- Dashboard empty:
  - verify backend on `http://localhost:3001`
  - verify `/api/stats` returns 200
- Generation fails:
  - verify `GEMINI_API_KEY`
  - verify LiteLLM reachable at `http://localhost:4000`
- Demo mode expectations:
  - open an empty IntelliJ folder before clicking `Run live demo`
  - demo mode uses the real backend and real model calls
  - created files, accepted edits, IDE activity, and post-accept follow-up edits should appear in the dashboard
  - if the folder already contains visible project files, demo mode will stop and ask for a clean directory

## Security Notes

- Do not commit `.env` files or real API keys.
- Configure authentication and network access controls based on your deployment environment.
- Restrict `POST /api/admin/reset-telemetry` access to trusted operators.
