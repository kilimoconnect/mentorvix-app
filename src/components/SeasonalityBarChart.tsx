"use client";

import {
  BarChart, Bar, Cell, XAxis, YAxis,
  ReferenceLine, ResponsiveContainer, Tooltip,
} from "recharts";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/** Teal (#0891b2) = above baseline · Amber (#f59e0b) = below */
export function SeasonalityBarChart({
  multipliers,
  height = 200,
}: {
  multipliers: number[];
  height?: number;
}) {
  const data = multipliers.map((v, i) => ({
    month: MONTHS[i],
    pct:   Math.round(v * 100),
  }));

  const maxPct = Math.max(...data.map((d) => d.pct));
  const yMax   = Math.max(160, Math.ceil((maxPct + 20) / 40) * 40);
  const yStep  = yMax / 4;
  const yTicks = [0, yStep, yStep * 2, yStep * 3, yMax];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap="18%">
        <XAxis
          dataKey="month"
          tick={{ fontSize: 9, fill: "#94a3b8" }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          domain={[0, yMax]}
          ticks={yTicks}
          tick={{ fontSize: 9, fill: "#cbd5e1" }}
          tickFormatter={(v) => `${v}%`}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          formatter={(v) => [`${v}%`, "Index"]}
          contentStyle={{
            fontSize: 11,
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            padding: "4px 10px",
          }}
          cursor={{ fill: "#f1f5f9" }}
        />
        <ReferenceLine y={100} stroke="#e2e8f0" strokeDasharray="4 2" />
        <Bar dataKey="pct" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.pct >= 100 ? "#0891b2" : "#f59e0b"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
