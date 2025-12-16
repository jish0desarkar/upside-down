"use client";

import { useMemo, useState } from "react";
import type { EndpointLatency } from "../lib/latency-data";
import {
  calculateEndpointStats,
  formatHourLabel,
} from "../lib/latency-data";
import { LatencyChart } from "./latency-chart";
import { MetricCard } from "./metric-card";
import { LatencyTable } from "./latency-table";

type LatencyDashboardProps = {
  endpoints: EndpointLatency[];
};

const getStatusLabel = (status: EndpointLatency["status"]) => {
  switch (status) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    default:
      return "Operational";
  }
};

export const LatencyDashboard = ({ endpoints }: LatencyDashboardProps) => {
  const [activeEndpointId, setActiveEndpointId] = useState(
    endpoints[0]?.endpointId ?? "",
  );

  const activeEndpoint =
    endpoints.find((endpoint) => endpoint.endpointId === activeEndpointId) ??
    endpoints[0];

  const stats = activeEndpoint
    ? calculateEndpointStats(activeEndpoint)
    : undefined;

  const firstPoint = activeEndpoint?.points[0];
  const latestPoint = activeEndpoint?.points.at(-1);

  const avgDelta =
    firstPoint && latestPoint
      ? latestPoint.avgLatency - firstPoint.avgLatency
      : 0;

  const metrics = stats
    ? [
        {
          label: "6h average",
          value: `${stats.averageLatency} ms`,
          detail: `Window average for ${activeEndpoint?.label}`,
          trendLabel: `${avgDelta >= 0 ? "+" : ""}${avgDelta} ms vs first hour`,
          trendPositive: avgDelta <= 0,
        },
        {
          label: "Best hour",
          value: `${stats.bestHour.avgLatency} ms`,
          detail: formatHourLabel(stats.bestHour.hour),
        },
        {
          label: "Peak p99",
          value: `${stats.peak99.value} ms`,
          detail: formatHourLabel(stats.peak99.hour),
          trendLabel: "Watch",
          trendPositive: false,
        },
        {
          label: "Requests processed",
          value: stats.totalRequests.toLocaleString(),
          detail: "Last 6 hour rollup",
        },
      ]
    : [];

  const availabilityBadge = useMemo(() => {
    if (!activeEndpoint) return null;
    const statusLabel = getStatusLabel(activeEndpoint.status);
    return (
      <span className={`status-pill status-pill--${activeEndpoint.status}`}>
        {statusLabel}
      </span>
    );
  }, [activeEndpoint]);

  if (!activeEndpoint) {
    return null;
  }

  return (
    <section className="dashboard">
      <div className="panel">
        <div className="panel__row">
          <div>
            <p className="eyebrow">Select endpoint</p>
            <div className="select">
              <select
                value={activeEndpoint.endpointId}
                onChange={(event) => setActiveEndpointId(event.target.value)}
              >
                {endpoints.map((endpoint) => (
                  <option key={endpoint.endpointId} value={endpoint.endpointId}>
                    {endpoint.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="panel__meta">
            <p className="eyebrow">Time range</p>
            <strong>Last 6 hours · UTC</strong>
            <span>Aggregated via ClickHouse hourly_latency</span>
          </div>
        </div>
        <div className="panel__details">
          <div>
            <p className="eyebrow">Status</p>
            {availabilityBadge}
            <p className="panel__description">{activeEndpoint.description}</p>
          </div>
          <div>
            <p className="eyebrow">Region · Owner</p>
            <strong>{activeEndpoint.region}</strong>
            <span>{activeEndpoint.owner}</span>
          </div>
          <div>
            <p className="eyebrow">SLO budget</p>
            <strong>{activeEndpoint.sloMs} ms</strong>
            <span>Avg latency budget</span>
          </div>
        </div>
      </div>

      <LatencyChart
        data={activeEndpoint.points}
        sloTarget={activeEndpoint.sloMs}
        endpointLabel={activeEndpoint.label}
      />

      <div className="cards-grid">
        {metrics.map((metric) => (
          <MetricCard key={metric.label} {...metric} />
        ))}
      </div>

      <LatencyTable data={activeEndpoint.points} />
    </section>
  );
};
