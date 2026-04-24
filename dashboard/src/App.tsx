import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  fetchHealth,
  fetchIdeActivity,
  fetchIdeEvents,
  fetchStats,
  resetTelemetry,
  type IdeActivityResponse,
  type IdeMonitorEvent,
  type StatsResponse
} from "./api";
import { ActivityTable, ChartPanel, ControlPanel, IdeEventDebugPanel, KpiGrid, StatusBadge } from "./components/dashboard";

const AUTO_REFRESH_OPTIONS = [0, 5000, 10000, 30000] as const;
const TIME_RANGES = ["15m", "1h", "24h", "7d"] as const;

export function App() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [ideActivity, setIdeActivity] = useState<IdeActivityResponse | null>(null);
  const [apiHealthy, setApiHealthy] = useState(false);
  const [ideEvents, setIdeEvents] = useState<IdeMonitorEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [autoRefreshMs, setAutoRefreshMs] = useState<number>(10000);
  const [timeRange, setTimeRange] = useState<(typeof TIME_RANGES)[number]>("24h");
  const [query, setQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<"ALL" | "ACCEPTED" | "REJECTED" | "ITERATED" | "DIFF_RENDERED">("ALL");

  const load = async () => {
    const [statsRes, healthRes, ideRes, ideEventsRes] = await Promise.allSettled([
      fetchStats(),
      fetchHealth(),
      fetchIdeActivity(),
      fetchIdeEvents()
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
      const inRange = new Date(row.timestamp).getTime() >= cutoff;
      const matchesOutcome = outcomeFilter === "ALL" ? true : row.outcome === outcomeFilter;
      const q = query.trim().toLowerCase();
      const matchesQuery = q.length === 0 || row.promptSnippet.toLowerCase().includes(q) || row.model.toLowerCase().includes(q);
      return inRange && matchesOutcome && matchesQuery;
    });
  }, [cutoff, outcomeFilter, query, stats?.recentActivity]);

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
      <header className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-6">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-400">SignalCode Enterprise</p>
          <h1 className="text-3xl font-bold text-white">Telemetry Command Center</h1>
        </div>
        <StatusBadge healthy={apiHealthy} ideConnected={ideActivity?.ideConnected ?? false} />
      </header>
      <main className="mx-auto grid w-full max-w-7xl gap-6 px-6 pb-8 lg:grid-cols-[2fr_1fr]">
        <section className="space-y-6">
          <KpiGrid stats={stats} isLoading={isLoading} />
          <ChartPanel timeSeries={filteredTimeSeries} />
          <motion.section layout className="card">
            <h2 className="card-title">Outcome Distribution</h2>
            <div className="h-72">
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
          </motion.section>
          <ActivityTable rows={filteredActivity} />
        </section>
        <aside className="space-y-6">
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
            <dl className="space-y-2 text-sm">
              <MetricRow label="Connected" value={ideActivity?.ideConnected ? "Yes" : "No"} />
              <MetricRow label="Last event" value={formatDate(ideActivity?.lastEventAt)} />
              <MetricRow label="Current file" value={ideActivity?.currentFile ?? "n/a"} />
              <MetricRow label="Last edited" value={ideActivity?.lastEditedFile ?? "n/a"} />
              <MetricRow label="Last added" value={ideActivity?.lastAddedFile ?? "n/a"} />
            </dl>
          </section>
          <IdeEventDebugPanel events={ideEvents} />
          <AnimatePresence>{error ? <ErrorBanner message={error} /> : null}</AnimatePresence>
        </aside>
      </main>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-800/80 pb-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className="max-w-[65%] break-all text-right text-slate-200">{value}</dd>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-lg border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
      {message}
    </motion.div>
  );
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}
