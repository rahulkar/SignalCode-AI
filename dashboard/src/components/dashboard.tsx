import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import type { IdeMonitorEvent, StatsResponse } from "../api";

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function StatusBadge({ healthy, ideConnected }: { healthy: boolean; ideConnected: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <Badge label={healthy ? "API Healthy" : "API Unreachable"} tone={healthy ? "success" : "danger"} />
      <Badge label={ideConnected ? "IDE Connected" : "IDE Disconnected"} tone={ideConnected ? "success" : "danger"} />
    </div>
  );
}

export function KpiGrid({ stats, isLoading }: { stats: StatsResponse | null; isLoading: boolean }) {
  const cards = [
    { label: "Acceptance Rate", value: formatPercent(stats?.acceptanceRate ?? 0), helper: "ACCEPTED / DIFF_RENDERED" },
    { label: "Total Tasks", value: String(stats?.totalTasks ?? 0), helper: "Unique successful tasks" },
    { label: "Avg Iterations", value: (stats?.averageIterationsBeforeAccept ?? 0).toFixed(2), helper: "ITERATED before ACCEPTED" }
  ];
  return (
    <section className="grid gap-4 md:grid-cols-3">
      {cards.map((card, index) => (
        <motion.article key={card.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }} className="card">
          <p className="text-xs uppercase tracking-wider text-slate-400">{card.label}</p>
          <p className="mt-3 text-3xl font-semibold text-white">{isLoading ? "--" : card.value}</p>
          <p className="mt-2 text-xs text-slate-500">{card.helper}</p>
        </motion.article>
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
    <section className="grid gap-4 xl:grid-cols-2">
      <article className="card">
        <h2 className="card-title">Accept vs Reject Trend</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={timeSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="bucket" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Bar dataKey="accepted" fill="#22c55e" radius={4} />
              <Bar dataKey="rejected" fill="#ef4444" radius={4} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
      <article className="card">
        <h2 className="card-title">Acceptance Momentum</h2>
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={timeSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="bucket" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip />
              <Area type="monotone" dataKey="accepted" stroke="#38bdf8" fill="#0ea5e9" fillOpacity={0.35} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
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
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400">
              <Th>Timestamp</Th>
              <Th>Prompt snippet</Th>
              <Th>Model</Th>
              <Th>Outcome</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.task_id}-${row.diff_id}-${row.timestamp}-${row.outcome}`} className="border-t border-slate-800">
                <Td>{new Date(row.timestamp).toLocaleString()}</Td>
                <Td>{row.promptSnippet}</Td>
                <Td>{row.model}</Td>
                <Td>{row.outcome}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    <nav className="card space-y-4" aria-label="Dashboard controls">
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
      <div className="flex gap-2">
        <button className="btn-primary" onClick={props.onRefresh} type="button">
          Refresh now
        </button>
      </div>
      <section className="rounded-md border border-red-500/30 bg-red-500/10 p-3">
        <p className="text-xs uppercase tracking-widest text-red-300">Danger Zone</p>
        <button className="mt-2 w-full rounded-md border border-red-400/40 px-3 py-2 text-sm text-red-200 hover:bg-red-500/20" onClick={props.onResetDatabase} type="button">
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
          <p className="text-slate-400">No IDE monitor events yet.</p>
        ) : (
          events.map((event) => (
            <div key={`${event.timestamp}-${event.activityType}-${event.filePath ?? "none"}`} className="rounded-md border border-slate-800 bg-slate-950/60 p-2">
              <p className="text-slate-300">{new Date(event.timestamp).toLocaleString()}</p>
              <p className="font-medium text-slate-100">{event.activityType}</p>
              <p className="truncate text-slate-400">{event.filePath ?? "n/a"}</p>
              <p className="text-slate-500">{event.languageId ?? "unknown"}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function Badge({ label, tone }: { label: string; tone: "success" | "danger" }) {
  const klass = tone === "success" ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-100" : "border-red-400/40 bg-red-500/20 text-red-100";
  return <span className={`rounded-full border px-3 py-1 text-xs font-medium ${klass}`}>{label}</span>;
}

function Th({ children }: { children: string }) {
  return <th className="px-3 py-2 font-semibold">{children}</th>;
}

function Td({ children }: { children: string }) {
  return <td className="px-3 py-2 text-slate-200">{children}</td>;
}
