import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import {
  fetchHealth,
  fetchExportChangeSnapshots,
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
import { Icon, type IconName } from "./components/icons";
import { ActivityTable, ChartPanel, ControlPanel, IdeEventDebugPanel, KpiGrid, PostAcceptReworkPanel, StatusBadge } from "./components/dashboard";

const AUTO_REFRESH_OPTIONS = [0, 5000, 10000, 30000] as const;
const TIME_RANGES = ["15m", "1h", "24h", "7d"] as const;
type ThemeMode = "light" | "dark";
const PIE_TOOLTIP_STYLE = {
  backgroundColor: "#ffffff",
  border: "1px solid #e5e5e5",
  borderRadius: "6px",
  color: "#0a0a0a",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.06)"
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
  const [isExporting, setIsExporting] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const stored = window.localStorage.getItem("signalcode-theme");
    return stored === "dark" ? "dark" : "light";
  });

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("signalcode-theme", theme);
  }, [theme]);

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
      { name: "Accepted", value: stats?.totals.accepted ?? 0, color: "#16a34a" },
      { name: "Rejected", value: stats?.totals.rejected ?? 0, color: "#dc2626" },
      { name: "Iterated", value: stats?.totals.iterated ?? 0, color: "#2563eb" }
    ],
    [stats]
  );
  const windowOutcomeData = useMemo(
    () => [
      { name: "Accepted", value: (stats?.timeSeries ?? []).reduce((sum, point) => sum + point.accepted, 0), color: "#16a34a" },
      { name: "Rejected", value: (stats?.timeSeries ?? []).reduce((sum, point) => sum + point.rejected, 0), color: "#dc2626" },
      { name: "Iterated", value: (stats?.timeSeries ?? []).reduce((sum, point) => sum + point.iterated, 0), color: "#2563eb" }
    ],
    [stats?.timeSeries]
  );
  const pieData = windowOutcomeData.filter((item) => item.value > 0);
  const totalOutcomeCount = windowOutcomeData.reduce((sum, item) => sum + item.value, 0);
  const isDark = theme === "dark";

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

  const onExportChangeSnapshots = async () => {
    try {
      setIsExporting(true);
      const payload = await fetchExportChangeSnapshots();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `signalcode-pr-snapshots-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export change snapshots");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar__inner">
          <div>
            <p className="topbar__eyebrow">SignalCode Dashboard</p>
            <h1 className="topbar__title">Telemetry Command Center</h1>
            <p className="topbar__subtitle">Track generation quality, acceptance behavior, and post-accept rework from one place.</p>
          </div>
          <div className="topbar__actions">
            <div className="hero-chip-group">
              <button className="theme-toggle" onClick={() => setTheme(isDark ? "light" : "dark")} type="button">
                <Icon name="appearance" />
                <span>Canvas</span>
                <strong>{isDark ? "Midnight" : "Daybreak"}</strong>
              </button>
              <InfoChip icon="window" label="Window" value={timeRange.toUpperCase()} />
              <InfoChip icon="refresh" label="Refresh" value={autoRefreshMs === 0 ? "Manual" : `${autoRefreshMs / 1000}s`} />
              <InfoChip icon="sync" label="Last Sync" value={formatLastSync(lastLoadedAt)} />
            </div>
            <StatusBadge healthy={apiHealthy} ideConnected={ideActivity?.ideConnected ?? false} />
          </div>
        </div>
      </header>

      <main className="app-main">
          <section className="hero-banner">
          <div className="hero-banner__content">
            <p className="hero-banner__eyebrow">Overview</p>
            <h2 className="hero-banner__title">Monitor delivery quality across the active analysis window</h2>
            <p className="hero-banner__copy">
              KPIs, trend panels, and recent activity stay aligned to the same time window so the data is easier to compare.
            </p>
            <div className="hero-banner__meta">
              <HeroStat icon="accepted" label="Accepted" value={String(windowOutcomeData[0]?.value ?? 0)} accent="success" />
              <HeroStat icon="rejected" label="Rejected" value={String(windowOutcomeData[1]?.value ?? 0)} accent="danger" />
              <HeroStat icon="iterated" label="Iterated" value={String(windowOutcomeData[2]?.value ?? 0)} accent="info" />
            </div>
          </div>
        </section>

        <div className="dashboard-grid">
          <section className="space-y-4">
            <KpiGrid stats={stats} isLoading={isLoading} />
            <ChartPanel timeSeries={stats?.timeSeries ?? []} timeRange={timeRange} isDark={isDark} />

            <motion.section layout className="card card--elevated">
              <div className="panel-heading">
                <div>
                  <p className="panel-heading__eyebrow">Distribution</p>
                  <h2 className="panel-heading__title">Overall outcome mix</h2>
                  <p className="panel-heading__subtitle">Window totals only, with zero-value segments hidden for readability.</p>
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
                          contentStyle={buildTooltipStyle(isDark)}
                          formatter={(value: number, name: string) => [value, name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="distribution-legend">
                    {windowOutcomeData.map((item) => (
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
            <PostAcceptReworkPanel rows={postAcceptRows} isDark={isDark} />
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
              onExportChangeSnapshots={() => void onExportChangeSnapshots()}
              isExporting={isExporting}
              onResetDatabase={() => void onResetDatabase()}
            />

            <section className="card card--elevated">
              <div className="panel-heading">
                <div>
                  <p className="panel-heading__eyebrow">Live Connection</p>
                  <h2 className="panel-heading__title panel-heading__title--with-icon">
                    <span className="icon-badge icon-badge--info" aria-hidden>
                      <Icon name="terminal" size={16} />
                    </span>
                    IDE status
                  </h2>
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

function buildTooltipStyle(isDark: boolean) {
  return {
    ...PIE_TOOLTIP_STYLE,
    backgroundColor: isDark ? "#171717" : "#ffffff",
    border: isDark ? "1px solid #333333" : "1px solid #e5e5e5",
    color: isDark ? "#fafafa" : "#0a0a0a",
    boxShadow: isDark ? "0 4px 12px rgba(0, 0, 0, 0.24)" : "0 1px 2px rgba(0, 0, 0, 0.06)"
  };
}

function PanelEmptyState({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className={`empty-state ${compact ? "empty-state--compact" : ""}`}>
      <svg width={compact ? 76 : 96} height={compact ? 44 : 56} viewBox="0 0 96 56" role="img" aria-label="Empty state">
        <rect x="8" y="8" width="80" height="40" rx="10" fill="var(--surface-card-strong)" stroke="var(--border-strong)" />
        <line x1="18" y1="22" x2="78" y2="22" stroke="var(--text-tertiary)" />
        <line x1="18" y1="30" x2="64" y2="30" stroke="var(--border-strong)" />
        <line x1="18" y1="37" x2="58" y2="37" stroke="var(--border-strong)" />
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

function InfoChip({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="info-chip">
      <span className="chip-icon" aria-hidden>
        <Icon name={icon} size={14} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function HeroStat({
  icon,
  label,
  value,
  accent
}: {
  icon: IconName;
  label: string;
  value: string;
  accent: "success" | "danger" | "info";
}) {
  return (
    <div className={`hero-stat hero-stat--${accent}`}>
      <div className="hero-stat__top">
        <span>{label}</span>
        <span className={`icon-badge icon-badge--${accent}`} aria-hidden>
          <Icon name={icon} size={15} />
        </span>
      </div>
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
