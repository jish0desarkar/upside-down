export type LatencyPoint = {
  hour: string;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p95Latency: number;
  p99Latency: number;
  requestCount: number;
};

export type EndpointLatency = {
  endpointId: string;
  label: string;
  description: string;
  region: string;
  status: "operational" | "warning" | "critical";
  owner: string;
  sloMs: number;
  points: LatencyPoint[];
};

const HOURS = 6;

const hourFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "UTC",
});

const dayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const hourBuckets = Array.from({ length: HOURS }, (_, index) => {
  const date = new Date();
  date.setUTCMinutes(0, 0, 0);
  date.setUTCHours(date.getUTCHours() - (HOURS - 1 - index));
  return date;
});

const buildPoints = (latencies: number[], requests: number[]): LatencyPoint[] => {
  return hourBuckets.map((date, index) => {
    const avgLatency = latencies[index] ?? latencies[latencies.length - 1];
    const requestCount = requests[index] ?? requests[requests.length - 1];
    return {
      hour: date.toISOString(),
      avgLatency,
      minLatency: Math.max(Math.round(avgLatency * 0.65), 30),
      maxLatency: Math.round(avgLatency * 1.35),
      p95Latency: Math.round(avgLatency * 1.2),
      p99Latency: Math.round(avgLatency * 1.3),
      requestCount,
    };
  });
};

export const latencyDataset: EndpointLatency[] = [
  {
    endpointId: "edge-health",
    label: "edge:/api/v1/health",
    description: "Primary public uptime monitor served via the edge network.",
    region: "IAD · 3 AZs",
    status: "operational",
    owner: "Reliability Core",
    sloMs: 250,
    points: buildPoints(
      [182, 196, 205, 188, 164, 155],
      [1284, 1332, 1398, 1420, 1366, 1294],
    ),
  },
  {
    endpointId: "api-latency",
    label: "api:/v2/latency-report",
    description: "Internal reporting endpoint aggregating hourly metrics.",
    region: "PDX · 2 AZs",
    status: "warning",
    owner: "Observability",
    sloMs: 350,
    points: buildPoints(
      [244, 251, 263, 275, 268, 259],
      [980, 1012, 995, 1004, 1021, 997],
    ),
  },
  {
    endpointId: "batch-insights",
    label: "batch:/insights/pipeline",
    description: "Async pipeline feeding ClickHouse hourly rollups.",
    region: "FRA · 2 AZs",
    status: "operational",
    owner: "Data Platform",
    sloMs: 450,
    points: buildPoints(
      [326, 311, 298, 286, 279, 271],
      [720, 744, 702, 715, 736, 710],
    ),
  },
];

export const formatHourLabel = (iso: string) => {
  const date = new Date(iso);
  return `${dayFormatter.format(date)} · ${hourFormatter.format(date)} UTC`;
};

export const shortHourLabel = (iso: string) => {
  const date = new Date(iso);
  return hourFormatter.format(date);
};

export const calculateEndpointStats = (endpoint: EndpointLatency) => {
  const totals = endpoint.points.reduce(
    (acc, point) => {
      acc.sum += point.avgLatency;
      acc.requests += point.requestCount;
      if (point.avgLatency < acc.best.avgLatency) {
        acc.best = { avgLatency: point.avgLatency, hour: point.hour };
      }
      if (point.avgLatency > acc.worst.avgLatency) {
        acc.worst = { avgLatency: point.avgLatency, hour: point.hour };
      }
      if (point.p99Latency > acc.peak99.value) {
        acc.peak99 = { value: point.p99Latency, hour: point.hour };
      }
      return acc;
    },
    {
      sum: 0,
      requests: 0,
      best: { avgLatency: Number.POSITIVE_INFINITY, hour: "" },
      worst: { avgLatency: Number.NEGATIVE_INFINITY, hour: "" },
      peak99: { value: Number.NEGATIVE_INFINITY, hour: "" },
    },
  );

  return {
    averageLatency: Math.round(totals.sum / endpoint.points.length),
    totalRequests: totals.requests,
    bestHour: totals.best,
    worstHour: totals.worst,
    peak99: totals.peak99,
  };
};
