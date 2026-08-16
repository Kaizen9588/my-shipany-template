"use client";

/**
 * 轻量 SVG 图表（6.6 数据看板，无第三方图表依赖）
 * 数据量小（30 点），纯 SVG 足够；未来如需复杂交互可换 recharts。
 */

function niceMax(values: number[]): number {
  const max = Math.max(...values, 1);
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  return Math.ceil(max / pow) * pow;
}

export function SimpleLineChart({
  data,
  dataKey,
  color = "#4f46e5",
  height = 160,
}: {
  data: { date: string; [key: string]: string | number }[];
  dataKey: string;
  color?: string;
  height?: number;
}) {
  const width = 600;
  const values = data.map((d) => Number(d[dataKey]) || 0);
  const max = niceMax(values);
  const points = data
    .map((d, i) => {
      const x = (i / Math.max(data.length - 1, 1)) * width;
      const y = height - (Number(d[dataKey]) / max) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const areaPoints = `${points} ${width},${height} 0,${height}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="none"
    >
      <polygon points={areaPoints} fill={color} opacity="0.12" />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SimpleBarChart({
  data,
  dataKey,
  color = "#10b981",
  height = 160,
}: {
  data: { date: string; [key: string]: string | number }[];
  dataKey: string;
  color?: string;
  height?: number;
}) {
  const width = 600;
  const values = data.map((d) => Number(d[dataKey]) || 0);
  const max = niceMax(values);
  const barWidth = Math.max(width / data.length - 4, 1);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      style={{ height }}
      preserveAspectRatio="none"
    >
      {data.map((d, i) => {
        const v = Number(d[dataKey]) || 0;
        const barHeight = (v / max) * height;
        const x = (i / data.length) * width + 2;
        return (
          <rect
            key={d.date}
            x={x}
            y={height - barHeight}
            width={barWidth}
            height={barHeight}
            rx="1"
            fill={color}
            opacity="0.85"
          />
        );
      })}
    </svg>
  );
}

export function StatCard({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function ChartCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="mb-2 text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}
