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

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export async function fetchStats(): Promise<StatsResponse> {
  const response = await fetch(`${apiBaseUrl}/api/stats`);
  if (!response.ok) {
    throw new Error(`Failed to fetch stats: ${response.status}`);
  }
  return (await response.json()) as StatsResponse;
}
