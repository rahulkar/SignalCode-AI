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
  firstAcceptedAt: string;
  firstEditedAt: string;
  secondsToFirstEdit: number;
  maxCharDelta: number;
  maxLineDelta: number;
  editsAfterAccept: number;
}

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export async function fetchStats(range: StatsRange): Promise<StatsResponse> {
  const response = await fetch(`${apiBaseUrl}/api/stats?range=${encodeURIComponent(range)}`);
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

export async function fetchPostAcceptTaskRework(): Promise<{ rows: PostAcceptTaskReworkRow[] }> {
  const response = await fetch(`${apiBaseUrl}/api/stats/post-accept-tasks`);
  if (!response.ok) {
    throw new Error(`Failed to fetch post-accept task rework: ${response.status}`);
  }
  return (await response.json()) as { rows: PostAcceptTaskReworkRow[] };
}
