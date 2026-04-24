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
import { useMemo, useState, type ReactNode } from "react";
import type { IdeMonitorEvent, PostAcceptTaskReworkRow, StatsRange, StatsResponse } from "../api";
import { Icon, type IconName } from "./icons";

const CHART_GRID_STROKE = "rgba(148, 163, 184, 0.14)";
const CHART_AXIS_STROKE = "#737373";
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e5e5",
  borderRadius: "6px",
  color: "#0a0a0a",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)"
};

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatRangeLabel(range: StatsRange): string {
  if (range === "15m") return "15 minutes";
  if (range === "1h") return "1 hour";
  if (range === "24h") return "24 hours";
  return "7 days";
}

function formatBucketLabel(bucket: string, range: StatsRange): string {
  const date = new Date(bucket);
  if (range === "15m" || range === "1h") {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "24h") {
    return date.toLocaleTimeString([], { hour: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function StatusBadge({ healthy, ideConnected }: { healthy: boolean; ideConnected: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge icon="server" label={healthy ? "API Healthy" : "API Unreachable"} tone={healthy ? "success" : "danger"} />
      <Badge icon="terminal" label={ideConnected ? "IDE Connected" : "IDE Disconnected"} tone={ideConnected ? "success" : "danger"} />
    </div>
  );
}

export function KpiGrid({ stats, isLoading }: { stats: StatsResponse | null; isLoading: boolean }) {
  const cards = [
    { label: "Acceptance Rate", value: formatPercent(stats?.acceptanceRate ?? 0), helper: "Overall accepted / diff rendered", icon: "rate" as const, tone: "info" as const },
    { label: "Total Tasks", value: String(stats?.totalTasks ?? 0), helper: "Successful tasks recorded", icon: "tasks" as const, tone: "neutral" as const },
    { label: "Avg Iterations", value: (stats?.averageIterationsBeforeAccept ?? 0).toFixed(2), helper: "Iterations before first accept", icon: "layers" as const, tone: "info" as const },
    { label: "Post-Accept Edit Rate", value: formatPercent(stats?.postAccept.editedTaskRate ?? 0), helper: "Accepted tasks later edited", icon: "edit" as const, tone: "warning" as const },
    { label: "Avg Post-Accept Char Delta", value: String((stats?.postAccept.avgCharDelta ?? 0).toFixed(1)), helper: "Largest character delta per task", icon: "type" as const, tone: "warning" as const },
    { label: "Median Time To First Edit", value: `${(stats?.postAccept.medianSecondsToFirstEdit ?? 0).toFixed(1)}s`, helper: "From accept to first human edit", icon: "timer" as const, tone: "success" as const }
  ];

  return (
    <section className="metric-grid">
      {cards.map((card, index) => (
        <article key={card.label} className="metric-card">
          <div className="metric-card__accent" aria-hidden style={{ animationDelay: `${index * 70}ms` }} />
          <div className="metric-card__header">
            <p className="metric-card__label">{card.label}</p>
            <span className={`icon-badge icon-badge--${card.tone}`} aria-hidden>
              <Icon name={card.icon} size={15} />
            </span>
          </div>
          {isLoading || stats ? (
            <>
              <p className="metric-card__value">{isLoading ? "--" : card.value}</p>
              <p className="metric-card__helper">{card.helper}</p>
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
  timeSeries,
  timeRange,
  isDark
}: {
  timeSeries: StatsResponse["timeSeries"];
  timeRange: StatsRange;
  isDark: boolean;
}) {
  const hasTimeSeries = timeSeries.some(
    (point) => point.accepted > 0 || point.rejected > 0 || point.iterated > 0 || point.diffRendered > 0
  );
  const hasOutcomeFlow = timeSeries.some((point) => point.accepted > 0 || point.rejected > 0 || point.iterated > 0);
  const flowChartData = useMemo(
    () => timeSeries.filter((point) => point.accepted > 0 || point.rejected > 0 || point.iterated > 0),
    [timeSeries]
  );
  const totals = useMemo(
    () =>
      timeSeries.reduce(
        (summary, point) => ({
          accepted: summary.accepted + point.accepted,
          rejected: summary.rejected + point.rejected,
          iterated: summary.iterated + point.iterated,
          diffRendered: summary.diffRendered + point.diffRendered
        }),
        { accepted: 0, rejected: 0, iterated: 0, diffRendered: 0 }
      ),
    [timeSeries]
  );
  const latestMomentum = timeSeries[timeSeries.length - 1]?.acceptanceMomentum ?? 0;

  return (
    <section className="space-y-4">
      <div className="section-heading">
        <div>
          <p className="section-heading__eyebrow">Windowed Analytics</p>
          <h2 className="section-heading__title section-heading__title--with-icon">
            <span className="icon-badge icon-badge--info" aria-hidden>
              <Icon name="chart" size={16} />
            </span>
            Recent delivery behavior
          </h2>
          <p className="section-heading__subtitle">Trends are bucketed across the last {formatRangeLabel(timeRange)}.</p>
        </div>
        <div className="summary-pill-group">
          <SummaryPill icon="table" label="Rendered" value={String(totals.diffRendered)} />
          <SummaryPill icon="accepted" label="Accepted" value={String(totals.accepted)} tone="success" />
          <SummaryPill icon="momentum" label="Momentum" value={formatPercent(latestMomentum)} tone="info" />
        </div>
      </div>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="card card--elevated">
          <ChartHeader
            icon="chart"
            title="Outcome Flow"
            subtitle="Accepted, iterated, and rejected outputs across the active analysis window."
            badge={timeRange.toUpperCase()}
          />
          {hasOutcomeFlow ? (
            <div className="h-72 sm:h-80">
              <ResponsiveContainer>
                <BarChart data={flowChartData} barGap={10} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                  <XAxis
                    dataKey="bucket"
                    stroke={CHART_AXIS_STROKE}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => formatBucketLabel(value, timeRange)}
                    minTickGap={24}
                  />
                  <YAxis stroke={CHART_AXIS_STROKE} tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip
                    contentStyle={buildChartTooltipStyle(isDark)}
                    labelFormatter={(value) => new Date(value).toLocaleString()}
                    formatter={(value: number, name: string) => [value, toTitleCase(name)]}
                  />
                  <Bar dataKey="accepted" name="Accepted" fill="#16a34a" radius={[4, 4, 0, 0]} minPointSize={8} />
                  <Bar dataKey="iterated" name="Iterated" fill="#2563eb" radius={[4, 4, 0, 0]} minPointSize={8} />
                  <Bar dataKey="rejected" name="Rejected" fill="#dc2626" radius={[4, 4, 0, 0]} minPointSize={8} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : hasTimeSeries ? (
            <CardEmptyState
              title="No accepted, rejected, or iterated events"
              subtitle="The current window has rendered activity, but no terminal outcomes have been recorded yet."
              icon="chart"
            />
          ) : (
            <CardEmptyState
              title="No outcome trend data"
              subtitle="Events will appear here once telemetry is captured inside the selected window."
              icon="chart"
            />
          )}
        </article>

        <article className="card card--elevated">
          <ChartHeader
            icon="momentum"
            title="Acceptance Momentum"
            subtitle="Cumulative acceptance rate against rendered diffs, expressed as a percentage."
            badge={formatPercent(latestMomentum)}
          />
          {hasTimeSeries ? (
            <div className="h-72 sm:h-80">
              <ResponsiveContainer>
                <AreaChart data={timeSeries}>
                  <defs>
                    <linearGradient id="momentumFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                  <XAxis
                    dataKey="bucket"
                    stroke={CHART_AXIS_STROKE}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => formatBucketLabel(value, timeRange)}
                    minTickGap={24}
                  />
                  <YAxis
                    stroke={CHART_AXIS_STROKE}
                    tick={{ fontSize: 11 }}
                    domain={[0, 100]}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip
                    contentStyle={buildChartTooltipStyle(isDark)}
                    labelFormatter={(value) => new Date(value).toLocaleString()}
                    formatter={(value: number) => [`${value.toFixed(1)}%`, "Acceptance Momentum"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="acceptanceMomentum"
                    stroke="#2563eb"
                    strokeWidth={2}
                    fill="url(#momentumFill)"
                    activeDot={{ r: 4, strokeWidth: 0, fill: "#2563eb" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <CardEmptyState title="No momentum data" subtitle="Momentum appears when rendered diffs enter the selected window." icon="chart" />
          )}
        </article>
      </section>
    </section>
  );
}

export function ActivityTable({ rows }: { rows: StatsResponse["recentActivity"] }) {
  return (
    <section className="card card--elevated">
      <div className="panel-heading">
        <div>
          <p className="panel-heading__eyebrow">Activity Feed</p>
          <h2 className="panel-heading__title panel-heading__title--with-icon">
            <span className="icon-badge icon-badge--info" aria-hidden>
              <Icon name="events" size={16} />
            </span>
            Recent task events
          </h2>
        </div>
        {rows.length > 5 ? <span className="soft-badge">5-row window</span> : null}
      </div>
      {rows.length === 0 ? (
        <CardEmptyState title="No activity rows" subtitle="Try a broader time range or wait for new events." icon="table" />
      ) : (
        <div className="table-shell table-shell--activity">
          <table className="data-table">
            <thead>
              <tr>
                <Th>Timestamp</Th>
                <Th>Prompt snippet</Th>
                <Th>Model</Th>
                <Th>Outcome</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.task_id}-${row.diff_id}-${row.timestamp}-${row.outcome}`}>
                  <Td>{new Date(row.timestamp).toLocaleString()}</Td>
                  <Td>{row.promptSnippet}</Td>
                  <Td>{row.model}</Td>
                  <Td>
                    <OutcomePill outcome={row.outcome} />
                  </Td>
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
  timeRange: StatsRange;
  timeRanges: readonly StatsRange[];
  onTimeRangeChange: (value: StatsRange) => void;
  query: string;
  onQueryChange: (value: string) => void;
  outcomeFilter: "ALL" | "ACCEPTED" | "REJECTED" | "ITERATED" | "DIFF_RENDERED";
  onOutcomeFilterChange: (value: "ALL" | "ACCEPTED" | "REJECTED" | "ITERATED" | "DIFF_RENDERED") => void;
  onRefresh: () => void;
  onExportChangeSnapshots: () => void;
  isExporting: boolean;
  onResetDatabase: () => void;
}) {
  return (
    <nav className="card card--elevated space-y-5" aria-label="Dashboard controls">
      <div className="panel-heading">
        <div>
          <p className="panel-heading__eyebrow">Command Panel</p>
          <h2 className="panel-heading__title panel-heading__title--with-icon">
            <span className="icon-badge icon-badge--info" aria-hidden>
              <Icon name="filter" size={16} />
            </span>
            Filters and controls
          </h2>
          <p className="panel-heading__subtitle">Adjust the analysis window, filters, and refresh cadence.</p>
        </div>
      </div>

      <div className="control-group">
        <div className="control-group__header">
          <span className="icon-badge icon-badge--info" aria-hidden>
            <Icon name="refresh" size={14} />
          </span>
          <span>Cadence</span>
        </div>
        <label className="control-row">
          <span className="control-label">
            <Icon name="refresh" size={14} />
            Auto Refresh
          </span>
          <select value={props.autoRefreshMs} onChange={(e) => props.onAutoRefreshChange(Number(e.target.value))} className="control-input">
            {props.autoRefreshOptions.map((value) => (
              <option key={value} value={value}>
                {value === 0 ? "Off" : `${value / 1000}s`}
              </option>
            ))}
          </select>
        </label>
        <label className="control-row">
          <span className="control-label">
            <Icon name="window" size={14} />
            Analysis Window
          </span>
          <select value={props.timeRange} onChange={(e) => props.onTimeRangeChange(e.target.value as StatsRange)} className="control-input">
            {props.timeRanges.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="control-group">
        <div className="control-group__header">
          <span className="icon-badge icon-badge--info" aria-hidden>
            <Icon name="search" size={14} />
          </span>
          <span>Filters</span>
        </div>
        <label className="control-row">
          <span className="control-label">
            <Icon name="search" size={14} />
            Search
          </span>
          <input value={props.query} onChange={(e) => props.onQueryChange(e.target.value)} className="control-input" placeholder="Prompt or model..." />
        </label>
        <label className="control-row">
          <span className="control-label">
            <Icon name="filter" size={14} />
            Outcome
          </span>
          <select
            value={props.outcomeFilter}
            onChange={(e) => props.onOutcomeFilterChange(e.target.value as "ALL" | "ACCEPTED" | "REJECTED" | "ITERATED" | "DIFF_RENDERED")}
            className="control-input"
          >
            {["ALL", "DIFF_RENDERED", "ACCEPTED", "REJECTED", "ITERATED"].map((value) => (
              <option key={value} value={value}>
                {toTitleCase(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-2">
        <button className="btn-primary" onClick={props.onRefresh} type="button">
          <Icon name="refresh" size={15} />
          Refresh dashboard
        </button>
        <button className="btn-secondary" onClick={props.onExportChangeSnapshots} type="button" disabled={props.isExporting}>
          <Icon name="download" size={15} />
          {props.isExporting ? "Exporting..." : "Export PR-style JSON"}
        </button>
        <p className="text-[11px]" style={{ color: "var(--text-tertiary)" }}>
          Downloads a best-effort snapshot export derived from SignalCode task telemetry for downstream analytics pipelines.
        </p>
      </div>

      <section className="danger-card">
        <div>
          <p className="danger-card__eyebrow">Danger Zone</p>
          <p className="danger-card__copy">Remove all recorded telemetry and restart the command center with an empty data store.</p>
        </div>
        <button className="btn-danger" onClick={props.onResetDatabase} type="button">
          <Icon name="trash" size={15} />
          Clear database
        </button>
      </section>
    </nav>
  );
}

export function IdeEventDebugPanel({ events }: { events: IdeMonitorEvent[] }) {
  return (
    <section className="card card--elevated">
      <div className="panel-heading">
        <div>
          <p className="panel-heading__eyebrow">IDE Telemetry</p>
          <h2 className="panel-heading__title panel-heading__title--with-icon">
            <span className="icon-badge icon-badge--info" aria-hidden>
              <Icon name="terminal" size={16} />
            </span>
            Last 10 monitor events
          </h2>
        </div>
      </div>
      <div className="space-y-2 text-xs">
        {events.length === 0 ? (
          <CardEmptyState title="No monitor events" subtitle="Open or edit files in the IDE to stream activity here." icon="events" />
        ) : (
          events.map((event) => (
            <div key={`${event.timestamp}-${event.activityType}-${event.filePath ?? "none"}`} className="event-card">
              <p className="event-card__timestamp">{new Date(event.timestamp).toLocaleString()}</p>
              <p className="event-card__title">
                <span className="event-card__icon" aria-hidden>
                  <Icon name="events" size={14} />
                </span>
                {event.activityType}
              </p>
              <p className="event-card__path">{event.filePath ?? "n/a"}</p>
              <p className="event-card__meta">{event.languageId ?? "unknown"}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function PostAcceptReworkPanel({ rows, isDark }: { rows: PostAcceptTaskReworkRow[]; isDark: boolean }) {
  const [selectedModel, setSelectedModel] = useState("ALL");
  const [minCharDelta, setMinCharDelta] = useState("0");
  const [maxSecondsToFirstEdit, setMaxSecondsToFirstEdit] = useState("ALL");
  const models = useMemo(() => ["ALL", ...Array.from(new Set(rows.map((row) => row.model)))], [rows]);
  const filteredRows = useMemo(() => {
    const minDelta = Number(minCharDelta) || 0;
    return rows.filter((row) => {
      const modelMatch = selectedModel === "ALL" ? true : row.model === selectedModel;
      const deltaMatch = row.maxCharDelta >= minDelta;
      const speedMatch = maxSecondsToFirstEdit === "ALL" ? true : row.secondsToFirstEdit <= Number(maxSecondsToFirstEdit);
      return modelMatch && deltaMatch && speedMatch;
    });
  }, [maxSecondsToFirstEdit, minCharDelta, rows, selectedModel]);

  const chartData = filteredRows.slice(0, 8).map((row) => ({
    task: row.taskId.slice(0, 8),
    maxCharDelta: row.maxCharDelta
  }));

  return (
    <section className="card card--elevated">
      <div className="panel-heading">
        <div>
          <p className="panel-heading__eyebrow">Quality Follow-Up</p>
          <h2 className="panel-heading__title panel-heading__title--with-icon">
            <span className="icon-badge icon-badge--warning" aria-hidden>
              <Icon name="edit" size={16} />
            </span>
            Post-accept rework
          </h2>
          <p className="panel-heading__subtitle">Inspect the tasks that triggered the largest manual corrections after acceptance.</p>
        </div>
      </div>
      {rows.length === 0 ? (
        <CardEmptyState title="No rework data yet" subtitle="Tasks appear here after accepted output is manually edited." icon="table" />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="control-row">
              <span className="control-label">
                <Icon name="terminal" size={14} />
                Model
              </span>
              <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} className="control-input">
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
            <label className="control-row">
              <span className="control-label">
                <Icon name="type" size={14} />
                Min Char Delta
              </span>
              <input value={minCharDelta} onChange={(event) => setMinCharDelta(event.target.value)} className="control-input" inputMode="numeric" />
            </label>
            <label className="control-row">
              <span className="control-label">
                <Icon name="timer" size={14} />
                First Edit Within
              </span>
              <select value={maxSecondsToFirstEdit} onChange={(event) => setMaxSecondsToFirstEdit(event.target.value)} className="control-input">
                <option value="ALL">Any time</option>
                <option value="10">10s</option>
                <option value="30">30s</option>
                <option value="60">60s</option>
                <option value="300">5m</option>
              </select>
            </label>
          </div>
          {filteredRows.length === 0 ? (
            <CardEmptyState title="No tasks match filters" subtitle="Try wider thresholds or include all models." icon="table" />
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID_STROKE} vertical={false} />
                    <XAxis dataKey="task" stroke={CHART_AXIS_STROKE} tick={{ fontSize: 11 }} />
                    <YAxis stroke={CHART_AXIS_STROKE} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={buildChartTooltipStyle(isDark)} />
                    <Line type="monotone" dataKey="maxCharDelta" stroke="#2563eb" strokeWidth={2} dot={{ r: 3, fill: "#2563eb" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="table-shell">
                <table className="data-table">
                  <thead>
                    <tr>
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
                      <tr key={row.taskId}>
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
    <div className={`empty-state ${compact ? "empty-state--compact" : ""}`}>
      <span className="empty-state__icon" aria-hidden>
        <Icon name={iconToIconName(icon)} size={22} />
      </span>
      <p className="empty-state__title">{title}</p>
      <p className="empty-state__subtitle">{subtitle}</p>
    </div>
  );
}

function ChartHeader({ icon, title, subtitle, badge }: { icon: IconName; title: string; subtitle: string; badge: string }) {
  return (
    <div className="chart-header">
      <div>
        <h3 className="chart-header__title chart-header__title--with-icon">
          <span className="icon-badge icon-badge--info" aria-hidden>
            <Icon name={icon} size={16} />
          </span>
          {title}
        </h3>
        <p className="chart-header__subtitle">{subtitle}</p>
      </div>
      <span className="soft-badge">{badge}</span>
    </div>
  );
}

function SummaryPill({
  icon,
  label,
  value,
  tone = "default"
}: {
  icon: IconName;
  label: string;
  value: string;
  tone?: "default" | "success" | "info";
}) {
  return (
    <div className={`summary-pill summary-pill--${tone}`}>
      <span className="chip-icon" aria-hidden>
        <Icon name={icon} size={14} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({ icon, label, tone }: { icon: IconName; label: string; tone: "success" | "danger" }) {
  return (
    <span className={`status-chip status-chip--${tone}`}>
      <span className="status-chip__dot" aria-hidden>
        <Icon name={icon} size={12} />
      </span>
      {label}
    </span>
  );
}

function OutcomePill({ outcome }: { outcome: "DIFF_RENDERED" | "ACCEPTED" | "REJECTED" | "ITERATED" }) {
  const tone =
    outcome === "ACCEPTED" ? "success" : outcome === "REJECTED" ? "danger" : outcome === "ITERATED" ? "info" : "neutral";
  return <span className={`outcome-pill outcome-pill--${tone}`}>{toTitleCase(outcome)}</span>;
}

function Th({ children }: { children: string }) {
  return <th>{children}</th>;
}

function Td({ children }: { children: ReactNode }) {
  return <td>{children}</td>;
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildChartTooltipStyle(isDark: boolean) {
  return {
    ...CHART_TOOLTIP_STYLE,
    backgroundColor: isDark ? "#171717" : "#ffffff",
    border: isDark ? "1px solid #333333" : "1px solid #e5e5e5",
    color: isDark ? "#fafafa" : "#0a0a0a",
    boxShadow: isDark ? "0 4px 12px rgba(0, 0, 0, 0.24)" : "0 1px 2px rgba(0, 0, 0, 0.06)"
  };
}

function iconToIconName(icon: "chart" | "table" | "events" | "kpi"): IconName {
  if (icon === "table") return "table";
  if (icon === "events") return "events";
  if (icon === "kpi") return "rate";
  return "chart";
}
