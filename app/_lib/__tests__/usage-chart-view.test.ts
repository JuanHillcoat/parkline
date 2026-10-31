import { describe, expect, it } from "vitest";
import { buildUsageChart, CHART, REFERENCE_CONTRACTED_HOURS } from "../usage-chart-view";

const slot = (index: number): number => Math.round((CHART.left + (index * (CHART.right - CHART.left)) / 11) * 100) / 100;

describe("buildUsageChart", () => {
  it("keeps the scale fixed at 0, 100, 200 and 300 while every value fits", () => {
    expect(buildUsageChart([0, 87, 300], null).ticks.map((tick) => tick.value)).toEqual([0, 100, 200, 300]);
    expect(buildUsageChart([], null).max).toBe(300);
  });

  it("extends the scale to the next multiple of 100 only when a value goes over 300", () => {
    expect(buildUsageChart([301], null).ticks.map((tick) => tick.value)).toEqual([0, 100, 200, 300, 400]);
    expect(buildUsageChart([450], null).max).toBe(500);
  });

  it("widens the step so a very large value does not crowd the axis", () => {
    const chart = buildUsageChart([1000], null);
    expect(chart.ticks.map((tick) => tick.value)).toEqual([0, 200, 400, 600, 800, 1000]);
  });

  it("puts zero on the floor and the top of the scale on the ceiling of the plot", () => {
    const chart = buildUsageChart([0, 300], null);
    expect(chart.ticks[0]?.y).toBe(CHART.bottom);
    expect(chart.ticks.at(-1)?.y).toBe(CHART.top);
    expect(chart.points[0]).toMatchObject({ x: slot(0), y: CHART.bottom, value: 0 });
    expect(chart.points[1]).toMatchObject({ x: slot(1), y: CHART.top, value: 300 });
  });

  it("draws only the months it is given, in their slots of a twelve month axis", () => {
    const chart = buildUsageChart([10, 20, 30], null);
    expect(chart.points.map((point) => point.x)).toEqual([slot(0), slot(1), slot(2)]);
    expect(buildUsageChart(Array<number>(12).fill(1), null).points.at(-1)?.x).toBe(CHART.right);
  });

  it("places the reference line at its value on the same scale", () => {
    const chart = buildUsageChart([0], REFERENCE_CONTRACTED_HOURS);
    const plot = CHART.bottom - CHART.top;
    expect(chart.referenceY).toBe(Math.round((CHART.bottom - (REFERENCE_CONTRACTED_HOURS / 300) * plot) * 100) / 100);
    expect(buildUsageChart([0], null).referenceY).toBeNull();
  });

  it("keeps the reference line on the plot when the scale grows", () => {
    expect(buildUsageChart([900], REFERENCE_CONTRACTED_HOURS).referenceY).toBeGreaterThan(CHART.top);
  });

  it("draws the line through the points and closes the area on the baseline under the last one", () => {
    const chart = buildUsageChart([0, 150, 300], null);
    expect(chart.line).toBe(`M${String(slot(0))},${String(CHART.bottom)} L${String(slot(1))},${String(chart.points[1]?.y)} L${String(slot(2))},${String(CHART.top)}`);
    expect(chart.area.endsWith(`L${String(slot(2))},${String(CHART.bottom)} L${String(slot(0))},${String(CHART.bottom)} Z`)).toBe(true);
  });

  it("draws nothing for no months and treats a negative total as zero", () => {
    expect(buildUsageChart([], null)).toMatchObject({ line: "", area: "", points: [] });
    expect(buildUsageChart([-5], null).points[0]).toMatchObject({ y: CHART.bottom, value: 0 });
  });
});
