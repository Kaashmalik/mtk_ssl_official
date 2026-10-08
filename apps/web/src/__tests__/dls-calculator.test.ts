import { describe, it, expect } from "vitest";
import { calculateDLS, calculateDLSSecondInnings } from "../lib/dls-calculator";

describe("Duckworth-Lewis-Stern (DLS) Calculator", () => {
  it("should calculate DLS values correctly for standard inputs", () => {
    const params = {
      targetRuns: 200,
      oversCompleted: 20,
      totalOvers: 50,
      wicketsLost: 3,
      runsScored: 80,
    };

    const result = calculateDLS(params);

    expect(result.method).toBe("DLS");
    expect(result.resourcesRemaining).toBeGreaterThan(0);
    expect(result.resourcesUsed).toBeGreaterThan(0);
    expect(result.revisedTarget).toBeGreaterThan(80);
    expect(result.parScore).toBeGreaterThan(0);
  });

  it("should interpolate resource values correctly when overs are between 5-over intervals", () => {
    // 18 overs remaining, 2 wickets lost (oversCompleted = 32, totalOvers = 50)
    const result1 = calculateDLS({
      targetRuns: 250,
      oversCompleted: 32,
      totalOvers: 50,
      wicketsLost: 2,
      runsScored: 120,
    });

    expect(result1.resourcesRemaining).toBeGreaterThan(37.1); // 15 overs is 37.1
    expect(result1.resourcesRemaining).toBeLessThan(47.8); // 20 overs is 47.8
  });

  it("should return revisedTarget of at least runsScored + 1", () => {
    const params = {
      targetRuns: 100,
      oversCompleted: 49,
      totalOvers: 50,
      wicketsLost: 9,
      runsScored: 98,
    };

    const result = calculateDLS(params);
    expect(result.revisedTarget).toBe(99);
  });

  it("should handle second innings calculation correctly", () => {
    const params = {
      targetRuns: 300,
      oversCompleted: 10,
      totalOvers: 20,
      wicketsLost: 1,
      runsScored: 90,
    };

    const result = calculateDLSSecondInnings(params);
    expect(result.revisedTarget).toBeGreaterThan(90);
    expect(result.resourcesUsed).toBeGreaterThan(0);
  });
});
