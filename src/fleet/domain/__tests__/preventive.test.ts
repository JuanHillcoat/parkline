import { describe, expect, it } from "vitest";
import { preventiveStatus } from "../preventive";

describe("preventiveStatus", () => {
  it("is ok at the start of the cycle", () => {
    expect(preventiveStatus(250, 1000, 1000)).toEqual({ next: 1250, consumed: 0, remaining: 250, percent: 0, state: "ok" });
  });

  it("stays ok at exactly 75% of the interval", () => {
    expect(preventiveStatus(200, 1000, 1150)).toMatchObject({ consumed: 150, remaining: 50, percent: 75, state: "ok" });
  });

  it("is due soon just above 75% of the interval", () => {
    expect(preventiveStatus(200, 1000, 1150.1)).toMatchObject({ state: "due_soon" });
  });

  it("is overdue when exactly nothing remains", () => {
    expect(preventiveStatus(250, 1000, 1250)).toEqual({ next: 1250, consumed: 250, remaining: 0, percent: 100, state: "overdue" });
  });

  it("is due soon with a sliver remaining", () => {
    expect(preventiveStatus(250, 1000, 1249.9)).toMatchObject({ state: "due_soon" });
  });

  it("caps the percent at 100 and reports negative remaining when overdue", () => {
    expect(preventiveStatus(250, 1000, 1500)).toEqual({ next: 1250, consumed: 500, remaining: -250, percent: 100, state: "overdue" });
  });

  it("never reports negative consumption when the current reading is below the base", () => {
    expect(preventiveStatus(250, 1000, 900)).toEqual({ next: 1250, consumed: 0, remaining: 350, percent: 0, state: "ok" });
  });

  it("handles huge values", () => {
    expect(preventiveStatus(10000, 1e9, 1e9 + 9000)).toMatchObject({ next: 1e9 + 10000, consumed: 9000, percent: 90, state: "due_soon" });
  });
});
