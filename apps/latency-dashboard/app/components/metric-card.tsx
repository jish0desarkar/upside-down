type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
  trendLabel?: string;
  trendPositive?: boolean;
};

export const MetricCard = ({
  label,
  value,
  detail,
  trendLabel,
  trendPositive = true,
}: MetricCardProps) => {
  return (
    <article className="card metric-card">
      <p className="eyebrow">{label}</p>
      <div className="metric-card__value">{value}</div>
      <p className="metric-card__detail">{detail}</p>
      {trendLabel ? (
        <span
          className={`metric-card__trend ${trendPositive ? "metric-card__trend--up" : "metric-card__trend--down"}`}
        >
          {trendLabel}
        </span>
      ) : null}
    </article>
  );
};
