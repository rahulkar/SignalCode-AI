import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchStats, type StatsResponse } from "./api";

const POLL_INTERVAL_MS = 8000;

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function App() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const data = await fetchStats();
        if (mounted) {
          setStats(data);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : "Failed to load stats");
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);

  const chartData = useMemo(() => stats?.timeSeries ?? [], [stats]);

  return (
    <main className="min-h-screen bg-slate-100 p-6 text-slate-900">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header>
          <h1 className="text-3xl font-semibold">SignalCode AI Telemetry Dashboard</h1>
        </header>

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <section className="grid gap-4 md:grid-cols-3">
          <KpiCard
            label="Acceptance Rate"
            value={formatPercent(stats?.acceptanceRate ?? 0)}
            helper="ACCEPTED / DIFF_RENDERED"
          />
          <KpiCard label="Total Tasks" value={String(stats?.totalTasks ?? 0)} helper="Unique task_id count" />
          <KpiCard
            label="Average Iterations"
            value={(stats?.averageIterationsBeforeAccept ?? 0).toFixed(2)}
            helper="ITERATED before ACCEPTED"
          />
        </section>

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-medium">Accept vs Reject Over Time</h2>
          <div className="h-80 w-full">
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="bucket" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="accepted" fill="#22c55e" name="Accepted" />
                <Bar dataKey="rejected" fill="#ef4444" name="Rejected" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <h2 className="mb-4 text-lg font-medium">Recent Activity</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Timestamp</Th>
                  <Th>Prompt snippet</Th>
                  <Th>Model</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {(stats?.recentActivity ?? []).map((row) => (
                  <tr key={`${row.task_id}-${row.diff_id}-${row.timestamp}-${row.outcome}`}>
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
      </div>
    </main>
  );
}

function KpiCard(props: { label: string; value: string; helper: string }) {
  return (
    <article className="rounded-lg bg-white p-4 shadow-sm">
      <p className="text-sm text-slate-500">{props.label}</p>
      <p className="mt-2 text-3xl font-semibold">{props.value}</p>
      <p className="mt-1 text-xs text-slate-500">{props.helper}</p>
    </article>
  );
}

function Th({ children }: { children: string }) {
  return <th className="px-3 py-2 text-left font-semibold text-slate-700">{children}</th>;
}

function Td({ children }: { children: string }) {
  return <td className="px-3 py-2 text-slate-700">{children}</td>;
}
