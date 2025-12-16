import { LatencyDashboard } from "./components/latency-dashboard";
import { latencyDataset } from "./lib/latency-data";

export default function Page() {
  return (
    <main className="page-shell">
      <header className="hero">
        <div className="hero__badge">Uptime Intelligence</div>
        <div className="hero__title-row">
          <h1>Latency Control Room</h1>
          <span className="status-pill status-pill--live">Live</span>
        </div>
        <p className="hero__subtitle">
          Visualize hourly aggregates pulled from the <code>hourly_latency</code>{" "}
          table and keep your most critical endpoints within SLO. Slice by
          endpoint to explore the last six hours of average latency, p95/p99
          outliers, and request volume.
        </p>
      </header>

      <LatencyDashboard endpoints={latencyDataset} />
    </main>
  );
}
