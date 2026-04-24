export type TelemetryEventType =
  | "DIFF_RENDERED"
  | "ACCEPTED"
  | "REJECTED"
  | "ITERATED";

export type StatsRange = "15m" | "1h" | "24h" | "7d";
export type GenerateMode = "update_selection" | "insert_into_file" | "create_file";
export type OperationKind = "replace_range" | "insert_after" | "create_file";

export interface UsageMetrics {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

export interface AgentOperation {
  kind: OperationKind;
  summary: string;
  targetFilePath: string;
  search?: string;
  replace?: string;
  anchor?: string;
  content?: string;
}

export interface GenerateRequest {
  prompt: string;
  model?: string;
  mode?: GenerateMode;
  context: {
    filePath: string;
    projectRootPath?: string;
    targetFilePath?: string;
    selectionOrCaretSnippet: string;
    languageId?: string;
  };
}

export interface GenerateResponse {
  task_id: string;
  diff_id: string;
  raw: string;
  model: string;
  operation: AgentOperation;
  usage?: UsageMetrics;
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
  iterated: number;
  diffRendered: number;
  acceptanceMomentum: number;
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
