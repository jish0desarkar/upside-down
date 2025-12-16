"use client";

import { useMemo, useState } from "react";
import type { LatencyPoint } from "../lib/latency-data";
import { shortHourLabel } from "../lib/latency-data";

const VIEWBOX_WIDTH = 760;
const VIEWBOX_HEIGHT = 260;
const PADDING = {
  top: 16,
  right: 32,
  bottom: 32,
  left: 40,
};

type LatencyChartProps = {
  data: LatencyPoint[];
  sloTarget: number;
  endpointLabel: string;
};

type ChartPoint = {
  x: number;
  y: number;
  value: number;
  hour: string;
};

const formatValue = (value: number) => `${value.toLocaleString()} ms`;

export const LatencyChart = ({
  data,
  sloTarget,
  endpointLabel,
}: LatencyChartProps) => {
  const [focusIndex, setFocusIndex] = useState(Math.max(data.length - 1, 0));

  const chartState = useMemo(() => {
    if (data.length === 0) {
      return {
        linePath: "",
        areaPath: "",
        points: [],
        domain: { min: 0, max: 0 },
      };
    }

    const values = data.map((point) => point.avgLatency);
    const domainPadding = Math.max(
      Math.round((Math.max(...values) - Math.min(...values)) * 0.2),
      30,
    );
    const domainMax = Math.max(...values) + domainPadding;
    const domainMin = Math.max(Math.min(...values) - domainPadding, 20);

    const chartWidth = VIEWBOX_WIDTH - PADDING.left - PADDING.right;
    const chartHeight = VIEWBOX_HEIGHT - PADDING.top - PADDING.bottom;
    const horizontalStep =
      data.length > 1 ? chartWidth / (data.length - 1) : chartWidth;

    const toY = (value: number) => {
      const ratio = (value - domainMin) / (domainMax - domainMin);
      return PADDING.top + (1 - ratio) * chartHeight;
    };

    const points = data.map((point, index) => {
      return {
        x: PADDING.left + index * horizontalStep,
        y: toY(point.avgLatency),
        value: point.avgLatency,
        hour: point.hour,
      };
    });

    const commands = points.map((point, index) => {
      return `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    });

    const linePath = commands.join(" ");

    const lastPoint = points.at(-1);
    const firstPoint = points[0];
    const baseline = PADDING.top + chartHeight;
    const areaPath =
      commands.join(" ") +
      ` L${lastPoint?.x ?? PADDING.left} ${baseline} L${firstPoint?.x ?? PADDING.left} ${baseline} Z`;

    return {
      linePath,
      areaPath,
      points,
      domain: {
        min: domainMin,
        max: domainMax,
      },
    };
  }, [data]);

  const activePoint = chartState.points[focusIndex] ?? chartState.points.at(-1);
  const fallbackPoint = chartState.points.at(-1);
  const resolvedPoint = activePoint ?? fallbackPoint;
  const resolvedData = data[focusIndex] ?? data.at(-1);
  const sloY =
    sloTarget > 0 && chartState.domain.max > chartState.domain.min
      ? (() => {
          const ratio =
            (sloTarget - chartState.domain.min) /
            (chartState.domain.max - chartState.domain.min);
          const chartHeight = VIEWBOX_HEIGHT - PADDING.top - PADDING.bottom;
          return PADDING.top + (1 - ratio) * chartHeight;
        })()
      : null;

  const handlePointerMove = (clientX: number, rect: DOMRect) => {
    const ratio = (clientX - rect.left) / rect.width;
    const index = Math.round(
      Math.min(
        data.length - 1,
        Math.max(0, ratio * (data.length - 1)),
      ),
    );
    setFocusIndex(index);
  };

  return (
    <section className="card chart-card">
      <div className="chart-card__header">
        <div>
          <p className="eyebrow">Average latency · last 6 hours</p>
          <h2>{endpointLabel}</h2>
        </div>
        <div className="slo-badge">
          <span>SLO target</span>
          <strong>{sloTarget} ms</strong>
        </div>
      </div>
      <div className="chart-wrapper">
        <svg
          viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
          role="img"
          aria-label="Latency trend chart"
        >
          <defs>
            <linearGradient id="latencyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="rgba(99,218,255,0.55)" />
              <stop offset="100%" stopColor="rgba(99,218,255,0)" />
            </linearGradient>
            <linearGradient id="lineGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#64d6ff" />
              <stop offset="100%" stopColor="#4a8bff" />
            </linearGradient>
          </defs>

          {/* grid */}
          {Array.from({ length: 4 }).map((_, idx) => {
            const ratio = idx / 3;
            const y =
              PADDING.top +
              ratio * (VIEWBOX_HEIGHT - PADDING.top - PADDING.bottom);
            const value =
              Math.round(
                chartState.domain.max -
                  ratio * (chartState.domain.max - chartState.domain.min),
              ) ?? 0;
            return (
              <g key={`grid-${idx}`}>
                <line
                  x1={PADDING.left}
                  x2={VIEWBOX_WIDTH - PADDING.right}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1}
                />
                <text
                  x={8}
                  y={y + 4}
                  className="chart-axis-label"
                >
                  {value} ms
                </text>
              </g>
            );
          })}

          {sloY && sloY > PADDING.top && sloY < VIEWBOX_HEIGHT - PADDING.bottom ? (
            <g>
              <line
                x1={PADDING.left}
                x2={VIEWBOX_WIDTH - PADDING.right}
                y1={sloY}
                y2={sloY}
                stroke="rgba(245, 158, 11, 0.7)"
                strokeWidth={1}
                strokeDasharray="4 6"
              />
              <text
                x={VIEWBOX_WIDTH - PADDING.right + 6}
                y={sloY + 4}
                className="chart-slo-label"
              >
                {formatValue(sloTarget)}
              </text>
            </g>
          ) : null}

          <path
            d={chartState.areaPath}
            fill="url(#latencyGradient)"
            stroke="none"
          />
          <path
            d={chartState.linePath}
            fill="none"
            stroke="url(#lineGradient)"
            strokeWidth={3}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {chartState.points.map((point, index) => (
            <circle
              key={point.hour}
              cx={point.x}
              cy={point.y}
              r={index === focusIndex ? 4.6 : 3}
              fill={index === focusIndex ? "#fff" : "#64d6ff"}
              opacity={index === focusIndex ? 1 : 0.6}
            />
          ))}

          {resolvedPoint ? (
            <g>
              <line
                x1={resolvedPoint.x}
                x2={resolvedPoint.x}
                y1={PADDING.top}
                y2={VIEWBOX_HEIGHT - PADDING.bottom}
                stroke="rgba(255,255,255,0.2)"
                strokeWidth={1}
              />
              <circle
                cx={resolvedPoint.x}
                cy={resolvedPoint.y}
                r={6}
                fill="#fff"
              />
            </g>
          ) : null}
        </svg>
        <div
          className="chart-overlay"
          onMouseMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            handlePointerMove(event.clientX, rect);
          }}
          onMouseLeave={() => setFocusIndex(data.length - 1)}
          onTouchMove={(event) => {
            const touch = event.touches[0];
            if (!touch) return;
            const rect = event.currentTarget.getBoundingClientRect();
            handlePointerMove(touch.clientX, rect);
          }}
          onTouchEnd={() => setFocusIndex(data.length - 1)}
        />
      </div>
      {resolvedPoint && resolvedData ? (
        <div className="chart-meta">
          <div>
            <p className="eyebrow">Selected hour</p>
            <h3>{shortHourLabel(resolvedPoint.hour)} UTC</h3>
          </div>
          <div>
            <p className="eyebrow">Average</p>
            <strong>{formatValue(resolvedData.avgLatency)}</strong>
          </div>
          <div>
            <p className="eyebrow">p95 / p99</p>
            <strong>
              {resolvedData.p95Latency} ms · {resolvedData.p99Latency} ms
            </strong>
          </div>
          <div>
            <p className="eyebrow">Requests</p>
            <strong>{resolvedData.requestCount.toLocaleString()}</strong>
          </div>
        </div>
      ) : null}
      <div className="chart-axis">
        {data.map((point) => (
          <span key={point.hour}>{shortHourLabel(point.hour)}</span>
        ))}
      </div>
    </section>
  );
};
