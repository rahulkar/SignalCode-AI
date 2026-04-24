import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  fetchHealth,
  fetchIdeActivity,
  fetchIdeEvents,
  fetchPostAcceptTaskRework,
  fetchStats,
  resetTelemetry,
  type IdeActivityResponse,
  type IdeMonitorEvent,
  type PostAcceptTaskReworkRow,
  type StatsRange,
  type StatsResponse
} from "./api";
import { ActivityTable, ChartPanel, ControlPanel, IdeEventDebugPanel, KpiGrid, PostAcceptReworkPanel, StatusBadge } from "./components/dashboard";

const AUTO_REFRESH_OPTIONS = [0, 5000, 10000, 30000] as const;
const TIME_RANGES = ["15m", "1h", "24h", "7d"] as const;
const PIE_TOOLTIP_STYLE = {
  backgroundColor: "#0f172a",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: "14px",
  color: "#e2e8f0",
  boxShadow: "0 24px 48px rgba(2, 6, 23, 0.32)"
};

export function App() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [ideActivity, setIdeActivity] = useState<IdeActivityResponse | null>(null);
  const [apiHealthy, setApiHealthy] = useState(false);
  const [ideEvents, setIdeEvents] = useState<IdeMonitorEvent[]>([]);
  const [postAcceptRows, setPostAcceptRows] = useState<PostAcceptTaskReworkRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [autoRefreshMs, setAutoRefreshMs] = useState<number>(10000);
  const [timeRange, setTimeRange] = useState<StatsRange>("24h");
  const [query, setQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"ALL" | "ACCEPTED" | "REJECTED" | "ITERATED" | "DIFF_RENDERED">("ALL");
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  const load = async (range: StatsRange) => {
    const [statsRes, healthRes, ideRes, ideEventsRes, postAcceptRes] = await Promise.allSettled([
      fetchStats(range),
      fetchHealth(),
      fetchIdeActivity(),
      fetchIdeEvents(),
      fetchPostAcceptTaskRework()
    ]);

    if (statsRes.status === "fulfilled") {
      setStats(statsRes.value);
      setError(null);
      setLastLoadedAt(new Date().toISOString());
    } else {
      setError(statsRes.reason instanceof Error ? statsRes.reason.message : "Failed to load dashboard data");
    }

    setApiHealthy(healthRes.status === "fulfilled" ? healthRes.value.ok : false);
    if (ideRes.status === "fulfilled") {
      setIdeActivity(ideRes.value);
    } else {
      setIdeActivity(null);
    }
    if (ideEventsRes.status === "fulfilled") {
      setIdeEvents(ideEventsRes.value.events);
    } else {
      setIdeEvents([]);
    }
    if (postAcceptRes.status === "fulfilled") {
      setPostAcceptRows(postAcceptRes.value.rows);
    } else {
      setPostAcceptRows([]);
    }

    setIsLoading(false);
  };

  useEffect(() => {
    setIsLoading(true);
    void load(timeRange);
  }, [timeRange]);

  useEffect(() => {
    if (autoRefreshMs === 0) return;
    const timer = window.setInterval(() => void load(timeRange), autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshMs, timeRange]);

  const filteredActivity = useMemo(() => {
    const rows = stats?.recentActivity ?? [];
    return rows.filter((row) => {
      if (row.model === "ide-monitor") {
        return false;
      }
      const matchesOutcome = outcomeFilter === "ALL" ? true : row.outcome === outcomeFilter;
      const q = query.trim().toLowerCase();
      const matchesQuery = q.length === 0 || row.promptSnippet.toLowerCase().includes(q) || row.model.toLowerCase().includes(q);
      return matchesOutcome && matchesQuery;
    });
  }, [outcomeFilter, query, stats?.recentActivity]);

  const visibleIdeEvents = useMemo(() => ideEvents.filter((event) => event.activityType !== "heartbeat"), [ideEvents]);

  const outcomeData = useMemo(
    () => [
      { name: "Accepted", value: stats?.totals.accepted ?? 0, color: "#1fb86a" },
      { name: "Rejected", value: stats?.totals.rejected ?? 0, color: "#f46d5e" },
      { name: "Iterated", value: stats?.totals.iterated ?? 0, color: "#4f7cff" }
    ],
    [stats]
  );
  const pieData = outcomeData.filter((item) => item.value > 0);
  const totalOutcomeCount = outcomeData.reduce((sum, item) => sum + item.value, 0);

  const onResetDatabase = async () => {
    const ok = window.confirm("Clear all telemetry events and tasks?");
    if (!ok) return;
    try {
      await resetTelemetry();
      await load(timeRange);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear database");
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__inner">
          <div>
            <p className="topbar__eyebrow">SignalCode Enterprise</p>
            <h1 className="topbar__title">Telemetry Command Center</h1>
            <p className="topbar__subtitle">Enterprise-grade visibility into generation flow, acceptance quality, and post-accept rework.</p>
          </div>
          <div className="topbar__actions">
            <div className="hero-chip-group">
              <InfoChip label="Window" value={timeRange.toUpperCase()} />
              <InfoChip label="Refresh" value={autoRefreshMs === 0 ? "Manual" : `${autoRefreshMs / 1000}s`} />
              <InfoChip label="Last Sync" value={formatLastSync(lastLoadedAt)} />
            </div>
            <StatusBadge healthy={apiHealthy} ideConnected={ideActivity?.ideConnected ?? false} />
          </div>
        </div>
      </header>

      <main className="app-main">
        <section className="hero-banner">
          <div>
            <p className="hero-banner__eyebrow">Operations Overview</p>
            <h2 className="hero-banner__title">A cleaner control room for prompt delivery analytics</h2>
            <p className="hero-banner__copy">
              Platform KPIs stay visible at a glance while the trend panels and activity feed follow the selected analysis window.
            </p>
          </div>
          <div className="hero-banner__meta">
            <HeroStat label="Accepted" value={String(stats?.totals.accepted ?? 0)} accent="success" />
            <HeroStat label="Rejected" value={String(stats?.totals.rejected ?? 0)} accent="danger" />
            <HeroStat label="Iterated" value={String(stats?.totals.iterated ?? 0)} accent="info" />
          </div>
        </section>

        <div className="dashboard-grid">
          <section className="space-y-4">
            <KpiGrid stats={stats} isLoading={isLoading} />
            <ChartPanel timeSeries={stats?.timeSeries ?? []} timeRange={timeRange} />

            <motion.section layout className="card card--elevated">
              <div className="panel-heading">
                <div>
                  <p className="panel-heading__eyebrow">Distribution</p>
                  <h2 className="panel-heading__title">Overall outcome mix</h2>
                  <p className="panel-heading__subtitle">Zero-value segments are suppressed from the pie so active outcomes stay readable.</p>
                </div>
              </div>
              {pieData.length > 0 ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="h-72 sm:h-80">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={72}
                          outerRadius={112}
                          paddingAngle={3}
                          stroke="rgba(15, 23, 42, 0.9)"
                          strokeWidth={2}
                        >
                          {pieData.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={PIE_TOOLTIP_STYLE}
                          formatter={(value: number, name: string) => [value, name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="distribution-legend">
                    {outcomeData.map((item) => (
                      <div key={item.name} className="distribution-legend__row">
                        <div className="distribution-legend__label">
                          <span className="distribution-legend__dot" style={{ backgroundColor: item.color }} aria-hidden />
                          <span>{item.name}</span>
                        </div>
                        <div className="distribution-legend__values">
                          <strong>{item.value}</strong>
                          <span>{totalOutcomeCount === 0 ? "0%" : `${((item.value / totalOutcomeCount) * 100).toFixed(0)}%`}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <PanelEmptyState label="No outcome distribution yet" />
              )}
            </motion.section>

            <ActivityTable rows={filteredActivity} />
            <PostAcceptReworkPanel rows={postAcceptRows} />
          </section>

          <aside className="dashboard-aside">
            <ControlPanel
              autoRefreshMs={autoRefreshMs}
              autoRefreshOptions={AUTO_REFRESH_OPTIONS}
              onAutoRefreshChange={setAutoRefreshMs}
              timeRange={timeRange}
              timeRanges={TIME_RANGES}
              onTimeRangeChange={setTimeRange}
              query={query}
              onQueryChange={setQuery}
              outcomeFilter={outcomeFilter}
              onOutcomeFilterChange={setOutcomeFilter}
              onRefresh={() => void load(timeRange)}
              onResetDatabase={() => void onResetDatabase()}
            />

            <section className="card card--elevated">
              <div className="panel-heading">
                <div>
                  <p className="panel-heading__eyebrow">Live Connection</p>
                  <h2 className="panel-heading__title">IDE status</h2>
                </div>
              </div>
              {ideActivity?.lastEventAt ? (
                <dl className="space-y-2 text-[13px]">
                  <MetricRow label="Connected" value={ideActivity?.ideConnected ? "Yes" : "No"} />
                  <MetricRow label="Last event" value={formatDate(ideActivity?.lastEventAt)} />
                  <MetricRow label="Current file" value={ideActivity?.currentFile ?? "n/a"} />
                  <MetricRow label="Last edited" value={ideActivity?.lastEditedFile ?? "n/a"} />
                  <MetricRow label="Last added" value={ideActivity?.lastAddedFile ?? "n/a"} />
                </dl>
              ) : (
                <PanelEmptyState label="IDE has not sent events yet" compact />
              )}
            </section>

            <IdeEventDebugPanel events={visibleIdeEvents} />
            <AnimatePresence>{error ? <ErrorBanner message={error} /> : null}</AnimatePresence>
          </aside>
        </div>
      </main>
    </div>
  );
}

function PanelEmptyState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`empty-state ${compact ? "empty-state--compact" : ""}`}>
      <svg width={compact ? 76 : 96} height={compact ? 44 : 56} viewBox="0 0 96 56" role="img" aria-label="Empty state">
        <rect x="8" y="8" width="80" height="40" rx="10" fill="#0f172a" stroke="#334155" />
        <line x1="18" y1="22" x2="78" y2="22" stroke="#475569" />
        <line x1="18" y1="30" x2="64" y2="30" stroke="#334155" />
        <line x1="18" y1="37" x2="58" y2="37" stroke="#334155" />
      </svg>
      <p className="empty-state__subtitle">{label}</p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-row">
      <dt className="metric-row__label">{label}</dt>
      <dd className="metric-row__value">{value}</dd>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18 }}
      className="error-banner"
    >
      {message}
    </motion.div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HeroStat({ label, value, accent }: { label: string; value: string; accent: "success" | "danger" | "info" }) {
  return (
    <div className={`hero-stat hero-stat--${accent}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function formatLastSync(value: string | null): string {
  if (!value) return "Pending";
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
