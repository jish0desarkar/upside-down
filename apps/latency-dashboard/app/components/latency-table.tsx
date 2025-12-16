import type { LatencyPoint } from "../lib/latency-data";
import { formatHourLabel } from "../lib/latency-data";

type LatencyTableProps = {
  data: LatencyPoint[];
};

export const LatencyTable = ({ data }: LatencyTableProps) => {
  return (
    <section className="card latency-table">
      <div className="latency-table__header">
        <div>
          <p className="eyebrow">Detailed breakdown</p>
          <h3>Hourly aggregates</h3>
        </div>
        <span className="table-range">6 hour window · UTC</span>
      </div>
      <div className="latency-table__scroller">
        <table>
          <thead>
            <tr>
              <th>Hour</th>
              <th>Average</th>
              <th>p95</th>
              <th>p99</th>
              <th>Max</th>
              <th>Requests</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.hour}>
                <td>{formatHourLabel(point.hour)}</td>
                <td>{point.avgLatency} ms</td>
                <td>{point.p95Latency} ms</td>
                <td>{point.p99Latency} ms</td>
                <td>{point.maxLatency} ms</td>
                <td>{point.requestCount.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};
