export type EventOutcome = "DIFF_RENDERED" | "ACCEPTED" | "REJECTED" | "ITERATED";
export type StatsRange = "15m" | "1h" | "24h" | "7d";

export interface StatsResponse {
  acceptanceRate: number;
  totalTasks: number;
  averageIterationsBeforeAccept: number;
  totals: {
    diffRendered: number;
    accepted: number;
    rejected: number;
    iterated: number;
  };
  timeSeries: Array<{
    bucket: string;
    accepted: number;
    rejected: number;
    iterated: number;
    diffRendered: number;
    acceptanceMomentum: number;
  }>;
  recentActivity: Array<{
    timestamp: string;
    promptSnippet: string;
    model: string;
    outcome: EventOutcome;
    task_id: string;
    diff_id: string;
    team: string | null;
    author_id: string | null;
  }>;
  postAccept: {
    editedTaskRate: number;
    avgCharDelta: number;
    medianSecondsToFirstEdit: number;
  };
}

export interface IdeActivityResponse {
  ideConnected: boolean;
  lastEventAt: string | null;
  currentFile: string | null;
  lastEditedFile: string | null;
  lastAddedFile: string | null;
}

export interface IdeMonitorEvent {
  timestamp: string;
  activityType: string;
  filePath: string | null;
  languageId: string | null;
}

export interface PostAcceptTaskReworkRow {
  taskId: string;
  promptSnippet: string;
  model: string;
  team: string | null;
  author_id: string | null;
  firstAcceptedAt: string;
  firstEditedAt: string;
  secondsToFirstEdit: number;
  maxCharDelta: number;
  maxLineDelta: number;
  maxDeletedChars: number;
  maxInsertedChars: number;
  editsAfterAccept: number;
}

export interface ExportChangeSnapshotRow {
  pr_id: string;
  service: string | null;
  team: string | null;
  author_id: string | null;
  submitted_at: string;
  merged_at: string | null;
  total_lines_added_at_submission: number | null;
  total_lines_added_at_merge: number | null;
  ai_flagged_lines_at_submission: number | null;
  ai_flagged_lines_at_merge: number | null;
  ai_submission_pct: number | null;
  ai_acceptance_pct: number | null;
  files_changed: string[];
  ai_tool_hint: string | null;
  review_cycle_count: number;
  comments_on_ai_lines: number | null;
  terminal_outcome: "ACCEPTED" | "REJECTED" | "OPEN";
  signal_source: "signalcode_telemetry";
  data_quality: "observed" | "partial" | "derived";
}

export interface ExportChangeSnapshotsResponse {
  exportedAt: string;
  totalRecords: number;
  records: ExportChangeSnapshotRow[];
}

export interface TeamOptionsResponse {
  teams: string[];
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export async function fetchStats(range: StatsRange, team: string | null = null): Promise<StatsResponse> {
  const params = new URLSearchParams({ range });
  if (team) {
    params.set("team", team);
  }
  const response = await fetch(`${apiBaseUrl}/api/stats?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.status}`);
  }
  return (await response.json()) as StatsResponse;
}

export async function fetchHealth(): Promise<{ ok: boolean }> {
  const response = await fetch(`${apiBaseUrl}/api/health`);
  if (!response.ok) {
    throw new Error(`Failed to fetch health: ${response.status}`);
  }
  return (await response.json()) as { ok: boolean };
}

export async function fetchIdeActivity(): Promise<IdeActivityResponse> {
  const response = await fetch(`${apiBaseUrl}/api/ide/activity`);
  if (!response.ok) {
    throw new Error(`Failed to fetch IDE activity: ${response.status}`);
  }
  return (await response.json()) as IdeActivityResponse;
}

export async function resetTelemetry(): Promise<{ ok: boolean }> {
  const response = await fetch(`${apiBaseUrl}/api/admin/reset-telemetry`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Failed to reset telemetry: ${response.status}`);
  }
  return (await response.json()) as { ok: boolean };
}

export async function fetchIdeEvents(): Promise<{ events: IdeMonitorEvent[] }> {
  const response = await fetch(`${apiBaseUrl}/api/ide/events`);
  if (!response.ok) {
    throw new Error(`Failed to fetch IDE events: ${response.status}`);
  }
  return (await response.json()) as { events: IdeMonitorEvent[] };
}

export async function fetchPostAcceptTaskRework(team: string | null = null): Promise<{ rows: PostAcceptTaskReworkRow[] }> {
  const params = new URLSearchParams();
  if (team) {
    params.set("team", team);
  }
  const suffix = params.toString();
  const response = await fetch(`${apiBaseUrl}/api/stats/post-accept-tasks${suffix ? `?${suffix}` : ""}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch post-accept task rework: ${response.status}`);
  }
  return (await response.json()) as { rows: PostAcceptTaskReworkRow[] };
}

export async function fetchExportChangeSnapshots(team: string | null = null): Promise<ExportChangeSnapshotsResponse> {
  const params = new URLSearchParams();
  if (team) {
    params.set("team", team);
  }
  const suffix = params.toString();
  const response = await fetch(`${apiBaseUrl}/api/export/pr-snapshots${suffix ? `?${suffix}` : ""}`);
  if (!response.ok) {
    throw new Error(`Failed to export change snapshots: ${response.status}`);
  }
  return (await response.json()) as ExportChangeSnapshotsResponse;
}

export async function fetchTeams(): Promise<TeamOptionsResponse> {
  const response = await fetch(`${apiBaseUrl}/api/teams`);
  if (!response.ok) {
    throw new Error(`Failed to fetch teams: ${response.status}`);
  }
  return (await response.json()) as TeamOptionsResponse;
}
