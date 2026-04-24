export type EventOutcome = "DIFF_RENDERED" | "ACCEPTED" | "REJECTED" | "ITERATED";

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
  }>;
  recentActivity: Array<{
    timestamp: string;
    promptSnippet: string;
    model: string;
    outcome: EventOutcome;
    task_id: string;
    diff_id: string;
  }>;
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

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export async function fetchStats(): Promise<StatsResponse> {
  const response = await fetch(`${apiBaseUrl}/api/stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.status}`);
  }
  return (await response.json()) as StatsResponse;
}

export async function fetchHealth(): Promise<{ ok: boolean }> {
  const response = await fetch(`${apiBaseUrl}/health`);
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
