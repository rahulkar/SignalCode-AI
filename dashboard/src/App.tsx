import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
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
  type StatsResponse
} from "./api";
import { ActivityTable, ChartPanel, ControlPanel, IdeEventDebugPanel, KpiGrid, PostAcceptReworkPanel, StatusBadge } from "./components/dashboard";

const AUTO_REFRESH_OPTIONS = [0, 5000, 10000, 30000] as const;
const TIME_RANGES = ["15m", "1h", "24h", "7d"] as const;

export function App() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [ideActivity, setIdeActivity] = useState<IdeActivityResponse | null>(null);
  const [apiHealthy, setApiHealthy] = useState(false);
  const [ideEvents, setIdeEvents] = useState<IdeMonitorEvent[]>([]);
  const [postAcceptRows, setPostAcceptRows] = useState<PostAcceptTaskReworkRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [autoRefreshMs, setAutoRefreshMs] = useState<number>(10000);
  const [timeRange, setTimeRange] = useState<(typeof TIME_RANGES)[number]>("24h");
  const [query, setQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"ALL" | "ACCEPTED" | "REJECTED" | "ITERATED" | "DIFF_RENDERED">("ALL");

  const load = async () => {
    const [statsRes, healthRes, ideRes, ideEventsRes, postAcceptRes] = await Promise.allSettled([
      fetchStats(),
      fetchHealth(),
      fetchIdeActivity(),
      fetchIdeEvents(),
      fetchPostAcceptTaskRework()
    ]);

    if (statsRes.status === "fulfilled") {
      setStats(statsRes.value);
      setError(null);
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
    void load();
  }, []);

  useEffect(() => {
    if (autoRefreshMs === 0) return;
    const timer = window.setInterval(() => void load(), autoRefreshMs);
    return () => window.clearInterval(timer);
  }, [autoRefreshMs]);

  const cutoff = useMemo(() => {
    const now = Date.now();
    if (timeRange === "15m") return now - 15 * 60 * 1000;
    if (timeRange === "1h") return now - 60 * 60 * 1000;
    if (timeRange === "24h") return now - 24 * 60 * 60 * 1000;
    return now - 7 * 24 * 60 * 60 * 1000;
  }, [timeRange]);

  const filteredActivity = useMemo(() => {
    const rows = stats?.recentActivity ?? [];
    return rows.filter((row) => {
      if (row.model === "ide-monitor") {
        return false;
      }
      const inRange = new Date(row.timestamp).getTime() >= cutoff;
      const matchesOutcome = outcomeFilter === "ALL" ? true : row.outcome === outcomeFilter;
      const q = query.trim().toLowerCase();
      const matchesQuery = q.length === 0 || row.promptSnippet.toLowerCase().includes(q) || row.model.toLowerCase().includes(q);
      return inRange && matchesOutcome && matchesQuery;
    });
  }, [cutoff, outcomeFilter, query, stats?.recentActivity]);

  const visibleIdeEvents = useMemo(
    () => ideEvents.filter((event) => event.activityType !== "heartbeat"),
    [ideEvents]
  );

  const filteredTimeSeries = useMemo(
    () => (stats?.timeSeries ?? []).filter((point) => new Date(`${point.bucket}T00:00:00`).getTime() >= cutoff),
    [cutoff, stats?.timeSeries]
  );

  const outcomeData = useMemo(
    () => [
      { name: "Accepted", value: stats?.totals.accepted ?? 0, color: "#22c55e" },
      { name: "Rejected", value: stats?.totals.rejected ?? 0, color: "#ef4444" },
      { name: "Iterated", value: stats?.totals.iterated ?? 0, color: "#3b82f6" }
    ],
    [stats]
  );
  const hasOutcomeData = outcomeData.some((item) => item.value > 0);

  const onResetDatabase = async () => {
    const ok = window.confirm("Clear all telemetry events and tasks?");
    if (!ok) return;
    try {
      await resetTelemetry();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear database");
    }
  };

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/95">
        <div className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">SignalCode Enterprise</p>
            <h1 className="text-xl font-semibold text-neutral-50">Telemetry Command Center</h1>
          </div>
          <StatusBadge healthy={apiHealthy} ideConnected={ideActivity?.ideConnected ?? false} />
        </div>
      </header>
      <main className="mx-auto grid w-full max-w-[1280px] grid-cols-1 gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="space-y-4">
          <KpiGrid stats={stats} isLoading={isLoading} />
          <ChartPanel timeSeries={filteredTimeSeries} />
          <motion.section layout className="card">
            <h2 className="card-title">Outcome Distribution</h2>
            {hasOutcomeData ? (
              <div className="h-64 sm:h-72">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={outcomeData} dataKey="value" nameKey="name" outerRadius={95} label>
                      {outcomeData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <PanelEmptyState label="No outcome distribution yet" />
            )}
          </motion.section>
          <ActivityTable rows={filteredActivity} />
          <PostAcceptReworkPanel rows={postAcceptRows} />
        </section>
        <aside className="space-y-4 lg:sticky lg:top-[72px] lg:h-fit">
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
            onRefresh={() => void load()}
            onResetDatabase={() => void onResetDatabase()}
          />
          <section className="card">
            <h2 className="card-title">IDE Live Status</h2>
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
      </main>
    </div>
  );
}

function PanelEmptyState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`mt-2 flex flex-col items-center justify-center rounded-md border border-neutral-800 bg-neutral-950/60 px-4 text-center ${compact ? "py-4" : "min-h-64 py-6"}`}>
      <svg width={compact ? 72 : 96} height={compact ? 42 : 56} viewBox="0 0 96 56" role="img" aria-label="Empty state">
        <rect x="8" y="8" width="80" height="40" rx="6" fill="#111111" stroke="#2a2a2a" />
        <line x1="18" y1="21" x2="78" y2="21" stroke="#333333" />
        <line x1="18" y1="29" x2="64" y2="29" stroke="#2f2f2f" />
        <line x1="18" y1="36" x2="58" y2="36" stroke="#2f2f2f" />
      </svg>
      <p className="mt-3 text-xs text-neutral-400">{label}</p>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-neutral-800 pb-2">
      <dt className="text-neutral-400">{label}</dt>
      <dd className="max-w-[65%] break-all text-right font-mono text-[12px] text-neutral-200">{value}</dd>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="rounded-md border border-red-800 bg-neutral-950 p-3 text-[13px] text-red-300">
      {message}
    </motion.div>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}
