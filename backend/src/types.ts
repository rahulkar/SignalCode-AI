export type TelemetryEventType =
  | "DIFF_RENDERED"
  | "ACCEPTED"
  | "REJECTED"
  | "ITERATED";

export interface GenerateRequest {
  prompt: string;
  model?: string;
  context: {
    filePath: string;
    selectionOrCaretSnippet: string;
    languageId?: string;
  };
}

export interface GenerateResponse {
  task_id: string;
  diff_id: string;
  raw: string;
  model: string;
}

export interface TelemetryRequest {
  task_id: string;
  diff_id: string;
  event: TelemetryEventType;
  timestamp?: string;
  meta?: Record<string, unknown>;
}

export interface TimeSeriesPoint {
  bucket: string;
  accepted: number;
  rejected: number;
}

export interface RecentActivityRow {
  timestamp: string;
  promptSnippet: string;
  model: string;
  outcome: TelemetryEventType;
  task_id: string;
  diff_id: string;
}

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
  timeSeries: TimeSeriesPoint[];
  recentActivity: RecentActivityRow[];
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
