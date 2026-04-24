# SignalCode AI

Cursor-style inline AI editing inside IntelliJ, backed by LiteLLM and a React telemetry dashboard.

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

In sandbox IDE: open file -> select text or place caret -> press `Alt+\` (or `Ctrl+Alt+K`) -> prompt -> Generate -> Accept/Reject.

## How It Works

1. Plugin opens inline prompt popup.
2. Plugin fetches models (`GET /api/models`) and sends `POST /api/generate`.
3. Backend calls LiteLLM and expects strict `SEARCH/REPLACE` output.
4. Plugin renders diff and applies on Accept.
5. Plugin posts telemetry (`DIFF_RENDERED`, `ACCEPTED`, `REJECTED`, `ITERATED`).
6. Dashboard visualizes stats, IDE activity, and post-accept rework.

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
- Dashboard empty:
  - verify backend on `http://localhost:3001`
  - verify `/api/stats` returns 200
- Generation fails:
  - verify `GEMINI_API_KEY`
  - verify LiteLLM reachable at `http://localhost:4000`

## Security Notes

- Do not commit `.env` files or real API keys.
- Configure authentication and network access controls based on your deployment environment.
- Restrict `POST /api/admin/reset-telemetry` access to trusted operators.
