import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { useMemo, useState } from "react";
import type { IdeMonitorEvent, PostAcceptTaskReworkRow, StatsResponse } from "../api";

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function StatusBadge({ healthy, ideConnected }: { healthy: boolean; ideConnected: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge label={healthy ? "API Healthy" : "API Unreachable"} tone={healthy ? "success" : "danger"} />
      <Badge label={ideConnected ? "IDE Connected" : "IDE Disconnected"} tone={ideConnected ? "success" : "danger"} />
    </div>
  );
}

export function KpiGrid({ stats, isLoading }: { stats: StatsResponse | null; isLoading: boolean }) {
  const cards = [
    { label: "Acceptance Rate", value: formatPercent(stats?.acceptanceRate ?? 0), helper: "ACCEPTED / DIFF_RENDERED" },
    { label: "Total Tasks", value: String(stats?.totalTasks ?? 0), helper: "Unique successful tasks" },
    { label: "Avg Iterations", value: (stats?.averageIterationsBeforeAccept ?? 0).toFixed(2), helper: "ITERATED before ACCEPTED" },
    { label: "Post-Accept Edit Rate", value: formatPercent(stats?.postAccept.editedTaskRate ?? 0), helper: "Accepted tasks later edited" },
    { label: "Avg Post-Accept Char Delta", value: String((stats?.postAccept.avgCharDelta ?? 0).toFixed(1)), helper: "Max char delta per edited task" },
    { label: "Median Time To First Edit", value: `${(stats?.postAccept.medianSecondsToFirstEdit ?? 0).toFixed(1)}s`, helper: "After ACCEPTED to first human edit" }
  ];
  return (
    <section className="metric-grid">
      {cards.map((card) => (
        <article key={card.label} className="card">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">{card.label}</p>
          {isLoading || stats ? (
            <>
              <p className="mt-2 text-[28px] font-semibold leading-tight text-neutral-50">{isLoading ? "--" : card.value}</p>
              <p className="mt-1 text-xs text-neutral-500">{card.helper}</p>
            </>
          ) : (
            <CardEmptyState title="No metrics yet" subtitle="Awaiting telemetry ingestion." icon="kpi" compact />
          )}
        </article>
      ))}
    </section>
  );
}

