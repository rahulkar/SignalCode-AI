# SignalCode AI Coding MVP (IntelliJ + LiteLLM + Dashboard)

This project is a full-stack MVP that recreates a Cursor-style inline coding flow inside IntelliJ IDEA:

- Trigger inline prompt with a keyboard shortcut
- Send editor context + natural language instruction to a backend
- Generate structured `SEARCH/REPLACE` edits via Gemini (through LiteLLM)
- Render inline diff with Accept / Reject actions
- Capture telemetry and visualize outcomes in a web dashboard

---

## What this repo contains

```text
/
  litellm/     LiteLLM proxy config + compose files for Gemini routing/logging
  backend/     Express + TypeScript + SQLite orchestration and telemetry API
  dashboard/   React + Vite + Tailwind + Recharts telemetry dashboard
  plugin/      IntelliJ Platform Plugin (Kotlin) inline coding client
```

---

## High-level architecture

1. User highlights code (or uses caret) in IntelliJ and presses `Alt+\` or `Ctrl+Alt+K`.
2. Plugin shows a floating prompt input in the editor.
3. Plugin sends `{ prompt, context }` to backend `POST /api/generate`.
4. Backend sends request to LiteLLM (`/v1/chat/completions`), which routes to Gemini Flash.
5. Model returns strict `SEARCH/REPLACE` block.
6. Plugin parses result, renders inline diff, and offers Accept/Reject.
7. Plugin emits telemetry events to backend (`DIFF_RENDERED`, `ACCEPTED`, `REJECTED`, `ITERATED`).
8. Dashboard reads `GET /api/stats` and shows acceptance metrics in near real time.

---

## Prerequisites

- **OS:** Windows/macOS/Linux
- **Node.js:** 20+
- **npm:** 10+
- **Java:** JDK 17+ recommended for plugin work (this repo was validated with modern JDK; see troubleshooting for JDK 25 notes)
- **Gradle:** available in PATH (or add Gradle Wrapper later)
- **Docker Desktop:** for LiteLLM and optional dashboard container
- **Gemini API key:** `GEMINI_API_KEY`

---

## Quick start (recommended dev flow)

### 1) Environment setup

From repo root:

1. Copy root env template:
  - `copy .env.example .env` (Windows)
2. Copy LiteLLM env template:
  - `copy litellm/.env.example litellm/.env`
3. Set your key in both files:
  - `GEMINI_API_KEY=...`

Notes:

- Root `.env` is used by root Docker Compose.
- `litellm/.env` is used by `litellm/docker-compose.yml`.

---

### 2) Start LiteLLM

Option A (root unified compose: LiteLLM + dashboard):

```bash
docker compose up --build
```

Option B (LiteLLM only from subfolder):

```bash
cd litellm
docker compose up
```

Expected:

- LiteLLM available at `http://localhost:4000`
- SQLite logging DB persisted under `litellm/data`

---

### 3) Start backend API

```bash
cd backend
npm install
copy .env.example .env
npm run dev
```

Update `backend/.env` if needed:

- `PORT=3001`
- `LITELLM_BASE_URL=http://localhost:4000`
- `LITELLM_MODEL=gemini-flash`
- `DATABASE_PATH=./telemetry.db`

Expected:

- Backend on `http://localhost:3001`
- `telemetry.db` created automatically

---

### 4) Start dashboard (if not using dashboard container)

```bash
cd dashboard
npm install
npm run dev
```

Expected:

- Dashboard on `http://localhost:5173`
- Header: **SignalCode AI Telemetry Dashboard**
- KPI cards + chart + recent activity table

---

### 5) Build/run plugin

```bash
cd plugin
gradle build --console=plain
gradle runIde
```

In the launched IDE sandbox:

