import {
  Bar, BarChart, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ChartCard } from "./dataCardTypes";
import { StyledDataTable } from "./StyledDataTable";
import { renderVivicSpec } from "./vivicGUILibrary";

type ChartProps = ChartCard["displayProps"];

const fallbackReason = ({ chartKind, points }: ChartProps): string | undefined => {
  if (!points.length) return "empty";
  if (points.some(({ x, y }) =>
    !Number.isFinite(y) || (typeof x !== "string" && !Number.isFinite(x)),
  )) return "invalid-values";
  // Even finite endpoints can overflow a Cartesian scale's range.
  const ys = points.map(point => point.y);
  const xs = points.flatMap(point => typeof point.x === "number" ? [point.x] : []);
  if (!Number.isFinite(Math.max(...ys) - Math.min(...ys)) ||
    (xs.length > 0 && !Number.isFinite(Math.max(...xs) - Math.min(...xs)))) return "invalid-range";
  if (chartKind !== "pie") return undefined;
  if (points.some(point => point.y < 0)) return "negative-pie";
  const total = points.reduce((sum, point) => sum + point.y, 0);
  return total > 0 && Number.isFinite(total) ? undefined : "invalid-pie-total";
};

/** All marks, axes, labels and hover details come from Recharts, never custom SVG. */
export const ChartCardView = ({ card }: { card: ChartCard }) => {
  const { chartKind, points, xLabel, yLabel } = card.displayProps;
  const fallback = fallbackReason(card.displayProps);
  const height = Math.max(144, Math.min(640, card.layout.height - 32));

  if (fallback) return <div data-vivic-chart-fallback={fallback}>
    {points.length ? <StyledDataTable
      columns={[xLabel ?? "x", yLabel ?? "y"]}
      rows={points.map(({ x, y }) => [x, y])}
      maxHeight={height}
    /> : renderVivicSpec({ _type: "Text", value: "—" })}
  </div>;

  const axis = <>
    <XAxis
      dataKey="x"
      type={points.every(point => typeof point.x === "number") ? "number" : "category"}
      domain={["dataMin", "dataMax"]}
      tick={{ fill: "currentColor", fontSize: 11 }}
      tickLine={false}
      axisLine={{ stroke: "var(--border)" }}
      minTickGap={16}
      height={xLabel ? 46 : 28}
      label={xLabel ? { value: xLabel, position: "insideBottom", offset: 0, fill: "currentColor", fontSize: 11 } : undefined}
    />
    <YAxis
      width={yLabel ? 64 : 44}
      domain={chartKind === "bar"
        ? [(min: number) => Math.min(0, min), (max: number) => Math.max(0, max)]
        : ["auto", "auto"]}
      tick={{ fill: "currentColor", fontSize: 11 }}
      tickLine={false}
      axisLine={false}
      tickCount={4}
      label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: "currentColor", fontSize: 11 } : undefined}
    />
  </>;
  const tooltip = <Tooltip
    isAnimationActive={false}
    contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--card-foreground)", fontSize: 12 }}
    itemStyle={{ color: "var(--card-foreground)" }}
  />;
  const margin = { top: 8, right: 12, bottom: 0, left: 0 };

  return <div
    className="nodrag nowheel min-w-0 overflow-hidden"
    style={{ width: "100%", height }}
    data-vivic-chart={chartKind}
  >
    <ResponsiveContainer
      width="100%"
      height={height}
      minWidth={1}
      minHeight={144}
      initialDimension={{ width: Math.max(1, card.layout.width - 38), height }}
    >
      {chartKind === "pie" ? <PieChart margin={{ top: 16, right: 24, bottom: 16, left: 24 }} accessibilityLayer>
        <Pie
          data={points.map((point, index) => ({ ...point, fill: `var(--chart-${index % 5 + 1})` }))}
          dataKey="y"
          nameKey="x"
          outerRadius="60%"
          label={({ name, value }) => `${name}: ${value}${yLabel ? ` ${yLabel}` : ""}`}
          isAnimationActive={false}
          stroke="var(--card)"
        />
        {tooltip}
      </PieChart> : chartKind === "bar" ? <BarChart data={points} margin={margin} accessibilityLayer>
        {axis}
        {tooltip}
        <Bar dataKey="y" name={yLabel ?? "y"} fill="var(--chart-1)" isAnimationActive={false} />
      </BarChart> : <LineChart data={points} margin={margin} accessibilityLayer>
        {axis}
        {tooltip}
        <Line dataKey="y" name={yLabel ?? "y"} type="linear" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
      </LineChart>}
    </ResponsiveContainer>
  </div>;
};