export function ChartPanel({
  timeSeries
}: {
  timeSeries: Array<{ bucket: string; accepted: number; rejected: number }>;
}) {
  return (
    <section className="grid gap-3 xl:grid-cols-2">
      <article className="card">
        <h2 className="card-title">Accept vs Reject Trend</h2>
        {timeSeries.length === 0 ? (
          <CardEmptyState title="No trend data" subtitle="Events will appear after activity is captured." icon="chart" />
        ) : (
          <div className="h-64 sm:h-72">
            <ResponsiveContainer>
              <BarChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="bucket" stroke="#737373" tick={{ fontSize: 11 }} />
                <YAxis stroke="#737373" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="accepted" fill="#22c55e" radius={4} />
                <Bar dataKey="rejected" fill="#ef4444" radius={4} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </article>
      <article className="card">
        <h2 className="card-title">Acceptance Momentum</h2>
        {timeSeries.length === 0 ? (
          <CardEmptyState title="No momentum data" subtitle="No accepted events in selected range." icon="chart" />
        ) : (
          <div className="h-64 sm:h-72">
            <ResponsiveContainer>
              <AreaChart data={timeSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="bucket" stroke="#737373" tick={{ fontSize: 11 }} />
                <YAxis stroke="#737373" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Area type="monotone" dataKey="accepted" stroke="#38bdf8" fill="#0ea5e9" fillOpacity={0.35} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </article>
    </section>
  );
}

export function ActivityTable({
  rows
}: {
  rows: StatsResponse["recentActivity"];
}) {
  return (
    <section className="card">
      <h2 className="card-title">Recent Activity</h2>
      {rows.length === 0 ? (
        <CardEmptyState title="No activity rows" subtitle="Try a broader time range or wait for new events." icon="table" />
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-[13px]">
            <thead className="bg-neutral-900">
              <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-400">
                <Th>Timestamp</Th>
                <Th>Prompt snippet</Th>
                <Th>Model</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.task_id}-${row.diff_id}-${row.timestamp}-${row.outcome}`} className="h-9 border-b border-neutral-800 hover:bg-neutral-900/70">
                  <Td>{new Date(row.timestamp).toLocaleString()}</Td>
                  <Td>{row.promptSnippet}</Td>
                  <Td>{row.model}</Td>
                  <Td>{row.outcome}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ControlPanel(props: {
  autoRefreshMs: number;
  autoRefreshOptions: readonly number[];
  onAutoRefreshChange: (value: number) => void;
  timeRange: string;
  timeRanges: readonly string[];
  onTimeRangeChange: (value: "15m" | "1h" | "24h" | "7d") => void;
  query: string;
  onQueryChange: (value: string) => void;
  outcomeFilter: "ALL" | "ACCEPTED" | "REJECTED" | "ITERATED" | "DIFF_RENDERED";
  onOutcomeFilterChange: (value: "ALL" | "ACCEPTED" | "REJECTED" | "ITERATED" | "DIFF_RENDERED") => void;
  onRefresh: () => void;
  onResetDatabase: () => void;
}) {
  return (
    <nav className="card space-y-3" aria-label="Dashboard controls">
      <h2 className="card-title">Controls & Config</h2>
      <label className="control-row">
        <span>Auto Refresh</span>
        <select value={props.autoRefreshMs} onChange={(e) => props.onAutoRefreshChange(Number(e.target.value))} className="control-input">
          {props.autoRefreshOptions.map((value) => (
            <option key={value} value={value}>
              {value === 0 ? "Off" : `${value / 1000}s`}
            </option>
          ))}
        </select>
      </label>
      <label className="control-row">
        <span>Time Range</span>
        <select value={props.timeRange} onChange={(e) => props.onTimeRangeChange(e.target.value as "15m" | "1h" | "24h" | "7d")} className="control-input">
          {props.timeRanges.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="control-row">
        <span>Search</span>
        <input value={props.query} onChange={(e) => props.onQueryChange(e.target.value)} className="control-input" placeholder="Prompt or model..." />
      </label>
      <label className="control-row">
        <span>Outcome</span>
        <select value={props.outcomeFilter} onChange={(e) => props.onOutcomeFilterChange(e.target.value as "ALL" | "ACCEPTED" | "REJECTED" | "ITERATED" | "DIFF_RENDERED")} className="control-input">
          {["ALL", "DIFF_RENDERED", "ACCEPTED", "REJECTED", "ITERATED"].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" onClick={props.onRefresh} type="button">
          Refresh now
        </button>
      </div>
      <section className="rounded-md border border-red-800 bg-neutral-950 p-3">
        <p className="text-[11px] uppercase tracking-wide text-red-400">Danger Zone</p>
        <button className="mt-2 h-8 w-full rounded-md border border-red-700 px-3 text-[13px] text-red-300 transition hover:bg-red-950/60" onClick={props.onResetDatabase} type="button">
          Clear Database
        </button>
      </section>
    </nav>
  );
}

export function IdeEventDebugPanel({ events }: { events: IdeMonitorEvent[] }) {
  return (
    <section className="card">
      <h2 className="card-title">IDE Monitor Events (Last 10)</h2>
      <div className="space-y-2 text-xs">
        {events.length === 0 ? (
          <CardEmptyState title="No monitor events" subtitle="Open or edit files in IDE to stream events." icon="events" />
        ) : (
          events.map((event) => (
            <div key={`${event.timestamp}-${event.activityType}-${event.filePath ?? "none"}`} className="rounded-md border border-neutral-800 bg-neutral-950 p-2">
              <p className="text-neutral-300">{new Date(event.timestamp).toLocaleString()}</p>
              <p className="font-medium text-neutral-100">{event.activityType}</p>
              <p className="truncate font-mono text-[12px] text-neutral-400">{event.filePath ?? "n/a"}</p>
              <p className="text-neutral-500">{event.languageId ?? "unknown"}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function PostAcceptReworkPanel({ rows }: { rows: PostAcceptTaskReworkRow[] }) {
  const [selectedModel, setSelectedModel] = useState("ALL");
  const [minCharDelta, setMinCharDelta] = useState("0");
  const [maxSecondsToFirstEdit, setMaxSecondsToFirstEdit] = useState("ALL");
  const models = useMemo(() => ["ALL", ...Array.from(new Set(rows.map((row) => row.model)))], [rows]);
  const filteredRows = useMemo(() => {
    const minDelta = Number(minCharDelta) || 0;
    return rows.filter((row) => {
      const modelMatch = selectedModel === "ALL" ? true : row.model === selectedModel;
      const deltaMatch = row.maxCharDelta >= minDelta;
      const speedMatch =
        maxSecondsToFirstEdit === "ALL" ? true : row.secondsToFirstEdit <= Number(maxSecondsToFirstEdit);
      return modelMatch && deltaMatch && speedMatch;
    });
  }, [maxSecondsToFirstEdit, minCharDelta, rows, selectedModel]);

  const chartData = filteredRows.slice(0, 8).map((row) => ({
    task: row.taskId.slice(0, 8),
    maxCharDelta: row.maxCharDelta
  }));
  return (
    <section className="card">
      <h2 className="card-title">Post-Accept Rework (Top Tasks)</h2>
      {rows.length === 0 ? (
        <CardEmptyState title="No rework data yet" subtitle="Tasks will appear after accepted output is manually edited." icon="table" />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="control-row">
              <span>Model</span>
              <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} className="control-input">
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-row">
              <span>Min Char Delta</span>
              <input
                value={minCharDelta}
                onChange={(event) => setMinCharDelta(event.target.value)}
                className="control-input"
                inputMode="numeric"
              />
            </label>
            <label className="control-row">
              <span>First Edit Within</span>
              <select
                value={maxSecondsToFirstEdit}
                onChange={(event) => setMaxSecondsToFirstEdit(event.target.value)}
                className="control-input"
              >
                <option value="ALL">Any time</option>
                <option value="10">10s</option>
                <option value="30">30s</option>
                <option value="60">60s</option>
                <option value="300">5m</option>
              </select>
            </label>
          </div>
          {filteredRows.length === 0 ? (
            <CardEmptyState title="No tasks match filters" subtitle="Try wider thresholds or all models." icon="table" />
          ) : (
            <>
          <div className="h-48">
            <ResponsiveContainer>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis dataKey="task" stroke="#737373" tick={{ fontSize: 11 }} />
                <YAxis stroke="#737373" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="maxCharDelta" stroke="#3b82f6" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[13px]">
              <thead className="bg-neutral-900">
                <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-400">
                  <Th>Task</Th>
                  <Th>Prompt</Th>
                  <Th>Model</Th>
                  <Th>Max Char Delta</Th>
                  <Th>Edits</Th>
                  <Th>First Edit</Th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.taskId} className="h-9 border-b border-neutral-800 hover:bg-neutral-900/70">
                    <Td>{row.taskId.slice(0, 8)}</Td>
                    <Td>{row.promptSnippet}</Td>
                    <Td>{row.model}</Td>
                    <Td>{String(row.maxCharDelta)}</Td>
                    <Td>{String(row.editsAfterAccept)}</Td>
                    <Td>{`${row.secondsToFirstEdit.toFixed(1)}s`}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function CardEmptyState({
  title,
  subtitle,
  icon,
  compact = false
}: {
  title: string;
  subtitle: string;
  icon: "chart" | "table" | "events" | "kpi";
  compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-md border border-neutral-800 bg-neutral-950/60 px-3 text-center ${compact ? "py-3 mt-2" : "py-8 mt-2"}`}>
      <EmptyIcon icon={icon} />
      <p className="mt-2 text-[13px] font-medium text-neutral-200">{title}</p>
      <p className="mt-1 text-xs text-neutral-500">{subtitle}</p>
    </div>
  );
}

function EmptyIcon({ icon }: { icon: "chart" | "table" | "events" | "kpi" }) {
  if (icon === "table") {
    return (
      <svg width="44" height="28" viewBox="0 0 44 28" fill="none" aria-hidden>
        <rect x="1" y="1" width="42" height="26" rx="4" stroke="#404040" />
        <line x1="1" y1="9" x2="43" y2="9" stroke="#333333" />
        <line x1="14.5" y1="9" x2="14.5" y2="27" stroke="#262626" />
        <line x1="29.5" y1="9" x2="29.5" y2="27" stroke="#262626" />
      </svg>
    );
  }
  if (icon === "events") {
    return (
      <svg width="44" height="28" viewBox="0 0 44 28" fill="none" aria-hidden>
        <circle cx="7" cy="7" r="3" fill="#3b82f6" />
        <circle cx="7" cy="14" r="3" fill="#525252" />
        <circle cx="7" cy="21" r="3" fill="#525252" />
        <line x1="14" y1="7.5" x2="40" y2="7.5" stroke="#404040" />
        <line x1="14" y1="14.5" x2="40" y2="14.5" stroke="#333333" />
        <line x1="14" y1="21.5" x2="32" y2="21.5" stroke="#333333" />
      </svg>
    );
  }
  if (icon === "kpi") {
    return (
      <svg width="44" height="28" viewBox="0 0 44 28" fill="none" aria-hidden>
        <rect x="2" y="15" width="6" height="10" rx="1" fill="#404040" />
        <rect x="11" y="11" width="6" height="14" rx="1" fill="#525252" />
        <rect x="20" y="7" width="6" height="18" rx="1" fill="#737373" />
        <rect x="29" y="3" width="6" height="22" rx="1" fill="#3b82f6" />
      </svg>
    );
  }
  return (
    <svg width="44" height="28" viewBox="0 0 44 28" fill="none" aria-hidden>
      <rect x="1" y="1" width="42" height="26" rx="4" stroke="#404040" />
      <polyline points="6,20 14,14 21,17 30,9 38,12" stroke="#3b82f6" strokeWidth="1.5" fill="none" />
      <circle cx="30" cy="9" r="1.5" fill="#3b82f6" />
    </svg>
  );
}

function Badge({ label, tone }: { label: string; tone: "success" | "danger" }) {
  const klass = tone === "success" ? "bg-emerald-900/40 text-emerald-300" : "bg-red-900/40 text-red-300";
  return <span className={`status-chip ${klass}`}>{label}</span>;
}

function Th({ children }: { children: string }) {
  return <th className="px-3 py-2 font-medium">{children}</th>;
}

function Td({ children }: { children: string }) {
  return <td className="px-3 py-2 text-neutral-200">{children}</td>;
}