1. Open any file
2. Select text (or place caret on a line)
3. Press `Alt+\` (or `Ctrl+Alt+K`)
4. Enter prompt (example: `Refactor this function to handle null input safely`)
5. Click **Generate**
6. Review inline highlights and choose **Accept** or **Reject**

---

## How to use the MVP

### Inline prompt behavior

- If text is selected, selected text is sent as context.
- If no selection exists, current line text is used.
- Prompt appears as a popup anchored in the editor.

### Diff behavior

- Backend enforces model output in this format:

```text
<<<<SEARCH
[exact original code]
====
[exact new code]
>>>>REPLACE
```

- Plugin parses this block.
- Plugin searches document for the `SEARCH` segment.
- It renders visual red/green highlights.

### Accept / Reject behavior

- **Accept:** applies replacement inside `WriteCommandAction.runWriteCommandAction(...)`.
- **Reject:** clears temporary diff rendering only.

### Telemetry behavior

Plugin emits:

- `DIFF_RENDERED` when diff is shown
- `ACCEPTED` when accepted and applied
- `REJECTED` when discarded
- `ITERATED` when a new prompt is submitted while another diff is active

---

## API reference

### `POST /api/generate`

Request:

```json
{
  "prompt": "Refactor this function",
  "context": {
    "filePath": "/path/to/file.ts",
    "selectionOrCaretSnippet": "function x() {...}",
    "languageId": "TypeScript"
  }
}
```

Response:

```json
{
  "task_id": "uuid",
  "diff_id": "uuid",
  "raw": "<<<<SEARCH\n...\n====\n...\n>>>>REPLACE",
  "model": "gemini-flash"
}
```

### `POST /api/telemetry`

Request:

```json
{
  "task_id": "uuid",
  "diff_id": "uuid",
  "event": "ACCEPTED"
}
```

### `GET /api/stats`

Returns:

- `acceptanceRate`
- `totalTasks`
- `averageIterationsBeforeAccept`
- totals for each event type
- time series (`accepted`, `rejected`)
- recent activity rows

---

## What to expect (current MVP scope)

### Working today

- End-to-end prompt -> generation -> diff -> accept/reject -> telemetry
- Dashboard KPI metrics and timeline chart
- SQLite persistence for telemetry
- LiteLLM proxy path for Gemini model calls

### Known limitations

- Plugin currently uses popup-style inline prompt (not deep embedded editor component)
- Diff matching is plain text first-match based (`indexOf`), not semantic patching
- Single `SEARCH/REPLACE` block expected
- No authentication layer on backend endpoints
- Plugin build can still hit Windows file-lock issues on `plugin/build` in some environments

---

## Build and verification commands

### Backend

```bash
cd backend
npm run build
```

### Dashboard

```bash
cd dashboard
npm run build
```

### Plugin

```bash
cd plugin
gradle build --console=plain
```

---

## Troubleshooting

### Plugin build fails with Java/Kotlin version parsing errors

Symptom examples:

- `IllegalArgumentException: 25.0.2`
- Kotlin compiler internal errors around Java version parsing

Fix:

- Use the updated plugin versions in `plugin/build.gradle.kts`:
  - Kotlin plugin `2.1.21`
  - IntelliJ Platform Gradle plugin `2.14.0`

### Plugin build fails at clean/delete step on Windows locks

Symptom examples:

- `Unable to delete directory ... plugin/build ...`
- stale class paths under `build/classes/...` or `build/instrumented/...`

Workaround:

- Stop daemons and rebuild:
  - `gradle --stop`
  - `gradle clean build --console=plain`
- If needed, close IDE/file handles and manually delete `plugin/build`, then rebuild.

### Build directory cannot be deleted (Windows lock)

Symptom:

- `Unable to delete directory ... build ... process has files open`

Fix:

```bash
cd plugin
gradle --stop
```

Then delete `plugin/build` and rebuild.

### Dashboard loads but no data

Check:

1. Backend running on expected URL (`http://localhost:3001`)
2. `VITE_API_BASE_URL` (for Docker dashboard) points to reachable backend
3. Browser devtools network for `/api/stats` failures

### Generation fails

Check:

1. `GEMINI_API_KEY` is set
2. LiteLLM reachable at configured `LITELLM_BASE_URL`
3. Model alias in `litellm/config.yaml` matches backend `LITELLM_MODEL`

---

## Next recommended improvements

1. Add root Gradle Wrapper (`gradlew`) for reproducible plugin builds
2. Move plugin source folders to match package path (`com/signalcode/mvp`) for consistency
3. Persist plugin settings (backend URL) via `PersistentStateComponent`
4. Upgrade diff engine to robust multi-hunk matching
5. Add auth/rate-limits for telemetry/generation APIs
6. Add automated integration tests (backend + plugin parser)

---

## Security and privacy notes

- Do not commit real API keys (`.env` files should stay local).
- Telemetry currently stores prompt snippets; avoid sending sensitive production code in unsecured environments.
- Add transport security and auth before external/shared deployment.

